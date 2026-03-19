/**
 * AI Spec Parser
 * - Primary provider: pi CLI (openai-codex/gpt-5.3-codex by default)
 * - Fallback provider: Google Gemini
 */

import { spawn } from 'node:child_process'
import { GoogleGenAI } from '@google/genai'
import { ParsedBearingQuery } from './types'

const AI_PROVIDER = (process.env.SITE_AGENT_PROVIDER ?? 'pi').toLowerCase()
const PI_BIN = process.env.PI_AGENT_BIN ?? 'pi'
const PI_MODEL = process.env.PI_AGENT_MODEL ?? 'google/gemini-3.1-pro-preview'
const PI_PARSE_MODEL = process.env.PI_PARSE_MODEL ?? process.env.PARTS_HELPER_MODEL ?? PI_MODEL
const PI_TIMEOUT_MS = Number(process.env.PI_AGENT_TIMEOUT_MS ?? 12000)
const PI_THINKING = process.env.PI_AGENT_THINKING ?? 'minimal'
const PI_CWD = process.env.PI_AGENT_CWD ?? process.env.HOME ?? '/tmp'
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-pro-preview'

const genAI = process.env.GOOGLE_GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY })
  : null

const SYSTEM_PROMPT = `You are a mechanical engineering assistant that parses bearing queries into structured JSON.

Extract these fields from the user's query:
- part_number: specific part number if mentioned (e.g. "6204-2RS", "6204", "204PP")
- manufacturer: brand name if mentioned (SKF, NSK, FAG/Schaeffler, Timken, NTN, Koyo/JTEKT, INA, RBC)
- bore_mm: inner bore diameter in mm (convert inches: 1" = 25.4mm)
- od_mm: outer diameter in mm
- width_mm: bearing width in mm
- bearing_type: one of: deep_groove, angular, tapered, spherical, thrust, needle
- seal_type: one of: open, zz (metal shield), 2rs (rubber seal), 2rz (contact-free rubber)
- speed_rpm: max operating speed in RPM
- load_kn: required load rating in kN
- environment: dusty, wet, high_temp, food_grade, vacuum, chemical

intent must be one of:
- "crossref": user wants equivalent parts from other brands
- "spec_search": user describes requirements without a specific part number
- "part_lookup": user has exact part number and wants info/price
- "availability": user wants to know stock/pricing for a specific part
- "chat": greeting/smalltalk/help/capabilities request without a concrete bearing lookup

Rules:
- If user gives a part number AND asks for equivalents → crossref
- If user gives a part number without asking for alternatives → part_lookup
- If user describes an application without a part number → spec_search
- Always return valid JSON, never null`

const INTENTS = new Set<ParsedBearingQuery['intent']>([
  'crossref',
  'spec_search',
  'part_lookup',
  'availability',
  'chat',
])

export async function parseQuery(query: string): Promise<ParsedBearingQuery> {
  const trimmed = query.trim()

  if (isConversationalQuery(trimmed)) {
    return {
      raw_query: trimmed,
      intent: 'chat',
      confidence: 0.96,
    }
  }

  const crossrefHeuristic = parseHeuristicCrossRef(trimmed)
  if (crossrefHeuristic) return crossrefHeuristic

  // Fast path: if it looks like a bare part number, skip AI entirely
  const partNumberRegex = /^[0-9]{4,6}([- ]?(2RS|ZZ|2Z|DDU|LLU|2RSR|PP|KDD))?$/i
  const withMfr = /^(SKF|NSK|FAG|NTN|TIMKEN|KOYO|INA|RBC)\s+\S+$/i

  if (partNumberRegex.test(trimmed) || withMfr.test(trimmed)) {
    return parseBarePartNumber(trimmed)
  }

  // Deterministic spec-search guardrail for obvious application/spec language
  if (looksLikeSpecSearch(trimmed) && !containsLikelyPartNumber(trimmed)) {
    return parseHeuristicSpecSearch(trimmed)
  }

  try {
    if (AI_PROVIDER === 'pi') {
      return await parseQueryWithPi(trimmed)
    }

    return await parseQueryWithGemini(trimmed)
  } catch (err) {
    console.error(`AI parse error (${AI_PROVIDER}):`, err)

    // Fallback provider hop if configured provider fails
    try {
      if (AI_PROVIDER === 'pi') {
        return await parseQueryWithGemini(trimmed)
      }
      return await parseQueryWithPi(trimmed)
    } catch (fallbackErr) {
      console.error('AI parse fallback error:', fallbackErr)
      return buildSafeFallbackQuery(trimmed)
    }
  }
}

async function parseQueryWithGemini(query: string): Promise<ParsedBearingQuery> {
  if (!genAI) throw new Error('GOOGLE_GEMINI_API_KEY is not configured')

  const result = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: `Parse this bearing query into JSON: "${query}"\n\nRespond with only valid JSON, no markdown, no explanation.`,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 1200,
      temperature: 0.1,
    },
  })

  const parts = result.candidates?.[0]?.content?.parts ?? []
  const raw = parts
    .filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? '')
    .join('')

  const parsed = parseJsonObject(raw)
  return normalizeParsedQuery(parsed, query, 0.9)
}

async function parseQueryWithPi(query: string): Promise<ParsedBearingQuery> {
  const prompt = `Convert this bearing search query into a JSON object.

Allowed intent values: crossref, spec_search, part_lookup, availability, chat.
Allowed keys: intent, part_number, manufacturer, bore_mm, od_mm, width_mm, bearing_type, seal_type, speed_rpm, load_kn, environment, confidence.
Rules:
- part number + equivalent/alternative language => crossref
- part number only => part_lookup
- no part number => spec_search
- dusty/wet environment should usually imply seal_type=2rs

Return JSON only (no markdown, no prose). Use null for unknown values.

Query: "${query}"`

  const raw = await runPi(prompt, { model: PI_PARSE_MODEL, systemPrompt: SYSTEM_PROMPT })
  const parsed = parseJsonObject(raw)
  return normalizeParsedQuery(parsed, query, 0.9)
}

function looksLikeSpecSearch(query: string): boolean {
  return /(\bmm\b|\bbore\b|\bshaft\b|\bod\b|outer diameter|\bwidth\b|\brpm\b|\bload\b|\bkn\b|\bkN\b|\bsealed\b|\bseal\b|\bdusty\b|\bwet\b|\bconveyor\b|application)/i.test(query)
}

function containsLikelyPartNumber(query: string): boolean {
  const q = query.trim()

  // Manufacturer-prefixed mentions are usually part lookups/crossrefs.
  if (/\b(SKF|NSK|FAG|NTN|TIMKEN|KOYO|INA|RBC)\s+[A-Z0-9-]+\b/i.test(q)) return true

  // Alphanumeric designations are likely part numbers.
  if (/\b[A-Z]+\d{2,}[A-Z0-9-]*\b/i.test(q)) return true
  if (/\b\d{3,8}[-/][A-Z0-9]{1,8}\b/i.test(q)) return true

  // Pure numeric tokens are too ambiguous in natural-language specs (rpm/mm/load).
  // Treat them as part numbers only when the whole query is basically that token.
  const pure = q.match(/^\d{4,6}$/)
  if (pure) return true

  return false
}

function parseHeuristicSpecSearch(query: string): ParsedBearingQuery {
  const q = query.toLowerCase()

  const boreFromBore = q.match(/(?:bore|shaft)\s*(?:diameter)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*mm/i)
  const boreFromLeadMm = q.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:bore|shaft)/i)
  const rpm = q.match(/(\d{3,6})\s*rpm/i)
  const load = q.match(/(\d+(?:\.\d+)?)\s*k\s*n\b|(\d+(?:\.\d+)?)\s*kn\b/i)

  const bore = Number(boreFromBore?.[1] ?? boreFromLeadMm?.[1] ?? NaN)
  const speed = Number(rpm?.[1] ?? NaN)
  const loadKn = Number(load?.[1] ?? load?.[2] ?? NaN)

  const environment = /food|washdown|hygien/i.test(q)
    ? 'food_grade'
    : /high\s*temp|\btemp\b|\bhot\b|\b180c\b|\b200c\b/i.test(q)
      ? 'high_temp'
      : /dust|dirty|contamin/i.test(q)
        ? 'dusty'
        : /wet|water|moisture|wash/i.test(q)
          ? 'wet'
          : /chem|solvent|caustic/i.test(q)
            ? 'chemical'
            : undefined

  const sealType = /(2rs|sealed|dust|washdown|wet|water)/i.test(query)
    ? '2rs'
    : /(2z|zz|shield)/i.test(query)
      ? 'zz'
      : undefined

  return {
    raw_query: query,
    intent: 'spec_search',
    confidence: 0.85,
    manufacturer: detectManufacturer(query),
    bore_mm: Number.isFinite(bore) ? bore : undefined,
    speed_rpm: Number.isFinite(speed) ? speed : undefined,
    load_kn: Number.isFinite(loadKn) ? loadKn : undefined,
    bearing_type: detectBearingType(query),
    environment,
    seal_type: sealType,
  }
}

function isConversationalQuery(query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false

  if (containsLikelyPartNumber(q) || looksLikeSpecSearch(q)) return false

  const conversationalPatterns = [
    /^(hi|hello|hey|yo|sup|good\s*(morning|afternoon|evening))\b/,
    /\b(thanks|thank you|appreciate it)\b/,
    /\b(how are you|who are you|what can you do|help|capabilities|what do you do)\b/,
    /\b(can you help me|i need help)\b/,
  ]

  if (conversationalPatterns.some((re) => re.test(q))) return true

  const tokenCount = q.split(/\s+/).filter(Boolean).length
  if (tokenCount <= 3 && /^(ok|okay|cool|nice|great|hmm|huh)$/.test(q)) return true

  return false
}

function parseHeuristicCrossRef(query: string): ParsedBearingQuery | null {
  if (!/equivalent|alternative|replace|replacement|substitute|cross\s*reference|cross\s*ref|xref|same as|instead of/i.test(query)) {
    return null
  }

  const partNumber = extractPartNumberCandidate(query)
  if (!partNumber) return null

  return {
    raw_query: query,
    intent: 'crossref',
    part_number: partNumber.toUpperCase(),
    manufacturer: detectManufacturer(query),
    confidence: 0.92,
  }
}

function buildSafeFallbackQuery(query: string): ParsedBearingQuery {
  const partNumber = extractPartNumberCandidate(query)
  const manufacturer = detectManufacturer(query)
  const asksCrossRef = /equivalent|alternative|replace|replacement|substitute|cross\s*reference|cross\s*ref|xref|same as|instead of/i.test(query)

  if (partNumber && asksCrossRef) {
    return {
      raw_query: query,
      intent: 'crossref',
      part_number: partNumber.toUpperCase(),
      manufacturer,
      confidence: 0.45,
    }
  }

  if (partNumber) {
    return {
      raw_query: query,
      intent: 'part_lookup',
      part_number: partNumber.toUpperCase(),
      manufacturer,
      confidence: 0.45,
    }
  }

  return {
    raw_query: query,
    intent: 'spec_search',
    manufacturer,
    bearing_type: detectBearingType(query),
    confidence: 0.35,
  }
}

function detectManufacturer(query: string): string | undefined {
  const match = query.match(/\b(SKF|NSK|FAG|NTN|TIMKEN|KOYO|INA|RBC)\b/i)
  return match?.[1]?.toUpperCase()
}

function detectBearingType(query: string): string | undefined {
  const q = query.toLowerCase()
  if (q.includes('tapered')) return 'tapered'
  if (q.includes('angular')) return 'angular'
  if (q.includes('spherical')) return 'spherical'
  if (q.includes('needle')) return 'needle'
  if (q.includes('thrust')) return 'thrust'
  if (q.includes('cylindrical')) return 'cylindrical'
  if (q.includes('deep groove') || q.includes('ball bearing')) return 'deep_groove'
  return undefined
}

/**
 * Quickly parse obvious part number patterns without calling the AI
 */
function parseBarePartNumber(query: string): ParsedBearingQuery {
  const mfrMatch = query.match(/^(SKF|NSK|FAG|NTN|TIMKEN|KOYO|INA|RBC)\s+(.+)$/i)
  const crossRefTriggers = /equivalent|alternative|replace|substitute|cross.?ref|same as|instead of/i

  const isXref = crossRefTriggers.test(query)

  if (mfrMatch) {
    const remainder = mfrMatch[2].trim()
    const extractedPart = extractPartNumberCandidate(remainder) ?? remainder

    return {
      raw_query: query,
      manufacturer: mfrMatch[1].toUpperCase(),
      part_number: extractedPart.toUpperCase(),
      intent: isXref ? 'crossref' : 'part_lookup',
      confidence: 1.0,
    }
  }

  const stripped = query.replace(/^(SKF|NSK|FAG|NTN|TIMKEN|KOYO|INA|RBC)\s*/i, '').trim()

  return {
    raw_query: query,
    part_number: (extractPartNumberCandidate(stripped) ?? stripped).toUpperCase(),
    intent: isXref ? 'crossref' : 'part_lookup',
    confidence: 1.0,
  }
}

function extractPartNumberCandidate(text: string): string | undefined {
  const tokens = text
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9-]+$/g, ''))
    .filter(Boolean)

  const lower = text.toLowerCase()
  const hasMeasurementLanguage = /\b(mm|rpm|kn|k\s*n|shaft|bore|od|width|load|temp|°c| c\b)\b/i.test(lower)
  const banned = new Set(['MM', 'RPM', 'KN', 'N', 'C', 'DEG', 'DEGC'])

  const candidate = tokens.find((token) => {
    const t = token.toUpperCase()
    if (banned.has(t)) return false
    if (/^\d{1,3}$/.test(t)) return false
    if (/^\d+(MM|RPM|KN|C)$/.test(t)) return false
    if (!/\d/.test(t)) return false
    if (!/^[A-Z0-9][A-Z0-9-]{2,24}$/.test(t)) return false
    if (/^(?:19|20)\d{2}$/.test(t)) return false
    if (/^\d{4,6}$/.test(t) && hasMeasurementLanguage) return false
    return true
  })

  return candidate
}

/**
 * Generate a human-readable explanation of why a part was recommended
 */
export async function explainRecommendation(params: {
  query: string
  partNumber: string
  manufacturer: string
  specs: Record<string, unknown>
}): Promise<string> {
  const prompt = `User searched: "${params.query}"
We recommended: ${params.manufacturer} ${params.partNumber}
Specs: ${JSON.stringify(params.specs)}

Write ONE sentence (max 20 words) explaining why this bearing matches the query. No fluff.`

  try {
    if (AI_PROVIDER === 'pi') {
      return (await runPi(prompt)).trim() || 'Matches your dimensional and environmental requirements.'
    }

    if (!genAI) throw new Error('GOOGLE_GEMINI_API_KEY is not configured')

    const result = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        maxOutputTokens: 80,
        temperature: 0.2,
      },
    })

    return result.text?.trim() || 'Matches your dimensional and environmental requirements.'
  } catch {
    return 'Matches your dimensional and environmental requirements.'
  }
}

export interface PiTextOptions {
  model?: string
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  timeoutMs?: number
  cwd?: string
  systemPrompt?: string
  appendSystemPrompt?: string
  inputFiles?: string[]
}

export async function runPiText(prompt: string, options: PiTextOptions = {}): Promise<string> {
  return runPi(prompt, options)
}

async function runPi(prompt: string, options: PiTextOptions = {}): Promise<string> {
  const model = options.model ?? PI_MODEL
  const thinking = options.thinking ?? PI_THINKING
  const timeoutMs = options.timeoutMs ?? PI_TIMEOUT_MS
  const cwd = options.cwd ?? PI_CWD

  const args = [
    '-p',
    '--mode',
    'text',
    '--no-session',
    '--no-tools',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--model',
    model,
    '--thinking',
    thinking,
  ]

  if (options.systemPrompt?.trim()) {
    args.push('--system-prompt', options.systemPrompt.trim())
  }

  if (options.appendSystemPrompt?.trim()) {
    args.push('--append-system-prompt', options.appendSystemPrompt.trim())
  }

  const inputFiles = (options.inputFiles ?? []).map((value) => String(value).trim()).filter(Boolean)
  args.push(...inputFiles.map((filePath) => `@${filePath}`))
  args.push(prompt)

  const env = buildPiEnv()

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(PI_BIN, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const maxChars = 1024 * 1024

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
      if (stdout.length > maxChars) {
        child.kill('SIGTERM')
      }
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
      if (stderr.length > maxChars) {
        child.kill('SIGTERM')
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    child.on('close', (code, signal) => {
      clearTimeout(timeout)

      const text = stdout.trim()
      if (code === 0 && text) {
        resolve(text)
        return
      }

      reject(
        new Error(
          `pi command failed (code=${code}, signal=${signal ?? 'none'}): ${stderr || stdout || 'no output'}`
        )
      )
    })
  })
}

function buildPiEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  // pi expects GEMINI_API_KEY while this app historically used GOOGLE_GEMINI_API_KEY
  if (!env.GEMINI_API_KEY && env.GOOGLE_GEMINI_API_KEY) {
    env.GEMINI_API_KEY = env.GOOGLE_GEMINI_API_KEY
  }

  return env
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
    // Fall through to substring extraction
  }

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const inner = cleaned.slice(start, end + 1)
    const parsed = JSON.parse(inner)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  }

  throw new Error(`Unable to parse JSON object from model output: ${raw.slice(0, 400)}`)
}

function normalizeParsedQuery(
  parsed: Record<string, unknown>,
  query: string,
  defaultConfidence: number
): ParsedBearingQuery {
  const intent = normalizeIntent(parsed.intent, parsed.part_number)
  const environment = normalizeString(parsed.environment)?.toLowerCase()
  let sealType = normalizeString(parsed.seal_type)?.toLowerCase()
  const speedRpm = normalizeNumber(parsed.speed_rpm)

  // Deterministic post-processing to keep behavior stable across model providers
  if (!sealType && (environment === 'dusty' || environment === 'wet')) {
    sealType = '2rs'
  }
  if (!sealType && typeof speedRpm === 'number' && speedRpm > 15000) {
    sealType = 'zz'
  }

  return {
    raw_query: query,
    confidence: normalizeNumber(parsed.confidence, defaultConfidence) ?? defaultConfidence,
    intent,
    part_number: normalizeString(parsed.part_number)?.toUpperCase(),
    manufacturer: normalizeString(parsed.manufacturer)?.toUpperCase(),
    bore_mm: normalizeNumber(parsed.bore_mm),
    od_mm: normalizeNumber(parsed.od_mm),
    width_mm: normalizeNumber(parsed.width_mm),
    bearing_type: normalizeString(parsed.bearing_type),
    seal_type: sealType,
    speed_rpm: speedRpm,
    load_kn: normalizeNumber(parsed.load_kn),
    environment,
  }
}

function normalizeIntent(value: unknown, partNumber: unknown): ParsedBearingQuery['intent'] {
  if (typeof value === 'string' && INTENTS.has(value as ParsedBearingQuery['intent'])) {
    return value as ParsedBearingQuery['intent']
  }

  return normalizeString(partNumber) ? 'part_lookup' : 'spec_search'
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function normalizeNumber(value: unknown, fallback?: number): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}
