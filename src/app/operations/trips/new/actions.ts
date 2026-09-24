"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { organizationLocalToUtc } from "@/lib/operations/local-time";
import { mapNewTripError, type NewTripErrorCode } from "@/lib/operations/new-trip-errors";
import { callAssignmentRpc } from "@/lib/operations/assignment-mutation";
import type { DispatchErrorCode } from "@/lib/operations/dispatch-errors";
import type { CreateTripAssignmentOutcome } from "@/lib/operations/readiness-actions-core";

export interface CreateTripActionState {
  status: "idle" | "success" | "error";
  errorCode?: NewTripErrorCode;
  tripId?: string;
  /** P1-OPS-PROG2 "Assign now": whether an assignment was requested and how it ended. Only meaningful on success. */
  assignment?: CreateTripAssignmentOutcome;
  assignmentErrorCode?: DispatchErrorCode;
}

function stringField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Create Trip — the real `create_trip` RPC only, never a direct `trips`
 * INSERT (work item §8; the raw grant is revoked entirely — ZD-101 — so a
 * direct INSERT would fail at the privilege layer regardless). Re-derives
 * Operations authorization fresh on every call, exactly like
 * `assignmentAction`/`cancelTripAction` — an inactive Membership, a role
 * change, or a foreign-org attempt is caught HERE, not assumed from how the
 * page happened to render (work item §61/§62/§63).
 *
 * The ONE explicit local→UTC conversion boundary (work item §22): every
 * date/time field arrives as separate organization-local `date`+`time`
 * strings, never a browser-composed Date. `organizationLocalToUtc` resolves
 * each pair against the organization's OWN timezone (re-derived here from
 * the fresh `requireOperationsAccess` call, never trusted from the client)
 * — a `"nonexistent"`/`"ambiguous"` result (work item §23) is rejected
 * before create_trip is ever called, with an honest, specific message,
 * rather than silently picking an instant.
 */
export async function createTripAction(
  _prevState: CreateTripActionState,
  formData: FormData,
): Promise<CreateTripActionState> {
  const passengerId = stringField(formData, "passengerId");
  const pickupDate = stringField(formData, "pickupDate");
  const pickupTime = stringField(formData, "pickupTime");
  const appointmentDate = stringField(formData, "appointmentDate");
  const appointmentTime = stringField(formData, "appointmentTime");
  const pickupFacilityId = stringField(formData, "pickupFacilityId");
  const pickupDescription = stringField(formData, "pickupDescription");
  const destinationFacilityId = stringField(formData, "destinationFacilityId");
  const destinationDescription = stringField(formData, "destinationDescription");
  const instructions = stringField(formData, "instructions");
  const assistanceNotes = stringField(formData, "assistanceNotes");
  const requestId = stringField(formData, "requestId");
  // P1-OPS-PROG2 "Assign now" -- opt-in; the Driver/Vehicle fields exist
  // in the form only while the operator has it switched on.
  const assignNow = formData.get("assignNow") === "on";
  const assignDriverId = stringField(formData, "driverId");
  const assignVehicleId = stringField(formData, "vehicleId");

  // Obvious client-catchable validation (work item §36) — improves
  // usability, never a substitute for the RPC's own authority below.
  if (!passengerId) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (!pickupDescription || !destinationDescription) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  // Pickup date+time is required by this form even though create_trip's own
  // p_scheduled_pickup_at is nullable — a Trip with no scheduled pickup
  // cannot appear on Today's Operations/Dispatch by calendar day at all
  // (work item §42/§43/§66's own mandatory day-scoped E2E test), so this
  // phase's UI requires it as a deliberate product decision beyond the RPC's
  // bare minimum, not an inferred backend rule.
  if (!pickupDate || !pickupTime) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  // Appointment is both-or-neither — a lone date or lone time cannot be
  // resolved to an instant.
  if ((appointmentDate && !appointmentTime) || (appointmentTime && !appointmentDate)) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  // Checked before anything is created: "Assign now" with no Driver must
  // never silently become an unassigned Trip.
  if (assignNow && !assignDriverId) {
    return { status: "error", errorCode: "ASSIGN_DRIVER_REQUIRED" };
  }

  const pathname = await getCurrentPathname("/operations/trips/new");
  const organization = await requireOperationsAccess(pathname);
  const supabase = await createServerSupabaseClient();

  // P1-E1-S2F-B1 §17 — defense-in-depth beyond create_trip's own
  // hardened (P1-E1-S2F-A) rejection: when a Request is submitted, the
  // Passenger actually sent to the RPC is derived HERE, server-side,
  // from that Request's own row — never trusted from the browser's own
  // `passengerId` field. The New Trip UI already makes Passenger
  // read-only/derived whenever a Request is selected (§7), so this
  // lookup should normally just confirm what the client already sent;
  // its real purpose is closing the gap for a forged or stale
  // submission (`requestId` = Request A, `passengerId` = Passenger B)
  // BEFORE it ever reaches the RPC, not merely relying on the
  // database's own final rejection. A single small, org-scoped lookup
  // — no new query architecture. If the Request cannot be found in
  // this organization (malformed/nonexistent/foreign-org/stale), no
  // override is applied here — `create_trip` itself still authoritatively
  // rejects the whole call regardless (its own existing `not found`
  // check on `p_request_id`), so the final security posture is
  // unchanged either way; this lookup only ever narrows what reaches
  // the RPC, never widens it.
  let effectivePassengerId = passengerId;
  if (requestId) {
    const { data: requestRow } = await supabase
      .from("transportation_requests")
      .select("passenger_id")
      .eq("id", requestId)
      .eq("organization_id", organization.organizationId)
      .maybeSingle();
    if (requestRow?.passenger_id) {
      effectivePassengerId = requestRow.passenger_id;
    }
  }

  const pickupConversion = organizationLocalToUtc(
    { date: pickupDate, time: pickupTime },
    organization.organizationTimezone,
  );
  if (pickupConversion.status === "invalid") {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }
  if (pickupConversion.status === "nonexistent" || pickupConversion.status === "ambiguous") {
    return { status: "error", errorCode: "SCHEDULE_UNRESOLVABLE" };
  }

  let appointmentUtc: Date | undefined;
  if (appointmentDate && appointmentTime) {
    const appointmentConversion = organizationLocalToUtc(
      { date: appointmentDate, time: appointmentTime },
      organization.organizationTimezone,
    );
    if (appointmentConversion.status === "invalid") {
      return { status: "error", errorCode: "INVALID_INPUT" };
    }
    if (appointmentConversion.status === "nonexistent" || appointmentConversion.status === "ambiguous") {
      return { status: "error", errorCode: "SCHEDULE_UNRESOLVABLE" };
    }
    appointmentUtc = appointmentConversion.utc;
  }
  // Helpful, non-authoritative ordering check (work item §24) — the RPC
  // re-validates this itself regardless (invalid-timing application test,
  // report §46).
  if (appointmentUtc && appointmentUtc.getTime() < pickupConversion.utc.getTime()) {
    return { status: "error", errorCode: "INVALID_INPUT" };
  }

  const { data, error } = await supabase.rpc("create_trip", {
    p_organization_id: organization.organizationId,
    p_passenger_id: effectivePassengerId,
    p_pickup_description: pickupDescription,
    p_destination_description: destinationDescription,
    p_scheduled_pickup_at: pickupConversion.utc.toISOString(),
    p_appointment_at: appointmentUtc?.toISOString(),
    p_pickup_facility_id: pickupFacilityId ?? undefined,
    p_destination_facility_id: destinationFacilityId ?? undefined,
    p_assistance_notes: assistanceNotes ?? undefined,
    p_instructions: instructions ?? undefined,
    p_request_id: requestId ?? undefined,
  });

  if (error) {
    return { status: "error", errorCode: mapNewTripError(error.code) };
  }

  // The newly-created Trip should appear naturally wherever its own
  // schedule/assignment condition puts it (work item §41/§42/§43) — no
  // special-case write, just the standard revalidation set.
  revalidatePath("/operations");
  revalidatePath("/operations/dispatch");
  if (data?.trip_id) {
    revalidatePath(`/operations/trips/${data.trip_id}`);
  }
  // P1-E1-S2F-B1 §18 — a Request-linked conversion changes the
  // Request's own state (pending -> accepted), its Linked Trips list,
  // and Request Hub's queue status/readiness for that row — all real,
  // observable changes create_trip itself just made, so both surfaces
  // need fresh data on the very next navigation, same as every other
  // Request-mutating action in this codebase already does.
  if (requestId) {
    revalidatePath("/operations/requests");
    revalidatePath(`/operations/requests/${requestId}`);
  }

  revalidatePath("/operations/tomorrow");

  const tripId = data?.trip_id ?? undefined;
  if (!assignNow || !tripId || !assignDriverId) {
    return { status: "success", tripId, assignment: "not_requested" };
  }

  // P1-OPS-PROG2 CREATE THEN ASSIGN -- deliberately two existing calls, not
  // a combined RPC and not atomic. The Trip above is already created and is
  // never rolled back or re-created here; the assignment goes through the
  // SAME single assign_trip path the dialog uses, exactly once (no retry).
  // A failure is reported as a partial success so the operator is sent to
  // the created Trip, where assignment can be completed.
  const assignment = await callAssignmentRpc(supabase, {
    mode: "assign",
    tripId,
    driverId: assignDriverId,
    vehicleId: assignVehicleId ?? undefined,
  });
  if (!assignment.ok) {
    return { status: "success", tripId, assignment: "failed", assignmentErrorCode: assignment.errorCode };
  }
  return { status: "success", tripId, assignment: "assigned" };
}

export interface AddPassengerActionState {
  status: "idle" | "success" | "error";
  passenger?: { id: string; displayName: string; phone: string | null };
}

/**
 * Add New Passenger — a direct, RLS-protected `passengers` INSERT, not an
 * RPC (work item §11: Passenger "has no lifecycle machine to protect,
 * unlike Trip" — ui-data-action-map.md's own pre-existing note). Mirrors
 * `addNoteAction`'s established direct-write pattern (P1-E3-S6). Does not
 * expand this phase materially — one table, two real columns, the exact
 * "Add New Passenger" affordance the canonical reference itself shows.
 */
export async function addPassengerAction(
  _prevState: AddPassengerActionState,
  formData: FormData,
): Promise<AddPassengerActionState> {
  const displayName = stringField(formData, "displayName");
  const phone = stringField(formData, "phone");

  if (!displayName) {
    return { status: "error" };
  }

  const pathname = await getCurrentPathname("/operations/trips/new");
  const organization = await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("passengers")
    .insert({
      organization_id: organization.organizationId,
      display_name: displayName,
      phone: phone ?? null,
    })
    .select("id, display_name, phone")
    .single();

  if (error || !data) {
    return { status: "error" };
  }

  return {
    status: "success",
    passenger: { id: data.id, displayName: data.display_name, phone: data.phone },
  };
}
