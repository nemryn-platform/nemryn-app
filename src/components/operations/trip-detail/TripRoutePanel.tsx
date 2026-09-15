import { Info } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { formatOperationsTime } from "@/lib/operations/presentation";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface TripRoutePanelProps {
  scheduledPickupAt: string | null;
  appointmentAt: string | null;
  pickupDescription: string;
  destinationDescription: string;
  pickupFacilityName: string | null;
  destinationFacilityName: string | null;
  instructions: string | null;
  timezone: string;
}

/**
 * "Trip Route" (docs/design/stitch/references/02-trip-detail.png) — the
 * same dot-line-dot metaphor `DriverRoute` established, richer per the
 * Operations variant component-inventory.md already anticipated
 * (`TripRouteTimeline`): a time badge per stop, the trip's own address
 * snapshot (never a mutable Facility record — work item §15; an optional
 * Facility name, when linked, is shown as a small annotation only) and
 * `trip.instructions` surfaced as an inline callout under Pickup,
 * matching the reference's own "Call passenger on arrival" treatment
 * exactly. No embedded map, no directions link inline here — see
 * TripDetailActionBar/data-map for the directions decision.
 */
export function TripRoutePanel({
  scheduledPickupAt,
  appointmentAt,
  pickupDescription,
  destinationDescription,
  pickupFacilityName,
  destinationFacilityName,
  instructions,
  timezone,
}: TripRoutePanelProps) {
  return (
    <Panel>
      <h3 className={cn(typography.subsectionHeading, "border-b border-border-subtle pb-zw-md text-text-primary")}>
        Trip Route
      </h3>
      <div className="flex gap-3 pt-zw-lg">
        <div className="flex flex-col items-center pt-1">
          <span className="size-3 shrink-0 rounded-full bg-text-primary" aria-hidden />
          <span className="w-px flex-1 bg-border-strong" aria-hidden />
          <span className="size-3 shrink-0 rounded-full bg-info-strong" aria-hidden />
        </div>
        <div className="flex flex-1 flex-col gap-zw-lg">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn(typography.bodySmall, "font-semibold text-text-primary")}>Pickup</p>
              <span className={cn(typography.metadata, "rounded-full bg-surface-secondary px-2 py-0.5 text-text-secondary")}>
                {formatOperationsTime(scheduledPickupAt, timezone)}
              </span>
            </div>
            <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{pickupDescription}</p>
            {pickupFacilityName && (
              <p className={cn(typography.metadata, "mt-0.5 text-text-muted")}>{pickupFacilityName}</p>
            )}
            {instructions && (
              <div className="mt-zw-sm flex items-start gap-2 rounded-sm border border-warning-border bg-warning-bg px-zw-md py-zw-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-warning-strong" weight="fill" aria-hidden />
                <p className={cn(typography.bodySmall, "text-text-primary")}>{instructions}</p>
              </div>
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn(typography.bodySmall, "font-semibold text-text-primary")}>Destination</p>
              {appointmentAt && (
                <span className={cn(typography.metadata, "rounded-full bg-info-bg px-2 py-0.5 text-info-text")}>
                  Appointment {formatOperationsTime(appointmentAt, timezone)}
                </span>
              )}
            </div>
            <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{destinationDescription}</p>
            {destinationFacilityName && (
              <p className={cn(typography.metadata, "mt-0.5 text-text-muted")}>{destinationFacilityName}</p>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
