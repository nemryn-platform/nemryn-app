import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { CandidateCoverage, OverlapCandidate } from "./trip-overlap-core";

/**
 * Complete, paginated overlap candidate retrieval (P1-OPS-PROG4B-R1).
 *
 * PostgREST silently caps every response at the project's `max_rows`
 * (supabase/config.toml: 1000) whatever `.limit()` asks for, and a capped
 * response is indistinguishable from a naturally short one. So candidates
 * are never read in one request: each query family is read in
 * KEYSET pages of OVERLAP_CANDIDATE_PAGE_SIZE rows, ordered by
 * (scheduled_pickup_at, id) -- a total order, so no row is duplicated or
 * skipped between pages -- until a page comes back SHORTER than the page
 * size (proof of exhaustion). OVERLAP_CANDIDATE_PAGE_SIZE must stay <=
 * max_rows, or a capped page would read as the last one.
 *
 * Family C (P1-OPS-PROG4B-R2) has no start time to order by, so it is paged
 * by `id` alone (unique, so equally a total order).
 *
 * A family that is still returning full pages at OVERLAP_CANDIDATE_MAX_PAGES
 * stops and reports coverage "incomplete" -- never silently sliced. An
 * incomplete set can never produce "clear" (see deriveResourceOverlap).
 *
 * No runtime imports: the caller injects the session (RLS) client, so this
 * module is exercised directly by the local integration check.
 */

export const OVERLAP_CANDIDATE_PAGE_SIZE = 500;
/** Safety ceiling per family: 20 × 500 = 10,000 non-terminal trips. Reaching it means "incomplete", not "done". */
export const OVERLAP_CANDIDATE_MAX_PAGES = 20;

const NON_TERMINAL = [
  "scheduled",
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
];

export interface KeysetCursor {
  scheduledPickupAt: string;
  id: string;
}

export interface KeysetPagesResult<R> {
  rows: R[];
  complete: boolean;
  pages: number;
}

/**
 * Reads keyset pages until one is shorter than `pageSize` (complete) or
 * `maxPages` full pages have been read (incomplete -- more rows may exist).
 * `cursorOf` turns the last row of a full page into the next page's cursor.
 */
export async function collectPages<R, C>(
  fetchPage: (cursor: C | null, pageSize: number) => Promise<R[]>,
  options: { pageSize: number; maxPages: number },
  cursorOf: (last: R) => C,
): Promise<KeysetPagesResult<R>> {
  const rows: R[] = [];
  let cursor: C | null = null;
  for (let page = 1; page <= options.maxPages; page++) {
    const batch = await fetchPage(cursor, options.pageSize);
    rows.push(...batch);
    if (batch.length < options.pageSize) return { rows, complete: true, pages: page };
    cursor = cursorOf(batch[batch.length - 1]);
  }
  return { rows, complete: false, pages: options.maxPages };
}

/** Families A / B: keyset on (scheduled_pickup_at, id). */
export function collectKeysetPages<R extends { id: string; scheduled_pickup_at: string | null }>(
  fetchPage: (cursor: KeysetCursor | null, pageSize: number) => Promise<R[]>,
  options: { pageSize: number; maxPages: number },
): Promise<KeysetPagesResult<R>> {
  return collectPages(fetchPage, options, (last) => {
    if (last.scheduled_pickup_at === null) throw new Error("Overlap candidate page ended on a row without a scheduled pickup");
    return { scheduledPickupAt: last.scheduled_pickup_at, id: last.id };
  });
}

/** Family C: keyset on id alone (no start time to order by). */
export function collectIdPages<R extends { id: string }>(
  fetchPage: (afterId: string | null, pageSize: number) => Promise<R[]>,
  options: { pageSize: number; maxPages: number },
): Promise<KeysetPagesResult<R>> {
  return collectPages(fetchPage, options, (last) => last.id);
}

/** PostgREST keyset predicate: strictly after (scheduled_pickup_at, id). Values are quoted (timestamps contain reserved characters). */
export function keysetAfterFilter(cursor: KeysetCursor): string {
  return `scheduled_pickup_at.gt."${cursor.scheduledPickupAt}",and(scheduled_pickup_at.eq."${cursor.scheduledPickupAt}",id.gt."${cursor.id}")`;
}

interface CandidateRow {
  id: string;
  state: string;
  scheduled_pickup_at: string | null;
  expected_duration_minutes: number | null;
  pickup_description: string;
  destination_description: string;
  trip_assignments: { driver_id: string; vehicle_id: string | null; ended_at: string | null }[] | null;
}

/** Family C rows: the minimum the derivation needs -- no route, passenger or other trip detail. */
interface SchedulelessRow {
  id: string;
  state: string;
  scheduled_pickup_at: null;
  expected_duration_minutes: number | null;
  trip_assignments: { driver_id: string; vehicle_id: string | null; ended_at: string | null }[] | null;
}

export interface CandidateDetails {
  scheduledPickupAt: string | null;
  expectedDurationMinutes: number | null;
  pickup: string;
  destination: string;
}

export interface CandidateSet {
  candidates: OverlapCandidate[];
  /** Route + timing facts for listing a candidate in the UI (same tenant only; families A / B -- Family C trips can never be a known overlap). */
  details: Map<string, CandidateDetails>;
  /** "incomplete" when any family hit the safety ceiling: callers must not derive "clear" from it. */
  coverage: CandidateCoverage;
  /** Technical facts for logs / reports only -- never operator copy. */
  diagnostics: {
    windowRows: number;
    windowPages: number;
    windowComplete: boolean;
    stillOpenRows: number;
    stillOpenPages: number;
    stillOpenComplete: boolean;
    schedulelessRows: number;
    schedulelessPages: number;
    schedulelessComplete: boolean;
  };
}

const COLUMNS = "id, state, scheduled_pickup_at, expected_duration_minutes, pickup_description, destination_description, ";

/**
 * The candidate set for [fromMs, toMs), as three query FAMILIES (never one
 * query per trip), all organization-scoped on the caller's session client:
 *   A. non-terminal trips starting in [from − lookback, to), active
 *      assignment left-joined;
 *   B. OLDER non-terminal trips (start < from − lookback) that still hold an
 *      active assignment (inner join) -- still-open commitments (Q7);
 *   C. non-terminal trips with NO pickup time that hold an active assignment
 *      (inner join) -- commitments with unknown timing (R2). Neither A nor B
 *      can return them: their range filters on scheduled_pickup_at are never
 *      true for NULL.
 * Terminal trips and ended assignments are never fetched.
 */
export async function loadOverlapCandidates(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  fromMs: number,
  toMs: number,
  options: { lookbackMs: number; pageSize?: number; maxPages?: number },
): Promise<CandidateSet> {
  const pageOptions = {
    pageSize: options.pageSize ?? OVERLAP_CANDIDATE_PAGE_SIZE,
    maxPages: options.maxPages ?? OVERLAP_CANDIDATE_MAX_PAGES,
  };
  const lookbackIso = new Date(fromMs - options.lookbackMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  const windowFamily = (cursor: KeysetCursor | null, pageSize: number) => {
    let query = supabase
      .from("trips")
      .select(COLUMNS + "trip_assignments!trip_assignments_trip_id_organization_id_fkey(driver_id, vehicle_id, ended_at)")
      .eq("organization_id", organizationId)
      .in("state", NON_TERMINAL)
      .gte("scheduled_pickup_at", lookbackIso)
      .lt("scheduled_pickup_at", toIso)
      .is("trip_assignments.ended_at", null);
    if (cursor) query = query.or(keysetAfterFilter(cursor));
    return run(query.order("scheduled_pickup_at", { ascending: true }).order("id", { ascending: true }).limit(pageSize), "overlap candidates");
  };
  const stillOpenFamily = (cursor: KeysetCursor | null, pageSize: number) => {
    let query = supabase
      .from("trips")
      .select(COLUMNS + "trip_assignments!trip_assignments_trip_id_organization_id_fkey!inner(driver_id, vehicle_id, ended_at)")
      .eq("organization_id", organizationId)
      .in("state", NON_TERMINAL)
      .lt("scheduled_pickup_at", lookbackIso)
      .is("trip_assignments.ended_at", null);
    if (cursor) query = query.or(keysetAfterFilter(cursor));
    return run(query.order("scheduled_pickup_at", { ascending: true }).order("id", { ascending: true }).limit(pageSize), "still-open candidates");
  };

  const schedulelessFamily = async (afterId: string | null, pageSize: number) => {
    let query = supabase
      .from("trips")
      .select("id, state, scheduled_pickup_at, expected_duration_minutes, trip_assignments!trip_assignments_trip_id_organization_id_fkey!inner(driver_id, vehicle_id, ended_at)")
      .eq("organization_id", organizationId)
      .in("state", NON_TERMINAL)
      .is("scheduled_pickup_at", null)
      .is("trip_assignments.ended_at", null);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query.order("id", { ascending: true }).limit(pageSize);
    if (error) throw new Error(`Failed to load scheduleless candidates: ${error.message}`);
    return (data ?? []) as unknown as SchedulelessRow[];
  };

  const [windowResult, stillOpenResult, schedulelessResult] = await Promise.all([
    collectKeysetPages(windowFamily, pageOptions),
    collectKeysetPages(stillOpenFamily, pageOptions),
    collectIdPages(schedulelessFamily, pageOptions),
  ]);

  const candidates: OverlapCandidate[] = [];
  const details: CandidateSet["details"] = new Map();
  for (const row of [...windowResult.rows, ...stillOpenResult.rows]) {
    if (details.has(row.id)) continue;
    const active = (row.trip_assignments ?? []).find((a) => a.ended_at === null) ?? null;
    candidates.push({
      tripId: row.id,
      state: row.state,
      scheduledPickupAt: row.scheduled_pickup_at,
      expectedDurationMinutes: row.expected_duration_minutes,
      activeDriverId: active?.driver_id ?? null,
      activeVehicleId: active?.vehicle_id ?? null,
    });
    details.set(row.id, {
      scheduledPickupAt: row.scheduled_pickup_at,
      expectedDurationMinutes: row.expected_duration_minutes,
      pickup: row.pickup_description,
      destination: row.destination_description,
    });
  }
  const seen = new Set(details.keys());
  for (const row of schedulelessResult.rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const active = (row.trip_assignments ?? []).find((a) => a.ended_at === null) ?? null;
    candidates.push({
      tripId: row.id,
      state: row.state,
      scheduledPickupAt: null,
      expectedDurationMinutes: row.expected_duration_minutes,
      activeDriverId: active?.driver_id ?? null,
      activeVehicleId: active?.vehicle_id ?? null,
    });
  }
  return {
    candidates,
    details,
    coverage: windowResult.complete && stillOpenResult.complete && schedulelessResult.complete ? "complete" : "incomplete",
    diagnostics: {
      windowRows: windowResult.rows.length,
      windowPages: windowResult.pages,
      windowComplete: windowResult.complete,
      stillOpenRows: stillOpenResult.rows.length,
      stillOpenPages: stillOpenResult.pages,
      stillOpenComplete: stillOpenResult.complete,
      schedulelessRows: schedulelessResult.rows.length,
      schedulelessPages: schedulelessResult.pages,
      schedulelessComplete: schedulelessResult.complete,
    },
  };
}

async function run(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<CandidateRow[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load ${label}: ${error.message}`);
  return (data ?? []) as CandidateRow[];
}
