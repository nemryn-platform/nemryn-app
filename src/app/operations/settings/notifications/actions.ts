"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isNotificationEvent, validateRoleSelection } from "@/lib/operations/notification-core";

export interface NotificationActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

/**
 * Save who receives ONE notification event. Organization Admin only --
 * re-derived per call and enforced again by set_notification_settings. The
 * organization is the session workspace; the form carries only an event id
 * from a closed list and staff role names (no channel, no addresses).
 */
export async function saveNotificationSettingsAction(
  _prev: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const pathname = await getCurrentPathname("/operations/settings/notifications");
  const organization = await requireOrganizationAdminAccess(pathname);

  const event = formData.get("event");
  if (!isNotificationEvent(event)) {
    return { status: "error", message: "That notification isn't available." };
  }
  const roles = formData.getAll("role").filter((value): value is string => typeof value === "string");
  const validation = validateRoleSelection(roles);
  if (!validation.ok) {
    return { status: "error", message: validation.error };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("set_notification_settings", {
    p_organization_id: organization.organizationId,
    p_event_type: event,
    p_recipient_roles: validation.roles,
  });
  if (error) {
    return {
      status: "error",
      message:
        error.code === "ZW002"
          ? "Only an Organization Admin can change notification settings."
          : "Something went wrong saving that. Try again.",
    };
  }

  revalidatePath("/operations/settings/notifications");
  return { status: "success", message: data?.changed ? "Saved." : "No changes." };
}
