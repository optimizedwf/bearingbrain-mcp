import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CHATGPT_WIDGET_TEMPLATE_URI } from '@/mcp/chatgpt-widget'

const HERO_TOOLS = [
  'bearingbrain',
] as const

const INTERNAL_WIDGET_TOOLS = [
  'about_bearingbrain',
  'compare_quote_or_bom',
  'identify_from_evidence',
  'fitment_sanity_check',
] as const

async function main() {
  const transport = new StdioClientTransport({
    command: './node_modules/.bin/tsx',
    args: ['mcp/server.ts'],
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    stderr: 'inherit',
  })

  const client = new Client({
    name: 'bearingbrain-mcp-smoke',
    version: '0.1.0',
  })

  try {
    await client.connect(transport)

    const tools = await client.listTools()
    console.log('tools:', tools.tools.map((tool) => tool.name))

    const resources = await client.listResources()
    console.log('resources:', resources.resources.map((resource) => resource.uri))

    if (!resources.resources.some((resource) => resource.uri === CHATGPT_WIDGET_TEMPLATE_URI)) {
      throw new Error(`Missing ChatGPT widget resource ${CHATGPT_WIDGET_TEMPLATE_URI}`)
    }

    for (const heroTool of HERO_TOOLS) {
      const tool = tools.tools.find((entry) => entry.name === heroTool) as (typeof tools.tools[number] & {
        _meta?: { ui?: { resourceUri?: string } }
      }) | undefined
      if (!tool) throw new Error(`Missing hero tool ${heroTool}`)
      if (tool._meta?.ui?.resourceUri !== CHATGPT_WIDGET_TEMPLATE_URI) {
        throw new Error(`${heroTool} is missing ui.resourceUri=${CHATGPT_WIDGET_TEMPLATE_URI}`)
      }
    }

    const cases = [
      {
        name: 'bearingbrain',
        arguments: { prompt: 'What is BearingBrain and is bearingbrain.com the official website?' },
      },
    ]

    for (const testCase of cases) {
      const result = await client.callTool({
        name: testCase.name,
        arguments: testCase.arguments,
        ...((HERO_TOOLS.includes(testCase.name as typeof HERO_TOOLS[number]) || INTERNAL_WIDGET_TOOLS.includes(testCase.name as typeof INTERNAL_WIDGET_TOOLS[number]))
          ? { _meta: { 'openai/locale': 'en-US' } }
          : {}),
      }) as {
        structuredContent?: { ui?: { widget?: string } }
        _meta?: { ['bearingbrain/widget']?: { host?: string; ui?: { widget?: string; primaryAction?: { url?: string } } } }
      }

      if (HERO_TOOLS.includes(testCase.name as typeof HERO_TOOLS[number]) || INTERNAL_WIDGET_TOOLS.includes(testCase.name as typeof INTERNAL_WIDGET_TOOLS[number])) {
        const widgetMeta = result._meta?.['bearingbrain/widget']
        if (!widgetMeta?.ui?.widget) {
          throw new Error(`${testCase.name} did not return bearingbrain/widget result metadata`)
        }
        const primaryUrl = widgetMeta.ui.primaryAction?.url
        if (widgetMeta.host !== 'chatgpt') {
          throw new Error(`${testCase.name} did not detect ChatGPT host metadata`)
        }
        if (primaryUrl && !primaryUrl.includes('host=chatgpt')) {
          throw new Error(`${testCase.name} primary action is missing host=chatgpt attribution`) 
        }
      }
      console.log(`\n===== ${testCase.name} =====`)
      console.log(JSON.stringify(result, null, 2))
    }
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error('MCP smoke test failed:', error)
  process.exit(1)
})
