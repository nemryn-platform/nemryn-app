import Link from "next/link";
import { getPlatformOverview, getNotificationAttention } from "@/lib/platform/platform";
import { failureReasonLabel, formatPlatformTimestamp, notificationEventLabel, notificationStatusLabel } from "@/lib/platform/platform-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Overview" };

function Metric({ label, value, href, tone }: { label: string; value: number; href?: string; tone?: "warning" }) {
  const body = (
    <Panel className={cn("h-full", tone === "warning" && value > 0 && "border-warning-border bg-warning-bg")}>
      <p className={cn(typography.label, "text-text-muted")}>{label}</p>
      <p className={cn(typography.numericDisplay, "mt-1 text-text-primary")}>{value}</p>
    </Panel>
  );
  return href ? (
    <Link href={href} className="block rounded-md focus-visible:outline-2 focus-visible:outline-border-focus">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Platform overview: platform-health metadata only. No transportation records,
 * no people, no revenue/churn (no billing data exists to back them).
 */
export default async function PlatformOverviewPage() {
  const [overview, attention] = await Promise.all([getPlatformOverview(), getNotificationAttention(8)]);
  const needsAttention = overview.notificationsFailed + overview.notificationsPartial + overview.notificationsStuck;

  return (
    <>
      <PageHeader title="Platform" description="Health of the Nemryn platform and the organizations on it." />

      <section aria-label="Organizations" className="grid grid-cols-2 gap-zw-md lg:grid-cols-4">
        <Metric label="Organizations" value={overview.totalOrganizations} href="/platform/organizations" />
        <Metric label="Active organizations" value={overview.activeOrganizations} href="/platform/organizations?status=active" />
        <Metric label="Suspended organizations" value={overview.suspendedOrganizations} href="/platform/organizations?status=inactive" tone="warning" />
        <Metric label="Platform administrators" value={overview.platformAdminCount} />
      </section>

      <section aria-label="Integrations and notifications" className="grid grid-cols-2 gap-zw-md lg:grid-cols-4">
        <Metric label="Website integrations" value={overview.integrationsTotal} />
        <Metric label="Website integrations active" value={overview.integrationsActive} />
        <Metric label="Notifications failed" value={overview.notificationsFailed + overview.notificationsPartial} tone="warning" />
        <Metric label="Notifications stuck" value={overview.notificationsStuck} tone="warning" />
      </section>

      <section aria-label="Notification delivery attention" className="flex flex-col gap-zw-sm">
        <h2 className={cn(typography.sectionHeading, "text-text-primary")}>Notification delivery</h2>
        {needsAttention === 0 ? (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>No notification delivery needs attention.</p>
        ) : (
          <Panel>
            <ul>
              {attention.map((item) => (
                <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle py-zw-sm first:border-t-0 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <Link href={`/platform/organizations/${item.organizationId}`} className={cn(typography.subsectionHeading, "break-words text-text-link")}>
                      {item.organizationName}
                    </Link>
                    <p className={cn(typography.metadata, "text-text-muted")}>
                      {notificationEventLabel(item.eventType)} · {formatPlatformTimestamp(item.createdAt)}
                      {failureReasonLabel(item.failureReason) ? ` · ${failureReasonLabel(item.failureReason)}` : ""}
                    </p>
                  </div>
                  <StatusBadge label={notificationStatusLabel(item.status, item.isStuck)} category={item.status === "failed" || item.isStuck ? "critical" : "warning"} />
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <p className={cn(typography.metadata, "text-text-muted")}>
          Events pending or dispatching for more than 15 minutes are flagged as stuck. They are shown, never changed automatically.
        </p>
      </section>
    </>
  );
}
