import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CHATGPT_WIDGET_TEMPLATE_URI } from '@/mcp/chatgpt-widget'

const endpoint = new URL(process.argv[2] ?? 'http://127.0.0.1:3001/api/mcp')

async function main() {
  const transport = new StreamableHTTPClientTransport(endpoint)
  const client = new Client({
    name: 'bearingbrain-mcp-http-smoke',
    version: '0.1.0',
  })

  try {
    await client.connect(transport)

    const tools = await client.listTools()
    const resources = await client.listResources()
    const resource = await client.readResource({ uri: CHATGPT_WIDGET_TEMPLATE_URI })

    console.log('endpoint:', endpoint.toString())
    console.log('sessionId:', transport.sessionId ?? '(none)')
    console.log('tools:', tools.tools.map((tool) => tool.name))
    console.log('resources:', resources.resources.map((entry) => entry.uri))

    if (!resources.resources.some((entry) => entry.uri === CHATGPT_WIDGET_TEMPLATE_URI)) {
      throw new Error(`Missing ChatGPT widget resource ${CHATGPT_WIDGET_TEMPLATE_URI}`)
    }

    if (!tools.tools.some((tool) => tool.name === 'bearingbrain')) {
      throw new Error('Missing bearingbrain on HTTP MCP surface')
    }

    if (!resource.contents.length) {
      throw new Error(`Resource ${CHATGPT_WIDGET_TEMPLATE_URI} returned no contents`)
    }

    const chatgptResult = await client.callTool({
      name: 'bearingbrain',
      arguments: { prompt: 'Is bearingbrain.com the official site and does BearingBrain sell bearings directly?' },
      _meta: { 'openai/locale': 'en-US' },
    }) as {
      content?: Array<{ type?: string; text?: string }>
      structuredContent?: { route?: string; officialWebsite?: string; sellsBearingsDirectly?: boolean }
      _meta?: { ['bearingbrain/widget']?: { host?: string; ui?: { primaryAction?: { url?: string } } } }
    }

    const chatgptWidgetMeta = chatgptResult._meta?.['bearingbrain/widget']
    if (chatgptWidgetMeta?.host !== 'chatgpt') {
      throw new Error('bearingbrain did not detect ChatGPT host metadata over HTTP')
    }
    if (chatgptResult.structuredContent?.route !== 'about_bearingbrain') {
      throw new Error('bearingbrain did not route the identity prompt to about_bearingbrain over HTTP')
    }
    if (chatgptResult.structuredContent?.officialWebsite !== 'https://bearingbrain.com') {
      throw new Error('bearingbrain did not return the expected official website over HTTP')
    }
    if (chatgptResult.structuredContent?.sellsBearingsDirectly !== false) {
      throw new Error('bearingbrain did not return sellsBearingsDirectly=false over HTTP')
    }
    if (chatgptWidgetMeta.ui?.primaryAction?.url && !chatgptWidgetMeta.ui.primaryAction.url.includes('host=chatgpt')) {
      throw new Error('bearingbrain primary action is missing host=chatgpt attribution over HTTP')
    }

    const claudeStyleResult = await client.callTool({
      name: 'bearingbrain',
      arguments: { prompt: 'Is bearingbrain.com the official site and does BearingBrain sell bearings directly?' },
      _meta: { 'bearingbrain/host': 'claude' },
    }) as {
      content?: Array<{ type?: string; text?: string }>
      structuredContent?: { route?: string; officialWebsite?: string; sellsBearingsDirectly?: boolean }
      _meta?: { ['bearingbrain/widget']?: { host?: string } }
    }

    const claudeText = claudeStyleResult.content?.find((block) => block.type === 'text')?.text ?? ''
    if (claudeStyleResult._meta?.['bearingbrain/widget']) {
      throw new Error('bearingbrain should not attach ChatGPT widget meta for Claude-style HTTP requests')
    }
    if (!/bearingbrain\.com/i.test(claudeText) || !/does not directly sell|does not sell|supplier|referral/i.test(claudeText)) {
      throw new Error(`bearingbrain did not return substantive Claude-style summary text over HTTP: ${claudeText}`)
    }

    console.log('chatgptResult:', JSON.stringify(chatgptResult, null, 2))
    console.log('claudeStyleResult:', JSON.stringify(claudeStyleResult, null, 2))
  } finally {
    await transport.terminateSession().catch(() => undefined)
    await client.close()
  }
}

main().catch((error) => {
  console.error('HTTP MCP smoke test failed:', error)
  process.exit(1)
})
