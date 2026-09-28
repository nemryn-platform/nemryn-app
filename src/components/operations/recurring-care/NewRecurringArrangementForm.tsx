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
import { AttentionState } from "@/components/ui/AttentionState";
import { LinkButton } from "@/components/ui/LinkButton";
import { formatWallClockTime } from "@/lib/operations/presentation";
import { RETURN_TRIP_HINT_TITLE, RETURN_TRIP_HINT_BODY, type RecurringPrefill } from "@/lib/operations/request-recurring-prefill-core";

const INITIAL_STATE: CreateRecurringArrangementActionState = { status: "idle" };

export interface NewRecurringArrangementFormProps {
  passengers: NewTripPassengerOption[];
  /**
   * P1-PILOT-R3 (PR-04): created from an accepted Request. Structured facts only (request-recurring-prefill-core);
   * the Passenger is the Request's linked Passenger (fixed); pickup time starts EMPTY.
   */
  fromRequest?: { prefill: RecurringPrefill; passengerName: string };
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
export function NewRecurringArrangementForm({ passengers, fromRequest }: NewRecurringArrangementFormProps) {
  const [state, formAction, pending] = useActionState(createRecurringArrangementAction, INITIAL_STATE);
  const prefill = fromRequest?.prefill ?? null;
  const [wheelchair, setWheelchair] = useState<TriState>(prefill?.wheelchair === "yes" ? "yes" : "unspecified");
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

      {prefill && (
        <p className={cn(typography.bodySmall, "max-w-2xl text-text-secondary")} data-testid="recurring-from-request">
          Prefilled from an accepted request. Check each detail and choose the pickup time.{" "}
          <LinkButton href={`/operations/requests/${prefill.requestId}`} variant="text" size="sm">
            View request
          </LinkButton>
        </p>
      )}
      {prefill?.returnTripExpected && (
        <div className="max-w-2xl" data-testid="recurring-return-hint">
          <AttentionState level="info" title={RETURN_TRIP_HINT_TITLE} description={RETURN_TRIP_HINT_BODY} />
        </div>
      )}

      <Panel className="max-w-2xl">
        <form action={formAction} className="flex flex-col gap-zw-md">
          {prefill ? (
            <div>
              <input type="hidden" name="requestId" value={prefill.requestId} />
              <input type="hidden" name="passengerId" value={prefill.passengerId} />
              <p className={cn(typography.label, "text-text-primary")}>Passenger</p>
              <p className={cn(typography.body, "mt-1 text-text-secondary")} data-testid="recurring-request-passenger">
                {fromRequest?.passengerName}
              </p>
              <p className={cn(typography.metadata, "mt-0.5 text-text-muted")}>The passenger linked to the request.</p>
            </div>
          ) : passengers.length === 0 ? (
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

          <Input label="Pickup" name="pickupDescription" required disabled={pending} placeholder="e.g. Home" defaultValue={prefill?.pickupDescription} />
          <Input
            label="Destination"
            name="destinationDescription"
            required
            disabled={pending}
            placeholder="e.g. Cascade Dialysis Center"
            defaultValue={prefill?.destinationDescription}
          />

          <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
            {/* P1-PILOT-R3 (D-R3-4): never prefilled -- the request's APPOINTMENT time is context only, not a pickup time. */}
            <Input
              label="Pickup time"
              name="pickupTime"
              type="time"
              required
              disabled={pending}
              helpText={prefill?.appointmentTime ? `Requested appointment time: ${formatWallClockTime(prefill.appointmentTime)}` : undefined}
            />
            <Input label="Start date" name="startDate" type="date" required disabled={pending} defaultValue={prefill?.startDate || undefined} />
          </div>

          <WeekdaySelector name="daysOfWeek" defaultValue={prefill?.daysOfWeek} />

          <Input
            label="End date"
            name="endDate"
            type="date"
            disabled={pending}
            defaultValue={prefill?.endDate || undefined}
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
            <Button type="submit" variant="primary" loading={pending} disabled={pending || (!prefill && passengers.length === 0)}>
              {pending ? "Creating…" : "Create arrangement"}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
