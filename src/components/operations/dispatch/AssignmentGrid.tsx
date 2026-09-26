"use client";

import type { ReactNode } from "react";
import { MapPin } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatOperationsTime } from "@/lib/operations/presentation";
import {
  extentBlockGeometry,
  hoursFromDayStart,
  EXTENT_HOUR_WIDTH_PX,
  EXTENT_LANE_HEIGHT_PX,
  EXTENT_ROW_MIN_HEIGHT_PX,
} from "@/lib/operations/dispatch-grid";
import { assignLanes, deriveAxisHours, deriveTripExtent, formatTripExtent } from "@/lib/operations/trip-overlap-core";
import { DRIVER_NOW_STATUS_LABEL } from "@/lib/operations/availability-core";
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
  /** P1-OPS-PROG4: the board's org-local day ("today" | "tomorrow") and its start instant (UTC ISO). */
  day: "today" | "tomorrow";
  dayStartUtc: string;
  onReassign: (trip: DispatchTrip) => void;
  /** P1-OPS-PROG1: role-appropriate next steps shown with the "No active drivers" empty state. */
  emptyAction?: ReactNode;
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
export function AssignmentGrid({ driverRows, timezone, day, dayStartUtc, onReassign, emptyAction }: AssignmentGridProps) {
  // P1-OPS-PROG4 -- fact-derived axis: default 6:00-20:00, widened to cover every trip's start and KNOWN planned
  // end on this day. Widths come only from a known duration; unknown durations get a fixed labelled chip.
  const dayStartMs = Date.parse(dayStartUtc);
  const allTrips = driverRows.flatMap((row) => row.trips);
  const axis = deriveAxisHours(
    allTrips
      .filter((trip) => trip.scheduledPickupAt)
      .map((trip) => {
        const extent = deriveTripExtent(trip.scheduledPickupAt, trip.expectedDurationMinutes);
        const start = hoursFromDayStart(Date.parse(trip.scheduledPickupAt as string), dayStartMs);
        return { start, end: extent.kind === "known" ? hoursFromDayStart(extent.endMs, dayStartMs) : null };
      }),
  );
  const totalWidth = (axis.end - axis.start) * EXTENT_HOUR_WIDTH_PX;
  const hourMarks: { hour: number; label: string }[] = [];
  for (let hour = axis.start; hour <= axis.end; hour++) {
    hourMarks.push({
      hour,
      label: new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: timezone }).format(new Date(dayStartMs + hour * 3_600_000)),
    });
  }

  return (
    <div className="flex flex-col gap-zw-md">
      <div className="flex items-center justify-between">
        <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>{day === "tomorrow" ? "Tomorrow's Assignments" : "Today\u2019s Assignments"}</h2>
        <span className={cn(typography.metadata, "rounded-full bg-surface-secondary px-2.5 py-1 text-text-muted")} data-testid="dispatch-axis">
          {hourMarks[0].label} – {hourMarks[hourMarks.length - 1].label}
        </span>
      </div>

      <Panel className="overflow-x-auto p-0" data-testid="dispatch-grid">
        {driverRows.length === 0 ? (
          <div className="p-zw-lg">
            <EmptyState title="No active drivers" description="Add an active driver to see assignments here." action={emptyAction} />
          </div>
        ) : (
          <div style={{ width: ROW_LABEL_WIDTH_PX + totalWidth }}>
            <div className="flex border-b border-border-subtle bg-surface-secondary">
              <div className="shrink-0 border-r border-border-subtle" style={{ width: ROW_LABEL_WIDTH_PX }} />
              <div className="relative" style={{ width: totalWidth, height: 32 }}>
                {hourMarks.map(({ hour, label }) => (
                  <span
                    key={hour}
                    className={cn(typography.metadata, "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 whitespace-nowrap text-text-muted")}
                    style={{ left: (hour - axis.start) * EXTENT_HOUR_WIDTH_PX }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {driverRows.map((row) => {
              // P1-E3-S7A -- the row's own live-location indicator.
              const trackedTrip = row.trips.find((trip) => trip.driverLocation !== null);
              const location = trackedTrip?.driverLocation ?? null;
              const now = new Date();
              const freshness = location ? classifyLocationFreshness(location.recordedAt, now) : "none";

              const geometries = new Map(
                row.trips.map((trip) => [
                  trip.id,
                  extentBlockGeometry(
                    { startMs: trip.scheduledPickupAt ? Date.parse(trip.scheduledPickupAt) : dayStartMs + axis.start * 3_600_000, durationMinutes: trip.expectedDurationMinutes },
                    dayStartMs,
                    axis,
                  ),
                ]),
              );
              const lanes = assignLanes(row.trips.map((trip) => ({ id: trip.id, left: geometries.get(trip.id)!.left, width: geometries.get(trip.id)!.width })));
              const laneCount = Math.max(1, ...[...lanes.values()].map((lane) => lane + 1));
              const rowHeight = Math.max(EXTENT_ROW_MIN_HEIGHT_PX, laneCount * EXTENT_LANE_HEIGHT_PX + 12);

              return (
              <div key={row.driver.id} className="flex border-b border-border-subtle last:border-b-0" data-driver-row={row.driver.id}>
                <div
                  className="flex shrink-0 flex-col justify-center gap-0.5 border-r border-border-subtle px-3"
                  style={{ width: ROW_LABEL_WIDTH_PX, height: rowHeight }}
                >
                  <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")} title={row.driver.displayName}>
                    {row.driver.displayName}
                  </p>
                  {/* P1-OPS-PROG5B: Today = canonical NOW status; Tomorrow = working-hours / time-off facts (never "available tomorrow"). */}
                  {(() => {
                    const a = row.availability;
                    const text = a.nowStatus
                      ? DRIVER_NOW_STATUS_LABEL[a.nowStatus]
                      : a.day
                        ? [a.day.scheduleConfigured ? (a.day.hours.length ? a.day.hours.join(", ") : "No working hours") : "Schedule not set", ...a.day.timeOff.map((t) => `Time off ${t}`)].join(" · ")
                        : null;
                    return text ? (
                      <p className={cn(typography.metadata, "truncate text-text-secondary")} title={text} data-testid="row-availability">
                        {text}
                      </p>
                    ) : null;
                  })()}
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

                <div className="relative" style={{ width: totalWidth, height: rowHeight }}>
                  {hourMarks.map(({ hour }) => (
                    <div
                      key={hour}
                      className="absolute top-0 bottom-0 border-l border-border-subtle/60"
                      style={{ left: (hour - axis.start) * EXTENT_HOUR_WIDTH_PX }}
                      aria-hidden
                    />
                  ))}

                  {row.trips.map((trip) => {
                    const g = geometries.get(trip.id)!;
                    const lane = lanes.get(trip.id) ?? 0;
                    const extentLabel = formatTripExtent(deriveTripExtent(trip.scheduledPickupAt, trip.expectedDurationMinutes), timezone);
                    const overlaps = trip.overlap.driver === "overlap" || trip.overlap.vehicle === "overlap";
                    // R2: another active commitment of this driver / vehicle has no pickup time, so it is not on the board.
                    const notFullyCheckable =
                      !overlaps &&
                      (trip.overlap.driver === "not_fully_checkable" || trip.overlap.vehicle === "not_fully_checkable" || trip.overlap.unknownTimeCommitment);
                    const flags = [
                      overlaps ? "Overlaps another trip" : null,
                      notFullyCheckable ? "Can't fully check" : null,
                      trip.pastPlannedEnd ? "Past planned end" : null,
                      ...trip.availabilityFlags,
                      g.continuesAfter ? "→ next day" : null,
                      g.clippedStart ? "← earlier" : null,
                    ].filter(Boolean) as string[];

                    return (
                      <button
                        key={trip.id}
                        type="button"
                        data-trip-id={trip.id}
                        data-extent={g.known ? "known" : "unknown"}
                        data-lane={lane}
                        data-overlap={overlaps ? "1" : "0"}
                        data-availability={trip.availabilityFlags.join("|")}
                        data-unknown-time={trip.overlap.unknownTimeCommitment ? "1" : "0"}
                        onClick={() => onReassign(trip)}
                        className={cn(
                          "absolute overflow-hidden rounded-sm border bg-surface-elevated px-2 py-1 text-left shadow-sm transition-colors hover:border-selection-border focus-visible:border-border-focus",
                          g.known ? "border-border-subtle" : "border-dashed border-border-strong",
                          overlaps && "border-warning-border",
                        )}
                        style={{ left: g.left, width: g.width, top: 6 + lane * EXTENT_LANE_HEIGHT_PX, height: EXTENT_LANE_HEIGHT_PX - 8 }}
                        title={`${trip.passengerName} · ${extentLabel ?? `${formatOperationsTime(trip.scheduledPickupAt, timezone)} · duration not set`}${flags.length ? ` · ${flags.join(" · ")}` : ""}`}
                        aria-label={`Reassign ${trip.passengerName}'s trip at ${formatOperationsTime(trip.scheduledPickupAt, timezone)}, currently assigned to ${row.driver.displayName}${extentLabel ? `, planned ${extentLabel}` : ", duration not set"}${flags.length ? ` — ${flags.join(", ")}` : ""}${trip.hasOpenException ? " — has an open issue" : ""}`}
                      >
                        {/* P1-E3-S8 — a small, restrained open-exception marker. Never color-only (aria-label states it). */}
                        {trip.hasOpenException && (
                          <span
                            className="absolute right-1 top-1 size-2 rounded-full bg-warning-strong"
                            aria-hidden
                            title="Open issue reported"
                          />
                        )}
                        <p className={cn(typography.bodySmall, "truncate font-medium text-text-primary")}>{trip.passengerName}</p>
                        <p className={cn(typography.metadata, "truncate", IN_PROGRESS_LABELS.has(trip.statusLabel) ? "text-info-text" : "text-text-muted")}>
                          {g.known ? extentLabel : `${formatOperationsTime(trip.scheduledPickupAt, timezone)} · Duration not set`} · {trip.statusLabel}
                          {flags.length > 0 && <span className={overlaps ? "text-warning-text" : undefined}> · {flags.join(" · ")}</span>}
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
