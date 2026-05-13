/**
 * auth.ts — Simple JWT-based auth for BearingBrain
 */
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { query } from './db'
import { cookies } from 'next/headers'

const JWT_SECRET = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'bearingbrain-dev-secret-change-me')
const TOKEN_EXPIRY = '30d'
const COOKIE_NAME = 'bb_token'

function getJwtSecret(): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is required for authentication in production')
  }
  return JWT_SECRET
}

export interface User {
  id: number
  email: string
  name: string | null
  company: string | null
  plan: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan_expires_at: string | null
}

interface UserRow extends User {
  password_hash: string | null
}

/**
 * Register a new user
 */
export async function registerUser(
  email: string,
  password: string,
  name?: string,
  company?: string
): Promise<User> {
  // Check if email exists
  const existing = await query<{ id: number }>('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
  if (existing.length > 0) {
    throw new Error('Email already registered')
  }

  const hash = await bcrypt.hash(password, 10)

  const rows = await query<User>(
    `INSERT INTO users (email, password_hash, name, company, plan)
     VALUES ($1, $2, $3, $4, 'free')
     RETURNING id, email, name, company, plan, stripe_customer_id, stripe_subscription_id, plan_expires_at`,
    [email.toLowerCase(), hash, name ?? null, company ?? null]
  )

  return rows[0]
}

/**
 * Login with email + password
 */
export async function loginUser(email: string, password: string): Promise<User> {
  const rows = await query<UserRow>(
    `SELECT id, email, name, company, plan, password_hash, stripe_customer_id, stripe_subscription_id, plan_expires_at
     FROM users WHERE email = $1`,
    [email.toLowerCase()]
  )

  if (rows.length === 0) throw new Error('Invalid email or password')

  const user = rows[0]
  if (!user.password_hash) throw new Error('Invalid email or password')

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) throw new Error('Invalid email or password')

  // Update last_seen
  await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [user.id])

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash, ...safeUser } = user
  return safeUser
}

/**
 * Create a JWT token for a user
 */
export function createToken(user: User): string {
  return jwt.sign(
    { userId: user.id, email: user.email, plan: user.plan },
    getJwtSecret(),
    { expiresIn: TOKEN_EXPIRY }
  )
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): { userId: number; email: string; plan: string } | null {
  try {
    return jwt.verify(token, getJwtSecret()) as { userId: number; email: string; plan: string }
  } catch {
    return null
  }
}

/**
 * Get the current user from the cookie (server-side)
 */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null

  const decoded = verifyToken(token)
  if (!decoded) return null

  const rows = await query<User>(
    `SELECT id, email, name, company, plan, stripe_customer_id, stripe_subscription_id, plan_expires_at
     FROM users WHERE id = $1`,
    [decoded.userId]
  )

  if (rows.length === 0) return null

  const user = rows[0]

  // Check if pro plan has expired
  if (user.plan === 'pro' && user.plan_expires_at) {
    if (new Date(user.plan_expires_at) < new Date()) {
      await query("UPDATE users SET plan = 'free' WHERE id = $1", [user.id])
      user.plan = 'free'
    }
  }

  return user
}

/**
 * Check if user has pro access
 */
export function isPro(user: User | null): boolean {
  if (!user) return false
  if (user.plan !== 'pro') return false
  if (user.plan_expires_at && new Date(user.plan_expires_at) < new Date()) return false
  return true
}

export { COOKIE_NAME }
