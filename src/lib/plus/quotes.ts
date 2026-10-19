import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Nemryn Plus estimates & quotes reads (NP-P2-S5-S2). Ordinary per-request, cookie-based client -- never the
 * service-role client -- so the database decides from the caller's own membership, named grant and entitlement
 * (plus_can_read inside plus_list_quotes / plus_get_quote). Amounts are integer cents (bigint columns arrive as JSON
 * numbers well inside the safe-integer range: each line is capped at 10,000,000).
 */
export class QuotesError extends Error {
  constructor(public readonly code: string | undefined) {
    super(`plus quotes request failed (${code ?? "unknown"})`);
  }
}

export interface QuoteSummary {
  id: string;
  quoteNumber: number;
  kind: string;
  status: string;
  isExpired: boolean;
  serviceType: string | null;
  roundTrip: boolean;
  totalCents: number;
  currency: string;
  validUntil: string;
  supersedesQuoteId: string | null;
  supersededByQuoteId: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteDetail extends QuoteSummary {
  distanceMiles: number | null;
  baseCents: number;
  mileageCents: number;
  waitCents: number;
  extraStopsCents: number;
  mobilityAssistanceCents: number;
  escortCents: number;
  returnLegCents: number;
  otherCents: number;
  otherLabel: string | null;
  discountCents: number;
  termsNote: string | null;
  createdByName: string | null;
  withdrawnReason: string | null;
}

const n = (v: number | string | null) => (v === null ? 0 : Number(v));

export async function listOpportunityQuotes(organizationId: string, opportunityId: string): Promise<QuoteSummary[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_quotes", {
    p_organization_id: organizationId,
    p_opportunity_id: opportunityId,
    p_contact_id: null as unknown as string,
  });
  if (error) throw new QuotesError(error.code);
  return (data ?? []).map((r) => ({
    id: r.quote_id,
    quoteNumber: r.quote_number,
    kind: r.kind,
    status: r.status,
    isExpired: r.is_expired === true,
    serviceType: r.service_type,
    roundTrip: r.round_trip,
    totalCents: n(r.total_cents),
    currency: r.currency,
    validUntil: r.valid_until,
    supersedesQuoteId: r.supersedes_quote_id,
    supersededByQuoteId: r.superseded_by_quote_id,
    sentAt: r.sent_at,
    respondedAt: r.responded_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** One quote of the organization; null when unknown, foreign or not readable (ZW002 -- indistinguishable). */
export async function getQuote(organizationId: string, quoteId: string): Promise<QuoteDetail | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_get_quote", { p_organization_id: organizationId, p_quote_id: quoteId });
  if (error) {
    if (error.code === "ZW002") return null;
    throw new QuotesError(error.code);
  }
  const r = data?.[0];
  if (!r) return null;
  return {
    id: r.quote_id,
    quoteNumber: r.quote_number,
    kind: r.kind,
    status: r.status,
    isExpired: r.is_expired === true,
    serviceType: r.service_type,
    roundTrip: r.round_trip,
    totalCents: n(r.total_cents),
    currency: r.currency,
    validUntil: r.valid_until,
    supersedesQuoteId: r.supersedes_quote_id,
    supersededByQuoteId: r.superseded_by_quote_id,
    sentAt: r.sent_at,
    respondedAt: r.responded_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    distanceMiles: r.distance_miles === null ? null : Number(r.distance_miles),
    baseCents: n(r.base_cents),
    mileageCents: n(r.mileage_cents),
    waitCents: n(r.wait_cents),
    extraStopsCents: n(r.extra_stops_cents),
    mobilityAssistanceCents: n(r.mobility_assistance_cents),
    escortCents: n(r.escort_cents),
    returnLegCents: n(r.return_leg_cents),
    otherCents: n(r.other_cents),
    otherLabel: r.other_label,
    discountCents: n(r.discount_cents),
    termsNote: r.terms_note,
    createdByName: r.created_by_name,
    withdrawnReason: r.withdrawn_reason,
  };
}
