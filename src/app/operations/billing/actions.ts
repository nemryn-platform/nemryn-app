"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import {
  BILL_TO_KINDS,
  CARD_NUMBER_WARNING,
  MAX_PAYMENT_CENTS,
  RECEIPT_METHODS,
  RECEIPT_PROVIDERS,
  REVERSAL_REASON_CODES,
  billingErrorMessage,
  formatCents,
  isIsoDate,
  looksLikeCardNumber,
  parseMoneyToCents,
  parseQuantity,
  receiptNumberLabel,
  type BillToKind,
} from "@/lib/billing/billing-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const PAGE = "/operations/billing";
const WRONG_ORGANIZATION = "You switched to a different organization since this page was loaded. Reload the page before making changes.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9._:-]{8,100}$/;

export interface BillingActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** the database rule that refused the action (e.g. possible_duplicate), so a dialog can offer the right next step */
  rule?: string;
}

const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

/**
 * Organization Admin only (D2), re-derived on every call, and the form must have been rendered for the CURRENT session
 * workspace. The billing RPCs re-check the role, organization, version and state; nothing here is trusted by them.
 */
async function guard(formData: FormData) {
  const organization = await requireOrganizationAdminAccess(await getCurrentPathname(PAGE));
  if (text(formData, "organizationId") !== organization.organizationId) return { error: WRONG_ORGANIZATION } as const;
  return { organization } as const;
}
const fail = (code: string | undefined, message?: string): BillingActionState => {
  // R4: the code only -- never names, addresses, amounts' context, references or notes
  console.error("[billing] action refused", code ?? "unknown");
  const rule = message?.match(/^[a-z_]+$/)?.[0];
  return { status: "error", message: billingErrorMessage(code, message), ...(rule ? { rule } : {}) };
};
const intOf = (v: string) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
};
const invoicePath = (id: string) => `${PAGE}/invoices/${id}`;
const refresh = (id?: string) => {
  revalidatePath(PAGE);
  if (id) revalidatePath(invoicePath(id));
  revalidatePath("/operations/trips", "layout");
};

// ---------------------------------------------------------------------------------------------------------------------
// Create a draft (Completed trip(s) -> draft)
// ---------------------------------------------------------------------------------------------------------------------
export async function createInvoiceDraftAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const tripIds = formData.getAll("tripId").filter((v): v is string => typeof v === "string" && UUID_RE.test(v));
  if (tripIds.length === 0) return { status: "error", message: "Choose at least one completed trip.", fieldErrors: { tripId: "Choose at least one trip." } };
  const [kind, billToId = ""] = text(formData, "billTo").split(":");
  if (!(BILL_TO_KINDS as readonly string[]).includes(kind)) return { status: "error", message: "Choose who the invoice is for.", fieldErrors: { billTo: "Choose who the invoice is for." } };
  const billToName = text(formData, "billToName").trim();
  if (kind === "other" && (billToName.length < 1 || billToName.length > 200)) {
    return { status: "error", message: "Enter who the invoice is for.", fieldErrors: { billToName: "Enter a name (up to 200 characters)." } };
  }
  if (kind !== "other" && !UUID_RE.test(billToId)) return { status: "error", message: "Choose who the invoice is for." };
  const quoteId = text(formData, "quoteId");
  const key = text(formData, "idempotencyKey");
  if (!KEY_RE.test(key) || (quoteId && !UUID_RE.test(quoteId))) return fail("ZW006");

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_create_invoice_draft", {
    p_organization_id: g.organization.organizationId,
    p_trip_ids: tripIds,
    p_bill_to_kind: kind as BillToKind,
    p_bill_to_id: (kind === "other" ? null : billToId) as string,
    p_bill_to_name: (kind === "other" ? billToName : null) as string,
    p_source_quote_id: (quoteId || null) as string,
    p_idempotency_key: key,
  });
  if (error || !data?.invoice_id) return fail(error?.code, error?.message);
  refresh(data.invoice_id);
  redirect(`${invoicePath(data.invoice_id)}?created=1`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Edit / discard a draft
// ---------------------------------------------------------------------------------------------------------------------
interface LineInput {
  description: string;
  quantity: string;
  unitPrice: string;
  tripId: string | null;
  source: string;
}
export async function updateInvoiceDraftAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const invoiceId = text(formData, "invoiceId");
  const version = intOf(text(formData, "expectedVersion"));
  if (!UUID_RE.test(invoiceId) || version === null) return fail("ZW006");

  let raw: unknown;
  try {
    raw = JSON.parse(text(formData, "lines") || "[]");
  } catch {
    return fail("ZW006");
  }
  if (!Array.isArray(raw) || raw.length > 200) return fail("ZW006");
  const fieldErrors: Record<string, string> = {};
  const lines = (raw as LineInput[]).map((l, i) => {
    const description = typeof l?.description === "string" ? l.description.trim() : "";
    const q = parseQuantity(typeof l?.quantity === "string" ? l.quantity : "1");
    const unit = parseMoneyToCents(typeof l?.unitPrice === "string" ? l.unitPrice : "");
    if (description.length < 1 || description.length > 300) fieldErrors[`line-${i}`] = "Enter a description (up to 300 characters).";
    else if (!q.ok) fieldErrors[`line-${i}`] = q.error;
    else if (!unit.ok) fieldErrors[`line-${i}`] = unit.error;
    const tripId = typeof l?.tripId === "string" && UUID_RE.test(l.tripId) ? l.tripId : null;
    const source = l?.source === "trip" || l?.source === "quote" ? l.source : "manual";
    return {
      description,
      quantity: q.ok ? (q.hundredths / 100).toFixed(2) : "1",
      unit_cents: unit.ok ? unit.cents : 0,
      trip_id: tripId,
      source: source === "trip" && !tripId ? "manual" : source,
    };
  });
  const discount = parseMoneyToCents(text(formData, "discount"));
  if (!discount.ok) fieldErrors.discount = discount.error;
  const billToName = text(formData, "billToName").trim();
  if (billToName.length < 1 || billToName.length > 200) fieldErrors.billToName = "Enter who the invoice is for (up to 200 characters).";
  const address = text(formData, "billToAddress").trim();
  if (address.length > 500) fieldErrors.billToAddress = "Use at most 500 characters.";
  const email = text(formData, "billToEmail").trim();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) fieldErrors.billToEmail = "Enter a valid email address.";
  const phone = text(formData, "billToPhone").trim();
  if (phone.length > 40) fieldErrors.billToPhone = "Use at most 40 characters.";
  const terms = text(formData, "terms").trim();
  if (terms.length > 1000) fieldErrors.terms = "Use at most 1000 characters.";
  if (Object.keys(fieldErrors).length > 0) return { status: "error", message: "Check the highlighted fields.", fieldErrors };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("billing_update_invoice_draft", {
    p_organization_id: g.organization.organizationId,
    p_invoice_id: invoiceId,
    p_expected_version: version,
    p_bill_to_name: billToName,
    p_bill_to_address: (address || null) as string,
    p_bill_to_email: (email || null) as string,
    p_bill_to_phone: (phone || null) as string,
    p_lines: lines,
    p_discount_cents: discount.ok ? discount.cents : 0,
    p_terms_note: (terms || null) as string,
  });
  if (error) return fail(error.code, error.message);
  refresh(invoiceId);
  return { status: "success", message: "Draft saved." };
}

export async function discardInvoiceDraftAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const invoiceId = text(formData, "invoiceId");
  const version = intOf(text(formData, "expectedVersion"));
  if (!UUID_RE.test(invoiceId) || version === null) return fail("ZW006");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("billing_discard_invoice_draft", {
    p_organization_id: g.organization.organizationId,
    p_invoice_id: invoiceId,
    p_expected_version: version,
  });
  if (error) return fail(error.code, error.message);
  refresh();
  redirect(`${PAGE}?discarded=1`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Issue / void
// ---------------------------------------------------------------------------------------------------------------------
export async function issueInvoiceAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const invoiceId = text(formData, "invoiceId");
  const version = intOf(text(formData, "expectedVersion"));
  const issueDate = text(formData, "issueDate");
  const dueDate = text(formData, "dueDate");
  if (!UUID_RE.test(invoiceId) || version === null) return fail("ZW006");
  if (!isIsoDate(issueDate) || !isIsoDate(dueDate)) return { status: "error", message: billingErrorMessage("ZW006", "invalid_dates") };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_issue_invoice", {
    p_organization_id: g.organization.organizationId,
    p_invoice_id: invoiceId,
    p_expected_version: version,
    p_issue_date: issueDate,
    p_due_date: dueDate,
  });
  if (error || !data) return fail(error?.code, error?.message);
  refresh(invoiceId);
  return { status: "success", message: "Invoice issued. It can no longer be edited." };
}

export async function voidInvoiceAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const invoiceId = text(formData, "invoiceId");
  const version = intOf(text(formData, "expectedVersion"));
  const reason = text(formData, "reason").trim();
  if (!UUID_RE.test(invoiceId) || version === null) return fail("ZW006");
  if (reason.length < 3 || reason.length > 500) return { status: "error", message: billingErrorMessage("ZW006", "reason_required"), fieldErrors: { reason: "Enter a reason (3–500 characters)." } };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("billing_void_invoice", {
    p_organization_id: g.organization.organizationId,
    p_invoice_id: invoiceId,
    p_expected_version: version,
    p_reason: reason,
  });
  if (error) return fail(error.code, error.message);
  refresh(invoiceId);
  return { status: "success", message: "Invoice voided. Its number is kept and its trips can be invoiced again." };
}

// ---------------------------------------------------------------------------------------------------------------------
// Payments received (NP-FIN-P1 ledger: receipts + allocations; append-only). Nemryn records money received elsewhere;
// it never charges cards. Every write is idempotent (one key per opened dialog) and re-checked by the database.
// ---------------------------------------------------------------------------------------------------------------------
const receiptPath = (id: string) => `${PAGE}/receipts/${id}`;
const refreshReceipt = (receiptId?: string, invoiceIds: string[] = []) => {
  refresh();
  if (receiptId) revalidatePath(receiptPath(receiptId));
  for (const id of invoiceIds) revalidatePath(invoicePath(id));
};

/** Shared money-received fields (amount, fee, date, method, provider, reference, note, document). */
function receiptFields(formData: FormData) {
  const fieldErrors: Record<string, string> = {};
  const amount = parseMoneyToCents(text(formData, "amount"), MAX_PAYMENT_CENTS);
  if (!amount.ok) fieldErrors.amount = amount.error;
  else if (amount.cents <= 0) fieldErrors.amount = "Enter an amount above $0.00.";
  const fee = parseMoneyToCents(text(formData, "fee"), MAX_PAYMENT_CENTS);
  if (!fee.ok) fieldErrors.fee = fee.error;
  else if (amount.ok && fee.cents > amount.cents) fieldErrors.fee = "The fee can't be more than the amount received.";
  const receivedOn = text(formData, "receivedOn");
  if (!isIsoDate(receivedOn)) fieldErrors.receivedOn = "Enter the date the payment was received.";
  const method = text(formData, "method");
  if (!(RECEIPT_METHODS as readonly string[]).includes(method)) fieldErrors.method = "Choose how it was paid.";
  const provider = text(formData, "provider");
  if (provider && !(RECEIPT_PROVIDERS as readonly string[]).includes(provider)) fieldErrors.provider = "Choose a provider from the list.";
  const reference = text(formData, "reference").trim();
  if (reference.length > 100) fieldErrors.reference = "Use at most 100 characters.";
  else if (looksLikeCardNumber(reference)) fieldErrors.reference = CARD_NUMBER_WARNING;
  const note = text(formData, "note").trim();
  if (note.length > 500) fieldErrors.note = "Use at most 500 characters.";
  else if (looksLikeCardNumber(note)) fieldErrors.note = CARD_NUMBER_WARNING;
  return {
    fieldErrors,
    amountCents: amount.ok ? amount.cents : 0,
    feeCents: fee.ok ? fee.cents : 0,
    receivedOn,
    method,
    provider: provider || null,
    reference: reference || null,
    note: note || null,
    documentHeld: text(formData, "documentHeld") === "on",
  };
}
function parseAllocations(raw: string): { invoice_id: string; amount_cents: number; expected_version?: number }[] | null {
  let v: unknown;
  try {
    v = JSON.parse(raw || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(v) || v.length > 50) return null;
  const out: { invoice_id: string; amount_cents: number; expected_version?: number }[] = [];
  for (const a of v as { invoiceId?: unknown; cents?: unknown; version?: unknown }[]) {
    if (typeof a?.invoiceId !== "string" || !UUID_RE.test(a.invoiceId) || !Number.isSafeInteger(a.cents) || (a.cents as number) <= 0) return null;
    out.push({ invoice_id: a.invoiceId, amount_cents: a.cents as number, ...(Number.isInteger(a.version) ? { expected_version: a.version as number } : {}) });
  }
  return out;
}

/**
 * Record payment on an invoice: one receipt whose payer is the invoice's bill-to, applied to this invoice. Paying more
 * than the balance is refused (NP-BILL-P1 behaviour) unless the Admin explicitly keeps the extra as payer credit.
 */
export async function recordPaymentAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const invoiceId = text(formData, "invoiceId");
  const version = intOf(text(formData, "expectedVersion"));
  const balance = Number.parseInt(text(formData, "balanceCents"), 10);
  const key = text(formData, "idempotencyKey");
  if (!UUID_RE.test(invoiceId) || version === null || !KEY_RE.test(key) || !Number.isSafeInteger(balance)) return fail("ZW006");
  const f = receiptFields(formData);
  if (Object.keys(f.fieldErrors).length > 0) return { status: "error", message: "Check the highlighted fields.", fieldErrors: f.fieldErrors };
  const keepExtra = text(formData, "keepExtraAsCredit") === "on";
  // without the explicit choice the whole amount is applied, so the database refuses an overpayment (amount_exceeds_balance)
  const applied = keepExtra ? Math.min(f.amountCents, balance) : f.amountCents;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_record_receipt", {
    p_organization_id: g.organization.organizationId,
    p_source_invoice_id: invoiceId,
    p_payer_kind: null as unknown as string,
    p_payer_id: null as unknown as string,
    p_payer_name: null as unknown as string,
    p_gross_cents: f.amountCents,
    p_fee_cents: f.feeCents,
    p_received_on: f.receivedOn,
    p_method: f.method,
    p_provider: f.provider as string,
    p_reference: f.reference as string,
    p_note: f.note as string,
    p_document_held: f.documentHeld,
    p_allocations: applied > 0 ? [{ invoice_id: invoiceId, amount_cents: applied, expected_version: version }] : [],
    p_different_payer_reason: null as unknown as string,
    p_confirm_possible_duplicate: text(formData, "confirmDuplicate") === "on",
    p_idempotency_key: key,
  });
  if (error || !data) return fail(error?.code, error?.message);
  refreshReceipt(data.receipt_id ?? undefined, [invoiceId]);
  const credit = Number(data.unallocated_cents ?? 0);
  const paidInFull = applied >= balance;
  return {
    status: "success",
    message: credit > 0
      ? `Payment recorded. ${formatCents(credit)} is kept as payer credit on ${receiptNumberLabel(data.receipt_number ?? 0)}.`
      : paidInFull ? "Payment recorded. The invoice is paid in full." : "Payment recorded.",
  };
}

/** Record payment received that isn't tied to one invoice: choose the payer, apply to their invoices, keep the rest as credit. */
export async function recordReceiptAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const key = text(formData, "idempotencyKey");
  if (!KEY_RE.test(key)) return fail("ZW006");
  const f = receiptFields(formData);
  const [kind, payerId = ""] = text(formData, "payer").split(":");
  const payerName = text(formData, "payerName").trim();
  if (!["passenger", "requester", "facility", "other"].includes(kind)) f.fieldErrors.payer = "Choose who paid.";
  else if (kind === "other" && (payerName.length < 1 || payerName.length > 200)) f.fieldErrors.payerName = "Enter who paid (up to 200 characters).";
  else if (kind !== "other" && !UUID_RE.test(payerId)) f.fieldErrors.payer = "Choose who paid.";
  const allocations = parseAllocations(text(formData, "allocations"));
  if (allocations === null) f.fieldErrors.allocations = "Check the amounts to apply.";
  else if (allocations.reduce((s2, a) => s2 + a.amount_cents, 0) > f.amountCents) f.fieldErrors.allocations = "You're applying more than the amount received.";
  const reason = text(formData, "differentPayerReason").trim();
  if (Object.keys(f.fieldErrors).length > 0) return { status: "error", message: "Check the highlighted fields.", fieldErrors: f.fieldErrors };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_record_receipt", {
    p_organization_id: g.organization.organizationId,
    p_source_invoice_id: null as unknown as string,
    p_payer_kind: kind,
    p_payer_id: (kind === "other" ? null : payerId) as string,
    p_payer_name: (kind === "other" ? payerName : null) as string,
    p_gross_cents: f.amountCents,
    p_fee_cents: f.feeCents,
    p_received_on: f.receivedOn,
    p_method: f.method,
    p_provider: f.provider as string,
    p_reference: f.reference as string,
    p_note: f.note as string,
    p_document_held: f.documentHeld,
    p_allocations: allocations ?? [],
    p_different_payer_reason: (reason || null) as string,
    p_confirm_possible_duplicate: text(formData, "confirmDuplicate") === "on",
    p_idempotency_key: key,
  });
  if (error || !data?.receipt_id) return fail(error?.code, error?.message);
  refreshReceipt(data.receipt_id, (allocations ?? []).map((a) => a.invoice_id));
  redirect(`${receiptPath(data.receipt_id)}?recorded=1`);
}

/** Apply a receipt's payer credit to one or more invoices (other / unverified payers need an explicit reason). */
export async function allocateReceiptAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const receiptId = text(formData, "receiptId");
  const key = text(formData, "idempotencyKey");
  if (!UUID_RE.test(receiptId) || !KEY_RE.test(key)) return fail("ZW006");
  const allocations = parseAllocations(text(formData, "allocations"));
  if (!allocations || allocations.length === 0) return { status: "error", message: "Enter an amount for at least one invoice.", fieldErrors: { allocations: "Enter an amount for at least one invoice." } };
  const reason = text(formData, "differentPayerReason").trim();
  if (reason && looksLikeCardNumber(reason)) return { status: "error", message: CARD_NUMBER_WARNING, fieldErrors: { differentPayerReason: CARD_NUMBER_WARNING } };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_allocate_receipt", {
    p_organization_id: g.organization.organizationId,
    p_receipt_id: receiptId,
    p_allocations: allocations,
    p_different_payer_reason: (reason || null) as string,
    p_idempotency_key: key,
  });
  if (error || !data) return fail(error?.code, error?.message);
  refreshReceipt(receiptId, allocations.map((a) => a.invoice_id));
  const credit = Number(data.unallocated_cents ?? 0);
  return { status: "success", message: credit > 0 ? `Credit applied. ${formatCents(credit)} of credit is left on this payment.` : "Credit applied." };
}

const reasonOf = (formData: FormData) => text(formData, "reason").trim();
const reasonError = (reason: string): BillingActionState | null =>
  reason.length < 3 || reason.length > 500
    ? { status: "error", message: billingErrorMessage("ZW006", "reason_required"), fieldErrors: { reason: "Enter a reason (3–500 characters)." } }
    : looksLikeCardNumber(reason)
      ? { status: "error", message: CARD_NUMBER_WARNING, fieldErrors: { reason: CARD_NUMBER_WARNING } }
      : null;

/** SENSITIVE (Organization Admin): remove one applied payment from an invoice; the money becomes payer credit again. */
export async function unapplyAllocationAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const allocationId = text(formData, "allocationId");
  const invoiceId = text(formData, "invoiceId");
  const key = text(formData, "idempotencyKey");
  if (!UUID_RE.test(allocationId) || !UUID_RE.test(invoiceId) || !KEY_RE.test(key)) return fail("ZW006");
  const reason = reasonOf(formData);
  const bad = reasonError(reason);
  if (bad) return bad;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_unapply_allocation", {
    p_organization_id: g.organization.organizationId,
    p_allocation_id: allocationId,
    p_reason: reason,
    p_idempotency_key: key,
  });
  if (error || !data) return fail(error?.code, error?.message);
  refreshReceipt(data.receipt_id ?? undefined, [invoiceId]);
  return { status: "success", message: "Payment removed from the invoice. The money is kept as payer credit; nothing was refunded." };
}

/** SENSITIVE (Organization Admin): RECORD a refund the organization made from a payment's unapplied funds. */
export async function recordRefundAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const receiptId = text(formData, "receiptId");
  const key = text(formData, "idempotencyKey");
  if (!UUID_RE.test(receiptId) || !KEY_RE.test(key)) return fail("ZW006");
  const fieldErrors: Record<string, string> = {};
  const amount = parseMoneyToCents(text(formData, "amount"), MAX_PAYMENT_CENTS);
  if (!amount.ok) fieldErrors.amount = amount.error;
  else if (amount.cents <= 0) fieldErrors.amount = "Enter an amount above $0.00.";
  const refundedOn = text(formData, "refundedOn");
  if (!isIsoDate(refundedOn)) fieldErrors.refundedOn = "Enter the date the refund was made.";
  const method = text(formData, "method");
  if (!(RECEIPT_METHODS as readonly string[]).includes(method)) fieldErrors.method = "Choose how the money was returned.";
  const provider = text(formData, "provider");
  if (provider && !(RECEIPT_PROVIDERS as readonly string[]).includes(provider)) fieldErrors.provider = "Choose a provider from the list.";
  const reference = text(formData, "reference").trim();
  if (reference.length > 100) fieldErrors.reference = "Use at most 100 characters.";
  else if (looksLikeCardNumber(reference)) fieldErrors.reference = CARD_NUMBER_WARNING;
  const reason = reasonOf(formData);
  const bad = reasonError(reason);
  if (bad) Object.assign(fieldErrors, bad.fieldErrors);
  if (Object.keys(fieldErrors).length > 0) return { status: "error", message: "Check the highlighted fields.", fieldErrors };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("billing_record_refund", {
    p_organization_id: g.organization.organizationId,
    p_receipt_id: receiptId,
    p_amount_cents: amount.ok ? amount.cents : 0,
    p_refunded_on: refundedOn,
    p_method: method,
    p_provider: (provider || null) as string,
    p_reference: (reference || null) as string,
    p_reason: reason,
    p_idempotency_key: key,
  });
  if (error) return fail(error.code, error.message);
  refreshReceipt(receiptId);
  return { status: "success", message: "Refund recorded. This is your record of money returned; it isn't confirmation from a provider or your bank." };
}

/** SENSITIVE (Organization Admin): correct a refund that was recorded by mistake. */
export async function reverseRefundAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const refundId = text(formData, "refundId");
  const receiptId = text(formData, "receiptId");
  const key = text(formData, "idempotencyKey");
  if (!UUID_RE.test(refundId) || !UUID_RE.test(receiptId) || !KEY_RE.test(key)) return fail("ZW006");
  const reason = reasonOf(formData);
  const bad = reasonError(reason);
  if (bad) return bad;
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("billing_reverse_refund", { p_organization_id: g.organization.organizationId, p_refund_id: refundId, p_reason: reason, p_idempotency_key: key });
  if (error) return fail(error.code, error.message);
  refreshReceipt(receiptId);
  return { status: "success", message: "Refund corrected. The amount is payer credit again; the original entry stays in the history." };
}

/** SENSITIVE (Organization Admin): mark a payment as recorded in error / returned check / duplicate (nothing applied or refunded). */
export async function reverseReceiptAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const receiptId = text(formData, "receiptId");
  const key = text(formData, "idempotencyKey");
  const code = text(formData, "reasonCode");
  if (!UUID_RE.test(receiptId) || !KEY_RE.test(key)) return fail("ZW006");
  if (!(REVERSAL_REASON_CODES as readonly string[]).includes(code)) return { status: "error", message: "Choose why this payment is being reversed.", fieldErrors: { reasonCode: "Choose a reason." } };
  const reason = reasonOf(formData);
  const bad = reasonError(reason);
  if (bad) return bad;
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("billing_reverse_receipt", { p_organization_id: g.organization.organizationId, p_receipt_id: receiptId, p_reason_code: code, p_reason: reason, p_idempotency_key: key });
  if (error) return fail(error.code, error.message);
  refreshReceipt(receiptId);
  return { status: "success", message: "Payment reversed. It stays in the history with its number; it isn't a refund." };
}

/** Add staff evidence to a payment (never provider confirmation). */
export async function addReceiptEvidenceAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const receiptId = text(formData, "receiptId");
  const kind = text(formData, "kind");
  if (!UUID_RE.test(receiptId) || !["evidence_reference_noted", "evidence_document_held"].includes(kind)) return fail("ZW006");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("billing_add_receipt_evidence", { p_organization_id: g.organization.organizationId, p_receipt_id: receiptId, p_kind: kind });
  if (error) return fail(error.code, error.message);
  refreshReceipt(receiptId);
  return { status: "success", message: "Evidence noted." };
}

export async function reversePaymentAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const invoiceId = text(formData, "invoiceId");
  const paymentId = text(formData, "paymentId");
  const version = intOf(text(formData, "expectedVersion"));
  const key = text(formData, "idempotencyKey");
  const reason = text(formData, "reason").trim();
  if (!UUID_RE.test(invoiceId) || !UUID_RE.test(paymentId) || version === null || !KEY_RE.test(key)) return fail("ZW006");
  if (reason.length < 3 || reason.length > 500) return { status: "error", message: billingErrorMessage("ZW006", "reason_required"), fieldErrors: { reason: "Enter a reason (3–500 characters)." } };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("billing_reverse_payment", {
    p_organization_id: g.organization.organizationId,
    p_payment_id: paymentId,
    p_expected_version: version,
    p_reason: reason,
    p_idempotency_key: key,
  });
  if (error) return fail(error.code, error.message);
  refresh(invoiceId);
  return { status: "success", message: "Payment reversed. The original entry is kept in the history." };
}

// NP-FIN-P1: reversePaymentAction stays on the NP-BILL-P1 compatibility RPC (billing_reverse_payment) for a simple
// whole-receipt payment on one invoice; anything else is corrected on the payment's own page.
