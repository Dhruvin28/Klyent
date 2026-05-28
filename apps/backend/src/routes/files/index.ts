import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from '../../lib/prisma'
import { s3Client, getPresignedDownloadUrl, deleteS3Object } from '../../lib/s3'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'

const addCommentSchema = z.object({
  content: z.string().min(1, 'Comment cannot be empty').max(2000),
})

const listFilesQuerySchema = z.object({
  clientId: z.string().min(1, 'clientId is required'),
})

const listCommentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export default async function fileRoutes(app: FastifyInstance) {
  // GET /api/files - list files for a client (requires auth)
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const queryResult = listFilesQuerySchema.safeParse(request.query)

    if (!queryResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: queryResult.error.flatten().fieldErrors,
      })
    }

    const { clientId } = queryResult.data

    // Verify ownership
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { userId: true },
    })

    if (!client) {
      return reply.code(404).send({ error: 'Client not found' })
    }
    if (client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const files = await prisma.file.findMany({
      where: { clientId },
      orderBy: { updatedAt: 'desc' },
      include: {
        versions: {
          where: { isActive: true },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: {
            uploadedBy: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: { versions: true, comments: true },
        },
      },
    })

    return reply.send({ data: files })
  })

  // POST /api/files/upload - multipart file upload (requires auth)
  app.post('/upload', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub

    const data = await request.file()

    if (!data) {
      return reply.code(400).send({ error: 'No file provided' })
    }

    // Validate clientId from fields
    const clientIdField = data.fields['clientId'] as { value: string } | undefined
    if (!clientIdField?.value) {
      // consume remaining stream
      data.file.resume()
      return reply.code(400).send({ error: 'clientId is required in form fields' })
    }

    const clientId = clientIdField.value

    const customNameField = data.fields['name'] as { value: string } | undefined
    const descriptionField = data.fields['description'] as { value: string } | undefined
    const customName = customNameField?.value?.trim() || undefined
    const description = descriptionField?.value?.trim() || undefined

    // Verify ownership
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { userId: true, name: true },
    })

    if (!client) {
      data.file.resume()
      return reply.code(404).send({ error: 'Client not found' })
    }
    if (client.userId !== userId) {
      data.file.resume()
      return reply.code(403).send({ error: 'Forbidden' })
    }

    // Validate mime type
    const mimeType = data.mimetype
    if (!config.allowedMimeTypes.includes(mimeType)) {
      data.file.resume()
      return reply.code(400).send({
        error: 'File type not allowed',
        allowed: config.allowedMimeTypes,
      })
    }

    const filename = customName || data.filename

    // Check if file with same name exists for this client
    let existingFile = await prisma.file.findFirst({
      where: { clientId, name: filename },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    })

    const isNewVersion = existingFile !== null
    const nextVersionNumber = isNewVersion ? (existingFile!.versions[0]?.versionNumber ?? 0) + 1 : 1

    // Create File record first if new
    let fileId: string
    if (!isNewVersion) {
      const newFile = await prisma.file.create({
        data: {
          name: filename,
          description,
          mimeType,
          clientId,
        },
      })
      fileId = newFile.id
    } else {
      fileId = existingFile!.id

      // Mark previous versions as inactive
      await prisma.fileVersion.updateMany({
        where: { fileId, isActive: true },
        data: { isActive: false },
      })
    }

    // S3 key
    const s3Key = `users/${userId}/clients/${clientId}/${fileId}/v${nextVersionNumber}/${filename}`

    // Collect file bytes to determine size (stream to S3)
    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer)
    }

    if (data.file.truncated) {
      // File exceeded size limit
      if (!isNewVersion) {
        await prisma.file.delete({ where: { id: fileId } })
      }
      return reply.code(413).send({ error: 'File too large. Maximum size is 50MB.' })
    }

    const fileBuffer = Buffer.concat(chunks)
    const fileSize = fileBuffer.length

    // Upload to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.r2.bucket,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mimeType,
        ContentLength: fileSize,
        Metadata: {
          userId,
          clientId,
          fileId,
          originalName: encodeURIComponent(filename),
        },
      })
    )

    // Create FileVersion
    const version = await prisma.fileVersion.create({
      data: {
        versionNumber: nextVersionNumber,
        s3Key,
        s3Bucket: config.r2.bucket,
        size: fileSize,
        isActive: true,
        uploadedById: userId,
        fileId,
      },
    })

    // Update file updatedAt (and description if provided)
    await prisma.file.update({
      where: { id: fileId },
      data: {
        updatedAt: new Date(),
        ...(description !== undefined && { description }),
      },
    })

    // Log activity
    await prisma.activityLog.create({
      data: {
        type: isNewVersion ? 'FILE_VERSION_ADDED' : 'FILE_UPLOADED',
        metadata: {
          fileId,
          fileName: filename,
          versionNumber: nextVersionNumber,
          size: fileSize,
          clientName: client.name,
        },
        clientId,
        userId,
      },
    })

    const file = await prisma.file.findUnique({
      where: { id: fileId },
      include: {
        versions: {
          where: { isActive: true },
          take: 1,
          include: { uploadedBy: { select: { id: true, name: true } } },
        },
      },
    })

    return reply.code(201).send({
      data: file,
      version,
    })
  })

  // GET /api/files/:id/versions
  app.get('/:id/versions', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const file = await prisma.file.findUnique({
      where: { id },
      include: {
        client: { select: { userId: true } },
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            uploadedBy: { select: { id: true, name: true } },
          },
        },
      },
    })

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    return reply.send({ data: file.versions })
  })

  // GET /api/files/:id/download - redirect to presigned S3 URL
  app.get('/:id/download', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const file = await prisma.file.findUnique({
      where: { id },
      include: {
        client: { select: { userId: true } },
        versions: {
          where: { isActive: true },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    })

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const activeVersion = file.versions[0]
    if (!activeVersion) {
      return reply.code(404).send({ error: 'No active version found' })
    }

    const url = await getPresignedDownloadUrl(activeVersion.s3Key)
    return reply.redirect(302, url)
  })

  // GET /api/files/:id/preview - return presigned URL as JSON
  app.get('/:id/preview', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const file = await prisma.file.findUnique({
      where: { id },
      include: {
        client: { select: { userId: true } },
        versions: {
          where: { isActive: true },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    })

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const activeVersion = file.versions[0]
    if (!activeVersion) {
      return reply.code(404).send({ error: 'No active version found' })
    }

    const url = await getPresignedDownloadUrl(activeVersion.s3Key, 900) // 15-minute URL for preview

    return reply.send({
      data: {
        url,
        expiresIn: 900,
        file: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          versionNumber: activeVersion.versionNumber,
          size: activeVersion.size,
        },
      },
    })
  })

  // DELETE /api/files/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const { hard } = request.query as { hard?: string }

    const file = await prisma.file.findUnique({
      where: { id },
      include: {
        client: { select: { userId: true } },
        versions: true,
      },
    })

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    if (hard === 'true') {
      // Hard delete: remove from S3 and database
      for (const version of file.versions) {
        try {
          await deleteS3Object(version.s3Key)
        } catch (err) {
          app.log.warn({ err, s3Key: version.s3Key }, 'Failed to delete S3 object')
        }
      }
      await prisma.file.delete({ where: { id } })
    } else {
      // Soft delete: deactivate all versions
      await prisma.fileVersion.updateMany({
        where: { fileId: id },
        data: { isActive: false },
      })
    }

    return reply.code(204).send()
  })

  // GET /api/files/share/:token - public endpoint, no auth required
  app.get('/share/:token', async (request, reply) => {
    const { token } = request.params as { token: string }

    const file = await prisma.file.findUnique({
      where: { shareToken: token },
      include: {
        versions: {
          where: { isActive: true },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
        client: { select: { name: true } },
      },
    })

    if (!file) {
      return reply.code(404).send({ error: 'File not found or share link is invalid' })
    }

    const activeVersion = file.versions[0]
    if (!activeVersion) {
      return reply.code(404).send({ error: 'No active version available' })
    }

    const url = await getPresignedDownloadUrl(activeVersion.s3Key, 3600)

    return reply.send({
      data: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        clientName: file.client.name,
        versionNumber: activeVersion.versionNumber,
        size: activeVersion.size,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        downloadUrl: url,
        expiresIn: 3600,
      },
    })
  })

  // POST /api/files/:id/comments
  app.post('/:id/comments', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const result = addCommentSchema.safeParse(request.body)
    if (!result.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: result.error.flatten().fieldErrors,
      })
    }

    const file = await prisma.file.findUnique({
      where: { id },
      include: { client: { select: { userId: true, id: true } } },
    })

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const comment = await prisma.comment.create({
      data: {
        content: result.data.content,
        fileId: id,
        userId,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    })

    await prisma.activityLog.create({
      data: {
        type: 'COMMENT_ADDED',
        metadata: {
          fileId: id,
          fileName: file.name,
          commentId: comment.id,
        },
        clientId: file.client.id,
        userId,
      },
    })

    return reply.code(201).send({ data: comment })
  })

  // GET /api/files/:id/comments
  app.get('/:id/comments', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }
    const queryResult = listCommentsQuerySchema.safeParse(request.query)

    if (!queryResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: queryResult.error.flatten().fieldErrors,
      })
    }

    const { page, limit } = queryResult.data
    const skip = (page - 1) * limit

    const file = await prisma.file.findUnique({
      where: { id },
      include: { client: { select: { userId: true } } },
    })

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.client.userId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where: { fileId: id },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.comment.count({ where: { fileId: id } }),
    ])

    return reply.send({
      data: comments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  })
}
