import { z } from "zod"

export const WidgetRenderTestInputSchema = {
  prompt: z.string().optional().describe("Optional text to echo into the diagnostic widget."),
}

export const WidgetRenderTestOutputSchema = {
  ok: z.boolean(),
  reply: z.string(),
  ui: z.object({
    widget: z.literal("render_test"),
    title: z.string(),
    subtitle: z.string().optional(),
    summary: z.string().optional(),
    tone: z.string().optional(),
    fields: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        tone: z.string().optional(),
      })
    ).optional(),
    primaryAction: z.object({
      label: z.string(),
      url: z.string(),
    }).optional(),
  }),
}

export type WidgetRenderTestOutput = {
  ok: boolean
  reply: string
  ui: {
    widget: 'render_test'
    title: string
    subtitle?: string
    summary?: string
    tone?: string
    fields?: Array<{ label: string; value: string; tone?: string }>
    primaryAction?: { label: string; url: string }
  }
}

export async function runWidgetRenderTestTool(input: { prompt?: string }): Promise<WidgetRenderTestOutput> {
  const echoed = input.prompt?.trim() || 'no prompt provided'
  return {
    ok: true,
    reply: `BearingBrain widget render test is ready. Echo: ${echoed}.`,
    ui: {
      widget: 'render_test',
      title: 'BearingBrain widget render test',
      subtitle: 'If you see a custom card, widget rendering works.',
      summary: 'This is a minimal diagnostic widget used to verify ChatGPT custom template rendering independently of bearing-search or shopping logic.',
      tone: 'info',
      fields: [
        { label: 'Status', value: 'Diagnostic tool executed', tone: 'success' },
        { label: 'Echo', value: echoed },
        { label: 'Template', value: 'ui://widget/bearingbrain-hero-v2.html' },
      ],
      primaryAction: {
        label: 'Open BearingBrain',
        url: 'https://bearingbrain.com/?utm_source=chatgpt-widget-test',
      },
    },
  }
}
