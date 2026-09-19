import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role-server";
import type { WebsiteIntakeSubmission } from "./website-intake-core";

/**
 * Server-side data-access boundary for the public tenant-website intake
 * RPC (P1-PILOT-S4A, hardened P1-PILOT-S4B). Deliberately the THINNEST
 * possible wrapper — all real validation/authorization/tenant-resolution/
 * idempotency lives in `submit_public_transportation_request` itself
 * (supabase/migrations/20260919090000_public_request_intake_foundation.sql),
 * never duplicated here. This module's only job is the one RPC call and
 * mapping its result/error into a small discriminated result the route
 * handler can safely render, exactly like `todays-operations.ts`/
 * `operations-brief.ts` already do for their own RPC calls.
 *
 * P1-PILOT-S4B: as of
 * supabase/migrations/20260919120000_public_intake_ingress_hardening.sql,
 * `submit_public_transportation_request` is `service_role`-only — the
 * direct-anon-RPC bypass P1-PILOT-S4A's own report explicitly flagged
 * ("anon can call this directly via PostgREST, bypassing the Route
 * Handler's own anti-abuse controls entirely") is now closed. This
 * module therefore uses `createServiceRoleSupabaseClient()` — the ONE
 * privileged Supabase client in this codebase (see that file's own
 * extensive comment on its narrow, single-purpose scope) — instead of
 * the ordinary publishable-key `createServerSupabaseClient()`. This is
 * the ONLY code path in this codebase that calls this RPC; the RPC
 * itself remains the sole authority for every protection it enforces
 * (tenant resolution, field bounds, idempotency, no-auto-Passenger,
 * no-auto-Trip, cross-tenant integrity) — this module still does nothing
 * beyond the one RPC call, never a raw table write.
 */

export type WebsiteIntakeSubmitResult = { status: "accepted" } | { status: "rejected" };

export async function submitWebsiteTransportationRequest(
  submission: WebsiteIntakeSubmission,
  origin: string | null,
): Promise<WebsiteIntakeSubmitResult> {
  const supabase = createServiceRoleSupabaseClient();

  const { data, error } = await supabase.rpc("submit_public_transportation_request", {
    p_integration_external_id: submission.integrationExternalId,
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
    p_origin: origin ?? undefined,
    // P1-PILOT-S4B-R2 — two optional structured fields, both `undefined`
    // (Postgres default null) when the caller did not send them. The RPC
    // itself converts recurringSchedule.daysOfWeek's day-NAME strings to
    // canonical ISO weekday numbers for storage — this module passes
    // them through unchanged, doing no conversion of its own.
    p_service_type: submission.serviceType ?? undefined,
    p_recurring_days_of_week: submission.recurringSchedule?.daysOfWeek ?? undefined,
    p_recurring_start_date: submission.recurringSchedule?.startDate ?? undefined,
    p_recurring_end_date: submission.recurringSchedule?.endDate ?? undefined,
    p_recurring_appointment_time: submission.recurringSchedule?.appointmentTime ?? undefined,
    p_recurring_return_trip_expected: submission.recurringSchedule?.returnTripExpected ?? undefined,
    // P1-PILOT-S4B-R2A — a plain free-text snapshot, passed through
    // unchanged. Never matched/resolved against any Passenger record by
    // this module or the RPC — see requested_passenger_name's own
    // column comment.
    p_requested_passenger_name: submission.requestedPassengerName ?? undefined,
  });

  if (error || !data?.accepted) {
    // Safe, fixed, non-dynamic log only (mirrors requests-list.ts's/
    // operations-brief.ts's own established convention) — the RPC's own
    // raised error message is never logged here, since ZW006 covers
    // several distinct causes and this module has no way to know which
    // one applies without re-deriving logic that belongs solely to the
    // RPC. No payload content (name/phone/email/pickup/destination) is
    // ever logged.
    console.error("[public-intake] submit_public_transportation_request rejected");
    return { status: "rejected" };
  }

  return { status: "accepted" };
}
