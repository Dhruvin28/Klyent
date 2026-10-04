import { FastifyInstance } from 'fastify'
import JSZip from 'jszip'
import { eq, and } from 'drizzle-orm'
import { db, studioWhatsappGroups } from '../../db'
import { authenticate } from '../../middleware/authenticate'
import { config } from '../../config'
import { parseMultipart } from '../../lib/multipart'
import { parseWhatsAppExport } from '../../studio/whatsappExportParser'
import { ingestMessage } from '../../studio/messageService'

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
}

function mimeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/**
 * Option C: manual/periodic WhatsApp "Export Chat" import. Accepts either a
 * bare `.txt` export or a `.zip` ("Export Chat" > "Attach Media"), parses it,
 * and feeds every line through the same `ingestMessage` pipeline the generic
 * ingestion endpoint and a future live bridge use — so this is a thin
 * capture-layer adapter, not a parallel pipeline.
 */
export default async function studioImportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // POST /api/studio/import/whatsapp-export — multipart: file + groupName + optional projectId
  app.post('/whatsapp-export', async (request, reply) => {
    const userId = request.user.sub
    const { fields, file } = await parseMultipart(request, { fileSizeLimit: config.studioUpload.maxImportSize })
    if (!file) return reply.code(400).send({ error: 'No file provided' })
    if (file.truncated) {
      return reply.code(413).send({ error: `File too large. Maximum size is ${config.studioUpload.maxImportSize / (1024 * 1024)}MB.` })
    }

    const groupName = fields.groupName?.trim()
    if (!groupName) {
      return reply.code(400).send({ error: 'groupName is required (which project/WhatsApp group this export belongs to)' })
    }

    const buffer = file.buffer
    let chatText: string
    const media = new Map<string, Buffer>()

    const lowerName = file.filename.toLowerCase()
    if (lowerName.endsWith('.zip') || file.mimetype === 'application/zip') {
      const zip = await JSZip.loadAsync(buffer)
      let txtEntry: JSZip.JSZipObject | null = null
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue
        if (entry.name.toLowerCase().endsWith('.txt') && !txtEntry) {
          txtEntry = entry
        }
      }
      if (!txtEntry) {
        return reply.code(400).send({ error: 'No .txt chat export found inside the zip' })
      }
      chatText = await txtEntry.async('string')
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || entry === txtEntry) continue
        media.set(entry.name, await entry.async('nodebuffer'))
      }
    } else {
      chatText = buffer.toString('utf-8')
    }

    const parsed = parseWhatsAppExport(chatText)

    let messagesIngested = 0
    let mediaAttached = 0
    let skipped = 0
    const errors: string[] = []

    for (const line of parsed) {
      if (line.isSystem) {
        skipped++
        continue
      }
      try {
        let mediaPayload: { buffer: Buffer; fileName: string; mimeType: string } | null = null
        if (line.attachedFileName) {
          const found = media.get(line.attachedFileName)
          if (found) {
            mediaPayload = { buffer: found, fileName: line.attachedFileName, mimeType: mimeFromFileName(line.attachedFileName) }
            mediaAttached++
          }
        }

        const isMediaOmitted = line.content.trim() === '<Media omitted>'

        await ingestMessage(userId, {
          source: 'manual_import',
          group_name: groupName,
          sender: line.sender,
          message: isMediaOmitted ? '' : line.content,
          timestamp: line.timestamp.toISOString(),
          media: mediaPayload,
        })
        messagesIngested++
      } catch (err: any) {
        errors.push(err.message || String(err))
      }
    }

    // If a project hint was given and the group isn't linked to one yet,
    // link it now so subsequent imports/live messages resolve automatically.
    if (fields.projectId) {
      await db
        .update(studioWhatsappGroups)
        .set({ projectId: fields.projectId })
        .where(and(eq(studioWhatsappGroups.userId, userId), eq(studioWhatsappGroups.name, groupName)))
    }

    return reply.code(201).send({
      data: {
        totalLines: parsed.length,
        messagesIngested,
        mediaAttached,
        skippedSystemMessages: skipped,
        errors,
      },
    })
  })
}
