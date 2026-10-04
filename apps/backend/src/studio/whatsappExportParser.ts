/**
 * Parser for WhatsApp's "Export Chat" feature (Settings → more → Export
 * chat, with or without media). This is the Option C capture path: zero
 * integration risk, fully manual, good for validating the knowledge engine
 * against real historical data before committing to a live bridge.
 *
 * Handles both common export line formats:
 *   Android: "12/01/24, 10:30 - Sender Name: message text"
 *   iOS:     "[12/01/24, 10:30:15] Sender Name: message text"
 *
 * Assumes day-first dates (DD/MM/YY), which is what WhatsApp exports use for
 * the vast majority of locales. Multi-line messages (no date prefix on
 * continuation lines) are appended to the previous message. System messages
 * (no "Sender: " prefix, e.g. "X joined using this group's invite link") are
 * kept with `sender: null, isSystem: true` and are not ingested as content.
 */

export interface ParsedWhatsAppMessage {
  timestamp: Date
  sender: string | null
  content: string
  attachedFileName: string | null
  isSystem: boolean
}

const ANDROID_LINE = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?:\s?[APap][Mm])?)\s-\s(.*)$/
const IOS_LINE = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}:\d{2}(?:\s?[APap][Mm])?)\]\s(.*)$/

function parseDateTime(dateStr: string, timeStr: string): Date | null {
  const parts = dateStr.split('/').map((s) => parseInt(s, 10))
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null
  const [day, month, yRaw] = parts
  const year = yRaw < 100 ? (yRaw < 70 ? 2000 + yRaw : 1900 + yRaw) : yRaw

  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([APap][Mm])?/)
  if (!timeMatch) return null
  let hour = parseInt(timeMatch[1], 10)
  const minute = parseInt(timeMatch[2], 10)
  const second = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0
  const ampm = timeMatch[4]?.toLowerCase()
  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0

  const date = new Date(year, month - 1, day, hour, minute, second)
  return Number.isNaN(date.getTime()) ? null : date
}

function splitSenderAndContent(rest: string): { sender: string | null; content: string; isSystem: boolean } {
  const match = rest.match(/^(.*?):\s(.*)$/s)
  if (!match) {
    return { sender: null, content: rest.trim(), isSystem: true }
  }
  const [, sender, content] = match
  // Heuristic: a real sender name is short and has no newlines; otherwise this
  // was probably a colon inside a system message or a long message with an
  // early colon (e.g. "Note: ..."). Treat as system/unattributed in that case.
  if (sender.length > 60 || sender.includes('\n')) {
    return { sender: null, content: rest.trim(), isSystem: true }
  }
  return { sender: sender.trim(), content: content.trim(), isSystem: false }
}

function extractAttachment(content: string): { content: string; attachedFileName: string | null } {
  const attachedMatch = content.match(/^(.*?)\s\(file attached\)\s*$/)
  if (attachedMatch) {
    return { content, attachedFileName: attachedMatch[1].trim() }
  }
  return { content, attachedFileName: null }
}

export function parseWhatsAppExport(rawText: string): ParsedWhatsAppMessage[] {
  // Strip BOM and normalize line endings; WhatsApp exports also use U+200E
  // (left-to-right mark) around the date/time on some platforms.
  const clean = rawText.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/‎/g, '')
  const lines = clean.split('\n')

  const messages: ParsedWhatsAppMessage[] = []

  for (const line of lines) {
    const androidMatch = line.match(ANDROID_LINE)
    const iosMatch = !androidMatch ? line.match(IOS_LINE) : null
    const match = androidMatch || iosMatch

    if (match) {
      const [, dateStr, timeStr, rest] = match
      const timestamp = parseDateTime(dateStr, timeStr)
      if (!timestamp) {
        // Couldn't parse the date -- treat as a continuation line instead of
        // dropping it.
        appendToLast(messages, line)
        continue
      }
      const { sender, content, isSystem } = splitSenderAndContent(rest)
      const { content: finalContent, attachedFileName } = extractAttachment(content)
      messages.push({ timestamp, sender, content: finalContent, attachedFileName, isSystem })
    } else if (line.trim().length > 0) {
      appendToLast(messages, line)
    }
  }

  return messages
}

function appendToLast(messages: ParsedWhatsAppMessage[], line: string) {
  const last = messages[messages.length - 1]
  if (!last) return // leading junk before the first real line -- drop it
  last.content = last.content ? `${last.content}\n${line}` : line
}
