import "server-only";
import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildGettingStarted, type GettingStarted, type SetupFacts } from "./getting-started-core";

export type { GettingStarted, SetupStep } from "./getting-started-core";

/**
 * Live workspace facts for the Getting started checklist (P1-E3-S9, extended in NP-PILOT-P2). Every fact is a real
 * read with the caller's own client (RLS + RPC role checks) -- never a stored "X% complete" value. Each read fails on
 * its own: a failed or forbidden read becomes `null` (the step makes no claim) instead of failing the page.
 * Admin-only lists (team members, staff invitations) are read only for an Organization Admin.
 *
 * Cached per request (React cache) so the Operations layout (sidebar entry) and the Operations Brief (banner) share
 * one set of reads.
 */
export const getGettingStarted = cache(async (organizationId: string, isAdmin: boolean, growth: boolean): Promise<GettingStarted> => {
  const supabase = await createServerSupabaseClient();
  const counted = ({ count: n, error }: { count: number | null; error: unknown }) => (error ? null : (n ?? 0));
  const count = async (table: "vehicles" | "facilities" | "passengers" | "trips" | "transportation_requests" | "plus_contacts" | "plus_quotes") =>
    counted(await supabase.from(table).select("id", { count: "exact", head: true }).eq("organization_id", organizationId));
  const activeDriverCount = async () =>
    counted(await supabase.from("drivers").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "active"));

  const [org, services, vehicles, activeDrivers, facilities, passengers, trips, requests, team, growthContacts, growthQuotes] = await Promise.all([
    supabase.from("organizations").select("business_phone, business_address").eq("id", organizationId).maybeSingle(),
    supabase.rpc("get_organization_service_offerings", { p_organization_id: organizationId }),
    count("vehicles"),
    activeDriverCount(),
    count("facilities"),
    count("passengers"),
    count("trips"),
    count("transportation_requests"),
    isAdmin
      ? Promise.all([
          supabase.rpc("list_team_members", { p_organization_id: organizationId }),
          supabase.rpc("list_staff_invites", { p_organization_id: organizationId }),
        ])
      : Promise.resolve(null),
    growth ? count("plus_contacts") : Promise.resolve(null),
    growth ? count("plus_quotes") : Promise.resolve(null),
  ]);

  let otherActiveStaff: number | null = null;
  let pendingStaffInvites: number | null = null;
  if (team) {
    const [members, invites] = team;
    if (!members.error) otherActiveStaff = (members.data ?? []).filter((m) => !m.is_self && m.status === "active" && m.role !== "driver").length;
    if (!invites.error) pendingStaffInvites = (invites.data ?? []).filter((i) => i.status !== "expired" && i.role !== "driver").length;
  }

  const facts: SetupFacts = {
    isAdmin,
    growth,
    business: org.error || !org.data ? null : { phone: org.data.business_phone, address: org.data.business_address },
    services: services.error ? null : (services.data ?? []).length,
    vehicles,
    activeDrivers,
    facilities,
    passengers,
    trips,
    requests,
    otherActiveStaff,
    pendingStaffInvites,
    growthContacts,
    growthQuotes,
  };
  return buildGettingStarted(facts);
});
