import crypto from 'crypto'

const ADMIN_TOKEN_ENV_NAMES = ['ORDER_ADMIN_TOKEN', 'INTERNAL_ORDER_ADMIN_TOKEN'] as const

export function getOrderAdminToken(): string | null {
  for (const key of ADMIN_TOKEN_ENV_NAMES) {
    const value = process.env[key]
    if (value && value.trim()) return value.trim()
  }
  return null
}

export function isValidOrderAdminToken(value: string | null | undefined): boolean {
  const expected = getOrderAdminToken()
  if (!expected || !value) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(value))
  } catch {
    return false
  }
}
