/**
 * Pure(ish) helpers for the public-intake rate limiter (P1-PILOT-S4B).
 * No `server-only` import and no application/database import of any
 * kind — mirrors `website-intake-core.ts`'s/`operations-brief-core.ts`'s
 * own established "no runtime import" charter, EXCEPT for Node's own
 * built-in `node:crypto` module, which is available identically under
 * plain `node --test`, the Next.js server runtime, and this app's own
 * deployment target — unlike a `server-only` sentinel or a Supabase
 * client import, importing a Node built-in does not compromise this
 * module's own ability to be unit-tested directly with no bundler and no
 * database.
 */

import { createHash } from "node:crypto";

/**
 * NOT a secret — see rate-limit.ts's own extensive comment for why a
 * fixed, hard-coded salt is a deliberate, documented, safe choice here
 * (this hash exists to avoid storing a bare, trivially-reversible IP
 * address at rest, not to defeat a determined attacker with database
 * read access, who already has far greater capability than "reverse an
 * IP hash" would grant — and this table has zero grants to anon/
 * authenticated in the first place).
 */
export const CLIENT_KEY_SALT = "nemryn-public-intake-rate-limit-v1";

/** Deterministic, one-way, never reversed anywhere in this codebase. */
export function hashClientIp(ip: string): string {
  return createHash("sha256").update(`${CLIENT_KEY_SALT}:${ip}`).digest("hex");
}

/**
 * Resolves the client's own IP from the standard `x-forwarded-for`
 * (first entry) / `x-real-ip` proxy-chain header convention. Takes a
 * plain `Record<string, string | null>` rather than a real `Headers`
 * object so this function has no DOM/Fetch-API runtime dependency either
 * — trivially testable with a plain object literal.
 */
export function resolveClientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
