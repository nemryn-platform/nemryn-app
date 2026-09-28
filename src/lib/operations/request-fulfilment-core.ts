/**
 * Pure Request fulfilment (P1-PILOT-R2B, PR-03). Runtime-import-free.
 *
 * ONE definition shared by the Overview stranded count, the Requests "needs a trip" filter and Request readiness:
 *   fulfilled = hasActiveTrip OR hasLinkedArrangement
 * - Active Trip = a linked Trip whose state is NOT 'cancelled'. Completed / no_show Trips are historical fulfilment:
 *   they never re-strand the Request. A cancelled-only Trip set does NOT fulfil it.
 * - P1-PILOT-R3 (PR-04, owner decision D-R3-1): hasLinkedArrangement = ANY recurring_arrangements row with
 *   request_id = the Request (same organization), whatever its status -- active, paused or ENDED. An arrangement that
 *   legitimately fulfilled a standing-order Request does not re-strand it when it later concludes. Several
 *   arrangements may reference one Request (D-R3-2); one is enough (a return-trip expectation never makes fulfilment
 *   depend on a second one).
 * Stranded = state 'accepted' AND not fulfilled. Pending / declined / cancelled Requests are never stranded.
 */

export const CANCELLED_TRIP_STATE = "cancelled";

export interface RequestFulfilmentFacts {
  /** transportation_requests.state */
  state: string;
  /** States of every Trip linked through trips.request_id (any order; may be empty). */
  linkedTripStates: readonly string[];
  /** P1-PILOT-R3: at least one recurring arrangement was created from this Request (any status). */
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

/**
 * Overview copy (P1-PILOT-R3): "1 accepted request still needs a trip or recurring arrangement" /
 * "N accepted requests still need a trip or recurring arrangement".
 */
export function strandedRequestsLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 accepted request still needs a trip or recurring arrangement"
    : `${count} accepted requests still need a trip or recurring arrangement`;
}

export const STRANDED_REQUESTS_HREF = "/operations/requests?state=accepted&needs=trip";
