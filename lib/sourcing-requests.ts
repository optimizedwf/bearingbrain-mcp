import crypto from 'crypto'
import { query, queryOne, withTransaction } from '@/lib/db'
import { getActiveCartSummary, getCartSummaryById } from '@/lib/cart'

export interface SourcingRequestRecord {
  id: string
  requestRef: string
  cartId: string
  userId: number | null
  sessionId: string
  threadId: string | null
  status: string
  source: string
  note: string | null
  contactEmail: string | null
  contactName: string | null
  company: string | null
  itemCount: number
  estimatedSubtotalUsd: number | null
  createdAt: string
  updatedAt: string
  submittedAt: string
  orderRef: string | null
  orderStatus: string | null
}

interface SourcingRequestRow {
  id: string
  request_ref: string
  cart_id: string
  user_id: number | null
  session_id: string
  thread_id: string | null
  status: string
  source: string
  note: string | null
  contact_email: string | null
  contact_name: string | null
  company: string | null
  item_count: number | string
  estimated_subtotal_usd: number | string | null
  created_at: string
  updated_at: string
  submitted_at: string
  order_ref?: string | null
  order_status?: string | null
}

export async function submitActiveCartForQuote(params: {
  sessionId: string
  userId?: number | null
  threadId?: string | null
  note?: string | null
  contactEmail?: string | null
  contactName?: string | null
  company?: string | null
}) {
  const activeCart = await getActiveCartSummary({
    sessionId: params.sessionId,
    userId: params.userId ?? null,
    threadId: params.threadId ?? null,
  })

  if (!activeCart.items.length) {
    throw new Error('Add at least one line item before submitting for quote review')
  }

  const requestId = crypto.randomUUID()
  const requestRef = buildRequestRef()
  const cleanNote = cleanText(params.note ?? '', 4000) || null
  const cleanThreadId = cleanText(params.threadId ?? activeCart.cart.threadId ?? '', 255) || null
  const cleanContactEmail = cleanText(params.contactEmail ?? '', 255) || null
  const cleanContactName = cleanText(params.contactName ?? '', 160) || null
  const cleanCompany = cleanText(params.company ?? '', 160) || null

  await withTransaction(async (client) => {
    const lockedCart = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM carts WHERE id = $1 FOR UPDATE',
      [activeCart.cart.id]
    )
    const cartRow = lockedCart.rows[0]
    if (!cartRow) throw new Error('Active cart not found')
    if (cartRow.status !== 'active') throw new Error('Cart is no longer active')

    await client.query(
      `INSERT INTO sourcing_requests (
        id, request_ref, cart_id, user_id, session_id, thread_id, status, source,
        note, contact_email, contact_name, company, item_count, estimated_subtotal_usd,
        created_at, updated_at, submitted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'submitted', 'quote_cart',
        $7, $8, $9, $10, $11, $12,
        NOW(), NOW(), NOW()
      )`,
      [
        requestId,
        requestRef,
        activeCart.cart.id,
        params.userId ?? null,
        params.sessionId,
        cleanThreadId,
        cleanNote,
        cleanContactEmail,
        cleanContactName,
        cleanCompany,
        activeCart.itemCount,
        activeCart.estimatedSubtotalUsd,
      ]
    )

    await client.query(
      `INSERT INTO sourcing_request_items (
        sourcing_request_id, cart_item_id, part_id, listing_id,
        manufacturer_name, manufacturer_slug, part_number, quantity,
        supplier_name, supplier_slug, unit_price_usd, line_total_usd,
        note, metadata_json, created_at
      )
      SELECT
        $2,
        ci.id,
        ci.part_id,
        ci.listing_id,
        ci.manufacturer_name,
        ci.manufacturer_slug,
        ci.part_number,
        ci.quantity,
        ci.supplier_name,
        ci.supplier_slug,
        ci.unit_price_usd,
        CASE WHEN ci.unit_price_usd IS NOT NULL THEN ROUND(ci.unit_price_usd * ci.quantity, 2) ELSE NULL END,
        ci.note,
        ci.metadata_json,
        NOW()
      FROM cart_items ci
      WHERE ci.cart_id = $1
      ORDER BY ci.created_at ASC`,
      [activeCart.cart.id, requestId]
    )

    await client.query(
      `UPDATE carts
       SET status = 'submitted',
           submitted_at = NOW(),
           updated_at = NOW(),
           thread_id = COALESCE(thread_id, $2),
           user_id = COALESCE(user_id, $3),
           notes = COALESCE($4, notes)
       WHERE id = $1`,
      [activeCart.cart.id, cleanThreadId, params.userId ?? null, cleanNote]
    )
  })

  const request = await getSourcingRequestById(requestId)
  if (!request) throw new Error('Submitted request not found')

  const submittedCart = await getCartSummaryById(activeCart.cart.id)
  const nextActiveCart = await getActiveCartSummary({
    sessionId: params.sessionId,
    userId: params.userId ?? null,
    threadId: params.threadId ?? null,
  })

  return {
    request,
    submittedCart,
    activeCart: nextActiveCart,
  }
}

export async function getSourcingRequestById(id: string): Promise<SourcingRequestRecord | null> {
  const row = await queryOne<SourcingRequestRow>(
    `SELECT sr.*, o.order_ref, o.status AS order_status
     FROM sourcing_requests sr
     LEFT JOIN orders o ON o.sourcing_request_id = sr.id
     WHERE sr.id = $1
     LIMIT 1`,
    [id]
  )
  return row ? mapSourcingRequestRow(row) : null
}


export async function listRecentSourcingRequests(params: {
  sessionId: string
  userId?: number | null
  limit?: number
}): Promise<SourcingRequestRecord[]> {
  const limit = Math.max(1, Math.min(25, Math.floor(params.limit ?? 10)))
  const rows = await (params.userId
    ? query<SourcingRequestRow>(
        `SELECT sr.*, o.order_ref, o.status AS order_status
         FROM sourcing_requests sr
         LEFT JOIN orders o ON o.sourcing_request_id = sr.id
         WHERE sr.user_id = $1 OR sr.session_id = $2
         ORDER BY sr.submitted_at DESC
         LIMIT $3`,
        [params.userId, params.sessionId, limit]
      )
    : query<SourcingRequestRow>(
        `SELECT sr.*, o.order_ref, o.status AS order_status
         FROM sourcing_requests sr
         LEFT JOIN orders o ON o.sourcing_request_id = sr.id
         WHERE sr.session_id = $1
         ORDER BY sr.submitted_at DESC
         LIMIT $2`,
        [params.sessionId, limit]
      ))

  return rows.map(mapSourcingRequestRow)
}

function buildRequestRef() {
  const date = new Date()
  const stamp = [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('')
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `BBQ-${stamp}-${suffix}`
}

function cleanText(value: string, limit: number): string {
  return String(value ?? '').trim().slice(0, limit)
}

function mapSourcingRequestRow(row: SourcingRequestRow): SourcingRequestRecord {
  return {
    id: row.id,
    requestRef: row.request_ref,
    cartId: row.cart_id,
    userId: row.user_id,
    sessionId: row.session_id,
    threadId: row.thread_id,
    status: row.status,
    source: row.source,
    note: row.note,
    contactEmail: row.contact_email,
    contactName: row.contact_name,
    company: row.company,
    itemCount: Number(row.item_count) || 0,
    estimatedSubtotalUsd: row.estimated_subtotal_usd == null ? null : Number(row.estimated_subtotal_usd),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    orderRef: row.order_ref ?? null,
    orderStatus: row.order_status ?? null,
  }
}

interface OperatorSourcingRequestRow {
  id: string
  request_ref: string
  cart_id: string
  user_id: number | null
  session_id: string
  thread_id: string | null
  status: string
  source: string
  note: string | null
  contact_email: string | null
  contact_name: string | null
  company: string | null
  item_count: number | string
  estimated_subtotal_usd: number | string | null
  created_at: string
  updated_at: string
  submitted_at: string
  order_ref: string | null
  order_status: string | null
}

interface OperatorSourcingRequestItemRow {
  id: number | string
  sourcing_request_id: string
  cart_item_id: number | null
  part_id: number | null
  listing_id: number | null
  manufacturer_name: string | null
  manufacturer_slug: string | null
  part_number: string
  quantity: number | string
  supplier_name: string | null
  supplier_slug: string | null
  unit_price_usd: number | string | null
  line_total_usd: number | string | null
  note: string | null
  metadata_json: Record<string, unknown> | null
  created_at: string
}

export interface OperatorSourcingRequestSummary {
  id: string
  requestRef: string
  cartId: string
  userId: number | null
  sessionId: string
  threadId: string | null
  status: string
  source: string
  note: string | null
  contactEmail: string | null
  contactName: string | null
  company: string | null
  itemCount: number
  estimatedSubtotalUsd: number | null
  submittedAt: string
  updatedAt: string
  orderRef: string | null
  orderStatus: string | null
}

export interface OperatorSourcingRequestItem {
  id: number
  sourcingRequestId: string
  cartItemId: number | null
  partId: number | null
  listingId: number | null
  manufacturerName: string | null
  manufacturerSlug: string | null
  partNumber: string
  quantity: number
  supplierName: string | null
  supplierSlug: string | null
  unitPriceUsd: number | null
  lineTotalUsd: number | null
  note: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface OperatorSourcingRequestDetail {
  request: OperatorSourcingRequestSummary
  items: OperatorSourcingRequestItem[]
}

export async function listOperatorSourcingRequests(params?: {
  limit?: number
  status?: string | null
  includeOrdered?: boolean
}): Promise<OperatorSourcingRequestSummary[]> {
  const limit = Math.max(1, Math.min(50, Math.floor(params?.limit ?? 15)))
  const status = cleanText(params?.status ?? '', 40) || null
  const includeOrdered = Boolean(params?.includeOrdered)
  const rows = await query<OperatorSourcingRequestRow>(
    `SELECT
       sr.*,
       o.order_ref,
       o.status AS order_status
     FROM sourcing_requests sr
     LEFT JOIN orders o ON o.sourcing_request_id = sr.id
     WHERE ($1::text IS NULL OR sr.status = $1)
       AND ($2::boolean = TRUE OR o.id IS NULL)
     ORDER BY sr.submitted_at DESC
     LIMIT $3`,
    [status, includeOrdered, limit]
  )
  return rows.map(mapOperatorSourcingRequestRow)
}

export async function getOperatorSourcingRequestDetailByRef(requestRef: string): Promise<OperatorSourcingRequestDetail | null> {
  const request = await queryOne<OperatorSourcingRequestRow>(
    `SELECT
       sr.*,
       o.order_ref,
       o.status AS order_status
     FROM sourcing_requests sr
     LEFT JOIN orders o ON o.sourcing_request_id = sr.id
     WHERE sr.request_ref = $1
     LIMIT 1`,
    [cleanText(requestRef, 40)]
  )
  if (!request) return null

  const items = await query<OperatorSourcingRequestItemRow>(
    `SELECT *
     FROM sourcing_request_items
     WHERE sourcing_request_id = $1
     ORDER BY created_at ASC, id ASC`,
    [request.id]
  )

  return {
    request: mapOperatorSourcingRequestRow(request),
    items: items.map(mapOperatorSourcingRequestItemRow),
  }
}


export async function updateOperatorSourcingRequestStatusByRef(params: {
  requestRef: string
  status: string
}): Promise<OperatorSourcingRequestDetail> {
  const nextStatus = cleanText(params.status, 40)
  if (!ALLOWED_SOURCING_REQUEST_STATUSES.has(nextStatus)) {
    throw new Error('Invalid sourcing request status')
  }

  const request = await queryOne<SourcingRequestRow>('SELECT * FROM sourcing_requests WHERE request_ref = $1 LIMIT 1', [cleanText(params.requestRef, 40)])
  if (!request) throw new Error('Sourcing request not found')

  await query(
    `UPDATE sourcing_requests SET status = $2, updated_at = NOW() WHERE id = $1`,
    [request.id, nextStatus]
  )

  const detail = await getOperatorSourcingRequestDetailByRef(request.request_ref)
  if (!detail) throw new Error('Updated sourcing request not found')
  return detail
}

function mapOperatorSourcingRequestRow(row: OperatorSourcingRequestRow): OperatorSourcingRequestSummary {
  return {
    id: row.id,
    requestRef: row.request_ref,
    cartId: row.cart_id,
    userId: row.user_id,
    sessionId: row.session_id,
    threadId: row.thread_id,
    status: row.status,
    source: row.source,
    note: row.note,
    contactEmail: row.contact_email,
    contactName: row.contact_name,
    company: row.company,
    itemCount: Number(row.item_count) || 0,
    estimatedSubtotalUsd: row.estimated_subtotal_usd == null ? null : Number(row.estimated_subtotal_usd),
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    orderRef: row.order_ref,
    orderStatus: row.order_status,
  }
}

function mapOperatorSourcingRequestItemRow(row: OperatorSourcingRequestItemRow): OperatorSourcingRequestItem {
  return {
    id: Number(row.id),
    sourcingRequestId: row.sourcing_request_id,
    cartItemId: row.cart_item_id,
    partId: row.part_id,
    listingId: row.listing_id,
    manufacturerName: row.manufacturer_name,
    manufacturerSlug: row.manufacturer_slug,
    partNumber: row.part_number,
    quantity: Number(row.quantity) || 0,
    supplierName: row.supplier_name,
    supplierSlug: row.supplier_slug,
    unitPriceUsd: row.unit_price_usd == null ? null : Number(row.unit_price_usd),
    lineTotalUsd: row.line_total_usd == null ? null : Number(row.line_total_usd),
    note: row.note,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
  }
}

const ALLOWED_SOURCING_REQUEST_STATUSES = new Set(['submitted', 'reviewing', 'quoted', 'closed'])
