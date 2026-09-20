import Link from "next/link";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getActivityPage } from "@/lib/operations/activity";
import { groupActivityByDay } from "@/lib/operations/activity-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Activity" };

/**
 * Settings -> Activity (P1-PILOT-S4B-R4D). Organization Admin only. A
 * human-readable, newest-first history of ADMINISTRATIVE changes to this
 * organization, projected from the existing audit trail. It is not the
 * operational trip/request timeline. Paged with an opaque "older" cursor.
 */
export default async function ActivitySettingsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const pathname = await getCurrentPathname("/operations/settings/activity");
  const organization = await requireOrganizationAdminAccess(pathname);

  const page = await getActivityPage(organization.organizationId, cursor);
  const groups = groupActivityByDay(page.items, organization.organizationTimezone, new Date());

  return (
    <div className="flex max-w-3xl flex-col gap-zw-lg">
      <PageHeader
        title="Activity"
        description="A history of administrative changes to your organization."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Activity" }]}
      />

      {groups.length === 0 ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>{cursor ? "No older activity." : "No administrative activity yet."}</p>
      ) : (
        groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="flex flex-col gap-zw-sm">
            <h2 className={cn(typography.label, "text-text-muted")}>{group.label}</h2>
            <Panel>
              <ul>
                {group.items.map((item) => (
                  <li key={item.key} className="flex gap-4 border-t border-border-subtle py-zw-sm first:border-t-0 first:pt-0 last:pb-0">
                    <span className={cn(typography.metadata, "w-16 shrink-0 pt-0.5 tabular-nums text-text-muted")}>{item.time}</span>
                    <div className="min-w-0">
                      <p className={cn(typography.subsectionHeading, "text-text-primary")}>{item.title}</p>
                      {item.summary && <p className={cn(typography.bodySmall, "min-w-0 break-words text-text-secondary")}>{item.summary}</p>}
                      <p className={cn(typography.metadata, "text-text-muted")}>{item.actor}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </section>
        ))
      )}

      <div className="flex items-center gap-zw-md">
        {page.nextCursor && (
          <Link href={`/operations/settings/activity?cursor=${page.nextCursor}`} className={cn(typography.bodySmall, "font-medium text-text-link")}>
            Load older activity
          </Link>
        )}
        {cursor && (
          <Link href="/operations/settings/activity" className={cn(typography.bodySmall, "font-medium text-text-link")}>
            Back to newest
          </Link>
        )}
      </div>
    </div>
  );
}
