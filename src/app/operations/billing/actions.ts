"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import {
  BILL_TO_KINDS,
  MAX_PAYMENT_CENTS,
  PAYMENT_METHODS,
  billingErrorMessage,
  isIsoDate,
  parseMoneyToCents,
  parseQuantity,
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
  return { status: "error", message: billingErrorMessage(code, message) };
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
// Payments (manual; append-only)
// ---------------------------------------------------------------------------------------------------------------------
export async function recordPaymentAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const g = await guard(formData);
  if ("error" in g) return { status: "error", message: g.error };
  const invoiceId = text(formData, "invoiceId");
  const version = intOf(text(formData, "expectedVersion"));
  const key = text(formData, "idempotencyKey");
  if (!UUID_RE.test(invoiceId) || version === null || !KEY_RE.test(key)) return fail("ZW006");
  const fieldErrors: Record<string, string> = {};
  const amount = parseMoneyToCents(text(formData, "amount"), MAX_PAYMENT_CENTS);
  if (!amount.ok) fieldErrors.amount = amount.error;
  else if (amount.cents <= 0) fieldErrors.amount = "Enter an amount above $0.00.";
  const receivedOn = text(formData, "receivedOn");
  if (!isIsoDate(receivedOn)) fieldErrors.receivedOn = "Enter the date the payment was received.";
  const method = text(formData, "method");
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) fieldErrors.method = "Choose how it was paid.";
  const reference = text(formData, "reference").trim();
  if (reference.length > 100) fieldErrors.reference = "Use at most 100 characters.";
  const note = text(formData, "note").trim();
  if (note.length > 500) fieldErrors.note = "Use at most 500 characters.";
  if (Object.keys(fieldErrors).length > 0) return { status: "error", message: "Check the highlighted fields.", fieldErrors };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_record_payment", {
    p_organization_id: g.organization.organizationId,
    p_invoice_id: invoiceId,
    p_expected_version: version,
    p_amount_cents: amount.ok ? amount.cents : 0,
    p_received_on: receivedOn,
    p_method: method,
    p_reference: (reference || null) as string,
    p_note: (note || null) as string,
    p_idempotency_key: key,
  });
  if (error || !data) return fail(error?.code, error?.message);
  refresh(invoiceId);
  return { status: "success", message: Number(data.balance_cents) === 0 ? "Payment recorded. The invoice is paid in full." : "Payment recorded." };
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
