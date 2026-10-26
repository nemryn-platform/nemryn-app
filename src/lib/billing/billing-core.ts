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
export const receiptNumberLabel = (invoiceNumber: number | null, sequence: number) => `${invoiceNumberLabel(invoiceNumber)}-R${sequence}`;

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

export const PAYMENT_METHODS = ["cash", "check", "card_external", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  card_external: "Card (outside terminal)",
  bank_transfer: "Bank transfer / ACH",
  other: "Other",
};
export const paymentMethodLabel = (m: string | null) => (m && m in PAYMENT_METHOD_LABELS ? PAYMENT_METHOD_LABELS[m as PaymentMethod] : "—");

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
export const BILLING_PAGE_SIZE = 25;

/** Billing page URL state (bounded; unknown values fall back). */
export function parseBillingParams(raw: Record<string, string | string[] | undefined>): { view: "ready" | "invoices"; filter: InvoiceFilter; search: string; page: number } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const view = one(raw.view) === "invoices" ? "invoices" : "ready";
  const filter = (INVOICE_FILTERS as readonly string[]).includes(one(raw.filter)) ? (one(raw.filter) as InvoiceFilter) : "all";
  const search = one(raw.q).trim().slice(0, 100);
  const page = Math.min(Math.max(1, Number.parseInt(one(raw.page), 10) || 1), 4000);
  return { view, filter, search, page };
}
export function billingHref(p: { view: "ready" | "invoices"; filter: InvoiceFilter; search: string; page: number }, over: Partial<{ view: "ready" | "invoices"; filter: InvoiceFilter; search: string; page: number }> = {}): string {
  const v = { ...p, ...over };
  const qs = new URLSearchParams();
  if (v.view !== "ready") qs.set("view", v.view);
  if (v.view === "invoices" && v.filter !== "all") qs.set("filter", v.filter);
  if (v.view === "invoices" && v.search) qs.set("q", v.search);
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
  invoice_has_payments: "This invoice has payments. Reverse them before voiding.",
  invoice_not_open: "Payments can only be recorded on an issued invoice that isn't void.",
  already_reversed: "This payment has already been reversed.",
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
    case "ZW003": return "Someone else changed this invoice just now. Reload the page to see the latest version.";
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
