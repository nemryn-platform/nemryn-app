import Link from "next/link";
import { Plus, Repeat } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getRecurringArrangementsList, type RecurringArrangementListRow } from "@/lib/operations/recurring-care-list";
import { flattenMissingOccurrences, type MissingOccurrenceSourceRow } from "@/lib/operations/recurring-care-bulk-core";
import {
  formatRecurringPattern,
  formatWallClockTime,
  recurringArrangementStatusLabel,
  recurringArrangementStatusCategory,
  formatServiceDateShortLabel,
} from "@/lib/operations/presentation";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkButton } from "@/components/ui/LinkButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecurringCareStatusTabs, type RecurringCareListStateFilter } from "@/components/operations/recurring-care/RecurringCareStatusTabs";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Recurring Care list (P1-E2-S1E §4-§7) — "What standing transportation
 * commitments do I currently have?" A restrained operational list, not a
 * "recurrence administration system": no scores, no percentages, no
 * adherence/clinical terminology, no AI recommendations (§4's own
 * explicit exclusion list). Validated deliberately against 0/1/3/20+
 * arrangements — the SAME route/component/query shape at every scale
 * (§6/§7), no separate "enterprise mode."
 *
 * Direct route access only (no sidebar item, no Operations Brief block
 * yet — S1F owns that contextual-discovery decision, §39).
 */
export default async function RecurringCareListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pathname = await getCurrentPathname("/operations/recurring-care");
  const organization = await requireOperationsAccess(pathname);
  const params = await searchParams;

  const state = (typeof params.state === "string" ? params.state : "active") as RecurringCareListStateFilter;

  const allArrangements = await getRecurringArrangementsList(organization.organizationId);
  const rows = state === "all" ? allArrangements : allArrangements.filter((a) => a.status === state);

  const missingSourceRows: MissingOccurrenceSourceRow[] = allArrangements
    .filter((a) => a.assurance !== null)
    .map((a) => ({
      arrangementId: a.id,
      passengerDisplayName: a.passengerDisplayName,
      pickupDescription: a.pickupDescription,
      destinationDescription: a.destinationDescription,
      pickupTime: a.pickupTime,
      timezone: a.timezone,
      occurrences: a.assurance!.occurrences,
    }));
  const missingCount = flattenMissingOccurrences(missingSourceRows).length;

  const columns: DataTableColumn<RecurringArrangementListRow>[] = [
    {
      key: "arrangement",
      header: "Arrangement",
      primary: true,
      render: (row) => (
        <Link href={`/operations/recurring-care/${row.id}`} className="flex flex-col gap-0.5 hover:text-text-link">
          <span className="font-medium text-text-primary hover:underline">{row.passengerDisplayName}</span>
          <span className={cn(typography.metadata, "text-text-muted")}>
            {formatRecurringPattern(row.daysOfWeek)} · {formatWallClockTime(row.pickupTime)}
          </span>
        </Link>
      ),
    },
    {
      key: "route",
      header: "Route",
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate">{row.pickupDescription}</span>
          <span aria-hidden className="text-text-disabled">
            →
          </span>
          <span className="truncate">{row.destinationDescription}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge label={recurringArrangementStatusLabel(row.status)} category={recurringArrangementStatusCategory(row.status)} />,
    },
    {
      key: "assurance",
      header: "Upcoming",
      render: (row) => {
        if (!row.assurance) {
          return <span className="text-text-muted">No upcoming occurrences</span>;
        }
        const { missingCount, scheduledCount, nextMissingDate } = row.assurance;
        return (
          <span className="flex flex-col gap-0.5">
            <span>
              {missingCount > 0 ? `${missingCount} not yet scheduled` : "All scheduled"}
              {scheduledCount > 0 && ` · ${scheduledCount} scheduled`}
            </span>
            {nextMissingDate && (
              <span className={cn(typography.metadata, "text-text-muted")}>Next open: {formatServiceDateShortLabel(nextMissingDate)}</span>
            )}
          </span>
        );
      },
    },
    {
      key: "view",
      header: "",
      align: "right",
      render: (row) => (
        <Link href={`/operations/recurring-care/${row.id}`} className={cn(typography.bodySmall, "text-text-link hover:underline")}>
          View →
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Recurring Care"
        description="Standing transportation commitments you repeatedly need to keep covered."
        actions={
          <>
            {missingCount > 0 && (
              <LinkButton href="/operations/recurring-care/create-missing" variant="secondary">
                {missingCount === 1 ? "Review 1 missing ride" : `Review ${missingCount} missing rides`}
              </LinkButton>
            )}
            <LinkButton href="/operations/recurring-care/new" leadingIcon={<Plus className="size-4" aria-hidden />}>
              New recurring arrangement
            </LinkButton>
          </>
        }
      />

      <RecurringCareStatusTabs active={state} />

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyState={
          allArrangements.length === 0 ? (
            <EmptyState
              icon={<Repeat className="size-8" aria-hidden />}
              title="No recurring transportation yet."
              description="Set up a standing arrangement for a passenger who needs regular rides."
              action={
                <LinkButton href="/operations/recurring-care/new" leadingIcon={<Plus className="size-4" aria-hidden />}>
                  Create recurring arrangement
                </LinkButton>
              }
            />
          ) : (
            <EmptyState title="No arrangements in this view." description="Try a different status tab above." />
          )
        }
      />
    </div>
  );
}
