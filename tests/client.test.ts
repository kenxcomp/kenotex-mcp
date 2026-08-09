import { describe, test, expect, beforeEach, mock } from "bun:test";
import { KenotexClient, KenotexClientError, CLIENT_API_VERSION } from "../src/client.js";

/** Mock fetch that answers /health with the given version fields and every
 * other request with a 404 (simulating a missing / version-skewed endpoint). */
function mockHealthAnd404(health: { apiVersion?: number; minClientApiVersion?: number }) {
  (globalThis as Record<string, unknown>).fetch = mock(async (url: string) => {
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok", ...health }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: "no route" } }), { status: 404 });
  });
}

describe("KenotexClient", () => {
  beforeEach(() => {
    // Reset global fetch mock between tests
    (globalThis as Record<string, unknown>).fetch = mock(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  });

  test("uses KENOTEX_TOKEN env override when set", async () => {
    const client = new KenotexClient({ token: "env-token" });
    await client.request("GET", "/v1/todos");
    const fetchMock = (globalThis as Record<string, unknown>).fetch as ReturnType<
      typeof mock
    >;
    const calls = fetchMock.mock.calls;
    const init = calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer env-token");
  });

  test("throws TOKEN_NOT_FOUND when no token sources available", async () => {
    const client = new KenotexClient({ host: "http://127.0.0.1:21519" });
    try {
      await client.request("GET", "/v1/todos");
      expect.unreachable("should have thrown");
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("TOKEN_NOT_FOUND");
    }
  });

  test("maps HTTP 404 to NOT_FOUND error code", async () => {
    (globalThis as Record<string, unknown>).fetch = mock(async () =>
      new Response(JSON.stringify({ error: { message: "gone" } }), {
        status: 404,
      }),
    );
    const client = new KenotexClient({ token: "t" });
    try {
      await client.request("GET", "/v1/todos/nope");
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.status).toBe(404);
    }
  });

  test("maps HTTP 401 to UNAUTHORIZED", async () => {
    (globalThis as Record<string, unknown>).fetch = mock(
      async () => new Response("{}", { status: 401 }),
    );
    const client = new KenotexClient({ token: "t" });
    try {
      await client.request("GET", "/v1/todos");
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("UNAUTHORIZED");
    }
  });

  test("maps HTTP 422 to VALIDATION and exposes message", async () => {
    (globalThis as Record<string, unknown>).fetch = mock(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "VALIDATION", message: "bad title" } }),
          { status: 422 },
        ),
    );
    const client = new KenotexClient({ token: "t" });
    try {
      await client.request("POST", "/v1/todos", { title: "" });
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("VALIDATION");
      expect(e.message).toContain("bad title");
    }
  });

  test("builds query string from object", async () => {
    const client = new KenotexClient({ token: "t" });
    await client.request("GET", "/v1/todos", undefined, {
      filter: "today",
      limit: 5,
      empty: undefined,
    });
    const fetchMock = (globalThis as Record<string, unknown>).fetch as ReturnType<
      typeof mock
    >;
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("filter=today");
    expect(url).toContain("limit=5");
    expect(url).not.toContain("empty=");
  });

  test("sends Content-Type application/json for body requests", async () => {
    const client = new KenotexClient({ token: "t" });
    await client.request("POST", "/v1/todos", { title: "x" });
    const fetchMock = (globalThis as Record<string, unknown>).fetch as ReturnType<
      typeof mock
    >;
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("API version handshake", () => {
  test("health() caches app apiVersion → skew hint says update the app when app is older", async () => {
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION - 1, minClientApiVersion: 1 });
    const client = new KenotexClient({ token: "t" });
    await client.health();
    const hint = client.versionSkewHint();
    expect(hint).toMatch(/update the Kenotex macOS app/i);
  });

  test("matching versions produce no skew hint", async () => {
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION, minClientApiVersion: 1 });
    const client = new KenotexClient({ token: "t" });
    await client.health();
    expect(client.versionSkewHint()).toBeUndefined();
  });

  test("app requires a newer client → skew hint says update kenotex-mcp", async () => {
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION + 5, minClientApiVersion: CLIENT_API_VERSION + 1 });
    const client = new KenotexClient({ token: "t" });
    await client.health();
    expect(client.versionSkewHint()).toMatch(/npx kenotex-mcp@latest/);
  });

  test("404 on /v1 endpoint with older app appends 'update the app' hint to the error", async () => {
    // Older app: /v1/habits 404s and /health reports an apiVersion below ours.
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION - 1, minClientApiVersion: 1 });
    const client = new KenotexClient({ token: "t" });
    try {
      await client.request("POST", "/v1/habits", { title: "x" });
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.message).toMatch(/update the Kenotex macOS app/i);
    }
  });

  test("404 lazily probes /health even without a prior health() call", async () => {
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION - 1 });
    const client = new KenotexClient({ token: "t" });
    // No explicit health() — the error path must probe it.
    try {
      await client.request("GET", "/v1/habits/nope");
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.message).toMatch(/update the Kenotex macOS app/i);
    }
  });

  test("legacy app (versionless /health) → habit 404 says update the app", async () => {
    // Every already-shipped app (≤ the release before habits) returns
    // {status:"ok"} with no version fields. A 404 on /v1/habits against such an
    // app means it predates API v2 — tell the LLM to update the app.
    mockHealthAnd404({});
    const client = new KenotexClient({ token: "t" });
    try {
      await client.request("POST", "/v1/habits", { title: "x" });
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.message).toMatch(/update the Kenotex macOS app/i);
      expect(e.message).toMatch(/too old to support check-in habits/i);
    }
  });

  test("legacy app → 404 on a pre-v2 route stays a plain not-found (no update hint)", async () => {
    // A missing todo is a real 404, not a version issue — the too-old hint must
    // NOT fire on routes that existed before habits.
    mockHealthAnd404({});
    const client = new KenotexClient({ token: "t" });
    try {
      await client.request("GET", "/v1/todos/nope");
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.message).not.toMatch(/update the Kenotex/i);
      expect(e.message).not.toMatch(/kenotex-mcp@latest/);
    }
  });

  test("failed boot health probe does not permanently suppress the version hint", async () => {
    // MCP started before the app: the boot health() throws (connection refused).
    // Later, the app is up (older than us) and a /v1/habits call 404s — the error
    // path MUST re-probe /health and still surface the "update the app" hint,
    // rather than giving up because a probe was already attempted once.
    let healthCalls = 0;
    (globalThis as Record<string, unknown>).fetch = mock(async (url: string) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        if (healthCalls === 1) throw new Error("connection refused"); // app down at boot
        return new Response(
          JSON.stringify({ status: "ok", apiVersion: CLIENT_API_VERSION - 1 }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: { message: "no route" } }), { status: 404 });
    });
    const client = new KenotexClient({ token: "t" });
    expect(await client.health()).toBe(false); // boot probe fails, no version learned
    try {
      await client.request("POST", "/v1/habits", { title: "x" });
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.message).toMatch(/update the Kenotex macOS app/i);
    }
    expect(healthCalls).toBe(2); // re-probed after the failed boot probe
  });
});
