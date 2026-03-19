import { z } from 'zod'
import { UiPayloadSchema } from '@/mcp/ui-schema'
import { fitmentSanityCheckForMcp } from '@/lib/parts-chat'

export const FitmentSanityCheckInputSchema = {
  query: z.string().min(1).max(400).describe('Fitment or equivalence question comparing at least two candidate parts'),
}

export const FitmentSanityCheckOutputSchema = {
  query: z.string(),
  reply: z.string(),
  verdict: z.enum(['exact_match', 'direct_fit_likely', 'conditional_fit', 'not_validated', 'needs_confirmation']),
  warnings: z.array(z.string()),
  leftLabel: z.string(),
  rightLabel: z.string(),
  leftCatalogLabel: z.string(),
  rightCatalogLabel: z.string(),
  ui: UiPayloadSchema,
}

export async function runFitmentSanityCheckMcpTool(args: { query: string }) {
  return await fitmentSanityCheckForMcp(args.query)
}
