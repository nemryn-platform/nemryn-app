/**
 * record_trip_completion_by_operations (P1-PILOT-R2C) error codes -> calm operator copy. Never exposes a ZW code,
 * SQLSTATE or raw PostgREST text. Mirrors trip-edit-errors.ts. The field-specific codes come from the Server Action's
 * pre-checks (the RPC re-checks every one of them and answers ZW006).
 */
export type TripCompletionErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "STALE"
  | "NOT_ELIGIBLE"
  | "NO_ACTIVE_ASSIGNMENT"
  | "NOTE_REQUIRED"
  | "NOTE_TOO_SHORT"
  | "NOTE_TOO_LONG"
  | "TIME_REQUIRED"
  | "TIME_IN_FUTURE"
  | "TIME_BEFORE_LAST_STEP"
  | "TIME_UNRESOLVABLE"
  | "INVALID_INPUT"
  | "UNKNOWN";

const MESSAGE: Record<TripCompletionErrorCode, string> = {
  UNAUTHORIZED: "Your session is no longer valid. Sign in again.",
  NOT_FOUND: "This trip is no longer available.",
  STALE: "This trip changed. Refresh and review the latest status.",
  NOT_ELIGIBLE: "This trip can no longer be completed this way.",
  NO_ACTIVE_ASSIGNMENT: "This trip has no active driver assignment, so its completion can't be recorded here.",
  NOTE_REQUIRED: "Add a note saying how completion was confirmed.",
  NOTE_TOO_SHORT: "Add a little more detail — at least 10 characters.",
  NOTE_TOO_LONG: "Keep the note to 500 characters or fewer.",
  TIME_REQUIRED: "Enter the completion date and time.",
  TIME_IN_FUTURE: "The completion time can't be in the future.",
  TIME_BEFORE_LAST_STEP: "The completion time can't be before the driver's last recorded step.",
  TIME_UNRESOLVABLE: "That time doesn't exist or is ambiguous because of a daylight-saving change. Pick a different time.",
  INVALID_INPUT: "Check the completion time and the note, then try again.",
  UNKNOWN: "Something went wrong. Try again.",
};

/** Codes that belong to a single field (shown under it rather than as a page-level alert). */
export const NOTE_ERROR_CODES: ReadonlySet<TripCompletionErrorCode> = new Set(["NOTE_REQUIRED", "NOTE_TOO_SHORT", "NOTE_TOO_LONG"]);
export const TIME_ERROR_CODES: ReadonlySet<TripCompletionErrorCode> = new Set([
  "TIME_REQUIRED",
  "TIME_IN_FUTURE",
  "TIME_BEFORE_LAST_STEP",
  "TIME_UNRESOLVABLE",
]);

export function mapTripCompletionError(code: string | undefined): TripCompletionErrorCode {
  switch (code) {
    case "ZW001":
      return "UNAUTHORIZED";
    case "ZW002":
      return "NOT_FOUND";
    case "ZW003":
      return "STALE";
    case "ZW004":
      return "NOT_ELIGIBLE";
    case "ZW006":
      return "INVALID_INPUT";
    default:
      return "UNKNOWN";
  }
}

export function tripCompletionErrorMessage(code: TripCompletionErrorCode): string {
  return MESSAGE[code];
}
