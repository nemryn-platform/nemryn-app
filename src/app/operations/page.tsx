import Link from "next/link";
import { ArrowRight, CalendarBlank, CheckCircle, ClockCounterClockwise, Lightning, ListChecks, Path, Tray, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import {
  getTodaysOperations,
  type TodaysOperationsData,
  type TodaysOperationsTrip,
} from "@/lib/operations/todays-operations";
import { getGettingStarted, type GettingStarted } from "@/lib/operations/onboarding-checklist";
import { getPlusAccessState } from "@/lib/plus/access";
import { canOpenGrowth } from "@/lib/plus/access-core";
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
import { formatOperationsLongDate, formatOperationsTime } from "@/lib/operations/presentation";
import { STRANDED_REQUESTS_HREF } from "@/lib/operations/request-fulfilment-core";
import { OnboardingChecklistBanner } from "@/components/operations/OnboardingChecklistBanner";
import { OperationsBrief } from "@/components/operations/OperationsBrief";
import { OverviewPageHeader } from "@/components/operations/OperationsPageHeaders";
import { composeOperationsBrief, type ProgressiveOperationsSignals } from "@/lib/operations/progressive-operations-core";
import { getOperatorLinkedDriverId } from "@/lib/operations/assignment-context";
import { getOperationsPreferences } from "@/lib/operations/organization-preferences";
import { formatSchedule } from "@/lib/operations/operating-schedule-core";
import { StatTile, StatTileGroup } from "@/components/ui/StatTile";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { TripStatus } from "@/components/ui/TripStatus";
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
  // NP-PILOT-P2: the same per-request (cached) Getting started read the layout's sidebar entry uses.
  const isAdmin = organization.role === "organization_admin";
  const checklistPromise: Promise<GettingStarted | null> = getPlusAccessState(organization.organizationId)
    .then((plus) => getGettingStarted(organization.organizationId, isAdmin, canOpenGrowth(plus.state, plus.capability)))
    .catch(() => {
      console.error("[operations] getGettingStarted failed");
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

  // P1-OPS-PROG3B fact-signal composition -- assembled ONLY from data this
  // page already loaded (no new query). null = could not be loaded, never 0.
  // No business_stage, size, membership or vehicle input exists at all.
  const tripChecklistItem = checklist?.steps.find((step) => step.key === "trip") ?? null;
  const nextTodayPickupAt =
    data?.todayTrips
      .filter((trip) => trip.state === "scheduled" && trip.scheduledPickupAt && Date.parse(trip.scheduledPickupAt) > now.getTime())
      .map((trip) => trip.scheduledPickupAt as string)
      .sort()[0] ?? null;
  const signals: ProgressiveOperationsSignals = {
    dayState: brief.dayState,
    attentionCount: brief.attention?.length ?? null,
    todayUnassignedCount: brief.unassignedCount,
    activeNowCount: brief.activeNow?.length ?? null,
    nextDepartureCount: brief.nextDepartures?.length ?? null,
    nextTodayPickupAt,
    pendingRequestCount: requestSummary?.pendingRequestCount ?? null,
    strandedRequestCount: requestSummary?.strandedAcceptedCount ?? null,
    tomorrowTripCount: tomorrowReadiness?.totalScheduledTrips ?? null,
    tomorrowNeedsPreparationCount: tomorrowReadiness?.needsPreparationCount ?? null,
    activeRecurringCount: recurringCare?.activeArrangementCount ?? null,
    recurringMissingCount: recurringCare?.missingOccurrenceCount ?? null,
    proofCompletedCount: proofOfService?.completedTripCount ?? null,
    proofReviewCount: proofOfService?.needsReviewCount ?? null,
    activeDriverCount: driverSnapshot?.totalActiveDrivers ?? null,
    hasEverHadTrip: tripChecklistItem ? tripChecklistItem.complete : null,
    // NP-PILOT-P2: setup completes with the four business essentials, before any trip; the "fresh" Brief (Get started
    // rows) keeps its original meaning -- set up AND a first trip -- so a configured agency still sees it until then.
    checklistComplete: checklist ? checklist.isComplete && tripChecklistItem?.complete === true : null,
  };
  const composition = composeOperationsBrief(signals);
  const hasLinkedDriver = (await getOperatorLinkedDriverId(organization.organizationId)) !== null;

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

  // Operating schedule (P1-PILOT-S4B-R4C) -- an informational Organization
  // preference shown here; best-effort (a failed read simply omits the line)
  // and it never gates or filters anything on this page.
  const operatingSchedule = await getOperationsPreferences(organization.organizationId)
    .then((preferences) => preferences?.schedule ?? null)
    .catch(() => null);

  // NP-UI-P1b: today's four real summary counts (formerly the inline SummaryStrip below the Brief) as Concept B fact
  // tiles directly under the Brief heading. Same values and labels; only shown when today's data loaded and the
  // organization is past the fresh state (a fresh organization still sees no zero counters, P1-OPS-PROG3B). A tile
  // links only where an existing destination shows that fact.
  const summaryTiles =
    composition.kind !== "fresh" && data !== null ? (
      <StatTileGroup label="Today at a glance" testId="brief-summary-tiles">
        {[
          <StatTile key="today" label="trips today" value={data.summary.todayCount} icon={<Path className="size-5" />} tone="accent" href="#today-trips" testId="tile-trips-today" />,
          <StatTile key="active" label="active" value={data.summary.activeCount} icon={<Lightning className="size-5" />} tone="info" href="#active-trips" testId="tile-active" />,
          <StatTile
            key="attention"
            label="need attention"
            value={data.summary.attentionCount}
            icon={<WarningCircle className="size-5" />}
            tone={data.summary.attentionCount > 0 ? "attention" : "neutral"}
            href="/operations/dispatch"
            testId="tile-attention"
          />,
          <StatTile
            key="ontrack"
            label="no current issues"
            value={data.summary.onTrackCount}
            icon={<CheckCircle className="size-5" />}
            tone={data.summary.onTrackCount > 0 ? "positive" : "neutral"}
            testId="tile-on-track"
          />,
        ]}
      </StatTileGroup>
    ) : null;

  // NP-UI-V2-1 (Concept B "Operations Brief" tiles on a fresh workspace): four real facts this page already loaded —
  // today's date, the setup progress, the pending requests and the accepted requests that still need a trip. Never a
  // zero counter (P1-OPS-PROG3B): an empty queue reads "None waiting"; a failed load reads "Unavailable", never 0.
  // Each tile links only to an existing destination; no new query, no new metric.
  const pendingCount = requestSummary?.pendingRequestCount ?? null;
  const strandedCount = requestSummary ? requestSummary.strandedAcceptedCount ?? 0 : null;
  const freshTiles =
    composition.kind === "fresh" ? (
      <StatTileGroup label="Today at a glance" testId="brief-fresh-tiles">
        {[
          <StatTile key="date" label="Today" value={formatOperationsLongDate(now, timezone)} icon={<CalendarBlank className="size-5" />} tone="accent" href="/operations/dispatch" testId="tile-today-date" />,
          checklist ? (
            <StatTile
              key="setup"
              label="setup steps complete"
              value={`${checklist.completedCount} of ${checklist.totalCount}`}
              icon={<ListChecks className="size-5" />}
              tone="accent"
              href="/operations/getting-started"
              testId="tile-setup"
            />
          ) : null,
          <StatTile
            key="pending"
            label={pendingCount === null ? "requests awaiting review" : pendingCount > 0 ? (pendingCount === 1 ? "request" : "requests") : "Requests awaiting review"}
            value={pendingCount === null ? null : pendingCount > 0 ? pendingCount : "None waiting"}
            detail={pendingCount !== null && pendingCount > 0 ? "Awaiting review" : undefined}
            icon={<Tray className="size-5" />}
            tone={pendingCount !== null && pendingCount > 0 ? "info" : "neutral"}
            href="/operations/requests?state=pending"
            testId="tile-pending-requests"
          />,
          <StatTile
            key="stranded"
            label={strandedCount === null ? "accepted requests need a trip" : strandedCount > 0 ? "need a trip" : "Accepted requests needing a trip"}
            value={strandedCount === null ? null : strandedCount > 0 ? strandedCount : "None waiting"}
            detail={strandedCount !== null && strandedCount > 0 ? "Accepted, not yet scheduled" : undefined}
            icon={<Path className="size-5" />}
            tone={strandedCount !== null && strandedCount > 0 ? "attention" : "neutral"}
            href={STRANDED_REQUESTS_HREF}
            testId="tile-stranded-requests"
          />,
        ].filter(Boolean)}
      </StatTileGroup>
    ) : null;

  return (
    <>
      <OverviewPageHeader timezone={timezone} operatingHours={operatingSchedule ? formatSchedule(operatingSchedule) : null} />
      {/* NP-UI-P1b rhythm: 32px between the page's major sections (setup, Brief, today's detail). */}
      <div className="flex flex-col gap-zw-xl">
        <OnboardingChecklistBanner checklist={checklist} />

        <OperationsBrief
          summaryTiles={composition.kind === "fresh" ? freshTiles : summaryTiles}
          brief={brief}
          composition={composition}
          timezone={timezone}
          nextTodayPickupAt={nextTodayPickupAt}
          isAdmin={organization.role === "organization_admin"}
          hasLinkedDriver={hasLinkedDriver}
        />

        {/* P1-OPS-PROG3B: a fresh organization (no trip yet, setup incomplete)
            sees no lower "today" detail -- it would only be zero counters and
            empty tables. It returns with the first trip. */}
        {composition.kind === "fresh" ? null : data === null ? (
          // Contained, page-level unavailable treatment (P1-PILOT-S3 §7/§10)
          // for the ENTIRE tightly-coupled today's-operations-derived group
          // (SummaryStrip + Needs Attention/Upcoming Trips/Active Trips/
          // Activity Log) — ONE notice for the whole group, not five
          // repeated errors. The Operations Brief above already rendered
          // its own compact "unavailable" treatment for the same
          // underlying failure (dayState === "UNAVAILABLE"); this is the
          // separate, larger detail region below it. No raw Supabase/SQL/
          // PostgREST/ZW error text is ever surfaced here.
          <Panel surface="raised">
            <EmptyState
              title="Today's operations unavailable"
              description="We couldn't load today's trip activity. Refresh the page to try again."
            />
          </Panel>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-zw-md xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="flex flex-col gap-zw-md">
                {/* P1-OPS-PROG3B (owner decision Q1): the full Needs Attention
                    table that used to be here duplicated the Brief's own
                    attention list -- removed. The Brief shows the first 5 with
                    their actions; Dispatch is the complete surface. */}
                <Panel surface="raised" className="scroll-mt-24 p-0" id="today-trips">
                  <div className="p-zw-lg pb-0">
                    <PanelHeader as="h2" variant="display" tone="accent" icon={<Path className="size-5" />} title="Upcoming Trips" description="Every trip scheduled for today." />
                  </div>
                  <div className="p-zw-lg">
                    {data.todayTrips.length === 0 ? (
                      <EmptyState size="compact" title="No trips scheduled today" description="Trips scheduled for today will appear here." />
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

              <div className="flex flex-col gap-zw-md">
                <Panel surface="raised" id="active-trips" className="scroll-mt-24">
                  <PanelHeader
                    as="h2"
                    variant="display"
                    tone="accent"
                    icon={<Lightning className="size-5" />}
                    title="Active Trips"
                    actions={
                      data.activeTrips.length > 0 ? (
                        <span className={cn(typography.metadata, "text-text-muted")}>{data.activeTrips.length} in progress</span>
                      ) : undefined
                    }
                  />
                  <div className="mt-zw-md">
                    {data.activeTrips.length === 0 ? (
                      <EmptyState size="compact" title="Nothing in progress" description="Trips currently underway will appear here." />
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

                <Panel surface="raised">
                  <PanelHeader as="h2" variant="display" tone="accent" icon={<ClockCounterClockwise className="size-5" />} title="Activity Log" />
                  <div className="mt-zw-md">
                    {data.activityLog.length === 0 ? (
                      <EmptyState size="compact" title="No activity yet today" description="Trip updates will appear here as they happen." />
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
    </>
  );
}
