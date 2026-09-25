import { overlapNotices } from "@/lib/operations/trip-overlap-core";
import type { AssignmentOverlapView } from "@/lib/operations/trip-overlap";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * P1-OPS-PROG4B-R1: the view for an overlap read that FAILED -- uncertainty, never silence (silence would read as
 * "nothing to worry about"). Renders the same factual "Can't fully check this assignment right now." line.
 */
export function overlapUnavailableView(hasDriver: boolean, hasVehicle: boolean): AssignmentOverlapView {
  const unresolved = { status: "not_fully_checkable" as const, overlaps: [], missingExtentCount: 0, missingScheduleCount: 0, stillOpenCount: 0, candidateSetIncomplete: true };
  return {
    targetExtentLabel: null,
    targetUnknownReason: null,
    driver: hasDriver ? unresolved : null,
    vehicle: hasVehicle ? unresolved : null,
  };
}

/**
 * P1-OPS-PROG4 overlap facts for one target, rendered from the single copy
 * source (overlapNotices). Known overlaps list the other trip's planned
 * extent + route. Purely informational: it never disables or hides an
 * action.
 */
export function OverlapNotes({ view }: { view: AssignmentOverlapView | null }) {
  if (!view) return null;
  const notices = overlapNotices({
    targetUnknownReason: view.targetUnknownReason,
    driver: view.driver,
    vehicle: view.vehicle,
  });
  if (notices.length === 0) return null;
  const overlapTrips = [...(view.driver?.overlaps ?? []), ...(view.vehicle?.overlaps ?? [])].filter(
    (trip, index, all) => all.findIndex((t) => t.tripId === trip.tripId) === index,
  );
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="overlap-notes">
      {notices.map((notice) => (
        <p
          key={notice.text}
          data-overlap-kind={notice.kind}
          className={cn(typography.bodySmall, notice.kind === "overlap" ? "font-medium text-warning-text" : "text-text-secondary")}
        >
          {notice.text}
        </p>
      ))}
      {overlapTrips.length > 0 && (
        <ul className="flex flex-col gap-1">
          {overlapTrips.map((trip) => (
            <li key={trip.tripId} className={cn(typography.metadata, "min-w-0 break-words text-text-secondary")} data-testid="overlap-trip">
              {trip.extentLabel ?? "Time not set"} · {trip.route}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
