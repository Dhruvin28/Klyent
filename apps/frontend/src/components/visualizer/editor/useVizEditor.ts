import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { visualizerApi, type VizProject } from '@/api/visualizer'
import { EngineClient, type Frame } from '@/lib/visualizer/engineClient'
import { PROTECT_KEY, type RenderSpec, type SpecSurface } from '@/lib/visualizer/engine'
import { decodePngExact } from '@/lib/visualizer/imageio'
import { SamClient } from '@/lib/visualizer/samClient'
import type { Mask, RGBAImage, VizAssignment, VizMaterial, VizOption, VizState, VizSurface } from '@/lib/visualizer/types'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

interface MaskEntry {
  data: Uint8Array
  version: number
  /** Asset id of the last uploaded copy of this exact version, if any. */
  assetId: string | null
  savedVersion: number
}

interface UndoEntry {
  key: string
  x0: number
  y0: number
  x1: number
  y1: number
  before: Uint8Array
  after: Uint8Array
}

const UNDO_LIMIT = 40

export function defaultAssignment(material: VizMaterial): VizAssignment {
  const s = material.settings
  return {
    materialId: material.id,
    pattern: material.kind === 'texture' ? s?.defaultPattern ?? (material.category === 'tile' ? 'tiles' : 'continuous') : 'continuous',
    rotationDeg: 0,
    offsetXMm: 0,
    offsetYMm: 0,
    scale: 1,
    finish: s?.defaultFinish ?? (material.kind === 'paint' ? 'matte' : 'satin'),
    shading: 1,
    detail: material.kind === 'paint' ? 0.15 : 0.1,
    smoothing: 0.5,
    exposure: 1,
    tile: s?.tile ?? { layout: 'grid', groutMm: 2, groutColor: '#cfcac2', variation: true },
  }
}

/** Builds the engine render spec for one option (surfaces without material are skipped). */
export function buildSpec(state: VizState, option: VizOption, materials: Map<string, VizMaterial>): RenderSpec {
  const surfaces: SpecSurface[] = []
  for (const s of state.surfaces) {
    const a = option.assignments[s.id]
    if (!a) continue
    const m = materials.get(a.materialId)
    if (!m) continue
    surfaces.push({
      id: s.id,
      quad: s.quad,
      widthMm: s.widthMm,
      heightMm: s.heightMm,
      feather: s.feather,
      assignment: a,
      material:
        m.kind === 'paint'
          ? { kind: 'paint', colorHex: m.colorHex ?? '#ffffff' }
          : { kind: 'texture', materialId: m.id, widthMm: m.widthMm ?? 1000, heightMm: m.heightMm ?? 1000 },
    })
  }
  return { surfaces }
}

export function useVizEditor(project: VizProject, materialsList: VizMaterial[]) {
  const W = project.width
  const H = project.height
  const [state, setStateRaw] = useState<VizState>(project.state)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [maskTick, setMaskTick] = useState(0)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [texturesLoading, setTexturesLoading] = useState<string[]>([])
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false })

  const originalRef = useRef<RGBAImage | null>(null)
  const engineRef = useRef<EngineClient | null>(null)
  const samRef = useRef<SamClient | null>(null)
  const masks = useRef(new Map<string, MaskEntry>())
  const revision = useRef(project.revision)
  const stateRef = useRef(state)
  const dirtyState = useRef(false)
  const undoStack = useRef<UndoEntry[]>([])
  const redoStack = useRef<UndoEntry[]>([])
  const loadedTextures = useRef(new Map<string, string>()) // materialId → texture asset id loaded into the engine
  const versionCounter = useRef(1)

  const materials = useMemo(() => new Map(materialsList.map((m) => [m.id, m])), [materialsList])
  stateRef.current = state

  // ── state updates ────────────────────────────────────────────────────────
  const setState = useCallback((fn: (s: VizState) => VizState) => {
    setStateRaw((prev) => {
      const next = fn(prev)
      if (next !== prev) {
        dirtyState.current = true
        setSaveStatus((st) => (st === 'conflict' ? st : 'dirty'))
      }
      return next
    })
  }, [])

  const activeOption = state.options.find((o) => o.id === state.activeOptionId) ?? state.options[0]

  // ── initial load: reference pixels, engine, saved masks ─────────────────
  useEffect(() => {
    let cancelled = false
    const engine = new EngineClient()
    engineRef.current = engine
    samRef.current = new SamClient()
    ;(async () => {
      try {
        const blob = await visualizerApi.getAssetBlob(project.referenceAssetId)
        const img = await decodePngExact(blob)
        if (img.width !== W || img.height !== H) throw new Error('Reference render size mismatch')
        if (cancelled) return
        originalRef.current = img
        await engine.init(img)
        const keys: [string, string | null][] = [
          ...project.state.surfaces.map((s) => [s.id, s.maskAssetId] as [string, string | null]),
          [PROTECT_KEY, project.state.protectMaskAssetId],
        ]
        for (const [key, assetId] of keys) {
          let data: Uint8Array
          if (assetId) {
            const mblob = await visualizerApi.getAssetBlob(assetId)
            data = await engine.decodeMask(mblob, W, H)
          } else data = new Uint8Array(W * H)
          const version = versionCounter.current++
          masks.current.set(key, { data, version, assetId, savedVersion: version })
          await engine.setMask(key, version, data)
        }
        if (cancelled) return
        setReady(true)
        setMaskTick((t) => t + 1)
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load the project')
      }
    })()
    return () => {
      cancelled = true
      engine.dispose()
      samRef.current?.dispose()
    }
  }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── masks ────────────────────────────────────────────────────────────────
  const getMask = useCallback((key: string): Mask | null => {
    const e = masks.current.get(key)
    return e ? { width: W, height: H, data: e.data } : null
  }, [W, H])

  const ensureMask = useCallback((key: string): MaskEntry => {
    let e = masks.current.get(key)
    if (!e) {
      const version = versionCounter.current++
      e = { data: new Uint8Array(W * H), version, assetId: null, savedVersion: -1 }
      masks.current.set(key, e)
    }
    return e
  }, [W, H])

  const pushMaskToEngine = useCallback(async (key: string) => {
    const e = masks.current.get(key)
    await engineRef.current?.setMask(key, e?.version ?? 0, e ? e.data : null)
  }, [])

  const markMaskChanged = useCallback((key: string) => {
    const e = ensureMask(key)
    e.version = versionCounter.current++
    setSaveStatus((st) => (st === 'conflict' ? st : 'dirty'))
    void pushMaskToEngine(key).then(() => setMaskTick((t) => t + 1))
  }, [ensureMask, pushMaskToEngine])

  const refreshUndo = () => setUndoState({ canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 })

  /** Records an undo step from a full snapshot taken before an edit (stores only the changed rectangle). */
  const commitEdit = useCallback((key: string, before: Uint8Array) => {
    const e = masks.current.get(key)
    if (!e) return
    const after = e.data
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    for (let y = 0; y < H; y++) {
      const row = y * W
      for (let x = 0; x < W; x++) {
        if (before[row + x] !== after[row + x]) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          y1 = y
        }
      }
    }
    if (x1 < 0) return // no change
    const rw = x1 - x0 + 1
    const rh = y1 - y0 + 1
    const b = new Uint8Array(rw * rh)
    const a = new Uint8Array(rw * rh)
    for (let y = 0; y < rh; y++) {
      b.set(before.subarray((y + y0) * W + x0, (y + y0) * W + x0 + rw), y * rw)
      a.set(after.subarray((y + y0) * W + x0, (y + y0) * W + x0 + rw), y * rw)
    }
    undoStack.current.push({ key, x0, y0, x1: x1 + 1, y1: y1 + 1, before: b, after: a })
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift()
    redoStack.current = []
    refreshUndo()
    markMaskChanged(key)
  }, [W, H, markMaskChanged])

  /** Applies a mutation to a mask with undo support. */
  const editMask = useCallback((key: string, mutate: (m: Mask) => void) => {
    const e = ensureMask(key)
    const before = e.data.slice()
    mutate({ width: W, height: H, data: e.data })
    commitEdit(key, before)
  }, [W, H, ensureMask, commitEdit])

  const applyUndo = (from: UndoEntry[], to: UndoEntry[], useBefore: boolean) => {
    const u = from.pop()
    if (!u) return
    const e = ensureMask(u.key)
    const rw = u.x1 - u.x0
    const src = useBefore ? u.before : u.after
    for (let y = 0; y < u.y1 - u.y0; y++) e.data.set(src.subarray(y * rw, (y + 1) * rw), (y + u.y0) * W + u.x0)
    to.push(u)
    refreshUndo()
    markMaskChanged(u.key)
  }
  const undo = useCallback(() => applyUndo(undoStack.current, redoStack.current, true), []) // eslint-disable-line react-hooks/exhaustive-deps
  const redo = useCallback(() => applyUndo(redoStack.current, undoStack.current, false), []) // eslint-disable-line react-hooks/exhaustive-deps

  const removeMask = useCallback((key: string) => {
    masks.current.delete(key)
    undoStack.current = undoStack.current.filter((u) => u.key !== key)
    redoStack.current = redoStack.current.filter((u) => u.key !== key)
    refreshUndo()
    void engineRef.current?.setMask(key, 0, null)
    setMaskTick((t) => t + 1)
  }, [])

  // ── textures for the materials in use ────────────────────────────────────
  // Keyed by content so slider tweaks (new options array) don't restart texture loads.
  const usedMaterialKey = useMemo(() => {
    const ids = new Set<string>()
    for (const o of state.options) for (const a of Object.values(o.assignments)) ids.add(a.materialId)
    return [...ids].sort().join(',')
  }, [state.options])
  const usedMaterialIds = useMemo(() => (usedMaterialKey ? usedMaterialKey.split(',') : []), [usedMaterialKey])
  const texturesInFlight = useRef(new Set<string>())

  useEffect(() => {
    if (!ready) return
    const engine = engineRef.current!
    const todo = usedMaterialIds
      .map((id) => materials.get(id))
      .filter(
        (m): m is VizMaterial =>
          !!m &&
          m.kind === 'texture' &&
          !!m.textureAssetId &&
          loadedTextures.current.get(m.id) !== m.textureAssetId &&
          !texturesInFlight.current.has(`${m.id}:${m.textureAssetId}`)
      )
    if (!todo.length) return
    setTexturesLoading((l) => [...new Set([...l, ...todo.map((m) => m.id)])])
    // Loads are never cancelled by later edits; a finished load that is no longer needed is pruned.
    for (const m of todo) {
      const key = `${m.id}:${m.textureAssetId}`
      texturesInFlight.current.add(key)
      ;(async () => {
        try {
          const blob = await visualizerApi.getAssetBlob(m.textureAssetId!)
          const img = await decodePngExact(blob)
          await engine.setTexture(m.id, m.textureAssetId!, img)
          loadedTextures.current.set(m.id, m.textureAssetId!)
          setMaskTick((t) => t + 1) // re-render with the texture in place
        } catch {
          setRenderError(`Could not load the texture for "${m.name}"`)
        } finally {
          texturesInFlight.current.delete(key)
          setTexturesLoading((l) => l.filter((x) => x !== m.id))
        }
      })()
    }
  }, [ready, usedMaterialIds, materials])

  // ── rendering (latest-wins scheduler: fast preview, then exact full frame) ─
  const spec = useMemo(() => (activeOption ? buildSpec(state, activeOption, materials) : { surfaces: [] }), [state, activeOption, materials])
  const renderGen = useRef(0)
  const previewBusy = useRef(false)
  const previewPending = useRef<{ spec: RenderSpec; gen: number } | null>(null)
  const fullLandedGen = useRef(0)

  const runPreview = useCallback((s: RenderSpec, gen: number) => {
    const engine = engineRef.current
    if (!engine) return
    if (previewBusy.current) {
      previewPending.current = { spec: s, gen }
      return
    }
    previewBusy.current = true
    engine
      .render(s, true)
      .then((f) => {
        // Never let a late preview replace the exact frame of the same generation.
        if (gen === renderGen.current && fullLandedGen.current !== gen && f.quality === 'preview') setFrame(f)
      })
      .catch(() => undefined)
      .finally(() => {
        previewBusy.current = false
        const next = previewPending.current
        previewPending.current = null
        if (next && next.gen === renderGen.current && fullLandedGen.current !== next.gen) runPreview(next.spec, next.gen)
      })
  }, [])

  useEffect(() => {
    if (!ready) return
    const gen = ++renderGen.current
    setRendering(true)
    runPreview(spec, gen)
    const t = setTimeout(() => {
      engineRef.current
        ?.render(spec, false)
        .then((f) => {
          if (gen !== renderGen.current) return
          fullLandedGen.current = gen
          setFrame(f)
          setRendering(false)
          setRenderError(null)
        })
        .catch((err) => {
          if (gen !== renderGen.current) return
          setRendering(false)
          setRenderError(err instanceof Error ? err.message : 'Render failed')
        })
    }, 280)
    return () => clearTimeout(t)
  }, [ready, spec, maskTick, runPreview])

  // Free engine caches for deleted surfaces / unused textures.
  useEffect(() => {
    if (!ready) return
    void engineRef.current?.prune(state.surfaces.map((s) => s.id), usedMaterialIds)
    for (const id of [...loadedTextures.current.keys()]) if (!usedMaterialIds.includes(id)) loadedTextures.current.delete(id)
  }, [ready, state.surfaces, usedMaterialIds])

  // ── saving (masks → assets, then optimistic-concurrency PATCH) ──────────
  const saving = useRef<Promise<boolean> | null>(null)
  const conflicted = useRef(false)
  const pendingName = useRef<string | null>(null)

  const doSave = useCallback(async () => {
    const engine = engineRef.current
    if (!engine) throw new Error('Editor is still loading')
    const snapshot = stateRef.current
    const name = pendingName.current
    // Clear the dirty flag at snapshot time: an edit made while masks upload sets it
    // again and triggers another save instead of being swallowed by this one.
    const wasDirtyAtStart = dirtyState.current
    dirtyState.current = false
    try {
      await saveSnapshot(engine, snapshot, name)
    } catch (err) {
      if (wasDirtyAtStart) dirtyState.current = true
      throw err
    }
  }, [W, H, project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveSnapshot = async (engine: EngineClient, snapshot: VizState, name: string | null) => {
    const ids: Record<string, string | null> = {}
    const keys = [...snapshot.surfaces.map((s) => s.id), PROTECT_KEY]
    for (const key of keys) {
      const e = masks.current.get(key)
      if (!e) {
        ids[key] = null
        continue
      }
      if (e.savedVersion === e.version) {
        ids[key] = e.assetId
        continue
      }
      const version = e.version
      let any = false
      for (let i = 0; i < e.data.length; i++) if (e.data[i]) { any = true; break }
      if (!any) {
        e.assetId = null
        e.savedVersion = version
        ids[key] = null
        continue
      }
      const png = await engine.encodeMask(W, H, e.data)
      const assetId = await visualizerApi.uploadMask(project.id, png)
      // Only mark clean if no edit happened while encoding/uploading.
      if (e.version === version) {
        e.assetId = assetId
        e.savedVersion = version
      }
      ids[key] = assetId
    }
    const toSave: VizState = {
      ...snapshot,
      surfaces: snapshot.surfaces.map((s) => ({ ...s, maskAssetId: ids[s.id] ?? null })),
      protectMaskAssetId: ids[PROTECT_KEY] ?? null,
    }
    const saved = await visualizerApi.updateProject(project.id, { revision: revision.current, state: toSave, ...(name ? { name } : {}) })
    revision.current = saved.revision
    if (pendingName.current === name) pendingName.current = null
    // Reflect new asset ids without marking the document dirty.
    setStateRaw((cur) => ({
      ...cur,
      surfaces: cur.surfaces.map((s) => (s.id in ids ? { ...s, maskAssetId: ids[s.id] ?? null } : s)),
      protectMaskAssetId: ids[PROTECT_KEY] ?? null,
    }))
  }

  const isDirty = useCallback(() => {
    if (dirtyState.current || pendingName.current) return true
    for (const e of masks.current.values()) if (e.savedVersion !== e.version) return true
    return false
  }, [])

  /** Persists masks + state. Resolves true when everything up to this call is saved. */
  const save = useCallback(async (): Promise<boolean> => {
    if (conflicted.current) return false
    if (saving.current) {
      // Wait for the in-flight save, then save whatever changed meanwhile.
      await saving.current
      return save()
    }
    if (!isDirty()) {
      setSaveStatus('saved')
      return true
    }
    setSaveStatus('saving')
    const p = doSave()
      .then(() => {
        setSaveError(null)
        setSaveStatus(isDirty() ? 'dirty' : 'saved')
        return true
      })
      .catch((err) => {
        const status = (err as { response?: { status?: number } }).response?.status
        if (status === 409) {
          conflicted.current = true
          setSaveStatus('conflict')
        } else setSaveStatus('error')
        const e = err as { response?: { data?: { message?: string } }; message?: string }
        setSaveError(e.response?.data?.message ?? e.message ?? 'Save failed')
        return false
      })
      .finally(() => {
        saving.current = null
      })
    saving.current = p
    return p
  }, [doSave, isDirty])

  /** Renames the project through the same revision-checked, serialised save path. */
  const rename = useCallback(async (name: string): Promise<boolean> => {
    pendingName.current = name
    return save()
  }, [save])

  // Autosave 1.5s after the last change.
  useEffect(() => {
    if (!ready || saveStatus !== 'dirty') return
    const t = setTimeout(() => void save(), 1500)
    return () => clearTimeout(t)
  }, [ready, saveStatus, state, maskTick, save])

  // Warn before closing the tab with unsaved work.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty() || saving.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  // ── helpers for panels ───────────────────────────────────────────────────
  const updateSurface = useCallback((id: string, patch: Partial<VizSurface>) => {
    setState((s) => ({ ...s, surfaces: s.surfaces.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  }, [setState])

  const updateAssignment = useCallback((optionId: string, surfaceId: string, patch: Partial<VizAssignment> | null, material?: VizMaterial) => {
    setState((s) => ({
      ...s,
      options: s.options.map((o) => {
        if (o.id !== optionId) return o
        const assignments = { ...o.assignments }
        if (patch === null) delete assignments[surfaceId]
        else if (material) assignments[surfaceId] = { ...defaultAssignment(material), ...patch }
        else if (assignments[surfaceId]) assignments[surfaceId] = { ...assignments[surfaceId], ...patch }
        return { ...o, assignments }
      }),
    }))
  }, [setState])

  const renderOption = useCallback(async (optionId: string): Promise<Frame> => {
    const s = stateRef.current
    const o = s.options.find((x) => x.id === optionId)
    if (!o) throw new Error('Option not found')
    return engineRef.current!.render(buildSpec(s, o, materials), false)
  }, [materials])

  const exportOption = useCallback(async (optionId: string) => {
    const s = stateRef.current
    const o = s.options.find((x) => x.id === optionId)
    if (!o) throw new Error('Option not found')
    return engineRef.current!.exportPng(buildSpec(s, o, materials))
  }, [materials])

  return {
    W,
    H,
    ready,
    loadError,
    original: originalRef,
    engine: engineRef,
    sam: samRef,
    state,
    setState,
    activeOption,
    materials,
    getMask,
    ensureMask,
    editMask,
    commitEdit,
    removeMask,
    maskTick,
    undo,
    redo,
    ...undoState,
    frame,
    rendering,
    renderError,
    texturesLoading,
    saveStatus,
    saveError,
    save,
    rename,
    updateSurface,
    updateAssignment,
    renderOption,
    exportOption,
  }
}

export type VizEditor = ReturnType<typeof useVizEditor>
