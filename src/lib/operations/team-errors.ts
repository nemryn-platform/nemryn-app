/**
 * ZW-code -> user-facing message mapping for the Team & Access mutations
 * (P1-PILOT-S4B-R4C). Never a code, SQLSTATE or raw PostgREST text.
 * ZW001 no session, ZW002 not an Organization Admin of the owning
 * organization / unknown target, ZW003 stale state (invitation already used,
 * cancelled...), ZW004 last-admin refusal, ZW006 validation.
 */
export type TeamErrorCode = "UNAUTHORIZED" | "ACCESS_UNAVAILABLE" | "STALE" | "LAST_ADMIN" | "INVALID_INPUT" | "UNKNOWN";

export function mapTeamError(code: string | undefined): TeamErrorCode {
  switch (code) {
    case "ZW001":
      return "UNAUTHORIZED";
    case "ZW002":
      return "ACCESS_UNAVAILABLE";
    case "ZW003":
      return "STALE";
    case "ZW004":
      return "LAST_ADMIN";
    case "ZW006":
      return "INVALID_INPUT";
    default:
      return "UNKNOWN";
  }
}

export type TeamOperation = "invite" | "resend" | "cancel" | "role" | "status";

export function teamErrorMessage(code: TeamErrorCode, operation: TeamOperation): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Your session is no longer valid. Sign in again.";
    case "ACCESS_UNAVAILABLE":
      return "Only an Organization Admin can manage the team.";
    case "STALE":
      return operation === "resend" || operation === "cancel"
        ? "That invitation has already been used or cancelled. Refresh the page."
        : "That change is no longer applicable. Refresh the page and try again.";
    case "LAST_ADMIN":
      return "Every organization needs at least one active Organization Admin. Make someone else an Organization Admin first.";
    case "INVALID_INPUT":
      return operation === "invite"
        ? "That invitation couldn't be sent. Check the email address — this person may already be on your team, or you may have too many pending invitations."
        : "That change couldn't be applied.";
    default:
      return "Something went wrong. Try again.";
  }
}
