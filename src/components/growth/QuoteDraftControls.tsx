"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  createQuoteDraftAction,
  updateQuoteDraftAction,
  withdrawQuoteDraftAction,
  type QuoteFormState,
  type QuoteWithdrawState,
} from "@/app/operations/growth/quotes/actions";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  CHARGE_FIELDS,
  KIND_HELP,
  KIND_OPTIONS,
  QUOTE_LIMITS,
  QUOTE_PRIVACY_HELP,
  formatCents,
  quoteReference,
  validateQuoteForm,
  type QuoteFormValues,
} from "@/lib/plus/quotes-core";
import { MarkSentDialog, ResponseDialog, ReviseDialog, WithdrawSentDialog, type LifecycleTarget, type QuoteReview } from "@/components/growth/QuoteLifecycleDialogs";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: QuoteFormState = { status: "idle" };
const WITHDRAW_IDLE: QuoteWithdrawState = { status: "idle" };

export interface ServiceChoice {
  value: string;
  label: string;
}

export interface DraftForEditing {
  id: string;
  quoteNumber: number;
  kind: string;
  updatedAt: string;
  values: QuoteFormValues;
  /** NP-P2-S5-S3B: the server-read snapshot shown in the Mark sent review */
  review: QuoteReview;
}

/** NP-P2-S5-S3B: the opportunity's current sent quote, for responses, revision and sent withdrawal. */
export interface SentForActions {
  id: string;
  reference: string;
  updatedAt: string;
  isExpired: boolean;
}

type Mode = "create" | "edit" | "withdraw" | "send" | "accept" | "decline" | "revise" | "withdraw-sent";

/**
 * The Quotes panel's write controls, shown only to Plus writers on an open opportunity (NP-P2-S5-S2 / S3B):
 *   no draft and no current sent quote -> "New estimate or quote";
 *   a draft                            -> "Mark sent", "Edit draft", "Withdraw draft";
 *   a current sent quote               -> "Record accepted" / "Record declined" (not once expired), "Revise" (when no
 *                                         draft holds the slot), "Withdraw sent quote".
 * Every lifecycle action is a STAFF STATEMENT; nothing is sent to the customer. One component instance in a fixed place,
 * so the confirmation line survives the page refresh that follows an action; each dialog acts on the quote captured
 * when it opened (D1).
 */
export function QuoteDraftControls({
  organizationId,
  opportunityId,
  today,
  serviceOptions,
  initialCreate,
  draft,
  sent,
  doNotContact,
  canCreate,
}: {
  organizationId: string;
  opportunityId: string;
  /** the organization-local date (YYYY-MM-DD) */
  today: string;
  serviceOptions: ServiceChoice[];
  initialCreate: QuoteFormValues;
  draft: DraftForEditing | null;
  sent: SentForActions | null;
  /** the contact's stored do-not-contact flag when the page loaded (the database re-checks the current one) */
  doNotContact: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Mode | null>(null);
  // D1 (NP-P2-S5-S3A): the draft / sent quote a dialog acts on is captured WHEN the dialog opens. The action's
  // revalidation re-renders this page (a withdrawn draft disappears, a sent quote changes status) and the open dialog
  // must not unmount before it has handed over its confirmation.
  const [target, setTarget] = useState<DraftForEditing | null>(null);
  const [sentTarget, setSentTarget] = useState<SentForActions | null>(null);
  const [instance, setInstance] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const show = (mode: Mode) => {
    setMessage(null);
    setTarget(["edit", "withdraw", "send"].includes(mode) ? draft : null);
    setSentTarget(["accept", "decline", "revise", "withdraw-sent"].includes(mode) ? sent : null);
    setInstance((n) => n + 1);
    setOpen(mode);
  };
  const done = (text: string) => {
    setOpen(null);
    setMessage(text);
    router.refresh();
  };
  const close = () => setOpen(null);
  const reload = () => {
    setOpen(null);
    router.refresh();
  };
  const draftTarget: LifecycleTarget | null = target ? { id: target.id, updatedAt: target.updatedAt, reference: target.review.reference } : null;
  const sentLifecycle: LifecycleTarget | null = sentTarget ? { id: sentTarget.id, updatedAt: sentTarget.updatedAt, reference: sentTarget.reference } : null;
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      {draft && (
        <div className="flex flex-wrap gap-2" data-testid="quote-draft-actions">
          <Button type="button" size="sm" onClick={() => show("send")} data-testid="quote-send-open">
            Mark sent
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => show("edit")} data-testid="quote-edit-open">
            Edit draft
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => show("withdraw")} data-testid="quote-withdraw-open">
            Withdraw draft
          </Button>
        </div>
      )}
      {sent && (
        <div className="flex flex-wrap gap-2" data-testid="quote-sent-actions">
          {!sent.isExpired && (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => show("accept")} data-testid="quote-accept-open">
                Record accepted
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => show("decline")} data-testid="quote-decline-open">
                Record declined
              </Button>
            </>
          )}
          {!draft && (
            <Button type="button" size="sm" variant="outline" onClick={() => show("revise")} data-testid="quote-revise-open">
              Revise
            </Button>
          )}
          <Button type="button" size="sm" variant="text" onClick={() => show("withdraw-sent")} data-testid="quote-withdraw-sent-open">
            Withdraw sent quote
          </Button>
        </div>
      )}
      {!draft && !sent && canCreate && (
        <Button type="button" size="sm" onClick={() => show("create")} data-testid="quote-create-open">
          New estimate or quote
        </Button>
      )}
      {message && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")} data-testid="quote-saved">
          {message}
        </p>
      )}
      {open === "create" && (
        <QuoteEditorDialog
          key={`c${instance}`}
          mode="create"
          organizationId={organizationId}
          opportunityId={opportunityId}
          today={today}
          serviceOptions={serviceOptions}
          initial={initialCreate}
          onClose={close}
          onDone={done}
          onReload={reload}
        />
      )}
      {open === "edit" && target && (
        <QuoteEditorDialog
          key={`e${instance}`}
          mode="edit"
          organizationId={organizationId}
          opportunityId={opportunityId}
          today={today}
          serviceOptions={serviceOptions}
          initial={target.values}
          draft={target}
          onClose={close}
          onDone={done}
          onReload={reload}
        />
      )}
      {open === "withdraw" && target && (
        <WithdrawDraftDialog key={`w${instance}`} organizationId={organizationId} draft={target} onClose={close} onDone={done} onReload={reload} />
      )}
      {open === "send" && target && draftTarget && (
        <MarkSentDialog
          key={`s${instance}`}
          organizationId={organizationId}
          target={draftTarget}
          review={target.review}
          doNotContact={doNotContact}
          onClose={close}
          onDone={done}
          onReload={reload}
        />
      )}
      {(open === "accept" || open === "decline") && sentLifecycle && (
        <ResponseDialog
          key={`r${instance}`}
          organizationId={organizationId}
          target={sentLifecycle}
          response={open === "accept" ? "accepted" : "declined"}
          onClose={close}
          onDone={done}
          onReload={reload}
        />
      )}
      {open === "revise" && sentLifecycle && (
        <ReviseDialog key={`v${instance}`} organizationId={organizationId} target={sentLifecycle} onClose={close} onDone={done} onReload={reload} />
      )}
      {open === "withdraw-sent" && sentLifecycle && (
        <WithdrawSentDialog key={`x${instance}`} organizationId={organizationId} target={sentLifecycle} onClose={close} onDone={done} onReload={reload} />
      )}
    </div>
  );
}

function QuoteEditorDialog({
  mode,
  organizationId,
  opportunityId,
  today,
  serviceOptions,
  initial,
  draft,
  onClose,
  onDone,
  onReload,
}: {
  mode: "create" | "edit";
  organizationId: string;
  opportunityId: string;
  today: string;
  serviceOptions: ServiceChoice[];
  initial: QuoteFormValues;
  draft?: DraftForEditing;
  onClose: () => void;
  onDone: (message: string) => void;
  onReload: () => void;
}) {
  // ONE key per intended draft. A retry (double click, timeout) reuses it and the database returns the same draft. It
  // is also kept in sessionStorage from submit until a confirmed result, so reopening the form after an ambiguous
  // failure (or a page reload) reuses the SAME key -- never a second draft. Storage failures fall back to a fresh key.
  const storageKey = `nemryn.plus.quote.create.${opportunityId}`;
  const [{ idempotencyKey, restored }] = useState(() => {
    if (mode !== "create") return { idempotencyKey: "", restored: false };
    try {
      const prior = window.sessionStorage.getItem(storageKey);
      if (prior && /^[A-Za-z0-9._:-]{8,200}$/.test(prior)) return { idempotencyKey: prior, restored: true };
    } catch {}
    return { idempotencyKey: `quote-${crypto.randomUUID()}`, restored: false };
  });
  const [state, action, pending] = useActionState(mode === "create" ? createQuoteDraftAction : updateQuoteDraftAction, IDLE);
  const [v, setV] = useState<QuoteFormValues>(initial);
  const set = (k: keyof QuoteFormValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const preview = useMemo(() => validateQuoteForm(v, today), [v, today]);
  const errors = state.status === "error" ? (state.errors ?? {}) : {};
  // live feedback for a field the person has typed in (the server's answer wins after a submit)
  const live = preview.ok ? {} : preview.errors;
  const fieldError = (k: keyof QuoteFormValues) => errors[k] ?? (v[k] ? live[k] : undefined);

  // the confirmed result is handed over exactly once
  const handled = useRef<QuoteFormState | null>(null);
  useEffect(() => {
    if (state.status !== "success" || handled.current === state) return;
    handled.current = state;
    if (mode === "create") {
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch {}
    }
    const total = state.totalCents !== undefined ? ` Total ${formatCents(state.totalCents)}.` : "";
    const ref = state.quoteNumber !== undefined ? `${quoteReference(v.kind, state.quoteNumber)}: ` : "";
    onDone(`${ref}${state.message ?? "Draft saved."}${total}`);
  }, [state, mode, storageKey, v.kind, onDone]);

  const title = mode === "create" ? "New estimate or quote" : `Edit draft · ${quoteReference(draft?.kind ?? v.kind, draft?.quoteNumber ?? 0)}`;
  const totals = preview.totals;
  return (
    <Dialog open onClose={onClose} title={title} description="Enter the price your team is giving the customer. It is saved as a draft." className="max-h-[92vh] max-w-2xl overflow-y-auto">
      <form
        action={action}
        onSubmit={() => {
          if (mode !== "create") return;
          try {
            window.sessionStorage.setItem(storageKey, idempotencyKey);
          } catch {}
        }}
        className="flex flex-col gap-zw-lg"
        noValidate
        data-testid="quote-form"
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        {mode === "create" && <input type="hidden" name="opportunityId" value={opportunityId} />}
        {mode === "create" && <input type="hidden" name="idempotencyKey" value={idempotencyKey} />}
        {draft && <input type="hidden" name="quoteId" value={draft.id} />}
        {draft && <input type="hidden" name="expectedVersion" value={draft.updatedAt} />}

        {restored && state.status === "idle" && (
          <p className={cn(typography.metadata, "text-text-secondary")} data-testid="quote-restored">
            Continuing an earlier attempt. If that draft was already saved, you&apos;ll see it instead of a second one.
          </p>
        )}

        <fieldset className="flex flex-col gap-zw-md" disabled={pending}>
          <legend className={cn(typography.label, "mb-2 text-text-primary")}>What you&apos;re pricing</legend>
          <div className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
            <Select name="kind" label="Type" required options={KIND_OPTIONS} value={v.kind} onChange={set("kind")} error={errors.kind}
              helpText={v.kind === "estimate" || v.kind === "quote" ? KIND_HELP[v.kind] : undefined} data-testid="quote-kind" />
            <Select name="serviceType" label="Service requested" options={serviceOptions} value={v.serviceType} onChange={set("serviceType")} error={errors.serviceType} data-testid="quote-service" />
            <Select name="roundTrip" label="Round trip" options={[{ value: "no", label: "No, one way" }, { value: "yes", label: "Yes, round trip" }]} value={v.roundTrip} onChange={set("roundTrip")} error={errors.roundTrip} data-testid="quote-round-trip" />
            <Input name="distanceMiles" label="Estimated miles (optional)" inputMode="decimal" autoComplete="off" placeholder="e.g. 12.5" value={v.distanceMiles} onChange={set("distanceMiles")}
              error={fieldError("distanceMiles")} helpText="Entered by your team. Nemryn doesn't look up distances." data-testid="quote-miles" />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-zw-md" disabled={pending}>
          <legend className={cn(typography.label, "mb-2 text-text-primary")}>Charges (US dollars)</legend>
          <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
            {CHARGE_FIELDS.map((f) => (
              <Input key={f.key} name={f.key} label={f.label} inputMode="decimal" autoComplete="off" placeholder="0.00" value={v[f.key]} onChange={set(f.key)}
                error={fieldError(f.key)} className="text-right tabular-nums" data-testid={`quote-${f.key}`} />
            ))}
          </div>
          <Input name="otherLabel" label="Other charge description" maxLength={QUOTE_LIMITS.otherLabel} autoComplete="off" value={v.otherLabel} onChange={set("otherLabel")}
            error={errors.otherLabel ?? (v.otherLabel || v.other ? live.otherLabel : undefined)} helpText={`Needed when there is an other charge. ${QUOTE_PRIVACY_HELP}`} data-testid="quote-other-label" />
          <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
            <Input name="discount" label="Discount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={v.discount} onChange={set("discount")}
              error={fieldError("discount")} className="text-right tabular-nums" data-testid="quote-discount" />
          </div>
          <div className="rounded-md bg-surface-secondary p-3" aria-live="polite" data-testid="quote-totals">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              <dt className={cn(typography.bodySmall, "text-text-secondary")}>Charges</dt>
              <dd className={cn(typography.bodySmall, "text-right tabular-nums text-text-primary")}>{totals ? formatCents(totals.subtotalCents) : "—"}</dd>
              <dt className={cn(typography.bodySmall, "text-text-secondary")}>Discount</dt>
              <dd className={cn(typography.bodySmall, "text-right tabular-nums text-text-primary")}>{totals ? (totals.discountCents ? `−${formatCents(totals.discountCents)}` : formatCents(0)) : "—"}</dd>
              <dt className={cn(typography.label, "text-text-primary")}>Total (USD)</dt>
              <dd className={cn(typography.label, "text-right tabular-nums text-text-primary")} data-testid="quote-total-preview">{totals ? formatCents(totals.totalCents) : "—"}</dd>
            </dl>
            <p className={cn(typography.metadata, "mt-2 text-text-muted")}>A preview. Nemryn calculates the saved total.</p>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-zw-md" disabled={pending}>
          <legend className={cn(typography.label, "mb-2 text-text-primary")}>Terms</legend>
          <div className="grid grid-cols-1 gap-zw-md sm:grid-cols-2">
            <Input name="validUntil" label="Valid until" type="date" required min={today} value={v.validUntil} onChange={set("validUntil")} error={errors.validUntil} data-testid="quote-valid-until" />
          </div>
          <Textarea name="termsNote" label="Terms note (optional)" rows={3} maxLength={QUOTE_LIMITS.terms} value={v.termsNote} onChange={set("termsNote")} error={errors.termsNote}
            helpText={QUOTE_PRIVACY_HELP} data-testid="quote-terms" />
        </fieldset>

        {state.status === "error" && state.message && (
          <div data-testid={state.stale ? "quote-stale" : "quote-error"}>
            <AttentionState level="critical" title={state.stale ? "This draft changed" : "Not saved"} description={state.message} />
            {state.stale && (
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onReload} data-testid="quote-reload">
                Reload the latest version
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending || state.stale === true} data-testid="quote-save">
            {mode === "create" ? "Save draft" : "Save changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function WithdrawDraftDialog({
  organizationId,
  draft,
  onClose,
  onDone,
  onReload,
}: {
  organizationId: string;
  draft: DraftForEditing;
  onClose: () => void;
  onDone: (message: string) => void;
  onReload: () => void;
}) {
  const [state, action, pending] = useActionState(withdrawQuoteDraftAction, WITHDRAW_IDLE);
  const handled = useRef<QuoteWithdrawState | null>(null);
  useEffect(() => {
    if (state.status !== "success" || handled.current === state) return;
    handled.current = state;
    onDone(state.message ?? "Draft withdrawn.");
  }, [state, onDone]);
  return (
    <Dialog open onClose={onClose} title={`Withdraw ${quoteReference(draft.kind, draft.quoteNumber)}?`} description="The draft is kept in the quote history as withdrawn. It can't be edited again.">
      <form action={action} className="flex flex-col gap-zw-md" data-testid="quote-withdraw-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="quoteId" value={draft.id} />
        <input type="hidden" name="expectedVersion" value={draft.updatedAt} />
        {state.status === "error" && state.message && (
          <div data-testid="quote-withdraw-error">
            <AttentionState level="critical" title="Not withdrawn" description={state.message} />
            {state.stale && (
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onReload}>
                Reload the latest version
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Keep draft
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending || state.stale === true} data-testid="quote-withdraw-confirm">
            Withdraw draft
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
