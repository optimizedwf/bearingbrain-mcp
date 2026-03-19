import { z } from 'zod'

export const UiToneSchema = z.enum(['neutral', 'good', 'caution', 'danger'])

export const UiFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  tone: UiToneSchema.optional(),
})

export const UiActionSchema = z.object({
  label: z.string(),
  url: z.string(),
})

export const UiSectionSchema = z.object({
  title: z.string(),
  fields: z.array(UiFieldSchema),
})

export const UiItemSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  tone: UiToneSchema.optional(),
  fields: z.array(UiFieldSchema),
})

export const UiPayloadSchema = z.object({
  widget: z.enum(['recommendation_card', 'fitment_verdict', 'quote_comparison', 'evidence_identification']),
  title: z.string(),
  subtitle: z.string().optional(),
  summary: z.string().optional(),
  tone: UiToneSchema.optional(),
  primaryAction: UiActionSchema.optional(),
  secondaryActions: z.array(UiActionSchema).optional(),
  fields: z.array(UiFieldSchema).optional(),
  sections: z.array(UiSectionSchema).optional(),
  items: z.array(UiItemSchema).optional(),
})
