"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/Select";
import { assignmentOverlapAction, driverDayContextAction } from "@/app/operations/dispatch/actions";
import { OverlapNotes, overlapUnavailableView } from "@/components/operations/overlap/OverlapNotes";
import type { AssignmentOverlapView } from "@/lib/operations/trip-overlap";
import type { DispatchDriverOption, DispatchVehicleOption } from "@/lib/operations/dispatch-board";
import type { DriverDayContext, DriverDayTarget } from "@/lib/operations/assignment-context";
import {
  deriveVehicleGuidance,
  orderDriversForOperator,
  type AssignmentDefaults,
  type AssignmentDefaultSource,
} from "@/lib/operations/assignment-defaults-core";
import { NoActiveDriversActions } from "./NoActiveDriversActions";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface AssignmentFieldsProps {
  driverOptions: DispatchDriverOption[];
  vehicleOptions: DispatchVehicleOption[];
  /** The signed-in operator's own active linked Driver (owner-as-driver), or null. Ordering/label only. */
  operatorDriverId: string | null;
  /** Organization Admin -- may add drivers / vehicles. Affects which setup hints are offered, never authorization. */
  canManageDriverSetup: boolean;
  /** Initial values -- read once on mount, never re-applied over the operator's own choice. */
  defaults: AssignmentDefaults;
  /** Whose day the driver-day context describes; null when there is no day yet (New Trip without a pickup date). */
  dayTarget: DriverDayTarget | null;
  disabled?: boolean;
}

const DRIVER_HELP: Partial<Record<AssignmentDefaultSource, string>> = {
  only_option: "Prefilled: the only active driver. You can change it before assigning.",
  recurring_history: "Prefilled from the most recent completed occurrence. You can change it before assigning.",
};
const VEHICLE_HELP: Partial<Record<AssignmentDefaultSource, string>> = {
  only_option: "Prefilled: the only active vehicle. Optional; use Clear vehicle to leave it empty.",
  recurring_history: "Prefilled from the most recent completed occurrence. Optional; use Clear vehicle to leave it empty.",
};

type DayContextState = { key: string; context: DriverDayContext };

function targetKey(target: DriverDayTarget | null): string {
  if (!target) return "none";
  return target.kind === "trip" ? `trip:${target.tripId}` : `date:${target.dateKey}`;
}

/**
 * The Driver + Vehicle controls of Progressive Assignment (P1-OPS-PROG1),
 * shared by the Assign/Reassign dialog and New Trip's "Assign now"
 * (P1-OPS-PROG2) so both surfaces follow exactly the same rules: prefill
 * only from `deriveAssignmentDefaults`, "(you)" ordering, driver-day facts
 * (never "conflict"/"available"; P1-OPS-PROG4 adds factual overlap notes
 * only from two KNOWN planned intervals), the non-blocking vehicle note
 * and the zero-driver guidance. Submits as plain `driverId` / `vehicleId`
 * form fields of whichever form contains it; writes nothing itself.
 */
export function AssignmentFields({
  driverOptions,
  vehicleOptions,
  operatorDriverId,
  canManageDriverSetup,
  defaults,
  dayTarget,
  disabled = false,
}: AssignmentFieldsProps) {
  const [driverId, setDriverId] = useState<string>(defaults.driverId ?? "");
  const [vehicleId, setVehicleId] = useState<string>(defaults.vehicleId ?? "");
  const [dayContext, setDayContext] = useState<DayContextState | null>(null);
  const [overlap, setOverlap] = useState<{ key: string; view: AssignmentOverlapView | null } | null>(null);

  const dayKey = `${targetKey(dayTarget)}|${driverId}`;
  useEffect(() => {
    if (!driverId || !dayTarget) return;
    let ignore = false;
    const key = `${targetKey(dayTarget)}|${driverId}`;
    driverDayContextAction(dayTarget, driverId).then(
      (context) => {
        if (!ignore) setDayContext({ key, context });
      },
      () => {
        if (!ignore) setDayContext({ key, context: { status: "unavailable" } });
      },
    );
    return () => {
      ignore = true;
    };
    // dayTarget is compared by its key so a re-created object with the same meaning does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  // P1-OPS-PROG4: overlap facts for the selected driver / vehicle (warning only; never gates the submit button).
  const overlapKey = JSON.stringify([dayTarget, driverId, vehicleId]);
  useEffect(() => {
    if (!dayTarget || (!driverId && !vehicleId)) return;
    let ignore = false;
    const key = overlapKey;
    const timer = setTimeout(() => {
      assignmentOverlapAction(dayTarget, driverId || null, vehicleId || null).then(
        (view) => {
          if (!ignore) setOverlap({ key, view });
        },
        () => {
          // A failed read is uncertainty, not "nothing to report".
          if (!ignore) setOverlap({ key, view: overlapUnavailableView(Boolean(driverId), Boolean(vehicleId)) });
        },
      );
    }, 250);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
    // overlapKey captures dayTarget / driverId / vehicleId by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlapKey]);
  const currentOverlap = overlap && overlap.key === overlapKey ? overlap.view : null;

  const orderedDrivers = orderDriversForOperator(driverOptions, operatorDriverId);
  const selectedDriver = orderedDrivers.find((d) => d.id === driverId) ?? null;
  const vehicleGuidance = deriveVehicleGuidance(vehicleOptions.length, vehicleId || null);
  const currentContext = dayContext && dayContext.key === dayKey ? dayContext.context : null;

  const driverHelp = driverId && driverId === defaults.driverId ? DRIVER_HELP[defaults.driverSource] : undefined;
  const vehicleHelp = (vehicleId && vehicleId === defaults.vehicleId ? VEHICLE_HELP[defaults.vehicleSource] : undefined) ?? "Optional.";

  return (
    <>
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
          options={orderedDrivers.map((d) => ({ value: d.id, label: d.label }))}
          value={driverId}
          onChange={(event) => setDriverId(event.target.value)}
          helpText={driverHelp}
          disabled={disabled}
        />
      )}

      {selectedDriver &&
        (dayTarget ? (
          <DriverDayPanel driverName={selectedDriver.displayName} context={currentContext} />
        ) : (
          <p className={cn(typography.bodySmall, "text-text-muted")} data-testid="driver-day-context">
            Choose a pickup date to see {selectedDriver.displayName}&apos;s other trips that day.
          </p>
        ))}

      <Select
        label="Vehicle"
        name="vehicleId"
        placeholder="No vehicle"
        options={vehicleOptions.map((v) => ({ value: v.id, label: v.label }))}
        value={vehicleId}
        onChange={(event) => setVehicleId(event.target.value)}
        helpText={vehicleHelp}
        disabled={disabled}
      />
      {vehicleId && (
        <button
          type="button"
          className={cn(typography.metadata, "-mt-2 self-start text-text-link hover:underline")}
          onClick={() => setVehicleId("")}
          disabled={disabled}
        >
          Clear vehicle
        </button>
      )}

      <OverlapNotes view={driverId || vehicleId ? currentOverlap : null} />

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
    </>
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
                    <span className={cn(typography.bodySmall, "shrink-0 font-medium text-text-primary tabular-nums", item.extentLabel ? "w-40" : "w-20")}>
                      {item.extentLabel ?? item.timeLabel}
                    </span>
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
