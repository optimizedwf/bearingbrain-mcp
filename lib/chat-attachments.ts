import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type ChatAttachmentKind = 'image' | 'pdf' | 'text' | 'csv' | 'other'

export interface ChatAttachment {
  name: string
  mimeType: string
  size: number
  filePath: string
  kind: ChatAttachmentKind
  extractedText?: string
}

export interface PreparedChatAttachments {
  tempDir?: string
  attachments: ChatAttachment[]
}

const MAX_ATTACHMENTS = 5
const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_EXTRACTED_TEXT_CHARS = 6000

export async function persistUploadedFiles(files: File[]): Promise<PreparedChatAttachments> {
  const validFiles = files
    .filter((file) => file && typeof file.arrayBuffer === 'function')
    .slice(0, MAX_ATTACHMENTS)

  if (!validFiles.length) return { attachments: [] }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'partsbrain-chat-'))
  const attachments: ChatAttachment[] = []

  for (let index = 0; index < validFiles.length; index++) {
    const file = validFiles[index]
    if (file.size <= 0) continue
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`File too large: ${file.name} exceeds ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB`)
    }

    const safeName = sanitizeFileName(file.name || `upload-${index + 1}`)
    const filePath = path.join(tempDir, `${index + 1}-${safeName}`)
    const mimeType = String(file.type || guessMimeType(safeName) || 'application/octet-stream')
    const kind = classifyAttachment(safeName, mimeType)
    const buffer = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(filePath, buffer)

    const attachment: ChatAttachment = {
      name: safeName,
      mimeType,
      size: file.size,
      filePath,
      kind,
    }

    attachment.extractedText = await extractAttachmentText(attachment)
    attachments.push(attachment)
  }

  return { tempDir, attachments }
}

export async function cleanupPreparedChatAttachments(tempDir?: string): Promise<void> {
  if (!tempDir) return
  try {
    await fs.rm(tempDir, { recursive: true, force: true })
  } catch {
    // best effort cleanup
  }
}

function classifyAttachment(name: string, mimeType: string): ChatAttachmentKind {
  const lowerName = name.toLowerCase()
  const lowerType = mimeType.toLowerCase()

  if (lowerType.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(lowerName)) return 'image'
  if (lowerType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf'
  if (lowerType.includes('csv') || lowerName.endsWith('.csv')) return 'csv'
  if (
    lowerType.startsWith('text/') ||
    /\.(txt|md|markdown|log|json|yaml|yml|xml)$/i.test(lowerName)
  ) {
    return 'text'
  }

  return 'other'
}

async function extractAttachmentText(attachment: ChatAttachment): Promise<string | undefined> {
  try {
    if (attachment.kind === 'pdf') {
      const text = await runCommand('pdftotext', ['-layout', '-nopgbrk', attachment.filePath, '-'])
      return normalizeExtractedText(text)
    }

    if (attachment.kind === 'text' || attachment.kind === 'csv') {
      const text = await fs.readFile(attachment.filePath, 'utf8')
      return normalizeExtractedText(text)
    }
  } catch (err) {
    console.warn(`Attachment extraction failed for ${attachment.name}:`, err)
  }

  return undefined
}

function normalizeExtractedText(text: string): string | undefined {
  const cleaned = text.replace(/\u0000/g, '').replace(/\r/g, '').trim()
  if (!cleaned) return undefined
  return cleaned.slice(0, MAX_EXTRACTED_TEXT_CHARS)
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'upload'
}

function guessMimeType(name: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return undefined
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr || stdout || 'no output'}`))
    })
  })
}
