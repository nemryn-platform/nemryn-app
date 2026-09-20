"use server";

import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getUser } from "@/lib/auth/session";
import { getAppOrigin } from "@/lib/app-url";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface OwnPasswordResetState {
  status: "idle" | "sent" | "error";
  message?: string;
}

/**
 * "Send password reset email" for the SIGNED-IN Organization Admin's OWN
 * account. Reuses the existing recovery flow exactly (resetPasswordForEmail ->
 * /auth/confirm type=recovery -> /auth/reset-password): the address comes from
 * the authenticated session, never from the form, so this can only ever email
 * the caller's own account. It cannot read, set or reset another person's
 * password, and no password or token is ever handled here.
 */
export async function sendOwnPasswordResetAction(): Promise<OwnPasswordResetState> {
  const pathname = await getCurrentPathname("/operations/settings/security");
  await requireOrganizationAdminAccess(pathname);

  const user = await getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) {
    return { status: "error", message: "We couldn't find an email address for your account." };
  }

  try {
    const origin = await getAppOrigin();
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/confirm` });
    if (error) {
      console.error("[security] password reset request failed");
      return { status: "error", message: "We couldn't send the reset email right now. Try again shortly." };
    }
  } catch {
    console.error("[security] password reset request could not be built");
    return { status: "error", message: "We couldn't send the reset email right now. Try again shortly." };
  }

  return { status: "sent", message: `We sent a password reset link to ${email}.` };
}
