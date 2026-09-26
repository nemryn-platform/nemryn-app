"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsAccess, requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { availabilityErrorMessage, windowInputToUtc, type WindowFormInput } from "@/lib/operations/availability";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface VehicleActionState {
  status: "idle" | "success" | "error";
  vehicle?: { id: string; label: string; status: string };
}

/**
 * Vehicle create/edit (P1-E3-S9, work item §7 — closes GAP-14). A direct,
 * RLS-protected `vehicles` INSERT/UPDATE, not an RPC — `vehicles_insert_
 * org_admin`/`_update_org_admin` were already confirmed safe (org+role-
 * scoped, and the only mutable columns are `label`/`status`) before this
 * phase built anything against them (ui-backend-gap-register.md GAP-14).
 * Only real schema fields — never a fabricated wheelchair/stretcher/
 * ambulatory capability column (work item §7's own explicit prohibition;
 * `vehicles` genuinely has no such columns).
 *
 * P1-OPS-PROG5B permission alignment: vehicle create / label / status edits
 * are Organization Admin only (requireOrganizationAdminAccess), matching
 * the RLS that already allowed only the Organization Admin to write
 * `vehicles` (a Dispatcher's attempt previously failed at the database).
 * Database authority is unchanged.
 */
export async function createVehicleAction(
  _prevState: VehicleActionState,
  formData: FormData,
): Promise<VehicleActionState> {
  const label = formData.get("label");
  if (typeof label !== "string" || label.trim().length === 0) {
    return { status: "error" };
  }

  const pathname = await getCurrentPathname("/operations/fleet");
  const organization = await requireOrganizationAdminAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vehicles")
    .insert({ organization_id: organization.organizationId, label: label.trim() })
    .select("id, label, status")
    .single();

  if (error || !data) {
    return { status: "error" };
  }

  revalidatePath("/operations/fleet");
  return { status: "success", vehicle: data };
}

export async function updateVehicleAction(
  _prevState: VehicleActionState,
  formData: FormData,
): Promise<VehicleActionState> {
  const vehicleId = formData.get("vehicleId");
  const label = formData.get("label");
  const status = formData.get("status");

  if (typeof vehicleId !== "string" || typeof label !== "string" || label.trim().length === 0) {
    return { status: "error" };
  }
  if (status !== "active" && status !== "inactive") {
    return { status: "error" };
  }

  const pathname = await getCurrentPathname("/operations/fleet");
  await requireOrganizationAdminAccess(pathname);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vehicles")
    .update({ label: label.trim(), status })
    .eq("id", vehicleId)
    .select("id, label, status")
    .single();

  if (error || !data) {
    return { status: "error" };
  }

  revalidatePath("/operations/fleet");
  return { status: "success", vehicle: data };
}

// =============================================================================
// P1-OPS-PROG5B -- recorded equipment (Organization Admin ONLY) + out-of-service windows (Admin / Dispatcher)
// =============================================================================

export type FleetAvailabilityResult = { ok: true } | { ok: false; message: string };

export async function saveVehicleCapabilitiesAction(
  vehicleId: string,
  input: { wheelchairRamp: boolean | null; wheelchairLift: boolean | null; wheelchairPositions: number | null; seatedCapacity: number | null },
): Promise<FleetAvailabilityResult> {
  await requireOrganizationAdminAccess(await getCurrentPathname("/operations/fleet"));
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("set_vehicle_capabilities", {
    p_vehicle_id: vehicleId,
    // NULL = not recorded (the generated types do not model the nullable arguments).
    p_wheelchair_ramp: input.wheelchairRamp as boolean,
    p_wheelchair_lift: input.wheelchairLift as boolean,
    p_wheelchair_positions: input.wheelchairPositions as number,
    p_seated_capacity: input.seatedCapacity as number,
  });
  if (error) return { ok: false, message: availabilityErrorMessage(error.code) };
  revalidatePath("/operations/fleet");
  revalidatePath("/operations/dispatch");
  revalidatePath("/operations/tomorrow");
  return { ok: true };
}

export async function saveVehicleOutOfServiceAction(vehicleId: string, windowId: string | null, input: WindowFormInput): Promise<FleetAvailabilityResult> {
  const organization = await requireOperationsAccess(await getCurrentPathname("/operations/fleet"));
  const range = windowInputToUtc(input, organization.organizationTimezone);
  if (!range) return { ok: false, message: "Those times aren't valid (check the dates and times)." };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("save_vehicle_unavailability", {
    p_vehicle_id: vehicleId,
    p_starts_at: range.startsAt,
    p_ends_at: range.endsAt,
    ...(windowId ? { p_window_id: windowId } : {}),
  });
  if (error) return { ok: false, message: availabilityErrorMessage(error.code) };
  revalidatePath("/operations/fleet");
  revalidatePath("/operations/dispatch");
  revalidatePath("/operations/tomorrow");
  return { ok: true };
}

export async function deleteVehicleOutOfServiceAction(windowId: string): Promise<FleetAvailabilityResult> {
  await requireOperationsAccess(await getCurrentPathname("/operations/fleet"));
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("delete_vehicle_unavailability", { p_window_id: windowId });
  if (error) return { ok: false, message: availabilityErrorMessage(error.code) };
  revalidatePath("/operations/fleet");
  revalidatePath("/operations/dispatch");
  revalidatePath("/operations/tomorrow");
  return { ok: true };
}
