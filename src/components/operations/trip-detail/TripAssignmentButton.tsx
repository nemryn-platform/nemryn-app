"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AssignmentDialog, type AssignmentDialogTrip } from "@/components/operations/dispatch/AssignmentDialog";
import type { DispatchDriverOption, DispatchVehicleOption } from "@/lib/operations/dispatch-board";
import type { RecurringAssignmentHint } from "@/lib/operations/assignment-defaults-core";

export interface TripAssignmentButtonProps {
  trip: AssignmentDialogTrip;
  driverOptions: DispatchDriverOption[];
  vehicleOptions: DispatchVehicleOption[];
  operatorDriverId: string | null;
  canManageDriverSetup: boolean;
  /** P1-OPS-PROG2: recurring-history prefill hint, used only when assigning. */
  recurringHint?: RecurringAssignmentHint | null;
  /** Button label override (Tomorrow's compact "Assign" / "Add vehicle"). */
  label?: string;
  fullWidth?: boolean;
}

/**
 * Opens the SAME Assign/Reassign dialog and Server Action as the Dispatch
 * board (no second mutation path). P1-OPS-PROG1: Trip Detail, so a Trip
 * scheduled tomorrow or later can be assigned. P1-OPS-PROG2: Tomorrow's
 * inline readiness fix. Mode follows the Trip's own facts: no active
 * assignment -> assign, otherwise reassign (current values preserved).
 */
export function TripAssignmentButton({
  trip,
  driverOptions,
  vehicleOptions,
  operatorDriverId,
  canManageDriverSetup,
  recurringHint = null,
  label,
  fullWidth = true,
}: TripAssignmentButtonProps) {
  const [open, setOpen] = useState(false);
  const mode = trip.activeAssignmentId ? "reassign" : "assign";
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={fullWidth ? "w-full" : "shrink-0"}
        onClick={() => setOpen(true)}
        data-assign-trip-id={trip.id}
      >
        {label ?? (mode === "reassign" ? "Manage Assignment" : "Assign Driver")}
      </Button>
      {open && (
        <AssignmentDialog
          trip={trip}
          mode={mode}
          driverOptions={driverOptions}
          vehicleOptions={vehicleOptions}
          operatorDriverId={operatorDriverId}
          canManageDriverSetup={canManageDriverSetup}
          recurringHint={mode === "assign" ? recurringHint : null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
