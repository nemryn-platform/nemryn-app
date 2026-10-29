"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  addReceiptEvidenceAction,
  allocateReceiptAction,
  recordReceiptAction,
  recordRefundAction,
  reverseReceiptAction,
  reverseRefundAction,
  type BillingActionState,
} from "@/app/operations/billing/actions";
import { keepValues, useDone } from "@/components/billing/InvoiceActions";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  PAYMENT_METHOD_LABELS,
  RECEIPT_METHODS,
  RECEIPT_PROVIDERS,
  REVERSAL_REASON_CODES,
  REVERSAL_REASON_LABELS,
  centsToInput,
  formatCents,
  formatIsoDate,
  invoiceNumberLabel,
  parseMoneyToCents,
  providerLabel,
  suggestAllocations,
} from "@/lib/billing/billing-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: BillingActionState = { status: "idle" };

export interface AllocatableInvoice {
  id: string;
  invoiceNumber: number | null;
  billToName: string;
  passengerName: string;
  issueDate: string | null;
  balanceCents: number;
  version: number;
  samePayer: boolean;
}

/**
 * Amounts to apply per invoice (ZD-269): the payer's own invoices first with an oldest-first suggestion; invoices of a
 * different / unverified payer are listed separately and need an explicit confirmation + reason (Organization Admin).
 * Never more than an invoice's balance or the money available; whatever isn't applied stays as payer credit.
 */
function AllocationEditor({ invoices, availableCents, onChange }: { invoices: AllocatableInvoice[]; availableCents: number; onChange: (v: { json: string; appliedCents: number; crossPayer: boolean; invalid: boolean }) => void }) {
  const initial = useMemo(() => {
    const s = suggestAllocations(availableCents, invoices.map((i) => ({ id: i.id, balanceCents: i.balanceCents, samePayer: i.samePayer })));
    return Object.fromEntries(invoices.map((i) => [i.id, centsToInput(s.allocations.find((a) => a.id === i.id)?.cents ?? 0)]));
  }, [invoices, availableCents]);
  const [amounts, setAmounts] = useState<Record<string, string>>(initial);
  const [showOthers, setShowOthers] = useState(false);
  const recompute = (next: Record<string, string>) => {
    let applied = 0;
    let invalid = false;
    let cross = false;
    const rows: { invoiceId: string; cents: number; version: number }[] = [];
    for (const inv of invoices) {
      const p = parseMoneyToCents(next[inv.id] ?? "");
      if (!p.ok || p.cents > inv.balanceCents) invalid = true;
      else if (p.cents > 0) {
        rows.push({ invoiceId: inv.id, cents: p.cents, version: inv.version });
        applied += p.cents;
        if (!inv.samePayer) cross = true;
      }
    }
    if (applied > availableCents) invalid = true;
    onChange({ json: JSON.stringify(rows), appliedCents: applied, crossPayer: cross, invalid });
  };
  const set = (id: string, v: string) => {
    const next = { ...amounts, [id]: v };
    setAmounts(next);
    recompute(next);
  };
  // report the initial (suggested) amounts once, so what is submitted always equals what is shown
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => recompute(initial), []);
  const own = invoices.filter((i) => i.samePayer);
  const others = invoices.filter((i) => !i.samePayer);
  const row = (inv: AllocatableInvoice) => {
    const p = parseMoneyToCents(amounts[inv.id] ?? "");
    const tooMuch = p.ok && p.cents > inv.balanceCents;
    return (
      <li key={inv.id} className="grid items-end gap-2 py-2 sm:grid-cols-[1fr_10rem]" data-testid="billing-allocation-row" data-same-payer={inv.samePayer ? "true" : "false"}>
        <div className="min-w-0">
          <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
            {invoiceNumberLabel(inv.invoiceNumber)} · {inv.billToName}
          </p>
          <p className={cn(typography.metadata, "text-text-muted")}>
            Issued {formatIsoDate(inv.issueDate)} · for {inv.passengerName} · balance {formatCents(inv.balanceCents)}
          </p>
        </div>
        <Input
          label={`Apply to ${invoiceNumberLabel(inv.invoiceNumber)} (USD)`}
          inputMode="decimal"
          value={amounts[inv.id] ?? ""}
          onChange={(e) => set(inv.id, e.target.value)}
          error={!p.ok ? p.error : tooMuch ? "More than the balance." : undefined}
          data-testid="billing-allocation-amount"
        />
      </li>
    );
  };
  return (
    <fieldset className="flex flex-col gap-2" data-testid="billing-allocation-editor">
      <legend className={cn(typography.label, "mb-1 text-text-primary")}>Apply to invoices</legend>
      {own.length === 0 ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>This payer has no open invoices. The money will be kept as payer credit.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">{own.map(row)}</ul>
      )}
      {others.length > 0 && (
        <div className="flex flex-col gap-2 pt-2">
          <Checkbox
            label="Show invoices of other or unverified payers"
            description="Applying money to them needs your confirmation and a reason; it's recorded in the history."
            checked={showOthers}
            onChange={(e) => setShowOthers(e.target.checked)}
            data-testid="billing-allocation-show-others"
          />
          {showOthers && <ul className="divide-y divide-border-subtle">{others.map(row)}</ul>}
        </div>
      )}
    </fieldset>
  );
}

const METHOD_OPTIONS = RECEIPT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));
const PROVIDER_OPTIONS = [{ value: "", label: "None" }, ...RECEIPT_PROVIDERS.map((p) => ({ value: p, label: providerLabel(p) ?? p }))];

function CrossPayerConfirm({ fe }: { fe: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-zw-md" data-testid="billing-cross-payer">
      <p className={cn(typography.bodySmall, "text-text-primary")}>
        Some of this money goes to an invoice of a different or unverified payer. Payers are never matched by name; confirm this is intended.
      </p>
      <Textarea name="differentPayerReason" label="Reason" required rows={2} maxLength={500} error={fe.differentPayerReason} data-testid="billing-cross-payer-reason" />
    </div>
  );
}

/** Apply a payment's unapplied money (payer credit) to one or more invoices. */
export function ApplyCreditButton({ organizationId, receiptId, availableCents, invoices }: { organizationId: string; receiptId: string; availableCents: number; invoices: AllocatableInvoice[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} disabled={availableCents <= 0 || invoices.length === 0} data-testid="billing-receipt-apply-open">
        Apply credit
      </Button>
      {open && <ApplyCreditDialog organizationId={organizationId} receiptId={receiptId} availableCents={availableCents} invoices={invoices} onClose={() => setOpen(false)} />}
    </>
  );
}
function ApplyCreditDialog({ organizationId, receiptId, availableCents, invoices, onClose }: { organizationId: string; receiptId: string; availableCents: number; invoices: AllocatableInvoice[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(allocateReceiptAction, IDLE);
  const [key] = useState(() => `alc-${crypto.randomUUID()}`);
  const [alloc, setAlloc] = useState(() => {
    const s = suggestAllocations(availableCents, invoices);
    return { json: JSON.stringify(s.allocations.map((a) => ({ invoiceId: a.id, cents: a.cents, version: invoices.find((i) => i.id === a.id)?.version }))), appliedCents: availableCents - s.creditCents, crossPayer: false, invalid: false };
  });
  useDone(state, onClose);
  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};
  return (
    <Dialog open onClose={onClose} title="Apply payer credit" description={`${formatCents(availableCents)} available. Whatever you don't apply stays as payer credit.`}>
      <form onSubmit={keepValues(action)} className="flex flex-col gap-zw-md" data-testid="billing-receipt-apply-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="receiptId" value={receiptId} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <input type="hidden" name="allocations" value={alloc.json} />
        <AllocationEditor invoices={invoices} availableCents={availableCents} onChange={setAlloc} />
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="billing-allocation-summary">
          Applying {formatCents(alloc.appliedCents)} · credit left {formatCents(Math.max(0, availableCents - alloc.appliedCents))}
        </p>
        {alloc.crossPayer && <CrossPayerConfirm fe={fe} />}
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="billing-receipt-apply-message">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending} disabled={pending || alloc.invalid || alloc.appliedCents <= 0} data-testid="billing-receipt-apply-submit">Apply credit</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** SENSITIVE (Organization Admin): record a refund made from unapplied money. */
export function RefundButton({ organizationId, receiptId, refundableCents, today, receivedOn }: { organizationId: string; receiptId: string; refundableCents: number; today: string; receivedOn: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={refundableCents <= 0} data-testid="billing-refund-open">
        Record refund
      </Button>
      {open && <RefundDialog organizationId={organizationId} receiptId={receiptId} refundableCents={refundableCents} today={today} receivedOn={receivedOn} onClose={() => setOpen(false)} />}
    </>
  );
}
function RefundDialog({ organizationId, receiptId, refundableCents, today, receivedOn, onClose }: { organizationId: string; receiptId: string; refundableCents: number; today: string; receivedOn: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(recordRefundAction, IDLE);
  const [key] = useState(() => `ref-${crypto.randomUUID()}`);
  useDone(state, onClose);
  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};
  return (
    <Dialog open onClose={onClose} title="Record a refund" description={`Up to ${formatCents(refundableCents)} can be refunded: money of this payment that isn't applied to an invoice.`}>
      <form onSubmit={keepValues(action)} className="flex flex-col gap-zw-md" data-testid="billing-refund-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="receiptId" value={receiptId} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <AttentionState
          level="info"
          title="This records a refund you made"
          description="Nemryn doesn't send money. Record the refund after you returned it; it stays 'Recorded by staff' until a provider or bank statement confirms it."
        />
        <div className="grid gap-zw-md sm:grid-cols-2">
          <Input name="amount" label="Amount refunded (USD)" inputMode="decimal" required defaultValue={centsToInput(refundableCents)} error={fe.amount} data-testid="billing-refund-amount" />
          <Input name="refundedOn" label="Refunded on" type="date" min={receivedOn} max={today} required defaultValue={today} error={fe.refundedOn} />
        </div>
        <div className="grid gap-zw-md sm:grid-cols-2">
          <Select name="method" label="How it was returned" required options={METHOD_OPTIONS} defaultValue="check" error={fe.method} />
          <Select name="provider" label="Provider (optional)" options={PROVIDER_OPTIONS} defaultValue="" error={fe.provider} />
        </div>
        <Input name="reference" label="Reference (optional)" maxLength={100} helpText="Never enter a full card number." error={fe.reference} />
        <Textarea name="reason" label="Reason" required rows={2} maxLength={500} error={fe.reason} data-testid="billing-refund-reason" />
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="billing-refund-message">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending} disabled={pending} data-testid="billing-refund-submit">Record refund</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A dialog that only needs a reason (refund correction). */
export function ReverseRefundButton({ organizationId, receiptId, refundId, label }: { organizationId: string; receiptId: string; refundId: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="text" size="sm" onClick={() => setOpen(true)} data-testid="billing-refund-reverse-open">
        Correct
      </Button>
      {open && <ReverseRefundDialog organizationId={organizationId} receiptId={receiptId} refundId={refundId} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}
function ReverseRefundDialog({ organizationId, receiptId, refundId, label, onClose }: { organizationId: string; receiptId: string; refundId: string; label: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(reverseRefundAction, IDLE);
  const [key] = useState(() => `rrv-${crypto.randomUUID()}`);
  useDone(state, onClose);
  return (
    <Dialog open onClose={onClose} title="Correct this refund?" description={label}>
      <form onSubmit={keepValues(action)} className="flex flex-col gap-zw-md" data-testid="billing-refund-reverse-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="receiptId" value={receiptId} />
        <input type="hidden" name="refundId" value={refundId} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <AttentionState level="warning" title="Use this only when the refund was recorded by mistake" description="The amount becomes payer credit again. The original refund entry stays in the history." />
        <Textarea name="reason" label="Reason" required rows={2} maxLength={500} error={state.status === "error" ? state.fieldErrors?.reason : undefined} data-testid="billing-refund-reverse-reason" />
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending} data-testid="billing-refund-reverse-submit">Correct refund</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** SENSITIVE (Organization Admin): the payment was entered by mistake / a returned check / a duplicate. */
export function ReverseReceiptButton({ organizationId, receiptId, disabledReason }: { organizationId: string; receiptId: string; disabledReason: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="destructive-outline" onClick={() => setOpen(true)} disabled={disabledReason !== null} title={disabledReason ?? undefined} data-testid="billing-receipt-reverse-open">
        Reverse payment
      </Button>
      {open && <ReverseReceiptDialog organizationId={organizationId} receiptId={receiptId} onClose={() => setOpen(false)} />}
    </>
  );
}
function ReverseReceiptDialog({ organizationId, receiptId, onClose }: { organizationId: string; receiptId: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(reverseReceiptAction, IDLE);
  const [key] = useState(() => `rvr-${crypto.randomUUID()}`);
  useDone(state, onClose);
  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};
  return (
    <Dialog open onClose={onClose} title="Reverse this payment?" description="For a payment entered by mistake, a returned check or a duplicate. It keeps its number and stays in the history as Reversed; it is not a refund.">
      <form onSubmit={keepValues(action)} className="flex flex-col gap-zw-md" data-testid="billing-receipt-reverse-form">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="receiptId" value={receiptId} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <RadioGroup name="reasonCode" legend="Why" options={REVERSAL_REASON_CODES.map((c) => ({ value: c, label: REVERSAL_REASON_LABELS[c] }))} defaultValue="entry_error" error={fe.reasonCode} />
        <Textarea name="reason" label="Details" required rows={2} maxLength={500} error={fe.reason} data-testid="billing-receipt-reverse-reason" />
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="billing-receipt-reverse-message">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending} data-testid="billing-receipt-reverse-submit">Reverse payment</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Staff evidence only -- never provider confirmation. */
export function AddEvidenceButton({ organizationId, receiptId }: { organizationId: string; receiptId: string }) {
  const [state, action, pending] = useActionState(addReceiptEvidenceAction, IDLE);
  return (
    <form onSubmit={keepValues(action)} className="flex flex-wrap items-center gap-2" data-testid="billing-evidence-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="receiptId" value={receiptId} />
      <input type="hidden" name="kind" value="evidence_document_held" />
      <Button type="submit" variant="outline" size="sm" loading={pending} disabled={pending} data-testid="billing-evidence-submit">
        I have the document
      </Button>
      {state.status !== "idle" && state.message && (
        <span role={state.status === "error" ? "alert" : "status"} className={cn(typography.metadata, state.status === "error" ? "text-critical-text" : "text-text-secondary")}>
          {state.message}
        </span>
      )}
    </form>
  );
}

export interface PayerOption {
  value: string;
  label: string;
}
/**
 * Record payment received (not tied to one invoice): payer = a party with an organization-scoped identity (from open
 * invoices) or "someone else" (typed name, unverified); apply to that payer's invoices; the rest is payer credit.
 */
export function RecordReceiptForm({ organizationId, idempotencyKey, today, payers, payer, invoices }: { organizationId: string; idempotencyKey: string; today: string; payers: PayerOption[]; payer: string; invoices: AllocatableInvoice[] }) {
  const [state, action, pending] = useActionState(recordReceiptAction, IDLE);
  const [amount, setAmount] = useState("");
  const parsed = parseMoneyToCents(amount);
  const available = parsed.ok ? parsed.cents : 0;
  const [alloc, setAlloc] = useState({ json: "[]", appliedCents: 0, crossPayer: false, invalid: false });
  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};
  return (
    <form onSubmit={keepValues(action)} className="flex flex-col gap-zw-lg" data-testid="billing-receipt-new-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="payer" value={payer} />
      <input type="hidden" name="allocations" value={alloc.json} />
      <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="billing-receipt-new-payer">
        Paid by: <span className="font-medium text-text-primary">{payers.find((p) => p.value === payer)?.label ?? "Someone else"}</span>
      </p>
      {payer === "other" && (
        <Input name="payerName" label="Who paid" required maxLength={200} error={fe.payerName} helpText="A typed name isn't a verified payer: its credit is never matched to other invoices by name." data-testid="billing-receipt-new-payer-name" />
      )}
      <div className="flex flex-col gap-zw-md">
        <div className="grid gap-zw-md sm:grid-cols-2">
          <Input name="amount" label="Amount received (USD)" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} error={fe.amount} data-testid="billing-receipt-new-amount" />
          <Input name="receivedOn" label="Received on" type="date" max={today} required defaultValue={today} error={fe.receivedOn} />
        </div>
        <ReceiptExtraFields fe={fe} />
      </div>
      {available > 0 && (
        <AllocationEditor key={`${payer}-${available}`} invoices={invoices} availableCents={available} onChange={setAlloc} />
      )}
      {fe.allocations && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>{fe.allocations}</p>}
      {available > 0 && (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="billing-receipt-new-summary">
          Applying {formatCents(alloc.appliedCents)} · kept as payer credit {formatCents(Math.max(0, available - alloc.appliedCents))}
        </p>
      )}
      {alloc.crossPayer && <CrossPayerConfirm fe={fe} />}
      {state.status === "error" && state.rule === "possible_duplicate" && (
        <Checkbox name="confirmDuplicate" label="I checked: this is a separate payment, not a duplicate" data-testid="billing-receipt-new-confirm-duplicate" />
      )}
      {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="billing-receipt-new-message">{state.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="submit" loading={pending} disabled={pending || alloc.invalid} data-testid="billing-receipt-new-submit">
          Record payment
        </Button>
      </div>
    </form>
  );
}

/** Method, provider, reference, fee, note, document -- the receipt fields other than amount / date. */
function ReceiptExtraFields({ fe }: { fe: Record<string, string> }) {
  return (
    <>
      <div className="grid gap-zw-md sm:grid-cols-2">
        <Select name="method" label="Method" required options={METHOD_OPTIONS} defaultValue="check" error={fe.method} />
        <Select name="provider" label="Provider (optional)" options={PROVIDER_OPTIONS} defaultValue="" error={fe.provider} helpText="Where the money came through, if any." />
      </div>
      <Input name="reference" label="Reference (optional)" maxLength={100} placeholder="Check number or transaction reference" helpText="Evidence you keep. Never enter a full card number." error={fe.reference} />
      <Input name="fee" label="Processing fee (optional)" inputMode="decimal" helpText="Your cost, for example a card processing fee. It is not charged to the customer." error={fe.fee} />
      <Textarea name="note" label="Note (optional)" rows={2} maxLength={500} error={fe.note} />
      <Checkbox name="documentHeld" label="I have the check, slip or remittance" description="Recorded as evidence. It isn't confirmation from a provider or your bank." />
    </>
  );
}

