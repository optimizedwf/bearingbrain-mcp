# Contributing

Thanks for helping improve BearingBrain MCP.

## Development setup

```bash
npm ci --include=dev
cp .env.example .env
npm test
```

`npm test` is intentionally public-safe: it type-checks and runs a stdio MCP smoke test that does not require private secrets or a catalog database.

## Optional integration testing

Catalog and live HTTP checks require extra infrastructure:

```bash
# Requires a compatible DATABASE_URL
npm run mcp:test:search -- "SKF 6204-2RS1"

# Requires reachable HTTP endpoint
npm run mcp:test:http -- https://bearingbrain.com/api/mcp
npm run mcp:test:claude -- https://bearingbrain.com/api/mcp
```

## Code guidelines

- Keep MCP tool descriptions concise and action-oriented.
- Prefer structured outputs with Zod schemas where possible.
- Make errors actionable for agents and humans.
- Do not add network/database requirements to the default smoke test unless guarded by an explicit env var.
- Do not commit generated `.next`, `node_modules`, `.env*`, logs, uploads, or secrets.

## Pull requests

Before opening a PR, run:

```bash
npm test
npm run build
npm audit --omit=dev
```

In the PR description, include what changed, how it was tested, and whether the change affects live HTTP behavior, Claude/Desktop behavior, or ChatGPT widget metadata.
