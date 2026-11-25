import { randomBytes } from 'node:crypto'
import type { FastifyBaseLogger } from 'fastify'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import { config } from '../config'
import { db, intJobs } from '../db'

// Durable background jobs on MySQL (plan §13). The app has no queue service, so the
// job table itself is the queue: workers claim with an atomic conditional UPDATE, hold
// a lease renewed by heartbeat, and may only commit results while their lease token is
// current. Delivery is at-least-once; handlers must be idempotent.

export type JobType = 'extract_document' | 'interpret_page' | 'build_scene' | 'render_view'

export interface JobContext {
  job: typeof intJobs.$inferSelect
  leaseToken: string
  /** Throws JobCanceled if cancellation was requested. */
  checkpoint: (progress?: Record<string, unknown>) => Promise<void>
  /** True while this worker still owns the job (use inside result transactions). */
  stillOwner: (tx?: typeof db) => Promise<boolean>
  log: FastifyBaseLogger
}

export class JobError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false
  ) {
    super(message)
  }
}
class JobCanceled extends Error {}
class LeaseLost extends Error {}

type Handler = (ctx: JobContext) => Promise<Record<string, unknown> | void>
const handlers = new Map<JobType, Handler>()
export function registerJobHandler(type: JobType, h: Handler) {
  handlers.set(type, h)
}

/** Enqueues a job; the (user, idempotency key) pair makes duplicate requests no-ops. */
export async function enqueueJob(
  tx: Pick<typeof db, 'insert' | 'select'>,
  job: { userId: string; workspaceId: string; type: JobType; targetId: string; idempotencyKey: string; input?: unknown; maxAttempts?: number }
): Promise<string> {
  const id = crypto.randomUUID()
  await tx
    .insert(intJobs)
    .ignore()
    .values({
      id,
      userId: job.userId,
      workspaceId: job.workspaceId,
      type: job.type,
      targetId: job.targetId,
      idempotencyKey: job.idempotencyKey.slice(0, 191),
      input: job.input ?? null,
      maxAttempts: job.maxAttempts ?? 3,
    })
  const [row] = await tx
    .select({ id: intJobs.id })
    .from(intJobs)
    .where(and(eq(intJobs.userId, job.userId), eq(intJobs.idempotencyKey, job.idempotencyKey.slice(0, 191))))
    .limit(1)
  kick()
  return row?.id ?? id
}

let running = 0
let timer: NodeJS.Timeout | null = null
let wake: (() => void) | null = null
let stopped = false
let logger: FastifyBaseLogger | null = null

/** Nudges the dispatcher (after commit) so new work starts without waiting for the sweep. */
export function kick() {
  wake?.()
}

const leaseUntil = () => new Date(Date.now() + config.interior.leaseSeconds * 1000)

async function claim(): Promise<{ job: typeof intJobs.$inferSelect; token: string } | null> {
  const candidates = await db
    .select({ id: intJobs.id })
    .from(intJobs)
    .where(and(inArray(intJobs.status, ['queued', 'retry_wait']), lte(intJobs.availableAt, new Date())))
    .orderBy(intJobs.availableAt)
    .limit(10)
  for (const c of candidates) {
    const token = randomBytes(16).toString('hex')
    const res = await db
      .update(intJobs)
      .set({ status: 'running', leaseToken: token, leaseExpiresAt: leaseUntil(), attempt: sql`${intJobs.attempt} + 1`, startedAt: new Date(), error: null, errorCode: null })
      .where(and(eq(intJobs.id, c.id), inArray(intJobs.status, ['queued', 'retry_wait'])))
    const affected = (res as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0
    if (affected === 1) {
      const [job] = await db.select().from(intJobs).where(eq(intJobs.id, c.id)).limit(1)
      if (job) return { job, token }
    }
  }
  return null
}

async function recoverExpired() {
  // Running jobs whose worker died: make them retryable (or failed when out of attempts).
  await db
    .update(intJobs)
    .set({ status: sql`IF(${intJobs.attempt} >= ${intJobs.maxAttempts}, 'failed', 'retry_wait')`, leaseToken: null, errorCode: 'LEASE_EXPIRED', error: 'The worker stopped before finishing; the job was re-queued.', availableAt: new Date() })
    .where(and(eq(intJobs.status, 'running'), lte(intJobs.leaseExpiresAt, new Date())))
  await db
    .update(intJobs)
    .set({ status: 'canceled', finishedAt: new Date() })
    .where(and(inArray(intJobs.status, ['queued', 'retry_wait']), sql`${intJobs.cancelRequestedAt} IS NOT NULL`))
}

async function runJob(job: typeof intJobs.$inferSelect, token: string) {
  const log = (logger ?? console) as FastifyBaseLogger
  const owner = async (tx: typeof db = db) => {
    const [r] = await tx.select({ t: intJobs.leaseToken, s: intJobs.status, c: intJobs.cancelRequestedAt }).from(intJobs).where(eq(intJobs.id, job.id)).limit(1)
    return !!r && r.t === token && r.s === 'running' && !r.c
  }
  const heartbeat = setInterval(
    () => {
      db.update(intJobs)
        .set({ leaseExpiresAt: leaseUntil() })
        .where(and(eq(intJobs.id, job.id), eq(intJobs.leaseToken, token)))
        .catch(() => undefined)
    },
    Math.max(5, config.interior.leaseSeconds / 3) * 1000
  )
  const ctx: JobContext = {
    job,
    leaseToken: token,
    log,
    stillOwner: owner,
    checkpoint: async (progress) => {
      const [r] = await db.select({ t: intJobs.leaseToken, c: intJobs.cancelRequestedAt }).from(intJobs).where(eq(intJobs.id, job.id)).limit(1)
      if (!r || r.t !== token) throw new LeaseLost()
      if (r.c) throw new JobCanceled()
      if (progress) await db.update(intJobs).set({ progress }).where(and(eq(intJobs.id, job.id), eq(intJobs.leaseToken, token)))
    },
  }
  const finish = (set: Partial<typeof intJobs.$inferInsert>) => db.update(intJobs).set({ ...set, leaseToken: null, leaseExpiresAt: null }).where(and(eq(intJobs.id, job.id), eq(intJobs.leaseToken, token)))
  try {
    const handler = handlers.get(job.type as JobType)
    if (!handler) throw new JobError('UNKNOWN_JOB', `No handler for ${job.type}`)
    const result = await handler(ctx)
    await finish({ status: 'succeeded', result: result ?? null, finishedAt: new Date() })
    // After the job row is terminal, so follow-up checks see it as done.
    await onJobSucceeded?.(job).catch((err) => log.error({ err, jobId: job.id }, 'interior job success hook failed'))
  } catch (err) {
    if (err instanceof LeaseLost) {
      log.warn({ jobId: job.id }, 'interior job lost its lease; result discarded')
      return
    }
    if (err instanceof JobCanceled) {
      await finish({ status: 'canceled', finishedAt: new Date() })
      return
    }
    const e = err as JobError & { retryable?: boolean; code?: string }
    const retryable = !!e.retryable && job.attempt < job.maxAttempts
    const backoff = Math.min(15 * 60, 20 * 2 ** (job.attempt - 1)) * 1000 * (0.75 + Math.random() * 0.5)
    log.error({ err, jobId: job.id, type: job.type, attempt: job.attempt }, 'interior job failed')
    await finish({
      status: retryable ? 'retry_wait' : 'failed',
      errorCode: (e.code ?? 'INTERNAL').slice(0, 64),
      error: (e.message ?? 'Unexpected error').slice(0, 2000),
      availableAt: retryable ? new Date(Date.now() + backoff) : undefined,
      finishedAt: retryable ? null : new Date(),
    })
    await onJobFailed?.(job, retryable)
  } finally {
    clearInterval(heartbeat)
  }
}

let onJobFailed: ((job: typeof intJobs.$inferSelect, willRetry: boolean) => Promise<void>) | null = null
export function setJobFailureHook(h: typeof onJobFailed) {
  onJobFailed = h
}
let onJobSucceeded: ((job: typeof intJobs.$inferSelect) => Promise<void>) | null = null
export function setJobSuccessHook(h: typeof onJobSucceeded) {
  onJobSucceeded = h
}

async function tick() {
  if (stopped) return
  while (running < config.interior.workerConcurrency) {
    const claimed = await claim().catch((err) => {
      logger?.error({ err }, 'interior job claim failed')
      return null
    })
    if (!claimed) break
    running++
    runJob(claimed.job, claimed.token)
      .catch((err) => logger?.error({ err }, 'interior job crashed'))
      .finally(() => {
        running--
        kick()
      })
  }
}

export async function startInteriorWorker(log: FastifyBaseLogger) {
  logger = log
  stopped = false
  await recoverExpired().catch((err) => log.error({ err }, 'interior job recovery failed'))
  let sweeps = 0
  const loop = async () => {
    while (!stopped) {
      await tick()
      if (++sweeps % 20 === 0) await recoverExpired().catch(() => undefined)
      await new Promise<void>((resolve) => {
        wake = resolve
        timer = setTimeout(resolve, 2000)
      })
      wake = null
      if (timer) clearTimeout(timer)
    }
  }
  void loop()
  log.info(`Interior 3D worker started (concurrency ${config.interior.workerConcurrency}, model ${config.interior.model})`)
}

export function stopInteriorWorker() {
  stopped = true
  wake?.()
}
