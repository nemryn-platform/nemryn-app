import "server-only";
import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { BILLING_PAGE_SIZE, type InvoiceFilter, type ReceiptFilter } from "./billing-core";

/**
 * Core billing reads (NP-BILL-P1). Every call uses the ordinary per-request, cookie-based client -- never the
 * service-role client -- so the database decides from the caller's own membership: the billing_* RPCs require an
 * Organization Admin of the organization (ZW002 otherwise) and the billing tables are RLS-readable by Organization
 * Admins of the same organization only. Nothing here logs bill-to details, payment references or notes (R4).
 */
export class BillingError extends Error {
  constructor(public readonly code: string | undefined) {
    super(`billing request failed (${code ?? "unknown"})`);
  }
}

const n = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);

export interface BillingSummary {
  outstandingCents: number;
  outstandingCount: number;
  overdueCents: number;
  overdueCount: number;
  collectedThisMonthCents: number;
  draftCount: number;
  readyTripCount: number;
}
export async function getBillingSummary(organizationId: string): Promise<BillingSummary> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_summary", { p_organization_id: organizationId });
  if (error) throw new BillingError(error.code);
  const r = data?.[0];
  return {
    outstandingCents: Number(r?.outstanding_cents ?? 0),
    outstandingCount: Number(r?.outstanding_count ?? 0),
    overdueCents: Number(r?.overdue_cents ?? 0),
    overdueCount: Number(r?.overdue_count ?? 0),
    collectedThisMonthCents: Number(r?.collected_this_month_cents ?? 0),
    draftCount: Number(r?.draft_count ?? 0),
    readyTripCount: Number(r?.ready_trip_count ?? 0),
  };
}

/**
 * NP-FIN-P1G financial-write gate. Deny-by-default: an organization can create or change financial records only after
 * the platform enables it (synthetic or launch-approved live). The database enforces it on every financial table; the
 * app only uses this to hide write actions and explain why. A failed read is treated as "not enabled" (fail closed).
 */
export interface BillingWriteStatus {
  enabled: boolean;
  /** false when the status couldn't be read; the UI then says actions are unavailable rather than "not enabled". */
  known: boolean;
}
export const getBillingWriteStatus = cache(async (organizationId: string): Promise<BillingWriteStatus> => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_write_status", { p_organization_id: organizationId });
  if (error) return { enabled: false, known: false };
  return { enabled: data?.[0]?.enabled === true, known: true };
});

export interface BillableTrip {
  tripId: string;
  passengerId: string;
  passengerName: string;
  scheduledPickupAt: string | null;
  completedAt: string | null;
  pickup: string;
  destination: string;
  requestId: string | null;
  requesterName: string | null;
  pickupFacilityId: string | null;
  pickupFacilityName: string | null;
  destinationFacilityId: string | null;
  destinationFacilityName: string | null;
}
export async function listBillableTrips(organizationId: string, opts: { passengerId?: string | null; page?: number; limit?: number } = {}): Promise<{ rows: BillableTrip[]; total: number }> {
  const supabase = await createServerSupabaseClient();
  const limit = opts.limit ?? BILLING_PAGE_SIZE;
  const { data, error } = await supabase.rpc("billing_list_billable_trips", {
    p_organization_id: organizationId,
    p_passenger_id: (opts.passengerId ?? null) as string,
    p_limit: limit,
    p_offset: ((opts.page ?? 1) - 1) * limit,
  });
  if (error) throw new BillingError(error.code);
  const rows = (data ?? []).map((r) => ({
    tripId: r.trip_id,
    passengerId: r.passenger_id,
    passengerName: r.passenger_name ?? "Unknown passenger",
    scheduledPickupAt: n(r.scheduled_pickup_at),
    completedAt: n(r.completed_at),
    pickup: r.pickup_description,
    destination: r.destination_description,
    requestId: n(r.request_id),
    requesterName: n(r.requester_name),
    pickupFacilityId: n(r.pickup_facility_id),
    pickupFacilityName: n(r.pickup_facility_name),
    destinationFacilityId: n(r.destination_facility_id),
    destinationFacilityName: n(r.destination_facility_name),
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
}

export interface InvoiceListRow {
  id: string;
  invoiceNumber: number | null;
  status: string;
  paymentState: string;
  isOverdue: boolean;
  billToName: string;
  passengerName: string;
  issueDate: string | null;
  dueDate: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  tripCount: number;
}
export async function listInvoices(organizationId: string, p: { filter: InvoiceFilter; search: string; page: number }): Promise<{ rows: InvoiceListRow[]; total: number }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_list_invoices", {
    p_organization_id: organizationId,
    p_filter: p.filter,
    p_search: (p.search || null) as string,
    p_limit: BILLING_PAGE_SIZE,
    p_offset: (p.page - 1) * BILLING_PAGE_SIZE,
  });
  if (error) throw new BillingError(error.code);
  const rows = (data ?? []).map((r) => ({
    id: r.invoice_id,
    invoiceNumber: n(r.invoice_number),
    status: r.status,
    paymentState: r.payment_state,
    isOverdue: Boolean(r.is_overdue),
    billToName: r.bill_to_name,
    passengerName: r.passenger_name,
    issueDate: n(r.issue_date),
    dueDate: n(r.due_date),
    totalCents: Number(r.total_cents),
    paidCents: Number(r.paid_cents),
    balanceCents: Number(r.balance_cents),
    tripCount: Number(r.trip_count),
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
}

export interface InvoiceLine {
  id: string;
  position: number;
  tripId: string | null;
  source: string;
  description: string;
  quantity: string;
  unitCents: number;
  amountCents: number;
}
export interface InvoiceTrip {
  tripId: string;
  scheduledPickupAt: string | null;
  completedAt: string | null;
  pickup: string;
  destination: string;
  released: boolean;
}
/**
 * NP-FIN-P1: one payment applied to the invoice = one apply allocation of a receipt (billing_get_invoice_ledger). The
 * receipt may also pay other invoices or hold payer credit; "simplePayment" = the whole receipt went to this invoice
 * only (reversible from the invoice page through the NP-BILL-P1 compatibility RPC).
 */
export interface InvoicePayment {
  /** the allocation id (what billing_reverse_payment / billing_unapply_allocation take) */
  id: string;
  receiptId: string;
  receiptNumber: number;
  amountCents: number;
  receivedOn: string;
  method: string | null;
  provider: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
  differentPayer: boolean;
  unapplied: boolean;
  unapplyReason: string | null;
  receiptReversed: boolean;
  receiptReversalReason: string | null;
  receiptReversalCode: string | null;
  receiptReversedAt: string | null;
  assurance: string;
  simplePayment: boolean;
}
export interface InvoiceDetail {
  id: string;
  invoiceNumber: number | null;
  status: string;
  paymentState: string;
  isOverdue: boolean;
  passengerId: string;
  passengerName: string;
  billToKind: string;
  billToName: string;
  billToAddress: string | null;
  billToEmail: string | null;
  billToPhone: string | null;
  sourceQuoteId: string | null;
  sourceQuoteNumber: number | null;
  sourceQuoteKind: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issueDate: string | null;
  dueDate: string | null;
  termsNote: string | null;
  version: number;
  createdAt: string;
  issuedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  lines: InvoiceLine[];
  trips: InvoiceTrip[];
  payments: InvoicePayment[];
}

/** One invoice with lines, trips and the payment ledger, or null when it isn't this organization's (ZW002). */
export const getInvoice = cache(async (organizationId: string, invoiceId: string): Promise<InvoiceDetail | null> => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_get_invoice", { p_organization_id: organizationId, p_invoice_id: invoiceId });
  if (error) {
    if (error.code === "ZW002") return null;
    throw new BillingError(error.code);
  }
  const r = data?.[0];
  if (!r) return null;
  const [lines, links, payments] = await Promise.all([
    supabase
      .from("billing_invoice_lines")
      .select("id, position, trip_id, source, description, quantity, unit_cents, amount_cents")
      .eq("organization_id", organizationId)
      .eq("invoice_id", invoiceId)
      .order("position"),
    supabase
      .from("billing_invoice_trips")
      .select("trip_id, released_at, trips!billing_invoice_trips_trip_fkey(scheduled_pickup_at, completed_at, pickup_description, destination_description)")
      .eq("organization_id", organizationId)
      .eq("invoice_id", invoiceId),
    supabase.rpc("billing_get_invoice_ledger", { p_organization_id: organizationId, p_invoice_id: invoiceId }),
  ]);
  if (lines.error || links.error || payments.error) throw new BillingError(lines.error?.code ?? links.error?.code ?? payments.error?.code);

  const ledger: InvoicePayment[] = (payments.data ?? []).map((p) => ({
    id: p.allocation_id,
    receiptId: p.receipt_id,
    receiptNumber: p.receipt_number,
    amountCents: Number(p.amount_cents),
    receivedOn: p.received_on,
    method: n(p.method),
    provider: n(p.provider),
    reference: n(p.reference),
    note: n(p.note),
    createdAt: p.created_at,
    differentPayer: Boolean(p.different_payer),
    unapplied: Boolean(p.unapplied),
    unapplyReason: n(p.unapply_reason),
    receiptReversed: Boolean(p.receipt_reversed),
    receiptReversalReason: n(p.receipt_reversal_reason),
    receiptReversalCode: n(p.receipt_reversal_code),
    receiptReversedAt: n(p.receipt_reversed_at),
    assurance: p.assurance ?? "recorded",
    simplePayment: Boolean(p.simple_payment),
  }));
  type TripEmbed = { scheduled_pickup_at: string | null; completed_at: string | null; pickup_description: string; destination_description: string };
  const trips: InvoiceTrip[] = (links.data ?? []).map((l) => {
    const t = (Array.isArray(l.trips) ? l.trips[0] : l.trips) as TripEmbed | null;
    return {
      tripId: l.trip_id,
      scheduledPickupAt: t?.scheduled_pickup_at ?? null,
      completedAt: t?.completed_at ?? null,
      pickup: t?.pickup_description ?? "",
      destination: t?.destination_description ?? "",
      released: l.released_at !== null,
    };
  });
  trips.sort((a, b) => (a.scheduledPickupAt ?? a.completedAt ?? "").localeCompare(b.scheduledPickupAt ?? b.completedAt ?? ""));

  return {
    id: r.invoice_id,
    invoiceNumber: n(r.invoice_number),
    status: r.status,
    paymentState: r.payment_state,
    isOverdue: Boolean(r.is_overdue),
    passengerId: r.passenger_id,
    passengerName: r.passenger_name,
    billToKind: r.bill_to_kind,
    billToName: r.bill_to_name,
    billToAddress: n(r.bill_to_address),
    billToEmail: n(r.bill_to_email),
    billToPhone: n(r.bill_to_phone),
    sourceQuoteId: n(r.source_quote_id),
    sourceQuoteNumber: n(r.source_quote_number),
    sourceQuoteKind: n(r.source_quote_kind),
    subtotalCents: Number(r.subtotal_cents),
    discountCents: Number(r.discount_cents),
    totalCents: Number(r.total_cents),
    paidCents: Number(r.paid_cents),
    balanceCents: Number(r.balance_cents),
    issueDate: n(r.issue_date),
    dueDate: n(r.due_date),
    termsNote: n(r.terms_note),
    version: r.version,
    createdAt: r.created_at,
    issuedAt: n(r.issued_at),
    voidedAt: n(r.voided_at),
    voidReason: n(r.void_reason),
    lines: (lines.data ?? []).map((l) => ({
      id: l.id,
      position: l.position,
      tripId: l.trip_id,
      source: l.source,
      description: l.description,
      quantity: String(l.quantity),
      unitCents: Number(l.unit_cents),
      amountCents: Number(l.amount_cents),
    })),
    trips,
    payments: ledger,
  };
});

export interface TripBillingStatus {
  billable: boolean;
  invoiceId: string | null;
  invoiceNumber: number | null;
  status: string | null;
  paymentState: string | null;
  balanceCents: number | null;
}
export async function getTripBillingStatus(organizationId: string, tripId: string): Promise<TripBillingStatus | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_trip_status", { p_organization_id: organizationId, p_trip_id: tripId });
  if (error) return null;
  const r = data?.[0];
  if (!r) return null;
  return {
    billable: Boolean(r.billable),
    invoiceId: n(r.invoice_id),
    invoiceNumber: n(r.invoice_number),
    status: n(r.status),
    paymentState: n(r.payment_state),
    balanceCents: r.balance_cents === null || r.balance_cents === undefined ? null : Number(r.balance_cents),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// NP-FIN-P1 ledger reads (receipts, allocations, refunds, payer credit). RPC-only; every call re-checks the permission
// catalogue (Organization Admin in FIN-P1). Nothing here logs payer names, references, notes or reasons.
// ---------------------------------------------------------------------------------------------------------------------
export interface LedgerSummary {
  creditCents: number;
  creditReceiptCount: number;
  receiptsThisMonth: number;
  refundsThisMonthCents: number;
}
export async function getLedgerSummary(organizationId: string): Promise<LedgerSummary> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_ledger_summary", { p_organization_id: organizationId });
  if (error) throw new BillingError(error.code);
  const r = data?.[0];
  return {
    creditCents: Number(r?.credit_cents ?? 0),
    creditReceiptCount: Number(r?.credit_receipt_count ?? 0),
    receiptsThisMonth: Number(r?.receipts_this_month ?? 0),
    refundsThisMonthCents: Number(r?.refunds_this_month_cents ?? 0),
  };
}

export interface ReceiptListRow {
  id: string;
  receiptNumber: number;
  payerKind: string;
  payerName: string;
  receivedOn: string;
  method: string;
  provider: string | null;
  grossCents: number;
  feeCents: number;
  allocatedCents: number;
  refundedCents: number;
  unallocatedCents: number;
  reversed: boolean;
  assurance: string;
}
export async function listReceipts(organizationId: string, p: { filter: ReceiptFilter; search: string; page: number }): Promise<{ rows: ReceiptListRow[]; total: number }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_list_receipts", {
    p_organization_id: organizationId,
    p_filter: p.filter,
    p_search: (p.search || null) as string,
    p_limit: BILLING_PAGE_SIZE,
    p_offset: (p.page - 1) * BILLING_PAGE_SIZE,
  });
  if (error) throw new BillingError(error.code);
  const rows = (data ?? []).map((r) => ({
    id: r.receipt_id,
    receiptNumber: r.receipt_number,
    payerKind: r.payer_kind,
    payerName: r.payer_name,
    receivedOn: r.received_on,
    method: r.method,
    provider: n(r.provider),
    grossCents: Number(r.gross_cents),
    feeCents: Number(r.fee_cents),
    allocatedCents: Number(r.allocated_cents),
    refundedCents: Number(r.refunded_cents),
    unallocatedCents: Number(r.unallocated_cents),
    reversed: Boolean(r.reversed),
    assurance: r.assurance ?? "recorded",
  }));
  return { rows, total: Number(data?.[0]?.total_count ?? 0) };
}

export interface ReceiptAllocation {
  id: string;
  invoiceId: string;
  invoiceNumber: number | null;
  invoiceStatus: string;
  amountCents: number;
  createdAt: string;
  differentPayer: boolean;
  differentPayerReason: string | null;
  unapplied: boolean;
  unapplyReason: string | null;
  unappliedAt: string | null;
}
export interface ReceiptRefund {
  id: string;
  refundSeq: number;
  amountCents: number;
  refundedOn: string;
  method: string;
  provider: string | null;
  reference: string | null;
  reason: string;
  recordedAt: string;
  assurance: string;
  reversed: boolean;
  reversalReason: string | null;
  reversedAt: string | null;
}
export interface ReceiptDetail {
  id: string;
  receiptNumber: number;
  payerKind: string;
  payerId: string | null;
  payerName: string;
  sourceInvoiceId: string | null;
  grossCents: number;
  feeCents: number;
  netCents: number;
  receivedOn: string;
  method: string;
  provider: string | null;
  reference: string | null;
  note: string | null;
  recordedAt: string;
  allocatedCents: number;
  refundedCents: number;
  unallocatedCents: number;
  assurance: string;
  reversal: { reasonCode: string; reason: string; reversedAt: string } | null;
  allocations: ReceiptAllocation[];
  refunds: ReceiptRefund[];
  events: { kind: string; source: string; occurredAt: string }[];
}
type J = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => Number(v ?? 0);

/** One receipt with its allocations, refunds, reversal and assurance facts, or null when it isn't this organization's. */
export const getReceipt = cache(async (organizationId: string, receiptId: string): Promise<ReceiptDetail | null> => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_get_receipt", { p_organization_id: organizationId, p_receipt_id: receiptId });
  if (error) {
    if (error.code === "ZW002") return null;
    throw new BillingError(error.code);
  }
  const root = (data ?? {}) as J;
  const r = (root.receipt ?? {}) as J;
  const rev = root.reversal as J | null;
  return {
    id: String(r.id),
    receiptNumber: num(r.receipt_number),
    payerKind: String(r.payer_kind),
    payerId: s(r.payer_id),
    payerName: String(r.payer_name),
    sourceInvoiceId: s(r.source_invoice_id),
    grossCents: num(r.gross_cents),
    feeCents: num(r.fee_cents),
    netCents: num(r.net_cents),
    receivedOn: String(r.received_on),
    method: String(r.method),
    provider: s(r.provider),
    reference: s(r.reference),
    note: s(r.note),
    recordedAt: String(r.recorded_at),
    allocatedCents: num(r.allocated_cents),
    refundedCents: num(r.refunded_cents),
    unallocatedCents: num(r.unallocated_cents),
    assurance: s(r.assurance) ?? "recorded",
    reversal: rev ? { reasonCode: String(rev.reason_code), reason: String(rev.reason), reversedAt: String(rev.reversed_at) } : null,
    allocations: ((root.allocations ?? []) as J[]).map((a) => ({
      id: String(a.id),
      invoiceId: String(a.invoice_id),
      invoiceNumber: a.invoice_number === null || a.invoice_number === undefined ? null : num(a.invoice_number),
      invoiceStatus: String(a.invoice_status),
      amountCents: num(a.amount_cents),
      createdAt: String(a.created_at),
      differentPayer: Boolean(a.different_payer),
      differentPayerReason: s(a.different_payer_reason),
      unapplied: Boolean(a.unapplied),
      unapplyReason: s(a.unapply_reason),
      unappliedAt: s(a.unapplied_at),
    })),
    refunds: ((root.refunds ?? []) as J[]).map((f) => ({
      id: String(f.id),
      refundSeq: num(f.refund_seq),
      amountCents: num(f.amount_cents),
      refundedOn: String(f.refunded_on),
      method: String(f.method),
      provider: s(f.provider),
      reference: s(f.reference),
      reason: String(f.reason),
      recordedAt: String(f.recorded_at),
      assurance: s(f.assurance) ?? "recorded",
      reversed: Boolean(f.reversed),
      reversalReason: s(f.reversal_reason),
      reversedAt: s(f.reversed_at),
    })),
    events: ((root.events ?? []) as J[]).map((e) => ({ kind: String(e.kind), source: String(e.source), occurredAt: String(e.occurred_at) })),
  };
});

export interface OpenInvoice {
  id: string;
  invoiceNumber: number | null;
  billToKind: string;
  billToName: string;
  passengerName: string;
  issueDate: string | null;
  dueDate: string | null;
  totalCents: number;
  balanceCents: number;
  version: number;
  samePayer: boolean;
}
/** Issued invoices with a balance, oldest first, flagged same_payer by authoritative identity (never by name). */
export async function listOpenInvoices(organizationId: string, p: { receiptId?: string | null; payerKind?: string | null; payerId?: string | null }): Promise<OpenInvoice[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_list_open_invoices", {
    p_organization_id: organizationId,
    p_receipt_id: (p.receiptId ?? null) as string,
    p_payer_kind: (p.payerKind ?? null) as string,
    p_payer_id: (p.payerId ?? null) as string,
  });
  if (error) throw new BillingError(error.code);
  return (data ?? []).map((r) => ({
    id: r.invoice_id,
    invoiceNumber: n(r.invoice_number),
    billToKind: r.bill_to_kind,
    billToName: r.bill_to_name,
    passengerName: r.passenger_name,
    issueDate: n(r.issue_date),
    dueDate: n(r.due_date),
    totalCents: Number(r.total_cents),
    balanceCents: Number(r.balance_cents),
    version: r.version,
    samePayer: Boolean(r.same_payer),
  }));
}

/** The same payer's receipts with credit, for "Apply payer credit" on an invoice. */
export async function listInvoiceCreditSources(organizationId: string, invoiceId: string): Promise<{ receiptId: string; receiptNumber: number; receivedOn: string; unallocatedCents: number }[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_invoice_credit_sources", { p_organization_id: organizationId, p_invoice_id: invoiceId });
  if (error) return [];
  return (data ?? []).map((r) => ({ receiptId: r.receipt_id, receiptNumber: r.receipt_number, receivedOn: r.received_on, unallocatedCents: Number(r.unallocated_cents) }));
}

/** Payers with an authoritative identity and open invoices (choices for a receipt that isn't tied to one invoice). */
export async function listPayers(organizationId: string): Promise<{ kind: string; id: string; name: string; openInvoiceCount: number; balanceCents: number }[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("billing_list_payers", { p_organization_id: organizationId });
  if (error) throw new BillingError(error.code);
  return (data ?? []).map((r) => ({ kind: r.payer_kind, id: r.payer_id, name: r.payer_name, openInvoiceCount: Number(r.open_invoice_count), balanceCents: Number(r.balance_cents) }));
}

export interface QuoteOption {
  id: string;
  label: string;
  totalCents: number;
}
/**
 * Plus quotes that may be imported for a trip (R3): sent / accepted quotes of the opportunities its request is attributed
 * to. Read through RLS (Plus read) -- an organization without Plus simply gets none. The RPC re-checks everything.
 */
export async function listImportableQuotes(organizationId: string, requestId: string | null): Promise<QuoteOption[]> {
  if (!requestId) return [];
  const supabase = await createServerSupabaseClient();
  const { data: links } = await supabase
    .from("plus_request_attributions")
    .select("opportunity_id")
    .eq("organization_id", organizationId)
    .eq("request_id", requestId);
  const opportunityIds = [...new Set((links ?? []).map((l) => l.opportunity_id).filter((v): v is string => Boolean(v)))];
  if (opportunityIds.length === 0) return [];
  const { data: quotes } = await supabase
    .from("plus_quotes")
    .select("id, kind, quote_number, status, total_cents")
    .eq("organization_id", organizationId)
    .in("opportunity_id", opportunityIds)
    .in("status", ["sent", "accepted"])
    .order("quote_number", { ascending: false })
    .limit(10);
  return (quotes ?? []).map((q) => ({
    id: q.id,
    label: `${q.kind === "estimate" ? "Estimate" : "Quote"} ${q.quote_number} (${q.status === "accepted" ? "accepted" : "sent"})`,
    totalCents: Number(q.total_cents),
  }));
}
