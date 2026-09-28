/**
 * Pure, framework-free Request readiness + action derivation (P1-E1-S2D,
 * reworked by P1-OPS-R1).
 *
 * Deliberately has NO runtime import of any kind (mirrors
 * operations-brief-core.ts's established "pure core" split — a pure
 * core + a server-only wrapper/caller — so this logic can be
 * unit-tested directly with Node's test runner, loaded as a bare `.ts`
 * file, with no bundler and no database).
 *
 * P1-OPS-R1 separates two concepts that were previously merged:
 *   - DECISION (stored `state`): pending → accepted | declined;
 *     accepted → cancelled. Set only by the explicit accept/decline/
 *     cancel RPCs — never by Passenger linking or Trip creation.
 *   - READINESS (derived here): what still prevents an ACCEPTED Request
 *     from becoming a Trip. The only operational requirement is the one
 *     `create_trip` itself enforces — an active linked Passenger. No new
 *     readiness requirement is invented.
 * This module computes STATE only — presentation labels/colors live in
 * presentation.ts.
 */

export type RequestReadiness =
  /** Pending, Passenger already resolved — only the business decision is outstanding. */
  | "awaiting_decision"
  /** No active linked Passenger (pending or accepted-without-Trips). */
  | "needs_passenger"
  /** Accepted + active linked Passenger + no Trip yet — Create Trip is available. */
  | "ready"
  /** Accepted and at least one NON-cancelled Trip exists (request-fulfilment-core: fulfilled). */
  | "trip_created"
  /** P1-PILOT-R2B: accepted, Trips were created, but every one of them is cancelled -- the ride still needs a Trip. */
  | "trip_cancelled"
  /** P1-PILOT-R3: accepted and at least one recurring arrangement was created from it (any status -- D-R3-1). Takes precedence over the Trip readiness values. */
  | "arrangement_created"
  /** Declined / cancelled — terminal. */
  | "not_convertible";

export interface RequestReadinessInput {
  /** transportation_requests.state — one of 'pending' | 'accepted' | 'declined' | 'cancelled'. */
  state: string;
  /** transportation_requests.passenger_id — null if no Passenger is linked. */
  passengerId: string | null;
  /** The linked Passenger's own `status === 'active'` — never inferred from passengerId alone (a linked-but-inactive Passenger is NOT ready). Ignored when passengerId is null. */
  passengerActive: boolean;
  /** Whether at least one Trip exists for this Request (Request → Trip is 1:N), cancelled ones included. */
  hasLinkedTrips: boolean;
  /**
   * P1-PILOT-R2B: whether at least one linked Trip is NOT cancelled (request-fulfilment-core `hasActiveTrip`).
   * Omitted = same as hasLinkedTrips (callers that cannot distinguish keep the pre-R2B meaning).
   */
  hasActiveTrips?: boolean;
  /** P1-PILOT-R3: at least one recurring_arrangements row references this Request (active, paused or ended). Omitted = false. */
  hasLinkedArrangement?: boolean;
  /** P1-PILOT-R3: the Request carries a STRUCTURED recurring schedule (recurring_days_of_week present). Omitted = false. */
  hasRecurringIntent?: boolean;
}

export function deriveRequestReadiness(input: RequestReadinessInput): RequestReadiness {
  if (input.state === "declined" || input.state === "cancelled") {
    return "not_convertible";
  }
  if (input.state === "accepted" && input.hasLinkedArrangement) {
    return "arrangement_created";
  }
  if (input.hasLinkedTrips) {
    return (input.hasActiveTrips ?? true) ? "trip_created" : "trip_cancelled";
  }
  const passengerResolved = input.passengerId !== null && input.passengerActive;
  if (input.state === "accepted") {
    return passengerResolved ? "ready" : "needs_passenger";
  }
  // pending (or any unrecognized value, treated defensively like pending —
  // never "ready", because only an accepted Request may become a Trip).
  return passengerResolved ? "awaiting_decision" : "needs_passenger";
}

export interface RequestActions {
  canAccept: boolean;
  canDecline: boolean;
  /** Accepted, no Trip yet. Request-level cancel never cascades into Trips. */
  canCancel: boolean;
  /** Accepted + a Trip already exists: cancellation is managed on the Trip instead. */
  cancelBlockedByTrips: boolean;
  /** First Trip from an accepted, ready Request. */
  canCreateTrip: boolean;
  /** Additional Trip (return / multi-leg) from an accepted Request whose Passenger is still active. */
  canCreateAnotherTrip: boolean;
  /** Mirrors link_request_passenger: pending or accepted, until the first Trip (P1-PILOT-R3: or recurring arrangement) exists. */
  canLinkPassenger: boolean;
  /** P1-PILOT-R3: accepted + a recurring arrangement exists -- cancellation is managed on the arrangement instead. */
  cancelBlockedByArrangement: boolean;
  /**
   * P1-PILOT-R3: Request -> Recurring Care. Offered for an accepted Request with an active linked Passenger that carries
   * a structured recurring schedule, or that already produced an arrangement (then as "Create another ..." -- e.g. a
   * separate return schedule). create_recurring_arrangement re-checks accepted / same org / Passenger.
   */
  canCreateRecurringArrangement: boolean;
}

/**
 * UI gating only — every rule here is re-enforced by the database RPCs
 * (accept/decline/cancel_transportation_request, link_request_passenger,
 * create_trip), which remain the authority.
 */
export function deriveRequestActions(input: RequestReadinessInput): RequestActions {
  const isPending = input.state === "pending";
  const isAccepted = input.state === "accepted";
  const passengerActive = input.passengerId !== null && input.passengerActive;
  const hasArrangement = input.hasLinkedArrangement === true;
  return {
    canAccept: isPending,
    canDecline: isPending,
    canCancel: isAccepted && !input.hasLinkedTrips && !hasArrangement,
    cancelBlockedByTrips: isAccepted && input.hasLinkedTrips,
    canCreateTrip: isAccepted && !input.hasLinkedTrips && passengerActive,
    canCreateAnotherTrip: isAccepted && input.hasLinkedTrips && passengerActive,
    canLinkPassenger: (isPending || isAccepted) && !input.hasLinkedTrips && !hasArrangement,
    cancelBlockedByArrangement: isAccepted && !input.hasLinkedTrips && hasArrangement,
    canCreateRecurringArrangement: isAccepted && passengerActive && (input.hasRecurringIntent === true || hasArrangement),
  };
}
