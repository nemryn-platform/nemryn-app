import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { TripStatus } from "@/components/ui/TripStatus";
import { DriverRoute } from "@/components/driver/DriverRoute";
import { LinkButton } from "@/components/ui/LinkButton";

export interface DriverNextTripCardProps {
  time: string;
  passengerName: string;
  pickup: string;
  destination: string;
  status: string;
  appointmentLabel?: string;
  /** The existing canonical trip-detail route (application-route-map.md `/driver/trips/[tripId]`) — still a placeholder screen until a later phase, per work item §24. */
  tripHref: string;
  className?: string;
}

/**
 * The featured "Next Trip" card on Driver Today (P1-E3-S2) — larger and
 * richer than DriverTripCard, matching the Stitch reference's single
 * dominant card. Deliberately carries only one action (View Trip, routes to
 * the existing canonical trip-detail route) — Navigate/Call Passenger and
 * any passenger-notes/assistance content require fields
 * (`passenger_phone`, `driver_notes`, `assistance_notes`) that
 * `driver_list_active_trips` does not return; those actions belong to the
 * Active Trip screen (docs/product/driver-today-data-map.md), not
 * duplicated here (work item §24/§25 — "actions delegate to 04").
 */
export function DriverNextTripCard({
  time,
  passengerName,
  pickup,
  destination,
  status,
  appointmentLabel,
  tripHref,
  className,
}: DriverNextTripCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-elevated p-zw-lg",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={cn(typography.sectionHeading, "text-info-text")}>{time}</p>
        <TripStatus status={status} />
      </div>
      <p className={cn(typography.subsectionHeading, "text-text-primary")}>{passengerName}</p>
      <DriverRoute pickup={pickup} destination={destination} appointmentLabel={appointmentLabel} />
      <LinkButton href={tripHref} variant="primary" size="lg" className="w-full">
        View Trip
      </LinkButton>
    </div>
  );
}
