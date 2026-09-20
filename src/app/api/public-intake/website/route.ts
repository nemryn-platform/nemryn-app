import { NextResponse, after, type NextRequest } from "next/server";
import { validateWebsiteIntakePayload, publicIntakeErrorMessage } from "@/lib/public-intake/website-intake-core";
import { submitWebsiteTransportationRequest } from "@/lib/public-intake/website-intake";
import { resolveAllowedCorsOrigin } from "@/lib/public-intake/cors";
import { checkAndRecordPublicIntakeRateLimit, resolveClientIp } from "@/lib/public-intake/rate-limit";
import { dispatchNotification } from "@/lib/notifications/dispatch";

/**
 * P1-PILOT-S4A/S4B — the ONE public, unauthenticated HTTP boundary an
 * external tenant website POSTs to. Implements the "preferred security
 * shape" from the S4A brief exactly:
 *
 *   browser -> Nemryn public route -> schema validation -> durable rate
 *   limit -> narrow database RPC (service_role only) -> integration
 *   lookup -> organization resolution -> request creation
 *
 * P1-PILOT-S4B additions over S4A: (1) this route is now the ONLY
 * intentionally supported anonymous entry point — the underlying RPC no
 * longer grants EXECUTE to anon/authenticated at all (see
 * supabase/migrations/20260919120000_public_intake_ingress_hardening.sql),
 * so calling it via this route is now the only way through, not merely
 * the preferred one; (2) a genuine durable, atomic, per-integration AND
 * per-client rate limit is checked (and recorded) BEFORE the submission
 * RPC is ever called — see `src/lib/public-intake/rate-limit.ts`;
 * (3) CORS now resolves to an explicit allow-list of currently-active
 * integrations' own configured origins, never a wildcard — see
 * `src/lib/public-intake/cors.ts`.
 *
 * This route creates no elevated credential of its own — the ONE
 * privileged Supabase client in this codebase
 * (`createServiceRoleSupabaseClient`, src/lib/supabase/service-role-
 * server.ts) is instantiated only inside the two narrow helper modules
 * this route calls (`website-intake.ts`, `rate-limit.ts`, `cors.ts`),
 * each of which uses it for exactly one narrow purpose. Nothing in this
 * route file itself reads `SUPABASE_SERVICE_ROLE_KEY`.
 */

const MAX_BODY_BYTES = 8 * 1024; // generous for this field set; rejects an oversized/abusive payload before JSON.parse ever runs

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  return headers;
}

function genericRejection(allowedOrigin: string | null, status = 400): NextResponse {
  return NextResponse.json(
    { ok: false, error: "invalid_request", message: publicIntakeErrorMessage("invalid_request") },
    { status, headers: corsHeaders(allowedOrigin) },
  );
}

export async function OPTIONS(request: NextRequest) {
  const allowedOrigin = await resolveAllowedCorsOrigin(request.headers.get("origin"));
  return new NextResponse(null, { status: 204, headers: corsHeaders(allowedOrigin) });
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  const allowedOrigin = await resolveAllowedCorsOrigin(requestOrigin);

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return genericRejection(allowedOrigin);
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return genericRejection(allowedOrigin);
  }

  if (rawText.length > MAX_BODY_BYTES) {
    return genericRejection(allowedOrigin);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return genericRejection(allowedOrigin);
  }

  const validation = validateWebsiteIntakePayload(parsed);
  if (!validation.ok) {
    return genericRejection(allowedOrigin);
  }

  // Durable, atomic rate limit — checked (and recorded) BEFORE the
  // submission RPC is ever called, so a throttled attempt never reaches
  // it at all. Same generic public response/status philosophy as every
  // other rejection in this route: a throttled caller learns nothing
  // beyond "this did not succeed" (see rate-limit.ts's own comment for
  // why HTTP 429 alone is not itself an information leak here — it is
  // this app's own established convention to use the status code
  // meaningfully while keeping the BODY itself uninformative).
  const clientIp = resolveClientIp(request.headers);
  const rateLimitResult = await checkAndRecordPublicIntakeRateLimit(validation.value.integrationExternalId, clientIp);
  if (!rateLimitResult.allowed) {
    return genericRejection(allowedOrigin, 429);
  }

  const result = await submitWebsiteTransportationRequest(validation.value, requestOrigin);

  if (result.status !== "accepted") {
    return genericRejection(allowedOrigin);
  }

  // P1-PILOT-S4B-R4D: a genuinely NEW Request (never an idempotent replay --
  // the id is null then) triggers the tenant's "New website request"
  // notification AFTER the response: best-effort, never able to change this
  // response or the committed Request. The public response is unchanged.
  if (result.notificationEventId) {
    const notificationEventId = result.notificationEventId;
    after(() => dispatchNotification(notificationEventId));
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: corsHeaders(allowedOrigin) });
}
