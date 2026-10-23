import Link from "next/link";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth, isPlusReadOnly } from "@/lib/plus/access-core";
import { getQuoteDirectorySummary, listOrganizationQuotes, type DirectoryQuoteRow, type DirectorySummary } from "@/lib/plus/quotes";
import {
  DIRECTORY_DESCRIPTION,
  DIRECTORY_NEW_NOTE,
  DIRECTORY_SEARCH_MAX,
  DIRECTORY_SORT_OPTIONS,
  DIRECTORY_STATUS_OPTIONS,
  QUOTE_NOT_INVOICE_NOTE,
  directoryHref,
  directoryPageCount,
  directoryRange,
  formatCents,
  formatQuoteDate,
  parseDirectoryParams,
  quoteKindLabel,
  quoteReference,
  quoteStatusLabel,
  quoteStatusTone,
} from "@/lib/plus/quotes-core";
import { serviceTypeLabel } from "@/lib/plus/opportunities-core";
import { localDateKeyOf } from "@/lib/operations/local-time-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { StatTile, StatTileGroup } from "@/components/ui/StatTile";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { CheckCircle, Hourglass, PaperPlaneTilt, PencilSimpleLine, Receipt } from "@phosphor-icons/react/dist/ssr";
import { QuotesDirectoryTable, type QuotesDirectoryRow } from "@/components/growth/QuotesDirectoryTable";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Estimates & Quotes" };

const PIPELINE = "/operations/growth/pipeline";

function toRow(r: DirectoryQuoteRow, timezone: string): QuotesDirectoryRow {
  const created = new Date(r.createdAt).getTime();
  return {
    id: r.id,
    reference: quoteReference(r.kind, r.quoteNumber),
    kindLabel: quoteKindLabel(r.kind),
    opportunityId: r.opportunityId,
    opportunityTitle: r.opportunityTitle,
    contactName: r.contactName,
    serviceLabel: r.serviceType ? serviceTypeLabel(r.serviceType) : "Not specified",
    amount: formatCents(r.totalCents),
    currency: r.currency,
    statusLabel: quoteStatusLabel(r.status, r.isExpired),
    statusTone: quoteStatusTone(r.status, r.isExpired),
    storedStatus: r.status,
    validUntil: formatQuoteDate(r.validUntil),
    created: Number.isNaN(created) ? "" : formatQuoteDate(localDateKeyOf(created, timezone)),
  };
}

/**
 * Growth -> Estimates & Quotes (NP-P2-S5-S3A). An organization-wide directory over the existing quote domain:
 * plus_list_organization_quotes (one bounded, server-filtered, server-sorted page + the filtered total) and
 * plus_quote_directory_summary (counts), both Plus READ and re-checked in the database. Every quote belongs to an
 * opportunity: a row opens that opportunity's Estimates & quotes panel, where the existing draft workflow lives. Nothing
 * is created, edited or withdrawn here, and no opportunity is created automatically.
 */
export default async function QuotesDirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pathname = await getCurrentPathname("/operations/growth/quotes");
  const { context, plus } = await requirePlusAccess(pathname);
  const params = parseDirectoryParams(await searchParams);
  const canWrite = canWriteGrowth(plus.state, plus.capability);
  const tz = context.organizationTimezone;
  const { limit, offset } = directoryRange(params.page);

  const [listResult, summaryResult] = await Promise.allSettled([
    listOrganizationQuotes(context.organizationId, { search: params.search, status: params.status, sort: params.sort, limit, offset }),
    getQuoteDirectorySummary(context.organizationId),
  ]);
  const list = listResult.status === "fulfilled" ? listResult.value : null;
  const summary: DirectorySummary | null = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const filtered = Boolean(params.search) || params.status !== "all";
  const pages = list ? directoryPageCount(list.total) : 1;
  const pastEnd = list !== null && list.rows.length === 0 && params.page > 1;

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Estimates & Quotes"
        description={DIRECTORY_DESCRIPTION}
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Estimates & Quotes" }]}
        actions={
          canWrite ? (
            <LinkButton href={PIPELINE} variant="outline" data-testid="quotes-directory-new">
              New estimate or quote
            </LinkButton>
          ) : undefined
        }
      />
      {canWrite && (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="quotes-directory-new-note">
          {DIRECTORY_NEW_NOTE}
        </p>
      )}
      {isPlusReadOnly(plus.state) && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="Your estimates and quotes are kept and can be viewed. They can't be changed until Plus is active again." />
      )}

      {summary ? (
        <div data-testid="quotes-directory-summary">
          {/* NP-UI-V2-3: the same four server counts in the Brand Lock v2 fact tiles (D-6); "expired" takes the attention
              tone only when it is above zero. */}
          <StatTileGroup label="Estimates and quotes at a glance">
            {[
              <StatTile key="drafts" label={summary.drafts === 1 ? "draft" : "drafts"} value={summary.drafts} icon={<PencilSimpleLine className="size-5" />} tone="neutral" />,
              <StatTile key="sent" label="sent" value={summary.sent} icon={<PaperPlaneTilt className="size-5" />} tone="info" />,
              <StatTile key="accepted" label="accepted" value={summary.accepted} icon={<CheckCircle className="size-5" />} tone={summary.accepted > 0 ? "positive" : "neutral"} />,
              <StatTile key="expired" label="expired" value={summary.expired} icon={<Hourglass className="size-5" />} tone={summary.expired > 0 ? "attention" : "neutral"} />,
            ]}
          </StatTileGroup>
          <p className={cn(typography.metadata, "mt-2 text-text-muted")}>
            Sent counts every quote currently sent, including expired ones; expired means its valid-until date has passed in your workspace&apos;s timezone.
          </p>
        </div>
      ) : (
        <AttentionState level="critical" title="Counts couldn't be loaded" description="The list below is unaffected. Reload the page to try again." />
      )}

      <form method="get" action="/operations/growth/quotes" role="search" className="flex flex-col gap-zw-md rounded-md border border-border-subtle bg-surface-elevated p-zw-md shadow-sm md:flex-row md:items-end" data-testid="quotes-directory-filters">
        <div className="min-w-0 flex-1">
          <Input name="q" label="Search" type="search" defaultValue={params.search} placeholder="Number, estimate / quote, opportunity or contact" maxLength={DIRECTORY_SEARCH_MAX} data-testid="quotes-directory-search" />
        </div>
        <div className="md:w-60">
          <Select name="status" label="Status" options={DIRECTORY_STATUS_OPTIONS} defaultValue={params.status} data-testid="quotes-directory-status" />
        </div>
        <div className="md:w-56">
          <Select name="sort" label="Sort" options={DIRECTORY_SORT_OPTIONS} defaultValue={params.sort} data-testid="quotes-directory-sort" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="outline" data-testid="quotes-directory-apply">
            Apply
          </Button>
          {filtered && (
            <LinkButton href={directoryHref(params, { search: "", status: "all", page: 1 })} variant="text">
              Clear
            </LinkButton>
          )}
        </div>
      </form>

      {list === null ? (
        <div data-testid="quotes-directory-error">
          <AttentionState
            level="critical"
            title="Estimates and quotes couldn't be loaded"
            description="Your filters are kept. Try again in a moment."
            action={
              <LinkButton href={directoryHref(params)} variant="outline" size="sm">
                Retry
              </LinkButton>
            }
          />
        </div>
      ) : pastEnd ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")} data-testid="quotes-directory-past-end">
          There are no more results on this page.{" "}
          <Link className="text-text-link hover:underline" href={directoryHref(params, { page: 1 })}>
            Go to the first page
          </Link>
        </p>
      ) : list.rows.length === 0 ? (
        // NP-UI-V2-4: the V2 EmptyState anatomy in a raised panel. Quotes always belong to an opportunity, so the only
        // next step offered is the Pipeline (no standalone quote is ever created from here). Same wording and test id.
        <Panel surface="raised" padding="none" data-testid="quotes-directory-empty">
          <EmptyState
            icon={<Receipt className="size-6" aria-hidden />}
            title={filtered ? "No estimates or quotes match these filters." : "No estimates or quotes yet."}
            description={
              filtered
                ? "Change the search or status, or open the Pipeline to work from an opportunity."
                : "Estimates and quotes start from an opportunity. Open one in the Pipeline and use its Estimates & quotes panel."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {filtered && (
                  <LinkButton href="/operations/growth/quotes" size="sm" variant="text">
                    Clear filters
                  </LinkButton>
                )}
                <LinkButton href={PIPELINE} size="sm" variant="outline">
                  Open the Pipeline
                </LinkButton>
              </div>
            }
          />
        </Panel>
      ) : (
        <>
          <QuotesDirectoryTable rows={list.rows.map((r) => toRow(r, tz))} />
          <nav aria-label="Estimates and quotes pages" className="flex flex-wrap items-center justify-between gap-2" data-testid="quotes-directory-pagination">
            <p className={cn(typography.metadata, "text-text-muted")}>
              {list.total} {list.total === 1 ? "estimate or quote" : "estimates and quotes"}
              {pages > 1 && ` · page ${Math.min(params.page, pages)} of ${pages}`}
            </p>
            {pages > 1 && (
              <div className="flex gap-3">
                {params.page > 1 && (
                  <Link className={cn(typography.bodySmall, "text-text-link hover:underline")} href={directoryHref(params, { page: params.page - 1 })} data-testid="quotes-directory-prev">
                    Previous
                  </Link>
                )}
                {params.page < pages && (
                  <Link className={cn(typography.bodySmall, "text-text-link hover:underline")} href={directoryHref(params, { page: params.page + 1 })} data-testid="quotes-directory-next">
                    Next
                  </Link>
                )}
              </div>
            )}
          </nav>
        </>
      )}
      <p className={cn(typography.metadata, "text-text-muted")}>{QUOTE_NOT_INVOICE_NOTE}</p>
    </div>
  );
}
