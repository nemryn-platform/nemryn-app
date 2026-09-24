/**
 * Pure, framework-free Readiness-to-Action derivations (P1-OPS-PROG2).
 * No runtime imports -- unit-testable with Node's test runner, like
 * `trip-readiness-core.ts`. Nothing here stores or overrides readiness:
 * readiness stays derived by `deriveTripReadiness`, and the assignment
 * RPCs stay the only authority on whether an assignment is legal.
 */

/** The Trip states `assign_trip` / `reassign_trip` accept (20260831100200_controlled_trip_mutations.sql). UI gate only. */
export const ASSIGNABLE_TRIP_STATES: ReadonlySet<string> = new Set(["scheduled", "en_route_to_pickup", "arrived_at_pickup"]);

export interface TomorrowAssignFacts {
  state: string;
  hasActiveAssignment: boolean;
  /** Readiness reason codes exactly as derived (`TripReadinessReasonCode`). */
  reasons: readonly string[];
}

export interface TomorrowAssignAction {
  /** Unassigned -> Assign (assign_trip); assigned without a vehicle -> Reassign (reassign_trip, current driver kept). */
  mode: "assign" | "reassign";
  label: "Assign" | "Add vehicle";
}

/**
 * The inline Tomorrow action for a row, or null. Offered only when BOTH:
 *   - a readiness reason is assignment-related (NEEDS_DRIVER / NEEDS_VEHICLE), and
 *   - the Trip is in a state the assignment RPCs accept.
 * Any other reason (open exception, inactive passenger, ...) is left for
 * the operator on Trip Detail -- assignment never claims to fix it.
 */
export function deriveTomorrowAssignAction(facts: TomorrowAssignFacts): TomorrowAssignAction | null {
  if (!ASSIGNABLE_TRIP_STATES.has(facts.state)) return null;
  if (facts.reasons.includes("NEEDS_DRIVER") && !facts.hasActiveAssignment) {
    return { mode: "assign", label: "Assign" };
  }
  if (facts.reasons.includes("NEEDS_VEHICLE") && facts.hasActiveAssignment) {
    return { mode: "reassign", label: "Add vehicle" };
  }
  return null;
}

export interface TomorrowSummaryCounts {
  totalScheduledTrips: number;
  needsPreparationCount: number;
}

/**
 * The Overview "Tomorrow" line -- counts come straight from the derived
 * Tomorrow aggregate; no percentage, no score. `null` means the summary
 * could not be loaded (never rendered as zero).
 */
export function deriveTomorrowSummaryLine(summary: TomorrowSummaryCounts | null): string {
  if (summary === null) return "Tomorrow unavailable";
  const { totalScheduledTrips: total, needsPreparationCount: needs } = summary;
  if (total === 0) return "Nothing scheduled for tomorrow";
  const trips = `${total} ${total === 1 ? "trip" : "trips"}`;
  if (needs === 0) return `${trips} · All ready`;
  return `${trips} · ${needs} ${needs === 1 ? "needs" : "need"} preparation`;
}

export type CreateTripAssignmentOutcome = "not_requested" | "assigned" | "failed";

/**
 * The New Trip result states (PROG2 §8) -- kept distinct so a partial
 * success is never shown as a generic success or as a failed creation.
 */
export function createTripNoticeParam(outcome: CreateTripAssignmentOutcome): string | null {
  if (outcome === "assigned") return "assigned";
  if (outcome === "failed") return "assignment_failed";
  return null;
}
