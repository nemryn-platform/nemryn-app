import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getBillingWriteStatus, getTripBillingStatus, listBillableTrips, listImportableQuotes } from "@/lib/billing/billing";
import { formatInstantDate, invoiceNumberLabel } from "@/lib/billing/billing-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { BillingWriteNotice } from "@/components/billing/BillingWriteNotice";
import { NewInvoiceForm, type BillToOption } from "@/components/billing/NewInvoiceForm";
import { AttentionState } from "@/components/ui/AttentionState";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";

export const metadata = { title: "Create invoice" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Billing -> Create invoice for a completed trip (NP-BILL-P1). Organization Admin only. Offers the same passenger's
 * other uninvoiced completed trips, bill-to choices that come from those trips (passenger, requester, facility) or a
 * typed name, and -- when Plus is readable -- a sent / accepted quote linked to the trip's request. Creates a DRAFT only.
 * NP-FIN-P1G: no form while the organization's financial writes are not enabled.
 */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const organization = await requireOrganizationAdminAccess(await getCurrentPathname("/operations/billing/new"));
  const raw = await searchParams;
  const tripId = typeof raw.trip === "string" ? raw.trip : "";
  if (!UUID_RE.test(tripId)) notFound();
  const tz = organization.organizationTimezone;

  const supabase = await createServerSupabaseClient();
  const { data: trip } = await supabase.from("trips").select("id, passenger_id").eq("organization_id", organization.organizationId).eq("id", tripId).maybeSingle();
  if (!trip?.passenger_id) notFound();

  const { rows } = await listBillableTrips(organization.organizationId, { passengerId: trip.passenger_id, limit: 100 });
  const anchor = rows.find((r) => r.tripId === tripId);
  const header = (
    <PageHeader
      title="Create invoice"
      description="Choose the trips and who pays. You'll add or check the prices on the draft before issuing it."
      breadcrumb={[{ label: "Billing", href: "/operations/billing" }, { label: "Create invoice" }]}
    />
  );
  const writeStatus = await getBillingWriteStatus(organization.organizationId);
  if (!writeStatus.enabled) {
    return (
      <div className="flex flex-col gap-zw-lg">
        {header}
        <BillingWriteNotice status={writeStatus} />
        <Link href={`/operations/trips/${tripId}`} className="text-text-link hover:underline">
          Back to the trip
        </Link>
      </div>
    );
  }
  if (!anchor) {
    const status = await getTripBillingStatus(organization.organizationId, tripId);
    return (
      <div className="flex flex-col gap-zw-lg">
        {header}
        <AttentionState
          level="info"
          title={status?.invoiceId ? `This trip is already on ${invoiceNumberLabel(status.invoiceNumber)}` : "This trip can't be invoiced"}
          description={status?.invoiceId ? "A trip can be on only one invoice. Void that invoice first if it needs to be corrected." : "Only completed trips can be invoiced."}
          action={
            status?.invoiceId ? (
              <LinkButton href={`/operations/billing/invoices/${status.invoiceId}`} size="sm" variant="outline">
                Open the invoice
              </LinkButton>
            ) : (
              <Link href={`/operations/trips/${tripId}`} className="text-text-link hover:underline">
                Back to the trip
              </Link>
            )
          }
        />
      </div>
    );
  }

  const options: BillToOption[] = [
    { value: `passenger:${anchor.passengerId}`, label: anchor.passengerName, description: "The passenger" },
  ];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.requestId && r.requesterName && !seen.has(r.requestId)) {
      seen.add(r.requestId);
      options.push({ value: `requester:${r.requestId}`, label: r.requesterName, description: `Requested the ride${r.tripId === anchor.tripId ? "" : " (another trip)"}` });
    }
  }
  for (const r of rows) {
    for (const [id, name] of [
      [r.pickupFacilityId, r.pickupFacilityName],
      [r.destinationFacilityId, r.destinationFacilityName],
    ] as const) {
      if (id && name && !seen.has(id)) {
        seen.add(id);
        options.push({ value: `facility:${id}`, label: name, description: "Facility on the trip (must be on every selected trip)" });
      }
    }
  }
  options.push({ value: "other:", label: "Someone else", description: "Type the name of the person or organization paying" });
  const defaultBillTo = anchor.requestId && anchor.requesterName ? `requester:${anchor.requestId}` : `passenger:${anchor.passengerId}`;
  const quotes = await listImportableQuotes(organization.organizationId, anchor.requestId).catch(() => []);

  return (
    <div className="flex flex-col gap-zw-lg">
      {header}
      <Panel surface="raised" className="flex flex-col gap-zw-md">
        <NewInvoiceForm
          organizationId={organization.organizationId}
          idempotencyKey={`inv-${randomUUID()}`}
          anchorTripId={anchor.tripId}
          trips={rows.map((r) => ({
            id: r.tripId,
            label: `${formatInstantDate(r.completedAt ?? r.scheduledPickupAt, tz)} — ${r.passengerName}`,
            detail: `${r.pickup} → ${r.destination}`,
          }))}
          billToOptions={options}
          defaultBillTo={defaultBillTo}
          quotes={quotes.map((q) => ({ id: q.id, label: q.label }))}
        />
      </Panel>
    </div>
  );
}
