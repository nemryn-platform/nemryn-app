"use client";

import { booleanToTriState, type TriState } from "@/lib/operations/capability-core";
import { WheelchairRequirementField } from "@/components/operations/wheelchair/WheelchairRequirementField";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { WeekdaySelector } from "./WeekdaySelector";
import { editRecurringArrangementAction, type RecurringArrangementActionState } from "@/app/operations/recurring-care/[arrangementId]/actions";
import { recurringArrangementErrorMessage } from "@/lib/operations/recurring-arrangement-errors";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: RecurringArrangementActionState = { status: "idle" };

export interface EditArrangementDialogProps {
  arrangementId: string;
  pickupDescription: string;
  destinationDescription: string;
  pickupTime: string;
  daysOfWeek: number[];
  startDate: string;
  endDate: string | null;
  requiresWheelchairAccess: boolean | null;
  onClose: () => void;
}

/**
 * Edit Arrangement (P1-E2-S1E §18) — editable: pickup/destination/pickup
 * time/weekdays/start date/end date. NOT editable: Passenger, timezone,
 * organization, status — no input exists for any of them, so there is no
 * code path through which a submitted value could ever reach the RPC.
 * `pickup_time` (an SQL `time`, e.g. "08:00:00") is truncated to "HH:mm"
 * for the native `<input type="time">`'s own required value format.
 */
export function EditArrangementDialog({
  arrangementId,
  pickupDescription,
  destinationDescription,
  pickupTime,
  daysOfWeek,
  startDate,
  endDate,
  requiresWheelchairAccess,
  onClose,
}: EditArrangementDialogProps) {
  const [wheelchair, setWheelchair] = useState<TriState>(booleanToTriState(requiresWheelchairAccess));
  const [state, formAction, pending] = useActionState(editRecurringArrangementAction, INITIAL_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "idle") return;
    router.refresh();
    if (state.status === "success") onClose();
  }, [state, router, onClose]);

  return (
    <Dialog open onClose={onClose} title="Edit recurring arrangement">
      <form action={formAction} className="flex flex-col gap-zw-md">
        <input type="hidden" name="arrangementId" value={arrangementId} />

        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Changes affect future recurring occurrences. Existing trips are not changed.
        </p>

        <Input label="Pickup" name="pickupDescription" required disabled={pending} defaultValue={pickupDescription} />
        <Input label="Destination" name="destinationDescription" required disabled={pending} defaultValue={destinationDescription} />
        <Input label="Pickup time" name="pickupTime" type="time" required disabled={pending} defaultValue={pickupTime.slice(0, 5)} />
        <WeekdaySelector name="daysOfWeek" defaultValue={daysOfWeek} disabled={pending} />
        <Input label="Start date" name="startDate" type="date" required disabled={pending} defaultValue={startDate} />
        <Input label="End date" name="endDate" type="date" disabled={pending} defaultValue={endDate ?? undefined} helpText="Optional — leave blank for an open-ended arrangement." />
        <input type="hidden" name="requiresWheelchairAccessOriginal" value={booleanToTriState(requiresWheelchairAccess)} />
        <WheelchairRequirementField
          value={wheelchair}
          onChange={setWheelchair}
          disabled={pending}
          helpText="Applied to trips created from this arrangement from now on; existing trips keep their own value."
        />

        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {recurringArrangementErrorMessage(state.errorCode ?? "UNKNOWN")}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-zw-sm">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
