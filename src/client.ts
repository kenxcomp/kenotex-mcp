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
 */
export const CLIENT_API_VERSION = 2;

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
   * re-probes on the later error path (when the app is up) instead of giving up. */
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
   * wasn't up yet must not permanently suppress the later "update the app" hint. */
  private async ensureVersions(): Promise<void> {
    if (this.healthProbeSucceeded) return;
    await this.health();
  }

  /** Human/LLM-facing hint when the app and this integration disagree on API
   * version, else undefined. Direction matters:
   *  - app older than this build (app.apiVersion < CLIENT_API_VERSION) → update the app.
   *  - this build older than the app requires (app.minClientApiVersion > CLIENT_API_VERSION) → update kenotex-mcp.
   */
  versionSkewHint(): string | undefined {
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
    if (
      this.appApiVersion !== undefined &&
      this.appApiVersion < CLIENT_API_VERSION
    ) {
      return (
        `The Kenotex app is older than this kenotex-mcp integration ` +
        `(the app reports local API v${this.appApiVersion}, but this tool needs API v${CLIENT_API_VERSION}+). ` +
        `Ask the user to update the Kenotex macOS app to the latest version, then retry.`
      );
    }
    return undefined;
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
        let hint = this.versionSkewHint();
        // A reachable app whose /health advertises no apiVersion predates API v2
        // (the version that added habits), so a 404 on a v2-only route means
        // "the app is too old", not "no such record". Scope this to /v1/habits so
        // a genuine 404 on a pre-v2 route (a missing todo/event) stays a plain
        // not-found — this is the one signal we CAN give against already-shipped
        // apps that will never advertise a version.
        if (!hint && this.appLegacyNoVersion && path.startsWith("/v1/habits")) {
          hint = this.legacyAppTooOldHint();
        }
        if (hint) message += ` — ${hint}`;
      } else {
        // For any other error, only append a hint when this integration is
        // definitively outdated (the app raised minClientApiVersion past us).
        const hint = this.versionSkewHint();
        if (hint && this.appMinClientApiVersion !== undefined && this.appMinClientApiVersion > CLIENT_API_VERSION) {
          message += ` — ${hint}`;
        }
      }

      throw new KenotexClientError(code, message, res.status);
    }
    return parsed as T;
  }
}
