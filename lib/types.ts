// ─── Database Types ───────────────────────────────────────────────────────────

export interface Manufacturer {
  id: number
  slug: string
  name: string
  country: string
  tier: number
}

export interface Part {
  id: number
  part_number: string
  manufacturer_id: number
  category_id: number
  name: string | null
  description: string | null
  image_url: string | null
  datasheet_url: string | null
  part_kind: 'bearing' | 'component' | 'accessory' | 'adjacent'
  status: string
  extra_specs: Record<string, unknown>
  // Joined fields
  manufacturer_name?: string
  manufacturer_slug?: string
  category_name?: string
}

export interface BearingSpec {
  part_id: number
  bore_mm: number | null
  od_mm: number | null
  width_mm: number | null
  dynamic_load_kn: number | null
  static_load_kn: number | null
  speed_grease_rpm: number | null
  speed_oil_rpm: number | null
  bearing_type: string | null
  rows: number
  seal_type: string | null
  internal_clearance: string | null
  cage_material: string | null
  precision_class: string | null
  ring_material: string | null
  weight_kg: number | null
  temp_min_c: number
  temp_max_c: number
}

export interface SupplierListing {
  id: number
  part_id: number
  supplier_id: number
  supplier_slug: string
  supplier_name: string
  supplier_sku: string | null
  supplier_url: string | null
  affiliate_url: string | null
  price_usd: number | null
  price_source?: 'live' | 'estimated'
  in_stock: boolean | null
  stock_qty: number | null
  lead_time_days: number | null
  last_checked_at: string | null
  price_breaks: Array<{ qty: number; price: number }> | null
}

export interface CrossReference {
  part_id: number
  equivalent_part_id: number
  match_type: 'exact' | 'dimensional' | 'functional' | 'supersedes'
  confidence: number
  source: string
  verified: boolean
}

// ─── Search / AI Types ────────────────────────────────────────────────────────

export interface ParsedBearingQuery {
  // Direct part number lookup
  part_number?: string
  manufacturer?: string

  // Spec-based search
  bore_mm?: number
  od_mm?: number
  width_mm?: number
  bearing_type?: string    // 'deep_groove', 'angular', 'tapered', 'spherical', 'needle'
  seal_type?: string       // 'open', 'zz', '2rs', '2rz'
  speed_rpm?: number
  load_kn?: number
  environment?: string     // 'dusty', 'wet', 'high_temp', 'food_grade'

  // Query intent
  intent: 'crossref' | 'spec_search' | 'part_lookup' | 'availability' | 'chat'
  raw_query: string
  confidence: number
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface SearchResult {
  part: Part
  specs: BearingSpec | null
  listings: SupplierListing[]
  cross_refs: CrossRefResult[]
  match_reason: string
  confidence: number
}

export interface CrossRefResult {
  part: Part
  specs: BearingSpec | null
  match_type: string
  confidence: number
  listings: SupplierListing[]
}

export interface SearchResponse {
  query: string
  parsed: ParsedBearingQuery
  results: SearchResult[]
  total: number
  search_id?: number
}
