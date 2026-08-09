# kenotex-mcp

**Let your coding agent manage your real todos, calendar, and habits.**

[Kenotex](https://kenxcomp.com/kenotex/?ct=npm-mcp) is a native planner for Mac and iPhone.
This package is its MCP server: point Claude Code, Claude Desktop, Cursor, Zed, or any MCP
client at it, and the agent works on the actual items in the app — creating todos with
categories and recurrence, scheduling calendar events, ticking off daily check-in habits.
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

**Habits are daily check-in trackers** (medication, water, stretching), up to 6 dose times/day. Use `create_habit` for daily routines the user ticks off; use `create_todo` + recurrence for one-off or non-daily schedules. Writes take `times: ["HH:mm", …]`; reads return `times: [{id, time}]` — pass a slot's `id` as `slotId` to `set_habit_check` for a multi-dose habit (omit it to check all of today's doses). Checking is explicit **set-state** (`checked: true|false`, `date` defaults to today, idempotent, `false` un-checks). **`delete_habit` permanently deletes the habit and its entire check-in history** — set an `endDate` via `update_habit` to stop-but-keep-records instead. Habit tools require the Kenotex app release that ships `/v1/habits` (1.2.9+); against an older app they return an "update the Kenotex app" hint.

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
