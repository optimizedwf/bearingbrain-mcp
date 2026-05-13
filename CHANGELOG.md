# Changelog

## Unreleased

- Professionalized public repo metadata, documentation, contribution/security guidance, and CI.
- Simplified package dependencies for the public MCP slice and removed unused heavy app dependencies.
- Moved Next/React to optional peer/dev dependencies so stdio MCP installs do not require the full web runtime.
- Made local MCP scripts load an optional gitignored `.env` file without requiring it.
- Adjusted default smoke test to avoid private database/API requirements.
- Hardened the copied auth helper so production authentication requires an explicit `JWT_SECRET`.

## 0.1.0

- Initial public BearingBrain MCP slice with stdio server, streamable HTTP route source, and BearingBrain tool surface.
