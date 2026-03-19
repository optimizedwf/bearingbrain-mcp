import { z } from 'zod'
import { UiPayloadSchema } from '@/mcp/ui-schema'
import { compareQuoteOrBomForMcp } from '@/lib/parts-chat'

const RecommendationChoiceSchema = z.object({
  manufacturer: z.string(),
  partNumber: z.string(),
  priceUsd: z.number().nullable(),
  supplierName: z.string().nullable(),
  reason: z.string(),
  productUrl: z.string().nullable(),
})

const QuoteComparisonLineItemSchema = z.object({
  sourceLine: z.string(),
  quotedManufacturer: z.string().nullable(),
  quotedPartNumber: z.string(),
  quotedPriceUsd: z.number().nullable(),
  matchedManufacturer: z.string().nullable(),
  matchedPartNumber: z.string().nullable(),
  matchedSupplier: z.string().nullable(),
  matchedPriceUsd: z.number().nullable(),
  cheapestAcceptable: RecommendationChoiceSchema.nullable(),
  premiumOption: RecommendationChoiceSchema.nullable(),
  warnings: z.array(z.string()),
})

export const CompareQuoteOrBomInputSchema = {
  sourceText: z.string().min(1).max(12000).describe('Quote or BOM text, including part numbers and optional prices'),
  message: z.string().min(1).max(300).optional().describe('Optional user framing, such as keep OEM-safe or optimize cost'),
}

export const CompareQuoteOrBomOutputSchema = {
  message: z.string(),
  sourceText: z.string(),
  reply: z.string(),
  itemCount: z.number().int(),
  items: z.array(QuoteComparisonLineItemSchema),
  warnings: z.array(z.string()),
  question: z.string().optional(),
  ui: UiPayloadSchema,
}

export async function runCompareQuoteOrBomMcpTool(args: { sourceText: string; message?: string }) {
  return await compareQuoteOrBomForMcp(args)
}
