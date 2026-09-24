"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mapLinkPassengerError, type LinkPassengerErrorCode } from "@/lib/operations/link-passenger-errors";
import { mapRequestLifecycleError, type RequestLifecycleErrorCode } from "@/lib/operations/request-lifecycle-errors";
import { validateRequestReason, type RequestDecisionKind } from "@/lib/operations/request-decision-reasons";

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
 * Accept Request (P1-OPS-R1) — calls `accept_transportation_request`
 * ONLY. pending → accepted; the RPC is idempotent (a double click or a
 * concurrent second Accept is a no-op) and never creates a Passenger,
 * Trip or assignment. `organizationId` is re-derived from the validated
 * session, never read from the client.
 */
export async function acceptRequestAction(
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
  const { error } = await supabase.rpc("accept_transportation_request", {
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

/**
 * Decline Request (P1-E1-S2F-B2, reworked by P1-OPS-R1) — calls
 * `decline_transportation_request` ONLY. pending → declined; a reason
 * code from the closed decline set is REQUIRED (note required for
 * `other`). Validated here for a clean error, and again by the RPC,
 * which remains the authority.
 */
export async function declineRequestAction(
  _prevState: RequestLifecycleActionState,
  formData: FormData,
): Promise<RequestLifecycleActionState> {
  return decideRequest("decline", formData);
}

/**
 * Cancel Request (P1-OPS-R1) — calls `cancel_transportation_request`
 * ONLY. accepted → cancelled, reason REQUIRED. The RPC's own "ANY linked
 * Trip blocks cancellation" rule is the authority; the UI hiding the
 * button is only a convenience.
 */
export async function cancelRequestAction(
  _prevState: RequestLifecycleActionState,
  formData: FormData,
): Promise<RequestLifecycleActionState> {
  return decideRequest("cancel", formData);
}

async function decideRequest(kind: RequestDecisionKind, formData: FormData): Promise<RequestLifecycleActionState> {
  const requestId = typeof formData.get("requestId") === "string" ? (formData.get("requestId") as string).trim() : "";
  const reason = validateRequestReason(kind, formData.get("reasonCode"), formData.get("reasonNote"));

  if (!requestId || !reason.ok) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname(`/operations/requests/${requestId}`);
  const organization = await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc(kind === "decline" ? "decline_transportation_request" : "cancel_transportation_request", {
    p_organization_id: organization.organizationId,
    p_request_id: requestId,
    p_reason_code: reason.reasonCode,
    // Always sent: between the P1-OPS-R1 EXPAND and CONTRACT migrations the new decline overload has no default
    // for p_reason_note (it must not be ambiguous with the legacy 3-argument overload). '' is normalised to NULL.
    p_reason_note: reason.reasonNote ?? "",
  });

  if (error) {
    return { status: "error", errorCode: mapRequestLifecycleError(error.code) };
  }

  revalidatePath(`/operations/requests/${requestId}`);
  revalidatePath("/operations/requests");

  return { status: "success" };
}
