import { notFound, redirect } from "next/navigation";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import { listContacts, listOwnerOptions, type OwnerOption } from "@/lib/plus/contacts";
import { getOpportunity } from "@/lib/plus/opportunities";
import { isUuid } from "@/lib/plus/opportunities-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { OpportunityForm } from "@/components/growth/OpportunityForm";

export const metadata = { title: "Edit opportunity" };

/**
 * Growth -> Pipeline -> Edit (NP-P2-S1). Plus WRITE and OPEN opportunities only (lost / converted are history). The
 * form carries the version it was rendered from (ZW003 on a concurrent change). The contact can be switched to
 * another ACTIVE contact; the current one is kept even if it has since been archived.
 */
export default async function EditOpportunityPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  const pathname = await getCurrentPathname(`/operations/growth/pipeline/${opportunityId}/edit`);
  const { context, plus } = await requirePlusAccess(pathname);
  if (!isUuid(opportunityId)) notFound();
  if (!canWriteGrowth(plus.state, plus.capability)) redirect(`/operations/growth/pipeline/${opportunityId}`);
  const o = await getOpportunity(context.organizationId, opportunityId);
  if (!o) notFound();
  if (o.stage === "lost" || o.stage === "converted") redirect(`/operations/growth/pipeline/${opportunityId}`);

  let owners: OwnerOption[] = [];
  let contacts: { value: string; label: string }[] = [];
  try {
    owners = await listOwnerOptions(context.organizationId);
  } catch {
    owners = [];
  }
  try {
    const active = await listContacts(context.organizationId, { search: "", kind: null, status: "active", page: 1 });
    contacts = active.rows.map((c) => ({ value: c.id, label: c.displayName }));
  } catch {
    contacts = [];
  }
  if (!contacts.some((c) => c.value === o.contactId)) {
    contacts.unshift({ value: o.contactId, label: `${o.contactName}${o.contactArchived ? " (archived)" : ""}` });
  }

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title={`Edit ${o.title}`}
        breadcrumb={[
          { label: "Growth", href: "/operations/growth" },
          { label: "Pipeline", href: "/operations/growth/pipeline" },
          { label: o.title, href: `/operations/growth/pipeline/${o.id}` },
          { label: "Edit" },
        ]}
      />
      <OpportunityForm
        mode="edit"
        organizationId={context.organizationId}
        opportunityId={o.id}
        expectedVersion={o.updatedAt}
        contactOptions={contacts}
        owners={owners.map((x) => ({ value: x.handle, label: x.isSelf ? `${x.name} (you)` : x.name }))}
        cancelHref={`/operations/growth/pipeline/${o.id}`}
        initial={{
          contactId: o.contactId,
          title: o.title,
          inquiryType: o.inquiryType ?? "other",
          serviceType: o.serviceType ?? "",
          source: o.source,
          sourceDetail: o.sourceDetail ?? "",
          campaignCode: o.campaignCode ?? "",
          estimate: o.estimatedValueCents !== null ? (o.estimatedValueCents / 100).toFixed(o.estimatedValueCents % 100 === 0 ? 0 : 2) : "",
          paymentReportedStatus: o.paymentReportedStatus,
          ownerHandle: o.ownerHandle ?? "",
        }}
      />
    </div>
  );
}
