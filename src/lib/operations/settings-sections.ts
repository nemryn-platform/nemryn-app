/**
 * The tenant Settings information architecture (P1-PILOT-S4B-R4A).
 *
 * Every section the long-term IA names is listed here so the Settings home
 * can show the whole shape, but a section is only NAVIGABLE once its page
 * actually exists (`available: true`). Later phases flip their own entry
 * when they ship the real page -- R4B: integrations; R4C: team, services,
 * operations (all shipped); R4D: notifications, security, activity. Never link an entry
 * whose page does not exist: a dead link presented as finished
 * functionality is exactly what this list exists to prevent.
 */
export interface SettingsSection {
  slug: string;
  title: string;
  description: string;
  /** True only when `/operations/settings/<slug>` is a real, implemented page. */
  available: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { slug: "organization", title: "Organization", description: "Business profile and operating timezone", available: true },
  { slug: "team", title: "Team & Access", description: "Staff accounts, invitations and roles", available: true },
  { slug: "services", title: "Services & Intake", description: "Transportation services and intake preferences", available: true },
  { slug: "integrations", title: "Integrations", description: "Connect your website and external systems", available: true },
  { slug: "notifications", title: "Notifications", description: "Operational alert preferences", available: false },
  { slug: "operations", title: "Operations", description: "Operating hours and dispatch information", available: true },
  { slug: "security", title: "Security", description: "Account and access security", available: false },
  { slug: "activity", title: "Activity", description: "Administrative change history", available: false },
];
