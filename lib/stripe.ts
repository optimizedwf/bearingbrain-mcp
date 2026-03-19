/**
 * stripe.ts — Stripe integration for BearingBrain Pro
 */
import Stripe from 'stripe'
import type { OrderItemRecord, OrderRecord } from '@/lib/orders'

const stripeKey = process.env.STRIPE_SECRET_KEY

export const stripe = stripeKey
  ? new Stripe(stripeKey)
  : null

export const PRO_MONTHLY_PRICE = 40000 // $400.00

/**
 * Create or get a Stripe customer for a user
 */
export async function getOrCreateCustomer(
  email: string,
  name?: string | null,
  existingCustomerId?: string | null
): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured')

  if (existingCustomerId) {
    try {
      await stripe.customers.retrieve(existingCustomerId)
      return existingCustomerId
    } catch {
      // Customer doesn't exist, create new
    }
  }

  const customer = await stripe.customers.create({
    email,
    name: name ?? undefined,
    metadata: { source: 'bearingbrain' },
  })

  return customer.id
}

/**
 * Create a Checkout Session for Pro subscription
 */
export async function createCheckoutSession(
  customerId: string,
  priceType: 'monthly' | 'yearly',
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured')

  const unitAmount = PRO_MONTHLY_PRICE
  const interval = 'month' as const

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'BearingBrain Pro',
            description: 'Monthly subscription — AI bearing engineer with unlimited calculations, fit recommendations, and engineering consultations',
          },
          unit_amount: unitAmount,
          recurring: { interval },
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: { source: 'bearingbrain' },
    },
  })

  return session.url!
}

/**
 * Create a Customer Portal session for managing subscription
 */
export async function createPortalSession(
  customerId: string,
  returnUrl: string
): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured')

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })

  return session.url
}


export async function createOrderCheckoutSession(params: {
  order: OrderRecord
  items: OrderItemRecord[]
  customerEmail?: string
}): Promise<{ id: string; url: string; customerId: string | null }> {
  if (!stripe) throw new Error('Stripe not configured')
  if (!params.items.length) throw new Error('Order has no line items')
  if (params.order.totalUsd <= 0) throw new Error('Order total must be greater than zero')

  const appUrl = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'https://bearingbrain.com').replace(/\/$/, '')
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: params.customerEmail,
    client_reference_id: params.order.orderRef,
    success_url: `${appUrl}/orders/${encodeURIComponent(params.order.orderRef)}?success=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/orders/${encodeURIComponent(params.order.orderRef)}?canceled=1`,
    metadata: {
      source: 'bearingbrain_parts_order',
      order_id: params.order.id,
      order_ref: params.order.orderRef,
    },
    line_items: buildOrderCheckoutLineItems(params.order, params.items),
  })

  if (!session.url) throw new Error('Stripe did not return a checkout URL')
  return {
    id: session.id,
    url: session.url,
    customerId: typeof session.customer === 'string' ? session.customer : null,
  }
}

function buildOrderCheckoutLineItems(order: OrderRecord, items: OrderItemRecord[]): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((item) => ({
    price_data: {
      currency: order.currency || 'usd',
      product_data: {
        name: [item.manufacturerName, item.partNumber].filter(Boolean).join(' '),
        description: [
          item.supplierName ? `Supplier: ${item.supplierName}` : null,
          item.note ? `Note: ${item.note}` : null,
        ].filter(Boolean).join(' · ') || undefined,
      },
      unit_amount: toStripeAmount(item.unitPriceUsd),
    },
    quantity: item.quantity,
  }))

  if (order.shippingUsd > 0) {
    lineItems.push({
      price_data: {
        currency: order.currency || 'usd',
        product_data: { name: 'Shipping' },
        unit_amount: toStripeAmount(order.shippingUsd),
      },
      quantity: 1,
    })
  }

  if (order.taxUsd > 0) {
    lineItems.push({
      price_data: {
        currency: order.currency || 'usd',
        product_data: { name: 'Tax' },
        unit_amount: toStripeAmount(order.taxUsd),
      },
      quantity: 1,
    })
  }

  return lineItems
}

function toStripeAmount(value: number): number {
  const amount = Math.round(Number(value) * 100)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid Stripe amount')
  return amount
}
