import "server-only";
import type { OrganizationContext } from "@/lib/auth/types";
import { getWebsiteIntakeEndpoint, listWebsiteIntegrations } from "./website-integration";
import { deriveWebsiteIntegrationStatus, formatIntegrationDate, formatIntegrationTimestamp } from "./website-integration-core";
import { WEBSITE_REQUESTS_STATUS_EXPLANATION, WEBSITE_REQUESTS_STATUS_LABEL, connectionMethodLabel } from "./website-requests-core";
import type { WebsiteRequestsConnectionView } from "@/components/operations/settings/WebsiteConnectionControls";

export interface WebsiteRequestsContext {
  connections: WebsiteRequestsConnectionView[];
  /** The connection these screens are about: `?connection=<handle>` when it is one of THIS organization's, else the first. */
  selected: WebsiteRequestsConnectionView | null;
  endpoint: string;
}

/**
 * Connections of the server-resolved organization for the Website Requests sub-screens. The optional `connection` query
 * value is only ever matched against this organization's own list (the list itself is authorized by the database), so a
 * foreign or invented handle simply falls back to the first connection.
 */
export async function loadWebsiteRequestsContext(organization: OrganizationContext, connectionParam?: string | string[]): Promise<WebsiteRequestsContext> {
  const [integrations, endpoint] = await Promise.all([listWebsiteIntegrations(organization.organizationId), getWebsiteIntakeEndpoint()]);
  const tz = organization.organizationTimezone;
  const connections = integrations.map<WebsiteRequestsConnectionView>((integration) => {
    const status = deriveWebsiteIntegrationStatus(integration);
    return {
      handle: integration.id,
      integrationId: integration.integrationId,
      website: integration.website,
      isActive: integration.isActive,
      status,
      statusLabel: WEBSITE_REQUESTS_STATUS_LABEL[status],
      statusExplanation: WEBSITE_REQUESTS_STATUS_EXPLANATION[status],
      requestCount: integration.requestCount,
      lastRequestReceived: formatIntegrationTimestamp(integration.lastRequestReceivedAt, tz),
      created: formatIntegrationDate(integration.createdAt, tz),
      connectionMethod: integration.connectionMethod,
      websiteManager: integration.websiteManager,
      methodLabel: connectionMethodLabel(integration.connectionMethod),
    };
  });
  const wanted = typeof connectionParam === "string" ? connectionParam : undefined;
  const selected = connections.find((c) => c.handle === wanted) ?? connections[0] ?? null;
  return { connections, selected, endpoint };
}
