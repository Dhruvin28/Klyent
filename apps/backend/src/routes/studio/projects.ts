import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { listProjects, getProject, createProject } from '../../studio/projectService'

const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  clientName: z.string().max(200).optional(),
  siteAddress: z.string().max(2000).optional(),
  projectType: z.string().max(100).optional(),
  budget: z.number().min(0).optional(),
  timelineNotes: z.string().max(2000).optional(),
  clientId: z.string().optional(),
})

export default async function studioProjectRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/studio/projects
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const projects = await listProjects(userId)
    return reply.send({ data: projects })
  })

  // POST /api/studio/projects
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const result = createProjectSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }
    const project = await createProject(userId, result.data)
    return reply.code(201).send({ data: project })
  })

  // GET /api/studio/projects/:id
  app.get('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const project = await getProject(userId, id)
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    return reply.send({ data: project })
  })
}
