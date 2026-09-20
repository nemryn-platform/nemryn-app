"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  toSettingsPatch,
  validateOrganizationSettings,
  type OrganizationSettingsFieldErrors,
  type OrganizationSettingsValues,
} from "@/lib/operations/organization-settings-core";
import {
  mapOrganizationSettingsError,
  organizationSettingsErrorMessage,
} from "@/lib/operations/organization-settings-errors";

export interface OrganizationSettingsActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: OrganizationSettingsFieldErrors;
  /** What the person submitted, echoed back so a failed save never wipes their edits (React resets uncontrolled form fields after every action). */
  values?: OrganizationSettingsValues;
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Settings -> Organization save. Organization Admin only, enforced here
 * (re-derived fresh on every call via requireOrganizationAdminAccess) AND
 * by the database. The organization is NEVER read from the form: the only
 * source of `p_organization_id` is the validated session's own current
 * workspace, so there is no hidden field for a crafted request to tamper
 * with. The RPC is the sole write path and records the AuditEvent.
 */
export async function updateOrganizationSettingsAction(
  _prevState: OrganizationSettingsActionState,
  formData: FormData,
): Promise<OrganizationSettingsActionState> {
  const pathname = await getCurrentPathname("/operations/settings/organization");
  const organization = await requireOrganizationAdminAccess(pathname);

  const submitted: OrganizationSettingsValues = {
    name: stringField(formData, "name"),
    timezone: stringField(formData, "timezone"),
    businessPhone: stringField(formData, "businessPhone"),
    businessEmail: stringField(formData, "businessEmail"),
    businessAddress: stringField(formData, "businessAddress"),
    primaryContactName: stringField(formData, "primaryContactName"),
  };
  const validation = validateOrganizationSettings(submitted);
  if (!validation.ok) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: validation.fieldErrors,
      values: submitted,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("update_organization_settings", {
    p_organization_id: organization.organizationId,
    p_changes: toSettingsPatch(validation.values),
  });

  if (error) {
    return {
      status: "error",
      message: organizationSettingsErrorMessage(mapOrganizationSettingsError(error.code)),
      values: validation.values,
    };
  }

  // The Operations layout resolves the workspace name/timezone per request;
  // revalidate the whole /operations tree so the sidebar's workspace name
  // and every timezone-derived surface pick up the change immediately.
  revalidatePath("/operations", "layout");

  return {
    status: "success",
    message: data?.changed ? "Organization settings saved." : "No changes to save.",
    values: validation.values,
  };
}
