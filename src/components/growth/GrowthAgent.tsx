"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { approveRecommendationAction, dismissRecommendationAction, runAgentReviewAction, type AgentActionState } from "@/app/operations/growth/agent/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ClockCounterClockwise, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Textarea } from "@/components/ui/Textarea";
import { CONSENT_CAVEAT, NOT_SENT_LABEL } from "@/lib/plus/agent-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: AgentActionState = { status: "idle" };

/** "Review opportunities": runs one deterministic review on the server. Creates recommendations only. */
export function RunReviewButton({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(runAgentReviewAction, IDLE);
  return (
    <form action={action} className="flex flex-col items-start gap-1" data-testid="agent-run-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <Button type="submit" variant="outline" loading={pending} disabled={pending} data-testid="agent-run">
        Review opportunities
      </Button>
      {state.status !== "idle" && state.message && (
        <p role={state.status === "error" ? "alert" : "status"} className={cn(typography.metadata, state.status === "error" ? "text-critical-text" : "text-text-secondary")} data-testid="agent-run-result">
          {state.message}
        </p>
      )}
    </form>
  );
}

export interface RecommendationView {
  id: string;
  version: string;
  status: string;
  opportunityId: string;
  opportunityTitle: string;
  stageLabel: string;
  contactId: string;
  contactName: string;
  doNotContact: boolean;
  title: string;
  reason: string;
  proposedAction: string;
  lastActivityLabel: string;
  generatedLabel: string;
  outcomeLabel: string | null;
  draft: { channel: "phone" | "email"; text: string } | null;
  noDraftReason: string | null;
  suggestedTaskTitle: string;
  suggestedDueDate: string;
}

function DraftBlock({ draft, noDraftReason }: { draft: RecommendationView["draft"]; noDraftReason: string | null }) {
  const [text, setText] = useState(draft?.text ?? "");
  if (!draft) {
    return (
      <p className={cn(typography.metadata, "text-text-secondary")} data-testid="agent-no-draft">
        {noDraftReason}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-md border border-warning-border bg-surface-secondary p-3" data-testid="agent-draft">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={NOT_SENT_LABEL} category="warning" />
        <span className={cn(typography.metadata, "text-text-secondary")}>
          Suggested {draft.channel === "phone" ? "call script" : "email"} — edit here, then use it yourself if appropriate.
        </span>
      </div>
      <Textarea label="Message draft (not sent)" value={text} onChange={(e) => setText(e.target.value)} rows={draft.channel === "email" ? 6 : 3} data-testid="agent-draft-text" />
      <p className={cn(typography.metadata, "text-text-muted")}>{CONSENT_CAVEAT} Edits stay on this page and are not saved or sent.</p>
    </div>
  );
}

function ReviewControls({
  rec,
  organizationId,
  owners,
  selfHandle,
  onDone,
}: {
  rec: RecommendationView;
  organizationId: string;
  owners: { value: string; label: string }[];
  selfHandle: string | null;
  onDone: (m: string, tone: "success" | "error") => void;
}) {
  // Submitted through a transition that reports to the QUEUE: on success the card turns "approved" and this form
  // unmounts, so the outcome must not depend on this component's own state.
  const [pending, startApprove] = useTransition();
  const [dismissPending, startDismiss] = useTransition();
  const dismiss = (outcome: "dismissed" | "not_relevant") =>
    startDismiss(async () => {
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      fd.set("recommendationId", rec.id);
      fd.set("expectedVersion", rec.version);
      fd.set("outcome", outcome);
      const r = await dismissRecommendationAction(IDLE, fd);
      onDone(r.message ?? "", r.status === "error" ? "error" : "success");
    });

  return (
    <div className="flex flex-col gap-zw-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startApprove(async () => {
            const r = await approveRecommendationAction(IDLE, fd);
            onDone(r.message ?? "", r.status === "error" ? "error" : "success");
          });
        }}
        className="flex flex-col gap-zw-md rounded-md border border-border-subtle p-3"
        data-testid="agent-approve-form"
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="recommendationId" value={rec.id} />
        <input type="hidden" name="expectedVersion" value={rec.version} />
        <p className={cn(typography.label, "text-text-primary")}>Suggested internal task</p>
        <Input name="title" label="Task" required maxLength={200} defaultValue={rec.suggestedTaskTitle} disabled={pending} />
        <div className="grid grid-cols-1 gap-zw-md md:grid-cols-3">
          <Input name="dueDate" label="Due date" type="date" defaultValue={rec.suggestedDueDate} disabled={pending} />
          <Input name="dueTime" label="Time (optional)" type="time" disabled={pending} />
          <Select name="assigneeHandle" label="Assignee" options={[{ value: "", label: "Unassigned" }, ...owners]} defaultValue={selfHandle ?? ""} disabled={pending} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending} disabled={pending || dismissPending} data-testid="agent-approve">
            Create follow-up task
          </Button>
          <Button type="button" variant="outline" onClick={() => dismiss("dismissed")} disabled={pending || dismissPending} data-testid="agent-dismiss">
            Dismiss
          </Button>
          <Button type="button" variant="text" onClick={() => dismiss("not_relevant")} disabled={pending || dismissPending} data-testid="agent-not-relevant">
            No longer relevant
          </Button>
        </div>
        <p className={cn(typography.metadata, "text-text-muted")}>Creating the task doesn&apos;t send anything or change the opportunity.</p>
      </form>
    </div>
  );
}

function RecommendationCard(props: {
  rec: RecommendationView;
  canWrite: boolean;
  organizationId: string;
  owners: { value: string; label: string }[];
  selfHandle: string | null;
  onDone: (m: string, tone: "success" | "error") => void;
}) {
  const { rec, canWrite } = props;
  const pending = rec.status === "pending";
  return (
    <li className="border-t border-border-subtle py-zw-lg first:border-t-0 first:pt-0" data-testid="agent-recommendation" data-status={rec.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn(typography.subsectionHeading, "text-text-primary")}>{rec.title}</p>
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            <Link href={`/operations/growth/pipeline/${rec.opportunityId}`} className="text-text-link hover:underline" data-testid="agent-opportunity-link">
              {rec.opportunityTitle}
            </Link>{" "}
            · {rec.stageLabel} ·{" "}
            <Link href={`/operations/growth/contacts/${rec.contactId}`} className="text-text-link hover:underline">
              {rec.contactName}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {rec.doNotContact && <StatusBadge label="Do not contact" category="critical" />}
          <StatusBadge label={pending ? "Needs review" : rec.outcomeLabel ?? ""} category={pending ? "warning" : rec.status === "approved" ? "positive" : "neutral"} />
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <dt className={cn(typography.metadata, "uppercase tracking-wide text-text-muted")}>Why</dt>
          <dd className={cn(typography.bodySmall, "text-text-primary")} data-testid="agent-reason">{rec.reason}</dd>
        </div>
        <div>
          <dt className={cn(typography.metadata, "uppercase tracking-wide text-text-muted")}>Proposed next action</dt>
          <dd className={cn(typography.bodySmall, "text-text-primary")}>{rec.proposedAction}</dd>
        </div>
        <div>
          <dt className={cn(typography.metadata, "uppercase tracking-wide text-text-muted")}>Last recorded activity</dt>
          <dd className={cn(typography.bodySmall, "text-text-primary")}>{rec.lastActivityLabel}</dd>
        </div>
        <div>
          <dt className={cn(typography.metadata, "uppercase tracking-wide text-text-muted")}>Who did what</dt>
          <dd className={cn(typography.bodySmall, "text-text-primary")} data-testid="agent-provenance">
            {rec.generatedLabel}
            {rec.outcomeLabel && !pending ? ` · ${rec.outcomeLabel}` : ""}
          </dd>
        </div>
      </dl>
      {pending && (
        <div className="mt-zw-md flex flex-col gap-zw-md">
          <DraftBlock draft={rec.draft} noDraftReason={rec.noDraftReason} />
          {canWrite && <ReviewControls {...props} />}
        </div>
      )}
    </li>
  );
}

/** The supervision queue: recommendations needing review, then reviewed history. */
export function RecommendationQueue({
  pending,
  reviewed,
  canWrite,
  organizationId,
  owners,
  selfHandle,
}: {
  pending: RecommendationView[];
  reviewed: RecommendationView[];
  canWrite: boolean;
  organizationId: string;
  owners: { value: string; label: string }[];
  selfHandle: string | null;
}) {
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const onDone = useCallback((text: string, tone: "success" | "error") => setNotice(text ? { text, tone } : null), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);
  return (
    <div className="flex flex-col gap-zw-lg" data-testid="agent-queue">
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={cn(typography.bodySmall, notice.tone === "error" ? "text-critical-text" : "text-text-secondary")} data-testid="agent-notice">
          {notice.text}
        </p>
      )}
      {/* NP-UI-V2-3 final polish: each queue is one raised panel with an icon header (the V2-2 / V2-3 anatomy). */}
      <Panel surface="raised" className="flex flex-col gap-zw-md">
      <section aria-label="Needs review" className="flex flex-col gap-zw-md">
        <SectionHeader title={`Needs review (${pending.length})`} icon={<Sparkle />} tone={pending.length > 0 ? "attention" : "neutral"} />
        {pending.length === 0 ? (
          <p className={cn(typography.bodySmall, "rounded-sm bg-surface-app px-zw-md py-zw-sm text-text-secondary")} data-testid="agent-empty">
            Nothing needs review right now.{canWrite ? " Use “Review opportunities” to check the pipeline again." : ""}
          </p>
        ) : (
          <div>
            <ul aria-label="Recommendations needing review">
              {pending.map((r) => (
                <RecommendationCard key={r.id} rec={r} canWrite={canWrite} organizationId={organizationId} owners={owners} selfHandle={selfHandle} onDone={onDone} />
              ))}
            </ul>
          </div>
        )}
      </section>
      </Panel>
      <Panel surface="raised" className="flex flex-col gap-zw-md">
      <section aria-label="Reviewed" className="flex flex-col gap-zw-md">
        <SectionHeader title="Recently reviewed" icon={<ClockCounterClockwise />} />
        {reviewed.length === 0 ? (
          <p className={cn(typography.bodySmall, "rounded-sm bg-surface-app px-zw-md py-zw-sm text-text-secondary")}>No reviewed recommendations yet.</p>
        ) : (
          <div>
            <ul aria-label="Reviewed recommendations">
              {reviewed.map((r) => (
                <RecommendationCard key={r.id} rec={r} canWrite={false} organizationId={organizationId} owners={owners} selfHandle={selfHandle} onDone={onDone} />
              ))}
            </ul>
          </div>
        )}
      </section>
      </Panel>
    </div>
  );
}
