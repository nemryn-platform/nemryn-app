"use client";

import { useActionState, useEffect } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { addPassengerAction, type AddPassengerActionState } from "@/app/operations/trips/new/actions";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: AddPassengerActionState = { status: "idle" };

export interface AddPassengerDialogProps {
  /** Editable starting value for Full Name (P1-OPS-R1A: a Request's requested-passenger snapshot). Nothing is created until the operator submits. */
  initialDisplayName?: string;
  onClose: () => void;
  onCreated: (passenger: { id: string; displayName: string; phone: string | null }) => void;
}

/**
 * "Add New Passenger" (docs/design/stitch/references/05-internal-new-
 * trip.png) — a real, RLS-protected `passengers` INSERT (work item §11).
 * Deliberately does NOT trigger `router.refresh()`/a page reload: the
 * created Passenger is handed directly to the parent form via `onCreated`
 * and appended to its own in-memory options list, so the rest of an
 * already-in-progress New Trip form (pickup/destination/schedule already
 * typed) is never at risk of being cleared by an unrelated action (work
 * item §46).
 *
 * `initialDisplayName` only seeds the uncontrolled Full Name input. The dialog is mounted
 * only while open, so Cancel / close discards any edit and a reopen starts from the seed again.
 */
export function AddPassengerDialog({ initialDisplayName, onClose, onCreated }: AddPassengerDialogProps) {
  const [state, formAction, pending] = useActionState(addPassengerAction, INITIAL_STATE);

  useEffect(() => {
    if (state.status === "success" && state.passenger) {
      onCreated(state.passenger);
      onClose();
    }
  }, [state, onCreated, onClose]);

  return (
    <Dialog open onClose={onClose} title="Add New Passenger" description="This adds a new passenger record for this organization.">
      <form action={formAction} className="flex flex-col gap-zw-md">
        <Input
          label="Full Name"
          name="displayName"
          required
          placeholder="e.g. James Carter"
          defaultValue={initialDisplayName || undefined}
          disabled={pending}
        />
        <Input label="Phone" name="phone" type="tel" placeholder="e.g. (404) 555-0184" disabled={pending} />

        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            Couldn&apos;t add this passenger. Check the name and try again.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-zw-sm">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending}>
            {pending ? "Adding…" : "Add Passenger"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
