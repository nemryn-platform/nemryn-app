import Link from "next/link";
import { Plus, ListChecks } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getTripsList, TRIPS_LIST_PAGE_SIZE, type TripsListDateFilter, type TripsListAssignmentFilter } from "@/lib/operations/trips-list";
import { operationsTripStatusLabel, formatOperationsTime } from "@/lib/operations/presentation";
import { PageHeader } from "@/components/ui/PageHeader";
import { FilterBar } from "@/components/ui/FilterBar";
import { Pagination } from "@/components/ui/Pagination";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { TripStatus } from "@/components/ui/TripStatus";
import type { TripsListRow } from "@/lib/operations/trips-list";

/**
 * The canonical Trip inventory (P1-E3-S8B1) — replaces the "Structural
 * placeholder" that previously sat here. Server-rendered, server-filtered
 * (plain GET query params — no client-side fetch, no JS required for the
 * filter bar to work), bounded pagination via `getTripsList`. Every Trip
 * in the organization is reachable here, not just today's narrow slice
 * Today's Operations/Dispatch already cover — see docs/product/
 * operations-surface-map.md for the full rationale and how this
 * relates to those two existing screens.
 */
export default async function TripsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pathname = await getCurrentPathname("/operations/trips");
  const organization = await requireOperationsAccess(pathname);
  const params = await searchParams;

  const search = typeof params.q === "string" ? params.q : "";
  const date = (typeof params.date === "string" ? params.date : "all") as TripsListDateFilter;
  const assignment = (typeof params.assignment === "string" ? params.assignment : "all") as TripsListAssignmentFilter;
  const page = typeof params.page === "string" ? Number.parseInt(params.page, 10) || 1 : 1;

  const result = await getTripsList(organization.organizationId, organization.organizationTimezone, {
    search,
    date,
    assignment,
    page,
  });

  const totalPages = Math.max(1, Math.ceil(result.totalCount / TRIPS_LIST_PAGE_SIZE));
  const buildPageHref = (targetPage: number) => {
    const qp = new URLSearchParams();
    if (search) qp.set("q", search);
    if (date !== "all") qp.set("date", date);
    if (assignment !== "all") qp.set("assignment", assignment);
    if (targetPage > 1) qp.set("page", String(targetPage));
    const qs = qp.toString();
    return qs ? `/operations/trips?${qs}` : "/operations/trips";
  };

  const columns: DataTableColumn<TripsListRow>[] = [
    {
      key: "time",
      header: "Scheduled Pickup",
      render: (row) => formatOperationsTime(row.scheduledPickupAt, organization.organizationTimezone),
    },
    {
      key: "passenger",
      header: "Passenger",
      primary: true,
      render: (row) => (
        <Link href={`/operations/trips/${row.id}`} className="hover:text-text-link hover:underline">
          {row.passengerName}
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
      key: "driver",
      header: "Driver",
      render: (row) => row.driverName ?? <span className="text-text-muted">Unassigned</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <TripStatus status={operationsTripStatusLabel(row.state, row.driverName !== null)} />,
    },
  ];

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Trips"
        description="Every trip in your organization — find, filter, and open any of them."
        actions={
          <LinkButton href="/operations/trips/new" leadingIcon={<Plus className="size-4" aria-hidden />}>
            New Trip
          </LinkButton>
        }
      />

      {/* NP-UI-P2: the shared FilterBar frame around the same plain GET filter form (same fields, same Apply). */}
      <form method="get">
        <FilterBar
          search={<SearchInput name="q" label="Search trips" placeholder="Search by passenger, pickup, or destination" defaultValue={search} />}
          filters={
            <>
              <Select
                label="Date"
                name="date"
                defaultValue={date}
                options={[
                  { value: "all", label: "All dates" },
                  { value: "today", label: "Today" },
                  { value: "upcoming", label: "Upcoming" },
                  { value: "past", label: "Past" },
                ]}
              />
              <Select
                label="Assignment"
                name="assignment"
                defaultValue={assignment}
                options={[
                  { value: "all", label: "All trips" },
                  { value: "assigned", label: "Assigned" },
                  { value: "unassigned", label: "Unassigned" },
                ]}
              />
            </>
          }
          actions={
            <>
              {(search || date !== "all" || assignment !== "all") && (
                <LinkButton href="/operations/trips" variant="text">
                  Clear
                </LinkButton>
              )}
              <Button type="submit" variant="outline">
                Apply
              </Button>
            </>
          }
          resultCount={`${result.totalCount} ${result.totalCount === 1 ? "trip" : "trips"}`}
        />
      </form>

      <DataTable
        columns={columns}
        rows={result.rows}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState
            icon={<ListChecks className="size-8" aria-hidden />}
            title={search || date !== "all" || assignment !== "all" ? "No trips match these filters" : "No trips yet"}
            description={
              search || date !== "all" || assignment !== "all"
                ? "Try a different search term or clear the filters."
                : "Trips you create will appear here."
            }
          />
        }
      />

      {result.rows.length > 0 && (
        <Pagination page={result.page} totalPages={totalPages} hrefForPage={buildPageHref} totalItems={result.totalCount} pageSize={result.pageSize} label="Trips pages" />
      )}
    </div>
  );
}
