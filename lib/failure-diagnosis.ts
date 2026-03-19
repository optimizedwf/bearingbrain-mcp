import { GoogleGenAI } from '@google/genai'

const FAILURE_DIAG_MODEL = process.env.FAILURE_DIAG_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

export const FAILURE_DIAGNOSIS_SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

const genAI = process.env.GOOGLE_GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY })
  : null

const SYSTEM_PROMPT = `You are a senior rotating equipment reliability engineer specializing in bearing failure analysis.

You are given a bearing photo and optional context notes. Your job is to produce a practical diagnostic assessment.

Rules:
- Be conservative: mention uncertainty when visual evidence is weak.
- Do not fabricate exact measurements or test readings.
- Keep language practical for maintenance teams.
- Always output strict JSON only. No markdown.
- Confidence must be between 0 and 1.
- If image quality is poor, include that in evidence and recommend follow-up inspection.`

export interface FailureModeFinding {
  mode: string
  confidence: number
  evidence: string[]
}

export interface FailureDiagnosisInput {
  imageBase64: string
  mimeType: string
  notes?: string
  applicationContext?: string
}

export interface FailureDiagnosisResult {
  summary: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  likelyFailureModes: FailureModeFinding[]
  probableRootCauses: string[]
  immediateActions: string[]
  correctiveActions: string[]
  verificationChecks: string[]
  replacementRecommendation: string
  followUpQuestions: string[]
  disclaimer: string
}

export async function diagnoseBearingFailure(
  input: FailureDiagnosisInput
): Promise<FailureDiagnosisResult> {
  if (!genAI) {
    throw new Error('GOOGLE_GEMINI_API_KEY is not configured')
  }

  const prompt = [
    'Analyze this bearing image for likely failure modes.',
    '',
    `Context notes: ${input.notes?.trim() || 'none provided'}`,
    `Application context: ${input.applicationContext?.trim() || 'none provided'}`,
    '',
    'Return JSON in this exact shape:',
    '{',
    '  "summary": "string max 40 words",',
    '  "severity": "low|medium|high|critical",',
    '  "likelyFailureModes": [',
    '    { "mode": "string", "confidence": 0.0, "evidence": ["string", "string"] }',
    '  ],',
    '  "probableRootCauses": ["string"],',
    '  "immediateActions": ["string"],',
    '  "correctiveActions": ["string"],',
    '  "verificationChecks": ["string"],',
    '  "replacementRecommendation": "string",',
    '  "followUpQuestions": ["string"],',
    '  "disclaimer": "string"',
    '}',
  ].join('\n')

  const result = await genAI.models.generateContent({
    model: FAILURE_DIAG_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.imageBase64,
            },
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.2,
      maxOutputTokens: 1600,
    },
  })

  const parts = (result as { candidates?: Array<{ content?: { parts?: Array<{ thought?: boolean; text?: string }> } }> })
    .candidates?.[0]?.content?.parts ?? []

  const rawText = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim()

  const parsed = parseJsonObject(rawText)
  return normalizeDiagnosis(parsed)
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // noop - continue to brace extraction
  }

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const inner = cleaned.slice(start, end + 1)
    const parsed = JSON.parse(inner)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  }

  throw new Error('Failed to parse diagnosis JSON')
}

function normalizeDiagnosis(parsed: Record<string, unknown>): FailureDiagnosisResult {
  const likelyFailureModes = normalizeFailureModes(parsed.likelyFailureModes)

  return {
    summary: asString(parsed.summary) ?? 'Unable to determine failure mode confidently from this image.',
    severity: normalizeSeverity(parsed.severity),
    likelyFailureModes,
    probableRootCauses: asStringArray(parsed.probableRootCauses, 5),
    immediateActions: asStringArray(parsed.immediateActions, 6),
    correctiveActions: asStringArray(parsed.correctiveActions, 6),
    verificationChecks: asStringArray(parsed.verificationChecks, 8),
    replacementRecommendation:
      asString(parsed.replacementRecommendation) ??
      'Inspect manually and replace if pitting, spalling, or discoloration is confirmed.',
    followUpQuestions: asStringArray(parsed.followUpQuestions, 5),
    disclaimer:
      asString(parsed.disclaimer) ??
      'Image-based analysis is advisory. Confirm with teardown inspection and operating data before final decisions.',
  }
}

function normalizeFailureModes(value: unknown): FailureModeFinding[] {
  if (!Array.isArray(value)) return []

  return value
    .slice(0, 4)
    .map((item) => {
      const row = item as { mode?: unknown; confidence?: unknown; evidence?: unknown }
      const mode = asString(row.mode)
      if (!mode) return null

      return {
        mode,
        confidence: clampConfidence(row.confidence),
        evidence: asStringArray(row.evidence, 4),
      }
    })
    .filter((item): item is FailureModeFinding => item !== null)
}

function normalizeSeverity(value: unknown): FailureDiagnosisResult['severity'] {
  const normalized = asString(value)?.toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'critical') {
    return normalized
  }
  return 'medium'
}

function clampConfidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, round(value)))
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, round(parsed)))
    }
  }

  return 0.45
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function asStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit)
}
