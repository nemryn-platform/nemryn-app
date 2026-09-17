import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTodaysOperations } from "./todays-operations";
import { getTomorrowReadiness } from "./tomorrow-readiness";
import { isActiveTripState } from "./presentation";
import { deriveOperationsBrief, countDriversCurrentlyOnTrip, type DriverAssignmentStateRow } from "./operations-brief-core";
import type {
  OperationsBriefData,
  OperationsBriefDriverSnapshot,
  OperationsBriefRequestSummary,
  OperationsBriefTomorrowSummary,
} from "./operations-brief-core";

export type {
  OperationsBriefData,
  OperationsBriefDayState,
  OperationsBriefDriverSnapshot,
  OperationsBriefRequestSummary,
  OperationsBriefTomorrowSummary,
} from "./operations-brief-core";

/**
 * Server-side data COMPOSITION layer for Operations Brief (P1-E1-S1B,
 * P1-E1-S1A §16/§19-21). Deliberately does not fork or reimplement:
 *   - trip assurance (src/lib/operations/trip-assurance.ts) — untouched,
 *     unread even, other than through getTodaysOperations()'s own return
 *     value;
 *   - the trip lifecycle (presentation.ts's isActiveTripState) — reused,
 *     not re-derived;
 *   - organization-context resolution — this module takes `organizationId`
 *     as a plain parameter, exactly like getTodaysOperations() and
 *     getDispatchBoardData() already do; the caller (an /operations route)
 *     is responsible for having already resolved it server-side via
 *     requireOperationsAccess(), the same established trust boundary
 *     every existing Operations data-access module already relies on —
 *     no new pattern introduced here;
 *   - today-boundary calculations (organizationDayBoundsUtc) — entirely
 *     internal to getTodaysOperations(), never touched here.
 *
 * The ONE genuinely new data requirement (P1-E1-S1A §12) is the driver
 * snapshot — total active drivers, and how many currently hold an active
 * assignment on an active-state trip. This is a small, dedicated,
 * explicit-column query (never `select("*")`, never a duplicate of the
 * much larger Dispatch Board query), reusing dispatch-board.ts's own
 * proven "on trip" interpretation (active assignment + active-state trip)
 * without importing or duplicating that larger module.
 */

interface TripStateEmbed {
  state: string;
}
type TripStateRelation = TripStateEmbed | TripStateEmbed[] | null;

interface DriverAssignmentRow {
  driver_id: string;
  trips: TripStateRelation;
}

/** Same defensive to-one-embed unwrap todays-operations.ts/dispatch-board.ts each already carry their own copy of — PostgREST can return either shape depending on inference; a private 3-line copy here matches that same established convention rather than introducing a shared cross-module import for it. */
function unwrapOne<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

/**
 * Exported separately from `getOperationsBrief` (P1-E1-S1C) so a caller
 * that has ALREADY fetched `TodaysOperationsData` for its own existing
 * page sections (e.g. /operations' own Today's Operations panels) can
 * compose the Brief from that same result via `deriveOperationsBrief`
 * (operations-brief-core.ts) instead of calling the convenience
 * `getOperationsBrief` below, which would issue its own SECOND
 * `getTodaysOperations()` call — see operations-brief-core.ts's own
 * `deriveOperationsBrief` doc comment and src/app/operations/page.tsx's
 * own usage for the exact avoided-duplication pattern.
 */
export async function getDriverSnapshot(organizationId: string): Promise<OperationsBriefDriverSnapshot> {
  const supabase = await createServerSupabaseClient();

  const driversResult = await supabase
    .from("drivers")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "active");

  if (driversResult.error) {
    throw new Error(`Failed to load active drivers: ${driversResult.error.message}`);
  }

  const activeDriverIds = (driversResult.data ?? []).map((row) => row.id);
  const totalActiveDrivers = activeDriverIds.length;

  // No active drivers at all — skip the second query entirely (nothing to
  // ask trip_assignments about), rather than issuing an `.in("driver_id", [])`
  // query that would trivially return zero rows anyway.
  if (activeDriverIds.length === 0) {
    return { totalActiveDrivers: 0, driversCurrentlyOnTrip: 0 };
  }

  const assignmentsResult = await supabase
    .from("trip_assignments")
    .select("driver_id, trips!trip_assignments_trip_id_organization_id_fkey(state)")
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .in("driver_id", activeDriverIds)
    .returns<DriverAssignmentRow[]>();

  if (assignmentsResult.error) {
    throw new Error(`Failed to load active driver assignments: ${assignmentsResult.error.message}`);
  }

  const rows: DriverAssignmentStateRow[] = [];
  for (const row of assignmentsResult.data ?? []) {
    const trip = unwrapOne(row.trips);
    if (trip) {
      rows.push({ driverId: row.driver_id, isActiveState: isActiveTripState(trip.state) });
    }
  }

  return {
    totalActiveDrivers,
    driversCurrentlyOnTrip: countDriversCurrentlyOnTrip(rows),
  };
}

/**
 * Requests awaiting review (P1-E1-S2G). Exported separately from
 * `getOperationsBrief`, exactly like `getDriverSnapshot` above, so
 * /operations' own page can compose it alongside its already-fetched
 * `TodaysOperationsData` without a second, redundant Brief fetch.
 *
 * Reuses the EXACT SAME Pending queue definition Request Hub's own
 * `getRequestsList` (requests-list.ts) already established —
 * `organization_id = <current org>` AND `state = 'pending'` — never a
 * second interpretation. `organization_id` is explicitly filtered here
 * as defense in depth, on top of RLS, matching every other query in this
 * module. Uses the normal RLS-respecting server client, never the
 * service role.
 *
 * One narrow query does both jobs at once: `count: "exact"` returns the
 * organization's real total pending count regardless of `.limit()`
 * (PostgREST computes the count from the full filtered set, not the
 * returned page), while `.order("created_at", { ascending: true
 * }).limit(1)` returns only the single oldest pending row — the same
 * `created_at ASC` ordering requests-list.ts's own Pending queue already
 * uses. This avoids ever fetching Request rows individually when only a
 * count and a single timestamp are actually needed. No score, no SLA, no
 * urgency model, no fake priority, no AI classification — just the two
 * plain facts the Brief needs.
 */
export async function getRequestSummary(organizationId: string): Promise<OperationsBriefRequestSummary> {
  const supabase = await createServerSupabaseClient();

  const { data, error, count } = await supabase
    .from("transportation_requests")
    .select("created_at", { count: "exact" })
    .eq("organization_id", organizationId)
    .eq("state", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load pending request summary: ${error.message}`);
  }

  return {
    pendingRequestCount: count ?? 0,
    oldestPendingRequestCreatedAt: data?.[0]?.created_at ?? null,
  };
}

/**
 * Compact Tomorrow Readiness summary for Operations Brief (P1-E1-S4E
 * §2) — reuses S4C/S4C1's already-authoritative `getTomorrowReadiness`
 * directly (the SAME day bounds, the SAME candidate Trip set, the SAME
 * evaluator `/operations/tomorrow` itself uses), then narrows the result
 * down to the 3 counts `OperationsBriefTomorrowSummary` needs — never a
 * parallel query, never a second interpretation of "tomorrow" or
 * "ready." `null` represents a genuine fetch failure (caught by the
 * caller, mirroring `RequestActivityPanel`'s established null-on-failure
 * convention) — this function itself does not catch; every caller below
 * wraps its own call in try/catch so the failure mode is visible at each
 * call site, exactly like `candidatePassengers`/`activityEvents` in
 * src/app/operations/requests/[requestId]/page.tsx.
 */
export async function getTomorrowReadinessSummary(
  organizationId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<OperationsBriefTomorrowSummary> {
  const data = await getTomorrowReadiness(organizationId, timezone, now);
  return {
    totalScheduledTrips: data.totalScheduledTrips,
    readyCount: data.readyCount,
    needsPreparationCount: data.needsPreparationCount,
  };
}

/**
 * The one Operations Brief entry point. `organizationId`/`timezone` follow
 * the exact same caller-resolves-context convention getTodaysOperations()
 * already established. `now` defaults to the real current instant but is
 * an explicit parameter so a future caller (or a test that mocks
 * createServerSupabaseClient) can pin it — mirrors organizationDayBoundsUtc's
 * own existing `now: Date` parameter shape, not a new pattern.
 *
 * Tomorrow Readiness (P1-E1-S4E) is fetched as its own isolated,
 * best-effort promise — started before the existing Promise.all so it
 * overlaps with those fetches in wall-clock time (S4E §12's own "do not
 * serially delay the page" instruction), but caught independently so a
 * genuine failure there degrades only the Brief's own compact block,
 * never this whole function (S4E §11).
 */
export async function getOperationsBrief(
  organizationId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<OperationsBriefData> {
  const tomorrowReadinessPromise: Promise<OperationsBriefTomorrowSummary | null> = getTomorrowReadinessSummary(
    organizationId,
    timezone,
    now,
  ).catch(() => null);

  const [todaysOperations, driverSnapshot, requestSummary] = await Promise.all([
    getTodaysOperations(organizationId, timezone),
    getDriverSnapshot(organizationId),
    getRequestSummary(organizationId),
  ]);

  const tomorrowReadiness = await tomorrowReadinessPromise;

  return deriveOperationsBrief(todaysOperations, driverSnapshot, requestSummary, tomorrowReadiness, now);
}
