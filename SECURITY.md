# Security Policy

## Supported versions

This public MCP slice is maintained on `main`.

## Reporting a vulnerability

Please do **not** open a public issue for vulnerabilities, leaked credentials, auth bypasses, data exposure, or supply-chain problems.

Preferred process:

1. Open a private GitHub Security Advisory for this repository.
2. Include affected files, reproduction steps, impact, and suggested fixes if available.
3. If the issue involves a potentially exposed secret, rotate/revoke the secret immediately before sharing details.

## Secret handling

- Do not commit `.env`, `.env.local`, database URLs, API keys, tokens, cookies, customer data, uploads, or logs.
- Use `.env.example` for documentation only.
- CI should run public-safe checks only. Private integration tests must require explicit environment variables.

## Public-slice boundaries

This repository intentionally excludes the private BearingBrain production database, deployment config, uploads, order data, and full website/product codebase.
