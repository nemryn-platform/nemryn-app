"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeWebsiteOrigin } from "@/lib/operations/website-integration-core";
import {
  mapWebsiteIntegrationError,
  websiteIntegrationErrorMessage,
  type WebsiteIntegrationOperation,
} from "@/lib/operations/website-integration-errors";

export interface WebsiteIntegrationActionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** What was submitted, echoed back so a rejected save never wipes the field. */
  website?: string;
}

const PAGE = "/operations/settings/integrations";

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function guard() {
  const pathname = await getCurrentPathname(PAGE);
  return requireOrganizationAdminAccess(pathname);
}

const INVALID_ORIGIN_MESSAGE = websiteIntegrationErrorMessage("INVALID_INPUT", "create");

/**
 * Connect website. Organization Admin only -- re-derived on every call, and
 * enforced again by the database. The organization comes ONLY from the
 * validated session workspace; the form carries just the website address.
 * The Integration ID, active flag, type and actor are all generated/fixed by
 * `create_request_intake_integration`.
 */
export async function createWebsiteIntegrationAction(
  _prev: WebsiteIntegrationActionState,
  formData: FormData,
): Promise<WebsiteIntegrationActionState> {
  const organization = await guard();
  const website = stringField(formData, "website");
  if (!normalizeWebsiteOrigin(website)) {
    return { status: "error", message: INVALID_ORIGIN_MESSAGE, website };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_request_intake_integration", {
    p_organization_id: organization.organizationId,
    p_origin: website,
  });
  if (error) {
    return { status: "error", message: websiteIntegrationErrorMessage(mapWebsiteIntegrationError(error.code), "create"), website };
  }

  revalidatePath(PAGE);
  return {
    status: "success",
    message: data?.changed ? "Connection created." : "This website is already connected.",
  };
}

/** Activate / Disable intake (kill switch). The integration id is an opaque handle authorized against the caller's own organization inside the RPC. */
export async function setWebsiteIntegrationActiveAction(
  _prev: WebsiteIntegrationActionState,
  formData: FormData,
): Promise<WebsiteIntegrationActionState> {
  await guard();
  const active = stringField(formData, "active") === "true";
  const operation: WebsiteIntegrationOperation = active ? "activate" : "disable";

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("set_request_intake_integration_active", {
    p_integration_id: stringField(formData, "integrationHandle"),
    p_active: active,
  });
  if (error) {
    return { status: "error", message: websiteIntegrationErrorMessage(mapWebsiteIntegrationError(error.code), operation) };
  }

  revalidatePath(PAGE);
  if (!data?.changed) {
    return { status: "success", message: active ? "Already active." : "Already disabled." };
  }
  return {
    status: "success",
    message: active ? "Website intake is on. New requests will be accepted." : "Website intake is off. New requests will not be accepted.",
  };
}

/** Edit website. An active connection whose website changes is automatically disabled by the database and must be re-activated. */
export async function updateWebsiteIntegrationOriginAction(
  _prev: WebsiteIntegrationActionState,
  formData: FormData,
): Promise<WebsiteIntegrationActionState> {
  await guard();
  const website = stringField(formData, "website");
  if (!normalizeWebsiteOrigin(website)) {
    return { status: "error", message: INVALID_ORIGIN_MESSAGE, website };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("update_request_intake_integration_origin", {
    p_integration_id: stringField(formData, "integrationHandle"),
    p_origin: website,
  });
  if (error) {
    return { status: "error", message: websiteIntegrationErrorMessage(mapWebsiteIntegrationError(error.code), "update_origin"), website };
  }

  revalidatePath(PAGE);
  if (!data?.changed) {
    return { status: "success", message: "No changes to save.", website };
  }
  return {
    status: "success",
    message: data.deactivated
      ? "Website updated. Intake was turned off — review the new address, then activate again."
      : "Website updated.",
    website,
  };
}
