import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isStaffRole, type InvitationStatus, type StaffRole } from "./team-core";

export interface TeamMember {
  /** Opaque management handle -- posted back to the server actions, never displayed. */
  handle: string;
  name: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
  joinedAt: string;
  isSelf: boolean;
}

export interface StaffInvitation {
  /** Opaque management handle -- never displayed. */
  handle: string;
  email: string;
  role: StaffRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

/** Staff Memberships of the caller's organization (Organization Admin only, enforced by the database). Drivers are not staff and are never listed. */
export async function listTeamMembers(organizationId: string): Promise<TeamMember[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_team_members", { p_organization_id: organizationId });
  if (error) throw new Error("Failed to load team members");

  return (data ?? [])
    .filter((row) => isStaffRole(row.role))
    .map((row) => ({
      handle: row.membership_id,
      name: row.display_name?.trim() || row.email.split("@")[0],
      email: row.email,
      role: row.role as StaffRole,
      isActive: row.status === "active",
      joinedAt: row.joined_at,
      isSelf: row.is_self,
    }));
}

/** Pending (or expired-pending) invitations. No token material is ever returned. */
export async function listStaffInvitations(organizationId: string): Promise<StaffInvitation[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_staff_invites", { p_organization_id: organizationId });
  if (error) throw new Error("Failed to load invitations");

  return (data ?? [])
    .filter((row) => isStaffRole(row.role))
    .map((row) => ({
      handle: row.id,
      email: row.email,
      role: row.role as StaffRole,
      status: row.status === "expired" ? ("expired" as const) : ("pending" as const),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
}
