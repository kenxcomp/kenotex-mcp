import { describe, test, expect, beforeEach, mock } from "bun:test";
import { KenotexClient } from "../src/client.js";
import { todoTools } from "../src/tools/todos.js";
import { eventTools } from "../src/tools/events.js";
import { habitTools } from "../src/tools/habits.js";
import { categoryTools } from "../src/tools/categories.js";
import { reminderTools } from "../src/tools/reminders.js";

describe("tool definitions", () => {
  test("all tools have name + description + inputSchema", () => {
    const client = new KenotexClient({ token: "t" });
    const all = [
      ...todoTools(client).definitions,
      ...eventTools(client).definitions,
      ...habitTools(client).definitions,
      ...categoryTools(client).definitions,
      ...reminderTools(client).definitions,
    ];
    for (const tool of all) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  test("total tool count is 22", () => {
    const client = new KenotexClient({ token: "t" });
    const count =
      todoTools(client).definitions.length +
      eventTools(client).definitions.length +
      habitTools(client).definitions.length +
      categoryTools(client).definitions.length +
      reminderTools(client).definitions.length;
    expect(count).toBe(22);
  });

  test("create_todo requires categoryId", () => {
    const client = new KenotexClient({ token: "t" });
    const createTodo = todoTools(client).definitions.find((t) => t.name === "create_todo");
    expect(createTodo?.inputSchema.required).toContain("categoryId");
  });
});

describe("habit tool definitions", () => {
  const client = new KenotexClient({ token: "t" });
  const defs = habitTools(client).definitions;

  test("create_habit requires only title", () => {
    const createHabit = defs.find((t) => t.name === "create_habit");
    expect(createHabit?.inputSchema.required).toEqual(["title"]);
  });

  test("set_habit_check requires id + checked", () => {
    const setCheck = defs.find((t) => t.name === "set_habit_check");
    expect(setCheck?.inputSchema.required).toEqual(["id", "checked"]);
    const props = setCheck?.inputSchema.properties as Record<string, { type?: string }>;
    expect(props.checked?.type).toBe("boolean");
  });

  test("update_habit endDate is tri-state (string|null)", () => {
    const updateHabit = defs.find((t) => t.name === "update_habit");
    const props = updateHabit?.inputSchema.properties as Record<string, { type?: unknown }>;
    expect(props.endDate?.type).toEqual(["string", "null"]);
    expect(props.times?.type).toEqual(["array", "null"]);
  });

  test("delete_habit warns about destroying check history", () => {
    const del = defs.find((t) => t.name === "delete_habit");
    expect(del?.description).toMatch(/check-?in history|PERMANENTLY/i);
  });
});

describe("todo tool handlers", () => {
  let client: KenotexClient;
  let handlers: ReturnType<typeof todoTools>["handlers"];
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  beforeEach(() => {
    client = new KenotexClient({ token: "t" });
    handlers = todoTools(client).handlers;
    capturedUrl = undefined;
    capturedInit = undefined;
    (globalThis as Record<string, unknown>).fetch = mock(
      async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true, data: { id: "new-id" } }), {
          status: 200,
        });
      },
    );
  });

  test("create_todo posts to /v1/todos with body", async () => {
    await handlers.create_todo!({ title: "x", priority: "high" });
    expect(capturedUrl).toMatch(/\/v1\/todos$/);
    expect(capturedInit?.method).toBe("POST");
    const body = JSON.parse(capturedInit!.body as string);
    expect(body.title).toBe("x");
    expect(body.priority).toBe("high");
  });

  test("list_todos adds filter query param", async () => {
    await handlers.list_todos!({ filter: "today" });
    expect(capturedUrl).toContain("/v1/todos?");
    expect(capturedUrl).toContain("filter=today");
    expect(capturedInit?.method).toBe("GET");
  });

  test("get_todo uses id in path", async () => {
    await handlers.get_todo!({ id: "abc-123" });
    expect(capturedUrl).toMatch(/\/v1\/todos\/abc-123$/);
    expect(capturedInit?.method).toBe("GET");
  });

  test("update_todo strips id from body and uses PATCH", async () => {
    await handlers.update_todo!({ id: "abc", title: "new" });
    expect(capturedUrl).toMatch(/\/v1\/todos\/abc$/);
    expect(capturedInit?.method).toBe("PATCH");
    const body = JSON.parse(capturedInit!.body as string);
    expect(body).toEqual({ title: "new" });
  });

  test("complete_todo POSTs to /toggle", async () => {
    await handlers.complete_todo!({ id: "xyz" });
    expect(capturedUrl).toMatch(/\/v1\/todos\/xyz\/toggle$/);
    expect(capturedInit?.method).toBe("POST");
  });

  test("delete_todo uses DELETE", async () => {
    await handlers.delete_todo!({ id: "abc" });
    expect(capturedInit?.method).toBe("DELETE");
  });

  test("get_todo rejects a path-traversal id before fetch (#8)", () => {
    // pathSegmentId throws synchronously while building the URL, before any fetch.
    expect(() => handlers.get_todo!({ id: "../categories/x" })).toThrow(
      /path separator/,
    );
    expect(capturedUrl).toBeUndefined();
  });

  test("delete_todo rejects a path-traversal id before fetch (#8)", () => {
    expect(() => handlers.delete_todo!({ id: "../categories/x" })).toThrow(
      /path separator/,
    );
    expect(capturedUrl).toBeUndefined();
  });
});

describe("event tool handlers", () => {
  let client: KenotexClient;
  let handlers: ReturnType<typeof eventTools>["handlers"];

  beforeEach(() => {
    client = new KenotexClient({ token: "t" });
    handlers = eventTools(client).handlers;
    (globalThis as Record<string, unknown>).fetch = mock(
      async () => new Response("{}", { status: 200 }),
    );
  });

  test("create_event rejects after: recurrence client-side", async () => {
    await expect(
      handlers.create_event!({
        title: "x",
        startDate: "2026-05-01",
        endDate: "2026-05-01",
        recurrence: "after:daily",
      }),
    ).rejects.toThrow(/after:/);
  });

  test("create_event allows daily recurrence", async () => {
    await expect(
      handlers.create_event!({
        title: "x",
        startDate: "2026-05-01",
        endDate: "2026-05-01",
        recurrence: "daily",
      }),
    ).resolves.toBeTruthy();
  });

  test("list_events sends from + to + preview query", async () => {
    let url: string | undefined;
    (globalThis as Record<string, unknown>).fetch = mock(
      async (u: string) => {
        url = u;
        return new Response("{}", { status: 200 });
      },
    );
    await handlers.list_events!({ from: "2026-04-01", to: "2026-04-30", preview: true });
    expect(url).toContain("from=2026-04-01");
    expect(url).toContain("to=2026-04-30");
    expect(url).toContain("preview=true");
  });
});

describe("habit tool handlers", () => {
  let client: KenotexClient;
  let handlers: ReturnType<typeof habitTools>["handlers"];
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  beforeEach(() => {
    client = new KenotexClient({ token: "t" });
    handlers = habitTools(client).handlers;
    capturedUrl = undefined;
    capturedInit = undefined;
    (globalThis as Record<string, unknown>).fetch = mock(
      async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true, data: { id: "h1" } }), {
          status: 200,
        });
      },
    );
  });

  test("create_habit posts to /v1/habits with body", async () => {
    await handlers.create_habit!({ title: "meds", times: ["09:00", "21:00"] });
    expect(capturedUrl).toMatch(/\/v1\/habits$/);
    expect(capturedInit?.method).toBe("POST");
    const body = JSON.parse(capturedInit!.body as string);
    expect(body.title).toBe("meds");
    expect(body.times).toEqual(["09:00", "21:00"]);
  });

  test("list_habits calls GET /v1/habits (no query)", async () => {
    await handlers.list_habits!({});
    expect(capturedUrl).toMatch(/\/v1\/habits$/);
    expect(capturedUrl).not.toContain("?");
    expect(capturedInit?.method).toBe("GET");
  });

  test("get_habit uses id in path", async () => {
    await handlers.get_habit!({ id: "abc-123" });
    expect(capturedUrl).toMatch(/\/v1\/habits\/abc-123$/);
    expect(capturedInit?.method).toBe("GET");
  });

  test("update_habit strips id, uses PATCH, keeps endDate:null on the wire", async () => {
    await handlers.update_habit!({ id: "abc", endDate: null });
    expect(capturedUrl).toMatch(/\/v1\/habits\/abc$/);
    expect(capturedInit?.method).toBe("PATCH");
    const body = JSON.parse(capturedInit!.body as string);
    expect("id" in body).toBe(false);
    expect(body.endDate).toBeNull();
    expect("endDate" in body).toBe(true);
  });

  test("set_habit_check PUTs to /checks, strips id, passes slotId", async () => {
    await handlers.set_habit_check!({ id: "h1", checked: true, slotId: "s1" });
    expect(capturedUrl).toMatch(/\/v1\/habits\/h1\/checks$/);
    expect(capturedInit?.method).toBe("PUT");
    const body = JSON.parse(capturedInit!.body as string);
    expect("id" in body).toBe(false);
    expect(body.checked).toBe(true);
    expect(body.slotId).toBe("s1");
  });

  test("set_habit_check passes checked:false through", async () => {
    await handlers.set_habit_check!({ id: "h1", checked: false });
    const body = JSON.parse(capturedInit!.body as string);
    expect(body.checked).toBe(false);
  });

  test("set_habit_check without date does not send date on the wire", async () => {
    await handlers.set_habit_check!({ id: "h1", checked: true });
    const body = JSON.parse(capturedInit!.body as string);
    expect("date" in body).toBe(false);
  });

  test("list_habit_checks adds from + to query", async () => {
    await handlers.list_habit_checks!({ id: "h1", from: "2026-06-01", to: "2026-06-30" });
    expect(capturedUrl).toContain("/v1/habits/h1/checks?");
    expect(capturedUrl).toContain("from=2026-06-01");
    expect(capturedUrl).toContain("to=2026-06-30");
  });

  test("list_habit_checks without range has no query string", async () => {
    await handlers.list_habit_checks!({ id: "h1" });
    expect(capturedUrl).toMatch(/\/v1\/habits\/h1\/checks$/);
  });

  test("delete_habit uses DELETE", async () => {
    await handlers.delete_habit!({ id: "h1" });
    expect(capturedInit?.method).toBe("DELETE");
    expect(capturedUrl).toMatch(/\/v1\/habits\/h1$/);
  });
});

describe("category + reminder handlers", () => {
  let client: KenotexClient;

  beforeEach(() => {
    client = new KenotexClient({ token: "t" });
    (globalThis as Record<string, unknown>).fetch = mock(
      async () => new Response("{}", { status: 200 }),
    );
  });

  test("list_categories calls GET /v1/categories", async () => {
    let method: string | undefined;
    let url: string | undefined;
    (globalThis as Record<string, unknown>).fetch = mock(
      async (u: string, init: RequestInit) => {
        url = u;
        method = init.method;
        return new Response("{}", { status: 200 });
      },
    );
    await categoryTools(client).handlers.list_categories!({});
    expect(method).toBe("GET");
    expect(url).toMatch(/\/v1\/categories$/);
  });

  test("add_reminder POSTs to /v1/reminders with entityType + minutesBefore", async () => {
    let body: string | undefined;
    (globalThis as Record<string, unknown>).fetch = mock(
      async (_u: string, init: RequestInit) => {
        body = init.body as string;
        return new Response("{}", { status: 200 });
      },
    );
    await reminderTools(client).handlers.add_reminder!({
      entityType: "todo",
      entityId: "t1",
      minutesBefore: 30,
    });
    const parsed = JSON.parse(body!);
    expect(parsed.entityType).toBe("todo");
    expect(parsed.minutesBefore).toBe(30);
  });

  test("remove_reminder uses DELETE on /v1/reminders/{id}", async () => {
    let method: string | undefined;
    let url: string | undefined;
    (globalThis as Record<string, unknown>).fetch = mock(
      async (u: string, init: RequestInit) => {
        url = u;
        method = init.method;
        return new Response("{}", { status: 200 });
      },
    );
    await reminderTools(client).handlers.remove_reminder!({ id: "r1" });
    expect(method).toBe("DELETE");
    expect(url).toMatch(/\/v1\/reminders\/r1$/);
  });
});
