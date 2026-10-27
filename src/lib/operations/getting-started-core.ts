/**
 * Getting started (NP-PILOT-P2) -- the workspace setup checklist, derived ONLY from live workspace facts. Runtime-import
 * free (unit-tested under plain Node: getting-started-core.test.mjs).
 *
 * Rules:
 * - A step is complete only when the workspace really holds the configuration (a vehicle exists, the business phone and
 *   address are saved, ...). Visiting a page never completes anything, and nothing is stored as "done".
 * - A fact the signed-in person cannot read (an admin-only list) or that failed to load is `null`: the step then makes
 *   NO claim ("complete" or "not complete") and never counts as done.
 * - Admin-only setup (business details, services, team) links to Settings only for an Organization Admin; others are
 *   told who completes it. Every target route re-checks access on the server.
 * - Only the four BUSINESS SETUP essentials (business phone + address, a service, a vehicle, an active driver) decide
 *   "setup complete". First-use milestones (facility, passenger, first request or trip, team) and the Nemryn Plus
 *   (Growth) steps are shown separately and never block setup: a configured agency is set up before it has carried
 *   anyone, and a milestone only says a first record exists (MILESTONES_NOTE) -- never that real patient
 *   information may be processed.
 * - Setup describes workspace configuration only. It is not a compliance assessment (see GETTING_STARTED_SCOPE_NOTE).
 */

export type SetupStepKey =
  | "business"
  | "services"
  | "vehicle"
  | "driver"
  | "facility"
  | "passenger"
  | "trip"
  | "team"
  | "growth_contact"
  | "growth_quote";

export type SetupStepGroup = "essentials" | "milestones" | "growth";

export interface SetupFacts {
  isAdmin: boolean;
  /** The person can open Growth (Nemryn Plus entitlement + access); false = Core-only view, no Growth steps. */
  growth: boolean;
  /** null = the organization row could not be read. */
  business: { phone: string | null; address: string | null } | null;
  services: number | null;
  vehicles: number | null;
  activeDrivers: number | null;
  facilities: number | null;
  passengers: number | null;
  trips: number | null;
  /** Transportation requests logged (a first request counts as the first-use "request or trip" milestone). */
  requests: number | null;
  /** Admin-only facts (null for everyone else): other ACTIVE staff members, and PENDING staff invitations. */
  otherActiveStaff: number | null;
  pendingStaffInvites: number | null;
  growthContacts: number | null;
  growthQuotes: number | null;
}

export interface SetupStep {
  key: SetupStepKey;
  group: SetupStepGroup;
  label: string;
  /** One plain sentence: why this matters for running rides. */
  description: string;
  /** true / false from real data; null = not known to this person (never shown as complete). */
  complete: boolean | null;
  /** Where to do it; null when this person cannot (adminOnly for a non-admin). */
  href: string | null;
  actionLabel: string;
  adminOnly: boolean;
  /** Shown instead of a link when href is null. */
  note: string | null;
}

export interface GettingStarted {
  steps: SetupStep[];
  /** The four business-setup essentials -- the only steps that decide completion. */
  essentials: SetupStep[];
  milestones: SetupStep[];
  completedCount: number;
  totalCount: number;
  /** Essentials still to do (unknown counts as not done). */
  remaining: number;
  isComplete: boolean;
}

export const MILESTONES_NOTE =
  "Milestones only show that a first record exists in Nemryn. They are not required for setup and do not mean your organization is approved or ready to handle real patient information. While you evaluate Nemryn, use fictional practice records.";

export const GETTING_STARTED_SCOPE_NOTE =
  "These steps set up your workspace for daily operations. Completing them does not make your organization HIPAA compliant or certify any regulatory requirement.";

const ADMIN_NOTE = "An Organization Admin completes this in Settings.";

const has = (n: number | null): boolean | null => (n === null ? null : n > 0);
const filled = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

export function buildGettingStarted(f: SetupFacts): GettingStarted {
  const adminStep = (step: Omit<SetupStep, "href" | "note" | "adminOnly">, href: string): SetupStep =>
    f.isAdmin ? { ...step, href, adminOnly: true, note: null } : { ...step, href: null, adminOnly: true, note: ADMIN_NOTE };
  const step = (s: Omit<SetupStep, "adminOnly" | "note">): SetupStep => ({ ...s, adminOnly: false, note: null });

  const team: boolean | null =
    f.otherActiveStaff === null || f.pendingStaffInvites === null ? null : f.otherActiveStaff > 0 || f.pendingStaffInvites > 0;

  const steps: SetupStep[] = [
    adminStep(
      {
        key: "business",
        group: "essentials",
        label: "Business details",
        description: "Your business phone and address appear on quotes, invoices and receipts, so customers know how to reach you.",
        complete: f.business === null ? null : filled(f.business.phone) && filled(f.business.address),
        actionLabel: "Add business details",
      },
      "/operations/settings/organization",
    ),
    adminStep(
      {
        key: "services",
        group: "essentials",
        label: "Services you offer",
        description: "Choose the trip types you provide (for example wheelchair or dialysis rides) so requests and quotes use them.",
        complete: has(f.services),
        actionLabel: "Choose services",
      },
      "/operations/settings/services",
    ),
    step({
      key: "vehicle",
      group: "essentials",
      label: "First vehicle",
      description: "Add a vehicle so drivers can be assigned to trips with the right equipment.",
      complete: has(f.vehicles),
      href: "/onboarding/vehicle",
      actionLabel: "Add a vehicle",
    }),
    step({
      key: "driver",
      group: "essentials",
      label: "Driver setup",
      description: "Add an active driver (or yourself, if you drive) so trips can be dispatched.",
      complete: has(f.activeDrivers),
      href: "/onboarding/driver",
      actionLabel: "Set up a driver",
    }),
    step({
      key: "facility",
      group: "milestones",
      label: "First facility",
      description: "If you drive to clinics or dialysis centers, save one you visit often so pickups and drop-offs are quick to enter.",
      complete: has(f.facilities),
      href: "/onboarding/facility",
      actionLabel: "Add a facility",
    }),
    step({
      key: "passenger",
      group: "milestones",
      label: "First passenger",
      description: "Add a rider with their mobility needs so trips carry the right assistance details (a fictional practice rider is fine).",
      complete: has(f.passengers),
      href: "/onboarding/passenger",
      actionLabel: "Add a passenger",
    }),
    step({
      key: "trip",
      group: "milestones",
      label: "First request or trip",
      description: "Log a request or schedule a trip to see review, dispatch, the driver app and proof of service work end to end.",
      complete: f.trips === null || f.requests === null ? (f.trips ?? 0) > 0 || (f.requests ?? 0) > 0 || null : f.trips > 0 || f.requests > 0,
      href: "/operations/trips/new",
      actionLabel: "Schedule a trip",
    }),
    adminStep(
      {
        key: "team",
        group: "milestones",
        label: "Invite your team",
        description: "Recommended: invite a dispatcher or another admin. Not needed if you run the business on your own.",
        complete: team,
        actionLabel: "Invite a teammate",
      },
      "/operations/settings/team",
    ),
  ];

  if (f.growth) {
    steps.push(
      step({
        key: "growth_contact",
        group: "growth",
        label: "First Growth contact",
        description: "Record a family member, case manager or facility that asks you for rides, to follow up and book again.",
        complete: has(f.growthContacts),
        href: "/operations/growth/contacts",
        actionLabel: "Open contacts",
      }),
      step({
        key: "growth_quote",
        group: "growth",
        label: "First estimate or quote",
        description: "Price a private-pay ride, send the quote yourself, and turn an accepted quote into a request.",
        complete: has(f.growthQuotes),
        href: "/operations/growth/quotes",
        actionLabel: "Open estimates & quotes",
      }),
    );
  }

  const essentials = steps.filter((s) => s.group === "essentials");
  const milestones = steps.filter((s) => s.group === "milestones");
  const completedCount = essentials.filter((s) => s.complete === true).length;
  return {
    steps,
    essentials,
    milestones,
    completedCount,
    totalCount: essentials.length,
    remaining: essentials.length - completedCount,
    isComplete: completedCount === essentials.length,
  };
}

/** "Complete" / "Not complete" / "Not available to you" -- always text, never colour or icon alone. */
export function setupStatusText(step: Pick<SetupStep, "complete" | "adminOnly">): string {
  if (step.complete === true) return "Complete";
  if (step.complete === false) return "Not complete";
  return step.adminOnly ? "Managed by an Organization Admin" : "Couldn't check right now";
}
