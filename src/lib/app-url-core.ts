/**
 * Pure, framework-free origin-normalization helpers (P0-S2A).
 *
 * Deliberately has NO `server-only`/`next/headers` import — nothing here
 * touches a request, a cookie, or a secret, so there is no reason to
 * restrict where it can be imported, and keeping it framework-free is
 * what makes it directly unit-testable with plain Node
 * (`node --test src/lib/app-url-core.test.mjs`), with zero new
 * dependencies and zero mocking of Next internals.
 *
 * `src/lib/app-url.ts` (the `server-only` module every application call
 * site actually imports) is a thin wrapper around these two functions.
 */

/**
 * Normalizes a candidate application-origin string (typically
 * `NEXT_PUBLIC_APP_URL`) through the built-in `URL` parser rather than
 * plain string concatenation — this is what actually prevents every
 * malformed-URL case this helper was reviewed for:
 *
 *   - a missing scheme (`app.zenwardmobility.com` with no `https://`) —
 *     `new URL()` throws `Invalid URL` for a bare hostname; returned as
 *     `null` (i.e. "not usably configured") rather than silently building
 *     a broken link from it.
 *   - a double/trailing slash (`https://x.com//`, `https://x.com/`) —
 *     `.origin` never carries a trailing slash, so appending `/join/…`
 *     downstream can never produce `//join`.
 *   - an accidental path/query/hash in the configured value
 *     (`https://x.com/some/base?x=1`) — `.origin` is scheme+host+port
 *     only, so a stray path segment in the env var can never leak into
 *     the built link.
 *   - a non-http(s) scheme (`javascript:`, `data:`, …) — rejected
 *     explicitly, not merely "whatever URL happened to parse."
 *
 * Returns `null` for anything blank, unparseable, or non-http(s) — never
 * throws. The caller decides what "not configured" means for it.
 */
export function resolveConfiguredOrigin(rawValue: string | undefined | null): string | null {
  const trimmed = rawValue?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** True iff `origin`'s host is a loopback address — never a real deployment. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    // `URL#hostname` renders an IPv6 literal WITH its brackets
    // (`new URL("http://[::1]:3000").hostname === "[::1]"`) — checked here
    // in both forms rather than assuming either.
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
