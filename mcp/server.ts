import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createBearingBrainMcpServer } from '@/mcp/server-core'

async function main() {
  const server = createBearingBrainMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('BearingBrain MCP server failed to start:', error)
  process.exit(1)
})
