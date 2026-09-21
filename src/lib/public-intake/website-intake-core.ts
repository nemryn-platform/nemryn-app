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

/** Closed allow-list (P1-PILOT-S4B-R2) — matches Zenward-Web's own `SERVICE_TYPES` (src/lib/request-intake/service-types.ts in that repository) value-for-value. Optional at this layer (a future non-Zenward integration need not send one — see submit_public_transportation_request's own p_service_type default null), but when present must be exactly one of these. */
export const SERVICE_TYPE_VALUES = [
  "medical_appointment",
  "dialysis",
  "rehabilitation",
  "hospital_discharge",
  "recurring_care",
  "senior_medical",
  "wheelchair_transportation",
  "other",
] as const;

/** Lowercase weekday NAME strings — the wire contract, matching Zenward-Web's own `Weekday` type exactly. The RPC converts these to canonical ISO weekday numbers (1=Monday..7=Sunday) for storage; this module never does that conversion itself (server-authoritative, per this schema's own established discipline). */
export const RECURRING_WEEKDAY_VALUES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export type RequesterRelationship = (typeof REQUESTER_RELATIONSHIP_VALUES)[number];
export type ReturnTripNeeded = (typeof RETURN_TRIP_NEEDED_VALUES)[number];
export type ServiceType = (typeof SERVICE_TYPE_VALUES)[number];
export type RecurringWeekday = (typeof RECURRING_WEEKDAY_VALUES)[number];

/** The REQUESTED recurring schedule (P1-PILOT-S4B-R2) — describes what the requester wants, never an actual Trip series or a recurring_arrangements row. Mirrors Zenward-Web's own `RecurringSchedule` shape (src/lib/request-intake/recurring.ts) field-for-field. */
export interface RecurringScheduleInput {
  daysOfWeek: RecurringWeekday[];
  startDate: string;
  endDate: string | null;
  appointmentTime: string | null;
  returnTripExpected: boolean | null;
}

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
  /** P1-PILOT-S4B-R2. Optional — `null` when the caller did not send one (backward compatible with any non-Zenward integration). */
  serviceType: ServiceType | null;
  /** P1-PILOT-S4B-R2. Optional — `null` means a one-time request (the pre-R2 default, unchanged). */
  recurringSchedule: RecurringScheduleInput | null;
  /** P1-PILOT-S4B-R2A. A free-text SNAPSHOT of the passenger name the requester supplied — NOT a Passenger id, NOT matched/resolved against any Passenger record. `null` when not sent. See `transportation_requests.requested_passenger_name`'s own column comment for the full snapshot/entity distinction. */
  requestedPassengerName: string | null;
  /**
   * P1-PILOT-S4C. Optional acquisition attribution, ALREADY SANITISED by `sanitizeAcquisition`: only valid
   * known fields survive, `null` when the caller sent nothing usable. It can never make the submission
   * invalid -- a valid transportation Request must never fail because of marketing attribution.
   */
  acquisition: AcquisitionAttribution | null;
}

/**
 * P1-PILOT-S4C -- the closed set of acquisition facts a website may send with a Request. Every property is
 * optional. Nothing else is ever accepted (no IP, user agent, cookies, full URLs, query strings, click ids,
 * arbitrary metadata).
 */
export interface AcquisitionAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingPath?: string;
  submissionPath?: string;
  referrerHost?: string;
  formVersion?: string;
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
  "serviceType",
  "recurringSchedule",
  "passengerName",
  // P1-PILOT-S4C -- optional; sanitised leniently (see sanitizeAcquisition), never a reason to reject.
  "acquisition",
]);

/** Keys `recurringSchedule` itself may contain — a nested closed field set, exactly like the top-level `ALLOWED_KEYS` above. */
const RECURRING_SCHEDULE_ALLOWED_KEYS = new Set(["daysOfWeek", "startDate", "endDate", "appointmentTime", "returnTripExpected"]);

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
  /** P1-PILOT-S4B-R2A — matches `requester_name`'s own bound exactly (same category of free-text snapshot field). */
  passengerName: 200,
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
/** Strict 24-hour `HH:MM` (hour 00-23, minute 00-59) — used only for `recurringSchedule.appointmentTime` (P1-PILOT-S4B-R2), which the phase's own shape spec requires as exactly this format, matching Zenward-Web's own `isTime`. */
const STRICT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30, 2026-13-01, …) — a stricter check than `DATE_RE`'s own shape-only match, needed for `recurringSchedule.startDate`/`endDate` per the phase's own "valid real calendar date" requirement. Mirrors Zenward-Web's own `isIsoDate` exactly. */
function isRealIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

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
 * Validates a raw, untrusted `recurringSchedule` object (P1-PILOT-S4B-R2).
 * Returns the normalized shape on success, `null` on any failure —
 * mirrors Zenward-Web's own `parseRecurringSchedule` rule-for-rule:
 *   - must be a plain object with ONLY the five known keys (an array,
 *     primitive, or an object with an unknown key is rejected, never
 *     silently trimmed);
 *   - `daysOfWeek`: array of 1-7 distinct allow-listed weekday-name
 *     strings;
 *   - `startDate`: required, a real `YYYY-MM-DD` calendar date;
 *   - `endDate`: optional; a real date, not before `startDate`;
 *   - `appointmentTime`: optional; strict 24-hour `HH:MM`;
 *   - `returnTripExpected`: optional; a strict boolean (`"true"`/`1` is
 *     rejected, never coerced).
 * This is still only a fast, client-facing PRE-check — the RPC
 * (submit_public_transportation_request) re-validates every one of
 * these same rules server-side regardless of what passes here, exactly
 * like every other field this module checks.
 */
function validateRecurringSchedule(raw: unknown): RecurringScheduleInput | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;

  for (const key of Object.keys(body)) {
    if (!RECURRING_SCHEDULE_ALLOWED_KEYS.has(key)) return null;
  }

  const days = body.daysOfWeek;
  if (!Array.isArray(days) || days.length < 1 || days.length > RECURRING_WEEKDAY_VALUES.length) return null;
  const seen = new Set<RecurringWeekday>();
  for (const d of days) {
    if (typeof d !== "string" || !RECURRING_WEEKDAY_VALUES.includes(d as RecurringWeekday)) return null;
    if (seen.has(d as RecurringWeekday)) return null;
    seen.add(d as RecurringWeekday);
  }
  const daysOfWeek = RECURRING_WEEKDAY_VALUES.filter((d) => seen.has(d));

  if (typeof body.startDate !== "string" || !isRealIsoDate(body.startDate)) return null;
  const startDate = body.startDate;

  let endDate: string | null = null;
  if (body.endDate !== undefined && body.endDate !== null && body.endDate !== "") {
    if (typeof body.endDate !== "string" || !isRealIsoDate(body.endDate)) return null;
    if (body.endDate < startDate) return null; // ISO dates sort lexicographically
    endDate = body.endDate;
  }

  let appointmentTime: string | null = null;
  if (body.appointmentTime !== undefined && body.appointmentTime !== null && body.appointmentTime !== "") {
    if (typeof body.appointmentTime !== "string" || !STRICT_TIME_RE.test(body.appointmentTime)) return null;
    appointmentTime = body.appointmentTime;
  }

  let returnTripExpected: boolean | null = null;
  if (body.returnTripExpected !== undefined && body.returnTripExpected !== null) {
    if (typeof body.returnTripExpected !== "boolean") return null;
    returnTripExpected = body.returnTripExpected;
  }

  return { daysOfWeek, startDate, endDate, appointmentTime, returnTripExpected };
}

/** Acquisition limits (P1-PILOT-S4C) -- kept in exact sync with public._sanitize_acquisition and the table CHECK constraints. */
export const ACQUISITION_LIMITS = {
  utmSource: 120,
  utmMedium: 120,
  utmCampaign: 160,
  utmContent: 160,
  utmTerm: 160,
  landingPath: 300,
  submissionPath: 300,
  referrerHost: 253,
  formVersion: 64,
} as const;

const ACQUISITION_UTM_KEYS = ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm"] as const;
/** pathname only: leading "/", RFC 3986 path characters, no "?", "#", whitespace or backslash. */
const ACQUISITION_PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const ACQUISITION_HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const ACQUISITION_FORM_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

function codePoints(value: string): number {
  return Array.from(value).length;
}

/**
 * Reduces an UNTRUSTED `acquisition` value to the closed set of valid facts. NEVER throws and NEVER rejects:
 * a non-object, unknown keys, non-string values and any value that fails its rule are simply dropped;
 * `null` is returned when nothing valid remains (=> no attribution snapshot is created). Rules:
 *  - UTM fields: trimmed, non-empty, within the limit, no control characters; case is preserved.
 *  - landingPath / submissionPath: a pathname only (starts with "/", not "//", no scheme, host, query or fragment).
 *  - referrerHost: a bare hostname (no protocol, port, path or query), lowercased -- hostnames are case-insensitive.
 *  - formVersion: a short safe identifier.
 * The database re-sanitises independently (`public._sanitize_acquisition`) -- this is the fast first pass.
 */
export function sanitizeAcquisition(raw: unknown): AcquisitionAttribution | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const out: AcquisitionAttribution = {};

  for (const key of ACQUISITION_UTM_KEYS) {
    const value = body[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0 && codePoints(trimmed) <= ACQUISITION_LIMITS[key] && !CONTROL_CHARS_RE.test(trimmed)) out[key] = trimmed;
  }

  for (const key of ["landingPath", "submissionPath"] as const) {
    const value = body[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length >= 1 && codePoints(trimmed) <= ACQUISITION_LIMITS[key] && ACQUISITION_PATH_RE.test(trimmed) && !trimmed.startsWith("//")) out[key] = trimmed;
  }

  if (typeof body.referrerHost === "string") {
    const host = body.referrerHost.trim().toLowerCase();
    if (host.length >= 1 && host.length <= ACQUISITION_LIMITS.referrerHost && ACQUISITION_HOST_RE.test(host) && !/\.\.|-\.|\.-/.test(host)) out.referrerHost = host;
  }

  if (typeof body.formVersion === "string") {
    const version = body.formVersion.trim();
    if (version.length >= 1 && version.length <= ACQUISITION_LIMITS.formVersion && ACQUISITION_FORM_VERSION_RE.test(version)) out.formVersion = version;
  }

  return Object.keys(out).length > 0 ? out : null;
}

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

  // P1-PILOT-S4B-R2 — serviceType: optional (absent = backward compatible
  // with a future non-Zenward integration), but when present must be
  // exactly one allow-listed value — never coerced, never accepted as an
  // arbitrary string.
  let serviceType: ServiceType | null = null;
  if (body.serviceType !== undefined && body.serviceType !== null) {
    if (typeof body.serviceType !== "string" || !SERVICE_TYPE_VALUES.includes(body.serviceType as ServiceType)) {
      return INVALID;
    }
    serviceType = body.serviceType as ServiceType;
  }

  // P1-PILOT-S4B-R2 — recurringSchedule: optional; absent means a
  // one-time request (unchanged default). When present, validated
  // strictly — see validateRecurringSchedule's own comment for the full
  // rule set.
  let recurringSchedule: RecurringScheduleInput | null = null;
  if (body.recurringSchedule !== undefined && body.recurringSchedule !== null) {
    const parsed = validateRecurringSchedule(body.recurringSchedule);
    if (parsed === null) return INVALID;
    recurringSchedule = parsed;
  }

  // P1-PILOT-S4B-R2A — passengerName: optional free-text SNAPSHOT of the
  // passenger's name. Same `optionalString` convention as `requesterEmail`/
  // `assistanceNotes`/`additionalNotes` — an empty string normalizes to
  // `null` (not rejected), a too-long value is rejected, wrong type is
  // rejected. This value is NEVER matched, resolved, or looked up against
  // any Passenger record — it is stored on the Request row only (see
  // `transportation_requests.requested_passenger_name`'s own comment).
  const passengerName = optionalString(body.passengerName, MAX_LENGTHS.passengerName);
  if (!passengerName.present) return INVALID;

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
      serviceType,
      recurringSchedule,
      requestedPassengerName: passengerName.value,
      // P1-PILOT-S4C -- best effort: never a validation failure.
      acquisition: sanitizeAcquisition(body.acquisition),
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

/** Human-readable labels for `SERVICE_TYPE_VALUES` (P1-PILOT-S4B-R2) — matches Zenward-Web's own `SERVICE_TYPE_LABELS` (src/lib/request-intake/service-types.ts in that repository) word-for-word, so the label an operator sees in Request Hub matches what the requester saw on the form. */
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  medical_appointment: "Medical appointment",
  dialysis: "Dialysis transportation",
  rehabilitation: "Rehabilitation transportation",
  hospital_discharge: "Hospital discharge transportation",
  recurring_care: "Recurring care transportation",
  senior_medical: "Senior medical transportation",
  wheelchair_transportation: "Wheelchair transportation",
  other: "Other",
};

/** Short weekday labels keyed by the canonical ISO weekday number (1=Monday..7=Sunday) `transportation_requests.recurring_days_of_week` stores — for rendering a REQUESTED schedule's days on Request Detail. */
const ISO_WEEKDAY_SHORT_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

/** Renders a stored `recurring_days_of_week` (ISO weekday numbers, already canonically ascending) as `"Mon, Wed, Fri"`. Unrecognized numbers (should never occur — the DB CHECK constraint already guarantees 1-7 only) are simply skipped rather than throwing, since this is a display helper, not a validator. */
export function formatRecurringDaysOfWeek(daysOfWeek: number[]): string {
  return daysOfWeek
    .map((d) => ISO_WEEKDAY_SHORT_LABELS[d])
    .filter((label): label is string => Boolean(label))
    .join(", ");
}
