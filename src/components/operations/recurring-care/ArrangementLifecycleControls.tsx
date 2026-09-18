"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EditArrangementDialog } from "./EditArrangementDialog";
import { EndArrangementDialog } from "./EndArrangementDialog";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { pauseRecurringArrangementAction, resumeRecurringArrangementAction } from "@/app/operations/recurring-care/[arrangementId]/actions";

export interface ArrangementLifecycleControlsProps {
  arrangementId: string;
  passengerName: string;
  status: "active" | "paused" | "ended";
  pickupDescription: string;
  destinationDescription: string;
  pickupTime: string;
  daysOfWeek: number[];
  startDate: string;
  endDate: string | null;
}

type ActiveDialog = "edit" | "pause" | "resume" | "end" | null;

/**
 * Controlled lifecycle actions (P1-E2-S1E §17) — only legal actions for
 * the CURRENT status are ever rendered: active -> Edit/Pause/End; paused
 * -> Edit/Resume/End; ended -> none. Never an impossible button relying
 * on the RPC's own rejection as the actual UX (§17's own explicit
 * instruction) — though the RPC remains the authoritative final
 * boundary regardless, exactly like every other controlled mutation in
 * this codebase.
 */
export function ArrangementLifecycleControls({
  arrangementId,
  passengerName,
  status,
  pickupDescription,
  destinationDescription,
  pickupTime,
  daysOfWeek,
  startDate,
  endDate,
}: ArrangementLifecycleControlsProps) {
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);

  if (status === "ended") {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setActiveDialog("edit")}>
          Edit
        </Button>
        {status === "active" && (
          <Button variant="outline" onClick={() => setActiveDialog("pause")}>
            Pause
          </Button>
        )}
        {status === "paused" && (
          <Button variant="outline" onClick={() => setActiveDialog("resume")}>
            Resume
          </Button>
        )}
        <Button variant="destructive" onClick={() => setActiveDialog("end")}>
          End
        </Button>
      </div>

      {activeDialog === "edit" && (
        <EditArrangementDialog
          arrangementId={arrangementId}
          pickupDescription={pickupDescription}
          destinationDescription={destinationDescription}
          pickupTime={pickupTime}
          daysOfWeek={daysOfWeek}
          startDate={startDate}
          endDate={endDate}
          onClose={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "pause" && (
        <ConfirmActionDialog
          title="Pause recurring arrangement"
          description="Nemryn will stop expecting new occurrences while this arrangement is paused. Existing trips are not cancelled."
          confirmLabel="Pause"
          confirmingLabel="Pausing…"
          hiddenFields={{ arrangementId }}
          action={pauseRecurringArrangementAction}
          onClose={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "resume" && (
        <ConfirmActionDialog
          title="Resume recurring arrangement"
          description="Nemryn will resume expecting occurrences from the current active pattern. Existing trips remain unchanged."
          confirmLabel="Resume"
          confirmingLabel="Resuming…"
          hiddenFields={{ arrangementId }}
          action={resumeRecurringArrangementAction}
          onClose={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "end" && (
        <EndArrangementDialog arrangementId={arrangementId} passengerName={passengerName} onClose={() => setActiveDialog(null)} />
      )}
    </>
  );
}
