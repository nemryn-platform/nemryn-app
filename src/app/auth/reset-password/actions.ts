"use server";

import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { validateNewPassword } from "@/lib/auth/recovery-core";
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/recovery";
import { AUTH_ERROR, type AuthErrorCode } from "@/lib/auth/errors";

export interface ResetPasswordState {
  status: "idle" | "success" | "error";
  error?: AuthErrorCode;
}

/**
 * Consumes an established Supabase recovery session to set a new
 * password (P0-S2B). The browser never receives a service-role key, an
 * admin API, or any privileged credential — this calls the same
 * `updateUser()` mechanism Supabase's client SDK exposes to any
 * authenticated user, scoped entirely to the CALLER'S OWN current
 * session; there is no code path here (or anywhere in this application)
 * that can target another user's account.
 *
 * Defense in depth, not the only gate: `/auth/reset-password` (the page)
 * already checks the recovery marker cookie + an active session before
 * ever rendering the form, but a Server Action is reachable directly
 * (a raw POST bypassing the page), so both checks are re-verified here
 * too — never trust that a request reached this action only through the
 * page that normally leads to it.
 */
export async function resetPasswordAction(_prevState: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const cookieStore = await cookies();
  const hasRecoveryMarker = cookieStore.get(RECOVERY_COOKIE_NAME)?.value === "1";

  const user = await getUser();
  if (!user || !hasRecoveryMarker) {
    return { status: "error", error: AUTH_ERROR.RESET_PASSWORD_FAILED };
  }

  const password = formData.get("password");
  const confirmPassword = formData.get("confirmPassword");
  const validation = validateNewPassword(password, confirmPassword);

  if (!validation.valid) {
    return {
      status: "error",
      error: validation.reason === "mismatch" ? AUTH_ERROR.RESET_PASSWORD_MISMATCH : AUTH_ERROR.RESET_PASSWORD_WEAK,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: password as string });

  if (error) {
    console.error(`[password-recovery] updateUser failed: ${error.message}`);
    return { status: "error", error: AUTH_ERROR.RESET_PASSWORD_FAILED };
  }

  // Deliberately NOT clearing the recovery marker cookie here. Next.js
  // refreshes the invoking route's Server Component tree automatically
  // after any Server Action completes; clearing the cookie in THIS same
  // action would flip `/auth/reset-password`'s own gate condition
  // (`canReset`) to false on that refresh, unmounting the just-rendered
  // success UI below (this component's local `useActionState` state) and
  // replacing it with the "link expired" view before the person ever
  // sees the success message — confirmed directly, not theoretical (see
  // docs/reports/p0-s2b-password-recovery.txt §16 for the reproduction).
  // Leaving the cookie in place does not reopen any real security gap:
  // the underlying Supabase recovery TOKEN is already single-use at the
  // provider level (verified separately — re-opening the same emailed
  // link a second time fails at `/auth/confirm` regardless of this
  // cookie), and this cookie's own short, fixed lifetime
  // (`RECOVERY_COOKIE_MAX_AGE_SECONDS`, 10 minutes) is what bounds how
  // long the reset form stays reachable at all — not this success path.
  return { status: "success" };
}
