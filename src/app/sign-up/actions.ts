"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AUTH_ERROR, type AuthErrorCode } from "@/lib/auth/errors";

export interface SignUpState {
  error?: AuthErrorCode;
  /** True only when Supabase Auth genuinely requires email confirmation
   * before a session exists (work item §2: "Email verification behavior
   * must be documented and truthful") — never assumed either way, always
   * read from the real `signUp()` response for THIS environment. */
  needsEmailConfirmation?: boolean;
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Sign-up (P1-E3-S9, work item §2) — collects exactly what's needed to
 * start: full name, email, password, business name. Creates the real
 * authenticated user via Supabase Auth's own `signUp()` (never a
 * service-role shortcut from this — or any — browser-reachable code
 * path), then, ONLY if a real session actually exists (see the
 * `needsEmailConfirmation` branch below), calls `complete_pending_
 * signup` (which reaches `signup_create_organization`, internal-only since
 * P1-PILOT-S4B-R4A) — the sole controlled path that atomically creates the
 * caller's UserProfile, a new Organization, and their own
 * organization_admin Membership in one transaction (docs/product/
 * operator-onboarding-model.md).
 *
 * When email confirmation IS required (`needsEmailConfirmation: true`),
 * full name/business name are NOT lost — they were just passed as
 * `signUp()`'s own `options.data` above, persisted on the auth.users row
 * itself independent of confirmation state. `/sign-in`'s own Server
 * Action calls `complete_pending_signup()` after every successful
 * sign-in, which performs this SAME organization creation using those
 * persisted values the first time a real session exists (P1-E4-S0A §4/§8
 * — this phase's own fix for a real gap: before it existed, a person who
 * had to confirm their email landed on `/access-unavailable` with their
 * original signup details permanently gone). See docs/product/
 * operator-onboarding-model.md §4A.
 *
 * Failure-mode honesty (work item §2's own "failed signup does not leave
 * a broken partial state"): if `signUp()` succeeds but the RPC fails for
 * any reason, the person is left with a real, valid, harmless account and
 * NO organization — the exact same "authenticated, zero Membership" state
 * `/access-unavailable` already handles for other fixtures. Nothing is
 * silently half-created; since their full name/business name are already
 * persisted in `auth.users.raw_user_meta_data` (above), signing in again
 * safely retries `signup_create_organization` from those same values via
 * `complete_pending_signup()` — the same continuation the email-
 * confirmation case uses — or they can contact support.
 */
export async function signUpAction(_prevState: SignUpState, formData: FormData): Promise<SignUpState> {
  const fullName = stringField(formData, "fullName");
  const email = stringField(formData, "email").toLowerCase();
  const password = stringField(formData, "password");
  const businessName = stringField(formData, "businessName");

  if (!fullName || !email || !password || !businessName) {
    return { error: AUTH_ERROR.SIGNUP_INVALID_INPUT };
  }
  if (password.length < 8) {
    return { error: AUTH_ERROR.SIGNUP_WEAK_PASSWORD };
  }

  const supabase = await createServerSupabaseClient();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Persisted on the auth.users row itself (Supabase's own
      // `raw_user_meta_data`), regardless of whether email confirmation
      // is required — unlike a local variable in this Server Action,
      // this survives the confirmation boundary. `complete_pending_
      // signup()` reads these back once a real session first exists
      // (P1-E4-S0A §8/§4 — see docs/product/operator-onboarding-model.md
      // §4A for the full architecture).
      data: {
        pending_full_name: fullName,
        pending_business_name: businessName,
      },
    },
  });

  if (signUpError) {
    // Supabase returns a generic "already registered"-shaped error for a
    // taken email in some configurations and a distinguishable one in
    // others — normalized here rather than parsing message text, matching
    // the "never a raw Supabase/Postgres message" discipline used
    // throughout this codebase (src/lib/driver/errors.ts).
    if (signUpError.message.toLowerCase().includes("already registered") || signUpError.status === 422) {
      return { error: AUTH_ERROR.SIGNUP_EMAIL_TAKEN };
    }
    return { error: AUTH_ERROR.SIGNUP_FAILED };
  }

  // Honest environment-dependent branch (work item §2's own requirement).
  // Locally (supabase/config.toml: enable_confirmations = false) signUp()
  // returns a session immediately. A real deployment with email
  // confirmation enabled would return a user but no session here — this
  // codebase does not assume either way; it reads the real response.
  if (!signUpData.session) {
    return { needsEmailConfirmation: true };
  }

  // `signup_create_organization` is internal-only since P1-PILOT-S4B-R4A
  // (no client role can execute it). The immediate-session path uses the
  // SAME exactly-once gate the email-confirmation path uses,
  // `complete_pending_signup()`, which reads the pending_full_name /
  // pending_business_name just persisted by `signUp()` above -- one
  // creation path regardless of the environment's confirmation behavior.
  const { data: result, error: orgError } = await supabase.rpc("complete_pending_signup");

  if (orgError || !result?.created) {
    return { error: AUTH_ERROR.SIGNUP_FAILED };
  }

  redirect("/onboarding");
}
