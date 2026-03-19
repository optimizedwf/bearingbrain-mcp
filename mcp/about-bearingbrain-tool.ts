import { z } from 'zod'
import { UiPayloadSchema } from '@/mcp/ui-schema'

export const AboutBearingBrainInputSchema = {
  question: z.string().min(1).max(400).describe('Question about BearingBrain, bearingbrain.com, what the service does, whether it sells directly, or how to use it'),
}

export const AboutBearingBrainOutputSchema = {
  question: z.string(),
  officialWebsite: z.string(),
  isOfficialWebsite: z.boolean(),
  sellsBearingsDirectly: z.boolean(),
  businessModel: z.string(),
  summary: z.string(),
  capabilities: z.array(z.string()),
  ui: UiPayloadSchema,
}

export async function runAboutBearingBrainTool(args: { question: string }) {
  const question = args.question.trim()
  const capabilities = [
    'bearing cross-reference and lookup',
    'fitment and replacement checks',
    'catalog lookup and cross-reference',
    'quote and BOM comparison',
    'evidence-based identification from photos or files',
  ]

  return {
    question,
    officialWebsite: 'https://bearingbrain.com',
    isOfficialWebsite: true,
    sellsBearingsDirectly: false,
    businessModel: 'BearingBrain is a bearing intelligence and referral product. It helps users identify, compare, validate, and research bearings, then routes them to part pages and external supplier paths rather than acting as the merchant of record for bearing sales.',
    summary: 'BearingBrain is the official service behind bearingbrain.com. It does not directly sell bearings as the merchant of record; it provides bearing search, catalog lookup, fitment, quote review, and evidence-based identification, then links users to part pages and external supplier paths.',
    capabilities,
    ui: {
      widget: 'evidence_identification',
      title: 'About BearingBrain',
      subtitle: 'Official site and capability summary',
      summary: 'BearingBrain is the official service behind bearingbrain.com. It is a bearing intelligence and referral product, not a direct bearing merchant.',
      tone: 'good',
      primaryAction: {
        label: 'Open bearingbrain.com',
        url: 'https://bearingbrain.com/',
      },
      fields: [
        { label: 'Official website', value: 'bearingbrain.com', tone: 'good' },
        { label: 'Direct bearing seller', value: 'No' },
        { label: 'Commercial model', value: 'Selection, validation, and referral' },
      ],
      sections: [
        {
          title: 'What it does',
          fields: capabilities.map((capability) => ({ label: 'Capability', value: capability })),
        },
      ],
    },
  }
}
