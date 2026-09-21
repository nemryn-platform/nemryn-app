/**
 * Pure Activity projection (P1-PILOT-S4B-R4D) -- no runtime imports,
 * unit-testable under plain Node (activity-core.test.mjs).
 *
 * Activity is a human-readable projection of the EXISTING administrative
 * audit_events for one organization (no second audit table). The database
 * function list_activity_events already restricts rows to a whitelist of
 * administrative actions; this module turns each into a title and a short SAFE
 * summary. It never surfaces ids, raw before/after JSON, role codes or function
 * names, and it names people only where the Admin already sees them (team
 * emails). An action with no mapping is OMITTED from the page rather than shown
 * as a raw code.
 */

export interface ActivityRecord {
  action: string;
  actorName: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ActivityDescription {
  title: string;
  summary: string | null;
}

/** Injected so this module stays import-free and the real implementations stay single-sourced. */
export interface ActivityHelpers {
  formatSchedule: (days: number[], opensAt: string, closesAt: string) => string;
  serviceLabel: (value: string) => string;
}

const SETTING_LABEL: Record<string, string> = {
  name: "Name",
  timezone: "Timezone",
  business_phone: "Business phone",
  business_email: "Business email",
  business_address: "Business address",
  primary_contact_name: "Primary operations contact",
  business_stage: "Business stage",
  service_area_description: "Service area",
};

const ROLE_LABEL: Record<string, string> = { organization_admin: "Organization Admin", dispatcher: "Dispatcher" };
const ROLE_GROUP_LABEL: Record<string, string> = { organization_admin: "Organization Admins", dispatcher: "Dispatchers" };
const NOTIFICATION_LABEL: Record<string, string> = { website_request: "New website request", trip_exception: "Trip exception" };

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
function roleLabel(value: unknown): string {
  return (typeof value === "string" && ROLE_LABEL[value]) || "Team member";
}
function clock(value: unknown): string | null {
  return typeof value === "string" && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : null;
}

export function describeActivity(record: ActivityRecord, helpers: ActivityHelpers): ActivityDescription | null {
  const after = record.after ?? {};
  const before = record.before ?? {};

  switch (record.action) {
    case "organization_created":
      return { title: "Organization created", summary: null };

    case "organization_settings_updated": {
      const labels = Object.keys(after).map((key) => SETTING_LABEL[key]).filter((label): label is string => Boolean(label));
      return { title: "Organization details updated", summary: labels.length ? `Changed: ${labels.join(", ")}` : null };
    }

    case "organization_operating_schedule_updated": {
      const days = Array.isArray(after.days) ? (after.days as unknown[]).filter((d): d is number => typeof d === "number") : [];
      const opens = clock(after.opens_at);
      const closes = clock(after.closes_at);
      return {
        title: "Operating schedule updated",
        summary: days.length && opens && closes ? helpers.formatSchedule(days, opens, closes) : "Schedule cleared",
      };
    }

    case "organization_services_configured":
    case "organization_service_offerings_updated": {
      const services = strList(after.service_types).map(helpers.serviceLabel);
      return {
        title: record.action === "organization_services_configured" ? "Services configured" : "Services updated",
        summary: services.length ? `Now: ${services.join(", ")}` : null,
      };
    }

    case "website_integration_created": {
      const origin = strList(after.allowed_origins)[0] ?? null;
      return { title: "Website integration created", summary: origin };
    }
    case "website_integration_activated":
      return { title: "Website integration activated", summary: str(after.external_id) ? `Integration ID ${after.external_id}` : null };
    case "website_integration_disabled":
      return { title: "Website integration disabled", summary: str(after.external_id) ? `Integration ID ${after.external_id}` : null };
    case "website_integration_origin_updated": {
      const origin = strList(after.allowed_origins)[0] ?? null;
      const off = after.auto_disabled === true ? " Intake was turned off until reactivated." : "";
      return { title: "Website address changed", summary: origin ? `Now ${origin}.${off}` : off.trim() || null };
    }

    case "staff_invitation_created":
      return { title: `${roleLabel(after.role)} invitation sent`, summary: str(after.email) };
    case "staff_invitation_resent":
      return { title: "Invitation resent", summary: str(after.email) };
    case "staff_invitation_cancelled":
      return { title: "Invitation cancelled", summary: str(after.email) };
    case "staff_invitation_accepted": {
      const who = str(after.email);
      return { title: "Invitation accepted", summary: who ? `${who} joined as ${roleLabel(after.role)}` : null };
    }

    case "membership_role_changed": {
      const who = str(after.email);
      return { title: "Team member role changed", summary: `${who ? `${who}: ` : ""}${roleLabel(before.role)} → ${roleLabel(after.role)}` };
    }
    case "membership_deactivated":
      return { title: "Team member access deactivated", summary: str(after.email) };
    case "membership_reactivated":
      return { title: "Team member access reactivated", summary: str(after.email) };

    case "notification_preferences_updated": {
      const event = (typeof after.event_type === "string" && NOTIFICATION_LABEL[after.event_type]) || "Notification";
      const roles = strList(after.recipient_roles);
      const who = roles.length ? roles.map((r) => ROLE_GROUP_LABEL[r] ?? "Team").join(" and ") : "Off";
      return { title: "Notification preferences updated", summary: `${event}: ${who}` };
    }

    // S5A1: an Organization Admin enabling Driver access for their OWN account
    // (Settings -> My Access, or the onboarding "I also drive" step -- the same
    // database primitive). The actor is shown by the page; nothing here names an
    // id, a role code or the Driver row.
    case "driver_self_linked":
      return { title: "Driver access enabled", summary: "Enabled for their own account." };
    case "driver_self_reactivated":
      return { title: "Driver access turned back on", summary: "Turned back on for their own account." };

    // R4E: Nemryn platform lifecycle actions. Shown deliberately and generically --
    // the internal reason and the platform administrator's identity are never
    // part of the tenant-visible record (the database returns the actor as "Nemryn").
    case "platform_organization_suspended":
      return { title: "Organization suspended by Nemryn", summary: "Workspace access and new website requests were paused. Your records were not changed." };
    case "platform_organization_reactivated":
      return { title: "Organization reactivated by Nemryn", summary: "Workspace access and new website requests are available again." };

    default:
      return null;
  }
}

export function actorLabel(actorName: string | null): string {
  return actorName && actorName.trim().length > 0 ? actorName : "System";
}

// ---- grouping ---------------------------------------------------------------

export interface ActivityItem {
  key: string;
  occurredAt: string;
  title: string;
  summary: string | null;
  actor: string;
}

export interface ActivityGroup {
  label: string;
  items: (ActivityItem & { time: string })[];
}

function dayKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Groups newest-first items under "Today" / "Yesterday" / a date, all in the organization's timezone. */
export function groupActivityByDay(items: ActivityItem[], timezone: string, now: Date): ActivityGroup[] {
  const today = dayKey(now, timezone);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000), timezone);
  const groups: ActivityGroup[] = [];
  for (const item of items) {
    const date = new Date(item.occurredAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date, timezone);
    const label =
      key === today
        ? "Today"
        : key === yesterday
          ? "Yesterday"
          : new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "short", day: "numeric" }).format(date);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push({ ...item, time });
    else groups.push({ label, items: [{ ...item, time }] });
  }
  return groups;
}

// ---- cursor -----------------------------------------------------------------

const CURSOR_PATTERN = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(text: string): string | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

/** Opaque "older than this row" cursor for the page link. Never displayed. */
export function encodeCursor(occurredAt: string, id: string): string {
  return toBase64Url(`${occurredAt}|${id}`);
}

/** A tampered or malformed cursor decodes to null (treated as "start from the newest"). */
export function decodeCursor(value: string | null | undefined): { occurredAt: string; id: string } | null {
  if (!value || value.length > 200) return null;
  const decoded = fromBase64Url(value);
  const match = decoded ? CURSOR_PATTERN.exec(decoded) : null;
  return match ? { occurredAt: match[1], id: match[2] } : null;
}

export const ACTIVITY_PAGE_SIZE = 30;
