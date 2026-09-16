import Link from "next/link";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getRequestsList, REQUESTS_LIST_PAGE_SIZE, parseRequestsListStateFilter } from "@/lib/operations/requests-list";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { SummaryStrip } from "@/components/ui/SummaryStrip";
import { AttentionState } from "@/components/ui/AttentionState";
import { RequestStatusTabs } from "@/components/operations/requests/RequestStatusTabs";
import { RequestsTable } from "@/components/operations/requests/RequestsTable";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Request Hub — the queue (P1-E1-S2D). Server-rendered, server-filtered
 * (plain GET query params — no client-side fetch, no JS required for
 * search/status-view to work), bounded pagination via `getRequestsList`,
 * mirroring the exact established shape `/operations/trips` (P1-E3-S8B1)
 * already proved out for this codebase, rather than inventing a second
 * list-page architecture.
 *
 * Request Detail does not exist until S2E — this page deliberately does
 * NOT link queue rows anywhere (§17); the one real action here is Log
 * Request, already fully built (S2C).
 */
export default async function RequestHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pathname = await getCurrentPathname("/operations/requests");
  const organization = await requireOperationsAccess(pathname);
  const params = await searchParams;

  const search = typeof params.q === "string" ? params.q : "";
  const state = parseRequestsListStateFilter(params.state);
  // Math.max(1, ...) mirrors getRequestsList's own internal clamp
  // (`Math.max(1, filters.page ?? 1)`) exactly, so this value is always
  // genuinely what the query will use — never a raw, unclamped
  // page=-5-style value that Retry/pagination could otherwise echo back.
  const page = Math.max(1, typeof params.page === "string" ? Number.parseInt(params.page, 10) || 1 : 1);

  // P1-E1-S2D-R2: the CURRENT validated Request Hub view (state/search/
  // page, already normalized above — an invalid `?state=bogus` has
  // already fallen back to "pending" by this point, exactly like an
  // invalid page already clamped to 1) — never raw, unvalidated
  // query-string content. Shared by the Retry action (failure state,
  // below) and by pagination's Previous/Next links (success state), so
  // there is exactly one place that knows how a Request Hub URL is
  // built. Only the three query params the page actually supports are
  // ever written; anything else in the original request URL is dropped.
  const buildRequestHubHref = (targetPage: number) => {
    const qp = new URLSearchParams();
    if (search) qp.set("q", search);
    if (state !== "pending") qp.set("state", state);
    if (targetPage > 1) qp.set("page", String(targetPage));
    const qs = qp.toString();
    return qs ? `/operations/requests?${qs}` : "/operations/requests";
  };

  const result = await getRequestsList(organization.organizationId, { search, state, page });

  // P1-E1-S2D-R1: a query failure must render a visibly different,
  // restrained operational error state — never an apparently-valid
  // empty queue (S2D's own live-testing found and fixed exactly this
  // failure mode once already; see the R1 report). Log Request stays
  // reachable in the header because it is a functionally independent
  // feature — an operator can still record a new request by phone even
  // while the QUEUE READ is failing.
  //
  // P1-E1-S2D-R2: Retry must re-run the SAME logical Request Hub view
  // that failed, not silently reset the operator to default Pending —
  // uses the exact validated state/search/page this render attempted,
  // via the same `buildRequestHubHref` the success path's own
  // pagination already relies on.
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-zw-lg">
        <PageHeader
          title="Request Hub"
          description="Review transportation requests and move them into trip planning."
          actions={
            <LinkButton href="/operations/requests/new" leadingIcon={<Plus className="size-4" aria-hidden />}>
              Log Request
            </LinkButton>
          }
        />
        <AttentionState
          level="critical"
          title="Unable to load requests"
          description="Request information could not be loaded. Try again."
          action={
            <LinkButton href={buildRequestHubHref(page)} variant="outline">
              Retry
            </LinkButton>
          }
        />
      </div>
    );
  }

  // "Active filters" for the empty-state distinction (§21/§10 of the
  // report) — a search term, or any status view OTHER than the true
  // default (Pending, no search), counts as a deliberate narrowing a
  // person applied, not the organization's own baseline state.
  const hasActiveFilters = search !== "" || state !== "pending";

  const totalPages = Math.max(1, Math.ceil(result.totalCount / REQUESTS_LIST_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Request Hub"
        description="Review transportation requests and move them into trip planning."
        actions={
          <LinkButton href="/operations/requests/new" leadingIcon={<Plus className="size-4" aria-hidden />}>
            Log Request
          </LinkButton>
        }
      />

      {/* A single real figure, never a decorative KPI tile (P1-E1-S2D
          §9) — always the organization's true total pending count,
          independent of whichever status view is currently open. */}
      <SummaryStrip items={[{ label: "pending", value: result.pendingCount, tone: result.pendingCount > 0 ? "warning" : "default" }]} inline />

      <RequestStatusTabs active={state} search={search} />

      <form method="get" className="max-w-md">
        {state !== "pending" && <input type="hidden" name="state" value={state} />}
        <SearchInput name="q" label="Search requests" placeholder="Search by name or phone" defaultValue={search} />
        <Button type="submit" className="sr-only">
          Search
        </Button>
      </form>

      <RequestsTable
        rows={result.rows}
        hasActiveFilters={hasActiveFilters}
        organizationHasAnyRequests={result.organizationHasAnyRequests}
        now={new Date()}
      />

      {result.rows.length > 0 && (
        <div className={cn(typography.bodySmall, "flex items-center justify-between text-text-muted")}>
          <p>
            Showing {(result.page - 1) * result.pageSize + 1}–{Math.min(result.page * result.pageSize, result.totalCount)} of {result.totalCount}
          </p>
          <div className="flex gap-2">
            {result.page > 1 && (
              <Link href={buildRequestHubHref(result.page - 1)} className={cn(typography.button, "text-text-link hover:underline")}>
                Previous
              </Link>
            )}
            {result.page < totalPages && (
              <Link href={buildRequestHubHref(result.page + 1)} className={cn(typography.button, "text-text-link hover:underline")}>
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
