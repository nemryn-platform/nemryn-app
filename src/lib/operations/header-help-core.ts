/**
 * Pure Help & support content for the Operations header (P1-PILOT-UX1). Runtime-import-free.
 *
 * Quick paths to the tasks operators actually perform -- existing routes only, Nemryn's own terminology, no articles.
 * Role-aware: Settings routes guarded by requireOrganizationAdminAccess are offered to Organization Admins only.
 * No "Contact support" item: no approved general support destination exists in this repository / configuration
 * (SETUP_HELP_EMAIL is scoped to Website Requests setup help and is not repurposed).
 */

export type HelpRole = "organization_admin" | "dispatcher" | "driver";

export interface HelpLink {
  label: string;
  description: string;
  href: string;
}

const OPERATIONS_LINKS: HelpLink[] = [
  { label: "Requests", description: "Review and manage transportation requests", href: "/operations/requests" },
  { label: "Prepare tomorrow", description: "Review trips that need preparation", href: "/operations/tomorrow" },
  { label: "Dispatch", description: "Manage today's transportation", href: "/operations/dispatch" },
  { label: "Recurring care", description: "Manage standing transportation schedules", href: "/operations/recurring-care" },
];

const ADMIN_LINKS: HelpLink[] = [
  { label: "Website requests", description: "Set up transportation requests from your website", href: "/operations/settings/website-requests" },
  { label: "Team", description: "Invite staff and manage access", href: "/operations/settings/team" },
  { label: "Notifications", description: "Choose who receives operational notifications", href: "/operations/settings/notifications" },
];

export function helpLinksFor(role: HelpRole): HelpLink[] {
  if (role === "organization_admin") return [...OPERATIONS_LINKS, ...ADMIN_LINKS];
  if (role === "dispatcher") return [...OPERATIONS_LINKS];
  return [];
}

/** The header bell reads the existing notification history, which the database exposes to Organization Admins only. */
export function canViewNotificationHistory(role: HelpRole): boolean {
  return role === "organization_admin";
}
