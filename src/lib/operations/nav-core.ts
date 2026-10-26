/**
 * Canonical Operations navigation model (NP-UI-P1b). Runtime-import-free (unit-tested under plain Node:
 * nav-core.test.mjs). OperationsSidebar renders it; OperationsLayoutClient uses the same labels for the context header.
 *
 * Labels follow Brand Lock v1 §15 terminology (Operations Brief, Tomorrow Readiness, standing orders, Vehicles). Only
 * the visible COPY changed: every destination is the existing route, and code / route identifiers are not renamed
 * (`/operations/fleet`, `/operations/recurring-care`, icon key `fleet`).
 *
 * Visibility here is navigation convenience only. Every route and every mutation re-checks access on the server.
 */

export type OperationsNavItemKey =
  | "overview"
  | "requests"
  | "trips"
  | "dispatch"
  | "tomorrow"
  | "recurring"
  | "passengers"
  | "facilities"
  | "drivers"
  | "fleet"
  | "drive"
  | "settings";

export type OperationsNavSectionKey = "today" | "planning" | "records" | "growth" | "administration";

export interface OperationsNavItem {
  key: OperationsNavItemKey;
  label: string;
  href: string;
}

export interface OperationsNavSection {
  key: OperationsNavSectionKey;
  label: string;
  /** Empty for "growth": GrowthNavGroup renders that section's own children (lib/plus/growth-nav-core). */
  items: OperationsNavItem[];
}

export interface OperationsNavAccess {
  /** A live `current_driver_id()` fact (owner-operator) -- gates "Drive". requireDriverAccess re-checks. */
  hasLinkedDriverProfile?: boolean;
  /** Organization Admin of the active workspace -- gates "Settings". Every settings route re-checks. */
  canManageSettings?: boolean;
  /** Server-resolved Nemryn Plus entry -- gates the Growth section. Every Growth route re-checks requirePlusAccess. */
  canAccessGrowth?: boolean;
}

const TODAY: OperationsNavItem[] = [
  { key: "overview", label: "Operations Brief", href: "/operations" },
  { key: "requests", label: "Requests", href: "/operations/requests" },
  { key: "trips", label: "Trips", href: "/operations/trips" },
  { key: "dispatch", label: "Dispatch", href: "/operations/dispatch" },
  { key: "tomorrow", label: "Tomorrow Readiness", href: "/operations/tomorrow" },
];

const PLANNING: OperationsNavItem[] = [{ key: "recurring", label: "Standing Orders", href: "/operations/recurring-care" }];

const RECORDS: OperationsNavItem[] = [
  { key: "passengers", label: "Passengers", href: "/operations/passengers" },
  { key: "facilities", label: "Facilities", href: "/operations/facilities" },
  { key: "drivers", label: "Drivers", href: "/operations/drivers" },
  { key: "fleet", label: "Vehicles", href: "/operations/fleet" },
];

/**
 * The visible sections, in order. Billing / Reports stay unlinked (their routes are placeholders). Proof of Service
 * and the Growth Agent keep their existing entry points (the Operations Brief and the Growth dashboard). An
 * Administration section with nothing visible is omitted, never rendered empty.
 */
export function operationsNavSections(access: OperationsNavAccess): OperationsNavSection[] {
  const administration: OperationsNavItem[] = [
    ...(access.hasLinkedDriverProfile ? [{ key: "drive" as const, label: "Drive", href: "/driver" }] : []),
    ...(access.canManageSettings ? [{ key: "settings" as const, label: "Settings", href: "/operations/settings" }] : []),
  ];
  return [
    { key: "today", label: "Today", items: TODAY },
    { key: "planning", label: "Planning", items: PLANNING },
    { key: "records", label: "Records", items: RECORDS },
    ...(access.canAccessGrowth ? [{ key: "growth" as const, label: "Growth", items: [] }] : []),
    ...(administration.length > 0 ? [{ key: "administration" as const, label: "Administration", items: administration }] : []),
  ];
}

/** "/operations" matches only itself (its sub-routes have their own items); every other item matches its sub-tree. */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/operations") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Routes reachable from the Brief rather than the sidebar, still named in the context header. */
const OTHER_CONTEXT: { prefix: string; section: string; label: string }[] = [
  { prefix: "/operations/proof-of-service", section: "Today", label: "Proof of Service" },
  { prefix: "/operations/growth/agent", section: "Growth", label: "Growth Agent" },
  { prefix: "/operations/growth/inquiries", section: "Growth", label: "Inquiries" },
  { prefix: "/operations/growth/pipeline", section: "Growth", label: "Pipeline" },
  { prefix: "/operations/growth/contacts", section: "Growth", label: "Contacts" },
  { prefix: "/operations/growth/quotes", section: "Growth", label: "Estimates & Quotes" },
  { prefix: "/operations/growth/tasks", section: "Growth", label: "Tasks" },
  { prefix: "/operations/growth", section: "Growth", label: "Dashboard" },
  { prefix: "/operations/billing", section: "Administration", label: "Billing" },
  { prefix: "/operations/reports", section: "Administration", label: "Reports" },
];

/**
 * The slim context header's location line: the section and the page's area, e.g. { section: "Records", label:
 * "Vehicles" }. Independent of visibility (a Dispatcher on a settings URL still sees where they are; the route itself
 * decides access). Unknown /operations paths fall back to "Operations".
 */
export function operationsContext(pathname: string): { section: string | null; label: string } {
  const sections = operationsNavSections({ hasLinkedDriverProfile: true, canManageSettings: true, canAccessGrowth: false });
  for (const section of sections) {
    for (const item of section.items) {
      if (item.key !== "drive" && isNavItemActive(item.href, pathname)) return { section: section.label, label: item.label };
    }
  }
  const other = OTHER_CONTEXT.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
  if (other) return { section: other.section, label: other.label };
  return { section: null, label: "Operations" };
}
