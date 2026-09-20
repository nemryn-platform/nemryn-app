/**
 * Pure helpers for the Nemryn Platform control plane (P1-PILOT-S4B-R4E) -- no
 * runtime imports, unit-testable under plain Node (platform-core.test.mjs).
 *
 * The stored organization status vocabulary is exactly `active | inactive`
 * (organizations_status_check). The platform presents `inactive` as
 * "Suspended": it is a reversible, non-destructive pause, and the same word the
 * confirmation text uses. No other lifecycle term is invented.
 */

export type OrganizationStatus = "active" | "inactive";

export const DIRECTORY_PAGE_SIZE = 25;
export const MAX_DIRECTORY_PAGE = 4000;
export const REASON_MIN = 3;
export const REASON_MAX = 500;
/** Must match the 15-minute threshold in the platform_* SQL functions. */
export const STUCK_AFTER_MINUTES = 15;

export function organizationStatusLabel(status: string): string {
  return status === "active" ? "Active" : "Suspended";
}

export function organizationStatusCategory(status: string): "positive" | "warning" {
  return status === "active" ? "positive" : "warning";
}

export function parseStatusFilter(raw: string | string[] | undefined): OrganizationStatus | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "active" || value === "inactive" ? value : null;
}

export function parseSearch(raw: string | string[] | undefined): string | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) return null;
  return value.slice(0, 100);
}

/** 1-based page from a query string; anything malformed is page 1. */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{1,4}$/.test(value)) return 1;
  const page = Number.parseInt(value, 10);
  return page >= 1 && page <= MAX_DIRECTORY_PAGE ? page : 1;
}

export interface LifecycleInput {
  status: OrganizationStatus;
  reason: string;
}

export type LifecycleValidation = { ok: true; value: LifecycleInput } | { ok: false; message: string };

/** Browser input is untrusted; the database re-validates every rule. */
export function validateLifecycleInput(rawStatus: unknown, rawReason: unknown): LifecycleValidation {
  if (rawStatus !== "active" && rawStatus !== "inactive") {
    return { ok: false, message: "Choose a valid organization status." };
  }
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (reason.length < REASON_MIN) {
    return { ok: false, message: "Enter a reason for this change." };
  }
  if (reason.length > REASON_MAX) {
    return { ok: false, message: `Keep the reason under ${REASON_MAX} characters.` };
  }
  return { ok: true, value: { status: rawStatus, reason } };
}

export function notificationEventLabel(eventType: string): string {
  if (eventType === "website_request") return "New website request";
  if (eventType === "trip_exception") return "Trip exception";
  return "Notification";
}

/** Fixed failure vocabulary -> a plain label. Never provider text. */
export function failureReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  switch (reason) {
    case "provider_error":
      return "Email provider error";
    case "not_configured":
      return "Email not configured";
    case "build_failed":
      return "Message could not be built";
    default:
      return "Unknown";
  }
}

export function notificationStatusLabel(status: string, isStuck: boolean): string {
  if (isStuck) return status === "pending" ? "Pending too long" : "Stuck dispatching";
  switch (status) {
    case "failed":
      return "Failed";
    case "partial":
      return "Partly sent";
    case "pending":
      return "Pending";
    case "dispatching":
      return "Dispatching";
    case "sent":
      return "Sent";
    case "skipped":
      return "Skipped";
    default:
      return "Unknown";
  }
}

export function platformActionTitle(action: string): string | null {
  if (action === "platform_organization_suspended") return "Organization suspended";
  if (action === "platform_organization_reactivated") return "Organization reactivated";
  return null;
}

/** The platform has no organization timezone: timestamps are shown in UTC and labelled as such. */
export function formatPlatformTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${text} UTC`;
}

export function formatPlatformDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
