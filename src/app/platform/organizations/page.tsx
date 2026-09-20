import Link from "next/link";
import { getOrganizationDirectory } from "@/lib/platform/platform";
import {
  DIRECTORY_PAGE_SIZE,
  formatPlatformDate,
  formatPlatformTimestamp,
  organizationStatusCategory,
  organizationStatusLabel,
  parsePage,
  parseSearch,
  parseStatusFilter,
  pluralize,
} from "@/lib/platform/platform-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Organizations" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function directoryHref(params: { q: string | null; status: string | null; page: number }): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status) query.set("status", params.status);
  if (params.page > 1) query.set("page", String(params.page));
  const text = query.toString();
  return text ? `/platform/organizations?${text}` : "/platform/organizations";
}

/**
 * Organization directory. Server-side search / status filter / pagination
 * (never the whole directory in the browser). COUNTS ONLY -- no Request, Trip or
 * Passenger records; "Last activity" is the latest audit event, Request
 * received or Trip change (it is not a sign-in time).
 */
export default async function PlatformOrganizationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = parseSearch(params.q);
  const status = parseStatusFilter(params.status);
  const page = parsePage(params.page);

  const directory = await getOrganizationDirectory({ search: q, status, page });
  const from = directory.total === 0 ? 0 : (directory.page - 1) * DIRECTORY_PAGE_SIZE + 1;
  const to = (directory.page - 1) * DIRECTORY_PAGE_SIZE + directory.rows.length;

  return (
    <>
      <PageHeader title="Organizations" description="Every organization on the platform. Counts and health only." breadcrumb={[{ label: "Platform", href: "/platform" }, { label: "Organizations" }]} />

      <form method="get" action="/platform/organizations" className="flex flex-wrap items-end gap-zw-sm" role="search">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="org-search" className={cn(typography.label, "text-text-primary")}>
            Search by name
          </label>
          <input
            id="org-search"
            name="q"
            type="search"
            defaultValue={q ?? ""}
            maxLength={100}
            className={cn(typography.body, "h-10 rounded-md border border-border-strong bg-surface-elevated px-3 text-text-primary")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="org-status" className={cn(typography.label, "text-text-primary")}>
            Status
          </label>
          <select id="org-status" name="status" defaultValue={status ?? ""} className={cn(typography.body, "h-10 rounded-md border border-border-strong bg-surface-elevated px-3 text-text-primary")}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Suspended</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {(q || status) && (
          <Link href="/platform/organizations" className={cn(typography.bodySmall, "pb-2.5 font-medium text-text-link")}>
            Clear
          </Link>
        )}
      </form>

      {directory.rows.length === 0 ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>{q || status ? "No organizations match these filters." : "No organizations yet."}</p>
      ) : (
        <ul aria-label="Organizations" className="flex flex-col gap-zw-sm">
          {directory.rows.map((row) => (
            <li key={row.organizationId}>
              <Panel className="flex flex-col gap-zw-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link href={`/platform/organizations/${row.organizationId}`} className={cn(typography.subsectionHeading, "min-w-0 break-words text-text-link")}>
                    {row.name}
                  </Link>
                  <StatusBadge label={organizationStatusLabel(row.status)} category={organizationStatusCategory(row.status)} />
                </div>
                <dl className="grid grid-cols-2 gap-x-zw-lg gap-y-zw-sm sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["Created", formatPlatformDate(row.createdAt)],
                    ["Timezone", row.timezone],
                    ["Active staff", String(row.activeStaffCount)],
                    ["Drivers", String(row.driverCount)],
                    ["Website intake", row.integrationsTotal === 0 ? "Not connected" : `${row.integrationsActive} of ${pluralize(row.integrationsTotal, "integration")} active`],
                    ["Last activity", formatPlatformTimestamp(row.lastActivityAt)],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className={cn(typography.metadata, "text-text-muted")}>{label}</dt>
                      <dd className={cn(typography.bodySmall, "break-words text-text-primary")}>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className={cn(typography.metadata, "text-text-muted")}>
                  {pluralize(row.requestCount, "request")} received · {pluralize(row.tripCount, "trip")}
                </p>
              </Panel>
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="Pagination" className="flex flex-wrap items-center gap-zw-md">
        <span className={cn(typography.bodySmall, "text-text-secondary")}>
          {directory.total === 0 ? "0 organizations" : `${from}–${to} of ${directory.total}`}
        </span>
        {directory.page > 1 && (
          <Link href={directoryHref({ q, status, page: directory.page - 1 })} className={cn(typography.bodySmall, "font-medium text-text-link")}>
            Previous
          </Link>
        )}
        {directory.page < directory.pageCount && (
          <Link href={directoryHref({ q, status, page: directory.page + 1 })} className={cn(typography.bodySmall, "font-medium text-text-link")}>
            Next
          </Link>
        )}
      </nav>
    </>
  );
}
