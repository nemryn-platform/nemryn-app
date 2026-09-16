/**
 * Pure, framework-free Request readiness derivation (P1-E1-S2D).
 *
 * Deliberately has NO runtime import of any kind (mirrors
 * operations-brief-core.ts's established "pure core" split — a pure
 * core + a server-only wrapper/caller — so this logic can be
 * unit-tested directly with Node's test runner, loaded as a bare `.ts`
 * file, with no bundler and no database).
 *
 * Readiness answers exactly one question: "what prevents this Request
 * from becoming a Trip right now?" — derived ONLY from fields the real
 * `create_trip`/lifecycle RPCs actually require or reject on
 * (docs/reports/p1-e1-s2a-request-hub-product-workflow-audit.txt §10),
 * never a numeric score, never a weighted/AI-style signal. This module
 * computes the STATE only — presentation labels/colors live in
 * presentation.ts, kept deliberately separate (P1-E1-S2D §12's own
 * instruction: "keep the underlying state separate from presentation
 * labels").
 */

export type RequestReadiness = "ready" | "needs_passenger" | "not_convertible" | "accepted";

export interface RequestReadinessInput {
  /** transportation_requests.state — one of 'pending' | 'accepted' | 'declined' | 'cancelled'. */
  state: string;
  /** transportation_requests.passenger_id — null if no Passenger is linked. */
  passengerId: string | null;
  /** The linked Passenger's own `status === 'active'` — never inferred from passengerId alone (P1-E1-S2D §13: a linked-but-inactive Passenger is NOT ready). Meaningless/ignored when passengerId is null. */
  passengerActive: boolean;
}

/**
 * Mirrors create_trip's own actual validation exactly (re-verified
 * directly against 20260831120000_controlled_trip_creation.sql, not
 * assumed from the S2A report alone): the ONLY hard blocker beyond what
 * a saved Request already structurally guarantees (pickup/destination
 * are NOT NULL columns) is a missing or inactive linked Passenger, and
 * only while the Request is still `pending` — `declined`/`cancelled`
 * are rejected outright by create_trip's own `state not in ('pending',
 * 'accepted')` check, and an already-`accepted` Request (meaning at
 * least one Trip already exists) is not "needs review" in the same
 * sense a pending one is.
 */
export function deriveRequestReadiness(input: RequestReadinessInput): RequestReadiness {
  if (input.state === "accepted") {
    return "accepted";
  }
  if (input.state === "declined" || input.state === "cancelled") {
    return "not_convertible";
  }
  // pending (or any unrecognized value, treated defensively the same
  // way pending is — never silently claimed "ready" for an unknown
  // state).
  if (input.passengerId !== null && input.passengerActive) {
    return "ready";
  }
  return "needs_passenger";
}
