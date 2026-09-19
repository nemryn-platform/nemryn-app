/**
 * Pure, framework-free validation + safe-error-mapping helpers for the
 * public tenant-website intake boundary (P1-PILOT-S4A). Deliberately has
 * NO `server-only`/database import, and no RUNTIME import of any kind —
 * mirrors `operations-brief-core.ts`'s/`recurring-care-bulk-core.ts`'s
 * own established "no runtime import" charter, so this module can be
 * unit-tested directly with Node's test runner, with no bundler and no
 * database.
 *
 * This module is a FAST, CLIENT-FACING pre-check only — it never
 * replaces `submit_public_transportation_request`'s own authoritative
 * validation, which re-validates every one of these same fields
 * server-side regardless of what passes here (defense in depth, exactly
 * like every other "light client-side check, real check in the RPC"
 * pair already established in this codebase — see
 * `src/app/operations/requests/new/actions.ts`'s own explicit comment on
 * this same distinction). Bounds below are kept in exact sync with
 * `submit_public_transportation_request`'s own SQL-side limits
 * (supabase/migrations/20260919090000_public_request_intake_foundation.sql),
 * which are themselves kept in exact sync with
 * `log_transportation_request`'s own limits — a public Request and a
 * staff-entered Request must satisfy the identical minimum save
 * contract.
 *
 * NO business/database authority lives here: this module never decides
 * which organization a submission belongs to (that is
 * `request_intake_integrations` lookup, entirely inside the RPC), never
 * decides whether an integration is active, and never performs the
 * idempotency check itself (that is the database's own unique index).
 */

export const REQUESTER_RELATIONSHIP_VALUES = ["self", "family", "caregiver", "facility_coordinator", "other"] as const;
export const RETURN_TRIP_NEEDED_VALUES = ["yes", "no", "not_sure"] as const;

export type RequesterRelationship = (typeof REQUESTER_RELATIONSHIP_VALUES)[number];
export type ReturnTripNeeded = (typeof RETURN_TRIP_NEEDED_VALUES)[number];

/** Raw, fully untrusted shape as received from an external caller's JSON body — every field is `unknown` until validated below. */
export interface RawWebsiteIntakePayload {
  [key: string]: unknown;
}

/** The normalized, validated payload this module hands back on success — safe to pass directly as RPC parameters. */
export interface WebsiteIntakeSubmission {
  integrationExternalId: string;
  idempotencyKey: string;
  requesterName: string;
  requesterRelationship: RequesterRelationship;
  requesterPhone: string;
  pickupDescription: string;
  destinationDescription: string;
  returnTripNeeded: ReturnTripNeeded;
  requesterEmail: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  assistanceNotes: string | null;
  additionalNotes: string | null;
}

/**
 * Every field this endpoint will ever accept — deliberately closed, not
 * open. `validateWebsiteIntakePayload` rejects a payload containing any
 * OTHER top-level key (§ "unexpected properties" in the phase's own
 * validation checklist) rather than silently ignoring it, since a client
 * sending unexpected fields is itself a signal worth failing closed on.
 */
const ALLOWED_KEYS = new Set([
  "integrationExternalId",
  "idempotencyKey",
  "requesterName",
  "requesterRelationship",
  "requesterPhone",
  "pickupDescription",
  "destinationDescription",
  "returnTripNeeded",
  "requesterEmail",
  "preferredDate",
  "preferredTime",
  "assistanceNotes",
  "additionalNotes",
]);

/** A single, narrow, public-safe error vocabulary — deliberately NOT finer-grained than this. Every distinct internal failure (unknown field, missing field, oversized field, invalid enum value, malformed date/time, a disabled integration, a nonexistent integration, an Origin mismatch, a field-validation failure inside the RPC itself) collapses to this SAME code from the public caller's point of view — no existence oracle, exactly mirroring ZW002's own "not_found is not_found regardless of why" contract carried one layer further out to the public HTTP boundary. */
export type PublicIntakeErrorCode = "invalid_request";

export type WebsiteIntakeValidationResult =
  | { ok: true; value: WebsiteIntakeSubmission }
  | { ok: false; error: PublicIntakeErrorCode };

const MAX_LENGTHS = {
  integrationExternalId: 200,
  idempotencyKey: 200,
  requesterName: 200,
  requesterPhone: 50,
  requesterEmail: 320,
  pickupDescription: 2000,
  destinationDescription: 2000,
  assistanceNotes: 4000,
  additionalNotes: 4000,
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function nonBlankString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function optionalString(value: unknown, maxLength: number): { present: boolean; value: string | null } {
  if (value === undefined || value === null) return { present: true, value: null };
  if (typeof value !== "string") return { present: false, value: null };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { present: true, value: null };
  if (trimmed.length > maxLength) return { present: false, value: null };
  return { present: true, value: trimmed };
}

const INVALID: WebsiteIntakeValidationResult = { ok: false, error: "invalid_request" };

/**
 * Validates a raw, untrusted JSON payload against the exact field set
 * `submit_public_transportation_request` accepts. Rejects: missing
 * required fields, wrong types, oversized strings, an unrecognized
 * `requesterRelationship`/`returnTripNeeded` value, a malformed
 * `preferredDate`/`preferredTime`, and any top-level key outside
 * `ALLOWED_KEYS` (including a caller attempting to send `organizationId`,
 * `passengerId`, `state`, `source`, or any other field this endpoint
 * structurally does not accept at all — see the route handler's own
 * comment for why no such field ever reaches the RPC).
 */
export function validateWebsiteIntakePayload(raw: unknown): WebsiteIntakeValidationResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return INVALID;
  }
  const body = raw as RawWebsiteIntakePayload;

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return INVALID;
    }
  }

  const integrationExternalId = nonBlankString(body.integrationExternalId, MAX_LENGTHS.integrationExternalId);
  if (integrationExternalId === null) return INVALID;

  const idempotencyKey = nonBlankString(body.idempotencyKey, MAX_LENGTHS.idempotencyKey);
  if (idempotencyKey === null) return INVALID;

  const requesterName = nonBlankString(body.requesterName, MAX_LENGTHS.requesterName);
  if (requesterName === null) return INVALID;

  if (typeof body.requesterRelationship !== "string" || !REQUESTER_RELATIONSHIP_VALUES.includes(body.requesterRelationship as RequesterRelationship)) {
    return INVALID;
  }
  const requesterRelationship = body.requesterRelationship as RequesterRelationship;

  const requesterPhone = nonBlankString(body.requesterPhone, MAX_LENGTHS.requesterPhone);
  if (requesterPhone === null) return INVALID;

  const pickupDescription = nonBlankString(body.pickupDescription, MAX_LENGTHS.pickupDescription);
  if (pickupDescription === null) return INVALID;

  const destinationDescription = nonBlankString(body.destinationDescription, MAX_LENGTHS.destinationDescription);
  if (destinationDescription === null) return INVALID;

  if (typeof body.returnTripNeeded !== "string" || !RETURN_TRIP_NEEDED_VALUES.includes(body.returnTripNeeded as ReturnTripNeeded)) {
    return INVALID;
  }
  const returnTripNeeded = body.returnTripNeeded as ReturnTripNeeded;

  const email = optionalString(body.requesterEmail, MAX_LENGTHS.requesterEmail);
  if (!email.present) return INVALID;

  const assistance = optionalString(body.assistanceNotes, MAX_LENGTHS.assistanceNotes);
  if (!assistance.present) return INVALID;

  const additional = optionalString(body.additionalNotes, MAX_LENGTHS.additionalNotes);
  if (!additional.present) return INVALID;

  let preferredDate: string | null = null;
  if (body.preferredDate !== undefined && body.preferredDate !== null) {
    if (typeof body.preferredDate !== "string" || !DATE_RE.test(body.preferredDate)) return INVALID;
    preferredDate = body.preferredDate;
  }

  let preferredTime: string | null = null;
  if (body.preferredTime !== undefined && body.preferredTime !== null) {
    if (typeof body.preferredTime !== "string" || !TIME_RE.test(body.preferredTime)) return INVALID;
    preferredTime = body.preferredTime;
  }

  return {
    ok: true,
    value: {
      integrationExternalId,
      idempotencyKey,
      requesterName,
      requesterRelationship,
      requesterPhone,
      pickupDescription,
      destinationDescription,
      returnTripNeeded,
      requesterEmail: email.value,
      preferredDate,
      preferredTime,
      assistanceNotes: assistance.value,
      additionalNotes: additional.value,
    },
  };
}

/** Single, safe, public-facing message per code — never a raw SQL/PostgREST/ZW code, never a stack trace, never an internal identifier. Deliberately a single-entry map today: every distinct internal failure (malformed payload, disabled integration, field-validation failure inside the RPC) collapses to the SAME `PublicIntakeErrorCode`, so there is only one message to find here — kept as a lookup (mirroring log-request-errors.ts's own established `Record<Code, string>` shape) rather than a bare string literal, so a future, genuinely-distinct public error class has an obvious place to land without restructuring this function's own signature. */
const PUBLIC_INTAKE_ERROR_MESSAGE: Record<PublicIntakeErrorCode, string> = {
  invalid_request: "We couldn't process this request. Please check the information provided and try again.",
};

export function publicIntakeErrorMessage(code: PublicIntakeErrorCode): string {
  return PUBLIC_INTAKE_ERROR_MESSAGE[code];
}

/**
 * Request Hub provenance display (P1-PILOT-S4A). The authoritative
 * signal is `intakeIntegrationId !== null` — NEVER `source === 'web'`
 * alone, which remains a separately staff-selectable descriptive channel
 * a human can choose for an entirely manually-typed row (see the
 * migration's own column comment on
 * `transportation_requests.intake_integration_id`). Returns `null` (no
 * badge at all) for the overwhelmingly common staff-entered case, never
 * a generic "Staff entered" label competing for attention — the phase's
 * own "do not make provenance visually dominant" instruction.
 */
export function requestProvenanceLabel(intakeIntegrationId: string | null): "Website" | null {
  return intakeIntegrationId !== null ? "Website" : null;
}
