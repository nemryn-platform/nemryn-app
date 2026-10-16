"use server";

import { revalidatePath } from "next/cache";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import { attributionErrorMessage, isUuid, parseAttributionChoice, validateCorrectionReason } from "@/lib/plus/attribution-core";
import { stageDisplayLabel } from "@/lib/plus/opportunities-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Request attribution actions (NP-P2-S3), used by the Growth panel on Operations -> Request detail. Each re-checks Growth
 * access (requirePlusAccess: the Operations role + a Plus entitlement / grant), the organization binding of the form,
 * and the write capability. The RPCs re-check everything again, including the Core request-read role, tenancy and
 * consistency. Nothing here touches the Core Request itself.
 */

const WRONG_ORGANIZATION = "You switched to a different organization since this page was loaded. Reload the page before making changes.";
const NO_WRITE = "You can view Growth links but not change them. Ask an Organization Admin for write access.";

export interface AttributionActionState {
  status: "idle" | "success" | "error";
  message?: string;
}
export interface LinkOption {
  value: string;
  label: string;
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

async function guard(organizationId: string, write: boolean) {
  const pathname = await getCurrentPathname("/operations/requests");
  const { context, plus } = await requirePlusAccess(pathname);
  if (organizationId !== context.organizationId) return { error: WRONG_ORGANIZATION } as const;
  if (write && !canWriteGrowth(plus.state, plus.capability)) return { error: NO_WRITE } as const;
  return { context } as const;
}

function refresh(requestId: string) {
  revalidatePath(`/operations/requests/${requestId}`);
  revalidatePath("/operations/growth", "layout");
}

/** Active contacts matching a search, for the "Track in Plus" picker (never creates or merges contacts). */
export async function searchLinkContactsAction(organizationId: string, query: string): Promise<{ options: LinkOption[]; error?: string }> {
  const g = await guard(organizationId, true);
  if ("error" in g) return { options: [], error: g.error };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_contacts", {
    p_organization_id: g.context.organizationId,
    p_search: (query.trim().slice(0, 200) || null) as string,
    p_contact_kind: null as unknown as string,
    p_status: "active",
    p_limit: 20,
    p_offset: 0,
  });
  if (error) return { options: [], error: attributionErrorMessage(error.code) };
  return { options: (data ?? []).map((c) => ({ value: c.contact_id, label: c.display_name })) };
}

/** The chosen contact's private-pay opportunities (any stage), for the optional opportunity choice. */
export async function contactOpportunitiesAction(organizationId: string, contactId: string): Promise<{ options: LinkOption[]; error?: string }> {
  const g = await guard(organizationId, true);
  if ("error" in g) return { options: [], error: g.error };
  if (!isUuid(contactId)) return { options: [] };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_opportunities", {
    p_organization_id: g.context.organizationId,
    p_search: null as unknown as string,
    p_view: "all",
    p_stage: null as unknown as string,
    p_source: null as unknown as string,
    p_owner_membership_id: null as unknown as string,
    p_contact_id: contactId,
    p_limit: 50,
    p_offset: 0,
  });
  if (error) return { options: [], error: attributionErrorMessage(error.code) };
  return { options: (data ?? []).map((o) => ({ value: o.opportunity_id, label: `${o.title} (${stageDisplayLabel(o.stage)})` })) };
}

/** Links this existing Request to a contact and/or one of that contact's opportunities. Never changes the Request. */
export async function linkRequestAction(_prev: AttributionActionState, formData: FormData): Promise<AttributionActionState> {
  const g = await guard(text(formData, "organizationId"), true);
  if ("error" in g) return { status: "error", message: g.error };
  const requestId = text(formData, "requestId");
  if (!isUuid(requestId)) return { status: "error", message: "Reload the page and try again." };
  const choice = parseAttributionChoice(text(formData, "contactId"), text(formData, "opportunityId"));
  if (!choice.ok) return { status: "error", message: choice.error };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_link_request", {
    p_organization_id: g.context.organizationId,
    p_request_id: requestId,
    p_contact_id: choice.value.contactId as string,
    p_opportunity_id: choice.value.opportunityId as string,
  });
  if (error || !data) {
    console.error("[plus] request link failed", error?.code ?? "no_data");
    return { status: "error", message: attributionErrorMessage(error?.code) };
  }
  refresh(requestId);
  return { status: "success", message: data.changed ? "Linked in Growth. The request itself is unchanged." : "This request was already linked that way." };
}

/** Corrects an existing link (required reason). Never deletes the link and never changes the Request. */
export async function correctAttributionAction(_prev: AttributionActionState, formData: FormData): Promise<AttributionActionState> {
  const g = await guard(text(formData, "organizationId"), true);
  if ("error" in g) return { status: "error", message: g.error };
  const requestId = text(formData, "requestId");
  const expected = text(formData, "expectedVersion");
  if (!isUuid(requestId) || !expected) return { status: "error", message: "Reload the page and try again." };
  const choice = parseAttributionChoice(text(formData, "contactId"), text(formData, "opportunityId"));
  if (!choice.ok) return { status: "error", message: choice.error };
  const reason = validateCorrectionReason(text(formData, "reason"));
  if (!reason.ok) return { status: "error", message: reason.error };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_update_request_attribution", {
    p_organization_id: g.context.organizationId,
    p_request_id: requestId,
    p_expected_updated_at: expected,
    p_contact_id: choice.value.contactId as string,
    p_opportunity_id: choice.value.opportunityId as string,
    p_reason: reason.value,
  });
  if (error || !data) {
    console.error("[plus] attribution correction failed", error?.code ?? "no_data");
    return { status: "error", message: attributionErrorMessage(error?.code, error?.message) };
  }
  refresh(requestId);
  return { status: "success", message: data.changed ? "Link corrected. The request itself is unchanged." : "Nothing changed: the link already matches." };
}
