"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { AttentionState } from "@/components/ui/AttentionState";
import { recordTripCompletionAction } from "@/app/operations/trips/[tripId]/actions";
import {
  NOTE_ERROR_CODES,
  TIME_ERROR_CODES,
  tripCompletionErrorMessage,
  type TripCompletionErrorCode,
} from "@/lib/operations/trip-completion-errors";
import { RECOVERY_NOTE_MAX } from "@/lib/operations/trip-completion-core";
import { wallClockFields } from "@/lib/operations/local-time-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const pad = (n: number) => String(n).padStart(2, "0");

/** "Now" as organization-local { date, time } -- the default completion time the operator can change. */
function nowLocalParts(timezone: string): { date: string; time: string } {
  const f = wallClockFields(new Date(), timezone);
  return { date: `${f.year}-${pad(f.month)}-${pad(f.day)}`, time: `${pad(f.hour)}:${pad(f.minute)}` };
}

/**
 * P1-PILOT-R2C (PR-02) Record completion -- the exceptional path for a Trip the Driver can't complete in Nemryn after
 * pickup. The Trip's current state is the concurrency token. Nothing about the Driver's own record is changed: the
 * Trip timeline gains one "Completion recorded by operations" entry, and the note is kept in the admin audit record.
 */
export function RecordCompletionDialog({
  tripId,
  tripState,
  organizationTimezone,
  onClose,
}: {
  tripId: string;
  tripState: string;
  organizationTimezone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [initial] = useState(() => nowLocalParts(organizationTimezone));
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [note, setNote] = useState("");
  const [error, setError] = useState<TripCompletionErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await recordTripCompletionAction({ tripId, expectedState: tripState, completedDate: date, completedTime: time, note });
      if (!result.ok) {
        setError(result.code);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const noteError = error && NOTE_ERROR_CODES.has(error) ? tripCompletionErrorMessage(error) : undefined;
  const timeError = error && TIME_ERROR_CODES.has(error) ? tripCompletionErrorMessage(error) : undefined;
  const pageError = error && !noteError && !timeError ? error : null;

  return (
    <Dialog open onClose={onClose} title="Record completion" description="Use this when the driver can't complete the trip in Nemryn.">
      <div className="flex flex-col gap-zw-md" data-testid="record-completion-form">
        <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
          <Input label="Completion date" name="completedDate" type="date" required value={date} onChange={(e) => setDate(e.target.value)} disabled={pending} error={timeError} />
          <Input label="Completion time" name="completedTime" type="time" required value={time} onChange={(e) => setTime(e.target.value)} disabled={pending} />
        </div>
        <Textarea
          label="Recovery note"
          name="recoveryNote"
          required
          rows={3}
          maxLength={RECOVERY_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={pending}
          helpText="Say how completion was confirmed. Don't include health information."
          error={noteError}
        />
        <p className={cn(typography.metadata, "text-text-muted")}>
          The driver&apos;s own recorded steps stay as they are. This adds &ldquo;Completion recorded by operations&rdquo; to the trip.
        </p>
        {pageError && (
          <AttentionState
            level={pageError === "STALE" ? "warning" : "critical"}
            title={pageError === "STALE" ? "This trip changed" : "Couldn't record the completion"}
            description={tripCompletionErrorMessage(pageError)}
            action={
              pageError === "STALE" || pageError === "NOT_ELIGIBLE" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    router.refresh();
                    onClose();
                  }}
                >
                  Refresh
                </Button>
              ) : undefined
            }
          />
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} loading={pending} disabled={pending}>
            Record completion
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
