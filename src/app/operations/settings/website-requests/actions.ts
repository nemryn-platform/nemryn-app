"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeWebsiteOrigin } from "@/lib/operations/website-integration-core";
import { CONNECTION_METHOD_VALUES, isWebsiteManager, validateFormInput } from "@/lib/operations/website-requests-core";
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

const PAGE = "/operations/settings/website-requests";
/** Every Website Requests screen shows connection state; revalidate the whole subtree after any change. */
function refresh() {
  revalidatePath(PAGE, "layout");
}

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

  refresh();
  return {
    status: "success",
    message: data?.changed ? "Website connected. Turn it on when you are ready to receive requests." : "This website is already connected.",
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

  refresh();
  if (!data?.changed) {
    return { status: "success", message: active ? "Already active." : "Already disabled." };
  }
  return {
    status: "success",
    message: active ? "Website requests are on. New requests from your website will be accepted." : "Website requests are off. New requests from your website will not be accepted.",
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

  refresh();
  if (!data?.changed) {
    return { status: "success", message: "No changes to save.", website };
  }
  return {
    status: "success",
    message: data.deactivated
      ? "Website updated. Requests were turned off — check the new address, then turn them on again."
      : "Website updated.",
    website,
  };
}

// ---------------------------------------------------------------------------
// D1 additions: guidance preferences and the Nemryn form configuration
// ---------------------------------------------------------------------------
const FORM_PAGE = "/operations/settings/website-requests/form";

export interface ConnectionSetupActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

/**
 * Saves the operator's connection method / "who manages your website" choice for ONE of their own integrations.
 * These are GUIDANCE preferences only (instructions and language): there is one intake engine underneath and nothing
 * here changes what the endpoint accepts. Authorization: Organization Admin (guard) and again inside
 * `set_request_intake_integration_setup`, which derives the owner from the integration row. Nothing tenant-scoped comes
 * from the browser except the opaque handle, which the database authorizes.
 */
export async function saveConnectionSetupAction(
  _prev: ConnectionSetupActionState,
  formData: FormData,
): Promise<ConnectionSetupActionState> {
  await guard();
  const methodRaw = stringField(formData, "connectionMethod");
  const managerRaw = stringField(formData, "websiteManager");
  const connectionMethod = (CONNECTION_METHOD_VALUES as readonly string[]).includes(methodRaw) ? methodRaw : null;
  const websiteManager = isWebsiteManager(managerRaw) ? managerRaw : null;

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("set_request_intake_integration_setup", {
    p_integration_id: stringField(formData, "integrationHandle"),
    p_connection_method: connectionMethod ?? undefined,
    p_website_manager: websiteManager ?? undefined,
  });
  if (error) {
    return { status: "error", message: websiteIntegrationErrorMessage(mapWebsiteIntegrationError(error.code), "disable") };
  }
  refresh();
  return { status: "success", message: "Saved." };
}

export interface WebsiteRequestFormActionState {
  status: "idle" | "success" | "error";
  message?: string;
  field?: string;
}

/**
 * Saves the organization's Nemryn form configuration. Organization Admin only (guard + the database re-checks Membership,
 * role and an ACTIVE organization). The organization always comes from the validated session workspace, never the browser;
 * the form carries only the copy, the service selection and the two switches. The database validates every bound again and
 * that any service subset is currently offered by the organization (Services & Intake stays the only source of truth).
 */
export async function saveWebsiteRequestFormAction(
  _prev: WebsiteRequestFormActionState,
  formData: FormData,
): Promise<WebsiteRequestFormActionState> {
  const organization = await guard();
  const parsed = validateFormInput({
    status: stringField(formData, "status"),
    title: stringField(formData, "title"),
    introText: stringField(formData, "introText"),
    submitLabel: stringField(formData, "submitLabel"),
    confirmationMessage: stringField(formData, "confirmationMessage"),
    serviceSelection: formData.getAll("service").filter((v): v is string => typeof v === "string"),
    everyService: stringField(formData, "serviceMode") !== "subset",
    allowRecurring: stringField(formData, "allowRecurring") === "on",
    requireServiceChoice: stringField(formData, "requireServiceChoice") === "on",
  });
  if (!parsed.ok) return { status: "error", message: parsed.message, field: parsed.field };

  const config = parsed.value;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("save_website_request_form", {
    p_organization_id: organization.organizationId,
    p_title: config.title,
    p_intro_text: config.introText ?? undefined,
    p_submit_label: config.submitLabel,
    p_confirmation_message: config.confirmationMessage,
    p_offered_service_types: config.offeredServiceTypes ?? undefined,
    p_allow_recurring: config.allowRecurring,
    p_require_service_choice: config.requireServiceChoice,
    p_status: config.status,
  });
  if (error) {
    if (error.code === "ZW006") {
      return { status: "error", field: "services", message: "One of the selected services isn't offered by your organization. Check Services & Intake, then choose again." };
    }
    return { status: "error", message: websiteIntegrationErrorMessage(mapWebsiteIntegrationError(error.code), "disable") };
  }
  revalidatePath(FORM_PAGE);
  refresh();
  return { status: "success", message: data?.changed ? (config.status === "ready" ? "Form saved and marked Ready." : "Draft saved.") : "No changes to save." };
}
