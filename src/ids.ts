/**
 * #8: Validate + percent-encode an id destined for a single URL path segment.
 *
 * A crafted id like `../categories/x` would otherwise interpolate into
 * `/v1/todos/../categories/x`, normalise to a *different* endpoint, and let a tool
 * reach routes its MCP authorization boundary never intended (e.g. a delete route
 * with no corresponding MCP tool).
 *
 * Defense (two layers):
 *  1. Reject the path-structural vectors — `/`, `\`, the bare `.`/`..` segments,
 *     control chars, whitespace — with a clear error.
 *  2. `encodeURIComponent` the rest so any remaining reserved chars (`%`, `?`, `#`,
 *     …) can't inject query/fragment/segment structure downstream.
 *
 * Everything else — RFC UUIDs, `cat-default-*` seed ids, recurrence `__child__` /
 * virtual `__occ__` synthetic ids — is a legitimate Kenotex id and passes through.
 * (Deliberately NOT a strict-UUID gate: the app uses non-UUID ids for default
 * category seeds and synthetic occurrence/child rows; a UUID-only rule would
 * reject them.)
 */
const ID_MAX_LENGTH = 128;

export function pathSegmentId(rawId: unknown, field = "id"): string {
  if (typeof rawId !== "string" || rawId.length === 0) {
    throw new Error(`Invalid ${field}: must be a non-empty string`);
  }
  if (rawId.length > ID_MAX_LENGTH) {
    throw new Error(`Invalid ${field}: exceeds ${ID_MAX_LENGTH} characters`);
  }
  // Bare "." / ".." remain path segments even after encoding (dots aren't
  // percent-encoded), and any "/" or "\" splits the id into multiple segments —
  // both let the request escape the intended `/v1/<collection>/<id>` shape.
  if (rawId === "." || rawId === ".." || /[\/\\\x00-\x1f\x7f\s]/.test(rawId)) {
    throw new Error(
      `Invalid ${field}: contains a path separator, traversal segment, or control/whitespace character`,
    );
  }
  return encodeURIComponent(rawId);
}
