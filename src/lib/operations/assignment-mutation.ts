import "server-only";
import type { createServerSupabaseClient } from "@/lib/supabase/server";
import { mapDispatchError, type DispatchErrorCode } from "./dispatch-errors";

export interface AssignmentCall {
  mode: "assign" | "reassign";
  tripId: string;
  driverId: string;
  vehicleId?: string;
  reason?: string;
  expectedAssignmentId?: string;
}

export type AssignmentCallResult = { ok: true; changed: boolean } | { ok: false; errorCode: DispatchErrorCode };

/**
 * The ONE place `assign_trip` / `reassign_trip` are called from the app
 * (P1-OPS-PROG2 extraction of the P1-E3-S5 Server Action body): the
 * Assign/Reassign dialog's `assignmentAction` and New Trip's "Assign now"
 * both go through here, so there is still a single assignment mutation
 * path. `mode` is a fixed two-value choice, never a caller-supplied RPC
 * name. Callers MUST have re-derived Operations authorization first; the
 * RPCs re-validate everything (organization, active Driver/Vehicle,
 * assignable state, one active assignment, expected assignment).
 */
export async function callAssignmentRpc(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  call: AssignmentCall,
): Promise<AssignmentCallResult> {
  const { data, error } =
    call.mode === "assign"
      ? await supabase.rpc("assign_trip", {
          p_trip_id: call.tripId,
          p_driver_id: call.driverId,
          p_vehicle_id: call.vehicleId,
        })
      : await supabase.rpc("reassign_trip", {
          p_trip_id: call.tripId,
          p_driver_id: call.driverId,
          p_vehicle_id: call.vehicleId,
          p_reason: call.reason,
          p_expected_assignment_id: call.expectedAssignmentId,
        });
  if (error) return { ok: false, errorCode: mapDispatchError(error.code) };
  return { ok: true, changed: data?.changed ?? false };
}
