import Link from "next/link";
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
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Opportunity" };

const SAVED: Record<string, string> = { created: "Opportunity created.", updated: "Changes saved.", unchanged: "No changes to save." };

function historyLine(a: OpportunityActivity): string {
  if (a.type === "stage_changed") return `${stageLabel(a.fromStage ?? "")} → ${stageDisplayLabel(a.toStage ?? "")}`;
  return activityTypeLabel(a.type);
}

/**
 * Growth -> Pipeline -> Opportunity (NP-P2-S1). Who the prospective customer is, why they got in touch, where the
 * potential booking stands, and what happened last. Server-authorized (requirePlusAccess + plus_get_opportunity); a
 * foreign, unknown or inaccessible id renders the same 404. Write controls only for Plus write capability. No
 * conversion, booking, Passenger, Trip, quote document or payment record exists here.
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
            <LinkButton href={`/operations/growth/pipeline/${o.id}/edit`} variant="outline" data-testid="opportunity-edit">
              Edit opportunity
            </LinkButton>
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
      {o.contactArchived && (
        <AttentionState level="info" title="The contact is archived" description="The opportunity is kept. Their contact record is now read-only history." />
      )}

      <Panel className="flex flex-col gap-zw-md" data-testid="opportunity-details">
        <SectionHeader
          title="Details"
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
        <Panel className="flex flex-col gap-zw-md">
          <SectionHeader title="Stage" />
          <OpportunityStageControls organizationId={context.organizationId} opportunityId={o.id} expectedVersion={o.updatedAt} stage={o.stage} />
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-zw-lg lg:grid-cols-2">
        <div className="flex flex-col gap-zw-md">
          <SectionHeader title="History" description="Stage and owner changes, newest first. Entries can't be edited." />
          {history === null ? (
            <AttentionState level="critical" title="History couldn't be loaded" description="Reload the page to try again." />
          ) : history.length === 0 ? (
            <p className={cn(typography.bodySmall, "text-text-secondary")}>No stage changes yet. It started as a new inquiry.</p>
          ) : (
            <Panel>
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
            </Panel>
          )}
        </div>
        <div className="flex flex-col gap-zw-md">
          <SectionHeader
            title="Latest with this contact"
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
            <Panel>
              <ol aria-label="Latest contact interactions" data-testid="opportunity-interactions">
                {interactions.map((a) => (
                  <li key={a.id} className="border-t border-border-subtle py-zw-sm first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={cn(typography.label, "text-text-primary")}>{activityTypeLabel(a.type)}</span>
                      <span className={cn(typography.metadata, "text-text-muted")}>
                        {formatContactTime(a.occurredAt, tz)}
                        {a.actorName ? ` · ${a.actorName}` : ""}
                      </span>
                    </div>
                    {a.body && <p className={cn(typography.bodySmall, "mt-1 line-clamp-3 whitespace-pre-wrap break-words text-text-secondary")}>{a.body}</p>}
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
