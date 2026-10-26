"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { convertInquiryAction, dismissInquiryAction, reopenInquiryAction, type InquiryActionState } from "@/app/operations/growth/inquiries/actions";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Textarea } from "@/components/ui/Textarea";
import { DISMISS_NOTE_MAX, DISMISS_REASONS, DISMISS_REASON_LABELS } from "@/lib/plus/inquiries-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: InquiryActionState = { status: "idle" };

export interface LinkCandidate {
  id: string;
  displayName: string;
  matchOn: string;
  doNotContact: boolean;
  /** The contact has no phone / email and the inquiry has one (offer "fill blanks"). */
  canFill: boolean;
}

interface Shared {
  organizationId: string;
  inquiryId: string;
  version: number;
}

function ConvertDialog({ shared, name, defaultTitle, candidates, ticks, onClose }: { shared: Shared; name: string; defaultTitle: string; candidates: LinkCandidate[]; ticks: { followup: boolean; marketing: boolean }; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(convertInquiryAction, IDLE);
  const [mode, setMode] = useState<"create" | "link">(candidates.length > 0 ? "link" : "create");
  const [contactId, setContactId] = useState(candidates[0]?.id ?? "");
  const [ack, setAck] = useState(false);
  const chosen = candidates.find((c) => c.id === contactId);
  const dnc = mode === "link" && chosen?.doNotContact === true;
  const close = () => {
    if (state.status === "success") router.refresh();
    onClose();
  };

  if (state.status === "success") {
    return (
      <Dialog open onClose={close} title={`Converted — ${name}`}>
        <div className="flex flex-col gap-zw-md" role="status" data-testid="inquiry-convert-success">
          <p className={cn(typography.body, "text-text-primary")}>{state.message}</p>
          <ul className={cn(typography.bodySmall, "list-disc pl-5 text-text-secondary")} data-testid="inquiry-convert-consent-notes">
            {state.consentNotes?.map((n) => <li key={n}>{n}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            {state.opportunityId && <Link className="text-text-link hover:underline" href={`/operations/growth/pipeline/${state.opportunityId}`}>Open the opportunity</Link>}
            {state.contactId && <Link className="text-text-link hover:underline" href={`/operations/growth/contacts/${state.contactId}`}>Open the contact</Link>}
          </div>
          <div className="flex justify-end"><Button type="button" onClick={close}>Done</Button></div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={close} title={`Convert inquiry — ${name}`} description="Creates or links a contact and creates one private-pay opportunity in New inquiry. No booking request is made.">
      <form action={action} className="flex flex-col gap-zw-md" data-testid="inquiry-convert-form">
        <input type="hidden" name="organizationId" value={shared.organizationId} />
        <input type="hidden" name="inquiryId" value={shared.inquiryId} />
        <input type="hidden" name="expectedVersion" value={shared.version} />
        <input type="hidden" name="mode" value={mode} />
        {state.status === "duplicates" && <input type="hidden" name="confirmDuplicate" value="true" />}
        <RadioGroup
          legend="Contact"
          name="modeChoice"
          value={mode}
          onChange={(v) => setMode(v === "link" ? "link" : "create")}
          options={[
            { value: "create", label: "Create a new contact", description: "From the name, phone and email on the inquiry." },
            { value: "link", label: "Link to an existing contact", description: candidates.length > 0 ? "One of the possible matches below." : "No possible match was found.", disabled: candidates.length === 0 },
          ]}
        />
        {mode === "link" && candidates.length > 0 && (
          <RadioGroup
            legend="Which contact?"
            name="contactId"
            value={contactId}
            onChange={setContactId}
            options={candidates.map((c) => ({ value: c.id, label: c.displayName, description: `${c.doNotContact ? "Do not contact · " : ""}matches on ${c.matchOn}` }))}
          />
        )}
        {mode === "link" && chosen?.canFill && (
          <Checkbox name="fillBlanks" label="Add the inquiry's missing phone or email to this contact" description="Only empty fields are filled. Existing contact details are never changed." />
        )}
        {dnc && (
          <div className="flex flex-col gap-2" data-testid="inquiry-convert-dnc">
            <AttentionState level="critical" title="This contact is marked Do not contact" description="You can still convert the inquiry so it is tracked, but respect their preference. No consent will be recorded from this inquiry, and Do not contact stays on." />
            <Checkbox name="dncAcknowledged" label="I've read this warning" checked={ack} onChange={(e) => setAck(e.target.checked)} required />
          </div>
        )}
        <Input name="title" label="Opportunity title (optional)" placeholder={defaultTitle} maxLength={200} disabled={pending} />
        <div className={cn(typography.bodySmall, "rounded-md bg-surface-secondary p-3 text-text-secondary")} data-testid="inquiry-convert-consent">
          <p className="font-medium text-text-primary">Communication consent</p>
          <p>
            {ticks.followup || ticks.marketing
              ? `Recorded only for the boxes the person ticked (${[ticks.followup && "follow-up", ticks.marketing && "news and offers"].filter(Boolean).join(" and ")}), for the email and phone they gave, when they match the contact. Text messages are never included.`
              : "The person ticked no consent box, so no consent will be recorded."}
          </p>
        </div>
        {(state.status === "error" || state.status === "duplicates") && state.message && (
          <p role="alert" className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-warning-text")} data-testid="inquiry-convert-message">
            {state.message}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending} disabled={pending || (dnc && !ack)} data-testid="inquiry-convert-submit">
            {state.status === "duplicates" && mode === "create" ? "Create a new contact anyway" : "Convert"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DismissDialog({ shared, name, onClose }: { shared: Shared; name: string; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(dismissInquiryAction, IDLE);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    onClose();
  }, [state, router, onClose]);
  return (
    <Dialog open onClose={onClose} title={`Dismiss inquiry — ${name}`} description="The inquiry is kept and can be reopened later.">
      <form action={action} className="flex flex-col gap-zw-md" data-testid="inquiry-dismiss-form">
        <input type="hidden" name="organizationId" value={shared.organizationId} />
        <input type="hidden" name="inquiryId" value={shared.inquiryId} />
        <input type="hidden" name="expectedVersion" value={shared.version} />
        <Select name="reason" label="Reason" required options={DISMISS_REASONS.map((r) => ({ value: r, label: DISMISS_REASON_LABELS[r] }))} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Choose…" />
        <Textarea name="note" label={reason === "other" ? "Note" : "Note (optional)"} required={reason === "other"} rows={2} maxLength={DISMISS_NOTE_MAX} helpText="Please don't include medical details." disabled={pending} />
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending} disabled={pending} data-testid="inquiry-dismiss-submit">Dismiss</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Actions for one inquiry. Read-only viewers (READ grant, read_only workspace) see the status only. */
export function InquiryActions(props: {
  organizationId: string;
  inquiryId: string;
  version: number;
  status: string;
  canWrite: boolean;
  name: string;
  defaultTitle: string;
  candidates: LinkCandidate[];
  ticks: { followup: boolean; marketing: boolean };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"convert" | "dismiss" | null>(null);
  const [reopenState, reopen, reopening] = useActionState(reopenInquiryAction, IDLE);
  const shared = { organizationId: props.organizationId, inquiryId: props.inquiryId, version: props.version };
  useEffect(() => {
    if (reopenState.status === "success") router.refresh();
  }, [reopenState, router]);
  if (!props.canWrite) {
    return <StatusBadge label="View only" category="neutral" />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="inquiry-actions">
      {props.status === "new" && (
        <>
          <Button type="button" onClick={() => setOpen("convert")} data-testid="inquiry-convert-open">Convert</Button>
          <Button type="button" variant="outline" onClick={() => setOpen("dismiss")} data-testid="inquiry-dismiss-open">Dismiss</Button>
        </>
      )}
      {props.status === "dismissed" && (
        <form action={reopen}>
          <input type="hidden" name="organizationId" value={props.organizationId} />
          <input type="hidden" name="inquiryId" value={props.inquiryId} />
          <input type="hidden" name="expectedVersion" value={props.version} />
          <Button type="submit" variant="outline" loading={reopening} disabled={reopening} data-testid="inquiry-reopen">Reopen</Button>
        </form>
      )}
      {reopenState.status === "error" && reopenState.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>{reopenState.message}</p>}
      {open === "convert" && <ConvertDialog shared={shared} name={props.name} defaultTitle={props.defaultTitle} candidates={props.candidates} ticks={props.ticks} onClose={() => setOpen(null)} />}
      {open === "dismiss" && <DismissDialog shared={shared} name={props.name} onClose={() => setOpen(null)} />}
    </div>
  );
}
