import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { organizationDayBoundsUtc, localDateKey, addDaysToDateKey, localMidnightUtc } from "./day-bounds";
import { deriveTripProofOfService, type TripProofOfServiceFacts, type TripProofOfServiceResult } from "./trip-proof-of-service-core";
import {
  evaluateLifecycleEventChain,
  extractLifecycleEventTimestamps,
  classifyCompletionAssignmentCardinality,
  REQUIRED_LIFECYCLE_EVENT_TYPES,
  type LifecycleEventFact,
  type RequiredLifecycleEventType,
} from "./trip-proof-of-service-evidence";

/**
 * Server-side data-access boundary for Proof-of-Service Assurance
 * (P1-E3-S1C, following the P1-E3-S1B pure core). Answers: "for
 * COMPLETED Trips in the requested organization-local review window,
 * what execution evidence does Nemryn actually possess, and what does
 * the Proof-of-Service core conclude for each one?"
 *
 * READ-ONLY, DATA ONLY — no UI, no Operations Brief integration, no Trip
 * Detail change, no mutation, no correction path of any kind (S1C's own
 * explicit boundary; S1D owns the operator-facing review surface).
 *
 * COMPOSITION, NEVER REIMPLEMENTATION (S1C §2/§20): this module's only
 * job is DB facts -> TripProofOfServiceFacts -> deriveTripProofOfService
 * -> presentation-ready rows. No READY_FOR_REVIEW/NEEDS_REVIEW/reason
 * decision is made anywhere in this file — every one of those decisions
 * lives exclusively in `trip-proof-of-service-core.ts` (S1B, unmodified)
 * and the lifecycle-chain/cardinality NORMALIZATION helpers each live in
 * `trip-proof-of-service-evidence.ts` (this phase's own pure module,
 * independently unit-tested).
 *
 * AUTHORIZATION PATTERN (audited, not invented — see tomorrow-
 * readiness.ts's own identical doc-comment section): every existing
 * Operations data-access module in this codebase takes
 * `organizationId`/`timezone` as PLAIN PARAMETERS; none of them call
 * `requireOperationsAccess` internally. This module follows that exact
 * same established convention — the CALLING PAGE (S1D) is responsible
 * for resolving organization access via `requireOperationsAccess`
 * (Organization Admin / Dispatcher only — Driver is redirected to
 * `/driver` by that helper before ever reaching this module) and passing
 * the result down. `organizationId` must never be sourced from a
 * browser-supplied value by any future caller.
 */

export type ProofOfServiceReviewWindow = "TODAY" | "YESTERDAY" | "LAST_7_DAYS";

/** Matches `TRIPS_LIST_PAGE_SIZE`'s own established magnitude (trips-list.ts) — Today/Yesterday are naturally small; Last 7 Days is the one window that could genuinely exceed it, so bounded server-side pagination applies uniformly rather than only to that one case. */
export const PROOF_OF_SERVICE_PAGE_SIZE = 25;

// =============================================================================
// WHOLE-WINDOW SUMMARY (P1-E3-S1F) — a SEPARATE query path from
// `getProofOfServiceReview` above. The Brief needs an AUTHORITATIVE
// count across the entire Yesterday window, never a page-1-only count
// (S1D deliberately did not build this — the review page's own
// pagination runs BEFORE Proof-of-Service evaluation, so summing only
// the first page would silently misrepresent the true whole-window
// total). This path fetches every completed Trip in the window (chunked
// — see below), evaluates each one through the SAME
// `deriveTripProofOfService` core, and returns the full per-Trip result
// array for `operations-brief.ts` to reduce via
// `deriveProofOfServiceSummary` (operations-brief-core.ts) — never a
// second Proof-of-Service evaluator.
// =============================================================================

/** Matches `supabase/config.toml`'s own configured `max_rows = 1000` — PostgREST silently caps ANY query's returned rows at this value regardless of what `.range()` requests, so the whole-window Trip fetch is explicitly paginated at this exact size rather than assuming a single unbounded `.select()` would return everything. */
const WHOLE_WINDOW_TRIP_PAGE_SIZE = 1000;

/** Conservative headroom for the evidence queries (assignments/events/exceptions), chunked by Trip id: `trip_events` can return up to the 6 `REQUIRED_LIFECYCLE_EVENT_TYPES` rows per Trip, so 150 × 6 = 900 stays safely under the 1000-row `max_rows` cap even before accounting for any anomalous duplicate-event data — and the truncation guard below still catches it if a chunk somehow exceeds that anyway, rather than trusting the arithmetic alone. */
const WHOLE_WINDOW_ID_CHUNK_SIZE = 150;

/**
 * A generous ceiling past any realistic single-organization daily
 * completed-Trip volume for this product (docs/product/product-
 * definition.md's own small/mid NEMT operator framing — nowhere near
 * this scale is anticipated). If the window's own authoritative
 * PostgREST-reported count ever exceeds this, the summary returns
 * `"unavailable"` rather than silently truncating the window and
 * reporting a false whole-window count (S1F §9's own explicit
 * "truthfulness > convenience" instruction) — chunked fetching itself
 * has no inherent upper bound, this cap exists purely as a defensive
 * backstop against a genuinely pathological/corrupted scenario.
 */
const WHOLE_WINDOW_SAFETY_CAP = 5000;

interface WholeWindowTripFact {
  id: string;
  completedAt: string | null;
  hasPickup: boolean;
  hasDestination: boolean;
  hasPassenger: boolean;
}

/** Deliberately narrower than `TripRow` above (no `scheduled_pickup_at`) — the whole-window summary query never selects it, since the summary never presents a scheduled time anywhere. */
interface WholeWindowTripRow {
  id: string;
  completed_at: string | null;
  pickup_description: string;
  destination_description: string;
  passengers: PassengerRelation;
}

export type ProofOfServiceWholeWindowFetchResult =
  | { status: "ok"; results: TripProofOfServiceResult[] }
  | { status: "unavailable" };

/**
 * Fetches and evaluates EVERY completed Trip in Yesterday's organization-
 * local calendar window — never page-1-limited, never silently truncated.
 *
 * QUERY ARCHITECTURE (S1F §8): lighter than `getProofOfServiceReview`'s
 * own paginated row query — no Passenger display name, no Driver/Vehicle
 * name/label embeds (the summary only ever needs COUNTS, never
 * presentation labels).
 *   1. Trip candidates, chunked by `WHOLE_WINDOW_TRIP_PAGE_SIZE`
 *      (matching the server's own configured `max_rows`), each page
 *      requesting `{ count: "exact" }` so the TRUE window total is known
 *      from PostgREST itself, independent of any single page's own row
 *      count. The safety cap is checked against this authoritative total
 *      before any further fetching occurs.
 *   2-4. Completion assignments (`end_reason = 'trip_completed'` only —
 *      the same S1C-established authority), required lifecycle events,
 *      and open exceptions — each issued once PER ID-CHUNK (never once
 *      per Trip — this is chunking, not N+1), each also requesting
 *      `{ count: "exact" }` so a silent `max_rows` truncation within a
 *      chunk is directly detectable (returned row count ≠ that query's
 *      own authoritative count) rather than assumed safe from the chunk
 *      arithmetic alone.
 *
 * Any query error, any detected truncation, or the safety-cap trip all
 * collapse to `{ status: "unavailable" }` — never a partial or estimated
 * count (S1F §11 — "Unknown ≠ healthy").
 */
export async function getYesterdayProofOfServiceResults(
  organizationId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<ProofOfServiceWholeWindowFetchResult> {
  const { startUtc, endUtc } = computeYesterdayBoundsUtc(now, timezone);
  const startIso = startUtc.toISOString();
  const endIso = endUtc.toISOString();

  const supabase = await createServerSupabaseClient();

  const tripFacts: WholeWindowTripFact[] = [];
  let offset = 0;
  let expectedTotal: number | null = null;

  while (true) {
    const { data, error, count } = await supabase
      .from("trips")
      .select(
        "id, completed_at, pickup_description, destination_description, " +
          "passengers!trips_passenger_id_organization_id_fkey(id)",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .eq("state", "completed")
      .gte("completed_at", startIso)
      .lt("completed_at", endIso)
      .order("id", { ascending: true })
      .range(offset, offset + WHOLE_WINDOW_TRIP_PAGE_SIZE - 1)
      .returns<WholeWindowTripRow[]>();

    if (error) {
      return { status: "unavailable" };
    }

    if (expectedTotal === null) {
      expectedTotal = count ?? 0;
      if (expectedTotal > WHOLE_WINDOW_SAFETY_CAP) {
        return { status: "unavailable" };
      }
    }

    const rows = data ?? [];
    for (const row of rows) {
      const passenger = unwrapOne(row.passengers);
      tripFacts.push({
        id: row.id,
        completedAt: row.completed_at,
        hasPickup: isNonBlank(row.pickup_description),
        hasDestination: isNonBlank(row.destination_description),
        hasPassenger: passenger !== null,
      });
    }

    offset += WHOLE_WINDOW_TRIP_PAGE_SIZE;
    if (rows.length < WHOLE_WINDOW_TRIP_PAGE_SIZE) break;
  }

  // The accumulated set must exactly match PostgREST's own authoritative
  // total from the first page — a mismatch means the underlying data
  // shifted between pages or a page was silently short, either of which
  // makes this no longer a trustworthy whole-window count.
  if (expectedTotal !== null && tripFacts.length !== expectedTotal) {
    return { status: "unavailable" };
  }

  if (tripFacts.length === 0) {
    return { status: "ok", results: [] };
  }

  const tripIds = tripFacts.map((t) => t.id);
  const assignmentsByTrip = new Map<string, { vehicleId: string | null }[]>();
  const eventsByTrip = new Map<string, LifecycleEventFact[]>();
  const exceptionCountByTrip = new Map<string, number>();

  for (let i = 0; i < tripIds.length; i += WHOLE_WINDOW_ID_CHUNK_SIZE) {
    const chunk = tripIds.slice(i, i + WHOLE_WINDOW_ID_CHUNK_SIZE);

    const [assignmentsResult, eventsResult, exceptionsResult] = await Promise.all([
      supabase
        .from("trip_assignments")
        .select("trip_id, vehicle_id", { count: "exact" })
        .eq("organization_id", organizationId)
        .eq("end_reason", "trip_completed")
        .in("trip_id", chunk),
      supabase
        .from("trip_events")
        .select("trip_id, event_type, occurred_at", { count: "exact" })
        .eq("organization_id", organizationId)
        .in("trip_id", chunk)
        .in("event_type", REQUIRED_LIFECYCLE_EVENT_TYPES as unknown as string[]),
      supabase
        .from("trip_exceptions")
        .select("trip_id", { count: "exact" })
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .in("trip_id", chunk),
    ]);

    if (assignmentsResult.error || eventsResult.error || exceptionsResult.error) {
      return { status: "unavailable" };
    }

    const assignmentRows = assignmentsResult.data ?? [];
    const eventRows = eventsResult.data ?? [];
    const exceptionRows = exceptionsResult.data ?? [];

    // Truncation guard: if this chunk's own `max_rows` cap silently cut
    // off any of these 3 queries, the returned row count would fall
    // short of that SAME query's own authoritative `count`. Detected
    // directly, never assumed safe from the chunk-size arithmetic alone.
    if (
      assignmentRows.length !== (assignmentsResult.count ?? assignmentRows.length) ||
      eventRows.length !== (eventsResult.count ?? eventRows.length) ||
      exceptionRows.length !== (exceptionsResult.count ?? exceptionRows.length)
    ) {
      return { status: "unavailable" };
    }

    for (const row of assignmentRows) {
      const entry = { vehicleId: row.vehicle_id };
      const existing = assignmentsByTrip.get(row.trip_id);
      if (existing) {
        existing.push(entry);
      } else {
        assignmentsByTrip.set(row.trip_id, [entry]);
      }
    }
    for (const row of eventRows) {
      const fact: LifecycleEventFact = { eventType: row.event_type, occurredAt: row.occurred_at };
      const existing = eventsByTrip.get(row.trip_id);
      if (existing) {
        existing.push(fact);
      } else {
        eventsByTrip.set(row.trip_id, [fact]);
      }
    }
    for (const row of exceptionRows) {
      exceptionCountByTrip.set(row.trip_id, (exceptionCountByTrip.get(row.trip_id) ?? 0) + 1);
    }
  }

  const results: TripProofOfServiceResult[] = tripFacts.map((trip) => {
    const events = eventsByTrip.get(trip.id) ?? [];
    const assignments = assignmentsByTrip.get(trip.id) ?? [];
    const cardinality = classifyCompletionAssignmentCardinality(assignments.length);

    const facts: TripProofOfServiceFacts = {
      tripState: "completed",
      hasPassenger: trip.hasPassenger,
      hasPickupDescription: trip.hasPickup,
      hasDestinationDescription: trip.hasDestination,
      completedAt: trip.completedAt,
      hasCompleteLifecycleEventChain: evaluateLifecycleEventChain(events, trip.completedAt),
      hasCompletionAssignment: cardinality === "one",
      completionAssignmentVehicleId: cardinality === "one" ? assignments[0].vehicleId : null,
      openExceptionCount: exceptionCountByTrip.get(trip.id) ?? 0,
    };

    return deriveTripProofOfService(facts);
  });

  return { status: "ok", results };
}

export interface ProofOfServicePassenger {
  id: string;
  displayName: string;
}

export interface ProofOfServiceDriver {
  id: string;
  displayName: string;
}

export interface ProofOfServiceVehicle {
  id: string;
  label: string | null;
}

/** SUPPORTING TIMESTAMPS (S1C §22) — for a later single-Trip Proof-of-Service detail/document presentation. Deliberately never consulted by `result` itself (that decision is already fully captured in `hasCompleteLifecycleEventChain` before this module ever builds this object). */
export type ProofOfServiceLifecycleTimestamps = Record<RequiredLifecycleEventType, string | null>;

export interface ProofOfServiceReviewRow {
  tripId: string;
  passenger: ProofOfServicePassenger;
  completedAt: string;
  scheduledPickupAt: string | null;
  pickupDescription: string;
  destinationDescription: string;
  performingDriver: ProofOfServiceDriver | null;
  performingVehicle: ProofOfServiceVehicle | null;
  lifecycleEvents: ProofOfServiceLifecycleTimestamps;
  result: TripProofOfServiceResult;
}

export interface ProofOfServiceReviewResult {
  window: ProofOfServiceReviewWindow;
  timezone: string;
  startUtc: string;
  endUtc: string;
  rows: ProofOfServiceReviewRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

// =============================================================================
// REVIEW WINDOW BOUNDARIES (S1C §3-§7) — every boundary resolves through
// the existing organization-local calendar-date helpers exclusively; NONE
// of the three windows below is ever computed via `now - N * 24h`
// arithmetic, which would be wrong on any DST-transition day (a
// spring-forward local day has 23 elapsed hours, a fall-back day has 25 —
// day-bounds.ts's own P1-E1-S4C1 fix, reused here rather than
// reintroducing the exact bug that fix corrected).
// =============================================================================

/** YESTERDAY: the immediately previous organization-local calendar date, [start, end) — `end` is today's own start (reused directly, never recomputed), `start` is resolved independently via `localMidnightUtc` so it reflects THAT specific date's own real UTC offset regardless of any DST transition between the two days. */
function computeYesterdayBoundsUtc(now: Date, timezone: string): { startUtc: Date; endUtc: Date } {
  const today = organizationDayBoundsUtc(now, timezone);
  const todayKey = localDateKey(now, timezone);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  const startUtc = localMidnightUtc(yesterdayKey, timezone);
  return { startUtc, endUtc: today.startUtc };
}

/** LAST_7_DAYS: today plus the previous 6 organization-local calendar dates — exactly 7 local dates, [start of (today - 6 days), end of today). Never `now - 7*24h`. */
function computeLast7DaysBoundsUtc(now: Date, timezone: string): { startUtc: Date; endUtc: Date } {
  const todayKey = localDateKey(now, timezone);
  const sixDaysAgoKey = addDaysToDateKey(todayKey, -6);
  const startUtc = localMidnightUtc(sixDaysAgoKey, timezone);
  const today = organizationDayBoundsUtc(now, timezone);
  return { startUtc, endUtc: today.endUtc };
}

function computeReviewWindowBoundsUtc(
  window: ProofOfServiceReviewWindow,
  now: Date,
  timezone: string,
): { startUtc: Date; endUtc: Date } {
  switch (window) {
    case "TODAY":
      return organizationDayBoundsUtc(now, timezone);
    case "YESTERDAY":
      return computeYesterdayBoundsUtc(now, timezone);
    case "LAST_7_DAYS":
      return computeLast7DaysBoundsUtc(now, timezone);
  }
}

// =============================================================================
// Row shapes
// =============================================================================

interface PassengerEmbed {
  id: string;
  display_name: string;
}
type PassengerRelation = PassengerEmbed | PassengerEmbed[] | null;

interface TripRow {
  id: string;
  completed_at: string | null;
  scheduled_pickup_at: string | null;
  pickup_description: string;
  destination_description: string;
  passengers: PassengerRelation;
}

interface DriverEmbed {
  id: string;
  display_name: string;
}
type DriverRelation = DriverEmbed | DriverEmbed[] | null;

interface VehicleEmbed {
  id: string;
  label: string | null;
}
type VehicleRelation = VehicleEmbed | VehicleEmbed[] | null;

interface CompletionAssignmentRow {
  trip_id: string;
  vehicle_id: string | null;
  drivers: DriverRelation;
  vehicles: VehicleRelation;
}

function unwrapOne<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

function isNonBlank(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// =============================================================================
// getProofOfServiceReview
// =============================================================================

/**
 * QUERY ROUND TRIPS — exactly 4, matching the bounded shape this phase's
 * own spec requires (S1C §27), each explicitly `organization_id`-scoped,
 * none inside a loop, none a `select("*")`:
 *
 *   1. The completed-Trip candidate page itself, `state = 'completed'`
 *      AND `completed_at` within the resolved window, WITH the Passenger
 *      relation embedded in the SAME round trip (the same composite-FK
 *      convention `tomorrow-readiness.ts`/`trip-detail.ts` both already
 *      use) — server-side paginated via `.range()`, `{ count: "exact" }`.
 *   2. The completion-assignment query, scoped to exactly this page's
 *      returned Trip ids, filtered to `end_reason = 'trip_completed'`
 *      (S1C §10's own locked authority — never `ended_at IS NULL`, never
 *      "most recent," never `trip_events.actor_user_id`), with
 *      `drivers`/`vehicles` embedded in the SAME round trip. Grouped by
 *      `trip_id` in memory afterward so `classifyCompletionAssignmentCardinality`
 *      can see the true per-Trip row count (0 / 1 / >1) — deliberately
 *      NOT filtered further in SQL to "at most one," since collapsing
 *      that in the query itself would silently hide a >1 anomaly (S1C
 *      §11's own explicit "do not mask corrupted historical data").
 *   3. The `trip_events` query, scoped to the same Trip ids AND
 *      pre-filtered to exactly the 6 `REQUIRED_LIFECYCLE_EVENT_TYPES`
 *      (S1C §14) — cheaper than fetching every event type, and the pure
 *      `evaluateLifecycleEventChain`/`extractLifecycleEventTimestamps`
 *      helpers remain independently correct even if an unrelated type
     *  were ever present (proven by their own dedicated unit tests),
 *      so this SQL-level filter is a performance optimization, never a
 *      correctness dependency.
 *   4. The open `trip_exceptions` count query, scoped to the same Trip
 *      ids, `status = 'open'` — identical shape to `tomorrow-
 *      readiness.ts`'s own established two-phase exception-count pattern.
 *
 * Embedding the completion-assignment query directly into query 1 (the
 * way `tomorrow-readiness.ts` embeds its OWN `ended_at IS NULL` active
 * assignment) was evaluated and deliberately NOT done: that embed's
 * "still returns the parent row when zero children match" behavior was
 * empirically verified in this codebase only for `.is(..., null)`
 * filters, never for an `.eq("trip_assignments.end_reason", ...)` text
 * filter, which is new to this phase — collapsing queries 1 and 2 without
 * that same empirical confirmation risks silently EXCLUDING a completed
 * Trip with a real completion assignment from the result set entirely
 * (a materially worse failure than one extra round trip), so the query
 * stays separate. Correctness over round-trip count, per this phase's
 * own explicit instruction.
 */
export async function getProofOfServiceReview(
  organizationId: string,
  timezone: string,
  window: ProofOfServiceReviewWindow,
  page: number = 1,
  now: Date = new Date(),
): Promise<ProofOfServiceReviewResult> {
  const { startUtc, endUtc } = computeReviewWindowBoundsUtc(window, now, timezone);
  const startIso = startUtc.toISOString();
  const endIso = endUtc.toISOString();

  const supabase = await createServerSupabaseClient();

  const safePage = Math.max(1, page);
  const pageSize = PROOF_OF_SERVICE_PAGE_SIZE;
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;

  // -------------------------------------------------------------------
  // Query 1: completed Trip candidates for this page of this window.
  // -------------------------------------------------------------------
  const { data: tripRows, error: tripsError, count } = await supabase
    .from("trips")
    .select(
      "id, completed_at, scheduled_pickup_at, pickup_description, destination_description, " +
        "passengers!trips_passenger_id_organization_id_fkey(id, display_name)",
      { count: "exact" },
    )
    .eq("organization_id", organizationId)
    .eq("state", "completed")
    .gte("completed_at", startIso)
    .lt("completed_at", endIso)
    .order("completed_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to)
    .returns<TripRow[]>();

  if (tripsError) {
    throw new Error(`Failed to load completed trips for proof-of-service review: ${tripsError.message}`);
  }

  const rows = tripRows ?? [];
  const tripIds = rows.map((row) => row.id);

  if (tripIds.length === 0) {
    return { window, timezone, startUtc: startIso, endUtc: endIso, rows: [], totalCount: count ?? 0, page: safePage, pageSize };
  }

  // -------------------------------------------------------------------
  // Query 2: completion assignments (end_reason = 'trip_completed' ONLY)
  // for exactly these Trip ids — never filtered down to one row in SQL,
  // so a >1 anomaly remains visible after grouping in memory below.
  // -------------------------------------------------------------------
  const { data: assignmentRows, error: assignmentsError } = await supabase
    .from("trip_assignments")
    .select(
      "trip_id, vehicle_id, " +
        "drivers!trip_assignments_driver_id_organization_id_fkey(id, display_name), " +
        "vehicles!trip_assignments_vehicle_id_organization_id_fkey(id, label)",
    )
    .eq("organization_id", organizationId)
    .eq("end_reason", "trip_completed")
    .in("trip_id", tripIds)
    .returns<CompletionAssignmentRow[]>();

  if (assignmentsError) {
    throw new Error(`Failed to load completion assignments for proof-of-service review: ${assignmentsError.message}`);
  }

  const assignmentsByTrip = new Map<string, CompletionAssignmentRow[]>();
  for (const row of assignmentRows ?? []) {
    const existing = assignmentsByTrip.get(row.trip_id);
    if (existing) {
      existing.push(row);
    } else {
      assignmentsByTrip.set(row.trip_id, [row]);
    }
  }

  // -------------------------------------------------------------------
  // Query 3: required lifecycle events for exactly these Trip ids.
  // -------------------------------------------------------------------
  const { data: eventRows, error: eventsError } = await supabase
    .from("trip_events")
    .select("trip_id, event_type, occurred_at")
    .eq("organization_id", organizationId)
    .in("trip_id", tripIds)
    .in("event_type", REQUIRED_LIFECYCLE_EVENT_TYPES as unknown as string[]);

  if (eventsError) {
    throw new Error(`Failed to load lifecycle events for proof-of-service review: ${eventsError.message}`);
  }

  const eventsByTrip = new Map<string, LifecycleEventFact[]>();
  for (const row of eventRows ?? []) {
    const fact: LifecycleEventFact = { eventType: row.event_type, occurredAt: row.occurred_at };
    const existing = eventsByTrip.get(row.trip_id);
    if (existing) {
      existing.push(fact);
    } else {
      eventsByTrip.set(row.trip_id, [fact]);
    }
  }

  // -------------------------------------------------------------------
  // Query 4: open exception counts for exactly these Trip ids.
  // -------------------------------------------------------------------
  const { data: exceptionRows, error: exceptionsError } = await supabase
    .from("trip_exceptions")
    .select("trip_id")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .in("trip_id", tripIds);

  if (exceptionsError) {
    throw new Error(`Failed to load open exceptions for proof-of-service review: ${exceptionsError.message}`);
  }

  const openExceptionCountByTrip = new Map<string, number>();
  for (const row of exceptionRows ?? []) {
    openExceptionCountByTrip.set(row.trip_id, (openExceptionCountByTrip.get(row.trip_id) ?? 0) + 1);
  }

  // -------------------------------------------------------------------
  // Compose: DB facts -> TripProofOfServiceFacts -> deriveTripProofOfService
  // -> presentation-ready row. No business decision made here.
  // -------------------------------------------------------------------
  const reviewRows: ProofOfServiceReviewRow[] = rows.map((row) => {
    const passenger = unwrapOne(row.passengers);
    const events = eventsByTrip.get(row.id) ?? [];
    const completionAssignments = assignmentsByTrip.get(row.id) ?? [];
    const cardinality = classifyCompletionAssignmentCardinality(completionAssignments.length);
    const completionAssignment = cardinality === "one" ? completionAssignments[0] : null;
    const driver = completionAssignment ? unwrapOne(completionAssignment.drivers) : null;
    const vehicle = completionAssignment ? unwrapOne(completionAssignment.vehicles) : null;

    const facts: TripProofOfServiceFacts = {
      // This module only ever queries `state = 'completed'` rows, so this
      // is always "completed" — supplied literally rather than re-read
      // from `row` (there is no `state` column selected in query 1 at
      // all, deliberately: the SQL filter is already the authority).
      tripState: "completed",
      hasPassenger: passenger !== null,
      hasPickupDescription: isNonBlank(row.pickup_description),
      hasDestinationDescription: isNonBlank(row.destination_description),
      completedAt: row.completed_at,
      hasCompleteLifecycleEventChain: evaluateLifecycleEventChain(events, row.completed_at),
      hasCompletionAssignment: cardinality === "one",
      completionAssignmentVehicleId: cardinality === "one" ? completionAssignment!.vehicle_id : null,
      openExceptionCount: openExceptionCountByTrip.get(row.id) ?? 0,
    };

    return {
      tripId: row.id,
      passenger: { id: passenger?.id ?? "", displayName: passenger?.display_name ?? "Unknown Passenger" },
      // Non-null by construction: the SQL range filter above already
      // excludes any row with a null completed_at.
      completedAt: row.completed_at as string,
      scheduledPickupAt: row.scheduled_pickup_at,
      pickupDescription: row.pickup_description,
      destinationDescription: row.destination_description,
      performingDriver: driver ? { id: driver.id, displayName: driver.display_name } : null,
      performingVehicle: vehicle ? { id: vehicle.id, label: vehicle.label } : null,
      lifecycleEvents: extractLifecycleEventTimestamps(events),
      result: deriveTripProofOfService(facts),
    };
  });

  return {
    window,
    timezone,
    startUtc: startIso,
    endUtc: endIso,
    rows: reviewRows,
    totalCount: count ?? reviewRows.length,
    page: safePage,
    pageSize,
  };
}
