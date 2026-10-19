/**
 * Estimates & quotes -- pure rules (NP-P2-S5-S2). Runtime-import-free (unit-tested under plain Node:
 * quotes-core.test.mjs).
 *
 * Staff enter every price by hand in US dollars; these helpers turn that text into integer cents EXACTLY (string
 * arithmetic -- never floating-point multiplication or rounding), preview the total, and mirror the database's own
 * limits so people get clear messages first. The database stays authoritative: _plus_quote_validate re-checks
 * everything, computes the stored total, and the page always shows the server-confirmed record after a save.
 * OD-Q12 (ZD-221): one active draft and one current sent quote per opportunity. Expiry is derived (is_expired from the
 * read RPCs), never a stored status.
 */

/** Mirrors the S1 CHECKs / _plus_quote_validate. */
export const QUOTE_LIMITS = {
  /** each charge and the discount: 0 .. $100,000.00 */
  maxLineCents: 10_000_000,
  otherLabel: 60,
  terms: 500,
  /** numeric(7,1) */
  maxMiles: 99_999.9,
} as const;

export const QUOTE_KINDS = ["estimate", "quote"] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];
const KIND_LABELS: Record<QuoteKind, string> = { estimate: "Estimate", quote: "Quote" };
export const KIND_OPTIONS = QUOTE_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }));
export const KIND_HELP: Record<QuoteKind, string> = {
  estimate: "A non-binding price to help the customer plan.",
  quote: "A price your team commits to until the valid-until date.",
};
export const quoteKindLabel = (v: string) => (v === "estimate" || v === "quote" ? KIND_LABELS[v] : "Quote");

/** The eight Plus opportunity services (no airport in this release); mirrors opportunities-core SERVICE_TYPES. */
export const QUOTE_SERVICE_TYPES = [
  "medical_appointment",
  "dialysis",
  "rehabilitation",
  "hospital_discharge",
  "recurring_care",
  "senior_medical",
  "wheelchair_transportation",
  "other",
] as const;
export type QuoteServiceType = (typeof QUOTE_SERVICE_TYPES)[number];

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "superseded", "withdrawn"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
type Tone = "neutral" | "informational" | "active" | "positive" | "warning" | "critical" | "completed" | "cancelled";
const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  superseded: "Replaced by a revision",
  withdrawn: "Withdrawn",
};
const STATUS_TONES: Record<QuoteStatus, Tone> = {
  draft: "neutral",
  sent: "informational",
  accepted: "positive",
  declined: "cancelled",
  superseded: "cancelled",
  withdrawn: "cancelled",
};
const isStatus = (v: string): v is QuoteStatus => (QUOTE_STATUSES as readonly string[]).includes(v);
/** A derived-expired sent quote reads "Expired"; the stored status stays sent (no Expired status exists). */
export function quoteStatusLabel(status: string, isExpired: boolean): string {
  if (status === "sent" && isExpired) return "Expired";
  return isStatus(status) ? STATUS_LABELS[status] : status;
}
export function quoteStatusTone(status: string, isExpired: boolean): Tone {
  if (status === "sent" && isExpired) return "warning";
  return isStatus(status) ? STATUS_TONES[status] : "neutral";
}
/**
 * The stored per-organization number, shown plainly. The display format is OPEN (OD-Q10), so no prefix, padding or
 * year is invented here.
 */
export const quoteReference = (kind: string, quoteNumber: number) => `${quoteKindLabel(kind)} ${quoteNumber}`;

// ---------------------------------------------------------------------------------------------------------------------
// Money: exact decimal text <-> integer cents
// ---------------------------------------------------------------------------------------------------------------------

/** "1,234.5" / "$75" / "75.00" / "" -> cents. Two decimals at most; commas only as thousands separators. */
const MONEY_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
export type MoneyParse = { ok: true; cents: number } | { ok: false; error: string };

export function parseMoneyToCents(raw: string, opts: { max?: number } = {}): MoneyParse {
  const max = opts.max ?? QUOTE_LIMITS.maxLineCents;
  let s = (raw ?? "").trim();
  if (s.startsWith("$")) s = s.slice(1).trim();
  if (s === "") return { ok: true, cents: 0 };
  if (s.startsWith("-")) return { ok: false, error: "Enter an amount of $0.00 or more." };
  if (s.startsWith(".")) s = `0${s}`;
  const m = MONEY_RE.exec(s);
  if (!m) return { ok: false, error: "Enter an amount like 75 or 75.00 (at most two decimal places)." };
  const [wholeText, fracText = ""] = s.replace(/,/g, "").split(".");
  const whole = wholeText.replace(/^0+(?=\d)/, "");
  // more digits than the largest allowed amount: refuse before any Number conversion
  if (whole.length > String(Math.floor(max / 100)).length) return { ok: false, error: `Enter ${formatCents(max)} or less.` };
  const cents = Number(whole) * 100 + Number(fracText.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > max) return { ok: false, error: `Enter ${formatCents(max)} or less.` };
  return { ok: true, cents };
}

/** Integer cents -> "$1,234.50" (always two decimals). Pure integer arithmetic for the digits. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) return "";
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "−" : ""}$${dollars}.${rest}`;
}

/** Cents -> the text a person edits ("75.00"; "" for 0 so empty optional lines stay empty). */
export function centsToInput(cents: number): string {
  if (!cents) return "";
  return `${Math.floor(cents / 100)}.${(cents % 100).toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------------------------------------

/** The fixed charge columns (ZD-214), in display order. */
export const CHARGE_FIELDS = [
  { key: "base", label: "Base transportation" },
  { key: "mileage", label: "Mileage charge" },
  { key: "wait", label: "Waiting time" },
  { key: "extraStops", label: "Additional stops" },
  { key: "mobilityAssistance", label: "Mobility assistance" },
  { key: "escort", label: "Escort / attendant" },
  { key: "returnLeg", label: "Return leg" },
  { key: "other", label: "Other charge" },
] as const;
export type ChargeKey = (typeof CHARGE_FIELDS)[number]["key"];

export interface QuoteFormValues {
  kind: string;
  serviceType: string;
  roundTrip: string;
  distanceMiles: string;
  base: string;
  mileage: string;
  wait: string;
  extraStops: string;
  mobilityAssistance: string;
  escort: string;
  returnLeg: string;
  other: string;
  otherLabel: string;
  discount: string;
  validUntil: string;
  termsNote: string;
}
export type QuoteFieldErrors = Partial<Record<keyof QuoteFormValues, string>>;

export interface QuoteInput {
  kind: QuoteKind;
  serviceType: QuoteServiceType | null;
  roundTrip: boolean;
  /** one decimal at most, as exact text for the numeric(7,1) column */
  distanceMiles: number | null;
  charges: Record<ChargeKey, number>;
  otherLabel: string | null;
  discountCents: number;
  validUntil: string;
  termsNote: string | null;
}

export interface QuoteTotals {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MILES_RE = /^\d{1,5}(?:\.\d)?$/;
const KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;

/** A real calendar date (rejects 2026-02-30). */
export function isDateKey(raw: string): boolean {
  if (!DATE_RE.test(raw)) return false;
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function emptyQuoteForm(serviceType: string | null): QuoteFormValues {
  return {
    kind: "estimate",
    // the opportunity's own service is only a suggestion; staff may change it within the eight Plus services
    serviceType: serviceType && (QUOTE_SERVICE_TYPES as readonly string[]).includes(serviceType) ? serviceType : "",
    roundTrip: "no",
    distanceMiles: "",
    base: "",
    mileage: "",
    wait: "",
    extraStops: "",
    mobilityAssistance: "",
    escort: "",
    returnLeg: "",
    other: "",
    otherLabel: "",
    discount: "",
    // OD-Q10 is open: no default validity -- staff choose the date
    validUntil: "",
    termsNote: "",
  };
}

/** Totals over already-parsed cents (integers only). */
export function quoteTotals(charges: Record<ChargeKey, number>, discountCents: number): QuoteTotals {
  const subtotalCents = CHARGE_FIELDS.reduce((sum, f) => sum + charges[f.key], 0);
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}

/**
 * Validates the whole form (the same rules on the client preview and in the server action; the database re-checks).
 * `today` is the organization-local date (YYYY-MM-DD).
 */
export function validateQuoteForm(values: QuoteFormValues, today: string): { ok: true; value: QuoteInput; totals: QuoteTotals } | { ok: false; errors: QuoteFieldErrors; totals: QuoteTotals | null } {
  const errors: QuoteFieldErrors = {};
  if (values.kind !== "estimate" && values.kind !== "quote") errors.kind = "Choose Estimate or Quote.";
  const service = values.serviceType.trim() === "" ? null : values.serviceType;
  if (service !== null && !(QUOTE_SERVICE_TYPES as readonly string[]).includes(service)) errors.serviceType = "Choose a service from the list, or Not specified.";
  if (values.roundTrip !== "yes" && values.roundTrip !== "no") errors.roundTrip = "Say whether this is a round trip.";
  const milesText = values.distanceMiles.trim();
  let miles: number | null = null;
  if (milesText !== "") {
    if (!MILES_RE.test(milesText) || Number(milesText) > QUOTE_LIMITS.maxMiles) errors.distanceMiles = "Enter miles like 12 or 12.5 (one decimal place at most).";
    else miles = Number(milesText);
  }
  const charges = {} as Record<ChargeKey, number>;
  let chargesOk = true;
  for (const f of CHARGE_FIELDS) {
    const r = parseMoneyToCents(values[f.key]);
    if (r.ok) charges[f.key] = r.cents;
    else {
      errors[f.key] = r.error;
      chargesOk = false;
      charges[f.key] = 0;
    }
  }
  const label = values.otherLabel.trim();
  if (chargesOk && charges.other > 0 && !label) errors.otherLabel = "Describe the other charge.";
  if (label && charges.other === 0 && !errors.other) errors.otherLabel = "Remove the description, or enter the other charge.";
  if (label.length > QUOTE_LIMITS.otherLabel) errors.otherLabel = `Use ${QUOTE_LIMITS.otherLabel} characters or fewer.`;
  const d = parseMoneyToCents(values.discount);
  let discount = 0;
  if (!d.ok) errors.discount = d.error;
  else discount = d.cents;
  const totals = chargesOk && d.ok ? quoteTotals(charges, discount) : null;
  if (totals && discount > totals.subtotalCents) errors.discount = "The discount can't be more than the charges.";
  const valid = values.validUntil.trim();
  if (!valid) errors.validUntil = "Choose the date this price is valid until.";
  else if (!isDateKey(valid)) errors.validUntil = "Choose a valid date.";
  else if (valid < today) errors.validUntil = "Choose today or a later date.";
  const terms = values.termsNote.trim();
  if (terms.length > QUOTE_LIMITS.terms) errors.termsNote = `Use ${QUOTE_LIMITS.terms} characters or fewer.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors, totals: totals && discount <= totals.subtotalCents ? totals : null };
  return {
    ok: true,
    totals: totals as QuoteTotals,
    value: {
      kind: values.kind as QuoteKind,
      serviceType: service as QuoteServiceType | null,
      roundTrip: values.roundTrip === "yes",
      distanceMiles: miles,
      charges,
      otherLabel: label || null,
      discountCents: discount,
      validUntil: valid,
      termsNote: terms || null,
    },
  };
}

/** The idempotency key carried by one create (retries reuse it). Not proof of anything: the database re-checks. */
export function isQuoteKey(raw: unknown): raw is string {
  return typeof raw === "string" && KEY_RE.test(raw);
}

// ---------------------------------------------------------------------------------------------------------------------
// Panel grouping (OD-Q12: one active draft, one current sent, everything else history)
// ---------------------------------------------------------------------------------------------------------------------

export interface QuoteSummaryLike {
  id: string;
  status: string;
  createdAt: string;
}
export function groupQuotes<T extends QuoteSummaryLike>(rows: T[]): { draft: T | null; sent: T | null; history: T[] } {
  const draft = rows.find((r) => r.status === "draft") ?? null;
  const sent = rows.find((r) => r.status === "sent") ?? null;
  const history = rows.filter((r) => r !== draft && r !== sent).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { draft, sent, history };
}

// ---------------------------------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------------------------------

export const QUOTE_NOT_INVOICE_NOTE =
  "Estimates and quotes are prices your team gives the customer. They are not invoices, and Nemryn doesn't send them or take payment.";
export const QUOTE_PRIVACY_HELP = "Commercial terms only. Don't include addresses, appointment details or medical information.";
export const QUOTE_SENT_CURRENT_NOTE =
  "A sent quote is current for this opportunity. To change its price, it will be revised from the quote itself in a later update; a separate new draft is not created here.";

/**
 * Plain-words error copy for the draft actions. `reason` is the database exception message (it distinguishes refusals
 * sharing a code). Never shows SQL or constraint text.
 */
export function quoteErrorMessage(code: string | undefined, reason?: string): string {
  switch (code) {
    case "ZW003":
      return "Someone else changed this draft since you opened it. Reload to see the latest version, then make your changes again.";
    case "ZW004":
      if (reason === "draft_exists") return "This opportunity already has a draft. Reload the page to open it.";
      if (reason === "quote_not_draft") return "This quote is no longer a draft, so it can't be edited. Reload the page to see it.";
      if (reason === "opportunity_closed") return "This opportunity is closed, so its quotes can't be changed.";
      if (reason === "illegal_transition") return "This quote can't be changed that way any more. Reload the page to see its current status.";
      return "This quote can't be changed right now. Reload the page to see its current status.";
    case "ZW006":
      if (reason === "contact_not_active") return "The contact is archived, so a new draft can't be created.";
      return "Check the highlighted fields and try again.";
    case "ZW001":
      return "You can view quotes but can't change them. Ask an Organization Admin for write access.";
    case "ZW002":
      return "This quote isn't available, or you don't have permission to change it.";
    default:
      // (after a timeout the first attempt may have succeeded: a retry with the same key returns it, never a duplicate)
      return "The draft couldn't be confirmed. It's safe to try again -- it will never be created twice.";
  }
}
