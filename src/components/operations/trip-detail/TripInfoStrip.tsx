import { CalendarCheck, Clock, SteeringWheel, Van } from "@phosphor-icons/react/dist/ssr";
import type { RecordFact } from "@/components/ui/RecordSummary";
import { formatOperationsTime } from "@/lib/operations/presentation";

export interface TripSummaryFactsInput {
  scheduledPickupAt: string | null;
  appointmentAt: string | null;
  driverName: string | null;
  vehicleLabel: string | null;
  timezone: string;
}

/**
 * The at-a-glance trip facts (Pickup / Appointment / Driver / Vehicle) shown in Trip Detail's RecordSummary.
 * NP-UI-V2-2: formerly the 5-column uppercase strip; its fifth cell ("Trip Status") repeated the status badge beside
 * the passenger name and is not duplicated. Real fields only -- an unset value reads "—" / "Unassigned", as before.
 */
export function tripSummaryFacts({ scheduledPickupAt, appointmentAt, driverName, vehicleLabel, timezone }: TripSummaryFactsInput): RecordFact[] {
  return [
    { label: "Pickup", value: formatOperationsTime(scheduledPickupAt, timezone), icon: <Clock /> },
    { label: "Appointment", value: appointmentAt ? formatOperationsTime(appointmentAt, timezone) : "—", icon: <CalendarCheck /> },
    { label: "Driver", value: driverName ?? "Unassigned", icon: <SteeringWheel /> },
    { label: "Vehicle", value: vehicleLabel ?? "—", icon: <Van /> },
  ];
}
