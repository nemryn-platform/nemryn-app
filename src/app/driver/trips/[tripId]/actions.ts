"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { redirect } from "next/navigation";
import { requireDriverAccess } from "@/lib/auth/authorization";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DRIVER_NEXT_ACTION, type DriverLifecycleRpc } from "@/lib/driver/trip-presentation";
import { mapDriverActionError, type DriverActionErrorCode } from "@/lib/driver/errors";
import { mapDriverLocationError, type DriverLocationErrorCode } from "@/lib/driver/location-errors";
import {
  mapTripExceptionError,
  type TripExceptionErrorCode,
  EXCEPTION_TYPE_VALUES,
} from "@/lib/operations/trip-exception-errors";

export interface ProgressTripState {
  status: "idle" | "success" | "error";
  errorCode?: DriverActionErrorCode;
  changed?: boolean;
  newState?: string;
}

const ALLOWED_RPCS = new Set<string>(Object.values(DRIVER_NEXT_ACTION).map((a) => a.rpc));

/**
 * The single Server Action backing every Driver lifecycle progression
 * button (P1-E3-S3, work item §42). No service role — runs entirely under
 * the caller's own authenticated session via `createServerSupabaseClient()`,
 * exactly like every other mutation this application performs.
 *
 * Authorization is layered, matching ZD-105's established relationship
 * between this application layer and the database:
 *   1. `requireDriverAccess()` — re-derived fresh on every call (never
 *      trusted from a prior page render) — confirms the caller is still an
 *      active Driver in an active Membership right now (work item §52/§53).
 *   2. The RPC itself — the actual, final authority on whether THIS caller
 *      may act on THIS specific Trip right now (currently active
 *      assignment, correct from-state). This action never attempts to
 *      duplicate that check; it exists only to invoke the RPC under a real
 *      session and translate its result into safe UI state.
 *
 * `rpc` is validated against the fixed 6-name allowlist derived from
 * `DRIVER_NEXT_ACTION` — never passed through as an arbitrary client-
 * supplied function name (trip ID and expected-state values are untrusted
 * form input; the RPC name must be even more tightly constrained, since an
 * unvalidated dynamic RPC name would be a far more dangerous injection
 * surface than a wrong string parameter).
 */
export async function progressTripAction(
  _prevState: ProgressTripState,
  formData: FormData,
): Promise<ProgressTripState> {
  const tripId = formData.get("tripId");
  const expectedCurrentState = formData.get("expectedCurrentState");
  const rpc = formData.get("rpc");

  if (typeof tripId !== "string" || typeof expectedCurrentState !== "string" || typeof rpc !== "string") {
    return { status: "error", errorCode: "UNKNOWN" };
  }
  if (!ALLOWED_RPCS.has(rpc)) {
    return { status: "error", errorCode: "UNKNOWN" };
  }

  const access = await requireDriverAccess(`/driver/trips/${tripId}`);
  if (access.status !== "ok") {
    // Membership/Driver linkage failed closed on this very attempt — same
    // safe outcome as any other inaccessible-Trip case, no extra detail.
    return { status: "error", errorCode: "NOT_FOUND" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(rpc as DriverLifecycleRpc, {
    p_trip_id: tripId,
    p_expected_current_state: expectedCurrentState,
  });

  if (error || !data) {
    return { status: "error", errorCode: mapDriverActionError(error?.code) };
  }

  // Server-side revalidation (work item §28) — the database response is
  // authoritative; every surface that could show this Trip's state is
  // invalidated so the next render anywhere reflects it, never a
  // client-guessed optimistic value.
  revalidatePath(`/driver/trips/${tripId}`);
  revalidatePath("/driver/trips");
  revalidatePath("/driver");

  if (rpc === "driver_complete_trip") {
    // `driver_complete_trip` closes the active assignment in the same
    // transaction (docs/data/mutation-api.md) — this detail page becomes
    // inaccessible on its very next `driver_get_trip_detail` call, which
    // is exactly what the `revalidatePath` calls above would trigger on
    // this same route next. Redirecting SERVER-SIDE, from within the
    // action itself, avoids a real race that a client-side
    // `router.push()` after the fact loses: Next.js automatically
    // re-renders the current route's Server Component tree once a Server
    // Action completes (to reflect its own `revalidatePath` calls) —
    // that automatic re-render would otherwise show this now-inaccessible
    // Trip's "Trip unavailable" state before a client `useEffect`-driven
    // push ever gets a chance to run (found and reproduced via the real
    // end-to-end lifecycle test, not assumed — see docs/reports/
    // P1-E3-S3-completion-report.txt). `redirect()` thrown here pre-empts
    // that race entirely (work item §29).
    redirect("/driver");
  }

  return {
    status: "success",
    changed: data.changed ?? false,
    newState: data.current_state ?? undefined,
  };
}

export interface RecordLocationResult {
  status: "success" | "error";
  errorCode?: DriverLocationErrorCode;
}

/**
 * Records one location update for the Trip the Driver is currently
 * tracking (P1-E3-S7A, work item §46) — invoked directly from
 * `DriverLocationTracker` on each throttled `watchPosition` reading, NOT
 * bound to a `<form>` (there is no user-facing submit button; this is a
 * background write triggered by the browser's geolocation callback).
 * Next.js Server Actions may be called as plain async functions from a
 * Client Component exactly like this — the `"use server"` boundary above
 * still applies per-call.
 *
 * Same layered-authorization discipline as `progressTripAction`:
 * `requireDriverAccess()` re-derived fresh on every single call (never
 * cached across the tracker's own polling loop), then
 * `driver_record_location` itself remains the final, real authority
 * (currently-active assignment, eligible lifecycle state, valid
 * coordinates). Deliberately does NOT call `revalidatePath` — a location
 * post changes no Trip-visible field this page itself renders, and
 * calling it on a ~20s cadence would trigger unnecessary Server Component
 * re-renders of the Driver's own active-trip view for no visible benefit.
 */
export async function recordLocationAction(
  tripId: string,
  latitude: number,
  longitude: number,
  accuracyMeters: number | null,
): Promise<RecordLocationResult> {
  const access = await requireDriverAccess(`/driver/trips/${tripId}`);
  if (access.status !== "ok") {
    return { status: "error", errorCode: "NOT_FOUND" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("driver_record_location", {
    p_trip_id: tripId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_accuracy_meters: accuracyMeters ?? undefined,
  });

  if (error || !data) {
    return { status: "error", errorCode: mapDriverLocationError(error?.code) };
  }

  return { status: "success" };
}

export interface DriverReportIssueState {
  status: "idle" | "success" | "error";
  errorCode?: TripExceptionErrorCode;
}

/**
 * Driver-facing "Report Issue" (P1-E3-S8B, work item §37) — the
 * reference (docs/design/stitch/references/04-driver-active-trip.png)
 * shows this as a clear, natural affordance on the Active Trip screen,
 * and the backend already safely supports exactly this scope after
 * P1-E3-S8A's own hardening: `report_trip_exception` now requires a
 * CURRENTLY active assignment (not merely "ever assigned") and is the
 * sole write path (direct INSERT is revoked entirely). This action adds
 * no new authorization logic of its own — same `requireDriverAccess()` +
 * RPC pattern as every other action in this file; the RPC itself remains
 * the real, final authority.
 *
 * Deliberately narrow, matching the work item's own explicit conditions:
 * no Driver resolve path (resolve_trip_exception is Operations-only, and
 * this file exposes no way to call it), no broad exception read (the
 * Driver UI never lists or displays existing exceptions — this is a
 * write-only affordance), non-terminal enforced by the RPC's own
 * current-assignment requirement (ZD-178), not duplicated here.
 */
export async function driverReportIssueAction(
  _prevState: DriverReportIssueState,
  formData: FormData,
): Promise<DriverReportIssueState> {
  const tripId = formData.get("tripId");
  const exceptionType = formData.get("exceptionType");
  const description = formData.get("description");

  if (typeof tripId !== "string" || tripId.length === 0) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  if (typeof exceptionType !== "string" || !EXCEPTION_TYPE_VALUES.has(exceptionType)) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const access = await requireDriverAccess(`/driver/trips/${tripId}`);
  if (access.status !== "ok") {
    return { status: "error", errorCode: "NOT_FOUND" };
  }

  const supabase = await createServerSupabaseClient();
  const { data: reported, error } = await supabase.rpc("report_trip_exception", {
    p_trip_id: tripId,
    p_exception_type: exceptionType,
    p_description: description.trim(),
  });

  if (error) {
    return { status: "error", errorCode: mapTripExceptionError(error.code) };
  }

  // P1-PILOT-S4B-R4D: the exception and its notification event committed
  // together; the email goes out AFTER, best-effort (see dispatchNotification) --
  // it can never fail or slow this action, and a provider outage is recorded,
  // not surfaced as a failed report.
  const notificationEventId = reported?.notification_event_id;
  if (notificationEventId) {
    after(() => dispatchNotification(notificationEventId));
  }

  // No revalidation of this Driver route — the Driver UI never displays
  // exception state (no broad exception read, per the work item's own
  // explicit condition), so there is nothing here for a re-render to
  // reflect. Operations-facing surfaces (Today's Operations, Dispatch,
  // this Trip's own Operations Trip Detail) already revalidate
  // themselves the identical way when Operations reports an issue
  // (reportExceptionAction) — this is the same underlying row, so those
  // surfaces will show it correctly on their own next load regardless.
  return { status: "success" };
}
