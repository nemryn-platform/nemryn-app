"use client";

import { useActionState, useState } from "react";
import { createInvoiceDraftAction, type BillingActionState } from "@/app/operations/billing/actions";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { Select } from "@/components/ui/Select";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const IDLE: BillingActionState = { status: "idle" };

export interface NewInvoiceTrip {
  id: string;
  label: string;
  detail: string;
}
export interface BillToOption {
  value: string;
  label: string;
  description: string;
}

/**
 * Billing -> Create invoice (NP-BILL-P1). One invoice = completed trips of ONE passenger for ONE bill-to party (D3, R1):
 * only this passenger's uninvoiced trips are offered; the database re-checks every rule (completed, same organization,
 * not already invoiced, bill-to linked to every trip, quote linked) and nothing is issued here.
 */
export function NewInvoiceForm({
  organizationId,
  idempotencyKey,
  trips,
  anchorTripId,
  billToOptions,
  defaultBillTo,
  quotes,
}: {
  organizationId: string;
  idempotencyKey: string;
  trips: NewInvoiceTrip[];
  anchorTripId: string;
  billToOptions: BillToOption[];
  defaultBillTo: string;
  quotes: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(createInvoiceDraftAction, IDLE);
  const [billTo, setBillTo] = useState(defaultBillTo);
  return (
    <form action={action} className="flex flex-col gap-zw-lg" data-testid="billing-new-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <fieldset className="flex flex-col gap-2" data-testid="billing-new-trips">
        <legend className={cn(typography.label, "mb-1 text-text-primary")}>Trips on this invoice</legend>
        {trips.map((t) => (
          <Checkbox key={t.id} name="tripId" value={t.id} defaultChecked={t.id === anchorTripId} label={t.label} description={t.detail} />
        ))}
        <p className={cn(typography.metadata, "text-text-muted")}>Only this passenger&apos;s completed trips that aren&apos;t on another invoice are listed.</p>
        {state.fieldErrors?.tripId && <p className={cn(typography.bodySmall, "text-critical-text")}>{state.fieldErrors.tripId}</p>}
      </fieldset>

      <RadioGroup legend="Bill to" name="billTo" value={billTo} onChange={setBillTo} options={billToOptions} variant="card" error={state.fieldErrors?.billTo} />
      {billTo === "other:" && (
        <Input name="billToName" label="Name to bill" required maxLength={200} error={state.fieldErrors?.billToName} data-testid="billing-new-other-name" />
      )}

      {quotes.length > 0 && (
        <Select
          name="quoteId"
          label="Use prices from a quote (optional)"
          options={[{ value: "", label: "No quote — enter prices on the next step" }, ...quotes.map((q) => ({ value: q.id, label: q.label }))]}
          defaultValue=""
          helpText="The quote's charges are copied per trip and shown on the draft before you issue it. They replace the trip line, never add to it."
          data-testid="billing-new-quote"
        />
      )}

      {state.status === "error" && state.message && (
        <p role="alert" className={cn(typography.bodySmall, "text-critical-text")} data-testid="billing-new-error">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending} disabled={pending} data-testid="billing-new-submit">
          Create draft invoice
        </Button>
      </div>
    </form>
  );
}
