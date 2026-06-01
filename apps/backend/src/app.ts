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

// Augment FastifyRequest to include JWT user payload
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string
      email: string
      role: string
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
