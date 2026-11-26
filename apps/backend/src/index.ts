import path from 'path'
import dotenv from 'dotenv'
// Resolve .env relative to apps/backend (works from src/ or dist/, any cwd)
dotenv.config({ path: path.resolve(__dirname, '../.env') })
import { buildApp } from './app'
import { config } from './config'
import { runMigrations } from './migrate'
import { startInteriorWorker, stopInteriorWorker } from './interior/jobs'
import './interior/service' // registers the Interior 3D job handlers

async function main() {
  await runMigrations()

  const app = await buildApp()

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`)
    try {
      stopInteriorWorker()
      await app.close()
      process.exit(0)
    } catch (err) {
      app.log.error(err, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  try {
    await app.listen({ port: config.port, host: config.host })
    if (config.interior.enabled) await startInteriorWorker(app.log)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
