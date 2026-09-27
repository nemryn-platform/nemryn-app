/**
 * Pure Request fulfilment (P1-PILOT-R2B, PR-03). Runtime-import-free.
 *
 * ONE definition shared by the Overview stranded count, the Requests "needs a trip" filter and Request readiness:
 *   fulfilled = hasActiveTrip OR hasLinkedArrangement
 * - Active Trip = a linked Trip whose state is NOT 'cancelled'. Completed / no_show Trips are historical fulfilment:
 *   they never re-strand the Request. A cancelled-only Trip set does NOT fulfil it.
 * - hasLinkedArrangement is always false in R2B (Request -> Recurring Care, PR-04, is a future R3). R3 supplies it
 *   without changing any caller. Owner decision D-4: an arrangement that legitimately fulfilled a recurring Request
 *   and is later ended does NOT re-strand the historical Request (R3 formalizes that query).
 * Stranded = state 'accepted' AND not fulfilled. Pending / declined / cancelled Requests are never stranded.
 */

export const CANCELLED_TRIP_STATE = "cancelled";

export interface RequestFulfilmentFacts {
  /** transportation_requests.state */
  state: string;
  /** States of every Trip linked through trips.request_id (any order; may be empty). */
  linkedTripStates: readonly string[];
  /** R3 (PR-04) hook -- always false in R2B. */
  hasLinkedArrangement: boolean;
}

export function hasActiveTrip(linkedTripStates: readonly string[]): boolean {
  return linkedTripStates.some((s) => s !== CANCELLED_TRIP_STATE);
}

export function isRequestFulfilled(facts: RequestFulfilmentFacts): boolean {
  return hasActiveTrip(facts.linkedTripStates) || facts.hasLinkedArrangement;
}

export function isRequestStranded(facts: RequestFulfilmentFacts): boolean {
  return facts.state === "accepted" && !isRequestFulfilled(facts);
}

/** Overview copy: "1 accepted request still needs a trip" / "N accepted requests still need a trip". */
export function strandedRequestsLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 accepted request still needs a trip" : `${count} accepted requests still need a trip`;
}

export const STRANDED_REQUESTS_HREF = "/operations/requests?state=accepted&needs=trip";
