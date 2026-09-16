"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mapLinkPassengerError, type LinkPassengerErrorCode } from "@/lib/operations/link-passenger-errors";
import { mapRequestLifecycleError, type RequestLifecycleErrorCode } from "@/lib/operations/request-lifecycle-errors";

export interface LinkPassengerActionState {
  status: "idle" | "success" | "error";
  errorCode?: LinkPassengerErrorCode;
}

/**
 * Request Detail's Passenger-linking action (P1-E1-S2E §15) — calls
 * `link_request_passenger` ONLY, never a raw
 * `.update({ passenger_id: ... })` (P1-E1-S2B deliberately retired direct
 * `passenger_id` client writability — a raw UPDATE would bypass the RPC's
 * own pending/active/same-org validation entirely).
 *
 * `requestId`/`passengerId` are the only client-supplied identifiers —
 * matching `logRequestAction`'s own established discipline,
 * `organizationId` is NEVER read from the client (form field, query
 * string, or otherwise); it is re-derived fresh from the validated
 * session on every call via `requireOperationsAccess`, so a forged or
 * stale organization context can never reach the RPC.
 */
export async function linkPassengerAction(
  _prevState: LinkPassengerActionState,
  formData: FormData,
): Promise<LinkPassengerActionState> {
  const requestId = typeof formData.get("requestId") === "string" ? (formData.get("requestId") as string).trim() : "";
  const passengerId = typeof formData.get("passengerId") === "string" ? (formData.get("passengerId") as string).trim() : "";

  if (!requestId || !passengerId) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/requests/${requestId}`);
  const organization = await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("link_request_passenger", {
    p_organization_id: organization.organizationId,
    p_request_id: requestId,
    p_passenger_id: passengerId,
  });

  if (error) {
    return { status: "error", errorCode: mapLinkPassengerError(error.code) };
  }

  // Both the Detail page itself (the Passenger section + Readiness
  // banner must show the new linkage immediately) and the Request Hub
  // queue (its own Readiness column reads the same underlying data —
  // P1-E1-S2D §34's own revalidation discipline, reused here) need fresh
  // data on the very next navigation.
  revalidatePath(`/operations/requests/${requestId}`);
  revalidatePath("/operations/requests");

  return { status: "success" };
}

export interface RequestLifecycleActionState {
  status: "idle" | "success" | "error";
  errorCode?: RequestLifecycleErrorCode;
}

/**
 * Decline Request (P1-E1-S2F-B2 §8) — calls `decline_transportation_
 * request` ONLY, never a raw `.update({ state: 'declined' })` or a raw
 * `request_events` INSERT (both were deliberately retired/never
 * granted in S2B — the RPC's own pending-only + idempotent-no-op +
 * atomic-event-write behavior would otherwise be bypassed entirely).
 *
 * `requestId` and the optional `reason` are the only client-supplied
 * values; `organizationId` is re-derived fresh from the validated
 * session via `requireOperationsAccess`, exactly like
 * `linkPassengerAction` above — never read from the client, and
 * `actor_user_id` is never accepted from the client at all (the RPC
 * derives it itself from `auth.uid()`).
 */
export async function declineRequestAction(
  _prevState: RequestLifecycleActionState,
  formData: FormData,
): Promise<RequestLifecycleActionState> {
  const requestId = typeof formData.get("requestId") === "string" ? (formData.get("requestId") as string).trim() : "";
  const rawReason = formData.get("reason");
  // Empty/whitespace-only normalizes to undefined (never sent as an
  // empty string) — the RPC's own `nullif(btrim(...), '')` would treat
  // them identically anyway, but normalizing here keeps the actual
  // network payload honest about "no reason was given."
  const reason = typeof rawReason === "string" && rawReason.trim().length > 0 ? rawReason.trim() : undefined;

  if (!requestId) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/requests/${requestId}`);
  const organization = await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("decline_transportation_request", {
    p_organization_id: organization.organizationId,
    p_request_id: requestId,
    p_reason: reason,
  });

  if (error) {
    return { status: "error", errorCode: mapRequestLifecycleError(error.code) };
  }

  // Request Hub's queue view/counts and this Request's own Detail page
  // (status, readiness, lifecycle actions, Request Activity) all need
  // fresh data on the very next navigation — same discipline as
  // linkPassengerAction above.
  revalidatePath(`/operations/requests/${requestId}`);
  revalidatePath("/operations/requests");

  return { status: "success" };
}

/**
 * Cancel Request (P1-E1-S2F-B2 §12) — calls
 * `cancel_transportation_request` ONLY. Deliberately does NOT perform
 * its own linked-Trip check before calling the RPC — the RPC's own
 * "ANY linked Trip row blocks cancellation" rule (S2B, locked) remains
 * the sole authority; duplicating it here would only create a second
 * place that check could drift out of sync with the database, for no
 * real benefit (the UI's own `linkedTrips.length === 0` gate is a
 * convenience that hides the button, not a trust boundary).
 */
export async function cancelRequestAction(
  _prevState: RequestLifecycleActionState,
  formData: FormData,
): Promise<RequestLifecycleActionState> {
  const requestId = typeof formData.get("requestId") === "string" ? (formData.get("requestId") as string).trim() : "";

  if (!requestId) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/requests/${requestId}`);
  const organization = await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("cancel_transportation_request", {
    p_organization_id: organization.organizationId,
    p_request_id: requestId,
  });

  if (error) {
    return { status: "error", errorCode: mapRequestLifecycleError(error.code) };
  }

  revalidatePath(`/operations/requests/${requestId}`);
  revalidatePath("/operations/requests");

  return { status: "success" };
}
