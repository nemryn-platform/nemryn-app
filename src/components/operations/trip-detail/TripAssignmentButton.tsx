"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AssignmentDialog, type AssignmentDialogTrip } from "@/components/operations/dispatch/AssignmentDialog";
import type { DispatchDriverOption, DispatchVehicleOption } from "@/lib/operations/dispatch-board";

export interface TripAssignmentButtonProps {
  trip: AssignmentDialogTrip;
  driverOptions: DispatchDriverOption[];
  vehicleOptions: DispatchVehicleOption[];
  operatorDriverId: string | null;
  canManageDriverSetup: boolean;
}

/**
 * P1-OPS-PROG1: Trip Detail opens the SAME Assign/Reassign dialog and the
 * SAME Server Action as the Dispatch board (no second mutation path), so a
 * Trip scheduled for tomorrow or later -- which the today-only Dispatch
 * board never lists -- can be assigned with its own day's driver context.
 */
export function TripAssignmentButton({
  trip,
  driverOptions,
  vehicleOptions,
  operatorDriverId,
  canManageDriverSetup,
}: TripAssignmentButtonProps) {
  const [open, setOpen] = useState(false);
  const mode = trip.activeAssignmentId ? "reassign" : "assign";
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
        {mode === "reassign" ? "Manage Assignment" : "Assign Driver"}
      </Button>
      {open && (
        <AssignmentDialog
          trip={trip}
          mode={mode}
          driverOptions={driverOptions}
          vehicleOptions={vehicleOptions}
          operatorDriverId={operatorDriverId}
          canManageDriverSetup={canManageDriverSetup}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
