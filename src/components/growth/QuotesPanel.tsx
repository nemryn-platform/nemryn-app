import { getQuote, listOpportunityQuotes, type QuoteDetail, type QuoteSummary } from "@/lib/plus/quotes";
import { localDateKeyOf } from "@/lib/operations/local-time-core";
import { formatContactTime } from "@/lib/plus/contacts-core";
import { SERVICE_OPTIONS, serviceTypeLabel } from "@/lib/plus/opportunities-core";
import {
  QUOTE_NOT_INVOICE_NOTE,
  QUOTE_SENT_CURRENT_NOTE,
  centsToInput,
  emptyQuoteForm,
  formatCents,
  groupQuotes,
  quoteKindLabel,
  quoteReference,
  quoteStatusLabel,
  quoteStatusTone,
  type QuoteFormValues,
} from "@/lib/plus/quotes-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { QuoteDraftControls, type DraftForEditing } from "@/components/growth/QuoteDraftControls";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/** "Oct 20, 2026" for a calendar date (no timezone shift: it is a date, not an instant). */
function formatDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
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
        {q.roundTrip ? " · Round trip" : ""} · Valid until {formatDateKey(q.validUntil)}
        {q.status === "sent" && q.isExpired ? " (passed)" : ""}
      </p>
      <p className={cn(typography.metadata, "text-text-muted")}>
        Created {formatContactTime(q.createdAt, timezone)}
        {predecessor ? ` · Revision of ${quoteReference(predecessor.kind, predecessor.quoteNumber)}` : ""}
        {successor ? ` · Replaced by ${quoteReference(successor.kind, successor.quoteNumber)}` : ""}
      </p>
    </li>
  );
}

/**
 * Estimates & quotes on an Opportunity (NP-P2-S5-S2). Server component: reads through plus_list_quotes (Plus read;
 * tenant-scoped) and, for a writer's draft, plus_get_quote. OD-Q12 (ZD-221): at most one active draft and one current
 * sent quote; everything else is read-only history. Expiry is the read RPC's derived is_expired. Writers on an open
 * opportunity may create, edit and withdraw a DRAFT; Mark sent / responses / revisions arrive in S3.
 */
export async function QuotesPanel({
  organizationId,
  timezone,
  opportunityId,
  opportunityServiceType,
  canWrite,
}: {
  organizationId: string;
  timezone: string;
  opportunityId: string;
  opportunityServiceType: string | null;
  /** Plus write AND an open opportunity (the database re-checks both) */
  canWrite: boolean;
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
      if (d && d.status === "draft") draft = { id: d.id, quoteNumber: d.quoteNumber, kind: d.kind, updatedAt: d.updatedAt, values: toFormValues(d) };
      else draftUnavailable = true;
    } catch {
      draftUnavailable = true;
    }
  }
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const today = localDateKeyOf(new Date().getTime(), timezone);
  const serviceOptions = [{ value: "", label: "Not specified" }, ...SERVICE_OPTIONS];
  const showControls = canWrite && groups !== null && !draftUnavailable && (groups.draft ? draft !== null : !groups.sent);

  return (
    <div className="flex flex-col gap-zw-md" data-testid="opportunity-quotes">
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
