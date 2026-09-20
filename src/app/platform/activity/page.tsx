import Link from "next/link";
import { getPlatformActivity } from "@/lib/platform/platform";
import { formatPlatformTimestamp, platformActionTitle } from "@/lib/platform/platform-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Activity" };

/**
 * Platform activity: PLATFORM administrative actions only (organization
 * suspended / reactivated), projected from the existing audit trail through a
 * deliberate whitelist. It is not any organization's own history.
 */
export default async function PlatformActivityPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const page = await getPlatformActivity(cursor);

  return (
    <>
      <PageHeader title="Activity" description="Administrative actions taken on the platform." breadcrumb={[{ label: "Platform", href: "/platform" }, { label: "Activity" }]} />

      {page.items.length === 0 ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>{cursor ? "No older activity." : "No platform actions yet."}</p>
      ) : (
        <Panel>
          <ul aria-label="Platform activity">
            {page.items.map((item) => (
              <li key={item.key} className="flex flex-col gap-1 border-t border-border-subtle py-zw-sm first:border-t-0 first:pt-0 last:pb-0">
                <p className={cn(typography.subsectionHeading, "text-text-primary")}>
                  {platformActionTitle(item.action) ?? "Platform action"} ·{" "}
                  <Link href={`/platform/organizations/${item.organizationId}`} className="break-words text-text-link">
                    {item.organizationName}
                  </Link>
                </p>
                {item.reason && <p className={cn(typography.bodySmall, "break-words text-text-secondary")}>Reason: {item.reason}</p>}
                <p className={cn(typography.metadata, "text-text-muted")}>
                  {item.actor} · {formatPlatformTimestamp(item.occurredAt)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="flex items-center gap-zw-md">
        {page.nextCursor && (
          <Link href={`/platform/activity?cursor=${page.nextCursor}`} className={cn(typography.bodySmall, "font-medium text-text-link")}>
            Load older activity
          </Link>
        )}
        {cursor && (
          <Link href="/platform/activity" className={cn(typography.bodySmall, "font-medium text-text-link")}>
            Back to newest
          </Link>
        )}
      </div>
    </>
  );
}
