import Link from "next/link";
import { WarningCircle, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/LinkButton";
import { formatOperationsTime, assuranceStatusCategory } from "@/lib/operations/presentation";
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
 * Driver Snapshot renders in every mode — it is not trip-scoped.
 */
export function OperationsBrief({ brief, timezone }: OperationsBriefProps) {
  const { dayState, attention, activeNow, nextDepartures, unassignedCount, driverSnapshot } = brief;

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
