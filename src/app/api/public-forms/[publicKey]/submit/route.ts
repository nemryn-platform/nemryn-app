import { NextResponse, after, type NextRequest } from "next/server";
import { validatePublicFormPayload } from "@/lib/public-intake/website-intake-core";
import { checkAndRecordPublicIntakeRateLimit, resolveClientIp } from "@/lib/public-intake/rate-limit";
import { getPublicRequestForm, submitPublicFormRequest } from "@/lib/public-forms/public-form";
import { PUBLIC_FORM_COPY, isPublicFormKey } from "@/lib/public-forms/public-form-core";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { normalizeRequestFormOrigin } from "@/lib/operations/website-requests-setup-core";

/**
 * P1-COMM-D2 -- the ONE public write boundary of the Nemryn-hosted / embedded request form:
 *
 *   browser (Nemryn-hosted page or the embed iframe, same origin) -> this route -> closed-schema validation -> durable rate limit
 *   -> narrow service_role RPC `submit_public_form_request` -> publication + organization + snapshot rules -> the SAME canonical
 *   Request-creation primitive website intake uses.
 *
 * Trust model:
 *  - The tenant is resolved ONLY from the opaque public key in the URL. The body may never name an organization, integration,
 *    passenger, state or source (the closed key set rejects them).
 *  - No CORS: only Nemryn-hosted pages submit here. A browser Origin that is not this app's own is refused; a request with no
 *    Origin (server-to-server) is allowed -- Origin is never the authorization boundary, the publication + rate limit are.
 *  - The tenant website's Origin is NOT faked or required (the embed iframe is Nemryn's own page).
 *  - Responses are minimal and uniform: {"ok":true} or a generic passenger-safe message. No Request id, no ZW code, no
 *    database text, no rate-limit detail. Unknown / disabled / suspended forms are indistinguishable (404).
 *  - Idempotency is authoritative in the database (unique per binding + client submission reference).
 */
const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
const unavailable = () => json(404, { ok: false, error: "unavailable", message: PUBLIC_FORM_COPY.unavailableTitle });
const invalid = (status = 400) => json(status, { ok: false, error: "invalid_request", message: status === 429 ? PUBLIC_FORM_COPY.couldNotSend : PUBLIC_FORM_COPY.checkInfo });

function ownOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>([request.nextUrl.origin]);
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) origins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
  } catch {
    /* ignore a malformed configured URL */
  }
  // P1-COMM-D3: the dedicated hosted-form origin (e.g. https://request.nemryn.com) is also Nemryn's own origin -- the
  // hosted form served there posts here. Only this exact configured origin is added; no third-party origin is admitted.
  const requestFormOrigin = normalizeRequestFormOrigin(process.env.REQUEST_FORM_ORIGIN);
  if (requestFormOrigin) origins.add(requestFormOrigin);
  return origins;
}

export async function POST(request: NextRequest, context: { params: Promise<{ publicKey: string }> }) {
  const { publicKey } = await context.params;
  if (!isPublicFormKey(publicKey)) return unavailable();

  const origin = request.headers.get("origin");
  if (origin !== null && !ownOrigins(request).has(origin)) return invalid();

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) return invalid();

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return invalid();
  }
  if (rawText.length > MAX_BODY_BYTES) return invalid();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return invalid();
  }

  const validation = validatePublicFormPayload(parsed);
  if (!validation.ok) return invalid();

  // Durable, atomic per-form AND per-client rate limit (the existing limiter; the public key is its "integration" bucket).
  // Checked and recorded BEFORE the submission RPC is called. The client key is a one-way hash of the IP: no raw IP is stored.
  const rate = await checkAndRecordPublicIntakeRateLimit(publicKey, resolveClientIp(request.headers));
  if (!rate.allowed) return invalid(429);

  const result = await submitPublicFormRequest(publicKey, validation.value);
  if (result.status !== "accepted") {
    // Rejected for any reason. A form that is no longer available says so (the public config already discloses availability);
    // everything else is the generic "check your information". Neither reveals which rule failed.
    return (await getPublicRequestForm(publicKey)) ? invalid() : unavailable();
  }

  // Genuinely NEW Request only (an idempotent replay has no event id): notify the tenant after the response, best effort.
  if (result.notificationEventId) {
    const notificationEventId = result.notificationEventId;
    after(() => dispatchNotification(notificationEventId));
  }
  return json(200, { ok: true });
}
