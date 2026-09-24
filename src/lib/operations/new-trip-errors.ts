/**
 * Narrow ZW-code → user-facing message mapping for `create_trip` (P1-E3-S7,
 * work item §37) — mirrors `dispatch-errors.ts`/`trip-detail-errors.ts`'s
 * established pattern exactly. Never exposes a ZW code, SQLSTATE, or raw
 * PostgREST error text to an Operations user.
 *
 * `create_trip` itself (20260831120000_controlled_trip_creation.sql) only
 * ever raises 3 distinct codes — ZW001 (no session), ZW002 (not an
 * Organization Admin/Dispatcher for this organization), and ZW006 (every
 * other validation failure: blank/oversized address, invalid Passenger,
 * invalid Facility, invalid/ineligible Request, or bad time ordering, all
 * collapsed into the SAME code by the function itself). This mapping does
 * not invent finer-grained categories the RPC doesn't actually provide —
 * `INVALID_INPUT` below is deliberately one bucket, with a message broad
 * enough to cover every real cause, matching "Use actual create_trip
 * errors" (work item §37) rather than guessing which field was the problem.
 * `SCHEDULE_UNRESOLVABLE` is the one code this module adds on top of the
 * RPC's own contract — for a local-time conversion failure (DST
 * nonexistent/ambiguous, work item §23) caught before the RPC is ever
 * called, never returned by create_trip itself.
 */
export type NewTripErrorCode =
  | "UNAUTHORIZED"
  | "ACCESS_UNAVAILABLE"
  | "INVALID_INPUT"
  | "SCHEDULE_UNRESOLVABLE"
  | "ASSIGN_DRIVER_REQUIRED"
  | "UNKNOWN";

const NEW_TRIP_ERROR_MESSAGE: Record<NewTripErrorCode, string> = {
  UNAUTHORIZED: "Your session is no longer valid. Sign in again.",
  ACCESS_UNAVAILABLE: "You don't have permission to create trips for this organization.",
  INVALID_INPUT:
    "Could not create this trip. Check the passenger, pickup, destination, schedule, and any linked request, then try again.",
  SCHEDULE_UNRESOLVABLE:
    "That date and time couldn't be resolved in the organization's timezone (it may fall in a daylight-saving change). Choose a different time.",
  // P1-OPS-PROG2: caught BEFORE create_trip runs, so nothing is created.
  ASSIGN_DRIVER_REQUIRED: "Choose a driver for Assign now, or turn Assign now off to create the trip unassigned.",
  UNKNOWN: "Something went wrong. Try again.",
};

/** Maps a real ZW code (create_trip's own errcode contract) to a narrow, user-safe category. Never inferred/guessed — every branch corresponds to a code the RPC actually raises. */
export function mapNewTripError(code: string | undefined): NewTripErrorCode {
  switch (code) {
    case "ZW001":
      return "UNAUTHORIZED";
    case "ZW002":
      return "ACCESS_UNAVAILABLE";
    case "ZW006":
      return "INVALID_INPUT";
    default:
      return "UNKNOWN";
  }
}

export function newTripErrorMessage(code: NewTripErrorCode): string {
  return NEW_TRIP_ERROR_MESSAGE[code];
}
