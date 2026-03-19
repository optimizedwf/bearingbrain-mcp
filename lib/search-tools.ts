import { parseQuery } from './ai'
import { findCrossRefs } from './crossref'
import { query } from './db'
import type { BearingSpec, Part, SearchResponse, SupplierListing } from './types'

export async function searchPartsByQuery(rawQuery: string, limit = 10): Promise<SearchResponse> {
  const parsed = await parseQuery(rawQuery)

  let results: SearchResponse

  if (parsed.intent === 'chat') {
    results = {
      query: rawQuery,
      parsed,
      results: [],
      total: 0,
    }
  } else if (parsed.intent === 'crossref' || parsed.intent === 'part_lookup') {
    const pn = parsed.part_number ?? rawQuery
    const { source_part, cross_refs } = await findCrossRefs(pn, parsed.manufacturer)

    const allResults = [
      ...(source_part ? [source_part] : []),
      ...cross_refs.map((ref) => ({
        part: ref.part,
        specs: ref.specs,
        listings: ref.listings,
        cross_refs: [],
        match_reason: ref.match_type,
        confidence: ref.confidence,
      })),
    ]

    results = {
      query: rawQuery,
      parsed,
      results: allResults.slice(0, limit),
      total: allResults.length,
    }
  } else {
    results = await specSearch(parsed, rawQuery, limit)
  }

  results = withBrandAwareLinks(results)
  results = withDisplayPrices(results)

  return results
}

export function summarizeSearchForLLM(results: SearchResponse): string {
  const top = results.results.slice(0, 5)

  const lines = top.map((row, i) => {
    const best = row.listings.find((l) => l.price_usd != null)
    const specs = row.specs
      ? [
          specsPart('bore_mm', row.specs.bore_mm),
          specsPart('od_mm', row.specs.od_mm),
          specsPart('width_mm', row.specs.width_mm),
          row.specs.seal_type ? `seal=${row.specs.seal_type}` : undefined,
          row.specs.speed_grease_rpm ? `speed_grease_rpm=${row.specs.speed_grease_rpm}` : undefined,
        ]
          .filter(Boolean)
          .join(', ')
      : 'specs unavailable'

    const priceText = best
      ? `${best.price_source === 'estimated' ? '~' : ''}$${Number(best.price_usd).toFixed(2)} via ${best.supplier_name}`
      : 'price unavailable'

    return `${i + 1}. ${row.part.manufacturer_name ?? row.part.manufacturer_slug} ${row.part.part_number} | ${row.match_reason} | ${specs} | ${priceText}`
  })

  const parsedSummary = {
    intent: results.parsed.intent,
    part_number: results.parsed.part_number ?? null,
    manufacturer: results.parsed.manufacturer ?? null,
    bore_mm: results.parsed.bore_mm ?? null,
    od_mm: results.parsed.od_mm ?? null,
    width_mm: results.parsed.width_mm ?? null,
    seal_type: results.parsed.seal_type ?? null,
    speed_rpm: results.parsed.speed_rpm ?? null,
    environment: results.parsed.environment ?? null,
  }

  return [
    `query=${results.query}`,
    `parsed=${JSON.stringify(parsedSummary)}`,
    `total=${results.total}`,
    lines.length ? lines.join('\n') : 'no matched parts',
  ].join('\n')
}

async function specSearch(
  parsed: Awaited<ReturnType<typeof parseQuery>>,
  rawQuery: string,
  limit: number
): Promise<SearchResponse> {
  const conditions: string[] = ['1=1']
  const params: unknown[] = []
  let i = 1

  if (parsed.bore_mm) {
    conditions.push(`bs.bore_mm BETWEEN $${i} AND $${i + 1}`)
    params.push(parsed.bore_mm - 1, parsed.bore_mm + 1)
    i += 2
  }
  if (parsed.od_mm) {
    conditions.push(`bs.od_mm BETWEEN $${i} AND $${i + 1}`)
    params.push(parsed.od_mm - 1, parsed.od_mm + 1)
    i += 2
  }
  if (parsed.seal_type) {
    conditions.push(`bs.seal_type = $${i}`)
    params.push(parsed.seal_type)
    i++
  }
  if (parsed.bearing_type) {
    conditions.push(`bs.bearing_type = $${i}`)
    params.push(parsed.bearing_type)
    i++
  }
  if (parsed.speed_rpm) {
    conditions.push(`bs.speed_grease_rpm >= $${i}`)
    params.push(parsed.speed_rpm)
    i++
  }
  if (parsed.manufacturer) {
    const mfrSlug = manufacturerToSlug(parsed.manufacturer)
    if (mfrSlug) {
      conditions.push(`m.slug = $${i}`)
      params.push(mfrSlug)
      i++
    }
  }

  const fetchLimit = Math.max(limit * 5, 40)

  const rows = await query<Part & BearingSpec & { supplier_count: number }>(
    `SELECT p.*, m.name AS manufacturer_name, m.slug AS manufacturer_slug,
            c.name AS category_name, bs.*,
            (SELECT COUNT(*) FROM supplier_listings sl WHERE sl.part_id = p.id AND sl.is_active) AS supplier_count
     FROM parts p
     JOIN manufacturers m ON m.id = p.manufacturer_id
     JOIN categories c ON c.id = p.category_id
     JOIN bearing_specs bs ON bs.part_id = p.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY supplier_count DESC, m.tier ASC
     LIMIT ${Math.max(10, Math.min(fetchLimit, 80))}`,
    params
  )

  const prefs = extractQueryPreferences(rawQuery)

  const scoredResults = await Promise.all(
    rows.map(async (row) => {
      const listings = await query<SupplierListing>(
        `SELECT sl.*, s.slug AS supplier_slug, s.name AS supplier_name
         FROM supplier_listings sl
         JOIN suppliers s ON s.id = sl.supplier_id
         WHERE sl.part_id = $1 AND sl.is_active = TRUE
         ORDER BY sl.price_usd ASC NULLS LAST
         LIMIT 5`,
        [row.id]
      )

      const score = scoreSpecResult(parsed, row as BearingSpec, listings, prefs)
      const confidence = Math.min(0.97, Math.max(0.55, 0.62 + score / 100))

      return {
        part: row as Part,
        specs: row as BearingSpec,
        listings,
        cross_refs: [],
        match_reason: buildMatchReason(parsed, row as BearingSpec, prefs),
        confidence,
        _score: score,
      }
    })
  )

  const ranked = scoredResults
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score
      return (b.listings.length ?? 0) - (a.listings.length ?? 0)
    })
    .slice(0, Math.max(1, Math.min(limit, 25)))
    .map(({ _score, ...result }) => result)

  return {
    query: rawQuery,
    parsed,
    results: ranked,
    total: ranked.length,
  }
}

function extractQueryPreferences(rawQuery: string): {
  preferLowCost: boolean
  preferLowNoise: boolean
  wantsStainless: boolean
  wantsWashdown: boolean
  wantsHighTemp: boolean
} {
  const q = rawQuery.toLowerCase()

  return {
    preferLowCost: /\b(cheap|budget|low\s*cost|economical|lowest price)\b/i.test(q),
    preferLowNoise: /\b(low noise|quiet|silent|noise)\b/i.test(q),
    wantsStainless: /\b(stainless|ss\b|corrosion resistant)\b/i.test(q),
    wantsWashdown: /\b(washdown|food|hygien|water|wet)\b/i.test(q),
    wantsHighTemp: /\b(high\s*temp|hot|temperature|180c|200c|220c)\b/i.test(q),
  }
}

function scoreSpecResult(
  parsed: Awaited<ReturnType<typeof parseQuery>>,
  specs: BearingSpec,
  listings: SupplierListing[],
  prefs: ReturnType<typeof extractQueryPreferences>
): number {
  let score = 0

  if (parsed.bore_mm != null && specs.bore_mm != null) {
    const diff = Math.abs(specs.bore_mm - parsed.bore_mm)
    score += Math.max(0, 28 - diff * 10)
  }

  if (parsed.od_mm != null && specs.od_mm != null) {
    const diff = Math.abs(specs.od_mm - parsed.od_mm)
    score += Math.max(0, 14 - diff * 5)
  }

  if (parsed.width_mm != null && specs.width_mm != null) {
    const diff = Math.abs(specs.width_mm - parsed.width_mm)
    score += Math.max(0, 10 - diff * 4)
  }

  if (parsed.bearing_type && specs.bearing_type === parsed.bearing_type) score += 22
  if (parsed.seal_type && (specs.seal_type ?? '').toLowerCase() === parsed.seal_type.toLowerCase()) score += 16

  if (parsed.speed_rpm != null && specs.speed_grease_rpm != null) {
    score += specs.speed_grease_rpm >= parsed.speed_rpm ? 8 : -20
  }

  if (parsed.load_kn != null && specs.dynamic_load_kn != null) {
    score += specs.dynamic_load_kn >= parsed.load_kn ? 8 : -15
  }

  if (prefs.wantsWashdown && (specs.seal_type ?? '').toLowerCase() === '2rs') score += 8
  if (prefs.wantsHighTemp) score += (specs.temp_max_c ?? 120) >= 150 ? 8 : -6

  const ringMaterial = (specs.ring_material ?? '').toLowerCase()
  if (prefs.wantsStainless) score += /stainless|inox|440c|aisi\s*316/.test(ringMaterial) ? 15 : -8

  if (prefs.preferLowNoise) {
    const type = (specs.bearing_type ?? '').toLowerCase()
    if (type === 'deep_groove' || type === 'angular') score += 4
  }

  if (prefs.preferLowCost) {
    const minPrice = listings
      .map((l) => l.price_usd)
      .find((p): p is number => typeof p === 'number' && Number.isFinite(p))
    if (typeof minPrice === 'number') score += Math.max(0, 12 - minPrice / 8)
  }

  if ((parsed.environment ?? '') === 'dusty' && (specs.seal_type ?? '').toLowerCase() !== '2rs') score -= 6
  if ((parsed.environment ?? '') === 'wet' && (specs.seal_type ?? '').toLowerCase() !== '2rs') score -= 6

  return score
}

function buildMatchReason(
  parsed: Awaited<ReturnType<typeof parseQuery>>,
  specs: BearingSpec,
  prefs: ReturnType<typeof extractQueryPreferences>
): string {
  const reasons: string[] = []

  if (parsed.bore_mm != null && specs.bore_mm != null && Math.abs(specs.bore_mm - parsed.bore_mm) <= 0.5) {
    reasons.push('bore_match')
  }
  if (parsed.bearing_type && specs.bearing_type === parsed.bearing_type) reasons.push('type_match')
  if (parsed.seal_type && (specs.seal_type ?? '').toLowerCase() === parsed.seal_type.toLowerCase()) reasons.push('seal_match')
  if (parsed.speed_rpm != null && specs.speed_grease_rpm != null && specs.speed_grease_rpm >= parsed.speed_rpm) reasons.push('speed_ok')
  if (parsed.load_kn != null && specs.dynamic_load_kn != null && specs.dynamic_load_kn >= parsed.load_kn) reasons.push('load_ok')
  if (prefs.wantsWashdown && (specs.seal_type ?? '').toLowerCase() === '2rs') reasons.push('washdown_friendly')
  if (prefs.wantsHighTemp && (specs.temp_max_c ?? 120) >= 150) reasons.push('high_temp_capable')

  return reasons.length ? reasons.join('+') : 'spec_match'
}

function specsPart(label: string, value: number | string | null | undefined): string | undefined {
  if (value == null) return undefined
  return `${label}=${value}`
}

function withBrandAwareLinks(results: SearchResponse): SearchResponse {
  return {
    ...results,
    results: results.results.map((result) => ({
      ...result,
      listings: result.listings.map((listing) => mapBrandAwareListing(listing, result.part)),
    })),
  }
}

function mapBrandAwareListing(listing: SupplierListing, part: Part): SupplierListing {
  if (listing.supplier_slug !== 'amazon') return listing

  const amazonUrl = buildAmazonBrandSearchUrl(part)

  return {
    ...listing,
    supplier_url: amazonUrl,
    affiliate_url: amazonUrl,
  }
}

function buildAmazonBrandSearchUrl(part: Part): string {
  const tag = process.env.AMAZON_ASSOCIATE_TAG ?? 'adamnorm13-20'
  const brand = (part.manufacturer_name ?? '').trim()
  const partNumber = part.part_number.trim()
  const q = [brand, `"${partNumber}"`, 'bearing'].filter(Boolean).join(' ')

  return `https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}`
}

function withDisplayPrices(results: SearchResponse): SearchResponse {
  return {
    ...results,
    results: results.results.map((result) => {
      const enrichedListings = result.listings
        .map((listing) => mapDisplayPrice(listing, result.part, result.specs))
        .sort((a, b) => (a.price_usd ?? Number.POSITIVE_INFINITY) - (b.price_usd ?? Number.POSITIVE_INFINITY))

      return {
        ...result,
        listings: enrichedListings,
      }
    }),
  }
}

function mapDisplayPrice(listing: SupplierListing, part: Part, specs: BearingSpec | null): SupplierListing {
  if (listing.price_usd != null) {
    return {
      ...listing,
      price_source: 'live',
    }
  }

  return {
    ...listing,
    price_usd: estimateListingPrice(part, specs, listing.supplier_slug),
    price_source: 'estimated',
  }
}

function estimateListingPrice(part: Part, specs: BearingSpec | null, supplierSlug: string): number {
  const base = estimateBasePartPrice(part, specs)

  const supplierMultiplier: Record<string, number> = {
    zoro: 1.0,
    amazon: 1.06,
    msc: 1.09,
    ebay: 0.95,
  }

  const manufacturerMultiplier: Record<string, number> = {
    skf: 1.28,
    fag: 1.22,
    timken: 1.18,
    nsk: 1.16,
    ntn: 1.12,
    koyo: 1.1,
  }

  const mfrSlug = (part.manufacturer_slug ?? '').toLowerCase()
  const supplierFactor = supplierMultiplier[supplierSlug] ?? 1
  const manufacturerFactor = manufacturerMultiplier[mfrSlug] ?? 1

  return roundUsd(Math.max(4.5, base * supplierFactor * manufacturerFactor))
}

function estimateBasePartPrice(part: Part, specs: BearingSpec | null): number {
  if (specs) {
    const bore = specs.bore_mm ?? 20
    const od = specs.od_mm ?? 50
    const width = specs.width_mm ?? 15
    const dynamicLoad = specs.dynamic_load_kn ?? 12

    const seriesFactor = part.part_number.includes('63') ? 1.2 : 1

    const sealFactorMap: Record<string, number> = {
      open: 1,
      zz: 1.07,
      '2rz': 1.08,
      '2rs': 1.12,
    }

    const sealFactor = sealFactorMap[(specs.seal_type ?? '').toLowerCase()] ?? 1.05
    const raw = (2.5 + bore * 0.22 + od * 0.045 + width * 0.3 + dynamicLoad * 0.12) * seriesFactor * sealFactor

    return raw
  }

  const parsed = parseSeriesAndBore(part.part_number)
  if (parsed) {
    const { boreMm, series } = parsed
    const seriesFactor = series === '63' ? 1.22 : 1
    return (4 + boreMm * 0.38) * seriesFactor
  }

  return 11
}

function parseSeriesAndBore(partNumber: string): { series: '62' | '63'; boreMm: number } | null {
  const normalized = partNumber.toUpperCase().replace(/\s+/g, '')
  const match = normalized.match(/(?:^|\D)(6[23])(\d{2})/)
  if (!match) return null

  const [, series, boreCodeRaw] = match
  const boreCode = Number.parseInt(boreCodeRaw, 10)

  const boreMm = boreCode <= 3
    ? [10, 12, 15, 17][boreCode]
    : boreCode * 5

  return {
    series: series as '62' | '63',
    boreMm,
  }
}

function manufacturerToSlug(input: string): string | undefined {
  const key = input.trim().toLowerCase()
  const map: Record<string, string> = {
    skf: 'skf',
    nsk: 'nsk',
    fag: 'fag',
    timken: 'timken',
    ntn: 'ntn',
    koyo: 'koyo',
    ina: 'ina',
    rbc: 'rbc',
    nmb: 'nmb',
    iko: 'iko',
  }

  return map[key]
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100
}
