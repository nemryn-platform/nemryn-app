import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getWebsiteIntakeEndpoint, listWebsiteIntegrations } from "@/lib/operations/website-integration";
import {
  WEBSITE_INTEGRATION_STATUS_LABEL,
  deriveWebsiteIntegrationStatus,
  formatIntegrationDate,
  formatIntegrationTimestamp,
} from "@/lib/operations/website-integration-core";
import { getServiceOfferings } from "@/lib/operations/organization-services";
import { summarizeServices } from "@/lib/operations/organization-services-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { WebsiteIntakeSection, type WebsiteIntegrationView } from "@/components/operations/settings/WebsiteIntakeSection";

export const metadata = { title: "Integrations" };

/**
 * Settings -> Integrations (P1-PILOT-S4B-R4B). Organization Admin only. The
 * organization is derived from the authenticated workspace context; the read
 * model never accepts a browser-supplied tenant. Today this section is Website
 * Intake only -- future integrations will live beside it.
 */
export default async function IntegrationsSettingsPage() {
  const pathname = await getCurrentPathname("/operations/settings/integrations");
  const organization = await requireOrganizationAdminAccess(pathname);

  const [integrations, endpoint, services] = await Promise.all([
    listWebsiteIntegrations(organization.organizationId),
    getWebsiteIntakeEndpoint(),
    // Informational only (P1-PILOT-S4B-R4C): what website intake will accept.
    // A failed read simply omits the line; the integration UI never depends on it.
    getServiceOfferings(organization.organizationId).catch(() => null),
  ]);

  const tz = organization.organizationTimezone;
  const views: WebsiteIntegrationView[] = integrations.map((integration) => {
    const status = deriveWebsiteIntegrationStatus(integration);
    return {
      handle: integration.id,
      integrationId: integration.integrationId,
      website: integration.website,
      isActive: integration.isActive,
      status,
      statusLabel: WEBSITE_INTEGRATION_STATUS_LABEL[status],
      requestCount: integration.requestCount,
      lastRequestReceived: formatIntegrationTimestamp(integration.lastRequestReceivedAt, tz),
      created: formatIntegrationDate(integration.createdAt, tz),
    };
  });

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Integrations"
        description="Connect your website and external systems to Nemryn."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Integrations" }]}
      />
      <WebsiteIntakeSection
        integrations={views}
        endpoint={endpoint}
        servicesSummary={services === null ? null : { configured: services.length > 0, text: summarizeServices(services) }}
      />
    </div>
  );
}
