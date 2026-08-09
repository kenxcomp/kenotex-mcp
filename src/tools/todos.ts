import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { KenotexClient } from "../client.js";
import { pathSegmentId } from "../ids.js";

/** Create an array of Todo tools bound to a given client. */
export function todoTools(client: KenotexClient): {
  definitions: Tool[];
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
} {
  const definitions: Tool[] = [
    {
      name: "create_todo",
      description:
        "Create a todo in Kenotex. Use when the user wants to add, remember, or track a task. A categoryId is REQUIRED — fetch one via list_categories (or create_category) first.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short task name" },
          priority: { enum: ["high", "medium", "low"], default: "medium" },
          deadline: {
            type: "string",
            description: "yyyy-MM-dd or yyyy-MM-dd HH:mm (24-hour)",
          },
          startDate: {
            type: "string",
            description: "Earliest date the task can start, yyyy-MM-dd",
          },
          description: { type: "string", description: "Details / markdown" },
          categoryId: {
            type: "string",
            description:
              "Required. Call list_categories first and reuse a matching category's id; if none fits, call create_category then use the returned id. Todos cannot be created without a category.",
          },
          recurrence: {
            type: "string",
            description:
              "Recurrence DSL: 'daily' | 'weekly:mon,wed' | 'monthly:15' | 'yearly' | 'after:daily' | 'none'",
          },
          reminderMinutes: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            description: "Minutes before deadline to fire OS notifications",
          },
        },
        required: ["title", "categoryId"],
      },
    },
    {
      name: "list_todos",
      description: "List todos with optional filter and limit.",
      inputSchema: {
        type: "object",
        properties: {
          filter: {
            enum: ["all", "today", "overdue", "week", "pending", "completed"],
            default: "pending",
          },
          limit: { type: "integer", minimum: 1, maximum: 1000, default: 50 },
          sort: {
            enum: ["newest", "priority", "deadline", "default"],
            default: "default",
          },
        },
      },
    },
    {
      name: "get_todo",
      description: "Fetch a specific todo by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "update_todo",
      description:
        "Partially update a todo. Null values explicitly clear fields; omit fields to keep existing values.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          priority: { enum: ["high", "medium", "low"] },
          deadline: { type: ["string", "null"] },
          startDate: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          categoryId: { type: ["string", "null"] },
          recurrence: { type: ["string", "null"] },
          completed: { type: "boolean" },
        },
        required: ["id"],
      },
    },
    {
      name: "complete_todo",
      description:
        "Mark a todo complete. For recurring parents, completes the next uncompleted instance.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "delete_todo",
      description:
        "Delete a todo. Recurring parents also remove all child instances.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ];

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    create_todo: (args) =>
      client.request("POST", "/v1/todos", args),
    list_todos: (args) =>
      client.request("GET", "/v1/todos", undefined, {
        filter: args.filter as string | undefined,
        limit: args.limit as number | undefined,
        sort: args.sort as string | undefined,
      }),
    get_todo: (args) =>
      client.request("GET", `/v1/todos/${pathSegmentId(args.id)}`),
    update_todo: (args) => {
      const { id, ...body } = args;
      return client.request("PATCH", `/v1/todos/${pathSegmentId(id)}`, body);
    },
    complete_todo: async (args) => {
      const id = pathSegmentId(args.id);
      // Idempotent: fetch current state first, skip toggle if already completed.
      // The /toggle endpoint is symmetric — calling it on an already-complete todo
      // re-opens it, which violates "Mark complete" semantics for LLM callers.
      const current = (await client.request("GET", `/v1/todos/${id}`)) as {
        data?: { completed?: boolean };
      };
      if (current?.data?.completed === true) {
        return current;
      }
      return client.request("POST", `/v1/todos/${id}/toggle`, {});
    },
    delete_todo: (args) =>
      client.request("DELETE", `/v1/todos/${pathSegmentId(args.id)}`),
  };

  return { definitions, handlers };
}
