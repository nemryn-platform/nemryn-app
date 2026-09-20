"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildStaffInviteUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email/send";
import { buildStaffInviteEmail } from "@/lib/email/staff-invite-email";
import { isStaffRole, validateInviteInput } from "@/lib/operations/team-core";
import { mapTeamError, teamErrorMessage, type TeamOperation } from "@/lib/operations/team-errors";

export interface TeamActionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Echoed so a rejected invite never wipes the typed email. */
  email?: string;
}

const PAGE = "/operations/settings/team";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function guard() {
  const pathname = await getCurrentPathname(PAGE);
  return requireOrganizationAdminAccess(pathname);
}

/**
 * Builds and sends the staff-invitation email, reduced to a plain delivery
 * outcome -- never throws (getAppOrigin can, by design) and never returns or
 * logs the token. The raw token exists only in this server process, between
 * the RPC result and the email.
 */
async function deliverInvite(input: { organizationName: string; email: string; role: string; token: string }): Promise<"sent" | "failed"> {
  try {
    const inviteUrl = await buildStaffInviteUrl(input.token);
    const result = await sendEmail(
      buildStaffInviteEmail({ organizationName: input.organizationName, recipientEmail: input.email, role: input.role, inviteUrl }),
    );
    return result.status === "sent" ? "sent" : "failed";
  } catch {
    console.error("[staff-invite] failed to build/send the invitation email");
    return "failed";
  }
}

function fail(code: string | undefined, operation: TeamOperation, extra?: Partial<TeamActionState>): TeamActionState {
  return { status: "error", message: teamErrorMessage(mapTeamError(code), operation), ...extra };
}

/**
 * Invite team member. Organization Admin only -- re-derived on every call and
 * enforced again inside create_staff_invite. The browser supplies ONLY an
 * email and one of the two staff roles; the organization is the validated
 * session workspace. The admin is told "Invitation sent" -- never whether the
 * address already has a Nemryn account.
 */
export async function inviteStaffAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const organization = await guard();
  const validation = validateInviteInput(field(formData, "email"), field(formData, "role"));
  if (!validation.ok) {
    return { status: "error", message: validation.error, email: field(formData, "email") };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_staff_invite", {
    p_organization_id: organization.organizationId,
    p_email: validation.email,
    p_role: validation.role,
  });
  if (error || !data?.token || !data.email) {
    return fail(error?.code, "invite", { email: validation.email });
  }

  const delivery = await deliverInvite({
    organizationName: organization.organizationName,
    email: data.email,
    role: validation.role,
    token: data.token,
  });

  revalidatePath(PAGE);
  return delivery === "sent"
    ? { status: "success", message: "Invitation sent." }
    : { status: "success", message: "The invitation was created, but the email couldn't be sent. Use Resend to try again." };
}

/** Resend = re-issue: a fresh token and expiry; the previous link stops working. */
export async function resendStaffInviteAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const organization = await guard();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("resend_staff_invite", { p_invite_id: field(formData, "handle") });
  if (error || !data?.token || !data.email || !data.role) {
    return fail(error?.code, "resend");
  }

  const delivery = await deliverInvite({
    organizationName: organization.organizationName,
    email: data.email,
    role: data.role,
    token: data.token,
  });
  revalidatePath(PAGE);
  return delivery === "sent"
    ? { status: "success", message: "Invitation resent. The previous link no longer works." }
    : { status: "success", message: "A new invitation was created, but the email couldn't be sent. Try Resend again." };
}

export async function cancelStaffInviteAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  await guard();
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("cancel_staff_invite", { p_invite_id: field(formData, "handle") });
  if (error) return fail(error.code, "cancel");
  revalidatePath(PAGE);
  return { status: "success", message: "Invitation cancelled." };
}

/** Change a staff member's role. The database refuses to demote the last active Organization Admin. */
export async function changeStaffRoleAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  await guard();
  const role = field(formData, "role");
  if (!isStaffRole(role)) return { status: "error", message: "Choose a role." };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("change_membership_role", {
    p_membership_id: field(formData, "handle"),
    p_role: role,
  });
  if (error) return fail(error.code, "role");
  revalidatePath("/operations", "layout");
  return { status: "success", message: data?.changed ? "Role updated." : "No change." };
}

/** Deactivate / reactivate staff access. The database refuses to deactivate the last active Organization Admin. */
export async function setStaffAccessAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  await guard();
  const active = field(formData, "active") === "true";
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("set_membership_status", {
    p_membership_id: field(formData, "handle"),
    p_active: active,
  });
  if (error) return fail(error.code, "status");
  revalidatePath("/operations", "layout");
  if (!data?.changed) return { status: "success", message: "No change." };
  return { status: "success", message: active ? "Access reactivated." : "Access deactivated." };
}
