import { z } from 'zod'
import { searchPartsByQuery } from '@/lib/search-tools'

const NullableString = z.string().nullable()
const NullableNumber = z.number().nullable()

export const SearchCatalogInputSchema = {
  query: z.string().min(1).max(300).describe('Natural-language bearing query or part number to search'),
  limit: z.number().int().min(1).max(10).optional().describe('Maximum number of items to return; defaults to 5'),
}

export const SearchCatalogOutputSchema = {
  query: z.string(),
  parsedIntent: z.string(),
  total: z.number().int(),
  returned: z.number().int(),
  summary: z.string(),
  items: z.array(
    z.object({
      id: z.number().int(),
      manufacturer: z.string(),
      manufacturerSlug: NullableString,
      partNumber: z.string(),
      partKind: z.string(),
      productUrl: NullableString,
      matchReason: z.string(),
      confidence: z.number(),
      bearingType: NullableString,
      sealType: NullableString,
      boreMm: NullableNumber,
      odMm: NullableNumber,
      widthMm: NullableNumber,
      bestPriceUsd: NullableNumber,
      bestSupplier: NullableString,
      bestAffiliateUrl: NullableString,
    })
  ),
}

export type SearchCatalogToolOutput = z.infer<z.ZodObject<typeof SearchCatalogOutputSchema>>

export async function runSearchCatalogTool(args: { query: string; limit?: number }): Promise<SearchCatalogToolOutput> {
  const query = args.query.trim()
  const limit = Math.max(1, Math.min(args.limit ?? 5, 10))
  const results = await searchPartsByQuery(query, limit)

  const items = results.results.slice(0, limit).map((row) => {
    const bestListing = row.listings.find((listing) => listing.price_usd != null) ?? row.listings[0] ?? null
    const manufacturer = row.part.manufacturer_name ?? row.part.manufacturer_slug ?? 'Unknown'
    const manufacturerSlug = row.part.manufacturer_slug ?? null
    const productUrl = manufacturerSlug
      ? `https://bearingbrain.com/bearing/${encodeURIComponent(manufacturerSlug)}/${encodeURIComponent(row.part.part_number)}`
      : null

    return {
      id: row.part.id,
      manufacturer,
      manufacturerSlug,
      partNumber: row.part.part_number,
      partKind: row.part.part_kind ?? 'bearing',
      productUrl,
      matchReason: row.match_reason,
      confidence: Number(row.confidence ?? 0),
      bearingType: row.specs?.bearing_type ?? null,
      sealType: row.specs?.seal_type ?? null,
      boreMm: toNullableNumber(row.specs?.bore_mm),
      odMm: toNullableNumber(row.specs?.od_mm),
      widthMm: toNullableNumber(row.specs?.width_mm),
      bestPriceUsd: toNullableNumber(bestListing?.price_usd),
      bestSupplier: bestListing?.supplier_name ?? null,
      bestAffiliateUrl: bestListing?.affiliate_url ?? bestListing?.supplier_url ?? null,
    }
  })

  return {
    query: results.query,
    parsedIntent: results.parsed.intent,
    total: results.total,
    returned: items.length,
    summary: summarizeOutput(results.query, results.parsed.intent, items, results.total),
    items,
  }
}

function summarizeOutput(
  query: string,
  parsedIntent: string,
  items: SearchCatalogToolOutput['items'],
  total: number
): string {
  if (!items.length) {
    return `No catalog matches found for \"${query}\". Parsed intent: ${parsedIntent}.`
  }

  const lines = items.slice(0, 5).map((item, index) => {
    const dims = [item.boreMm, item.odMm, item.widthMm].every((value) => value != null)
      ? `${item.boreMm}×${item.odMm}×${item.widthMm} mm`
      : 'dims unavailable'
    const price = item.bestPriceUsd != null
      ? `$${item.bestPriceUsd.toFixed(2)}${item.bestSupplier ? ` via ${item.bestSupplier}` : ''}`
      : 'price unavailable'
    return `${index + 1}. ${item.manufacturer} ${item.partNumber} — ${item.matchReason}; ${dims}; ${price}`
  })

  return [
    `Catalog search for \"${query}\" parsed as ${parsedIntent}.`,
    `Returning ${items.length} of ${total} total matches.`,
    ...lines,
  ].join('\n')
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
