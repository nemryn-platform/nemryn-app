import "server-only";
import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { BILLING_PAGE_SIZE, type InvoiceFilter } from "./billing-core";

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
export interface InvoicePayment {
  id: string;
  entryKind: "payment" | "reversal";
  amountCents: number;
  receivedOn: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  reversesPaymentId: string | null;
  reason: string | null;
  recordedAt: string;
  /** payments only: 1-based order among this invoice's payments (receipt number), and the reversal correcting it, if any */
  sequence: number | null;
  reversedBy: { id: string; reason: string | null; recordedAt: string } | null;
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
    supabase
      .from("billing_payments")
      .select("id, entry_kind, amount_cents, received_on, method, reference, note, reverses_payment_id, reason, recorded_at")
      .eq("organization_id", organizationId)
      .eq("invoice_id", invoiceId)
      .order("recorded_at"),
  ]);
  if (lines.error || links.error || payments.error) throw new BillingError(lines.error?.code ?? links.error?.code ?? payments.error?.code);

  const reversals = new Map((payments.data ?? []).filter((p) => p.entry_kind === "reversal").map((p) => [p.reverses_payment_id as string, p]));
  let seq = 0;
  const ledger: InvoicePayment[] = (payments.data ?? []).map((p) => {
    const rev = p.entry_kind === "payment" ? reversals.get(p.id) : undefined;
    return {
      id: p.id,
      entryKind: p.entry_kind === "reversal" ? "reversal" : "payment",
      amountCents: Number(p.amount_cents),
      receivedOn: p.received_on,
      method: p.method,
      reference: p.reference,
      note: p.note,
      reversesPaymentId: p.reverses_payment_id,
      reason: p.reason,
      recordedAt: p.recorded_at,
      sequence: p.entry_kind === "payment" ? ++seq : null,
      reversedBy: rev ? { id: rev.id, reason: rev.reason, recordedAt: rev.recorded_at } : null,
    };
  });
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
