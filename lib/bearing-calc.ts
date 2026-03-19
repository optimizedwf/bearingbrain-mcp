/**
 * bearing-calc.ts — Deterministic bearing engineering calculations
 *
 * ISO 281 bearing life, equivalent load, static safety factor.
 * NO AI in this layer — pure math only.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface CalcInput {
  /** Radial load in kN */
  radialLoad_kn: number
  /** Axial load in kN */
  axialLoad_kn: number
  /** Whether axial load was explicitly provided */
  axialLoadSpecified?: boolean
  /** Shaft speed in RPM */
  rpm: number
  /** Desired minimum life in hours (for filtering) */
  minLifeHours?: number
  /** Operating temperature in °C */
  temperature_c?: number
  /** Lubrication type */
  lubrication?: 'grease' | 'oil'
  /** Shaft diameter in mm (for candidate filtering) */
  shaftDiameter_mm?: number
  /** Preferred outer diameter envelope in mm */
  outerDiameter_mm?: number
  /** Preferred width envelope in mm */
  width_mm?: number
  /** Minimum static safety factor */
  minStaticSafetyFactor?: number
}

export interface BearingData {
  part_id: number
  part_number: string
  manufacturer_name: string
  manufacturer_slug: string
  bearing_type: BearingType
  bore_mm: number
  od_mm: number
  width_mm: number
  dynamic_load_kn: number
  static_load_kn: number
  speed_grease_rpm: number
  speed_oil_rpm: number
  contact_angle_deg: number | null
  seal_type: string | null
  temp_min_c: number
  temp_max_c: number
  weight_kg: number | null
}

export interface CalcResult {
  bearing: BearingData
  /** Equivalent dynamic load P (kN) */
  equivalentLoad_kn: number
  /** Basic rating life L10 (millions of revolutions) */
  l10_revolutions_millions: number
  /** Basic rating life L10 (hours) */
  l10_hours: number
  /** Static safety factor S0 = C0 / P0 */
  staticSafetyFactor: number
  /** Dynamic safety factor C / P */
  dynamicSafetyFactor: number
  /** Speed utilization (rpm / speed limit) as fraction */
  speedUtilization: number
  /** Whether bearing passes all checks */
  suitable: boolean
  /** Reasons if not suitable */
  warnings: string[]
  /** Fit recommendation */
  fitRecommendation: FitRecommendation
}

export interface FitRecommendation {
  shaft: string
  housing: string
  notes: string
}

export type BearingType =
  | 'deep_groove'
  | 'angular'
  | 'self_aligning'
  | 'spherical'
  | 'cylindrical'
  | 'tapered'

// ─── Life Exponent ────────────────────────────────────────────────────

/** ISO 281: p = 3 for ball bearings, p = 10/3 for roller bearings */
function lifeExponent(type: BearingType): number {
  switch (type) {
    case 'cylindrical':
    case 'tapered':
    case 'spherical':
      return 10 / 3
    default:
      return 3
  }
}

// ─── X/Y Factor Tables (ISO 281 / Manufacturer Catalogs) ─────────────

/**
 * Equivalent dynamic load: P = X·Fr + Y·Fa
 *
 * For most bearing types, if Fa/Fr ≤ e, then X=1, Y=0 (pure radial).
 * If Fa/Fr > e, use the tabulated X and Y values.
 *
 * These are simplified representative values from ISO 281 and
 * manufacturer catalogs (SKF, NSK, FAG). For production use,
 * exact values depend on specific bearing geometry.
 */

interface LoadFactors {
  e: number
  X_below_e: number
  Y_below_e: number
  X_above_e: number
  Y_above_e: number
}

/**
 * Deep groove ball bearings:
 * X/Y depends on Fa/(Fr) relative to e, which depends on f0·Fa/C0.
 * Simplified table using representative values.
 */
const DEEP_GROOVE_FACTORS: { f0FaOverC0_max: number; e: number; Y: number }[] = [
  { f0FaOverC0_max: 0.028, e: 0.19, Y: 2.30 },
  { f0FaOverC0_max: 0.056, e: 0.22, Y: 1.99 },
  { f0FaOverC0_max: 0.084, e: 0.26, Y: 1.71 },
  { f0FaOverC0_max: 0.110, e: 0.28, Y: 1.55 },
  { f0FaOverC0_max: 0.170, e: 0.31, Y: 1.45 },
  { f0FaOverC0_max: 0.280, e: 0.37, Y: 1.31 },
  { f0FaOverC0_max: 0.420, e: 0.44, Y: 1.15 },
  { f0FaOverC0_max: 0.560, e: 0.54, Y: 1.04 },
  { f0FaOverC0_max: Infinity, e: 0.54, Y: 1.00 },
]

/** f0 factor for deep groove ball bearings (approximate, depends on D_pw/d_w) */
const DEEP_GROOVE_F0 = 14.0

function getDeepGrooveFactors(Fa: number, Fr: number, C0: number): LoadFactors {
  const f0FaOverC0 = (DEEP_GROOVE_F0 * Fa) / Math.max(C0, 0.001)

  let entry = DEEP_GROOVE_FACTORS[DEEP_GROOVE_FACTORS.length - 1]
  for (const row of DEEP_GROOVE_FACTORS) {
    if (f0FaOverC0 <= row.f0FaOverC0_max) {
      entry = row
      break
    }
  }

  return {
    e: entry.e,
    X_below_e: 1,
    Y_below_e: 0,
    X_above_e: 0.56,
    Y_above_e: entry.Y,
  }
}

/** Angular contact ball bearings — factors by contact angle */
const ANGULAR_FACTORS: { angle_min: number; angle_max: number; factors: LoadFactors }[] = [
  {
    angle_min: 0, angle_max: 20,
    factors: { e: 0.43, X_below_e: 1, Y_below_e: 0, X_above_e: 0.44, Y_above_e: 1.47 },
  },
  {
    angle_min: 20, angle_max: 30,
    factors: { e: 0.43, X_below_e: 1, Y_below_e: 0, X_above_e: 0.44, Y_above_e: 1.40 },
  },
  {
    angle_min: 30, angle_max: 35,
    factors: { e: 0.57, X_below_e: 1, Y_below_e: 0, X_above_e: 0.55, Y_above_e: 1.14 },
  },
  {
    angle_min: 35, angle_max: 40,
    factors: { e: 0.68, X_below_e: 1, Y_below_e: 0, X_above_e: 0.57, Y_above_e: 0.93 },
  },
  {
    angle_min: 40, angle_max: 90,
    factors: { e: 0.95, X_below_e: 1, Y_below_e: 0, X_above_e: 0.55, Y_above_e: 0.57 },
  },
]

function getAngularFactors(contactAngle: number | null): LoadFactors {
  const angle = contactAngle ?? 30
  for (const row of ANGULAR_FACTORS) {
    if (angle >= row.angle_min && angle < row.angle_max) {
      return row.factors
    }
  }
  return ANGULAR_FACTORS[2].factors // default 30°
}

/** Self-aligning ball bearings — simplified */
const SELF_ALIGNING_FACTORS: LoadFactors = {
  e: 0.40,
  X_below_e: 1,
  Y_below_e: 0,
  X_above_e: 0.65,
  Y_above_e: 3.50,
}

/** Spherical roller bearings — simplified (e depends on geometry, using typical) */
const SPHERICAL_FACTORS: LoadFactors = {
  e: 0.32,
  X_below_e: 1,
  Y_below_e: 0,
  X_above_e: 0.67,
  Y_above_e: 2.70,
}

/** Cylindrical roller bearings — pure radial only (Fa must be 0 or negligible) */
const CYLINDRICAL_FACTORS: LoadFactors = {
  e: 0,
  X_below_e: 1,
  Y_below_e: 0,
  X_above_e: 1,
  Y_above_e: 0,
}

/**
 * Tapered roller bearings — simplified.
 * Real values depend heavily on specific bearing geometry (K factor).
 * Using typical values for standard taper angles.
 */
function getTaperedFactors(contactAngle: number | null): LoadFactors {
  const angle = contactAngle ?? 15
  // Y ≈ 0.4 / tan(α)
  const Y = 0.4 / Math.tan((angle * Math.PI) / 180)
  const e = 1.5 * Math.tan((angle * Math.PI) / 180)

  return {
    e,
    X_below_e: 1,
    Y_below_e: 0,
    X_above_e: 0.4,
    Y_above_e: Y,
  }
}

// ─── Core Calculation Functions ───────────────────────────────────────

/**
 * Get X/Y load factors for a bearing
 */
export function getLoadFactors(
  type: BearingType,
  contactAngle: number | null,
  Fa: number,
  Fr: number,
  C0: number
): LoadFactors {
  switch (type) {
    case 'deep_groove':
      return getDeepGrooveFactors(Fa, Fr, C0)
    case 'angular':
      return getAngularFactors(contactAngle)
    case 'self_aligning':
      return SELF_ALIGNING_FACTORS
    case 'spherical':
      return SPHERICAL_FACTORS
    case 'cylindrical':
      return CYLINDRICAL_FACTORS
    case 'tapered':
      return getTaperedFactors(contactAngle)
    default:
      // Fallback: treat as deep groove
      return getDeepGrooveFactors(Fa, Fr, C0)
  }
}

/**
 * Calculate equivalent dynamic load P (kN)
 * P = X·Fr + Y·Fa
 */
export function equivalentDynamicLoad(
  Fr: number,
  Fa: number,
  factors: LoadFactors
): number {
  const ratio = Fr > 0 ? Fa / Fr : Infinity

  if (ratio <= factors.e) {
    const P = factors.X_below_e * Fr + factors.Y_below_e * Fa
    // P must be at least Fr for radial bearings
    return Math.max(P, Fr)
  } else {
    const P = factors.X_above_e * Fr + factors.Y_above_e * Fa
    return Math.max(P, Fr)
  }
}

/**
 * Calculate equivalent static load P0 (kN)
 * P0 = max(0.6·Fr + 0.5·Fa, Fr)  for radial bearings
 */
export function equivalentStaticLoad(Fr: number, Fa: number): number {
  return Math.max(0.6 * Fr + 0.5 * Fa, Fr)
}

/**
 * Calculate basic rating life L10 in millions of revolutions
 * L10 = (C / P) ^ p
 */
export function l10Life_millions(C: number, P: number, type: BearingType): number {
  if (P <= 0) return Infinity
  const p = lifeExponent(type)
  return Math.pow(C / P, p)
}

/**
 * Convert L10 from millions of revolutions to hours
 * L10h = L10 × 10^6 / (60 × n)
 */
export function l10Life_hours(l10_millions: number, rpm: number): number {
  if (rpm <= 0) return Infinity
  return (l10_millions * 1_000_000) / (60 * rpm)
}

/**
 * Calculate static safety factor
 * S0 = C0 / P0
 *
 * Minimum recommended values:
 *   - Normal operation: S0 ≥ 1.0
 *   - Vibration/shock: S0 ≥ 1.5
 *   - Quiet running (precision): S0 ≥ 2.0
 */
export function staticSafetyFactor(C0: number, P0: number): number {
  if (P0 <= 0) return Infinity
  return C0 / P0
}

// ─── Fit Recommendations (ISO 286 Rule-of-Thumb) ─────────────────────

/**
 * Recommend shaft and housing fits based on bearing type and application.
 * These are standard rule-of-thumb recommendations.
 * Always confirm against bearing OEM catalog for the specific bearing.
 */
export function recommendFit(
  type: BearingType,
  Fr: number,
  rotatingRing: 'inner' | 'outer' | 'both' = 'inner'
): FitRecommendation {
  // Most common case: inner ring rotates (shaft rotates)
  if (rotatingRing === 'inner' || rotatingRing === 'both') {
    // Inner ring has circumferential load → tight shaft fit
    // Outer ring has point load → loose housing fit (allows float)
    const isHeavy = Fr > 5 // kN threshold for "heavy" load

    let shaft: string
    let housing: string
    let notes: string

    if (isHeavy) {
      shaft = 'm6'
      housing = 'H7'
      notes = 'Heavy radial load — tight shaft fit (m6) for circumferential load on inner ring. Housing H7 allows axial float.'
    } else {
      shaft = 'k6'
      housing = 'H7'
      notes = 'Normal radial load — standard shaft fit (k6). Housing H7 allows axial float.'
    }

    // Adjustments for specific bearing types
    if (type === 'self_aligning' || type === 'spherical') {
      housing = 'H7'
      notes += ' Self-aligning/spherical types: ensure housing allows angular adjustment.'
    }

    if (type === 'tapered') {
      notes += ' Tapered roller: axial preload adjustment required at assembly.'
    }

    return { shaft, housing, notes }
  }

  // Outer ring rotates (less common — e.g., wheel hubs)
  return {
    shaft: 'g6',
    housing: 'M7',
    notes: 'Outer ring rotates — loose shaft fit (g6) for point load on inner ring. Tight housing (M7) for circumferential load on outer ring.',
  }
}

// ─── Temperature Adjustment ──────────────────────────────────────────

/**
 * Temperature factor fT for bearing life.
 * Above ~100°C, bearing capacity is reduced.
 * Below 100°C, fT = 1.0 (no penalty).
 */
export function temperatureFactor(temp_c: number): number {
  if (temp_c <= 100) return 1.0
  if (temp_c <= 125) return 0.95
  if (temp_c <= 150) return 0.90
  if (temp_c <= 175) return 0.85
  if (temp_c <= 200) return 0.75
  if (temp_c <= 250) return 0.60
  return 0.50
}

// ─── Main Calculator ─────────────────────────────────────────────────

/**
 * Run full bearing selection calculation for a single bearing.
 * Returns detailed results with life, safety factors, and fit recs.
 */
export function calculateBearing(
  bearing: BearingData,
  input: CalcInput
): CalcResult {
  const Fr = input.radialLoad_kn
  const Fa = input.axialLoad_kn
  const rpm = input.rpm
  const temp = input.temperature_c ?? 20
  const lube = input.lubrication ?? 'grease'

  const warnings: string[] = []

  // 1. Get load factors
  const factors = getLoadFactors(
    bearing.bearing_type,
    bearing.contact_angle_deg,
    Fa,
    Fr,
    bearing.static_load_kn
  )

  // 2. Equivalent dynamic load
  let P = equivalentDynamicLoad(Fr, Fa, factors)

  // Apply temperature factor
  const fT = temperatureFactor(temp)
  if (fT < 1.0) {
    // Reduce effective C (capacity) at high temp
    // Equivalent to increasing P by 1/fT
    P = P / fT
    warnings.push(`High temperature (${temp}°C) reduces effective bearing capacity by ${Math.round((1 - fT) * 100)}%`)
  }

  // 3. Equivalent static load
  const P0 = equivalentStaticLoad(Fr, Fa)

  // 4. L10 life
  const l10_rev = l10Life_millions(bearing.dynamic_load_kn, P, bearing.bearing_type)
  const l10_hrs = l10Life_hours(l10_rev, rpm)

  // 5. Safety factors
  const S0 = staticSafetyFactor(bearing.static_load_kn, P0)
  const dynamicFactor = P > 0 ? bearing.dynamic_load_kn / P : Infinity

  // 6. Speed check
  const speedLimit = lube === 'oil' ? bearing.speed_oil_rpm : bearing.speed_grease_rpm
  const speedUtil = speedLimit > 0 ? rpm / speedLimit : 1
  if (speedUtil > 1.0) {
    warnings.push(`Speed ${rpm} RPM exceeds ${lube} limit of ${speedLimit} RPM`)
  } else if (speedUtil > 0.8) {
    warnings.push(`Speed ${rpm} RPM is ${Math.round(speedUtil * 100)}% of ${lube} limit — consider oil lubrication`)
  }

  // 7. Temperature check
  if (temp > bearing.temp_max_c) {
    warnings.push(`Operating temperature ${temp}°C exceeds bearing max of ${bearing.temp_max_c}°C`)
  }
  if (temp < bearing.temp_min_c) {
    warnings.push(`Operating temperature ${temp}°C below bearing min of ${bearing.temp_min_c}°C`)
  }

  // 8. Cylindrical roller + axial load check
  if (bearing.bearing_type === 'cylindrical' && Fa > 0.01) {
    warnings.push('Standard cylindrical roller bearings cannot support significant axial loads. Consider angular contact or tapered roller.')
  }

  // 9. Static safety check
  if (S0 < 1.0) {
    warnings.push(`Static safety factor ${S0.toFixed(2)} is below minimum 1.0 — risk of brinelling`)
  } else if (S0 < 1.5) {
    warnings.push(`Static safety factor ${S0.toFixed(2)} is marginal — consider a larger bearing for shock/vibration environments`)
  }

  // 10. Life check
  const minLife = input.minLifeHours
  if (minLife != null && l10_hrs < minLife && isFinite(l10_hrs)) {
    warnings.push(`Calculated life ${formatHours(l10_hrs)} is below desired minimum of ${formatHours(minLife)}`)
  }

  // 10b. Envelope check
  const exceedsOuterDiameter = input.outerDiameter_mm != null && bearing.od_mm > input.outerDiameter_mm
  const exceedsWidth = input.width_mm != null && bearing.width_mm > input.width_mm
  if (exceedsOuterDiameter || exceedsWidth) {
    const limitParts = [
      input.outerDiameter_mm != null ? `${input.outerDiameter_mm} mm OD` : null,
      input.width_mm != null ? `${input.width_mm} mm width` : null,
    ].filter(Boolean)
    warnings.push(`Bearing envelope ${bearing.od_mm}×${bearing.width_mm} mm exceeds the stated limit of ${limitParts.join(' × ')}`)
  }

  // Suitability
  const meetsLifeTarget = minLife == null || l10_hrs >= minLife
  const meetsEnvelope = !exceedsOuterDiameter && !exceedsWidth

  const suitable =
    speedUtil <= 1.0 &&
    temp <= bearing.temp_max_c &&
    temp >= bearing.temp_min_c &&
    S0 >= 1.0 &&
    meetsLifeTarget &&
    meetsEnvelope &&
    !(bearing.bearing_type === 'cylindrical' && Fa > 0.01)

  // 11. Fit recommendation
  const fitRecommendation = recommendFit(bearing.bearing_type, Fr)

  return {
    bearing,
    equivalentLoad_kn: round3(P),
    l10_revolutions_millions: round3(l10_rev),
    l10_hours: Math.round(l10_hrs),
    staticSafetyFactor: round2(S0),
    dynamicSafetyFactor: round2(dynamicFactor),
    speedUtilization: round2(speedUtil),
    suitable,
    warnings,
    fitRecommendation,
  }
}

/**
 * Rank and sort a list of calc results.
 * Suitable bearings first, then by: smallest envelope → longest life → lowest cost.
 */
export function rankResults(results: CalcResult[]): CalcResult[] {
  return [...results].sort((a, b) => {
    // Suitable bearings first
    if (a.suitable !== b.suitable) return a.suitable ? -1 : 1

    // Prefer the more robust candidate first unless the user supplied an envelope constraint.
    // Longer life and stronger static safety are usually better default engineering choices
    // than simply picking the smallest package.
    if (a.l10_hours !== b.l10_hours) return b.l10_hours - a.l10_hours
    if (Math.abs(a.staticSafetyFactor - b.staticSafetyFactor) > 0.01) {
      return b.staticSafetyFactor - a.staticSafetyFactor
    }

    // Use smaller envelope only as a tie-breaker.
    const envelopeA = a.bearing.od_mm * a.bearing.width_mm
    const envelopeB = b.bearing.od_mm * b.bearing.width_mm
    if (Math.abs(envelopeA - envelopeB) > 1) return envelopeA - envelopeB

    return a.bearing.od_mm - b.bearing.od_mm
  })
}

// ─── Summary for Chat/UI ─────────────────────────────────────────────

/**
 * Format a calc result into a human-readable summary string.
 */
export function formatCalcResult(result: CalcResult): string {
  const b = result.bearing
  const lines: string[] = []

  lines.push(`**${b.manufacturer_name} ${b.part_number}**`)
  lines.push(`Type: ${formatBearingType(b.bearing_type)} | ${b.bore_mm}mm × ${b.od_mm}mm × ${b.width_mm}mm`)

  if (b.seal_type && b.seal_type !== 'open') {
    lines.push(`Seal: ${b.seal_type.toUpperCase()}`)
  }

  lines.push('')
  lines.push(`Equivalent load (P): ${result.equivalentLoad_kn} kN`)
  lines.push(`**L10 life: ${formatHours(result.l10_hours)}** (${result.l10_revolutions_millions.toLocaleString()}M rev)`)
  lines.push(`Static safety factor (S₀): ${result.staticSafetyFactor}`)
  lines.push(`Dynamic safety factor: ${result.dynamicSafetyFactor}`)
  lines.push(`Speed utilization: ${Math.round(result.speedUtilization * 100)}%`)

  lines.push('')
  lines.push(`Fit: shaft **${result.fitRecommendation.shaft}** / housing **${result.fitRecommendation.housing}**`)
  lines.push(`_${result.fitRecommendation.notes}_`)

  if (result.warnings.length > 0) {
    lines.push('')
    lines.push('⚠️ Warnings:')
    result.warnings.forEach((w) => lines.push(`  • ${w}`))
  }

  return lines.join('\n')
}

/**
 * Format a full calc summary for the chat AI to use as context.
 */
export function formatCalcSummary(input: CalcInput, results: CalcResult[]): string {
  const suitable = results.filter((r) => r.suitable)
  const unsuitable = results.filter((r) => !r.suitable)

  const lines: string[] = [
    '═══ BEARING SELECTION RESULTS ═══',
    '',
    `Application: Fr=${input.radialLoad_kn} kN, Fa=${input.axialLoad_kn} kN, ${input.rpm} RPM`,
  ]

  if (input.shaftDiameter_mm) lines.push(`Shaft diameter: ${input.shaftDiameter_mm} mm`)
  if (input.temperature_c) lines.push(`Temperature: ${input.temperature_c}°C`)
  if (input.lubrication) lines.push(`Lubrication: ${input.lubrication}`)
  if (input.minLifeHours) lines.push(`Minimum life target: ${formatHours(input.minLifeHours)}`)

  lines.push('')
  lines.push(`${suitable.length} suitable candidates found (${unsuitable.length} filtered out)`)
  lines.push('')

  if (suitable.length > 0) {
    lines.push('── TOP RECOMMENDATIONS ──')
    suitable.slice(0, 5).forEach((r, i) => {
      lines.push('')
      lines.push(`${i + 1}. ${formatCalcResult(r)}`)
    })
  }

  if (suitable.length === 0) {
    lines.push('No bearings in catalog meet all requirements.')
    lines.push('')
    if (unsuitable.length > 0) {
      lines.push('── CLOSEST MATCHES (with issues) ──')
      unsuitable.slice(0, 3).forEach((r, i) => {
        lines.push('')
        lines.push(`${i + 1}. ${formatCalcResult(r)}`)
      })
    }
  }

  return lines.join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function formatHours(hours: number): string {
  if (!isFinite(hours)) return '∞'
  if (hours >= 1_000_000) return `${(hours / 1_000_000).toFixed(1)}M hours`
  if (hours >= 1_000) return `${(hours / 1_000).toFixed(1)}K hours`
  return `${Math.round(hours)} hours`
}

function formatBearingType(type: BearingType): string {
  const names: Record<BearingType, string> = {
    deep_groove: 'Deep Groove Ball',
    angular: 'Angular Contact Ball',
    self_aligning: 'Self-Aligning Ball',
    spherical: 'Spherical Roller',
    cylindrical: 'Cylindrical Roller',
    tapered: 'Tapered Roller',
  }
  return names[type] ?? type
}
