import "server-only";
import { redirect } from "next/navigation";
import { requireUser } from "./session";
import { resolveOrganizationContext } from "./organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { DriverAccessResult, OrganizationContext } from "./types";

const OPERATIONS_ROLES = new Set(["organization_admin", "dispatcher"]);

function selectOrganizationRedirect(currentPath: string): never {
  redirect(`/select-organization?next=${encodeURIComponent(currentPath)}`);
}

/**
 * Route guard for /operations/*. Narrow and single-purpose (work item
 * §29 — not a giant `authorizeEverything()`): resolves auth, then
 * organization context, then checks the role for THAT organization only.
 * A Driver Membership is redirected to /driver rather than a bare denial
 * — the "wrong surface for this role" case, not "no access at all"
 * (work item §24).
 *
 * This narrows navigation for UX only — it does not replace RLS/RPC
 * authorization (work item §30). Every data read/write this route
 * eventually performs is still independently enforced by the database.
 */
export async function requireOperationsAccess(currentPath: string): Promise<OrganizationContext> {
  await requireUser(`/sign-in?next=${encodeURIComponent(currentPath)}`);

  const resolution = await resolveOrganizationContext();

  if (resolution.status === "none") {
    // P1-E4-S0A1 §6: routes through the same pending-signup/invite
    // continuation as root `/` — not straight to `/access-unavailable` —
    // so a deep link (a bookmark, a previously-open tab) reached BEFORE
    // ever visiting `/` doesn't strand a person whose signup/invite has
    // never actually been completed yet. `/complete-signup` itself falls
    // through to `/access-unavailable` if there is genuinely nothing to
    // complete — this is a strict superset of the previous behavior, not
    // a weaker one.
    redirect("/complete-signup");
  }
  if (resolution.status === "select-required") {
    selectOrganizationRedirect(currentPath);
  }

  const { context } = resolution;
  if (!OPERATIONS_ROLES.has(context.role)) {
    if (context.role === "driver") {
      redirect("/driver");
    }
    redirect("/access-unavailable");
  }

  return context;
}

/**
 * Route guard for /operations/settings/* (P1-PILOT-S4B-R4A). Settings is
 * tenant ADMINISTRATION, not operations: only an Organization Admin of the
 * resolved workspace passes. A Dispatcher is sent back to /operations (the
 * surface their role owns), a Driver to /driver (via
 * requireOperationsAccess), exactly as for any other out-of-role route.
 * Every Settings mutation calls this again itself -- hiding the sidebar
 * link is convenience, not authorization -- and the database
 * (`update_organization_settings`) enforces Organization Admin
 * independently of this guard.
 */
export async function requireOrganizationAdminAccess(currentPath: string): Promise<OrganizationContext> {
  const context = await requireOperationsAccess(currentPath);
  if (context.role !== "organization_admin") {
    redirect("/operations");
  }
  return context;
}

/**
 * Route guard for /onboarding/* (P1-E3-S9). Deliberately reuses the exact
 * same resolution/role logic as `requireOperationsAccess` rather than a
 * separate "just signed up" concept — a brand-new organization's creator
 * already has exactly one active Membership (organization_admin) the
 * instant `signup_create_organization` returns, so the ordinary
 * single-Membership auto-resolution in `resolveOrganizationContext`
 * already does the right thing with no special-casing.
 */
export async function requireOnboardingAccess(currentPath: string): Promise<OrganizationContext> {
  await requireUser(`/sign-in?next=${encodeURIComponent(currentPath)}`);

  const resolution = await resolveOrganizationContext();

  if (resolution.status === "none") {
    // P1-E4-S0A1 §6 — same reasoning as requireOperationsAccess above.
    redirect("/complete-signup");
  }
  if (resolution.status === "select-required") {
    selectOrganizationRedirect(currentPath);
  }

  const { context } = resolution;
  if (!OPERATIONS_ROLES.has(context.role)) {
    if (context.role === "driver") {
      redirect("/driver");
    }
    redirect("/access-unavailable");
  }

  return context;
}

/**
 * Route guard for /driver/*. Same auth/org-context resolution as
 * Operations, then requires role=driver for the resolved organization,
 * then confirms a genuinely linked, active Driver record by calling the
 * SAME `driver_get_profile` RPC the secure read API already uses
 * (docs/data/read-api.md) — re-deriving that check in TypeScript would
 * duplicate, and risk drifting from, the database's own authoritative
 * current_driver_id() logic (work item §30). A Membership with role=driver
 * but no resolvable Driver row does NOT redirect (redirecting back into
 * /driver's own guard would loop, work item §60) — it returns a
 * discriminated "link-missing" result so the layout can render a safe,
 * non-crashing account-configuration state inline instead.
 *
 * P1-E3-S9 (work item §4, Owner-Operator Mode): an organization_admin or
 * dispatcher who has ALSO linked themselves as a Driver in this same
 * organization (`link_self_as_driver`/`redeem_driver_invite`) may reach
 * /driver/* too — this is a NAVIGATION relaxation only, not a security
 * one. The actual data access this route eventually performs is still
 * gated entirely by `driver_get_profile`/`current_driver_id()` resolving
 * from the real `drivers` table (organization_id + user_id + status —
 * never Membership.role), exactly as before; this guard simply stops
 * redirecting a dual-hat person away before that check ever runs.
 * Operations authorization (Membership.role) is completely untouched —
 * an Operations-role person with NO linked Driver row is redirected to
 * /operations exactly as before, unchanged.
 */
export async function requireDriverAccess(currentPath: string): Promise<DriverAccessResult> {
  await requireUser(`/sign-in?next=${encodeURIComponent(currentPath)}`);

  const resolution = await resolveOrganizationContext();

  if (resolution.status === "none") {
    // P1-E4-S0A1 §6/§7 — same reasoning as requireOperationsAccess above;
    // this is also the path a Driver invitee's deep link into /driver/*
    // (e.g. a bookmarked /join/[token] tab reloaded after confirming)
    // would hit before their invite is redeemed.
    redirect("/complete-signup");
  }
  if (resolution.status === "select-required") {
    selectOrganizationRedirect(currentPath);
  }

  const { context } = resolution;
  const isOperationsRole = OPERATIONS_ROLES.has(context.role);
  if (context.role !== "driver" && !isOperationsRole) {
    redirect("/access-unavailable");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("driver_get_profile", {
    p_organization_id: context.organizationId,
  });

  if (error || !data || !data.driver_id || !data.display_name) {
    // An Operations-role person with no linked Driver row has no reason
    // to be here at all (unlike a pure Driver Membership with a missing
    // link, which is a real account-setup gap worth showing inline) —
    // send them back to their real home surface.
    if (isOperationsRole) {
      redirect("/operations");
    }
    return { status: "link-missing", organization: context };
  }

  return {
    status: "ok",
    organization: context,
    driverId: data.driver_id,
    displayName: data.display_name,
    phone: data.phone,
    driverStatus: data.status,
  };
}
