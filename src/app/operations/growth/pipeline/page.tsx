import Link from "next/link";
import { Kanban, Plus } from "@phosphor-icons/react/dist/ssr";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth, isPlusReadOnly } from "@/lib/plus/access-core";
import { listOwnerOptions, type OwnerOption } from "@/lib/plus/contacts";
import { listOpportunities, PIPELINE_PAGE_SIZE, type OpportunityListRow } from "@/lib/plus/opportunities";
import {
  OPEN_STAGES,
  REPORTED_QUOTE_STAGE_NOTE,
  SOURCE_OPTIONS,
  formatEstimate,
  parsePipelineParams,
  pipelineHref,
  sourceLabel,
  stageDisplayLabel,
  stageTone,
  type PipelineParams,
} from "@/lib/plus/opportunities-core";
import { AttentionState } from "@/components/ui/AttentionState";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { ViewSwitch } from "@/components/ui/ViewSwitch";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Pipeline" };

function Card({ row }: { row: OpportunityListRow }) {
  return (
    <li>
      <Link
        href={`/operations/growth/pipeline/${row.id}`}
        className="block rounded-md border border-border-subtle bg-surface-elevated p-3 shadow-sm transition-colors duration-base hover:border-accent-hover-border focus-visible:border-accent-hover-border motion-reduce:transition-none"
        data-testid="pipeline-card"
        data-stage={row.stage}
      >
        <p className={cn(typography.label, "break-words text-text-primary")}>{row.title}</p>
        <p className={cn(typography.bodySmall, "mt-0.5 break-words text-text-secondary")}>
          {row.contactName}
          {row.contactArchived && <span className="text-text-muted"> · contact archived</span>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {row.contactDoNotContact && <StatusBadge label="Do not contact" category="critical" />}
          <span className={cn(typography.metadata, "text-text-muted")}>
            {sourceLabel(row.source)}
            {row.estimatedValueCents !== null ? ` · est. ${formatEstimate(row.estimatedValueCents)}` : ""}
          </span>
        </div>
        <p className={cn(typography.metadata, "mt-1 text-text-muted")}>{row.ownerName ? `Owner: ${row.ownerName}` : "No owner"}</p>
      </Link>
    </li>
  );
}

function Board({ rows }: { rows: OpportunityListRow[] }) {
  return (
    <div className="overflow-x-auto" data-testid="pipeline-board">
      <div className="grid min-w-[60rem] grid-cols-5 gap-zw-md">
        {OPEN_STAGES.map((stage) => {
          const cards = rows.filter((r) => r.stage === stage);
          return (
            <section key={stage} aria-label={stageDisplayLabel(stage)} className="flex min-w-0 flex-col gap-2 rounded-md border border-border-subtle bg-surface-secondary/60 p-2.5" data-testid="pipeline-column" data-stage={stage}>
              <h2 className={cn(typography.label, "flex items-center justify-between gap-2 px-1 py-0.5 text-text-primary")}>
                <span>{stageDisplayLabel(stage)}</span>
                <span className={cn(typography.metadata, "min-w-6 rounded-full bg-surface-elevated px-2 py-0.5 text-center font-medium tabular-nums text-text-secondary ring-1 ring-border-subtle")}>{cards.length}</span>
              </h2>
              {cards.length === 0 ? (
                <p className={cn(typography.metadata, "px-1 text-text-muted")}>None</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {cards.map((r) => (
                    <Card key={r.id} row={r} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function List({ rows }: { rows: OpportunityListRow[] }) {
  const columns: DataTableColumn<OpportunityListRow>[] = [
    {
      key: "title",
      header: "Opportunity",
      primary: true,
      render: (r) => (
        <div className="min-w-0">
          <Link href={`/operations/growth/pipeline/${r.id}`} className={cn(typography.bodySmall, "font-medium text-text-primary hover:underline")} data-testid="pipeline-row-link">
            {r.title}
          </Link>
          <p className={cn(typography.metadata, "text-text-secondary")}>
            {r.contactName}
            {r.contactArchived ? " · contact archived" : ""}
          </p>
        </div>
      ),
    },
    { key: "stage", header: "Stage", render: (r) => <StatusBadge label={stageDisplayLabel(r.stage)} category={stageTone(r.stage)} /> },
    { key: "source", header: "Source", render: (r) => <span className={cn(typography.bodySmall, "text-text-secondary")}>{sourceLabel(r.source)}</span> },
    { key: "owner", header: "Owner", render: (r) => <span className={cn(typography.bodySmall, "text-text-secondary")}>{r.ownerName ?? "—"}</span> },
    {
      key: "estimate",
      header: "Estimate",
      align: "right",
      render: (r) => <span className={cn(typography.bodySmall, "text-text-secondary")}>{r.estimatedValueCents !== null ? formatEstimate(r.estimatedValueCents) : "—"}</span>,
    },
  ];
  return (
    <div data-testid="pipeline-list">
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} />
    </div>
  );
}

/**
 * Growth -> Pipeline (NP-P2-S1). The workspace's PRIVATE-PAY sales conversations, read through plus_list_opportunities
 * (Plus read, re-checked in the database). Board (open stages) or list; search, stage, source and owner filters; Open /
 * Lost / All views. "New opportunity" only for Plus write capability. No Facility tab (P3), no conversion (P2-S4), no
 * metrics or sample cards.
 */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pathname = await getCurrentPathname("/operations/growth/pipeline");
  const { context, plus } = await requirePlusAccess(pathname);
  const params: PipelineParams = parsePipelineParams(await searchParams);
  const canWrite = canWriteGrowth(plus.state, plus.capability);
  const filtered = Boolean(params.search || params.stage || params.source || params.owner);

  let rows: OpportunityListRow[] | null = null;
  let total = 0;
  try {
    const page = await listOpportunities(context.organizationId, params);
    rows = page.rows;
    total = page.total;
  } catch {
    rows = null;
  }
  // Owner filter choices: Plus writers (the only people who can own an opportunity). Read-only viewers get no filter.
  let owners: OwnerOption[] = [];
  if (canWrite) {
    try {
      owners = await listOwnerOptions(context.organizationId);
    } catch {
      owners = [];
    }
  }
  const stageOptions =
    params.view === "lost"
      ? []
      : OPEN_STAGES.map((s) => ({ value: s, label: stageDisplayLabel(s) }));

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Pipeline"
        description="Private-pay sales conversations, from first inquiry to an accepted quote. Bookings are still created in Operations."
        breadcrumb={[{ label: "Growth", href: "/operations/growth" }, { label: "Pipeline" }]}
        actions={
          canWrite ? (
            <LinkButton href="/operations/growth/pipeline/new" leadingIcon={<Plus className="size-4" aria-hidden />} data-testid="pipeline-new">
              New opportunity
            </LinkButton>
          ) : undefined
        }
      />

      {isPlusReadOnly(plus.state) && (
        <AttentionState level="info" title="Nemryn Plus is not active" description="Your pipeline is kept and can be viewed. It can't be changed until Plus is active again." />
      )}

      {/* NP-UI-V2-3: the shared URL-driven ViewSwitch (D-5) in place of the hand-built links -- same views, same hrefs,
          aria-current on the active one; Board / List only for the open view, as before. */}
      <div className="flex flex-wrap items-center gap-x-zw-md gap-y-zw-sm" data-testid="pipeline-views">
        <ViewSwitch
          label="Pipeline views"
          activeKey={params.view}
          items={(["open", "lost", "all"] as const).map((v) => ({
            key: v,
            label: v === "open" ? "Open" : v === "lost" ? "Lost" : "All",
            href: pipelineHref(params, { view: v, stage: null, layout: v === "open" ? params.layout : "list" }),
          }))}
        />
        {params.view === "open" && (
          <ViewSwitch
            label="Pipeline layout"
            activeKey={params.layout}
            items={[
              { key: "board", label: "Board", href: pipelineHref(params, { layout: "board" }), testId: "layout-board" },
              { key: "list", label: "List", href: pipelineHref(params, { layout: "list" }), testId: "layout-list" },
            ]}
          />
        )}
        <p className={cn(typography.metadata, "text-text-muted")}>
          <span className="font-medium text-text-secondary">Private-pay</span> · Facility pipeline arrives in a later release
        </p>
      </div>

      {/* NP-UX-FILTER-01: the layout follows the FORM's own width (container query), not the viewport -- the sidebar
          expands / collapses independently, so a viewport breakpoint can leave too little room. One row only when the
          form is at least 64rem wide (Search keeps >= 15rem and can never collapse); otherwise Search takes a full row
          and Stage / Source / Owner share the next row (each >= 10rem), with Apply wrapping rather than shrinking. */}
      <form method="get" action="/operations/growth/pipeline" role="search" className="@container rounded-md border border-border-subtle bg-surface-elevated p-zw-md shadow-sm" data-testid="pipeline-filters">
        {params.view !== "open" && <input type="hidden" name="view" value={params.view} />}
        {params.view === "open" && params.layout === "list" && <input type="hidden" name="layout" value="list" />}
        <div className="flex flex-wrap items-end gap-zw-md">
          <div className="min-w-0 basis-full @5xl:min-w-60 @5xl:flex-1 @5xl:basis-60" data-testid="pipeline-filter-search">
            <Input name="q" label="Search" type="search" defaultValue={params.search} placeholder="Title or contact name" maxLength={200} />
          </div>
          {stageOptions.length > 0 && (
            <div className="min-w-40 flex-1 @5xl:w-48 @5xl:flex-none">
              <Select name="stage" label="Stage" options={[{ value: "", label: "All stages" }, ...stageOptions]} defaultValue={params.stage ?? ""} />
            </div>
          )}
          <div className="min-w-40 flex-1 @5xl:w-44 @5xl:flex-none">
            <Select name="source" label="Source" options={[{ value: "", label: "All sources" }, ...SOURCE_OPTIONS]} defaultValue={params.source ?? ""} />
          </div>
          {owners.length > 0 && (
            <div className="min-w-40 flex-1 @5xl:w-44 @5xl:flex-none">
              <Select name="owner" label="Owner" options={[{ value: "", label: "Anyone" }, ...owners.map((o) => ({ value: o.handle, label: o.isSelf ? `${o.name} (you)` : o.name }))]} defaultValue={params.owner ?? ""} />
            </div>
          )}
          <div className="flex shrink-0 gap-2">
            <Button type="submit" variant="outline">
              Apply
            </Button>
            {filtered && (
              <LinkButton href={pipelineHref(params, { search: "", stage: null, source: null, owner: null })} variant="text">
                Clear
              </LinkButton>
            )}
          </div>
        </div>
      </form>

      {rows === null ? (
        <AttentionState
          level="critical"
          title="The pipeline couldn't be loaded"
          description="Your filters are kept. Try again in a moment."
          action={
            <LinkButton href={pipelineHref(params)} variant="outline" size="sm">
              Retry
            </LinkButton>
          }
        />
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border-subtle bg-surface-elevated shadow-sm">
          <EmptyState
            icon={<Kanban className="size-6" aria-hidden />}
            title={filtered ? "No opportunities match these filters." : params.view === "lost" ? "No lost opportunities." : "No private-pay inquiries yet."}
            description={
              filtered
                ? "Try a different search, or clear the filters."
                : params.view === "lost"
                  ? "Opportunities marked as lost appear here and can be reopened."
                  : canWrite
                    ? "Record a new inquiry from someone in your contacts to start tracking it."
                    : "Opportunities your team records will appear here."
            }
            action={
              !filtered && canWrite && params.view === "open" ? (
                <LinkButton href="/operations/growth/pipeline/new" size="sm" variant="outline">
                  New opportunity
                </LinkButton>
              ) : undefined
            }
          />
        </div>
      ) : params.view === "open" && params.layout === "board" ? (
        <Board rows={rows} />
      ) : (
        <List rows={rows} />
      )}

      {rows && rows.length > 0 && (
        <p className={cn(typography.metadata, "text-text-muted")} data-testid="pipeline-count">
          {total} {total === 1 ? "opportunity" : "opportunities"}
          {total > PIPELINE_PAGE_SIZE ? ` · showing the ${PIPELINE_PAGE_SIZE} most recently updated; narrow the filters to see others` : ""}. {REPORTED_QUOTE_STAGE_NOTE}
        </p>
      )}
    </div>
  );
}
