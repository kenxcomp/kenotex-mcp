# kenotex-mcp

**Let your coding agent manage your real todos, calendar, and habits.**

[Kenotex](https://kenxcomp.com/kenotex/?ct=npm-mcp) is a native planner for Mac and iPhone.
This package is its MCP server: point Claude Code, Claude Desktop, Cursor, Zed, or any MCP
client at it, and the agent works on the actual items in the app — creating todos with
categories and recurrence, scheduling calendar events, ticking off daily or interval check-in habits.
Not a scratchpad, not a markdown file. Everything lives in a local SQLite database on your
own machine.

> **Your agent writes on your Mac. It's on your iPhone via iCloud.**

Works with **Claude Code**, **Claude Desktop**, **Cursor**, **Zed**, **OpenClaw**, and
anything else that speaks MCP over stdio.

## Get the app

These tools drive the Kenotex **macOS** app — it hosts the local server this package talks
to, so you need it installed and running. Free to download, with in-app purchases.

**The MCP integration is not one of those purchases.** Every tool in this package talks to
the app's local HTTP server, which has no subscription gate — the whole integration works
on the free tier.

**→ [kenxcomp.com/kenotex](https://kenxcomp.com/kenotex/?ct=npm-mcp)**

## Prerequisites

- **macOS 26 or later** — the app's minimum. The iPhone app syncs over iCloud, but the MCP
  server talks to the Mac.
- The Kenotex macOS app must be **running** (it hosts the local HTTP server on port 21519).
- Node.js 20+ or Bun.

## Install

Globally:

```bash
npm install -g kenotex-mcp
# or
bun add -g kenotex-mcp
```

Or use it directly via npx / bunx (no install):

```bash
npx kenotex-mcp
```

## Configure in an MCP client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "kenotex": {
      "command": "npx",
      "args": ["-y", "kenotex-mcp"]
    }
  }
}
```

Restart Claude Desktop. You'll see the Kenotex tools appear in the 🛠️ menu.

### Cursor / Zed / OpenClaw

Same pattern: point the MCP config at `kenotex-mcp` as the `command`.

### Environment overrides

- `KENOTEX_HOST` — override base URL (default `http://127.0.0.1:21519`).
- `KENOTEX_TOKEN` — skip filesystem token discovery and use this token.

## Tools exposed

| Category   | Tool                                                |
| ---------- | --------------------------------------------------- |
| Todo       | `create_todo` `list_todos` `get_todo` `update_todo` `complete_todo` `delete_todo` |
| Event      | `create_event` `list_events` `get_event` `update_event` `delete_event` |
| Habit      | `create_habit` `list_habits` `get_habit` `update_habit` `set_habit_check` `list_habit_checks` `delete_habit` |
| Category   | `list_categories` `create_category`                 |
| Reminder   | `add_reminder` `remove_reminder`                    |

**`create_todo` requires a `categoryId`** — todos can no longer be created uncategorized. The flow is: call `list_categories` and reuse a matching category's id; if none fits, call `create_category` and use the returned id, then `create_todo`.

**Habits are check-in trackers** (medication, water, stretching) — **daily** by default (up to 6 dose times/day), or **interval** (Q times every N days / N times a week / N times a month) via `cadence`. Use `create_habit` for routines the user ticks off; use `create_todo` + recurrence for one-off tasks or *fixed-slot* schedules (a particular weekday, a particular day of the month) — `cadence` counts how many times per period, recurrence pins which day. Writes take `times: ["HH:mm", …]`; reads return `times: [{id, time}]` — pass a slot's `id` as `slotId` to `set_habit_check` for a multi-dose habit (omit it to check all of today's doses). `cadence: {"unit":"day"|"week"|"month","interval":N,"quota"?:Q,"startDate"?:"yyyy-MM-dd"}` makes an interval habit — `quota` defaults to 1, out-of-range is a 422 and is never clamped, `startDate` defaults to today and can never be changed afterwards, and an interval habit takes at most one dose time:

| `unit` | `interval` | `quota` | period |
|---|---|---|---|
| `day` | 1–365 | 1–`interval` | N calendar days, so `quota ≤ N`; `day/1` takes quota 1 = explicitly daily |
| `week` | 1–8 | 1–7×`interval` | N week(s) |
| `month` | 1–12 | 1–min(31×`interval`, 365) | N whole **calendar** months (1st → last day), so the due day is always month end and the period's length follows the calendar rather than a fixed 30 days |

Examples: `{"unit":"day","interval":3}` = every 3 days · `{"unit":"day","interval":5,"quota":2}` = twice every 5 days · `{"unit":"week","interval":1,"quota":2}` = twice a week · `{"unit":"month","interval":1,"quota":2}` = twice a month.

Reads add `cadence`, `isIntervalHabit` and `currentPeriod {start,end,dueDay,doneCount,quota,done}` (`quota` is the period's effective quota — the configured quota clamped to the period's checkable days from `startDate` on, so a 31-a-month habit reports 28 in February and 17 for a first month started on the 14th) — use `currentPeriod.done` for "is this period satisfied" (`checkedToday` stays a calendar-day fact). `update_habit {"cadence": null}` turns an interval habit back into a daily one (anchor kept). Interval habits are checked per calendar day (no `slotId`; `date` never in the future). Checking is explicit **set-state** (`checked: true|false`, `date` defaults to today, idempotent, `false` un-checks). **`delete_habit` permanently deletes the habit and its entire check-in history** — set an `endDate` via `update_habit` to stop-but-keep-records instead.

**App version**: habit tools require the Kenotex app release that ships `/v1/habits` (1.2.9+, local API v2). `cadence` additionally requires the release that advertises local API **v3** — against an older app a `cadence` write is refused up front with `VERSION_SKEW` rather than being silently ignored, and once the app is updated you just retry (the check re-reads the running app's version, no MCP restart needed). **Nothing else is gated**: on a v2 app every other tool, habit tools included, behaves exactly as it did before — only `cadence` is unavailable.

**Recurrence DSL**: `'daily'` / `'weekly:mon,wed,fri'` / `'monthly:15'` / `'yearly'` / `'after:daily'` (todos only) / `'none'`.

**Virtual event occurrences**: `get_event` accepts ids like `{parentId}__occ__{yyyy-MM-dd}`. Recurring parents materialize past occurrences on delete.

## How auth works

On each HTTP request the server reads the Kenotex bearer token from (in order):

1. `~/Library/Containers/com.kenxcomp.kenotex/Data/Library/Application Support/Kenotex/local-http-token`
2. `~/Library/Application Support/Kenotex/local-http-token`
3. `~/.kenotex-local-token`

The token is rotated each time the Kenotex app starts, so a stale MCP session just re-reads the file on its next tool call.

## Troubleshooting

**"Kenotex app not running or token not accessible"** — launch Kenotex.app. If running, the token file should exist at one of the three paths above.

**Requests time out** — check that no firewall is blocking localhost:21519; tools are hardcoded to 10-second timeout.

## License

MIT © kenxcomp
