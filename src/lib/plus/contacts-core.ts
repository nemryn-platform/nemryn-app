/**
 * Pure rules for Nemryn Plus Contacts and the activity timeline (NP-P1-S4). Runtime-import-free (unit-tested under
 * plain Node: contacts-core.test.mjs).
 *
 * The database is the authority (plus_create_contact / plus_update_contact / plus_archive_contact /
 * plus_log_contact_activity re-check Plus access, the organization, every value and the version). These helpers mirror
 * the database's limits so a form can explain a problem before submitting, and they keep wording in one place.
 * They never grant anything.
 */

export const CONTACT_KINDS = ["individual", "family_caregiver", "facility_staff", "referral_source", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const CONTACT_CHANNELS = ["phone", "email", "none"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export type ContactStatus = "active" | "archived";
export type ContactStatusFilter = ContactStatus | "all";

/** Staff-loggable timeline entries. owner_changed / record_archived are written by the system. */
export const LOGGABLE_ACTIVITY_TYPES = ["note", "call_logged", "email_logged", "meeting_logged"] as const;
export type LoggableActivityType = (typeof LOGGABLE_ACTIVITY_TYPES)[number];
export type ActivityType = LoggableActivityType | "owner_changed" | "record_archived" | "stage_changed";

export const CONTACT_LIMITS = {
  name: 200,
  phone: 40,
  email: 254,
  jobTitle: 120,
  body: 2000,
  archiveReason: 500,
  search: 200,
} as const;

export const CONTACTS_PAGE_SIZE = 25;

const KIND_LABELS: Record<ContactKind, string> = {
  individual: "Individual",
  family_caregiver: "Family member / caregiver",
  facility_staff: "Facility staff",
  referral_source: "Referral source",
  other: "Other",
};
const CHANNEL_LABELS: Record<ContactChannel, string> = { phone: "Phone", email: "Email", none: "No preference" };
const ACTIVITY_LABELS: Record<ActivityType, string> = {
  note: "Note",
  call_logged: "Call logged",
  email_logged: "Email logged",
  meeting_logged: "Meeting logged",
  owner_changed: "Owner changed",
  record_archived: "Contact archived",
  stage_changed: "Stage changed",
};
const LOG_ACTION_LABELS: Record<LoggableActivityType, string> = {
  note: "Add note",
  call_logged: "Log call",
  email_logged: "Log email",
  meeting_logged: "Log meeting",
};

export function isContactKind(raw: unknown): raw is ContactKind {
  return typeof raw === "string" && (CONTACT_KINDS as readonly string[]).includes(raw);
}
export function isContactChannel(raw: unknown): raw is ContactChannel {
  return typeof raw === "string" && (CONTACT_CHANNELS as readonly string[]).includes(raw);
}
export function isLoggableActivityType(raw: unknown): raw is LoggableActivityType {
  return typeof raw === "string" && (LOGGABLE_ACTIVITY_TYPES as readonly string[]).includes(raw);
}

export function contactKindLabel(kind: string): string {
  return isContactKind(kind) ? KIND_LABELS[kind] : "Other";
}
export function contactChannelLabel(channel: string): string {
  return isContactChannel(channel) ? CHANNEL_LABELS[channel] : "No preference";
}
export function activityTypeLabel(type: string): string {
  return (ACTIVITY_LABELS as Record<string, string>)[type] ?? "Activity";
}
export function logActionLabel(type: LoggableActivityType): string {
  return LOG_ACTION_LABELS[type];
}

export const CONTACT_KIND_OPTIONS = CONTACT_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }));
export const CONTACT_CHANNEL_OPTIONS = CONTACT_CHANNELS.map((value) => ({ value, label: CHANNEL_LABELS[value] }));

/**
 * Shown next to every free-text field. It is a reminder, NOT a control: it cannot stop someone typing health details.
 * (docs/security/plus-access-model.md section 5, C6.)
 */
export const NO_MEDICAL_DETAILS_NOTICE =
  "Don't record medical, diagnosis, insurance or patient-care details here. Keep notes to what's needed to follow up.";

/** Logging is a record of what staff did themselves -- Nemryn never sends, calls or schedules anything. */
export const LOGGING_IS_NOT_SENDING_NOTICE =
  "This records an interaction you had. Nemryn doesn't send emails, place calls or schedule meetings.";

export const DO_NOT_CONTACT_HELP =
  "Stored as this person's preference. Nemryn Plus does not send messages today; any future outreach feature must respect it.";

// ---------------------------------------------------------------------------------------------------------------------
// Contact form validation (mirrors the plus_contacts CHECK constraints)
// ---------------------------------------------------------------------------------------------------------------------
const PHONE_RE = /^[0-9+(). -]+( ?(x|ext\.?) ?[0-9]{1,6})?$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ContactFormValues {
  displayName: string;
  phone: string;
  email: string;
  contactKind: string;
  jobTitle: string;
  preferredChannel: string;
  doNotContact: boolean;
  /** Opaque membership handle of the owner, or "" for none. */
  ownerHandle: string;
}

export interface ContactInput {
  displayName: string;
  phone: string | null;
  email: string | null;
  contactKind: ContactKind;
  jobTitle: string | null;
  preferredChannel: ContactChannel;
  doNotContact: boolean;
  ownerHandle: string | null;
}

export type ContactFieldErrors = Partial<Record<"displayName" | "phone" | "email" | "contactKind" | "jobTitle" | "preferredChannel" | "ownerHandle" | "form", string>>;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function phoneDigits(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

export function validateContactForm(values: ContactFormValues): { ok: true; value: ContactInput } | { ok: false; errors: ContactFieldErrors } {
  const errors: ContactFieldErrors = {};
  const displayName = values.displayName.trim();
  const phone = values.phone.trim();
  const email = normalizeEmail(values.email);
  const jobTitle = values.jobTitle.trim();

  if (!displayName) errors.displayName = "Enter a name.";
  else if (displayName.length > CONTACT_LIMITS.name) errors.displayName = `Use ${CONTACT_LIMITS.name} characters or fewer.`;

  if (phone) {
    const digits = phoneDigits(phone).length;
    if (phone.length > CONTACT_LIMITS.phone || !PHONE_RE.test(phone) || digits < 7 || digits > 20) {
      errors.phone = "Enter a phone number using digits, spaces and + ( ) . - (an extension like x12 is fine).";
    }
  }
  if (email && (email.length > CONTACT_LIMITS.email || !EMAIL_RE.test(email))) errors.email = "Enter a valid email address.";
  if (!phone && !email && !errors.phone && !errors.email) errors.form = "Add a phone number or an email address.";

  if (!isContactKind(values.contactKind)) errors.contactKind = "Choose a contact type.";
  if (jobTitle.length > CONTACT_LIMITS.jobTitle) errors.jobTitle = `Use ${CONTACT_LIMITS.jobTitle} characters or fewer.`;
  if (!isContactChannel(values.preferredChannel)) errors.preferredChannel = "Choose a preferred channel.";
  if (values.preferredChannel === "phone" && !phone && email && !errors.preferredChannel) {
    errors.preferredChannel = "Add a phone number, or choose another preferred channel.";
  }
  if (values.preferredChannel === "email" && !email && phone && !errors.preferredChannel) {
    errors.preferredChannel = "Add an email address, or choose another preferred channel.";
  }
  if (values.ownerHandle && !UUID_RE.test(values.ownerHandle)) errors.ownerHandle = "Choose an owner from the list.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      displayName,
      phone: phone || null,
      email: email || null,
      contactKind: values.contactKind as ContactKind,
      jobTitle: jobTitle || null,
      preferredChannel: values.preferredChannel as ContactChannel,
      doNotContact: values.doNotContact,
      ownerHandle: values.ownerHandle || null,
    },
  };
}

export function isUuid(raw: unknown): raw is string {
  return typeof raw === "string" && UUID_RE.test(raw);
}

// ---------------------------------------------------------------------------------------------------------------------
// Activity logging
// ---------------------------------------------------------------------------------------------------------------------
export type ActivityInput =
  | { ok: true; type: LoggableActivityType; body: string }
  | { ok: false; error: string };

export function validateActivityInput(rawType: unknown, rawBody: unknown): ActivityInput {
  if (!isLoggableActivityType(rawType)) return { ok: false, error: "Choose what you are recording." };
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  if (!body) return { ok: false, error: "Write a short summary." };
  if (body.length > CONTACT_LIMITS.body) return { ok: false, error: `Use ${CONTACT_LIMITS.body} characters or fewer.` };
  return { ok: true, type: rawType, body };
}

// ---------------------------------------------------------------------------------------------------------------------
// List parameters (from the URL; anything unexpected falls back to the default)
// ---------------------------------------------------------------------------------------------------------------------
export interface ContactListParams {
  search: string;
  kind: ContactKind | null;
  status: ContactStatusFilter;
  page: number;
}

function single(raw: string | string[] | undefined): string {
  return typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
}

export function parseContactListParams(params: Record<string, string | string[] | undefined>): ContactListParams {
  const search = single(params.q).trim().slice(0, CONTACT_LIMITS.search);
  const kindRaw = single(params.kind);
  const statusRaw = single(params.status);
  const pageRaw = Number.parseInt(single(params.page), 10);
  return {
    search,
    kind: isContactKind(kindRaw) ? kindRaw : null,
    status: statusRaw === "archived" || statusRaw === "all" ? statusRaw : "active",
    page: Number.isFinite(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000 ? pageRaw : 1,
  };
}

export function contactListHref(params: ContactListParams, overrides: Partial<ContactListParams> = {}): string {
  const p = { ...params, ...overrides };
  const qs = new URLSearchParams();
  if (p.search) qs.set("q", p.search);
  if (p.kind) qs.set("kind", p.kind);
  if (p.status !== "active") qs.set("status", p.status);
  if (p.page > 1) qs.set("page", String(p.page));
  const s = qs.toString();
  return `/operations/growth/contacts${s ? `?${s}` : ""}`;
}

export function pageCount(total: number, pageSize = CONTACTS_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

// ---------------------------------------------------------------------------------------------------------------------
// Duplicates and errors
// ---------------------------------------------------------------------------------------------------------------------
export interface PossibleDuplicate {
  contactId: string;
  displayName: string;
  status: string;
  matchOn: string[];
}

export function describeMatch(matchOn: string[]): string {
  const parts = matchOn.filter((m) => m === "email" || m === "phone" || m === "name");
  if (parts.length === 0) return "Similar details";
  const words = parts.map((m) => (m === "email" ? "email" : m === "phone" ? "phone" : "name"));
  return `Same ${words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`}`;
}

export const CONTACT_STALE_MESSAGE =
  "This contact changed since you opened it. Reload the page to see the latest details, then make your change again.";

export function contactErrorMessage(code: string | undefined, operation: "save" | "archive" | "log" | "load"): string {
  switch (code) {
    case "ZW003":
      return CONTACT_STALE_MESSAGE;
    case "ZW004":
      return "This contact is archived. Archived contacts are kept as history and can't be changed.";
    case "ZW006":
      return operation === "log"
        ? "Check the entry: a summary is required and the time can't be in the future or more than a year ago."
        : "Check the details: a name and a phone number or email are required, and the owner must have Nemryn Plus write access.";
    case "ZW001":
      return "You can view contacts but not change them. Ask an Organization Admin for write access.";
    case "ZW002":
      return "That contact isn't available. It may not exist, or you may no longer have access.";
    default:
      return operation === "load" ? "Contacts couldn't be loaded. Try again." : "That change couldn't be saved. Try again.";
  }
}

/** "Oct 14, 2026, 9:05 AM" in the organization's own timezone; "" for an invalid instant. */
export function formatContactTime(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(d);
}

/** True when an entry was logged noticeably after it happened (shown as "logged later"). */
export function isBackdated(occurredAt: string, recordedAt: string): boolean {
  const o = Date.parse(occurredAt);
  const r = Date.parse(recordedAt);
  return !Number.isNaN(o) && !Number.isNaN(r) && r - o > 10 * 60_000;
}
