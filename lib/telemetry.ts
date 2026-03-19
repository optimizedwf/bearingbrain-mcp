import crypto from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'
import { query, withTransaction } from '@/lib/db'
import type { ChatAttachment } from '@/lib/chat-attachments'

const SESSION_COOKIE_NAME = 'session_id'
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

type JsonRecord = Record<string, unknown>

export function getOrCreateSessionId(req: NextRequest): string {
  return req.cookies.get(SESSION_COOKIE_NAME)?.value ?? crypto.randomUUID()
}

export function applySessionCookie(response: NextResponse, sessionId: string) {
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    maxAge: SESSION_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })
}

export async function recordSiteEvent(params: {
  sessionId: string
  req: NextRequest
  eventName: string
  pagePath?: string | null
  threadId?: string | null
  properties?: JsonRecord
}) {
  await query(
    `INSERT INTO site_events
      (session_id, event_name, page_path, thread_id, properties_json, user_agent, referrer, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())`,
    [
      params.sessionId,
      params.eventName,
      params.pagePath ?? null,
      params.threadId ?? null,
      JSON.stringify(safeJson(params.properties)),
      params.req.headers.get('user-agent')?.slice(0, 500) ?? null,
      params.req.headers.get('referer')?.slice(0, 1000) ?? null,
    ]
  )
}

export async function ensureChatSession(params: {
  threadId: string
  sessionId: string
  title?: string | null
}) {
  await query(
    `INSERT INTO chat_sessions (thread_id, session_id, title, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (thread_id)
     DO UPDATE SET
       session_id = EXCLUDED.session_id,
       title = COALESCE(chat_sessions.title, EXCLUDED.title),
       updated_at = NOW()`,
    [params.threadId, params.sessionId, cleanText(params.title ?? '', 160)]
  )
}

export async function recordChatMessage(params: {
  threadId: string
  sessionId: string
  role: 'user' | 'assistant' | 'error'
  content: string
  attachments?: ChatAttachment[]
  resultCount?: number
  metadata?: JsonRecord
}) {
  const attachmentMeta = summarizeAttachments(params.attachments ?? [])
  const content = cleanText(params.content, 12000)

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO chat_messages
        (id, thread_id, session_id, role, content, attachments_json, result_count, metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, NOW())`,
      [
        crypto.randomUUID(),
        params.threadId,
        params.sessionId,
        params.role,
        content,
        JSON.stringify(attachmentMeta),
        params.resultCount ?? 0,
        JSON.stringify(safeJson(params.metadata)),
      ]
    )

    await client.query(
      `UPDATE chat_sessions
       SET
         updated_at = NOW(),
         message_count = message_count + 1,
         attachment_count = attachment_count + $2,
         last_user_message = CASE WHEN $3 = 'user' THEN $4 ELSE last_user_message END,
         last_error = CASE WHEN $3 = 'error' THEN $4 ELSE last_error END
       WHERE thread_id = $1`,
      [params.threadId, attachmentMeta.length, params.role, cleanText(content, 1000)]
    )
  })
}

function summarizeAttachments(attachments: ChatAttachment[]) {
  return attachments.map((attachment) => ({
    name: cleanText(attachment.name, 255),
    mimeType: cleanText(attachment.mimeType ?? '', 120),
    kind: cleanText(attachment.kind ?? '', 40),
    size: attachment.size ?? null,
    hasExtractedText: Boolean(attachment.extractedText?.trim()),
  }))
}

function cleanText(value: string, limit: number): string {
  return String(value ?? '').trim().slice(0, limit)
}

function safeJson(value: unknown): JsonRecord {
  try {
    const normalized = JSON.parse(JSON.stringify(value ?? {}))
    return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
      ? normalized as JsonRecord
      : {}
  } catch {
    return {}
  }
}
