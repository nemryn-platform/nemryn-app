"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveOrganizationContext } from "@/lib/auth/organization";
import { AUTH_ERROR, type AuthErrorCode } from "@/lib/auth/errors";

export interface CompleteSignupState {
  error?: AuthErrorCode;
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The explicit, user-initiated recovery form (P1-E4-S0A1 §9) —
 * `complete_pending_signup_manual`'s only caller. Reached exclusively via
 * `/complete-signup` when NEITHER an operator-signup nor a driver-invite
 * automatic continuation applied (see that page for the full routing
 * logic) — this is a deliberate, explicit action the person takes, never
 * a silent auto-creation.
 */
export async function completeSignupManualAction(
  _prevState: CompleteSignupState,
  formData: FormData,
): Promise<CompleteSignupState> {
  const fullName = stringField(formData, "fullName");
  const businessName = stringField(formData, "businessName");

  if (!fullName || !businessName) {
    return { error: AUTH_ERROR.ORG_SETUP_INVALID_INPUT };
  }

  const supabase = await createServerSupabaseClient();
  const { data: result, error } = await supabase.rpc("complete_pending_signup_manual", {
    p_full_name: fullName,
    p_business_name: businessName,
  });

  if (error) {
    return { error: AUTH_ERROR.ORG_SETUP_FAILED };
  }

  if (!result?.created) {
    // `created: false` is the exactly-once gate holding (see
    // complete_pending_signup_manual): this person already holds a
    // Membership -- a second tab, a double submit, or a retry after a slow
    // response that actually succeeded. Send them to their real home
    // rather than showing a failure or creating a second organization.
    // If they still resolve to NO workspace, the gate refused for another
    // reason (e.g. an inactive Membership) -- say so instead of looping.
    const resolution = await resolveOrganizationContext();
    if (resolution.status === "none") {
      return { error: AUTH_ERROR.ORG_SETUP_FAILED };
    }
    redirect("/");
  }

  redirect("/onboarding/basics");
}
