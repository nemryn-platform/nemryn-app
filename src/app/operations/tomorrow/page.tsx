import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getTomorrowReadiness, type TomorrowReadinessData } from "@/lib/operations/tomorrow-readiness";
import { formatOperationsTime, formatOperationsLongDate, tripReadinessReasonLabel } from "@/lib/operations/presentation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { SummaryStrip, type SummaryItem } from "@/components/ui/SummaryStrip";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LinkButton } from "@/components/ui/LinkButton";
import { TripAssignmentButton } from "@/components/operations/trip-detail/TripAssignmentButton";
import {
  getAssignmentOptions,
  getOperatorLinkedDriverId,
  getRecurringAssignmentHints,
  type AssignmentOptions,
} from "@/lib/operations/assignment-context";
import type { RecurringAssignmentHint } from "@/lib/operations/assignment-defaults-core";
import { deriveTomorrowAssignAction, type TomorrowAssignAction } from "@/lib/operations/readiness-actions-core";
import { getKnownOverlapTripIds } from "@/lib/operations/trip-overlap";
import { deriveTripExtent, formatTripExtent } from "@/lib/operations/trip-overlap-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Tomorrow Readiness (P1-E1-S4D) — the first operator-facing surface over
 * the S4B/S4C/S4C1 readiness engine. Answers exactly one question: "what
 * scheduled work for tomorrow still needs preparation?" Never a dispatch
 * board, never a Trip lifecycle page, never a score.
 *
 * Reached directly at this route only — deliberately NOT added to the
 * permanent Operations sidebar (S4D §3/§29) and NOT integrated into
 * Operations Brief (S4D §28) in this phase; both are S4E's own contextual-
 * discovery work. Authorization comes entirely from the existing
 * `/operations/*` boundary — `requireOperationsAccess` here (this route's
 * own page-level call, matching every other Operations page's own
 * convention) plus the parent layout's own identical call already gate
 * this route exactly like every other Operations screen; a Driver
 * Membership is redirected to /driver before this component ever renders,
 * no second access model introduced.
 *
 * All data comes from the ALREADY-PROVEN `getTomorrowReadiness` wrapper
 * (S4C/S4C1) — this page renders that data, it never re-derives or
 * re-interprets a readiness rule itself.
 */
export default async function TomorrowReadinessPage() {
  const pathname = await getCurrentPathname("/operations/tomorrow");
  const organization = await requireOperationsAccess(pathname);

  let data: TomorrowReadinessData;
  try {
    data = await getTomorrowReadiness(organization.organizationId, organization.organizationTimezone);
  } catch {
    // S4D §24: data unavailable is never rendered as "0 trips / 0
    // problems / tomorrow is ready" — a contained page-level error state
    // instead, matching Trip Detail's own established "Couldn't load"
    // pattern (src/app/operations/trips/[tripId]/page.tsx).
    return (
      <div className="flex flex-col gap-zw-lg">
        <PageHeader title="Tomorrow" />
        <Panel>
          <EmptyState
            icon={<WarningCircle className="size-8" aria-hidden />}
            title="Couldn't load tomorrow's trips"
            description="Something went wrong. Try refreshing the page in a moment."
          />
        </Panel>
      </div>
    );
  }

  const { totalScheduledTrips, readyCount, needsPreparationCount, items, timezone } = data;
  const dateLabel = formatOperationsLongDate(new Date(data.tomorrowStartUtc), timezone);

  // S4C1 §7/S4D §9 invariant: a Trip with a null scheduled_pickup_at can
  // never truthfully belong to "tomorrow" — S4C's own date-range query
  // excludes it before aggregation ever runs. If NO_SCHEDULE ever reached
  // this page anyway, that is an upstream contract violation, never a
  // case to quietly render (S4D §9's own explicit instruction).
  for (const item of items) {
    if (item.readiness.reasons.includes("NO_SCHEDULE")) {
      throw new Error(
        `Invariant violation: Tomorrow Readiness item ${item.tripId} carries NO_SCHEDULE, which S4C's own query is supposed to have already excluded.`,
      );
    }
  }

  const needsPreparation = items.filter((item) => item.readiness.state === "NEEDS_PREPARATION");
  const ready = items.filter((item) => item.readiness.state === "READY");

  // P1-OPS-PROG2 inline readiness fix: an Assign / Add vehicle action only
  // for rows whose reasons are assignment-related AND whose Trip is in a
  // state the assignment RPCs accept. It opens the SAME PROG1 dialog +
  // Server Action; after success the dialog refreshes this page, so
  // readiness is re-derived (never forced to Ready).
  const assignActions = new Map<string, TomorrowAssignAction>();
  for (const item of needsPreparation) {
    const target = data.assignmentTargets[item.tripId];
    if (!target) continue;
    const action = deriveTomorrowAssignAction({
      state: target.state,
      hasActiveAssignment: target.activeAssignmentId !== null,
      reasons: item.readiness.reasons,
    });
    if (action) assignActions.set(item.tripId, action);
  }
  let assignmentOptions: AssignmentOptions | null = null;
  let operatorDriverId: string | null = null;
  let recurringHints: Record<string, RecurringAssignmentHint> = {};
  if (assignActions.size > 0) {
    try {
      const assignTargets = [...assignActions.entries()]
        .filter(([, action]) => action.mode === "assign")
        .map(([tripId]) => data.assignmentTargets[tripId]);
      [assignmentOptions, operatorDriverId, recurringHints] = await Promise.all([
        getAssignmentOptions(organization.organizationId),
        getOperatorLinkedDriverId(organization.organizationId),
        getRecurringAssignmentHints(
          organization.organizationId,
          assignTargets.map((t) => ({ tripId: t.id, recurringArrangementId: t.recurringArrangementId, scheduledPickupAt: t.scheduledPickupAt })),
        ),
      ]);
    } catch {
      // Options unavailable -> rows keep their "View trip" link only.
      assignmentOptions = null;
    }
  }

  // P1-OPS-PROG4: planned window + a NEUTRAL overlap badge per row, from ONE candidate set for tomorrow and the
  // canonical pure model. Informational only: readiness (READY / NEEDS_PREPARATION and the counts) is untouched.
  const extentLabels = new Map<string, string | null>();
  for (const item of items) {
    const target = data.assignmentTargets[item.tripId];
    extentLabels.set(item.tripId, target ? formatTripExtent(deriveTripExtent(target.scheduledPickupAt, target.expectedDurationMinutes), timezone) : null);
  }
  // Overlap facts unavailable -> no badges plus the incomplete note; readiness is unaffected. An incomplete set
  // keeps the known badges and adds one factual note: the absence of a badge then proves nothing.
  const { tripIds: overlapping, coverage: overlapCoverage } = await getKnownOverlapTripIds(
    organization.organizationId,
    { fromMs: Date.parse(data.tomorrowStartUtc), toMs: Date.parse(data.tomorrowEndUtc) },
    items.map((item) => data.assignmentTargets[item.tripId]).filter((t): t is NonNullable<typeof t> => Boolean(t)),
  ).catch(() => ({ tripIds: new Set<string>(), coverage: "incomplete" as const }));
  const extentText = (tripId: string) => extentLabels.get(tripId) ?? "Duration not set";

  const summaryItems: SummaryItem[] = [
    { label: totalScheduledTrips === 1 ? "scheduled trip" : "scheduled trips", value: totalScheduledTrips },
    { label: "ready", value: readyCount, dot: true },
  ];
  if (needsPreparationCount > 0) {
    summaryItems.push({ label: "need preparation", value: needsPreparationCount, tone: "warning", dot: true });
  }

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader title="Tomorrow" description={dateLabel} />
      <Link href="/operations/dispatch?day=tomorrow" className={cn(typography.bodySmall, "self-start font-medium text-text-link hover:underline")} data-testid="tomorrow-dispatch-link">
        Open in Dispatch
      </Link>

      {totalScheduledTrips === 0 ? (
        <Panel>
          <EmptyState
            title="No trips scheduled for tomorrow."
            description="Trips scheduled for tomorrow will appear here."
          />
        </Panel>
      ) : (
        <>
          <SummaryStrip inline items={summaryItems} />
          {overlapCoverage !== "complete" && (
            <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="tomorrow-overlap-incomplete">
              Some trip commitments could not be fully checked for other trips at the same time.
            </p>
          )}

          {needsPreparationCount === 0 ? (
            <Panel>
              <EmptyState
                title="Tomorrow is ready"
                description={`All ${totalScheduledTrips} scheduled ${totalScheduledTrips === 1 ? "trip is" : "trips are"} prepared based on the information currently available.`}
              />
            </Panel>
          ) : (
            <Panel className="p-0">
              <div className="flex items-center justify-between gap-4 p-zw-lg pb-0">
                <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Needs preparation</h2>
                <StatusBadge
                  label={`${needsPreparationCount} ${needsPreparationCount === 1 ? "Trip" : "Trips"}`}
                  category="warning"
                />
              </div>
              <div className="p-zw-lg">
                <ul className="divide-y divide-border-subtle">
                  {needsPreparation.map((item) => (
                    <li
                      key={item.tripId}
                      className="flex flex-col gap-2 py-zw-sm first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
                          {formatOperationsTime(item.scheduledPickupAt, timezone)} · {item.passengerDisplayName}
                        </p>
                        <p className={cn(typography.metadata, "text-text-muted")} data-testid="tomorrow-extent">
                          {extentText(item.tripId)}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {item.readiness.reasons.map((reason) => (
                            <StatusBadge key={reason} label={tripReadinessReasonLabel(reason)} category="warning" />
                          ))}
                          {overlapping.has(item.tripId) && <StatusBadge label="Overlaps another trip" category="neutral" />}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {assignmentOptions && assignActions.has(item.tripId) && (
                          <TripAssignmentButton
                            trip={data.assignmentTargets[item.tripId]}
                            driverOptions={assignmentOptions.driverOptions}
                            vehicleOptions={assignmentOptions.vehicleOptions}
                            operatorDriverId={operatorDriverId}
                            canManageDriverSetup={organization.role === "organization_admin"}
                            recurringHint={recurringHints[item.tripId] ?? null}
                            label={assignActions.get(item.tripId)?.label}
                            fullWidth={false}
                          />
                        )}
                        <LinkButton href={`/operations/trips/${item.tripId}`} variant="outline" size="sm" className="shrink-0">
                          View trip
                        </LinkButton>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}

          {ready.length > 0 && (
            <Panel className="p-0">
              <div className="p-zw-lg pb-0">
                <h2 className={cn(typography.subsectionHeading, "text-text-secondary")}>Ready</h2>
              </div>
              <div className="p-zw-lg">
                <ul className="divide-y divide-border-subtle">
                  {ready.map((item) => (
                    <li key={item.tripId} className="flex items-center justify-between gap-3 py-zw-xs first:pt-0 last:pb-0">
                      <Link
                        href={`/operations/trips/${item.tripId}`}
                        className={cn(typography.bodySmall, "min-w-0 flex-1 truncate text-text-secondary hover:text-text-link hover:underline")}
                      >
                        {formatOperationsTime(item.scheduledPickupAt, timezone)} · {item.passengerDisplayName}
                        <span className={cn(typography.metadata, "ml-2 text-text-muted")} data-testid="tomorrow-extent">
                          {extentText(item.tripId)}
                        </span>
                      </Link>
                      {overlapping.has(item.tripId) && <StatusBadge label="Overlaps another trip" category="neutral" />}
                      <span className={cn(typography.metadata, "shrink-0 text-success-text")}>Ready</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
