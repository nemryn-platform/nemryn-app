"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { availabilityErrorMessage, windowInputToUtc, type WindowFormInput } from "@/lib/operations/availability";
import { buildDriverInviteUrl } from "@/lib/app-url";
import { sendEmail, type EmailResult } from "@/lib/email/send";
import { buildDriverInviteEmail } from "@/lib/email/driver-invite-email";

/**
 * Delivery outcome for the DRIVER INVITATION EMAIL (G0-R3). Distinct from
 * the invite-row creation result: the row can be created successfully and
 * the email still fail to send. The operator must never be told
 * "invitation sent" unless it genuinely was.
 *   - "sent"           — INVITE_CREATED_EMAIL_SENT
 *   - "failed"         — INVITE_CREATED_EMAIL_FAILED (provider error)
 *   - "not_configured" — INVITE_CREATED_EMAIL_FAILED (no provider set up)
 */
export type InviteDelivery = "sent" | "failed" | "not_configured";

export interface DriverInviteActionState {
  status: "idle" | "success" | "error";
  error?: string;
  invite?: { inviteId: string; email: string; reused: boolean };
  /** Present only when `status === "success"`. */
  delivery?: InviteDelivery;
}

function toDelivery(result: EmailResult): InviteDelivery {
  if (result.status === "sent") return "sent";
  if (result.status === "not_configured") return "not_configured";
  return "failed";
}

/**
 * Builds and sends the driver-invitation email, reduced to the SAME
 * discriminated `EmailResult` shape `sendEmail()` itself returns — even
 * when something throws before a real send is ever attempted (P0-S2A
 * finding: `getAppOrigin()` can throw — by design, e.g. its production/
 * loopback-origin guard — and that throw was previously uncaught here,
 * crashing the whole Server Action instead of degrading to the same
 * honest "delivery failed, invite preserved" state every other failure
 * mode already produces). Never lets a raw error escape to either
 * caller; the caught detail is logged server-side only, bounded, and
 * contains no token/secret (mirrors `sendViaResend`'s own discipline).
 */
async function deliverDriverInviteEmail(input: { organizationName: string; recipientEmail: string; token: string }): Promise<EmailResult> {
  try {
    const joinUrl = await buildDriverInviteUrl(input.token);
    return await sendEmail(
      buildDriverInviteEmail({
        organizationName: input.organizationName,
        recipientEmail: input.recipientEmail,
        joinUrl,
      }),
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "invite email could not be built";
    console.error(`[driver-invite] failed to build/send the invitation email: ${detail}`);
    return { status: "failed", provider: "unknown", detail: "build_failed" };
  }
}

/**
 * Driver invite (P1-E3-S9 §10, GAP-15; email delivery added G0-R3).
 *
 * 1. `create_driver_invite` is the actual authorization boundary
 *    (Organization Admin, own org only) and re-checks it live regardless
 *    of the `requireOperationsAccess` call above — "re-derive
 *    authorization fresh on every mutation".
 * 2. On success, the DRIVER INVITATION EMAIL is sent server-side with the
 *    secure `/join/<token>` link. The token is never returned to the
 *    browser and never logged.
 * 3. If the invite row exists but the email fails, the valid invite is
 *    preserved and the operator is told delivery failed — with a resend
 *    path (`resendDriverInviteAction`), not a duplicate invite.
 */
export async function createDriverInviteAction(
  _prevState: DriverInviteActionState,
  formData: FormData,
): Promise<DriverInviteActionState> {
  const email = formData.get("email");
  const displayName = formData.get("displayName");
  const phone = formData.get("phone");

  if (typeof email !== "string" || email.trim().length === 0 || typeof displayName !== "string" || displayName.trim().length === 0) {
    return { status: "error", error: "Enter a name and email to invite." };
  }

  const pathname = await getCurrentPathname("/operations/drivers");
  const organization = await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_driver_invite", {
    p_organization_id: organization.organizationId,
    p_email: email.trim(),
    p_display_name: displayName.trim(),
    p_phone: typeof phone === "string" && phone.trim().length > 0 ? phone.trim() : undefined,
  });

  if (error || !data || !data.invite_id || !data.email || !data.token) {
    if (error?.code === "ZW002") {
      return { status: "error", error: "Only an Organization Admin can invite drivers." };
    }
    return { status: "error", error: "Enter a valid name and email address." };
  }

  const delivery = toDelivery(
    await deliverDriverInviteEmail({
      organizationName: organization.organizationName,
      recipientEmail: data.email,
      token: data.token,
    }),
  );

  if (delivery !== "sent") {
    console.warn(`[driver-invite] invite ${data.invite_id} created; email delivery: ${delivery}`);
  }

  revalidatePath("/operations/drivers");
  return {
    status: "success",
    invite: { inviteId: data.invite_id, email: data.email, reused: data.reused ?? false },
    delivery,
  };
}

export interface RevokeInviteState {
  status: "idle" | "success" | "error";
}

export async function revokeDriverInviteAction(inviteId: string): Promise<RevokeInviteState> {
  const pathname = await getCurrentPathname("/operations/drivers");
  await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("revoke_driver_invite", { p_invite_id: inviteId });

  if (error) {
    return { status: "error" };
  }

  revalidatePath("/operations/drivers");
  return { status: "success" };
}

export interface ResendInviteState {
  status: "idle" | "sent" | "failed" | "not_configured" | "error";
}

/**
 * Resend the DRIVER INVITATION EMAIL for an existing pending invite
 * (G0-R3 STEP 9). Deliberately touches NO database state:
 *   - authorization is re-derived server-side (`requireOperationsAccess`
 *     + an explicit organization_admin check);
 *   - the invite is read through the RLS-protected `driver_invites`
 *     SELECT policy (Organization Admin, own org) and re-bound to the
 *     currently-resolved organization context — a cross-tenant `inviteId`
 *     resolves to no row;
 *   - only a `pending` invite is resendable;
 *   - the recipient CANNOT be changed — the address comes from the invite
 *     row, never from the caller;
 *   - no row is inserted or updated, so no duplicate Membership/Driver
 *     and no duplicate invite can result.
 * The invite token is never returned to the browser.
 */
export async function resendDriverInviteAction(inviteId: string): Promise<ResendInviteState> {
  if (typeof inviteId !== "string" || inviteId.trim().length === 0) {
    return { status: "error" };
  }

  const pathname = await getCurrentPathname("/operations/drivers");
  const organization = await requireOperationsAccess(pathname);
  if (organization.role !== "organization_admin") {
    return { status: "error" };
  }

  const supabase = await createServerSupabaseClient();
  const { data: invite, error } = await supabase
    .from("driver_invites")
    .select("token, email, status, organization_id")
    .eq("id", inviteId)
    .maybeSingle();

  if (error || !invite || invite.organization_id !== organization.organizationId || invite.status !== "pending" || !invite.token || !invite.email) {
    return { status: "error" };
  }

  const result = await deliverDriverInviteEmail({
    organizationName: organization.organizationName,
    recipientEmail: invite.email,
    token: invite.token,
  });

  if (result.status === "sent") return { status: "sent" };
  if (result.status === "not_configured") return { status: "not_configured" };
  console.warn(`[driver-invite] resend for invite ${inviteId} failed: ${result.detail}`);
  return { status: "failed" };
}

// =============================================================================
// P1-OPS-PROG5B -- working hours + time off (Organization Admin / Dispatcher; the RPCs re-check role and tenant)
// =============================================================================

export type AvailabilityActionResult = { ok: true } | { ok: false; message: string };

export async function saveDriverScheduleAction(driverId: string, shifts: { weekday: number; start: string; end: string }[]): Promise<AvailabilityActionResult> {
  await requireOperationsAccess(await getCurrentPathname("/operations/drivers"));
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("set_driver_weekly_schedule", { p_driver_id: driverId, p_shifts: shifts });
  if (error) return { ok: false, message: availabilityErrorMessage(error.code) };
  revalidatePath("/operations/drivers");
  revalidatePath("/operations/dispatch");
  revalidatePath("/operations/tomorrow");
  return { ok: true };
}

export async function clearDriverScheduleAction(driverId: string): Promise<AvailabilityActionResult> {
  await requireOperationsAccess(await getCurrentPathname("/operations/drivers"));
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("clear_driver_weekly_schedule", { p_driver_id: driverId });
  if (error) return { ok: false, message: availabilityErrorMessage(error.code) };
  revalidatePath("/operations/drivers");
  revalidatePath("/operations/dispatch");
  revalidatePath("/operations/tomorrow");
  return { ok: true };
}

export async function saveDriverTimeOffAction(driverId: string, windowId: string | null, input: WindowFormInput): Promise<AvailabilityActionResult> {
  const organization = await requireOperationsAccess(await getCurrentPathname("/operations/drivers"));
  const range = windowInputToUtc(input, organization.organizationTimezone);
  if (!range) return { ok: false, message: "Those times aren't valid (check the dates and times)." };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("save_driver_unavailability", {
    p_driver_id: driverId,
    p_starts_at: range.startsAt,
    p_ends_at: range.endsAt,
    ...(windowId ? { p_window_id: windowId } : {}),
  });
  if (error) return { ok: false, message: availabilityErrorMessage(error.code) };
  revalidatePath("/operations/drivers");
  revalidatePath("/operations/dispatch");
  revalidatePath("/operations/tomorrow");
  return { ok: true };
}

export async function deleteDriverTimeOffAction(windowId: string): Promise<AvailabilityActionResult> {
  await requireOperationsAccess(await getCurrentPathname("/operations/drivers"));
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("delete_driver_unavailability", { p_window_id: windowId });
  if (error) return { ok: false, message: availabilityErrorMessage(error.code) };
  revalidatePath("/operations/drivers");
  revalidatePath("/operations/dispatch");
  revalidatePath("/operations/tomorrow");
  return { ok: true };
}
