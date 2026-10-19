import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { PipelineParams } from "./opportunities-core";

/**
 * Nemryn Plus private-pay pipeline reads (NP-P2-S1). Every call uses the ordinary per-request, cookie-based client --
 * never the service-role client -- so the database decides from the caller's own membership, named grant and
 * entitlement (plus_can_read inside each RPC).
 */
export class OpportunitiesError extends Error {
  constructor(public readonly code: string | undefined) {
    super(`plus opportunities request failed (${code ?? "unknown"})`);
  }
}

export interface OpportunityListRow {
  id: string;
  title: string;
  stage: string;
  contactId: string;
  contactName: string;
  contactArchived: boolean;
  contactDoNotContact: boolean;
  inquiryType: string | null;
  serviceType: string | null;
  source: string;
  estimatedValueCents: number | null;
  ownerName: string | null;
  updatedAt: string;
}

export const PIPELINE_PAGE_SIZE = 200;

export async function listOpportunities(
  organizationId: string,
  params: Pick<PipelineParams, "search" | "view" | "stage" | "source" | "owner"> & { contactId?: string | null },
): Promise<{ rows: OpportunityListRow[]; total: number }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_opportunities", {
    p_organization_id: organizationId,
    p_search: (params.search || null) as string,
    p_view: params.view,
    p_stage: params.stage as string,
    p_source: params.source as string,
    p_owner_membership_id: params.owner as string,
    p_contact_id: (params.contactId ?? null) as string,
    p_limit: PIPELINE_PAGE_SIZE,
    p_offset: 0,
  });
  if (error) throw new OpportunitiesError(error.code);
  return {
    rows: (data ?? []).map((r) => ({
      id: r.opportunity_id,
      title: r.title,
      stage: r.stage,
      contactId: r.contact_id,
      contactName: r.contact_name,
      contactArchived: r.contact_status === "archived",
      contactDoNotContact: r.contact_do_not_contact,
      inquiryType: r.inquiry_type,
      serviceType: r.service_type,
      source: r.source,
      estimatedValueCents: r.estimated_value_cents === null ? null : Number(r.estimated_value_cents),
      ownerName: r.owner_name,
      updatedAt: r.updated_at,
    })),
    total: data && data.length > 0 ? Number(data[0].total_count) : 0,
  };
}

export interface OpportunityDetail extends OpportunityListRow {
  sourceDetail: string | null;
  campaignCode: string | null;
  paymentReportedStatus: string;
  lostReason: string | null;
  lostNote: string | null;
  ownerHandle: string | null;
  ownerCanWrite: boolean | null;
  closedAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** null when not available to the caller (foreign, unknown or no access): never says which. */
export async function getOpportunity(organizationId: string, opportunityId: string): Promise<OpportunityDetail | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_get_opportunity", { p_organization_id: organizationId, p_opportunity_id: opportunityId });
  if (error) {
    if (error.code === "ZW002") return null;
    throw new OpportunitiesError(error.code);
  }
  const r = data?.[0];
  if (!r) return null;
  return {
    id: r.opportunity_id,
    title: r.title,
    stage: r.stage,
    contactId: r.contact_id,
    contactName: r.contact_name,
    contactArchived: r.contact_status === "archived",
    contactDoNotContact: r.contact_do_not_contact,
    inquiryType: r.inquiry_type,
    serviceType: r.service_type,
    source: r.source,
    sourceDetail: r.source_detail,
    campaignCode: r.campaign_code,
    estimatedValueCents: r.estimated_value_cents === null ? null : Number(r.estimated_value_cents),
    paymentReportedStatus: r.payment_reported_status,
    lostReason: r.lost_reason,
    lostNote: r.lost_note,
    ownerName: r.owner_name,
    ownerHandle: r.owner_membership_id,
    ownerCanWrite: r.owner_can_write,
    closedAt: r.closed_at,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface OpportunityActivity {
  id: string;
  type: string;
  fromStage: string | null;
  toStage: string | null;
  body: string | null;
  actorName: string | null;
  occurredAt: string;
  /** NP-P2-S5-S3B (ZD-222): quote lifecycle event reference (null for every other activity); never an amount */
  quoteId: string | null;
  quoteNumber: number | null;
  quoteKind: string | null;
  quoteStatus: string | null;
  relatedQuoteNumber: number | null;
}

export async function listOpportunityActivities(organizationId: string, opportunityId: string): Promise<OpportunityActivity[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_opportunity_activities", {
    p_organization_id: organizationId,
    p_opportunity_id: opportunityId,
    p_limit: 100,
    p_offset: 0,
  });
  if (error) throw new OpportunitiesError(error.code);
  return (data ?? []).map((r) => ({
    id: r.activity_id,
    type: r.activity_type,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    body: r.body,
    actorName: r.actor_name,
    occurredAt: r.occurred_at,
    quoteId: r.quote_id,
    quoteNumber: r.quote_number,
    quoteKind: r.quote_kind,
    quoteStatus: r.quote_status,
    relatedQuoteNumber: r.related_quote_number,
  }));
}
