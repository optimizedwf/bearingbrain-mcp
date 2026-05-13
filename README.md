# BearingBrain MCP

[![CI](https://github.com/optimizedwf/bearingbrain-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/optimizedwf/bearingbrain-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-server-blue)](https://modelcontextprotocol.io/)

Public Model Context Protocol (MCP) server slice for [BearingBrain](https://bearingbrain.com): bearing lookup, fitment sanity checks, quote/BOM review, evidence-based identification, and official BearingBrain identity answers.

## What this repo contains

- Stdio MCP server for Claude Desktop and local MCP hosts.
- Streamable HTTP route source for the live BearingBrain app.
- ChatGPT widget metadata/resource support for richer MCP clients.
- Deterministic tools for BearingBrain identity, quote/BOM parsing, fitment checks, evidence summaries, and catalog search.
- Smoke tests for local stdio, live HTTP, and Claude MCP bridge compatibility.

## What this repo does **not** contain

- `.env` files, production credentials, or deployment secrets.
- Private uploads, logs, user data, or order data.
- The full BearingBrain website/product repository.
- A public database dump. Catalog-backed tools require your own compatible database connection.

## Live public endpoint

```text
https://bearingbrain.com/api/mcp
```

## Claude Desktop setup

Recommended config uses `mcp-remote` against the live endpoint:

```json
{
  "mcpServers": {
    "bearingbrain": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://bearingbrain.com/api/mcp"]
    }
  }
}
```

Claude Desktop config file locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`

## Local development

Requirements:

- Node.js 20+
- npm
- Optional: PostgreSQL-compatible `DATABASE_URL` for catalog-backed search tools
- Optional: `GOOGLE_GEMINI_API_KEY`, `SKF_API_KEY`, Stripe/CJ settings for integration paths copied from the private app

Install:

```bash
npm ci --include=dev
cp .env.example .env
```

Run the stdio MCP server locally:

```bash
npm run mcp:server
```

Run validation that does not require private secrets or a database:

```bash
npm test
npm run build
npm audit --omit=dev
```

Run optional integration checks:

```bash
# Requires DATABASE_URL with BearingBrain-compatible schema
npm run mcp:test:search -- "SKF 6204-2RS1"

# Against a running HTTP MCP endpoint
npm run mcp:test:http -- https://bearingbrain.com/api/mcp
npm run mcp:test:claude -- https://bearingbrain.com/api/mcp
```

## Tools

| Tool | Purpose | Private services required? |
| --- | --- | --- |
| `bearingbrain` | Router for official BearingBrain answers, lookup, fitment, quote/BOM review, and evidence identification | Only for catalog/search branches |
| `about_bearingbrain` | Grounded facts about BearingBrain and bearingbrain.com | No |
| `search_catalog` | Catalog search by part number or natural-language bearing query | Yes, `DATABASE_URL` |
| `recommend_buy_option` | Selection guidance for buy/fitment-style prompts | Sometimes, depending on query |
| `compare_quote_or_bom` | Parse quoted line items and summarize review next steps | No for basic parsing |
| `identify_from_evidence` | Turn visible markings/photo/file evidence summaries into candidate bearing guidance | No for basic evidence summaries |
| `fitment_sanity_check` | Compare two bearing part numbers for likely fit | No for common dimensional part numbers |

## HTTP integration

`app/api/mcp/route.ts` is a Next.js App Router streamable HTTP MCP route. It uses session IDs, permissive CORS for MCP clients, and JSON-RPC error responses. In the public repo, Next/React are optional peer dependencies and dev dependencies so the stdio server can be installed without shipping a full web app runtime.

## Security

- Never commit `.env`, `.env.local`, database URLs, API keys, webhook secrets, upload data, or logs.
- Use `.env.example` as the only committed environment template.
- Report vulnerabilities privately via GitHub Security Advisories or the process in [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
