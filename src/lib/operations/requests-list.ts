import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type RequestsListStateFilter = "pending" | "accepted" | "declined" | "cancelled" | "all";

const VALID_STATE_FILTERS: RequestsListStateFilter[] = ["pending", "accepted", "declined", "cancelled", "all"];

/** Unknown/malformed values fall back to "pending" (P1-E1-S2D §7) — never trusted as-is into a query. */
export function parseRequestsListStateFilter(value: unknown): RequestsListStateFilter {
  return typeof value === "string" && (VALID_STATE_FILTERS as string[]).includes(value)
    ? (value as RequestsListStateFilter)
    : "pending";
}

export interface RequestsListFilters {
  search?: string;
  state?: RequestsListStateFilter;
  page?: number;
}

export interface RequestsListRow {
  id: string;
  requesterName: string;
  passengerId: string | null;
  passengerName: string | null;
  /** The linked Passenger's own current active status — false (never assumed true) when passengerId is null. Required for readiness (P1-E1-S2D §13 — never derived from passengerId presence alone). */
  passengerActive: boolean;
  /** Whether at least one Trip exists for this Request (P1-OPS-R1 readiness: "Trip created" vs "Ready to schedule"). */
  hasLinkedTrips: boolean;
  pickupDescription: string;
  destinationDescription: string;
  preferredDate: string | null;
  preferredTime: string | null;
  state: string;
  createdAt: string;
  updatedAt: string;
}

export interface RequestsListSuccess {
  ok: true;
  rows: RequestsListRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  /** The organization's total pending count, independent of the currently selected view/filters — powers the persistent "N pending" summary (P1-E1-S2D §9), never recomputed as "however many pending rows happen to be on THIS page". */
  pendingCount: number;
  /** Whether this organization has EVER had any Request at all, regardless of the current view/search — the one signal that distinguishes "brand-new organization, nothing logged yet" (empty state A) from "caught up right now, but history exists" (empty state B) or "this specific filter/search matched nothing" (empty state C). Never inferred from `rows.length === 0` alone, which is true in all three cases. */
  organizationHasAnyRequests: boolean;
}

/**
 * (P1-E1-S2D-R1) Which of the four queries this call depends on actually
 * failed — never shown to the operator (§5's copy is fixed and generic),
 * used only for server-side diagnostic logging (§9) so a failure can be
 * narrowed down without exposing raw PostgREST detail.
 */
export type RequestsListErrorCode =
  | "requests_query_failed"
  | "pending_count_failed"
  | "org_total_count_failed"
  | "passenger_search_failed";

export interface RequestsListFailure {
  ok: false;
  errorCode: RequestsListErrorCode;
}

/**
 * Every query this helper depends on (main rows+count, pending count,
 * organization-total count, and — when a search term is present —
 * Passenger-id resolution) is required to present the page's
 * authoritative state (the "N pending" figure, the empty-state A/B/C
 * distinction, and the row set itself). P1-E1-S2D-R1: a failure in ANY
 * one of them is a page-level load failure, not a degraded-but-valid
 * render — `rows: []` must never be reachable from a query error, only
 * from a query that genuinely succeeded with zero matching rows. See
 * docs/reports/p1-e1-s2d-r1-request-queue-fail-visible-errors.txt.
 */
export type RequestsListResult = RequestsListSuccess | RequestsListFailure;

/** Operation name + a safe (non-PII) error code only — never the raw Postgres/PostgREST message, which can occasionally echo back filter values. */
function logRequestsListFailure(operation: string, error: { code?: string } | null): void {
  console.error(`[requests-list] ${operation} failed`, { code: error?.code ?? "unknown" });
}

export const REQUESTS_LIST_PAGE_SIZE = 25;

interface RequestRow {
  id: string;
  requester_name: string;
  passenger_id: string | null;
  pickup_description: string;
  destination_description: string;
  preferred_date: string | null;
  preferred_time: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  passengers: { display_name: string; status: string } | { display_name: string; status: string }[] | null;
  /** At most one row (limited on the referenced table) — existence only, for readiness. */
  trips: { id: string }[] | null;
}

function unwrapPassenger(value: RequestRow["passengers"]): { display_name: string; status: string } | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * The canonical Request Hub queue query (P1-E1-S2D). Mirrors
 * trips-list.ts's own established shape closely: bounded, server-side
 * pagination (REQUESTS_LIST_PAGE_SIZE per page via `range()`) — never an
 * unbounded historical load; every filter (search, state) resolved to a
 * real database condition BEFORE pagination, never a client-side
 * re-filter on an already-paginated page (the exact correctness bug
 * trips-list.ts's own doc comment already found and fixed once —
 * avoided here by construction, not merely by caution).
 *
 * organization_id is explicitly filtered as the application's own
 * intended context on every query (never relying on RLS alone, even
 * though RLS independently enforces the same scoping as defense in
 * depth — matching every other list helper in this codebase).
 *
 * The Passenger relationship is embedded directly
 * (`passengers!transportation_requests_passenger_id_organization_id_fkey(display_name, status)`)
 * in the SAME query — one round trip, not two — which also happens to
 * give readiness exactly the `status` field it needs (P1-E1-S2D §13)
 * with no extra query. The explicit FK-name hint is required (not
 * cosmetic): `transportation_requests` carries TWO foreign keys to
 * `passengers` (a plain `passenger_id_fkey` and the composite,
 * tenant-safe `passenger_id_organization_id_fkey`), so an unqualified
 * `passengers(...)` embed is genuinely ambiguous to PostgREST
 * (PGRST201) and fails closed — the query errors and `getRequestsList`
 * silently returned zero rows despite the independent count queries
 * still succeeding, a real bug caught only by live-testing against the
 * local database, not by typecheck/lint/build. Matches the same
 * composite-FK hint convention already used by
 * `dispatch-board.ts`/`todays-operations.ts`/`trip-detail.ts` for the
 * analogous `trips` → `passengers` embed. Search across the embedded
 * Passenger's own columns still requires the two-phase resolve-then-
 * filter technique trips-list.ts already established (PostgREST cannot
 * `.or()` filter across an embedded relation's columns in the same call
 * as the top-level table's own columns).
 */
export async function getRequestsList(organizationId: string, filters: RequestsListFilters): Promise<RequestsListResult> {
  const supabase = await createServerSupabaseClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = REQUESTS_LIST_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const state = filters.state ?? "pending";

  // A search term may match the Request's OWN requester_name/phone OR
  // the linked Passenger's display_name/phone — two different tables,
  // same two-phase discipline as trips-list.ts's own passenger-name
  // search: resolve matching Passenger ids first (one small, org-scoped
  // query), then fold them into the same server-side `.or()` filter as
  // the Request's own columns. P1-E1-S2D-R1 (§7): if THIS query fails,
  // it must never be silently treated as "zero Passengers matched" —
  // that would quietly narrow/hide legitimate search results with no
  // indication anything went wrong. Fail the whole page load instead.
  const search = filters.search?.trim().slice(0, 200);
  let passengerIds: string[] = [];
  if (search) {
    const { data: matchingPassengers, error: searchError } = await supabase
      .from("passengers")
      .select("id")
      .eq("organization_id", organizationId)
      .or(`display_name.ilike.%${search}%,phone.ilike.%${search}%`);
    if (searchError) {
      logRequestsListFailure("passenger_search", searchError);
      return { ok: false, errorCode: "passenger_search_failed" };
    }
    passengerIds = (matchingPassengers ?? []).map((p) => p.id);
  }

  let query = supabase
    .from("transportation_requests")
    .select(
      "id, requester_name, passenger_id, pickup_description, destination_description, preferred_date, preferred_time, state, created_at, updated_at, passengers!transportation_requests_passenger_id_organization_id_fkey(display_name, status), trips(id)",
      { count: "exact" },
    )
    .eq("organization_id", organizationId)
    .limit(1, { referencedTable: "trips" });

  if (state !== "all") {
    query = query.eq("state", state);
  }

  if (search) {
    const orParts = [`requester_name.ilike.%${search}%`, `requester_phone.ilike.%${search}%`];
    if (passengerIds.length > 0) {
      orParts.push(`passenger_id.in.(${passengerIds.join(",")})`);
    }
    query = query.or(orParts.join(","));
  }

  // LOCKED ordering rule (P1-E1-S2D §8): Pending = oldest-waiting-demand
  // first (created_at ascending) — matches the table's own pre-existing
  // (organization_id, state, created_at) index intent exactly. Every
  // other view (Accepted/Declined/Cancelled/All) = most-recently-changed
  // first (updated_at descending), so a historical view surfaces what
  // just happened, not what happened longest ago.
  if (state === "pending") {
    query = query.order("created_at", { ascending: true });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  query = query.range(from, to);

  // P1-E1-S2D-R1 (§2/§6): this is the exact query whose PostgREST
  // relationship-ambiguity failure (S2D's own live-testing find) used
  // to be swallowed into `rows: []` — indistinguishable from a genuine
  // empty queue. A query error now fails the whole page load instead of
  // rendering an apparently-valid zero-row table.
  const { data, error, count } = await query;
  if (error || !data) {
    logRequestsListFailure("requests_query", error);
    return { ok: false, errorCode: "requests_query_failed" };
  }

  // Independent of the current view/filters — the persistent "N
  // pending" summary always reflects the organization's REAL total
  // pending count, never "however many pending rows happen to be on
  // this page" (which would be wrong the moment a filter or page other
  // than page 1/Pending is active). P1-E1-S2D-R1 (§6): this query's own
  // failure must not silently render "0 pending" — that would be a
  // fabricated fact, not a genuine zero.
  const { count: pendingCount, error: pendingCountError } = await supabase
    .from("transportation_requests")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("state", "pending");
  if (pendingCountError || pendingCount === null) {
    logRequestsListFailure("pending_count", pendingCountError);
    return { ok: false, errorCode: "pending_count_failed" };
  }

  // Same reasoning, for the empty-state distinction (A vs. B/C) — a
  // single cheap head-only count, no state/search filter, organization-
  // scoped only. P1-E1-S2D-R1 (§6): a failure here must not silently
  // resolve to `organizationHasAnyRequests: false`, which would
  // incorrectly render empty-state A (brand-new organization) — a
  // materially misleading claim when the truth is simply unknown.
  const { count: organizationTotalCount, error: orgTotalError } = await supabase
    .from("transportation_requests")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (orgTotalError || organizationTotalCount === null) {
    logRequestsListFailure("org_total_count", orgTotalError);
    return { ok: false, errorCode: "org_total_count_failed" };
  }

  const rows: RequestsListRow[] = (data as unknown as RequestRow[]).map((row) => {
    const passenger = unwrapPassenger(row.passengers);
    return {
      id: row.id,
      requesterName: row.requester_name,
      passengerId: row.passenger_id,
      passengerName: passenger?.display_name ?? null,
      passengerActive: passenger?.status === "active",
      hasLinkedTrips: (row.trips ?? []).length > 0,
      pickupDescription: row.pickup_description,
      destinationDescription: row.destination_description,
      preferredDate: row.preferred_date,
      preferredTime: row.preferred_time,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return {
    ok: true,
    rows,
    totalCount: count ?? rows.length,
    page,
    pageSize,
    pendingCount,
    organizationHasAnyRequests: organizationTotalCount > 0,
  };
}
