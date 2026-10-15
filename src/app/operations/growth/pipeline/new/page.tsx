import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import { getContact, listContacts, listOwnerOptions, type ContactListRow, type OwnerOption } from "@/lib/plus/contacts";
import { contactKindLabel, parseContactListParams } from "@/lib/plus/contacts-core";
import { isUuid } from "@/lib/plus/opportunities-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { OpportunityForm } from "@/components/growth/OpportunityForm";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "New opportunity" };

/**
 * Growth -> Pipeline -> New (NP-P2-S1). Plus WRITE only. Step 1: choose an ACTIVE contact of THIS workspace (search, or
 * preselected from a contact's page via ?contactId=). Step 2: the opportunity details. The contact is re-checked by the
 * database on save (archived or foreign contacts are refused). Nothing here creates a booking.
 */
export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pathname = await getCurrentPathname("/operations/growth/pipeline/new");
  const { context, plus } = await requirePlusAccess(pathname);
  if (!canWriteGrowth(plus.state, plus.capability)) redirect("/operations/growth/pipeline");
  const sp = await searchParams;
  const contactId = typeof sp.contactId === "string" ? sp.contactId : "";
  const crumbs = [{ label: "Growth", href: "/operations/growth" }, { label: "Pipeline", href: "/operations/growth/pipeline" }, { label: "New" }];

  const contact = isUuid(contactId) ? await getContact(context.organizationId, contactId) : null;

  if (!contact || contact.status !== "active") {
    const q = typeof sp.q === "string" ? sp.q : "";
    let results: ContactListRow[] | null = null;
    try {
      results = (await listContacts(context.organizationId, { ...parseContactListParams({ q }), status: "active" })).rows;
    } catch {
      results = null;
    }
    return (
      <div className="flex flex-col gap-zw-lg">
        <PageHeader title="New opportunity" description="Every private-pay opportunity belongs to someone in your contacts. Choose who this inquiry is from." breadcrumb={crumbs} />
        {contactId && (
          <AttentionState level="warning" title="That contact can't be used" description="It isn't an active contact in this workspace. Choose another one below." />
        )}
        <Panel className="flex max-w-3xl flex-col gap-zw-md" data-testid="opportunity-contact-step">
          <form method="get" action="/operations/growth/pipeline/new" role="search" className="flex flex-col gap-2 md:flex-row md:items-end">
            <div className="min-w-0 flex-1">
              <Input name="q" label="Find a contact" type="search" defaultValue={q} placeholder="Name, email or phone" maxLength={200} />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          {results === null ? (
            <AttentionState level="critical" title="Contacts couldn't be loaded" description="Try again in a moment." />
          ) : results.length === 0 ? (
            <p className={cn(typography.bodySmall, "text-text-secondary")}>
              {q ? "No active contact matches." : "There are no active contacts yet."}{" "}
              <Link href="/operations/growth/contacts/new" className="text-text-link hover:underline">
                Add a contact
              </Link>{" "}
              first.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle" aria-label="Choose a contact">
              {results.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className={cn(typography.label, "block break-words text-text-primary")}>{c.displayName}</span>
                    <span className={cn(typography.metadata, "text-text-secondary")}>{contactKindLabel(c.contactKind)}</span>
                  </span>
                  <LinkButton href={`/operations/growth/pipeline/new?contactId=${c.id}`} size="sm" variant="outline" data-testid="choose-contact">
                    Choose
                  </LinkButton>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    );
  }

  let owners: OwnerOption[] = [];
  try {
    owners = await listOwnerOptions(context.organizationId);
  } catch {
    owners = [];
  }
  const self = owners.find((o) => o.isSelf);

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader title="New opportunity" description="Record a private-pay inquiry so your team can follow it through to a booking." breadcrumb={crumbs} />
      {contact.doNotContact && (
        <AttentionState level="warning" title="This contact asked not to be contacted" description="You can still record their inquiry. Respect their preference when following up." />
      )}
      <OpportunityForm
        mode="create"
        organizationId={context.organizationId}
        contactOptions={[{ value: contact.id, label: contact.displayName }]}
        owners={owners.map((o) => ({ value: o.handle, label: o.isSelf ? `${o.name} (you)` : o.name }))}
        cancelHref="/operations/growth/pipeline"
        initial={{
          contactId: contact.id,
          title: "",
          inquiryType: "quote",
          serviceType: "",
          source: "phone",
          sourceDetail: "",
          campaignCode: "",
          estimate: "",
          paymentReportedStatus: "none",
          ownerHandle: self?.handle ?? "",
        }}
      />
    </div>
  );
}
