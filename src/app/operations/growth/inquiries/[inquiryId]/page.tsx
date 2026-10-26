import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth, isPlusReadOnly } from "@/lib/plus/access-core";
import { getContact } from "@/lib/plus/contacts";
import { formatContactTime, isUuid } from "@/lib/plus/contacts-core";
import { getInquiry, listDuplicateHints, type DuplicateHint } from "@/lib/plus/inquiries";
import {
  consentTicksText,
  defaultOpportunityTitle,
  dismissReasonLabel,
  inquiryStatusLabel,
  inquiryStatusTone,
  inquiryTypeText,
  matchOnText,
  preferredReplyText,
  relationshipText,
  timeframeText,
} from "@/lib/plus/inquiries-core";
import { serviceTypeLabel } from "@/lib/plus/opportunities-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { DefinitionList, type DefinitionItem } from "@/components/ui/DefinitionList";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { InquiryActions, type LinkCandidate } from "@/components/growth/InquiryActions";
import { ChatCircleText, CheckSquare, Compass, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Inquiry" };

/**
 * Growth -> Inquiries -> Inquiry (NP-P2-S7-C). Server-authorized (requirePlusAccess + plus_get_inquiry, which re-checks
 * Plus read access and the organization); a foreign, unknown or inaccessible id renders the same "not found". Duplicate
 * hints are hints only (nothing is merged). Convert / Dismiss / Reopen are rendered for Plus write capability only, and
 * the database re-checks write access, the expected version and the inquiry's state.
 */
export default async function InquiryDetailPage({ params }: { params: Promise<{ inquiryId: string }> }) {
  const { inquiryId } = await params;
  const pathname = await getCurrentPathname(`/operations/growth/inquiries/${inquiryId}`);
  const { context, plus } = await requirePlusAccess(pathname);
  if (!isUuid(inquiryId)) notFound();

  const inquiry = await getInquiry(context.organizationId, inquiryId);
  if (!inquiry) notFound();

  const tz = context.organizationTimezone;
  const canWrite = canWriteGrowth(plus.state, plus.capability);

  let hints: DuplicateHint[] | null = null;
  try {
    hints = await listDuplicateHints(context.organizationId, inquiry.id);
  } catch {
    hints = null;
  }

  // Link targets: the matching contacts only (an unrelated contact can't be linked from here), with Do not contact and
  // the blank fields read from the contact itself.
  const candidates: LinkCandidate[] = [];
  if (canWrite && inquiry.status === "new" && hints) {
    const contacts = await Promise.all(hints.filter((h) => h.kind === "contact").map(async (h) => ({ h, c: await getContact(context.organizationId, h.id).catch(() => null) })));
    for (const { h, c } of contacts) {
      if (!c || c.status !== "active") continue;
      candidates.push({
        id: c.id,
        displayName: c.displayName,
        matchOn: matchOnText(h.matchOn),
        doNotContact: c.doNotContact,
        canFill: (!c.phone && Boolean(inquiry.phone)) || (!c.email && Boolean(inquiry.email)),
      });
    }
  }

  const contactHints = hints?.filter((h) => h.kind === "contact") ?? [];
  const inquiryHints = hints?.filter((h) => h.kind === "inquiry") ?? [];
  const acquisition: DefinitionItem[] = [];
  if (inquiry.utmSource) acquisition.push({ label: "Campaign source", value: inquiry.utmSource });
  if (inquiry.utmMedium) acquisition.push({ label: "Campaign medium", value: inquiry.utmMedium });
  if (inquiry.utmCampaign) acquisition.push({ label: "Campaign", value: inquiry.utmCampaign });
  if (inquiry.landingPath) acquisition.push({ label: "Page", value: <span className="break-all">{inquiry.landingPath}</span> });
  if (inquiry.referrerHost) acquisition.push({ label: "Came from", value: inquiry.referrerHost });

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title={inquiry.name}
        description={`Website inquiry · received ${formatContactTime(inquiry.receivedAt, tz)}`}
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Inquiries", href: "/operations/growth/inquiries" }, { label: inquiry.name }]}
        actions={
          <InquiryActions
            organizationId={context.organizationId}
            inquiryId={inquiry.id}
            version={inquiry.version}
            status={inquiry.status}
            canWrite={canWrite}
            name={inquiry.name}
            defaultTitle={defaultOpportunityTitle(inquiry.name, inquiry.inquiryType)}
            candidates={candidates}
            ticks={{ followup: inquiry.consentFollowup, marketing: inquiry.consentMarketing }}
          />
        }
      />
      {isPlusReadOnly(plus.state) && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="This inquiry is kept and can be viewed, but not converted or dismissed." />
      )}

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="inquiry-status">
        <SectionHeader title="Status" icon={<CheckSquare />} tone="accent" actions={<StatusBadge label={inquiryStatusLabel(inquiry.status)} category={inquiryStatusTone(inquiry.status)} />} />
        {inquiry.status === "new" && (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            Not handled yet. Converting creates or links a contact and creates one private-pay opportunity. It never creates a booking request.
          </p>
        )}
        {inquiry.status === "converted" && (
          <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="inquiry-converted-links">
            Converted{inquiry.triagedAt ? ` ${formatContactTime(inquiry.triagedAt, tz)}` : ""}
            {inquiry.triagedByName ? ` by ${inquiry.triagedByName}` : ""}.{" "}
            {inquiry.contactId && (
              <Link className="text-text-link hover:underline" href={`/operations/growth/contacts/${inquiry.contactId}`}>
                {inquiry.contactDisplayName ?? "Open the contact"}
              </Link>
            )}
            {inquiry.contactId && inquiry.opportunityId && " · "}
            {inquiry.opportunityId && (
              <Link className="text-text-link hover:underline" href={`/operations/growth/pipeline/${inquiry.opportunityId}`}>
                Open the opportunity
              </Link>
            )}
          </p>
        )}
        {inquiry.status === "dismissed" && (
          <DefinitionList
            columns={2}
            items={[
              { label: "Reason", value: dismissReasonLabel(inquiry.dismissReason) },
              { label: "Dismissed", value: `${inquiry.triagedAt ? formatContactTime(inquiry.triagedAt, tz) : "—"}${inquiry.triagedByName ? ` by ${inquiry.triagedByName}` : ""}` },
              ...(inquiry.dismissNote ? [{ label: "Note", value: <span className="whitespace-pre-wrap">{inquiry.dismissNote}</span>, fullWidth: true }] : []),
            ]}
          />
        )}
      </Panel>

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="inquiry-details">
        <SectionHeader title="What they sent" icon={<ChatCircleText />} />
        <DefinitionList
          columns={2}
          items={[
            { label: "Phone", value: inquiry.phone ?? "—" },
            { label: "Email", value: inquiry.email ? <span className="break-all">{inquiry.email}</span> : "—" },
            { label: "Preferred reply", value: preferredReplyText(inquiry.preferredReply) },
            { label: "About", value: inquiryTypeText(inquiry.inquiryType) },
            { label: "Service", value: inquiry.serviceType ? serviceTypeLabel(inquiry.serviceType) : "Not specified" },
            { label: "Ride is for", value: relationshipText(inquiry.relationship) },
            { label: "When", value: timeframeText(inquiry.timeframe) },
            { label: "Question", value: <span className="whitespace-pre-wrap break-words">{inquiry.question}</span>, fullWidth: true },
          ]}
        />
        <div data-testid="inquiry-consent-ticks">
          <p className={cn(typography.label, "text-text-primary")}>Communication boxes on the form</p>
          <ul className={cn(typography.bodySmall, "mt-1 list-disc pl-5 text-text-secondary")}>
            {consentTicksText(inquiry.consentFollowup, inquiry.consentMarketing).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className={cn(typography.metadata, "mt-1 text-text-muted")}>
            A ticked box becomes consent on the contact only when the inquiry is converted. An unticked box is never permission.
          </p>
        </div>
      </Panel>

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="inquiry-duplicates">
        <SectionHeader title="Possible matches" icon={<UsersThree />} description="Hints only. Nothing is merged automatically." />
        {hints === null ? (
          <AttentionState level="critical" title="Possible matches couldn't be loaded" description="Reload the page to try again." />
        ) : hints.length === 0 ? (
          <p className={cn(typography.bodySmall, "text-text-secondary")}>No existing contact or other new inquiry has the same name, phone or email.</p>
        ) : (
          <div className="flex flex-col gap-zw-md">
            {contactHints.length > 0 && (
              <ul aria-label="Matching contacts" className="divide-y divide-border-subtle">
                {contactHints.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                    <Link href={`/operations/growth/contacts/${h.id}`} className={cn(typography.bodySmall, "font-medium text-text-link hover:underline")}>
                      {h.displayName}
                    </Link>
                    <span className={cn(typography.metadata, "text-text-muted")}>Contact · matches on {matchOnText(h.matchOn)}</span>
                  </li>
                ))}
              </ul>
            )}
            {inquiryHints.length > 0 && (
              <ul aria-label="Other new inquiries" className="divide-y divide-border-subtle">
                {inquiryHints.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                    <Link href={`/operations/growth/inquiries/${h.id}`} className={cn(typography.bodySmall, "font-medium text-text-link hover:underline")}>
                      {h.displayName}
                    </Link>
                    <span className={cn(typography.metadata, "text-text-muted")}>
                      Inquiry{h.receivedAt ? ` · ${formatContactTime(h.receivedAt, tz)}` : ""} · matches on {matchOnText(h.matchOn)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      {acquisition.length > 0 && (
        <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="inquiry-acquisition">
          <SectionHeader title="How they found you" icon={<Compass />} />
          <DefinitionList columns={2} items={acquisition} />
        </Panel>
      )}
    </div>
  );
}
