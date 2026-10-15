"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import {
  isOpenStage,
  isUuid,
  opportunityErrorMessage,
  validateLostInput,
  validateOpportunityForm,
  validateReopenInput,
  type OpportunityFieldErrors,
  type OpportunityFormValues,
} from "@/lib/plus/opportunities-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const PIPELINE = "/operations/growth/pipeline";
const WRONG_ORGANIZATION =
  "You switched to a different organization since this page was loaded. Reload the page before making changes.";
const NO_WRITE = "You can view the pipeline but not change it. Ask an Organization Admin for write access.";

export interface OpportunityFormState {
  status: "idle" | "error";
  message?: string;
  errors?: OpportunityFieldErrors;
  values?: OpportunityFormValues;
}

export interface OpportunityActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function readValues(formData: FormData): OpportunityFormValues {
  return {
    contactId: text(formData, "contactId"),
    title: text(formData, "title").slice(0, 260),
    inquiryType: text(formData, "inquiryType"),
    serviceType: text(formData, "serviceType"),
    source: text(formData, "source"),
    sourceDetail: text(formData, "sourceDetail").slice(0, 160),
    campaignCode: text(formData, "campaignCode").slice(0, 80),
    estimate: text(formData, "estimate").slice(0, 20),
    paymentReportedStatus: text(formData, "paymentReportedStatus"),
    ownerHandle: text(formData, "ownerHandle"),
  };
}

/** Growth guard + organization binding (the session workspace; the form must have been rendered for it) + write. */
async function guardWrite(formData: FormData) {
  const pathname = await getCurrentPathname(PIPELINE);
  const { context, plus } = await requirePlusAccess(pathname);
  if (text(formData, "organizationId") !== context.organizationId) return { error: WRONG_ORGANIZATION } as const;
  if (!canWriteGrowth(plus.state, plus.capability)) return { error: NO_WRITE } as const;
  return { context } as const;
}

/** New private-pay opportunity for an existing, active contact. Never creates a Core Request, Passenger or Trip. */
export async function createOpportunityAction(_prev: OpportunityFormState, formData: FormData): Promise<OpportunityFormState> {
  const values = readValues(formData);
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error, values };
  const parsed = validateOpportunityForm(values);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, values };
  const v = parsed.value;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_create_opportunity", {
    p_organization_id: guard.context.organizationId,
    p_contact_id: v.contactId,
    p_title: v.title,
    p_inquiry_type: v.inquiryType,
    p_service_type: v.serviceType as string,
    p_source: v.source,
    p_source_detail: v.sourceDetail as string,
    p_campaign_code: v.campaignCode as string,
    p_estimated_value_cents: v.estimatedValueCents as number,
    p_owner_membership_id: v.ownerHandle as string,
  });
  if (error || !data?.opportunity_id) {
    console.error("[plus] create opportunity failed", error?.code ?? "no_data");
    return { status: "error", message: opportunityErrorMessage(error?.code, "save"), values };
  }
  revalidatePath(PIPELINE);
  redirect(`${PIPELINE}/${data.opportunity_id}?saved=created`);
}

/** Edit an open opportunity. The version the form was rendered from must still be current (ZW003 otherwise). */
export async function updateOpportunityAction(_prev: OpportunityFormState, formData: FormData): Promise<OpportunityFormState> {
  const values = readValues(formData);
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error, values };
  const opportunityId = text(formData, "opportunityId");
  const expected = text(formData, "expectedVersion");
  if (!isUuid(opportunityId) || !expected || Number.isNaN(Date.parse(expected))) {
    return { status: "error", message: "Reload the page and try again.", values };
  }
  const parsed = validateOpportunityForm(values);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, values };
  const v = parsed.value;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_update_opportunity", {
    p_organization_id: guard.context.organizationId,
    p_opportunity_id: opportunityId,
    p_expected_updated_at: expected,
    p_contact_id: v.contactId,
    p_title: v.title,
    p_inquiry_type: v.inquiryType,
    p_service_type: v.serviceType as string,
    p_source: v.source,
    p_source_detail: v.sourceDetail as string,
    p_campaign_code: v.campaignCode as string,
    p_estimated_value_cents: v.estimatedValueCents as number,
    p_payment_reported_status: v.paymentReportedStatus,
    p_owner_membership_id: v.ownerHandle as string,
  });
  if (error || !data) {
    console.error("[plus] update opportunity failed", error?.code ?? "no_data");
    return { status: "error", message: opportunityErrorMessage(error?.code, "save"), values };
  }
  revalidatePath(PIPELINE);
  revalidatePath(`${PIPELINE}/${opportunityId}`);
  redirect(`${PIPELINE}/${opportunityId}?saved=${data.changed ? "updated" : "unchanged"}`);
}

function common(formData: FormData) {
  const opportunityId = text(formData, "opportunityId");
  const expected = text(formData, "expectedVersion");
  return isUuid(opportunityId) && expected && !Number.isNaN(Date.parse(expected)) ? { opportunityId, expected } : null;
}

/** Move an open opportunity to another open stage (forward or back). Lost / converted are not reachable here. */
export async function changeStageAction(_prev: OpportunityActionState, formData: FormData): Promise<OpportunityActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const c = common(formData);
  const to = text(formData, "toStage");
  const note = text(formData, "note").trim();
  if (!c) return { status: "error", message: "Reload the page and try again." };
  if (!isOpenStage(to)) return { status: "error", message: opportunityErrorMessage("ZW006", "stage") };
  if (note.length > 500) return { status: "error", message: "Use 500 characters or fewer." };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_change_opportunity_stage", {
    p_organization_id: guard.context.organizationId,
    p_opportunity_id: c.opportunityId,
    p_expected_updated_at: c.expected,
    p_to_stage: to,
    p_note: (note || null) as string,
  });
  if (error || !data) return { status: "error", message: opportunityErrorMessage(error?.code, "stage") };
  revalidatePath(PIPELINE);
  revalidatePath(`${PIPELINE}/${c.opportunityId}`);
  return { status: "success", message: data.changed ? "Stage updated." : "It was already in that stage." };
}

export async function markLostAction(_prev: OpportunityActionState, formData: FormData): Promise<OpportunityActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const c = common(formData);
  if (!c) return { status: "error", message: "Reload the page and try again." };
  const parsed = validateLostInput(formData.get("lostReason"), formData.get("lostNote"));
  if (!parsed.ok) return { status: "error", message: parsed.error };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_mark_opportunity_lost", {
    p_organization_id: guard.context.organizationId,
    p_opportunity_id: c.opportunityId,
    p_expected_updated_at: c.expected,
    p_lost_reason: parsed.reason,
    p_lost_note: parsed.note as string,
  });
  if (error || !data) return { status: "error", message: opportunityErrorMessage(error?.code, "lost") };
  revalidatePath(PIPELINE);
  revalidatePath(`${PIPELINE}/${c.opportunityId}`);
  return { status: "success", message: data.changed ? "Marked as lost." : "It was already marked as lost." };
}

export async function reopenAction(_prev: OpportunityActionState, formData: FormData): Promise<OpportunityActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const c = common(formData);
  if (!c) return { status: "error", message: "Reload the page and try again." };
  const parsed = validateReopenInput(formData.get("toStage"), formData.get("reason"));
  if (!parsed.ok) return { status: "error", message: parsed.error };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_reopen_opportunity", {
    p_organization_id: guard.context.organizationId,
    p_opportunity_id: c.opportunityId,
    p_expected_updated_at: c.expected,
    p_to_stage: parsed.stage,
    p_reason: parsed.reason,
  });
  if (error || !data) return { status: "error", message: opportunityErrorMessage(error?.code, "reopen") };
  revalidatePath(PIPELINE);
  revalidatePath(`${PIPELINE}/${c.opportunityId}`);
  return { status: "success", message: "Opportunity reopened." };
}
