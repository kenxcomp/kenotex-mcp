# kenotex-mcp

MCP server (stdio) for Kenotex. Tools mirror the macOS app's local `/v1` REST API
1:1; it is a thin bridge and adds no behaviour of its own (see
[CONTRIBUTING.md](CONTRIBUTING.md)). This directory is mirrored to the public
`kenxcomp/kenotex-mcp` repository on release, so keep content here publishable.

## Product direction

Today the server reaches data only through the Kenotex Mac app on the same
machine. The product direction is account-scoped data that LLM apps can reach
from anywhere, so a remote transport authenticated against a Kenotex account
(OAuth scopes, audit, idempotent writes) is expected to sit beside or replace the
local HTTP client. When changing tools or the client:

- Keep tool names, input schemas and output shapes transport-neutral; do not leak
  local-only details (port, token file, Mac paths) into the tool contract.
- Isolate transport and auth in the client layer so a remote backend can be
  swapped in without redefining tools.
- Pass through stable entity ids and keep writes safe to retry.

Do not build the remote transport ahead of its task. In the monorepo, the
direction lives in the root `ROADMAP.md` and the tool/API contract (version
handshake, release order, Beta-only local agent boundary) in
`.claude/rules/external-api-surface.md`.

## Commands

```bash
bun install
bun run build
bun test
```

Publishing (npm, public mirror, MCP Registry) is a manual owner workflow; do not
run it unless explicitly asked.
