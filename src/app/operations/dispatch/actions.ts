"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { DispatchErrorCode } from "@/lib/operations/dispatch-errors";
import { callAssignmentRpc } from "@/lib/operations/assignment-mutation";
import { getAssignmentOverlap, type AssignmentOverlapView } from "@/lib/operations/trip-overlap";
import { getDriverDayContext, type DriverDayContext, type DriverDayTarget } from "@/lib/operations/assignment-context";

export interface AssignmentActionState {
  status: "idle" | "success" | "error";
  errorCode?: DispatchErrorCode;
  changed?: boolean;
}

const ALLOWED_MODES = new Set(["assign", "reassign"]);

/**
 * The one Server Action behind both the Assign and Reassign dialogs
 * (P1-E3-S5) — mirrors `progressTripAction`'s established shape
 * (src/app/driver/trips/[tripId]/actions.ts): re-derives authorization
 * fresh on every call via `requireOperationsAccess` (never trusts the
 * page render, never trusts a client-supplied organization id), validates
 * every field from `FormData` defensively, calls the real RPC, maps any
 * error to a narrow user-safe code, and revalidates the real routes this
 * mutation affects.
 *
 * `mode` selects `assign_trip` vs `reassign_trip` — a fixed 2-value
 * allowlist, not a caller-supplied RPC name (same discipline as
 * `ALLOWED_RPCS` in the Driver action). Neither RPC is ever called with
 * anything other than its own real, inspected parameter names.
 */
export async function assignmentAction(
  _prevState: AssignmentActionState,
  formData: FormData,
): Promise<AssignmentActionState> {
  const mode = formData.get("mode");
  const tripId = formData.get("tripId");
  const driverId = formData.get("driverId");
  const vehicleIdRaw = formData.get("vehicleId");
  const reasonRaw = formData.get("reason");
  const expectedAssignmentIdRaw = formData.get("expectedAssignmentId");

  if (typeof mode !== "string" || !ALLOWED_MODES.has(mode)) {
    return { status: "error", errorCode: "UNKNOWN" };
  }
  if (typeof tripId !== "string" || tripId.length === 0) {
    return { status: "error", errorCode: "NOT_FOUND" };
  }
  if (typeof driverId !== "string" || driverId.length === 0) {
    return { status: "error", errorCode: "INVALID_DRIVER_OR_VEHICLE" };
  }

  const vehicleId = typeof vehicleIdRaw === "string" && vehicleIdRaw.length > 0 ? vehicleIdRaw : undefined;
  const reason = typeof reasonRaw === "string" && reasonRaw.trim().length > 0 ? reasonRaw.trim() : undefined;
  // P1-E3-S5A: the assignment the Dispatcher actually reviewed, forwarded
  // as-is to reassign_trip's own p_expected_assignment_id precondition —
  // this Server Action does not itself compare it against anything; the
  // RPC, under its own row lock, is the sole authority on whether it still
  // matches the active assignment (never trusted "by itself", work item §7).
  const expectedAssignmentId =
    typeof expectedAssignmentIdRaw === "string" && expectedAssignmentIdRaw.length > 0
      ? expectedAssignmentIdRaw
      : undefined;

  const pathname = await getCurrentPathname("/operations/dispatch");
  // Re-derived fresh, every call — an inactive Membership, a role change,
  // or a foreign-org attempt is caught HERE, not assumed from how the
  // page happened to render (work item §61/§62/§63).
  await requireOperationsAccess(pathname);

  const supabase = await createServerSupabaseClient();

  // P1-OPS-PROG2: the same single RPC call path New Trip "Assign now" uses.
  const result = await callAssignmentRpc(supabase, {
    mode: mode === "assign" ? "assign" : "reassign",
    tripId,
    driverId,
    vehicleId,
    reason,
    expectedAssignmentId,
  });

  if (!result.ok) {
    return { status: "error", errorCode: result.errorCode };
  }

  revalidatePath("/operations/dispatch");
  revalidatePath("/operations");
  revalidatePath("/operations/tomorrow");
  revalidatePath(`/operations/trips/${tripId}`);

  return { status: "success", changed: result.changed };
}

/**
 * P1-OPS-PROG1 driver-day context -- a READ only, for the one Driver the
 * operator selected in the Assign/Reassign dialog (or New Trip's "Assign
 * now"). Authorization is re-derived here exactly as for the mutation
 * above; the organization and its timezone come from the server-resolved
 * context, never the browser, and the read itself is a session-client
 * (RLS) query filtered to that organization. Writes nothing.
 *
 * `target` is either an existing Trip (its own org-local day, itself
 * excluded) or, for New Trip (P1-OPS-PROG2), the chosen org-local pickup
 * date as YYYY-MM-DD.
 */
export async function driverDayContextAction(target: unknown, driverId: unknown): Promise<DriverDayContext> {
  if (typeof driverId !== "string" || !isDriverDayTarget(target)) return { status: "unavailable" };
  const pathname = await getCurrentPathname("/operations/dispatch");
  const organization = await requireOperationsAccess(pathname);
  try {
    return await getDriverDayContext(organization.organizationId, organization.organizationTimezone, target, driverId);
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * P1-OPS-PROG4 overlap facts for the Assign / Reassign dialog and New Trip "Assign now": the target (a Trip, or a
 * New Trip's date + time + duration) against the selected driver / vehicle. A READ only -- the assignment RPCs
 * never consult it; overlap is a warning, confirmation always stays available.
 */
export async function assignmentOverlapAction(target: unknown, driverId: unknown, vehicleId: unknown): Promise<AssignmentOverlapView | null> {
  if (!isDriverDayTarget(target)) return null;
  const driver = typeof driverId === "string" && driverId.length > 0 ? driverId : null;
  const vehicle = typeof vehicleId === "string" && vehicleId.length > 0 ? vehicleId : null;
  if (!driver && !vehicle) return null;
  const pathname = await getCurrentPathname("/operations/dispatch");
  const organization = await requireOperationsAccess(pathname);
  try {
    return await getAssignmentOverlap(organization.organizationId, organization.organizationTimezone, target, driver, vehicle);
  } catch {
    return null;
  }
}

function isDriverDayTarget(value: unknown): value is DriverDayTarget {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.kind === "trip" && typeof v.tripId === "string") || (v.kind === "date" && typeof v.dateKey === "string");
}
