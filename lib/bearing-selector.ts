/**
 * bearing-selector.ts — Catalog query + calc orchestration
 *
 * Queries the DB for candidate bearings based on application inputs,
 * runs the L10 calculator on each, and returns ranked results.
 */

import { query } from './db'
import {
  calculateBearing,
  rankResults,
  formatCalcSummary,
  type BearingData,
  type CalcInput,
  type CalcResult,
} from './bearing-calc'

export interface SelectionRequest {
  /** Shaft diameter in mm */
  shaftDiameter_mm?: number
  /** Preferred outer diameter envelope in mm */
  outerDiameter_mm?: number
  /** Preferred width envelope in mm */
  width_mm?: number
  /** Radial load in kN */
  radialLoad_kn: number
  /** Axial load in kN */
  axialLoad_kn: number
  /** Whether axial load was explicitly provided */
  axialLoadSpecified?: boolean
  /** Shaft speed in RPM */
  rpm: number
  /** Operating temperature in °C */
  temperature_c?: number
  /** Lubrication type */
  lubrication?: 'grease' | 'oil'
  /** Environment description (for AI context, not used in math) */
  environment?: string
  /** Desired minimum life in hours */
  minLifeHours?: number
  /** Specific bearing types to consider */
  bearingTypes?: string[]
  /** Specific seal type preference */
  sealType?: string
  /** Minimum static safety factor */
  minStaticSafetyFactor?: number
  /** Limit results */
  limit?: number
}

export interface SelectionResult {
  input: CalcInput
  candidates: CalcResult[]
  suitable: CalcResult[]
  totalCandidates: number
  summary: string
}

/**
 * Run full bearing selection: query DB → calculate → rank → format.
 */
export async function selectBearings(request: SelectionRequest): Promise<SelectionResult> {
  // 1. Build calc input
  const calcInput: CalcInput = {
    radialLoad_kn: request.radialLoad_kn,
    axialLoad_kn: request.axialLoad_kn,
    axialLoadSpecified: request.axialLoadSpecified,
    rpm: request.rpm,
    temperature_c: request.temperature_c,
    lubrication: request.lubrication,
    shaftDiameter_mm: request.shaftDiameter_mm,
    outerDiameter_mm: request.outerDiameter_mm,
    width_mm: request.width_mm,
    minLifeHours: request.minLifeHours,
    minStaticSafetyFactor: request.minStaticSafetyFactor,
  }

  // 2. Query candidate bearings from DB
  const candidates = await queryCandidates(request)

  // 3. Calculate for each candidate
  const results = candidates.map((b) => calculateBearing(b, calcInput))

  // 4. Rank
  const ranked = rankResults(results)

  // 5. Limit output
  const limit = request.limit ?? 10
  const suitable = ranked.filter((r) => r.suitable).slice(0, limit)

  // 6. Format summary for AI
  const summary = formatCalcSummary(calcInput, ranked)

  return {
    input: calcInput,
    candidates: ranked.slice(0, limit),
    suitable,
    totalCandidates: candidates.length,
    summary,
  }
}

/**
 * Query candidate bearings from DB based on application requirements.
 */
async function queryCandidates(request: SelectionRequest): Promise<BearingData[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  // Filter by shaft diameter (bore_mm)
  if (request.shaftDiameter_mm) {
    // Allow ±1mm tolerance for bore matching
    conditions.push(`bs.bore_mm BETWEEN $${paramIdx} AND $${paramIdx + 1}`)
    params.push(request.shaftDiameter_mm - 1, request.shaftDiameter_mm + 1)
    paramIdx += 2
  }

  // Filter by speed limit
  if (request.rpm) {
    const speedCol = request.lubrication === 'oil' ? 'speed_oil_rpm' : 'speed_grease_rpm'
    // Include bearings up to 120% of speed limit (will get warnings)
    conditions.push(`bs.${speedCol} >= $${paramIdx}`)
    params.push(Math.floor(request.rpm * 0.8))
    paramIdx++
  }

  // Filter by temperature
  if (request.temperature_c != null) {
    conditions.push(`bs.temp_max_c >= $${paramIdx}`)
    params.push(request.temperature_c)
    paramIdx++
  }

  // Filter by bearing type
  if (request.bearingTypes && request.bearingTypes.length > 0) {
    const placeholders = request.bearingTypes.map((_, i) => `$${paramIdx + i}`)
    conditions.push(`bs.bearing_type IN (${placeholders.join(', ')})`)
    params.push(...request.bearingTypes)
    paramIdx += request.bearingTypes.length
  }

  // Filter by seal type
  if (request.sealType) {
    conditions.push(`bs.seal_type = $${paramIdx}`)
    params.push(request.sealType)
    paramIdx++
  }

  // Filter out bearings that can't handle axial load if significant
  if (request.axialLoad_kn > 0.1) {
    // Exclude cylindrical rollers which can't handle axial loads
    conditions.push(`bs.bearing_type != 'cylindrical'`)
  }

  // Ensure we have load ratings
  conditions.push('bs.dynamic_load_kn > 0')
  conditions.push('bs.static_load_kn > 0')

  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1'

  const sql = `
    SELECT 
      p.id AS part_id,
      p.part_number,
      m.name AS manufacturer_name,
      m.slug AS manufacturer_slug,
      bs.bearing_type,
      bs.bore_mm::float,
      bs.od_mm::float,
      bs.width_mm::float,
      bs.dynamic_load_kn::float,
      bs.static_load_kn::float,
      bs.speed_grease_rpm,
      bs.speed_oil_rpm,
      bs.contact_angle_deg::float,
      bs.seal_type,
      bs.temp_min_c,
      bs.temp_max_c,
      bs.weight_kg::float
    FROM bearing_specs bs
    JOIN parts p ON p.id = bs.part_id
    JOIN manufacturers m ON m.id = p.manufacturer_id
    WHERE ${whereClause}
    ORDER BY m.tier ASC, bs.bore_mm ASC, bs.od_mm ASC
    LIMIT 100
  `

  const rows = await query<BearingData>(sql, params)
  return rows
}
