#!/usr/bin/env node
/**
 * kenotex-mcp ── MCP server for Kenotex local API.
 *
 * Runs as a stdio-transport subprocess spawned by MCP clients (Claude
 * Desktop, Cursor, Zed, OpenClaw, etc.). Proxies tool calls over HTTP to
 * the Kenotex macOS app's local server on port 21519.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { KenotexClient, KenotexClientError } from "./client.js";
import { todoTools } from "./tools/todos.js";
import { eventTools } from "./tools/events.js";
import { habitTools } from "./tools/habits.js";
import { categoryTools } from "./tools/categories.js";
import { reminderTools } from "./tools/reminders.js";
import pkg from "../package.json" with { type: "json" };

async function main(): Promise<void> {
  const client = new KenotexClient();

  const todo = todoTools(client);
  const event = eventTools(client);
  const habit = habitTools(client);
  const cat = categoryTools(client);
  const reminder = reminderTools(client);

  const allDefs: Tool[] = [
    ...todo.definitions,
    ...event.definitions,
    ...habit.definitions,
    ...cat.definitions,
    ...reminder.definitions,
  ];
  const allHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> =
    {
      ...todo.handlers,
      ...event.handlers,
      ...habit.handlers,
      ...cat.handlers,
      ...reminder.handlers,
    };

  // Boot probe ── don't block start if app isn't running; just log to stderr.
  // Tool calls will surface the error back to the LLM with structured context.
  // health() also caches the app's API version for version-skew diagnostics.
  if (!(await client.health())) {
    process.stderr.write(
      "[kenotex-mcp] Warning: Kenotex local server not responding at http://127.0.0.1:21519.\n" +
        "             Tools will fail until the Kenotex macOS app is running.\n",
    );
  } else {
    const skew = client.versionSkewHint();
    if (skew) {
      process.stderr.write(`[kenotex-mcp] Version skew: ${skew}\n`);
    }
  }

  const server = new Server(
    { name: pkg.name, version: pkg.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allDefs,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const handler = allHandlers[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    try {
      const result = await handler(args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const err =
        error instanceof KenotexClientError
          ? { code: error.code, message: error.message, status: error.status }
          : {
              code: "UNKNOWN",
              message: error instanceof Error ? error.message : String(error),
            };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: err }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`[kenotex-mcp] Fatal: ${e?.message ?? e}\n`);
  process.exit(1);
});
