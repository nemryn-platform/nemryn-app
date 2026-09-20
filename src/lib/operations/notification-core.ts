/**
 * Pure Notifications helpers (P1-PILOT-S4B-R4D) -- no runtime imports,
 * unit-testable under plain Node (notification-core.test.mjs). The database
 * (set_notification_settings, claim_notification_dispatch) is the authority.
 *
 * Only events Nemryn can identify at an authoritative, transactional moment are
 * offered -- "New website request" (a genuinely new public Request) and "Trip
 * exception" (a newly reported TripException). "Upcoming unassigned trip" and
 * "Recurring care gap" need periodic evaluation (no scheduler exists) and
 * "Proof needs review" is a derived read-time state, so none of the three has a
 * switch: a switch that never fires would be a lie.
 */

export const NOTIFICATION_EVENT_VALUES = ["website_request", "trip_exception"] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENT_VALUES)[number];

export const NOTIFICATION_EVENT_OPTIONS: { value: NotificationEvent; label: string; description: string }[] = [
  {
    value: "website_request",
    label: "New website request",
    description: "A transportation request arrives through your connected website.",
  },
  {
    value: "trip_exception",
    label: "Trip exception",
    description: "An issue is reported on a trip by your team or a driver.",
  },
];

/** Staff roles that can receive a notification. Drivers never receive staff notifications. */
export const NOTIFICATION_ROLE_VALUES = ["organization_admin", "dispatcher"] as const;
export type NotificationRole = (typeof NOTIFICATION_ROLE_VALUES)[number];

export const NOTIFICATION_ROLE_OPTIONS: { value: NotificationRole; label: string }[] = [
  { value: "organization_admin", label: "Organization Admins" },
  { value: "dispatcher", label: "Dispatchers" },
];

export function notificationEventLabel(value: string): string {
  return NOTIFICATION_EVENT_OPTIONS.find((option) => option.value === value)?.label ?? "Notification";
}

export function isNotificationEvent(value: unknown): value is NotificationEvent {
  return typeof value === "string" && (NOTIFICATION_EVENT_VALUES as readonly string[]).includes(value);
}

export type RoleSelectionValidation = { ok: true; roles: NotificationRole[] } | { ok: false; error: string };

/** Canonical order, distinct, staff roles only. An empty selection is valid (= off). */
export function validateRoleSelection(selected: string[]): RoleSelectionValidation {
  const unique = new Set(selected);
  for (const value of unique) {
    if (!(NOTIFICATION_ROLE_VALUES as readonly string[]).includes(value)) {
      return { ok: false, error: "That selection isn't valid. Refresh the page and try again." };
    }
  }
  return { ok: true, roles: NOTIFICATION_ROLE_VALUES.filter((role) => unique.has(role)) };
}

/** "Organization Admins and Dispatchers" / "Organization Admins" / "No one (off)". */
export function describeRecipients(roles: string[]): string {
  const labels = NOTIFICATION_ROLE_OPTIONS.filter((option) => roles.includes(option.value)).map((option) => option.label);
  if (labels.length === 0) return "Off";
  return labels.join(" and ");
}

export type DeliveryStatus = "pending" | "dispatching" | "sent" | "partial" | "failed" | "skipped";

/** Honest delivery wording -- never "sent" unless it was. */
export function deliveryStatusLabel(status: string): string {
  switch (status) {
    case "sent":
      return "Sent";
    case "partial":
      return "Partly sent";
    case "failed":
      return "Not delivered";
    case "skipped":
      return "No recipients";
    default:
      return "Sending";
  }
}

export type DeliveryTone = "positive" | "warning" | "critical" | "neutral";

export function deliveryStatusTone(status: string): DeliveryTone {
  if (status === "sent") return "positive";
  if (status === "partial") return "warning";
  if (status === "failed") return "critical";
  return "neutral";
}
