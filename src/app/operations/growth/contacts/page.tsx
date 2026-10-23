import Link from "next/link";
import { AddressBook, Plus } from "@phosphor-icons/react/dist/ssr";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth, isPlusReadOnly } from "@/lib/plus/access-core";
import { listContacts, type ContactListPage } from "@/lib/plus/contacts";
import {
  CONTACT_KIND_OPTIONS,
  CONTACTS_PAGE_SIZE,
  contactChannelLabel,
  contactKindLabel,
  contactListHref,
  pageCount,
  parseContactListParams,
} from "@/lib/plus/contacts-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ContactsTable } from "@/components/growth/ContactsTable";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Contacts" };

/**
 * Growth -> Contacts (NP-P1-S4). The people this workspace sells to or works with. Server-authorized on every request
 * (requirePlusAccess) and read through plus_list_contacts, which re-checks Plus read access in the database; a page of
 * 25 with search (name, email, phone), kind and active / archived filters. "New contact" only for Plus write
 * capability. No import, no metrics, no sample records.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pathname = await getCurrentPathname("/operations/growth/contacts");
  const { context, plus } = await requirePlusAccess(pathname);
  const params = parseContactListParams(await searchParams);
  const canWrite = canWriteGrowth(plus.state, plus.capability);
  const filtered = Boolean(params.search || params.kind || params.status !== "active");

  let page: ContactListPage | null = null;
  try {
    page = await listContacts(context.organizationId, params);
  } catch {
    page = null;
  }
  const pages = page ? pageCount(page.total) : 1;

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Contacts"
        description="People you work with or follow up with. Nemryn Plus records them; it never contacts anyone for you."
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Contacts" }]}
        actions={
          canWrite ? (
            <LinkButton href="/operations/growth/contacts/new" leadingIcon={<Plus className="size-4" aria-hidden />} data-testid="contacts-new">
              New contact
            </LinkButton>
          ) : undefined
        }
      />

      {isPlusReadOnly(plus.state) && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="Your contacts are kept and can be viewed. They can't be changed until Plus is active again." />
      )}

      <form method="get" action="/operations/growth/contacts" className="flex flex-col gap-zw-md rounded-md border border-border-subtle bg-surface-elevated p-zw-md shadow-sm md:flex-row md:items-end" role="search" data-testid="contacts-filters">
        <div className="min-w-0 flex-1">
          <Input name="q" label="Search" type="search" defaultValue={params.search} placeholder="Name, email or phone" maxLength={200} />
        </div>
        <div className="md:w-56">
          <Select name="kind" label="Type" options={[{ value: "", label: "All types" }, ...CONTACT_KIND_OPTIONS]} defaultValue={params.kind ?? ""} />
        </div>
        <div className="md:w-40">
          <Select
            name="status"
            label="Status"
            options={[
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
              { value: "all", label: "All" },
            ]}
            defaultValue={params.status}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="outline">
            Apply
          </Button>
          {filtered && (
            <LinkButton href="/operations/growth/contacts" variant="text">
              Clear
            </LinkButton>
          )}
        </div>
      </form>

      {!page ? (
        <AttentionState
          level="critical"
          title="Contacts couldn't be loaded"
          description="Your filters are kept. Try again in a moment."
          action={
            <LinkButton href={contactListHref(params)} variant="outline" size="sm">
              Retry
            </LinkButton>
          }
        />
      ) : page.rows.length === 0 ? (
        <div className="rounded-md border border-border-subtle bg-surface-elevated shadow-sm">
          <EmptyState
            icon={<AddressBook className="size-6" aria-hidden />}
            title={filtered ? "No contacts match these filters." : "No contacts yet."}
            description={
              filtered
                ? "Try a different search, or clear the filters."
                : canWrite
                  ? "Add the people you follow up with: families, caregivers, facility staff and referral sources."
                  : "Contacts added by your team will appear here."
            }
            action={
              !filtered && canWrite ? (
                <LinkButton href="/operations/growth/contacts/new" size="sm" variant="outline">
                  New contact
                </LinkButton>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <ContactsTable
            rows={page.rows.map((r) => ({
              id: r.id,
              name: r.displayName,
              kind: contactKindLabel(r.contactKind),
              jobTitle: r.jobTitle,
              phone: r.phone,
              email: r.email,
              channel: contactChannelLabel(r.preferredChannel),
              doNotContact: r.doNotContact,
              archived: r.status === "archived",
              owner: r.ownerName,
            }))}
          />
          <nav aria-label="Contacts pages" className="flex flex-wrap items-center justify-between gap-2" data-testid="contacts-pagination">
            <p className={cn(typography.metadata, "text-text-secondary")}>
              {page.total} {page.total === 1 ? "contact" : "contacts"}
              {pages > 1 && ` · page ${Math.min(params.page, pages)} of ${pages}`}
              {` · ${CONTACTS_PAGE_SIZE} per page`}
            </p>
            {pages > 1 && (
              <div className="flex gap-2">
                {params.page > 1 && (
                  <Link className={cn(typography.bodySmall, "text-text-link hover:underline")} href={contactListHref(params, { page: params.page - 1 })}>
                    Previous
                  </Link>
                )}
                {params.page < pages && (
                  <Link className={cn(typography.bodySmall, "text-text-link hover:underline")} href={contactListHref(params, { page: params.page + 1 })}>
                    Next
                  </Link>
                )}
              </div>
            )}
          </nav>
        </>
      )}
      <p className={cn(typography.metadata, "text-text-muted")}>
        <StatusBadge label="Do not contact" category="critical" /> marks people who asked not to be contacted.
      </p>
    </div>
  );
}
