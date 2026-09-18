import Link from "next/link";
import { WarningCircle, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";
import { formatOperationsTime, formatOperationsLongDate, formatServiceDateLabel, assuranceStatusCategory } from "@/lib/operations/presentation";
import type { OperationsBriefData } from "@/lib/operations/operations-brief-core";
import type { TodaysOperationsTrip, TodaysOperationsAttentionItem } from "@/lib/operations/todays-operations";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface OperationsBriefProps {
  brief: OperationsBriefData;
  timezone: string;
}

/**
 * The Operations Brief (P1-E1-S1C) — the operator's briefing layer,
 * rendered above the existing Today's Operations detail. Answers "what
 * needs attention / what's happening now / what's coming next / who's
 * responsible" from data S1B already composed
 * (src/lib/operations/operations-brief-core.ts) — this component renders
 * that data, it does not re-filter, re-sort, or re-derive any of it.
 *
 * Four render modes, driven by `brief.dayState` plus the real contents of
 * `attention`/`activeNow` (never `organizations.business_stage` — P1-E1-
 * S1A §11's own explicit instruction):
 *   - QUIET: dayState=NO_TRIPS and both attention and activeNow are
 *     empty — a single calm "Nothing scheduled today" panel.
 *   - CARRYOVER: dayState=NO_TRIPS but attention or activeNow is
 *     non-empty (a prior-day trip still active, or an issue on it) —
 *     todaysOperations.ts's own activeTrips query has no day boundary
 *     (ZD-131), so this is a real, expected case, not a bug. Needs
 *     Attention and Active Now still render normally; Next Departures is
 *     skipped (it can only ever be empty here, since it is itself
 *     derived from today's — zero — scheduled trips) rather than
 *     stacking a redundant empty panel under an already-quiet headline.
 *   - ALL_COMPLETE: every trip today reached 'completed' — a single
 *     positive "All caught up" panel.
 *   - ACTIVE_DAY (default): the full 3-block grid, each with its own
 *     real content or its own calm empty state.
 * Driver Snapshot and Requests Awaiting Review both render in every
 * mode — neither is trip-scoped (P1-E1-S2G: a pending Request is
 * inbound demand, never a Trip operational failure, so it never joins
 * the day-state-gated Trip sections above).
 */
export function OperationsBrief({ brief, timezone }: OperationsBriefProps) {
  const {
    dayState,
    attention,
    activeNow,
    nextDepartures,
    unassignedCount,
    driverSnapshot,
    requestSummary,
    tomorrowReadiness,
    recurringCare,
    proofOfService,
  } = brief;

  const isQuiet = dayState === "NO_TRIPS" && activeNow.length === 0 && attention.length === 0;
  const isAllComplete = dayState === "ALL_COMPLETE";
  const isCarryoverOnly = dayState === "NO_TRIPS" && !isQuiet;

  return (
    <div className="flex flex-col gap-zw-lg">
      <div>
        <h2 className={cn(typography.sectionHeading, "text-text-primary")}>Operations Brief</h2>
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>
          What needs your attention and what is happening next.
        </p>
      </div>

      {isQuiet ? (
        <Panel>
          <EmptyState title="Nothing scheduled today" description="Trips scheduled for today will appear here." />
        </Panel>
      ) : isAllComplete ? (
        <Panel>
          <EmptyState title="All caught up" description="Every trip scheduled for today has been completed." />
        </Panel>
      ) : (
        <>
          {isCarryoverOnly && (
            <p className={cn(typography.bodySmall, "text-text-secondary")}>No new trips scheduled today.</p>
          )}
          <NeedsAttentionBlock items={attention} unassignedCount={unassignedCount} timezone={timezone} />
          {isCarryoverOnly ? (
            <ActiveNowBlock trips={activeNow} timezone={timezone} />
          ) : (
            <div className="grid grid-cols-1 gap-zw-lg lg:grid-cols-2">
              <ActiveNowBlock trips={activeNow} timezone={timezone} />
              <NextDeparturesBlock trips={nextDepartures} timezone={timezone} />
            </div>
          )}
        </>
      )}

      <DriverSnapshotBlock snapshot={driverSnapshot} />
      <RequestsAwaitingReviewBlock summary={requestSummary} timezone={timezone} />
      <TomorrowReadinessBlock summary={tomorrowReadiness} />
      <RecurringCareBlock summary={recurringCare} />
      <ProofOfServiceBlock summary={proofOfService} />
    </div>
  );
}

/** Restrained maximum row count for the Brief's own compact Needs Attention list (P1-E1-S1C §10) — the existing, unchanged, full Needs Attention table further down the page remains the "see everything" surface; this block's own overflow link goes to Dispatch, the same already-existing destination NEEDS_ASSIGNMENT rows already route to. */
const ATTENTION_ROW_LIMIT = 5;

function attentionItemHref(item: TodaysOperationsAttentionItem): string {
  return item.assurance.code === "NEEDS_ASSIGNMENT" ? "/operations/dispatch" : `/operations/trips/${item.trip.id}`;
}

function NeedsAttentionBlock({
  items,
  unassignedCount,
  timezone,
}: {
  items: TodaysOperationsAttentionItem[];
  unassignedCount: number;
  timezone: string;
}) {
  const visible = items.slice(0, ATTENTION_ROW_LIMIT);
  const overflowCount = items.length - visible.length;

  return (
    <Panel className="p-0">
      <div className="flex items-start justify-between gap-4 p-zw-lg pb-0">
        <div className="flex items-center gap-2">
          <WarningCircle className="size-5 text-warning-strong" weight="fill" aria-hidden />
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Needs Attention</h3>
        </div>
        {items.length > 0 && (
          <StatusBadge label={`${items.length} ${items.length === 1 ? "Item" : "Items"}`} category="warning" />
        )}
      </div>

      {unassignedCount > 0 && (
        <p className={cn(typography.bodySmall, "px-zw-lg pt-zw-sm text-text-secondary")}>
          {unassignedCount} {unassignedCount === 1 ? "trip needs" : "trips need"} a driver.
        </p>
      )}

      <div className="p-zw-lg">
        {items.length === 0 ? (
          <EmptyState title="Nothing needs attention" description="No open issues, unassigned trips, or location concerns right now." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {visible.map((item) => (
              <li
                key={item.trip.id}
                className="flex flex-col gap-2 py-zw-sm first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
                      {formatOperationsTime(item.trip.scheduledPickupAt, timezone)} · {item.trip.passengerName}
                    </p>
                    <StatusBadge label={item.assurance.label} category={assuranceStatusCategory(item.assurance.code)} />
                  </div>
                  <p className={cn(typography.metadata, "truncate text-text-muted")}>
                    {item.trip.pickupDescription} <ArrowRight className="inline size-3" aria-hidden />{" "}
                    {item.trip.destinationDescription}
                  </p>
                  <p className={cn(typography.metadata, "text-text-secondary")}>{item.assurance.explanation}</p>
                </div>
                <LinkButton href={attentionItemHref(item)} variant="outline" size="sm" className="shrink-0">
                  {item.assurance.code === "NEEDS_ASSIGNMENT" ? "Assign" : "Open Trip"}
                </LinkButton>
              </li>
            ))}
          </ul>
        )}

        {overflowCount > 0 && (
          <div className="mt-zw-md border-t border-border-subtle pt-zw-md text-center">
            <Link
              href="/operations/dispatch"
              className={cn(typography.bodySmall, "inline-flex items-center gap-1 font-medium text-text-link hover:underline")}
            >
              +{overflowCount} more in Dispatch <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Matches SectionHeader's own visual styling (title + description) but at
 * heading level 3 — every Brief sub-block nests under the Brief's own h2
 * "Operations Brief" (accessibility: a screen-reader heading-level scan
 * must see Brief -> its 4 blocks as a real h2 -> h3 nesting, not a second,
 * competing set of page-level h2s alongside the existing Needs Attention/
 * Upcoming Trips/Active Trips/Activity Log panels below). */
function BlockHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>{title}</h3>
      {description && <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{description}</p>}
    </div>
  );
}

function ActiveNowBlock({ trips, timezone }: { trips: TodaysOperationsTrip[]; timezone: string }) {
  return (
    <Panel>
      <BlockHeading title="Active Now" description="What's happening right now." />
      <div className="mt-zw-md">
        {trips.length === 0 ? (
          <EmptyState title="Nothing in progress" description="Trips currently underway will appear here." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {trips.map((trip) => (
              <li key={trip.id} className="py-zw-sm first:pt-0 last:pb-0">
                <Link
                  href={`/operations/trips/${trip.id}`}
                  className="flex items-center justify-between gap-3 rounded-sm px-zw-sm py-zw-xs hover:bg-surface-hover"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full bg-info-strong" aria-hidden />
                    <div className="min-w-0">
                      <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")}>
                        {formatOperationsTime(trip.scheduledPickupAt, timezone)} · {trip.passengerName}
                      </p>
                      <p className={cn(typography.metadata, "truncate text-text-muted")}>
                        {trip.pickupDescription} → {trip.destinationDescription}
                      </p>
                    </div>
                  </div>
                  <span className={cn(typography.bodySmall, "shrink-0 font-medium text-info-text")}>{trip.statusLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function NextDeparturesBlock({ trips, timezone }: { trips: TodaysOperationsTrip[]; timezone: string }) {
  return (
    <Panel>
      <BlockHeading title="Next Departures" description="Scheduled to depart within 2 hours." />
      <div className="mt-zw-md">
        {trips.length === 0 ? (
          <EmptyState title="Nothing departing soon" description="No trips scheduled to depart in the next 2 hours." />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {trips.map((trip) => (
              <li key={trip.id} className="py-zw-sm first:pt-0 last:pb-0">
                <Link
                  href={`/operations/trips/${trip.id}`}
                  className="flex items-center justify-between gap-3 rounded-sm px-zw-sm py-zw-xs hover:bg-surface-hover"
                >
                  <div className="min-w-0">
                    <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")}>
                      {formatOperationsTime(trip.scheduledPickupAt, timezone)} · {trip.passengerName}
                    </p>
                    <p className={cn(typography.metadata, "truncate text-text-muted")}>
                      {trip.pickupDescription} → {trip.destinationDescription}
                    </p>
                  </div>
                  <span className={cn(typography.metadata, "shrink-0 text-text-muted")}>{trip.statusLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function DriverSnapshotBlock({ snapshot }: { snapshot: OperationsBriefData["driverSnapshot"] }) {
  const { totalActiveDrivers, driversCurrentlyOnTrip } = snapshot;
  const hasDrivers = totalActiveDrivers > 0;

  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Driver Snapshot</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>
          {hasDrivers
            ? `On trip now: ${driversCurrentlyOnTrip} of ${totalActiveDrivers} active drivers`
            : "No drivers set up yet."}
        </p>
      </div>
      <LinkButton href={hasDrivers ? "/operations/dispatch" : "/operations/drivers"} variant="outline" size="sm">
        {hasDrivers ? "View Dispatch" : "Set up drivers"}
      </LinkButton>
    </Panel>
  );
}

/**
 * Requests awaiting review (P1-E1-S2G) — answers "is there inbound
 * transportation demand I have not reviewed yet?" Mirrors
 * DriverSnapshotBlock's own compact single-row shape exactly (same Panel
 * layout, same label/value/action structure) rather than inventing a new
 * visual pattern. Deliberately calm: no WarningCircle icon, no
 * StatusBadge, no warning color — a pending Request is inbound demand,
 * never a Trip operational failure, so this block never competes
 * visually with Needs Attention above. "Review requests" always routes
 * to Request Hub's own actual Pending filter contract
 * (`?state=pending`, requests-list.ts's own query parameter — no new
 * parameter invented here).
 */
function RequestsAwaitingReviewBlock({
  summary,
  timezone,
}: {
  summary: OperationsBriefData["requestSummary"];
  timezone: string;
}) {
  const { pendingRequestCount, oldestPendingRequestCreatedAt } = summary;
  const hasPending = pendingRequestCount > 0;

  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Requests awaiting review</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>
          {hasPending ? `${pendingRequestCount} ${pendingRequestCount === 1 ? "request" : "requests"}` : "No requests awaiting review"}
        </p>
        {hasPending && oldestPendingRequestCreatedAt && (
          <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
            Oldest request received {formatOperationsLongDate(new Date(oldestPendingRequestCreatedAt), timezone)}
          </p>
        )}
      </div>
      <LinkButton href="/operations/requests?state=pending" variant="outline" size="sm">
        Review requests
      </LinkButton>
    </Panel>
  );
}

/**
 * Tomorrow Readiness (P1-E1-S4E) — mirrors DriverSnapshotBlock's and
 * RequestsAwaitingReviewBlock's own compact single-row shape exactly
 * (same Panel layout, same fixed-title/varying-description/single-action
 * structure) — no new visual pattern. Deliberately calm at every count,
 * including when `needsPreparationCount > 0`: no StatusBadge, no
 * WarningCircle, no warning-toned text — the SAME restraint
 * RequestsAwaitingReviewBlock already establishes for exactly the same
 * reason ("never compete visually with Needs Attention above"). Tomorrow
 * preparation is workflow, not a current operational failure (S4E §8's
 * own explicit instruction).
 *
 * Reuses `TomorrowReadinessData`'s already-authoritative counts
 * end-to-end — this component performs no filtering, sorting, or
 * re-evaluation of its own; `summary` is `null` only when the underlying
 * fetch genuinely failed (S4E §11), never used to represent a real zero
 * value.
 */
function TomorrowReadinessBlock({ summary }: { summary: OperationsBriefData["tomorrowReadiness"] }) {
  if (summary === null) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Tomorrow readiness</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-muted")}>Tomorrow readiness unavailable</p>
        </div>
        <LinkButton href="/operations/tomorrow" variant="outline" size="sm">
          View tomorrow
        </LinkButton>
      </Panel>
    );
  }

  const { totalScheduledTrips, needsPreparationCount } = summary;

  if (totalScheduledTrips === 0) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Tomorrow readiness</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>No trips scheduled for tomorrow</p>
        </div>
        <LinkButton href="/operations/tomorrow" variant="outline" size="sm">
          View tomorrow
        </LinkButton>
      </Panel>
    );
  }

  if (needsPreparationCount === 0) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Tomorrow readiness</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>
            Tomorrow is ready — all {totalScheduledTrips} scheduled {totalScheduledTrips === 1 ? "trip is" : "trips are"} prepared
            based on the information currently available.
          </p>
        </div>
        <LinkButton href="/operations/tomorrow" variant="outline" size="sm">
          View tomorrow
        </LinkButton>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Tomorrow readiness</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>
          {needsPreparationCount} {needsPreparationCount === 1 ? "trip needs" : "trips need"} preparation
        </p>
        <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
          {totalScheduledTrips} scheduled for tomorrow
        </p>
      </div>
      <LinkButton href="/operations/tomorrow" variant="outline" size="sm">
        Review tomorrow
      </LinkButton>
    </Panel>
  );
}

/**
 * Recurring Care (P1-E2-S1F) — mirrors TomorrowReadinessBlock's own
 * compact single-row shape and fixed-title/varying-description structure
 * exactly (same Panel layout, same "Recurring care" heading in every
 * state — never a state-dependent heading, matching every other Brief
 * block's own convention of keeping the h3 identity label constant and
 * varying only the body copy, so a screen-reader heading-level scan
 * always sees the same fixed set of Brief sub-headings regardless of
 * data). Answers exactly "Which expected recurring occurrences do not
 * yet have qualifying Trips?" (§2) — never Trip Readiness reasons, open
 * Trip exceptions, Driver/Vehicle inactivity, or today's execution
 * problems, all already owned by other blocks above.
 *
 * `summary` is `null` only on a genuine fetch failure (§17 — "Unknown ≠
 * healthy") and renders "Recurring care unavailable," never silently
 * falling back to a covered/zero appearance. `activeArrangementCount
 * === 0` is a real discovery state (§6), not an error — restrained
 * "Set up recurring care" copy, no 0-missing/0-scheduled numbers shown.
 * `missingOccurrenceCount === 0` (with active arrangements) is a calm,
 * factual "covered" state (§7) — deliberately never claims recurring
 * care "will run successfully," since Trip Readiness/execution are
 * separate concerns this block does not speak to. `missingOccurrenceCount
 * > 0` uses restrained attention styling (a warm text tone on the count
 * line only — no WarningCircle icon, no StatusBadge, §13) — visually
 * quieter than Needs Attention's own stronger current-execution
 * hierarchy, consistent with Recurring Care being forward planning, not
 * an active incident. `nextMissingDate` (already an authoritative LOCAL
 * SERVICE DATE string from the evaluator's own per-arrangement timezone
 * resolution) is rendered via `formatServiceDateLabel` — the same
 * date-key-only formatter the Recurring Care workspace itself uses,
 * never re-interpreted through the browser's timezone.
 */
function RecurringCareBlock({ summary }: { summary: OperationsBriefData["recurringCare"] }) {
  if (summary === null) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Recurring care</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-muted")}>Recurring care unavailable</p>
        </div>
        <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
          View recurring care
        </LinkButton>
      </Panel>
    );
  }

  const { activeArrangementCount, missingOccurrenceCount, arrangementsWithMissingCount, nextMissingDate } = summary;

  if (activeArrangementCount === 0) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Recurring care</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>No recurring transportation set up</p>
        </div>
        <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
          Set up recurring care
        </LinkButton>
      </Panel>
    );
  }

  if (missingOccurrenceCount === 0) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Recurring care</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Recurring care is covered</p>
          <p className={cn(typography.metadata, "mt-1 text-text-muted")}>All expected rides in the next 14 days have trips scheduled.</p>
        </div>
        <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
          View recurring care
        </LinkButton>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Recurring care</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-warning-text")}>
          {missingOccurrenceCount} recurring {missingOccurrenceCount === 1 ? "ride" : "rides"} need{missingOccurrenceCount === 1 ? "s" : ""} scheduling
        </p>
        <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
          Across {arrangementsWithMissingCount} {arrangementsWithMissingCount === 1 ? "arrangement" : "arrangements"}
          {nextMissingDate && ` · Next gap: ${formatServiceDateLabel(nextMissingDate)}`}
        </p>
      </div>
      <LinkButton href="/operations/recurring-care" variant="outline" size="sm">
        Review recurring care
      </LinkButton>
    </Panel>
  );
}

/**
 * Proof of Service (P1-E3-S1F) — mirrors `TomorrowReadinessBlock`'s/
 * `RecurringCareBlock`'s own compact single-row shape and fixed-title/
 * varying-description structure exactly (same Panel layout, same "Proof
 * of service" heading in every state — never state-dependent). Answers
 * exactly one question: "does any recently completed transportation need
 * operational evidence review before billing?" (§Mission) — never a
 * revenue amount, a claim/invoice/payment state, or a payer-compliance
 * judgment (none of that data exists in this schema — see docs/reports/
 * p1-e3-s1a-revenue-assurance-foundation-audit.txt). This block owns
 * ONLY completed-service evidence review — never live Trip execution,
 * Trip Readiness, Tomorrow Readiness, Recurring Care gaps, Requests
 * awaiting review, Driver capacity, or any monetary concept, all already
 * owned by other Brief blocks or explicitly out of scope for this
 * product today (§12).
 *
 * WINDOW: always Yesterday, in the organization's local timezone (§3,
 * locked) — never Today, never Last 7 Days; the summary itself
 * (`getProofOfServiceSummary`) only ever evaluates that one window. The
 * "Review proof of service"/"View proof of service" action always routes
 * to `/operations/proof-of-service`, which itself already defaults to
 * Yesterday (P1-E3-S1D) — no query param is needed here to keep the two
 * in sync.
 *
 * `summary` is `null` only on a genuine fetch failure OR a deliberate
 * whole-window "unavailable" decision (a safety-cap trip or a detected
 * truncation — trip-proof-of-service.ts's own `getYesterdayProofOfServiceResults`,
 * S1F §9/§11 — "Unknown ≠ healthy") — renders "Proof-of-service review
 * unavailable," never silently falling back to a covered/zero appearance.
 * `completedTripCount === 0` is a real, successfully-fetched "nothing to
 * review" state (§13), not an error — restrained copy, never "No
 * revenue"/"No billable trips"/"Everything ready." `needsReviewCount ===
 * 0` (with completed trips present) is a calm, factual "ready for
 * review" state (§14) — deliberately never "ready to bill"/"claim
 * ready"/"revenue secured," since none of those claims is one this
 * product can truthfully make. `needsReviewCount > 0` uses the SAME
 * restrained warm-text-only attention styling `RecurringCareBlock`
 * already established (§18 — "lower urgency than active Trip exception
 * or current operational failure," no WarningCircle icon, no
 * StatusBadge, no critical-red treatment) — administrative follow-through
 * on completed work, not a current incident. An `evidenceIntegrityGapCount
 * > 0` contribution adds one restrained extra line (§16) without ever
 * exposing which specific internal-integrity cause produced it and
 * without turning the whole block critical.
 */
function ProofOfServiceBlock({ summary }: { summary: OperationsBriefData["proofOfService"] }) {
  if (summary === null) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Proof of service</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-muted")}>Proof-of-service review unavailable</p>
        </div>
        <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
          View proof of service
        </LinkButton>
      </Panel>
    );
  }

  const { completedTripCount, needsReviewCount, evidenceIntegrityGapCount } = summary;

  if (completedTripCount === 0) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Proof of service</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>No completed trips to review from yesterday.</p>
        </div>
        <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
          View proof of service
        </LinkButton>
      </Panel>
    );
  }

  if (needsReviewCount === 0) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Proof of service</h3>
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>Yesterday&apos;s completed trips are ready for review.</p>
          <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
            {completedTripCount} completed {completedTripCount === 1 ? "trip has" : "trips have"} the required operational evidence.
          </p>
        </div>
        <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
          View proof of service
        </LinkButton>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Proof of service</h3>
        <p className={cn(typography.bodySmall, "mt-1 text-warning-text")}>
          {needsReviewCount} completed {needsReviewCount === 1 ? "trip needs" : "trips need"} review
        </p>
        <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
          From {completedTripCount} completed {completedTripCount === 1 ? "trip" : "trips"} yesterday.
        </p>
        {evidenceIntegrityGapCount > 0 && (
          <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
            {evidenceIntegrityGapCount} {evidenceIntegrityGapCount === 1 ? "has" : "have"} incomplete service evidence.
          </p>
        )}
      </div>
      <LinkButton href="/operations/proof-of-service" variant="outline" size="sm">
        Review proof of service
      </LinkButton>
    </Panel>
  );
}
