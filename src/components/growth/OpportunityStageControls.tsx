"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { changeStageAction, markLostAction, reopenAction, type OpportunityActionState } from "@/app/operations/growth/pipeline/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  CONVERTED_RESERVED_NOTE,
  LOST_REASON_OPTIONS,
  OPEN_STAGE_OPTIONS,
  REPORTED_QUOTE_STAGE_NOTE,
  stageDisplayLabel,
  stageMoveOptions,
} from "@/lib/plus/opportunities-core";
import { NO_MEDICAL_DETAILS_NOTICE } from "@/lib/plus/contacts-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: OpportunityActionState = { status: "idle" };

function Hidden({ organizationId, opportunityId, expectedVersion }: { organizationId: string; opportunityId: string; expectedVersion: string }) {
  return (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
    </>
  );
}

function ErrorLine({ state }: { state: OpportunityActionState }) {
  if (state.status !== "error" || !state.message) return null;
  return (
    <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
      {state.message}
    </p>
  );
}

/** Direct, accessible stage selector (no drag-and-drop): every other open stage, forward or back. */
function StageForm(props: { organizationId: string; opportunityId: string; expectedVersion: string; stage: string; onDone: (m: string) => void }) {
  const [state, action, pending] = useActionState(changeStageAction, IDLE);
  const { onDone } = props;
  useEffect(() => {
    if (state.status === "success") onDone(state.message ?? "");
  }, [state, onDone]);
  const options = stageMoveOptions(props.stage).map((s) => ({ value: s, label: stageDisplayLabel(s) }));
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="stage-form">
      <Hidden {...props} />
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <div className="md:w-64">
          <Select name="toStage" label="Move to stage" options={options} defaultValue={options[0]?.value} disabled={pending} />
        </div>
        <div className="min-w-0 flex-1">
          <Textarea name="note" label="Note (optional)" rows={1} maxLength={500} disabled={pending} />
        </div>
        <Button type="submit" variant="outline" loading={pending} disabled={pending} data-testid="stage-save">
          Move
        </Button>
      </div>
      <ErrorLine state={state} />
    </form>
  );
}

function LostDialog(props: { organizationId: string; opportunityId: string; expectedVersion: string; onClose: () => void; onDone: (m: string) => void }) {
  const [state, action, pending] = useActionState(markLostAction, IDLE);
  const { onClose, onDone } = props;
  useEffect(() => {
    if (state.status === "success") {
      onDone(state.message ?? "");
      onClose();
    }
  }, [state, onClose, onDone]);
  return (
    <Dialog open onClose={onClose} title="Mark as lost" description="Lost opportunities are kept with their history and can be reopened later with a reason.">
      <form action={action} className="flex flex-col gap-zw-md" data-testid="lost-form">
        <Hidden {...props} />
        <Select name="lostReason" label="Reason" required options={[{ value: "", label: "Choose a reason" }, ...LOST_REASON_OPTIONS]} defaultValue="" disabled={pending} />
        <Textarea name="lostNote" label="Note (required for Other)" rows={3} maxLength={500} disabled={pending} helpText={NO_MEDICAL_DETAILS_NOTICE} />
        <ErrorLine state={state} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending} data-testid="lost-confirm">
            Mark as lost
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReopenForm(props: { organizationId: string; opportunityId: string; expectedVersion: string; onDone: (m: string) => void }) {
  const [state, action, pending] = useActionState(reopenAction, IDLE);
  const { onDone } = props;
  useEffect(() => {
    if (state.status === "success") onDone(state.message ?? "");
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="reopen-form">
      <Hidden {...props} />
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <div className="md:w-64">
          <Select name="toStage" label="Reopen in stage" options={OPEN_STAGE_OPTIONS} defaultValue="contacted" disabled={pending} />
        </div>
        <div className="min-w-0 flex-1">
          <Textarea name="reason" label="Why are you reopening it?" required rows={1} maxLength={500} disabled={pending} />
        </div>
        <Button type="submit" variant="outline" loading={pending} disabled={pending} data-testid="reopen-save">
          Reopen
        </Button>
      </div>
      <ErrorLine state={state} />
    </form>
  );
}

/**
 * Stage controls on Opportunity detail (NP-P2-S1). Rendered only for Plus write capability. Open: move to another
 * open stage, or mark lost (reason required). Lost: reopen with a reason. Converted is never offered -- it is reserved
 * for the later Operations conversion, and that is said plainly instead of showing a dead button.
 * Kept mounted across stage changes so the outcome message survives the refresh.
 */
export function OpportunityStageControls({
  organizationId,
  opportunityId,
  expectedVersion,
  stage,
}: {
  organizationId: string;
  opportunityId: string;
  expectedVersion: string;
  stage: string;
}) {
  const [lostOpen, setLostOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeLost = useCallback(() => setLostOpen(false), []);
  const onDone = useCallback((m: string) => setNotice(m || null), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  const ids = { organizationId, opportunityId, expectedVersion };

  return (
    <div className="flex flex-col gap-zw-md" data-testid="stage-controls">
      {notice && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")} data-testid="stage-notice">
          {notice}
        </p>
      )}
      {stage === "lost" ? (
        <ReopenForm {...ids} onDone={onDone} />
      ) : stage === "converted" ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>This opportunity became a booking request in Operations.</p>
      ) : (
        <>
          <StageForm {...ids} stage={stage} onDone={onDone} />
          <div>
            <Button type="button" variant="text" size="sm" onClick={() => { setNotice(null); setLostOpen(true); }} data-testid="lost-open">
              Mark as lost
            </Button>
          </div>
        </>
      )}
      <p className={cn(typography.metadata, "text-text-muted")}>
        {REPORTED_QUOTE_STAGE_NOTE} {CONVERTED_RESERVED_NOTE}
      </p>
      {lostOpen && <LostDialog {...ids} onClose={closeLost} onDone={onDone} />}
    </div>
  );
}
