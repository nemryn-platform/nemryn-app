/**
 * update_trip_details (P1-PILOT-R2B) error codes -> calm operator copy. Never exposes a ZW code, SQLSTATE or raw
 * PostgREST text. Mirrors trip-detail-errors.ts.
 */
export type TripEditErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "STALE"
  | "LOCKED"
  | "EN_ROUTE_DATE"
  | "RECURRING_DATE"
  | "INVALID_INPUT"
  | "SCHEDULE_UNRESOLVABLE"
  | "UNKNOWN";

const MESSAGE: Record<TripEditErrorCode, string> = {
  UNAUTHORIZED: "Your session is no longer valid. Sign in again.",
  NOT_FOUND: "This trip is no longer available.",
  STALE: "This trip changed since you opened it. Refresh and review the latest details.",
  LOCKED: "This detail can't be changed at the trip's current stage.",
  EN_ROUTE_DATE: "The driver is already on the way, so the pickup date can't change. Only the time can.",
  RECURRING_DATE: "A recurring trip keeps its date. To move it, skip the date in Recurring Care and create a one-time trip.",
  INVALID_INPUT: "Check the details: addresses are required, and an appointment can't be before pickup.",
  SCHEDULE_UNRESOLVABLE: "That time doesn't exist or is ambiguous because of a daylight-saving change. Pick a different time.",
  UNKNOWN: "Something went wrong. Try again.",
};

export function mapTripEditError(code: string | undefined): TripEditErrorCode {
  switch (code) {
    case "ZW001":
      return "UNAUTHORIZED";
    case "ZW002":
      return "NOT_FOUND";
    case "ZW003":
      return "STALE";
    case "ZW004":
      return "LOCKED";
    case "ZW006":
      return "INVALID_INPUT";
    default:
      return "UNKNOWN";
  }
}

export function tripEditErrorMessage(code: TripEditErrorCode): string {
  return MESSAGE[code];
}
