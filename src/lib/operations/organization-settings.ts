import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface OrganizationSettings {
  name: string;
  timezone: string;
  businessPhone: string;
  businessEmail: string;
  businessAddress: string;
  primaryContactName: string;
}

/**
 * Settings -> Organization read model (P1-PILOT-S4B-R4A). The
 * `organizationId` is ALWAYS the server-resolved workspace from
 * `requireOrganizationAdminAccess` -- never a browser-supplied value. RLS
 * (`organizations_select_members`) is an independent second scope: even a
 * wrong id here returns no row for a caller who is not a member of it.
 * Reuses the existing `organizations` columns; there is no second settings
 * table.
 */
export async function getOrganizationSettings(organizationId: string): Promise<OrganizationSettings | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("name, timezone, business_phone, business_email, business_address, primary_contact_name")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load organization settings: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  return {
    name: data.name,
    timezone: data.timezone,
    businessPhone: data.business_phone ?? "",
    businessEmail: data.business_email ?? "",
    businessAddress: data.business_address ?? "",
    primaryContactName: data.primary_contact_name ?? "",
  };
}
