import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "./session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Nemryn Platform Admin authority (P1-PILOT-S4B-R4E). Established ONLY by a
 * PlatformAdminGrant, evaluated live in the database by `is_platform_admin()`.
 * It is deliberately independent of Membership: an Organization Admin,
 * Dispatcher or Driver without a grant is not a Platform Admin, and a Platform
 * Admin without a Membership has no tenant authority at all. This function
 * answers exactly one question and never widens any tenant access.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  return !error && data === true;
}

/**
 * Route guard for /platform/* and every platform Server Action. Unauthenticated
 * -> sign-in (preserving the destination). Authenticated without a
 * PlatformAdminGrant -> 404: the control plane is not advertised to tenant
 * users, and a tenant user learns nothing about it. The database independently
 * enforces the same rule inside every platform function (ZW002), so this guard
 * is navigation, not the security boundary.
 */
export async function requirePlatformAdminAccess(currentPath: string) {
  const user = await requireUser(`/sign-in?next=${encodeURIComponent(currentPath)}`);
  if (!(await isPlatformAdmin())) {
    notFound();
  }
  return user;
}
