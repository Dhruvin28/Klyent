import { FastifyRequest } from 'fastify'

export interface ParsedMultipartFile {
  buffer: Buffer
  filename: string
  mimetype: string
  truncated: boolean
}

export interface ParsedMultipart {
  fields: Record<string, string>
  file: ParsedMultipartFile | null
}

/**
 * Fully drains a multipart request into fields + (at most) one file.
 *
 * `request.file()` from @fastify/multipart resolves as soon as it reaches
 * the first file part in the stream, and only fields that appeared *before*
 * the file are populated on `.fields` at that point -- fields sent after the
 * file (e.g. a browser's `FormData.append('file', ...)` followed by
 * `.append('groupName', ...)`) are silently missing. Iterating `request.parts()`
 * to completion avoids that field-order trap entirely, which matters both
 * for the dashboard's own uploads and for any external caller (a WhatsApp
 * bridge, a script) that won't necessarily send fields in a particular order.
 */
export async function parseMultipart(request: FastifyRequest, opts?: { fileSizeLimit?: number }): Promise<ParsedMultipart> {
  const fields: Record<string, string> = {}
  let file: ParsedMultipartFile | null = null

  const parts = request.parts(opts?.fileSizeLimit ? { limits: { fileSize: opts.fileSizeLimit } } : undefined)
  for await (const part of parts) {
    if (part.type === 'file') {
      const chunks: Buffer[] = []
      for await (const chunk of part.file) chunks.push(chunk as Buffer)
      file = {
        buffer: Buffer.concat(chunks),
        filename: part.filename,
        mimetype: part.mimetype,
        truncated: part.file.truncated,
      }
    } else {
      fields[part.fieldname] = typeof part.value === 'string' ? part.value : String(part.value)
    }
  }

  return { fields, file }
}
