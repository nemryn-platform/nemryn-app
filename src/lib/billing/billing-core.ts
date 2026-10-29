/**
 * Core private-pay billing rules (NP-BILL-P1). Runtime-import free (unit-tested under plain Node: billing-core.test.mjs).
 * The database is authoritative (billing_* RPCs: totals, numbering, balances, eligibility, immutability); this module
 * only parses, labels, previews and explains. Money is always integer cents, USD only (D6).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------------------------------
export const MAX_LINE_UNIT_CENTS = 10_000_000_00; // $10,000,000.00 (database: unit_cents <= 1e10)
export const MAX_PAYMENT_CENTS = 1_000_000_000_00;

export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) return "";
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "−" : ""}$${dollars}.${rest}`;
}

/** Plain decimal text for an input's default value: 4500 -> "45.00". */
export const centsToInput = (cents: number) => (Number.isSafeInteger(cents) ? (cents / 100).toFixed(2) : "");

const MONEY_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
export type MoneyParse = { ok: true; cents: number } | { ok: false; error: string };

/** "1,234.5" / "$75" / "75.00" -> cents, exactly (no floating point). Empty -> 0. */
export function parseMoneyToCents(raw: string, max = MAX_LINE_UNIT_CENTS): MoneyParse {
  let s = (raw ?? "").trim();
  if (s.startsWith("$")) s = s.slice(1).trim();
  if (s === "") return { ok: true, cents: 0 };
  if (s.startsWith("-")) return { ok: false, error: "Enter an amount of $0.00 or more." };
  if (s.startsWith(".")) s = `0${s}`;
  if (!MONEY_RE.test(s)) return { ok: false, error: "Enter an amount like 75 or 75.00 (at most two decimal places)." };
  const [wholeText, fracText = ""] = s.replace(/,/g, "").split(".");
  const whole = wholeText.replace(/^0+(?=\d)/, "");
  if (whole.length > String(Math.floor(max / 100)).length) return { ok: false, error: `Enter ${formatCents(max)} or less.` };
  const cents = Number(whole) * 100 + Number(fracText.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > max) return { ok: false, error: `Enter ${formatCents(max)} or less.` };
  return { ok: true, cents };
}

/** Quantity with at most two decimals, 0 < q <= 99999.99 (database numeric(10,2)). Returns hundredths. */
export function parseQuantity(raw: string): { ok: true; hundredths: number } | { ok: false; error: string } {
  const s = (raw ?? "").trim() || "1";
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(s)) return { ok: false, error: "Enter a quantity like 1 or 12.5." };
  const [w, f = ""] = s.split(".");
  const hundredths = Number(w) * 100 + Number(f.padEnd(2, "0"));
  if (hundredths <= 0) return { ok: false, error: "Enter a quantity above 0." };
  return { ok: true, hundredths };
}

/** amount = round(quantity x unit) in cents -- the same half-away-from-zero rounding as Postgres numeric round(). */
export function lineAmountCents(quantityHundredths: number, unitCents: number): number {
  const product = quantityHundredths * unitCents; // exact: both are integers well below 2^53
  return Math.floor((product + 50) / 100);
}

export function previewTotals(lines: { amountCents: number }[], discountCents: number) {
  const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
  return { subtotal, discount: discountCents, total: subtotal - discountCents, discountTooHigh: discountCents > subtotal };
}

// ---------------------------------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------------------------------
/** Display format chosen for NP-BILL-P1 (D4): INV- + at least six digits. */
export const invoiceNumberLabel = (n: number | null) => (n === null ? "Draft" : `INV-${String(n).padStart(6, "0")}`);
/** NP-FIN-P1 (ZD-266, OD-4): customer-facing receipt numbers, per organization -- RCPT-000123. */
export const receiptNumberLabel = (n: number) => `RCPT-${String(n).padStart(6, "0")}`;

export type PaymentState = "draft" | "unpaid" | "partially_paid" | "paid" | "void";
const STATE_LABELS: Record<PaymentState, string> = { draft: "Draft", unpaid: "Unpaid", partially_paid: "Partially paid", paid: "Paid", void: "Void" };
const STATE_TONES: Record<PaymentState, "neutral" | "informational" | "warning" | "positive" | "cancelled"> = {
  draft: "neutral",
  unpaid: "informational",
  partially_paid: "warning",
  paid: "positive",
  void: "cancelled",
};
const isState = (v: string): v is PaymentState => v in STATE_LABELS;
export const paymentStateLabel = (s: string) => (isState(s) ? STATE_LABELS[s] : s);
export const paymentStateTone = (s: string) => (isState(s) ? STATE_TONES[s] : "neutral");

/** NP-BILL-P1 method values (accepted by the billing_record_payment compatibility wrapper). */
export const PAYMENT_METHODS = ["cash", "check", "card_external", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** NP-FIN-P1 receipt / refund methods (database CHECK). Money is received outside Nemryn; Nemryn never charges cards. */
export const RECEIPT_METHODS = ["cash", "check", "card", "ach", "bank_transfer", "wire", "digital_wallet", "other"] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];
const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card (outside terminal)",
  card_external: "Card (outside terminal)",
  ach: "ACH",
  bank_transfer: "Bank transfer",
  wire: "Wire",
  digital_wallet: "Digital wallet",
  other: "Other",
};
export const PAYMENT_METHOD_LABELS = METHOD_LABELS as Record<PaymentMethod | ReceiptMethod, string>;
export const paymentMethodLabel = (m: string | null) => (m && m in METHOD_LABELS ? METHOD_LABELS[m] : "—");

export const RECEIPT_PROVIDERS = ["stripe", "square", "paypal", "zelle", "venmo", "bank", "other"] as const;
export type ReceiptProvider = (typeof RECEIPT_PROVIDERS)[number];
const PROVIDER_LABELS: Record<ReceiptProvider, string> = {
  stripe: "Stripe",
  square: "Square",
  paypal: "PayPal",
  zelle: "Zelle",
  venmo: "Venmo",
  bank: "Bank",
  other: "Other",
};
export const providerLabel = (p: string | null) => (p && p in PROVIDER_LABELS ? PROVIDER_LABELS[p as ReceiptProvider] : null);

/**
 * ZD-270: four separate assurance facts. Staff can record evidence only; "Provider confirmed" and "Reconciled" come
 * exclusively from a provider integration / approved statement match (FIN-P5 / P6) -- never from a typed reference.
 */
export type AssuranceLevel = "recorded" | "evidence_reference_noted" | "evidence_document_held" | "provider_confirmed" | "reconciled";
const ASSURANCE_LABELS: Record<AssuranceLevel, string> = {
  recorded: "Recorded by staff",
  evidence_reference_noted: "Reference noted",
  evidence_document_held: "Document held",
  provider_confirmed: "Provider confirmed",
  reconciled: "Reconciled",
};
const ASSURANCE_TONES: Record<AssuranceLevel, "neutral" | "informational" | "positive"> = {
  recorded: "neutral",
  evidence_reference_noted: "informational",
  evidence_document_held: "informational",
  provider_confirmed: "positive",
  reconciled: "positive",
};
const isAssurance = (v: string): v is AssuranceLevel => v in ASSURANCE_LABELS;
export const assuranceLabel = (a: string) => (isAssurance(a) ? ASSURANCE_LABELS[a] : "Recorded by staff");
export const assuranceTone = (a: string) => (isAssurance(a) ? ASSURANCE_TONES[a] : "neutral");
export const ASSURANCE_EXPLANATION =
  "Recorded by staff. A reference or document is evidence you keep; it isn't confirmation from a payment provider or your bank.";

/** Receipt state, derived exactly like the database (never stored). */
export type ReceiptState = "reversed" | "refunded" | "fully_allocated" | "partially_allocated" | "unallocated";
export function receiptState(r: { grossCents: number; allocatedCents: number; refundedCents: number; reversed: boolean }): ReceiptState {
  if (r.reversed) return "reversed";
  if (r.refundedCents >= r.grossCents) return "refunded";
  const unallocated = r.grossCents - r.allocatedCents - r.refundedCents;
  if (unallocated <= 0) return "fully_allocated";
  return r.allocatedCents > 0 || r.refundedCents > 0 ? "partially_allocated" : "unallocated";
}
const RECEIPT_STATE_LABELS: Record<ReceiptState, string> = {
  reversed: "Reversed",
  refunded: "Refunded",
  fully_allocated: "Applied",
  partially_allocated: "Credit left",
  unallocated: "Credit",
};
const RECEIPT_STATE_TONES: Record<ReceiptState, "neutral" | "informational" | "warning" | "positive" | "cancelled"> = {
  reversed: "cancelled",
  refunded: "neutral",
  fully_allocated: "positive",
  partially_allocated: "warning",
  unallocated: "informational",
};
export const receiptStateLabel = (s: ReceiptState) => RECEIPT_STATE_LABELS[s];
export const receiptStateTone = (s: ReceiptState) => RECEIPT_STATE_TONES[s];

export const REVERSAL_REASON_CODES = ["entry_error", "returned_check", "duplicate", "other"] as const;
export type ReversalReasonCode = (typeof REVERSAL_REASON_CODES)[number];
export const REVERSAL_REASON_LABELS: Record<ReversalReasonCode, string> = {
  entry_error: "Entered by mistake",
  returned_check: "Returned (bounced) check",
  duplicate: "Duplicate entry",
  other: "Other",
};

/**
 * Oldest-first allocation suggestion (ZD-269): fills the payer's own open invoices in the given order (oldest first)
 * and never exceeds a balance; whatever is left stays as payer credit. Invoices of other / unverified payers are never
 * suggested -- applying money to them is an explicit Organization Admin decision with a reason.
 */
export function suggestAllocations(amountCents: number, invoices: { id: string; balanceCents: number; samePayer: boolean }[]): { allocations: { id: string; cents: number }[]; creditCents: number } {
  let left = Number.isSafeInteger(amountCents) && amountCents > 0 ? amountCents : 0;
  const allocations: { id: string; cents: number }[] = [];
  for (const inv of invoices) {
    if (left <= 0) break;
    if (!inv.samePayer || inv.balanceCents <= 0) continue;
    const cents = Math.min(left, inv.balanceCents);
    allocations.push({ id: inv.id, cents });
    left -= cents;
  }
  return { allocations, creditCents: left };
}

/**
 * Mirrors the database's _billing_looks_like_pan: a 13-19 digit run (single spaces / dashes allowed between digits) that
 * passes the Luhn check looks like a payment card number and must never be stored.
 */
export function looksLikeCardNumber(text: string): boolean {
  const joined = (text ?? "").replace(/(\d)[ -](?=\d)/g, "$1");
  for (const run of joined.match(/\d+/g) ?? []) {
    if (run.length < 13 || run.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < run.length; i++) {
      let d = Number(run[run.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}
export const CARD_NUMBER_WARNING = "Don't enter card numbers. Use the last 4 digits or the terminal's transaction reference.";

export const BILL_TO_KINDS = ["passenger", "requester", "facility", "other"] as const;
export type BillToKind = (typeof BILL_TO_KINDS)[number];
export const BILL_TO_KIND_LABELS: Record<BillToKind, string> = {
  passenger: "Passenger",
  requester: "Person who requested the ride",
  facility: "Facility",
  other: "Someone else",
};

export const INVOICE_FILTERS = ["all", "open", "overdue", "draft", "paid", "void"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];
export const INVOICE_FILTER_LABELS: Record<InvoiceFilter, string> = {
  all: "All",
  open: "Open",
  overdue: "Overdue",
  draft: "Drafts",
  paid: "Paid",
  void: "Void",
};
export const RECEIPT_FILTERS = ["all", "credit", "reversed"] as const;
export type ReceiptFilter = (typeof RECEIPT_FILTERS)[number];
export const RECEIPT_FILTER_LABELS: Record<ReceiptFilter, string> = { all: "All", credit: "With credit", reversed: "Reversed" };
export const BILLING_PAGE_SIZE = 25;

export type BillingView = "ready" | "invoices" | "receipts";
export interface BillingParams {
  view: BillingView;
  filter: InvoiceFilter;
  receiptFilter: ReceiptFilter;
  search: string;
  page: number;
}
/** Billing page URL state (bounded; unknown values fall back). */
export function parseBillingParams(raw: Record<string, string | string[] | undefined>): BillingParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const view: BillingView = one(raw.view) === "invoices" ? "invoices" : one(raw.view) === "receipts" ? "receipts" : "ready";
  const filter = (INVOICE_FILTERS as readonly string[]).includes(one(raw.filter)) ? (one(raw.filter) as InvoiceFilter) : "all";
  const receiptFilter = (RECEIPT_FILTERS as readonly string[]).includes(one(raw.rfilter)) ? (one(raw.rfilter) as ReceiptFilter) : "all";
  const search = one(raw.q).trim().slice(0, 100);
  const page = Math.min(Math.max(1, Number.parseInt(one(raw.page), 10) || 1), 4000);
  return { view, filter, receiptFilter, search, page };
}
export function billingHref(p: BillingParams, over: Partial<BillingParams> = {}): string {
  const v = { ...p, ...over };
  const qs = new URLSearchParams();
  if (v.view !== "ready") qs.set("view", v.view);
  if (v.view === "invoices" && v.filter !== "all") qs.set("filter", v.filter);
  if (v.view === "receipts" && v.receiptFilter !== "all") qs.set("rfilter", v.receiptFilter);
  if (v.view !== "ready" && v.search) qs.set("q", v.search);
  if (v.page > 1) qs.set("page", String(v.page));
  const s = qs.toString();
  return `/operations/billing${s ? `?${s}` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------------------------
/** "YYYY-MM-DD" + n days (calendar arithmetic, timezone-free). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
export const DEFAULT_TERMS_DAYS = 15; // D6
export const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export function formatIsoDate(isoDate: string | null): string {
  if (!isoDate || !isIsoDate(isoDate)) return "—";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Errors (never the raw code or database message)
// ---------------------------------------------------------------------------------------------------------------------
const RULE_MESSAGES: Record<string, string> = {
  trip_already_invoiced: "One of these trips is already on another invoice. Void that invoice first, or choose other trips.",
  trip_not_completed: "Only completed trips can be invoiced.",
  mixed_customers: "All trips on one invoice must be for the same passenger.",
  bill_to_not_linked: "That bill-to choice isn't linked to every selected trip. A requester can pay only for trips they requested, and a facility only for trips that use it. Choose the passenger, a matching requester or facility, or someone else.",
  bill_to_name_required: "Enter who the invoice is for.",
  quote_not_linked: "That quote isn't linked to these trips' request. Leave the quote out or choose another one.",
  quote_not_billable: "Only a sent or accepted quote can be used.",
  quote_unavailable: "That quote isn't available. Nemryn Plus may not be active; you can invoice without a quote.",
  invoice_total_required: "Add at least one charge before issuing; the total must be above $0.00.",
  discount_exceeds_subtotal: "The discount can't be more than the subtotal.",
  line_trip_not_on_invoice: "A charge refers to a trip that isn't on this invoice.",
  invalid_line: "Check the charges: each needs a description, a quantity above 0 and a price.",
  invalid_dates: "Check the dates: the issue date can't be in the future and the due date can't be before it.",
  amount_exceeds_balance: "That's more than the balance due. Payments can't exceed the balance.",
  invalid_amount: "Enter an amount above $0.00.",
  invoice_has_payments: "This invoice has payments applied. Reverse or unapply them before voiding.",
  amount_exceeds_receipt: "That's more than this payment has left to apply.",
  refund_exceeds_refundable: "That's more than can be refunded. Only money that isn't applied to an invoice can be refunded; unapply it first.",
  receipt_reversed: "This payment was reversed, so it can't be applied or refunded.",
  receipt_has_allocations: "This payment is still applied to an invoice. Unapply it first.",
  receipt_has_refunds: "This payment has a recorded refund. Reverse the refund first.",
  already_unapplied: "That payment was already removed from the invoice.",
  different_payer_confirmation_required: "That invoice belongs to a different or unverified payer. Confirm and give a reason to apply this money to it.",
  possible_duplicate: "A payment with the same method, reference, amount and date is already recorded. Check it isn't a duplicate, then confirm.",
  looks_like_card_number: "That looks like a card number. Don't enter card numbers; use the last 4 digits or a transaction reference.",
  invalid_fee: "The processing fee can't be more than the amount received.",
  invalid_allocations: "Check the amounts to apply: one line per invoice, each above $0.00.",
  use_receipt_page: "This payment is applied to more than one invoice or was partly refunded. Correct it on its payment page.",
  cross_organization: "That isn't available in this workspace.",
  payer_name_required: "Enter who paid.",
  invalid_payer: "Choose who paid.",
  invalid_method: "Choose how it was paid.",
  invalid_reference: "Use at most 100 characters for the reference.",
  invalid_note: "Use at most 500 characters for the note.",
  invalid_input: "Some information wasn't accepted. Check the values and try again.",
  invoice_not_open: "Payments can only be recorded on an issued invoice that isn't void.",
  already_reversed: "This has already been reversed.",
  reason_required: "Enter a reason (at least 3 characters).",
  invoice_immutable: "Issued invoices can't be changed. Void it and create a new one if something is wrong.",
  illegal_transition: "That isn't possible in the invoice's current state. Reload the page.",
  invalid_trip_selection: "Choose between 1 and 31 completed trips.",
  invalid_idempotency_key: "Something went wrong. Reload the page and try again.",
};
export function billingErrorMessage(code: string | undefined, message?: string): string {
  const rule = message?.match(/^[a-z_]+$/)?.[0] ?? message?.trim();
  if (rule && RULE_MESSAGES[rule]) return RULE_MESSAGES[rule];
  switch (code) {
    case "ZW001": return "Your session has ended. Sign in again.";
    case "ZW002": return "This isn't available. It may belong to another workspace, or you may not have billing access.";
    case "ZW003": return "Someone else changed this just now. Reload the page to see the latest version.";
    case "ZW004": return "That isn't possible in the invoice's current state. Reload the page.";
    case "ZW006": return "Some information wasn't accepted. Check the values and try again.";
    default: return "Something went wrong. Nothing was changed; please try again.";
  }
}

/** An instant (timestamptz) as a calendar date in the organization's timezone, e.g. "Oct 26, 2026". */
export function formatInstantDate(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(d);
}
/** Today's date in the organization's timezone as "YYYY-MM-DD". */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).format(now);
}
