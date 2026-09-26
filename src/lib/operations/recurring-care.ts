import "server-only";
import { getTripAvailabilityOutcomes } from "./availability";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { localDateKey, addDaysToDateKey, localMidnightUtc } from "./day-bounds";
import { deriveTripReadiness, type TripReadinessFacts } from "./trip-readiness-core";
import {
  deriveRecurringCareAssurance,
  HORIZON_LENGTH_DAYS,
  type RecurringArrangementFacts,
  type RecurringArrangementAssurance,
  type RecurringLinkedTripFact,
  type RecurringSkipFact,
  type IsoWeekday,
} from "./recurring-care-core";

export type { RecurringArrangementAssurance, RecurringOccurrence, RecurringOccurrenceState } from "./recurring-care-core";

/**
 * Server-side data-access boundary for Recurring Care Assurance
 * (P1-E2-S1C), mirroring `tomorrow-readiness.ts`'s own established
 * shape: organization-scoped, explicit columns (never `select("*")`), no
 * service role, no presentation JSX, bounded query count regardless of
 * how many arrangements/Trips exist. Composes the real, unmodified
 * `deriveRecurringCareAssurance` (recurring-care-core.ts) — every date/
 * lifecycle/satisfaction rule lives there and only there; this module's
 * only job is resolving real timezone-dependent instants into the
 * already-normalized local-date-key facts that pure evaluator requires,
 * and fetching the bounded data it needs to do so.
 *
 * `organizationId` follows the exact same caller-resolves-context
 * convention every other Operations data-access module in this codebase
 * already establishes (never itself the trust boundary — the calling
 * page/route is responsible for having resolved it via
 * `requireOperationsAccess()` first). No arrangement lifecycle mutation
 * exists here or anywhere yet (S1D) — this module is read-only, matching
 * the database's own current grant reality (recurring_arrangements/
 * recurring_occurrence_exceptions carry no authenticated INSERT/UPDATE/
 * DELETE grant at all, P1-E2-S1B/S1C).
 */

interface PassengerEmbed {
  display_name: string;
}
type PassengerRelation = PassengerEmbed | PassengerEmbed[] | null;

interface ArrangementRow {
  id: string;
  organization_id: string;
  passenger_id: string;
  passengers: PassengerRelation;
  pickup_description: string;
  destination_description: string;
  days_of_week: number[];
  start_date: string;
  end_date: string | null;
  timezone: string;
  status: "active" | "paused" | "ended";
  paused_at: string | null;
  ended_at: string | null;
}

function unwrapOne<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

const ARRANGEMENT_COLUMNS =
  "id, organization_id, passenger_id, " +
  "passengers!recurring_arrangements_passenger_id_organization_id_fkey(display_name), " +
  "pickup_description, destination_description, days_of_week, start_date, end_date, " +
  "timezone, status, paused_at, ended_at";

interface StatusEmbed {
  status: string;
}
type StatusRelation = StatusEmbed | StatusEmbed[] | null;

interface AssignmentEmbed {
  id: string;
  ended_at: string | null;
  vehicle_id: string | null;
  drivers: { id: string; status: string } | { id: string; status: string }[] | null;
  vehicles: StatusRelation;
}

interface TripRow {
  id: string;
  organization_id: string;
  recurring_arrangement_id: string;
  state: string;
  scheduled_pickup_at: string | null;
  expected_duration_minutes: number | null;
  requires_wheelchair_access: boolean | null;
  passengers: StatusRelation;
  trip_assignments: AssignmentEmbed[] | null;
}

const TRIP_COLUMNS =
  "id, organization_id, recurring_arrangement_id, state, scheduled_pickup_at, expected_duration_minutes, requires_wheelchair_access, " +
  "passengers!trips_passenger_id_organization_id_fkey(status), " +
  "trip_assignments!trip_assignments_trip_id_organization_id_fkey(id, ended_at, vehicle_id, " +
  "drivers!trip_assignments_driver_id_organization_id_fkey(id, status), " +
  "vehicles!trip_assignments_vehicle_id_organization_id_fkey(status))";

/**
 * Fetches and evaluates Recurring Care Assurance for every candidate
 * RecurringArrangement in `organizationId`, across the locked 14-local-
 * calendar-date horizon (per-arrangement, in ITS OWN stored timezone
 * snapshot — never the organization's current timezone).
 *
 * QUERY ROUND TRIPS — exactly 4, every one explicitly `organization_id`-
 * scoped and bounded, never a `select("*")`, never one query per
 * arrangement (P1-E2-S1C §21/§35 "NO N+1"):
 *   1. Candidate arrangements for this organization — coarsely bounded
 *      (see COARSE ARRANGEMENT FILTER below) so a long history of
 *      unambiguously-irrelevant `ended` arrangements is never scanned
 *      forever; the PURE evaluator's own exact per-arrangement timezone
 *      logic is what actually decides relevance, this is only a cheap
 *      pre-filter.
 *   2. Occurrence exceptions (skips) for the resulting candidate
 *      arrangement ids, bounded to the union of every candidate
 *      arrangement's own horizon date range.
 *   3. Linked Trips for the resulting candidate arrangement ids, with
 *      driver/vehicle/passenger status embedded in the SAME round trip
 *      (mirroring trip-readiness.ts's own composite-FK-hint convention
 *      exactly) — bounded to the UNION UTC envelope of every candidate
 *      arrangement's own local horizon (see MULTI-TIMEZONE STRATEGY).
 *   4. A small, scoped `trip_exceptions` open-count query against
 *      exactly the resulting candidate Trip ids — mirrors `tomorrow-
 *      readiness.ts`'s own established two-phase Trip-Readiness-input
 *      pattern (grouped into a per-trip count in memory, never one query
 *      per Trip).
 * No fifth query is needed.
 *
 * MULTI-TIMEZONE STRATEGY (P1-E2-S1C §23): different arrangements in the
 * SAME organization may carry different timezone snapshots. Each
 * candidate arrangement's own 14-date horizon is resolved independently
 * into its own exact UTC [startUtc, endUtc) envelope (via the same
 * exact-DST-safe `localMidnightUtc` machinery day-bounds.ts already
 * proves correct, P1-E1-S4C1); the Trip query is then bounded to the
 * UNION of every candidate arrangement's own envelope (the earliest
 * startUtc across all arrangements through the latest endUtc), fetched
 * in ONE round trip, and each fetched Trip is mapped back to its own
 * `recurring_arrangement_id` and re-resolved to a local service date
 * using THAT SPECIFIC arrangement's OWN timezone — never a shared/
 * organization-wide date assumption.
 */
export async function getRecurringCareAssurance(
  organizationId: string,
  now: Date = new Date(),
): Promise<RecurringArrangementAssurance[]> {
  const supabase = await createServerSupabaseClient();

  // COARSE ARRANGEMENT FILTER — deliberately approximate, never
  // timezone-exact (no single UTC-based filter can be exact across
  // heterogeneous per-arrangement timezones without first reading every
  // row). A generous ±1-2 day margin means this filter can only ever
  // OVER-include a borderline row, never incorrectly exclude a genuinely
  // relevant one — the pure evaluator's own per-arrangement isPatternDate
  // logic is what actually and exactly decides relevance from here.
  const nowUtcDateKey = localDateKey(now, "UTC");
  const coarseFloorDateKey = addDaysToDateKey(nowUtcDateKey, -2);
  const coarseCeilingDateKey = addDaysToDateKey(nowUtcDateKey, HORIZON_LENGTH_DAYS + 2);
  const coarseFloorInstantIso = new Date(coarseFloorDateKey + "T00:00:00.000Z").toISOString();

  const { data: arrangementRows, error: arrangementsError } = await supabase
    .from("recurring_arrangements")
    .select(ARRANGEMENT_COLUMNS)
    .eq("organization_id", organizationId)
    .lte("start_date", coarseCeilingDateKey)
    .or(`end_date.is.null,end_date.gte.${coarseFloorDateKey}`)
    .or(`status.neq.ended,ended_at.gte.${coarseFloorInstantIso}`)
    .returns<ArrangementRow[]>();

  if (arrangementsError) {
    throw new Error(`Failed to load candidate recurring arrangements: ${arrangementsError.message}`);
  }

  const arrangements = arrangementRows ?? [];
  if (arrangements.length === 0) {
    return [];
  }

  return composeAssuranceForArrangements(supabase, organizationId, now, arrangements);
}

/**
 * Single-arrangement variant (P1-E2-S1E), mirroring trip-readiness.ts's
 * own established "smallest wrapper for exactly one record" precedent —
 * for a detail page, never trip-readiness.ts's own full-organization
 * fetch. Deliberately bypasses the COARSE ARRANGEMENT FILTER entirely
 * (that filter exists only to avoid scanning a long history of
 * unambiguously-irrelevant arrangements when computing an org-wide list;
 * an operator navigating directly to one specific arrangement's detail
 * page must still see it regardless of how old/ended it is — a coarse
 * date-window exclusion would incorrectly 404 a legitimately-requested,
 * long-ended arrangement). Returns null on not-found/foreign-org, no
 * existence oracle — matches every other Operations detail read model's
 * own established contract (e.g. getTripDetail/getRequestDetail).
 */
export async function getRecurringCareAssuranceForArrangement(
  organizationId: string,
  arrangementId: string,
  now: Date = new Date(),
): Promise<RecurringArrangementAssurance | null> {
  const supabase = await createServerSupabaseClient();

  const { data: arrangementRows, error: arrangementsError } = await supabase
    .from("recurring_arrangements")
    .select(ARRANGEMENT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", arrangementId)
    .returns<ArrangementRow[]>();

  if (arrangementsError) {
    throw new Error(`Failed to load recurring arrangement: ${arrangementsError.message}`);
  }

  const arrangements = arrangementRows ?? [];
  if (arrangements.length === 0) {
    return null;
  }

  const results = await composeAssuranceForArrangements(supabase, organizationId, now, arrangements);
  return results[0] ?? null;
}

async function composeAssuranceForArrangements(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  organizationId: string,
  now: Date,
  arrangements: ArrangementRow[],
): Promise<RecurringArrangementAssurance[]> {
  const arrangementIds = arrangements.map((a) => a.id);

  // Resolve each candidate arrangement's own "today" local date key and
  // exact 14-date horizon envelope, in its OWN timezone snapshot.
  const horizonByArrangementId = new Map<
    string,
    { todayLocalDateKey: string; horizonStartUtc: Date; horizonEndUtc: Date }
  >();
  for (const row of arrangements) {
    const todayLocalDateKey = localDateKey(now, row.timezone);
    const horizonStartUtc = localMidnightUtc(todayLocalDateKey, row.timezone);
    const horizonEndDateKey = addDaysToDateKey(todayLocalDateKey, HORIZON_LENGTH_DAYS);
    const horizonEndUtc = localMidnightUtc(horizonEndDateKey, row.timezone);
    horizonByArrangementId.set(row.id, { todayLocalDateKey, horizonStartUtc, horizonEndUtc });
  }

  const globalEnvelopeStartUtc = new Date(
    Math.min(...[...horizonByArrangementId.values()].map((h) => h.horizonStartUtc.getTime())),
  );
  const globalEnvelopeEndUtc = new Date(
    Math.max(...[...horizonByArrangementId.values()].map((h) => h.horizonEndUtc.getTime())),
  );

  // Round trip 2: occurrence exceptions, bounded to the widest possible
  // date range any candidate arrangement's own horizon could need.
  const globalFloorDateKey = [...horizonByArrangementId.values()]
    .map((h) => localDateKey(h.horizonStartUtc, "UTC"))
    .sort()[0];
  const globalCeilingDateKey = [...horizonByArrangementId.values()]
    .map((h) => localDateKey(h.horizonEndUtc, "UTC"))
    .sort()
    .at(-1)!;

  const { data: skipRows, error: skipsError } = await supabase
    .from("recurring_occurrence_exceptions")
    .select("recurring_arrangement_id, service_date, reason")
    .eq("organization_id", organizationId)
    .in("recurring_arrangement_id", arrangementIds)
    .gte("service_date", globalFloorDateKey)
    .lte("service_date", globalCeilingDateKey);

  if (skipsError) {
    throw new Error(`Failed to load recurring occurrence exceptions: ${skipsError.message}`);
  }

  const skipsByArrangementId = new Map<string, RecurringSkipFact[]>();
  for (const row of skipRows ?? []) {
    const list = skipsByArrangementId.get(row.recurring_arrangement_id) ?? [];
    list.push({ serviceDate: row.service_date, reason: row.reason });
    skipsByArrangementId.set(row.recurring_arrangement_id, list);
  }

  // Round trip 3: linked Trips, bounded to the UNION UTC envelope across
  // every candidate arrangement's own horizon (never a single
  // organization-wide window — see MULTI-TIMEZONE STRATEGY above).
  const { data: tripRows, error: tripsError } = await supabase
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("organization_id", organizationId)
    .in("recurring_arrangement_id", arrangementIds)
    .gte("scheduled_pickup_at", globalEnvelopeStartUtc.toISOString())
    .lt("scheduled_pickup_at", globalEnvelopeEndUtc.toISOString())
    .is("trip_assignments.ended_at", null)
    .returns<TripRow[]>();

  if (tripsError) {
    throw new Error(`Failed to load linked Trips for recurring arrangements: ${tripsError.message}`);
  }

  const trips = tripRows ?? [];
  const tripIds = trips.map((t) => t.id);

  // Round trip 4: open exception counts, scoped to exactly the resulting
  // candidate Trip ids — mirrors tomorrow-readiness.ts's own established
  // two-phase pattern exactly, never one query per Trip.
  const { data: exceptionRows, error: exceptionsError } =
    tripIds.length > 0
      ? await supabase
          .from("trip_exceptions")
          .select("trip_id")
          .eq("organization_id", organizationId)
          .eq("status", "open")
          .in("trip_id", tripIds)
      : { data: [], error: null };

  if (exceptionsError) {
    throw new Error(`Failed to load open exception counts for recurring care assurance: ${exceptionsError.message}`);
  }

  const openExceptionCountByTrip = new Map<string, number>();
  for (const row of exceptionRows ?? []) {
    openExceptionCountByTrip.set(row.trip_id, (openExceptionCountByTrip.get(row.trip_id) ?? 0) + 1);
  }

  // P1-OPS-PROG5B: the SAME known availability / capability readiness reasons as Tomorrow / Trip Detail, from ONE
  // batched evaluation (shifts are organization-local, so the organization's timezone is read once).
  let availabilityOutcomes = new Map<string, { reasons: import("./availability-core").AvailabilityReadinessReason[] }>();
  const scheduledAssigned = trips.filter((t) => t.state === "scheduled" && (t.trip_assignments ?? []).length > 0);
  if (scheduledAssigned.length > 0) {
    const { data: orgRow, error: orgError } = await supabase.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
    if (orgError || !orgRow) {
      throw new Error(`Failed to load organization timezone for recurring care assurance: ${orgError?.message ?? "not found"}`);
    }
    availabilityOutcomes = await getTripAvailabilityOutcomes(
      organizationId,
      orgRow.timezone,
      scheduledAssigned.map((t) => {
        const assignment = (t.trip_assignments ?? [])[0] ?? null;
        return {
          id: t.id,
          scheduledPickupAt: t.scheduled_pickup_at,
          expectedDurationMinutes: t.expected_duration_minutes,
          requiresWheelchairAccess: t.requires_wheelchair_access,
          driverId: unwrapOne(assignment?.drivers)?.id ?? null,
          vehicleId: assignment?.vehicle_id ?? null,
        };
      }),
    );
  }

  // Map every fetched Trip to its own arrangement's local service date,
  // using THAT arrangement's own timezone — never a shared assumption.
  const tripsByArrangementId = new Map<string, RecurringLinkedTripFact[]>();
  for (const row of trips) {
    const arrangement = arrangements.find((a) => a.id === row.recurring_arrangement_id);
    if (!arrangement) continue; // defensive — cannot happen given the .in() filter above

    const serviceDate = row.scheduled_pickup_at === null ? null : localDateKey(new Date(row.scheduled_pickup_at), arrangement.timezone);

    let readiness = null;
    if (row.state === "scheduled") {
      const activeAssignment = (row.trip_assignments ?? [])[0] ?? null;
      const driver = unwrapOne(activeAssignment?.drivers);
      const vehicle = unwrapOne(activeAssignment?.vehicles);
      const passenger = unwrapOne(row.passengers);
      const facts: TripReadinessFacts = {
        state: row.state,
        scheduledPickupAt: row.scheduled_pickup_at,
        hasActiveAssignment: activeAssignment !== null,
        assignedVehicleId: activeAssignment?.vehicle_id ?? null,
        driverStatus: activeAssignment ? (driver?.status ?? null) : null,
        vehicleStatus: activeAssignment?.vehicle_id ? (vehicle?.status ?? null) : null,
        passengerStatus: passenger?.status ?? "inactive",
        openExceptionCount: openExceptionCountByTrip.get(row.id) ?? 0,
        availabilityReasons: availabilityOutcomes.get(row.id)?.reasons ?? [],
      };
      readiness = deriveTripReadiness(facts);
    }

    const list = tripsByArrangementId.get(row.recurring_arrangement_id) ?? [];
    list.push({ tripId: row.id, state: row.state, serviceDate, readiness });
    tripsByArrangementId.set(row.recurring_arrangement_id, list);
  }

  // Compose the pure evaluator once per candidate arrangement — no
  // additional queries, purely in-memory from the bounded fetches above.
  return arrangements.map((row) => {
    const horizon = horizonByArrangementId.get(row.id)!;
    const arrangementFacts: RecurringArrangementFacts = {
      id: row.id,
      organizationId: row.organization_id,
      passengerId: row.passenger_id,
      passengerDisplayName: unwrapOne(row.passengers)?.display_name ?? "Unknown Passenger",
      pickupDescription: row.pickup_description,
      destinationDescription: row.destination_description,
      daysOfWeek: row.days_of_week as IsoWeekday[],
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
      pausedEffectiveDate: row.status === "paused" && row.paused_at ? localDateKey(new Date(row.paused_at), row.timezone) : null,
      endedEffectiveDate: row.status === "ended" && row.ended_at ? localDateKey(new Date(row.ended_at), row.timezone) : null,
    };

    return deriveRecurringCareAssurance(
      arrangementFacts,
      horizon.todayLocalDateKey,
      tripsByArrangementId.get(row.id) ?? [],
      skipsByArrangementId.get(row.id) ?? [],
    );
  });
}
