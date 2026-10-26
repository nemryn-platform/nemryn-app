/**
 * Pure, framework-free helpers for the PUBLIC Nemryn Plus inquiry form (NP-P2-S7-B): the public key format, the kill-switch
 * rule, passenger-facing copy and options, client validation, the closed-schema server validator, the submission body, the
 * status -> HTTP mapping and the iframe <-> loader postMessage protocol.
 *
 * No runtime import of any kind (so `node --test` can load it). Nothing here decides anything
 * authoritative: the service_role RPCs (`get_public_plus_inquiry_form`, `submit_plus_inquiry`) re-validate everything and
 * resolve the organization ONLY from a published, allowlisted key (ZD-243, ZD-262). Design:
 * docs/product/NP-P2-S7-public-inquiry-intake-design.md.
 */

/** The plus_opportunities.inquiry_type set (identical; inquiry-core.test.mjs asserts it against opportunities-core). */
export const INQUIRY_TYPES = ["quote", "availability", "service_question", "booking", "other"] as const;
/**
 * The EIGHT Plus opportunity service types and their labels (identical to opportunities-core; asserted by the unit test).
 * Never airport_transportation (ZD-263): the database also refuses it.
 */
export const SERVICE_TYPES = ["medical_appointment", "dialysis", "rehabilitation", "hospital_discharge", "recurring_care", "senior_medical", "wheelchair_transportation", "other"] as const;
export const SERVICE_LABELS: Record<(typeof SERVICE_TYPES)[number], string> = {
  medical_appointment: "Medical appointment",
  dialysis: "Dialysis transportation",
  rehabilitation: "Rehabilitation transportation",
  hospital_discharge: "Hospital discharge transportation",
  recurring_care: "Recurring care transportation",
  senior_medical: "Senior medical transportation",
  wheelchair_transportation: "Wheelchair transportation",
  other: "Other",
};

/** Opaque addressing identifier: "inq_" + 128 bits (hex). A namespace distinct from Core "form_" keys. Not a secret. */
export const INQUIRY_KEY_RE = /^inq_[0-9a-f]{32}$/;
export function isInquiryKey(value: unknown): value is string {
  return typeof value === "string" && INQUIRY_KEY_RE.test(value);
}

/**
 * The global kill switch (ZD-259). Public inquiries are available ONLY when the server environment sets
 * PLUS_INQUIRY_SUBMISSIONS to exactly "on". Unset, empty, "true", "ON " or anything else is OFF. Checked by the server on every
 * public page, config read and submission, before any database call; the per-organization allowlist (database) is checked as
 * well, and BOTH must allow.
 */
export function inquirySubmissionsEnabled(value: string | undefined): boolean {
  return value === "on";
}

/** The consent wording version the database stores with every inquiry (plus_inquiry_forms.consent_text_version). */
export const INQUIRY_CONSENT_TEXT_VERSION = "plus-inquiry-consent-v1";

/** What the public may see: nothing else leaves the server (no ids, no settings, no allowlist state). */
export interface PublicInquiryFormConfig {
  organizationName: string;
  headline: string;
  introText: string | null;
  /** Plus service types the form offers AND the organization still offers (never airport_transportation; ZD-263). */
  services: string[];
  configVersion: number;
  consentTextVersion: string;
}

/**
 * Passenger-facing copy. The consent sentences are the approved P2-S7 wording (OD-S7-9 / ZD-252); their final legal review is
 * still OUTSTANDING, so real submissions stay disabled (kill switch OFF, allowlist empty) until it is done. A change to the
 * consent sentences MUST come with a new consent text version.
 */
export const INQUIRY_COPY = {
  privacy: (org: string) => `Please don't include medical details. ${org} will reply about your question using the contact details you give.`,
  consentFollowup: (org: string) => `${org} may follow up with me about transportation services by the contact details above.`,
  consentMarketing: (org: string) => `Send me news and offers from ${org}.`,
  consentLegend: "Optional",
  checkInfo: "Please check the highlighted information.",
  couldNotSend: "We couldn't send your question right now. Please try again.",
  rateLimited: "We've received several messages from you recently. Please wait a little while, then try again.",
  formChanged: "This form was just updated. Please review it and send again.",
  unavailableTitle: "This form isn't available right now",
  unavailableBody: "Please contact the transportation company directly.",
  received: "Thanks — your question was sent",
  receivedBody: (org: string) => `${org} will get back to you.`,
  submitAnother: "Ask another question",
  submit: "Send question",
  sending: "Sending…",
  poweredBy: "Powered by Nemryn",
  notABooking: "This form is for questions. It doesn't book a ride.",
} as const;

export const RELATIONSHIP_OPTIONS = [
  { value: "self", label: "Myself" },
  { value: "family", label: "A family member" },
  { value: "caregiver", label: "Someone I care for" },
  { value: "facility_staff", label: "I'm facility staff" },
  { value: "other", label: "Other" },
] as const;

/** Inquiry types: the SAME closed set as plus_opportunities.inquiry_type (1:1 on conversion). */
export const INQUIRY_TYPE_OPTIONS = INQUIRY_TYPES.map((value) => ({
  value,
  label: value === "quote" ? "Price or estimate" : value === "availability" ? "Availability" : value === "service_question" ? "Is this service offered?" : value === "booking" ? "I'd like to book a ride" : "Something else",
}));

export const TIMEFRAME_OPTIONS = [
  { value: "asap", label: "As soon as possible" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "later", label: "Later" },
  { value: "not_sure", label: "Not sure" },
] as const;

export const PREFERRED_REPLY_OPTIONS = [
  { value: "either", label: "Either" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
] as const;

/** Labels for the offered services; only values in the Plus set are ever shown. */
export function serviceOptionsFor(services: readonly string[]): { value: string; label: string }[] {
  return services.filter((s): s is (typeof SERVICE_TYPES)[number] => (SERVICE_TYPES as readonly string[]).includes(s)).map((value) => ({ value, label: SERVICE_LABELS[value] }));
}

// ---------------------------------------------------------------------------
// Values, limits, validation (mirrors the plus_inquiries CHECKs; the database is the authority)
// ---------------------------------------------------------------------------
export const INQUIRY_LIMITS = { name: 120, phone: 40, email: 254, question: 500 } as const;

export interface InquiryValues {
  name: string;
  phone: string;
  email: string;
  preferredReply: "either" | "phone" | "email";
  relationship: string;
  inquiryType: string;
  serviceType: string;
  timeframe: string;
  question: string;
  consentFollowup: boolean;
  consentMarketing: boolean;
}

export const EMPTY_INQUIRY_VALUES: InquiryValues = {
  name: "", phone: "", email: "", preferredReply: "either", relationship: "", inquiryType: "", serviceType: "", timeframe: "",
  question: "", consentFollowup: false, consentMarketing: false,
};

export type InquiryFieldErrors = Partial<Record<keyof InquiryValues, string>>;
export const INQUIRY_FIELD_ORDER: (keyof InquiryValues)[] = ["name", "phone", "email", "preferredReply", "relationship", "inquiryType", "serviceType", "timeframe", "question"];

// The plus_contacts / plus_inquiries phone and email rules, exactly.
const PHONE_RE = /^[0-9+(). -]+( ?(x|ext\.?) ?[0-9]{1,6})?$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,100}$/;

export function isValidInquiryPhone(phone: string): boolean {
  const p = phone.trim();
  const digits = p.replace(/\D/g, "").length;
  return p.length <= INQUIRY_LIMITS.phone && PHONE_RE.test(p) && digits >= 7 && digits <= 20;
}
export function isValidInquiryEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return e.length >= 3 && e.length <= INQUIRY_LIMITS.email && EMAIL_RE.test(e);
}

/** Fast, friendly validation. The server and the database re-validate authoritatively. */
export function validateInquiryValues(v: InquiryValues, services: readonly string[]): InquiryFieldErrors {
  const e: InquiryFieldErrors = {};
  const name = v.name.trim();
  if (name === "") e.name = "Enter your name.";
  else if (name.length > INQUIRY_LIMITS.name || CONTROL_RE.test(name)) e.name = `Use at most ${INQUIRY_LIMITS.name} characters.`;
  const phone = v.phone.trim();
  const email = v.email.trim();
  if (phone === "" && email === "") {
    e.phone = "Enter a phone number or an email address.";
  } else {
    if (phone !== "" && !isValidInquiryPhone(phone)) e.phone = "Enter a phone number with the area code.";
    if (email !== "" && !isValidInquiryEmail(email)) e.email = "Enter a valid email address.";
  }
  if (v.preferredReply === "phone" && phone === "") e.preferredReply = "Add a phone number, or choose another way to reply.";
  if (v.preferredReply === "email" && email === "") e.preferredReply = "Add an email address, or choose another way to reply.";
  if (v.inquiryType === "") e.inquiryType = "Choose what your question is about.";
  if (v.serviceType !== "" && !services.includes(v.serviceType)) e.serviceType = "Choose one of the listed services.";
  const q = v.question.trim();
  if (q === "") e.question = "Enter your question.";
  else if (q.length > INQUIRY_LIMITS.question) e.question = `Use at most ${INQUIRY_LIMITS.question} characters.`;
  return e;
}

export function firstInvalidInquiryField(errors: InquiryFieldErrors): keyof InquiryValues | null {
  return INQUIRY_FIELD_ORDER.find((k) => errors[k] !== undefined) ?? null;
}

const blankToNull = (s: string) => (s.trim() === "" ? null : s.trim());

/** The submission body. There is deliberately NO organization / form / contact / status field (the server refuses them). */
export function buildInquiryBody(v: InquiryValues, extra: { idempotencyKey: string; configVersion: number; acquisition: Record<string, string> | null }) {
  const body: Record<string, unknown> = {
    idempotencyKey: extra.idempotencyKey,
    configVersion: extra.configVersion,
    name: v.name.trim(),
    phone: blankToNull(v.phone),
    email: blankToNull(v.email),
    preferredReply: v.preferredReply,
    relationship: blankToNull(v.relationship),
    inquiryType: v.inquiryType,
    serviceType: blankToNull(v.serviceType),
    timeframe: blankToNull(v.timeframe),
    question: v.question.trim(),
    consentFollowup: v.consentFollowup === true,
    consentMarketing: v.consentMarketing === true,
  };
  if (extra.acquisition && Object.keys(extra.acquisition).length > 0) body.acquisition = extra.acquisition;
  return body;
}

// ---------------------------------------------------------------------------
// Server-side closed-schema validation of the request body
// ---------------------------------------------------------------------------
export interface InquirySubmission {
  idempotencyKey: string;
  configVersion: number;
  name: string;
  phone: string | null;
  email: string | null;
  preferredReply: "either" | "phone" | "email";
  relationship: string | null;
  inquiryType: string;
  serviceType: string | null;
  timeframe: string | null;
  question: string;
  consentFollowup: boolean;
  consentMarketing: boolean;
  acquisition: Record<string, string> | null;
}

const ALLOWED_KEYS = new Set(["idempotencyKey", "configVersion", "name", "phone", "email", "preferredReply", "relationship", "inquiryType", "serviceType", "timeframe", "question", "consentFollowup", "consentMarketing", "acquisition"]);
const ACQUISITION_KEYS = new Set(["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "landingPath", "submissionPath", "referrerHost", "formVersion"]);
const RELATIONSHIPS = new Set<string>(RELATIONSHIP_OPTIONS.map((o) => o.value));
const TIMEFRAMES = new Set<string>(TIMEFRAME_OPTIONS.map((o) => o.value));
const REPLIES = new Set<string>(PREFERRED_REPLY_OPTIONS.map((o) => o.value));

const optString = (raw: unknown, max: number): string | null | undefined => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t === "") return null;
  return t.length <= max && !CONTROL_RE.test(t) ? t : undefined;
};

/**
 * Closed key set: any unknown key (organizationId, formId, status, contactId, ...) rejects the whole body. Types, lengths and
 * closed sets are checked here; the database re-checks every rule (and the service offering) authoritatively.
 */
export function validateInquiryPayload(raw: unknown): { ok: true; value: InquirySubmission } | { ok: false } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const b = raw as Record<string, unknown>;
  for (const key of Object.keys(b)) if (!ALLOWED_KEYS.has(key)) return { ok: false };
  if (typeof b.idempotencyKey !== "string" || !IDEMPOTENCY_RE.test(b.idempotencyKey)) return { ok: false };
  if (typeof b.configVersion !== "number" || !Number.isInteger(b.configVersion) || b.configVersion < 1) return { ok: false };
  if (typeof b.name !== "string") return { ok: false };
  const name = b.name.trim();
  if (name === "" || name.length > INQUIRY_LIMITS.name || CONTROL_RE.test(name)) return { ok: false };
  const phone = optString(b.phone, INQUIRY_LIMITS.phone);
  const email = optString(b.email, INQUIRY_LIMITS.email);
  if (phone === undefined || email === undefined) return { ok: false };
  if (phone === null && email === null) return { ok: false };
  if (phone !== null && !isValidInquiryPhone(phone)) return { ok: false };
  if (email !== null && !isValidInquiryEmail(email)) return { ok: false };
  const reply = b.preferredReply === undefined || b.preferredReply === null ? "either" : b.preferredReply;
  if (typeof reply !== "string" || !REPLIES.has(reply)) return { ok: false };
  if ((reply === "phone" && phone === null) || (reply === "email" && email === null)) return { ok: false };
  const relationship = optString(b.relationship, 40);
  if (relationship === undefined || (relationship !== null && !RELATIONSHIPS.has(relationship))) return { ok: false };
  if (typeof b.inquiryType !== "string" || !(INQUIRY_TYPES as readonly string[]).includes(b.inquiryType)) return { ok: false };
  const serviceType = optString(b.serviceType, 40);
  if (serviceType === undefined || (serviceType !== null && !(SERVICE_TYPES as readonly string[]).includes(serviceType))) return { ok: false };
  const timeframe = optString(b.timeframe, 40);
  if (timeframe === undefined || (timeframe !== null && !TIMEFRAMES.has(timeframe))) return { ok: false };
  if (typeof b.question !== "string") return { ok: false };
  const question = b.question.trim();
  if (question === "" || question.length > INQUIRY_LIMITS.question) return { ok: false };
  for (const k of ["consentFollowup", "consentMarketing"] as const) {
    if (b[k] !== undefined && typeof b[k] !== "boolean") return { ok: false };
  }
  let acquisition: Record<string, string> | null = null;
  if (b.acquisition !== undefined && b.acquisition !== null) {
    if (typeof b.acquisition !== "object" || Array.isArray(b.acquisition)) return { ok: false };
    const a = b.acquisition as Record<string, unknown>;
    acquisition = {};
    for (const [k, v] of Object.entries(a)) {
      // unknown acquisition keys are ignored (the database sanitiser keeps only the closed set), never an error
      if (ACQUISITION_KEYS.has(k) && typeof v === "string" && v.length <= 300) acquisition[k] = v;
    }
  }
  return {
    ok: true,
    value: {
      idempotencyKey: b.idempotencyKey, configVersion: b.configVersion, name, phone, email: email === null ? null : email.toLowerCase(),
      preferredReply: reply as InquirySubmission["preferredReply"], relationship, inquiryType: b.inquiryType, serviceType, timeframe,
      question, consentFollowup: b.consentFollowup === true, consentMarketing: b.consentMarketing === true, acquisition,
    },
  };
}

// ---------------------------------------------------------------------------
// Submission status -> HTTP response (uniform, minimal; no ids, no reasons, no limits)
// ---------------------------------------------------------------------------
export type InquirySubmitStatus = "accepted" | "unavailable" | "form_changed" | "invalid" | "rate_limited" | "error";
export function httpForInquiryStatus(status: InquirySubmitStatus): { status: number; body: Record<string, unknown> } {
  switch (status) {
    case "accepted": return { status: 200, body: { ok: true } };
    case "unavailable": return { status: 404, body: { ok: false, error: "unavailable" } };
    case "form_changed": return { status: 409, body: { ok: false, error: "form_changed" } };
    case "invalid": return { status: 400, body: { ok: false, error: "invalid_request" } };
    case "rate_limited": return { status: 429, body: { ok: false, error: "try_later" } };
    default: return { status: 503, body: { ok: false, error: "try_later" } };
  }
}

// ---------------------------------------------------------------------------
// iframe <-> loader postMessage protocol (same shape as the Core request form; its own source and key namespace)
// ---------------------------------------------------------------------------
export const INQUIRY_EMBED_SOURCE = "nemryn-inquiry-form";
export const INQUIRY_EMBED_VERSION = 1;
export type InquiryEmbedMessageType = "ready" | "resize" | "submitted" | "context";

export function isInquiryEmbedMessage(data: unknown, publicKey: string, type: InquiryEmbedMessageType): data is Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return d.source === INQUIRY_EMBED_SOURCE && d.v === INQUIRY_EMBED_VERSION && d.type === type && d.key === publicKey;
}

/** sessionStorage key for the acquisition-only first-touch helper (never any inquiry content). */
export function inquiryAcquisitionStorageKey(publicKey: string): string {
  return `nemryn:inquiry-form:${publicKey}:acquisition`;
}
