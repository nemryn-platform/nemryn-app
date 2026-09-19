import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role-server";

/**
 * P1-PILOT-S4B — CORS origin resolution for the public intake route.
 * S4A shipped a permissive `Access-Control-Allow-Origin: *`, correct for
 * a foundation phase with zero active integrations. Now that a real
 * pilot integration may be activated, this narrows to an explicit
 * allow-list, never a reflected/wildcard origin — the phase's own
 * explicit instruction ("do not reflect arbitrary origins").
 *
 * The Route Handler's own preflight (OPTIONS) request carries no JSON
 * body — only headers — so there is no `integrationExternalId` to look
 * up a SPECIFIC integration's own `allowed_origins` at that point. This
 * resolves the incoming `Origin` header against the UNION of every
 * currently ACTIVE integration's own `allowed_origins` instead — cheap
 * at pilot scale (a handful of integrations at most), and still never a
 * blanket "anything goes": an origin absent from every active
 * integration's own configured list gets NO
 * `Access-Control-Allow-Origin` header at all, which causes the browser
 * itself to block the calling page's JS from ever reading the response
 * (the request still reaches this server either way — CORS is a
 * browser-enforced client-side control, never a server-side
 * authorization boundary; see this module's own repeated reminder below
 * and the RPC's own independent, authoritative per-integration Origin
 * check, which is what actually matters).
 *
 * This is a courtesy/UX layer only. It is NOT tenant authorization, NOT
 * a replacement for rate limiting, and NOT relied upon anywhere in this
 * codebase as a security boundary — `submit_public_transportation_
 * request` performs its OWN independent, per-integration Origin check
 * (see supabase/migrations/20260919090000_public_request_intake_
 * foundation.sql), which remains authoritative and un-bypassable by
 * forging this HTTP-layer header, exactly as it was in P1-PILOT-S4A.
 */
export async function resolveAllowedCorsOrigin(requestOrigin: string | null): Promise<string | null> {
  if (!requestOrigin) return null;

  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("request_intake_integrations")
    .select("allowed_origins")
    .eq("is_active", true)
    .not("allowed_origins", "is", null);

  if (error || !data) {
    console.error("[public-intake] resolveAllowedCorsOrigin lookup failed");
    return null;
  }

  const allOrigins = new Set<string>();
  for (const row of data) {
    for (const origin of row.allowed_origins ?? []) {
      allOrigins.add(origin);
    }
  }

  return allOrigins.has(requestOrigin) ? requestOrigin : null;
}
