import Link from "next/link";
import { WarningCircle, ClipboardText } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getProofOfServiceReview, PROOF_OF_SERVICE_PAGE_SIZE, type ProofOfServiceReviewResult, type ProofOfServiceReviewRow } from "@/lib/operations/trip-proof-of-service";
import { formatOperationsTime, proofOfServiceStateLabel, proofOfServiceStateCategory, proofOfServiceReasonLabel, proofOfServiceWindowLabel } from "@/lib/operations/presentation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ProofOfServiceWindowTabs, parseProofOfServiceWindowParam } from "@/components/operations/proof-of-service/ProofOfServiceWindowTabs";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/** URL input safety (P1-E3-S1D §34): a page number is never trusted beyond a small positive-integer, reasonably-bounded value — nothing from search params ever reaches organizationId/timezone/role/proof-state authority. */
const MAX_PAGE = 1000;

function parsePageParam(value: string | string[] | undefined): number {
  if (typeof value !== "string") return 1;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_PAGE);
}

/**
 * Proof-of-Service Assurance (P1-E3-S1D) — the first operator-facing
 * surface over the S1B/S1C evidence engine. Answers exactly one
 * question: "what completed transportation should I review before
 * moving it into my billing process?" This remains OPERATIONAL evidence
 * review — never a revenue amount, claim, invoice, payment, or payer-
 * compliance surface (none of that data exists in this schema yet — see
 * docs/reports/p1-e3-s1a-revenue-assurance-foundation-audit.txt).
 *
 * Reached directly at this route only — deliberately NOT added to the
 * permanent Operations sidebar and NOT integrated into Operations Brief
 * in this phase (S1D §3/§42 — both are S1F's own contextual-discovery
 * work, mirroring Tomorrow Readiness's own identical S4D-era precedent).
 *
 * Authorization comes entirely from the existing `/operations/*`
 * boundary: `requireOperationsAccess` here (this route's own page-level
 * call, matching every other Operations page) gates Organization Admin/
 * Dispatcher and redirects a Driver Membership to `/driver` before this
 * component ever renders — no second access model introduced.
 * `organizationId`/`organizationTimezone` come ONLY from that trusted
 * result, never from a search param (S1D §4/§34).
 *
 * All data comes from the ALREADY-PROVEN `getProofOfServiceReview`
 * (S1C) — this page renders that data and the S1B core's own already-
 * derived state/reasons, it never re-derives a Proof-of-Service judgment
 * itself (S1D §1's own explicit instruction).
 *
 * NO proof-state filter/tabs exist here (S1D §19): the S1C read model
 * paginates the completed-Trip set BEFORE any Proof-of-Service
 * evaluation runs, so a client-visible "17 need review" count or a
 * Needs-Review-only filter would either require a second, unbounded,
 * whole-window query this phase does not build, or would silently
 * mislead by reporting only what happens to be on the current page. The
 * MVP list is therefore a truthful chronological completed-Trip list
 * with a real per-row status — nothing more.
 */
export default async function ProofOfServicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pathname = await getCurrentPathname("/operations/proof-of-service");
  const organization = await requireOperationsAccess(pathname);
  const params = await searchParams;

  const window = parseProofOfServiceWindowParam(params.window);
  const page = parsePageParam(params.page);

  let data: ProofOfServiceReviewResult;
  try {
    data = await getProofOfServiceReview(organization.organizationId, organization.organizationTimezone, window, page);
  } catch {
    // S1D §29: query failure is never rendered as "0 completed trips" or
    // "all ready" — a contained page-level error state instead, matching
    // Tomorrow Readiness's own established "Couldn't load" pattern.
    // Unknown ≠ healthy.
    return (
      <div className="flex flex-col gap-zw-lg">
        <PageHeader title="Proof of Service" description="Review completed transportation before billing." />
        <Panel>
          <EmptyState
            icon={<WarningCircle className="size-8" aria-hidden />}
            title="Proof-of-service review unavailable"
            description="Something went wrong loading this review. Try refreshing the page in a moment."
          />
        </Panel>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.totalCount / PROOF_OF_SERVICE_PAGE_SIZE));
  const buildPageHref = (targetPage: number) => {
    const qp = new URLSearchParams();
    if (window !== "YESTERDAY") qp.set("window", window === "TODAY" ? "today" : "last-7-days");
    if (targetPage > 1) qp.set("page", String(targetPage));
    const qs = qp.toString();
    return qs ? `/operations/proof-of-service?${qs}` : "/operations/proof-of-service";
  };

  const columns: DataTableColumn<ProofOfServiceReviewRow>[] = [
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-col gap-1">
          <StatusBadge label={proofOfServiceStateLabel(row.result.state)} category={proofOfServiceStateCategory(row.result.state)} />
          {row.result.reasons.length > 0 && (
            <ul className={cn(typography.metadata, "flex flex-col gap-0.5 text-text-muted")}>
              {row.result.reasons.map((reason) => (
                <li key={reason}>· {proofOfServiceReasonLabel(reason)}</li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
    {
      key: "passenger",
      header: "Passenger",
      primary: true,
      render: (row) => row.passenger.displayName,
    },
    {
      key: "completed",
      header: "Completed",
      render: (row) => formatOperationsTime(row.completedAt, data.timezone),
    },
    {
      key: "route",
      header: "Route",
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate">{row.pickupDescription}</span>
          <span aria-hidden className="text-text-disabled">
            →
          </span>
          <span className="truncate">{row.destinationDescription}</span>
        </span>
      ),
    },
    {
      key: "driver",
      header: "Driver",
      render: (row) => row.performingDriver?.displayName ?? <span className="text-text-muted">Not recorded</span>,
    },
    {
      key: "vehicle",
      header: "Vehicle",
      render: (row) => row.performingVehicle?.label ?? <span className="text-text-muted">Not recorded</span>,
    },
    {
      key: "review",
      header: "",
      align: "right",
      render: (row) => (
        <Link href={`/operations/trips/${row.tripId}`} className={cn(typography.bodySmall, "text-text-link hover:underline")}>
          View trip →
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader title="Proof of Service" description="Review completed transportation before billing." />

      <ProofOfServiceWindowTabs active={window} />

      <DataTable
        columns={columns}
        rows={data.rows}
        getRowId={(row) => row.tripId}
        emptyState={
          <EmptyState
            icon={<ClipboardText className="size-8" aria-hidden />}
            title="No completed trips in this period."
            description="Completed transportation will appear here for service-evidence review."
          />
        }
      />

      {data.rows.length > 0 && (
        <div className={cn(typography.bodySmall, "flex items-center justify-between text-text-muted")}>
          <p>
            {proofOfServiceWindowLabel(window)} · Showing {(data.page - 1) * data.pageSize + 1}–
            {Math.min(data.page * data.pageSize, data.totalCount)} of {data.totalCount}
          </p>
          <div className="flex gap-2">
            {data.page > 1 && (
              <Link href={buildPageHref(data.page - 1)} className={cn(typography.button, "text-text-link hover:underline")}>
                Previous
              </Link>
            )}
            {data.page < totalPages && (
              <Link href={buildPageHref(data.page + 1)} className={cn(typography.button, "text-text-link hover:underline")}>
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
