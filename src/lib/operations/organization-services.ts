import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The organization's enabled canonical service types (Organization Admin
 * only, enforced by the database). An empty list means the organization has
 * never explicitly configured its offerings.
 */
export async function getServiceOfferings(organizationId: string): Promise<string[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_organization_service_offerings", { p_organization_id: organizationId });
  if (error) throw new Error("Failed to load service offerings");
  return data ?? [];
}
