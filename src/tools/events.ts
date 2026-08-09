import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { KenotexClient } from "../client.js";
import { pathSegmentId } from "../ids.js";

export function eventTools(client: KenotexClient): {
  definitions: Tool[];
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
} {
  const definitions: Tool[] = [
    {
      name: "create_event",
      description:
        "Create a calendar event in Kenotex. `recurrence` supports 'daily' | 'weekly:mon,wed' | 'monthly:15' | 'yearly' | 'none'. 'after:*' is NOT supported for events.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          startDate: {
            type: "string",
            description: "yyyy-MM-dd or yyyy-MM-dd HH:mm",
          },
          endDate: {
            type: "string",
            description: "Must be >= startDate",
          },
          allDay: { type: "boolean", default: false },
          description: { type: "string" },
          recurrence: { type: "string" },
          reminderMinutes: {
            type: "array",
            items: { type: "integer", minimum: 0 },
          },
        },
        required: ["title", "startDate", "endDate"],
      },
    },
    {
      name: "list_events",
      description:
        "List calendar events in a date range. Virtual recurring occurrences are expanded.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "yyyy-MM-dd (inclusive)" },
          to: { type: "string", description: "yyyy-MM-dd (inclusive)" },
          preview: {
            type: "boolean",
            default: false,
            description: "If true, expand all future occurrences within 6-month window",
          },
        },
        required: ["from", "to"],
      },
    },
    {
      name: "get_event",
      description:
        "Fetch a specific event by id. Accepts real event ids or virtual occurrence ids (`{parent}__occ__{yyyy-MM-dd}`).",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "update_event",
      description:
        "Partially update an event. Cannot update virtual occurrences — modify parent or create exception.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          allDay: { type: "boolean" },
          description: { type: ["string", "null"] },
          recurrence: { type: ["string", "null"] },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_event",
      description:
        "Delete an event. Recurring parents materialize past occurrences then delete.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ];

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    create_event: async (args) => {
      // Reject after:* on the client side for faster feedback
      const rec = args.recurrence as string | undefined;
      if (typeof rec === "string" && rec.toLowerCase().startsWith("after:")) {
        throw new Error(
          "Events do not support 'after:' recurrence mode (only todos do).",
        );
      }
      return client.request("POST", "/v1/events", args);
    },
    list_events: (args) =>
      client.request("GET", "/v1/events", undefined, {
        from: args.from as string,
        to: args.to as string,
        preview: args.preview ? "true" : undefined,
      }),
    get_event: (args) =>
      client.request("GET", `/v1/events/${pathSegmentId(args.id)}`),
    update_event: (args) => {
      const { id, ...body } = args;
      return client.request("PATCH", `/v1/events/${pathSegmentId(id)}`, body);
    },
    delete_event: (args) =>
      client.request("DELETE", `/v1/events/${pathSegmentId(args.id)}`),
  };

  return { definitions, handlers };
}
