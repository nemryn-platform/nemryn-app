/**
 * Pure Team & Access helpers (P1-PILOT-S4B-R4C) -- no runtime imports,
 * unit-testable under plain Node (team-core.test.mjs). The database
 * (create_staff_invite / change_membership_role / set_membership_status) is
 * the authority for every rule here; this is presentation and friendly
 * pre-validation only.
 */

/** The only roles a staff invitation or role change can name. Driver is a separate lifecycle. */
export const STAFF_ROLE_VALUES = ["organization_admin", "dispatcher"] as const;
export type StaffRole = (typeof STAFF_ROLE_VALUES)[number];

export const STAFF_ROLE_OPTIONS: { value: StaffRole; label: string; description: string }[] = [
  { value: "organization_admin", label: "Organization Admin", description: "Manages settings, team, integrations and can do everything a Dispatcher can." },
  { value: "dispatcher", label: "Dispatcher", description: "Runs day-to-day operations. Cannot change organization settings." },
];

export function staffRoleLabel(role: string): string {
  return STAFF_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "Team member";
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLE_VALUES as readonly string[]).includes(value);
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type InviteValidation = { ok: true; email: string; role: StaffRole } | { ok: false; error: string };

export function validateInviteInput(emailRaw: string, roleRaw: string): InviteValidation {
  const email = emailRaw.trim().toLowerCase();
  if (email.length === 0 || email.length > 255 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!isStaffRole(roleRaw)) {
    return { ok: false, error: "Choose a role." };
  }
  return { ok: true, email, role: roleRaw };
}

export type InvitationStatus = "pending" | "expired";

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: "Invitation sent",
  expired: "Expired",
};

/** "Sep 27, 2026" in the organization's timezone. */
export function formatTeamDate(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "short", day: "numeric" }).format(date);
}

/** Copy for the Deactivate / demote confirmation, aware of self-management. */
export function accessChangeCopy(input: { action: "deactivate" | "demote"; isSelf: boolean; name: string }): { title: string; body: string; confirm: string } {
  const { action, isSelf, name } = input;
  if (action === "deactivate") {
    return isSelf
      ? {
          title: "Deactivate your own access?",
          body: "You will lose access to this organization immediately. This is only allowed while another active Organization Admin remains. Their history stays on record.",
          confirm: "Deactivate my access",
        }
      : {
          title: `Deactivate ${name}?`,
          body: `${name} will lose access to this organization immediately. Their history stays on record and you can reactivate them later.`,
          confirm: "Deactivate access",
        };
  }
  return isSelf
    ? {
        title: "Change your own role to Dispatcher?",
        body: "You will no longer be able to manage settings or the team. This is only allowed while another active Organization Admin remains.",
        confirm: "Change my role",
      }
    : {
        title: `Change ${name} to Dispatcher?`,
        body: `${name} will no longer be able to manage settings or the team.`,
        confirm: "Change role",
      };
}
