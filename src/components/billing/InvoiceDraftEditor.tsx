"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash } from "@phosphor-icons/react/dist/ssr";
import { discardInvoiceDraftAction, issueInvoiceAction, updateInvoiceDraftAction, type BillingActionState } from "@/app/operations/billing/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { DEFAULT_TERMS_DAYS, addDays, formatCents, lineAmountCents, parseMoneyToCents, parseQuantity, previewTotals } from "@/lib/billing/billing-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: BillingActionState = { status: "idle" };

export interface DraftLine {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  tripId: string | null;
  source: string;
}

function amountOf(l: DraftLine): number | null {
  const q = parseQuantity(l.quantity);
  const u = parseMoneyToCents(l.unitPrice);
  return q.ok && u.ok ? lineAmountCents(q.hundredths, u.cents) : null;
}

/**
 * Draft invoice editor (NP-BILL-P1): bill-to contact text, itemised charges (quantity x price), discount and terms.
 * Live totals are a preview with the database's own rounding; the server recomputes them and is authoritative. Quote
 * lines (R3) arrive here pre-filled and stay editable until the invoice is issued.
 */
export function InvoiceDraftEditor({
  organizationId,
  invoiceId,
  version,
  billTo,
  lines: initialLines,
  discount,
  terms,
  tripOptions,
}: {
  organizationId: string;
  invoiceId: string;
  version: number;
  billTo: { name: string; address: string; email: string; phone: string };
  lines: DraftLine[];
  discount: string;
  terms: string;
  tripOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(updateInvoiceDraftAction, IDLE);
  const [lines, setLines] = useState<DraftLine[]>(initialLines);
  const [discountText, setDiscountText] = useState(discount);
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);

  const amounts = lines.map(amountOf);
  const d = parseMoneyToCents(discountText);
  const totals = previewTotals(amounts.map((a) => ({ amountCents: a ?? 0 })), d.ok ? d.cents : 0);
  const update = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};

  return (
    <form action={action} className="flex flex-col gap-zw-lg" data-testid="billing-draft-editor">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ description, quantity, unitPrice, tripId, source }) => ({ description, quantity, unitPrice, tripId, source })))} />

      <fieldset className="grid gap-zw-md md:grid-cols-2" disabled={pending}>
        <legend className={cn(typography.subsectionHeading, "mb-2 text-text-primary")}>Bill to</legend>
        <Input name="billToName" label="Name" required maxLength={200} defaultValue={billTo.name} error={fe.billToName} />
        <Input name="billToPhone" label="Phone (optional)" maxLength={40} defaultValue={billTo.phone} error={fe.billToPhone} />
        <Input name="billToEmail" label="Email (optional)" type="email" maxLength={254} defaultValue={billTo.email} error={fe.billToEmail} />
        <Textarea name="billToAddress" label="Billing address (optional)" rows={2} maxLength={500} defaultValue={billTo.address} error={fe.billToAddress} />
      </fieldset>

      <div className="flex flex-col gap-2" data-testid="billing-draft-lines">
        <p className={cn(typography.subsectionHeading, "text-text-primary")}>Charges</p>
        {lines.length === 0 && <p className={cn(typography.bodySmall, "text-text-secondary")}>No charges yet. Add one below.</p>}
        {lines.map((l, i) => (
          <div key={l.key} className="grid grid-cols-1 gap-2 rounded-md border border-border-subtle p-3 md:grid-cols-[minmax(0,1fr)_7rem_9rem_7rem_auto] md:items-end" data-testid="billing-draft-line">
            <Input label="Description" value={l.description} onChange={(e) => update(i, { description: e.target.value })} maxLength={300} error={fe[`line-${i}`]} />
            <Input label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
            <Input label="Price (USD)" inputMode="decimal" value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} data-testid="billing-line-price" />
            <div className="flex flex-col gap-1">
              <span className={cn(typography.label, "text-text-secondary")}>Amount</span>
              <span className="h-10 py-2 tabular-nums" data-testid="billing-line-amount">{amounts[i] === null ? "—" : formatCents(amounts[i] as number)}</span>
            </div>
            <IconButton type="button" label={`Remove charge ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} icon={<Trash className="size-4" />} />
            {(l.tripId || l.source === "quote") && (
              <p className={cn(typography.metadata, "text-text-muted md:col-span-5")}>
                {l.source === "quote" ? "From the quote · " : ""}
                {tripOptions.find((t) => t.id === l.tripId)?.label ?? ""}
              </p>
            )}
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            leadingIcon={<Plus className="size-4" />}
            onClick={() => setLines((ls) => [...ls, { key: `new-${Date.now()}-${ls.length}`, description: "", quantity: "1", unitPrice: "", tripId: null, source: "manual" }])}
            data-testid="billing-add-line"
          >
            Add charge
          </Button>
        </div>
      </div>

      <div className="grid gap-zw-md md:grid-cols-2">
        <Input name="discount" label="Discount (USD, optional)" inputMode="decimal" value={discountText} onChange={(e) => setDiscountText(e.target.value)} error={fe.discount ?? (totals.discountTooHigh ? "The discount can't be more than the subtotal." : undefined)} />
        <Textarea name="terms" label="Terms or note on the invoice (optional)" rows={2} maxLength={1000} defaultValue={terms} error={fe.terms} />
      </div>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-sm" data-testid="billing-draft-totals">
        <dt className="text-text-secondary">Subtotal</dt>
        <dd className="text-right tabular-nums">{formatCents(totals.subtotal)}</dd>
        <dt className="text-text-secondary">Discount</dt>
        <dd className="text-right tabular-nums">−{formatCents(totals.discount)}</dd>
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold tabular-nums" data-testid="billing-draft-total">{formatCents(totals.total)}</dd>
      </dl>

      {state.status !== "idle" && state.message && (
        <p role={state.status === "error" ? "alert" : "status"} className={cn(typography.bodySmall, state.status === "error" ? "text-critical-text" : "text-text-secondary")} data-testid="billing-draft-message">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending} disabled={pending} data-testid="billing-draft-save">
          Save draft
        </Button>
      </div>
    </form>
  );
}

/** Issue a saved draft: dates, then a confirmation (issued invoices are frozen). */
export function IssueInvoicePanel({ organizationId, invoiceId, version, today, canIssue }: { organizationId: string; invoiceId: string; version: number; today: string; canIssue: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(issueInvoiceAction, IDLE);
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDays(today, DEFAULT_TERMS_DAYS));
  const [confirm, setConfirm] = useState(false);
  const formId = `issue-${invoiceId}`;
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  return (
    <form id={formId} action={action} className="flex flex-col gap-zw-md" data-testid="billing-issue-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <div className="grid gap-zw-md sm:grid-cols-2">
        <Input name="issueDate" label="Issue date" type="date" max={today} value={issueDate} onChange={(e) => { setIssueDate(e.target.value); setDueDate(addDays(e.target.value, DEFAULT_TERMS_DAYS)); }} required />
        <Input name="dueDate" label="Due date" type="date" min={issueDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} required helpText={`Default: ${DEFAULT_TERMS_DAYS} days after the issue date.`} />
      </div>
      {!canIssue && <p className={cn(typography.bodySmall, "text-text-secondary")}>Save the draft with at least one charge and a total above $0.00 to issue it.</p>}
      {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="billing-issue-message">{state.message}</p>}
      <div>
        <Button type="button" onClick={() => setConfirm(true)} disabled={!canIssue || pending} loading={pending} data-testid="billing-issue-open">
          Issue invoice
        </Button>
      </div>
      {confirm && (
        <Dialog open onClose={() => setConfirm(false)} title="Issue this invoice?" description="It gets the next invoice number and can no longer be edited. If something is wrong later, void it (with a reason) and create a new one.">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button type="submit" form={formId} onClick={() => setConfirm(false)} data-testid="billing-issue-confirm">Issue invoice</Button>
          </div>
        </Dialog>
      )}
    </form>
  );
}

export function DiscardDraftButton({ organizationId, invoiceId, version }: { organizationId: string; invoiceId: string; version: number }) {
  const [state, action, pending] = useActionState(discardInvoiceDraftAction, IDLE);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="destructive-outline" size="sm" onClick={() => setOpen(true)} data-testid="billing-discard-open">
        Discard draft
      </Button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title="Discard this draft?" description="The draft is deleted and its trips become ready to invoice again. Drafts have no invoice number, so nothing is skipped.">
          <form action={action} className="flex flex-col gap-zw-md">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <input type="hidden" name="expectedVersion" value={version} />
            {state.status === "error" && state.message && <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>{state.message}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Keep draft</Button>
              <Button type="submit" variant="destructive" loading={pending} disabled={pending} data-testid="billing-discard-confirm">Discard</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
