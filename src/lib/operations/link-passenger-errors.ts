/**
 * Narrow ZW-code → user-facing message mapping for `link_request_passenger`
 * (P1-E1-S2E) — mirrors `trip-detail-errors.ts`'s established 5-code
 * pattern exactly (the closest precedent: both wrap a mutation RPC that
 * can legally raise unauthorized/not-found/illegal-transition/invalid-
 * input). Never exposes a ZW code, SQLSTATE, or raw PostgREST error text
 * to an Operations user.
 *
 * `link_request_passenger` itself
 * (20260916100000_request_mutation_foundation.sql) only ever raises 4
 * distinct codes — ZW001 (no session), ZW002 (not an Organization Admin/
 * Dispatcher for this organization, OR the target Request doesn't exist/
 * isn't in the caller's organization — indistinguishable by design, no
 * existence oracle), ZW004 (the Request is no longer `pending` — already
 * accepted/declined/cancelled), and ZW006 (the passenger_id is null,
 * nonexistent, foreign-org, or not `active` — all collapsed into the SAME
 * code by the function itself, matching the RPC's own doc comment). This
 * mapping does not invent finer-grained categories the RPC doesn't
 * actually provide.
 */
export type LinkPassengerErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "ILLEGAL_STATE" | "INVALID_INPUT" | "UNKNOWN";

const LINK_PASSENGER_ERROR_MESSAGE: Record<LinkPassengerErrorCode, string> = {
  UNAUTHORIZED: "Your session is no longer valid. Sign in again.",
  NOT_FOUND: "This request is no longer available.",
  ILLEGAL_STATE: "This request can no longer be changed in this way.",
  INVALID_INPUT: "Selected passenger is unavailable.",
  UNKNOWN: "Something went wrong. Try again.",
};

/** Maps a real ZW code (link_request_passenger's own errcode contract) to a narrow, user-safe category. Every branch corresponds to a code the RPC actually raises; none is guessed. */
export function mapLinkPassengerError(code: string | undefined): LinkPassengerErrorCode {
  switch (code) {
    case "ZW001":
      return "UNAUTHORIZED";
    case "ZW002":
      return "NOT_FOUND";
    case "ZW004":
      return "ILLEGAL_STATE";
    case "ZW006":
      return "INVALID_INPUT";
    default:
      return "UNKNOWN";
  }
}

export function linkPassengerErrorMessage(code: LinkPassengerErrorCode): string {
  return LINK_PASSENGER_ERROR_MESSAGE[code];
}
