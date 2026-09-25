import { WarningCircle, MapPin } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { TripStatus } from "@/components/ui/TripStatus";
import { Button } from "@/components/ui/Button";
import { formatOperationsTime } from "@/lib/operations/presentation";
import type { DispatchTrip } from "@/lib/operations/dispatch-board";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface NeedsAssignmentQueueProps {
  trips: DispatchTrip[];
  timezone: string;
  /** P1-OPS-PROG4: which org-local day the board shows (copy only). */
  day?: "today" | "tomorrow";
  onAssign: (trip: DispatchTrip) => void;
}

/**
 * The left-column card queue (docs/design/stitch/references/
 * 03-dispatch-board.png) — real Needs-Assignment Trips only. The
 * reference's own second/third queue cards ("UNASSIGNED"/"REVIEW",
 * "Potential timing conflict", "Return trip confirmation pending") map to
 * undefined product concepts (no Running Late threshold, no domain model
 * for "Pending Confirmation" — ui-backend-gap-register.md) and are not
 * built here, matching Today's Operations' own established Needs
 * Attention precedent (ZD-130). Every card here reads exactly one real
 * condition: `state='scheduled'` with no active `trip_assignments` row.
 */
export function NeedsAssignmentQueue({ trips, timezone, day = "today", onAssign }: NeedsAssignmentQueueProps) {
  return (
    <div className="flex flex-col gap-zw-md">
      <div className="flex items-center gap-2">
        <WarningCircle className="size-5 text-warning-strong" weight="fill" aria-hidden />
        <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>
          Needs Assignment ({trips.length})
        </h2>
      </div>

      {trips.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing needs assignment"
            description={`Every trip scheduled ${day === "tomorrow" ? "tomorrow" : "today"} already has a driver.`}
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-zw-md">
          {trips.map((trip) => (
            <Panel key={trip.id} className="flex flex-col gap-zw-sm">
              <div className="flex items-start justify-between gap-2">
                <p className={cn(typography.subsectionHeading, "text-text-primary")}>{trip.passengerName}</p>
                <TripStatus status="Needs Assignment" />
              </div>
              <p className={cn(typography.bodySmall, "text-text-secondary")}>
                {formatOperationsTime(trip.scheduledPickupAt, timezone)}
                {trip.appointmentAt && ` (Appt: ${formatOperationsTime(trip.appointmentAt, timezone)})`}
              </p>
              <p className={cn(typography.bodySmall, "flex items-start gap-1.5 text-text-secondary")}>
                <MapPin className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
                <span>
                  {trip.pickupDescription} → {trip.destinationDescription}
                </span>
              </p>
              <Button onClick={() => onAssign(trip)} data-trip-id={trip.id} className="mt-1 w-full">
                Assign
              </Button>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
