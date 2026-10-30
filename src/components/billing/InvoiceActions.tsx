"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  allocateReceiptAction,
  recordPaymentAction,
  reversePaymentAction,
  unapplyAllocationAction,
  voidInvoiceAction,
  type BillingActionState,
} from "@/app/operations/billing/actions";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  PAYMENT_METHOD_LABELS,
  RECEIPT_METHODS,
  RECEIPT_PROVIDERS,
  centsToInput,
  formatCents,
  formatIsoDate,
  parseMoneyToCents,
  providerLabel,
  receiptNumberLabel,
} from "@/lib/billing/billing-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: BillingActionState = { status: "idle" };

interface Shared {
  organizationId: string;
  invoiceId: string;
  version: number;
}

/**
 * Submit handler that dispatches the server action by hand: a React 19 <form action> resets every field after each
 * submit -- including a refused one -- so a corrected retry would lose what the person typed (same fix as NP-PILOT-P1).
 */
export const keepValues = (action: (fd: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  startTransition(() => action(fd));
};

/** Closes the dialog and refreshes the server page once an action succeeded. */
export function useDone(state: BillingActionState, close: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    close();
  }, [state, router, close]);
}

const METHOD_OPTIONS = RECEIPT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));
const PROVIDER_OPTIONS = [{ value: "", label: "None" }, ...RECEIPT_PROVIDERS.map((p) => ({ value: p, label: providerLabel(p) ?? p }))];

/**
 * The fields of money received (shared by "Record payment" on an invoice and "Record payment received"). The processing
 * fee is the agency's own cost (ZD / OD-5) -- never charged to the customer and never reducing what the customer paid.
 */
export function MoneyReceivedFields({ fe, today, defaultAmount, amountTestId }: { fe: Record<string, string>; today: string; defaultAmount: string; amountTestId: string }) {
  return (
    <>
      <div className="grid gap-zw-md sm:grid-cols-2">
        <Input name="amount" label="Amount received (USD)" inputMode="decimal" required defaultValue={defaultAmount} error={fe.amount} data-testid={amountTestId} />
        <Input name="receivedOn" label="Received on" type="date" max={today} required defaultValue={today} error={fe.receivedOn} />
      </div>
      <div className="grid gap-zw-md sm:grid-cols-2">
        <Select name="method" label="Method" required options={METHOD_OPTIONS} defaultValue="check" error={fe.method} data-testid="billing-payment-method" />
        <Select name="provider" label="Provider (optional)" options={PROVIDER_OPTIONS} defaultValue="" error={fe.provider} helpText="Where the money came through, if any." />
      </div>
      <Input
        name="reference"
        label="Reference (optional)"
        maxLength={100}
        placeholder="Check number or transaction reference"
        helpText="Evidence you keep. Never enter a full card number."
        error={fe.reference}
        data-testid="billing-payment-reference"
      />
      <Input
        name="fee"
        label="Processing fee (optional)"
        inputMode="decimal"
        defaultValue=""
        helpText="Your cost, for example a card processing fee. It is not charged to the customer and doesn't reduce what they paid."
        error={fe.fee}
        data-testid="billing-payment-fee"
      />
      <Textarea name="note" label="Note (optional)" rows={2} maxLength={500} error={fe.note} />
      <Checkbox name="documentHeld" label="I have the check, slip or remittance" description="Recorded as evidence. It isn't confirmation from a provider or your bank." />
    </>
  );
}

function RecordPaymentDialog({ shared, balanceCents, today, onClose }: { shared: Shared; balanceCents: number; today: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(recordPaymentAction, IDLE);
  // one key per opened dialog: a double-click or a retry after a network error records the payment once
  const [key] = useState(() => `pay-${crypto.randomUUID()}`);
  useDone(state, onClose);
  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};
  return (
    <Dialog open onClose={onClose} title="Record a payment" description={`Balance due ${formatCents(balanceCents)}. Record money you already received; Nemryn doesn't charge cards.`}>
      <form onSubmit={keepValues(action)} className="flex flex-col gap-zw-md" data-testid="billing-payment-form">
        <input type="hidden" name="organizationId" value={shared.organizationId} />
        <input type="hidden" name="invoiceId" value={shared.invoiceId} />
        <input type="hidden" name="expectedVersion" value={shared.version} />
        <input type="hidden" name="balanceCents" value={balanceCents} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <MoneyReceivedFields fe={fe} today={today} defaultAmount={centsToInput(balanceCents)} amountTestId="billing-payment-amount" />
        <Checkbox
          name="keepExtraAsCredit"
          label="If this is more than the balance, keep the extra as payer credit"
          description="Otherwise a payment above the balance is refused. Credit can be applied to this payer's other invoices or refunded later."
          data-testid="billing-payment-keep-credit"
        />
        {state.status === "error" && state.rule === "possible_duplicate" && (
          <Checkbox name="confirmDuplicate" label="I checked: this is a separate payment, not a duplicate" data-testid="billing-payment-confirm-duplicate" />
        )}
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="billing-payment-message">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending} disabled={pending} data-testid="billing-payment-submit">Record payment</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ApplyCreditDialog({ shared, balanceCents, sources, onClose }: { shared: Shared; balanceCents: number; sources: CreditSource[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(allocateReceiptAction, IDLE);
  const [key] = useState(() => `alc-${crypto.randomUUID()}`);
  const [receiptId, setReceiptId] = useState(sources[0]?.receiptId ?? "");
  const src = sources.find((x) => x.receiptId === receiptId);
  const [amount, setAmount] = useState(centsToInput(Math.min(src?.unallocatedCents ?? 0, balanceCents)));
  useDone(state, onClose);
  const parsed = parseMoneyToCents(amount);
  const cents = parsed.ok ? parsed.cents : 0;
  const allocations = JSON.stringify(cents > 0 ? [{ invoiceId: shared.invoiceId, cents, version: shared.version }] : []);
  return (
    <Dialog open onClose={onClose} title="Apply payer credit" description={`Balance due ${formatCents(balanceCents)}. Uses money this payer already paid that isn't applied to an invoice.`}>
      <form onSubmit={keepValues(action)} className="flex flex-col gap-zw-md" data-testid="billing-apply-credit-form">
        <input type="hidden" name="organizationId" value={shared.organizationId} />
        <input type="hidden" name="receiptId" value={receiptId} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <input type="hidden" name="allocations" value={allocations} />
        <Select
          name="source"
          label="Credit from"
          options={sources.map((x) => ({ value: x.receiptId, label: `${receiptNumberLabel(x.receiptNumber)} · ${formatIsoDate(x.receivedOn)} · ${formatCents(x.unallocatedCents)} available` }))}
          value={receiptId}
          onChange={(e) => {
            setReceiptId(e.target.value);
            const next = sources.find((x) => x.receiptId === e.target.value);
            setAmount(centsToInput(Math.min(next?.unallocatedCents ?? 0, balanceCents)));
          }}
          data-testid="billing-apply-credit-source"
        />
        <Input name="amountView" label="Amount to apply (USD)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={state.status === "error" ? state.fieldErrors?.allocations : undefined} data-testid="billing-apply-credit-amount" />
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="billing-apply-credit-message">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending} disabled={pending || cents <= 0} data-testid="billing-apply-credit-submit">Apply credit</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReverseDialog({ shared, payment, onClose }: { shared: Shared; payment: { id: string; label: string }; onClose: () => void }) {
  const [state, action, pending] = useActionState(reversePaymentAction, IDLE);
  const [key] = useState(() => `rev-${crypto.randomUUID()}`);
  useDone(state, onClose);
  return (
    <Dialog open onClose={onClose} title="Reverse this payment?" description={payment.label}>
      <form onSubmit={keepValues(action)} className="flex flex-col gap-zw-md" data-testid="billing-reverse-form">
        <input type="hidden" name="organizationId" value={shared.organizationId} />
        <input type="hidden" name="invoiceId" value={shared.invoiceId} />
        <input type="hidden" name="paymentId" value={payment.id} />
        <input type="hidden" name="expectedVersion" value={shared.version} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <AttentionState
          level="warning"
          title="This corrects the record only"
          description="Use it when a payment was entered by mistake or didn't go through (for example a bounced check). It doesn't send or prove a refund. The original entry stays in the history."
        />
        <Textarea name="reason" label="Reason" required rows={2} maxLength={500} error={state.status === "error" ? state.fieldErrors?.reason : undefined} data-testid="billing-reverse-reason" />
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending} data-testid="billing-reverse-submit">Reverse payment</Button>
        </div>
      </form>
    </Dialog>
  );
}

function UnapplyDialog({ shared, payment, onClose }: { shared: Shared; payment: { id: string; label: string }; onClose: () => void }) {
  const [state, action, pending] = useActionState(unapplyAllocationAction, IDLE);
  const [key] = useState(() => `unap-${crypto.randomUUID()}`);
  useDone(state, onClose);
  return (
    <Dialog open onClose={onClose} title="Remove this payment from the invoice?" description={payment.label}>
      <form onSubmit={keepValues(action)} className="flex flex-col gap-zw-md" data-testid="billing-unapply-form">
        <input type="hidden" name="organizationId" value={shared.organizationId} />
        <input type="hidden" name="invoiceId" value={shared.invoiceId} />
        <input type="hidden" name="allocationId" value={payment.id} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <AttentionState
          level="warning"
          title="The money stays with the payer as credit"
          description="The invoice balance reopens. Nothing is refunded: you can apply the credit to another invoice or record a refund from the payment's page. The original entry stays in the history."
        />
        <Textarea name="reason" label="Reason" required rows={2} maxLength={500} error={state.status === "error" ? state.fieldErrors?.reason : undefined} data-testid="billing-unapply-reason" />
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending} data-testid="billing-unapply-submit">Remove from invoice</Button>
        </div>
      </form>
    </Dialog>
  );
}

function VoidDialog({ shared, onClose }: { shared: Shared; onClose: () => void }) {
  const [state, action, pending] = useActionState(voidInvoiceAction, IDLE);
  useDone(state, onClose);
  return (
    <Dialog open onClose={onClose} title="Void this invoice?" description="The invoice keeps its number and stays in your records as Void. Its trips can then be invoiced again.">
      <form onSubmit={keepValues(action)} className="flex flex-col gap-zw-md" data-testid="billing-void-form">
        <input type="hidden" name="organizationId" value={shared.organizationId} />
        <input type="hidden" name="invoiceId" value={shared.invoiceId} />
        <input type="hidden" name="expectedVersion" value={shared.version} />
        <Textarea name="reason" label="Reason" required rows={2} maxLength={500} error={state.status === "error" ? state.fieldErrors?.reason : undefined} data-testid="billing-void-reason" />
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="billing-void-message">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={pending} data-testid="billing-void-submit">Void invoice</Button>
        </div>
      </form>
    </Dialog>
  );
}

export interface CreditSource {
  receiptId: string;
  receiptNumber: number;
  receivedOn: string;
  unallocatedCents: number;
}

/** Issued-invoice actions: Record payment and Apply payer credit (while a balance is due) and Void (only when nothing is paid). */
export function IssuedInvoiceActions({ shared, balanceCents, paidCents, today, creditSources = [] }: { shared: Shared; balanceCents: number; paidCents: number; today: string; creditSources?: CreditSource[] }) {
  const [open, setOpen] = useState<"pay" | "credit" | "void" | null>(null);
  const close = () => setOpen(null);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="billing-issued-actions">
      {balanceCents > 0 && (
        <Button type="button" onClick={() => setOpen("pay")} data-testid="billing-payment-open">
          Record payment
        </Button>
      )}
      {balanceCents > 0 && creditSources.length > 0 && (
        <Button type="button" variant="outline" onClick={() => setOpen("credit")} data-testid="billing-apply-credit-open">
          Apply payer credit
        </Button>
      )}
      {paidCents === 0 && (
        <Button type="button" variant="destructive-outline" onClick={() => setOpen("void")} data-testid="billing-void-open">
          Void
        </Button>
      )}
      {open === "pay" && <RecordPaymentDialog shared={shared} balanceCents={balanceCents} today={today} onClose={close} />}
      {open === "credit" && <ApplyCreditDialog shared={shared} balanceCents={balanceCents} sources={creditSources} onClose={close} />}
      {open === "void" && <VoidDialog shared={shared} onClose={close} />}
    </div>
  );
}

/** Reverse a simple whole-receipt payment (entered by mistake / bounced) -- NP-BILL-P1 compatibility path. */
export function ReversePaymentButton({ shared, payment }: { shared: Shared; payment: { id: string; label: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="text" size="sm" onClick={() => setOpen(true)} data-testid="billing-reverse-open">
        Reverse
      </Button>
      {open && <ReverseDialog shared={shared} payment={payment} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Remove a payment from this invoice (SENSITIVE, Organization Admin); the money becomes payer credit. */
export function UnapplyPaymentButton({ shared, payment }: { shared: Shared; payment: { id: string; label: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="text" size="sm" onClick={() => setOpen(true)} data-testid="billing-unapply-open">
        Remove from invoice
      </Button>
      {open && <UnapplyDialog shared={shared} payment={payment} onClose={() => setOpen(false)} />}
    </>
  );
}
