import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

async function main() {
  const query = process.argv.slice(2).join(' ').trim() || 'SKF 6204-2RS1'

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--env-file=.env.local', './node_modules/.bin/tsx', 'mcp/server.ts'],
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    stderr: 'inherit',
  })

  const client = new Client({
    name: 'bearingbrain-mcp-smoke-test',
    version: '0.1.0',
  })

  try {
    await client.connect(transport)
    const tools = await client.listTools()
    console.log('tools:', tools.tools.map((tool) => tool.name))

    const result = await client.callTool({
      name: 'search_catalog',
      arguments: {
        query,
        limit: 3,
      },
    })

    console.log(JSON.stringify(result, null, 2))
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error('MCP search test failed:', error)
  process.exit(1)
})
