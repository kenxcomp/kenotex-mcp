import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Default base URL for Kenotex local HTTP server. */
export const DEFAULT_HOST = "http://127.0.0.1:21519";

/**
 * The Kenotex local-API version this build of kenotex-mcp targets. Compared
 * against the app's `/health` `apiVersion` to detect version skew and, on
 * failure, tell the LLM whether to update the Kenotex app or this integration.
 * Bump alongside the app's `LocalHTTPServer.apiVersion` when adding tools that
 * depend on new routes. v2 (2026-07-06): check-in habit tools + `/v1/habits`.
 * v3 (2026-09-13): habit `cadence` (interval habits) on `POST`/`PATCH /v1/habits`,
 * plus `cadence` / `isIntervalHabit` / `currentPeriod` on every habit response.
 */
export const CLIENT_API_VERSION = 3;

/**
 * First local-API version whose `/v1/habits` understands `cadence`. A pre-v3 app
 * silently DROPS the field (unknown JSON keys are ignored) and answers 201 with a
 * plain daily habit — no error to decorate — so cadence writes are refused
 * client-side via `requireApiVersion` when the app is known to be older.
 */
export const HABIT_CADENCE_MIN_API_VERSION = 3;

/**
 * Token file locations searched, in priority order.
 * Matches the lookup chain used by raycast-extension/src/api.ts.
 */
export const TOKEN_PATHS = [
  join(
    homedir(),
    "Library/Containers/com.kenxcomp.kenotex/Data/Library/Application Support/Kenotex/local-http-token",
  ),
  join(homedir(), "Library/Application Support/Kenotex/local-http-token"),
  join(homedir(), ".kenotex-local-token"),
];

/** Structured result of a tool call — LLM-friendly JSON rather than throwing. */
export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    field?: string;
  };
}

export class KenotexClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "KenotexClientError";
  }
}

/**
 * HTTP client for the Kenotex local server.
 * Looks up the bearer token from the same paths as Raycast.
 */
export class KenotexClient {
  private readonly host: string;
  private readonly tokenOverride: string | undefined;

  /** Cached from `/health`. Populated by `health()` / `ensureVersions()`. */
  private appApiVersion: number | undefined;
  private appMinClientApiVersion: number | undefined;
  /** True once a `/health` probe *succeeded* (200 reached the app and its version
   * state was discovered). Distinct from "we attempted a probe": if the MCP boots
   * before the app, the boot probe fails and this stays false, so `ensureVersions()`
   * re-probes on the later error path (when the app is up) instead of giving up.
   * A *successful* probe is not the last word either: `requireApiVersion()` refreshes
   * it before refusing, so an app updated mid-session is noticed without a restart. */
  private healthProbeSucceeded = false;
  /** True when `/health` responded 200 but carried no `apiVersion` — an app that
   * predates version advertising, i.e. definitely older than local API v2 (the
   * version that introduced check-in habits). Distinct from "app unreachable"
   * (both version fields undefined AND this false), so the too-old hint only
   * fires when we positively saw a versionless-but-alive app. */
  private appLegacyNoVersion = false;

  constructor(options?: { host?: string; token?: string }) {
    this.host = options?.host ?? process.env.KENOTEX_HOST ?? DEFAULT_HOST;
    this.tokenOverride = options?.token ?? process.env.KENOTEX_TOKEN;
  }

  /** Find token from disk. Throws a structured MCP-friendly error if missing. */
  private findToken(): string {
    if (this.tokenOverride && this.tokenOverride.trim() !== "") {
      return this.tokenOverride.trim();
    }
    for (const path of TOKEN_PATHS) {
      if (existsSync(path)) {
        const content = readFileSync(path, "utf8").trim();
        if (content !== "") return content;
      }
    }
    throw new KenotexClientError(
      "TOKEN_NOT_FOUND",
      `Kenotex app not running or token not accessible. Searched: ${TOKEN_PATHS.join(", ")}`,
    );
  }

  /** Sanity probe — returns true if /health responds 200. Also caches the app's
   * `apiVersion` / `minClientApiVersion` for version-skew diagnostics. */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.status === 200) {
        try {
          const body = (await res.json()) as {
            apiVersion?: number;
            minClientApiVersion?: number;
          };
          if (typeof body.apiVersion === "number") this.appApiVersion = body.apiVersion;
          if (typeof body.minClientApiVersion === "number")
            this.appMinClientApiVersion = body.minClientApiVersion;
        } catch {
          /* older app: /health had no version fields — leave undefined */
        }
        // Reachable, but no advertised apiVersion ⇒ an app older than API v2.
        this.appLegacyNoVersion = this.appApiVersion === undefined;
        // We reached the app and learned its version state — record success so
        // ensureVersions() won't re-probe, and a failed boot probe (app down) that
        // left this false will re-probe on the later error path.
        this.healthProbeSucceeded = true;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Lazily populate the cached app versions from the error path so version hints
   * work even when the app started after this process. Re-probes until a probe
   * *succeeds* (not just "was attempted"): a boot probe that failed because the app
   * wasn't up yet must not permanently suppress the later "update the app" hint.
   * Returns true when this call actually probed — the cache is then as fresh as it
   * gets, so a caller that dislikes the answer need not refresh it a second time. */
  private async ensureVersions(): Promise<boolean> {
    if (this.healthProbeSucceeded) return false;
    await this.health();
    return true;
  }

  /** True when the app is *positively known* to be older than `minApiVersion`:
   * it advertises a lower `apiVersion`, or it is reachable and advertises none at
   * all. An app whose version is unknown (unreachable) is never "too old". */
  private isKnownOlderThan(minApiVersion: number): boolean {
    const known = this.appApiVersion;
    return known !== undefined ? known < minApiVersion : this.appLegacyNoVersion;
  }

  /** Hint for the "this integration is behind the app" direction: the app raised
   * `minClientApiVersion` past this build, so it will refuse us outright. Always
   * actionable and route-independent — a stale MCP breaks every tool, not one
   * feature — so this one is appended to any error that carries a hint at all. */
  clientTooOldHint(): string | undefined {
    if (
      this.appMinClientApiVersion !== undefined &&
      this.appMinClientApiVersion > CLIENT_API_VERSION
    ) {
      return (
        `This kenotex-mcp integration is outdated for the installed Kenotex app ` +
        `(it targets local API v${CLIENT_API_VERSION}, but the app now requires client API v${this.appMinClientApiVersion}+). ` +
        `Ask the user to update it by running \`npx kenotex-mcp@latest\` (and re-read the in-app integration guide), then retry.`
      );
    }
    return undefined;
  }

  /** Hint for the opposite direction: the app advertises a LOWER `apiVersion`
   * than this build targets. Deliberately NOT phrased as "you must update the
   * app": the v2 → v3 step is additive, so the only thing a v2 app cannot do is
   * habit `cadence`. Every other tool works against it exactly as before, and
   * this build ships ahead of the app release on purpose — telling every user of
   * a current app to go install an update that does not exist yet is noise, not
   * a diagnosis. Scoped by the caller to the routes where it is actually
   * informative (see `request()`); the hard refusal for cadence writes lives in
   * `requireApiVersion()`, which does tell the user to update. */
  appBehindHint(): string | undefined {
    if (
      this.appApiVersion !== undefined &&
      this.appApiVersion < CLIENT_API_VERSION
    ) {
      return (
        `Version note: the Kenotex app reports local API v${this.appApiVersion}, while this kenotex-mcp ` +
        `build targets v${CLIENT_API_VERSION}. Only habit \`cadence\` (interval habits) needs v${HABIT_CADENCE_MIN_API_VERSION}+ — ` +
        `every other tool works against this app as usual. ` +
        `Update the Kenotex macOS app only if the user wants interval habits.`
      );
    }
    return undefined;
  }

  /** Both directions at once, for callers that just want "is anything skewed?"
   * (the boot probe). Client-too-old wins: it is the blocking one. */
  versionSkewHint(): string | undefined {
    return this.clientTooOldHint() ?? this.appBehindHint();
  }

  /** Hint for a reachable app that predates API version advertising: it can't
   * serve v2-only routes (habits). Only meaningful when `appLegacyNoVersion`. */
  private legacyAppTooOldHint(): string {
    return (
      `The Kenotex app is too old to support check-in habits ` +
      `(its /health advertises no local API version, so it predates API v${CLIENT_API_VERSION}). ` +
      `Ask the user to update the Kenotex macOS app to the latest version, then retry.`
    );
  }

  /** Success-path guard for a request the running app may silently mis-handle.
   * The 404-based skew hint only fires on the error path; an older app that does
   * not know a request FIELD ignores it and answers 2xx, so features that ride on
   * new fields (not new routes) must check the app's version BEFORE sending.
   * Throws `VERSION_SKEW` when the app is positively known to be older than
   * `minApiVersion` (advertised `apiVersion` below it, or a reachable app that
   * advertises no version at all). An unreachable app (version unknown) passes —
   * the request then fails with its normal connection error.
   * Before refusing, the app version is re-probed once: the user's fix for a
   * VERSION_SKEW is to update the app, and the cached version would otherwise
   * outlive that update and keep rejecting every write until the MCP restarts.
   * Only this refusal path pays for the extra `/health` — a satisfied guard never
   * re-reads it. */
  async requireApiVersion(minApiVersion: number, feature: string): Promise<void> {
    const probedNow = await this.ensureVersions();
    if (!this.isKnownOlderThan(minApiVersion)) return;
    // Cache says "too old". Re-check against the app that is running *now* (unless
    // ensureVersions() just probed, in which case it already is current). A failed
    // re-probe leaves the cache untouched, so an app that is down stays refused
    // with exactly the error below — the semantics only change when the app has
    // genuinely been updated in the meantime.
    if (!probedNow) {
      await this.health();
      if (!this.isKnownOlderThan(minApiVersion)) return;
    }
    const known = this.appApiVersion;
    const reported = known !== undefined ? `local API v${known}` : "no local API version at all";
    throw new KenotexClientError(
      "VERSION_SKEW",
      `${feature} needs local API v${minApiVersion}+, which ships with the next Kenotex macOS app release; ` +
        `the running app reports ${reported}. The request was NOT sent (an older app would silently ignore the field ` +
        `and create a plain daily habit). Everything except ${feature} works with the current app — ` +
        `update the Kenotex macOS app once the version advertising API v${minApiVersion}+ is available, then retry.`,
    );
  }

  /** Generic request helper. */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const token = this.findToken();
    let url = `${this.host}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
      }
      const q = params.toString();
      if (q) url += `?${q}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave undefined */
      }
    }

    if (!res.ok) {
      const err = (parsed as { error?: { code?: string; message?: string } })?.error;
      const code =
        res.status === 404
          ? "NOT_FOUND"
          : res.status === 401
            ? "UNAUTHORIZED"
            : res.status === 422
              ? "VALIDATION"
              : err?.code ?? `HTTP_${res.status}`;
      let message = err?.message ?? `HTTP ${res.status} on ${method} ${path}`;

      // Version-skew hint. A NOT_FOUND on a /v1/ path is the classic symptom of
      // an API the running app doesn't have yet (or a route this outdated build
      // no longer targets), so probe the app's version and, if it disagrees with
      // this build, tell the LLM which side to update. (The hint reaches the LLM
      // via the error text, prompting it to ask the user to update.)
      if (res.status === 404 && path.startsWith("/v1/")) {
        await this.ensureVersions();
        // A stale MCP breaks every route, so that direction is never scoped.
        let hint = this.clientTooOldHint();
        // The opposite direction IS scoped to /v1/habits, by the same rule the
        // versionless-app branch below has always used: habits are the only
        // surface an older app can be genuinely missing, so a 404 anywhere else
        // (a missing todo/event) is a plain not-found and must stay one. Without
        // this scope an app one version behind — i.e. every installed app between
        // an MCP release and the matching app release — decorates EVERY 404 with
        // "update the Kenotex app", which the LLM then relays as an instruction
        // the user cannot act on.
        if (!hint && path.startsWith("/v1/habits")) {
          // A reachable app whose /health advertises no apiVersion predates API
          // v2 (the version that added habits), so it cannot serve this route at
          // all — that one is a hard "too old", not a soft version note.
          hint = this.appLegacyNoVersion ? this.legacyAppTooOldHint() : this.appBehindHint();
        }
        if (hint) message += ` — ${hint}`;
      } else {
        // For any other error, only append a hint when this integration is
        // definitively outdated (the app raised minClientApiVersion past us).
        const hint = this.clientTooOldHint();
        if (hint) message += ` — ${hint}`;
      }

      throw new KenotexClientError(code, message, res.status);
    }
    return parsed as T;
  }
}
