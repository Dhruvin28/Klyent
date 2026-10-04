import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'
import { ingestDocument, listDocuments, getDocument } from '../../studio/documentService'

export default async function studioDocumentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/studio/documents?projectId=...
  app.get('/', async (request, reply) => {
    const userId = request.user.sub
    const { projectId } = request.query as { projectId?: string }
    const documents = await listDocuments(userId, projectId)
    return reply.send({ data: documents })
  })

  // GET /api/studio/documents/:id
  app.get('/:id', async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const document = await getDocument(userId, id)
    if (!document) return reply.code(404).send({ error: 'Document not found' })
    return reply.send({ data: document })
  })

  // POST /api/studio/documents — multipart upload: file + optional projectId/groupName
  app.post('/', async (request, reply) => {
    const userId = request.user.sub
    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'No file provided' })

    const projectIdField = data.fields['projectId'] as { value: string } | undefined
    const groupNameField = data.fields['groupName'] as { value: string } | undefined

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer)
    }
    if (data.file.truncated) {
      return reply.code(413).send({ error: `File too large. Maximum size is ${config.studioUpload.maxSize / (1024 * 1024)}MB.` })
    }

    const buffer = Buffer.concat(chunks)
    const document = await ingestDocument(userId, {
      buffer,
      fileName: data.filename,
      mimeType: data.mimetype,
      projectIdHint: projectIdField?.value || null,
      groupName: groupNameField?.value || null,
      uploadedBy: request.user.email,
    })

    return reply.code(201).send({ data: document })
  })
}
