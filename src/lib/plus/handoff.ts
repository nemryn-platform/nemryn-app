import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getActivePassengerOptions } from "@/lib/operations/recurring-arrangement-options";
import { getInquiry } from "./inquiries";
import { listOpportunityQuotes } from "./quotes";
import { handoffPrefill, rankPassengerChoices, type HandoffPrefill, type PassengerChoice } from "./handoff-core";

export interface HandoffContext {
  prefill: HandoffPrefill;
  /** null = the passenger list could not be loaded: the form keeps today's flow (decide on the request page). */
  passengers: PassengerChoice[] | null;
}

/**
 * Growth -> Core handoff hints (NP-PILOT-P1) for the conversion / rebooking dialog. Read with the caller's own
 * per-request client (RLS + RPC checks): the opportunity's inquiry answer, its quotes, the contact's earlier requests
 * and this organization's ACTIVE passengers. Any read that fails simply drops its hint -- never an error page, never a
 * guessed value.
 */
export async function getHandoffContext(
  organizationId: string,
  input: { opportunityId?: string | null; contactId: string; contactName: string; contactPhone: string | null; contactKind: string | null },
): Promise<HandoffContext> {
  const supabase = await createServerSupabaseClient();

  let inquiryRelationship: string | null = null;
  let quotes: { quoteNumber: number; kind: string; status: string; roundTrip: boolean; isExpired: boolean }[] = [];
  if (input.opportunityId) {
    const [inq, q] = await Promise.allSettled([
      (async () => {
        const { data } = await supabase.from("plus_opportunities").select("inquiry_id").eq("organization_id", organizationId).eq("id", input.opportunityId as string).maybeSingle();
        return data?.inquiry_id ? (await getInquiry(organizationId, data.inquiry_id))?.relationship ?? null : null;
      })(),
      listOpportunityQuotes(organizationId, input.opportunityId),
    ]);
    if (inq.status === "fulfilled") inquiryRelationship = inq.value;
    if (q.status === "fulfilled") quotes = q.value;
  }

  let passengers: PassengerChoice[] | null = null;
  try {
    const [options, links] = await Promise.all([
      getActivePassengerOptions(organizationId),
      supabase.from("plus_request_attributions").select("request_id").eq("organization_id", organizationId).eq("contact_id", input.contactId),
    ]);
    const requestIds = (links.data ?? []).map((l) => l.request_id);
    let previous: string[] = [];
    if (requestIds.length > 0) {
      const { data } = await supabase.from("transportation_requests").select("passenger_id").eq("organization_id", organizationId).in("id", requestIds);
      previous = (data ?? []).map((r) => r.passenger_id).filter((v): v is string => Boolean(v));
    }
    passengers = rankPassengerChoices(options, { name: input.contactName, phone: input.contactPhone }, previous);
  } catch {
    passengers = null;
  }

  return { prefill: handoffPrefill({ inquiryRelationship, contactKind: input.contactKind, quotes }), passengers };
}
