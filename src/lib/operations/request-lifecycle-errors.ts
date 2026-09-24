/**
 * Narrow ZW-code → user-facing message mapping for Request Detail's
 * lifecycle actions (Accept/Decline/Cancel — P1-E1-S2F-B2, P1-OPS-R1) — mirrors
 * `trip-detail-errors.ts`'s established 5-code pattern exactly (the
 * closest precedent: both wrap a mutation RPC that can legally raise
 * unauthorized/not-found/illegal-transition/invalid-input). Never
 * exposes a ZW code, SQLSTATE, or raw PostgREST error text to an
 * Operations user.
 *
 * Deliberately ONE shared mapper for both
 * `decline_transportation_request` and `cancel_transportation_request`
 * (P1-E1-S2F-B2 §21) — both RPCs raise the exact same four codes
 * (ZW001/ZW002/ZW004/ZW006, confirmed directly against
 * 20260916100000_request_mutation_foundation.sql before writing this),
 * so a second, near-duplicate error map would add nothing.
 */
export type RequestLifecycleErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "ILLEGAL_STATE" | "INVALID_INPUT" | "UNKNOWN";

const REQUEST_LIFECYCLE_ERROR_MESSAGE: Record<RequestLifecycleErrorCode, string> = {
  UNAUTHORIZED: "Your session is no longer valid. Sign in again.",
  NOT_FOUND: "This request is no longer available.",
  // Exact restrained copy specified for the stale-state/concurrent-
  // transition case (P1-E1-S2F-B2 §14) — never mentions ZW004.
  ILLEGAL_STATE: "This request has changed and can no longer be updated this way.",
  INVALID_INPUT: "Please check the information provided and try again.",
  UNKNOWN: "Something went wrong. Try again.",
};

/**
 * Maps a real ZW code — `decline_transportation_request`'s and
 * `cancel_transportation_request`'s own shared errcode contract — to a
 * narrow, user-safe category. Every branch corresponds to a code these
 * RPCs actually raise; none is guessed.
 */
export function mapRequestLifecycleError(code: string | undefined): RequestLifecycleErrorCode {
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

export function requestLifecycleErrorMessage(code: RequestLifecycleErrorCode): string {
  return REQUEST_LIFECYCLE_ERROR_MESSAGE[code];
}
