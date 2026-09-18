/**
 * Narrow ZW-code → user-facing message mapping for every Recurring Care
 * mutation server action (P1-E2-S1E) — mirrors `request-lifecycle-
 * errors.ts`'s established pattern exactly. Never exposes a ZW code,
 * SQLSTATE, or raw PostgREST error text to an Operations user.
 *
 * ONE shared mapper for all 8 RPCs this phase's server actions call
 * (create/edit/pause/resume/end_recurring_arrangement,
 * skip/unskip_recurring_occurrence, create_trip_for_recurring_occurrence)
 * — confirmed directly against 20260917110000_recurring_arrangement_
 * lifecycle_mutations.sql and 20260918090000_recurring_occurrence_trip_
 * creation.sql before writing this: every one of the 8 raises only a
 * subset of {ZW001, ZW002, ZW004, ZW006} (never ZW003, never ZW005 — no
 * assignment concept exists here), so a single shared map is correct and
 * sufficient, exactly like request-lifecycle-errors.ts's own reasoning
 * for decline/cancel_transportation_request.
 */
export type RecurringArrangementErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "ILLEGAL_STATE" | "INVALID_INPUT" | "UNKNOWN";

const RECURRING_ARRANGEMENT_ERROR_MESSAGE: Record<RecurringArrangementErrorCode, string> = {
  UNAUTHORIZED: "Your session is no longer valid. Sign in again.",
  NOT_FOUND: "This recurring arrangement is no longer available.",
  ILLEGAL_STATE: "This arrangement has changed and can no longer be updated this way.",
  INVALID_INPUT: "Please check the information provided and try again.",
  UNKNOWN: "Something went wrong. Try again.",
};

/**
 * Maps a real ZW code to a narrow, user-safe category. Every branch
 * corresponds to a code these RPCs actually raise; none is guessed.
 */
export function mapRecurringArrangementError(code: string | undefined): RecurringArrangementErrorCode {
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

export function recurringArrangementErrorMessage(code: RecurringArrangementErrorCode): string {
  return RECURRING_ARRANGEMENT_ERROR_MESSAGE[code];
}
