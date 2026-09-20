import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getEmailTransportStatus } from "@/lib/email/send";
import { getNotificationHistory, getNotificationSettings } from "@/lib/operations/notifications";
import {
  NOTIFICATION_EVENT_OPTIONS,
  deliveryStatusLabel,
  deliveryStatusTone,
  notificationEventLabel,
} from "@/lib/operations/notification-core";
import { formatIntegrationTimestamp } from "@/lib/operations/website-integration-core";
import { NotificationSettingsForm } from "@/components/operations/settings/NotificationSettingsForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Notifications" };

/**
 * Settings -> Notifications (P1-PILOT-S4B-R4D). Organization Admin only.
 * Email only; two events Nemryn can genuinely identify at a transactional
 * moment. Recipients are STAFF roles resolved from live Membership state at
 * send time. The platform's own email transport is never configured here.
 */
export default async function NotificationsSettingsPage() {
  const pathname = await getCurrentPathname("/operations/settings/notifications");
  const organization = await requireOrganizationAdminAccess(pathname);

  const [settings, history] = await Promise.all([
    getNotificationSettings(organization.organizationId),
    getNotificationHistory(organization.organizationId).catch(() => []),
  ]);
  const transport = getEmailTransportStatus();
  const tz = organization.organizationTimezone;

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Notifications"
        description="Choose which important operational events email your team."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Notifications" }]}
      />

      {transport === "unavailable" && (
        <p role="status" className={cn(typography.bodySmall, "max-w-3xl rounded-sm bg-warning-bg px-3 py-2 text-warning-text")}>
          Email delivery is currently unavailable. Your settings are saved, but notifications can&apos;t be sent until it is restored.
        </p>
      )}

      <section aria-label="Notification settings" className="flex max-w-3xl flex-col gap-zw-md">
        {NOTIFICATION_EVENT_OPTIONS.map((option) => {
          const setting = settings.find((s) => s.event === option.value);
          return (
            <NotificationSettingsForm
              key={option.value}
              event={option.value}
              label={option.label}
              description={option.description}
              recipientRoles={setting?.recipientRoles ?? []}
              isDefault={setting?.isDefault ?? true}
            />
          );
        })}
        <p className={cn(typography.metadata, "text-text-muted")}>
          Emails only tell your team that something needs attention and link into Nemryn — they never include names, contact details,
          addresses or notes. Drivers are not part of these staff notifications.
        </p>
      </section>

      <section aria-label="Recent notifications" className="flex max-w-3xl flex-col gap-zw-md">
        <SectionHeader title="Recent notifications" description="The most recent notifications Nemryn tried to send for your organization." />
        {history.length === 0 ? (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>Nothing has been sent yet.</p>
        ) : (
          <Panel>
            <ul>
              {history.map((item, index) => (
                <li key={`${item.createdAt}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle py-zw-sm first:border-t-0 first:pt-0 last:pb-0">
                  <div>
                    <p className={cn(typography.label, "text-text-primary")}>{notificationEventLabel(item.event)}</p>
                    <p className={cn(typography.metadata, "text-text-muted")}>{formatIntegrationTimestamp(item.createdAt, tz)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(item.status === "sent" || item.status === "partial") && (
                      <span className={cn(typography.metadata, "text-text-muted")}>
                        {item.sentCount} of {item.recipientCount} emailed
                      </span>
                    )}
                    <StatusBadge label={deliveryStatusLabel(item.status)} category={deliveryStatusTone(item.status)} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>
    </div>
  );
}
