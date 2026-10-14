import { redirect } from "next/navigation";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import { listOwnerOptions, type OwnerOption } from "@/lib/plus/contacts";
import { PageHeader } from "@/components/ui/PageHeader";
import { ContactForm } from "@/components/growth/ContactForm";

export const metadata = { title: "New contact" };

/** Growth -> Contacts -> New (NP-P1-S4). Plus WRITE only; a read-only viewer is sent back to the list. */
export default async function NewContactPage() {
  const pathname = await getCurrentPathname("/operations/growth/contacts/new");
  const { context, plus } = await requirePlusAccess(pathname);
  if (!canWriteGrowth(plus.state, plus.capability)) redirect("/operations/growth/contacts");

  let owners: OwnerOption[] = [];
  try {
    owners = await listOwnerOptions(context.organizationId);
  } catch {
    owners = [];
  }
  const self = owners.find((o) => o.isSelf);

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="New contact"
        description="Add someone you work with or follow up with. Possible duplicates are shown before anything is saved."
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Contacts", href: "/operations/growth/contacts" }, { label: "New" }]}
      />
      <ContactForm
        mode="create"
        organizationId={context.organizationId}
        owners={owners}
        cancelHref="/operations/growth/contacts"
        initial={{
          displayName: "",
          phone: "",
          email: "",
          contactKind: "individual",
          jobTitle: "",
          preferredChannel: "phone",
          doNotContact: false,
          ownerHandle: self?.handle ?? "",
        }}
      />
    </div>
  );
}
