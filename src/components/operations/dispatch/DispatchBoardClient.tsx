"use client";

import { useState } from "react";
import { NeedsAssignmentQueue } from "./NeedsAssignmentQueue";
import { AssignmentGrid } from "./AssignmentGrid";
import { DriverCapacityPanel } from "./DriverCapacityPanel";
import { AssignmentDialog } from "./AssignmentDialog";
import { NoActiveDriversActions } from "./NoActiveDriversActions";
import type { DispatchBoardData, DispatchTrip } from "@/lib/operations/dispatch-board";
import type { RecurringAssignmentHint } from "@/lib/operations/assignment-defaults-core";

export interface DispatchBoardClientProps {
  data: DispatchBoardData;
  timezone: string;
  /** P1-OPS-PROG1 presentation inputs (ordering, "(you)", empty-state links) -- never authorization. */
  operatorDriverId: string | null;
  canManageDriverSetup: boolean;
  /** P1-OPS-PROG2: recurring-history prefill hints keyed by trip id (assign mode only). */
  recurringHints?: Record<string, RecurringAssignmentHint>;
}

interface ActiveDialogState {
  trip: DispatchTrip;
  mode: "assign" | "reassign";
}

/**
 * Client orchestrator for the 3-column Dispatch Board — holds only which
 * dialog (if any) is open; every other value is server-fetched data
 * passed straight through as props (work item §40 — server-first reads,
 * no client `useEffect` fetch-after-mount). Mounting `AssignmentDialog`
 * only while a dialog is active (keyed by trip id + mode) guarantees a
 * fresh `useActionState` per dialog — no stale success/error state can
 * leak from a previous assignment into the next one.
 */
export function DispatchBoardClient({ data, timezone, operatorDriverId, canManageDriverSetup, recurringHints = {} }: DispatchBoardClientProps) {
  const [activeDialog, setActiveDialog] = useState<ActiveDialogState | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-zw-lg xl:grid-cols-[280px_minmax(0,1fr)_280px]">
        <NeedsAssignmentQueue
          trips={data.unassignedTrips}
          timezone={timezone}
          onAssign={(trip) => setActiveDialog({ trip, mode: "assign" })}
        />
        <AssignmentGrid
          driverRows={data.driverRows}
          timezone={timezone}
          onReassign={(trip) => setActiveDialog({ trip, mode: "reassign" })}
          emptyAction={
            <NoActiveDriversActions canManageDriverSetup={canManageDriverSetup} hasLinkedDriver={operatorDriverId !== null} />
          }
        />
        <DriverCapacityPanel driverRows={data.driverRows} />
      </div>

      {activeDialog && (
        <AssignmentDialog
          key={`${activeDialog.trip.id}-${activeDialog.mode}`}
          trip={activeDialog.trip}
          mode={activeDialog.mode}
          driverOptions={data.driverOptions}
          vehicleOptions={data.vehicleOptions}
          operatorDriverId={operatorDriverId}
          canManageDriverSetup={canManageDriverSetup}
          recurringHint={activeDialog.mode === "assign" ? (recurringHints[activeDialog.trip.id] ?? null) : null}
          onClose={() => setActiveDialog(null)}
        />
      )}
    </>
  );
}
