# CHANGELOG

## [1.3.0] - 2026-09-14

- **Interval habits (`cadence`)** on `create_habit` / `update_habit`: `{"unit":"day"|"week"|"month","interval":N,"quota"?:Q,"startDate"?:"yyyy-MM-dd"}` — Q times every N days, Q times per N week(s), or Q times per N calendar month(s). Accepted table (mirrors the app; 422 on `cadence`, never clamped): `day` interval 1–365 with quota 1–interval (a `day/N` period spans N calendar days, so `Q ≤ N`; `day/1/1` = explicitly daily), `week` interval 1–8 with quota 1–7×interval, `month` interval 1–12 with quota 1–min(31×interval, 365); `quota` omitted defaults to 1. A `month` period is a run of whole **calendar** months (1st → last day), so its due day is always month end and its length varies with the calendar — it is not "30 days". `update_habit {"cadence": null}` turns a habit back into a plain daily one (the period anchor is kept). Habit reads gain `cadence`, `isIntervalHabit` and `currentPeriod {start,end,dueDay,doneCount,quota,done}`; tool descriptions steer "is this period done" to `currentPeriod.done` and spell out the per-calendar-day check rules for interval habits (no `slotId`, `date` never in the future).
- **`CLIENT_API_VERSION` 2 → 3**, in lock-step with the app's `LocalHTTPServer.apiVersion`. The app's `minClientApiVersion` stays 1 — the change is additive, older kenotex-mcp builds keep working against a v3 app.
- **New `VERSION_SKEW` pre-flight for `cadence`**: `cadence` rides on a request *field*, not a new route, so a pre-v3 app would accept the write and silently drop it (creating a daily habit). Writes carrying `cadence` (including `null`) now check the app's advertised API version first and are refused with `VERSION_SKEW` when the app is too old; the message says `cadence` ships with the next Kenotex macOS app release and that every other tool keeps working with the current app. Writes without `cadence`, and apps that are current or unreachable, behave exactly as before.
- **The `VERSION_SKEW` refusal now re-checks the running app before it fires.** The app's `/health` version was probed once and cached for the life of the process, so a user who followed the hint and updated the Kenotex app kept getting `cadence` writes refused until the MCP server was restarted. The guard now re-probes `/health` when the cached version fails the requirement and only refuses if the *running* app is still too old — the satisfied path never re-reads `/health`, and a re-probe that cannot reach the app leaves the error exactly as before.
- **The "app is older than this integration" hint is now scoped to `/v1/habits`.** It used to be appended to *every* `/v1/` 404 whenever the app advertised a lower `apiVersion`, so against a v2 app an ordinary "todo not found" came back as "…— Ask the user to update the Kenotex macOS app", and the LLM relayed that as an instruction. Since the v2 → v3 step is additive, the only thing a v2 app cannot do is `cadence`: non-habit 404s are now returned verbatim, the habit-route note names `cadence` and says every other tool still works, and the startup stderr line says the same instead of demanding an update. The opposite direction is unchanged and still unscoped — when the app raises `minClientApiVersion` past this build, every error says to run `npx kenotex-mcp@latest`, because that one really does break every tool.
- **Compatibility with an app on local API v2**: `create_habit` / `update_habit` calls that carry `cadence` (including `cadence: null`) are refused with `VERSION_SKEW` and are never sent; every other tool — todos, events, categories, reminders, and all seven habit tools used without `cadence` — works exactly as it did on 1.2.3. Upgrading alongside the Kenotex macOS app release that advertises local API v3 is recommended, since that is when interval habits become usable.

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
