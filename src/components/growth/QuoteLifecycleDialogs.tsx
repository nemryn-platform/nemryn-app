"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  markQuoteSentAction,
  recordQuoteResponseAction,
  reviseQuoteAction,
  withdrawSentQuoteAction,
  type QuoteLifecycleState,
} from "@/app/operations/growth/quotes/actions";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import {
  DNC_ACK_LABEL,
  DNC_WARNING_TEXT,
  DNC_WARNING_TITLE,
  MARK_SENT_NOTE,
  RESPONSE_NOTE,
  REVISE_NOTE,
  SENT_WITHDRAW_REASON_MAX,
  WITHDRAW_SENT_NOTE,
} from "@/lib/plus/quotes-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: QuoteLifecycleState = { status: "idle" };

/** The server-read snapshot a reviewer confirms (formatted on the server; the client never computes the total). */
export interface QuoteReview {
  reference: string;
  kindLabel: string;
  serviceLabel: string;
  lines: { label: string; amount: string }[];
  discount: string | null;
  total: string;
  validUntil: string;
  /** "Quote 3" when this draft is a revision that will replace the current sent quote */
  replaces: string | null;
}

export interface LifecycleTarget {
  id: string;
  updatedAt: string;
  reference: string;
}

/** Hands a confirmed result over exactly once (a re-render after revalidation must not repeat it). */
function useDone(state: QuoteLifecycleState, onDone: (message: string) => void, after?: () => void) {
  const handled = useRef<QuoteLifecycleState | null>(null);
  useEffect(() => {
    if (state.status !== "success" || handled.current === state) return;
    handled.current = state;
    after?.();
    onDone(state.message ?? "Saved.");
  }, [state, onDone, after]);
}

function ErrorBlock({ state, onReload, testid }: { state: QuoteLifecycleState; onReload: () => void; testid: string }) {
  if (state.status !== "error" || !state.message || state.dncRequired) return null;
  return (
    <div data-testid={testid}>
      <AttentionState level="critical" title={state.stale ? "This quote changed" : "Not saved"} description={state.message} />
      {state.stale && (
        <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onReload} data-testid="quote-lifecycle-reload">
          Reload the latest version
        </Button>
      )}
    </div>
  );
}

/**
 * Mark sent (NP-P2-S5-S3B): review the server snapshot, then confirm. OD-Q16 (ZD-223): for a do-not-contact contact a
 * warning and an explicit acknowledgment are required; the database re-reads the CURRENT flag and refuses without it,
 * so a preference changed after this dialog opened is caught (the warning then appears here).
 */
export function MarkSentDialog({
  organizationId,
  target,
  review,
  doNotContact,
  onClose,
  onDone,
  onReload,
}: {
  organizationId: string;
  target: LifecycleTarget;
  review: QuoteReview;
  doNotContact: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  onReload: () => void;
}) {
  const [state, action, pending] = useActionState(markQuoteSentAction, IDLE);
  const [ack, setAck] = useState(false);
  useDone(state, onDone);
  const needsAck = doNotContact || state.dncRequired === true;
  return (
    <Dialog open onClose={onClose} title={`Mark ${review.reference} sent?`} description={MARK_SENT_NOTE} className="max-h-[92vh] max-w-xl overflow-y-auto">
      <form action={action} className="flex flex-col gap-zw-md" data-testid="quote-send-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="quoteId" value={target.id} />
        <input type="hidden" name="expectedVersion" value={target.updatedAt} />
        <input type="hidden" name="dncAcknowledged" value={needsAck && ack ? "true" : "false"} />
        <div className="rounded-md bg-surface-secondary p-3" data-testid="quote-send-review">
          <p className={cn(typography.label, "text-text-primary")}>
            {review.kindLabel} · {review.serviceLabel}
          </p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {review.lines.map((l) => (
              <div key={l.label} className="contents">
                <dt className={cn(typography.bodySmall, "text-text-secondary")}>{l.label}</dt>
                <dd className={cn(typography.bodySmall, "text-right tabular-nums text-text-primary")}>{l.amount}</dd>
              </div>
            ))}
            {review.discount && (
              <>
                <dt className={cn(typography.bodySmall, "text-text-secondary")}>Discount</dt>
                <dd className={cn(typography.bodySmall, "text-right tabular-nums text-text-primary")}>−{review.discount}</dd>
              </>
            )}
            <dt className={cn(typography.label, "text-text-primary")}>Total (USD)</dt>
            <dd className={cn(typography.label, "text-right tabular-nums text-text-primary")} data-testid="quote-send-total">
              {review.total}
            </dd>
          </dl>
          <p className={cn(typography.metadata, "mt-2 text-text-muted")}>Valid until {review.validUntil}</p>
          {review.replaces && (
            <p className={cn(typography.bodySmall, "mt-2 text-text-primary")} data-testid="quote-send-replaces">
              This revision replaces {review.replaces}, which becomes history.
            </p>
          )}
        </div>
        {needsAck && (
          <div className="flex flex-col gap-2" data-testid="quote-send-dnc">
            <AttentionState level="warning" title={DNC_WARNING_TITLE} description={DNC_WARNING_TEXT} />
            <label className={cn(typography.bodySmall, "flex items-start gap-2 text-text-primary")}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={pending} className="mt-0.5" data-testid="quote-send-dnc-ack" />
              <span>{DNC_ACK_LABEL}</span>
            </label>
            {state.dncRequired && !ack && (
              <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="quote-send-dnc-required">
                {state.message}
              </p>
            )}
          </div>
        )}
        <ErrorBlock state={state} onReload={onReload} testid="quote-send-error" />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending || state.stale === true || (needsAck && !ack)} data-testid="quote-send-confirm">
            Mark sent
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Record the customer's reported response (accepted | declined). */
export function ResponseDialog({
  organizationId,
  target,
  response,
  onClose,
  onDone,
  onReload,
}: {
  organizationId: string;
  target: LifecycleTarget;
  response: "accepted" | "declined";
  onClose: () => void;
  onDone: (message: string) => void;
  onReload: () => void;
}) {
  const [state, action, pending] = useActionState(recordQuoteResponseAction, IDLE);
  useDone(state, onDone);
  const accepted = response === "accepted";
  return (
    <Dialog
      open
      onClose={onClose}
      title={accepted ? `Record the customer's acceptance of ${target.reference}?` : `Record the customer's decline of ${target.reference}?`}
      description={RESPONSE_NOTE}
    >
      <form action={action} className="flex flex-col gap-zw-md" data-testid="quote-response-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="quoteId" value={target.id} />
        <input type="hidden" name="expectedVersion" value={target.updatedAt} />
        <input type="hidden" name="response" value={response} />
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          {accepted
            ? "The opportunity moves to Quote accepted (if it isn't there yet). Converting it to a transportation request stays a separate step."
            : "The opportunity stays open. Mark it lost yourself if the customer isn't going ahead."}
        </p>
        <ErrorBlock state={state} onReload={onReload} testid="quote-response-error" />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending || state.stale === true} data-testid="quote-response-confirm">
            {accepted ? "Record acceptance" : "Record decline"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Revise a sent quote: ONE key per intended revision, kept in sessionStorage from submit until a confirmed result, so a
 * retry after an ambiguous failure returns the same revision instead of trying to create a second one.
 */
export function ReviseDialog({
  organizationId,
  target,
  onClose,
  onDone,
  onReload,
}: {
  organizationId: string;
  target: LifecycleTarget;
  onClose: () => void;
  onDone: (message: string) => void;
  onReload: () => void;
}) {
  const storageKey = `nemryn.plus.quote.revise.${target.id}`;
  const [key] = useState(() => {
    try {
      const prior = window.sessionStorage.getItem(storageKey);
      if (prior && /^[A-Za-z0-9._:-]{8,200}$/.test(prior)) return prior;
    } catch {}
    return `revise-${crypto.randomUUID()}`;
  });
  const [state, action, pending] = useActionState(reviseQuoteAction, IDLE);
  useDone(state, onDone, () => {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {}
  });
  return (
    <Dialog open onClose={onClose} title={`Revise ${target.reference}?`} description={REVISE_NOTE}>
      <form
        action={action}
        onSubmit={() => {
          try {
            window.sessionStorage.setItem(storageKey, key);
          } catch {}
        }}
        className="flex flex-col gap-zw-md"
        data-testid="quote-revise-form"
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="quoteId" value={target.id} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <p className={cn(typography.bodySmall, "text-text-secondary")}>No prices change until you edit the new draft.</p>
        <ErrorBlock state={state} onReload={onReload} testid="quote-revise-error" />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={pending || state.stale === true} data-testid="quote-revise-confirm">
            Create revision draft
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Withdraw a SENT quote: a reason is required; the quote stays in the history with its prices. */
export function WithdrawSentDialog({
  organizationId,
  target,
  onClose,
  onDone,
  onReload,
}: {
  organizationId: string;
  target: LifecycleTarget;
  onClose: () => void;
  onDone: (message: string) => void;
  onReload: () => void;
}) {
  const [state, action, pending] = useActionState(withdrawSentQuoteAction, IDLE);
  const [reason, setReason] = useState("");
  useDone(state, onDone);
  return (
    <Dialog open onClose={onClose} title={`Withdraw sent ${target.reference}?`} description={WITHDRAW_SENT_NOTE}>
      <form action={action} className="flex flex-col gap-zw-md" data-testid="quote-withdraw-sent-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="quoteId" value={target.id} />
        <input type="hidden" name="expectedVersion" value={target.updatedAt} />
        <Textarea
          name="reason"
          label="Reason"
          required
          rows={2}
          maxLength={SENT_WITHDRAW_REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={state.reasonError}
          helpText="Kept with the quote for your team. Don't include medical details."
          disabled={pending}
          data-testid="quote-withdraw-sent-reason"
        />
        <ErrorBlock state={state} onReload={onReload} testid="quote-withdraw-sent-error" />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Keep it sent
          </Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending || state.stale === true || !reason.trim()} data-testid="quote-withdraw-sent-confirm">
            Withdraw sent quote
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
