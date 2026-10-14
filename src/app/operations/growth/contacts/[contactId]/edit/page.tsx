import { notFound, redirect } from "next/navigation";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import { getContact, listOwnerOptions, type OwnerOption } from "@/lib/plus/contacts";
import { isUuid } from "@/lib/plus/contacts-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { ContactForm } from "@/components/growth/ContactForm";

export const metadata = { title: "Edit contact" };

/**
 * Growth -> Contacts -> Edit (NP-P1-S4). Plus WRITE only and ACTIVE contacts only (archived contacts are read-only
 * history). The form carries the version it was rendered from; a concurrent change is refused (ZW003).
 */
export default async function EditContactPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const pathname = await getCurrentPathname(`/operations/growth/contacts/${contactId}/edit`);
  const { context, plus } = await requirePlusAccess(pathname);
  if (!isUuid(contactId)) notFound();
  if (!canWriteGrowth(plus.state, plus.capability)) redirect(`/operations/growth/contacts/${contactId}`);

  const contact = await getContact(context.organizationId, contactId);
  if (!contact) notFound();
  if (contact.status !== "active") redirect(`/operations/growth/contacts/${contactId}`);

  let owners: OwnerOption[] = [];
  try {
    owners = await listOwnerOptions(context.organizationId);
  } catch {
    owners = [];
  }

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title={`Edit ${contact.displayName}`}
        breadcrumb={[
          { label: "Growth", href: "/operations/growth" },
          { label: "Contacts", href: "/operations/growth/contacts" },
          { label: contact.displayName, href: `/operations/growth/contacts/${contactId}` },
          { label: "Edit" },
        ]}
      />
      <ContactForm
        mode="edit"
        organizationId={context.organizationId}
        contactId={contact.id}
        expectedVersion={contact.updatedAt}
        owners={owners}
        cancelHref={`/operations/growth/contacts/${contactId}`}
        initial={{
          displayName: contact.displayName,
          phone: contact.phone ?? "",
          email: contact.email ?? "",
          contactKind: contact.contactKind,
          jobTitle: contact.jobTitle ?? "",
          preferredChannel: contact.preferredChannel,
          doNotContact: contact.doNotContact,
          ownerHandle: contact.ownerHandle ?? "",
        }}
      />
    </div>
  );
}
