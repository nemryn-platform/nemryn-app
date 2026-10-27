import Link from "next/link";
import { ChatCircleText, ClockCounterClockwise, Funnel, Handshake } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth, isPlusReadOnly } from "@/lib/plus/access-core";
import { listContactActivities, type ContactActivity } from "@/lib/plus/contacts";
import { activityTypeLabel, formatContactTime } from "@/lib/plus/contacts-core";
import { getOpportunity, listOpportunityActivities, type OpportunityActivity } from "@/lib/plus/opportunities";
import {
  ESTIMATE_NOTE,
  PAYMENT_REPORTED_NOTE,
  formatEstimate,
  inquiryTypeLabel,
  isUuid,
  lostReasonLabel,
  paymentReportedLabel,
  serviceTypeLabel,
  sourceLabel,
  stageDisplayLabel,
  stageLabel,
  stageTone,
} from "@/lib/plus/opportunities-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { OpportunityStageControls } from "@/components/growth/OpportunityStageControls";
import { SubjectTasksPanel } from "@/components/growth/SubjectTasksPanel";
import { LinkedRequestsPanel } from "@/components/growth/LinkedRequestsPanel";
import { BookingRequestDialog } from "@/components/growth/BookingRequestDialog";
import { QuotesPanel } from "@/components/growth/QuotesPanel";
import { isQuoteActivity, quoteActivityLine } from "@/lib/plus/quotes-core";
import { getContact } from "@/lib/plus/contacts";
import { getHandoffContext, type HandoffContext } from "@/lib/plus/handoff";
import { listLinkedRequests } from "@/lib/plus/attribution";
import { coreSourceForOpportunity } from "@/lib/plus/booking-core";
import { SOURCE_OPTIONS, selectOptionLabel } from "@/lib/operations/log-request-options";
import { SERVICE_TYPE_LABELS, type ServiceType } from "@/lib/public-intake/website-intake-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Opportunity" };

const SAVED: Record<string, string> = { created: "Opportunity created.", updated: "Changes saved.", unchanged: "No changes to save." };

function historyLine(a: OpportunityActivity): string {
  if (a.type === "stage_changed") return `${stageLabel(a.fromStage ?? "")} → ${stageDisplayLabel(a.toStage ?? "")}`;
  if (isQuoteActivity(a.type)) return quoteActivityLine(a.type, a.quoteKind, a.quoteNumber, a.quoteStatus, a.relatedQuoteNumber);
  return activityTypeLabel(a.type);
}

/**
 * Growth -> Pipeline -> Opportunity (NP-P2-S1). Who the prospective customer is, why they got in touch, where the
 * potential booking stands, and what happened last. Server-authorized (requirePlusAccess + plus_get_opportunity); a
 * foreign, unknown or inaccessible id renders the same 404. Write controls only for Plus write capability.
 * NP-P2-S4: "Create transportation request" converts an open opportunity into ONE pending Operations Request (Core
 * decides from there). No Passenger, Trip, quote document or payment record is created here.
 * NP-P2-S5-S2 / S3B: "Estimates & quotes" lists this opportunity's quotes (read for every Growth reader) and lets writers
 * on an open opportunity manage the one active draft and the current sent quote (OD-Q12, ZD-221): mark sent (with the
 * do-not-contact acknowledgment, ZD-223), record responses, revise, withdraw. Nothing is sent to the customer.
 */
export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ opportunityId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { opportunityId } = await params;
  const pathname = await getCurrentPathname(`/operations/growth/pipeline/${opportunityId}`);
  const { context, plus } = await requirePlusAccess(pathname);
  if (!isUuid(opportunityId)) notFound();
  const o = await getOpportunity(context.organizationId, opportunityId);
  if (!o) notFound();

  const tz = context.organizationTimezone;
  const canWrite = canWriteGrowth(plus.state, plus.capability);
  const open = o.stage !== "lost" && o.stage !== "converted";
  let history: OpportunityActivity[] | null = null;
  let interactions: ContactActivity[] | null = null;
  try {
    history = await listOpportunityActivities(context.organizationId, o.id);
  } catch {
    history = null;
  }
  try {
    interactions = (await listContactActivities(context.organizationId, o.contactId, 5)).rows;
  } catch {
    interactions = null;
  }
  // NP-P2-S4 conversion: writers, open opportunity, active contact, and no Request already linked (a manual P2-S3 link
  // is never turned into a second Request). The database re-checks every one of these and the Core role.
  let linkedCount: number | null = null;
  let customer: { name: string; phone: string | null; email: string | null; doNotContact: boolean } | null = null;
  let contactKind: string | null = null;
  if (canWrite && open && !o.contactArchived) {
    try {
      linkedCount = (await listLinkedRequests(context.organizationId, { opportunityId: o.id })).total;
    } catch {
      linkedCount = null;
    }
    try {
      const c = await getContact(context.organizationId, o.contactId);
      customer = c ? { name: c.displayName, phone: c.phone, email: c.email, doNotContact: c.doNotContact } : null;
      contactKind = c?.contactKind ?? null;
    } catch {
      customer = null;
    }
  }
  const canConvert = canWrite && open && !o.contactArchived && linkedCount === 0 && customer !== null;
  // NP-PILOT-P1: handoff hints for the conversion form (suggested, editable; optional passenger choice)
  const handoff: HandoffContext | undefined = canConvert && customer
    ? await getHandoffContext(context.organizationId, { opportunityId: o.id, contactId: o.contactId, contactName: customer.name, contactPhone: customer.phone, contactKind })
    : undefined;
  const saved = (await searchParams).saved;
  const savedMessage = typeof saved === "string" ? SAVED[saved] : undefined;

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title={o.title}
        description={`Private-pay · ${inquiryTypeLabel(o.inquiryType)}`}
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Pipeline", href: "/operations/growth/pipeline" }, { label: o.title }]}
        actions={
          canWrite && open ? (
            <div className="flex flex-wrap items-center gap-2">
              <LinkButton href={`/operations/growth/pipeline/${o.id}/edit`} variant="outline" data-testid="opportunity-edit">
                Edit opportunity
              </LinkButton>
              {canConvert && customer && (
                <BookingRequestDialog
                  mode="convert"
                  organizationId={context.organizationId}
                  customer={customer}
                  opportunityId={o.id}
                  opportunityTitle={o.title}
                  expectedVersion={o.updatedAt}
                  sourceLabel={selectOptionLabel(SOURCE_OPTIONS, coreSourceForOpportunity(o.source))}
                  opportunityServiceLabel={o.serviceType ? (SERVICE_TYPE_LABELS[o.serviceType as ServiceType] ?? null) : null}
                  handoff={handoff}
                />
              )}
            </div>
          ) : undefined
        }
      />
      {savedMessage && (
        <p role="status" className={cn(typography.bodySmall, "text-text-secondary")} data-testid="opportunity-saved">
          {savedMessage}
        </p>
      )}
      {isPlusReadOnly(plus.state) && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="This opportunity and its history are kept and can be viewed, but not changed." />
      )}
      {canWrite && open && linkedCount !== null && linkedCount > 0 && (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="convert-unavailable-linked">
          This opportunity is already linked to a transportation request (see Linked requests), so a new one isn&apos;t created from here.
        </p>
      )}
      {o.stage === "converted" && (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="opportunity-converted-note">
          Converted: a transportation request was created for Operations to review. Its status is shown under Linked requests.
        </p>
      )}
      {o.contactArchived && (
        <AttentionState level="info" title="The contact is archived" description="The opportunity is kept. Their contact record is now read-only history." />
      )}

      <Panel surface="raised" className="flex flex-col gap-zw-md" data-testid="opportunity-details">
        <SectionHeader
          title="Details"
          icon={<Handshake />}
          tone="accent"
          actions={
            <div className="flex flex-wrap gap-1">
              {o.contactDoNotContact && <StatusBadge label="Do not contact" category="critical" />}
              <span data-testid="opportunity-stage">
                <StatusBadge label={stageDisplayLabel(o.stage)} category={stageTone(o.stage)} />
              </span>
            </div>
          }
        />
        <DefinitionList
          columns={2}
          items={[
            {
              label: "Contact",
              value: (
                <Link href={`/operations/growth/contacts/${o.contactId}`} className="text-text-link hover:underline" data-testid="opportunity-contact-link">
                  {o.contactName}
                </Link>
              ),
            },
            { label: "They asked about", value: inquiryTypeLabel(o.inquiryType) },
            { label: "Service", value: serviceTypeLabel(o.serviceType) },
            { label: "How they found you", value: `${sourceLabel(o.source)}${o.sourceDetail ? ` · ${o.sourceDetail}` : ""}` },
            { label: "Owner", value: o.ownerName ? `${o.ownerName}${o.ownerCanWrite === false ? " (no longer has write access)" : ""}` : "No owner" },
            { label: "Campaign code", value: o.campaignCode ?? "—" },
            {
              label: "Estimated value",
              value: o.estimatedValueCents !== null ? `${formatEstimate(o.estimatedValueCents)} (estimate)` : "—",
            },
            { label: "Payment (reported by staff)", value: paymentReportedLabel(o.paymentReportedStatus) },
            ...(o.stage === "lost"
              ? [{ label: "Lost because", value: `${lostReasonLabel(o.lostReason)}${o.lostNote ? ` — ${o.lostNote}` : ""}` }]
              : []),
            { label: "Created", value: `${formatContactTime(o.createdAt, tz)}${o.createdByName ? ` by ${o.createdByName}` : ""}` },
          ]}
        />
        <p className={cn(typography.metadata, "text-text-muted")}>
          {ESTIMATE_NOTE} {PAYMENT_REPORTED_NOTE}
        </p>
      </Panel>

      {canWrite && (
        <Panel surface="raised" className="flex flex-col gap-zw-md">
          <SectionHeader title="Stage" icon={<Funnel />} />
          <OpportunityStageControls organizationId={context.organizationId} opportunityId={o.id} expectedVersion={o.updatedAt} stage={o.stage} />
        </Panel>
      )}

      <QuotesPanel
        organizationId={context.organizationId}
        timezone={tz}
        opportunityId={o.id}
        opportunityTitle={o.title}
        opportunityServiceType={o.serviceType}
        canWrite={canWrite && open}
        contactDoNotContact={o.contactDoNotContact}
      />

      <SubjectTasksPanel organizationId={context.organizationId} timezone={tz} subject={{ kind: "opportunity", id: o.id, label: o.title }} canWrite={canWrite && open} />
      <LinkedRequestsPanel organizationId={context.organizationId} timezone={tz} subject={{ kind: "opportunity", id: o.id }} />

      {/* NP-UI-V2-3: History and the contact's latest interactions are each one raised panel (header inside). */}
      <div className="grid grid-cols-1 items-start gap-zw-lg lg:grid-cols-2">
        <Panel surface="raised" className="flex flex-col gap-zw-md">
          <SectionHeader title="History" description="Stage, owner and quote changes, newest first. Entries can't be edited." icon={<ClockCounterClockwise />} />
          {history === null ? (
            <AttentionState level="critical" title="History couldn't be loaded" description="Reload the page to try again." />
          ) : history.length === 0 ? (
            <p className={cn(typography.bodySmall, "text-text-secondary")}>No stage changes yet. It started as a new inquiry.</p>
          ) : (
            <div>
              <ol aria-label="Opportunity history" data-testid="opportunity-history">
                {history.map((a) => (
                  <li key={a.id} className="border-t border-border-subtle py-zw-sm first:border-t-0 first:pt-0" data-testid="history-entry" data-type={a.type}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={cn(typography.label, "text-text-primary")}>{historyLine(a)}</span>
                      <span className={cn(typography.metadata, "text-text-muted")}>
                        {formatContactTime(a.occurredAt, tz)}
                        {a.actorName ? ` · ${a.actorName}` : ""}
                      </span>
                    </div>
                    {a.body && <p className={cn(typography.bodySmall, "mt-1 whitespace-pre-wrap break-words text-text-secondary")}>{a.body}</p>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Panel>
        <Panel surface="raised" className="flex flex-col gap-zw-md">
          <SectionHeader
            title="Latest with this contact"
            icon={<ChatCircleText />}
            description="The most recent notes, calls, emails and meetings logged on the contact."
            actions={
              <Link href={`/operations/growth/contacts/${o.contactId}`} className={cn(typography.bodySmall, "text-text-link hover:underline")}>
                Open contact
              </Link>
            }
          />
          {interactions === null ? (
            <AttentionState level="critical" title="Interactions couldn't be loaded" description="Reload the page to try again." />
          ) : interactions.length === 0 ? (
            <p className={cn(typography.bodySmall, "text-text-secondary")}>Nothing logged with this contact yet.</p>
          ) : (
            <div>
              <ol aria-label="Latest contact interactions" data-testid="opportunity-interactions">
                {interactions.map((a) => (
                  <li key={a.id} className="border-t border-border-subtle py-zw-sm first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={cn(typography.label, "text-text-primary")}>
                        {isQuoteActivity(a.type) ? quoteActivityLine(a.type, a.quoteKind, a.quoteNumber, a.quoteStatus, a.relatedQuoteNumber) : activityTypeLabel(a.type)}
                      </span>
                      <span className={cn(typography.metadata, "text-text-muted")}>
                        {formatContactTime(a.occurredAt, tz)}
                        {a.actorName ? ` · ${a.actorName}` : ""}
                      </span>
                    </div>
                    {a.body && <p className={cn(typography.bodySmall, "mt-1 line-clamp-3 whitespace-pre-wrap break-words text-text-secondary")}>{a.body}</p>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
