import Link from "next/link";
import { WarningCircle, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import {
  getTodaysOperations,
  type TodaysOperationsData,
  type TodaysOperationsTrip,
  type TodaysOperationsAttentionItem,
} from "@/lib/operations/todays-operations";
import { getOnboardingChecklist, type OnboardingChecklist } from "@/lib/operations/onboarding-checklist";
import {
  getDriverSnapshot,
  getRequestSummary,
  getTomorrowReadinessSummary,
  getRecurringCareSummary,
  getProofOfServiceSummary,
} from "@/lib/operations/operations-brief";
import {
  deriveOperationsBrief,
  type OperationsBriefDriverSnapshot,
  type OperationsBriefRequestSummary,
  type OperationsBriefTomorrowSummary,
  type OperationsBriefRecurringCareSummary,
  type OperationsBriefProofOfServiceSummary,
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
  // Proof-of-Service whole-window summary (P1-E3-S1F) — same independent,
  // best-effort, caught-separately shape as Tomorrow Readiness/Recurring
  // Care immediately above; a genuine failure (or a deliberate
  // unavailable decision from the whole-window fetch itself) degrades
  // only the Brief's own Proof-of-Service block, never the rest of this
  // page.
  const proofOfServicePromise: Promise<OperationsBriefProofOfServiceSummary | null> = getProofOfServiceSummary(
    organization.organizationId,
    organization.organizationTimezone,
    now,
  ).catch(() => null);

  // Today's Operations (P1-PILOT-S3) — started here, alongside the
  // independent promises above, rather than a plain `await` (its
  // pre-existing shape) so a genuine failure degrades only the sections
  // that actually depend on it (the Brief's own attention/active-now/
  // next-departures fields via deriveOperationsBrief, and this page's own
  // SummaryStrip + Needs Attention/Upcoming Trips/Active Trips/Activity
  // Log panels below) rather than failing this entire route. Caught here
  // at the ORCHESTRATION layer, not by rewriting getTodaysOperations
  // itself into a nullable data source — it remains the authoritative,
  // always-throws-on-genuine-failure read model; only this page (and
  // getOperationsBrief, its one other caller) decides how to present that
  // failure. Mirrors the exact same `.catch(() => null)` shape as
  // tomorrowReadiness/recurringCare/proofOfService immediately above,
  // except the "unavailable" value is a discriminated result rather than
  // a bare `null`, since this page (unlike the Brief) also needs to
  // render today's-operations-derived TABLES, not just a compact summary.
  const todaysOperationsPromise: Promise<{ status: "ok"; data: TodaysOperationsData } | { status: "unavailable" }> = getTodaysOperations(
    organization.organizationId,
    organization.organizationTimezone,
  )
    .then((data) => ({ status: "ok" as const, data }))
    .catch(() => {
      // Safe, fixed, non-dynamic message only (mirrors requests-list.ts's
      // established convention) — getTodaysOperations wraps the
      // underlying Postgres/PostgREST error's own `.message` into its
      // thrown Error's message, which can occasionally echo back filter
      // values, so it is never logged here.
      console.error("[operations] getTodaysOperations failed");
      return { status: "unavailable" as const };
    });

  // Onboarding Checklist / Driver Snapshot / Request Summary (P1-PILOT-S3R
  // — the remaining plain, uncaught Promise.all flagged as an OPEN ISSUE
  // in P1-PILOT-S3's own report). Each is now started here and caught
  // independently, exactly like the 4 promises above: a genuine failure
  // in any ONE of these three must degrade only its own UI area, never
  // take down this whole route with it.
  //
  // Onboarding Checklist has no dedicated "unavailable" presentation
  // (§4 of P1-PILOT-S3R) — it is a low-priority setup banner, not
  // operationally load-bearing, and OnboardingChecklistBanner already
  // renders nothing once setup is complete. On a genuine fetch failure it
  // is simply omitted from the page entirely (`checklist: null` — the
  // banner returns null for that case too), which is truthful: it never
  // claims onboarding is complete, it just doesn't claim anything at all.
  const checklistPromise: Promise<OnboardingChecklist | null> = getOnboardingChecklist(organization.organizationId).catch(() => {
    console.error("[operations] getOnboardingChecklist failed");
    return null;
  });
  const driverSnapshotPromise: Promise<OperationsBriefDriverSnapshot | null> = getDriverSnapshot(organization.organizationId).catch(() => {
    console.error("[operations] getDriverSnapshot failed");
    return null;
  });
  const requestSummaryPromise: Promise<OperationsBriefRequestSummary | null> = getRequestSummary(organization.organizationId).catch(() => {
    console.error("[operations] getRequestSummary failed");
    return null;
  });

  const [checklist, driverSnapshot, requestSummary] = await Promise.all([checklistPromise, driverSnapshotPromise, requestSummaryPromise]);
  const tomorrowReadiness = await tomorrowReadinessPromise;
  const recurringCare = await recurringCarePromise;
  const proofOfService = await proofOfServicePromise;
  const todaysOperationsResult = await todaysOperationsPromise;
  const data = todaysOperationsResult.status === "ok" ? todaysOperationsResult.data : null;
  const brief = deriveOperationsBrief(data, driverSnapshot, requestSummary, tomorrowReadiness, recurringCare, proofOfService, now);
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

      {data === null ? (
        // Contained, page-level unavailable treatment (P1-PILOT-S3 §7/§10)
        // for the ENTIRE tightly-coupled today's-operations-derived group
        // (SummaryStrip + Needs Attention/Upcoming Trips/Active Trips/
        // Activity Log) — ONE notice for the whole group, not five
        // repeated errors. The Operations Brief above already rendered
        // its own compact "unavailable" treatment for the same
        // underlying failure (dayState === "UNAVAILABLE"); this is the
        // separate, larger detail region below it. No raw Supabase/SQL/
        // PostgREST/ZW error text is ever surfaced here.
        <Panel>
          <EmptyState
            title="Today's operations unavailable"
            description="We couldn't load today's trip activity. Refresh the page to try again."
          />
        </Panel>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
