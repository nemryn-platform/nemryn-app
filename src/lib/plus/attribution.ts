import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Nemryn Plus request attribution reads (NP-P2-S3). Every call uses the ordinary per-request, cookie-based client --
 * never the service-role client -- so the database decides from the caller's own membership, named grant, entitlement
 * AND Core request-read role. A refusal surfaces as an AttributionError with the ZW code.
 */
export class AttributionError extends Error {
  constructor(public readonly code: string | undefined) {
    super(`plus attribution request failed (${code ?? "unknown"})`);
  }
}

export interface RequestAttribution {
  requestId: string;
  contactId: string | null;
  contactName: string | null;
  contactStatus: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  opportunityStage: string | null;
  linkMethod: string;
  linkedByName: string | null;
  linkedAt: string;
  updatedAt: string;
}

/** The Growth attribution of one Request, or null when it is not attributed. */
export async function getRequestAttribution(organizationId: string, requestId: string): Promise<RequestAttribution | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_get_request_attribution", { p_organization_id: organizationId, p_request_id: requestId });
  if (error) throw new AttributionError(error.code);
  const r = data?.[0];
  if (!r) return null;
  return {
    requestId: r.request_id,
    contactId: r.contact_id,
    contactName: r.contact_name,
    contactStatus: r.contact_status,
    opportunityId: r.opportunity_id,
    opportunityTitle: r.opportunity_title,
    opportunityStage: r.opportunity_stage,
    linkMethod: r.link_method,
    linkedByName: r.linked_by_name,
    linkedAt: r.linked_at,
    updatedAt: r.updated_at,
  };
}

export interface RequestSummary {
  requestId: string;
  state: string;
  source: string;
  serviceType: string | null;
  createdAt: string;
  preferredDate: string | null;
  passengerLinked: boolean;
  decisionReasonCode: string | null;
  tripsTotal: number;
  tripsCompleted: number;
  tripsCancelled: number;
  firstCompletedAt: string | null;
  arrangementCount: number;
  arrangementStatus: string | null;
}

export interface LinkedRequest extends RequestSummary {
  opportunityId: string | null;
  opportunityTitle: string | null;
  linkMethod: string;
  linkedAt: string;
}

/**
 * The Requests attributed to one contact or one opportunity, with their minimum-necessary Core facts derived live
 * from Core (plus_get_request_summaries). Ordered newest link first.
 */
export async function listLinkedRequests(
  organizationId: string,
  subject: { contactId: string } | { opportunityId: string },
): Promise<{ rows: LinkedRequest[]; total: number }> {
  const supabase = await createServerSupabaseClient();
  const { data: links, error } = await supabase.rpc("plus_list_request_attributions", {
    p_organization_id: organizationId,
    p_contact_id: ("contactId" in subject ? subject.contactId : null) as string,
    p_opportunity_id: ("opportunityId" in subject ? subject.opportunityId : null) as string,
    p_limit: 50,
    p_offset: 0,
  });
  if (error) throw new AttributionError(error.code);
  if (!links || links.length === 0) return { rows: [], total: 0 };
  const { data: summaries, error: sumError } = await supabase.rpc("plus_get_request_summaries", {
    p_organization_id: organizationId,
    p_request_ids: links.map((l) => l.request_id),
  });
  if (sumError) throw new AttributionError(sumError.code);
  const byId = new Map((summaries ?? []).map((s) => [s.request_id, s]));
  const rows: LinkedRequest[] = [];
  for (const l of links) {
    const s = byId.get(l.request_id);
    if (!s) continue;
    rows.push({
      requestId: l.request_id,
      opportunityId: l.opportunity_id,
      opportunityTitle: l.opportunity_title,
      linkMethod: l.link_method,
      linkedAt: l.linked_at,
      state: s.state,
      source: s.source,
      serviceType: s.service_type,
      createdAt: s.created_at,
      preferredDate: s.preferred_date,
      passengerLinked: s.passenger_linked,
      decisionReasonCode: s.decision_reason_code,
      tripsTotal: s.trips_total,
      tripsCompleted: s.trips_completed,
      tripsCancelled: s.trips_cancelled,
      firstCompletedAt: s.first_completed_at,
      arrangementCount: s.arrangement_count,
      arrangementStatus: s.arrangement_status,
    });
  }
  return { rows, total: Number(links[0].total_count) };
}
