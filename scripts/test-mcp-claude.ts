import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mcpTools, type MCPCallToolResultLike, type MCPClientLike } from '@anthropic-ai/sdk/helpers/beta/mcp'

const endpoint = new URL(process.argv[2] ?? 'http://127.0.0.1:3001/api/mcp')

function blocksToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((block) => {
      if (block && typeof block === 'object' && 'type' in block && (block as { type?: unknown }).type === 'text') {
        return String((block as { text?: unknown }).text ?? '')
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

async function main() {
  const transport = new StreamableHTTPClientTransport(endpoint)
  const client = new Client({
    name: 'bearingbrain-mcp-claude-smoke',
    version: '0.1.0',
  })

  try {
    await client.connect(transport)

    const tools = await client.listTools()
    const anthroBridgeClient: MCPClientLike = {
      callTool: async ({ name, arguments: args }) => {
        const result = await client.callTool({ name, arguments: args })
        const normalized = (result && typeof result === 'object' && 'toolResult' in result)
          ? (result as { toolResult?: MCPCallToolResultLike }).toolResult
          : result
        if (!normalized || typeof normalized !== 'object' || !('content' in normalized)) {
          throw new Error(`Unexpected MCP callTool result shape for ${name}`)
        }
        return normalized as MCPCallToolResultLike
      },
    }
    const claudeTools = mcpTools(tools.tools, anthroBridgeClient)
    const bearingbrain = claudeTools.find((tool) => tool.name === 'bearingbrain')
    if (!bearingbrain) throw new Error('Missing bearingbrain on MCP surface for Claude bridge')

    const identityText = blocksToText(await bearingbrain.run({
      prompt: 'Is bearingbrain.com the official site and does BearingBrain sell bearings directly?',
    }))
    if (!/bearingbrain\.com/i.test(identityText)) {
      throw new Error(`Claude bridge identity result missing official-site grounding: ${identityText}`)
    }
    if (!/does not sell|doesn.t sell|refer|supplier/i.test(identityText)) {
      throw new Error(`Claude bridge identity result missing business-model grounding: ${identityText}`)
    }

    const fitmentText = blocksToText(await bearingbrain.run({
      prompt: 'Will 6205-2RS fit instead of 6204-2RS?',
    }))
    if (!/6205-2RS/i.test(fitmentText) || !/6204-2RS/i.test(fitmentText)) {
      throw new Error(`Claude bridge fitment result missing compared parts: ${fitmentText}`)
    }
    if (!/bearingbrain fitment check/i.test(fitmentText) || !/next step:/i.test(fitmentText)) {
      throw new Error(`Claude bridge fitment result is missing the expected BearingBrain desk framing: ${fitmentText}`)
    }

    const quoteText = blocksToText(await bearingbrain.run({
      prompt: 'Compare this quote.',
      sourceText: 'Line 1: SKF 6204-2RS1 $25.00 each\nLine 2: NSK 6205-2RS $31.50 each',
    }))
    if (!/bearingbrain quote review/i.test(quoteText) || !/reviewed 2 quoted line items?/i.test(quoteText) || !/next step:/i.test(quoteText)) {
      throw new Error(`Claude bridge quote result missing desk-style comparison framing: ${quoteText}`)
    }

    console.log('endpoint:', endpoint.toString())
    console.log('toolsConvertibleForClaude:', claudeTools.length)
    console.log('identity:', identityText)
    console.log('fitment:', fitmentText)
    console.log('quote:', quoteText)
  } finally {
    await transport.terminateSession().catch(() => undefined)
    await client.close()
  }
}

main().catch((error) => {
  console.error('Claude MCP smoke test failed:', error)
  process.exit(1)
})
