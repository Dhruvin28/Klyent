import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'
import { parseMultipart } from '../../lib/multipart'
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
    const { fields, file } = await parseMultipart(request, { fileSizeLimit: config.studioUpload.maxSize })
    if (!file) return reply.code(400).send({ error: 'No file provided' })
    if (file.truncated) {
      return reply.code(413).send({ error: `File too large. Maximum size is ${config.studioUpload.maxSize / (1024 * 1024)}MB.` })
    }

    const document = await ingestDocument(userId, {
      buffer: file.buffer,
      fileName: file.filename,
      mimeType: file.mimetype,
      projectIdHint: fields.projectId || null,
      groupName: fields.groupName || null,
      uploadedBy: request.user.email,
    })

    return reply.code(201).send({ data: document })
  })
}
