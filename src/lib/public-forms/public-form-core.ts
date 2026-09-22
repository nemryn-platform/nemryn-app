/**
 * Pure, framework-free helpers for the PUBLIC Nemryn request form (P1-COMM-D2): the public key format, the passenger-facing
 * copy, form values -> canonical intake payload mapping with client-side validation, the S4C-safe acquisition context
 * (hosted + embedded) and the iframe <-> loader postMessage protocol guards.
 *
 * No runtime import of any kind (so `node --test` can load it): this module never decides anything authoritative. The
 * server (Route Handler + `submit_public_form_request`) validates everything again; nothing here selects a tenant.
 * The embed loader (public/embed/request-form.js) is plain JavaScript and implements the SAME acquisition rules --
 * public-form-core.test.mjs runs the real loader against these functions to keep the two in lock-step.
 */

/** Opaque addressing identifier: "form_" + 128 bits (hex). NOT a secret -- the form is intentionally public. */
export const PUBLIC_FORM_KEY_RE = /^form_[0-9a-f]{32}$/;
export function isPublicFormKey(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_FORM_KEY_RE.test(value);
}

/** What a passenger may see: nothing else ever leaves the server (no ids, no Settings, no internal state). */
export interface PublicFormConfig {
  organizationName: string;
  title: string;
  introText: string | null;
  submitLabel: string;
  confirmationMessage: string;
  /** Canonical service identifiers currently offered by this form (already intersected with Services & Intake). */
  services: string[];
  allowRecurring: boolean;
  requireServiceChoice: boolean;
  /** Published version number; the S4C formVersion is "nemryn-form-v<formVersion>". */
  formVersion: number;
}

export function publicFormVersionLabel(version: number): string {
  const n = Number.isInteger(version) && version >= 1 ? version : 1;
  return `nemryn-form-v${n}`;
}

/** Passenger-facing copy. Never a ZW code, database message, RPC name, stack trace or rate-limit detail. */
export const PUBLIC_FORM_COPY = {
  checkInfo: "Please check the highlighted information.",
  couldNotSend: "We couldn't send your request right now. Please try again.",
  unavailableTitle: "This form isn't available right now",
  unavailableBody: "Please contact the transportation company directly to request a ride.",
  emergency: "This form is for non-emergency transportation requests. If this is an emergency, contact your local emergency service.",
  privacy: "Please don't include medical record numbers or detailed medical information.",
  received: "Request received",
  submitAnother: "Submit another request",
  poweredBy: "Powered by Nemryn",
} as const;

// ---------------------------------------------------------------------------
// Form values <-> canonical intake payload
// ---------------------------------------------------------------------------
export const WEEKDAYS = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
] as const;

export const RELATIONSHIP_OPTIONS = [
  { value: "self", label: "I am the passenger" },
  { value: "family", label: "Family member" },
  { value: "caregiver", label: "Caregiver" },
  { value: "facility_coordinator", label: "Facility coordinator" },
  { value: "other", label: "Other" },
] as const;

export const RETURN_TRIP_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
] as const;

/** Client-side input limits (well inside the canonical bounds so the whole body stays far below the endpoint's size cap). */
export const PUBLIC_FORM_INPUT_LIMITS = {
  name: 200,
  phone: 50,
  email: 320,
  address: 500,
  notes: 1000,
} as const;

export interface PublicFormValues {
  serviceType: string;
  pickupDescription: string;
  destinationDescription: string;
  preferredDate: string;
  preferredTime: string;
  returnTripNeeded: "" | "yes" | "no" | "not_sure";
  recurring: boolean;
  recurringDays: string[];
  recurringStartDate: string;
  recurringEndDate: string;
  recurringTime: string;
  assistanceNotes: string;
  passengerName: string;
  requesterName: string;
  requesterRelationship: string;
  requesterPhone: string;
  requesterEmail: string;
  additionalNotes: string;
}

export const EMPTY_PUBLIC_FORM_VALUES: PublicFormValues = {
  serviceType: "",
  pickupDescription: "",
  destinationDescription: "",
  preferredDate: "",
  preferredTime: "",
  returnTripNeeded: "",
  recurring: false,
  recurringDays: [],
  recurringStartDate: "",
  recurringEndDate: "",
  recurringTime: "",
  assistanceNotes: "",
  passengerName: "",
  requesterName: "",
  requesterRelationship: "",
  requesterPhone: "",
  requesterEmail: "",
  additionalNotes: "",
};

export type PublicFormFieldErrors = Partial<Record<keyof PublicFormValues, string>>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Field order used to move focus to the FIRST invalid field. */
export const PUBLIC_FORM_FIELD_ORDER: (keyof PublicFormValues)[] = [
  "serviceType", "pickupDescription", "destinationDescription", "preferredDate", "preferredTime", "returnTripNeeded",
  "recurringDays", "recurringStartDate", "recurringEndDate", "recurringTime", "assistanceNotes", "passengerName",
  "requesterName", "requesterRelationship", "requesterPhone", "requesterEmail", "additionalNotes",
];

/** Fast, friendly validation. The server re-validates authoritatively; this only decides whether to send. */
export function validatePublicFormValues(values: PublicFormValues, config: Pick<PublicFormConfig, "services" | "allowRecurring" | "requireServiceChoice">): PublicFormFieldErrors {
  const errors: PublicFormFieldErrors = {};
  if (config.services.length > 0) {
    if (values.serviceType === "" ) {
      if (config.requireServiceChoice) errors.serviceType = "Choose what the trip is for.";
    } else if (!config.services.includes(values.serviceType)) {
      errors.serviceType = "Choose one of the listed options.";
    }
  }
  if (values.pickupDescription.trim() === "") errors.pickupDescription = "Enter the pickup address.";
  if (values.destinationDescription.trim() === "") errors.destinationDescription = "Enter where you are going.";
  if (values.preferredDate !== "" && !ISO_DATE_RE.test(values.preferredDate)) errors.preferredDate = "Enter a valid date.";
  if (values.preferredTime !== "" && !TIME_RE.test(values.preferredTime)) errors.preferredTime = "Enter a valid time.";
  if (values.returnTripNeeded === "") errors.returnTripNeeded = "Tell us whether you need a ride back.";
  if (config.allowRecurring && values.recurring) {
    if (values.recurringDays.length === 0) errors.recurringDays = "Choose at least one day of the week.";
    if (!ISO_DATE_RE.test(values.recurringStartDate)) errors.recurringStartDate = "Enter the date the rides should start.";
    if (values.recurringEndDate !== "") {
      if (!ISO_DATE_RE.test(values.recurringEndDate)) errors.recurringEndDate = "Enter a valid date.";
      else if (ISO_DATE_RE.test(values.recurringStartDate) && values.recurringEndDate < values.recurringStartDate) errors.recurringEndDate = "The end date can't be before the start date.";
    }
    if (values.recurringTime !== "" && !TIME_RE.test(values.recurringTime)) errors.recurringTime = "Enter a valid time.";
  }
  if (values.requesterName.trim() === "") errors.requesterName = "Enter your name.";
  if (values.requesterRelationship === "") errors.requesterRelationship = "Tell us how you're related to the passenger.";
  const digits = values.requesterPhone.replace(/\D/g, "");
  if (values.requesterPhone.trim() === "") errors.requesterPhone = "Enter a phone number we can call.";
  else if (digits.length < 7) errors.requesterPhone = "Enter a phone number we can call, including the area code.";
  if (values.requesterEmail.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.requesterEmail.trim())) errors.requesterEmail = "Enter a valid email address, or leave it blank.";
  return errors;
}

/** First invalid field in display order (for focus movement), or null. */
export function firstInvalidField(errors: PublicFormFieldErrors): keyof PublicFormValues | null {
  return PUBLIC_FORM_FIELD_ORDER.find((k) => errors[k] !== undefined) ?? null;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The canonical website-intake body for this submission (the SAME field contract `submit_public_transportation_request`
 * accepts -- no second Request schema). There is deliberately NO organization / integration / passenger field.
 */
export function buildSubmissionBody(
  values: PublicFormValues,
  config: Pick<PublicFormConfig, "allowRecurring">,
  extra: { idempotencyKey: string; acquisition: Record<string, string> | null },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    idempotencyKey: extra.idempotencyKey,
    requesterName: values.requesterName.trim(),
    requesterRelationship: values.requesterRelationship,
    requesterPhone: values.requesterPhone.trim(),
    pickupDescription: values.pickupDescription.trim(),
    destinationDescription: values.destinationDescription.trim(),
    returnTripNeeded: values.returnTripNeeded,
  };
  const set = (key: string, value: string | undefined) => { if (value !== undefined) body[key] = value; };
  set("requesterEmail", optional(values.requesterEmail));
  set("preferredDate", optional(values.preferredDate));
  set("preferredTime", optional(values.preferredTime));
  set("assistanceNotes", optional(values.assistanceNotes));
  set("additionalNotes", optional(values.additionalNotes));
  set("passengerName", optional(values.passengerName));
  set("serviceType", optional(values.serviceType));
  if (config.allowRecurring && values.recurring) {
    const order = WEEKDAYS.map((d) => d.value as string);
    body.recurringSchedule = {
      daysOfWeek: order.filter((d) => values.recurringDays.includes(d)),
      startDate: values.recurringStartDate,
      endDate: optional(values.recurringEndDate) ?? null,
      appointmentTime: optional(values.recurringTime) ?? null,
      returnTripExpected: null,
    };
  }
  if (extra.acquisition && Object.keys(extra.acquisition).length > 0) body.acquisition = extra.acquisition;
  return body;
}

// ---------------------------------------------------------------------------
// S4C-safe acquisition context (hosted + embedded). Closed field set; pathnames and bare hostnames only.
// ---------------------------------------------------------------------------
const UTM_PARAMS: [string, string, number][] = [
  ["utm_source", "utmSource", 120],
  ["utm_medium", "utmMedium", 120],
  ["utm_campaign", "utmCampaign", 160],
  ["utm_content", "utmContent", 160],
  ["utm_term", "utmTerm", 160],
];
const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
export const ACQUISITION_CONTEXT_KEYS = ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "landingPath", "submissionPath", "referrerHost"] as const;

/** A pathname (never a URL, query or fragment) or null. */
export function safePathname(pathname: unknown): string | null {
  if (typeof pathname !== "string") return null;
  const p = pathname.trim();
  if (p.length < 1 || p.length > 300 || !PATH_RE.test(p) || p.startsWith("//")) return null;
  return p;
}

/** The hostname of a referrer URL (lowercased, no port/path/query), or null. `ownHost` (same-site navigation) is dropped. */
export function referrerHostOf(referrer: unknown, ownHost?: string | null): string | null {
  if (typeof referrer !== "string" || referrer === "") return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "" || host.length > 253 || !HOST_RE.test(host) || /\.\.|-\.|\.-/.test(host)) return null;
  if (ownHost && host === ownHost.toLowerCase()) return null;
  return host;
}

/**
 * What this page visit tells us, in S4C's closed vocabulary. `search` is the raw query string (only the five utm_* values are
 * read from it; the query itself is NEVER kept); `pathname` becomes the landing / submission path; the referrer is reduced to
 * its hostname. No full URL, click id, cookie, IP or user agent is ever produced.
 */
export function acquisitionFromLocation(input: { search: string; pathname: string; referrer: string; ownHost?: string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  let params: URLSearchParams | null = null;
  try {
    params = new URLSearchParams(input.search);
  } catch {
    params = null;
  }
  if (params) {
    for (const [param, key, max] of UTM_PARAMS) {
      const raw = params.get(param);
      if (raw === null) continue;
      const v = raw.trim();
      if (v !== "" && Array.from(v).length <= max && !CONTROL_RE.test(v)) out[key] = v;
    }
  }
  const path = safePathname(input.pathname);
  if (path) {
    out.landingPath = path;
    out.submissionPath = path;
  }
  const host = referrerHostOf(input.referrer, input.ownHost);
  if (host) out.referrerHost = host;
  return out;
}

/** Only the closed acquisition keys, string values only, bounded -- for anything read back from storage or received by message. */
export function sanitizeAcquisitionContext(raw: unknown): Record<string, string> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ACQUISITION_CONTEXT_KEYS) {
    const v = body[key];
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t === "" || t.length > 300 || CONTROL_RE.test(t)) continue;
    if ((key === "landingPath" || key === "submissionPath") && safePathname(t) === null) continue;
    if (key === "referrerHost" && !HOST_RE.test(t.toLowerCase())) continue;
    out[key] = key === "referrerHost" ? t.toLowerCase() : t;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * First-touch rule for the browser session: the FIRST observation (landing path, UTMs, referrer) is kept; the submission
 * path always reflects where the passenger submitted from. When nothing was stored yet the current visit becomes the first.
 */
export function mergeFirstTouch(stored: Record<string, string> | null, current: Record<string, string>): Record<string, string> {
  if (!stored) return { ...current };
  const merged: Record<string, string> = { ...stored };
  if (current.submissionPath) merged.submissionPath = current.submissionPath;
  return merged;
}

/** sessionStorage key for the acquisition-ONLY helper. Holds S4C values only -- never any passenger data. */
export function acquisitionStorageKey(publicKey: string): string {
  return `nemryn:request-form:${publicKey}:acquisition`;
}

// ---------------------------------------------------------------------------
// iframe <-> loader postMessage protocol
// ---------------------------------------------------------------------------
export const EMBED_MESSAGE_SOURCE = "nemryn-request-form";
export const EMBED_MESSAGE_VERSION = 1;
export type EmbedMessageType = "ready" | "resize" | "submitted" | "context";
export const MIN_EMBED_HEIGHT = 200;
export const MAX_EMBED_HEIGHT = 6000;

/** True only for a well-formed message of this protocol for THIS form key and the expected type. */
export function isEmbedMessage(data: unknown, publicKey: string, type: EmbedMessageType): data is Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return d.source === EMBED_MESSAGE_SOURCE && d.v === EMBED_MESSAGE_VERSION && d.type === type && d.key === publicKey;
}

/** A finite iframe height clamped to a sane range, or null. */
export function clampEmbedHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(MAX_EMBED_HEIGHT, Math.max(MIN_EMBED_HEIGHT, Math.ceil(value)));
}
