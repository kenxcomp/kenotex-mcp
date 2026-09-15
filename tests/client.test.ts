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
  test("health() caches app apiVersion → an app one version behind gets a SOFT note", async () => {
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION - 1, minClientApiVersion: 1 });
    const client = new KenotexClient({ token: "t" });
    await client.health();
    const hint = client.versionSkewHint();
    // The v2 → v3 step is additive, so the note must name the ONE thing that is
    // unavailable, say the rest still works, and make the update conditional.
    // An unconditional "update the app" reaches users of a current app as an
    // instruction they cannot act on until the matching app release ships.
    expect(hint).toMatch(/cadence/i);
    expect(hint).toMatch(/every other tool works/i);
    expect(hint).toMatch(/only if the user wants interval habits/i);
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

/**
 * kenotex-mcp targeting API v3 reaches npm before (or alongside) the Kenotex app
 * release that advertises v3, so for a while EVERY installed app reports v2.
 * That has to stay a non-event: `cadence` is the only thing unavailable, and an
 * unrelated not-found must not come back carrying "update the Kenotex app" —
 * the LLM relays that to a user who has no such update to install.
 */
describe("v3 client against a v2 app (client shipped ahead of the app release)", () => {
  const V2 = { apiVersion: 2, minClientApiVersion: 1 };

  test("404 on a non-habit route stays a plain not-found, verbatim", async () => {
    (globalThis as Record<string, unknown>).fetch = mock(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok", ...V2 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "Todo not found" } }), {
        status: 404,
      });
    });
    const client = new KenotexClient({ token: "t" });
    await client.health(); // app version is known and lower than ours
    try {
      await client.request("GET", "/v1/todos/nope");
      expect.unreachable("should have thrown");
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.message).toBe("Todo not found"); // nothing appended at all
      expect(e.message).not.toMatch(/update the Kenotex/i);
      expect(e.message).not.toMatch(/cadence/i);
    }
  });

  test("404 on /v1/habits still carries the version note (the scope boundary, other side)", async () => {
    mockHealthAnd404(V2);
    const client = new KenotexClient({ token: "t" });
    try {
      await client.request("GET", "/v1/habits/nope");
      expect.unreachable("should have thrown");
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.message).toMatch(/cadence/i);
      expect(e.message).toMatch(/local API v2/);
    }
  });

  test("the narrowing does not swallow the other direction: an outdated MCP is still flagged everywhere", async () => {
    // A MCP the app refuses outright breaks every route, not one feature, so
    // that hint stays unscoped — including on a plain /v1/todos 404.
    mockHealthAnd404({
      apiVersion: CLIENT_API_VERSION + 1,
      minClientApiVersion: CLIENT_API_VERSION + 1,
    });
    const client = new KenotexClient({ token: "t" });
    try {
      await client.request("GET", "/v1/todos/nope");
      expect.unreachable("should have thrown");
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.message).toMatch(/npx kenotex-mcp@latest/);
    }
  });
});

describe("requireApiVersion (success-path guard for field-level features)", () => {
  test("resolves when the app meets the minimum", async () => {
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION, minClientApiVersion: 1 });
    const client = new KenotexClient({ token: "t" });
    await expect(client.requireApiVersion(CLIENT_API_VERSION, "x")).resolves.toBeUndefined();
  });

  test("throws VERSION_SKEW naming the feature when the app is older", async () => {
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION - 1, minClientApiVersion: 1 });
    const client = new KenotexClient({ token: "t" });
    try {
      await client.requireApiVersion(CLIENT_API_VERSION, "habit cadence");
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("VERSION_SKEW");
      expect(e.message).toContain("habit cadence");
      expect(e.message).toMatch(/update the Kenotex macOS app/i);
      expect(e.message).toMatch(/NOT sent/);
    }
  });

  test("throws for a reachable app that advertises no version at all", async () => {
    mockHealthAnd404({});
    const client = new KenotexClient({ token: "t" });
    await expect(client.requireApiVersion(2, "x")).rejects.toMatchObject({ code: "VERSION_SKEW" });
  });

  test("re-probes before every gated write: an app downgraded under a long-lived process is refused", async () => {
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION, minClientApiVersion: 1 });
    const client = new KenotexClient({ token: "t" });
    await expect(client.requireApiVersion(CLIENT_API_VERSION, "x")).resolves.toBeUndefined();
    // The user swaps the running app for an older build while this process lives on.
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION - 1, minClientApiVersion: 1 });
    await expect(client.requireApiVersion(CLIENT_API_VERSION, "x")).rejects.toMatchObject({
      code: "VERSION_SKEW",
    });
  });

  test("a successful probe replaces stale version fields: v3 cached, then a versionless /health is legacy again", async () => {
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION, minClientApiVersion: 1 });
    const client = new KenotexClient({ token: "t" });
    await expect(client.requireApiVersion(2, "x")).resolves.toBeUndefined();
    mockHealthAnd404({});
    await expect(client.requireApiVersion(2, "x")).rejects.toMatchObject({ code: "VERSION_SKEW" });
  });

  test("a failed re-probe keeps the last known verdict: cached v3 and an app that is down still passes", async () => {
    mockHealthAnd404({ apiVersion: CLIENT_API_VERSION, minClientApiVersion: 1 });
    const client = new KenotexClient({ token: "t" });
    await expect(client.requireApiVersion(CLIENT_API_VERSION, "x")).resolves.toBeUndefined();
    (globalThis as Record<string, unknown>).fetch = mock(async () => {
      throw new Error("connection refused");
    });
    await expect(client.requireApiVersion(CLIENT_API_VERSION, "x")).resolves.toBeUndefined();
  });

  test("passes when the app is unreachable (version unknown) — the request fails on its own", async () => {
    (globalThis as Record<string, unknown>).fetch = mock(async () => {
      throw new Error("connection refused");
    });
    const client = new KenotexClient({ token: "t" });
    await expect(client.requireApiVersion(CLIENT_API_VERSION, "x")).resolves.toBeUndefined();
  });

  test("probes /health on every gated write — a satisfied verdict is never trusted across calls", async () => {
    // 1.3.0 probed once and trusted the cache for the life of the process; that let a
    // downgraded app silently drop `cadence`. One local GET per gated write is the price.
    let healthCalls = 0;
    (globalThis as Record<string, unknown>).fetch = mock(async (url: string) => {
      if (url.endsWith("/health")) healthCalls += 1;
      return new Response(JSON.stringify({ status: "ok", apiVersion: CLIENT_API_VERSION }), { status: 200 });
    });
    const client = new KenotexClient({ token: "t" });
    await client.requireApiVersion(CLIENT_API_VERSION, "x");
    await client.requireApiVersion(CLIENT_API_VERSION, "x");
    expect(healthCalls).toBe(2);
  });

  test("app updated mid-session: the guard re-probes and stops refusing (no MCP restart)", async () => {
    // The whole point of VERSION_SKEW is to tell the user to update the app. If the
    // boot-time version stayed cached for the life of the process, the retry after
    // that update would keep being refused until the MCP restarted.
    let appApiVersion = CLIENT_API_VERSION - 1;
    let healthCalls = 0;
    (globalThis as Record<string, unknown>).fetch = mock(async (url: string) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return new Response(
          JSON.stringify({ status: "ok", apiVersion: appApiVersion, minClientApiVersion: 1 }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const client = new KenotexClient({ token: "t" });
    expect(await client.health()).toBe(true); // boot probe caches the old version
    await expect(
      client.requireApiVersion(CLIENT_API_VERSION, "habit cadence"),
    ).rejects.toMatchObject({ code: "VERSION_SKEW" });

    appApiVersion = CLIENT_API_VERSION; // user updates the Kenotex app, same MCP process
    await expect(
      client.requireApiVersion(CLIENT_API_VERSION, "habit cadence"),
    ).resolves.toBeUndefined();

    // …and a satisfied verdict is re-checked on the next gated write too (1.3.1): the
    // app can be swapped back for an older build just as easily as it was updated.
    const afterRefresh = healthCalls;
    await client.requireApiVersion(CLIENT_API_VERSION, "habit cadence");
    expect(healthCalls).toBe(afterRefresh + 1);
  });

  test("legacy versionless app that gets updated is unblocked by the same re-probe", async () => {
    let health: Record<string, unknown> = {}; // reachable, advertises no version
    (globalThis as Record<string, unknown>).fetch = mock(async (url: string) => {
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok", ...health }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const client = new KenotexClient({ token: "t" });
    await client.health();
    await expect(client.requireApiVersion(CLIENT_API_VERSION, "x")).rejects.toMatchObject({
      code: "VERSION_SKEW",
    });
    health = { apiVersion: CLIENT_API_VERSION, minClientApiVersion: 1 };
    await expect(client.requireApiVersion(CLIENT_API_VERSION, "x")).resolves.toBeUndefined();
  });

  test("a failed re-probe changes nothing: the same VERSION_SKEW is thrown", async () => {
    // App was v2 at boot and is unreachable when the guard re-checks (e.g. it is
    // mid-restart). The stale-but-only answer stands — error code and text unchanged.
    let healthCalls = 0;
    (globalThis as Record<string, unknown>).fetch = mock(async (url: string) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        if (healthCalls > 1) throw new Error("connection refused");
        return new Response(
          JSON.stringify({ status: "ok", apiVersion: CLIENT_API_VERSION - 1 }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const client = new KenotexClient({ token: "t" });
    await client.health();
    try {
      await client.requireApiVersion(CLIENT_API_VERSION, "habit cadence");
      expect.unreachable();
    } catch (e) {
      if (!(e instanceof KenotexClientError)) throw e;
      expect(e.code).toBe("VERSION_SKEW");
      expect(e.message).toContain("habit cadence");
      expect(e.message).toContain(`local API v${CLIENT_API_VERSION - 1}`);
      expect(e.message).toMatch(/NOT sent/);
      expect(e.message).toMatch(/update the Kenotex macOS app/i);
    }
    expect(healthCalls).toBe(2); // one refresh attempt, then the cached verdict
  });
});
