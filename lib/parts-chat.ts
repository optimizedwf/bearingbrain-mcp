import { parseQuery, runPiText } from './ai'
import { searchPartsByQuery, summarizeSearchForLLM } from './search-tools'
import { maybeHandleCartAgentAction } from './cart-agent'
import { findActiveCartSummary, type CartSummary } from './cart'
import { listRecentSourcingRequests, type SourcingRequestRecord } from './sourcing-requests'
import { selectBearings, type SelectionRequest } from './bearing-selector'
import type { ChatAttachment } from './chat-attachments'

const PARTS_CHAT_MODEL = process.env.PARTS_CHAT_MODEL ?? process.env.PI_AGENT_MODEL ?? 'google/gemini-3.1-pro-preview'
const PARTS_HELPER_MODEL = process.env.PARTS_HELPER_MODEL ?? PARTS_CHAT_MODEL
const PARTS_PLANNER_MODEL = process.env.PARTS_PLANNER_MODEL ?? PARTS_HELPER_MODEL
const PARTS_REWRITE_MODEL = process.env.PARTS_REWRITE_MODEL ?? PARTS_HELPER_MODEL
const PARTS_PARAMS_MODEL = process.env.PARTS_PARAMS_MODEL ?? PARTS_HELPER_MODEL
const PARTS_CHAT_TIMEOUT_MS = Number(process.env.PARTS_CHAT_TIMEOUT_MS ?? 22000)
const PARTS_CHAT_THINKING = normalizeThinking(process.env.PARTS_CHAT_THINKING ?? 'high')
const PARTS_EXTRACT_THINKING = normalizeThinking(process.env.PARTS_EXTRACT_THINKING ?? 'minimal')
const PARTS_REWRITE_THINKING = normalizeThinking(process.env.PARTS_REWRITE_THINKING ?? 'minimal')
const PARTS_AGENT_PLANNER_THINKING = normalizeThinking(process.env.PARTS_AGENT_PLANNER_THINKING ?? 'high')

const PARTS_AGENT_SYSTEM_PROMPT = `You are BearingBrain, a purpose-built PI assistant for bearings, rotating equipment, and bearing shopping.

Mission:
- Feel like ChatGPT for bearings: conversational, helpful, fast, and grounded.
- Help users buy, compare, cross-reference, and choose bearings without sounding like a rigid report generator.
- Keep engineering rigor underneath, but surface it in plain language.

Identity and posture:
- Act like a strong bearings teammate for buyers, mechanics, and engineers.
- Be conversational first. Sound natural, not templated.
- Match the user's style: short and direct for quick shopping questions, more structured only when the problem is genuinely engineering-heavy.

Grounding rules:
- Provided catalog search and deterministic engineering context is the source of truth.
- Never invent stock, exact live pricing, dimensions, ratings, or suitability.
- If deterministic engineering results are provided, trust them and explain them clearly.
- If deterministic selection finds zero suitable candidates, say that plainly and do not pretend there is a validated match.

Default response behavior:
- Lead with the direct answer in one or two natural sentences.
- For shopping/lookup questions, make it feel like buying help: recommend the best fit, then mention 1-3 alternatives only if they matter.
- Use bullets only when they improve scannability. Do not force headings every turn.
- Avoid repetitive labels like Recommendation / Assumptions / Verification unless the problem is complex enough to need them.
- Ask at most one follow-up question, and only if it will materially improve the answer.
- When helpful, proactively offer the next narrowing move: cheaper option, premium brand, same-size substitute, faster shipping, or longer-life upgrade.

Shopping behavior:
- If the user sounds like they want to buy something, optimize for decision support: best overall pick, cheaper pick, premium pick, or closest equivalent.
- If price/supplier info exists, weave it in naturally instead of dumping raw search output.
- If deterministic buying recommendations are available, present the answer as: best pick, cheaper acceptable option, premium/OEM option, then one practical next question when useful.
- If quote/BOM comparison facts are available, use them directly instead of hand-waving about price or equivalence.
- If deterministic identification facts are available from photos/files, state the likely part clearly, hedge only when confidence requires it, and offer the next buying or confirmation move.
- If server-side cart/request state is provided, treat it as authoritative when the user asks what is staged, what was already submitted, or what the next buying step should be.
- Mention cart/request state only when it is relevant to the user's question.
- If the user did not specify budget or brand preference, you may briefly frame options as value vs premium vs same-size substitute.

Evidence behavior:
- If photos or files are attached, use them directly.
- Say what you can see or extract from the evidence in plain language.
- If the evidence is partial or unclear, ask for the single best next photo, angle, marking, or document detail.

Engineering behavior:
- For application/selection questions, still make the reasoning solid.
- Use structured sections only when the selection is non-trivial, high-risk, or missing critical constraints.
- If no life target was provided, say the recommendation is provisional with respect to life only when that genuinely matters.
- If no candidate fully passes, explain the closest path forward in plain language.

Tone:
- Calm, direct, practical, and human.
- No fluff. No robotic disclaimers. No canned capability dump unless the user explicitly asks what you can do.

Escalation:
- For hands-on engineering support with complex applications, failure analysis, or custom specs, add:
  "For hands-on engineering support with complex applications, failure analysis, or custom specs, [Bearing Consultants](https://www.bearingconsultants.com) can help."`

const EXTRACT_PARAMS_SYSTEM_PROMPT = `You extract structured bearing application parameters from user text.

Return JSON only with this shape:
{
  "isApplicationQuery": boolean,
  "shaftDiameter_mm": number|null,
  "outerDiameter_mm": number|null,
  "width_mm": number|null,
  "radialLoad_kn": number|null,
  "axialLoad_kn": number|null,
  "rpm": number|null,
  "temperature_c": number|null,
  "lubrication": "grease"|"oil"|null,
  "environment": string|null,
  "bearingTypes": string[]|null,
  "sealType": "open"|"2rs"|"zz"|null,
  "minLifeHours": number|null
}

Rules:
- isApplicationQuery=true only if load/speed/shaft/application-selection intent is present.
- Convert units:
  - N -> kN (÷1000)
  - lbf -> kN (×0.004448)
  - inches -> mm (×25.4)
  - °F -> °C
- If environment implies contamination (dusty/dirty/outdoor), prefer sealType="2rs".
- If no value is known, return null for that field.`

const QUERY_REWRITE_SYSTEM_PROMPT = `You rewrite short follow-up chat messages into standalone bearing/parts queries.

Return JSON only:
{
  "standalone_query": "string",
  "is_follow_up": boolean
}

Rules:
- Use conversation context to resolve pronouns like "that one", "what about NSK", "same size but sealed".
- Preserve exact part numbers and brands.
- If message is already standalone, return it unchanged and is_follow_up=false.
- Keep concise and factual. Never add made-up specs.`

const EVIDENCE_ANALYSIS_SYSTEM_PROMPT = `You analyze attached photos and files for bearing shopping, identification, and application help.

Return JSON only:
{
  "summary": "string",
  "rewrittenQuery": "string",
  "confidence": number
}

Rules:
- Use both the user's message and the attached evidence.
- Pull out any visible part numbers, shield markings, dimensions, bearing family clues, application clues, packaging text, or damage clues.
- If the evidence is uncertain, say so in summary.
- Use lower confidence for blurry, obstructed, partial, or conflicting markings.
- rewrittenQuery should be a standalone, catalog-friendly bearing query when the evidence strongly supports one.
- Never invent exact part numbers or dimensions.`

const AGENT_TOOL_PLANNER_SYSTEM_PROMPT = `You are the planning layer for BearingBrain, a conversational bearings-shopping and engineering assistant.

Return JSON only with this shape:
{
  "tool": "search_catalog" | "recommend_buy_option" | "compare_quote_or_bom" | "identify_from_evidence" | "fitment_sanity_check" | "run_engineering_selection" | "respond",
  "query": "string|null",
  "reason": "string",
  "response": "string|null"
}

Tool meanings:
- search_catalog: exact part lookup, cross-reference, spec search, and supplier/pricing lookup against the catalog
- recommend_buy_option: deterministic buying recommendation over existing catalog candidates
- compare_quote_or_bom: deterministic comparison of quoted/BOM line items against current catalog matches and alternatives
- identify_from_evidence: deterministic evidence-first identification using analyzed attachments plus current catalog matches
- fitment_sanity_check: deterministic equivalence / replacement sanity check between candidate parts or identified parts
- run_engineering_selection: deterministic bearing-selection plus ISO 281 life calculations for an application query
- respond: answer the user directly or ask one concise clarifying question

Rules:
- Use exactly one tool per step.
- Prefer search_catalog first for exact part lookups, cross-references, supplier questions, brand comparisons, or shopping help that needs catalog grounding.
- Prefer recommend_buy_option after search_catalog when the user is clearly asking what to buy, which option is best value, cheapest acceptable, premium/OEM, or brand-only.
- Prefer compare_quote_or_bom when the user asks whether a quote/BOM is okay, compares uploaded pricing, or wants line-item shopping guidance from evidence.
- Prefer identify_from_evidence when the user uploads a photo/file to identify a bearing, read a label, confirm a likely part number, or sanity-check a replacement from evidence.
- Prefer fitment_sanity_check when the user asks whether one part is really equivalent to another, whether a replacement will fit, whether two parts are interchangeable, or whether a candidate substitute preserves fitment.
- Prefer run_engineering_selection as soon as an application query has enough shaft/load/speed context to produce a useful deterministic answer.
- Prefer respond for casual conversation, quick follow-ups, preference questions, or when current observations already support a good answer.
- After deterministic selection results exist, usually respond instead of looping unless an exact catalog lookup is still missing.
- Never invent tool outputs.
- Keep any respond.response natural, practical, and user-facing.
- Ask at most one clarifying question. Do not ask a laundry list.
- Do not force a formal report when a short conversational answer will do.`

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

interface FailureModeFinding {
  part_number: string
  manufacturer: string
  l10_hours: number
  staticSafetyFactor: number
  suitable: boolean
}

interface EvidenceAnalysis {
  summary: string
  rewrittenQuery: string
  confidence: number
}

interface FailureSignal {
  isFailureAnalysis: boolean
  mentionsHeat: boolean
  mentionsNoise: boolean
  mentionsDust: boolean
}

interface FeasibilitySignal {
  looksExtreme: boolean
  reasons: string[]
}

interface BuyRecommendationChoice {
  manufacturer: string
  partNumber: string
  priceUsd: number | null
  supplierName: string | null
  reason: string
}

interface BuyRecommendationResult {
  shoppingIntent: 'value' | 'premium' | 'oem' | 'fastest' | 'general'
  recommended: BuyRecommendationChoice | null
  cheapestAcceptable: BuyRecommendationChoice | null
  premiumOption: BuyRecommendationChoice | null
  alternatives: BuyRecommendationChoice[]
  warnings: string[]
  question?: string
}

interface QuoteOrBomLineItem {
  sourceLine: string
  quotedManufacturer: string | null
  quotedPartNumber: string
  quotedPriceUsd: number | null
  matchedManufacturer: string | null
  matchedPartNumber: string | null
  matchedSupplier: string | null
  matchedPriceUsd: number | null
  cheapestAcceptable: BuyRecommendationChoice | null
  premiumOption: BuyRecommendationChoice | null
  warnings: string[]
}

interface QuoteOrBomComparisonResult {
  items: QuoteOrBomLineItem[]
  warnings: string[]
  question?: string
}

interface EvidenceIdentificationResult {
  reply: string
  observation: string
}

interface FitmentSanityCheckResult {
  reply: string
  observation: string
  verdict: 'exact_match' | 'direct_fit_likely' | 'conditional_fit' | 'not_validated' | 'needs_confirmation'
  warnings: string[]
  leftLabel: string
  rightLabel: string
  leftCatalogLabel: string
  rightCatalogLabel: string
}

interface PartsAssistantResponse {
  reply: string
  parsed: Awaited<ReturnType<typeof searchPartsByQuery>>['parsed']
  total: number
  results: Awaited<ReturnType<typeof searchPartsByQuery>>['results']
  calculation?: {
    input: NonNullable<Awaited<ReturnType<typeof selectBearings>>>['input']
    suitableCount: number
    totalCandidates: number
    topResults: FailureModeFinding[]
  }
}


interface ApplicationIntakeContext {
  isApplicationQuery: boolean
  shaftDiameter_mm?: number
  outerDiameter_mm?: number
  width_mm?: number
  radialLoad_kn?: number
  axialLoad_kn?: number
  rpm?: number
  temperature_c?: number
  lubrication?: 'grease' | 'oil'
  environment?: string
  bearingTypes?: string[]
  sealType?: string
  minLifeHours?: number
}

export async function runPartsAssistant(
  message: string,
  history: ChatTurn[] = [],
  attachments: ChatAttachment[] = [],
  context?: {
    sessionId?: string
    userId?: number | null
    threadId?: string | null
  }
): Promise<PartsAssistantResponse> {
  const recentHistory = sanitizeHistory(history)
  const baseMessage = message.trim() || 'Please inspect the attached evidence and help me identify or select the bearing.'
  const standaloneMessage = await resolveStandaloneUserQuery(baseMessage, recentHistory)
  const evidence = attachments.length ? await analyzeAttachmentEvidence(standaloneMessage, recentHistory, attachments) : null
  const evidenceSummary = attachments.length ? buildAttachmentEvidenceSummary(attachments, evidence) : undefined
  const effectiveMessage = evidence?.rewrittenQuery?.trim() || standaloneMessage
  const parsed = await parseQuery(effectiveMessage)
  const cartAction = await maybeHandleCartAgentAction({
    message: effectiveMessage,
    context,
  })
  if (cartAction) {
    return {
      reply: cartAction.reply,
      parsed: cartAction.parsed ?? parsed,
      total: cartAction.total ?? 0,
      results: cartAction.results ?? [],
    }
  }
  const commerceContext = await loadCommerceContext(context)
  const applicationIntakeContext = await analyzeApplicationIntakeContext(baseMessage, recentHistory, parsed)
  const shouldForceEngineeringSelection = Boolean(
    applicationIntakeContext?.isApplicationQuery
    && applicationIntakeContext.shaftDiameter_mm != null
    && applicationIntakeContext.radialLoad_kn != null
    && applicationIntakeContext.rpm != null
  )
  const forcedEngineeringSelectionQuery = shouldForceEngineeringSelection && applicationIntakeContext
    ? buildEngineeringSelectionQuery(applicationIntakeContext)
    : null
  const failureSignal = detectFailureAnalysisSignal(baseMessage, parsed)
  const feasibilitySignal = detectFeasibilitySignal(baseMessage)
  const lowConfidenceEvidenceReply = evidence ? buildLowConfidenceEvidenceReply({
    message: baseMessage,
    evidence,
    parsed,
    attachments,
  }) : null

  if (lowConfidenceEvidenceReply) {
    return {
      reply: lowConfidenceEvidenceReply,
      parsed,
      total: 0,
      results: [],
    }
  }

  if (failureSignal.isFailureAnalysis) {
    return {
      reply: await respondToFailureAnalysis({
        message: baseMessage,
        history: recentHistory,
        attachments,
        evidenceSummary,
        signal: failureSignal,
      }),
      parsed,
      total: 0,
      results: [],
    }
  }

  if (feasibilitySignal.looksExtreme && !attachments.length) {
    return {
      reply: `That duty sounds unusually aggressive for a 6204-size bearing envelope — ${feasibilitySignal.reasons.join(', ')}. I can help evaluate it, but I can’t honestly name a validated exact part yet without the actual radial load, any axial load, and whether the shock is continuous or intermittent. If you send those, I’ll check whether a 6204-size bearing is even realistic before recommending a part.`,
      parsed,
      total: 0,
      results: [],
    }
  }

  const applicationIntakeReply = applicationIntakeContext?.isApplicationQuery
    ? await maybeHandleApplicationIntake({
        message: baseMessage,
        history: recentHistory,
        parsed,
      })
    : null
  if (applicationIntakeReply) {
    return applicationIntakeReply
  }

  if (shouldForceEngineeringSelection && forcedEngineeringSelectionQuery) {
    const selection = await runEngineeringSelectionTool(forcedEngineeringSelectionQuery)
    if (selection.results) {
      const deterministicReply = buildDeterministicSelectionReply(selection.results) ?? selection.results.summary
      return {
        reply: deterministicReply,
        parsed,
        total: 0,
        results: [],
        calculation: {
          input: selection.results.input,
          suitableCount: selection.results.suitable.length,
          totalCandidates: selection.results.totalCandidates,
          topResults: selection.results.candidates.slice(0, 3).map((result) => ({
            part_number: result.bearing.part_number,
            manufacturer: result.bearing.manufacturer_name,
            l10_hours: result.l10_hours,
            staticSafetyFactor: result.staticSafetyFactor,
            suitable: result.suitable,
          })),
        },
      }
    }
  }

  const isApplicationContinuation = Boolean(applicationIntakeContext?.isApplicationQuery)

  if (parsed.intent === 'chat' && !isApplicationContinuation) {
    return {
      reply: await chatConversationally(baseMessage, recentHistory, attachments, evidenceSummary, commerceContext),
      parsed,
      total: 0,
      results: [],
    }
  }

  if (isLikelyConversationalMessage(message) && attachments.length === 0 && !isApplicationContinuation) {
    return {
      reply: await chatConversationally(baseMessage, recentHistory, [], undefined, commerceContext),
      parsed,
      total: 0,
      results: [],
    }
  }

  let search: Awaited<ReturnType<typeof searchPartsByQuery>> | null = null
  let calcResults: Awaited<ReturnType<typeof selectBearings>> | null = null
  let buyRecommendation: BuyRecommendationResult | null = null
  let quoteComparison: QuoteOrBomComparisonResult | null = null
  let evidenceIdentification: EvidenceIdentificationResult | null = null
  let fitmentCheck: FitmentSanityCheckResult | null = null
  const toolObservations: string[] = evidenceSummary ? [evidenceSummary] : []
  const seenPlans = new Set<string>()
  let reply = ''

  for (let step = 0; step < 3; step++) {
    let plan: PartsAgentPlan

    if (shouldForceEngineeringSelection && !calcResults) {
      plan = {
        tool: 'run_engineering_selection',
        query: forcedEngineeringSelectionQuery ?? effectiveMessage,
        reason: 'forced_application_selection',
      }
    } else {
      try {
        plan = await planNextPartsAgentStep({
          userMessage: baseMessage,
          effectiveMessage,
          history: recentHistory,
          parsed,
          toolObservations,
          hasSearch: Boolean(search),
          hasCalculation: Boolean(calcResults),
          hasRecommendation: Boolean(buyRecommendation),
          hasComparison: Boolean(quoteComparison),
          hasIdentification: Boolean(evidenceIdentification),
          hasFitmentCheck: Boolean(fitmentCheck),
          hasAttachments: attachments.length > 0,
          evidenceSummary,
          commerceContext,
        })
      } catch (err) {
        console.warn('Planner failed, falling back to direct synthesis:', err)
        break
      }
    }

    if (plan.tool === 'respond') {
      if (plan.response?.trim()) {
        reply = plan.response.trim()
      }
      break
    }

    const queryForTool = (plan.query ?? effectiveMessage).trim() || effectiveMessage
    const dedupeKey = `${plan.tool}:${queryForTool}`
    if (seenPlans.has(dedupeKey)) break
    seenPlans.add(dedupeKey)

    if (plan.tool === 'search_catalog') {
      search = await searchPartsByQuery(queryForTool, 8)
      toolObservations.push(formatSearchObservation(queryForTool, search))

      const guidedReply = buildGuidedClarificationReply(baseMessage, search)
      if (guidedReply && !looksLikeRecommendationQuery(baseMessage, search.parsed)) {
        reply = guidedReply
        break
      }

      continue
    }

    if (plan.tool === 'recommend_buy_option') {
      if (!search) {
        search = await searchPartsByQuery(queryForTool, 8)
        toolObservations.push(formatSearchObservation(queryForTool, search))
      }

      buyRecommendation = recommendBuyOptionFromSearch(baseMessage, search)
      if (buyRecommendation) {
        toolObservations.push(formatRecommendationObservation(buyRecommendation))
      }
      continue
    }

    if (plan.tool === 'compare_quote_or_bom') {
      quoteComparison = await runQuoteOrBomComparisonTool(baseMessage, attachments)
      if (quoteComparison) {
        toolObservations.push(formatQuoteComparisonObservation(quoteComparison))
      }
      continue
    }

    if (plan.tool === 'identify_from_evidence') {
      if (!search) {
        search = await searchPartsByQuery(queryForTool, 8)
        toolObservations.push(formatSearchObservation(queryForTool, search))
      }

      evidenceIdentification = runIdentifyFromEvidenceTool({
        message: baseMessage,
        evidence,
        search,
      })
      if (evidenceIdentification) {
        toolObservations.push(evidenceIdentification.observation)
      }
      continue
    }

    if (plan.tool === 'fitment_sanity_check') {
      fitmentCheck = await runFitmentSanityCheckTool(baseMessage, attachments)
      if (fitmentCheck) {
        toolObservations.push(fitmentCheck.observation)
      }
      continue
    }

    if (plan.tool === 'run_engineering_selection') {
      const selection = await runEngineeringSelectionTool(queryForTool)
      toolObservations.push(selection.observation)
      if (selection.results) calcResults = selection.results
      continue
    }
  }

  if (!search) {
    search = await searchPartsByQuery(effectiveMessage, 8)
    toolObservations.push(formatSearchObservation(effectiveMessage, search))
  }

  if (!quoteComparison && !calcResults && looksLikeQuoteOrBomComparisonQuery(baseMessage, attachments)) {
    quoteComparison = await runQuoteOrBomComparisonTool(baseMessage, attachments)
    if (quoteComparison) {
      toolObservations.push(formatQuoteComparisonObservation(quoteComparison))
    }
  }

  if (!evidenceIdentification && !quoteComparison && !calcResults && looksLikeIdentifyFromEvidenceQuery(baseMessage, attachments, evidence)) {
    evidenceIdentification = runIdentifyFromEvidenceTool({
      message: baseMessage,
      evidence,
      search,
    })
    if (evidenceIdentification) {
      toolObservations.push(evidenceIdentification.observation)
    }
  }

  if (!fitmentCheck && !calcResults && looksLikeFitmentSanityCheckQuery(baseMessage, attachments)) {
    fitmentCheck = await runFitmentSanityCheckTool(baseMessage, attachments)
    if (fitmentCheck) {
      toolObservations.push(fitmentCheck.observation)
    }
  }

  if (!buyRecommendation && !calcResults && looksLikeRecommendationQuery(baseMessage, search.parsed)) {
    buyRecommendation = recommendBuyOptionFromSearch(baseMessage, search)
    if (buyRecommendation) {
      toolObservations.push(formatRecommendationObservation(buyRecommendation))
    }
  }

  const calcContext = calcResults?.summary ?? ''

  if (fitmentCheck && looksLikeFitmentSanityCheckQuery(baseMessage, attachments)) {
    reply = fitmentCheck.reply
  }

  if (!reply && calcResults) {
    const deterministicReply = buildDeterministicSelectionReply(calcResults)
    if (deterministicReply) reply = deterministicReply
  }

  if (!reply && quoteComparison) {
    reply = buildQuoteComparisonReply(quoteComparison)
  }

  if (!reply && evidenceIdentification) {
    reply = evidenceIdentification.reply
  }

  if (!reply && fitmentCheck) {
    reply = fitmentCheck.reply
  }

  if (!reply && buyRecommendation) {
    reply = buildBuyRecommendationReply(buyRecommendation)
  }

  if (!reply) {
    const guidedReply = buildGuidedClarificationReply(baseMessage, search)

    if (guidedReply && !looksLikeRecommendationQuery(baseMessage, search.parsed)) {
      reply = guidedReply
    } else {
      try {
        reply = await chatWithPiAgent({
          userMessage: baseMessage,
          effectiveMessage,
          history: recentHistory,
          searchContext: summarizeSearchForLLM(search),
          calcContext,
          toolObservations,
          evidenceSummary,
          commerceContext,
          attachments,
          calculationMeta: calcResults
            ? {
                suitableCount: calcResults.suitable.length,
                totalCandidates: calcResults.totalCandidates,
                topResults: calcResults.candidates.slice(0, 3).map((r) => ({
                  part_number: r.bearing.part_number,
                  manufacturer: r.bearing.manufacturer_name,
                  l10_hours: r.l10_hours,
                  staticSafetyFactor: r.staticSafetyFactor,
                  suitable: r.suitable,
                })),
              }
            : undefined,
        })
      } catch (err) {
        console.error('Parts PI agent error:', err)
        reply = buyRecommendation
          ? buildBuyRecommendationReply(buyRecommendation)
          : buildFallbackReply(baseMessage, search, calcContext)
      }
    }
  }

  return {
    reply,
    parsed: search.parsed,
    total: search.total,
    results: search.results,
    calculation: calcResults
      ? {
          input: calcResults.input,
          suitableCount: calcResults.suitable.length,
          totalCandidates: calcResults.totalCandidates,
          topResults: calcResults.candidates.slice(0, 5).map((r) => ({
            part_number: r.bearing.part_number,
            manufacturer: r.bearing.manufacturer_name,
            l10_hours: r.l10_hours,
            staticSafetyFactor: r.staticSafetyFactor,
            suitable: r.suitable,
          })),
        }
      : undefined,
  }
}

function summarizeAttachmentKinds(attachments: ChatAttachment[]): string {
  return attachments.map((a) => `${a.name} (${a.kind}${a.mimeType ? `, ${a.mimeType}` : ''})`).join(', ')
}

function modelVisibleAttachmentPaths(attachments: ChatAttachment[]): string[] {
  return attachments.filter((attachment) => attachment.kind === 'image').map((attachment) => attachment.filePath)
}

function detectFailureAnalysisSignal(message: string, parsed: Awaited<ReturnType<typeof parseQuery>>): FailureSignal {
  const text = message.toLowerCase()
  const mentionsNoise = /(noisy|noise|rough|vibration|vibrating|rumbling|growling)/.test(text)
  const mentionsHeat = /(hot|heat|overheat|burnt|burned)/.test(text)
  const mentionsDust = /(dust|dusty|contamination|dirty|debris)/.test(text)
  const failureWords = /(failed|failure|seized|seizing|damaged|damage|worn|wear|spalled|cracked)/.test(text)

  return {
    isFailureAnalysis: failureWords || ((mentionsNoise || mentionsHeat) && /(bearing|conveyor|wheel|motor|shaft)/.test(text)) || /why did/.test(text),
    mentionsHeat,
    mentionsNoise,
    mentionsDust: mentionsDust || parsed.environment === 'dusty',
  }
}

function detectFeasibilitySignal(message: string): FeasibilitySignal {
  const text = message.toLowerCase()
  const reasons: string[] = []

  const hourMatch = text.match(/(\d[\d,]*)\s*(hour|hours|hr|hrs)/)
  const rpmMatch = text.match(/(\d[\d,]*)\s*rpm/)

  const hours = hourMatch ? Number(hourMatch[1].replace(/,/g, '')) : null
  const rpm = rpmMatch ? Number(rpmMatch[1].replace(/,/g, '')) : null

  if (hours && hours >= 30000) reasons.push(`very high life target (${hours.toLocaleString()} h)`)
  if (rpm && rpm >= 7000) reasons.push(`high speed (${rpm.toLocaleString()} rpm)`)
  if (/(heavy shock|shock load|impact load|severe shock)/.test(text)) reasons.push('shock loading')
  if (/exact part should i buy|exact part/.test(text)) reasons.push('user asked for exact part despite sparse duty data')

  return {
    looksExtreme: reasons.length >= 2,
    reasons,
  }
}

async function respondToFailureAnalysis(params: {
  message: string
  history: ChatTurn[]
  attachments: ChatAttachment[]
  evidenceSummary?: string
  signal: FailureSignal
}): Promise<string> {
  const historyBlock = params.history.length
    ? params.history
        .slice(-8)
        .map((turn, i) => `${i + 1}. ${turn.role.toUpperCase()}: ${turn.content}`)
        .join('\n')
    : 'none'

  const prompt = [
    `Latest user message: ${params.message}`,
    '',
    'Recent conversation context:',
    historyBlock,
    '',
    `Failure-analysis signal: ${JSON.stringify(params.signal)}`,
    params.evidenceSummary ? '' : null,
    params.evidenceSummary ? `Attached evidence:\n${params.evidenceSummary}` : null,
    '',
    'Answer like a bearings failure-analysis teammate.',
    'Focus on likely causes, what to inspect next, and what information would most change the diagnosis.',
    'Do not jump straight into recommending random replacement part numbers.',
    'If the duty/application details are sparse, give the top 3 likely causes and then ask 1-2 targeted follow-up questions.',
  ].filter(Boolean).join('\n')

  const text = await runPiText(prompt, {
    model: PARTS_CHAT_MODEL,
    thinking: PARTS_CHAT_THINKING,
    timeoutMs: PARTS_CHAT_TIMEOUT_MS,
    systemPrompt: PARTS_AGENT_SYSTEM_PROMPT,
    inputFiles: modelVisibleAttachmentPaths(params.attachments),
  })

  const trimmed = text.trim()
  if (!trimmed) {
    return 'Most likely causes are contamination, inadequate sealing/lubrication, misalignment, or overload/heat. If you can, tell me the bearing size, speed, load, and what the old bearing looked or sounded like before failure.'
  }
  return trimmed
}

function buildLowConfidenceEvidenceReply(params: {
  message: string
  evidence: EvidenceAnalysis
  parsed: Awaited<ReturnType<typeof parseQuery>>
  attachments: ChatAttachment[]
}): string | null {
  if (!params.attachments.length) return null
  if (params.evidence.confidence >= 0.86) return null
  const hasImage = params.attachments.some((attachment) => attachment.kind === 'image')
  if (!hasImage) return null

  const tentativeId = [params.parsed.manufacturer, params.parsed.part_number].filter(Boolean).join(' ').trim()
  const tentativeLabel = tentativeId || params.parsed.part_number || params.evidence.rewrittenQuery || 'the visible marking'
  const dimHint = params.parsed.bore_mm && params.parsed.od_mm && params.parsed.width_mm
    ? ` If that reading is right, dimensions should be about ${params.parsed.bore_mm} × ${params.parsed.od_mm} × ${params.parsed.width_mm} mm.`
    : ''

  return `From the photo, this might be **${tentativeLabel}**, but I’m not confident enough to call it definitive from this image alone.${dimHint} Can you send a clearer marking photo or the bore / OD / width so I can confirm it before you buy?`
}

function looksLikeRecommendationQuery(
  message: string,
  parsed: Awaited<ReturnType<typeof parseQuery>>
): boolean {
  if (parsed.intent === 'chat') return false
  const q = message.toLowerCase()
  return parsed.intent === 'availability'
    || /what should i buy|which one|best value|best option|best pick|recommend|worth it|cheapest|cheap|budget|premium|oem|brand|\bonly\b|supplier|price|in stock|fastest|ship today|buy today/.test(q)
}

function detectShoppingIntent(message: string): BuyRecommendationResult['shoppingIntent'] {
  const q = message.toLowerCase()
  if (/(fastest|urgent|ship today|buy today|lead time|in stock)/.test(q)) return 'fastest'
  if (/(premium|better brand|top brand)/.test(q)) return 'premium'
  if (/(oem|original|genuine|same brand)/.test(q)) return 'oem'
  if (/(cheap|cheapest|budget|best value|value|worth it|lowest price)/.test(q)) return 'value'
  return 'general'
}

function normalizeManufacturerToken(value?: string | null): string | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (raw.includes('skf')) return 'SKF'
  if (raw.includes('nsk')) return 'NSK'
  if (raw.includes('fag') || raw.includes('schaeffler')) return 'FAG'
  if (raw.includes('timken')) return 'TIMKEN'
  if (raw.includes('ntn')) return 'NTN'
  if (raw.includes('koyo') || raw.includes('jtekt')) return 'KOYO'
  if (raw.includes('ina')) return 'INA'
  if (raw.includes('rbc')) return 'RBC'
  return String(value ?? '').trim().toUpperCase()
}

function extractManufacturerPreference(
  message: string,
  parsed: Awaited<ReturnType<typeof parseQuery>>
): string | null {
  if (parsed.manufacturer) return normalizeManufacturerToken(parsed.manufacturer)
  const match = message.match(/\b(SKF|NSK|FAG|TIMKEN|NTN|KOYO|INA|RBC)\b/i)
  return match ? normalizeManufacturerToken(match[1]) : null
}

function brandRank(value?: string | null): number {
  switch (normalizeManufacturerToken(value)) {
    case 'SKF': return 100
    case 'NSK': return 96
    case 'FAG': return 95
    case 'TIMKEN': return 94
    case 'NTN': return 92
    case 'INA': return 90
    case 'KOYO': return 89
    case 'RBC': return 87
    default: return 75
  }
}

function bestListingForResult(row: Awaited<ReturnType<typeof searchPartsByQuery>>['results'][number]) {
  return row.listings
    .filter((listing) => listing.price_usd != null)
    .sort((a, b) => Number(a.price_usd ?? Infinity) - Number(b.price_usd ?? Infinity))[0] ?? row.listings[0] ?? null
}

function hardFitMatch(
  row: Awaited<ReturnType<typeof searchPartsByQuery>>['results'][number],
  parsed: Awaited<ReturnType<typeof searchPartsByQuery>>['parsed']
): boolean {
  const specs = row.specs
  if (!specs) return true
  if (parsed.bore_mm != null && specs.bore_mm != null && Math.abs(specs.bore_mm - parsed.bore_mm) > 0.6) return false
  if (parsed.od_mm != null && specs.od_mm != null && Math.abs(specs.od_mm - parsed.od_mm) > 0.6) return false
  if (parsed.width_mm != null && specs.width_mm != null && Math.abs(specs.width_mm - parsed.width_mm) > 0.6) return false
  if (parsed.bearing_type && specs.bearing_type && specs.bearing_type !== parsed.bearing_type) return false
  if (parsed.seal_type && specs.seal_type && specs.seal_type.toLowerCase() !== parsed.seal_type.toLowerCase()) return false
  return true
}

function recommendationChoiceFromResult(
  row: Awaited<ReturnType<typeof searchPartsByQuery>>['results'][number],
  reason: string
): BuyRecommendationChoice {
  const best = bestListingForResult(row)
  return {
    manufacturer: row.part.manufacturer_name ?? row.part.manufacturer_slug ?? 'Unknown',
    partNumber: row.part.part_number,
    priceUsd: best?.price_usd != null ? Number(best.price_usd) : null,
    supplierName: best?.supplier_name ?? null,
    reason,
  }
}

function formatRecommendationChoice(choice: BuyRecommendationChoice | null): string {
  if (!choice) return 'none'
  const pricePart = choice.priceUsd != null
    ? ` | price=$${choice.priceUsd.toFixed(2)}${choice.supplierName ? ` via ${choice.supplierName}` : ''}`
    : ' | price unavailable'
  return `${choice.manufacturer} ${choice.partNumber}${pricePart} | ${choice.reason}`
}

function summarizeRecommendationForLLM(result: BuyRecommendationResult): string {
  const lines = [
    `shopping_intent=${result.shoppingIntent}`,
    `recommended=${formatRecommendationChoice(result.recommended)}`,
    `cheapest_acceptable=${formatRecommendationChoice(result.cheapestAcceptable)}`,
    `premium_option=${formatRecommendationChoice(result.premiumOption)}`,
  ]

  if (result.alternatives.length) {
    lines.push(`alternatives=${result.alternatives.map((choice) => formatRecommendationChoice(choice)).join(' || ')}`)
  }
  if (result.warnings.length) {
    lines.push(`warnings=${result.warnings.join(' | ')}`)
  }
  if (result.question) {
    lines.push(`question=${result.question}`)
  }

  return lines.join('\n')
}

function buildBuyRecommendationReply(result: BuyRecommendationResult): string {
  const lines: string[] = []

  if (result.recommended) {
    const price = result.recommended.priceUsd != null
      ? ` at about **$${result.recommended.priceUsd.toFixed(2)}**${result.recommended.supplierName ? ` via ${result.recommended.supplierName}` : ''}`
      : ''
    lines.push(`Best pick: **${result.recommended.manufacturer} ${result.recommended.partNumber}**${price} — ${result.recommended.reason}.`)
  }

  if (
    result.cheapestAcceptable
    && (!result.recommended
      || `${result.cheapestAcceptable.manufacturer} ${result.cheapestAcceptable.partNumber}` !== `${result.recommended.manufacturer} ${result.recommended.partNumber}`)
  ) {
    const price = result.cheapestAcceptable.priceUsd != null
      ? ` at about **$${result.cheapestAcceptable.priceUsd.toFixed(2)}**${result.cheapestAcceptable.supplierName ? ` via ${result.cheapestAcceptable.supplierName}` : ''}`
      : ''
    lines.push(`Cheaper acceptable option: **${result.cheapestAcceptable.manufacturer} ${result.cheapestAcceptable.partNumber}**${price} — ${result.cheapestAcceptable.reason}.`)
  }

  if (
    result.premiumOption
    && (!result.recommended
      || `${result.premiumOption.manufacturer} ${result.premiumOption.partNumber}` !== `${result.recommended.manufacturer} ${result.recommended.partNumber}`)
  ) {
    const price = result.premiumOption.priceUsd != null
      ? ` at about **$${result.premiumOption.priceUsd.toFixed(2)}**${result.premiumOption.supplierName ? ` via ${result.premiumOption.supplierName}` : ''}`
      : ''
    lines.push(`Premium / OEM-safe option: **${result.premiumOption.manufacturer} ${result.premiumOption.partNumber}**${price} — ${result.premiumOption.reason}.`)
  }

  if (result.warnings[0]) {
    lines.push(`Note: ${result.warnings[0]}.`)
  }

  if (result.question) {
    lines.push(result.question)
  }

  return lines.join(' ')
}

function recommendBuyOptionFromSearch(
  message: string,
  search: Awaited<ReturnType<typeof searchPartsByQuery>>
): BuyRecommendationResult | null {
  const acceptable = search.results.filter((row) => hardFitMatch(row, search.parsed))
  const pool = acceptable.length ? acceptable : search.results
  if (!pool.length) return null

  const shoppingIntent = detectShoppingIntent(message)
  const requestedManufacturer = extractManufacturerPreference(message, search.parsed)
  const manufacturerOnly = /\bonly\b/i.test(message)

  const manufacturerPool = requestedManufacturer
    ? pool.filter((row) => normalizeManufacturerToken(row.part.manufacturer_name ?? row.part.manufacturer_slug) === requestedManufacturer)
    : []
  const activePool = manufacturerPool.length ? manufacturerPool : pool

  const exactPool = search.parsed.part_number
    ? activePool.filter((row) => row.part.part_number.toLowerCase() === String(search.parsed.part_number).toLowerCase())
    : []

  const cheapestRow = [...activePool].sort((a, b) => {
    const aPrice = Number(bestListingForResult(a)?.price_usd ?? Number.POSITIVE_INFINITY)
    const bPrice = Number(bestListingForResult(b)?.price_usd ?? Number.POSITIVE_INFINITY)
    return aPrice - bPrice
  })[0] ?? null

  const premiumRow = [...activePool].sort((a, b) => {
    const aMfr = a.part.manufacturer_name ?? a.part.manufacturer_slug
    const bMfr = b.part.manufacturer_name ?? b.part.manufacturer_slug
    if (brandRank(bMfr) !== brandRank(aMfr)) return brandRank(bMfr) - brandRank(aMfr)
    return (b.confidence ?? 0) - (a.confidence ?? 0)
  })[0] ?? null

  const fastestRow = [...activePool].sort((a, b) => {
    const aBest = bestListingForResult(a)
    const bBest = bestListingForResult(b)
    const aStock = aBest?.in_stock ? 0 : 1
    const bStock = bBest?.in_stock ? 0 : 1
    if (aStock !== bStock) return aStock - bStock
    const aLead = Number(aBest?.lead_time_days ?? 999)
    const bLead = Number(bBest?.lead_time_days ?? 999)
    if (aLead !== bLead) return aLead - bLead
    const aPrice = Number(aBest?.price_usd ?? Number.POSITIVE_INFINITY)
    const bPrice = Number(bBest?.price_usd ?? Number.POSITIVE_INFINITY)
    return aPrice - bPrice
  })[0] ?? null

  let recommendedRow = exactPool[0] ?? null
  if (shoppingIntent === 'value') recommendedRow = cheapestRow ?? recommendedRow
  else if (shoppingIntent === 'premium' || shoppingIntent === 'oem') recommendedRow = premiumRow ?? recommendedRow
  else if (shoppingIntent === 'fastest') recommendedRow = fastestRow ?? recommendedRow
  else if (!recommendedRow) recommendedRow = manufacturerPool[0] ?? pool[0] ?? cheapestRow

  const recommended = recommendedRow
    ? recommendationChoiceFromResult(
        recommendedRow,
        shoppingIntent === 'value'
          ? 'best value direct-fit option in the current result set'
          : shoppingIntent === 'premium' || shoppingIntent === 'oem'
            ? 'best brand-continuity / OEM-safe option in the current result set'
            : shoppingIntent === 'fastest'
              ? 'best available speed-to-buy option in the current result set'
              : search.parsed.part_number && recommendedRow.part.part_number.toLowerCase() === String(search.parsed.part_number).toLowerCase()
                ? 'best direct exact-match option in the current result set'
                : 'best overall direct-fit option in the current result set'
      )
    : null

  const cheapestAcceptable = cheapestRow
    ? recommendationChoiceFromResult(cheapestRow, 'lowest-price acceptable direct-fit option')
    : null
  const premiumOption = premiumRow
    ? recommendationChoiceFromResult(premiumRow, requestedManufacturer ? `best ${requestedManufacturer}-brand option` : 'best premium / OEM-safe option')
    : null

  const alternatives: BuyRecommendationChoice[] = []
  for (const row of activePool) {
    const choice = recommendationChoiceFromResult(row, 'alternative direct-fit option')
    const key = `${choice.manufacturer} ${choice.partNumber}`
    if (recommended && key === `${recommended.manufacturer} ${recommended.partNumber}`) continue
    if (cheapestAcceptable && key === `${cheapestAcceptable.manufacturer} ${cheapestAcceptable.partNumber}`) continue
    if (premiumOption && key === `${premiumOption.manufacturer} ${premiumOption.partNumber}`) continue
    if (!alternatives.some((existing) => `${existing.manufacturer} ${existing.partNumber}` === key)) alternatives.push(choice)
    if (alternatives.length >= 2) break
  }

  const warnings: string[] = []
  if (manufacturerOnly && requestedManufacturer && manufacturerPool.length === 0) {
    warnings.push(`no ${requestedManufacturer}-only match was found in the current result set`)
  }
  if (search.parsed.part_number && recommended && recommended.partNumber.toLowerCase() !== String(search.parsed.part_number).toLowerCase()) {
    warnings.push('recommendation assumes direct-fit equivalence rather than exact part-number continuity')
  }
  if (requestedManufacturer && recommended && normalizeManufacturerToken(recommended.manufacturer) !== requestedManufacturer) {
    warnings.push(`recommendation falls outside the requested ${requestedManufacturer} preference because no in-brand option was found here`)
  }
  if (recommended && recommended.priceUsd == null) {
    warnings.push('current recommendation has no price in the current supplier set')
  }

  let question: string | undefined
  if (requestedManufacturer && !manufacturerOnly) {
    question = `Do you want me to keep it ${requestedManufacturer}-preferred, or is any direct-fit equivalent acceptable?`
  } else if (cheapestAcceptable && premiumOption && `${cheapestAcceptable.manufacturer} ${cheapestAcceptable.partNumber}` !== `${premiumOption.manufacturer} ${premiumOption.partNumber}`) {
    question = 'Do you want the lowest-price option, or do you want the stronger OEM / premium-brand pick?'
  }

  return {
    shoppingIntent,
    recommended,
    cheapestAcceptable,
    premiumOption,
    alternatives,
    warnings,
    question,
  }
}

function formatRecommendationObservation(result: BuyRecommendationResult): string {
  return ['RECOMMEND_BUY_OPTION', summarizeRecommendationForLLM(result)].join('\n')
}
function looksLikeQuoteOrBomComparisonQuery(message: string, attachments: ChatAttachment[] = []): boolean {
  const q = message.toLowerCase()
  if (/(quote|bom|bill of materials|priced right|price check|compare this quote|compare this bom|is this quote|is this bom)/.test(q)) {
    return true
  }

  const extracted = attachments.map((attachment) => attachment.extractedText ?? '').join('\n')
  return /\$\s*\d+(?:\.\d{2})?/.test(extracted) && /\b(?:SKF|NSK|FAG|TIMKEN|NTN|KOYO|INA|RBC)?\s*[A-Z0-9]*\d[A-Z0-9-]{2,}\b/i.test(extracted)
}

function extractQuoteOrBomSourceText(message: string, attachments: ChatAttachment[]): string {
  const extracted = attachments
    .map((attachment) => attachment.extractedText?.trim())
    .filter((value): value is string => Boolean(value))

  return [message.trim(), ...extracted].filter(Boolean).join('\n')
}

function normalizeLoosePartNumber(value: string): string {
  return value.replace(/[^A-Z0-9]/gi, '').toUpperCase()
}

function extractQuotedPriceUsd(line: string): number | null {
  const dollar = line.match(/\$\s*([0-9]+(?:\.[0-9]{2})?)/)
  if (dollar) return Number(dollar[1])
  const usd = line.match(/\bUSD\s*([0-9]+(?:\.[0-9]{2})?)/i)
  if (usd) return Number(usd[1])
  return null
}

function extractQuoteOrBomLineItems(sourceText: string): Array<{
  sourceLine: string
  manufacturer: string | null
  partNumber: string
  priceUsd: number | null
}> {
  const lines = sourceText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 4)

  const seen = new Set<string>()
  const items: Array<{
    sourceLine: string
    manufacturer: string | null
    partNumber: string
    priceUsd: number | null
  }> = []

  for (const line of lines) {
    const manufacturerMatch = line.match(/\b(SKF|NSK|FAG|TIMKEN|NTN|KOYO|INA|RBC)\b/i)
    const manufacturer = manufacturerMatch ? normalizeManufacturerToken(manufacturerMatch[1]) : null
    const tokenMatch = line.match(/\b[A-Z]*\d[A-Z0-9]*(?:-[A-Z0-9]+)+\b/i)
      ?? line.match(/\b[A-Z]*\d{3,}[A-Z]+\b/i)
      ?? line.match(/\b\d{3,}[A-Z]{2,}\b/i)
      ?? line.match(/\b[A-Z]{1,4}\d{3,}[A-Z0-9]{0,4}\b/i)

    if (!tokenMatch) continue
    const partNumber = tokenMatch[0].toUpperCase()
    const loose = normalizeLoosePartNumber(partNumber)
    if (loose.length < 4) continue
    if (/^(QTY|LINE|ITEM|PRICE|EACH|TOTAL|BEARING)$/i.test(partNumber)) continue

    const dedupeKey = `${manufacturer ?? 'ANY'}:${loose}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    items.push({
      sourceLine: line,
      manufacturer,
      partNumber,
      priceUsd: extractQuotedPriceUsd(line),
    })

    if (items.length >= 6) break
  }

  return items
}

function formatPriceMaybe(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'price unavailable'
  return `$${value.toFixed(2)}`
}

async function runQuoteOrBomComparisonTool(
  message: string,
  attachments: ChatAttachment[]
): Promise<QuoteOrBomComparisonResult | null> {
  const sourceText = extractQuoteOrBomSourceText(message, attachments)
  const lineItems = extractQuoteOrBomLineItems(sourceText)
  if (!lineItems.length) return null

  const items: QuoteOrBomLineItem[] = []

  for (const lineItem of lineItems) {
    const searchQuery = [lineItem.manufacturer, lineItem.partNumber].filter(Boolean).join(' ')
    const search = await searchPartsByQuery(searchQuery, 6)
    const matched = search.results.find((row) => {
      const candidateLoose = normalizeLoosePartNumber(row.part.part_number)
      const inputLoose = normalizeLoosePartNumber(lineItem.partNumber)
      const candidateManufacturer = normalizeManufacturerToken(row.part.manufacturer_name ?? row.part.manufacturer_slug)
      if (candidateLoose === inputLoose) {
        return !lineItem.manufacturer || candidateManufacturer === lineItem.manufacturer
      }
      return false
    }) ?? search.results[0]

    const recommendation = recommendBuyOptionFromSearch(`compare quote for ${searchQuery}`, search)
    const best = matched ? bestListingForResult(matched) : null
    const matchedManufacturer = matched ? (matched.part.manufacturer_name ?? matched.part.manufacturer_slug ?? null) : null
    const matchedPartNumber = matched?.part.part_number ?? null
    const matchedPriceUsd = best?.price_usd != null ? Number(best.price_usd) : null
    const matchedSupplier = best?.supplier_name ?? null
    const warnings: string[] = []

    if (!matched) {
      warnings.push('could not verify this quoted line item in the current catalog')
    }

    if (
      lineItem.manufacturer
      && matchedManufacturer
      && normalizeManufacturerToken(matchedManufacturer) !== lineItem.manufacturer
    ) {
      warnings.push(`closest current catalog match is ${normalizeManufacturerToken(matchedManufacturer)} rather than the quoted ${lineItem.manufacturer}`)
    }

    if (
      matchedPartNumber
      && normalizeLoosePartNumber(matchedPartNumber) !== normalizeLoosePartNumber(lineItem.partNumber)
    ) {
      warnings.push('catalog comparison is using a direct-fit equivalent rather than the exact quoted part number')
    }

    if (lineItem.priceUsd != null && matchedPriceUsd != null) {
      const delta = lineItem.priceUsd - matchedPriceUsd
      if (delta >= 2) warnings.push(`quoted price is about ${formatPriceMaybe(delta)} above the current best catalog baseline`)
      if (delta <= -2) warnings.push(`quoted price is about ${formatPriceMaybe(Math.abs(delta))} below the current best catalog baseline`)
    } else if (lineItem.priceUsd == null) {
      warnings.push('quoted line has no parseable price, so this is a fit/availability comparison only')
    }

    items.push({
      sourceLine: lineItem.sourceLine,
      quotedManufacturer: lineItem.manufacturer,
      quotedPartNumber: lineItem.partNumber,
      quotedPriceUsd: lineItem.priceUsd,
      matchedManufacturer,
      matchedPartNumber,
      matchedSupplier,
      matchedPriceUsd,
      cheapestAcceptable: recommendation?.cheapestAcceptable ?? null,
      premiumOption: recommendation?.premiumOption ?? null,
      warnings,
    })
  }

  if (!items.length) return null

  const warnings: string[] = []
  if (items.some((item) => item.warnings.some((warning) => /equivalent/.test(warning)))) {
    warnings.push('at least one line item is being compared using direct-fit equivalence rather than exact part-number continuity')
  }
  if (items.some((item) => item.quotedPriceUsd == null)) {
    warnings.push('some quoted lines did not include a parseable price')
  }

  const question = items.length === 1
    ? 'Do you want to preserve OEM/brand continuity, or optimize this line strictly for lowest acceptable cost?'
    : 'Do you want me to keep the whole BOM OEM-safe, or trim cost line by line?'

  return { items, warnings, question }
}

function formatQuoteComparisonObservation(result: QuoteOrBomComparisonResult): string {
  const itemLines = result.items.map((item, index) => {
    const quoted = [item.quotedManufacturer, item.quotedPartNumber].filter(Boolean).join(' ')
    const matched = [item.matchedManufacturer, item.matchedPartNumber].filter(Boolean).join(' ')
    return `${index + 1}. quoted=${quoted || item.quotedPartNumber} @ ${formatPriceMaybe(item.quotedPriceUsd)} | matched=${matched || 'unverified'} @ ${formatPriceMaybe(item.matchedPriceUsd)}${item.matchedSupplier ? ` via ${item.matchedSupplier}` : ''} | warnings=${item.warnings.join(' | ') || 'none'}`
  })

  return [
    'COMPARE_QUOTE_OR_BOM',
    ...itemLines,
    result.warnings.length ? `summary_warnings=${result.warnings.join(' | ')}` : 'summary_warnings=none',
    result.question ? `question=${result.question}` : 'question=none',
  ].join('\n')
}

function buildQuoteComparisonReply(result: QuoteOrBomComparisonResult): string {
  const lines = result.items.map((item) => {
    const quoted = [item.quotedManufacturer, item.quotedPartNumber].filter(Boolean).join(' ')
    const matched = [item.matchedManufacturer, item.matchedPartNumber].filter(Boolean).join(' ')
    const base = item.matchedPartNumber
      ? `Quoted **${quoted || item.quotedPartNumber}** at **${formatPriceMaybe(item.quotedPriceUsd)}**. Current catalog baseline is **${matched}** at **${formatPriceMaybe(item.matchedPriceUsd)}**${item.matchedSupplier ? ` via ${item.matchedSupplier}` : ''}.`
      : `I could not verify **${quoted || item.quotedPartNumber}** in the current catalog.`

    const followups: string[] = []
    if (
      item.cheapestAcceptable
      && `${item.cheapestAcceptable.manufacturer} ${item.cheapestAcceptable.partNumber}` !== matched
    ) {
      followups.push(`Cheaper acceptable option: **${item.cheapestAcceptable.manufacturer} ${item.cheapestAcceptable.partNumber}** at **${formatPriceMaybe(item.cheapestAcceptable.priceUsd)}**${item.cheapestAcceptable.supplierName ? ` via ${item.cheapestAcceptable.supplierName}` : ''}`)
    }
    if (
      item.premiumOption
      && `${item.premiumOption.manufacturer} ${item.premiumOption.partNumber}` !== matched
    ) {
      followups.push(`Premium / OEM-safe option: **${item.premiumOption.manufacturer} ${item.premiumOption.partNumber}** at **${formatPriceMaybe(item.premiumOption.priceUsd)}**${item.premiumOption.supplierName ? ` via ${item.premiumOption.supplierName}` : ''}`)
    }
    if (item.warnings[0]) {
      followups.push(`Note: ${item.warnings[0]}`)
    }

    return [base, ...followups].join(' ')
  })

  if (result.question) lines.push(result.question)
  return lines.join('\n\n')
}


interface FitmentPartReference {
  manufacturer: string | null
  partNumber: string
  position: number
}

interface FitmentLookup {
  ref: FitmentPartReference
  matched: Awaited<ReturnType<typeof searchPartsByQuery>>['results'][number] | null
}

function extractFitmentPartReferences(sourceText: string): FitmentPartReference[] {
  const refs: FitmentPartReference[] = []
  const patterns: Array<{ regex: RegExp; manufacturerGroup?: number; tokenGroup: number }> = [
    { regex: /\b(SKF|NSK|FAG|TIMKEN|NTN|KOYO|INA|RBC)\s+([A-Z]{0,4}\d[A-Z0-9]*(?:-[A-Z0-9]+)*)\b/gi, manufacturerGroup: 1, tokenGroup: 2 },
    { regex: /\b([A-Z]{0,4}\d[A-Z0-9]*(?:-[A-Z0-9]+)+)\b/gi, tokenGroup: 1 },
    { regex: /\b([A-Z]{1,4}\d{3,}[A-Z]{1,6})\b/gi, tokenGroup: 1 },
    { regex: /\b(6[0-9]{3})\b/gi, tokenGroup: 1 },
  ]

  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern.regex)) {
      const partNumber = String(match[pattern.tokenGroup] ?? '').toUpperCase()
      const start = match.index ?? 0
      const end = start + partNumber.length
      const prevChar = start > 0 ? sourceText[start - 1] : ''
      const nextChar = end < sourceText.length ? sourceText[end] : ''
      const loose = normalizeLoosePartNumber(partNumber)
      if (loose.length < 4) continue
      if (/^(QTY|LINE|ITEM|PRICE|EACH|TOTAL|RPM|LOAD|OD|ID|BOM|QUOTE)$/i.test(partNumber)) continue
      if (/^[0-9]+MM$/i.test(partNumber)) continue
      if (/^[0-9]+$/.test(partNumber) && /[-A-Z0-9]/i.test(prevChar + nextChar)) continue

      const manufacturer = pattern.manufacturerGroup ? normalizeManufacturerToken(String(match[pattern.manufacturerGroup] ?? '')) : null
      const existingIndex = refs.findIndex((ref) => normalizeLoosePartNumber(ref.partNumber) === loose && ref.manufacturer === manufacturer)
      if (existingIndex !== -1) continue

      const genericIndex = refs.findIndex((ref) => normalizeLoosePartNumber(ref.partNumber) === loose && !ref.manufacturer)
      if (manufacturer && genericIndex !== -1) {
        refs[genericIndex] = {
          manufacturer,
          partNumber,
          position: match.index ?? 0,
        }
        continue
      }

      if (!manufacturer && refs.some((ref) => normalizeLoosePartNumber(ref.partNumber) === loose && Boolean(ref.manufacturer))) {
        continue
      }

      refs.push({
        manufacturer,
        partNumber,
        position: match.index ?? 0,
      })
    }
  }

  return refs
    .sort((a, b) => a.position - b.position)
    .slice(0, 3)
}

function looksLikeFitmentSanityCheckQuery(message: string, attachments: ChatAttachment[] = []): boolean {
  const q = message.toLowerCase()
  if (!/(same as|same size|equivalent|replacement for|replace with|fit instead of|fit in place of|substitute for|swap in|interchangeable|will .* fit|really equivalent|direct replacement|cross[- ]?reference this against)/.test(q)) {
    return false
  }

  const attachmentText = attachments
    .map((attachment) => attachment.extractedText?.trim())
    .filter((value): value is string => Boolean(value))
    .join('\n')
  const refs = extractFitmentPartReferences([message.trim(), attachmentText].filter(Boolean).join('\n'))
  return refs.length >= 2
}

async function lookupFitmentReference(ref: FitmentPartReference): Promise<FitmentLookup> {
  const searchQuery = [ref.manufacturer, ref.partNumber].filter(Boolean).join(' ')
  const search = await searchPartsByQuery(searchQuery, 6)
  const loose = normalizeLoosePartNumber(ref.partNumber)
  const matched = search.results.find((row) => {
    const candidateLoose = normalizeLoosePartNumber(row.part.part_number)
    if (candidateLoose != loose) return false
    if (!ref.manufacturer) return true
    return normalizeManufacturerToken(row.part.manufacturer_name ?? row.part.manufacturer_slug) === ref.manufacturer
  }) ?? search.results[0] ?? null

  return { ref, matched }
}

function fitmentLabel(lookup: FitmentLookup): string {
  return [lookup.ref.manufacturer, lookup.ref.partNumber].filter(Boolean).join(' ') || lookup.ref.partNumber
}

function matchedFitmentLabel(lookup: FitmentLookup): string {
  if (!lookup.matched) return 'unverified'
  return [lookup.matched.part.manufacturer_name ?? lookup.matched.part.manufacturer_slug, lookup.matched.part.part_number].filter(Boolean).join(' ')
}

async function runFitmentSanityCheckTool(
  message: string,
  attachments: ChatAttachment[] = []
): Promise<FitmentSanityCheckResult | null> {
  const sourceText = [
    message.trim(),
    ...attachments
      .map((attachment) => attachment.extractedText?.trim())
      .filter((value): value is string => Boolean(value)),
  ].filter(Boolean).join('\n')
  const refs = extractFitmentPartReferences(sourceText)
  if (refs.length < 2) return null

  const [left, right] = await Promise.all([
    lookupFitmentReference(refs[0]),
    lookupFitmentReference(refs[1]),
  ])

  const warnings: string[] = []
  const leftLabel = fitmentLabel(left)
  const rightLabel = fitmentLabel(right)

  if (!left.matched) warnings.push(`could not verify ${leftLabel} in the current catalog`)
  if (!right.matched) warnings.push(`could not verify ${rightLabel} in the current catalog`)

  let verdict = 'needs_confirmation'
  let reply = ''

  if (!left.matched || !right.matched) {
    reply = `I can't fully sanity-check **${leftLabel}** vs **${rightLabel}** yet because I could not verify both parts cleanly in the current catalog. Send the full markings or one clearer label photo and I'll confirm it before you buy.`
  } else {
    const leftSpecs = left.matched.specs
    const rightSpecs = right.matched.specs
    const leftBrand = normalizeManufacturerToken(left.matched.part.manufacturer_name ?? left.matched.part.manufacturer_slug)
    const rightBrand = normalizeManufacturerToken(right.matched.part.manufacturer_name ?? right.matched.part.manufacturer_slug)
    const leftLoose = normalizeLoosePartNumber(left.matched.part.part_number)
    const rightLoose = normalizeLoosePartNumber(right.matched.part.part_number)

    const dimensionMismatch: string[] = []
    const compareDim = (label: string, a?: number | null, b?: number | null) => {
      if (a == null || b == null) return
      if (Math.abs(a - b) > 0.6) dimensionMismatch.push(`${label} differs (${a} vs ${b} mm)`)
    }
    compareDim('bore', leftSpecs?.bore_mm, rightSpecs?.bore_mm)
    compareDim('OD', leftSpecs?.od_mm, rightSpecs?.od_mm)
    compareDim('width', leftSpecs?.width_mm, rightSpecs?.width_mm)

    const sameDimensions = Boolean(
      leftSpecs?.bore_mm != null && rightSpecs?.bore_mm != null
      && leftSpecs?.od_mm != null && rightSpecs?.od_mm != null
      && leftSpecs?.width_mm != null && rightSpecs?.width_mm != null
      && dimensionMismatch.length === 0
    )
    const typeMismatch = Boolean(leftSpecs?.bearing_type && rightSpecs?.bearing_type && leftSpecs.bearing_type !== rightSpecs.bearing_type)
    const sameType = Boolean(leftSpecs?.bearing_type && rightSpecs?.bearing_type && leftSpecs.bearing_type === rightSpecs.bearing_type)
    const sealMismatch = Boolean(leftSpecs?.seal_type && rightSpecs?.seal_type && leftSpecs.seal_type.toLowerCase() !== rightSpecs.seal_type.toLowerCase())
    const sameLoose = leftLoose == rightLoose
    const exactSame = sameLoose && leftBrand && rightBrand && leftBrand === rightBrand

    if (dimensionMismatch.length) warnings.push(...dimensionMismatch)
    if (typeMismatch) warnings.push(`bearing family differs (${leftSpecs?.bearing_type} vs ${rightSpecs?.bearing_type})`)
    if (sealMismatch) warnings.push(`seal/shield suffix differs (${String(leftSpecs?.seal_type).toUpperCase()} vs ${String(rightSpecs?.seal_type).toUpperCase()})`)
    if (leftBrand && rightBrand && leftBrand !== rightBrand) warnings.push(`brand changes from ${leftBrand} to ${rightBrand}`)
    if (!sameDimensions) warnings.push('catalog does not prove an identical bore / OD / width envelope')
    if (!sameType) warnings.push('catalog does not prove the same bearing family with full confidence')

    if (exactSame) {
      verdict = 'exact_match'
      reply = `Yes — **${leftLabel}** and **${rightLabel}** resolve to the same catalog fit here. I'd treat that as the same basic replacement path.`
      if (leftBrand && rightBrand && leftBrand === rightBrand && left.matched.part.part_number !== right.matched.part.part_number) {
        reply += ` The formatting differs, but the current catalog points to the same manufacturer family and designation.`
      }
    } else if (sameDimensions && sameType && !sealMismatch) {
      verdict = 'direct_fit_likely'
      reply = `This looks like a valid direct-fit substitution: **${leftLabel}** and **${rightLabel}** line up on bore / OD / width and bearing family in the current catalog.`
      if (leftBrand && rightBrand && leftBrand !== rightBrand) {
        reply += ` It is still a brand change, so treat it as an equivalent replacement rather than exact OEM continuity.`
      }
    } else if (sameDimensions && (sameType || !typeMismatch)) {
      verdict = 'conditional_fit'
      reply = `Physically, **${leftLabel}** and **${rightLabel}** look close on the fit envelope, but I would not call them fully equivalent yet.`
      if (sealMismatch) {
        reply += ` The main issue is the seal/shield difference, which can materially change contamination protection, drag, and speed behavior.`
      } else {
        reply += ` The envelope looks close, but the catalog does not prove exact functional equivalence on suffix/family details.`
      }
      reply += ' If you want, I can narrow which suffix is safer for your environment before you buy.'
    } else {
      verdict = 'not_validated'
      reply = `No — I would not treat **${leftLabel}** as a validated replacement for **${rightLabel}** from the current catalog data.`
      if (warnings[0]) {
        reply += ` Main reason: ${warnings[0]}.`
      }
      reply += ' If you send the actual bore / OD / width or the full suffix markings, I can check for a safer same-size substitute.'
    }
  }

  const observation = [
    'FITMENT_SANITY_CHECK',
    `left=${leftLabel}`,
    `right=${rightLabel}`,
    `left_catalog=${matchedFitmentLabel(left)}`,
    `right_catalog=${matchedFitmentLabel(right)}`,
    `verdict=${verdict}`,
    warnings.length ? `warnings=${warnings.join(' | ')}` : 'warnings=none',
  ].join('\n')

  return {
    reply,
    observation,
    verdict: verdict as FitmentSanityCheckResult['verdict'],
    warnings,
    leftLabel,
    rightLabel,
    leftCatalogLabel: matchedFitmentLabel(left),
    rightCatalogLabel: matchedFitmentLabel(right),
  }
}

async function loadCommerceContext(context?: {
  sessionId?: string
  userId?: number | null
  threadId?: string | null
}): Promise<string | undefined> {
  const sessionId = context?.sessionId?.trim()
  if (!sessionId) return undefined

  try {
    const [cartSummary, latestRequest] = await Promise.all([
      findActiveCartSummary({
        sessionId,
        userId: context?.userId ?? null,
      }),
      listRecentSourcingRequests({
        sessionId,
        userId: context?.userId ?? null,
        limit: 1,
      }).then((rows) => rows[0] ?? null),
    ])

    if (!cartSummary && !latestRequest) return undefined
    return buildCommerceContextPrompt(cartSummary, latestRequest)
  } catch (err) {
    console.warn('Commerce context lookup failed:', err)
    return undefined
  }
}

function buildCommerceContextPrompt(
  cartSummary: CartSummary | null,
  latestRequest: SourcingRequestRecord | null
): string {
  const lines = [
    'SERVER-SIDE CART / REQUEST STATE (authoritative):',
    `active_cart_line_items=${cartSummary?.items.length ?? 0}`,
    `active_cart_total_units=${cartSummary?.itemCount ?? 0}`,
    `active_cart_estimated_subtotal=${formatPriceMaybe(cartSummary?.estimatedSubtotalUsd ?? null)}`,
  ]

  if (cartSummary?.items.length) {
    lines.push('active_cart_contents:')
    lines.push(...cartSummary.items.slice(0, 5).map((item, index) => {
      const label = [item.manufacturerName ?? item.manufacturerSlug, item.partNumber].filter(Boolean).join(' ')
      const supplier = item.supplierName ? ` via ${item.supplierName}` : ''
      const unitPrice = item.unitPriceUsd != null ? ` @ ${formatPriceMaybe(item.unitPriceUsd)} each` : ''
      return `${index + 1}. ${label} x${item.quantity}${supplier}${unitPrice}`
    }))
  } else {
    lines.push('active_cart_contents: none')
  }

  if (latestRequest) {
    lines.push(`latest_submitted_request=${latestRequest.requestRef} | items=${latestRequest.itemCount} | estimated_subtotal=${formatPriceMaybe(latestRequest.estimatedSubtotalUsd)}`)
  } else {
    lines.push('latest_submitted_request=none')
  }

  return lines.join('\n')
}

function buildAttachmentEvidenceSummary(
  attachments: ChatAttachment[],
  evidence: EvidenceAnalysis | null
): string {
  const lines = [
    `ATTACHED EVIDENCE: ${summarizeAttachmentKinds(attachments)}`,
  ]

  if (evidence?.summary) {
    lines.push(`EVIDENCE SUMMARY: ${evidence.summary}`)
  }

  const extracted = attachments
    .filter((attachment) => attachment.extractedText)
    .map((attachment) => `${attachment.name}:\n${attachment.extractedText}`)

  if (extracted.length) {
    lines.push(`DOCUMENT EXTRACTS:\n${extracted.join('\n\n')}`)
  }

  return lines.join('\n\n')
}

function looksLikeIdentifyFromEvidenceQuery(
  message: string,
  attachments: ChatAttachment[],
  evidence: EvidenceAnalysis | null
): boolean {
  if (!attachments.length) return false
  if (looksLikeQuoteOrBomComparisonQuery(message, attachments)) return false
  const q = message.toLowerCase()
  if (!message.trim()) return true
  if (/(what is this|identify|id this|what bearing|what part|what do you see|read this|read the label|confirm this part|replacement from photo|from this photo|from this image|from this label|is this the same|is this equivalent)/.test(q)) {
    return true
  }
  return Boolean(evidence?.rewrittenQuery?.trim())
}

function runIdentifyFromEvidenceTool(params: {
  message: string
  evidence: EvidenceAnalysis | null
  search: Awaited<ReturnType<typeof searchPartsByQuery>>
}): EvidenceIdentificationResult | null {
  const top = params.search.results[0]
  if (!top) return null

  const mfr = top.part.manufacturer_name ?? top.part.manufacturer_slug ?? 'Unknown'
  const pn = top.part.part_number
  const specs = top.specs
  const listing = bestListingForResult(top)
  const recommendation = recommendBuyOptionFromSearch(params.message, params.search)
  const exactish = top.match_reason === 'exact' || top.match_reason === 'exact_part_number'
  const confidence = params.evidence?.confidence ?? 0.9
  const label = confidence >= 0.93 && exactish ? 'This looks like' : 'Most likely this is'
  const dimText = specs?.bore_mm && specs?.od_mm && specs?.width_mm
    ? ` (${specs.bore_mm}×${specs.od_mm}×${specs.width_mm} mm)`
    : ''
  const sealText = specs?.seal_type ? `, ${String(specs.seal_type).toUpperCase()} sealed` : ''
  const priceText = listing?.price_usd != null
    ? ` Current catalog baseline: **$${Number(listing.price_usd).toFixed(2)}**${listing.supplier_name ? ` via ${listing.supplier_name}` : ''}.`
    : ''

  const lines: string[] = [
    `${label} **${mfr} ${pn}**${dimText}${sealText}.`,
  ]

  if (params.evidence?.summary) {
    lines.push(`I’m basing that on the evidence: ${params.evidence.summary}.`)
  }

  lines.push(priceText.trim())

  if (
    recommendation?.cheapestAcceptable
    && `${recommendation.cheapestAcceptable.manufacturer} ${recommendation.cheapestAcceptable.partNumber}` !== `${mfr} ${pn}`
  ) {
    lines.push(
      `If you just want a cheaper acceptable replacement, look at **${recommendation.cheapestAcceptable.manufacturer} ${recommendation.cheapestAcceptable.partNumber}**${recommendation.cheapestAcceptable.priceUsd != null ? ` at about **$${recommendation.cheapestAcceptable.priceUsd.toFixed(2)}**` : ''}${recommendation.cheapestAcceptable.supplierName ? ` via ${recommendation.cheapestAcceptable.supplierName}` : ''}.`
    )
  }

  if (
    recommendation?.premiumOption
    && `${recommendation.premiumOption.manufacturer} ${recommendation.premiumOption.partNumber}` !== `${mfr} ${pn}`
  ) {
    lines.push(
      `If you want the safer premium / OEM-style option, use **${recommendation.premiumOption.manufacturer} ${recommendation.premiumOption.partNumber}**${recommendation.premiumOption.priceUsd != null ? ` at about **$${recommendation.premiumOption.priceUsd.toFixed(2)}**` : ''}${recommendation.premiumOption.supplierName ? ` via ${recommendation.premiumOption.supplierName}` : ''}.`
    )
  }

  const warnings: string[] = []
  if (!exactish) warnings.push('catalog match is the closest current fit, not a verified exact marking read')
  if (confidence < 0.93) warnings.push('photo/file confidence is moderate, not definitive')

  if (warnings[0]) {
    lines.push(`Note: ${warnings[0]}.`)
  }

  lines.push(
    confidence >= 0.93 && exactish
      ? 'If you want, I can now give you the cheapest acceptable option vs the premium/OEM pick.'
      : 'If you want, send one clearer marking photo or the bore / OD / width and I’ll confirm it before you buy.'
  )

  const observation = [
    'IDENTIFY_FROM_EVIDENCE',
    `identified=${mfr} ${pn}`,
    `match_reason=${top.match_reason}`,
    `evidence_confidence=${confidence}`,
    specs?.bore_mm && specs?.od_mm && specs?.width_mm ? `dimensions=${specs.bore_mm}x${specs.od_mm}x${specs.width_mm} mm` : 'dimensions=unknown',
    listing?.price_usd != null ? `baseline_price=$${Number(listing.price_usd).toFixed(2)}${listing.supplier_name ? ` via ${listing.supplier_name}` : ''}` : 'baseline_price=unavailable',
    recommendation?.cheapestAcceptable ? `cheapest_acceptable=${recommendation.cheapestAcceptable.manufacturer} ${recommendation.cheapestAcceptable.partNumber}` : 'cheapest_acceptable=none',
    recommendation?.premiumOption ? `premium_option=${recommendation.premiumOption.manufacturer} ${recommendation.premiumOption.partNumber}` : 'premium_option=none',
    warnings.length ? `warnings=${warnings.join(' | ')}` : 'warnings=none',
  ].join('\n')

  return {
    reply: lines.filter(Boolean).join(' '),
    observation,
  }
}

async function analyzeAttachmentEvidence(
  message: string,
  history: ChatTurn[],
  attachments: ChatAttachment[]
): Promise<EvidenceAnalysis | null> {
  const historyBlock = history.length
    ? history
        .slice(-8)
        .map((turn, i) => `${i + 1}. ${turn.role.toUpperCase()}: ${turn.content}`)
        .join('\n')
    : 'none'

  const extracted = attachments
    .filter((attachment) => attachment.extractedText)
    .map((attachment) => `FILE ${attachment.name}:\n${attachment.extractedText}`)
    .join('\n\n') || 'none'

  const prompt = [
    `Latest user message: ${message}`,
    '',
    'Recent conversation context:',
    historyBlock,
    '',
    `Attached files: ${summarizeAttachmentKinds(attachments)}`,
    '',
    'Extracted document text:',
    extracted,
    '',
    'Return the evidence-analysis JSON now.',
  ].join('\n')

  try {
    const raw = await runPiText(prompt, {
      model: PARTS_CHAT_MODEL,
      thinking: PARTS_EXTRACT_THINKING,
      timeoutMs: 12000,
      systemPrompt: EVIDENCE_ANALYSIS_SYSTEM_PROMPT,
      inputFiles: modelVisibleAttachmentPaths(attachments),
    })
    const parsed = parseJsonObject(raw)
    return {
      summary: asString(parsed.summary) ?? '',
      rewrittenQuery: asString(parsed.rewrittenQuery) ?? message,
      confidence: asNumber(parsed.confidence) ?? 0.75,
    }
  } catch (err) {
    console.warn('Attachment evidence analysis failed:', err)
    return null
  }
}
async function chatConversationally(
  message: string,
  history: ChatTurn[],
  attachments: ChatAttachment[] = [],
  evidenceSummary?: string,
  commerceContext?: string
): Promise<string> {
  const historyBlock = history.length
    ? history
        .slice(-8)
        .map((turn, i) => `${i + 1}. ${turn.role.toUpperCase()}: ${turn.content}`)
        .join('\n')
    : 'none'

  const prompt = [
    `Latest user message: ${message}`,
    '',
    'Recent conversation context:',
    historyBlock,
    attachments.length ? '' : null,
    attachments.length ? `Attached evidence: ${summarizeAttachmentKinds(attachments)}` : null,
    evidenceSummary ? '' : null,
    evidenceSummary ?? null,
    commerceContext ? '' : null,
    commerceContext ?? null,
    '',
    'Reply naturally like a strong bearings-shopping teammate.',
    'If server-side cart/request state is present and the user asks what is staged, what was submitted, or what the next step should be, use that state directly.',
    'If files or photos are attached, use them directly and say what you can see or infer.',
    'If this is a greeting or capability check, keep it short and warm, mention 2-4 useful things you can help with, and invite the next message.',
    'Do not output a canned capability dump unless the user explicitly asks for one.',
    'Do not use headings unless they genuinely help.',
  ].filter(Boolean).join('\n')

  try {
    const text = await runPiText(prompt, {
      model: PARTS_CHAT_MODEL,
      thinking: PARTS_CHAT_THINKING,
      timeoutMs: PARTS_CHAT_TIMEOUT_MS,
      systemPrompt: PARTS_AGENT_SYSTEM_PROMPT,
      inputFiles: modelVisibleAttachmentPaths(attachments),
    })
    const trimmed = text.trim()
    if (trimmed) return trimmed
  } catch (err) {
    console.warn('Conversational reply failed:', err)
  }

  return "Hey — I can help you find bearings, compare brands, cross-reference part numbers, inspect photos, and read uploaded files like PDFs or quotes. If you want, send a part number, a photo, or just describe what you're trying to buy."
}

async function chatWithPiAgent(params: {
  userMessage: string
  effectiveMessage: string
  history: ChatTurn[]
  searchContext: string
  calcContext?: string
  toolObservations?: string[]
  evidenceSummary?: string
  commerceContext?: string
  attachments?: ChatAttachment[]
  calculationMeta?: {
    suitableCount: number
    totalCandidates: number
    topResults: FailureModeFinding[]
  }
}): Promise<string> {
  const historyBlock = params.history.length
    ? params.history
        .slice(-8)
        .map((turn, i) => `${i + 1}. ${turn.role.toUpperCase()}: ${turn.content}`)
        .join('\n')
    : 'none'

  let prompt = [
    `Latest user message: ${params.userMessage}`,
    `Standalone interpreted message: ${params.effectiveMessage}`,
    '',
    'Recent conversation context:',
    historyBlock,
    '',
    'Live catalog search results:',
    params.searchContext,
  ].join('\n')

  if (params.evidenceSummary) {
    prompt += `\n\nATTACHED EVIDENCE:\n${params.evidenceSummary}`
  }

  if (params.commerceContext) {
    prompt += `\n\n${params.commerceContext}\nUse this as authoritative workflow state if the user refers to staged items, prior submissions, readiness to submit, or next-step buying workflow.`
  }

  if (params.toolObservations?.length) {
    prompt += `\n\nPLANNER / TOOL OBSERVATIONS:\n${params.toolObservations.join('\n\n')}`
  }

  if (params.calculationMeta) {
    const topCandidates = params.calculationMeta.topResults.length
      ? params.calculationMeta.topResults
          .map(
            (r, i) =>
              `${i + 1}. ${r.manufacturer} ${r.part_number} | suitable=${r.suitable ? 'yes' : 'no'} | L10=${Math.round(r.l10_hours)} h | static SF=${r.staticSafetyFactor.toFixed(2)}`
          )
          .join('\n')
      : 'none'

    prompt += `\n\nDETERMINISTIC SELECTION FACTS:\n- Suitable candidates: ${params.calculationMeta.suitableCount}\n- Total candidates considered: ${params.calculationMeta.totalCandidates}\n- Top candidates:\n${topCandidates}`
  }

  if (params.calcContext) {
    prompt += `\n\nENGINEERING CALCULATION RESULTS (deterministic ISO 281):\n${params.calcContext}\n\nInterpret L10 life and safety factors clearly. The calculation output is deterministic and should be treated as authoritative.`
  }

  const feasibility = detectFeasibilitySignal(params.userMessage)
  if (feasibility.looksExtreme) {
    prompt += `\n\nFEASIBILITY WARNING:\nThe user is asking for an unusually aggressive duty point: ${feasibility.reasons.join(', ')}.\nDo not imply that an exact validated match is likely unless the evidence truly supports it. If key load data is missing, say that openly. If the envelope may be unrealistic for the duty, say so clearly before suggesting next steps.`
  }

  prompt += '\n\nReturn your final user-facing answer only. Do not output JSON.'

  const text = await runPiText(prompt, {
    model: PARTS_CHAT_MODEL,
    thinking: PARTS_CHAT_THINKING,
    timeoutMs: PARTS_CHAT_TIMEOUT_MS,
    systemPrompt: PARTS_AGENT_SYSTEM_PROMPT,
    inputFiles: modelVisibleAttachmentPaths(params.attachments ?? []),
  })

  const trimmed = text.trim()
  if (!trimmed) throw new Error('Empty response from PI parts agent')
  return trimmed
}

interface PartsAgentPlan {
  tool: 'search_catalog' | 'recommend_buy_option' | 'compare_quote_or_bom' | 'identify_from_evidence' | 'fitment_sanity_check' | 'run_engineering_selection' | 'respond'
  query?: string
  reason?: string
  response?: string
}

async function planNextPartsAgentStep(params: {
  userMessage: string
  effectiveMessage: string
  history: ChatTurn[]
  parsed: Awaited<ReturnType<typeof parseQuery>>
  toolObservations: string[]
  hasSearch: boolean
  hasCalculation: boolean
  hasRecommendation: boolean
  hasComparison: boolean
  hasIdentification: boolean
  hasFitmentCheck: boolean
  hasAttachments: boolean
  evidenceSummary?: string
  commerceContext?: string
}): Promise<PartsAgentPlan> {
  const historyBlock = params.history.length
    ? params.history
        .slice(-8)
        .map((turn, i) => `${i + 1}. ${turn.role.toUpperCase()}: ${turn.content}`)
        .join('\n')
    : 'none'

  const prompt = [
    `Latest user message: ${params.userMessage}`,
    `Standalone interpreted message: ${params.effectiveMessage}`,
    `Parsed intent: ${JSON.stringify(params.parsed)}`,
    `Have catalog search results already: ${params.hasSearch ? 'yes' : 'no'}`,
    `Have engineering selection results already: ${params.hasCalculation ? 'yes' : 'no'}`,
    `Have deterministic buy recommendation already: ${params.hasRecommendation ? 'yes' : 'no'}`,
    `Have quote/BOM comparison already: ${params.hasComparison ? 'yes' : 'no'}`,
    `Have evidence identification already: ${params.hasIdentification ? 'yes' : 'no'}`,
    `Have fitment sanity check already: ${params.hasFitmentCheck ? 'yes' : 'no'}`,
    `Have attachments already: ${params.hasAttachments ? 'yes' : 'no'}`,
    '',
    'Recent conversation context:',
    historyBlock,
    '',
    'Attached evidence summary:',
    params.evidenceSummary ?? 'none',
    '',
    'Server-side cart / request state:',
    params.commerceContext ?? 'none',
    '',
    'Current observations:',
    params.toolObservations.length ? params.toolObservations.join('\n\n') : 'none',
    '',
    'Choose the next best step now.',
  ].join('\n')

  const raw = await runPiText(prompt, {
    model: PARTS_PLANNER_MODEL,
    thinking: PARTS_AGENT_PLANNER_THINKING,
    timeoutMs: 9000,
    systemPrompt: AGENT_TOOL_PLANNER_SYSTEM_PROMPT,
  })

  const parsed = parseJsonObject(raw)
  const tool = asString(parsed.tool)
  const response = asString(parsed.response)
  const query = asString(parsed.query)
  const reason = asString(parsed.reason)

  if (tool === 'search_catalog' || tool === 'recommend_buy_option' || tool === 'compare_quote_or_bom' || tool === 'identify_from_evidence' || tool === 'fitment_sanity_check' || tool === 'run_engineering_selection' || tool === 'respond') {
    return { tool, query, response, reason }
  }

  return {
    tool: params.hasSearch ? 'respond' : 'search_catalog',
    query: params.effectiveMessage,
    reason: 'fallback_plan',
  }
}

function formatSearchObservation(
  queryText: string,
  search: Awaited<ReturnType<typeof searchPartsByQuery>>
): string {
  return [
    `SEARCH_CATALOG for: ${queryText}`,
    summarizeSearchForLLM(search),
  ].join('\n')
}

async function runEngineeringSelectionTool(queryText: string): Promise<{
  results: Awaited<ReturnType<typeof selectBearings>> | null
  observation: string
}> {
  const params = await extractApplicationParams(queryText)

  if (!params?.isApplicationQuery) {
    return {
      results: null,
      observation: `ENGINEERING_SELECTION for: ${queryText}
No deterministic selection run: the message did not contain enough application-selection intent.`,
    }
  }

  if (!(params.radialLoad_kn || params.rpm || params.shaftDiameter_mm)) {
    return {
      results: null,
      observation: `ENGINEERING_SELECTION for: ${queryText}
No deterministic selection run: need at least one of shaft size, load, or RPM to calculate against the catalog.`,
    }
  }

  try {
    const request: SelectionRequest = {
      radialLoad_kn: params.radialLoad_kn ?? 1,
      axialLoad_kn: params.axialLoad_kn ?? 0,
      axialLoadSpecified: params.axialLoad_kn != null,
      rpm: params.rpm ?? 1500,
      shaftDiameter_mm: params.shaftDiameter_mm ?? undefined,
      outerDiameter_mm: params.outerDiameter_mm ?? undefined,
      width_mm: params.width_mm ?? undefined,
      temperature_c: params.temperature_c ?? undefined,
      lubrication: params.lubrication ?? undefined,
      environment: params.environment ?? undefined,
      bearingTypes: params.bearingTypes ?? undefined,
      sealType: params.sealType ?? undefined,
      minLifeHours: params.minLifeHours ?? undefined,
    }

    const results = await selectBearings(request)

    return {
      results,
      observation: `ENGINEERING_SELECTION for: ${queryText}
${results.summary}`,
    }
  } catch (err) {
    console.error('Bearing calculator error:', err)
    return {
      results: null,
      observation: `ENGINEERING_SELECTION for: ${queryText}
Deterministic selection failed to execute.`,
    }
  }
}

async function resolveStandaloneUserQuery(message: string, history: ChatTurn[]): Promise<string> {
  if (!history.length) return message

  const applicationHeuristic = heuristicApplicationFollowupRewrite(message, history)
  if (applicationHeuristic) return applicationHeuristic

  const heuristicFirst = heuristicFollowupRewrite(message, history)
  if (heuristicFirst) return heuristicFirst

  const prompt = [
    'Conversation history:',
    ...history.slice(-8).map((turn, i) => `${i + 1}. ${turn.role.toUpperCase()}: ${turn.content}`),
    '',
    `Latest user message: ${message}`,
    '',
    'Produce rewrite JSON now.',
  ].join('\n')

  try {
    const raw = await runPiText(prompt, {
      model: PARTS_REWRITE_MODEL,
      thinking: PARTS_REWRITE_THINKING,
      timeoutMs: 9000,
      systemPrompt: QUERY_REWRITE_SYSTEM_PROMPT,
    })

    const parsed = parseJsonObject(raw)
    const standalone = asString(parsed.standalone_query)
    if (standalone) {
      if (standalone === message) {
        const heuristic = heuristicFollowupRewrite(message, history)
        return heuristic ?? message
      }
      return standalone
    }

    return heuristicFollowupRewrite(message, history) ?? message
  } catch (err) {
    console.warn('Query rewrite failed, using raw message:', err)
    return heuristicFollowupRewrite(message, history) ?? message
  }
}

async function extractApplicationParams(message: string): Promise<{
  isApplicationQuery: boolean
  shaftDiameter_mm?: number
  outerDiameter_mm?: number
  width_mm?: number
  radialLoad_kn?: number
  axialLoad_kn?: number
  rpm?: number
  temperature_c?: number
  lubrication?: 'grease' | 'oil'
  environment?: string
  bearingTypes?: string[]
  sealType?: string
  minLifeHours?: number
} | null> {
  const prompt = [
    `User message: ${message}`,
    '',
    'Return the extraction JSON now.',
  ].join('\n')

  try {
    const raw = await runPiText(prompt, {
      model: PARTS_PARAMS_MODEL,
      thinking: PARTS_EXTRACT_THINKING,
      timeoutMs: 9000,
      systemPrompt: EXTRACT_PARAMS_SYSTEM_PROMPT,
    })

    const parsed = parseJsonObject(raw)

    return {
      isApplicationQuery: Boolean(parsed.isApplicationQuery),
      shaftDiameter_mm: asNumber(parsed.shaftDiameter_mm),
      outerDiameter_mm: asNumber(parsed.outerDiameter_mm),
      width_mm: asNumber(parsed.width_mm),
      radialLoad_kn: asNumber(parsed.radialLoad_kn),
      axialLoad_kn: asNumber(parsed.axialLoad_kn),
      rpm: asNumber(parsed.rpm),
      temperature_c: asNumber(parsed.temperature_c),
      lubrication: normalizeLube(parsed.lubrication),
      environment: asString(parsed.environment),
      bearingTypes: asStringArray(parsed.bearingTypes),
      sealType: asString(parsed.sealType),
      minLifeHours: asNumber(parsed.minLifeHours),
    }
  } catch (err) {
    console.warn('Parameter extraction failed:', err)
    return null
  }
}


async function maybeHandleApplicationIntake(params: {
  message: string
  history: ChatTurn[]
  parsed: Awaited<ReturnType<typeof parseQuery>>
}): Promise<PartsAssistantResponse | null> {
  const intake = await analyzeApplicationIntakeContext(params.message, params.history, params.parsed)
  if (!intake?.isApplicationQuery) return null

  const nextQuestion = chooseNextApplicationQuestion(intake, params.message)
  if (!nextQuestion) return null

  const searchQuery = buildApplicationContextSearchQuery(intake)
  const search = searchQuery ? await searchPartsByQuery(searchQuery, 6) : null

  return {
    reply: buildApplicationAskBackReply(intake, nextQuestion, search),
    parsed: search?.parsed ?? params.parsed,
    total: search?.total ?? 0,
    results: search?.results ?? [],
  }
}

async function analyzeApplicationIntakeContext(
  message: string,
  history: ChatTurn[],
  parsed: Awaited<ReturnType<typeof parseQuery>>
): Promise<ApplicationIntakeContext | null> {
  const shouldInspect = parsed.intent === 'spec_search' || /\b(shaft|bore|od|width|rpm|load|kn|application|conveyor|motor|pump|gearbox|fan|axial|thrust|life|hours|lubrication|grease|oil|dusty|wet|washdown|temperature)\b/i.test(message)
  if (!shouldInspect) return null

  const current = await extractApplicationParams(message)
  const heuristicCurrent = extractHeuristicApplicationContext(message)
  const priorUserTurns = history
    .filter((turn) => turn.role === 'user')
    .slice(-5)
    .map((turn) => turn.content.trim())
    .filter(Boolean)
  const combinedMessage = [...priorUserTurns, message].join('\n')
  const combined = combinedMessage && combinedMessage !== message
    ? await extractApplicationParams(combinedMessage)
    : null
  const heuristicCombined = extractHeuristicApplicationContext(combinedMessage)

  const isApplicationQuery = Boolean(
    parsed.intent === 'spec_search'
    || current?.isApplicationQuery
    || combined?.isApplicationQuery
    || heuristicCurrent.isApplicationQuery
    || heuristicCombined.isApplicationQuery
  )
  if (!isApplicationQuery) return null

  const mergedEnvironment = current?.environment
    ?? combined?.environment
    ?? heuristicCurrent.environment
    ?? heuristicCombined.environment
    ?? parsed.environment
  const derivedSeal = current?.sealType
    ?? combined?.sealType
    ?? heuristicCurrent.sealType
    ?? heuristicCombined.sealType
    ?? parsed.seal_type
    ?? deriveSealTypeFromEnvironment(mergedEnvironment)
  const derivedBearingTypes = current?.bearingTypes
    ?? combined?.bearingTypes
    ?? heuristicCurrent.bearingTypes
    ?? heuristicCombined.bearingTypes
    ?? (parsed.bearing_type ? [parsed.bearing_type] : undefined)

  return {
    isApplicationQuery,
    shaftDiameter_mm: current?.shaftDiameter_mm ?? combined?.shaftDiameter_mm ?? heuristicCurrent.shaftDiameter_mm ?? heuristicCombined.shaftDiameter_mm ?? parsed.bore_mm ?? undefined,
    outerDiameter_mm: current?.outerDiameter_mm ?? combined?.outerDiameter_mm ?? heuristicCurrent.outerDiameter_mm ?? heuristicCombined.outerDiameter_mm ?? parsed.od_mm ?? undefined,
    width_mm: current?.width_mm ?? combined?.width_mm ?? heuristicCurrent.width_mm ?? heuristicCombined.width_mm ?? parsed.width_mm ?? undefined,
    radialLoad_kn: current?.radialLoad_kn ?? combined?.radialLoad_kn ?? heuristicCurrent.radialLoad_kn ?? heuristicCombined.radialLoad_kn ?? parsed.load_kn ?? undefined,
    axialLoad_kn: current?.axialLoad_kn ?? combined?.axialLoad_kn ?? heuristicCurrent.axialLoad_kn ?? heuristicCombined.axialLoad_kn ?? undefined,
    rpm: current?.rpm ?? combined?.rpm ?? heuristicCurrent.rpm ?? heuristicCombined.rpm ?? parsed.speed_rpm ?? undefined,
    temperature_c: current?.temperature_c ?? combined?.temperature_c ?? heuristicCurrent.temperature_c ?? heuristicCombined.temperature_c ?? undefined,
    lubrication: current?.lubrication ?? combined?.lubrication ?? heuristicCurrent.lubrication ?? heuristicCombined.lubrication ?? undefined,
    environment: mergedEnvironment ?? undefined,
    bearingTypes: derivedBearingTypes,
    sealType: derivedSeal,
    minLifeHours: current?.minLifeHours ?? combined?.minLifeHours ?? heuristicCurrent.minLifeHours ?? heuristicCombined.minLifeHours ?? undefined,
  }
}

function extractHeuristicApplicationContext(message: string): ApplicationIntakeContext {
  const text = message.toLowerCase()
  const shaftMatch = message.match(/(?:shaft|bore)\s*(?:diameter)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*mm/i)
    ?? message.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:shaft|bore)/i)
  const odMatch = message.match(/(?:outer\s*diameter|od)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*mm/i)
    ?? message.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:outer\s*diameter|od)\b/i)
  const widthMatch = message.match(/(?:width|thickness)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*mm/i)
    ?? message.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:width|thickness)\b/i)
  const envelopeMatch = message.match(/(?:housing\s*pocket|envelope).{0,40}?(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm/i)
  const rpmMatch = message.match(/(\d[\d,]*(?:\.\d+)?)\s*rpm/i)
  const lifeMatch = message.match(/(\d[\d,]*)\s*(?:hours|hour|hrs|hr)\b/i)
  const radialMatch = message.match(/(?:radial\s*load|load|fr)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*k\s*n\b/i)
    ?? message.match(/(\d+(?:\.\d+)?)\s*k\s*n\s*(?:radial\s*load|radial)\b/i)
  const axialMatch = message.match(/(?:axial|thrust|fa)\s*(?:load)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*k\s*n\b/i)
    ?? message.match(/(\d+(?:\.\d+)?)\s*k\s*n\s*(?:axial|thrust)\b/i)
  const explicitZeroAxial = /\b(?:no|without|none|negligible)\s+(?:meaningful\s+)?(?:axial|thrust)\s*(?:load)?\b/i.test(message)
    || /\b(?:axial|thrust)\s*(?:load)?\s*(?:is\s*)?(?:none|zero|negligible)\b/i.test(message)
    || /\b(?:almost entirely|mostly)\s+radial\b/i.test(message)

  let environment: string | undefined
  if (/food|washdown|hygien/.test(text)) environment = 'food_grade'
  else if (/high\s*temp|\btemp\b|\bhot\b/.test(text)) environment = 'high_temp'
  else if (/dust|dirty|contamin/.test(text)) environment = 'dusty'
  else if (/wet|water|moisture|wash/.test(text)) environment = 'wet'
  else if (/chem|solvent|caustic/.test(text)) environment = 'chemical'

  let lubrication: 'grease' | 'oil' | undefined
  if (/\boil\b/.test(text)) lubrication = 'oil'
  else if (/\bgrease\b/.test(text)) lubrication = 'grease'

  let bearingTypes: string[] | undefined
  if (/deep[ -]?groove/.test(text)) bearingTypes = ['deep_groove']
  else if (/tapered/.test(text)) bearingTypes = ['tapered']
  else if (/needle/.test(text)) bearingTypes = ['needle']
  else if (/spherical/.test(text)) bearingTypes = ['spherical']
  else if (/thrust/.test(text)) bearingTypes = ['thrust']
  else if (/angular/.test(text)) bearingTypes = ['angular']

  let sealType: string | undefined
  if (/\b2rs\b|sealed|dust|washdown|wet|water/.test(text)) sealType = '2rs'
  else if (/\bzz\b|shield/.test(text)) sealType = 'zz'

  return {
    isApplicationQuery: /\b(shaft|bore|rpm|load|application|conveyor|motor|pump|gearbox|fan|axial|thrust|life|hours|lubrication|grease|oil|dusty|wet|washdown|temperature)\b/i.test(message),
    shaftDiameter_mm: shaftMatch ? Number(shaftMatch[1].replace(/,/g, '')) : undefined,
    outerDiameter_mm: odMatch ? Number(odMatch[1].replace(/,/g, '')) : (envelopeMatch ? Number(envelopeMatch[1].replace(/,/g, '')) : undefined),
    width_mm: widthMatch ? Number(widthMatch[1].replace(/,/g, '')) : (envelopeMatch ? Number(envelopeMatch[2].replace(/,/g, '')) : undefined),
    radialLoad_kn: radialMatch ? Number(radialMatch[1].replace(/,/g, '')) : undefined,
    axialLoad_kn: axialMatch ? Number(axialMatch[1].replace(/,/g, '')) : (explicitZeroAxial ? 0 : undefined),
    rpm: rpmMatch ? Number(rpmMatch[1].replace(/,/g, '')) : undefined,
    environment,
    lubrication,
    bearingTypes,
    sealType,
    minLifeHours: lifeMatch ? Number(lifeMatch[1].replace(/,/g, '')) : undefined,
  }
}

function chooseNextApplicationQuestion(
  intake: ApplicationIntakeContext,
  message: string
): string | null {
  if (!intake.shaftDiameter_mm) {
    return 'What shaft or bore size are you working with in mm?'
  }

  if (intake.radialLoad_kn == null) {
    return 'What radial load should I design around — roughly in kN, or what machine and transmitted power are we talking about?'
  }

  if (intake.rpm == null) {
    return 'What RPM is it running at?'
  }

  if (/\b(axial|thrust)\b/i.test(message) && intake.axialLoad_kn == null) {
    return 'Is there meaningful axial / thrust load here, or is this mostly radial?'
  }

  if (!intake.environment && !intake.sealType) {
    return 'What environment is it in: clean, dusty, wet/washdown, hot, or chemical service?'
  }

  return null
}

function buildApplicationContextSearchQuery(intake: ApplicationIntakeContext): string {
  const parts: string[] = []

  if (intake.shaftDiameter_mm != null) parts.push(`${intake.shaftDiameter_mm} mm bore bearing`)
  if (intake.bearingTypes?.[0]) parts.push(intake.bearingTypes[0].replace(/_/g, ' '))
  if (intake.sealType) parts.push(intake.sealType.toUpperCase())
  else if (intake.environment) parts.push(intake.environment)
  if (intake.lubrication) parts.push(intake.lubrication)

  return parts.join(' ').trim()
}

function buildEngineeringSelectionQuery(intake: ApplicationIntakeContext): string {
  const parts: string[] = []
  if (intake.shaftDiameter_mm != null) parts.push(`${trimTrailingZeros(intake.shaftDiameter_mm)} mm shaft`)
  if (intake.radialLoad_kn != null) parts.push(`${trimTrailingZeros(intake.radialLoad_kn)} kN radial load`)
  if (intake.axialLoad_kn != null) parts.push(`${trimTrailingZeros(intake.axialLoad_kn)} kN axial load`)
  if (intake.rpm != null) parts.push(`${Math.round(intake.rpm).toLocaleString()} rpm`)
  if (intake.outerDiameter_mm != null) parts.push(`${trimTrailingZeros(intake.outerDiameter_mm)} mm OD limit`)
  if (intake.width_mm != null) parts.push(`${trimTrailingZeros(intake.width_mm)} mm width limit`)
  if (intake.environment) parts.push(`${formatEnvironmentLabel(intake.environment)} service`)
  if (intake.sealType) parts.push(`${String(intake.sealType).toUpperCase()} sealed`)
  if (intake.minLifeHours != null) parts.push(`${Math.round(intake.minLifeHours).toLocaleString()} hour life target`)
  return parts.join(', ')
}

function buildApplicationAskBackReply(
  intake: ApplicationIntakeContext,
  nextQuestion: string,
  search: Awaited<ReturnType<typeof searchPartsByQuery>> | null
): string {
  const known = summarizeKnownApplicationContext(intake)
  const provisional = formatProvisionalApplicationCandidates(search)
  const lines: string[] = ['I’m treating this as an application-first bearing selection, not just a part lookup.']

  if (known.length) {
    lines.push(`So far I have ${joinNaturalLanguageList(known)}.`)
  }

  if (provisional) {
    lines.push(`Provisional catalog starting points right now: ${provisional}. I would still treat those as provisional until I have the next duty detail.`)
  } else if (known.length) {
    lines.push('I can start narrowing the family from that, but one more duty detail will change the recommendation a lot.')
  }

  lines.push(nextQuestion)
  return lines.join(' ')
}

function summarizeKnownApplicationContext(intake: ApplicationIntakeContext): string[] {
  const parts: string[] = []
  if (intake.shaftDiameter_mm != null) parts.push(`a ${intake.shaftDiameter_mm} mm shaft / bore`)
  if (intake.outerDiameter_mm != null || intake.width_mm != null) {
    const envelopeParts = [
      intake.outerDiameter_mm != null ? `${trimTrailingZeros(intake.outerDiameter_mm)} mm OD` : null,
      intake.width_mm != null ? `${trimTrailingZeros(intake.width_mm)} mm width` : null,
    ].filter(Boolean)
    if (envelopeParts.length) parts.push(`an envelope around ${envelopeParts.join(' × ')}`)
  }
  if (intake.radialLoad_kn != null) parts.push(`about ${trimTrailingZeros(intake.radialLoad_kn)} kN radial load`)
  if (intake.axialLoad_kn != null) parts.push(`about ${trimTrailingZeros(intake.axialLoad_kn)} kN axial load`)
  if (intake.rpm != null) parts.push(`${Math.round(intake.rpm).toLocaleString()} rpm`)
  if (intake.environment) parts.push(`${formatEnvironmentLabel(intake.environment)} service`)
  if (intake.sealType) parts.push(`${String(intake.sealType).toUpperCase()} sealing preference`)
  if (intake.bearingTypes?.length) parts.push(`${intake.bearingTypes[0].replace(/_/g, ' ')} style bearing`)
  if (intake.temperature_c != null) parts.push(`${trimTrailingZeros(intake.temperature_c)} °C operating temperature`)
  if (intake.lubrication) parts.push(`${intake.lubrication}-lubricated operation`)
  if (intake.minLifeHours != null) parts.push(`a life target around ${Math.round(intake.minLifeHours).toLocaleString()} hours`)
  return parts
}

function formatProvisionalApplicationCandidates(
  search: Awaited<ReturnType<typeof searchPartsByQuery>> | null
): string | null {
  if (!search?.results?.length) return null

  const labels = search.results
    .filter((row) => hardFitMatch(row, search.parsed))
    .slice(0, 3)
    .map((row) => [row.part.manufacturer_name ?? row.part.manufacturer_slug, row.part.part_number].filter(Boolean).join(' '))

  if (!labels.length) return null
  return joinNaturalLanguageList(labels)
}

function deriveSealTypeFromEnvironment(environment?: string | null): string | undefined {
  const value = String(environment ?? '').toLowerCase()
  if (!value) return undefined
  if (/dust|dirty|wet|wash|food|chemical/.test(value)) return '2rs'
  return undefined
}

function formatEnvironmentLabel(value: string): string {
  switch (value) {
    case 'food_grade': return 'food-grade / washdown'
    case 'high_temp': return 'high-temperature'
    default: return value.replace(/_/g, ' ')
  }
}

function joinNaturalLanguageList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function trimTrailingZeros(value: number): string {
  return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function buildDeterministicSelectionReply(
  calcResults: Awaited<ReturnType<typeof selectBearings>>
): string | undefined {
  const input = calcResults.input
  const suitable = calcResults.suitable.slice(0, 3)
  const closest = calcResults.candidates.slice(0, 3)
  const lead = suitable[0] ?? closest[0]

  if (!lead) return undefined

  const needsLifeTarget = input.minLifeHours == null
  const needsEnvelope = input.outerDiameter_mm == null || input.width_mm == null
  const needsAxialClarification = !input.axialLoadSpecified
  const isGrounded = !needsLifeTarget && !needsEnvelope && !needsAxialClarification

  if (!suitable.length && !closest.length) {
    return undefined
  }

  const dims = `${lead.bearing.bore_mm}×${lead.bearing.od_mm}×${lead.bearing.width_mm} mm`
  const leadLabel = `${lead.bearing.manufacturer_name} ${lead.bearing.part_number}`
  const comparisonSet = suitable.length ? suitable : closest
  const facts: string[] = []
  if (input.shaftDiameter_mm != null) facts.push(`${trimTrailingZeros(input.shaftDiameter_mm)} mm shaft / bore`)
  if (input.outerDiameter_mm != null || input.width_mm != null) {
    const envelopeParts = [
      input.outerDiameter_mm != null ? `${trimTrailingZeros(input.outerDiameter_mm)} mm OD` : null,
      input.width_mm != null ? `${trimTrailingZeros(input.width_mm)} mm width` : null,
    ].filter(Boolean)
    if (envelopeParts.length) facts.push(`envelope ${envelopeParts.join(' × ')}`)
  }
  if (input.radialLoad_kn != null) facts.push(`${trimTrailingZeros(input.radialLoad_kn)} kN radial load`)
  if (input.axialLoadSpecified) facts.push(`${trimTrailingZeros(input.axialLoad_kn)} kN axial load`)
  if (input.rpm != null) facts.push(`${Math.round(input.rpm).toLocaleString()} rpm`)
  if (input.minLifeHours != null) facts.push(`${Math.round(input.minLifeHours).toLocaleString()} h life target`)
  const lines: string[] = []

  if (isGrounded && suitable.length > 0) {
    const speedUtilizationPct = Math.max(1, Math.round(lead.speedUtilization * 100))
    lines.push(`Grounded recommendation from the current deterministic screen: **${leadLabel}** (${dims})${lead.bearing.seal_type ? `, ${lead.bearing.seal_type.toUpperCase()} sealed` : ''}.`)
    if (facts.length) {
      lines.push(`It clears the stated screen for ${joinNaturalLanguageList(facts)} with predicted L10 life around **${formatLifeHours(lead.l10_hours)}**, static safety factor **${lead.staticSafetyFactor.toFixed(2)}**, and speed utilization about **${speedUtilizationPct}%** of catalog limit.`)
    } else {
      lines.push(`It clears the stated screen with predicted L10 life around **${formatLifeHours(lead.l10_hours)}**, static safety factor **${lead.staticSafetyFactor.toFixed(2)}**, and speed utilization about **${speedUtilizationPct}%** of catalog limit.`)
    }
    if (comparisonSet.length > 1) {
      lines.push(`Other validated options on the same screen: ${comparisonSet.slice(1).map((r) => `${r.bearing.manufacturer_name} ${r.bearing.part_number} (${r.bearing.bore_mm}×${r.bearing.od_mm}×${r.bearing.width_mm} mm, L10 ${formatLifeHours(r.l10_hours)})`).join('; ')}.`)
    }
    lines.push('BearingBrain engineer call: this is the strongest current catalog fit from the deterministic screen and is ready to carry forward for quote or purchase review. For OEM-critical or safety-critical service, still confirm internal fit class, clearance, lubrication practice, and any required suffix-specific standards before release.')
    return lines.join(' ')
  }

  if (needsLifeTarget || needsEnvelope || needsAxialClarification) {
    const factText = facts.length ? ` for ${joinNaturalLanguageList(facts)}` : ''
    lines.push(`This is still provisional only — not purchase-ready yet — until I close the remaining application constraints${factText}.`)
  } else if (!suitable.length) {
    lines.push('This is still provisional only — not purchase-ready yet — because none of the current catalog candidates clears the current deterministic screen.')
  }

  if (suitable.length) {
    lines.push(`Best provisional catalog direction right now: **${leadLabel}** (${dims}) with predicted L10 life around **${formatLifeHours(lead.l10_hours)}** and static safety factor **${lead.staticSafetyFactor.toFixed(2)}**${lead.bearing.seal_type ? `, ${lead.bearing.seal_type.toUpperCase()} sealed` : ''}.`)
  } else {
    lines.push(`Closest provisional direction right now: **${leadLabel}** (${dims}) with predicted L10 life around **${formatLifeHours(lead.l10_hours)}** and static safety factor **${lead.staticSafetyFactor.toFixed(2)}**${lead.bearing.seal_type ? `, ${lead.bearing.seal_type.toUpperCase()} sealed` : ''}.`)
  }

  if (comparisonSet.length > 1) {
    lines.push(`Other nearby directions: ${comparisonSet.slice(1).map((r) => `${r.bearing.manufacturer_name} ${r.bearing.part_number} (${r.bearing.bore_mm}×${r.bearing.od_mm}×${r.bearing.width_mm} mm, L10 ${formatLifeHours(r.l10_hours)})`).join('; ')}.`)
  }

  lines.push(`${explainSelectionConstraint(calcResults)} ${chooseNextSelectionQuestion(calcResults)}`)
  return lines.join(' ')
}

function formatLifeHours(hours: number): string {
  if (!Number.isFinite(hours)) return '∞'
  return `${Math.round(hours).toLocaleString()} h`
}

function buildNoCandidateSelectionReply(
  calcResults: Awaited<ReturnType<typeof selectBearings>>
): string {
  const input = calcResults.input
  const facts: string[] = []
  if (input.shaftDiameter_mm != null) facts.push(`${trimTrailingZeros(input.shaftDiameter_mm)} mm shaft / bore`)
  if (input.outerDiameter_mm != null || input.width_mm != null) {
    const envelopeParts = [
      input.outerDiameter_mm != null ? `${trimTrailingZeros(input.outerDiameter_mm)} mm OD` : null,
      input.width_mm != null ? `${trimTrailingZeros(input.width_mm)} mm width` : null,
    ].filter(Boolean)
    if (envelopeParts.length) facts.push(`envelope ${envelopeParts.join(' × ')}`)
  }
  if (input.radialLoad_kn != null) facts.push(`${trimTrailingZeros(input.radialLoad_kn)} kN radial load`)
  if (input.axialLoadSpecified) facts.push(`${trimTrailingZeros(input.axialLoad_kn)} kN axial load`)
  if (input.rpm != null) facts.push(`${Math.round(input.rpm).toLocaleString()} rpm`)
  if (input.lubrication) facts.push(`${input.lubrication} lubrication`)
  if (input.minLifeHours != null) facts.push(`${Math.round(input.minLifeHours).toLocaleString()} h life target`)

  const opening = facts.length
    ? `This is still provisional only — not purchase-ready yet — because I can’t validate a catalog match from the current deterministic screen for ${joinNaturalLanguageList(facts)}.`
    : 'This is still provisional only — not purchase-ready yet — because I can’t validate a catalog match from the current deterministic screen.'

  return `${opening} ${explainSelectionConstraint(calcResults)} ${chooseNextSelectionQuestion(calcResults)}`
}

function chooseNextSelectionQuestion(
  calcResults: Awaited<ReturnType<typeof selectBearings>>
): string {
  const input = calcResults.input
  const top = calcResults.candidates[0]

  if (input.minLifeHours == null) {
    return 'What life target do you actually need here — for example 5,000 h, 20,000 h, or continuous-duty service?'
  }

  if (input.outerDiameter_mm == null || input.width_mm == null) {
    if (top?.bearing?.od_mm != null && top?.bearing?.width_mm != null) {
      return `Can you accept about **${top.bearing.od_mm} mm OD × ${top.bearing.width_mm} mm width**, or do I need to stay inside a tighter housing envelope?`
    }
    return 'What OD/width envelope or housing pocket size do I need to stay inside?'
  }

  if (!input.axialLoadSpecified) {
    return 'Is there any meaningful axial / thrust load here, or is this almost entirely radial?'
  }

  return 'Do you want me to relax the life target, open the envelope, or consider a different bearing family?'
}

function explainSelectionConstraint(
  calcResults: Awaited<ReturnType<typeof selectBearings>>
): string {
  const input = calcResults.input
  const top = calcResults.candidates[0]

  if (input.minLifeHours == null) {
    return 'The biggest missing constraint now is required life.'
  }

  if (top && top.l10_hours < input.minLifeHours) {
    return `Right now the main gap is life: the closest candidate only projects about ${formatLifeHours(top.l10_hours)} against the target ${formatLifeHours(input.minLifeHours)}.`
  }

  if (input.outerDiameter_mm == null || input.width_mm == null) {
    return 'The next missing constraint is housing envelope.'
  }

  if (!input.axialLoadSpecified) {
    return 'The next ambiguity is whether any axial / thrust load needs to be designed in.'
  }

  return 'The remaining gap is the limiting application constraint.'
}

function buildFallbackReply(
  message: string,
  search: Awaited<ReturnType<typeof searchPartsByQuery>>,
  calcContext: string = ''
): string {
  if (isLikelyConversationalMessage(message) || search.parsed.intent === 'chat') {
    return "Hey — I can help with bearing shopping, cross-references, specs, supplier options, and application selection. Send a part number or describe the job and I’ll narrow it down with you."
  }

  if (calcContext) {
    return `Here are the engineering calculation results for your application:\n\n${calcContext}\n\n_Results calculated using ISO 281 standard._`
  }

  const top = search.results.slice(0, 5)

  if (top.length === 0) {
    return `I couldn't find an exact match for "${message}". Try a standard part number like 6204-2RS, or share bore/OD/width plus RPM and environment.`
  }

  const lines: string[] = [`Here's what I found for "${message}":\n`]

  top.forEach((row, i) => {
    const mfr = row.part.manufacturer_name ?? row.part.manufacturer_slug
    const pn = row.part.part_number
    const best = row.listings.find((l) => l.price_usd != null)
    const specs = row.specs

    lines.push(`**${i + 1}. ${mfr} ${pn}**`)

    if (specs) {
      const specParts: string[] = []
      if (specs.bore_mm) specParts.push(`Bore: ${specs.bore_mm}mm`)
      if (specs.od_mm) specParts.push(`OD: ${specs.od_mm}mm`)
      if (specs.width_mm) specParts.push(`Width: ${specs.width_mm}mm`)
      if (specs.seal_type && specs.seal_type !== 'open') specParts.push(`Seal: ${specs.seal_type.toUpperCase()}`)
      if (specs.speed_grease_rpm) specParts.push(`Speed: ${specs.speed_grease_rpm.toLocaleString()} RPM`)
      if (specs.dynamic_load_kn) specParts.push(`Load: ${specs.dynamic_load_kn} kN`)
      if (specParts.length) lines.push(specParts.join(' · '))
    }

    if (best) {
      const est = best.price_source === 'estimated' ? '~' : ''
      lines.push(`${est}$${Number(best.price_usd).toFixed(2)} at ${best.supplier_name}`)
    }

    lines.push('')
  })

  lines.push('If you share shaft size, speed, and environment, I can narrow this down further.')

  return lines.join('\n')
}

function buildGuidedClarificationReply(
  message: string,
  search: Awaited<ReturnType<typeof searchPartsByQuery>>
): string | undefined {
  if (search.parsed.intent !== 'spec_search') return undefined

  const known = countKnownSpecConstraints(search.parsed)
  const hasResults = search.total > 0

  if (known >= 3 && hasResults) return undefined

  const question = primaryClarificationQuestion(search.parsed)
  const provisional = search.results.slice(0, 3)
  const provisionalLine = provisional.length
    ? `\n\nI can give provisional options now, but they may be wrong for your duty cycle. Current top picks: ${provisional
        .map((r) => `${r.part.manufacturer_slug?.toUpperCase()} ${r.part.part_number}`)
        .join(', ')}.`
    : ''

  return [
    `I can help with "${message}", but one detail will change the recommendation a lot:`,
    '',
    question,
    '',
    'If it helps, you can reply in a format like:',
    '`25mm bore, deep groove, 1800 rpm, dusty conveyor, 2 kN radial load`',
    provisionalLine,
  ].join('\n')
}

function primaryClarificationQuestion(
  parsed: Awaited<ReturnType<typeof searchPartsByQuery>>['parsed']
): string {
  if (!parsed.bore_mm && !parsed.od_mm && !parsed.width_mm) {
    return 'What shaft or bore size are you working with in mm?'
  }

  if (!parsed.load_kn) {
    return 'What load should I design around — roughly in kN, or what machine/application is this on?'
  }

  if (!parsed.speed_rpm) {
    return 'What RPM is it running at?'
  }

  if (!parsed.environment) {
    return 'What environment is it in: clean, dusty, wet/washdown, high-temp, or chemical?'
  }

  if (!parsed.bearing_type) {
    return 'Do you want a deep-groove ball bearing, tapered roller, needle, or another bearing type?'
  }

  return 'What is the most important constraint here: size envelope, load, speed, seal/environment, or bearing type?'
}

function countKnownSpecConstraints(parsed: Awaited<ReturnType<typeof searchPartsByQuery>>['parsed']): number {
  let count = 0
  if (parsed.bore_mm || parsed.od_mm || parsed.width_mm) count++
  if (parsed.bearing_type) count++
  if (parsed.seal_type) count++
  if (parsed.speed_rpm) count++
  if (parsed.load_kn) count++
  if (parsed.environment) count++
  if (parsed.manufacturer) count++
  return count
}

function heuristicApplicationFollowupRewrite(message: string, history: ChatTurn[]): string | undefined {
  const msg = message.trim()
  if (!msg) return undefined

  const looksApplicationFragment = /(rpm|load|k\s*n|life|hours|shaft|bore|axial|thrust|od|outer diameter|width|housing|envelope|sealed|2rs|zz|dusty|wet|washdown|hot|temperature)/i.test(msg)
    || /^\d[\d,.]*\s*rpm\.?$/i.test(msg)
    || /^\d[\d,.]*\s*(?:k\s*n|kn)/i.test(msg)
    || /^no meaningful axial load\.?$/i.test(msg)
  if (!looksApplicationFragment) return undefined

  const priorUserTurns = history
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content.trim())
    .filter(Boolean)
    .slice(-4)
  if (!priorUserTurns.length) return undefined

  const priorContext = priorUserTurns.join('. ')
  const combined = `${priorContext}. ${msg}`.trim()
  return combined.length > msg.length ? combined : undefined
}

function heuristicFollowupRewrite(message: string, history: ChatTurn[]): string | undefined {
  const msg = message.trim()
  const isFollowup = /(that one|this one|equivalent|same size|same specs|what about|prefer|options only|only)/i.test(msg)
  if (!isFollowup) return undefined

  const mfrMatch = msg.match(/\b(SKF|NSK|FAG|TIMKEN|NTN|KOYO|INA|RBC)\b/i)
  const targetMfr = mfrMatch?.[1]?.toUpperCase()

  const priorUserQuery = [...history]
    .reverse()
    .find((turn) => turn.role === 'user' && turn.content.trim().length > 0)?.content

  if (targetMfr && /prefer|only|options/i.test(msg) && priorUserQuery) {
    return `${priorUserQuery}. Prefer ${targetMfr} options only.`
  }

  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i]?.content ?? ''
    const pn = content.match(/\b([A-Z]{0,3}\d{3,8}(?:[-/][A-Z0-9]{1,8})?)\b/i)?.[1]
    if (!pn) continue

    if (targetMfr) return `${targetMfr} equivalent for ${pn}`
    return `${msg} for ${pn}`
  }

  if (priorUserQuery) return `${priorUserQuery}. ${msg}`

  return undefined
}

function isLikelyConversationalMessage(message: string): boolean {
  const m = message.trim().toLowerCase()
  if (!m) return false

  if (/^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great)[!. ]*$/i.test(m)) return true
  if (/\b(what can you do|how are you|help|capabilities)\b/i.test(m)) return true

  return false
}

function sanitizeHistory(history: ChatTurn[]): ChatTurn[] {
  if (!Array.isArray(history)) return []

  return history
    .filter((turn): turn is ChatTurn => Boolean(turn && (turn.role === 'user' || turn.role === 'assistant')))
    .map((turn) => ({
      role: turn.role,
      content: String(turn.content ?? '').trim().slice(0, 1200),
    }))
    .filter((turn) => turn.content.length > 0)
    .slice(-12)
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
    // continue to brace extraction
  }

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  }

  throw new Error(`Unable to parse JSON object from model output: ${raw.slice(0, 240)}`)
}

function normalizeThinking(value: string): 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  const v = String(value || '').toLowerCase()
  if (v === 'off' || v === 'minimal' || v === 'low' || v === 'medium' || v === 'high' || v === 'xhigh') {
    return v
  }
  return 'low'
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const out = value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 6)

  return out.length ? out : undefined
}

function normalizeLube(value: unknown): 'grease' | 'oil' | undefined {
  const v = asString(value)?.toLowerCase()
  if (v === 'grease' || v === 'oil') return v
  return undefined
}


export interface McpCatalogItemSummary {
  manufacturer: string
  manufacturerSlug: string | null
  partNumber: string
  partKind: string
  productUrl: string | null
  matchReason: string
  confidence: number
  bearingType: string | null
  sealType: string | null
  boreMm: number | null
  odMm: number | null
  widthMm: number | null
  bestPriceUsd: number | null
  bestSupplier: string | null
  bestAffiliateUrl: string | null
}

export interface McpBuyRecommendationChoice {
  manufacturer: string
  partNumber: string
  priceUsd: number | null
  supplierName: string | null
  reason: string
  productUrl: string | null
}

export type McpUiTone = 'neutral' | 'good' | 'caution' | 'danger'

export interface McpUiField {
  label: string
  value: string
  tone?: McpUiTone
}

export interface McpUiAction {
  label: string
  url: string
}

export interface McpUiSection {
  title: string
  fields: McpUiField[]
}

export interface McpUiItem {
  title: string
  subtitle?: string
  tone?: McpUiTone
  fields: McpUiField[]
}

export interface McpUiPayload {
  widget: 'recommendation_card' | 'fitment_verdict' | 'quote_comparison' | 'evidence_identification'
  title: string
  subtitle?: string
  summary?: string
  tone?: McpUiTone
  primaryAction?: McpUiAction
  secondaryActions?: McpUiAction[]
  fields?: McpUiField[]
  sections?: McpUiSection[]
  items?: McpUiItem[]
}

export interface McpRecommendBuyOptionOutput {
  query: string
  parsedIntent: string
  total: number
  reply: string
  shoppingIntent: 'value' | 'premium' | 'oem' | 'fastest' | 'general'
  recommended: McpBuyRecommendationChoice | null
  cheapestAcceptable: McpBuyRecommendationChoice | null
  premiumOption: McpBuyRecommendationChoice | null
  alternatives: McpBuyRecommendationChoice[]
  warnings: string[]
  question?: string
  candidateItems: McpCatalogItemSummary[]
  ui: McpUiPayload
}

export interface McpFitmentSanityCheckOutput {
  query: string
  reply: string
  verdict: 'exact_match' | 'direct_fit_likely' | 'conditional_fit' | 'not_validated' | 'needs_confirmation'
  warnings: string[]
  leftLabel: string
  rightLabel: string
  leftCatalogLabel: string
  rightCatalogLabel: string
  ui: McpUiPayload
}

export interface McpQuoteComparisonLineItem {
  sourceLine: string
  quotedManufacturer: string | null
  quotedPartNumber: string
  quotedPriceUsd: number | null
  matchedManufacturer: string | null
  matchedPartNumber: string | null
  matchedSupplier: string | null
  matchedPriceUsd: number | null
  cheapestAcceptable: McpBuyRecommendationChoice | null
  premiumOption: McpBuyRecommendationChoice | null
  warnings: string[]
}

export interface McpCompareQuoteOrBomOutput {
  message: string
  sourceText: string
  reply: string
  itemCount: number
  items: McpQuoteComparisonLineItem[]
  warnings: string[]
  question?: string
  ui: McpUiPayload
}

export interface McpIdentifyFromEvidenceOutput {
  message: string
  evidenceSummary: string
  rewrittenQuery: string
  confidence: number
  reply: string
  identified: McpCatalogItemSummary | null
  cheapestAcceptable: McpBuyRecommendationChoice | null
  premiumOption: McpBuyRecommendationChoice | null
  warnings: string[]
  ui: McpUiPayload
}

export async function recommendBuyOptionForMcp(message: string): Promise<McpRecommendBuyOptionOutput | null> {
  const query = message.trim()
  const search = await searchPartsByQuery(query, 8)
  const recommendation = recommendBuyOptionFromSearch(query, search)
  if (!recommendation) return null

  const recommended = mapMcpRecommendationChoice(recommendation.recommended, search.results)
  const cheapestAcceptable = mapMcpRecommendationChoice(recommendation.cheapestAcceptable, search.results)
  const premiumOption = mapMcpRecommendationChoice(recommendation.premiumOption, search.results)
  const candidateItems = search.results.slice(0, 6).map(mapMcpCatalogItemSummary)

  return {
    query,
    parsedIntent: search.parsed.intent,
    total: search.total,
    reply: buildBuyRecommendationReply(recommendation),
    shoppingIntent: recommendation.shoppingIntent,
    recommended,
    cheapestAcceptable,
    premiumOption,
    alternatives: recommendation.alternatives.map((choice) => mapMcpRecommendationChoice(choice, search.results)).filter((choice): choice is McpBuyRecommendationChoice => Boolean(choice)),
    warnings: recommendation.warnings,
    question: recommendation.question,
    candidateItems,
    ui: buildRecommendBuyOptionUi({
      query,
      shoppingIntent: recommendation.shoppingIntent,
      recommended,
      cheapestAcceptable,
      premiumOption,
      warnings: recommendation.warnings,
      candidateItems,
      total: search.total,
    }),
  }
}

export async function fitmentSanityCheckForMcp(message: string): Promise<McpFitmentSanityCheckOutput | null> {
  const result = await runFitmentSanityCheckTool(message)
  if (!result) return null

  return {
    query: message.trim(),
    reply: result.reply,
    verdict: result.verdict,
    warnings: result.warnings,
    leftLabel: result.leftLabel,
    rightLabel: result.rightLabel,
    leftCatalogLabel: result.leftCatalogLabel,
    rightCatalogLabel: result.rightCatalogLabel,
    ui: buildFitmentSanityUi({
      verdict: result.verdict,
      leftLabel: result.leftLabel,
      rightLabel: result.rightLabel,
      leftCatalogLabel: result.leftCatalogLabel,
      rightCatalogLabel: result.rightCatalogLabel,
      warnings: result.warnings,
      reply: result.reply,
    }),
  }
}

export async function compareQuoteOrBomForMcp(params: {
  sourceText: string
  message?: string
}): Promise<McpCompareQuoteOrBomOutput | null> {
  const sourceText = params.sourceText.trim()
  if (!sourceText) return null

  const message = params.message?.trim() || 'Compare this quote or BOM.'
  const combinedMessage = [message, sourceText].filter(Boolean).join('\n\n')
  const result = await runQuoteOrBomComparisonTool(combinedMessage, [])
  if (!result) return null

  const items = result.items.map((item) => ({
    sourceLine: item.sourceLine,
    quotedManufacturer: item.quotedManufacturer,
    quotedPartNumber: item.quotedPartNumber,
    quotedPriceUsd: item.quotedPriceUsd,
    matchedManufacturer: item.matchedManufacturer,
    matchedPartNumber: item.matchedPartNumber,
    matchedSupplier: item.matchedSupplier,
    matchedPriceUsd: item.matchedPriceUsd,
    cheapestAcceptable: mapMcpRecommendationChoiceLoose(item.cheapestAcceptable),
    premiumOption: mapMcpRecommendationChoiceLoose(item.premiumOption),
    warnings: item.warnings,
  }))

  return {
    message,
    sourceText,
    reply: buildQuoteComparisonReply(result),
    itemCount: result.items.length,
    items,
    warnings: result.warnings,
    question: result.question,
    ui: buildQuoteComparisonUi({
      itemCount: result.items.length,
      items,
      warnings: result.warnings,
      question: result.question,
    }),
  }
}

export async function identifyFromEvidenceForMcp(params: {
  message?: string
  evidenceSummary: string
  rewrittenQuery: string
  confidence?: number
}): Promise<McpIdentifyFromEvidenceOutput | null> {
  const message = params.message?.trim() || 'What bearing is this?'
  const evidenceSummary = params.evidenceSummary.trim()
  const rewrittenQuery = params.rewrittenQuery.trim()
  if (!evidenceSummary || !rewrittenQuery) return null

  const confidence = Math.max(0, Math.min(params.confidence ?? 0.9, 1))
  const search = await searchPartsByQuery(rewrittenQuery, 8)
  const evidence = {
    summary: evidenceSummary,
    rewrittenQuery,
    confidence,
  }
  const identification = runIdentifyFromEvidenceTool({
    message,
    evidence,
    search,
  })
  if (!identification) return null

  const top = search.results[0] ?? null
  const exactish = top ? top.match_reason === 'exact' || top.match_reason === 'exact_part_number' : false
  const recommendation = recommendBuyOptionFromSearch(message, search)
  const warnings: string[] = []
  if (!exactish) warnings.push('catalog match is the closest current fit, not a verified exact marking read')
  if (confidence < 0.93) warnings.push('photo/file confidence is moderate, not definitive')

  const identified = top ? mapMcpCatalogItemSummary(top) : null
  const cheapestAcceptable = mapMcpRecommendationChoice(recommendation?.cheapestAcceptable, search.results)
  const premiumOption = mapMcpRecommendationChoice(recommendation?.premiumOption, search.results)

  return {
    message,
    evidenceSummary,
    rewrittenQuery,
    confidence,
    reply: identification.reply,
    identified,
    cheapestAcceptable,
    premiumOption,
    warnings,
    ui: buildEvidenceIdentificationUi({
      rewrittenQuery,
      confidence,
      identified,
      cheapestAcceptable,
      premiumOption,
      warnings,
      reply: identification.reply,
    }),
  }
}


function buildRecommendBuyOptionUi(output: {
  query: string
  shoppingIntent: McpRecommendBuyOptionOutput['shoppingIntent']
  recommended: McpBuyRecommendationChoice | null
  cheapestAcceptable: McpBuyRecommendationChoice | null
  premiumOption: McpBuyRecommendationChoice | null
  warnings: string[]
  candidateItems: McpCatalogItemSummary[]
  total: number
}): McpUiPayload {
  const primary = output.recommended ?? output.cheapestAcceptable ?? output.premiumOption
  const fields: McpUiField[] = [
    { label: 'Selection mode', value: humanizeSelectionMode(output.shoppingIntent) },
    { label: 'Reviewed', value: `${output.total} catalog matches considered` },
  ]
  if (output.warnings[0]) fields.push({ label: 'Caution', value: output.warnings[0], tone: 'caution' })

  const sections: McpUiSection[] = [
    buildChoiceSection('Recommended match', output.recommended),
    buildChoiceSection('Lower-cost fallback', output.cheapestAcceptable),
    buildChoiceSection('Higher-confidence fallback', output.premiumOption),
  ].filter((section): section is McpUiSection => Boolean(section))

  const secondaryActions = [
    output.cheapestAcceptable ? { label: 'Open lower-cost fallback', choice: output.cheapestAcceptable } : null,
    output.premiumOption ? { label: 'Open higher-confidence fallback', choice: output.premiumOption } : null,
  ]
    .filter((entry): entry is { label: string; choice: McpBuyRecommendationChoice } => Boolean(entry?.choice?.productUrl))
    .filter((entry, index, arr) => entry.choice.productUrl !== primary?.productUrl && arr.findIndex((other) => other.choice.productUrl === entry.choice.productUrl) === index)
    .map((entry) => ({ label: entry.label, url: entry.choice.productUrl! }))

  return {
    widget: 'recommendation_card',
    title: primary ? `${primary.manufacturer} ${primary.partNumber}` : 'Bearing selection guidance',
    subtitle: primary ? 'Application and sourcing guidance' : 'Selection guidance',
    summary: primary ? `${humanizeSelectionModeSummary(output.shoppingIntent)} guidance from current catalog evidence.` : 'Deterministic selection guidance from current catalog evidence.',
    tone: output.warnings.length ? 'caution' : 'good',
    primaryAction: primary?.productUrl ? { label: 'Open part page', url: primary.productUrl } : undefined,
    secondaryActions: secondaryActions.length ? secondaryActions.slice(0, 2) : undefined,
    fields,
    sections: sections.length ? sections : undefined,
  }
}

function buildFitmentSanityUi(output: {
  verdict: McpFitmentSanityCheckOutput['verdict']
  leftLabel: string
  rightLabel: string
  leftCatalogLabel: string
  rightCatalogLabel: string
  warnings: string[]
  reply: string
}): McpUiPayload {
  const verdictLabel = humanizeFitmentVerdict(output.verdict)
  return {
    widget: 'fitment_verdict',
    title: `${output.leftLabel} vs ${output.rightLabel}`,
    subtitle: verdictLabel,
    summary: output.reply,
    tone: toneForFitmentVerdict(output.verdict),
    fields: [
      { label: 'Verdict', value: verdictLabel, tone: toneForFitmentVerdict(output.verdict) },
      { label: 'Candidate A', value: output.leftCatalogLabel || output.leftLabel },
      { label: 'Candidate B', value: output.rightCatalogLabel || output.rightLabel },
    ],
    sections: output.warnings.length ? [{
      title: 'Why',
      fields: output.warnings.slice(0, 4).map((warning) => ({ label: 'Reason', value: warning, tone: output.verdict === 'not_validated' ? 'danger' : 'caution' })),
    }] : undefined,
  }
}

function buildQuoteComparisonUi(output: {
  itemCount: number
  items: McpQuoteComparisonLineItem[]
  warnings: string[]
  question?: string
}): McpUiPayload {
  const fields: McpUiField[] = [
    { label: 'Line items', value: String(output.itemCount) },
  ]
  if (output.warnings[0]) fields.push({ label: 'Caution', value: output.warnings[0], tone: 'caution' })
  if (output.question) fields.push({ label: 'Next question', value: output.question })

  return {
    widget: 'quote_comparison',
    title: 'Quote / BOM comparison',
    subtitle: `${output.itemCount} line item${output.itemCount === 1 ? '' : 's'} analyzed`,
    summary: 'Compare quoted pricing against current catalog baselines and safer alternatives.',
    tone: output.warnings.length ? 'caution' : 'good',
    fields,
    items: output.items.slice(0, 6).map((item) => ({
      title: compactPartLabel(item.quotedManufacturer, item.quotedPartNumber),
      subtitle: item.quotedPriceUsd != null ? `Quoted ${formatPriceCompact(item.quotedPriceUsd)}` : 'Quoted price not provided',
      tone: item.warnings.length ? 'caution' : 'good',
      fields: [
        { label: 'Baseline', value: compactPartLabel(item.matchedManufacturer, item.matchedPartNumber, item.matchedPriceUsd, item.matchedSupplier) },
        { label: 'Cheaper option', value: compactChoiceValue(item.cheapestAcceptable) },
        { label: 'Premium option', value: compactChoiceValue(item.premiumOption) },
        ...(item.warnings[0] ? [{ label: 'Note', value: item.warnings[0], tone: 'caution' as const }] : []),
      ],
    })),
  }
}

function buildEvidenceIdentificationUi(output: {
  rewrittenQuery: string
  confidence: number
  identified: McpCatalogItemSummary | null
  cheapestAcceptable: McpBuyRecommendationChoice | null
  premiumOption: McpBuyRecommendationChoice | null
  warnings: string[]
  reply: string
}): McpUiPayload {
  const primary = output.identified
  const secondaryActions = [
    output.cheapestAcceptable ? { label: 'Open cheaper option', choice: output.cheapestAcceptable } : null,
    output.premiumOption ? { label: 'Open premium option', choice: output.premiumOption } : null,
  ]
    .filter((entry): entry is { label: string; choice: McpBuyRecommendationChoice } => Boolean(entry?.choice?.productUrl))
    .filter((entry, index, arr) => entry.choice.productUrl !== primary?.productUrl && arr.findIndex((other) => other.choice.productUrl === entry.choice.productUrl) === index)
    .map((entry) => ({ label: entry.label, url: entry.choice.productUrl! }))

  const identifiedFields: McpUiField[] = [
    { label: 'Confidence', value: `${Math.round(output.confidence * 100)}%`, tone: output.confidence >= 0.93 ? 'good' : 'caution' },
    { label: 'Catalog query', value: output.rewrittenQuery },
  ]
  if (primary?.bearingType) identifiedFields.push({ label: 'Type', value: primary.bearingType })
  if (primary?.sealType) identifiedFields.push({ label: 'Seal', value: primary.sealType.toUpperCase() })
  const dims = compactDimensions(primary)
  if (dims) identifiedFields.push({ label: 'Envelope', value: dims })
  if (output.warnings[0]) identifiedFields.push({ label: 'Caution', value: output.warnings[0], tone: 'caution' })

  const sections: McpUiSection[] = [
    {
      title: 'Buy options',
      fields: [
        { label: 'Cheaper option', value: compactChoiceValue(output.cheapestAcceptable) },
        { label: 'Premium option', value: compactChoiceValue(output.premiumOption) },
      ],
    },
  ]

  return {
    widget: 'evidence_identification',
    title: primary ? `${primary.manufacturer} ${primary.partNumber}` : 'Evidence identification',
    subtitle: primary ? 'Likely match from evidence' : 'No confident catalog match',
    summary: output.reply,
    tone: output.warnings.length ? 'caution' : 'good',
    primaryAction: primary?.productUrl ? { label: 'Open identified part', url: primary.productUrl } : undefined,
    secondaryActions: secondaryActions.length ? secondaryActions.slice(0, 2) : undefined,
    fields: identifiedFields,
    sections,
  }
}

function buildChoiceSection(title: string, choice: McpBuyRecommendationChoice | null): McpUiSection | null {
  if (!choice) return null
  return {
    title,
    fields: [
      { label: 'Part', value: `${choice.manufacturer} ${choice.partNumber}` },
      { label: 'Why', value: choice.reason },
      { label: 'Sourcing', value: choice.productUrl ? 'Part page and supplier path available.' : 'Catalog evidence available.' },
    ],
  }
}

function compactChoiceValue(choice: McpBuyRecommendationChoice | null): string {
  if (!choice) return '—'
  return compactPartLabel(choice.manufacturer, choice.partNumber, choice.priceUsd, choice.supplierName)
}

function compactPartLabel(
  manufacturer: string | null | undefined,
  partNumber: string | null | undefined,
  priceUsd?: number | null,
  supplierName?: string | null
): string {
  const base = [manufacturer, partNumber].filter(Boolean).join(' ')
  const tail = [
    priceUsd != null ? formatPriceCompact(priceUsd) : null,
    supplierName ? `via ${supplierName}` : null,
  ].filter(Boolean).join(' · ')
  return [base || 'Unknown part', tail].filter(Boolean).join(' · ')
}

function compactDimensions(item: McpCatalogItemSummary | null): string | null {
  if (!item) return null
  if (item.boreMm == null || item.odMm == null || item.widthMm == null) return null
  return `${trimMcpNumber(item.boreMm)}×${trimMcpNumber(item.odMm)}×${trimMcpNumber(item.widthMm)} mm`
}

function formatPriceCompact(priceUsd: number | null | undefined): string {
  if (priceUsd == null || !Number.isFinite(priceUsd)) return '—'
  return `$${priceUsd.toFixed(2)}`
}

function trimMcpNumber(value: number): string {
  const rounded = Number(value)
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded.toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function humanizeSelectionMode(intent: McpRecommendBuyOptionOutput['shoppingIntent']): string {
  switch (intent) {
    case 'value': return 'Cost-aware'
    case 'premium': return 'Higher-confidence'
    case 'oem': return 'OEM-safe'
    case 'fastest': return 'Fast-availability'
    default: return 'Balanced'
  }
}

function humanizeSelectionModeSummary(intent: McpRecommendBuyOptionOutput['shoppingIntent']): string {
  switch (intent) {
    case 'value': return 'Cost-aware selection'
    case 'premium': return 'Higher-confidence selection'
    case 'oem': return 'OEM-safe selection'
    case 'fastest': return 'Fast-availability selection'
    default: return 'Balanced selection'
  }
}

function humanizeShoppingIntent(intent: McpRecommendBuyOptionOutput['shoppingIntent']): string {
  switch (intent) {
    case 'value': return 'Best value'
    case 'premium': return 'Premium'
    case 'oem': return 'OEM-safe'
    case 'fastest': return 'Fastest fulfillment'
    default: return 'General'
  }
}

function humanizeShoppingIntentSummary(intent: McpRecommendBuyOptionOutput['shoppingIntent']): string {
  switch (intent) {
    case 'value': return 'Best-value'
    case 'premium': return 'Premium'
    case 'oem': return 'OEM-safe'
    case 'fastest': return 'Fast-fulfillment'
    default: return 'General'
  }
}

function humanizeFitmentVerdict(verdict: McpFitmentSanityCheckOutput['verdict']): string {
  switch (verdict) {
    case 'exact_match': return 'Exact match'
    case 'direct_fit_likely': return 'Direct fit likely'
    case 'conditional_fit': return 'Conditional fit'
    case 'not_validated': return 'Not validated'
    case 'needs_confirmation': return 'Needs confirmation'
  }
}

function toneForFitmentVerdict(verdict: McpFitmentSanityCheckOutput['verdict']): McpUiTone {
  switch (verdict) {
    case 'exact_match': return 'good'
    case 'direct_fit_likely': return 'good'
    case 'conditional_fit': return 'caution'
    case 'needs_confirmation': return 'caution'
    case 'not_validated': return 'danger'
  }
}

function mapMcpRecommendationChoice(
  choice: BuyRecommendationChoice | null | undefined,
  results: Awaited<ReturnType<typeof searchPartsByQuery>>['results']
): McpBuyRecommendationChoice | null {
  if (!choice) return null
  const matched = results.find((row) => (
    `${row.part.manufacturer_name ?? row.part.manufacturer_slug} ${row.part.part_number}`.toLowerCase()
      === `${choice.manufacturer} ${choice.partNumber}`.toLowerCase()
  ))
  return {
    manufacturer: choice.manufacturer,
    partNumber: choice.partNumber,
    priceUsd: choice.priceUsd,
    supplierName: choice.supplierName,
    reason: choice.reason,
    productUrl: matched ? bearingBrainProductUrl(matched.part.manufacturer_slug, matched.part.part_number) : null,
  }
}

function mapMcpRecommendationChoiceLoose(
  choice: BuyRecommendationChoice | null | undefined
): McpBuyRecommendationChoice | null {
  if (!choice) return null
  return {
    manufacturer: choice.manufacturer,
    partNumber: choice.partNumber,
    priceUsd: choice.priceUsd,
    supplierName: choice.supplierName,
    reason: choice.reason,
    productUrl: null,
  }
}

function mapMcpCatalogItemSummary(
  row: Awaited<ReturnType<typeof searchPartsByQuery>>['results'][number]
): McpCatalogItemSummary {
  const best = bestListingForResult(row)
  return {
    manufacturer: row.part.manufacturer_name ?? row.part.manufacturer_slug ?? 'Unknown',
    manufacturerSlug: row.part.manufacturer_slug ?? null,
    partNumber: row.part.part_number,
    partKind: row.part.part_kind ?? 'bearing',
    productUrl: bearingBrainProductUrl(row.part.manufacturer_slug, row.part.part_number),
    matchReason: row.match_reason,
    confidence: Number(row.confidence ?? 0),
    bearingType: row.specs?.bearing_type ?? null,
    sealType: row.specs?.seal_type ?? null,
    boreMm: toNullableMcpNumber(row.specs?.bore_mm),
    odMm: toNullableMcpNumber(row.specs?.od_mm),
    widthMm: toNullableMcpNumber(row.specs?.width_mm),
    bestPriceUsd: toNullableMcpNumber(best?.price_usd),
    bestSupplier: best?.supplier_name ?? null,
    bestAffiliateUrl: best?.affiliate_url ?? best?.supplier_url ?? null,
  }
}

function bearingBrainProductUrl(manufacturerSlug: string | undefined, partNumber: string): string | null {
  if (!manufacturerSlug) return null
  return `https://bearingbrain.com/bearing/${encodeURIComponent(manufacturerSlug)}/${encodeURIComponent(partNumber)}`
}

function toNullableMcpNumber(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
