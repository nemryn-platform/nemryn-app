"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { WeekdaySelector } from "./WeekdaySelector";
import { createRecurringArrangementAction, type CreateRecurringArrangementActionState } from "@/app/operations/recurring-care/new/actions";
import { recurringArrangementErrorMessage } from "@/lib/operations/recurring-arrangement-errors";
import type { NewTripPassengerOption } from "@/lib/operations/new-trip-options";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import type { TriState } from "@/lib/operations/capability-core";
import { WheelchairRequirementField } from "@/components/operations/wheelchair/WheelchairRequirementField";

const INITIAL_STATE: CreateRecurringArrangementActionState = { status: "idle" };

export interface NewRecurringArrangementFormProps {
  passengers: NewTripPassengerOption[];
}

/**
 * New Recurring Arrangement form (P1-E2-S1E §8). Fields are exactly
 * Passenger/Pickup/Destination/Pickup time/Days of week/Start date/End
 * date — organization_id, timezone, created_by, status, paused_at,
 * ended_at are never asked for or submitted (no input exists for any of
 * them). Timezone is never asked of the operator (§11) — the RPC derives
 * it authoritatively from the Organization's own current timezone at
 * creation time. On success, navigates to the new arrangement's own
 * detail page (mirrors NewTripForm's identical success-navigation
 * pattern — the action itself never calls `redirect()`).
 */
export function NewRecurringArrangementForm({ passengers }: NewRecurringArrangementFormProps) {
  const [state, formAction, pending] = useActionState(createRecurringArrangementAction, INITIAL_STATE);
  const [wheelchair, setWheelchair] = useState<TriState>("unspecified");
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success" && state.arrangementId) {
      router.push(`/operations/recurring-care/${state.arrangementId}`);
    }
  }, [state, router]);

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="New recurring arrangement"
        description="Set up a standing transportation commitment — Nemryn will track upcoming rides against this pattern."
        breadcrumb={[
          { label: "Recurring Care", href: "/operations/recurring-care" },
          { label: "New arrangement" },
        ]}
      />

      <Panel className="max-w-2xl">
        <form action={formAction} className="flex flex-col gap-zw-md">
          {passengers.length === 0 ? (
            <p className={cn(typography.bodySmall, "text-text-secondary")}>
              No active passengers are available yet. Add a passenger before creating a recurring arrangement.
            </p>
          ) : (
            <Select
              label="Passenger"
              name="passengerId"
              required
              disabled={pending}
              placeholder="Select a passenger"
              options={passengers.map((p) => ({ value: p.id, label: p.displayName }))}
            />
          )}

          <Input label="Pickup" name="pickupDescription" required disabled={pending} placeholder="e.g. Home" />
          <Input label="Destination" name="destinationDescription" required disabled={pending} placeholder="e.g. Cascade Dialysis Center" />

          <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
            <Input label="Pickup time" name="pickupTime" type="time" required disabled={pending} />
            <Input label="Start date" name="startDate" type="date" required disabled={pending} />
          </div>

          <WeekdaySelector name="daysOfWeek" />

          <Input
            label="End date"
            name="endDate"
            type="date"
            disabled={pending}
            helpText="Optional — leave blank for an open-ended standing commitment."
          />

          <WheelchairRequirementField
            value={wheelchair}
            onChange={setWheelchair}
            disabled={pending}
            helpText="Applied to each trip created from this arrangement. Used to check the assigned vehicle's recorded equipment."
          />

          {state.status === "error" && (
            <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
              {recurringArrangementErrorMessage(state.errorCode ?? "UNKNOWN")}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-zw-sm">
            <Button type="submit" variant="primary" loading={pending} disabled={pending || passengers.length === 0}>
              {pending ? "Creating…" : "Create arrangement"}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
