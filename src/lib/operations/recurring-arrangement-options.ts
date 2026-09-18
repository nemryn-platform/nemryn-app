import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { NewTripPassengerOption } from "./new-trip-options";

/**
 * Passenger options for the New/Edit Recurring Arrangement form
 * (P1-E2-S1E §9) — active Passengers only, the exact same
 * `status = 'active'` filter create_recurring_arrangement itself
 * re-validates server-side (this is a UX convenience, never the
 * authority, matching new-trip.ts's own identical convention and
 * identical reasoning for New Trip's own Passenger dropdown). Reuses
 * `NewTripPassengerOption`'s own shape rather than declaring a parallel
 * one-field-different type.
 */
export async function getActivePassengerOptions(organizationId: string): Promise<NewTripPassengerOption[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("passengers")
    .select("id, display_name, phone")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("display_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load passenger options: ${error.message}`);
  }

  return (data ?? []).map((p) => ({ id: p.id, displayName: p.display_name, phone: p.phone }));
}
