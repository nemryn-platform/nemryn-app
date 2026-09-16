"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mapLogRequestError, type LogRequestErrorCode } from "@/lib/operations/log-request-errors";

export interface LogRequestActionState {
  status: "idle" | "success" | "error";
  errorCode?: LogRequestErrorCode;
  requestId?: string;
}

function stringField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Log Request (P1-E1-S2C) — calls the real `log_transportation_request`
 * RPC only, never a direct `transportation_requests` INSERT (P1-E1-S2B
 * retired that raw grant entirely — a direct INSERT would fail at the
 * privilege layer regardless, same discipline as `createTripAction`'s
 * own comment for `create_trip`/`trips`).
 *
 * Re-derives Operations authorization fresh on every call via
 * `requireOperationsAccess`, exactly like `createTripAction` — an
 * inactive Membership, a role change, or a foreign-org attempt is caught
 * HERE, not assumed from how the page happened to render.
 * `organization.organizationId` (the validated session's own current
 * workspace) is the ONLY source of `p_organization_id` — no hidden form
 * field, no client-supplied value is ever read for it, matching the
 * phase's explicit "never trust organization_id from the browser" rule.
 *
 * preferred_date/preferred_time are plain `date`/`time` columns on
 * `transportation_requests` (not `timestamptz`) — unlike
 * `createTripAction`'s `organizationLocalToUtc` boundary for
 * `create_trip`'s `scheduled_pickup_at`, there is no timezone conversion
 * to perform here; the RPC stores exactly what is sent, wall-clock, with
 * no instant resolution needed (S2B's own migration comment: these
 * fields are optional, non-blocking scheduling hints, not the trip's own
 * eventual authoritative pickup time).
 */
export async function logRequestAction(
  _prevState: LogRequestActionState,
  formData: FormData,
): Promise<LogRequestActionState> {
  const requesterName = stringField(formData, "requesterName");
  const requesterRelationship = stringField(formData, "requesterRelationship");
  const requesterPhone = stringField(formData, "requesterPhone");
  const requesterEmail = stringField(formData, "requesterEmail");
  const pickupDescription = stringField(formData, "pickupDescription");
  const destinationDescription = stringField(formData, "destinationDescription");
  const returnTripNeeded = stringField(formData, "returnTripNeeded");
  const source = stringField(formData, "source");
  const passengerId = stringField(formData, "passengerId");
  const preferredDate = stringField(formData, "preferredDate");
  const preferredTime = stringField(formData, "preferredTime");
  const assistanceNotes = stringField(formData, "assistanceNotes");
  const additionalNotes = stringField(formData, "additionalNotes");

  // Obvious client-catchable validation (mirrors createTripAction's own
  // discipline) — improves usability, never a substitute for the RPC's
  // own authority below. Matches exactly the required-to-save set from
  // the S2B/S2A contract — no schedule, facility, driver, or vehicle is
  // required here.
  if (!requesterName || !requesterRelationship || !requesterPhone) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (!pickupDescription || !destinationDescription) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (!returnTripNeeded || !source) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const pathname = await getCurrentPathname("/operations/requests/new");
  const organization = await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("log_transportation_request", {
    p_organization_id: organization.organizationId,
    p_requester_name: requesterName,
    p_requester_relationship: requesterRelationship,
    p_requester_phone: requesterPhone,
    p_pickup_description: pickupDescription,
    p_destination_description: destinationDescription,
    p_return_trip_needed: returnTripNeeded,
    p_source: source,
    p_requester_email: requesterEmail ?? undefined,
    p_passenger_id: passengerId ?? undefined,
    p_preferred_date: preferredDate ?? undefined,
    p_preferred_time: preferredTime ?? undefined,
    p_assistance_notes: assistanceNotes ?? undefined,
    p_additional_notes: additionalNotes ?? undefined,
  });

  if (error) {
    return { status: "error", errorCode: mapLogRequestError(error.code) };
  }

  // P1-E1-S2D: the Request Hub queue now exists and reads this exact
  // table — without this, a freshly logged Request would not appear
  // there until some unrelated navigation happened to trigger a refetch.
  // The smallest existing Next.js mechanism (mirrors createTripAction's
  // own revalidatePath calls) — no redesign of this action otherwise.
  revalidatePath("/operations/requests");

  return { status: "success", requestId: data?.request_id ?? undefined };
}
