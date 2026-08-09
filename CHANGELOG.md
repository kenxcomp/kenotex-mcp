# CHANGELOG

## 1.2.3

- Added `mcpName` (`com.kenxcomp/kenotex-mcp`) so the package can be verified for
  publication to the official MCP Registry. The registry reads this field from the
  published `package.json` to prove the npm package and the registry entry are the
  same thing.
- Added `repository` / `bugs` pointing at the now-public
  [kenxcomp/kenotex-mcp](https://github.com/kenxcomp/kenotex-mcp) repo.
- Added the missing `LICENSE` file. The package has declared `"license": "MIT"`
  since 1.0.0 but never shipped the text.

No functional change — the tool surface, transport, and auth behaviour are identical
to 1.2.2.

## [1.2.2] - 2026-08-09

- **Fixed: the MCP handshake reported the wrong version.** The `Server` constructor carried a hardcoded `"1.2.0"`, so npm 1.2.1 introduced itself to clients as 1.2.0 and no client could tell which build it was talking to. The handshake now derives `name`/`version` from `package.json`, which is the only place a version is written.
- `prepublishOnly` runs the build, so a stale `dist/` can no longer be published — that was the second way this class of defect shipped.
- Regression guards in `tests/version.test.ts` pin all three: the constructor stays derived, no semver literal creeps back into the source, and the publish hook stays in place.

## [1.2.1] - 2026-08-09

- `homepage` now points at the Kenotex product page (`https://kenxcomp.com/kenotex/`) rather than the source repository, which is private.
- README leads with what the server actually does and how to get the app it talks to.

## [1.2.0] - 2026-07-06

- **7 new check-in habit tools** (22 tools total): `create_habit`, `list_habits`, `get_habit`, `update_habit`, `set_habit_check`, `list_habit_checks`, `delete_habit`.
- `set_habit_check` is explicit **set-state** (`checked: true|false`, idempotent) — both check AND un-check. `date` defaults to today; multi-dose habits take a `slotId` from the habit's `times[].id` (or omit it to check all of today's doses).
- `delete_habit` cascades: **permanently removes the habit and its entire check-in history** — set an `endDate` via `update_habit` to stop-but-keep-records instead.
- **API version handshake**: the client reads the app's `/health` `apiVersion` and, on a version-skewed `404`, tells the LLM whether to update the Kenotex app (app too old for a tool) or this integration (`npx kenotex-mcp@latest`, app raised its `minClientApiVersion`). This covers the mismatch you get from shipping the MCP and the app at different times — the package versions are independent; only the API version has to line up.
- **Already-shipped apps (no `/health` version field) get the hint too**: a reachable app that advertises no `apiVersion` predates local API v2, so a `404` on a `/v1/habits` route now says "update the Kenotex macOS app" instead of a bare not-found — while a `404` on a pre-v2 route (a missing todo/event) stays a plain not-found.
- Requires the Kenotex macOS app version that ships the `/v1/habits` routes (app 1.2.9+, local API v2). Older apps still work for todo/event/category/reminder tools; habit tools surface an "update the Kenotex app" hint until then.

## [1.1.0] - 2026-06-06

- `create_todo` now requires a `categoryId` (call `list_categories` / `create_category` first); external todos can no longer be uncategorized.

## [1.0.0] - 2026-04-17 (Initial Release)

- Stdio MCP server that proxies to Kenotex local HTTP API.
- 15 tools: Todo / Event / Category / Reminder CRUD.
- Recurrence DSL support: `daily`, `weekly:mon,wed`, `monthly:15`, `yearly`, `after:daily`, `none`, `custom:<json>`.
- Virtual event occurrence resolution by `{parent}__occ__{date}` id.
- Token discovery from Kenotex app support paths (3-tier fallback chain matching Raycast extension).
- Tested against Claude Desktop, Cursor.
