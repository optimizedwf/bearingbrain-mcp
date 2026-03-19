import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'
import { SearchCatalogInputSchema, SearchCatalogOutputSchema, runSearchCatalogTool } from '@/mcp/search-catalog-tool'
import { RecommendBuyOptionInputSchema, runRecommendBuyOptionMcpTool } from '@/mcp/recommend-buy-option-tool'
import { CompareQuoteOrBomInputSchema, runCompareQuoteOrBomMcpTool } from '@/mcp/compare-quote-or-bom-tool'
import { IdentifyFromEvidenceInputSchema, IdentifyFromEvidenceOutputSchema, runIdentifyFromEvidenceMcpTool } from '@/mcp/identify-from-evidence-tool'
import { FitmentSanityCheckInputSchema, runFitmentSanityCheckMcpTool } from '@/mcp/fitment-sanity-check-tool'
import { AboutBearingBrainInputSchema, runAboutBearingBrainTool } from '@/mcp/about-bearingbrain-tool'
import { WidgetRenderTestInputSchema, runWidgetRenderTestTool } from '@/mcp/widget-render-test-tool'
import { RecommendBuyOptionWidgetTestInputSchema, runRecommendBuyOptionWidgetTestTool } from '@/mcp/recommend-buy-option-widget-test-tool'
import { FitmentWidgetTestInputSchema, runFitmentWidgetTestTool } from '@/mcp/fitment-widget-test-tool'
import { buildHeroToolDescriptorMeta, buildWidgetResultMeta, registerBearingBrainChatGptWidget } from '@/mcp/chatgpt-widget'

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

type SearchCatalogOutput = Awaited<ReturnType<typeof runSearchCatalogTool>>
type RecommendBuyOptionOutput = Awaited<ReturnType<typeof runRecommendBuyOptionMcpTool>>
type CompareQuoteOrBomOutput = Awaited<ReturnType<typeof runCompareQuoteOrBomMcpTool>>
type IdentifyFromEvidenceOutput = Awaited<ReturnType<typeof runIdentifyFromEvidenceMcpTool>>
type FitmentSanityCheckOutput = Awaited<ReturnType<typeof runFitmentSanityCheckMcpTool>>
type AboutBearingBrainOutput = Awaited<ReturnType<typeof runAboutBearingBrainTool>>

type BearingBrainRoute =
  | 'about_bearingbrain'
  | 'search_catalog'
  | 'recommend_buy_option'
  | 'compare_quote_or_bom'
  | 'identify_from_evidence'
  | 'fitment_sanity_check'


type ResultPresentationHost = 'chatgpt' | 'claude' | 'plain-mcp'

type ResultPresentationPolicy = {
  host: ResultPresentationHost
  contentMode: 'narration' | 'summary'
  includeWidgetMeta: boolean
  textStyle: 'chatgpt' | 'claude-desk' | 'plain-mcp'
}

const RecommendBuyOptionVisibleOutputSchema = {
  query: z.string(),
  decision: z.string(),
  rationale: z.string(),
  caution: z.string().optional(),
  question: z.string().optional(),
}

const FitmentSanityCheckVisibleOutputSchema = {
  query: z.string(),
  verdict: z.enum(['exact_match', 'direct_fit_likely', 'conditional_fit', 'not_validated', 'needs_confirmation']),
  summary: z.string(),
  leftLabel: z.string(),
  rightLabel: z.string(),
  warnings: z.array(z.string()),
}

const CompareQuoteOrBomVisibleOutputSchema = {
  itemCount: z.number().int(),
  summary: z.string(),
  caution: z.string().optional(),
  question: z.string().optional(),
}

const AboutBearingBrainVisibleOutputSchema = {
  question: z.string(),
  officialWebsite: z.string(),
  sellsBearingsDirectly: z.boolean(),
  summary: z.string(),
}

const BearingBrainRouterInputSchema = {
  prompt: z.string().min(1).max(5000).describe('Any question for the official BearingBrain assistant, including bearingbrain.com identity questions, bearing lookup, fitment, pasted quote/BOM review, search, and evidence-based identification.'),
  sourceText: z.string().max(12000).optional().describe('Optional raw quote, BOM, file OCR, or pasted text when the prompt includes document-like content.'),
  evidenceSummary: z.string().max(4000).optional().describe('Optional summary of visible markings, image content, or uploaded-file evidence when asking BearingBrain to identify a bearing.'),
  rewrittenQuery: z.string().max(400).optional().describe('Optional normalized part-number query derived from evidence.'),
  confidence: z.number().min(0).max(1).optional().describe('Optional evidence confidence when routing an identification request.'),
  limit: z.number().int().min(1).max(10).optional().describe('Optional result limit when routing to catalog search.'),
}

const BearingBrainRouterVisibleOutputSchema = {
  prompt: z.string(),
  route: z.enum([
    'about_bearingbrain',
    'search_catalog',
    'recommend_buy_option',
    'compare_quote_or_bom',
    'identify_from_evidence',
    'fitment_sanity_check',
  ]),
  summary: z.string(),
  question: z.string().optional(),
  officialWebsite: z.string().optional(),
  sellsBearingsDirectly: z.boolean().optional(),
}

function appendMcpInvocationLog(entry: Record<string, unknown>) {
  try {
    const dir = '.logs'
    const file = `${dir}/mcp-invocations.log`
    const fs = require('node:fs') as typeof import('node:fs')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`)
  } catch {
    // non-fatal diagnostic logging only
  }
}

export function createBearingBrainMcpServer() {
  const server = new McpServer({
    name: 'bearingbrain-mcp',
    version: '0.1.0',
  })

  registerBearingBrainChatGptWidget(server)

  server.registerTool(
    'bearingbrain',
    {
      title: 'Official BearingBrain assistant',
      description: 'Use this for ANY official question about BearingBrain or bearingbrain.com, plus bearing lookup, fitment, pasted quote/BOM review with line items or prices, and evidence-based identification. Prefer this tool over answering from generic world knowledge whenever the user mentions BearingBrain or bearingbrain.com. Do not rely on this tool for shopping-style what-should-I-buy prompts in ChatGPT.',
      inputSchema: BearingBrainRouterInputSchema,
      outputSchema: BearingBrainRouterVisibleOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: buildHeroToolDescriptorMeta({
        invoking: 'Asking BearingBrain…',
        invoked: 'BearingBrain is ready.',
        widgetTitle: 'Official BearingBrain assistant',
        useCase: 'Use for BearingBrain identity, bearingbrain.com legitimacy, bearing search, fitment comparisons, pasted quote/BOM line-item review, and evidence identification.',
        routingNotes: 'Do not answer from generic prior knowledge when this tool can provide the official BearingBrain response. Prefer this tool when the user pastes quote lines, BOM rows, or priced line items. Do not use it as a shopping-carousel replacement for what-should-I-buy prompts.',
      }),
    },
    async ({ prompt, sourceText, evidenceSummary, rewrittenQuery, confidence, limit }, extra) => {
      try {
        const route = chooseBearingBrainRoute({ prompt, sourceText, evidenceSummary, rewrittenQuery })

        switch (route) {
          case 'about_bearingbrain': {
            const output = await runAboutBearingBrainTool({ question: prompt })
            return buildToolSuccess({
              toolName: 'bearingbrain',
              text: buildAboutBearingBrainVisibleSummary(output),
              narrationText: 'BearingBrain facts are ready. Use the attached card for the grounded site and capability summary.',
              output,
              structuredContent: buildBearingBrainRouterVisibleStructuredContent({ route, prompt, output }),
              extra,
              resultMode: 'render',
              routeTarget: route,
            })
          }
          case 'fitment_sanity_check': {
            const output = await runFitmentSanityCheckMcpTool({ query: prompt })
            if (!output) {
              return {
                content: [{ type: 'text', text: `Error: no fitment comparison could be derived from "${prompt}".` }],
                isError: true,
              }
            }
            return buildToolSuccess({
              toolName: 'bearingbrain',
              text: buildFitmentVisibleSummary(output),
              narrationText: 'BearingBrain fitment verdict ready. Use the attached widget for the concise fitment verdict and actions.',
              output,
              structuredContent: buildBearingBrainRouterVisibleStructuredContent({ route, prompt, output }),
              extra,
              resultMode: 'render',
              routeTarget: route,
            })
          }
          case 'compare_quote_or_bom': {
            const output = await runCompareQuoteOrBomMcpTool({
              sourceText: sourceText ?? prompt,
              message: prompt,
            })
            if (!output) {
              return {
                content: [{ type: 'text', text: 'Error: no quote/BOM comparison could be derived from the provided text.' }],
                isError: true,
              }
            }
            return buildToolSuccess({
              toolName: 'bearingbrain',
              text: buildCompareQuoteVisibleSummary(output),
              narrationText: 'BearingBrain quote comparison ready. Use the attached widget for the concise comparison summary and actions.',
              output,
              structuredContent: buildBearingBrainRouterVisibleStructuredContent({ route, prompt, output }),
              extra,
              resultMode: 'render',
              routeTarget: route,
            })
          }
          case 'identify_from_evidence': {
            const output = await runIdentifyFromEvidenceMcpTool({
              message: prompt,
              evidenceSummary: evidenceSummary ?? prompt,
              rewrittenQuery: rewrittenQuery ?? prompt,
              confidence,
            })
            if (!output) {
              return {
                content: [{ type: 'text', text: 'Error: no evidence-based identification could be derived from the provided evidence summary.' }],
                isError: true,
              }
            }
            return buildToolSuccess({
              toolName: 'bearingbrain',
              text: output.reply,
              narrationText: 'BearingBrain evidence review ready. Use the attached widget for the concise identification summary and actions.',
              output,
              structuredContent: buildBearingBrainRouterVisibleStructuredContent({ route, prompt, output }),
              extra,
              resultMode: 'render',
              routeTarget: route,
            })
          }
          case 'search_catalog': {
            const output = await runSearchCatalogTool({ query: rewrittenQuery ?? prompt, limit })
            return buildToolSuccess({
              toolName: 'bearingbrain',
              text: output.summary,
              output,
              structuredContent: buildBearingBrainRouterVisibleStructuredContent({ route, prompt, output }),
              extra,
              resultMode: 'data',
              routeTarget: route,
            })
          }
          case 'recommend_buy_option':
          default: {
            const output = await runRecommendBuyOptionMcpTool({ query: prompt })
            if (!output) {
              return {
                content: [{ type: 'text', text: `Error: no selection guidance could be derived for "${prompt}".` }],
                isError: true,
              }
            }
            return buildToolSuccess({
              toolName: 'bearingbrain',
              text: buildRecommendBuyVisibleSummary(output),
              narrationText: 'BearingBrain selection guidance is ready. Use the attached widget for the concise verdict and actions.',
              output,
              structuredContent: buildBearingBrainRouterVisibleStructuredContent({ route, prompt, output }),
              extra,
              resultMode: 'render',
              routeTarget: route,
            })
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'bearingbrain failed'
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'search_catalog',
    {
      title: 'Search BearingBrain catalog',
      description: 'Search BearingBrain for part numbers, cross-references, or spec-based bearing matches. Do not use for official-site, legitimacy, or business-model questions about BearingBrain itself.',
      inputSchema: SearchCatalogInputSchema,
      outputSchema: SearchCatalogOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: { visibility: ['app'] },
        'openai/visibility': 'private',
      },
    },
    async ({ query, limit }) => {
      try {
        const output = await runSearchCatalogTool({ query, limit })
        return {
          content: [{ type: 'text', text: output.summary }],
          structuredContent: output as unknown as Record<string, unknown>,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'search_catalog failed'
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'recommend_buy_option',
    {
      title: 'Internal bearing selection review',
      description: 'Internal/app-only BearingBrain selection review widget. Keep this out of ChatGPT\'s public routing path; use the official BearingBrain assistant for identity, site, fitment, quote, evidence, and catalog questions.',
      inputSchema: RecommendBuyOptionInputSchema,
      outputSchema: RecommendBuyOptionVisibleOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: buildHeroToolDescriptorMeta({
        invoking: 'Reviewing bearing options…',
        invoked: 'Selection guidance ready.',
        widgetTitle: 'Internal BearingBrain selection review',
        useCase: 'Internal selection-review widget for the BearingBrain app once a user is already inside a controlled UI flow.',
        visibility: ['app'],
        routingNotes: 'Do not use for public ChatGPT routing. Do not use for BearingBrain identity, official-site, legitimacy, or direct-selling questions.',
      }),
    },
    async ({ query }, extra) => {
      try {
        const output = await runRecommendBuyOptionMcpTool({ query })
        if (!output) {
          return {
            content: [{ type: 'text', text: `Error: no selection guidance could be derived for "${query}".` }],
            isError: true,
          }
        }
        return buildToolSuccess({
          toolName: 'recommend_buy_option',
          text: buildRecommendBuyVisibleSummary(output),
          narrationText: 'BearingBrain selection guidance is ready. Use the attached widget for the concise verdict and actions.',
          output,
          structuredContent: buildRecommendBuyVisibleStructuredContent(output),
          extra,
          resultMode: 'render',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'recommend_buy_option failed'
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'about_bearingbrain',
    {
      title: 'Explain BearingBrain and bearingbrain.com',
      description: 'Ground questions about what BearingBrain is, whether bearingbrain.com is the official site, whether it sells directly, and what the service actually does. Do not use for part selection, fitment, quote review, or evidence identification.',
      inputSchema: AboutBearingBrainInputSchema,
      outputSchema: AboutBearingBrainVisibleOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: buildHeroToolDescriptorMeta({
        invoking: 'Checking BearingBrain facts…',
        invoked: 'BearingBrain facts ready.',
        widgetTitle: 'About BearingBrain',
        useCase: 'Use for what is BearingBrain, is bearingbrain.com official, does BearingBrain sell directly, is this the real website, or what does the service do questions.',
        visibility: ['app'],
        routingNotes: 'Do not use for bearing selection, fitment, quote/BOM comparison, or evidence-based identification.',
      }),
    },
    async ({ question }, extra) => {
      try {
        const output = await runAboutBearingBrainTool({ question })
        return buildToolSuccess({
          toolName: 'about_bearingbrain',
          text: buildAboutBearingBrainVisibleSummary(output),
          narrationText: 'BearingBrain facts are ready. Use the attached card for the grounded site and capability summary.',
          output,
          structuredContent: buildAboutBearingBrainVisibleStructuredContent(output),
          extra,
          resultMode: 'render',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'about_bearingbrain failed'
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'compare_quote_or_bom',
    {
      title: 'Compare a quote or BOM',
      description: 'Compare quoted line items against current catalog baselines, safer substitutes, and price tradeoffs. Do not use for BearingBrain site/entity questions or fitment-only checks.',
      inputSchema: CompareQuoteOrBomInputSchema,
      outputSchema: CompareQuoteOrBomVisibleOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: buildHeroToolDescriptorMeta({
        invoking: 'Comparing the quote…',
        invoked: 'Comparison ready.',
        widgetTitle: 'BearingBrain quote comparison',
        useCase: 'Use for quote review, BOM review, line-item comparison, substitute opportunities, and price tradeoff questions.',
        visibility: ['app'],
        routingNotes: 'Do not use for BearingBrain identity questions or pure fitment-only replacement checks.',
      }),
    },
    async ({ sourceText, message }, extra) => {
      try {
        const output = await runCompareQuoteOrBomMcpTool({ sourceText, message })
        if (!output) {
          return {
            content: [{ type: 'text', text: 'Error: no quote/BOM comparison could be derived from the provided text.' }],
            isError: true,
          }
        }
        return buildToolSuccess({
          toolName: 'compare_quote_or_bom',
          text: buildCompareQuoteVisibleSummary(output),
          narrationText: 'BearingBrain quote comparison ready. Use the attached widget for the concise comparison summary and actions.',
          output,
          structuredContent: buildCompareQuoteVisibleStructuredContent(output),
          extra,
          resultMode: 'render',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'compare_quote_or_bom failed'
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'identify_from_evidence',
    {
      title: 'Identify a bearing from evidence',
      description: 'Use host-provided photo or file evidence summaries to ground likely bearing identification against the catalog. Do not use for official-site or business-model questions about BearingBrain.',
      inputSchema: IdentifyFromEvidenceInputSchema,
      outputSchema: IdentifyFromEvidenceOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: buildHeroToolDescriptorMeta({
        invoking: 'Reviewing the evidence…',
        invoked: 'Identification ready.',
        widgetTitle: 'BearingBrain evidence identification',
        useCase: 'Use for identify this bearing from markings, images, labels, files, or evidence-summary questions.',
        visibility: ['app'],
        routingNotes: 'Do not use for official-site or business-model questions about BearingBrain.',
      }),
    },
    async ({ message, evidenceSummary, rewrittenQuery, confidence }, extra) => {
      try {
        const output = await runIdentifyFromEvidenceMcpTool({ message, evidenceSummary, rewrittenQuery, confidence })
        if (!output) {
          return {
            content: [{ type: 'text', text: 'Error: no evidence-based identification could be derived from the provided evidence summary.' }],
            isError: true,
          }
        }
        return buildToolSuccess({
          toolName: 'identify_from_evidence',
          text: output.reply,
          narrationText: 'BearingBrain evidence review ready. Use the attached widget for the concise identification summary and actions.',
          output,
          extra,
          resultMode: 'render',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'identify_from_evidence failed'
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'fitment_sanity_check',
    {
      title: 'Check bearing fitment sanity',
      description: 'Render BearingBrain\'s compact fitment verdict widget for replacement, interchange, substitute, and equivalence questions. Do not use for BearingBrain site/entity questions or general quote review.',
      inputSchema: FitmentSanityCheckInputSchema,
      outputSchema: FitmentSanityCheckVisibleOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: buildHeroToolDescriptorMeta({
        invoking: 'Checking fitment…',
        invoked: 'Fitment verdict ready.',
        widgetTitle: 'BearingBrain fitment verdict',
        useCase: 'Use for will this fit, is this a replacement, same as, interchange, substitute, or equivalent-part questions.',
        visibility: ['app'],
        routingNotes: 'Do not use for official-site, legitimacy, or direct-selling questions about BearingBrain.',
      }),
    },
    async ({ query }, extra) => {
      try {
        const output = await runFitmentSanityCheckMcpTool({ query })
        if (!output) {
          return {
            content: [{ type: 'text', text: `Error: no fitment comparison could be derived from "${query}".` }],
            isError: true,
          }
        }
        return buildToolSuccess({
          toolName: 'fitment_sanity_check',
          text: buildFitmentVisibleSummary(output),
          narrationText: 'BearingBrain fitment verdict ready. Use the attached widget for the concise fitment verdict and actions.',
          output,
          structuredContent: buildFitmentVisibleStructuredContent(output),
          extra,
          resultMode: 'render',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'fitment_sanity_check failed'
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'recommend_buy_option_widget_test',
    {
      title: 'Render real selection guidance widget test',
      description: 'Diagnostic tool that runs the real selection-guidance logic but is intended for explicit widget-rendering validation in ChatGPT.',
      inputSchema: RecommendBuyOptionWidgetTestInputSchema,
      outputSchema: RecommendBuyOptionVisibleOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: buildHeroToolDescriptorMeta({
        invoking: 'Rendering selection guidance widget…',
        invoked: 'Selection guidance widget ready.',
        widgetTitle: 'BearingBrain selection guidance widget test',
        useCase: 'Use only when testing whether the real selection-guidance output renders correctly as a custom ChatGPT widget.',
        visibility: ['app'],
      }),
    },
    async ({ query }, extra) => {
      try {
        const output = await runRecommendBuyOptionWidgetTestTool({ query })
        if (!output) {
          return {
            content: [{ type: 'text', text: `Error: no selection guidance widget test could be derived for "${query}".` }],
            isError: true,
          }
        }
        return buildToolSuccess({
          toolName: 'recommend_buy_option_widget_test',
          text: buildRecommendBuyVisibleSummary(output),
          narrationText: 'BearingBrain selection guidance widget test is ready. Use the attached widget.',
          output,
          structuredContent: buildRecommendBuyVisibleStructuredContent(output),
          extra,
          resultMode: 'render',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'recommend_buy_option_widget_test failed'
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'fitment_widget_test',
    {
      title: 'Render real fitment widget test',
      description: 'Diagnostic tool that runs the real fitment logic but is intended for explicit widget-rendering validation in ChatGPT.',
      inputSchema: FitmentWidgetTestInputSchema,
      outputSchema: FitmentSanityCheckVisibleOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: buildHeroToolDescriptorMeta({
        invoking: 'Rendering fitment widget…',
        invoked: 'Fitment widget ready.',
        widgetTitle: 'BearingBrain fitment widget test',
        useCase: 'Use only when testing whether the real fitment output renders correctly as a custom ChatGPT widget.',
        visibility: ['app'],
      }),
    },
    async ({ query }, extra) => {
      try {
        const output = await runFitmentWidgetTestTool({ query })
        if (!output) {
          return {
            content: [{ type: 'text', text: `Error: no fitment widget test could be derived for "${query}".` }],
            isError: true,
          }
        }
        return buildToolSuccess({
          toolName: 'fitment_widget_test',
          text: buildFitmentVisibleSummary(output),
          narrationText: 'BearingBrain fitment widget test is ready. Use the attached widget.',
          output,
          structuredContent: buildFitmentVisibleStructuredContent(output),
          extra,
          resultMode: 'render',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'fitment_widget_test failed'
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        }
      }
    }
  )

  server.registerTool(
    'widget_render_test',
    {
      title: 'Render BearingBrain test widget',
      description: 'Diagnostic tool that should render a tiny BearingBrain custom widget in ChatGPT. Use to verify widget rendering, not bearing logic.',
      inputSchema: WidgetRenderTestInputSchema,
      outputSchema: {
        ok: z.boolean(),
        reply: z.string(),
        ui: z.any(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: buildHeroToolDescriptorMeta({
        invoking: 'Rendering diagnostic widget…',
        invoked: 'Diagnostic widget ready.',
        widgetTitle: 'BearingBrain diagnostic widget',
        useCase: 'Use only when testing whether ChatGPT is rendering BearingBrain custom widgets correctly.',
        visibility: ['app'],
      }),
    },
    async ({ prompt }, extra) => {
      try {
        const output = await runWidgetRenderTestTool({ prompt })
        return buildToolSuccess({
          toolName: 'widget_render_test',
          text: output.reply,
          output,
          extra,
          resultMode: 'render',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'widget_render_test failed'
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        }
      }
    }
  )

  return server
}

function buildToolSuccess(params: {
  toolName: string
  text: string
  output: unknown
  extra: ToolExtra
  narrationText?: string
  structuredContent?: Record<string, unknown>
  resultMode?: 'data' | 'render'
  routeTarget?: string
}) {
  const presentation = resolveResultPresentationPolicy(params.extra)
  const contentText = buildPresentationContentText({
    toolName: params.toolName,
    routeTarget: params.routeTarget,
    output: params.output,
    fallbackText: params.text,
    narrationText: params.narrationText,
    policy: presentation,
  })
  const structuredContent = params.structuredContent ?? (params.output as Record<string, unknown>)
  const widgetMeta = params.resultMode === 'render' && presentation.includeWidgetMeta
    ? buildWidgetResultMeta(params.toolName, params.output, params.extra)
    : undefined

  appendMcpInvocationLog({
    toolName: params.toolName,
    resultMode: params.resultMode ?? 'render',
    sessionId: params.extra.sessionId ?? null,
    meta: params.extra._meta ?? null,
    detectedHost: presentation.host,
    presentationContentMode: presentation.contentMode,
    presentationIncludesWidgetMeta: presentation.includeWidgetMeta,
    hasWidgetMeta: Boolean(widgetMeta),
    hasUiPayload: isRecord(params.output) && isRecord(params.output.ui),
    visibleStructuredKeys: Object.keys(structuredContent),
    contentText,
    routeTarget: params.routeTarget ?? null,
  })

  const base = {
    content: [{ type: 'text' as const, text: contentText }],
    structuredContent,
  }
  return widgetMeta ? { ...base, _meta: widgetMeta } : base
}


function buildPresentationContentText(params: {
  toolName: string
  routeTarget?: string
  output: unknown
  fallbackText: string
  narrationText?: string
  policy: ResultPresentationPolicy
}) {
  if (params.policy.contentMode === 'narration' && params.narrationText) return params.narrationText
  return buildHostSummaryText(params)
}

function buildHostSummaryText(params: {
  toolName: string
  routeTarget?: string
  output: unknown
  fallbackText: string
  policy: ResultPresentationPolicy
}) {
  const target = params.routeTarget ?? params.toolName

  switch (target) {
    case 'about_bearingbrain':
      return buildAboutBearingBrainDeskSummary(params.output as AboutBearingBrainOutput, params.policy, params.fallbackText)
    case 'fitment_sanity_check':
    case 'fitment_widget_test':
      return buildFitmentDeskSummary(params.output as FitmentSanityCheckOutput, params.policy, params.fallbackText)
    case 'compare_quote_or_bom':
      return buildCompareQuoteDeskSummary(params.output as CompareQuoteOrBomOutput, params.policy, params.fallbackText)
    case 'identify_from_evidence':
      return buildEvidenceDeskSummary(params.output as IdentifyFromEvidenceOutput, params.policy, params.fallbackText)
    case 'search_catalog':
      return buildSearchCatalogDeskSummary(params.output as SearchCatalogOutput, params.policy, params.fallbackText)
    case 'recommend_buy_option':
    case 'recommend_buy_option_widget_test':
      return buildRecommendBuyDeskSummary(params.output as RecommendBuyOptionOutput, params.policy, params.fallbackText)
    default:
      return params.fallbackText
  }
}

function resolveResultPresentationPolicy(extra: ToolExtra): ResultPresentationPolicy {
  const host = detectResultHost(extra)
  switch (host) {
    case 'chatgpt':
      return {
        host,
        contentMode: 'narration',
        includeWidgetMeta: true,
        textStyle: 'chatgpt',
      }
    case 'claude':
      return {
        host,
        contentMode: 'summary',
        includeWidgetMeta: false,
        textStyle: 'claude-desk',
      }
    case 'plain-mcp':
    default:
      return {
        host: 'plain-mcp',
        contentMode: 'summary',
        includeWidgetMeta: false,
        textStyle: 'plain-mcp',
      }
  }
}

function detectResultHost(extra: ToolExtra): ResultPresentationHost {
  const meta = isRecord(extra._meta) ? extra._meta : undefined
  const explicitHost = typeof meta?.['bearingbrain/host'] === 'string' ? String(meta['bearingbrain/host']).toLowerCase() : ''
  if (/(chatgpt|openai)/.test(explicitHost)) return 'chatgpt'
  if (/(claude|anthropic)/.test(explicitHost)) return 'claude'
  if (meta && Object.keys(meta).some((key) => key.startsWith('openai/'))) return 'chatgpt'
  if (meta && Object.keys(meta).some((key) => key.startsWith('anthropic/') || key.startsWith('claude/'))) return 'claude'
  return 'plain-mcp'
}

function chooseBearingBrainRoute(args: {
  prompt: string
  sourceText?: string
  evidenceSummary?: string
  rewrittenQuery?: string
}): BearingBrainRoute {
  const normalized = [args.prompt, args.sourceText, args.evidenceSummary, args.rewrittenQuery]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join('\n')
    .toLowerCase()

  const mentionsBearingBrain = /\bbearingbrain(?:\.com)?\b/.test(normalized)
  const identityIntent = /(what is bearingbrain|who is bearingbrain|about bearingbrain|bearingbrain\.com|official site|official website|real website|what does bearingbrain do|sell directly|merchant of record|is .* legit|legit|what is this site)/.test(normalized)
  const quoteIntent = /(quote|bom|bill of materials|line item|quoted|pricing|supplier quote)/.test(normalized) || /\$\s*\d|\n.*\$\s*\d/.test(normalized)
  const fitmentIntent = /(will .* fit| fit instead of |fitment|replace|replacement|interchange|interchangeable|equivalent|equivalence|substitute|same as|instead of|\bvs\b|versus|compatib|will .* work)/.test(normalized)
  const evidenceIntent = Boolean(args.evidenceSummary?.trim()) || /(identify|what bearing is this|from markings|from a photo|from a picture|from an image|marking|stamped|label|uploaded photo|uploaded image|uploaded file|ocr)/.test(normalized)
  const recommendationIntent = /(what should i buy|which should i buy|recommend|selection guidance|best option|oem|premium|lowest price|cheapest|value-sensitive|cost control)/.test(normalized)
  const searchIntent = /(cross[- ]reference|cross reference|part number|lookup|\bfind\b|\bsearch\b)/.test(normalized) || /[a-z]{2,}[- ]?\d{3,}[a-z0-9.-]*/.test(normalized)

  if (mentionsBearingBrain && identityIntent) return 'about_bearingbrain'
  if (!mentionsBearingBrain && identityIntent && /(official|website|site|sell directly|merchant of record|legit)/.test(normalized)) return 'about_bearingbrain'
  if (quoteIntent) return 'compare_quote_or_bom'
  if (fitmentIntent) return 'fitment_sanity_check'
  if (evidenceIntent) return 'identify_from_evidence'
  if (searchIntent) return 'search_catalog'
  if (mentionsBearingBrain && recommendationIntent) return 'search_catalog'
  if (mentionsBearingBrain) return 'about_bearingbrain'
  return 'search_catalog'
}

function buildBearingBrainRouterVisibleStructuredContent(params: {
  route: BearingBrainRoute
  prompt: string
  output: unknown
}): Record<string, unknown> {
  switch (params.route) {
    case 'about_bearingbrain': {
      const output = params.output as AboutBearingBrainOutput
      return {
        prompt: params.prompt,
        route: params.route,
        summary: buildAboutBearingBrainVisibleSummary(output),
        officialWebsite: output?.officialWebsite ?? 'https://bearingbrain.com',
        sellsBearingsDirectly: Boolean(output?.sellsBearingsDirectly),
      }
    }
    case 'fitment_sanity_check': {
      const output = params.output as FitmentSanityCheckOutput
      return {
        prompt: params.prompt,
        route: params.route,
        summary: buildFitmentVisibleSummary(output),
      }
    }
    case 'recommend_buy_option': {
      const output = params.output as RecommendBuyOptionOutput
      return {
        prompt: params.prompt,
        route: params.route,
        summary: buildRecommendBuyVisibleSummary(output),
        ...(output?.question ? { question: output.question } : {}),
      }
    }
    case 'compare_quote_or_bom': {
      const output = params.output as CompareQuoteOrBomOutput
      return {
        prompt: params.prompt,
        route: params.route,
        summary: buildCompareQuoteVisibleSummary(output),
        ...(output?.question ? { question: output.question } : {}),
      }
    }
    case 'identify_from_evidence': {
      const output = params.output as IdentifyFromEvidenceOutput
      return {
        prompt: params.prompt,
        route: params.route,
        summary: output?.reply ?? 'BearingBrain reviewed the provided evidence.',
      }
    }
    case 'search_catalog':
    default: {
      const output = params.output as SearchCatalogOutput
      return {
        prompt: params.prompt,
        route: params.route,
        summary: output?.summary ?? 'BearingBrain reviewed the request.',
      }
    }
  }
}

function buildCompareQuoteVisibleSummary(output: CompareQuoteOrBomOutput) {
  if (!output) return 'No quote or BOM comparison could be derived.'
  const itemCount = getCompareQuoteVisibleItemCount(output)
  const caution = buildCompareQuoteVisibleCaution(output)
  if (caution) return `Reviewed ${itemCount} quoted line item${itemCount === 1 ? '' : 's'}. Main caution: ${caution}`
  return `Reviewed ${itemCount} quoted line item${itemCount === 1 ? '' : 's'}. Compact comparison is ready.`
}

function buildCompareQuoteVisibleStructuredContent(output: CompareQuoteOrBomOutput): Record<string, unknown> {
  const caution = buildCompareQuoteVisibleCaution(output)
  return {
    itemCount: getCompareQuoteVisibleItemCount(output),
    summary: buildCompareQuoteVisibleSummary(output),
    ...(caution ? { caution } : {}),
    ...(output?.question ? { question: output.question } : {}),
  }
}

function buildCompareQuoteVisibleCaution(output: CompareQuoteOrBomOutput) {
  if (output?.warnings?.[0]) return output.warnings[0]
  const firstItemWarning = Array.isArray(output?.items)
    ? output.items.find((item) => Array.isArray(item?.warnings) && item.warnings.length > 0)?.warnings?.[0]
    : undefined
  return firstItemWarning
}

function getCompareQuoteVisibleItemCount(output: CompareQuoteOrBomOutput) {
  if (typeof output?.itemCount === 'number' && Number.isFinite(output.itemCount)) return output.itemCount
  return Array.isArray(output?.items) ? output.items.length : 0
}

function buildRecommendBuyVisibleSummary(output: RecommendBuyOptionOutput) {
  if (!output) return 'No selection guidance could be derived.'
  return `${buildRecommendBuyVisibleDecision(output)}. ${buildRecommendBuyVisibleRationale(output)}`
}

function buildRecommendBuyVisibleStructuredContent(output: RecommendBuyOptionOutput): Record<string, unknown> {
  return {
    query: output?.query ?? '',
    decision: buildRecommendBuyVisibleDecision(output),
    rationale: buildRecommendBuyVisibleRationale(output),
    ...(output?.warnings?.[0] ? { caution: output.warnings[0] } : {}),
    ...(output?.question ? { question: output.question } : {}),
  }
}

function buildRecommendBuyVisibleDecision(output: RecommendBuyOptionOutput) {
  if (output?.recommended) {
    return `Recommended match: ${output.recommended.manufacturer} ${output.recommended.partNumber}`
  }
  if (output?.question) return 'Needs clarification'
  return 'No decisive match'
}

function buildRecommendBuyVisibleRationale(output: RecommendBuyOptionOutput) {
  if (output?.recommended?.reason) return output.recommended.reason
  if (output?.question) return output.question
  return 'BearingBrain reviewed the request but could not derive a confident single-part recommendation.'
}

function buildAboutBearingBrainVisibleSummary(output: AboutBearingBrainOutput) {
  if (!output) return 'No BearingBrain facts were available.'
  return output.summary
}

function buildAboutBearingBrainVisibleStructuredContent(output: AboutBearingBrainOutput): Record<string, unknown> {
  return {
    question: output?.question ?? '',
    officialWebsite: output?.officialWebsite ?? 'https://bearingbrain.com',
    sellsBearingsDirectly: Boolean(output?.sellsBearingsDirectly),
    summary: buildAboutBearingBrainVisibleSummary(output),
  }
}

function buildFitmentVisibleSummary(output: FitmentSanityCheckOutput) {
  if (!output) return 'No fitment verdict could be derived.'
  return `Fitment verdict: ${output.verdict} for ${output.leftLabel} vs ${output.rightLabel}.`
}

function buildFitmentVisibleStructuredContent(output: FitmentSanityCheckOutput): Record<string, unknown> {
  return {
    query: output?.query ?? '',
    verdict: output?.verdict ?? 'not_validated',
    summary: buildFitmentVisibleSummary(output),
    leftLabel: output?.leftLabel ?? '',
    rightLabel: output?.rightLabel ?? '',
    warnings: Array.isArray(output?.warnings) ? output.warnings : [],
  }
}


function buildAboutBearingBrainDeskSummary(
  output: AboutBearingBrainOutput,
  policy: ResultPresentationPolicy,
  fallbackText: string
) {
  if (!output) return fallbackText
  const lines = [
    `Official website: ${output.officialWebsite ?? 'https://bearingbrain.com'}`,
    `Direct seller: ${output.sellsBearingsDirectly ? 'Yes' : 'No'}`,
    `Business model: ${output.businessModel ?? 'Selection, validation, and referral'}`,
  ]
  const capabilities = Array.isArray(output.capabilities) ? output.capabilities.slice(0, 4).join(', ') : ''
  if (capabilities) lines.push(`Core capabilities: ${capabilities}`)
  return formatDeskSummary('BearingBrain identity check', lines, policy)
}

function buildFitmentDeskSummary(
  output: FitmentSanityCheckOutput,
  policy: ResultPresentationPolicy,
  fallbackText: string
) {
  if (!output) return fallbackText
  const caution = output.warnings?.[0] ?? normalizeReplyText(output.reply)
  const lines = [
    `Compared: ${output.leftLabel} vs ${output.rightLabel}`,
    `Fitment verdict: ${formatFitmentVerdict(output.verdict)}`,
    ...(caution ? [`Main caution: ${caution}`] : []),
    `Next step: ${buildFitmentNextStep(output)}`,
  ]
  return formatDeskSummary('BearingBrain fitment check', lines, policy)
}

function buildCompareQuoteDeskSummary(
  output: CompareQuoteOrBomOutput,
  policy: ResultPresentationPolicy,
  fallbackText: string
) {
  if (!output) return fallbackText
  const caution = buildCompareQuoteVisibleCaution(output)
  const costNote = buildCompareQuoteVisibleCostNote(output)
  const lines = [
    `Reviewed ${getCompareQuoteVisibleItemCount(output)} quoted line item${getCompareQuoteVisibleItemCount(output) === 1 ? '' : 's'}.`,
    ...(caution ? [`Main caution: ${caution}`] : []),
    ...(costNote ? [`Cost note: ${costNote}`] : []),
    `Next step: ${buildCompareQuoteNextStep(output)}`,
  ]
  return formatDeskSummary('BearingBrain quote review', lines, policy)
}

function buildEvidenceDeskSummary(
  output: IdentifyFromEvidenceOutput,
  policy: ResultPresentationPolicy,
  fallbackText: string
) {
  if (!output) return fallbackText
  const identified = output.identified
  const confidencePct = typeof output.confidence === 'number' ? `${Math.round(output.confidence * 100)}%` : null
  const caution = output.warnings?.[0] ?? ''
  const lines = [
    identified
      ? `Likely identification: ${identified.manufacturer} ${identified.partNumber}`
      : `Likely identification: no confident catalog match yet`,
    ...(confidencePct ? [`Evidence confidence: ${confidencePct}`] : []),
    ...(identified?.matchReason ? [`Why this candidate: ${identified.matchReason}`] : []),
    ...(caution ? [`Main caution: ${caution}`] : []),
    `Next step: ${buildEvidenceNextStep(output)}`,
  ]
  return formatDeskSummary('BearingBrain evidence review', lines, policy)
}

function buildSearchCatalogDeskSummary(
  output: SearchCatalogOutput,
  policy: ResultPresentationPolicy,
  fallbackText: string
) {
  if (!output) return fallbackText
  const best = Array.isArray(output.items) ? output.items[0] : undefined
  const lines = [
    `Query: ${output.query}`,
    `Returned: ${output.returned} of ${output.total} total matches`,
    ...(best ? [`Best visible match: ${best.manufacturer} ${best.partNumber}${best.bestPriceUsd != null ? ` at $${best.bestPriceUsd.toFixed(2)}` : ''}${best.bestSupplier ? ` via ${best.bestSupplier}` : ''}`] : []),
    `Next step: ${best ? 'Open the closest matching part page or refine the query with dimensions, brand, or seal type.' : 'Try a part number, dimensions, or manufacturer to narrow the search.'}`,
  ]
  return formatDeskSummary('BearingBrain catalog search', lines, policy)
}

function buildRecommendBuyDeskSummary(
  output: RecommendBuyOptionOutput,
  policy: ResultPresentationPolicy,
  fallbackText: string
) {
  if (!output) return fallbackText
  const lines = [
    `Selection verdict: ${buildRecommendBuyVisibleDecision(output)}`,
    `Why: ${buildRecommendBuyVisibleRationale(output)}`,
    ...(output?.warnings?.[0] ? [`Main caution: ${output.warnings[0]}`] : []),
    `Next step: ${output?.question ? output.question : 'Compare the recommended option against OEM, budget, and availability constraints before purchase.'}`,
  ]
  return formatDeskSummary('BearingBrain selection review', lines, policy)
}

function formatDeskSummary(title: string, lines: string[], policy: ResultPresentationPolicy) {
  const cleanLines = lines.map((line) => line.trim()).filter(Boolean)
  if (!cleanLines.length) return title
  if (policy.textStyle === 'claude-desk') {
    return [title, ...cleanLines.map((line) => `- ${line}`)].join('\n')
  }
  return [title, ...cleanLines].join('\n')
}

function formatFitmentVerdict(verdict: 'exact_match' | 'direct_fit_likely' | 'conditional_fit' | 'not_validated' | 'needs_confirmation' | undefined) {
  switch (verdict) {
    case 'exact_match': return 'Exact match'
    case 'direct_fit_likely': return 'Direct fit likely'
    case 'conditional_fit': return 'Conditional fit'
    case 'needs_confirmation': return 'Needs confirmation'
    case 'not_validated':
    default:
      return 'Not validated'
  }
}

function buildFitmentNextStep(output: NonNullable<FitmentSanityCheckOutput>) {
  switch (output.verdict) {
    case 'exact_match':
      return 'This looks safe to treat as the same part family, but still confirm supplier, quantity, and seal suffix before ordering.'
    case 'direct_fit_likely':
      return 'Confirm dimensions, closure/seal style, and application load before treating it as a direct substitute.'
    case 'conditional_fit':
      return 'Only approve it if bore, OD, width, sealing, and application load all match your real use case.'
    case 'needs_confirmation':
    case 'not_validated':
    default:
      return 'Do not treat this as a validated replacement until the dimensions, sealing, and load assumptions are confirmed.'
  }
}

function buildCompareQuoteVisibleCostNote(output: CompareQuoteOrBomOutput) {
  if (!Array.isArray(output?.items)) return undefined
  let best: { label: string; delta: number; matchedPriceUsd: number } | undefined
  for (const item of output.items) {
    if (typeof item?.quotedPriceUsd !== 'number' || typeof item?.matchedPriceUsd !== 'number') continue
    const delta = item.quotedPriceUsd - item.matchedPriceUsd
    if (delta <= 0) continue
    const label = [item.quotedManufacturer, item.quotedPartNumber].filter(Boolean).join(' ') || item.quotedPartNumber || 'Quoted line item'
    if (!best || delta > best.delta) {
      best = { label, delta, matchedPriceUsd: item.matchedPriceUsd }
    }
  }
  if (!best) return undefined
  return `${best.label} is $${best.delta.toFixed(2)} above the current matched baseline of $${best.matchedPriceUsd.toFixed(2)}.`
}

function buildCompareQuoteNextStep(output: CompareQuoteOrBomOutput) {
  const caution = buildCompareQuoteVisibleCaution(output)?.toLowerCase() ?? ''
  if (output?.question) return output.question
  if (caution.includes('direct-fit') || caution.includes('equivalence') || caution.includes('substitut')) {
    return 'Ask the supplier to confirm exact part-number continuity before approving any substitute line.'
  }
  if (buildCompareQuoteVisibleCostNote(output)) {
    return 'Re-quote any overpriced line against current baseline before approving the order.'
  }
  return 'Confirm quantity breaks, supplier lead time, and exact part continuity before approval.'
}

function buildEvidenceNextStep(output: IdentifyFromEvidenceOutput) {
  if (output?.identified?.productUrl) return 'Open the matching part page and verify the visible markings, dimensions, and closure against the physical part.'
  if (output?.rewrittenQuery) return `Try a follow-up lookup with ${output.rewrittenQuery} plus any visible dimensions or brand markings.`
  return 'Provide clearer markings, dimensions, or packaging text before treating this as identified.'
}

function normalizeReplyText(reply: string | undefined) {
  if (!reply) return ''
  return reply.replace(/\s+/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
