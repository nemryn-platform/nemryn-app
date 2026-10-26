import { NextResponse, type NextRequest } from "next/server";
import { resolveClientIpFromHeaders } from "@/lib/public-intake/rate-limit-core";
import { checkInquiryRateLimit, publicInquiriesEnabled, submitPublicInquiry } from "@/lib/plus-inquiry/inquiry-public";
import { httpForInquiryStatus, isInquiryKey, validateInquiryPayload, type InquirySubmitStatus } from "@/lib/plus-inquiry/inquiry-core";

/**
 * NP-P2-S7-B -- the ONE public write of the Nemryn Plus inquiry form (hosted page or embed iframe, same origin):
 *
 *   kill switch -> key format -> Origin -> 8 KB cap -> JSON -> closed-schema validation -> durable rate limit
 *   -> service_role `submit_plus_inquiry` (publication + allowlist + active org + Plus write + every field rule)
 *
 * Trust model (ZD-243, ZD-254, ZD-259, ZD-262):
 *  - The global kill switch PLUS_INQUIRY_SUBMISSIONS must be exactly "on" (server env; default OFF) AND the organization must
 *    be on the database allowlist. Either missing -> the uniform 404.
 *  - The organization is resolved ONLY from the opaque key, inside the database. The body can never name an organization,
 *    form, contact, status or owner (closed key set).
 *  - No CORS. A browser Origin that is not this app's own is refused; a request without Origin is allowed (Origin is never the
 *    authorization boundary -- the activation rules, closed schema and rate limit are).
 *  - Responses are minimal and uniform: no ids, no database text, no limits. Nothing about the submission is logged.
 *  - A submission creates ONE inquiry: no contact, opportunity, Core Request, consent row or notification.
 */
const MAX_BODY_BYTES = 8 * 1024;
const NO_STORE = { "Cache-Control": "no-store" } as const;

function respond(status: InquirySubmitStatus) {
  const r = httpForInquiryStatus(status);
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

function ownOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>([request.nextUrl.origin]);
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) origins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
  } catch {
    /* ignore a malformed configured URL */
  }
  return origins;
}

export async function POST(request: NextRequest, context: { params: Promise<{ publicKey: string }> }) {
  if (!publicInquiriesEnabled()) return respond("unavailable");
  const { publicKey } = await context.params;
  if (!isInquiryKey(publicKey)) return respond("unavailable");

  const origin = request.headers.get("origin");
  if (origin !== null && !ownOrigins(request).has(origin)) return respond("invalid");

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) return respond("invalid");
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return respond("invalid");
  }
  if (raw.length > MAX_BODY_BYTES) return respond("invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return respond("invalid");
  }
  const validation = validateInquiryPayload(parsed);
  if (!validation.ok) return respond("invalid");

  // Checked AND recorded before the submission. The client key is a one-way hash; the raw IP is never stored or logged.
  const rate = await checkInquiryRateLimit(publicKey, resolveClientIpFromHeaders(request.headers));
  if (rate === "limited") return respond("rate_limited");
  if (rate === "error") return respond("error");

  return respond(await submitPublicInquiry(publicKey, validation.value));
}
