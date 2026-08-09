import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { KenotexClient } from "../client.js";
import { pathSegmentId } from "../ids.js";

export function reminderTools(client: KenotexClient): {
  definitions: Tool[];
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
} {
  const definitions: Tool[] = [
    {
      name: "add_reminder",
      description:
        "Attach a reminder N minutes before a todo's deadline or an event's start. Creates the DB row and schedules an OS notification.",
      inputSchema: {
        type: "object",
        properties: {
          entityType: { enum: ["todo", "event"] },
          entityId: { type: "string" },
          minutesBefore: {
            type: "integer",
            minimum: 0,
            maximum: 525960,
            description: "0 = fire at deadline, 1440 = one day before",
          },
        },
        required: ["entityType", "entityId", "minutesBefore"],
      },
    },
    {
      name: "remove_reminder",
      description: "Remove a reminder by id and cancel its OS notification.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ];

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    add_reminder: (args) => client.request("POST", "/v1/reminders", args),
    remove_reminder: (args) =>
      client.request("DELETE", `/v1/reminders/${pathSegmentId(args.id)}`),
  };

  return { definitions, handlers };
}
