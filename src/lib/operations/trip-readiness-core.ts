/**
 * Pure, framework-free Trip Readiness derivation (P1-E1-S4B, following
 * the P1-E1-S4A foundation audit — docs/reports/p1-e1-s4a-trip-tomorrow-
 * readiness-foundation-audit.txt).
 *
 * Deliberately has NO runtime import of any kind — no Supabase, no
 * `server-only`, no React, no date/time I/O beyond the facts supplied by
 * the caller — mirroring `request-readiness-core.ts`'s own established
 * pure-core convention exactly, so this logic is directly unit-testable
 * with Node's test runner, with no bundler and no database.
 *
 * Trip Readiness answers exactly one question: "is this SCHEDULED Trip
 * sufficiently prepared to execute?" It is derived, never stored — no
 * new `trips` column, no new lifecycle state, nothing written back
 * anywhere. It is never a score, never a percentage, never AI-
 * classified (S4A's own explicit instruction, reaffirmed by S4B).
 *
 * RELATIONSHIP TO TRIP ASSURANCE (`trip-assurance.ts`, NOT modified,
 * NOT duplicated, NOT renamed): Assurance and Readiness share two
 * authoritative raw facts — "does an active assignment exist" and
 * "how many open exceptions exist" — but they consume those facts
 * differently ON PURPOSE. `evaluateTripAssurance` intentionally
 * collapses every fact into exactly ONE highest-priority result (it
 * answers "what is the SINGLE most important thing happening on this
 * Trip right now"). Trip Readiness instead PRESERVES every applicable
 * reason simultaneously (it answers "list everything not yet in place
 * before this Trip can execute") — a Trip can genuinely have an open
 * exception AND a missing Vehicle AND an inactive Driver all at once,
 * and Readiness must report all three, never pick just one. This module
 * therefore does NOT call `evaluateTripAssurance` and does NOT import
 * from `trip-assurance.ts` — reusing its OUTPUT (a single collapsed
 * code) would silently lose the other applicable reasons, which is
 * exactly the mistake S4A's own corrections warned against. What IS
 * shared is the underlying MEANING of "active assignment" and "open
 * exception count" — both modules' callers derive these facts from the
 * identical source query shape (`trip_assignments` row with
 * `ended_at IS NULL`; a real open `trip_exceptions` row) — never a
 * second, independently-drifting definition of either concept.
 *
 * EXPLICITLY OUT OF SCOPE FOR THIS MVP (S4A's own audit + this phase's
 * own explicit corrections — not oversights):
 *   - Facility presence/absence (optional/contextual by schema design,
 *     never a preparation requirement).
 *   - Request linkage presence/absence (nullable by design, ZD-045).
 *   - `transportation_requests.return_trip_needed` / any outbound-vs-
 *     return inference — no `trip.leg` exists and none is added here;
 *     without a confirmed discriminator, which linked Trip is "the
 *     return" cannot be truthfully determined. Deferred, not guessed.
 *   - `assistance_notes` / Passenger-requirement-to-Vehicle-capability
 *     matching — no Vehicle capability taxonomy exists to match against.
 *   - Credentials/compliance (license, insurance, certification) — no
 *     such schema exists anywhere in this database. No placeholder
 *     boolean is introduced.
 *   - Routing, ETA, deadhead, capacity planning — no such data exists.
 *   - Location freshness — meaningful only once execution has begun;
 *     Trip Readiness never evaluates a Trip outside `state='scheduled'`.
 */

export type TripReadinessState = "READY" | "NEEDS_PREPARATION" | "NOT_APPLICABLE";

/**
 * Closed vocabulary, verified against actual current schema/RPC
 * behavior during the S4A audit and re-confirmed against source in this
 * phase (trips.sql, trip_assignments.sql, drivers.sql, vehicles.sql,
 * passengers.sql, trip_exceptions.sql) — never a guessed dimension.
 */
export type TripReadinessReasonCode =
  | "NO_SCHEDULE"
  | "NEEDS_DRIVER"
  | "NEEDS_VEHICLE"
  | "DRIVER_INACTIVE"
  | "VEHICLE_INACTIVE"
  | "PASSENGER_INACTIVE"
  | "OPEN_EXCEPTION";

/**
 * Stable, deterministic output order (S4B §4's own explicit
 * requirement) — reads as a natural preparation checklist (schedule it,
 * assign a driver, assign a vehicle, confirm the assigned Driver is
 * still valid, confirm the assigned Vehicle is still valid, confirm the
 * Passenger is still valid, resolve any flagged issue). This is a
 * PRESENTATION-FRIENDLY ordering choice only — unlike
 * `evaluateTripAssurance`'s own priority order (which picks the single
 * most important of several possible results), every reason here is
 * independently true or false and ALL true ones are always returned;
 * this array only fixes the order they appear in, never which ones
 * appear.
 */
const REASON_ORDER: TripReadinessReasonCode[] = [
  "NO_SCHEDULE",
  "NEEDS_DRIVER",
  "NEEDS_VEHICLE",
  "DRIVER_INACTIVE",
  "VEHICLE_INACTIVE",
  "PASSENGER_INACTIVE",
  "OPEN_EXCEPTION",
];

/**
 * The exact, minimal fact set the supported MVP dimensions require —
 * nothing more (S4B §2's own explicit exclusion list: no Facility, no
 * Request, no return_trip_needed, no assistance_notes, no credentials,
 * no routing/ETA/deadhead, no location freshness).
 */
export interface TripReadinessFacts {
  /** The canonical Trip lifecycle state — never re-derived, always the real `trips.state`. */
  state: string;
  /** `trips.scheduled_pickup_at` — nullable by schema; a Trip can genuinely have no scheduled time. */
  scheduledPickupAt: string | null;
  /** Whether a `trip_assignments` row with `ended_at IS NULL` currently exists for this Trip — the SAME authoritative definition `trip-assurance.ts` uses (ZD-051), never re-derived independently. */
  hasActiveAssignment: boolean;
  /** The active assignment's own `vehicle_id` — null both when there is no active assignment AND when there is one but no Vehicle was assigned to it; callers must check `hasActiveAssignment` first to distinguish the two (mirrors NEEDS_VEHICLE's own §5 semantics: it must never fire merely because there is no assignment at all). */
  assignedVehicleId: string | null;
  /** The active assignment's Driver's CURRENT `drivers.status` — null when there is no active assignment (meaningless/ignored in that case, never treated as "inactive"). A Driver's status can change after assignment; this is intentionally re-checked NOW, not assumed from assignment time. */
  driverStatus: string | null;
  /** The active assignment's Vehicle's CURRENT `vehicles.status` — null when there is no active assignment OR the active assignment has no Vehicle (meaningless/ignored in either case). */
  vehicleStatus: string | null;
  /** The Trip's own linked Passenger's CURRENT `passengers.status` — never null (`trips.passenger_id` is NOT NULL by schema, every Trip always has a Passenger). */
  passengerStatus: string;
  /** Count of real, currently OPEN `trip_exceptions` rows — the SAME authoritative definition `trip-assurance.ts` uses, never re-derived independently. */
  openExceptionCount: number;
}

export interface TripReadinessResult {
  state: TripReadinessState;
  /** Every applicable reason, in the fixed `REASON_ORDER` above — empty for both READY and NOT_APPLICABLE (never populated when inapplicable). */
  reasons: TripReadinessReasonCode[];
}

const SCHEDULED_STATE = "scheduled";

/**
 * Pure function: `facts → result`. No DB access, no `new Date()`
 * inside, no I/O of any kind — mirrors `deriveRequestReadiness`'s own
 * established shape exactly.
 *
 * NOT_APPLICABLE whenever `state !== 'scheduled'` (S4B §3's own locked
 * rule) — this includes every in-progress state
 * (en_route_to_pickup…arrived_at_destination, where Trip Assurance, not
 * Readiness, is the relevant lens) and every terminal state (completed,
 * cancelled, no_show). Readiness never evaluates, and never reports a
 * reason for, a Trip outside this one window.
 */
export function deriveTripReadiness(facts: TripReadinessFacts): TripReadinessResult {
  if (facts.state !== SCHEDULED_STATE) {
    return { state: "NOT_APPLICABLE", reasons: [] };
  }

  const applicable = new Set<TripReadinessReasonCode>();

  // NO_SCHEDULE — S4B §5: valid on this single-Trip evaluator; a Trip
  // reporting this reason cannot later be discovered by Tomorrow
  // Readiness's own date-range query, since it has no date to range
  // against. That limitation is intentionally NOT solved here (S4A/S4B
  // §11) — documented, not worked around.
  if (facts.scheduledPickupAt === null) {
    applicable.add("NO_SCHEDULE");
  }

  // NEEDS_DRIVER / NEEDS_VEHICLE — mutually exclusive by construction,
  // per §5's own explicit instruction: NEEDS_VEHICLE must NEVER fire
  // merely because there is no assignment at all (that is NEEDS_DRIVER's
  // own job). NEEDS_VEHICLE only ever applies when an active assignment
  // genuinely exists but carries no Vehicle.
  if (!facts.hasActiveAssignment) {
    applicable.add("NEEDS_DRIVER");
  } else if (facts.assignedVehicleId === null) {
    applicable.add("NEEDS_VEHICLE");
  }

  // DRIVER_INACTIVE / VEHICLE_INACTIVE — only meaningful when an active
  // assignment (and, for the Vehicle case, an assigned Vehicle) actually
  // exists; `driverStatus`/`vehicleStatus` are contractually null
  // otherwise, but the assignment check is still made explicit here
  // rather than relying solely on caller discipline (matching this
  // codebase's own established defensive-duplication style).
  if (facts.hasActiveAssignment && facts.driverStatus === "inactive") {
    applicable.add("DRIVER_INACTIVE");
  }
  if (facts.hasActiveAssignment && facts.assignedVehicleId !== null && facts.vehicleStatus === "inactive") {
    applicable.add("VEHICLE_INACTIVE");
  }

  // PASSENGER_INACTIVE — independent of assignment state entirely; a
  // Trip's own Passenger can go inactive regardless of whether the Trip
  // itself has been assigned yet. No resolution workflow is implied or
  // designed here (S4B §5's own explicit instruction) — this is a
  // truthful derived condition only.
  if (facts.passengerStatus === "inactive") {
    applicable.add("PASSENGER_INACTIVE");
  }

  // OPEN_EXCEPTION — identical meaning to Trip Assurance's own
  // `openExceptionCount > 0` check; never a second definition.
  if (facts.openExceptionCount > 0) {
    applicable.add("OPEN_EXCEPTION");
  }

  const reasons = REASON_ORDER.filter((code) => applicable.has(code));

  return {
    state: reasons.length > 0 ? "NEEDS_PREPARATION" : "READY",
    reasons,
  };
}
