import Link from "next/link";
import { WarningCircle, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getTodaysOperations, type TodaysOperationsTrip, type TodaysOperationsAttentionItem } from "@/lib/operations/todays-operations";
import { getOnboardingChecklist } from "@/lib/operations/onboarding-checklist";
import { getDriverSnapshot, getRequestSummary, getTomorrowReadinessSummary, getRecurringCareSummary } from "@/lib/operations/operations-brief";
import {
  deriveOperationsBrief,
  type OperationsBriefTomorrowSummary,
  type OperationsBriefRecurringCareSummary,
} from "@/lib/operations/operations-brief-core";
import { formatOperationsTime, assuranceStatusCategory } from "@/lib/operations/presentation";
import { OnboardingChecklistBanner } from "@/components/operations/OnboardingChecklistBanner";
import { OperationsBrief } from "@/components/operations/OperationsBrief";
import { SummaryStrip } from "@/components/ui/SummaryStrip";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TripStatus } from "@/components/ui/TripStatus";
import { LinkButton } from "@/components/ui/LinkButton";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Today's Operations (P1-E3-S4, "Needs Attention" upgraded to a real
 * assurance queue P1-E3-S8) —
 * docs/design/stitch/references/01-todays-operations.png, treated as the
 * canonical visual specification (work item §1). Deliberately omits the
 * reference's "Driver Availability" panel entirely (GAP-6,
 * ui-backend-gap-register.md — no schema concept exists for
 * Available/Break/Unavailable). "Needs Attention" is now a real,
 * deterministic operational attention queue — Open issue / Needs
 * assignment / Location needs update — derived from
 * `src/lib/operations/trip-assurance.ts`, the one shared evaluator every
 * Operations surface uses (never a fabricated "Running Late," never a
 * numeric score). See docs/product/trip-assurance-model.md and
 * docs/product/todays-operations-data-map.md for the full rationale.
 */
export default async function OperationsOverviewPage() {
  const pathname = await getCurrentPathname("/operations");
  const organization = await requireOperationsAccess(pathname);
  const now = new Date();
  // Tomorrow Readiness (P1-E1-S4E §11/§12) — started here, BEFORE the
  // Promise.all below, so it overlaps with those fetches in wall-clock
  // time rather than serially delaying the page. Caught independently
  // (never inside the Promise.all, whose rejection would fail this whole
  // page) — a genuine failure degrades only the Brief's own compact
  // block, mirroring RequestActivityPanel's established null-on-failure
  // convention (src/app/operations/requests/[requestId]/page.tsx).
  const tomorrowReadinessPromise: Promise<OperationsBriefTomorrowSummary | null> = getTomorrowReadinessSummary(
    organization.organizationId,
    organization.organizationTimezone,
    now,
  ).catch(() => null);
  // Recurring Care summary (P1-E2-S1F §17) — same independent, best-effort,
  // caught-separately shape as Tomorrow Readiness immediately above; a
  // genuine failure here degrades only the Brief's own Recurring Care
  // block, never the rest of this page.
  const recurringCarePromise: Promise<OperationsBriefRecurringCareSummary | null> = getRecurringCareSummary(
    organization.organizationId,
    now,
  ).catch(() => null);

  const data = await getTodaysOperations(organization.organizationId, organization.organizationTimezone);
  // Operations Brief (P1-E1-S1C) is derived from this SAME already-fetched
  // `data` — never a second getTodaysOperations() call. Only the driver
  // snapshot (S1B's one genuinely new query) needs its own fetch, run in
  // parallel with the onboarding checklist below.
  const [checklist, driverSnapshot, requestSummary] = await Promise.all([
    getOnboardingChecklist(organization.organizationId),
    getDriverSnapshot(organization.organizationId),
    getRequestSummary(organization.organizationId),
  ]);
  const tomorrowReadiness = await tomorrowReadinessPromise;
  const recurringCare = await recurringCarePromise;
  const brief = deriveOperationsBrief(data, driverSnapshot, requestSummary, tomorrowReadiness, recurringCare, now);
  const timezone = organization.organizationTimezone;

  const attentionColumns: DataTableColumn<TodaysOperationsAttentionItem>[] = [
    { key: "time", header: "Time", render: (row) => formatOperationsTime(row.trip.scheduledPickupAt, timezone) },
    {
      key: "passenger",
      header: "Passenger",
      primary: true,
      render: (row) => (
        <Link href={`/operations/trips/${row.trip.id}`} className="hover:text-text-link hover:underline">
          {row.trip.passengerName}
        </Link>
      ),
    },
    {
      key: "route",
      header: "Route",
      render: (row) => (
        <span className="text-text-secondary">
          {row.trip.pickupDescription} <ArrowRight className="inline size-3" aria-hidden /> {row.trip.destinationDescription}
        </span>
      ),
    },
    {
      key: "issue",
      header: "Reason",
      render: (row) => <StatusBadge label={row.assurance.label} category={assuranceStatusCategory(row.assurance.code)} />,
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (row) =>
        row.assurance.code === "NEEDS_ASSIGNMENT" ? (
          <LinkButton href="/operations/dispatch" variant="outline" size="sm">
            Assign
          </LinkButton>
        ) : (
          <LinkButton href={`/operations/trips/${row.trip.id}`} variant="outline" size="sm">
            Open Trip
          </LinkButton>
        ),
    },
  ];

  const upcomingColumns: DataTableColumn<TodaysOperationsTrip>[] = [
    { key: "time", header: "Time", render: (row) => formatOperationsTime(row.scheduledPickupAt, timezone) },
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
    { key: "pickup", header: "Pickup", render: (row) => row.pickupDescription },
    { key: "destination", header: "Destination", render: (row) => row.destinationDescription },
    { key: "driver", header: "Driver", render: (row) => row.driverName ?? "––" },
    { key: "vehicle", header: "Vehicle", render: (row) => row.vehicleLabel ?? "––" },
    { key: "status", header: "Status", render: (row) => <TripStatus status={row.statusLabel} /> },
  ];

  return (
    <div className="flex flex-col gap-zw-lg">
      <OnboardingChecklistBanner checklist={checklist} />

      <OperationsBrief brief={brief} timezone={timezone} />

      <SummaryStrip
        inline
        items={[
          { label: "trips today", value: data.summary.todayCount },
          { label: "active", value: data.summary.activeCount, dot: true },
          { label: "need attention", value: data.summary.attentionCount, tone: "warning", dot: true },
          { label: "no current issues", value: data.summary.onTrackCount, dot: true },
        ]}
      />

      <div className="grid grid-cols-1 gap-zw-lg lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-zw-lg">
          <Panel className="p-0">
            <div className="flex items-start justify-between gap-4 p-zw-lg pb-0">
              <div className="flex items-center gap-2">
                <WarningCircle className="size-5 text-warning-strong" weight="fill" aria-hidden />
                <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Needs Attention</h2>
              </div>
              {data.attentionItems.length > 0 && (
                <StatusBadge
                  label={`${data.attentionItems.length} ${data.attentionItems.length === 1 ? "Item" : "Items"}`}
                  category="warning"
                />
              )}
            </div>
            <div className="p-zw-lg">
              {data.attentionItems.length === 0 ? (
                <EmptyState title="Nothing needs attention" description="No open issues, unassigned trips, or location concerns right now." />
              ) : (
                <DataTable columns={attentionColumns} rows={data.attentionItems} getRowId={(row) => row.trip.id} />
              )}
            </div>
          </Panel>

          <Panel className="p-0">
            <div className="p-zw-lg pb-0">
              <SectionHeader title="Upcoming Trips" />
            </div>
            <div className="p-zw-lg">
              {data.todayTrips.length === 0 ? (
                <EmptyState title="No trips scheduled today" description="Trips scheduled for today will appear here." />
              ) : (
                <DataTable columns={upcomingColumns} rows={data.todayTrips} getRowId={(row) => row.id} />
              )}
            </div>
            <div className="border-t border-border-subtle p-zw-md text-center">
              <Link
                href="/operations/trips"
                className={cn(typography.bodySmall, "inline-flex items-center gap-1 font-medium text-text-link hover:underline")}
              >
                View all trips <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-zw-lg">
          <Panel>
            <SectionHeader
              title="Active Trips"
              actions={
                data.activeTrips.length > 0 ? (
                  <span className={cn(typography.metadata, "text-text-muted")}>{data.activeTrips.length} in progress</span>
                ) : undefined
              }
            />
            <div className="mt-zw-md">
              {data.activeTrips.length === 0 ? (
                <EmptyState title="Nothing in progress" description="Trips currently underway will appear here." />
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {data.activeTrips.map((trip) => (
                    <li key={trip.id} className="py-zw-sm first:pt-0 last:pb-0">
                      <Link
                        href={`/operations/trips/${trip.id}`}
                        className="flex items-center justify-between gap-3 rounded-sm hover:bg-surface-hover"
                      >
                        <div className="flex items-center gap-2">
                          <span className="size-2 shrink-0 rounded-full bg-info-strong" aria-hidden />
                          <div>
                            <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>{trip.passengerName}</p>
                            <p className={cn(typography.metadata, "text-text-muted")}>
                              {trip.driverName ?? "Unassigned"}
                              {trip.vehicleLabel ? ` • ${trip.vehicleLabel}` : ""}
                            </p>
                          </div>
                        </div>
                        <span className={cn(typography.bodySmall, "shrink-0 font-medium text-info-text")}>
                          {trip.statusLabel}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Panel>
            <SectionHeader title="Activity Log" />
            <div className="mt-zw-md">
              {data.activityLog.length === 0 ? (
                <EmptyState title="No activity yet today" description="Trip updates will appear here as they happen." />
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {data.activityLog.map((event) => (
                    <li key={event.id} className="flex items-start justify-between gap-3 py-zw-sm first:pt-0 last:pb-0">
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-text-muted" aria-hidden />
                        <div>
                          <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>{event.label}</p>
                          {event.passengerName && (
                            <p className={cn(typography.metadata, "text-text-muted")}>{event.passengerName}</p>
                          )}
                        </div>
                      </div>
                      <span className={cn(typography.metadata, "shrink-0 text-text-muted")}>
                        {formatOperationsTime(event.occurredAt, timezone)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
