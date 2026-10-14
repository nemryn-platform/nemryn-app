import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { grantVersionToken, parseGrantAccess, type PlusTeamMember } from "./team-access-core";

/**
 * Staff of the organization with their Core role and ACTIVE Nemryn Plus grant (NP-P1-S3). Organization Admin only,
 * while Plus is write or read_only -- enforced by `plus_list_member_access` itself with the caller's own session
 * (never the service-role client). Drivers are never listed. Throws on error so the page shows its error state.
 */
export async function listPlusTeamAccess(organizationId: string): Promise<PlusTeamMember[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("plus_list_member_access", { p_organization_id: organizationId });
  if (error) throw new Error("Failed to load Nemryn Plus team access");

  return (data ?? [])
    .filter((row) => row.role === "organization_admin" || row.role === "dispatcher")
    .map((row) => ({
      handle: row.membership_id,
      name: row.display_name?.trim() || row.email.split("@")[0],
      email: row.email,
      role: row.role as PlusTeamMember["role"],
      isActive: row.status === "active",
      isSelf: row.is_self,
      access: parseGrantAccess(row.access),
      grantToken: grantVersionToken(row.grant_id),
    }));
}
