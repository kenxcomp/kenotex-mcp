import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { KenotexClient } from "../client.js";

export function categoryTools(client: KenotexClient): {
  definitions: Tool[];
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
} {
  const definitions: Tool[] = [
    {
      name: "list_categories",
      description:
        "List all todo categories in Kenotex. Useful before `create_todo` so the LLM can pick a valid categoryId.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "create_category",
      description: "Create a new todo category.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          color: {
            type: "string",
            description: "Hex color, e.g. '#FF0000'. Defaults to #6B7280.",
          },
        },
        required: ["name"],
      },
    },
  ];

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    list_categories: () => client.request("GET", "/v1/categories"),
    create_category: (args) => client.request("POST", "/v1/categories", args),
  };

  return { definitions, handlers };
}
