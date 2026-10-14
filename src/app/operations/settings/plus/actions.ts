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
