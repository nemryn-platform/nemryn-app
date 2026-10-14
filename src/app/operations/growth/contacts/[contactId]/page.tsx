import { notFound } from "next/navigation";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth, isPlusReadOnly } from "@/lib/plus/access-core";
import { getContact, listContactActivities, type ContactActivity } from "@/lib/plus/contacts";
import {
  activityTypeLabel,
  contactChannelLabel,
  contactKindLabel,
  formatContactTime,
  isBackdated,
  isUuid,
} from "@/lib/plus/contacts-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ContactWriteActions } from "@/components/growth/ContactActions";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Contact" };

const SAVED_MESSAGES: Record<string, string> = {
  created: "Contact created.",
  updated: "Changes saved.",
  unchanged: "No changes to save.",
};

/**
 * Growth -> Contacts -> Contact (NP-P1-S4). Server-authorized (requirePlusAccess + plus_get_contact, which re-checks
 * Plus read access and the organization). A foreign, unknown or inaccessible id renders the same "not found" -- the
 * record's existence is never revealed. Write actions are rendered only for Plus write capability on an active
 * contact; read-only viewers see the same information without them. No account, opportunity, task, quote,
 * passenger, rebooking or Request controls exist yet.
 */
export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { contactId } = await params;
  const pathname = await getCurrentPathname(`/operations/growth/contacts/${contactId}`);
  const { context, plus } = await requirePlusAccess(pathname);
  if (!isUuid(contactId)) notFound();

  const contact = await getContact(context.organizationId, contactId);
  if (!contact) notFound();

  let activities: ContactActivity[] | null = null;
  try {
    activities = (await listContactActivities(context.organizationId, contactId)).rows;
  } catch {
    activities = null;
  }

  const tz = context.organizationTimezone;
  const archived = contact.status === "archived";
  const canWrite = canWriteGrowth(plus.state, plus.capability) && !archived;
  const saved = (await searchParams).saved;
  const savedMessage = typeof saved === "string" ? SAVED_MESSAGES[saved] : undefined;

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title={contact.displayName}
        description={`${contactKindLabel(contact.contactKind)}${contact.jobTitle ? ` · ${contact.jobTitle}` : ""}`}
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Contacts", href: "/operations/growth/contacts" }, { label: contact.displayName }]}
        actions={
          canWrite ? (
            <LinkButton href={`/operations/growth/contacts/${contact.id}/edit`} variant="outline" data-testid="contact-edit">
              Edit contact
            </LinkButton>
          ) : undefined
        }
      />

      {savedMessage && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")} data-testid="contact-saved">
          {savedMessage}
        </p>
      )}
      {isPlusReadOnly(plus.state) && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="This contact and its history are kept and can be viewed, but not changed." />
      )}
      {archived && (
        <AttentionState level="info" title="Archived contact" description="Archived contacts are kept as history and can't be changed." />
      )}

      <Panel className="flex flex-col gap-zw-md" data-testid="contact-details">
        <SectionHeader
          title="Details"
          actions={
            <div className="flex flex-wrap gap-1">
              {contact.doNotContact && <StatusBadge label="Do not contact" category="critical" />}
              <StatusBadge label={archived ? "Archived" : "Active"} category={archived ? "cancelled" : "positive"} />
            </div>
          }
        />
        <DefinitionList
          columns={2}
          items={[
            { label: "Phone", value: contact.phone ?? "—" },
            { label: "Email", value: contact.email ? <span className="break-all">{contact.email}</span> : "—" },
            { label: "Preferred channel", value: contactChannelLabel(contact.preferredChannel) },
            { label: "Do not contact", value: contact.doNotContact ? "Yes — this person asked not to be contacted" : "No" },
            {
              label: "Owner",
              value: contact.ownerName
                ? `${contact.ownerName}${contact.ownerCanWrite === false ? " (no longer has Nemryn Plus write access)" : ""}`
                : "No owner",
            },
            { label: "Added", value: `${formatContactTime(contact.createdAt, tz)}${contact.createdByName ? ` by ${contact.createdByName}` : ""}` },
          ]}
        />
      </Panel>

      <div className="flex flex-col gap-zw-md">
        <SectionHeader title="Timeline" description="Notes and the calls, emails and meetings your team logged. Entries can't be edited or deleted." />
        {canWrite && (
          <ContactWriteActions contactId={contact.id} contactName={contact.displayName} organizationId={context.organizationId} expectedVersion={contact.updatedAt} />
        )}
        {activities === null ? (
          <AttentionState level="critical" title="The timeline couldn't be loaded" description="Reload the page to try again." />
        ) : activities.length === 0 ? (
          <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="timeline-empty">
            Nothing recorded yet.
          </p>
        ) : (
          <Panel>
            <ol aria-label="Timeline" data-testid="contact-timeline">
              {activities.map((a) => (
                <li key={a.id} className="border-t border-border-subtle py-zw-md first:border-t-0 first:pt-0" data-testid="timeline-entry" data-type={a.type}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className={cn(typography.label, "text-text-primary")}>{activityTypeLabel(a.type)}</span>
                    <span className={cn(typography.metadata, "text-text-muted")}>
                      {formatContactTime(a.occurredAt, tz)}
                      {a.actorName ? ` · ${a.actorName}` : ""}
                      {isBackdated(a.occurredAt, a.recordedAt) ? ` · logged ${formatContactTime(a.recordedAt, tz)}` : ""}
                    </span>
                  </div>
                  {a.body && <p className={cn(typography.bodySmall, "mt-1 whitespace-pre-wrap break-words text-text-primary")}>{a.body}</p>}
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </div>
    </div>
  );
}
