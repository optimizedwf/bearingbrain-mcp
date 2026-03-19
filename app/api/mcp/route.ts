import { randomUUID } from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createBearingBrainMcpServer } from '@/mcp/server-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MCP_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id, authorization',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
} as const

type SessionEntry = {
  transport: WebStandardStreamableHTTPServerTransport
}

declare global {
  // eslint-disable-next-line no-var
  var __bearingbrainMcpSessions: Map<string, SessionEntry> | undefined
}

function getSessionStore() {
  if (!globalThis.__bearingbrainMcpSessions) {
    globalThis.__bearingbrainMcpSessions = new Map<string, SessionEntry>()
  }
  return globalThis.__bearingbrainMcpSessions
}

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function jsonRpcError(status: number, code: number, message: string) {
  return withCors(
    new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code, message },
        id: null,
      }),
      {
        status,
        headers: {
          'content-type': 'application/json',
        },
      }
    )
  )
}

async function getParsedBody(request: Request) {
  if (request.method !== 'POST') return undefined
  try {
    return await request.clone().json()
  } catch {
    return undefined
  }
}

async function handleMcpRequest(request: Request) {
  const sessions = getSessionStore()
  const sessionId = request.headers.get('mcp-session-id') ?? undefined
  const parsedBody = await getParsedBody(request)

  let transport = sessionId ? sessions.get(sessionId)?.transport : undefined

  if (!transport) {
    if (sessionId) {
      return jsonRpcError(404, -32000, 'Session not found')
    }

    if (request.method !== 'POST' || !isInitializeRequest(parsedBody)) {
      return jsonRpcError(400, -32000, 'No valid session ID provided')
    }

    const server = createBearingBrainMcpServer()
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { transport: transport! })
      },
      onsessionclosed: (closedSessionId) => {
        sessions.delete(closedSessionId)
      },
    })

    transport.onclose = () => {
      if (transport?.sessionId) {
        sessions.delete(transport.sessionId)
      }
    }

    transport.onerror = (error) => {
      console.error('BearingBrain MCP HTTP transport error:', error)
    }

    await server.connect(transport)
  }

  try {
    const response = await transport.handleRequest(
      request,
      parsedBody === undefined ? undefined : { parsedBody }
    )
    return withCors(response)
  } catch (error) {
    console.error('BearingBrain MCP HTTP route failed:', error)
    return jsonRpcError(500, -32603, 'Internal server error')
  }
}

export async function POST(request: Request) {
  return handleMcpRequest(request)
}

export async function GET(request: Request) {
  return handleMcpRequest(request)
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request)
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: MCP_CORS_HEADERS,
  })
}
