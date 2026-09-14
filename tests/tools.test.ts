import { describe, test, expect, beforeEach, mock } from "bun:test";
import { KenotexClient, KenotexClientError } from "../src/client.js";
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

  test("create_habit exposes cadence {unit enum day|week|month, interval, quota?, startDate?}", () => {
    const createHabit = defs.find((t) => t.name === "create_habit");
    const props = createHabit?.inputSchema.properties as Record<string, any>;
    expect(props.cadence?.type).toBe("object");
    expect(props.cadence?.required).toEqual(["unit", "interval"]);
    expect(props.cadence?.properties?.unit?.enum).toEqual(["day", "week", "month"]);
    expect(props.cadence?.properties?.interval?.type).toBe("integer");
    expect(props.cadence?.properties?.quota?.type).toBe("integer");
    expect(props.cadence?.properties?.startDate?.type).toBe("string");
    // still optional: a plain daily habit needs only a title
    expect(createHabit?.inputSchema.required).toEqual(["title"]);
    expect(createHabit?.description).toMatch(/interval/i);
    expect(createHabit?.description).not.toMatch(/daily-only/i);
  });

  test("cadence quota carries the day-unit range (1…interval), not a fixed 1", () => {
    const createHabit = defs.find((t) => t.name === "create_habit");
    const props = createHabit?.inputSchema.properties as Record<string, any>;
    const cadence = props.cadence;
    // quota has a real day-unit range now: 1…interval (a day/N period spans N calendar days)
    expect(cadence?.properties?.quota?.description).toMatch(/day: 1–interval/);
    expect(cadence?.properties?.quota?.description).toMatch(/week: 1–7×interval/);
    expect(cadence?.properties?.quota?.description).not.toMatch(/must be 1|always 1/i);
    expect(cadence?.properties?.unit?.description).not.toMatch(/quota is always 1/i);
    // the accepted table on the cadence field mirrors it, day/1/1 still = explicitly daily
    expect(cadence?.description).toMatch(/day interval 1–365 with quota 1–interval/);
    expect(cadence?.description).toMatch(/week interval 1–8 with quota 1–7×interval/);
    // stage 4: month periods are calendar months, so the due day is always month end
    expect(cadence?.properties?.quota?.description).toMatch(/month: 1–min\(31×interval, 365\)/);
    expect(cadence?.description).toMatch(/month interval 1–12 with quota 1–min\(31×interval, 365\)/);
    expect(cadence?.description).toMatch(/calendar month/);
    expect(cadence?.description).toMatch(/day\/1 with quota 1 = explicitly daily/);
    // out-of-range is still rejected, never clamped
    expect(cadence?.description).toMatch(/never clamped/);
  });

  test("update_habit cadence is tri-state (object|null) with the same shape", () => {
    const updateHabit = defs.find((t) => t.name === "update_habit");
    const props = updateHabit?.inputSchema.properties as Record<string, any>;
    expect(props.cadence?.type).toEqual(["object", "null"]);
    expect(props.cadence?.properties?.unit?.enum).toEqual(["day", "week", "month"]);
    expect(updateHabit?.description).toMatch(/cadence: null/);
  });

  test("interval semantics are described on the read + check tools", () => {
    const byName = (n: string) => defs.find((t) => t.name === n)?.description ?? "";
    expect(byName("list_habits")).toMatch(/currentPeriod/);
    expect(byName("get_habit")).toMatch(/currentPeriod\.done/);
    expect(byName("set_habit_check")).toMatch(/interval/i);
    expect(byName("set_habit_check")).toMatch(/never in the future/i);
    expect(byName("list_habit_checks")).toMatch(/interval/i);
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

describe("habit cadence version guard", () => {
  let handlers: ReturnType<typeof habitTools>["handlers"];
  /** Non-/health requests captured in order (method + url + parsed body). */
  let sent: { method: string; url: string; body: unknown }[];

  /** Mock fetch: /health answers with `health` (or throws when undefined = app
   * unreachable); every other request is recorded and answered 200. */
  function mockApp(health: Record<string, unknown> | undefined) {
    sent = [];
    (globalThis as Record<string, unknown>).fetch = mock(
      async (url: string, init?: RequestInit) => {
        if (url.endsWith("/health")) {
          if (health === undefined) throw new Error("connection refused");
          return new Response(JSON.stringify({ status: "ok", ...health }), { status: 200 });
        }
        sent.push({
          method: init?.method ?? "GET",
          url,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        return new Response(JSON.stringify({ ok: true, data: { id: "h1" } }), { status: 200 });
      },
    );
  }

  beforeEach(() => {
    handlers = habitTools(new KenotexClient({ token: "t" })).handlers;
  });

  test("create_habit with cadence posts it on the wire against a v3 app", async () => {
    mockApp({ apiVersion: 3, minClientApiVersion: 1 });
    await handlers.create_habit!({ title: "浇花", cadence: { unit: "day", interval: 3 } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("POST");
    expect(sent[0]!.url).toMatch(/\/v1\/habits$/);
    expect((sent[0]!.body as any).cadence).toEqual({ unit: "day", interval: 3 });
  });

  test("update_habit keeps cadence:null on the wire against a v3 app", async () => {
    mockApp({ apiVersion: 3, minClientApiVersion: 1 });
    await handlers.update_habit!({ id: "h1", cadence: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("PATCH");
    const body = sent[0]!.body as Record<string, unknown>;
    expect("cadence" in body).toBe(true);
    expect(body.cadence).toBeNull();
    expect("id" in body).toBe(false);
  });

  test("create_habit with cadence against a v2 app is refused with VERSION_SKEW before any POST", async () => {
    mockApp({ apiVersion: 2, minClientApiVersion: 1 });
    try {
      await handlers.create_habit!({ title: "浇花", cadence: { unit: "day", interval: 3 } });
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("VERSION_SKEW");
      expect(e.message).toMatch(/update the Kenotex macOS app/i);
      expect(e.message).toMatch(/local API v3\+/);
    }
    expect(sent).toHaveLength(0);
  });

  test("update_habit cadence:null against a v2 app is refused too (it is a v3 write)", async () => {
    mockApp({ apiVersion: 2, minClientApiVersion: 1 });
    await expect(handlers.update_habit!({ id: "h1", cadence: null })).rejects.toMatchObject({
      code: "VERSION_SKEW",
    });
    expect(sent).toHaveLength(0);
  });

  test("cadence against a legacy versionless app is refused", async () => {
    mockApp({});
    await expect(
      handlers.create_habit!({ title: "x", cadence: { unit: "week", interval: 1, quota: 2 } }),
    ).rejects.toMatchObject({ code: "VERSION_SKEW" });
    expect(sent).toHaveLength(0);
  });

  test("writes WITHOUT cadence are never gated (v2 app still gets the POST / PATCH)", async () => {
    mockApp({ apiVersion: 2, minClientApiVersion: 1 });
    await handlers.create_habit!({ title: "meds", times: ["09:00", "21:00"] });
    await handlers.update_habit!({ id: "h1", endDate: null });
    expect(sent.map((r) => r.method)).toEqual(["POST", "PATCH"]);
  });

  test("cadence with the app unreachable (version unknown) passes through to the request", async () => {
    mockApp(undefined);
    await handlers.create_habit!({ title: "x", cadence: { unit: "day", interval: 2 } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("POST");
  });

  test("v2 app, end to end: cadence write refused with VERSION_SKEW, ordinary 404 left clean", async () => {
    // The two halves of the "published ahead of the app" contract, on one app:
    // the cadence write is the ONLY thing that gets a version verdict, and an
    // unrelated not-found must not be dressed up as a version problem.
    const seen: string[] = [];
    (globalThis as Record<string, unknown>).fetch = mock(
      async (url: string, init?: RequestInit) => {
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ status: "ok", apiVersion: 2, minClientApiVersion: 1 }), {
            status: 200,
          });
        }
        seen.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(JSON.stringify({ error: { message: "Todo not found" } }), {
          status: 404,
        });
      },
    );
    const client = new KenotexClient({ token: "t" });
    const habits = habitTools(client).handlers;

    // 1) cadence write: refused client-side, never reaches the app.
    try {
      await habits.create_habit!({ title: "浇花", cadence: { unit: "month", interval: 1, quota: 2 } });
      expect.unreachable("cadence write should have been refused");
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("VERSION_SKEW");
      expect(e.message).toMatch(/update the Kenotex macOS app/i);
      expect(e.message).toMatch(/NOT sent/);
    }
    expect(seen).toHaveLength(0);

    // 2) an ordinary missing todo on the same app: plain not-found, no hint.
    try {
      await todoTools(client).handlers.get_todo!({ id: "nope" });
      expect.unreachable("should have thrown");
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.message).toBe("Todo not found");
      expect(e.message).not.toMatch(/update the Kenotex/i);
    }
    expect(seen).toEqual(["GET http://127.0.0.1:21519/v1/todos/nope"]);
  });

  test("retry after the user updates the app is sent — no MCP restart needed", async () => {
    // The refusal tells the user to update the Kenotex app. Same client instance,
    // same handlers: once the running app advertises v3, the retried write must
    // reach the wire instead of being refused by a boot-time version cache.
    const health: Record<string, unknown> = { apiVersion: 2, minClientApiVersion: 1 };
    mockApp(health);
    const cadence = { unit: "day", interval: 3 };
    await expect(handlers.create_habit!({ title: "浇花", cadence })).rejects.toMatchObject({
      code: "VERSION_SKEW",
    });
    expect(sent).toHaveLength(0);

    health.apiVersion = 3; // user updates the Kenotex macOS app
    await handlers.create_habit!({ title: "浇花", cadence });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("POST");
    expect((sent[0]!.body as any).cadence).toEqual(cadence);
  });

  test("ungated writes add no /health traffic (only the guard probes)", async () => {
    let healthCalls = 0;
    sent = [];
    (globalThis as Record<string, unknown>).fetch = mock(
      async (url: string, init?: RequestInit) => {
        if (url.endsWith("/health")) {
          healthCalls += 1;
          return new Response(JSON.stringify({ status: "ok", apiVersion: 2 }), { status: 200 });
        }
        sent.push({
          method: init?.method ?? "GET",
          url,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        return new Response(JSON.stringify({ ok: true, data: { id: "h1" } }), { status: 200 });
      },
    );
    await handlers.create_habit!({ title: "meds", times: ["09:00"] });
    await handlers.update_habit!({ id: "h1", endDate: null });
    await handlers.list_habits!({});
    expect(sent.map((r) => r.method)).toEqual(["POST", "PATCH", "GET"]);
    expect(healthCalls).toBe(0);
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
