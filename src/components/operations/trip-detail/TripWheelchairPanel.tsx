"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { setTripWheelchairRequirementAction, type TripDetailActionState } from "@/app/operations/trips/[tripId]/actions";
import { tripDetailErrorMessage } from "@/lib/operations/trip-detail-errors";
import { booleanToTriState, type TriState } from "@/lib/operations/capability-core";
import { WheelchairRequirementField } from "@/components/operations/wheelchair/WheelchairRequirementField";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: TripDetailActionState = { status: "idle" };
const LABEL: Record<TriState, string> = { yes: "Needed", no: "Not needed", unspecified: "Not specified" };

/**
 * P1-OPS-PROG5B -- the trip's wheelchair transport equipment requirement (a stated fact, never inferred). Editing
 * uses set_trip_wheelchair_requirement (Admin / Dispatcher, non-terminal trips only; the RPC re-checks).
 */
export function TripWheelchairPanel({ tripId, requiresWheelchairAccess, canEdit }: { tripId: string; requiresWheelchairAccess: boolean | null; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const current = booleanToTriState(requiresWheelchairAccess);
  return (
    <Panel data-testid="trip-wheelchair">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn(typography.metadata, "font-medium uppercase tracking-wide text-text-muted")}>Wheelchair transport equipment</p>
          <p className={cn(typography.subsectionHeading, "mt-1 text-text-primary")} data-testid="trip-wheelchair-value">
            {LABEL[current]}
          </p>
        </div>
        {canEdit && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Edit
          </Button>
        )}
      </div>
      {open && <WheelchairDialog tripId={tripId} current={current} onClose={() => setOpen(false)} />}
    </Panel>
  );
}

function WheelchairDialog({ tripId, current, onClose }: { tripId: string; current: TriState; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(setTripWheelchairRequirementAction, IDLE);
  const router = useRouter();
  const [value, setValue] = useState<TriState>(current);
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
    <Dialog open onClose={onClose} title="Wheelchair transport equipment" description="Compared with the assigned vehicle's recorded equipment.">
      <form action={formAction} className="flex flex-col gap-zw-md" data-testid="trip-wheelchair-form">
        <input type="hidden" name="tripId" value={tripId} />
        <WheelchairRequirementField value={value} onChange={setValue} disabled={pending} />
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
