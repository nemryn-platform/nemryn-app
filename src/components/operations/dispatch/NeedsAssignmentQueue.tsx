import { WarningCircle, MapPin } from "@phosphor-icons/react/dist/ssr";
import { Panel, PanelHeader } from "@/components/ui/Panel";
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
      {/* NP-UI-P2: the shared column-header anatomy (icon tile, title, real count); the attention tone only when
          something is actually unassigned. Cards: denser, pickup time first. Same data, same Assign handler + hook. */}
      <PanelHeader
        as="h2"
        icon={<WarningCircle className="size-5" weight="fill" />}
        tone={trips.length > 0 ? "attention" : "neutral"}
        title={`Needs Assignment (${trips.length})`}
      />

      {trips.length === 0 ? (
        <EmptyState
          size="compact"
          title="Nothing needs assignment"
          description={`Every trip scheduled ${day === "tomorrow" ? "tomorrow" : "today"} already has a driver.`}
        />
      ) : (
        <div className="flex flex-col gap-zw-sm">
          {trips.map((trip) => (
            <Panel key={trip.id} padding="dense" elevated className="flex flex-col gap-zw-xs">
              <div className="flex items-start justify-between gap-2">
                <p className={cn(typography.label, "tabular-nums text-text-primary")}>
                  {formatOperationsTime(trip.scheduledPickupAt, timezone)}
                  {trip.appointmentAt && <span className="font-normal text-text-secondary">{` · Appt ${formatOperationsTime(trip.appointmentAt, timezone)}`}</span>}
                </p>
                <TripStatus status="Needs Assignment" />
              </div>
              <p className={cn(typography.subsectionHeading, "text-text-primary")}>{trip.passengerName}</p>
              <p className={cn(typography.bodySmall, "flex items-start gap-1.5 text-text-secondary")}>
                <MapPin className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
                <span>
                  {trip.pickupDescription} → {trip.destinationDescription}
                </span>
              </p>
              <Button onClick={() => onAssign(trip)} data-trip-id={trip.id} size="sm" className="mt-zw-xs w-full">
                Assign
              </Button>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
