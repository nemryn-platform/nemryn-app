/**
 * Pure rules for Settings -> Nemryn Plus -> Team access (NP-P1-S3). Runtime-import-free (unit-tested under plain Node:
 * team-access-core.test.mjs).
 *
 * The database decides everything (plus_grant_member_access / plus_revoke_member_access re-check the Organization
 * Admin, the organization, the membership, its role and status, the entitlement and the version). These helpers only
 * describe rows and validate what a form posted, so the UI never offers a change the database would refuse anyway.
 */

/** A named-staff Plus grant level. "none" = no grant. */
export type PlusGrantAccess = "read" | "write";
export type PlusTeamChange = PlusGrantAccess | "none";

export const PLUS_GRANT_ACCESS: readonly PlusGrantAccess[] = ["read", "write"];

export interface PlusTeamMember {
  /** Opaque management handle (membership id) -- posted back to the server action, never displayed. */
  handle: string;
  name: string;
  email: string;
  /** Core role -- shown, never changed here. */
  role: "organization_admin" | "dispatcher";
  isActive: boolean;
  isSelf: boolean;
  /** The ACTIVE Plus grant, if any. */
  access: PlusGrantAccess | null;
  /** Version token of the active grant ("none" when there is none) -- posted back for optimistic concurrency. */
  grantToken: string;
}

export function parseGrantAccess(raw: unknown): PlusGrantAccess | null {
  return raw === "read" || raw === "write" ? raw : null;
}

/** "none" when no grant is active; otherwise the grant id. */
export function grantVersionToken(grantId: string | null | undefined): string {
  return grantId ? grantId : "none";
}

export function coreRoleLabel(role: PlusTeamMember["role"]): string {
  return role === "organization_admin" ? "Organization Admin" : "Dispatcher";
}

export function plusAccessLabel(access: PlusTeamChange): string {
  if (access === "write") return "Write";
  if (access === "read") return "Read";
  return "No access";
}

export interface PlusPermissionView {
  /** Short Plus permission label, deliberately different wording from the Core role. */
  label: string;
  /** Extra explanation, e.g. why a grant is inert. */
  note: string | null;
  tone: "positive" | "informational" | "neutral" | "warning";
}

/**
 * The Plus permission column for one staff member. `plusWritable` = the workspace's Plus entitlement is `write`
 * (named staff have no access in any other state, even with a grant).
 */
export function plusPermissionView(member: Pick<PlusTeamMember, "role" | "isActive" | "access">, plusWritable: boolean): PlusPermissionView {
  if (member.role === "organization_admin") {
    return member.isActive
      ? { label: "Full access", note: "Organization Admins always have Nemryn Plus access.", tone: "positive" }
      : { label: "No access", note: "This account is deactivated.", tone: "neutral" };
  }
  if (!member.access) return { label: "No access", note: null, tone: "neutral" };
  const label = plusAccessLabel(member.access);
  if (!member.isActive) {
    return { label, note: "Inactive account: no Plus access while deactivated. Remove access if it is no longer needed.", tone: "warning" };
  }
  if (!plusWritable) {
    return { label, note: "Nemryn Plus is not active, so named staff currently have no access.", tone: "warning" };
  }
  return { label, note: null, tone: member.access === "write" ? "positive" : "informational" };
}

/**
 * The changes offered for one staff member. Only an ACTIVE Dispatcher can be granted or changed, and only while Plus
 * is writable; an existing grant can always be removed (also for a deactivated member, or while Plus is read-only).
 * Admins need no grant: nothing is offered.
 */
export function offeredTeamChanges(member: Pick<PlusTeamMember, "role" | "isActive" | "access">, plusWritable: boolean): PlusTeamChange[] {
  if (member.role !== "dispatcher") return [];
  const changes: PlusTeamChange[] = [];
  if (member.isActive && plusWritable) {
    for (const access of PLUS_GRANT_ACCESS) if (member.access !== access) changes.push(access);
  }
  if (member.access) changes.push("none");
  return changes;
}

export function teamChangeButtonLabel(change: PlusTeamChange, current: PlusGrantAccess | null): string {
  if (change === "none") return "Remove access";
  if (!current) return change === "write" ? "Give write access" : "Give read access";
  return change === "write" ? "Change to write" : "Change to read";
}

export interface TeamChangeCopy {
  title: string;
  body: string;
  confirm: string;
  destructive: boolean;
}

export function teamChangeCopy(change: PlusTeamChange, member: Pick<PlusTeamMember, "name" | "access">, organizationName: string): TeamChangeCopy {
  if (change === "none") {
    return {
      title: `Remove ${member.name}'s Nemryn Plus access?`,
      body: `${member.name} will lose access to Growth in ${organizationName} on their next page load. Their operations access is not changed.`,
      confirm: "Remove access",
      destructive: true,
    };
  }
  const verb = member.access ? "Change" : "Give";
  const what = change === "write" ? "write access (view and change Growth)" : "read access (view Growth only)";
  return {
    title: `${verb} ${member.name}'s Nemryn Plus access?`,
    body: `${member.name} will have ${what} in ${organizationName}. Their Core role and operations access are not changed.`,
    confirm: member.access ? `Change to ${change}` : `Give ${change} access`,
    destructive: false,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TeamChangeInput =
  | { ok: true; handle: string; change: PlusTeamChange; expectedGrantId: string | null; organizationId: string }
  | { ok: false; error: string };

/** Validates the posted form. Anything malformed is refused before the database is called. */
export function validateTeamChangeInput(raw: { handle: unknown; change: unknown; expectedGrant: unknown; organizationId: unknown }): TeamChangeInput {
  const { handle, change, expectedGrant, organizationId } = raw;
  if (typeof handle !== "string" || !UUID_RE.test(handle)) return { ok: false, error: "That team member could not be found. Reload the page and try again." };
  if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) return { ok: false, error: "Reload the page and try again." };
  if (change !== "read" && change !== "write" && change !== "none") return { ok: false, error: "Choose read access, write access or remove access." };
  if (typeof expectedGrant !== "string" || (expectedGrant !== "none" && !UUID_RE.test(expectedGrant))) {
    return { ok: false, error: "Reload the page and try again." };
  }
  return { ok: true, handle, change, expectedGrantId: expectedGrant === "none" ? null : expectedGrant, organizationId };
}

export const TEAM_ACCESS_STALE_MESSAGE =
  "This person's Nemryn Plus access changed since this page was loaded. Reload the page and review it before trying again.";
export const TEAM_ACCESS_WRONG_ORGANIZATION_MESSAGE =
  "You switched to a different organization since this page was loaded. Reload the page and review the team before changing access.";

/** Maps a database error code to plain, actionable copy (no codes, no ids). */
export function teamAccessErrorMessage(code: string | undefined): string {
  switch (code) {
    case "ZW003":
      return TEAM_ACCESS_STALE_MESSAGE;
    case "ZW006":
      return "Only active Dispatchers can be given Nemryn Plus access. Organization Admins already have it; Drivers never can.";
    case "ZW001":
      return "Nemryn Plus is not active for this workspace, so access can't be given right now. You can still remove access.";
    case "ZW002":
      return "That team member or Nemryn Plus is not available in this organization. Reload the page and try again.";
    default:
      return "Nemryn Plus access could not be changed. Try again.";
  }
}
