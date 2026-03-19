# BearingBrain MCP

Public BearingBrain MCP slice for Claude/Desktop and other MCP hosts.

## What this repo contains

- BearingBrain MCP server core
- Streamable HTTP route used by the live app
- Claude/Desktop smoke test
- Bearing lookup, fitment, quote/BOM review, evidence identification, and official BearingBrain identity routing

## What this repo does not contain

- `.env` files
- deployment secrets
- private uploads or logs
- the full BearingBrain website/product repo

## Live public MCP endpoint

- `https://bearingbrain.com/api/mcp`

## Claude Desktop setup

Recommended Claude Desktop config uses `mcp-remote` against the live endpoint:

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

Claude Desktop config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

## Local development

Install:

```bash
npm install
```

Run stdio MCP server locally:

```bash
npm run mcp:server
```

Run the Claude bridge smoke test against the live endpoint:

```bash
npm run mcp:test:claude -- https://bearingbrain.com/api/mcp
```

Run the HTTP smoke test:

```bash
npm run mcp:test:http -- https://bearingbrain.com/api/mcp
```

## Notes

- This repo is an extracted public MCP slice from the main BearingBrain codebase.
- The deterministic bearing logic depends on the underlying catalog/database-backed application environment.
- ChatGPT-specific widget code is still present because the live MCP surface shares one core and varies presentation by host.
- Claude/Desktop receives text-first BearingBrain desk summaries rather than ChatGPT widget metadata.
