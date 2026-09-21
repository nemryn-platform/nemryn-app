import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAppOrigin } from "@/lib/app-url";
import { WEBSITE_INTAKE_PATH } from "./website-integration-core";

export interface WebsiteIntegration {
  /** Opaque handle for the management actions only -- never displayed to a customer. */
  id: string;
  /** The customer-facing "Integration ID" (web_XXXXXXXXXXXX). */
  integrationId: string;
  isActive: boolean;
  /** The configured website origin, or null for a legacy row that has none configured. */
  website: string | null;
  createdAt: string;
  requestCount: number;
  lastRequestReceivedAt: string | null;
  /** D1 guidance preference; null = a connection that predates D1 ("Existing connection"). */
  connectionMethod: string | null;
  /** D1 guidance preference (who manages the website); null = not chosen. */
  websiteManager: string | null;
}

/**
 * Tenant-scoped Website Integration read model (P1-PILOT-S4B-R4B). Goes
 * through `list_request_intake_integrations`, which authorizes the caller as
 * an Organization Admin of `organizationId` -- the locked
 * request_intake_integrations table itself has no client grant or policy and
 * is never read directly here. `organizationId` is ALWAYS the server-resolved
 * workspace (requireOrganizationAdminAccess), never a browser value.
 * Requests received / last received are derived from the Requests actually
 * tied to each integration.
 */
export async function listWebsiteIntegrations(organizationId: string): Promise<WebsiteIntegration[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_request_intake_integrations", {
    p_organization_id: organizationId,
  });

  if (error) {
    throw new Error("Failed to load website integrations");
  }

  return (data ?? [])
    .filter((row) => row.integration_type === "website")
    .map((row) => ({
      id: row.id,
      integrationId: row.external_id,
      isActive: row.is_active,
      website: row.allowed_origins?.[0] ?? null,
      createdAt: row.created_at,
      requestCount: Number(row.request_count),
      lastRequestReceivedAt: row.last_request_received_at,
      connectionMethod: row.connection_method,
      websiteManager: row.website_manager,
    }));
}

/** The public endpoint a customer's website server posts to -- built from this deployment's own canonical origin, never hard-coded. */
export async function getWebsiteIntakeEndpoint(): Promise<string> {
  return `${await getAppOrigin()}${WEBSITE_INTAKE_PATH}`;
}
