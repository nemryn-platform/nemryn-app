"use client";

import { useActionState } from "react";
import { saveTripDefaultsAction, type TripDefaultsActionState } from "@/app/operations/settings/operations/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { formatDurationMinutes } from "@/lib/operations/trip-overlap-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: TripDefaultsActionState = { status: "idle" };

/**
 * P1-OPS-PROG4 -- the optional organization default trip duration. Only used
 * for trips created afterwards when no duration is entered; existing trips
 * keep their own. There is no Nemryn default and no "apply to existing
 * trips" action.
 */
export function TripDefaultsForm({ defaultTripDurationMinutes }: { defaultTripDurationMinutes: number | null }) {
  const [state, action, pending] = useActionState(saveTripDefaultsAction, IDLE);
  const current = defaultTripDurationMinutes;
  return (
    <Panel className="flex flex-col gap-zw-md" data-testid="trip-defaults">
      <div>
        <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Default trip duration</h2>
        <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>
          Applied to new trips when no duration is entered. Existing trips keep their own duration.
        </p>
        <p className={cn(typography.metadata, "mt-1 text-text-muted")} data-testid="trip-default-current">
          {current === null ? "Not set" : `Currently ${formatDurationMinutes(current)}`}
        </p>
      </div>
      <form action={action} className="flex flex-col gap-zw-sm sm:flex-row sm:items-end">
        <div className="sm:w-64">
          <Input
            label="Minutes (optional)"
            name="defaultTripDurationMinutes"
            type="number"
            min={1}
            max={2880}
            step={1}
            inputMode="numeric"
            placeholder="e.g. 45"
            defaultValue={state.value ?? (current === null ? "" : String(current))}
            helpText="1 to 2880 (48 hours). Leave empty for no default."
            disabled={pending}
          />
        </div>
        <Button type="submit" loading={pending} disabled={pending}>
          Save
        </Button>
      </form>
      {state.status !== "idle" && state.message && (
        <p role="status" className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-primary")}>
          {state.message}
        </p>
      )}
    </Panel>
  );
}
