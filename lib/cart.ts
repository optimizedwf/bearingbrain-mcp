import crypto from 'crypto'
import { query, queryOne, withTransaction } from '@/lib/db'

export interface CartSummary {
  cart: CartRecord
  items: CartItemRecord[]
  itemCount: number
  estimatedSubtotalUsd: number | null
}

export interface CartRecord {
  id: string
  userId: number | null
  sessionId: string
  threadId: string | null
  status: string
  title: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  submittedAt: string | null
}

export interface CartItemRecord {
  id: string
  cartId: string
  partId: number | null
  listingId: number | null
  threadId: string | null
  source: string | null
  manufacturerName: string | null
  manufacturerSlug: string | null
  partNumber: string
  quantity: number
  supplierName: string | null
  supplierSlug: string | null
  unitPriceUsd: number | null
  note: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface AddCartItemInput {
  threadId?: string | null
  source?: string | null
  partId?: number | null
  listingId?: number | null
  manufacturerName?: string | null
  manufacturerSlug?: string | null
  partNumber: string
  quantity?: number
  supplierName?: string | null
  supplierSlug?: string | null
  unitPriceUsd?: number | null
  note?: string | null
  metadata?: Record<string, unknown>
}

interface CartRow {
  id: string
  user_id: number | null
  session_id: string
  thread_id: string | null
  status: string
  title: string | null
  notes: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
}

interface CartItemRow {
  id: string
  cart_id: string
  part_id: number | null
  listing_id: number | null
  thread_id: string | null
  source: string | null
  manufacturer_name: string | null
  manufacturer_slug: string | null
  part_number: string
  quantity: number | string
  supplier_name: string | null
  supplier_slug: string | null
  unit_price_usd: number | string | null
  note: string | null
  metadata_json: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export async function getOrCreateActiveCart(params: {
  sessionId: string
  userId?: number | null
  threadId?: string | null
}): Promise<CartRecord> {
  const existing = await queryOne<CartRow>(
    params.userId
      ? `SELECT * FROM carts
         WHERE status = 'active' AND (user_id = $1 OR session_id = $2)
         ORDER BY updated_at DESC
         LIMIT 1`
      : `SELECT * FROM carts
         WHERE status = 'active' AND session_id = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
    params.userId ? [params.userId, params.sessionId] : [params.sessionId]
  )

  if (existing) {
    if ((params.threadId ?? null) && existing.thread_id !== params.threadId) {
      await query(
        `UPDATE carts
         SET thread_id = COALESCE(thread_id, $2), updated_at = NOW(), user_id = COALESCE(user_id, $3)
         WHERE id = $1`,
        [existing.id, params.threadId, params.userId ?? null]
      )
      const refreshed = await queryOne<CartRow>('SELECT * FROM carts WHERE id = $1', [existing.id])
      return mapCartRow(refreshed ?? existing)
    }

    if (params.userId && existing.user_id == null) {
      await query('UPDATE carts SET user_id = $2, updated_at = NOW() WHERE id = $1', [existing.id, params.userId])
      const refreshed = await queryOne<CartRow>('SELECT * FROM carts WHERE id = $1', [existing.id])
      return mapCartRow(refreshed ?? existing)
    }

    return mapCartRow(existing)
  }

  const id = crypto.randomUUID()
  const created = await queryOne<CartRow>(
    `INSERT INTO carts (id, user_id, session_id, thread_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
     RETURNING *`,
    [id, params.userId ?? null, params.sessionId, params.threadId ?? null]
  )

  if (!created) throw new Error('Failed to create cart')
  return mapCartRow(created)
}

export async function getActiveCartSummary(params: {
  sessionId: string
  userId?: number | null
  threadId?: string | null
}): Promise<CartSummary> {
  const cart = await getOrCreateActiveCart(params)
  return getCartSummaryById(cart.id)
}

export async function findActiveCartSummary(params: {
  sessionId: string
  userId?: number | null
}): Promise<CartSummary | null> {
  const existing = await queryOne<CartRow>(
    params.userId
      ? `SELECT * FROM carts
         WHERE status = 'active' AND (user_id = $1 OR session_id = $2)
         ORDER BY updated_at DESC
         LIMIT 1`
      : `SELECT * FROM carts
         WHERE status = 'active' AND session_id = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
    params.userId ? [params.userId, params.sessionId] : [params.sessionId]
  )

  if (!existing) return null
  return getCartSummaryById(existing.id)
}

export async function getCartSummaryById(cartId: string): Promise<CartSummary> {
  const cartRow = await queryOne<CartRow>('SELECT * FROM carts WHERE id = $1', [cartId])
  if (!cartRow) throw new Error('Cart not found')

  const itemRows = await query<CartItemRow>(
    `SELECT * FROM cart_items
     WHERE cart_id = $1
     ORDER BY created_at ASC`,
    [cartId]
  )

  const items = itemRows.map(mapCartItemRow)
  const subtotal = items.every((item) => item.unitPriceUsd != null)
    ? Number(items.reduce((sum, item) => sum + (item.unitPriceUsd ?? 0) * item.quantity, 0).toFixed(2))
    : null

  return {
    cart: mapCartRow(cartRow),
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    estimatedSubtotalUsd: subtotal,
  }
}

export async function addItemToActiveCart(params: {
  sessionId: string
  userId?: number | null
  threadId?: string | null
  item: AddCartItemInput
}): Promise<CartSummary> {
  const cart = await getOrCreateActiveCart(params)
  const normalized = normalizeAddInput(params.item)

  await withTransaction(async (client) => {
    const existing = await client.query<CartItemRow>(
      `SELECT * FROM cart_items
       WHERE cart_id = $1
         AND COALESCE(part_id, -1) = COALESCE($2, -1)
         AND COALESCE(listing_id, -1) = COALESCE($3, -1)
         AND part_number = $4
         AND COALESCE(supplier_slug, '') = COALESCE($5, '')
       ORDER BY created_at DESC
       LIMIT 1`,
      [cart.id, normalized.partId, normalized.listingId, normalized.partNumber, normalized.supplierSlug]
    )

    if (existing.rows[0]) {
      await client.query(
        `UPDATE cart_items
         SET quantity = quantity + $2,
             thread_id = COALESCE(thread_id, $3),
             note = COALESCE($4, note),
             metadata_json = COALESCE($5::jsonb, metadata_json),
             updated_at = NOW()
         WHERE id = $1`,
        [
          existing.rows[0].id,
          normalized.quantity,
          normalized.threadId,
          normalized.note,
          JSON.stringify(normalized.metadata ?? {}),
        ]
      )
    } else {
      await client.query(
        `INSERT INTO cart_items (
          id, cart_id, part_id, listing_id, thread_id, source,
          manufacturer_name, manufacturer_slug, part_number, quantity,
          supplier_name, supplier_slug, unit_price_usd, note, metadata_json,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14, $15::jsonb,
          NOW(), NOW()
        )`,
        [
          crypto.randomUUID(),
          cart.id,
          normalized.partId,
          normalized.listingId,
          normalized.threadId,
          normalized.source,
          normalized.manufacturerName,
          normalized.manufacturerSlug,
          normalized.partNumber,
          normalized.quantity,
          normalized.supplierName,
          normalized.supplierSlug,
          normalized.unitPriceUsd,
          normalized.note,
          JSON.stringify(normalized.metadata ?? {}),
        ]
      )
    }

    await client.query(
      `UPDATE carts
       SET updated_at = NOW(),
           thread_id = COALESCE(thread_id, $2),
           user_id = COALESCE(user_id, $3)
       WHERE id = $1`,
      [cart.id, normalized.threadId ?? params.threadId ?? null, params.userId ?? null]
    )
  })

  return getCartSummaryById(cart.id)
}

export async function updateCartItem(params: {
  sessionId: string
  userId?: number | null
  itemId: string
  quantity?: number
  note?: string | null
}): Promise<CartSummary> {
  const row = await requireOwnedCartItem(params)
  const nextQty = params.quantity == null ? Number(row.quantity) : Math.max(1, Math.min(9999, Math.floor(params.quantity)))

  await query(
    `UPDATE cart_items
     SET quantity = $2,
         note = COALESCE($3, note),
         updated_at = NOW()
     WHERE id = $1`,
    [params.itemId, nextQty, cleanText(params.note ?? '', 2000) || null]
  )

  await touchCart(row.cart_id)
  return getCartSummaryById(row.cart_id)
}

export async function removeCartItem(params: {
  sessionId: string
  userId?: number | null
  itemId: string
}): Promise<CartSummary> {
  const row = await requireOwnedCartItem(params)
  await query('DELETE FROM cart_items WHERE id = $1', [params.itemId])
  await touchCart(row.cart_id)
  return getCartSummaryById(row.cart_id)
}

async function requireOwnedCartItem(params: {
  sessionId: string
  userId?: number | null
  itemId: string
}): Promise<CartItemRow> {
  const row = await queryOne<CartItemRow & { user_id: number | null; session_id: string }>(
    `SELECT ci.*, c.user_id, c.session_id
     FROM cart_items ci
     JOIN carts c ON c.id = ci.cart_id
     WHERE ci.id = $1`,
    [params.itemId]
  )

  if (!row) throw new Error('Cart item not found')
  const owned = params.userId ? (row.user_id === params.userId || row.session_id === params.sessionId) : row.session_id === params.sessionId
  if (!owned) throw new Error('Not authorized for this cart item')
  return row
}

async function touchCart(cartId: string) {
  await query('UPDATE carts SET updated_at = NOW() WHERE id = $1', [cartId])
}

function normalizeAddInput(item: AddCartItemInput) {
  const partNumber = cleanText(item.partNumber ?? '', 160)
  if (!partNumber) throw new Error('partNumber is required')
  return {
    threadId: cleanText(item.threadId ?? '', 255) || null,
    source: cleanText(item.source ?? '', 80) || null,
    partId: toOptionalInt(item.partId),
    listingId: toOptionalInt(item.listingId),
    manufacturerName: cleanText(item.manufacturerName ?? '', 160) || null,
    manufacturerSlug: cleanText(item.manufacturerSlug ?? '', 120) || null,
    partNumber,
    quantity: Math.max(1, Math.min(9999, Math.floor(item.quantity ?? 1))),
    supplierName: cleanText(item.supplierName ?? '', 160) || null,
    supplierSlug: cleanText(item.supplierSlug ?? '', 120) || null,
    unitPriceUsd: toOptionalMoney(item.unitPriceUsd),
    note: cleanText(item.note ?? '', 2000) || null,
    metadata: sanitizeJson(item.metadata ?? {}),
  }
}

function toOptionalInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.trunc(value)
}

function toOptionalMoney(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Number(value.toFixed(2))
}

function cleanText(value: string, limit: number): string {
  return String(value ?? '').trim().slice(0, limit)
}

function sanitizeJson(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(JSON.stringify(value ?? {}))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function mapCartRow(row: CartRow): CartRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    threadId: row.thread_id,
    status: row.status,
    title: row.title,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
  }
}

function mapCartItemRow(row: CartItemRow): CartItemRecord {
  return {
    id: row.id,
    cartId: row.cart_id,
    partId: row.part_id,
    listingId: row.listing_id,
    threadId: row.thread_id,
    source: row.source,
    manufacturerName: row.manufacturer_name,
    manufacturerSlug: row.manufacturer_slug,
    partNumber: row.part_number,
    quantity: Number(row.quantity) || 1,
    supplierName: row.supplier_name,
    supplierSlug: row.supplier_slug,
    unitPriceUsd: row.unit_price_usd == null ? null : Number(row.unit_price_usd),
    note: row.note,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
