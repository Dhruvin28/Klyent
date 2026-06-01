import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { eq, and, desc, count } from 'drizzle-orm'
import { db, clients, files, fileVersions, comments, activityLogs, users, freelanceProjects } from '../../db'
import { s3Client, deleteS3Object } from '../../lib/s3'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'

const addCommentSchema = z.object({
  content: z.string().min(1, 'Comment cannot be empty').max(2000),
})

const listFilesQuerySchema = z.object({
  clientId: z.string().optional(),
  freelanceProjectId: z.string().optional(),
}).refine((d) => d.clientId || d.freelanceProjectId, {
  message: 'Either clientId or freelanceProjectId is required',
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

    const { clientId, freelanceProjectId } = queryResult.data

    // Verify ownership
    if (clientId) {
      const [client] = await db.select({ userId: clients.userId }).from(clients).where(eq(clients.id, clientId)).limit(1)
      if (!client) return reply.code(404).send({ error: 'Client not found' })
      if (client.userId !== userId) return reply.code(403).send({ error: 'Forbidden' })
    }
    if (freelanceProjectId) {
      const [fp] = await db.select({ userId: freelanceProjects.userId }).from(freelanceProjects).where(eq(freelanceProjects.id, freelanceProjectId)).limit(1)
      if (!fp) return reply.code(404).send({ error: 'Freelance project not found' })
      if (fp.userId !== userId) return reply.code(403).send({ error: 'Forbidden' })
    }

    const ownerFilter = clientId ? eq(files.clientId, clientId) : eq(files.freelanceProjectId, freelanceProjectId!)
    const fileRows = await db
      .select()
      .from(files)
      .where(ownerFilter)
      .orderBy(desc(files.updatedAt))

    // For each file, fetch the active version and counts
    const fileIds = fileRows.map((f) => f.id)
    const [activeVersions, versionCounts, commentCounts] = await Promise.all([
      fileIds.length > 0
        ? db
            .select({
              fileId: fileVersions.fileId,
              id: fileVersions.id,
              versionNumber: fileVersions.versionNumber,
              s3Key: fileVersions.s3Key,
              s3Bucket: fileVersions.s3Bucket,
              size: fileVersions.size,
              isActive: fileVersions.isActive,
              uploadedById: fileVersions.uploadedById,
              createdAt: fileVersions.createdAt,
              uploaderName: users.name,
            })
            .from(fileVersions)
            .innerJoin(users, eq(fileVersions.uploadedById, users.id))
            .where(and(eq(fileVersions.isActive, true)))
            .orderBy(desc(fileVersions.versionNumber))
        : [],
      fileIds.length > 0
        ? db
            .select({ fileId: fileVersions.fileId, cnt: count() })
            .from(fileVersions)
            .where(eq(fileVersions.isActive, fileVersions.isActive))
            .groupBy(fileVersions.fileId)
        : [],
      fileIds.length > 0
        ? db
            .select({ fileId: comments.fileId, cnt: count() })
            .from(comments)
            .groupBy(comments.fileId)
        : [],
    ])

    // Index by fileId — keep only first (highest version)
    const activeVersionMap = new Map<string, (typeof activeVersions)[0]>()
    for (const v of activeVersions) {
      if (!activeVersionMap.has(v.fileId)) {
        activeVersionMap.set(v.fileId, v)
      }
    }
    const versionCountMap = new Map(versionCounts.map((r) => [r.fileId, Number(r.cnt)]))
    const commentCountMap = new Map(commentCounts.map((r) => [r.fileId, Number(r.cnt)]))

    const result = fileRows.map((file) => {
      const av = activeVersionMap.get(file.id)
      return {
        ...file,
        versions: av
          ? [
              {
                id: av.id,
                versionNumber: av.versionNumber,
                s3Key: av.s3Key,
                s3Bucket: av.s3Bucket,
                size: av.size,
                isActive: av.isActive,
                uploadedById: av.uploadedById,
                fileId: av.fileId,
                createdAt: av.createdAt,
                uploadedBy: { id: av.uploadedById, name: av.uploaderName },
              },
            ]
          : [],
        _count: {
          versions: versionCountMap.get(file.id) ?? 0,
          comments: commentCountMap.get(file.id) ?? 0,
        },
      }
    })

    return reply.send({ data: result })
  })

  // POST /api/files/upload - multipart file upload (requires auth)
  app.post('/upload', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub

    const data = await request.file()

    if (!data) {
      return reply.code(400).send({ error: 'No file provided' })
    }

    const clientIdField = data.fields['clientId'] as { value: string } | undefined
    const freelanceProjectIdField = data.fields['freelanceProjectId'] as { value: string } | undefined
    const clientId = clientIdField?.value || undefined
    const freelanceProjectId = freelanceProjectIdField?.value || undefined

    if (!clientId && !freelanceProjectId) {
      data.file.resume()
      return reply.code(400).send({ error: 'Either clientId or freelanceProjectId is required' })
    }

    const customNameField = data.fields['name'] as { value: string } | undefined
    const descriptionField = data.fields['description'] as { value: string } | undefined
    const customName = customNameField?.value?.trim() || undefined
    const description = descriptionField?.value?.trim() || undefined

    // Verify ownership
    if (clientId) {
      const [client] = await db
        .select({ userId: clients.userId })
        .from(clients).where(eq(clients.id, clientId)).limit(1)
      if (!client) { data.file.resume(); return reply.code(404).send({ error: 'Client not found' }) }
      if (client.userId !== userId) { data.file.resume(); return reply.code(403).send({ error: 'Forbidden' }) }
    }
    if (freelanceProjectId) {
      const [fp] = await db
        .select({ userId: freelanceProjects.userId })
        .from(freelanceProjects).where(eq(freelanceProjects.id, freelanceProjectId)).limit(1)
      if (!fp) { data.file.resume(); return reply.code(404).send({ error: 'Freelance project not found' }) }
      if (fp.userId !== userId) { data.file.resume(); return reply.code(403).send({ error: 'Forbidden' }) }
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

    // Check if file with same name exists for this client/project
    const ownerCondition = clientId
      ? eq(files.clientId, clientId)
      : eq(files.freelanceProjectId, freelanceProjectId!)
    const [existingFile] = await db
      .select()
      .from(files)
      .where(and(ownerCondition, eq(files.name, filename)))
      .limit(1)

    let latestVersionNumber = 0
    if (existingFile) {
      const [latestVersion] = await db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, existingFile.id))
        .orderBy(desc(fileVersions.versionNumber))
        .limit(1)
      latestVersionNumber = latestVersion?.versionNumber ?? 0
    }

    const isNewVersion = existingFile !== undefined
    const nextVersionNumber = latestVersionNumber + 1

    // Create File record first if new
    let fileId: string
    if (!isNewVersion) {
      fileId = crypto.randomUUID()
      const shareToken = crypto.randomUUID()
      await db.insert(files).values({
        id: fileId,
        name: filename,
        description,
        mimeType,
        clientId: clientId ?? null,
        freelanceProjectId: freelanceProjectId ?? null,
        shareToken,
      })
    } else {
      fileId = existingFile!.id

      // Mark previous versions as inactive
      await db
        .update(fileVersions)
        .set({ isActive: false })
        .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.isActive, true)))
    }

    // S3 key
    const ownerSegment = clientId ? `clients/${clientId}` : `freelance/${freelanceProjectId}`
    const s3Key = `users/${userId}/${ownerSegment}/${fileId}/v${nextVersionNumber}/${filename}`

    // Collect file bytes to determine size (stream to S3)
    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer)
    }

    if (data.file.truncated) {
      // File exceeded size limit
      if (!isNewVersion) {
        await db.delete(files).where(eq(files.id, fileId))
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
          fileId,
          originalName: encodeURIComponent(filename ?? ''),
          ...(clientId ? { clientId } : {}),
        },
      })
    )

    // Create FileVersion
    const versionId = crypto.randomUUID()
    await db.insert(fileVersions).values({
      id: versionId,
      versionNumber: nextVersionNumber,
      s3Key,
      s3Bucket: config.r2.bucket,
      size: fileSize,
      isActive: true,
      uploadedById: userId,
      fileId,
    })

    const [version] = await db.select().from(fileVersions).where(eq(fileVersions.id, versionId)).limit(1)

    // Update file updatedAt (and description if provided)
    await db.update(files).set(
      description !== undefined ? { description, updatedAt: new Date() } : { updatedAt: new Date() }
    ).where(eq(files.id, fileId))

    // Log activity only for client files (activity_logs requires clientId NOT NULL)
    if (clientId) {
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        type: isNewVersion ? 'FILE_VERSION_ADDED' : 'FILE_UPLOADED',
        metadata: { fileId, fileName: filename, versionNumber: nextVersionNumber, size: fileSize },
        clientId,
        userId,
      })
    }

    // Return the full file with active version
    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1)
    const activeVersionRows = await db
      .select({
        id: fileVersions.id,
        versionNumber: fileVersions.versionNumber,
        s3Key: fileVersions.s3Key,
        s3Bucket: fileVersions.s3Bucket,
        size: fileVersions.size,
        isActive: fileVersions.isActive,
        uploadedById: fileVersions.uploadedById,
        fileId: fileVersions.fileId,
        createdAt: fileVersions.createdAt,
        uploaderName: users.name,
      })
      .from(fileVersions)
      .innerJoin(users, eq(fileVersions.uploadedById, users.id))
      .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.isActive, true)))
      .limit(1)

    return reply.code(201).send({
      data: {
        ...file,
        versions: activeVersionRows.map((v) => ({
          ...v,
          uploadedBy: { id: v.uploadedById, name: v.uploaderName },
        })),
      },
      version,
    })
  })

  // GET /api/files/:id/versions
  app.get('/:id/versions', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [file] = await db
      .select({
        id: files.id,
        clientUserId: clients.userId,
      })
      .from(files)
      .innerJoin(clients, eq(files.clientId, clients.id))
      .where(eq(files.id, id))
      .limit(1)

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.clientUserId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const versions = await db
      .select({
        id: fileVersions.id,
        versionNumber: fileVersions.versionNumber,
        s3Key: fileVersions.s3Key,
        s3Bucket: fileVersions.s3Bucket,
        size: fileVersions.size,
        isActive: fileVersions.isActive,
        uploadedById: fileVersions.uploadedById,
        fileId: fileVersions.fileId,
        createdAt: fileVersions.createdAt,
        uploaderName: users.name,
      })
      .from(fileVersions)
      .innerJoin(users, eq(fileVersions.uploadedById, users.id))
      .where(eq(fileVersions.fileId, id))
      .orderBy(desc(fileVersions.versionNumber))

    return reply.send({
      data: versions.map((v) => ({
        ...v,
        uploadedBy: { id: v.uploadedById, name: v.uploaderName },
      })),
    })
  })

  // GET /api/files/:id/download - redirect to presigned S3 URL
  app.get('/:id/download', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [file] = await db
      .select({ id: files.id, clientUserId: clients.userId })
      .from(files)
      .innerJoin(clients, eq(files.clientId, clients.id))
      .where(eq(files.id, id))
      .limit(1)

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.clientUserId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const [activeVersion] = await db
      .select()
      .from(fileVersions)
      .where(and(eq(fileVersions.fileId, id), eq(fileVersions.isActive, true)))
      .orderBy(desc(fileVersions.versionNumber))
      .limit(1)

    if (!activeVersion) {
      return reply.code(404).send({ error: 'No active version found' })
    }

    const url = `${config.r2.publicUrl}/${activeVersion.s3Key}`
    return reply.redirect(302, url)
  })

  // GET /api/files/:id/preview - return presigned URL as JSON
  app.get('/:id/preview', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub
    const { id } = request.params as { id: string }

    const [file] = await db
      .select({
        id: files.id,
        name: files.name,
        mimeType: files.mimeType,
        clientUserId: clients.userId,
      })
      .from(files)
      .innerJoin(clients, eq(files.clientId, clients.id))
      .where(eq(files.id, id))
      .limit(1)

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.clientUserId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const [activeVersion] = await db
      .select()
      .from(fileVersions)
      .where(and(eq(fileVersions.fileId, id), eq(fileVersions.isActive, true)))
      .orderBy(desc(fileVersions.versionNumber))
      .limit(1)

    if (!activeVersion) {
      return reply.code(404).send({ error: 'No active version found' })
    }

    const url = `${config.r2.publicUrl}/${activeVersion.s3Key}`

    return reply.send({
      data: {
        url,
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

    const [file] = await db
      .select({ id: files.id, clientUserId: clients.userId })
      .from(files)
      .innerJoin(clients, eq(files.clientId, clients.id))
      .where(eq(files.id, id))
      .limit(1)

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.clientUserId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    if (hard === 'true') {
      // Hard delete: remove from S3 and database
      const allVersions = await db.select().from(fileVersions).where(eq(fileVersions.fileId, id))
      for (const version of allVersions) {
        try {
          await deleteS3Object(version.s3Key)
        } catch (err) {
          app.log.warn({ err, s3Key: version.s3Key }, 'Failed to delete S3 object')
        }
      }
      await db.delete(files).where(eq(files.id, id))
    } else {
      // Soft delete: deactivate all versions
      await db.update(fileVersions).set({ isActive: false }).where(eq(fileVersions.fileId, id))
    }

    return reply.code(204).send()
  })

  // GET /api/files/share/:token - public endpoint, no auth required
  app.get('/share/:token', async (request, reply) => {
    const { token } = request.params as { token: string }

    const [file] = await db
      .select({
        id: files.id,
        name: files.name,
        mimeType: files.mimeType,
        createdAt: files.createdAt,
        updatedAt: files.updatedAt,
        shareToken: files.shareToken,
        clientId: files.clientId,
        clientName: clients.name,
      })
      .from(files)
      .innerJoin(clients, eq(files.clientId, clients.id))
      .where(eq(files.shareToken, token))
      .limit(1)

    if (!file) {
      return reply.code(404).send({ error: 'File not found or share link is invalid' })
    }

    const [activeVersion] = await db
      .select()
      .from(fileVersions)
      .where(and(eq(fileVersions.fileId, file.id), eq(fileVersions.isActive, true)))
      .orderBy(desc(fileVersions.versionNumber))
      .limit(1)

    if (!activeVersion) {
      return reply.code(404).send({ error: 'No active version available' })
    }

    const url = `${config.r2.publicUrl}/${activeVersion.s3Key}`

    return reply.send({
      data: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        clientName: file.clientName,
        versionNumber: activeVersion.versionNumber,
        size: activeVersion.size,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        downloadUrl: url,
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

    const [file] = await db
      .select({ id: files.id, name: files.name, clientId: files.clientId, clientUserId: clients.userId })
      .from(files)
      .innerJoin(clients, eq(files.clientId, clients.id))
      .where(eq(files.id, id))
      .limit(1)

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.clientUserId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const commentId = crypto.randomUUID()
    await db.insert(comments).values({
      id: commentId,
      content: result.data.content,
      fileId: id,
      userId,
    })

    const [comment] = await db
      .select({
        id: comments.id,
        content: comments.content,
        fileId: comments.fileId,
        userId: comments.userId,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        userName: users.name,
        userEmail: users.email,
      })
      .from(comments)
      .innerJoin(users, eq(comments.userId, users.id))
      .where(eq(comments.id, commentId))
      .limit(1)

    // Log activity only for client files (activityLogs clientId is NOT NULL)
    if (file.clientId) {
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        type: 'COMMENT_ADDED',
        metadata: { fileId: id, fileName: file.name, commentId },
        clientId: file.clientId,
        userId,
      })
    }

    return reply.code(201).send({
      data: {
        ...comment,
        user: { id: comment.userId, name: comment.userName, email: comment.userEmail },
      },
    })
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

    const [file] = await db
      .select({ id: files.id, clientUserId: clients.userId })
      .from(files)
      .innerJoin(clients, eq(files.clientId, clients.id))
      .where(eq(files.id, id))
      .limit(1)

    if (!file) {
      return reply.code(404).send({ error: 'File not found' })
    }
    if (file.clientUserId !== userId) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const [commentRows, [{ total }]] = await Promise.all([
      db
        .select({
          id: comments.id,
          content: comments.content,
          fileId: comments.fileId,
          userId: comments.userId,
          createdAt: comments.createdAt,
          updatedAt: comments.updatedAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(comments)
        .innerJoin(users, eq(comments.userId, users.id))
        .where(eq(comments.fileId, id))
        .orderBy(desc(comments.createdAt))
        .limit(limit)
        .offset(skip),
      db.select({ total: count() }).from(comments).where(eq(comments.fileId, id)),
    ])

    return reply.send({
      data: commentRows.map((c) => ({
        ...c,
        user: { id: c.userId, name: c.userName, email: c.userEmail },
      })),
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    })
  })
}
