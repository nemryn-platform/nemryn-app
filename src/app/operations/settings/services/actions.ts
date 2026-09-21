"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateServiceSelection } from "@/lib/operations/organization-services-core";

export interface ServiceOfferingsActionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Echoed so a rejected save never wipes the selection. */
  selected?: string[];
}

/**
 * Save "Services we provide". Organization Admin only -- re-derived per call
 * and enforced again by set_organization_service_offerings. The organization
 * is the session workspace; the form carries only canonical service ids.
 * Affects NEW website intake for services not enabled; historical Requests are
 * untouched.
 */
export async function saveServiceOfferingsAction(
  _prev: ServiceOfferingsActionState,
  formData: FormData,
): Promise<ServiceOfferingsActionState> {
  const pathname = await getCurrentPathname("/operations/settings/services");
  const organization = await requireOrganizationAdminAccess(pathname);

  const selected = formData.getAll("service").filter((value): value is string => typeof value === "string");
  const validation = validateServiceSelection(selected);
  if (!validation.ok) {
    return { status: "error", message: validation.error, selected };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("set_organization_service_offerings", {
    p_organization_id: organization.organizationId,
    p_service_types: validation.services,
  });
  if (error) {
    const message =
      error.code === "ZW002"
        ? "Only an Organization Admin can change the services your organization provides."
        : error.code === "ZW006"
          ? "Choose at least one service your organization provides."
          : "Something went wrong saving your services. Try again.";
    return { status: "error", message, selected: validation.services };
  }

  revalidatePath("/operations/settings/services");
  revalidatePath("/operations/settings/website-requests", "layout");
  return {
    status: "success",
    message: data?.changed ? "Services saved." : "No changes to save.",
    selected: validation.services,
  };
}
