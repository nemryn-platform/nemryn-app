import { notFound } from "next/navigation";
import { getOrganizationDetail, getOrganizationIntegrations } from "@/lib/platform/platform";
import {
  failureReasonLabel,
  formatPlatformDate,
  formatPlatformTimestamp,
  organizationStatusCategory,
  organizationStatusLabel,
  pluralize,
} from "@/lib/platform/platform-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { OrganizationLifecycleControl } from "@/components/platform/OrganizationLifecycleControl";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Organization" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-zw-sm">
      <div>
        <h2 className={cn(typography.sectionHeading, "text-text-primary")}>{title}</h2>
        {description && <p className={cn(typography.bodySmall, "text-text-secondary")}>{description}</p>}
      </div>
      <Panel>{children}</Panel>
    </section>
  );
}

/**
 * Organization detail (platform). COUNTS and health metadata only: no
 * Request/Passenger/Trip content, no record links, no recipient addresses, no
 * provider text. The only control is suspend / reactivate.
 */
export default async function PlatformOrganizationPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  if (!UUID_PATTERN.test(organizationId)) notFound();

  const [org, integrations] = await Promise.all([getOrganizationDetail(organizationId), getOrganizationIntegrations(organizationId).catch(() => null)]);
  if (!org || !integrations) notFound();

  const n = org.notifications;
  const failure = failureReasonLabel(org.lastFailureReason);

  return (
    <>
      <PageHeader
        title={org.name}
        breadcrumb={[{ label: "Platform", href: "/platform" }, { label: "Organizations", href: "/platform/organizations" }, { label: org.name }]}
        actions={<StatusBadge label={organizationStatusLabel(org.status)} category={organizationStatusCategory(org.status)} />}
      />

      <Section title="Organization">
        <DefinitionList
          columns={2}
          items={[
            { label: "Status", value: organizationStatusLabel(org.status) },
            { label: "Created", value: formatPlatformDate(org.createdAt) },
            { label: "Timezone", value: org.timezone },
            { label: "Business stage", value: org.businessStage ? org.businessStage.replace(/_/g, " ") : "Not set" },
            { label: "Last activity", value: formatPlatformTimestamp(org.lastActivityAt) },
          ]}
        />
      </Section>

      <Section title="Access" description="Who can currently operate this organization's workspace.">
        <DefinitionList
          columns={2}
          items={[
            { label: "Active Organization Admins", value: org.activeAdminCount },
            { label: "Active Dispatchers", value: org.activeDispatcherCount },
            { label: "Active Driver memberships", value: org.activeDriverMembershipCount },
            { label: "Pending staff invitations", value: org.pendingStaffInviteCount },
          ]}
        />
      </Section>

      <Section title="Operations footprint" description="Counts only. Records are never shown here.">
        <DefinitionList
          columns={2}
          items={[
            { label: "Drivers", value: org.driverCount },
            { label: "Vehicles", value: org.vehicleCount },
            { label: "Passengers", value: org.passengerCount },
            { label: "Requests", value: org.requestCount },
            { label: "Trips", value: org.tripCount },
          ]}
        />
      </Section>

      <Section title="Website intake" description="Read-only. Managed by the organization's own Administrators.">
        <div className="flex flex-col gap-zw-md">
          <DefinitionList
            columns={2}
            items={[
              { label: "Integrations", value: org.integrationsTotal === 0 ? "None" : `${org.integrationsActive} of ${org.integrationsTotal} active` },
              { label: "Requests received", value: org.websiteRequestCount },
              { label: "Last request received", value: formatPlatformTimestamp(org.lastWebsiteRequestAt) },
            ]}
          />
          {integrations.length > 0 && (
            <ul aria-label="Website integrations" className="flex flex-col">
              {integrations.map((item, index) => (
                <li key={index} className="flex flex-wrap items-start justify-between gap-2 border-t border-border-subtle py-zw-sm first:border-t-0 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className={cn(typography.subsectionHeading, "break-all text-text-primary")}>{item.origin ?? "No website address"}</p>
                    <p className={cn(typography.metadata, "text-text-muted")}>
                      Added {formatPlatformDate(item.createdAt)} · {pluralize(item.requestCount, "request")} received
                      {item.lastRequestAt ? ` · last ${formatPlatformTimestamp(item.lastRequestAt)}` : ""}
                    </p>
                  </div>
                  <StatusBadge label={item.isActive ? "Active" : "Disabled"} category={item.isActive ? "positive" : "neutral"} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Notification delivery" description="Delivery outcomes of this organization's email notifications. No recipients or message content.">
        <div className="flex flex-col gap-zw-md">
          <DefinitionList
            columns={2}
            items={[
              { label: "Pending", value: n.pending },
              { label: "Dispatching", value: n.dispatching },
              { label: "Sent", value: n.sent },
              { label: "Partly sent", value: n.partial },
              { label: "Failed", value: n.failed },
              { label: "Skipped", value: n.skipped },
            ]}
          />
          {n.stuck > 0 && (
            <p role="status" className={cn(typography.bodySmall, "rounded-md bg-warning-bg px-3 py-2 text-warning-text")}>
              Needs attention: {pluralize(n.stuck, "notification")} pending or dispatching for more than 15 minutes.
            </p>
          )}
          {failure && (
            <p className={cn(typography.bodySmall, "text-text-secondary")}>
              Most recent failure category: {failure} ({formatPlatformTimestamp(org.lastFailureAt)}).
            </p>
          )}
        </div>
      </Section>

      <Section title="Lifecycle" description="Suspending pauses the workspace; nothing is deleted. There is no delete or purge.">
        <OrganizationLifecycleControl key={org.status} organizationId={org.organizationId} organizationName={org.name} status={org.status} />
      </Section>
    </>
  );
}
