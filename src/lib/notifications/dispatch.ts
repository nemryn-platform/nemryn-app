import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role-server";
import { getAppOrigin } from "@/lib/app-url";
import { sendEmail } from "@/lib/email/send";
import { buildNotificationEmail } from "@/lib/email/notification-email";
import { serviceLabel } from "@/lib/operations/organization-services-core";

/**
 * The server-side notification dispatch boundary (P1-PILOT-S4B-R4D).
 *
 * The business transaction (a new website Request, a reported TripException)
 * has ALREADY committed, and its notification_events row was written in that
 * same transaction. This function runs AFTER, best-effort, and can never affect
 * the outcome of the operation that triggered it:
 *   1. claim_notification_dispatch (service_role) atomically claims the event --
 *      exactly one concurrent caller wins, so a notification cannot be sent
 *      twice -- and returns recipients resolved from LIVE Membership state plus a
 *      deliberately minimal payload (or null: nothing to send);
 *   2. one email per recipient through the platform transport (each recipient is
 *      a separate message, so no one learns another's address);
 *   3. complete_notification_dispatch records the honest outcome: counts and a
 *      FIXED-vocabulary reason (provider_error | not_configured | build_failed),
 *      never provider text.
 * No retry happens here (a future job queue can drain failed events); nothing is
 * ever thrown to the caller; nothing sensitive is logged. Use `after()` from the
 * caller so the HTTP response / user action is not delayed by email latency.
 */

interface ClaimedDispatch {
  event_type: "website_request" | "trip_exception";
  organization_name: string;
  timezone: string;
  recipients: string[];
  payload: { requested_date?: string | null; service_type?: string | null; pickup_at?: string | null };
}

export async function dispatchNotification(eventId: string | null | undefined): Promise<void> {
  if (!eventId) return;
  try {
    const supabase = createServiceRoleSupabaseClient();
    const { data, error } = await supabase.rpc("claim_notification_dispatch", { p_event_id: eventId });
    if (error) {
      console.error("[notification] claim failed");
      return;
    }
    if (!data) return; // nothing to send (already claimed, or no eligible recipient)

    const claim = data as unknown as ClaimedDispatch;
    let sent = 0;
    let failed = 0;
    let reason: "provider_error" | "not_configured" | "build_failed" | null = null;

    let appOrigin: string | null = null;
    try {
      appOrigin = await getAppOrigin();
    } catch {
      appOrigin = null;
    }

    for (const recipient of claim.recipients) {
      if (!appOrigin) {
        failed += 1;
        reason = "build_failed";
        continue;
      }
      try {
        const result = await sendEmail(
          buildNotificationEmail({
            eventType: claim.event_type,
            recipient,
            organizationName: claim.organization_name,
            appOrigin,
            requestedDate: claim.payload.requested_date ?? null,
            serviceLabel: claim.payload.service_type ? serviceLabel(claim.payload.service_type) : null,
            pickupAt: claim.payload.pickup_at ?? null,
            timezone: claim.timezone,
          }),
        );
        if (result.status === "sent") {
          sent += 1;
        } else {
          failed += 1;
          reason = result.status === "not_configured" ? "not_configured" : (reason ?? "provider_error");
        }
      } catch {
        failed += 1;
        reason = reason ?? "build_failed";
      }
    }

    const { error: completeError } = await supabase.rpc("complete_notification_dispatch", {
      p_event_id: eventId,
      p_sent: sent,
      p_failed: failed,
      p_reason: reason as unknown as string,
    });
    if (completeError) console.error("[notification] could not record the delivery outcome");
    if (failed > 0) console.warn(`[notification] ${failed} of ${claim.recipients.length} deliveries failed (${reason})`);
  } catch {
    console.error("[notification] dispatch failed");
  }
}
