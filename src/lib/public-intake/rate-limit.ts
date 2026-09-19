import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role-server";
import { hashClientIp, resolveClientIpFromHeaders } from "./rate-limit-core";

/**
 * P1-PILOT-S4B — durable rate-limit boundary for public tenant-website
 * intake. Calls `check_and_record_public_intake_rate_limit` (service_role
 * only, see the migration's own comment) via the SAME narrow service-role
 * client `website-intake.ts` uses for the submission RPC itself — no
 * second privileged-client pattern is introduced.
 *
 * This module never receives or handles a raw IP address as a durable
 * value: `hashClientIp` (rate-limit-core.ts, pure, unit-tested directly)
 * is a ONE-WAY digest computed here, in Node, BEFORE anything reaches
 * the database — Postgres never stores or processes a raw IP anywhere in
 * this schema (see the migration's own table comment).
 */
export { resolveClientIpFromHeaders as resolveClientIp };

export type RateLimitResult = { allowed: true } | { allowed: false };

export async function checkAndRecordPublicIntakeRateLimit(integrationExternalId: string, clientIp: string): Promise<RateLimitResult> {
  const supabase = createServiceRoleSupabaseClient();
  const clientKey = hashClientIp(clientIp);

  const { data, error } = await supabase.rpc("check_and_record_public_intake_rate_limit", {
    p_integration_external_id: integrationExternalId,
    p_client_key: clientKey,
  });

  if (error || !data) {
    // Fails CLOSED — a genuine infrastructure error here must never be
    // treated as "allow the request through". Safe, fixed log only (see
    // website-intake.ts's own established convention) — no client_key,
    // no IP, ever logged.
    console.error("[public-intake] check_and_record_public_intake_rate_limit failed");
    return { allowed: false };
  }

  return data.allowed ? { allowed: true } : { allowed: false };
}
