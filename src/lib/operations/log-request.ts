import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { NewTripPassengerOption } from "./new-trip-options";

/**
 * Server-side data access boundary for Log Request (P1-E1-S2C) —
 * organization-scoped, explicit columns, no `select("*")`, no service
 * role. Exactly one option list: active Passengers, for the optional
 * "link an existing passenger" affordance — Log Request has no
 * Facility/Request pickers (unlike New Trip), since logging demand
 * never involves either.
 *
 * Reuses `NewTripPassengerOption`'s shape directly (id/displayName/phone)
 * rather than declaring a parallel, identical type — the same passenger
 * option shape New Trip's own Combobox already consumes, and the same
 * underlying query shape (`new-trip.ts`'s own passenger query), so the
 * two features stay consistent without duplicating either the type or
 * the query pattern.
 */
export interface LogRequestFormData {
  passengers: NewTripPassengerOption[];
}

export async function getLogRequestFormData(organizationId: string): Promise<LogRequestFormData> {
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

  const passengers: NewTripPassengerOption[] = (data ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
    phone: p.phone,
  }));

  return { passengers };
}
