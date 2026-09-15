import { Panel } from "@/components/ui/Panel";
import { formatOperationsTime } from "@/lib/operations/presentation";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface TripInfoStripProps {
  scheduledPickupAt: string | null;
  appointmentAt: string | null;
  driverName: string | null;
  vehicleLabel: string | null;
  statusLabel: string;
  timezone: string;
}

interface Cell {
  label: string;
  value: string;
  emphasize?: boolean;
}

/**
 * The 5-column at-a-glance strip under the Trip title
 * (docs/design/stitch/references/02-trip-detail.png: PICKUP / APPOINTMENT
 * / DRIVER / VEHICLE / TRIP STATUS). A one-off layout, not built on
 * `DefinitionList` (which only supports 1/2 columns) — a bespoke 5-column
 * grid for a single, specific use is more honest than stretching an
 * existing primitive's column count merely to reuse it here (interface-
 * principles.md's own "no generic abstraction merely for reuse" caution,
 * component-inventory.md).
 */
export function TripInfoStrip({
  scheduledPickupAt,
  appointmentAt,
  driverName,
  vehicleLabel,
  statusLabel,
  timezone,
}: TripInfoStripProps) {
  const cells: Cell[] = [
    { label: "Pickup", value: formatOperationsTime(scheduledPickupAt, timezone) },
    { label: "Appointment", value: appointmentAt ? formatOperationsTime(appointmentAt, timezone) : "—" },
    { label: "Driver", value: driverName ?? "Unassigned" },
    { label: "Vehicle", value: vehicleLabel ?? "—" },
    { label: "Trip Status", value: statusLabel, emphasize: true },
  ];

  return (
    <Panel className="grid grid-cols-2 gap-zw-md p-0 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-border-subtle">
      {cells.map((cell) => (
        <div key={cell.label} className="px-zw-lg py-zw-md">
          <p className={cn(typography.metadata, "font-medium uppercase tracking-wide text-text-muted")}>{cell.label}</p>
          <p className={cn(typography.subsectionHeading, "mt-0.5", cell.emphasize ? "text-info-text" : "text-text-primary")}>
            {cell.value}
          </p>
        </div>
      ))}
    </Panel>
  );
}
