import {
  addItemToActiveCart,
  getActiveCartSummary,
  removeCartItem,
  updateCartItem,
  type CartItemRecord,
  type CartSummary,
} from './cart'
import { listRecentSourcingRequests } from './sourcing-requests'
import { searchPartsByQuery } from './search-tools'

interface CartAgentContext {
  sessionId?: string
  userId?: number | null
  threadId?: string | null
}

interface CartAgentResult {
  reply: string
  results?: Awaited<ReturnType<typeof searchPartsByQuery>>['results']
  total?: number
  parsed?: Awaited<ReturnType<typeof searchPartsByQuery>>['parsed']
}

export async function maybeHandleCartAgentAction(params: {
  message: string
  context?: CartAgentContext
}): Promise<CartAgentResult | null> {
  const message = params.message.trim()
  const sessionId = params.context?.sessionId?.trim()
  if (!message || !sessionId) return null

  const lower = message.toLowerCase()
  const threadId = params.context?.threadId ?? null
  const userId = params.context?.userId ?? null

  if (isAddCartIntent(lower)) {
    const extracted = extractCatalogReference(message)
    const searchQuery = [extracted.manufacturer, extracted.partNumber].filter(Boolean).join(' ') || message
    const search = await searchPartsByQuery(searchQuery, 8)
    const match = pickAddMatch(search, extracted)
    if (!match) {
      return {
        reply: search.results.length
          ? 'I found a few possible parts, but not a single exact add-to-cart match yet. Send the exact part number you want added.'
          : 'I could not find a catalog match to add yet. Send the exact part number and I’ll add it to the quote cart.',
        results: search.results.slice(0, 4),
        total: search.total,
        parsed: search.parsed,
      }
    }

    const quantity = extractAddQuantity(message, match.part.part_number)
    const selectedListing = pickPreferredListing(match.listings)
    const summary = await addItemToActiveCart({
      sessionId,
      userId,
      threadId,
      item: {
        threadId,
        source: 'chat_agent',
        partId: match.part.id > 0 ? match.part.id : null,
        listingId: selectedListing?.id ?? null,
        manufacturerName: match.part.manufacturer_name ?? null,
        manufacturerSlug: match.part.manufacturer_slug ?? null,
        partNumber: match.part.part_number,
        quantity,
        supplierName: selectedListing?.supplier_name ?? null,
        supplierSlug: selectedListing?.supplier_slug ?? null,
        unitPriceUsd: selectedListing?.price_usd != null ? Number(selectedListing.price_usd) : null,
        metadata: {
          via: 'chat-agent',
          fromMessage: message,
        },
      },
    })

    return {
      reply: [
        `Added ${labelCartItem(match.part.manufacturer_name ?? match.part.manufacturer_slug ?? null, match.part.part_number)} ×${quantity} to your quote cart.`,
        summarizeCartTotals(summary),
      ].join(' '),
      parsed: search.parsed,
    }
  }

  if (isSetQuantityIntent(lower)) {
    const summary = await getActiveCartSummary({ sessionId, userId, threadId })
    const item = pickCartItemFromMessage(summary, message)
    const quantity = extractSetQuantity(message)

    if (!item || quantity == null) {
      return {
        reply: summary.items.length
          ? 'I can update quantity, but I need the exact part number and target quantity. Example: set 6205-2RS quantity to 4 in my cart.'
          : 'Your active quote cart is empty right now, so there is nothing to update yet.',
      }
    }

    const updated = await updateCartItem({ sessionId, userId, itemId: item.id, quantity })
    return {
      reply: [
        `Set ${labelCartItem(item.manufacturerName ?? item.manufacturerSlug ?? null, item.partNumber)} to quantity ${quantity}.`,
        summarizeCartTotals(updated),
      ].join(' '),
    }
  }

  if (isRemoveCartIntent(lower)) {
    const summary = await getActiveCartSummary({ sessionId, userId, threadId })
    const item = pickCartItemFromMessage(summary, message)
    if (!item) {
      return {
        reply: summary.items.length
          ? 'I can remove an item, but I need the exact part number from your cart. Example: remove 6205-2RS from my cart.'
          : 'Your active quote cart is already empty.',
      }
    }

    const updated = await removeCartItem({ sessionId, userId, itemId: item.id })
    return {
      reply: [
        `Removed ${labelCartItem(item.manufacturerName ?? item.manufacturerSlug ?? null, item.partNumber)} from your quote cart.`,
        summarizeCartTotals(updated),
      ].join(' '),
    }
  }

  if (isShowCartIntent(lower)) {
    const summary = await getActiveCartSummary({ sessionId, userId, threadId })
    const latestRequest = (await listRecentSourcingRequests({ sessionId, userId, limit: 1 }))[0] ?? null
    return { reply: buildCartSummaryReply(summary, latestRequest) }
  }

  return null
}

function isShowCartIntent(lower: string): boolean {
  return /\b(cart|quote cart|quote-cart)\b/.test(lower)
    && /\b(show|review|what(?:'s| is)?|current|view|see|summarize|summary|contents?|status|my)\b/.test(lower)
    && !/\b(add|put|include|place|remove|delete|drop|take out|set|change|update|make)\b/.test(lower)
}

function isAddCartIntent(lower: string): boolean {
  return /\b(add|put|include|place)\b/.test(lower) && /\b(cart|quote cart|quote-cart)\b/.test(lower)
}

function isRemoveCartIntent(lower: string): boolean {
  return /\b(remove|delete|drop|take out)\b/.test(lower) && /\b(cart|quote cart|quote-cart)\b/.test(lower)
}

function isSetQuantityIntent(lower: string): boolean {
  return /\b(quantity|qty)\b/.test(lower)
    && /\b(set|change|update|make)\b/.test(lower)
    && /\b(cart|quote cart|quote-cart)\b/.test(lower)
}

function extractCatalogReference(message: string): { partNumber: string | null; manufacturer: string | null } {
  const manufacturerMatch = message.match(/\b(skf|fag|nsk|ntn|timken|koyo|ina|nachi|oyo|snr)\b/i)
  const partPattern = /\b([A-Z]*\d[A-Z0-9]*?(?:-[A-Z0-9]+)+|[A-Z]*\d[A-Z0-9]{3,})\b/g
  const matches = Array.from(message.toUpperCase().matchAll(partPattern)).map((match) => match[1])
  const partNumber = matches
    .filter((value) => !['CART', 'QUOTE', 'QUOTECART'].includes(normalizePartNumber(value)))
    .sort((a, b) => b.length - a.length)[0] ?? null

  return {
    partNumber,
    manufacturer: manufacturerMatch ? manufacturerMatch[1] : null,
  }
}

function pickAddMatch(
  search: Awaited<ReturnType<typeof searchPartsByQuery>>,
  extracted?: { partNumber?: string | null; manufacturer?: string | null }
) {
  const targetPartNumber = normalizePartNumber(extracted?.partNumber ?? search.parsed.part_number ?? '')
  const targetManufacturer = (extracted?.manufacturer ?? search.parsed.manufacturer ?? '').trim().toLowerCase()
  if (!targetPartNumber) return null

  const exactMatches = search.results.filter((row) => normalizePartNumber(row.part.part_number) === targetPartNumber)
  if (!exactMatches.length) return null
  if (targetManufacturer) {
    const manufacturerMatch = exactMatches.find((row) => {
      const name = (row.part.manufacturer_name ?? '').trim().toLowerCase()
      const slug = (row.part.manufacturer_slug ?? '').trim().toLowerCase()
      return name === targetManufacturer || slug === targetManufacturer
    })
    if (manufacturerMatch) return manufacturerMatch
  }
  return exactMatches[0] ?? null
}

function pickPreferredListing<T extends { price_usd: number | null }>(listings: T[]): T | null {
  const priced = listings.filter((listing) => listing.price_usd != null)
  const pool = priced.length ? priced : listings
  return [...pool].sort((a, b) => Number(a.price_usd ?? 1e9) - Number(b.price_usd ?? 1e9))[0] ?? null
}

function pickCartItemFromMessage(summary: CartSummary, message: string): CartItemRecord | null {
  if (!summary.items.length) return null
  const normalizedMessage = normalizePartNumber(message)
  const direct = summary.items.find((item) => normalizedMessage.includes(normalizePartNumber(item.partNumber)))
  if (direct) return direct
  return summary.items.length === 1 ? summary.items[0] : null
}

function extractAddQuantity(message: string, partNumber: string): number {
  const explicit = matchNumber(message, [
    /\bqty\s*(?:of\s*)?(\d{1,4})\b/i,
    /\bquantity\s*(?:of\s*)?(\d{1,4})\b/i,
    /\b(?:x|×)\s*(\d{1,4})\b/i,
    new RegExp(`\\b(\\d{1,4})\\s*(?:x|×)?\\s*(?:of\\s+)?${escapeRegExp(partNumber)}\\b`, 'i'),
  ])
  return clampQuantity(explicit ?? 1)
}

function extractSetQuantity(message: string): number | null {
  const value = matchNumber(message, [
    /\b(?:set|change|update|make)\b[\s\S]{0,40}?\b(?:quantity|qty)?\b[\s\S]{0,20}?\bto\s+(\d{1,4})\b/i,
    /\b(?:quantity|qty)\b[\s\S]{0,12}?(\d{1,4})\b/i,
  ])
  return value == null ? null : clampQuantity(value)
}

function buildCartSummaryReply(
  summary: CartSummary,
  latestRequest: { requestRef: string; itemCount: number; estimatedSubtotalUsd: number | null } | null
): string {
  if (!summary.items.length) {
    let reply = 'Your active quote cart is empty.'
    if (latestRequest) {
      reply += ` Latest submitted request: ${latestRequest.requestRef} (${latestRequest.itemCount} item${latestRequest.itemCount === 1 ? '' : 's'}${latestRequest.estimatedSubtotalUsd != null ? `, ${formatUsd(latestRequest.estimatedSubtotalUsd)} estimated` : ''}).`
    }
    reply += ' Add a part with a message like “add SKF 6205-2RS to my quote cart.”'
    return reply
  }

  const lines = summary.items.slice(0, 5).map((item, index) => {
    const eachText = item.unitPriceUsd != null ? ` — ${formatUsd(item.unitPriceUsd)} each` : ''
    const supplierText = item.supplierName ? ` via ${item.supplierName}` : ''
    return `${index + 1}. ${labelCartItem(item.manufacturerName ?? item.manufacturerSlug ?? null, item.partNumber)} ×${item.quantity}${supplierText}${eachText}`
  })

  const trailer = [summarizeCartTotals(summary)]
  if (latestRequest) trailer.push(`Latest submitted request: ${latestRequest.requestRef}.`)

  return [
    `Your active quote cart currently contains ${summary.items.length} line item${summary.items.length === 1 ? '' : 's'}:`,
    ...lines,
    trailer.join(' '),
  ].join('\n')
}

function summarizeCartTotals(summary: CartSummary): string {
  return `Cart now has ${summary.items.length} line item${summary.items.length === 1 ? '' : 's'} / ${summary.itemCount} total unit${summary.itemCount === 1 ? '' : 's'}${summary.estimatedSubtotalUsd != null ? `, about ${formatUsd(summary.estimatedSubtotalUsd)}.` : '.'}`
}

function labelCartItem(manufacturer: string | null, partNumber: string): string {
  return [manufacturer?.trim(), partNumber.trim()].filter(Boolean).join(' ')
}

function normalizePartNumber(value: string): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function matchNumber(message: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (match?.[1]) {
      const value = Number(match[1])
      if (Number.isFinite(value)) return value
    }
  }
  return null
}

function clampQuantity(value: number): number {
  return Math.max(1, Math.min(9999, Math.floor(value)))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}
