/**
 * Narrow ZW-code → user-facing message mapping for
 * `log_transportation_request` (P1-E1-S2C) — mirrors
 * `new-trip-errors.ts`'s established pattern exactly. Never exposes a ZW
 * code, SQLSTATE, or raw PostgREST error text to an Operations user.
 *
 * `log_transportation_request` itself
 * (20260916100000_request_mutation_foundation.sql) only ever raises 3
 * distinct codes — ZW001 (no session), ZW002 (not an Organization
 * Admin/Dispatcher for this organization), and ZW006 (every other
 * validation failure: blank/oversized required field, invalid
 * requester_relationship/return_trip_needed/source, or an
 * invalid/foreign-org/inactive Passenger — all collapsed into the SAME
 * code by the function itself). This mapping does not invent
 * finer-grained categories the RPC doesn't actually provide, matching
 * `new-trip-errors.ts`'s own "use actual RPC errors" discipline.
 */
export type LogRequestErrorCode = "UNAUTHORIZED" | "ACCESS_UNAVAILABLE" | "INVALID_INPUT" | "UNKNOWN";

const LOG_REQUEST_ERROR_MESSAGE: Record<LogRequestErrorCode, string> = {
  UNAUTHORIZED: "Your session is no longer valid. Sign in again.",
  ACCESS_UNAVAILABLE: "You don't have permission to log requests for this organization.",
  INVALID_INPUT:
    "Could not log this request. Check the requester details, pickup, destination, and any linked passenger, then try again.",
  UNKNOWN: "Something went wrong. Try again.",
};

/** Maps a real ZW code (log_transportation_request's own errcode contract) to a narrow, user-safe category. Never inferred/guessed — every branch corresponds to a code the RPC actually raises. */
export function mapLogRequestError(code: string | undefined): LogRequestErrorCode {
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

export function logRequestErrorMessage(code: LogRequestErrorCode): string {
  return LOG_REQUEST_ERROR_MESSAGE[code];
}
