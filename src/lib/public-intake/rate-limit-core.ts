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

// ---------------------------------------------------------------------------
// P1-COMM-D3R -- server-to-server website intake: separate buckets for VERIFIED connections vs everything else.
// ---------------------------------------------------------------------------

/** The subset of a request_intake_integrations row the classification needs (read by the service-role lookup). */
export interface IntakeConnectionRow {
  integration_type: string;
  is_active: boolean;
  retired_at: string | null;
  allowed_origins: string[] | null;
}

/**
 * True only for a request the intake RPC would treat as coming from a live, correctly-configured website connection:
 * exact Integration ID found, website connection, turned on, not retired, and (when an approved-website list exists) the
 * Origin header exactly one of them -- the same rule submit_public_transportation_request applies. (Organization suspension
 * is still enforced by the RPC itself; a suspended tenant's connection is merely limited by its own integration bucket.)
 */
export function isVerifiedWebsiteConnection(row: IntakeConnectionRow | null, origin: string | null): boolean {
  if (!row || row.integration_type !== "website" || row.is_active !== true || row.retired_at !== null) return false;
  const allowed = row.allowed_origins ?? [];
  if (allowed.length === 0) return true;
  return origin !== null && allowed.includes(origin);
}

export interface IntakeRateLimitKeys {
  /** Passed as p_integration_external_id: the bucket the 120/hour integration limit counts. */
  integrationKey: string;
  /** Passed as p_client_key: the bucket the 8/hour per-client limit counts. */
  clientKey: string;
}

/**
 * Bucket selection for /api/public-intake/website.
 *  - VERIFIED connection: the integration's own bucket (120/hour, the commercial boundary). The per-client bucket is scoped
 *    to (integration, idempotencyKey), so distinct submissions from one outbound server IP never share a tiny IP bucket,
 *    while repeated replays of the SAME submission are still capped.
 *  - Everything else (unknown ID, off, retired, wrong Origin): the per-IP abuse bucket as before, and a separate
 *    "unverified:" integration bucket, so garbage traffic naming a real Integration ID can't consume that customer's
 *    capacity.
 */
export function websiteIntakeRateLimitKeys(input: { verified: boolean; integrationExternalId: string; idempotencyKey: string; clientIp: string }): IntakeRateLimitKeys {
  if (input.verified) {
    return {
      integrationKey: input.integrationExternalId,
      clientKey: createHash("sha256").update(`${CLIENT_KEY_SALT}:connection:${input.integrationExternalId}:${input.idempotencyKey}`).digest("hex"),
    };
  }
  return { integrationKey: `unverified:${input.integrationExternalId}`, clientKey: hashClientIp(input.clientIp) };
}
