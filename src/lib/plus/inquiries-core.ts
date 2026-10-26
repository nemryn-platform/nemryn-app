/**
 * Nemryn Plus -- staff inquiry management (NP-P2-S7-C): pure rules for Growth -> Inquiries and Settings -> Nemryn Plus ->
 * Inquiry form. No runtime import (unit-tested under plain `node --test`: inquiries-core.test.mjs). The database decides
 * everything authoritative (S7-A RPCs, ZD-243 .. ZD-263); this module only labels, parses and explains.
 */

export const INQUIRY_STATUS_FILTERS = ["new", "converted", "dismissed", "all"] as const;
export type InquiryStatusFilter = (typeof INQUIRY_STATUS_FILTERS)[number];
export const INQUIRIES_PAGE_SIZE = 25;

export const DISMISS_REASONS = ["spam", "duplicate", "not_relevant", "out_of_area", "other"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];
export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  spam: "Spam",
  duplicate: "Duplicate",
  not_relevant: "Not relevant",
  out_of_area: "Outside our service area",
  other: "Other",
};
export const DISMISS_NOTE_MAX = 500;

const STATUS_LABELS: Record<string, string> = { new: "New", converted: "Converted", dismissed: "Dismissed" };
export function inquiryStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
export function inquiryStatusTone(status: string): "informational" | "positive" | "neutral" {
  return status === "new" ? "informational" : status === "converted" ? "positive" : "neutral";
}
export function dismissReasonLabel(reason: string | null): string {
  return reason && reason in DISMISS_REASON_LABELS ? DISMISS_REASON_LABELS[reason as DismissReason] : "—";
}

const INQUIRY_TYPE_LABELS: Record<string, string> = {
  quote: "Price or estimate",
  availability: "Availability",
  service_question: "Is this service offered?",
  booking: "Wants to book a ride",
  other: "Something else",
};
const RELATIONSHIP_LABELS: Record<string, string> = { self: "Themselves", family: "A family member", caregiver: "Someone they care for", facility_staff: "Facility staff", other: "Other" };
const TIMEFRAME_LABELS: Record<string, string> = { asap: "As soon as possible", this_week: "This week", this_month: "This month", later: "Later", not_sure: "Not sure" };
const REPLY_LABELS: Record<string, string> = { either: "Phone or email", phone: "Phone", email: "Email" };
export const inquiryTypeText = (v: string | null) => (v ? INQUIRY_TYPE_LABELS[v] ?? v : "—");
export const relationshipText = (v: string | null) => (v ? RELATIONSHIP_LABELS[v] ?? v : "Not given");
export const timeframeText = (v: string | null) => (v ? TIMEFRAME_LABELS[v] ?? v : "Not given");
export const preferredReplyText = (v: string | null) => (v ? REPLY_LABELS[v] ?? v : "—");

/** The title plus_convert_inquiry gives the opportunity when staff leave it blank (kept in step with the RPC). */
const DEFAULT_TITLE_SUFFIX: Record<string, string> = { quote: "Price question", availability: "Availability question", service_question: "Service question", booking: "Booking interest" };
export function defaultOpportunityTitle(name: string, inquiryType: string): string {
  return `${name} — ${DEFAULT_TITLE_SUFFIX[inquiryType] ?? "Website inquiry"}`;
}

/** plus_list_inquiry_duplicate_hints' match_on ("email,phone,name") in words: "email, phone and name". */
export function matchOnText(raw: string): string {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "—";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Directory parameters from the URL (bounded; unknown values fall back to the defaults). */
export function parseInquiryListParams(raw: Record<string, string | string[] | undefined>): { status: InquiryStatusFilter; search: string; page: number } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = (INQUIRY_STATUS_FILTERS as readonly string[]).includes(one(raw.status)) ? (one(raw.status) as InquiryStatusFilter) : "new";
  const search = one(raw.q).trim().slice(0, 200);
  const page = Math.min(Math.max(1, Number.parseInt(one(raw.page), 10) || 1), 4000);
  return { status, search, page };
}
export function inquiryListHref(p: { status: InquiryStatusFilter; search: string; page: number }, over: Partial<{ status: InquiryStatusFilter; search: string; page: number }> = {}): string {
  const v = { ...p, ...over };
  const qs = new URLSearchParams();
  if (v.status !== "new") qs.set("status", v.status);
  if (v.search) qs.set("q", v.search);
  if (v.page > 1) qs.set("page", String(v.page));
  const s = qs.toString();
  return `/operations/growth/inquiries${s ? `?${s}` : ""}`;
}

/**
 * What the person ticked on the public form. Wording is deliberate: a ticked box is NOT "consent on record" until staff
 * convert the inquiry (ZD-252), and an UNticked box is never permission of any kind.
 */
export function consentTicksText(followup: boolean, marketing: boolean): string[] {
  return [
    followup ? "Ticked: follow-up about transportation services" : "Not ticked: follow-up (no permission given)",
    marketing ? "Ticked: news and offers" : "Not ticked: news and offers (no permission given)",
  ];
}

/** One skipped web_form consent pair from plus_convert_inquiry ('<channel>/<purpose>:<reason>') in plain words. */
export function consentSkipText(entry: string): string {
  const [pair, reason] = entry.split(":");
  const [channel, purpose] = (pair ?? "").split("/");
  const what = `${channel === "voice" ? "Phone calls" : channel === "email" ? "Email" : channel} — ${purpose === "marketing" ? "news and offers" : "follow-up"}`;
  const why: Record<string, string> = {
    do_not_contact: "not recorded because the contact is marked Do not contact",
    address_mismatch: "not recorded because the contact's address differs from the one given on the form",
    no_contact_address: "not recorded because the contact has no address for this channel",
    no_inquiry_address: "not recorded because the form gave no address for this channel",
    stale_evidence: "not recorded because a later withdrawal is already on file",
    evidence_too_old: "not recorded because the submission is more than a year old",
    contact_not_active: "not recorded because the contact is not active",
  };
  return `${what}: ${why[reason ?? ""] ?? "not recorded"}.`;
}

/** Staff-facing error text for an S7-A RPC failure (never the raw code or database message). */
export function inquiryErrorMessage(code: string | undefined, message?: string): string {
  if (code === "ZW004" && message?.includes("do_not_contact_acknowledgement_required")) {
    return "This contact is marked Do not contact. Confirm you have read the warning to continue.";
  }
  if (code === "ZW004" && message?.includes("public_access_not_enabled")) {
    return "Public inquiries haven't been turned on for this workspace yet. Nemryn turns them on; the form can be saved in the meantime.";
  }
  switch (code) {
    case "ZW001": return "You can view inquiries but not change them.";
    case "ZW002": return "This inquiry or contact isn't available. It may belong to another workspace or have been removed.";
    case "ZW003": return "Someone else changed this just now. Reload the page to see the latest version.";
    case "ZW004": return "This change isn't possible in the inquiry's current state. Reload the page to see the latest version.";
    case "ZW006": return "Some information wasn't accepted. Check the values and try again.";
    default: return "Something went wrong. Nothing was changed; please try again.";
  }
}

// ---------------------------------------------------------------------------
// Settings -> Inquiry form
// ---------------------------------------------------------------------------
export const FORM_LIMITS = { headline: 120, intro: 500 } as const;

export function validateInquiryFormSettings(input: { headline: unknown; introText: unknown; services: unknown }, allowedServices: readonly string[]):
  | { ok: true; value: { headline: string; introText: string | null; services: string[] } }
  | { ok: false; errors: { headline?: string; introText?: string; services?: string } } {
  const errors: { headline?: string; introText?: string; services?: string } = {};
  const headline = typeof input.headline === "string" ? input.headline.trim() : "";
  if (headline === "") errors.headline = "Enter a headline.";
  else if (headline.length > FORM_LIMITS.headline) errors.headline = `Use at most ${FORM_LIMITS.headline} characters.`;
  const intro = typeof input.introText === "string" ? input.introText.trim() : "";
  if (intro.length > FORM_LIMITS.intro) errors.introText = `Use at most ${FORM_LIMITS.intro} characters.`;
  const services = Array.isArray(input.services) ? [...new Set(input.services.filter((s): s is string => typeof s === "string"))] : [];
  if (services.some((s) => !allowedServices.includes(s))) errors.services = "Choose only services your workspace offers.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { headline, introText: intro === "" ? null : intro, services } };
}

export function inquiryFormStatusLabel(status: string | null): { label: string; tone: "neutral" | "positive" | "warning" } {
  if (status === "published") return { label: "Published", tone: "positive" };
  if (status === "disabled") return { label: "Disabled", tone: "warning" };
  if (status === "draft") return { label: "Draft", tone: "neutral" };
  return { label: "Not set up", tone: "neutral" };
}

export function buildInquiryHostedUrl(origin: string, publicKey: string): string {
  return `${origin.replace(/\/+$/, "")}/inquiry/${publicKey}`;
}
export function buildInquiryEmbedSnippet(origin: string, publicKey: string): string {
  const o = origin.replace(/\/+$/, "");
  return [`<div data-nemryn-inquiry-form="${publicKey}"></div>`, `<script src="${o}/embed/inquiry-form.js" async></script>`].join("\n");
}
