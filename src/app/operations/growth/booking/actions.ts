"use server";

import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";
import { canWriteGrowth } from "@/lib/plus/access-core";
import {
  BOOKING_SERVICE_ERROR,
  BOOKING_SUCCESS_MESSAGE,
  bookingErrorMessage,
  isIdempotencyKey,
  validateBookingForm,
  type BookingFieldErrors,
  type BookingFormValues,
} from "@/lib/plus/booking-core";
import { isUuid } from "@/lib/plus/attribution-core";
import { parseServiceTypeInput } from "@/lib/operations/log-request-options";
import { SERVICE_TYPE_VALUES } from "@/lib/public-intake/website-intake-core";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Conversion & rebooking actions (NP-P2-S4). Each re-checks Growth access (requirePlusAccess), the organization binding
 * of the form and the write capability; the RPC then re-checks Plus write AND the Core role that logs Requests, and
 * Core's own log_transportation_request validates and creates the PENDING Request as the signed-in staff member. The
 * idempotency key makes a retry (double click, timeout) return the same Request -- never a second one.
 */

const WRONG_ORGANIZATION = "You switched to a different organization since this page was loaded. Reload the page before making changes.";
const NO_WRITE = "You can view this record but can't create transportation requests. Ask an Organization Admin for access.";

export interface BookingActionState {
  status: "idle" | "success" | "error";
  message?: string;
  errors?: BookingFieldErrors;
  requestId?: string;
  replayed?: boolean;
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}
function readValues(formData: FormData): BookingFormValues {
  return {
    requesterRelationship: text(formData, "requesterRelationship"),
    pickupDescription: text(formData, "pickupDescription"),
    destinationDescription: text(formData, "destinationDescription"),
    returnTripNeeded: text(formData, "returnTripNeeded"),
    preferredDate: text(formData, "preferredDate"),
    preferredTime: text(formData, "preferredTime"),
    assistanceNotes: text(formData, "assistanceNotes"),
    additionalNotes: text(formData, "additionalNotes"),
    source: text(formData, "source"),
  };
}

async function guardWrite(formData: FormData) {
  const pathname = await getCurrentPathname("/operations/growth");
  const { context, plus } = await requirePlusAccess(pathname);
  if (text(formData, "organizationId") !== context.organizationId) return { error: WRONG_ORGANIZATION } as const;
  if (!canWriteGrowth(plus.state, plus.capability)) return { error: NO_WRITE } as const;
  return { context } as const;
}

// No revalidatePath here: in a Server Action it re-renders the CURRENT page immediately, which would show the converted
// opportunity WITHOUT its conversion control and unmount the confirmation before the person sees it. The dialog refreshes
// the page (router.refresh) when the person closes the confirmation; the Operations pages are dynamic and render fresh.
function refresh() {}

/** Opportunity -> ONE pending Core Request (+ conversion link, opportunity converted), in one database transaction. */
export async function convertOpportunityAction(_prev: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const opportunityId = text(formData, "opportunityId");
  const expected = text(formData, "expectedVersion");
  const key = text(formData, "idempotencyKey");
  if (!isUuid(opportunityId) || !expected || Number.isNaN(Date.parse(expected)) || !isIdempotencyKey(key)) {
    return { status: "error", message: "Reload the page and try again." };
  }
  const parsed = validateBookingForm(readValues(formData), { needsSource: false });
  if (!parsed.ok) return { status: "error", errors: parsed.errors, message: "Check the highlighted fields." };
  const v = parsed.value;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_convert_opportunity_to_request", {
    p_organization_id: guard.context.organizationId,
    p_opportunity_id: opportunityId,
    p_expected_updated_at: expected,
    p_idempotency_key: key,
    p_requester_relationship: v.requesterRelationship,
    p_pickup_description: v.pickupDescription,
    p_destination_description: v.destinationDescription,
    p_return_trip_needed: v.returnTripNeeded,
    p_preferred_date: v.preferredDate as string,
    p_preferred_time: v.preferredTime as string,
    p_assistance_notes: v.assistanceNotes as string,
    p_additional_notes: v.additionalNotes as string,
  });
  if (error || !data) {
    console.error("[plus] conversion failed", error?.code ?? "no_data");
    return { status: "error", message: bookingErrorMessage(error?.code, error?.message) };
  }
  refresh();
  return { status: "success", message: BOOKING_SUCCESS_MESSAGE, requestId: data.request_id ?? undefined, replayed: data.changed === false };
}

/** Contact -> ONE new pending Core Request (+ rebooking link). No opportunity is created or changed. */
export async function rebookContactAction(_prev: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const guard = await guardWrite(formData);
  if ("error" in guard) return { status: "error", message: guard.error };
  const contactId = text(formData, "contactId");
  const key = text(formData, "idempotencyKey");
  if (!isUuid(contactId) || !isIdempotencyKey(key)) return { status: "error", message: "Reload the page and try again." };
  const parsed = validateBookingForm(readValues(formData), { needsSource: true });
  if (!parsed.ok) return { status: "error", errors: parsed.errors, message: "Check the highlighted fields." };
  const v = parsed.value;
  // NP-P2-S4.1-S2: optional "Service requested" -- the RAW value against Core's canonical nine (blank = not specified;
  // never trimmed into a valid value). Configured Services do not restrict it (OD-S1 = A); Core re-validates.
  const service = parseServiceTypeInput(formData.get("serviceType"), SERVICE_TYPE_VALUES);
  if (!service.ok) return { status: "error", errors: { serviceType: BOOKING_SERVICE_ERROR }, message: "Check the highlighted fields." };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_create_rebooking_request", {
    p_organization_id: guard.context.organizationId,
    p_contact_id: contactId,
    p_idempotency_key: key,
    p_requester_relationship: v.requesterRelationship,
    p_pickup_description: v.pickupDescription,
    p_destination_description: v.destinationDescription,
    p_return_trip_needed: v.returnTripNeeded,
    p_source: v.source,
    p_preferred_date: v.preferredDate as string,
    p_preferred_time: v.preferredTime as string,
    p_assistance_notes: v.assistanceNotes as string,
    p_additional_notes: v.additionalNotes as string,
    p_service_type: service.value ?? undefined,
  });
  if (error || !data) {
    console.error("[plus] rebooking failed", error?.code ?? "no_data");
    return { status: "error", message: bookingErrorMessage(error?.code, error?.message) };
  }
  refresh();
  return { status: "success", message: BOOKING_SUCCESS_MESSAGE, requestId: data.request_id ?? undefined, replayed: data.changed === false };
}
