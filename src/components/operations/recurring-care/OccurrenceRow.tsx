"use client";

import { useState } from "react";
import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { SkipOccurrenceDialog } from "./SkipOccurrenceDialog";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import {
  createTripForRecurringOccurrenceAction,
  unskipRecurringOccurrenceAction,
  type CreateOccurrenceTripActionState,
} from "@/app/operations/recurring-care/[arrangementId]/actions";
import {
  formatServiceDateLabel,
  recurringOccurrenceStateLabel,
  recurringOccurrenceStateCategory,
  operationsTripStatusLabel,
  tripReadinessReasonLabel,
} from "@/lib/operations/presentation";
import { recurringArrangementErrorMessage } from "@/lib/operations/recurring-arrangement-errors";
import type { RecurringOccurrence } from "@/lib/operations/recurring-care";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const CREATE_TRIP_INITIAL_STATE: CreateOccurrenceTripActionState = { status: "idle" };

export interface OccurrenceRowProps {
  arrangementId: string;
  occurrence: RecurringOccurrence;
}

/**
 * One occurrence row (P1-E2-S1E §12-§14) — human language, never raw
 * enum strings. Actions are scoped exactly to the occurrence's own
 * state: Create trip / Skip date for MISSING only; Restore for SKIPPED
 * only; neither for SCHEDULED (§14 — "Do not display Create Trip for
 * SKIPPED. Do not display Skip for SCHEDULED"). For SCHEDULED, every
 * qualifying linked Trip is listed (never collapsed, matching the
 * evaluator's own "no invented aggregate" contract) with a link to its
 * own Trip Detail page and — only while it remains state='scheduled' —
 * its own Trip Readiness treatment, reusing TripReadinessPanel's exact
 * category/label conventions rather than inventing a second readiness
 * vocabulary (§13).
 */
export function OccurrenceRow({ arrangementId, occurrence }: OccurrenceRowProps) {
  const [activeDialog, setActiveDialog] = useState<"skip" | "unskip" | null>(null);
  const [createTripState, createTripFormAction, createTripPending] = useActionState(
    createTripForRecurringOccurrenceAction,
    CREATE_TRIP_INITIAL_STATE,
  );
  const router = useRouter();

  useEffect(() => {
    if (createTripState.status === "success") {
      router.refresh();
    }
  }, [createTripState, router]);

  return (
    <li className="flex flex-col gap-2 border-b border-border-subtle px-zw-md py-zw-md last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(typography.body, "font-medium text-text-primary")}>{formatServiceDateLabel(occurrence.serviceDate)}</span>
          <StatusBadge label={recurringOccurrenceStateLabel(occurrence.state)} category={recurringOccurrenceStateCategory(occurrence.state)} />
        </div>

        {occurrence.state === "SKIPPED" && occurrence.skipReason && (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>Reason: {occurrence.skipReason}</p>
        )}

        {occurrence.state === "SCHEDULED" && (
          <ul className="flex flex-col gap-1.5">
            {occurrence.trips.map((trip) => (
              <li key={trip.tripId} className="flex flex-col gap-0.5">
                <Link href={`/operations/trips/${trip.tripId}`} className={cn(typography.bodySmall, "text-text-link hover:underline")}>
                  {operationsTripStatusLabel(trip.state, false)} trip →
                </Link>
                {trip.readiness && trip.readiness.state !== "NOT_APPLICABLE" && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      label={trip.readiness.state === "READY" ? "Prepared" : "Needs preparation"}
                      category={trip.readiness.state === "READY" ? "positive" : "warning"}
                    />
                    {trip.readiness.state !== "READY" &&
                      trip.readiness.reasons.map((reason) => (
                        <span key={reason} className={cn(typography.metadata, "text-text-muted")}>
                          {tripReadinessReasonLabel(reason as Parameters<typeof tripReadinessReasonLabel>[0])}
                        </span>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {createTripState.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {recurringArrangementErrorMessage(createTripState.errorCode ?? "UNKNOWN")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {occurrence.state === "MISSING" && (
          <>
            <form action={createTripFormAction}>
              <input type="hidden" name="arrangementId" value={arrangementId} />
              <input type="hidden" name="serviceDate" value={occurrence.serviceDate} />
              <Button type="submit" variant="primary" size="sm" loading={createTripPending} disabled={createTripPending}>
                {createTripPending ? "Creating…" : "Create trip"}
              </Button>
            </form>
            <Button variant="outline" size="sm" onClick={() => setActiveDialog("skip")} disabled={createTripPending}>
              Skip date
            </Button>
          </>
        )}
        {occurrence.state === "SKIPPED" && (
          <Button variant="outline" size="sm" onClick={() => setActiveDialog("unskip")}>
            Restore occurrence
          </Button>
        )}
      </div>

      {activeDialog === "skip" && (
        <SkipOccurrenceDialog arrangementId={arrangementId} serviceDate={occurrence.serviceDate} onClose={() => setActiveDialog(null)} />
      )}
      {activeDialog === "unskip" && (
        <ConfirmActionDialog
          title={`Restore ${formatServiceDateLabel(occurrence.serviceDate)}`}
          description="This occurrence will be expected again."
          confirmLabel="Restore"
          confirmingLabel="Restoring…"
          hiddenFields={{ arrangementId, serviceDate: occurrence.serviceDate }}
          action={unskipRecurringOccurrenceAction}
          onClose={() => setActiveDialog(null)}
        />
      )}
    </li>
  );
}
