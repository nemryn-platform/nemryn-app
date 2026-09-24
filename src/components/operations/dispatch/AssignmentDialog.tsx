"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { assignmentAction, driverDayContextAction, type AssignmentActionState } from "@/app/operations/dispatch/actions";
import { dispatchErrorMessage } from "@/lib/operations/dispatch-errors";
import type { DispatchDriverOption, DispatchVehicleOption, DispatchTrip } from "@/lib/operations/dispatch-board";
import type { DriverDayContext } from "@/lib/operations/assignment-context";
import {
  deriveAssignmentDefaults,
  deriveVehicleGuidance,
  orderDriversForOperator,
} from "@/lib/operations/assignment-defaults-core";
import { NoActiveDriversActions } from "./NoActiveDriversActions";
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
  onClose: () => void;
}

type DayContextState = { driverId: string; context: DriverDayContext | null };

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
 * have no duration, drop-off, route or availability data).
 */
export function AssignmentDialog({
  trip,
  mode,
  driverOptions,
  vehicleOptions,
  operatorDriverId,
  canManageDriverSetup,
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
    }),
  );
  const [driverId, setDriverId] = useState<string>(defaults.driverId ?? "");
  const [vehicleId, setVehicleId] = useState<string>(defaults.vehicleId ?? "");
  const [dayContext, setDayContext] = useState<DayContextState | null>(null);
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

  useEffect(() => {
    if (!driverId) return;
    let ignore = false;
    driverDayContextAction(trip.id, driverId).then(
      (context) => {
        if (!ignore) setDayContext({ driverId, context });
      },
      () => {
        if (!ignore) setDayContext({ driverId, context: { status: "unavailable" } });
      },
    );
    return () => {
      ignore = true;
    };
  }, [trip.id, driverId]);

  const orderedDrivers = orderDriversForOperator(driverOptions, operatorDriverId);
  const driverSelectOptions = orderedDrivers.map((d) => ({ value: d.id, label: d.label }));
  const vehicleSelectOptions = vehicleOptions.map((v) => ({ value: v.id, label: v.label }));
  const selectedDriver = orderedDrivers.find((d) => d.id === driverId) ?? null;
  const vehicleGuidance = deriveVehicleGuidance(vehicleOptions.length, vehicleId || null);
  const currentContext = dayContext && dayContext.driverId === driverId ? dayContext.context : null;

  const driverHelp =
    driverId && driverId === defaults.driverId && defaults.driverSource === "only_option"
      ? "Prefilled: the only active driver. You can change it before assigning."
      : undefined;
  const vehicleHelp =
    vehicleId && vehicleId === defaults.vehicleId && defaults.vehicleSource === "only_option"
      ? "Prefilled: the only active vehicle. Optional; use Clear vehicle to leave it empty."
      : "Optional.";

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

        {driverOptions.length === 0 ? (
          <div className="flex flex-col gap-2 rounded-sm bg-surface-secondary px-3 py-2" data-testid="no-active-drivers-note">
            <p className={cn(typography.bodySmall, "text-text-primary")}>There are no active drivers yet.</p>
            <NoActiveDriversActions canManageDriverSetup={canManageDriverSetup} hasLinkedDriver={operatorDriverId !== null} />
          </div>
        ) : (
          <Select
            label="Driver"
            name="driverId"
            required
            placeholder="Choose a driver"
            options={driverSelectOptions}
            value={driverId}
            onChange={(event) => setDriverId(event.target.value)}
            helpText={driverHelp}
            disabled={pending}
          />
        )}

        {selectedDriver && (
          <DriverDayPanel driverName={selectedDriver.displayName} context={currentContext} />
        )}

        <Select
          label="Vehicle"
          name="vehicleId"
          placeholder="No vehicle"
          options={vehicleSelectOptions}
          value={vehicleId}
          onChange={(event) => setVehicleId(event.target.value)}
          helpText={vehicleHelp}
          disabled={pending}
        />
        {vehicleId && (
          <button
            type="button"
            className={cn(typography.metadata, "-mt-2 self-start text-text-link hover:underline")}
            onClick={() => setVehicleId("")}
            disabled={pending}
          >
            Clear vehicle
          </button>
        )}

        {vehicleGuidance === "no_vehicle_selected" && (
          <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="no-vehicle-note">
            No vehicle selected. Tomorrow readiness will show this trip as needing a vehicle.
          </p>
        )}
        {vehicleGuidance === "no_active_vehicles" && (
          <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="no-vehicle-note">
            No active vehicles yet.{" "}
            {canManageDriverSetup ? "Add one in Fleet so trips can be assigned a vehicle." : "An organization admin can add one in Fleet."}
          </p>
        )}

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

/**
 * "What else is this Driver already doing that day?" -- pickup times and
 * route only (no passenger names), no timeline, and never "conflict",
 * "overlap", "double-booked" or "available": Nemryn has no duration,
 * drop-off, travel-time or availability data to prove any of those.
 */
function DriverDayPanel({ driverName, context }: { driverName: string; context: DriverDayContext | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-sm border border-border-subtle px-3 py-2" data-testid="driver-day-context" aria-live="polite">
      {context === null ? (
        <p className={cn(typography.bodySmall, "text-text-muted")}>Loading {driverName}&apos;s day…</p>
      ) : context.status === "unavailable" ? (
        <p className={cn(typography.bodySmall, "text-text-muted")}>Couldn&apos;t load {driverName}&apos;s other trips. You can still assign.</p>
      ) : (
        <>
          {context.currentTripStatusLabel && (
            <p className={cn(typography.bodySmall, "font-medium text-text-primary")} data-testid="currently-on-trip">
              Currently on a trip · {context.currentTripStatusLabel}
            </p>
          )}
          {context.dayLabel === null ? (
            <p className={cn(typography.bodySmall, "text-text-muted")}>This trip has no scheduled pickup, so there is no day to show.</p>
          ) : context.otherTrips.length === 0 ? (
            <p className={cn(typography.bodySmall, "text-text-muted")} data-testid="driver-day-empty">
              No other trips for {driverName} on {context.dayLabel}.
            </p>
          ) : (
            <>
              <p className={cn(typography.metadata, "font-medium uppercase tracking-wide text-text-muted")}>
                Also scheduled {context.dayLabel} · {context.otherTrips.length} other {context.otherTrips.length === 1 ? "trip" : "trips"}
              </p>
              <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                {context.otherTrips.map((item) => (
                  <li key={item.tripId} className="flex min-w-0 gap-3" data-testid="driver-day-trip">
                    <span className={cn(typography.bodySmall, "w-20 shrink-0 font-medium text-text-primary tabular-nums")}>{item.timeLabel}</span>
                    <span className={cn(typography.bodySmall, "min-w-0 break-words text-text-secondary")}>
                      {item.pickupDescription} → {item.destinationDescription}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
