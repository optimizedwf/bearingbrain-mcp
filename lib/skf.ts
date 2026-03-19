/**
 * SKF PIM API Client
 * Gateway: SAP API Management (eu20)
 * Base:    /v1/pim
 * Auth:    "apikey" header (lowercase)
 *
 * Endpoint:
 *   GET /details?designation={designation}&language={lang}
 *     → returns PIM product data with technical specs, images, etc.
 *
 * Designation format notes:
 *   - Use exact SKF designation (e.g. "6204-2Z", "6204-2RSH", "22208 E")
 *   - "6204-2RS" does NOT exist — SKF uses "6204-2RSH" or "6204-2RS1"
 *   - Bare numbers work (e.g. "6204" returns open variant)
 *   - Spaces in designations use "+" or "%20" (e.g. "22208+E")
 */

import axios from 'axios'

const SKF_BASE = process.env.SKF_API_BASE ?? 'https://skf-api-external-eu20-tyvvw4iy.prod.apimanagement.eu20.hana.ondemand.com:443/v1/pim'
const SKF_KEY  = process.env.SKF_API_KEY  ?? ''

// Use mock data when no real API key is configured
const USE_MOCK = !SKF_KEY || SKF_KEY.startsWith('your_')

const skf = axios.create({
  baseURL: SKF_BASE,
  headers: {
    'apikey': SKF_KEY,          // SAP API Mgmt uses lowercase "apikey" header
    'Accept': 'application/json',
  },
  timeout: 10_000,
})

// ─── Types matching our unified product model ─────────────────────────────────

export interface SKFProduct {
  partNumber: string
  designation: string
  description: string
  longDescription?: string
  productType: string
  category: string
  imageUrl?: string
  additionalPhotos?: string[]
  buyable?: boolean
  dimensions?: {
    d: number     // bore mm
    D: number     // outer diameter mm
    B: number     // width mm
    r_min?: number
  }
  loadRatings?: {
    C: number     // dynamic kN
    C0: number    // static kN
    Pu?: number   // fatigue limit kN
  }
  speedRatings?: {
    reference: number   // reference speed r/min
    limiting: number    // limiting speed r/min
  }
  properties?: Record<string, string>
  weight?: number         // kg
  carbonFootprint?: string
  breadcrumbPath?: string
  performanceClass?: string
  tolerances?: Record<string, { value: number; unit: string }>
  calculationFactors?: Record<string, number>
  designations?: string[]
  rawDocument?: Record<string, unknown>  // full PIM document for debugging
}

export interface SKFCrossRef {
  manufacturer: string
  partNumber: string
  matchType: 'exact' | 'dimensional' | 'functional'
  notes?: string
}

// ─── PIM Response Parsing ─────────────────────────────────────────────────────

interface PIMResponse {
  stats: { totalHits: number }
  documentList: {
    documents: PIMDocument[]
  }
}

interface PIMDocument {
  _id: string
  designation: string
  category: string
  short_description: string
  long_description: string
  photo_url?: string
  additionalphoto_url?: string[]
  buyable?: boolean
  technical_data?: PIMTechnicalSection[]
  product_data_tables?: PIMProductDataTable[]
  tridion_primary_breadcrumbs?: { path: string }
  feature_flag?: Record<string, boolean>
  [key: string]: unknown
}

interface PIMTechnicalSection {
  name: string
  name_en: string
  rows: PIMTechnicalRow[]
}

interface PIMTechnicalRow {
  id: string
  name: string
  value?: number | string
  unit?: string
}

interface PIMProductDataTable {
  category: string
  tables: {
    features: PIMFeature[]
    subcategory: string
  }[]
  type: string
}

interface PIMFeature {
  data_type: string
  name: string
  real_value?: number
  string_values?: string[]
  unit?: string
  symbol?: string
  description?: string
  qualifier?: string
}

/**
 * Parse a PIM API document into our SKFProduct format
 */
function parsePIMDocument(doc: PIMDocument): SKFProduct {
  const product: SKFProduct = {
    partNumber: doc.designation,
    designation: doc.designation,
    description: doc.short_description,
    longDescription: doc.long_description,
    productType: mapCategoryToType(doc.category),
    category: doc.category,
    imageUrl: doc.photo_url,
    additionalPhotos: doc.additionalphoto_url,
    buyable: doc.buyable,
    breadcrumbPath: doc.tridion_primary_breadcrumbs?.path,
  }

  // Parse technical_data sections
  if (doc.technical_data) {
    for (const section of doc.technical_data) {
      switch (section.name_en || section.name) {
        case 'Dimensions':
          product.dimensions = parseDimensions(section.rows)
          break
        case 'Performance':
          parsePerformance(section.rows, product)
          break
        case 'Properties':
          product.properties = parseProperties(section.rows)
          break
        case 'Logistics':
          parseLogistics(section.rows, product)
          break
      }
    }
  }

  // Parse product_data_tables for more detailed specs
  if (doc.product_data_tables) {
    for (const table of doc.product_data_tables) {
      if (table.category === 'Calculation data') {
        parseCalculationData(table, product)
      }
    }
  }

  // Store raw document for debug/extensibility
  product.rawDocument = doc as unknown as Record<string, unknown>

  return product
}

function parseDimensions(rows: PIMTechnicalRow[]): SKFProduct['dimensions'] {
  let d = 0, D = 0, B = 0, r_min: number | undefined

  for (const row of rows) {
    const val = typeof row.value === 'number' ? row.value : parseFloat(String(row.value))
    if (isNaN(val)) continue

    switch (row.id) {
      case 'PIM001': d = val; break     // Bore diameter
      case 'PIM008': D = val; break     // Outside diameter
      case 'PIM017': B = val; break     // Width
    }

    // Also match by name as fallback
    if (row.name.includes('Bore diameter')) d = d || val
    if (row.name.includes('Outside diameter')) D = D || val
    if (row.name.includes('Width')) B = B || val
    if (row.name.includes('Fillet radius') || row.name.includes('r min')) r_min = val
  }

  return d && D && B ? { d, D, B, r_min } : undefined
}

function parsePerformance(rows: PIMTechnicalRow[], product: SKFProduct): void {
  for (const row of rows) {
    const val = typeof row.value === 'number' ? row.value : parseFloat(String(row.value))

    switch (row.id) {
      case 'PIM003': // Basic dynamic load rating C
        product.loadRatings = product.loadRatings ?? { C: 0, C0: 0 }
        product.loadRatings.C = val
        break
      case 'PIM004': // Basic static load rating C0
        product.loadRatings = product.loadRatings ?? { C: 0, C0: 0 }
        product.loadRatings.C0 = val
        break
      case 'PIM006': // Reference speed
        product.speedRatings = product.speedRatings ?? { reference: 0, limiting: 0 }
        product.speedRatings.reference = val
        break
      case 'PIM005': // Limiting speed
        product.speedRatings = product.speedRatings ?? { reference: 0, limiting: 0 }
        product.speedRatings.limiting = val
        break
      case 'PIM131': // SKF performance class
        product.performanceClass = String(row.value)
        break
    }
  }
}

function parseProperties(rows: PIMTechnicalRow[]): Record<string, string> {
  const props: Record<string, string> = {}
  for (const row of rows) {
    props[row.name] = String(row.value ?? '')
  }
  return props
}

function parseLogistics(rows: PIMTechnicalRow[], product: SKFProduct): void {
  for (const row of rows) {
    if (row.name.includes('net weight') && row.value != null) {
      product.weight = typeof row.value === 'number' ? row.value : parseFloat(String(row.value))
    }
    if (row.name.includes('carbon footprint') && row.value != null) {
      product.carbonFootprint = String(row.value) + (row.unit ? ` ${row.unit}` : '')
    }
  }
}

function parseCalculationData(table: PIMProductDataTable, product: SKFProduct): void {
  for (const sub of table.tables) {
    for (const feat of sub.features) {
      if (feat.real_value != null) {
        // Update load ratings from calculation data (may be more precise)
        if (feat.name === 'Basic dynamic load rating') {
          product.loadRatings = product.loadRatings ?? { C: 0, C0: 0 }
          product.loadRatings.C = feat.real_value
        }
        if (feat.name === 'Basic static load rating') {
          product.loadRatings = product.loadRatings ?? { C: 0, C0: 0 }
          product.loadRatings.C0 = feat.real_value
        }
        if (feat.name === 'Fatigue load limit') {
          product.loadRatings = product.loadRatings ?? { C: 0, C0: 0 }
          product.loadRatings.Pu = feat.real_value
        }
        if (feat.name === 'Reference speed') {
          product.speedRatings = product.speedRatings ?? { reference: 0, limiting: 0 }
          product.speedRatings.reference = feat.real_value
        }
        if (feat.name === 'Limiting speed') {
          product.speedRatings = product.speedRatings ?? { reference: 0, limiting: 0 }
          product.speedRatings.limiting = feat.real_value
        }
      }
      if (feat.name === 'SKF performance class' && feat.string_values?.length) {
        product.performanceClass = feat.string_values[0]
      }
    }
  }
}

function mapCategoryToType(category: string): string {
  const lower = category.toLowerCase()
  if (lower.includes('deep groove')) return 'deep_groove'
  if (lower.includes('angular contact')) return 'angular_contact'
  if (lower.includes('self-aligning ball')) return 'self_aligning_ball'
  if (lower.includes('spherical roller')) return 'spherical_roller'
  if (lower.includes('cylindrical roller')) return 'cylindrical_roller'
  if (lower.includes('tapered roller')) return 'tapered_roller'
  if (lower.includes('needle roller')) return 'needle_roller'
  if (lower.includes('thrust')) return 'thrust'
  if (lower.includes('linear')) return 'linear'
  if (lower.includes('seal')) return 'seal'
  return 'bearing'
}

// ─── API Methods ──────────────────────────────────────────────────────────────

/**
 * Look up a specific part by designation via SKF PIM API
 * Tries exact designation first, then common suffix variants if 0 hits
 */
export async function getSKFProduct(partNumber: string): Promise<SKFProduct | null> {
  if (USE_MOCK) return getMockSKFProduct(partNumber)

  const clean = partNumber.replace(/\s+/g, ' ').trim()

  // Try exact designation
  const result = await fetchPIMDetails(clean)
  if (result) return result

  // Try common SKF designation variants
  // "6204-2RS" → try "6204-2RSH", "6204-2RS1"
  const variants = generateDesignationVariants(clean)
  for (const variant of variants) {
    const varResult = await fetchPIMDetails(variant)
    if (varResult) return varResult
  }

  return null
}

/**
 * Fetch product details from the PIM /details endpoint
 */
async function fetchPIMDetails(designation: string): Promise<SKFProduct | null> {
  try {
    const { data } = await skf.get<PIMResponse>('/details', {
      params: { designation, language: 'en' },
    })

    if (data.stats.totalHits === 0 || !data.documentList.documents.length) {
      return null
    }

    return parsePIMDocument(data.documentList.documents[0])
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status === 404) return null
      if (err.response?.status === 401) {
        console.error('SKF PIM API: Invalid API key')
      }
    }
    console.error('SKF PIM API error:', err)
    return null
  }
}

/**
 * Generate common SKF designation variants to try
 * SKF uses specific suffixes that differ from generic industry names:
 *   -2RS → -2RSH, -2RS1, -2RSL
 *   -ZZ  → -2Z
 *   -RS  → -RSH, -RS1
 */
function generateDesignationVariants(designation: string): string[] {
  const variants: string[] = []
  const upper = designation.toUpperCase()

  // -2RS variants
  if (upper.endsWith('-2RS') || upper.endsWith('2RS')) {
    const base = upper.replace(/-?2RS$/, '')
    variants.push(`${base}-2RSH`, `${base}-2RS1`, `${base}-2RSL`)
  }
  // -RS variants
  else if (upper.endsWith('-RS') || upper.endsWith('RS')) {
    const base = upper.replace(/-?RS$/, '')
    variants.push(`${base}-RSH`, `${base}-RS1`)
  }
  // -ZZ variants
  else if (upper.endsWith('-ZZ') || upper.endsWith('ZZ')) {
    const base = upper.replace(/-?ZZ$/, '')
    variants.push(`${base}-2Z`)
  }
  // -Z variant
  else if (upper.endsWith('-Z')) {
    variants.push(upper.replace(/-Z$/, '-2Z'))
  }

  // Also try bare number (strip all suffixes)
  const bareMatch = upper.match(/^(\d{3,5}(?:\/\d+)?)/)
  if (bareMatch && bareMatch[1] !== upper) {
    variants.push(bareMatch[1])
  }

  return variants
}

/**
 * Get cross-references for a part number
 * NOTE: PIM API does not have a cross-ref endpoint — 
 * these come from our DB or the SKF cross-reference API (separate gateway)
 * For now, falls back to mock data for common designations
 */
export async function getSKFCrossRefs(partNumber: string): Promise<SKFCrossRef[]> {
  // TODO: Integrate SKF Cross-Reference API when available
  // Endpoint: /v1/searchequivalent/GetOEMPartsList
  return getMockCrossRefs(partNumber)
}

/**
 * Search by dimensions
 * PIM /details only works by designation — 
 * dimension search requires a different API or local DB query
 */
export async function searchSKFByDimensions(params: {
  bore_mm?: number
  od_mm?: number
  width_mm?: number
  bearing_type?: string
}): Promise<SKFProduct[]> {
  // PIM API only supports designation lookup, not dimension search
  // Dimension search will be handled by our PostgreSQL database
  if (USE_MOCK) return []
  console.log('SKF PIM API does not support dimension search — use local DB', params)
  return []
}

// ─── Mock data for development (fallback) ────────────────────────────────────

function getMockSKFProduct(partNumber: string): SKFProduct | null {
  const normalized = partNumber.replace(/\s+/g, '').toUpperCase()

  const catalog: Record<string, SKFProduct> = {
    '6204-2RS': {
      partNumber: '6204-2RS',
      designation: '6204-2RSH',
      description: 'Deep groove ball bearing, single row, 2 rubber seals',
      productType: 'deep_groove',
      category: 'Deep groove ball bearings',
      dimensions: { d: 20, D: 47, B: 14 },
      loadRatings: { C: 13.5, C0: 6.55 },
      speedRatings: { reference: 32000, limiting: 17000 },
      designations: ['6204-2RSH', '6204-2RS1'],
    },
    '6204-2Z': {
      partNumber: '6204-2Z',
      designation: '6204-2Z',
      description: 'Deep groove ball bearing, single row, 2 metal shields',
      productType: 'deep_groove',
      category: 'Deep groove ball bearings',
      dimensions: { d: 20, D: 47, B: 14 },
      loadRatings: { C: 13.5, C0: 6.55 },
      speedRatings: { reference: 32000, limiting: 17000 },
      designations: ['6204-2Z'],
    },
    '6205-2RS': {
      partNumber: '6205-2RS',
      designation: '6205-2RSH',
      description: 'Deep groove ball bearing, single row, 2 rubber seals',
      productType: 'deep_groove',
      category: 'Deep groove ball bearings',
      dimensions: { d: 25, D: 52, B: 15 },
      loadRatings: { C: 14.8, C0: 7.8 },
      speedRatings: { reference: 28000, limiting: 14000 },
    },
    '22208E': {
      partNumber: '22208 E',
      designation: '22208 E',
      description: 'Spherical roller bearing, single row',
      productType: 'spherical_roller',
      category: 'Spherical roller bearings',
      dimensions: { d: 40, D: 80, B: 23 },
      loadRatings: { C: 71, C0: 38 },
      speedRatings: { reference: 9500, limiting: 5600 },
    },
  }

  const direct = catalog[normalized] ?? catalog[normalized.replace('SKF', '')]
  if (direct) return direct

  const stripped = normalized.replace(/^(SKF|NSK|FAG|NTN|TIMKEN|KOYO|INA)/, '')
  return catalog[stripped] ?? null
}

function getMockCrossRefs(partNumber: string): SKFCrossRef[] {
  const normalized = partNumber.replace(/\s+/g, '').replace(/^(SKF|NSK|FAG|NTN|TIMKEN|KOYO)/, '').toUpperCase()

  const xrefMap: Record<string, SKFCrossRef[]> = {
    '6204-2RS': [
      { manufacturer: 'NSK',    partNumber: '6204DDU',     matchType: 'exact' },
      { manufacturer: 'FAG',    partNumber: '6204-2RSR',   matchType: 'exact' },
      { manufacturer: 'Timken', partNumber: '204PP',       matchType: 'exact' },
      { manufacturer: 'NTN',    partNumber: '6204LLU',     matchType: 'exact' },
      { manufacturer: 'Koyo',   partNumber: '6204-2RS',    matchType: 'exact' },
    ],
    '6204-2RSH': [
      { manufacturer: 'NSK',    partNumber: '6204DDU',     matchType: 'exact' },
      { manufacturer: 'FAG',    partNumber: '6204-2RSR',   matchType: 'exact' },
      { manufacturer: 'Timken', partNumber: '204PP',       matchType: 'exact' },
      { manufacturer: 'NTN',    partNumber: '6204LLU',     matchType: 'exact' },
      { manufacturer: 'Koyo',   partNumber: '6204-2RS',    matchType: 'exact' },
    ],
    '6204-2Z': [
      { manufacturer: 'NSK',    partNumber: '6204ZZ',      matchType: 'exact' },
      { manufacturer: 'FAG',    partNumber: '6204-2Z',     matchType: 'exact' },
      { manufacturer: 'Timken', partNumber: '204KDD',      matchType: 'exact' },
      { manufacturer: 'NTN',    partNumber: '6204ZZ',      matchType: 'exact' },
    ],
    '6205-2RS': [
      { manufacturer: 'NSK',    partNumber: '6205DDU',     matchType: 'exact' },
      { manufacturer: 'FAG',    partNumber: '6205-2RSR',   matchType: 'exact' },
      { manufacturer: 'Timken', partNumber: '205PP',       matchType: 'exact' },
      { manufacturer: 'NTN',    partNumber: '6205LLU',     matchType: 'exact' },
    ],
  }

  return xrefMap[normalized] ?? xrefMap[normalized + '-2RS'] ?? []
}
