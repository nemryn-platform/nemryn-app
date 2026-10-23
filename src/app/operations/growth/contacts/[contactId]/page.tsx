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
import { listOpportunities, type OpportunityListRow } from "@/lib/plus/opportunities";
import { stageDisplayLabel, stageTone } from "@/lib/plus/opportunities-core";
import Link from "next/link";
import { AddressBook, ClockCounterClockwise, Handshake } from "@phosphor-icons/react/dist/ssr";
import { isQuoteActivity, quoteActivityLine } from "@/lib/plus/quotes-core";
import { SubjectTasksPanel } from "@/components/growth/SubjectTasksPanel";
import { LinkedRequestsPanel } from "@/components/growth/LinkedRequestsPanel";
import { BookingRequestDialog } from "@/components/growth/BookingRequestDialog";
import { getServiceOfferings } from "@/lib/operations/organization-services";
import { serviceRequestedOptions } from "@/lib/operations/log-request-options";
import { SERVICE_TYPE_LABELS, SERVICE_TYPE_VALUES } from "@/lib/public-intake/website-intake-core";
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

  // NP-P2-S1: this contact's private-pay opportunities (Plus read, re-checked by the database).
  let opportunities: OpportunityListRow[] | null = null;
  try {
    opportunities = (await listOpportunities(context.organizationId, { search: "", view: "all", stage: null, source: null, owner: null, contactId })).rows;
  } catch {
    opportunities = null;
  }

  const tz = context.organizationTimezone;
  const archived = contact.status === "archived";
  const canWrite = canWriteGrowth(plus.state, plus.capability) && !archived;
  const saved = (await searchParams).saved;
  const savedMessage = typeof saved === "string" ? SAVED_MESSAGES[saved] : undefined;
  // NP-P2-S4.1-S2 rebooking "Service requested (optional)" (OD-S3): the organization's configured Services, or all nine
  // when none are configured; a FAILED read is never "none configured" (only "Not specified", with a short note).
  let configuredServices: string[] | null = null;
  if (canWrite) {
    try {
      configuredServices = await getServiceOfferings(context.organizationId);
    } catch {
      configuredServices = null;
    }
  }
  const rebookServiceOptions = serviceRequestedOptions(SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS, configuredServices);

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title={contact.displayName}
        description={`${contactKindLabel(contact.contactKind)}${contact.jobTitle ? ` · ${contact.jobTitle}` : ""}`}
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Contacts", href: "/operations/growth/contacts" }, { label: contact.displayName }]}
        actions={
          canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <LinkButton href={`/operations/growth/contacts/${contact.id}/edit`} variant="outline" data-testid="contact-edit">
                Edit contact
              </LinkButton>
              {/* NP-P2-S4 rebooking: ONE new pending Operations request for this contact; no opportunity is created */}
              <BookingRequestDialog
                mode="rebook"
                organizationId={context.organizationId}
                customer={{ name: contact.displayName, phone: contact.phone, email: contact.email, doNotContact: contact.doNotContact }}
                contactId={contact.id}
                serviceOptions={rebookServiceOptions}
                serviceOptionsUnavailable={configuredServices === null}
              />
            </div>
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

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="contact-details">
        <SectionHeader
          title="Details"
          icon={<AddressBook />}
          tone="accent"
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

      <SubjectTasksPanel organizationId={context.organizationId} timezone={tz} subject={{ kind: "contact", id: contact.id, label: contact.displayName }} canWrite={canWrite} />
      <LinkedRequestsPanel organizationId={context.organizationId} timezone={tz} subject={{ kind: "contact", id: contact.id }} />

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="contact-opportunities">
        <SectionHeader
          title="Opportunities"
          icon={<Handshake />}
          description="Private-pay sales conversations with this contact."
          actions={
            canWrite ? (
              <LinkButton href={`/operations/growth/pipeline/new?contactId=${contact.id}`} size="sm" variant="outline" data-testid="contact-new-opportunity">
                New opportunity
              </LinkButton>
            ) : undefined
          }
        />
        {opportunities === null ? (
          <AttentionState level="critical" title="Opportunities couldn't be loaded" description="Reload the page to try again." />
        ) : opportunities.length === 0 ? (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>No opportunities yet.</p>
        ) : (
          <div>
            <ul aria-label="Opportunities" className="divide-y divide-border-subtle">
              {opportunities.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <Link href={`/operations/growth/pipeline/${o.id}`} className={cn(typography.bodySmall, "font-medium text-text-link hover:underline")}>
                    {o.title}
                  </Link>
                  <StatusBadge label={stageDisplayLabel(o.stage)} category={stageTone(o.stage)} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel surface="raised" className="flex flex-col gap-zw-md">
        <SectionHeader title="Timeline" description="Notes and the calls, emails and meetings your team logged. Entries can't be edited or deleted." icon={<ClockCounterClockwise />} />
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
          <div>
            <ol aria-label="Timeline" data-testid="contact-timeline">
              {activities.map((a) => (
                <li key={a.id} className="border-t border-border-subtle py-zw-md first:border-t-0 first:pt-0" data-testid="timeline-entry" data-type={a.type}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className={cn(typography.label, "text-text-primary")}>
                      {isQuoteActivity(a.type) ? quoteActivityLine(a.type, a.quoteKind, a.quoteNumber, a.quoteStatus, a.relatedQuoteNumber) : activityTypeLabel(a.type)}
                    </span>
                    <span className={cn(typography.metadata, "text-text-muted")}>
                      {formatContactTime(a.occurredAt, tz)}
                      {a.actorName ? ` · ${a.actorName}` : ""}
                      {isBackdated(a.occurredAt, a.recordedAt) ? ` · logged ${formatContactTime(a.recordedAt, tz)}` : ""}
                    </span>
                  </div>
                  {a.body && <p className={cn(typography.bodySmall, "mt-1 whitespace-pre-wrap break-words text-text-primary")}>{a.body}</p>}
                  {isQuoteActivity(a.type) && a.opportunityId && (
                    <Link href={`/operations/growth/pipeline/${a.opportunityId}#quotes`} className={cn(typography.metadata, "text-text-link hover:underline")} data-testid="timeline-quote-link">
                      Open the opportunity&apos;s quotes
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </Panel>
    </div>
  );
}
