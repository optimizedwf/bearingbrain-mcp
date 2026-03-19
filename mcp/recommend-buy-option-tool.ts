import { z } from 'zod'
import { UiPayloadSchema } from '@/mcp/ui-schema'
import { recommendBuyOptionForMcp } from '@/lib/parts-chat'

const RecommendationChoiceSchema = z.object({
  manufacturer: z.string(),
  partNumber: z.string(),
  priceUsd: z.number().nullable(),
  supplierName: z.string().nullable(),
  reason: z.string(),
  productUrl: z.string().nullable(),
})

const CatalogItemSchema = z.object({
  manufacturer: z.string(),
  manufacturerSlug: z.string().nullable(),
  partNumber: z.string(),
  partKind: z.string(),
  productUrl: z.string().nullable(),
  matchReason: z.string(),
  confidence: z.number(),
  bearingType: z.string().nullable(),
  sealType: z.string().nullable(),
  boreMm: z.number().nullable(),
  odMm: z.number().nullable(),
  widthMm: z.number().nullable(),
  bestPriceUsd: z.number().nullable(),
  bestSupplier: z.string().nullable(),
  bestAffiliateUrl: z.string().nullable(),
})

export const RecommendBuyOptionInputSchema = {
  query: z.string().min(1).max(400).describe('Bearing selection or procurement-guidance question, such as value-sensitive, OEM-safe, or replacement-preference guidance'),
}

export const RecommendBuyOptionOutputSchema = {
  query: z.string(),
  parsedIntent: z.string(),
  total: z.number().int(),
  reply: z.string(),
  shoppingIntent: z.enum(['value', 'premium', 'oem', 'fastest', 'general']),
  recommended: RecommendationChoiceSchema.nullable(),
  cheapestAcceptable: RecommendationChoiceSchema.nullable(),
  premiumOption: RecommendationChoiceSchema.nullable(),
  alternatives: z.array(RecommendationChoiceSchema),
  warnings: z.array(z.string()),
  question: z.string().optional(),
  candidateItems: z.array(CatalogItemSchema),
  ui: UiPayloadSchema,
}

export async function runRecommendBuyOptionMcpTool(args: { query: string }) {
  return await recommendBuyOptionForMcp(args.query)
}
