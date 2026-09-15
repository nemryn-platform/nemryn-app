"use client";

import { MapPin } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatOperationsTime } from "@/lib/operations/presentation";
import {
  gridHourLabels,
  gridBlockLeftPx,
  orgLocalHourMinute,
  GRID_START_HOUR,
  GRID_TOTAL_WIDTH_PX,
  GRID_HOUR_WIDTH_PX,
  GRID_BLOCK_WIDTH_PX,
  GRID_ROW_HEIGHT_PX,
} from "@/lib/operations/dispatch-grid";
import type { DispatchDriverRow, DispatchTrip } from "@/lib/operations/dispatch-board";
import {
  classifyLocationFreshness,
  formatLocationFreshnessLabel,
  formatLocationFreshnessLabelCompact,
} from "@/lib/operations/location-freshness";
import { externalMapUrl } from "@/lib/operations/live-location-shared";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface AssignmentGridProps {
  driverRows: DispatchDriverRow[];
  timezone: string;
  onReassign: (trip: DispatchTrip) => void;
}

/** Bare active-state labels read as "in progress" (teal); "Assigned"/"Scheduled" read as pending — matches the same category distinction TripStatus/operationsTripStatusLabel already makes, applied to plain text here rather than a full badge, to keep the dense grid scannable. */
const IN_PROGRESS_LABELS = new Set(["En Route", "Arrived", "Passenger Onboard"]);

// P1-E3-S8B: widened from 140px — real driver names plus a vehicle label
// and freshness link were visibly truncating mid-word in QA (work item
// §12/§28). Unlike the trip-block width below, this column carries no
// time semantics, so widening it has no misleading side effect.
const ROW_LABEL_WIDTH_PX = 168;

/**
 * "Today's Assignments" — the center time-axis grid
 * (docs/design/stitch/references/03-dispatch-board.png). One row per
 * active Driver in the organization (including a Driver with zero Trips
 * today — matches the reference's own "C. Davis / Unassigned" empty row,
 * giving a Dispatcher visibility into who has NO work today, not just who
 * does), Trip blocks positioned by real `scheduled_pickup_at` only — see
 * src/lib/operations/dispatch-grid.ts for why block WIDTH is fixed rather
 * than duration-proportional (no duration field exists on `trips`).
 *
 * Click a block to reassign it — no drag-and-drop (ZD-1xx, work item §22):
 * the reference's spatial layout suggests it, but no interaction contract
 * confirms it, and drag-and-drop introduces real accessibility/mutation-
 * ambiguity risk a deliberate click → dialog → confirm flow avoids.
 */
export function AssignmentGrid({ driverRows, timezone, onReassign }: AssignmentGridProps) {
  const hourLabels = gridHourLabels();

  return (
    <div className="flex flex-col gap-zw-md">
      <div className="flex items-center justify-between">
        <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Today&rsquo;s Assignments</h2>
        <span className={cn(typography.metadata, "rounded-full bg-surface-secondary px-2.5 py-1 text-text-muted")}>
          {hourLabels[0].label} – {hourLabels[hourLabels.length - 1].label}
        </span>
      </div>

      <Panel className="overflow-x-auto p-0">
        {driverRows.length === 0 ? (
          <div className="p-zw-lg">
            <EmptyState title="No active drivers" description="Add an active driver to see assignments here." />
          </div>
        ) : (
          <div style={{ width: ROW_LABEL_WIDTH_PX + GRID_TOTAL_WIDTH_PX }}>
            <div className="flex border-b border-border-subtle bg-surface-secondary">
              <div className="shrink-0 border-r border-border-subtle" style={{ width: ROW_LABEL_WIDTH_PX }} />
              <div className="relative" style={{ width: GRID_TOTAL_WIDTH_PX, height: 32 }}>
                {hourLabels.map(({ hour, label }) => (
                  <span
                    key={hour}
                    className={cn(typography.metadata, "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-text-muted")}
                    style={{ left: (hour - GRID_START_HOUR) * GRID_HOUR_WIDTH_PX }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {driverRows.map((row) => {
              // P1-E3-S7A — the row's own live-location indicator (work
              // item §24: "Driver row → last known location state →
              // freshness indicator"), not per-block, to keep the grid
              // scannable. At most one of a Driver's trips is genuinely
              // in the tracking window at a time in practice; the first
              // one found with a location is what's shown.
              const trackedTrip = row.trips.find((trip) => trip.driverLocation !== null);
              const location = trackedTrip?.driverLocation ?? null;
              const now = new Date();
              const freshness = location ? classifyLocationFreshness(location.recordedAt, now) : "none";

              return (
              <div key={row.driver.id} className="flex border-b border-border-subtle last:border-b-0">
                <div
                  className="flex shrink-0 flex-col justify-center gap-0.5 border-r border-border-subtle px-3"
                  style={{ width: ROW_LABEL_WIDTH_PX, height: GRID_ROW_HEIGHT_PX }}
                >
                  <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")} title={row.driver.displayName}>
                    {row.driver.displayName}
                  </p>
                  {row.trips[0]?.vehicleLabel && (
                    <p className={cn(typography.metadata, "truncate text-text-muted")} title={row.trips[0].vehicleLabel}>
                      {row.trips[0].vehicleLabel}
                    </p>
                  )}
                  {location && (
                    <a
                      href={externalMapUrl(location.latitude, location.longitude)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        typography.metadata,
                        "flex items-center gap-1 truncate hover:underline",
                        freshness === "live" && "text-success-strong",
                        freshness === "recent" && "text-text-secondary",
                        freshness === "stale" && "text-text-muted",
                      )}
                      title={formatLocationFreshnessLabel(location.recordedAt, now)}
                    >
                      <MapPin className="size-3 shrink-0" aria-hidden weight={freshness === "live" ? "fill" : "regular"} />
                      <span className="truncate">{formatLocationFreshnessLabelCompact(location.recordedAt, now)}</span>
                    </a>
                  )}
                </div>

                <div className="relative" style={{ width: GRID_TOTAL_WIDTH_PX, height: GRID_ROW_HEIGHT_PX }}>
                  {hourLabels.map(({ hour }) => (
                    <div
                      key={hour}
                      className="absolute top-0 bottom-0 border-l border-border-subtle/60"
                      style={{ left: (hour - GRID_START_HOUR) * GRID_HOUR_WIDTH_PX }}
                      aria-hidden
                    />
                  ))}

                  {row.trips.map((trip) => {
                    const { hour, minute } = trip.scheduledPickupAt
                      ? orgLocalHourMinute(trip.scheduledPickupAt, timezone)
                      : { hour: GRID_START_HOUR, minute: 0 };
                    const left = gridBlockLeftPx(hour, minute);

                    return (
                      <button
                        key={trip.id}
                        type="button"
                        data-trip-id={trip.id}
                        onClick={() => onReassign(trip)}
                        className="absolute top-1/2 -translate-y-1/2 rounded-sm border border-border-subtle bg-surface-elevated px-2 py-1.5 text-left shadow-sm transition-colors hover:border-selection-border focus-visible:border-border-focus"
                        style={{ left, width: GRID_BLOCK_WIDTH_PX }}
                        aria-label={`Reassign ${trip.passengerName}'s trip at ${formatOperationsTime(trip.scheduledPickupAt, timezone)}, currently assigned to ${row.driver.displayName}${trip.hasOpenException ? " — has an open issue" : ""}`}
                      >
                        {/* P1-E3-S8 — a small, restrained open-exception marker (work item §31: "small attention marker... use restraint"). Never color-only (aria-label above already states it in words). */}
                        {trip.hasOpenException && (
                          <span
                            className="absolute -right-1 -top-1 size-2.5 rounded-full border border-surface-elevated bg-warning-strong"
                            aria-hidden
                            title="Open issue reported"
                          />
                        )}
                        <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")} title={trip.passengerName}>
                          {trip.passengerName}
                        </p>
                        <p
                          className={cn(
                            typography.metadata,
                            "truncate",
                            IN_PROGRESS_LABELS.has(trip.statusLabel) ? "text-info-text" : "text-text-muted",
                          )}
                        >
                          {formatOperationsTime(trip.scheduledPickupAt, timezone)} · {trip.statusLabel}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
