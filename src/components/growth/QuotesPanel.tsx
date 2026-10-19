import Link from "next/link";
import { listOwnerOptions } from "@/lib/plus/contacts";
import { getQuote, listOpportunityQuotes, type QuoteDetail, type QuoteSummary } from "@/lib/plus/quotes";
import { listTasks } from "@/lib/plus/tasks";
import { localDateKeyOf } from "@/lib/operations/local-time-core";
import { formatContactTime } from "@/lib/plus/contacts-core";
import { SERVICE_OPTIONS, serviceTypeLabel } from "@/lib/plus/opportunities-core";
import {
  QUOTE_NOT_INVOICE_NOTE,
  QUOTE_EXPIRED_NOTE,
  QUOTE_SENT_CURRENT_NOTE,
  centsToInput,
  emptyQuoteForm,
  formatCents,
  formatQuoteDate,
  groupQuotes,
  quoteChargeLines,
  quoteKindLabel,
  quotePrintHref,
  quoteReference,
  quoteStatusLabel,
  quoteStatusTone,
  type QuoteFormValues,
} from "@/lib/plus/quotes-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { QuoteDraftControls, type DraftForEditing, type FollowUpContext, type SentForActions } from "@/components/growth/QuoteDraftControls";
import type { QuoteReview } from "@/components/growth/QuoteLifecycleDialogs";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/** The server-read snapshot for the Mark sent review (amounts formatted from stored integer cents). */
function toReview(d: QuoteDetail, predecessor: QuoteSummary | undefined): QuoteReview {
  return {
    reference: quoteReference(d.kind, d.quoteNumber),
    kindLabel: quoteKindLabel(d.kind),
    serviceLabel: d.serviceType ? serviceTypeLabel(d.serviceType) : "Service not specified",
    lines: quoteChargeLines(d),
    discount: d.discountCents > 0 ? formatCents(d.discountCents) : null,
    total: formatCents(d.totalCents),
    validUntil: formatQuoteDate(d.validUntil),
    replaces: predecessor && predecessor.status === "sent" ? quoteReference(predecessor.kind, predecessor.quoteNumber) : null,
  };
}

function toFormValues(d: QuoteDetail): QuoteFormValues {
  return {
    kind: d.kind,
    serviceType: d.serviceType ?? "",
    roundTrip: d.roundTrip ? "yes" : "no",
    distanceMiles: d.distanceMiles === null ? "" : String(d.distanceMiles),
    base: centsToInput(d.baseCents),
    mileage: centsToInput(d.mileageCents),
    wait: centsToInput(d.waitCents),
    extraStops: centsToInput(d.extraStopsCents),
    mobilityAssistance: centsToInput(d.mobilityAssistanceCents),
    escort: centsToInput(d.escortCents),
    returnLeg: centsToInput(d.returnLegCents),
    other: centsToInput(d.otherCents),
    otherLabel: d.otherLabel ?? "",
    discount: centsToInput(d.discountCents),
    validUntil: d.validUntil,
    termsNote: d.termsNote ?? "",
  };
}

function QuoteRow({ q, byId, timezone, emphasis }: { q: QuoteSummary; byId: Map<string, QuoteSummary>; timezone: string; emphasis?: string }) {
  const predecessor = q.supersedesQuoteId ? byId.get(q.supersedesQuoteId) : undefined;
  const successor = q.supersededByQuoteId ? byId.get(q.supersededByQuoteId) : undefined;
  return (
    <li className="flex flex-col gap-1 border-t border-border-subtle py-zw-sm first:border-t-0 first:pt-0" data-testid="quote-row" data-status={q.status} data-quote-id={q.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn(typography.label, "text-text-primary")} data-testid="quote-reference">
            {quoteReference(q.kind, q.quoteNumber)}
          </span>
          <StatusBadge label={quoteStatusLabel(q.status, q.isExpired)} category={quoteStatusTone(q.status, q.isExpired)} />
          {emphasis && <span className={cn(typography.metadata, "text-text-muted")}>{emphasis}</span>}
        </span>
        <span className={cn(typography.label, "tabular-nums text-text-primary")} data-testid="quote-total">
          {formatCents(q.totalCents)} <span className={cn(typography.metadata, "text-text-muted")}>{q.currency}</span>
        </span>
      </div>
      <p className={cn(typography.bodySmall, "text-text-secondary")}>
        {quoteKindLabel(q.kind)} · {q.serviceType ? serviceTypeLabel(q.serviceType) : "Service not specified"}
        {q.roundTrip ? " · Round trip" : ""} · Valid until {formatQuoteDate(q.validUntil)}
        {q.status === "sent" && q.isExpired ? " (passed)" : ""}
      </p>
      <p className={cn(typography.metadata, "text-text-muted")}>
        Created {formatContactTime(q.createdAt, timezone)}
        {predecessor ? ` · Revision of ${quoteReference(predecessor.kind, predecessor.quoteNumber)}` : ""}
        {successor ? ` · Replaced by ${quoteReference(successor.kind, successor.quoteNumber)}` : ""}
        {" · "}
        <Link href={quotePrintHref(q.id)} target="_blank" rel="noopener" className="text-text-link hover:underline" data-testid="quote-print-link">
          Print<span className="sr-only"> {quoteReference(q.kind, q.quoteNumber)} (opens in a new tab)</span>
        </Link>
      </p>
    </li>
  );
}

/**
 * Estimates & quotes on an Opportunity (NP-P2-S5-S2). Server component: reads through plus_list_quotes (Plus read;
 * tenant-scoped) and, for a writer's draft, plus_get_quote. OD-Q12 (ZD-221): at most one active draft and one current
 * sent quote; everything else is read-only history. Expiry is the read RPC's derived is_expired. Writers on an open
 * opportunity may create, edit, mark sent and withdraw the DRAFT, and record responses to, revise or withdraw the current
 * SENT quote (NP-P2-S5-S3B); every action is a staff statement and the database writes its timeline event.
 * NP-P2-S5-S3C: every row has a staff-only "Print" view (ZD-224); after Mark sent, writers are OFFERED an optional
 * follow-up task (ZD-225) -- the panel reads the opportunity's open tasks and the assignable people for that offer only.
 */
export async function QuotesPanel({
  organizationId,
  timezone,
  opportunityId,
  opportunityTitle,
  opportunityServiceType,
  canWrite,
  contactDoNotContact = false,
}: {
  organizationId: string;
  timezone: string;
  opportunityId: string;
  opportunityTitle: string;
  opportunityServiceType: string | null;
  /** Plus write AND an open opportunity (the database re-checks both) */
  canWrite: boolean;
  /** the contact's stored do-not-contact flag (OD-Q16 warning; the database re-checks the current flag) */
  contactDoNotContact?: boolean;
}) {
  let rows: QuoteSummary[] | null = null;
  try {
    rows = await listOpportunityQuotes(organizationId, opportunityId);
  } catch {
    rows = null;
  }
  const groups = rows ? groupQuotes(rows) : null;
  let draft: DraftForEditing | null = null;
  let draftUnavailable = false;
  if (canWrite && groups?.draft) {
    try {
      const d = await getQuote(organizationId, groups.draft.id);
      if (d && d.status === "draft") {
        const predecessor = d.supersedesQuoteId ? rows?.find((r) => r.id === d.supersedesQuoteId) : undefined;
        draft = { id: d.id, quoteNumber: d.quoteNumber, kind: d.kind, updatedAt: d.updatedAt, values: toFormValues(d), review: toReview(d, predecessor) };
      }
      else draftUnavailable = true;
    } catch {
      draftUnavailable = true;
    }
  }
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const today = localDateKeyOf(new Date().getTime(), timezone);
  const serviceOptions = [{ value: "", label: "Not specified" }, ...SERVICE_OPTIONS];
  const sent: SentForActions | null = groups?.sent
    ? { id: groups.sent.id, reference: quoteReference(groups.sent.kind, groups.sent.quoteNumber), updatedAt: groups.sent.updatedAt, isExpired: groups.sent.isExpired }
    : null;
  // ZD-225 follow-up offer: the existing open tasks (duplicate notice) and the assignable people (default: you). A failed
  // read only hides the offer; it never blocks the quote actions.
  let followUp: FollowUpContext | null = null;
  if (canWrite && groups && (groups.draft || groups.sent)) {
    try {
      const [owners, tasks] = await Promise.all([listOwnerOptions(organizationId), listTasks(organizationId, { view: "open", opportunityId, limit: 5 })]);
      followUp = {
        subjectLabel: opportunityTitle,
        owners: owners.map((o) => ({ value: o.handle, label: o.isSelf ? `${o.name} (you)` : o.name })),
        selfHandle: owners.find((o) => o.isSelf)?.handle ?? null,
        openTaskCount: tasks.total,
        openTaskTitles: tasks.rows.map((t) => t.title),
      };
    } catch {
      followUp = null;
    }
  }
  const showControls = canWrite && groups !== null && !draftUnavailable && (groups.draft ? draft !== null : true);

  return (
    <div id="quotes" className="flex scroll-mt-4 flex-col gap-zw-md" data-testid="opportunity-quotes">
      <SectionHeader
        title="Estimates & quotes"
        description={QUOTE_NOT_INVOICE_NOTE}
        actions={
          showControls && groups ? (
            <QuoteDraftControls
              organizationId={organizationId}
              opportunityId={opportunityId}
              today={today}
              serviceOptions={serviceOptions}
              initialCreate={emptyQuoteForm(opportunityServiceType)}
              draft={draft}
              sent={sent}
              doNotContact={contactDoNotContact}
              followUp={followUp}
              canCreate={!groups.draft && !groups.sent}
            />
          ) : undefined
        }
      />
      {groups === null ? (
        <AttentionState level="critical" title="Quotes couldn't be loaded" description="Reload the page to try again." />
      ) : (
        <>
          {draftUnavailable && (
            <AttentionState level="critical" title="The draft couldn't be opened" description="Reload the page to try again." />
          )}
          {canWrite && !groups.draft && groups.sent && (
            <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="quote-sent-current-note">
              {QUOTE_SENT_CURRENT_NOTE}
            </p>
          )}
          {canWrite && groups.sent?.isExpired && (
            <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="quote-expired-note">
              {QUOTE_EXPIRED_NOTE}
            </p>
          )}
          {rows && rows.length === 0 ? (
            <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="quotes-empty">
              No estimates or quotes yet.
            </p>
          ) : (
            <Panel className="flex flex-col gap-zw-md">
              {(groups.draft || groups.sent) && (
                <section aria-label="Current" data-testid="quotes-current">
                  <h3 className={cn(typography.metadata, "mb-2 uppercase tracking-wide text-text-muted")}>Current</h3>
                  <ul>
                    {groups.draft && <QuoteRow q={groups.draft} byId={byId} timezone={timezone} emphasis="Active draft" />}
                    {groups.sent && <QuoteRow q={groups.sent} byId={byId} timezone={timezone} emphasis="Current sent" />}
                  </ul>
                </section>
              )}
              {groups.history.length > 0 && (
                <section aria-label="History" data-testid="quotes-history">
                  <h3 className={cn(typography.metadata, "mb-2 uppercase tracking-wide text-text-muted")}>History</h3>
                  <ul>
                    {groups.history.map((q) => (
                      <QuoteRow key={q.id} q={q} byId={byId} timezone={timezone} />
                    ))}
                  </ul>
                  <p className={cn(typography.metadata, "mt-2 text-text-muted")}>Earlier estimates and quotes are kept as they were. They can&apos;t be edited.</p>
                </section>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
