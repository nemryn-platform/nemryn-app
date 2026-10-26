"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  TEAM_ACCESS_WRONG_ORGANIZATION_MESSAGE,
  plusAccessLabel,
  teamAccessErrorMessage,
  validateTeamChangeInput,
} from "@/lib/plus/team-access-core";
import { inquiryErrorMessage, validateInquiryFormSettings } from "@/lib/plus/inquiries-core";
import { InquiriesError, getInquiryFormSettings } from "@/lib/plus/inquiries";

export interface PlusTeamActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

const PAGE = "/operations/settings/plus";

/**
 * Settings -> Nemryn Plus -> Team access (NP-P1-S3): give, change or remove a staff member's Plus access.
 *
 * - Organization Admin only: re-derived here on every call (`requireOrganizationAdminAccess`) and enforced again by
 *   the database (`plus_grant_member_access` / `plus_revoke_member_access`), which never trusts this action.
 * - Target organization: the change always runs against the caller's CURRENT session workspace, and the form must
 *   have been rendered for that same workspace -- a tab left open after switching organization is refused.
 * - The browser supplies only an opaque membership handle, the requested change and the version of the grant it
 *   showed. The database checks the membership belongs to the organization, its role / status, the entitlement and
 *   the version (ZW003 when someone else changed it first).
 */
export async function changePlusTeamAccessAction(_prev: PlusTeamActionState, formData: FormData): Promise<PlusTeamActionState> {
  const pathname = await getCurrentPathname(PAGE);
  const organization = await requireOrganizationAdminAccess(pathname);

  const input = validateTeamChangeInput({
    handle: formData.get("handle"),
    change: formData.get("change"),
    expectedGrant: formData.get("expectedGrant"),
    organizationId: formData.get("organizationId"),
  });
  if (!input.ok) return { status: "error", message: input.error };
  if (input.organizationId !== organization.organizationId) {
    return { status: "error", message: TEAM_ACCESS_WRONG_ORGANIZATION_MESSAGE };
  }

  const supabase = await createServerSupabaseClient();
  // Generated Args types have no nullability (repository convention: cast); NULL = "no active grant expected".
  const expectedGrantId = input.expectedGrantId as string;
  const { data, error } =
    input.change === "none"
      ? await supabase.rpc("plus_revoke_member_access", {
          p_organization_id: organization.organizationId,
          p_membership_id: input.handle,
          p_expected_grant_id: expectedGrantId,
        })
      : await supabase.rpc("plus_grant_member_access", {
          p_organization_id: organization.organizationId,
          p_membership_id: input.handle,
          p_access: input.change,
          p_expected_grant_id: expectedGrantId,
        });
  if (error || !data) {
    console.error("[plus] team access change failed", error?.code ?? "no_data");
    return { status: "error", message: teamAccessErrorMessage(error?.code) };
  }

  revalidatePath(PAGE);
  revalidatePath("/operations", "layout");
  if (!data.changed) {
    return { status: "success", message: "No change was needed: that access was already in place." };
  }
  return {
    status: "success",
    message: input.change === "none" ? "Nemryn Plus access removed." : `Nemryn Plus access set to ${plusAccessLabel(input.change).toLowerCase()}.`,
  };
}

// ---------------------------------------------------------------------------
// Settings -> Nemryn Plus -> Inquiry form (NP-P2-S7-C)
// ---------------------------------------------------------------------------

export interface InquiryFormActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: { headline?: string; introText?: string; services?: string };
}

/**
 * Save / publish / disable the organization's public inquiry form. Organization Admin only (re-derived here) and the
 * form must have been rendered for the CURRENT session workspace; the S7-A RPCs re-check admin + Plus write, the
 * version (ZW003) and the services. Publishing additionally needs Nemryn's per-organization activation (ZW004
 * public_access_not_enabled otherwise) -- and public submissions also need the PLUS_INQUIRY_SUBMISSIONS server switch.
 * Neither gate can be changed from here.
 */
export async function inquiryFormAction(_prev: InquiryFormActionState, formData: FormData): Promise<InquiryFormActionState> {
  const pathname = await getCurrentPathname(PAGE);
  const organization = await requireOrganizationAdminAccess(pathname);
  if (formData.get("organizationId") !== organization.organizationId) {
    return { status: "error", message: TEAM_ACCESS_WRONG_ORGANIZATION_MESSAGE };
  }
  const intent = formData.get("intent");
  const rawVersion = formData.get("expectedVersion");
  const version = typeof rawVersion === "string" && rawVersion !== "" ? Number.parseInt(rawVersion, 10) : null;
  if (version !== null && (!Number.isInteger(version) || version < 1)) return { status: "error", message: inquiryErrorMessage("ZW006") };

  const supabase = await createServerSupabaseClient();
  if (intent === "save") {
    let allowed: string[];
    try {
      allowed = (await getInquiryFormSettings(organization.organizationId)).serviceOptions;
    } catch (e) {
      return { status: "error", message: inquiryErrorMessage(e instanceof InquiriesError ? e.code : undefined) };
    }
    const input = validateInquiryFormSettings({ headline: formData.get("headline"), introText: formData.get("introText"), services: formData.getAll("services") }, allowed);
    if (!input.ok) return { status: "error", message: "Check the highlighted fields.", fieldErrors: input.errors };
    const { data, error } = await supabase.rpc("plus_save_inquiry_form", {
      p_organization_id: organization.organizationId,
      p_headline: input.value.headline,
      p_intro_text: input.value.introText as string,
      p_offered_service_types: input.value.services,
      p_expected_version: version as number,
    });
    if (error || !data) return { status: "error", message: inquiryErrorMessage(error?.code, error?.message) };
    revalidatePath(PAGE);
    return { status: "success", message: data.changed ? (data.status === "published" ? "Saved. The live form now shows these changes." : "Saved.") : "No changes to save." };
  }
  if (intent !== "publish" && intent !== "disable") return { status: "error", message: inquiryErrorMessage("ZW006") };
  if (version === null) return { status: "error", message: "Save the form first." };
  const { data, error } =
    intent === "publish"
      ? await supabase.rpc("plus_publish_inquiry_form", { p_organization_id: organization.organizationId, p_expected_version: version })
      : await supabase.rpc("plus_disable_inquiry_form", { p_organization_id: organization.organizationId, p_expected_version: version });
  if (error || !data) return { status: "error", message: inquiryErrorMessage(error?.code, error?.message) };
  revalidatePath(PAGE);
  if (!data.changed) return { status: "success", message: intent === "publish" ? "The form is already published." : "The form is already turned off." };
  return { status: "success", message: intent === "publish" ? "Published." : "The form is turned off. Its link and website code now show that it isn't available." };
}
