"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAppOrigin } from "@/lib/app-url";
import { isPlausibleEmail } from "@/lib/auth/recovery-core";
import { AUTH_ERROR, type AuthErrorCode } from "@/lib/auth/errors";

export interface ForgotPasswordState {
  status: "idle" | "sent" | "error";
  error?: AuthErrorCode;
}

/**
 * Password-recovery request (P0-S2B). The ONE governing rule: the
 * outward result must be identical whether or not an account exists for
 * the submitted email — never "no account found", never any response
 * shape/timing that would let a caller distinguish the two.
 *
 * Supabase's own `resetPasswordForEmail()` already implements this at
 * the provider level — it returns success (no `error`) for a syntactically
 * valid, non-existent email exactly the same as for a real one; this is
 * documented, intentional Supabase Auth behavior, not an assumption made
 * here. That means the `error` branch below only ever fires for a GENUINE
 * problem (rate limiting, a misconfigured origin, a network fault) — none
 * of which correlates with whether the specific email is registered — so
 * surfacing a distinct, generic failure message for it does not reopen
 * the enumeration question `AUTH_ERROR.FORGOT_PASSWORD_FAILED` exists to
 * avoid answering. The pre-validation `isPlausibleEmail` check is a pure
 * shape check (§ src/lib/auth/recovery-core.ts) — it rejects input that
 * cannot possibly be any account's address, so branching on IT reveals
 * nothing about any real account either.
 */
export async function forgotPasswordAction(_prevState: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const emailRaw = formData.get("email");
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";

  if (!isPlausibleEmail(email)) {
    return { status: "error", error: AUTH_ERROR.FORGOT_PASSWORD_INVALID_EMAIL };
  }

  try {
    // The trusted, app-owned origin (P0-S2A infrastructure, reused as-is)
    // — NOT Supabase's own separately-configured "Site URL". This is what
    // lets the recovery link automatically follow NEXT_PUBLIC_APP_URL
    // (including a future app.nemryn.com) with no code change — see
    // supabase/templates/recovery.html, which uses {{ .RedirectTo }}
    // rather than {{ .SiteURL }} for exactly this reason.
    const origin = await getAppOrigin();
    const supabase = await createServerSupabaseClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/confirm`,
    });

    if (error) {
      // A genuine provider/config error (rate limit, transport failure) —
      // never "no such account" (Supabase itself never reports that here).
      console.error(`[password-recovery] resetPasswordForEmail failed: ${error.message}`);
      return { status: "error", error: AUTH_ERROR.FORGOT_PASSWORD_FAILED };
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "unknown error";
    console.error(`[password-recovery] failed to build the recovery redirect: ${detail}`);
    return { status: "error", error: AUTH_ERROR.FORGOT_PASSWORD_FAILED };
  }

  return { status: "sent" };
}
