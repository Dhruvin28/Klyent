import path from 'path'
import fs from 'fs'
import Fastify, { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import staticPlugin from '@fastify/static'
import websocket from '@fastify/websocket'
import { config } from './config'
import corsPlugin from './plugins/cors'
import jwtPlugin from './plugins/jwt'
import authRoutes from './routes/auth'
import clientRoutes from './routes/clients'
import paymentRoutes from './routes/payments'
import fileRoutes from './routes/files'
import dashboardRoutes from './routes/dashboard'
import activityRoutes from './routes/activity'
import freelanceRoutes from './routes/freelance'
import proposalRoutes from './routes/proposals'
import invoiceRoutes from './routes/invoices'
import studioProjectRoutes from './routes/studio/projects'
import studioGroupRoutes from './routes/studio/groups'
import studioMessageRoutes from './routes/studio/messages'
import studioDocumentRoutes from './routes/studio/documents'
import studioAskRoutes from './routes/studio/ask'
import studioSearchRoutes from './routes/studio/search'
import studioTaskRoutes from './routes/studio/tasks'
import studioDecisionRoutes from './routes/studio/decisions'
import studioQuoteRoutes from './routes/studio/quotes'
import studioSummaryRoutes from './routes/studio/summary'
import studioImportRoutes from './routes/studio/import'
import studioSettingsRoutes from './routes/studio/settings'
import studioWebhookRoutes from './routes/studio/webhook'

// Augment FastifyRequest to include JWT user payload
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string
      email?: string
      role?: string
      purpose?: string
    }
    user: {
      sub: string
      email: string
      role: string
    }
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        process.env.NODE_ENV !== 'production'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  })

  // Register plugins
  await app.register(corsPlugin)
  await app.register(jwtPlugin)
  await app.register(multipart, {
    limits: {
      fileSize: config.uploadMaxSize,
      files: 1,
    },
  })
  await app.register(websocket)

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, url: request.url, method: request.method }, 'Unhandled error')

    if (error.validation) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: error.message,
        details: error.validation,
      })
    }

    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        error: error.name ?? 'Error',
        message: error.message,
      })
    }

    return reply.code(500).send({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
    })
  })

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // Register routes
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(clientRoutes, { prefix: '/api/clients' })
  await app.register(paymentRoutes, { prefix: '/api/payments' })
  await app.register(fileRoutes, { prefix: '/api/files' })
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' })
  await app.register(activityRoutes, { prefix: '/api/activity' })
  await app.register(freelanceRoutes, { prefix: '/api/freelance' })
  await app.register(proposalRoutes, { prefix: '/api/proposals' })
  await app.register(invoiceRoutes, { prefix: '/api/invoices' })

  // Studio AI — WhatsApp project knowledge engine
  await app.register(studioProjectRoutes, { prefix: '/api/studio/projects' })
  await app.register(studioGroupRoutes, { prefix: '/api/studio/groups' })
  await app.register(studioMessageRoutes, { prefix: '/api/studio/messages' })
  await app.register(studioDocumentRoutes, { prefix: '/api/studio/documents' })
  await app.register(studioAskRoutes, { prefix: '/api/studio/ask' })
  await app.register(studioSearchRoutes, { prefix: '/api/studio/search' })
  await app.register(studioTaskRoutes, { prefix: '/api/studio/tasks' })
  await app.register(studioDecisionRoutes, { prefix: '/api/studio/decisions' })
  await app.register(studioQuoteRoutes, { prefix: '/api/studio/quotes' })
  await app.register(studioSummaryRoutes, { prefix: '/api/studio/summary' })
  await app.register(studioImportRoutes, { prefix: '/api/studio/import' })
  await app.register(studioSettingsRoutes, { prefix: '/api/studio/settings' })
  await app.register(studioWebhookRoutes, { prefix: '/webhooks/studio-whatsapp' })

  // Serve frontend static files in production
  const frontendDist = path.join(__dirname, '../../frontend/dist')
  if (process.env.NODE_ENV === 'production' && fs.existsSync(frontendDist)) {
    await app.register(staticPlugin, { root: frontendDist, prefix: '/' })
    // SPA fallback — serve index.html for all non-API routes
    app.setNotFoundHandler((_request, reply) => {
      reply.sendFile('index.html')
    })
  }

  return app
}
