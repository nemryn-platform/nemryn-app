/**
 * Pure Website Integration helpers (P1-PILOT-S4B-R4B) -- no runtime imports,
 * unit-testable directly under plain Node (website-integration-core.test.mjs).
 *
 * `normalizeWebsiteOrigin` is the friendly first-line check and MUST stay in
 * step with the database's `_normalize_website_origin`
 * (20260920100000_website_integration_self_service.sql), which is the
 * authority: the same accept/reject vectors are asserted on both sides.
 */

export const WEBSITE_INTAKE_PATH = "/api/public-intake/website";

const ORIGIN_PATTERN = /^https:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})(:[0-9]{1,5})?$/;

/** Canonical https origin for an acceptable website address, or null. Mirrors the SQL function exactly. */
export function normalizeWebsiteOrigin(input: string): string | null {
  // Strip SPACES only (like SQL btrim): a tab/newline is malformed input, not padding.
  let value = input.replace(/^ +| +$/g, "").toLowerCase();
  if (value.length === 0 || value.length > 255) return null;
  if (value.endsWith("/")) value = value.slice(0, -1);
  if (!ORIGIN_PATTERN.test(value)) return null;

  const portMatch = /:([0-9]{1,5})$/.exec(value);
  const host = /^https:\/\/([^:]+)/.exec(value)?.[1];
  if (!host) return null;
  if (portMatch) {
    const port = Number(portMatch[1]);
    if (port < 1 || port > 65535) return null;
    return port === 443 ? `https://${host}` : `https://${host}:${port}`;
  }
  return `https://${host}`;
}

export type WebsiteIntegrationStatus = "NOT_CONFIGURED" | "DISABLED" | "READY_TO_TEST" | "CONNECTED";

export const WEBSITE_INTEGRATION_STATUS_LABEL: Record<WebsiteIntegrationStatus, string> = {
  NOT_CONFIGURED: "Not configured",
  DISABLED: "Disabled",
  READY_TO_TEST: "Ready to test",
  CONNECTED: "Connected",
};

/**
 * Derived, never persisted. "Connected" means at least one real accepted
 * Website Request exists for the integration -- never a ping or a click.
 */
export function deriveWebsiteIntegrationStatus(
  integration: { isActive: boolean; requestCount: number } | null,
): WebsiteIntegrationStatus {
  if (!integration) return "NOT_CONFIGURED";
  if (!integration.isActive) return "DISABLED";
  return integration.requestCount > 0 ? "CONNECTED" : "READY_TO_TEST";
}

/** Example server-side configuration shown in Setup instructions. Names are examples for a server implementation; nothing here is a credential. */
export function buildSetupEnvExample(input: { endpoint: string; integrationId: string }): string {
  return [
    "REQUEST_INTAKE_MODE=platform",
    `PLATFORM_INTAKE_URL=${input.endpoint}`,
    `PLATFORM_INTAKE_INTEGRATION_ID=${input.integrationId}`,
  ].join("\n");
}

/**
 * Developer example of the OPTIONAL `acquisition` object of the website intake payload (P1-PILOT-S4C), shown in
 * Setup instructions. Every property is optional; nothing here is a credential. Values are examples only.
 */
export function buildAcquisitionExample(): string {
  return [
    '"acquisition": {',
    '  "utmSource": "google",',
    '  "utmMedium": "cpc",',
    '  "utmCampaign": "dialysis_transport",',
    '  "landingPath": "/dialysis-transportation",',
    '  "submissionPath": "/request-transportation",',
    '  "referrerHost": "google.com",',
    '  "formVersion": "request-v2"',
    "}",
  ].join("\n");
}

/** "Sep 20, 2026, 3:14 PM" in the organization's own timezone; null when there is no timestamp. */
export function formatIntegrationTimestamp(iso: string | null, timezone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatIntegrationDate(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "short", day: "numeric" }).format(date);
}
