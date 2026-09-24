/**
 * Pure, framework-free Progressive Assignment derivations (P1-OPS-PROG1,
 * docs/reports/p1-ops-prog-progressive-operations-model.txt).
 *
 * Deliberately has NO runtime import of any kind -- no Supabase, no
 * `server-only`, no React -- mirroring `trip-readiness-core.ts`, so every
 * rule here is directly unit-testable with Node's test runner.
 *
 * Everything in this module is a CONVENIENCE: an initial form value, an
 * option order, a factual context list. None of it writes anything, and
 * none of it is a validation. `assign_trip` / `reassign_trip` remain the
 * sole authority on same-organization, active Driver/Vehicle, assignable
 * Trip state, one active assignment per Trip and the expected-assignment
 * precondition -- a prefilled value is submitted only when the operator
 * clicks Assign / Confirm Reassignment, exactly like a hand-picked one.
 */

export interface AssignmentOption {
  id: string;
}

export type AssignmentMode = "assign" | "reassign";

/**
 * P1-OPS-PROG2: the Driver/Vehicle of the most recent COMPLETED occurrence
 * of the same recurring arrangement (see `selectRecurringAssignmentHint`).
 * Historical convenience only -- never a stored preference.
 */
export interface RecurringAssignmentHint {
  driverId: string;
  /** Null when that occurrence was completed with no vehicle -- never invented. */
  vehicleId: string | null;
}

export interface AssignmentDefaultsInput {
  mode: AssignmentMode;
  /** The Trip's CURRENT active assignment values (null when unassigned / no vehicle). */
  currentDriverId: string | null;
  currentVehicleId: string | null;
  /** Eligible options exactly as offered to the operator (`status='active'`, same organization). */
  driverOptions: AssignmentOption[];
  vehicleOptions: AssignmentOption[];
  /** P1-OPS-PROG2: recurring-history hint for a Trip generated from a recurring arrangement, or null/absent. */
  recurringHint?: RecurringAssignmentHint | null;
}

export type AssignmentDefaultSource = "existing" | "recurring_history" | "only_option" | "none";

export interface AssignmentDefaults {
  driverId: string | null;
  driverSource: AssignmentDefaultSource;
  vehicleId: string | null;
  vehicleSource: AssignmentDefaultSource;
}

function has(options: AssignmentOption[], id: string | null): id is string {
  return id !== null && options.some((option) => option.id === id);
}

/**
 * Initial Driver/Vehicle values for the Assign / Reassign dialog.
 *
 * Priority:
 *   1. REASSIGN: the existing active assignment's own Driver/Vehicle, each
 *      only while it is still an eligible option. Uniqueness defaults are
 *      NEVER applied when reassigning -- an existing assignment is never
 *      overwritten by a "there is only one" default, and a resource that
 *      became inactive is never silently swapped for a different one (the
 *      field is left empty for the operator to choose). An existing
 *      assignment with no vehicle stays "No vehicle".
 *   2. ASSIGN, each field independently (P1-OPS-PROG2):
 *        a. the recurring-history hint's value, only while it is still an
 *           eligible option (an inactive historical Driver/Vehicle is
 *           ignored, never substituted by "something similar");
 *        b. otherwise the ONLY eligible option (PROG1 uniqueness rule);
 *        c. otherwise nothing is guessed.
 *      A hint with no vehicle contributes no vehicle -- the field falls
 *      through to the uniqueness rule, it is never invented from history.
 */
export function deriveAssignmentDefaults(input: AssignmentDefaultsInput): AssignmentDefaults {
  if (input.mode === "reassign") {
    const driverKept = has(input.driverOptions, input.currentDriverId);
    const vehicleKept = has(input.vehicleOptions, input.currentVehicleId);
    return {
      driverId: driverKept ? input.currentDriverId : null,
      driverSource: driverKept ? "existing" : "none",
      vehicleId: vehicleKept ? input.currentVehicleId : null,
      vehicleSource: vehicleKept ? "existing" : "none",
    };
  }

  const hint = input.recurringHint ?? null;
  const pick = (options: AssignmentOption[], hinted: string | null): { id: string | null; source: AssignmentDefaultSource } => {
    if (has(options, hinted)) return { id: hinted, source: "recurring_history" };
    if (options.length === 1) return { id: options[0].id, source: "only_option" };
    return { id: null, source: "none" };
  };
  const driver = pick(input.driverOptions, hint?.driverId ?? null);
  const vehicle = pick(input.vehicleOptions, hint?.vehicleId ?? null);
  return { driverId: driver.id, driverSource: driver.source, vehicleId: vehicle.id, vehicleSource: vehicle.source };
}

/** One completed occurrence of a recurring arrangement, with the assignment that completed it. */
export interface RecurringHistoryRow {
  tripId: string;
  recurringArrangementId: string;
  state: string;
  scheduledPickupAt: string | null;
  /** The assignment in place when the Trip completed (`end_reason='trip_completed'`, or still open), or null. */
  completedBy: { driverId: string; vehicleId: string | null } | null;
}

/**
 * The most recent COMPLETED occurrence of the SAME recurring arrangement
 * scheduled strictly before the target Trip, that has a usable completing
 * assignment. Explicit relational linkage only (`trips.recurring_arrangement_id`);
 * never passenger/address/time-text matching. Unassigned, cancelled and
 * no-show occurrences never count. Eligibility (still active) is applied
 * later by `deriveAssignmentDefaults` against the live option lists.
 */
export function selectRecurringAssignmentHint(
  target: { tripId: string; recurringArrangementId: string | null; scheduledPickupAt: string | null },
  history: RecurringHistoryRow[],
): RecurringAssignmentHint | null {
  if (!target.recurringArrangementId || !target.scheduledPickupAt) return null;
  const targetAt = Date.parse(target.scheduledPickupAt);
  if (Number.isNaN(targetAt)) return null;
  let best: RecurringHistoryRow | null = null;
  let bestAt = -Infinity;
  for (const row of history) {
    if (row.recurringArrangementId !== target.recurringArrangementId || row.tripId === target.tripId) continue;
    if (row.state !== "completed" || row.completedBy === null || row.scheduledPickupAt === null) continue;
    const at = Date.parse(row.scheduledPickupAt);
    if (Number.isNaN(at) || at >= targetAt) continue;
    if (at > bestAt || (at === bestAt && best !== null && row.tripId > best.tripId)) {
      best = row;
      bestAt = at;
    }
  }
  return best?.completedBy ? { driverId: best.completedBy.driverId, vehicleId: best.completedBy.vehicleId } : null;
}

export interface DriverOptionInput {
  id: string;
  displayName: string;
}

export interface OrderedDriverOption {
  id: string;
  displayName: string;
  /** Presentation label -- "<name> (you)" for the operator's own linked Driver. Never written back to `drivers.display_name`. */
  label: string;
  isSelf: boolean;
}

/**
 * Owner-as-driver ordering: the operator's own linked, eligible Driver is
 * listed FIRST and labelled "(you)"; everyone else keeps the incoming
 * (alphabetical) order. Ordering only -- it never selects anything.
 */
export function orderDriversForOperator(
  options: DriverOptionInput[],
  operatorDriverId: string | null,
): OrderedDriverOption[] {
  const mapped = options.map((option) => {
    const isSelf = operatorDriverId !== null && option.id === operatorDriverId;
    return {
      id: option.id,
      displayName: option.displayName,
      label: isSelf ? `${option.displayName} (you)` : option.displayName,
      isSelf,
    };
  });
  const self = mapped.filter((option) => option.isSelf);
  const others = mapped.filter((option) => !option.isSelf);
  return [...self, ...others];
}

/** Trip states in which a Driver is provably on a trip right now (lifecycle-model.md). */
export const IN_PROGRESS_TRIP_STATES: ReadonlySet<string> = new Set([
  "en_route_to_pickup",
  "arrived_at_pickup",
  "passenger_onboard",
  "en_route_to_destination",
  "arrived_at_destination",
]);

export const TERMINAL_TRIP_STATES: ReadonlySet<string> = new Set(["completed", "cancelled", "no_show"]);

/** One of the selected Driver's Trips that currently holds an ACTIVE assignment to that Driver. */
export interface DriverTripFact {
  tripId: string;
  state: string;
  scheduledPickupAt: string | null;
  pickupDescription: string;
  destinationDescription: string;
}

export interface DriverDayFactsInput {
  /** The Trip being assigned / reassigned -- always excluded. */
  targetTripId: string;
  /** The target Trip's organization-local calendar day as a UTC half-open window, or null when the Trip has no scheduled pickup. */
  dayStartUtc: string | null;
  dayEndUtc: string | null;
  trips: DriverTripFact[];
}

export interface DriverDayFacts {
  /** Other non-terminal Trips the Driver holds on the target day, earliest first. Empty when the target Trip is unscheduled. */
  otherTrips: DriverTripFact[];
  /** A Trip (other than the target) the Driver is on right now, if the data proves one. Any day -- an in-progress Trip is current regardless of its scheduled date. */
  currentTrip: DriverTripFact | null;
}

/**
 * "What else is this Driver already doing that day?" -- facts only. No
 * duration, drop-off, route or availability exists, so nothing here
 * compares times against each other or claims any overlap; the caller
 * presents pickup times as they are.
 */
export function deriveDriverDayFacts(input: DriverDayFactsInput): DriverDayFacts {
  const candidates = input.trips.filter(
    (trip) => trip.tripId !== input.targetTripId && !TERMINAL_TRIP_STATES.has(trip.state),
  );

  let otherTrips: DriverTripFact[] = [];
  if (input.dayStartUtc !== null && input.dayEndUtc !== null) {
    const start = Date.parse(input.dayStartUtc);
    const end = Date.parse(input.dayEndUtc);
    const seen = new Set<string>();
    otherTrips = candidates
      .filter((trip) => {
        if (trip.scheduledPickupAt === null || seen.has(trip.tripId)) return false;
        const at = Date.parse(trip.scheduledPickupAt);
        if (Number.isNaN(at) || at < start || at >= end) return false;
        seen.add(trip.tripId);
        return true;
      })
      .sort((a, b) => Date.parse(a.scheduledPickupAt as string) - Date.parse(b.scheduledPickupAt as string));
  }

  const inProgress = candidates
    .filter((trip) => IN_PROGRESS_TRIP_STATES.has(trip.state))
    .sort((a, b) => (Date.parse(a.scheduledPickupAt ?? "") || 0) - (Date.parse(b.scheduledPickupAt ?? "") || 0));

  return { otherTrips, currentTrip: inProgress[0] ?? null };
}

export type VehicleGuidance = "none" | "no_vehicle_selected" | "no_active_vehicles";

/** Non-blocking vehicle guidance -- `vehicle_id` stays optional exactly as the model allows. */
export function deriveVehicleGuidance(vehicleOptionCount: number, selectedVehicleId: string | null): VehicleGuidance {
  if (vehicleOptionCount === 0) return "no_active_vehicles";
  return selectedVehicleId ? "none" : "no_vehicle_selected";
}
