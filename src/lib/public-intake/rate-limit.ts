import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role-server";
import { hashClientIp, resolveClientIpFromHeaders, type IntakeConnectionRow, type IntakeRateLimitKeys } from "./rate-limit-core";

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

/**
 * P1-COMM-D3R: records against explicitly chosen buckets (see websiteIntakeRateLimitKeys). Same atomic SQL function, same
 * 8 / 120 per rolling hour; only the keys differ. Fails closed exactly like checkAndRecordPublicIntakeRateLimit.
 */
export async function checkAndRecordRateLimitKeys(keys: IntakeRateLimitKeys): Promise<RateLimitResult> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("check_and_record_public_intake_rate_limit", {
    p_integration_external_id: keys.integrationKey,
    p_client_key: keys.clientKey,
  });
  if (error || !data) {
    console.error("[public-intake] check_and_record_public_intake_rate_limit failed");
    return { allowed: false };
  }
  return data.allowed ? { allowed: true } : { allowed: false };
}

/**
 * P1-COMM-D3R: the connection facts needed to classify a website-intake submission BEFORE rate limiting. Uses the same
 * service-role SELECT on request_intake_integrations the CORS lookup already has (no new privilege). Exact external_id
 * match, like the intake RPC. A lookup failure classifies the submission as unverified (the stricter per-IP bucket).
 */
export async function lookupIntakeConnection(integrationExternalId: string): Promise<IntakeConnectionRow | null> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("request_intake_integrations")
    .select("integration_type, is_active, retired_at, allowed_origins")
    .eq("external_id", integrationExternalId)
    .maybeSingle();
  if (error) {
    console.error("[public-intake] intake connection lookup failed");
    return null;
  }
  return data ?? null;
}
