"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { setTripDurationAction, type TripDetailActionState } from "@/app/operations/trips/[tripId]/actions";
import { tripDetailErrorMessage } from "@/lib/operations/trip-detail-errors";
import { formatDurationMinutes } from "@/lib/operations/trip-overlap-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: TripDetailActionState = { status: "idle" };

export interface TripDurationPanelProps {
  tripId: string;
  expectedDurationMinutes: number | null;
  expectedDurationSource: "trip" | "organization_default" | null;
  /** The planned extent in the organization timezone ("9:30 AM – 10:15 AM"), or null when unknown. */
  plannedExtentLabel: string | null;
  /** Non-terminal trip (the RPC re-checks): only then can the plan be edited. */
  canEdit: boolean;
}

/**
 * P1-OPS-PROG4 -- the trip's expected duration: value, where it came from,
 * and the derived planned window. Editing touches ONLY the duration
 * (set_trip_expected_duration); general trip editing stays out of scope.
 * The planned window is a plan -- it never replaces lifecycle facts.
 */
export function TripDurationPanel({ tripId, expectedDurationMinutes, expectedDurationSource, plannedExtentLabel, canEdit }: TripDurationPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <Panel data-testid="trip-duration">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn(typography.metadata, "font-medium uppercase tracking-wide text-text-muted")}>Expected duration</p>
          <p className={cn(typography.subsectionHeading, "mt-1 text-text-primary")} data-testid="trip-duration-value">
            {expectedDurationMinutes === null ? "Not set" : formatDurationMinutes(expectedDurationMinutes)}
          </p>
          {expectedDurationSource === "organization_default" && (
            <p className={cn(typography.metadata, "text-text-muted")}>From the organization default</p>
          )}
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")} data-testid="trip-planned-window">
            {plannedExtentLabel ? `Planned ${plannedExtentLabel}` : "No planned end — other trips at the same time can't be checked."}
          </p>
        </div>
        {canEdit && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Edit duration
          </Button>
        )}
      </div>
      {open && <DurationDialog tripId={tripId} current={expectedDurationMinutes} onClose={() => setOpen(false)} />}
    </Panel>
  );
}

function DurationDialog({ tripId, current, onClose }: { tripId: string; current: number | null; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(setTripDurationAction, IDLE);
  const router = useRouter();
  const [value, setValue] = useState(current === null ? "" : String(current));
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onCloseRef.current();
    }
  }, [state, router]);

  return (
    <Dialog open onClose={onClose} title="Expected duration" description="Used to show when a driver or vehicle has another trip at the same time.">
      <form action={formAction} className="flex flex-col gap-zw-md" data-testid="trip-duration-form">
        <input type="hidden" name="tripId" value={tripId} />
        <Input
          label="Minutes"
          name="expectedDurationMinutes"
          type="number"
          min={1}
          max={2880}
          step={1}
          inputMode="numeric"
          placeholder="Not set"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          helpText="1 to 2880 (48 hours). Leave empty to mark it as not set."
          disabled={pending}
        />
        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {tripDetailErrorMessage(state.errorCode ?? "UNKNOWN")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
