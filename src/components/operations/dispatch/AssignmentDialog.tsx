"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { assignmentAction, type AssignmentActionState } from "@/app/operations/dispatch/actions";
import { dispatchErrorMessage } from "@/lib/operations/dispatch-errors";
import type { DispatchDriverOption, DispatchVehicleOption, DispatchTrip } from "@/lib/operations/dispatch-board";
import { deriveAssignmentDefaults, type RecurringAssignmentHint } from "@/lib/operations/assignment-defaults-core";
import { AssignmentFields } from "./AssignmentFields";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

const INITIAL_STATE: AssignmentActionState = { status: "idle" };

/** The Trip fields the dialog needs -- satisfied by both the Dispatch board and Trip Detail. */
export type AssignmentDialogTrip = Pick<
  DispatchTrip,
  | "id"
  | "passengerName"
  | "pickupDescription"
  | "destinationDescription"
  | "activeAssignmentId"
  | "driverId"
  | "driverName"
  | "vehicleId"
  | "vehicleLabel"
>;

export interface AssignmentDialogProps {
  trip: AssignmentDialogTrip;
  mode: "assign" | "reassign";
  driverOptions: DispatchDriverOption[];
  vehicleOptions: DispatchVehicleOption[];
  /** The signed-in operator's own active linked Driver (owner-as-driver), or null. Ordering/label only. */
  operatorDriverId: string | null;
  /** Organization Admin -- may add drivers / link themselves. Affects which setup links are offered, never authorization. */
  canManageDriverSetup: boolean;
  /** P1-OPS-PROG2: recurring-history hint (assign mode only), resolved server-side. */
  recurringHint?: RecurringAssignmentHint | null;
  onClose: () => void;
}

/**
 * The one Assign/Reassign dialog (P1-E3-S5, work item §23) -- a real
 * `<form>` + Server Action, never a client-side Supabase call, never an
 * optimistic update before the server confirms. The caller mounts this
 * component only while a dialog should be open and unmounts it to close,
 * so `useActionState` is always fresh per trip/mode.
 *
 * P1-OPS-PROG1 Progressive Assignment: initial values come from
 * `deriveAssignmentDefaults` -- the existing assignment when reassigning,
 * otherwise a Driver/Vehicle only when it is the ONLY eligible option.
 * That is a PREFILL: nothing is written until the operator clicks
 * Assign Driver / Confirm Reassignment, both selects stay enabled and
 * changeable, and assign_trip / reassign_trip remain the sole validators.
 * Selecting a Driver loads that Driver's other trips on the target
 * Trip's organization-local day -- facts only, no overlap claims (trips
 * have no duration, drop-off, route or availability data). The controls
 * themselves live in `AssignmentFields`, shared with New Trip (PROG2).
 */
export function AssignmentDialog({
  trip,
  mode,
  driverOptions,
  vehicleOptions,
  operatorDriverId,
  canManageDriverSetup,
  recurringHint = null,
  onClose,
}: AssignmentDialogProps) {
  const [state, formAction, pending] = useActionState(assignmentAction, INITIAL_STATE);
  const router = useRouter();

  // Initial values only -- derived once per mounted dialog, never re-applied over the operator's own choice
  // (a board refresh that changes the option lists must not silently change what is selected).
  const [defaults] = useState(() =>
    deriveAssignmentDefaults({
      mode,
      currentDriverId: trip.driverId,
      currentVehicleId: trip.vehicleId,
      driverOptions,
      vehicleOptions,
      recurringHint,
    }),
  );
  // Callers pass an inline onClose; keep the latest in a ref so the effect
  // below runs once per action result, not on every re-render (a selected
  // Driver's day context re-renders the dialog after an error).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (state.status === "idle") return;
    // Refresh on BOTH success and error -- a ZW005 conflict needs the same
    // authoritative re-fetch a success does (work item §28/§29/§37).
    router.refresh();
    if (state.status === "success") {
      onCloseRef.current();
    }
  }, [state, router]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === "assign" ? "Assign Driver" : "Reassign Trip"}
      description={`${trip.passengerName} — ${trip.pickupDescription} → ${trip.destinationDescription}`}
    >
      {mode === "reassign" && (
        <div className="mb-zw-lg">
          <DefinitionList
            items={[
              { label: "Currently assigned to", value: trip.driverName ?? "—" },
              { label: "Vehicle", value: trip.vehicleLabel ?? "None" },
            ]}
          />
        </div>
      )}

      <form action={formAction} className="flex min-w-0 flex-col gap-zw-md" data-testid="assignment-form">
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="tripId" value={trip.id} />
        {/*
          P1-E3-S5A: the assignment the Dispatcher actually reviewed --
          the optimistic-concurrency precondition reassign_trip requires.
          Never shown; the backend is what verifies it still matches.
        */}
        {mode === "reassign" && (
          <input type="hidden" name="expectedAssignmentId" value={trip.activeAssignmentId ?? ""} />
        )}

        <AssignmentFields
          driverOptions={driverOptions}
          vehicleOptions={vehicleOptions}
          operatorDriverId={operatorDriverId}
          canManageDriverSetup={canManageDriverSetup}
          defaults={defaults}
          dayTarget={{ kind: "trip", tripId: trip.id }}
          disabled={pending}
        />

        {mode === "reassign" && (
          <Textarea
            label="Reason (optional)"
            name="reason"
            placeholder="e.g. Original driver called out"
            disabled={pending}
          />
        )}

        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {dispatchErrorMessage(state.errorCode ?? "UNKNOWN")}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-zw-sm">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending || driverOptions.length === 0}>
            {pending ? "Saving…" : mode === "assign" ? "Assign Driver" : "Confirm Reassignment"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
