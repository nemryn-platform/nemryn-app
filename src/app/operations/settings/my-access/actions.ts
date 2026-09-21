"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { enableSelfDriverAccess } from "@/lib/operations/self-driver";

export interface MyAccessActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

/**
 * Settings -> My Access -> "Set up my Driver access" (P1-PILOT-S5A1).
 *
 * Authority is derived here, never taken from the form: the session user and the
 * resolved organization come from `requireOrganizationAdminAccess` (active
 * Membership, Organization Admin, current organization context), and the database
 * function `link_self_as_driver` re-checks the same chain (plus an active
 * organization) and only ever links `auth.uid()` itself. The only fields read from
 * the form are the two the person types: the name dispatch should see and an
 * optional phone. It is the SAME primitive onboarding's "I also drive" step uses.
 */
export async function setUpMyDriverAccessAction(
  _prevState: MyAccessActionState,
  formData: FormData,
): Promise<MyAccessActionState> {
  const pathname = await getCurrentPathname("/operations/settings/my-access");
  const organization = await requireOrganizationAdminAccess(pathname);

  const result = await enableSelfDriverAccess(organization, formData.get("displayName"), formData.get("phone"));
  if (!result.ok) return { status: "error", message: result.message };

  // The Operations layout resolves the "Drive" item live; refresh it (and this
  // page, and Activity) so it appears without a sign-out.
  revalidatePath("/operations", "layout");
  return { status: "success" };
}
