import "server-only";
import { cache } from "react";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role-server";
import type { PublicFormSubmission } from "@/lib/public-intake/website-intake-core";
import { isPublicFormKey, type PublicFormConfig } from "./public-form-core";

/**
 * Server-side data-access boundary for the PUBLIC Nemryn request form (P1-COMM-D2). Deliberately thin: every rule (publication
 * state, suspended organization, snapshot, services, idempotency, attribution, notification) lives in the two service_role
 * RPCs `get_public_request_form` / `submit_public_form_request`; nothing here selects a tenant except by passing the opaque
 * public key. Uses the same single narrow service-role client as website intake. No table access, no ids returned.
 */

/** The published, passenger-facing configuration, or null for ANY unavailable key (unknown, malformed, unpublished, disabled, suspended). */
export const getPublicRequestForm = cache(async (publicKey: string): Promise<PublicFormConfig | null> => {
  if (!isPublicFormKey(publicKey)) return null;
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_request_form", { p_public_key: publicKey });
  if (error) {
    console.error("[public-form] get_public_request_form failed");
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    organizationName: row.organization_name,
    title: row.title,
    introText: row.intro_text,
    submitLabel: row.submit_label,
    confirmationMessage: row.confirmation_message,
    services: row.service_types ?? [],
    allowRecurring: row.allow_recurring,
    requireServiceChoice: row.require_service_choice,
    formVersion: row.form_version,
  };
});

export type PublicFormSubmitResult =
  /** `notificationEventId` is non-null ONLY for a genuinely new Request (an idempotent replay yields null); server-side only. */
  | { status: "accepted"; notificationEventId: string | null }
  | { status: "rejected" };

export async function submitPublicFormRequest(publicKey: string, submission: PublicFormSubmission): Promise<PublicFormSubmitResult> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("submit_public_form_request", {
    p_public_key: publicKey,
    p_idempotency_key: submission.idempotencyKey,
    p_requester_name: submission.requesterName,
    p_requester_relationship: submission.requesterRelationship,
    p_requester_phone: submission.requesterPhone,
    p_pickup_description: submission.pickupDescription,
    p_destination_description: submission.destinationDescription,
    p_return_trip_needed: submission.returnTripNeeded,
    p_requester_email: submission.requesterEmail ?? undefined,
    p_preferred_date: submission.preferredDate ?? undefined,
    p_preferred_time: submission.preferredTime ?? undefined,
    p_assistance_notes: submission.assistanceNotes ?? undefined,
    p_additional_notes: submission.additionalNotes ?? undefined,
    p_service_type: submission.serviceType ?? undefined,
    p_recurring_days_of_week: submission.recurringSchedule?.daysOfWeek ?? undefined,
    p_recurring_start_date: submission.recurringSchedule?.startDate ?? undefined,
    p_recurring_end_date: submission.recurringSchedule?.endDate ?? undefined,
    p_recurring_appointment_time: submission.recurringSchedule?.appointmentTime ?? undefined,
    p_recurring_return_trip_expected: submission.recurringSchedule?.returnTripExpected ?? undefined,
    p_requested_passenger_name: submission.requestedPassengerName ?? undefined,
    // Sanitised optional acquisition. The database re-sanitises and OVERRIDES formVersion with the server-authoritative
    // published version; an unusable acquisition can never cause the Request to be rejected.
    p_acquisition: submission.acquisition ? { ...submission.acquisition } : undefined,
  });
  if (error || !data?.accepted) {
    console.error("[public-form] submit_public_form_request rejected");
    return { status: "rejected" };
  }
  return { status: "accepted", notificationEventId: data.notification_event_id ?? null };
}
