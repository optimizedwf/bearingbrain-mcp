import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(price: number | null | undefined): string {
  if (price == null) return 'Check price'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price)
}

export function formatMm(val: number | null | undefined): string {
  if (val == null) return '—'
  return `${val} mm`
}

export function formatRpm(val: number | null | undefined): string {
  if (val == null) return '—'
  return `${val.toLocaleString()} RPM`
}

export function formatKn(val: number | null | undefined): string {
  if (val == null) return '—'
  return `${val} kN`
}

export function sealTypeLabel(sealType: string | null | undefined): string {
  const map: Record<string, string> = {
    open:  'Open',
    zz:    '2Z (Metal Shield)',
    '2rs': '2RS (Rubber Seal)',
    '2rz': '2RZ (Non-contact)',
  }
  return map[sealType ?? ''] ?? sealType ?? '—'
}

export function matchTypeLabel(matchType: string): string {
  const map: Record<string, string> = {
    exact:       'Exact replacement',
    dimensional: 'Same dimensions',
    functional:  'Functional equivalent',
    supersedes:  'Superseded by',
  }
  return map[matchType] ?? matchType
}

export function matchTypeBadgeColor(matchType: string): string {
  const map: Record<string, string> = {
    exact:       'bg-green-100 text-green-800',
    dimensional: 'bg-blue-100 text-blue-800',
    functional:  'bg-yellow-100 text-yellow-800',
    supersedes:  'bg-gray-100 text-gray-600',
  }
  return map[matchType] ?? 'bg-gray-100 text-gray-600'
}

/**
 * Track a click and redirect to affiliate URL
 * Called on the client before navigating away
 */
export async function trackClick(params: {
  affiliate_url: string
  supplier_slug: string
  part_id: number
  listing_id?: number
  search_id?: number
}) {
  try {
    await fetch('/api/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      keepalive: true,  // ensures request completes even if page navigates away
    })
  } catch {
    // Fire and forget — never block the navigation
  }
}


export async function trackSiteEvent(params: {
  event_name: string
  page_path?: string
  thread_id?: string
  properties?: Record<string, unknown>
}) {
  try {
    await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      keepalive: true,
    })
  } catch {
    // Fire and forget — never block UI interaction.
  }
}
