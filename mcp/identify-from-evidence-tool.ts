import { z } from 'zod'
import { UiPayloadSchema } from '@/mcp/ui-schema'
import { identifyFromEvidenceForMcp } from '@/lib/parts-chat'

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

export const IdentifyFromEvidenceInputSchema = {
  message: z.string().min(1).max(300).optional().describe('Optional user prompt, such as what bearing is this?'),
  evidenceSummary: z.string().min(1).max(4000).describe('Host-provided summary of what the image/file appears to show'),
  rewrittenQuery: z.string().min(1).max(300).describe('Catalog-friendly rewritten query extracted from the evidence'),
  confidence: z.number().min(0).max(1).optional().describe('Confidence in the evidence rewrite, between 0 and 1'),
}

export const IdentifyFromEvidenceOutputSchema = {
  message: z.string(),
  evidenceSummary: z.string(),
  rewrittenQuery: z.string(),
  confidence: z.number(),
  reply: z.string(),
  identified: CatalogItemSchema.nullable(),
  cheapestAcceptable: RecommendationChoiceSchema.nullable(),
  premiumOption: RecommendationChoiceSchema.nullable(),
  warnings: z.array(z.string()),
  ui: UiPayloadSchema,
}

export async function runIdentifyFromEvidenceMcpTool(args: {
  message?: string
  evidenceSummary: string
  rewrittenQuery: string
  confidence?: number
}) {
  return await identifyFromEvidenceForMcp(args)
}
