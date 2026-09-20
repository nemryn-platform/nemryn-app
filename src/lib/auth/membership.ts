import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getUser } from "./session";
import type { ActiveMembership, MembershipRole } from "./types";

interface MembershipRow {
  organization_id: string;
  role: MembershipRole;
  organizations: OrganizationJoin | OrganizationJoin[] | null;
}

interface OrganizationJoin {
  name: string;
  timezone: string;
  status: string;
}

/**
 * Live-resolved active Memberships for the CURRENT USER, straight from the
 * database — never cached across requests, never derived from a JWT claim
 * (work item §5/§16, ZD-077's live-check principle applied at the
 * application layer).
 *
 * The `user_id` filter below is explicit and load-bearing, not merely
 * defensive: `memberships` carries a SECOND applicable RLS policy,
 * `memberships_select_org_admin`, which legitimately lets an
 * organization_admin see every membership row in their own organization
 * (their team), additively alongside `memberships_select_self` (RLS
 * policies OR together, they don't narrow each other). Querying this
 * table with only `.eq("status", "active")` and no `user_id` filter — as
 * an earlier version of this function did — silently returns every active
 * Membership in any organization the caller administers, not just their
 * own, for an org_admin caller specifically. That is completely correct
 * behavior for a future "manage my team" screen, and exactly wrong for
 * resolving "which of MY OWN organizations do I have access to" here —
 * caught by `docs/security/application-auth-test-matrix.md` ROLE-1 during
 * this phase's own integration testing, not assumed safe from RLS alone
 * (work item §17's own caution, applied to a subtler case than a simple
 * denial).
 */
export async function getActiveMemberships(): Promise<ActiveMembership[]> {
  const { active } = await getMembershipsByOrganizationStatus();
  return active;
}

/**
 * Names of organizations where the caller holds an ACTIVE Membership but Nemryn
 * has suspended the organization (R4E). Such a workspace is not operable: it is
 * excluded from `getActiveMemberships` (so it is never selectable and the
 * database helpers deny it anyway), and this is used only to explain the state
 * ("your workspace is suspended") instead of behaving like "no access at all".
 * The Membership rows themselves are untouched by suspension.
 */
export async function getSuspendedOrganizationNames(): Promise<string[]> {
  const { suspended } = await getMembershipsByOrganizationStatus();
  return suspended;
}

async function getMembershipsByOrganizationStatus(): Promise<{ active: ActiveMembership[]; suspended: string[] }> {
  const user = await getUser();
  if (!user) {
    return { active: [], suspended: [] };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("organization_id, role, organizations(name, timezone, status)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .returns<MembershipRow[]>();

  if (error) {
    throw new Error(`Failed to resolve active memberships (backend contract mismatch, not an authorization denial — RLS returns zero rows for "no access", not an error): ${error.message}`);
  }

  const active: ActiveMembership[] = [];
  const suspended: string[] = [];
  for (const row of data ?? []) {
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    // A member can read their own organization row regardless of its status
    // (organizations_select_members). An unreadable/missing join is treated as
    // not operable rather than as an active workspace.
    if (!org) continue;
    if (org.status !== "active") {
      suspended.push(org.name);
      continue;
    }
    active.push({
      organizationId: row.organization_id,
      organizationName: org.name,
      // organizations.timezone is NOT NULL at the schema level (P1-E3-S2C)
      // -- this fallback exists only so a malformed/partial join can never
      // silently produce `undefined` here; it is not an expected runtime path.
      organizationTimezone: org.timezone ?? "UTC",
      role: row.role,
    });
  }
  return { active, suspended };
}
