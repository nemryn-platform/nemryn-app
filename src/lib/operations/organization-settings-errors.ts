/**
 * Narrow ZW-code -> user-facing message mapping for
 * `update_organization_settings` (P1-PILOT-S4B-R4A) -- same discipline as
 * log-request-errors.ts / new-trip-errors.ts: never a ZW code, SQLSTATE or
 * raw PostgREST text in front of an operator, and no finer-grained
 * category than the function actually raises (ZW001 no session, ZW002 not
 * an Organization Admin of that organization, ZW006 any validation
 * failure).
 */
export type OrganizationSettingsErrorCode = "UNAUTHORIZED" | "ACCESS_UNAVAILABLE" | "INVALID_INPUT" | "UNKNOWN";

const MESSAGE: Record<OrganizationSettingsErrorCode, string> = {
  UNAUTHORIZED: "Your session is no longer valid. Sign in again.",
  ACCESS_UNAVAILABLE: "Only an Organization Admin can change these settings.",
  INVALID_INPUT: "Those details couldn't be saved. Check each field and try again.",
  UNKNOWN: "Something went wrong saving your settings. Try again.",
};

export function mapOrganizationSettingsError(code: string | undefined): OrganizationSettingsErrorCode {
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

export function organizationSettingsErrorMessage(code: OrganizationSettingsErrorCode): string {
  return MESSAGE[code];
}
