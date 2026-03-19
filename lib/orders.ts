import crypto from 'crypto'
import { query, queryOne, withTransaction } from '@/lib/db'

export interface OrderRecord {
  id: string
  orderRef: string
  sourcingRequestId: string
  cartId: string | null
  userId: number | null
  sessionId: string
  threadId: string | null
  status: string
  currency: string
  subtotalUsd: number
  shippingUsd: number
  taxUsd: number
  totalUsd: number
  note: string | null
  terms: string | null
  contactEmail: string | null
  contactName: string | null
  company: string | null
  stripeCheckoutSessionId: string | null
  stripePaymentIntentId: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderItemRecord {
  id: string
  orderId: string
  sourcingRequestItemId: number | null
  partId: number | null
  listingId: number | null
  manufacturerName: string | null
  manufacturerSlug: string | null
  partNumber: string
  quantity: number
  supplierName: string | null
  supplierSlug: string | null
  unitPriceUsd: number
  lineTotalUsd: number
  note: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface OrderPaymentRecord {
  id: string
  orderId: string
  provider: string
  status: string
  amountUsd: number
  currency: string
  stripeCheckoutSessionId: string | null
  stripePaymentIntentId: string | null
  stripeCustomerId: string | null
  checkoutUrl: string | null
  paidAt: string | null
  failedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderSummary {
  order: OrderRecord
  items: OrderItemRecord[]
  latestPayment: OrderPaymentRecord | null
}

export interface ViewerOrderListItem {
  id: string
  orderRef: string
  requestRef: string | null
  status: string
  paymentStatus: string | null
  totalUsd: number
  itemCount: number
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

interface OrderRow {
  id: string
  order_ref: string
  sourcing_request_id: string
  cart_id: string | null
  user_id: number | null
  session_id: string
  thread_id: string | null
  status: string
  currency: string
  subtotal_usd: number | string
  shipping_usd: number | string
  tax_usd: number | string
  total_usd: number | string
  note: string | null
  terms: string | null
  contact_email: string | null
  contact_name: string | null
  company: string | null
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  paid_at: string | null
  created_at: string
  updated_at: string
}

interface OrderItemRow {
  id: string
  order_id: string
  sourcing_request_item_id: number | string | null
  part_id: number | null
  listing_id: number | null
  manufacturer_name: string | null
  manufacturer_slug: string | null
  part_number: string
  quantity: number | string
  supplier_name: string | null
  supplier_slug: string | null
  unit_price_usd: number | string
  line_total_usd: number | string
  note: string | null
  metadata_json: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

interface OrderPaymentRow {
  id: string
  order_id: string
  provider: string
  status: string
  amount_usd: number | string
  currency: string
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_customer_id: string | null
  checkout_url: string | null
  paid_at: string | null
  failed_at: string | null
  created_at: string
  updated_at: string
}

interface ViewerOrderListRow {
  id: string
  order_ref: string
  request_ref: string | null
  status: string
  payment_status: string | null
  total_usd: number | string
  item_count: number | string
  paid_at: string | null
  created_at: string
  updated_at: string
}

interface SourcingRequestRow {
  id: string
  request_ref: string
  cart_id: string
  user_id: number | null
  session_id: string
  thread_id: string | null
  status: string
  note: string | null
  contact_email: string | null
  contact_name: string | null
  company: string | null
}

interface SourcingRequestItemRow {
  id: number | string
  sourcing_request_id: string
  part_id: number | null
  listing_id: number | null
  manufacturer_name: string | null
  manufacturer_slug: string | null
  part_number: string
  quantity: number | string
  supplier_name: string | null
  supplier_slug: string | null
  unit_price_usd: number | string | null
  note: string | null
  metadata_json: Record<string, unknown> | null
}

export interface AcceptedOrderItemInput {
  sourcingRequestItemId: number
  acceptedUnitPriceUsd?: number | null
  quantity?: number | null
  note?: string | null
}

export async function createAcceptedOrderFromSourcingRequest(params: {
  requestId?: string
  requestRef?: string
  shippingUsd?: number | null
  taxUsd?: number | null
  note?: string | null
  terms?: string | null
  items?: AcceptedOrderItemInput[]
  actor?: string | null
}): Promise<OrderSummary> {
  const request = await (params.requestId
    ? queryOne<SourcingRequestRow>('SELECT * FROM sourcing_requests WHERE id = $1', [params.requestId])
    : queryOne<SourcingRequestRow>('SELECT * FROM sourcing_requests WHERE request_ref = $1', [cleanText(params.requestRef ?? '', 40)]))

  if (!request) throw new Error('Sourcing request not found')

  const existing = await queryOne<OrderRow>('SELECT * FROM orders WHERE sourcing_request_id = $1 LIMIT 1', [request.id])
  if (existing) throw new Error(`Order already exists for ${request.request_ref}`)

  const requestItems = await query<SourcingRequestItemRow>(
    `SELECT * FROM sourcing_request_items WHERE sourcing_request_id = $1 ORDER BY created_at ASC`,
    [request.id]
  )
  if (!requestItems.length) throw new Error('Sourcing request has no line items')

  const overrideMap = new Map<number, AcceptedOrderItemInput>()
  for (const item of params.items ?? []) overrideMap.set(Number(item.sourcingRequestItemId), item)

  const normalizedItems = requestItems.map((item) => {
    const override = overrideMap.get(Number(item.id))
    const quantity = Math.max(1, Math.floor(Number(override?.quantity ?? item.quantity ?? 1)))
    const unitPriceUsd = normalizeMoney(override?.acceptedUnitPriceUsd ?? item.unit_price_usd)
    if (unitPriceUsd == null || unitPriceUsd <= 0) {
      throw new Error(`Accepted unit price is required for ${item.part_number}`)
    }
    return {
      sourcingRequestItemId: Number(item.id),
      partId: item.part_id,
      listingId: item.listing_id,
      manufacturerName: item.manufacturer_name,
      manufacturerSlug: item.manufacturer_slug,
      partNumber: item.part_number,
      quantity,
      supplierName: item.supplier_name,
      supplierSlug: item.supplier_slug,
      unitPriceUsd,
      lineTotalUsd: normalizeMoney(unitPriceUsd * quantity) ?? 0,
      note: cleanText(override?.note ?? item.note ?? '', 4000) || null,
      metadata: item.metadata_json ?? {},
    }
  })

  const subtotalUsd = normalizeMoney(normalizedItems.reduce((sum, item) => sum + item.lineTotalUsd, 0)) ?? 0
  const shippingUsd = normalizeMoney(params.shippingUsd ?? 0) ?? 0
  const taxUsd = normalizeMoney(params.taxUsd ?? 0) ?? 0
  const totalUsd = normalizeMoney(subtotalUsd + shippingUsd + taxUsd) ?? 0
  if (totalUsd <= 0) throw new Error('Accepted order total must be greater than zero')

  const orderId = crypto.randomUUID()
  const orderRef = buildOrderRef()
  const note = cleanText(params.note ?? request.note ?? '', 4000) || null
  const terms = cleanText(params.terms ?? '', 4000) || null
  const actor = cleanText(params.actor ?? 'operator', 80) || 'operator'

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO orders (
        id, order_ref, sourcing_request_id, cart_id, user_id, session_id, thread_id, status,
        currency, subtotal_usd, shipping_usd, tax_usd, total_usd,
        note, terms, contact_email, contact_name, company, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'payment_pending',
        'usd', $8, $9, $10, $11,
        $12, $13, $14, $15, $16, NOW(), NOW()
      )`,
      [
        orderId,
        orderRef,
        request.id,
        request.cart_id,
        request.user_id,
        request.session_id,
        request.thread_id,
        subtotalUsd,
        shippingUsd,
        taxUsd,
        totalUsd,
        note,
        terms,
        request.contact_email,
        request.contact_name,
        request.company,
      ]
    )

    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO order_items (
          id, order_id, sourcing_request_item_id, part_id, listing_id,
          manufacturer_name, manufacturer_slug, part_number, quantity,
          supplier_name, supplier_slug, unit_price_usd, line_total_usd,
          note, metadata_json, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15::jsonb, NOW(), NOW()
        )`,
        [
          crypto.randomUUID(),
          orderId,
          item.sourcingRequestItemId,
          item.partId,
          item.listingId,
          item.manufacturerName,
          item.manufacturerSlug,
          item.partNumber,
          item.quantity,
          item.supplierName,
          item.supplierSlug,
          item.unitPriceUsd,
          item.lineTotalUsd,
          item.note,
          JSON.stringify(item.metadata),
        ]
      )
    }

    await client.query(
      `UPDATE sourcing_requests SET status = 'quoted', updated_at = NOW() WHERE id = $1`,
      [request.id]
    )

    await appendOrderEventWithClient(client, orderId, 'order_created', actor, {
      requestRef: request.request_ref,
      subtotalUsd,
      shippingUsd,
      taxUsd,
      totalUsd,
    })
  })

  return await getOrderSummaryByRef(orderRef)
}

export async function getOrderSummaryByRef(orderRef: string): Promise<OrderSummary> {
  const order = await queryOne<OrderRow>('SELECT * FROM orders WHERE order_ref = $1', [cleanText(orderRef, 40)])
  if (!order) throw new Error('Order not found')
  return getOrderSummaryById(order.id)
}

export async function getOrderSummaryById(orderId: string): Promise<OrderSummary> {
  const order = await queryOne<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId])
  if (!order) throw new Error('Order not found')
  const items = await query<OrderItemRow>('SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC', [orderId])
  const latestPayment = await queryOne<OrderPaymentRow>(
    'SELECT * FROM order_payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
    [orderId]
  )
  return {
    order: mapOrderRow(order),
    items: items.map(mapOrderItemRow),
    latestPayment: latestPayment ? mapOrderPaymentRow(latestPayment) : null,
  }
}

export async function getOrderSummaryForViewer(params: {
  orderRef: string
  sessionId: string
  userId?: number | null
}): Promise<OrderSummary | null> {
  const order = await queryOne<OrderRow>(
    params.userId
      ? `SELECT * FROM orders WHERE order_ref = $1 AND (user_id = $2 OR session_id = $3) LIMIT 1`
      : `SELECT * FROM orders WHERE order_ref = $1 AND session_id = $2 LIMIT 1`,
    params.userId ? [cleanText(params.orderRef, 40), params.userId, params.sessionId] : [cleanText(params.orderRef, 40), params.sessionId]
  )
  if (!order) return null
  return getOrderSummaryById(order.id)
}


export async function listRecentOrdersForViewer(params: {
  sessionId: string
  userId?: number | null
  limit?: number
}): Promise<ViewerOrderListItem[]> {
  const limit = Math.max(1, Math.min(25, Math.floor(params.limit ?? 10)))
  const rows = await (params.userId
    ? query<ViewerOrderListRow>(
        `SELECT
           o.id,
           o.order_ref,
           sr.request_ref,
           o.status,
           p.status AS payment_status,
           o.total_usd,
           COUNT(oi.id) AS item_count,
           o.paid_at,
           o.created_at,
           o.updated_at
         FROM orders o
         LEFT JOIN sourcing_requests sr ON sr.id = o.sourcing_request_id
         LEFT JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN LATERAL (
           SELECT status
           FROM order_payments op
           WHERE op.order_id = o.id
           ORDER BY op.created_at DESC
           LIMIT 1
         ) p ON TRUE
         WHERE o.user_id = $1 OR o.session_id = $2
         GROUP BY o.id, sr.request_ref, p.status
         ORDER BY o.updated_at DESC
         LIMIT $3`,
        [params.userId, params.sessionId, limit]
      )
    : query<ViewerOrderListRow>(
        `SELECT
           o.id,
           o.order_ref,
           sr.request_ref,
           o.status,
           p.status AS payment_status,
           o.total_usd,
           COUNT(oi.id) AS item_count,
           o.paid_at,
           o.created_at,
           o.updated_at
         FROM orders o
         LEFT JOIN sourcing_requests sr ON sr.id = o.sourcing_request_id
         LEFT JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN LATERAL (
           SELECT status
           FROM order_payments op
           WHERE op.order_id = o.id
           ORDER BY op.created_at DESC
           LIMIT 1
         ) p ON TRUE
         WHERE o.session_id = $1
         GROUP BY o.id, sr.request_ref, p.status
         ORDER BY o.updated_at DESC
         LIMIT $2`,
        [params.sessionId, limit]
      ))

  return rows.map((row) => ({
    id: row.id,
    orderRef: row.order_ref,
    requestRef: row.request_ref,
    status: row.status,
    paymentStatus: row.payment_status,
    totalUsd: Number(row.total_usd) || 0,
    itemCount: Number(row.item_count) || 0,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function updateOrderStatusByRef(params: {
  orderRef: string
  status: string
  actor?: string | null
}): Promise<OrderSummary> {
  const nextStatus = cleanText(params.status, 40)
  if (!ALLOWED_ORDER_STATUSES.has(nextStatus)) {
    throw new Error('Invalid order status')
  }

  const order = await queryOne<OrderRow>('SELECT * FROM orders WHERE order_ref = $1 LIMIT 1', [cleanText(params.orderRef, 40)])
  if (!order) throw new Error('Order not found')

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE orders
       SET status = $2::text,
           updated_at = NOW(),
           paid_at = CASE WHEN $2::text = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END
       WHERE id = $1`,
      [order.id, nextStatus]
    )

    if (['fulfilled', 'cancelled'].includes(nextStatus)) {
      await client.query(
        `UPDATE sourcing_requests
         SET status = 'closed', updated_at = NOW()
         WHERE id = $1`,
        [order.sourcing_request_id]
      )
    }

    await appendOrderEventWithClient(client, order.id, 'order_status_updated', cleanText(params.actor ?? 'operator', 80) || 'operator', {
      previousStatus: order.status,
      nextStatus,
    })
  })

  return getOrderSummaryById(order.id)
}

export async function recordOrderCheckoutSession(params: {
  orderId: string
  checkoutSessionId: string
  checkoutUrl: string
  amountUsd: number
  currency?: string
  stripeCustomerId?: string | null
}) {
  const currency = cleanText(params.currency ?? 'usd', 8) || 'usd'
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE orders
       SET stripe_checkout_session_id = $2, updated_at = NOW(), status = CASE WHEN status = 'draft' THEN 'payment_pending' ELSE status END
       WHERE id = $1`,
      [params.orderId, params.checkoutSessionId]
    )

    await client.query(
      `INSERT INTO order_payments (
        id, order_id, provider, status, amount_usd, currency,
        stripe_checkout_session_id, stripe_customer_id, checkout_url, created_at, updated_at
      ) VALUES (
        $1, $2, 'stripe', 'pending', $3, $4,
        $5, $6, $7, NOW(), NOW()
      )`,
      [
        crypto.randomUUID(),
        params.orderId,
        normalizeMoney(params.amountUsd) ?? 0,
        currency,
        params.checkoutSessionId,
        params.stripeCustomerId ?? null,
        params.checkoutUrl,
      ]
    )

    await appendOrderEventWithClient(client, params.orderId, 'checkout_session_created', 'stripe', {
      checkoutSessionId: params.checkoutSessionId,
      amountUsd: normalizeMoney(params.amountUsd) ?? 0,
      currency,
    })
  })
}

export async function markOrderPaidFromStripeSession(params: {
  checkoutSessionId: string
  paymentIntentId?: string | null
  stripeCustomerId?: string | null
}) {
  const payment = await queryOne<OrderPaymentRow>(
    'SELECT * FROM order_payments WHERE stripe_checkout_session_id = $1 LIMIT 1',
    [params.checkoutSessionId]
  )
  if (!payment) return null

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE order_payments
       SET status = 'paid',
           stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
           stripe_customer_id = COALESCE($3, stripe_customer_id),
           paid_at = NOW(),
           updated_at = NOW()
       WHERE stripe_checkout_session_id = $1`,
      [params.checkoutSessionId, params.paymentIntentId ?? null, params.stripeCustomerId ?? null]
    )

    await client.query(
      `UPDATE orders
       SET status = 'paid',
           stripe_checkout_session_id = COALESCE($2, stripe_checkout_session_id),
           stripe_payment_intent_id = COALESCE($3, stripe_payment_intent_id),
           paid_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [payment.order_id, params.checkoutSessionId, params.paymentIntentId ?? null]
    )

    await appendOrderEventWithClient(client, payment.order_id, 'payment_paid', 'stripe', {
      checkoutSessionId: params.checkoutSessionId,
      paymentIntentId: params.paymentIntentId ?? null,
    })
  })

  return getOrderSummaryById(payment.order_id)
}

export async function markOrderCheckoutExpired(checkoutSessionId: string) {
  const payment = await queryOne<OrderPaymentRow>(
    'SELECT * FROM order_payments WHERE stripe_checkout_session_id = $1 LIMIT 1',
    [checkoutSessionId]
  )
  if (!payment) return null

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE order_payments SET status = 'expired', updated_at = NOW() WHERE stripe_checkout_session_id = $1`,
      [checkoutSessionId]
    )
    await appendOrderEventWithClient(client, payment.order_id, 'checkout_session_expired', 'stripe', {
      checkoutSessionId,
    })
  })

  return getOrderSummaryById(payment.order_id)
}

export async function markOrderPaymentFailedFromStripeIntent(params: {
  paymentIntentId: string
}) {
  const payment = await queryOne<OrderPaymentRow>(
    'SELECT * FROM order_payments WHERE stripe_payment_intent_id = $1 LIMIT 1',
    [params.paymentIntentId]
  )
  if (!payment) return null

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE order_payments SET status = 'failed', failed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [payment.id]
    )
    await appendOrderEventWithClient(client, payment.order_id, 'payment_failed', 'stripe', {
      paymentIntentId: params.paymentIntentId,
    })
  })

  return getOrderSummaryById(payment.order_id)
}

async function appendOrderEventWithClient(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  orderId: string,
  eventName: string,
  actor: string | null,
  payload: Record<string, unknown>
) {
  await client.query(
    `INSERT INTO order_events (order_id, event_name, actor, payload_json, created_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())`,
    [orderId, cleanText(eventName, 80), cleanText(actor ?? '', 80) || null, JSON.stringify(payload ?? {})]
  )
}

function buildOrderRef() {
  const date = new Date()
  const stamp = [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('')
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `BBO-${stamp}-${suffix}`
}

function cleanText(value: string, limit: number): string {
  return String(value ?? '').trim().slice(0, limit)
}

function normalizeMoney(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null
}


const ALLOWED_ORDER_STATUSES = new Set([
  'draft',
  'payment_pending',
  'paid',
  'processing',
  'fulfilled',
  'cancelled',
])

function mapOrderRow(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    orderRef: row.order_ref,
    sourcingRequestId: row.sourcing_request_id,
    cartId: row.cart_id,
    userId: row.user_id,
    sessionId: row.session_id,
    threadId: row.thread_id,
    status: row.status,
    currency: row.currency,
    subtotalUsd: Number(row.subtotal_usd) || 0,
    shippingUsd: Number(row.shipping_usd) || 0,
    taxUsd: Number(row.tax_usd) || 0,
    totalUsd: Number(row.total_usd) || 0,
    note: row.note,
    terms: row.terms,
    contactEmail: row.contact_email,
    contactName: row.contact_name,
    company: row.company,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapOrderItemRow(row: OrderItemRow): OrderItemRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    sourcingRequestItemId: row.sourcing_request_item_id == null ? null : Number(row.sourcing_request_item_id),
    partId: row.part_id,
    listingId: row.listing_id,
    manufacturerName: row.manufacturer_name,
    manufacturerSlug: row.manufacturer_slug,
    partNumber: row.part_number,
    quantity: Number(row.quantity) || 0,
    supplierName: row.supplier_name,
    supplierSlug: row.supplier_slug,
    unitPriceUsd: Number(row.unit_price_usd) || 0,
    lineTotalUsd: Number(row.line_total_usd) || 0,
    note: row.note,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapOrderPaymentRow(row: OrderPaymentRow): OrderPaymentRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    provider: row.provider,
    status: row.status,
    amountUsd: Number(row.amount_usd) || 0,
    currency: row.currency,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeCustomerId: row.stripe_customer_id,
    checkoutUrl: row.checkout_url,
    paidAt: row.paid_at,
    failedAt: row.failed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
