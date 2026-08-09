# Contributing

## Where this code lives

This repository is the public home of the `kenotex-mcp` npm package. It is
mirrored out of the private Kenotex monorepo on release — the monorepo is the
source of truth, because the MCP server is developed alongside the local HTTP
API it talks to and the two change together.

**What that means for you:**

- **Issues are welcome here** and are read. This is the right place for bug
  reports, missing-capability requests, and MCP client compatibility problems.
- **Pull requests can be accepted**, but they are applied upstream by hand
  rather than merged directly, so expect the commit to land under a different
  hash. Please open an issue first for anything larger than a fix, so we can
  agree on the shape before you spend time.
- **The tool surface is a contract.** Tools mirror the Kenotex local `/v1` REST
  API 1:1. A new tool here needs the endpoint to exist first, so tool additions
  usually start as an issue rather than a PR.

## Running it

```bash
bun install
bun run build
bun test
```

`tests/client.test.ts` reaches for the real token-discovery paths and can fail
on a machine with Kenotex installed. That is a known defect in the test, not in
the client.

## Scope

This package is a thin, faithful bridge to an API that already exists. It does
not add behaviour of its own, and it should stay that way — logic belongs in the
app, where it is shared with the REST API, Shortcuts, and Siri surfaces.
