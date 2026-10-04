import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { askQuestion } from '../../studio/agent'

const askSchema = z.object({
  question: z.string().min(1),
  projectName: z.string().optional(),
})

export default async function studioAskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // POST /api/studio/ask { question, projectName? }
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const result = askSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation Error', details: result.error.flatten().fieldErrors })
    }
    const answer = await askQuestion(userId, result.data.question, { projectName: result.data.projectName })
    return reply.send(answer)
  })
}
