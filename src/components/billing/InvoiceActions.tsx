"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { recordPaymentAction, reversePaymentAction, voidInvoiceAction, type BillingActionState } from "@/app/operations/billing/actions";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, centsToInput, formatCents } from "@/lib/billing/billing-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: BillingActionState = { status: "idle" };

interface Shared {
  organizationId: string;
  invoiceId: string;
  version: number;
}

/** Closes the dialog and refreshes the server page once an action succeeded. */
function useDone(state: BillingActionState, close: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    close();
  }, [state, router, close]);
}

function RecordPaymentDialog({ shared, balanceCents, today, onClose }: { shared: Shared; balanceCents: number; today: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(recordPaymentAction, IDLE);
  // one key per opened dialog: a double-click or a retry after a network error records the payment once
  const [key] = useState(() => `pay-${crypto.randomUUID()}`);
  useDone(state, onClose);
  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};
  return (
    <Dialog open onClose={onClose} title="Record a payment" description={`Balance due ${formatCents(balanceCents)}. Record money you already received; Nemryn doesn't charge cards.`}>
      <form action={action} className="flex flex-col gap-zw-md" data-testid="billing-payment-form">
        <input type="hidden" name="organizationId" value={shared.organizationId} />
        <input type="hidden" name="invoiceId" value={shared.invoiceId} />
        <input type="hidden" name="expectedVersion" value={shared.version} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <div className="grid gap-zw-md sm:grid-cols-2">
          <Input name="amount" label="Amount (USD)" inputMode="decimal" required defaultValue={centsToInput(balanceCents)} error={fe.amount} data-testid="billing-payment-amount" />
          <Input name="receivedOn" label="Received on" type="date" max={today} required defaultValue={today} error={fe.receivedOn} />
        </div>
        <Select name="method" label="Method" required options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} defaultValue="check" error={fe.method} data-testid="billing-payment-method" />
        <Input name="reference" label="Reference (optional)" maxLength={100} placeholder="Check number or transaction reference" helpText="Never enter a full card number." error={fe.reference} />
        <Textarea name="note" label="Note (optional)" rows={2} maxLength={500} error={fe.note} />
        {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="billing-payment-message">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending} disabled={pending} data-testid="billing-payment-submit">Record payment</Button>
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
      <form action={action} className="flex flex-col gap-zw-md" data-testid="billing-reverse-form">
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

function VoidDialog({ shared, onClose }: { shared: Shared; onClose: () => void }) {
  const [state, action, pending] = useActionState(voidInvoiceAction, IDLE);
  useDone(state, onClose);
  return (
    <Dialog open onClose={onClose} title="Void this invoice?" description="The invoice keeps its number and stays in your records as Void. Its trips can then be invoiced again.">
      <form action={action} className="flex flex-col gap-zw-md" data-testid="billing-void-form">
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

/** Issued-invoice actions: Record payment (while a balance is due) and Void (only when nothing is paid). */
export function IssuedInvoiceActions({ shared, balanceCents, paidCents, today }: { shared: Shared; balanceCents: number; paidCents: number; today: string }) {
  const [open, setOpen] = useState<"pay" | "void" | null>(null);
  const close = () => setOpen(null);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="billing-issued-actions">
      {balanceCents > 0 && (
        <Button type="button" onClick={() => setOpen("pay")} data-testid="billing-payment-open">
          Record payment
        </Button>
      )}
      {paidCents === 0 && (
        <Button type="button" variant="destructive-outline" onClick={() => setOpen("void")} data-testid="billing-void-open">
          Void
        </Button>
      )}
      {open === "pay" && <RecordPaymentDialog shared={shared} balanceCents={balanceCents} today={today} onClose={close} />}
      {open === "void" && <VoidDialog shared={shared} onClose={close} />}
    </div>
  );
}

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
