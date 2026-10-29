import { useCallback, useEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { designerApi } from '@/api/designer'
import type { DesignProject, Plan } from '@/lib/designer/types'

export type Selection = { kind: 'wall' | 'opening' | 'room' | 'item'; id: string } | null
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

const MAX_HISTORY = 100
const SAVE_DELAY = 1000

/**
 * Live plan state for the designer: undo/redo, drag gestures that collapse into a
 * single history step, and debounced autosave guarded by the project revision.
 */
export function useDesignerEditor(project: DesignProject) {
  const [plan, setPlan] = useState<Plan>(project.plan)
  const [selection, setSelection] = useState<Selection>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [historyLen, setHistoryLen] = useState({ past: 0, future: 0 })

  const planRef = useRef(plan)
  planRef.current = plan
  const past = useRef<Plan[]>([])
  const future = useRef<Plan[]>([])
  const gestureStart = useRef<Plan | null>(null)
  const revision = useRef(project.revision)
  const savedPlan = useRef<Plan>(project.plan)
  const saving = useRef(false)
  const timer = useRef<number | null>(null)

  const syncHistory = () => setHistoryLen({ past: past.current.length, future: future.current.length })

  /**
   * Applies a change. `transient` changes (during a drag) don't create history
   * entries until `commit()` is called.
   */
  const update = useCallback((fn: (p: Plan) => Plan, opts: { transient?: boolean } = {}) => {
    const prev = planRef.current
    const next = fn(prev)
    if (next === prev) return
    if (opts.transient) {
      if (!gestureStart.current) gestureStart.current = prev
    } else if (!gestureStart.current) {
      past.current = [...past.current.slice(-MAX_HISTORY + 1), prev]
      future.current = []
      syncHistory()
    }
    planRef.current = next
    setPlan(next)
  }, [])

  /** Ends a drag gesture, recording one undo step for it. */
  const commit = useCallback(() => {
    const start = gestureStart.current
    gestureStart.current = null
    if (start && start !== planRef.current) {
      past.current = [...past.current.slice(-MAX_HISTORY + 1), start]
      future.current = []
      syncHistory()
    }
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(planRef.current)
    planRef.current = prev
    setPlan(prev)
    syncHistory()
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(planRef.current)
    planRef.current = next
    setPlan(next)
    syncHistory()
  }, [])

  const save = useCallback(async () => {
    if (saving.current) return
    const toSave = planRef.current
    if (toSave === savedPlan.current) return
    saving.current = true
    setStatus('saving')
    try {
      const res = await designerApi.updateProject(project.id, { revision: revision.current, plan: toSave })
      revision.current = res.revision
      savedPlan.current = toSave
      setStatus(planRef.current === toSave ? 'saved' : 'dirty')
    } catch (err) {
      setStatus(isAxiosError(err) && err.response?.status === 409 ? 'conflict' : 'error')
    } finally {
      saving.current = false
    }
  }, [project.id])

  // Debounced autosave; reschedules while a save is in flight or a drag is active.
  useEffect(() => {
    if (plan === savedPlan.current || status === 'conflict') return
    setStatus((s) => (s === 'saving' ? s : 'dirty'))
    if (timer.current) window.clearTimeout(timer.current)
    const tick = () => {
      if (saving.current || gestureStart.current) {
        timer.current = window.setTimeout(tick, 400)
        return
      }
      void save().then(() => {
        if (planRef.current !== savedPlan.current) timer.current = window.setTimeout(tick, 200)
      })
    }
    timer.current = window.setTimeout(tick, SAVE_DELAY)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [plan, save, status])

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (planRef.current !== savedPlan.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  const rename = useCallback(
    async (name: string) => {
      const res = await designerApi.updateProject(project.id, { revision: revision.current, name })
      revision.current = res.revision
      return res
    },
    [project.id]
  )

  const setClient = useCallback(
    async (clientId: string | null) => {
      const res = await designerApi.updateProject(project.id, { revision: revision.current, clientId })
      revision.current = res.revision
      return res
    },
    [project.id]
  )

  return {
    plan,
    update,
    commit,
    undo,
    redo,
    canUndo: historyLen.past > 0,
    canRedo: historyLen.future > 0,
    selection,
    setSelection,
    status,
    saveNow: save,
    rename,
    setClient,
  }
}

export type DesignerEditor = ReturnType<typeof useDesignerEditor>
