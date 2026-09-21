import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getWebsiteIntakeEndpoint, listWebsiteIntegrations } from "@/lib/operations/website-integration";
import { deriveWebsiteIntegrationStatus, formatIntegrationDate, formatIntegrationTimestamp } from "@/lib/operations/website-integration-core";
import { getServiceOfferings } from "@/lib/operations/organization-services";
import { summarizeServices } from "@/lib/operations/organization-services-core";
import { getWebsiteRequestForm } from "@/lib/operations/website-request-form";
import {
  WEBSITE_REQUESTS_STATUS_EXPLANATION,
  WEBSITE_REQUESTS_STATUS_LABEL,
  connectionMethodLabel,
  deriveFormState,
  formVersionLabel,
} from "@/lib/operations/website-requests-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { WebsiteRequestsOverview } from "@/components/operations/settings/WebsiteRequestsOverview";
import type { WebsiteRequestsConnectionView } from "@/components/operations/settings/WebsiteConnectionControls";

export const metadata = { title: "Website Requests" };

/**
 * Settings -> Website Requests (P1-COMM-D1), the customer-facing name of tenant website intake (it replaced
 * "Integrations", which only ever held website intake; /operations/settings/integrations redirects here).
 * Organization Admin only. The organization comes from the authenticated workspace; connection status is the EXISTING
 * derived status (never stored, never invented) shown in customer wording. Technical details sit behind a collapsed
 * "Technical details" disclosure; the developer package lives on its own page.
 */
export default async function WebsiteRequestsPage() {
  const pathname = await getCurrentPathname("/operations/settings/website-requests");
  const organization = await requireOrganizationAdminAccess(pathname);

  const [integrations, endpoint, services, form] = await Promise.all([
    listWebsiteIntegrations(organization.organizationId),
    getWebsiteIntakeEndpoint(),
    getServiceOfferings(organization.organizationId).catch(() => null),
    getWebsiteRequestForm(organization.organizationId).catch(() => null),
  ]);

  const tz = organization.organizationTimezone;
  const connections: WebsiteRequestsConnectionView[] = integrations.map((integration) => {
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

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Website Requests"
        description="Receive transportation requests from your website directly inside Nemryn."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Website Requests" }]}
      />
      <WebsiteRequestsOverview
        connections={connections}
        endpoint={endpoint}
        formState={deriveFormState(form)}
        formVersionLabel={form ? formVersionLabel(form.version) : null}
        servicesSummary={services === null ? null : { configured: services.length > 0, text: summarizeServices(services) }}
      />
    </div>
  );
}
