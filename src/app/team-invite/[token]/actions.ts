"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AUTH_ERROR, type AuthErrorCode } from "@/lib/auth/errors";

export interface TeamJoinActionState {
  error?: AuthErrorCode;
  needsEmailConfirmation?: boolean;
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Team-invite sign-up (P1-PILOT-S4B-R4C) -- the SAME normal Supabase Auth
 * `signUp()` as `/sign-up` and the Driver join flow, never a service-role
 * account. The invitation intent is persisted on the auth user
 * (`pending_staff_invite_token`) so it survives an email-confirmation
 * boundary: `/complete-signup` redeems it the first time a session exists,
 * and -- deliberately -- it is checked BEFORE fresh-organization creation, so
 * an invitee is never routed into "create your organization". No
 * `pending_business_name` is ever set here, so `complete_pending_signup` can
 * never create an organization for them either.
 *
 * The role and organization come from the invitation row inside
 * accept_staff_invite; nothing on this form can select either. The email
 * field is re-checked by the database against the caller's real account.
 */
export async function teamJoinSignUpAction(_prev: TeamJoinActionState, formData: FormData): Promise<TeamJoinActionState> {
  const token = stringField(formData, "token");
  const email = stringField(formData, "email").toLowerCase();
  const fullName = stringField(formData, "fullName");
  const password = stringField(formData, "password");

  if (!token || !email || !fullName || !password) {
    return { error: AUTH_ERROR.SIGNUP_INVALID_INPUT };
  }
  if (password.length < 8) {
    return { error: AUTH_ERROR.SIGNUP_WEAK_PASSWORD };
  }

  const supabase = await createServerSupabaseClient();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { pending_staff_invite_token: token, pending_full_name: fullName } },
  });
  if (signUpError) {
    if (signUpError.message.toLowerCase().includes("already registered") || signUpError.status === 422) {
      return { error: AUTH_ERROR.SIGNUP_EMAIL_TAKEN };
    }
    return { error: AUTH_ERROR.SIGNUP_FAILED };
  }

  if (signUpData.user) {
    await supabase.from("user_profiles").upsert({ id: signUpData.user.id, display_name: fullName });
  }
  if (!signUpData.session) {
    return { needsEmailConfirmation: true };
  }

  const { error: acceptError } = await supabase.rpc("accept_staff_invite", { p_token: token });
  if (acceptError) {
    return { error: AUTH_ERROR.INVITE_INVALID };
  }
  redirect("/");
}

/** For an already-signed-in visitor whose account email matches the invitation -- one click to accept. */
export async function acceptTeamInviteAction(_prev: TeamJoinActionState, formData: FormData): Promise<TeamJoinActionState> {
  const token = stringField(formData, "token");
  if (!token) {
    return { error: AUTH_ERROR.INVITE_INVALID };
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("accept_staff_invite", { p_token: token });
  if (error) {
    return { error: AUTH_ERROR.INVITE_INVALID };
  }
  // "/" resolves the destination: a person with several organizations lands on the picker.
  redirect("/");
}
