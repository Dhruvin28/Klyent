import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../../config'

export class RenderError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false
  ) {
    super(message)
  }
}

const SCRIPT = [path.join(__dirname, 'blender', 'render_scene.py'), path.resolve(__dirname, '../../../src/interior/render/blender/render_scene.py')].find((p) => existsSync(p)) ?? path.join(__dirname, 'blender', 'render_scene.py')

/** The executable exists and its bundled Python (<dir>/<version>/python) came with it. */
export function blenderConfigured() {
  const exe = config.interior.render.blenderPath
  if (!exe || !existsSync(exe)) return false
  try {
    const dir = path.dirname(exe)
    return readdirSync(dir).some((d) => /^\d+\.\d+$/.test(d) && existsSync(path.join(dir, d, 'python', 'lib')))
  } catch {
    return false
  }
}

/** Runs the Cycles render in a headless Blender process and resolves when the PNG exists. */
export async function runBlender(opts: { sceneJson: string; outPng: string; width: number; height: number; samples: number; onLog?: (line: string) => void; signal?: AbortSignal }): Promise<void> {
  const exe = config.interior.render.blenderPath
  if (!exe) throw new RenderError('BLENDER_NOT_CONFIGURED', 'Server-side rendering needs Blender. Set BLENDER_PATH to the Blender executable on the render worker.')
  if (!blenderConfigured()) throw new RenderError('BLENDER_INCOMPLETE', 'Blender is still installing or its install is incomplete (bundled Python missing). It retries automatically on the next restart; use Retry in a few minutes.', true)
  if (!existsSync(exe)) throw new RenderError('BLENDER_NOT_FOUND', `BLENDER_PATH does not exist: ${exe}`)
  if (!existsSync(SCRIPT)) throw new RenderError('BLENDER_SCRIPT_MISSING', `Render script not found at ${SCRIPT}`)
  const args = ['-b', '--factory-startup', '-noaudio', '-P', SCRIPT, '--', opts.sceneJson, opts.outPng, String(opts.width), String(opts.height), String(opts.samples), String(config.interior.render.blenderThreads)]
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTHONHOME: '', PYTHONPATH: '', BLENDER_DEVICE: config.interior.render.blenderDevice } })
    const tail: string[] = []
    const onData = (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue
        tail.push(line)
        if (tail.length > 40) tail.shift()
        opts.onLog?.(line)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new RenderError('RENDER_TIMEOUT', `Blender did not finish within ${Math.round(config.interior.render.timeoutMs / 60000)} minutes.`, false))
    }, config.interior.render.timeoutMs)
    opts.signal?.addEventListener('abort', () => child.kill('SIGKILL'))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new RenderError('BLENDER_SPAWN', `Could not start Blender: ${err.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && existsSync(opts.outPng)) return resolve()
      const msg = tail.filter((l) => /error|exception|traceback|failed/i.test(l)).slice(-6).join(' | ') || tail.slice(-4).join(' | ')
      reject(new RenderError('BLENDER_FAILED', `Blender exited with code ${code}. ${msg}`.slice(0, 1500), true))
    })
  })
}
