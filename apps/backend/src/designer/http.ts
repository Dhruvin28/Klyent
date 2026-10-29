import type { FastifyReply, FastifyRequest } from 'fastify'

export function displayName(fileName: string) {
  return fileName.replace(/\.(png|jpe?g|webp|webm|mp4)$/i, '')
}

/** Sends a buffer honouring a single `Range: bytes=a-b` request (lets <video> seek). */
export function sendWithRange(request: FastifyRequest, reply: FastifyReply, data: Buffer) {
  const range = request.headers.range
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : data.length - parseInt(m[2], 10)
    let end = m[1] && m[2] ? parseInt(m[2], 10) : data.length - 1
    start = Math.max(0, start)
    end = Math.min(end, data.length - 1)
    if (start > end || start >= data.length) {
      return reply.code(416).header('Content-Range', `bytes */${data.length}`).send()
    }
    return reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${data.length}`)
      .header('Content-Length', String(end - start + 1))
      .send(data.subarray(start, end + 1))
  }
  return reply.header('Content-Length', String(data.length)).send(data)
}
