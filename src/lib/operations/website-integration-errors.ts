/**
 * ZW-code -> user-facing message mapping for the website-integration
 * mutations (P1-PILOT-S4B-R4B). Same discipline as the other *-errors.ts
 * modules: never a ZW code, SQLSTATE or raw PostgREST text in front of an
 * operator, and no finer category than the functions actually raise
 * (ZW001 no session, ZW002 not an Organization Admin of the owning
 * organization / unknown integration, ZW006 any validation failure).
 */
export type WebsiteIntegrationErrorCode = "UNAUTHORIZED" | "ACCESS_UNAVAILABLE" | "INVALID_INPUT" | "UNKNOWN";

export function mapWebsiteIntegrationError(code: string | undefined): WebsiteIntegrationErrorCode {
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

export type WebsiteIntegrationOperation = "create" | "activate" | "disable" | "update_origin";

export function websiteIntegrationErrorMessage(code: WebsiteIntegrationErrorCode, operation: WebsiteIntegrationOperation): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Your session is no longer valid. Sign in again.";
    case "ACCESS_UNAVAILABLE":
      return "Only an Organization Admin can manage website connections.";
    case "INVALID_INPUT":
      if (operation === "activate") {
        return "This connection needs a website address before it can be activated. Edit the website first.";
      }
      if (operation === "disable") {
        return "That change couldn't be applied. Refresh the page and try again.";
      }
      return "That website address can't be used. Enter your site's address, for example https://www.example.com — it may also already be connected, or you may have reached the connection limit.";
    default:
      return "Something went wrong. Try again.";
  }
}
