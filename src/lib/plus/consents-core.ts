/**
 * Nemryn Plus communication preferences (NP-P2-S6-B): pure labels, validation and error copy for the consent ledger
 * (database: 20261023100000_plus_communication_consents.sql; decisions ZD-228 .. ZD-242). No I/O.
 *
 * Wording rule (design section 3 C, ZD-232 / ZD-237): a recorded consent is EVIDENCE of what a person told the team. It is
 * never permission to send, never a legal determination, and Nemryn sends nothing. No label here may say "allowed",
 * "approved to send", "permitted" or "opted in".
 */

export const CONSENT_CHANNELS = ["email", "sms", "voice"] as const;
export const CONSENT_PURPOSES = ["service_followup", "marketing"] as const;
/** Staff-selectable capture methods only (ZD-238). do_not_contact is system-written; web_form / imported are not offered. */
export const STAFF_CAPTURE_METHODS = ["verbal_phone", "in_person", "written", "email_reply"] as const;

export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type StaffCaptureMethod = (typeof STAFF_CAPTURE_METHODS)[number];
export type ConsentMode = "grant" | "revoke";
export type RecordedStatus = "granted" | "revoked" | "none";
export type EffectiveStatus =
  | "consent_on_record"
  | "no_consent_on_record"
  | "address_changed"
  | "suppressed_do_not_contact"
  | "suppressed_archived"
  | "not_found";

export const CONSENT_LIMITS = { note: 500, historyPageSize: 20, captureWindowDays: 365 } as const;

const CHANNEL_LABELS: Record<ConsentChannel, string> = { email: "Email", sms: "Text messages (SMS)", voice: "Phone calls" };
const PURPOSE_LABELS: Record<ConsentPurpose, string> = { service_followup: "Service follow-up", marketing: "Marketing" };
const PURPOSE_DESCRIPTIONS: Record<ConsentPurpose, string> = {
  service_followup: "Replying to this person about their own enquiry or booking.",
  marketing: "Promotional news and offers. Separate from follow-up.",
};
const METHOD_LABELS: Record<string, string> = {
  verbal_phone: "On a phone call",
  in_person: "In person",
  written: "In writing",
  email_reply: "By email reply",
  do_not_contact: "Do not contact switched on",
  web_form: "Website form",
};

export function consentChannelLabel(channel: string): string {
  return CHANNEL_LABELS[channel as ConsentChannel] ?? channel;
}
export function consentPurposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose as ConsentPurpose] ?? purpose;
}
export function consentPurposeDescription(purpose: ConsentPurpose): string {
  return PURPOSE_DESCRIPTIONS[purpose];
}
export function captureMethodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

/** Badge for one channel / purpose cell. The approved labels (brief Phase 2 / design section 5.3). */
export function consentStateBadge(recorded: string, effective: string): { label: string; category: "positive" | "neutral" | "warning" | "critical" | "cancelled" } {
  switch (effective) {
    case "consent_on_record":
      return { label: "Consent recorded", category: "positive" };
    case "address_changed":
      return { label: "Recorded for a previous address", category: "warning" };
    case "suppressed_do_not_contact":
      return { label: "Suppressed — do not contact", category: "critical" };
    case "suppressed_archived":
      return { label: "Contact archived", category: "cancelled" };
    default:
      return recorded === "revoked" ? { label: "Revoked", category: "warning" } : { label: "No record", category: "neutral" };
  }
}

/** "Granted" / "Revoked" for a history entry (an event, not a permission). */
export function consentEventLabel(status: string): string {
  return status === "granted" ? "Granted" : "Revoked";
}

export const CONSENT_PANEL_DESCRIPTION =
  "What this person told your team about being contacted. A recorded consent isn't permission to send, and Nemryn sends nothing.";
export const CONSENT_EMPTY_TITLE = "No communication preferences recorded.";
export const CONSENT_EMPTY_DESCRIPTION =
  "Nemryn never assumes consent. Record it only when this person has told your team how they want to be contacted.";
export const CONSENT_READ_ONLY_NOTE = "Changes to communication preferences can be recorded again when Nemryn Plus is active.";
export const CONSENT_DNC_TITLE = "Do not contact is on.";
export const CONSENT_DNC_DESCRIPTION =
  "This person asked not to be contacted. Any consent recorded below is suppressed and no new consent can be recorded. Revocations can still be recorded. To change this, edit the contact.";
export const CONSENT_PREFERRED_CHANNEL_NOTE = "The preferred channel in Details is a convenience for your team. It isn't consent.";
export const CONSENT_DNC_SYSTEM_NOTE = "Recorded automatically when Do not contact was switched on.";
export const CONSENT_SELF_CONFIRMATION = "This person gave this consent themselves, for this channel and purpose.";

/** The approved Growth Agent caveat (ZD-237) lives in agent-core; this phrase list guards every consent label. */
export const FORBIDDEN_CONSENT_PHRASES = [/allowed to contact/i, /approved to send/i, /legally permitted/i, /opted in/i, /\bcan contact\b/i];

// ---------------------------------------------------------------------------------------------------------------------
// Input validation (mirrors the RPC; the database stays the authority)
// ---------------------------------------------------------------------------------------------------------------------
const KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isConsentChannel(raw: unknown): raw is ConsentChannel {
  return typeof raw === "string" && (CONSENT_CHANNELS as readonly string[]).includes(raw);
}
export function isConsentPurpose(raw: unknown): raw is ConsentPurpose {
  return typeof raw === "string" && (CONSENT_PURPOSES as readonly string[]).includes(raw);
}
export function isStaffCaptureMethod(raw: unknown): raw is StaffCaptureMethod {
  return typeof raw === "string" && (STAFF_CAPTURE_METHODS as readonly string[]).includes(raw);
}

/** Whether the contact has the address a GRANT on this channel binds to (email for email; phone for SMS / calls). */
export function channelHasAddress(channel: ConsentChannel, contact: { phone: string | null; email: string | null }): boolean {
  return channel === "email" ? !!contact.email : !!contact.phone && /\d/.test(contact.phone);
}

/** Earliest selectable capture date (organization-local date key), given today's key. */
export function earliestCaptureDate(todayKey: string): string {
  const d = new Date(`${todayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - CONSENT_LIMITS.captureWindowDays);
  return d.toISOString().slice(0, 10);
}

export interface ConsentFormValues {
  mode: string;
  channel: string;
  purpose: string;
  method: string;
  capturedDate: string;
  note: string;
  correctsConsentId: string;
  idempotencyKey: string;
  confirmed: boolean;
}

export interface ConsentInput {
  mode: ConsentMode;
  channel: ConsentChannel;
  purpose: ConsentPurpose;
  method: StaffCaptureMethod;
  /** Organization-local date key, or null for "today" (the server records now). */
  capturedDate: string | null;
  note: string | null;
  correctsConsentId: string | null;
  idempotencyKey: string;
}

/**
 * Validates a submission against the same rules as the RPC. `todayKey` is today's date in the organization timezone.
 * The caller never supplies an actor, a recorded time, an order, a digest or a status: mode only selects the RPC.
 */
export function validateConsentForm(values: ConsentFormValues, todayKey: string): { ok: true; value: ConsentInput } | { ok: false; error: string } {
  if (values.mode !== "grant" && values.mode !== "revoke") return { ok: false, error: "Reload the page and try again." };
  if (!isConsentChannel(values.channel)) return { ok: false, error: "Choose a channel." };
  if (!isConsentPurpose(values.purpose)) return { ok: false, error: "Choose a purpose." };
  if (!isStaffCaptureMethod(values.method)) return { ok: false, error: "Choose how they told you." };
  if (!KEY_RE.test(values.idempotencyKey)) return { ok: false, error: "Reload the page and try again." };
  const corrects = values.correctsConsentId.trim();
  if (corrects && !UUID_RE.test(corrects)) return { ok: false, error: "Reload the page and try again." };
  const note = values.note.trim();
  if (note.length > CONSENT_LIMITS.note) return { ok: false, error: `Keep the note to ${CONSENT_LIMITS.note} characters or fewer.` };
  if (corrects && !note) return { ok: false, error: "Explain the correction in the note." };
  let capturedDate: string | null = null;
  const date = values.capturedDate.trim();
  if (date) {
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { ok: false, error: "Enter a valid date." };
    if (date > todayKey) return { ok: false, error: "The date can't be in the future." };
    if (date < earliestCaptureDate(todayKey)) return { ok: false, error: "The date can't be more than a year ago." };
    capturedDate = date === todayKey ? null : date;
  }
  if (values.mode === "grant" && !values.confirmed) return { ok: false, error: "Confirm that this person gave this consent themselves." };
  return {
    ok: true,
    value: {
      mode: values.mode,
      channel: values.channel,
      purpose: values.purpose,
      method: values.method,
      capturedDate,
      note: note || null,
      correctsConsentId: corrects || null,
      idempotencyKey: values.idempotencyKey,
    },
  };
}

/** Plain-language copy for an RPC refusal. `message` is the database's exception name (e.g. stale_evidence). */
export function consentErrorMessage(code: string | undefined, message: string | undefined, mode: ConsentMode): string {
  const m = message ?? "";
  switch (code) {
    case "ZW001":
      return "Communication preferences can't be changed right now. Nemryn Plus is read-only, or your access is view-only.";
    case "ZW002":
      return "That contact isn't available. It may not exist, or you may no longer have access.";
    case "ZW003":
      return "These preferences changed since you opened them, so that entry can no longer be corrected. Reload the page and try again.";
    case "ZW004":
      if (m.includes("do_not_contact")) return "Do not contact is on for this person, so no new consent can be recorded.";
      if (m.includes("stale_evidence")) return "A revocation dated after this is already recorded. Use a date after that revocation, or check the history.";
      return mode === "grant"
        ? "Consent can't be recorded for this contact. Archived contacts accept revocations only, and automatic Do not contact entries can't be corrected."
        : "That entry can't be corrected.";
    case "ZW006":
      if (m.includes("idempotency_conflict")) return "This form was already used for a different entry. Close it and start again.";
      return mode === "grant"
        ? "Check the entry: the contact needs an address for this channel, and the date can't be in the future or more than a year ago."
        : "Check the entry: the date can't be in the future or more than a year ago, and a correction needs a note.";
    default:
      return "That change couldn't be saved. Try again.";
  }
}

export function consentSuccessMessage(mode: ConsentMode, changed: boolean, correction: boolean): string {
  if (!changed) return "That entry was already recorded.";
  if (correction) return "Correction recorded. The earlier entry is kept in the history.";
  return mode === "grant" ? "Consent recorded." : "Revocation recorded. Earlier entries are kept in the history.";
}

/** "Oct 12, 2026" in the organization's timezone (a capture date has day granularity); "" for an invalid instant. */
export function formatConsentDate(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(d);
}

/** Pair key for a channel / purpose cell. */
export function consentPairKey(channel: string, purpose: string): string {
  return `${channel}:${purpose}`;
}
