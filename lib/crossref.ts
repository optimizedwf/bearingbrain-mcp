/**
 * Cross-Reference Engine
 * Core logic: part number → equivalents across all manufacturers + live pricing
 *
 * Resolution order:
 *   1. DB cross_references table (pre-built, most trusted)
 *   2. SKF API cross-reference lookup (live, authoritative)
 *   3. ISO designation normalization (infer from standard naming)
 *   4. Spec-based dimensional match (fallback)
 */

import { query, queryOne } from './db'
import { getSKFCrossRefs, getSKFProduct, type SKFCrossRef } from './skf'
import { buildZoroSearchLink } from './zoro'
import type { Part, BearingSpec, SupplierListing, CrossRefResult, SearchResult } from './types'

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Given a part number (any manufacturer), find:
 * - The canonical part record
 * - All known equivalents
 * - Live pricing for each equivalent
 */
export async function findCrossRefs(
  partNumber: string,
  manufacturerHint?: string
): Promise<{
  source_part: SearchResult | null
  cross_refs: CrossRefResult[]
  from_cache: boolean
}> {
  const normalized = normalizePartNumber(partNumber)

  // 1. Find the part in our DB
  let sourcePart = await findPartInDB(normalized, manufacturerHint)

  // 2. If not in DB, look up via SKF API and seed the DB
  if (!sourcePart) {
    sourcePart = await lookupAndSeedFromSKF(normalized, manufacturerHint)
  }

  // 3. Get cross-refs from DB first
  let crossRefs = sourcePart
    ? await getCrossRefsFromDB(sourcePart.part.id)
    : []

  // 4. Augment with SKF API cross-refs if DB has <3 matches
  if (crossRefs.length < 3) {
    const skfRefs = await getSKFCrossRefs(normalized)
    crossRefs = await mergeWithSKFRefs(crossRefs, skfRefs, sourcePart)
  }

  // 5. Add live pricing for each result
  const refsWithPricing = await attachPricing(crossRefs)

  // 6. If source part found, also attach its pricing
  if (sourcePart) {
    sourcePart.listings = await getListingsForPart(sourcePart.part.id)

    if (sourcePart.listings.length === 0) {
      sourcePart.listings = [buildZoroSearchListing(sourcePart.part.part_number, sourcePart.part.manufacturer_name)]
    }
  }

  return {
    source_part: sourcePart,
    cross_refs: refsWithPricing,
    from_cache: crossRefs.length > 0,
  }
}

// ─── DB queries ───────────────────────────────────────────────────────────────

async function findPartInDB(
  partNumber: string,
  manufacturerHint?: string
): Promise<SearchResult | null> {
  const sql = manufacturerHint
    ? `SELECT p.*, m.name AS manufacturer_name, m.slug AS manufacturer_slug, c.name AS category_name
       FROM parts p
       JOIN manufacturers m ON m.id = p.manufacturer_id
       JOIN categories c ON c.id = p.category_id
       WHERE UPPER(REPLACE(p.part_number, ' ', '')) = $1
         AND UPPER(m.slug) = UPPER($2)
       LIMIT 1`
    : `SELECT p.*, m.name AS manufacturer_name, m.slug AS manufacturer_slug, c.name AS category_name
       FROM parts p
       JOIN manufacturers m ON m.id = p.manufacturer_id
       JOIN categories c ON c.id = p.category_id
       WHERE UPPER(REPLACE(p.part_number, ' ', '')) = $1
       ORDER BY m.tier ASC
       LIMIT 1`

  const params = manufacturerHint
    ? [partNumber, manufacturerHint]
    : [partNumber]

  const part = await queryOne<Part>(sql, params)
  if (!part) return null

  const specs = await queryOne<BearingSpec>(
    'SELECT * FROM bearing_specs WHERE part_id = $1',
    [part.id]
  )

  return {
    part,
    specs,
    listings: [],
    cross_refs: [],
    match_reason: 'exact_part_number',
    confidence: 1.0,
  }
}

async function getCrossRefsFromDB(partId: number): Promise<CrossRefResult[]> {
  // Use the bidirectional view
  const rows = await query<{
    equivalent_part_id: number
    match_type: string
    confidence: number
  }>(
    `SELECT equivalent_part_id, match_type, confidence
     FROM cross_references_full
     WHERE part_id = $1
     ORDER BY confidence DESC, match_type ASC`,
    [partId]
  )

  const results: CrossRefResult[] = []

  for (const row of rows) {
    const part = await queryOne<Part>(
      `SELECT p.*, m.name AS manufacturer_name, m.slug AS manufacturer_slug
       FROM parts p
       JOIN manufacturers m ON m.id = p.manufacturer_id
       WHERE p.id = $1`,
      [row.equivalent_part_id]
    )
    if (!part) continue

    const specs = await queryOne<BearingSpec>(
      'SELECT * FROM bearing_specs WHERE part_id = $1',
      [part.id]
    )

    results.push({
      part,
      specs,
      match_type: row.match_type,
      confidence: row.confidence,
      listings: [],
    })
  }

  return results
}

async function getListingsForPart(partId: number): Promise<SupplierListing[]> {
  return query<SupplierListing>(
    `SELECT sl.*, s.slug AS supplier_slug, s.name AS supplier_name
     FROM supplier_listings sl
     JOIN suppliers s ON s.id = sl.supplier_id
     WHERE sl.part_id = $1 AND sl.is_active = TRUE
     ORDER BY sl.price_usd ASC NULLS LAST`,
    [partId]
  )
}

// ─── SKF API integration ─────────────────────────────────────────────────────

function canonicalBearingType(rawType?: string | null): string | null {
  const t = (rawType ?? '').toLowerCase().trim()

  const direct: Record<string, string> = {
    deep_groove: 'deep_groove',
    deep_groove_ball: 'deep_groove',
    angular: 'angular',
    angular_contact: 'angular',
    angular_contact_ball: 'angular',
    cylindrical: 'cylindrical',
    cylindrical_roller: 'cylindrical',
    tapered: 'tapered',
    tapered_roller: 'tapered',
    spherical: 'spherical',
    spherical_roller: 'spherical',
    self_aligning: 'self_aligning',
    self_aligning_ball: 'self_aligning',
    needle: 'needle',
    needle_roller: 'needle',
    thrust: 'thrust',
    thrust_ball: 'thrust',
    thrust_roller: 'thrust',
  }

  if (direct[t]) return direct[t]
  if (t.includes('deep') && t.includes('groove')) return 'deep_groove'
  if (t.includes('angular')) return 'angular'
  if (t.includes('cylindrical')) return 'cylindrical'
  if (t.includes('tapered')) return 'tapered'
  if (t.includes('spherical')) return 'spherical'
  if (t.includes('self') && t.includes('align')) return 'self_aligning'
  if (t.includes('needle')) return 'needle'
  if (t.includes('thrust')) return 'thrust'

  return null
}

async function lookupAndSeedFromSKF(
  partNumber: string,
  _manufacturerHint?: string
): Promise<SearchResult | null> {
  const product = await getSKFProduct(partNumber)
  if (!product) return null

  const bearingType = canonicalBearingType(product.productType)
  if (!bearingType || !product.dimensions) {
    // Ignore non-bearing SKF hits (e.g., seals/linear products) in this bearing-only catalog.
    return null
  }

  // Upsert manufacturer
  await query(
    `INSERT INTO manufacturers (slug, name, country, tier)
     VALUES ('skf', 'SKF', 'SE', 1)
     ON CONFLICT (slug) DO NOTHING`
  )

  // Upsert category (bearing)
  await query(
    `INSERT INTO categories (slug, name)
     VALUES ('bearing', 'Bearings')
     ON CONFLICT (slug) DO NOTHING`
  )

  // Upsert the part
  const existingMfr = await queryOne<{ id: number }>(
    "SELECT id FROM manufacturers WHERE slug = 'skf'"
  )
  const existingCat = await queryOne<{ id: number }>(
    "SELECT id FROM categories WHERE slug = 'bearing'"
  )

  if (!existingMfr || !existingCat) return null

  const [part] = await query<Part>(
    `INSERT INTO parts (part_number, manufacturer_id, category_id, name, description, image_url, datasheet_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (part_number, manufacturer_id) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           updated_at = NOW()
     RETURNING *`,
    [
      product.designation ?? product.partNumber,
      existingMfr.id,
      existingCat.id,
      product.description,
      product.longDescription ?? product.description,
      product.imageUrl ?? null,
      null,  // datasheetUrl — not provided by PIM API
    ]
  )

  // Upsert bearing specs
  if (product.dimensions && part) {
    await query(
      `INSERT INTO bearing_specs
         (part_id, bore_mm, od_mm, width_mm, dynamic_load_kn, static_load_kn,
          speed_grease_rpm, speed_oil_rpm, bearing_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (part_id) DO UPDATE
         SET bore_mm = EXCLUDED.bore_mm,
             od_mm = EXCLUDED.od_mm,
             width_mm = EXCLUDED.width_mm,
             dynamic_load_kn = EXCLUDED.dynamic_load_kn,
             static_load_kn = EXCLUDED.static_load_kn,
             speed_grease_rpm = EXCLUDED.speed_grease_rpm,
             speed_oil_rpm = EXCLUDED.speed_oil_rpm`,
      [
        part.id,
        product.dimensions.d,
        product.dimensions.D,
        product.dimensions.B,
        product.loadRatings?.C ?? null,
        product.loadRatings?.C0 ?? null,
        product.speedRatings?.reference ?? null,
        product.speedRatings?.limiting ?? null,
        bearingType,
      ]
    )
  }

  const specs = part
    ? await queryOne<BearingSpec>('SELECT * FROM bearing_specs WHERE part_id = $1', [part.id])
    : null

  return {
    part: { ...part, manufacturer_name: 'SKF', manufacturer_slug: 'skf' },
    specs,
    listings: [],
    cross_refs: [],
    match_reason: 'skf_api_lookup',
    confidence: 1.0,
  }
}

async function mergeWithSKFRefs(
  existing: CrossRefResult[],
  skfRefs: SKFCrossRef[],
  sourcePart: SearchResult | null
): Promise<CrossRefResult[]> {
  const existingMfrs = new Set(
    existing.map(r => `${r.part.manufacturer_slug}:${r.part.part_number}`.toLowerCase())
  )

  const merged = [...existing]

  for (const ref of skfRefs) {
    const key = `${ref.manufacturer.toLowerCase()}:${ref.partNumber.toLowerCase()}`
    if (existingMfrs.has(key)) continue

    // Try to find in DB first
    const dbPart = await queryOne<Part>(
      `SELECT p.*, m.name AS manufacturer_name, m.slug AS manufacturer_slug
       FROM parts p
       JOIN manufacturers m ON m.id = p.manufacturer_id
       WHERE UPPER(REPLACE(p.part_number, ' ', '')) = UPPER($1)
         AND UPPER(m.name) LIKE UPPER($2)`,
      [
        normalizePartNumber(ref.partNumber),
        `%${ref.manufacturer}%`,
      ]
    )

    const specs = dbPart
      ? await queryOne<BearingSpec>('SELECT * FROM bearing_specs WHERE part_id = $1', [dbPart.id])
      : null

    // Build a synthetic part record for refs not yet in our DB
    const syntheticPart: Part = dbPart ?? {
      id: -1,  // Signals this is not yet persisted
      part_number: ref.partNumber,
      manufacturer_id: -1,
      category_id: -1,
      name: null,
      description: null,
      image_url: null,
      datasheet_url: null,
      part_kind: 'bearing',
      status: 'active',
      extra_specs: {},
      manufacturer_name: ref.manufacturer,
      manufacturer_slug: ref.manufacturer.toLowerCase(),
    }

    merged.push({
      part: syntheticPart,
      specs: specs ?? (sourcePart?.specs ?? null),  // Reuse source specs for exact matches
      match_type: ref.matchType,
      confidence: ref.matchType === 'exact' ? 1.0 : 0.8,
      listings: [],
    })

    // Store cross-ref in DB if we have real part IDs
    if (sourcePart && sourcePart.part.id > 0 && dbPart && dbPart.id > 0) {
      await query(
        `INSERT INTO cross_references
           (part_id, equivalent_part_id, match_type, confidence, source)
         VALUES ($1, $2, $3, $4, 'skf_api')
         ON CONFLICT (part_id, equivalent_part_id) DO NOTHING`,
        [sourcePart.part.id, dbPart.id, ref.matchType, ref.matchType === 'exact' ? 1.0 : 0.8]
      )
    }
  }

  return merged
}

// ─── Pricing attachment ───────────────────────────────────────────────────────

async function attachPricing(refs: CrossRefResult[]): Promise<CrossRefResult[]> {
  return Promise.all(
    refs.map(async (ref) => {
      if (ref.part.id > 0) {
        ref.listings = await getListingsForPart(ref.part.id)
      }

      // If no DB listings, generate an affiliate search link for Zoro
      if (ref.listings.length === 0) {
        ref.listings = [buildZoroSearchListing(ref.part.part_number, ref.part.manufacturer_name)]
      }

      return ref
    })
  )
}

/**
 * Build a placeholder listing pointing to a Zoro search
 * Used when we don't have a direct product page URL yet
 */
function buildZoroSearchListing(partNumber: string, manufacturer?: string | null): SupplierListing {
  const query = manufacturer ? `${manufacturer} ${partNumber}` : partNumber
  return {
    id: -1,
    part_id: -1,
    supplier_id: -1,
    supplier_slug: 'zoro',
    supplier_name: 'Zoro',
    supplier_sku: null,
    supplier_url: `https://www.zoro.com/search?q=${encodeURIComponent(query)}`,
    affiliate_url: buildZoroSearchLink(query),
    price_usd: null,
    in_stock: null,
    stock_qty: null,
    lead_time_days: null,
    last_checked_at: null,
    price_breaks: null,
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Normalize a part number for consistent DB lookups:
 * - Remove spaces and dashes (for lookup only, preserve for display)
 * - Uppercase
 * - Strip manufacturer prefix if present
 *
 * "skf 6204-2rs" → "6204-2RS"
 * "FAG6204-2RSR" → "6204-2RSR"
 */
export function normalizePartNumber(pn: string): string {
  return pn
    .trim()
    .toUpperCase()
    .replace(/^(SKF|NSK|FAG|NTN|TIMKEN|KOYO|INA|RBC|PEER)\s*/i, '')
    .replace(/\s+/g, '')
}

/**
 * Parse a bearing designation into components
 * "6204-2RS" → { series: "62", bore_code: "04", bore_mm: 20, suffix: "2RS" }
 */
export function parseBearingDesignation(pn: string) {
  const normalized = normalizePartNumber(pn)

  // Standard ISO deep groove format: XYYY[suffix]
  // X = type (6 = deep groove), YY = dimension series, YY = bore code
  const match = normalized.match(/^(6|7|2|3|N|NU|NJ)(\d{2})(\d{2})(.*)?$/)
  if (!match) return null

  const [, typeCode, dimSeries, boreCode, suffix] = match
  const boreCodeNum = parseInt(boreCode)

  // Bore conversion: codes 04-96 → multiply by 5 for mm
  // Codes 00-03 → special: 00=10mm, 01=12mm, 02=15mm, 03=17mm
  const boreMm = boreCodeNum <= 3
    ? [10, 12, 15, 17][boreCodeNum]
    : boreCodeNum * 5

  return {
    type_code: typeCode,
    dimension_series: dimSeries,
    bore_code: boreCode,
    bore_mm: boreMm,
    suffix: suffix ?? '',
    bearing_type: typeCode === '6' ? 'deep_groove'
                : typeCode === '7' ? 'angular'
                : typeCode === '2' || typeCode === '3' ? 'spherical'
                : 'roller',
    seal_type: suffix.includes('2RS') || suffix.includes('DDU') || suffix.includes('LLU') ? '2rs'
             : suffix.includes('ZZ') || suffix.includes('2Z') ? 'zz'
             : 'open',
  }
}
