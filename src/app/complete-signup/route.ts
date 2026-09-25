import { NextResponse, type NextRequest } from "next/server";
import { resolveOrganizationContext } from "@/lib/auth/organization";
import { isPlatformAdmin } from "@/lib/auth/platform";
import { getSuspendedOrganizationNames } from "@/lib/auth/membership";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * P1-E4-S0A1 §5/§6/§7/§9 — the one authoritative continuation point for
 * every "authenticated, zero Membership yet" arrival, regardless of HOW a
 * real session first came to exist (a manual `/sign-in` submission, or —
 * the actual cloud reproduction this phase fixes — Supabase's own email
 * confirmation link establishing a session directly, never touching the
 * sign-in Server Action at all). `/` routes every such visitor here
 * instead of straight to `/access-unavailable`.
 *
 * A Route Handler, deliberately NOT a Server Component page: an earlier
 * version of this fix put the exact same logic in `page.tsx` and found,
 * via live local testing (not assumed), that a Next.js Server Component's
 * OWN `redirect()` call — issued from a chained client-router navigation,
 * AFTER an internal `await` for the mutating RPC — was silently not
 * followed by the browser, even though the mutation itself succeeded
 * server-side every time (confirmed directly against the database: the
 * Organization/Membership were correctly created; only the client's
 * on-screen URL never advanced past `/complete-signup`, until a hard
 * reload of that same URL then correctly redirected onward). A Route
 * Handler always returns a REAL HTTP redirect response with a `Location`
 * header — the well-trodden path Next.js's own client-side fetch-based
 * navigation is built to follow — instead of an RSC-payload-embedded
 * soft redirect nested inside an already-redirect-triggered render.
 *
 * Order of checks:
 *   1. Already has a Membership? (idempotent re-visit, OR a race with a
 *      concurrent duplicate request to this SAME route — genuinely
 *      observed locally: Next.js's dev-mode navigation can fire two GET
 *      requests for one redirect chain, and the second sees the first's
 *      already-committed org). Deciding "onboarding vs. operations"
 *      purely from "did *this* request create it" is therefore not
 *      robust. P1-OPS-PROG3B retired the business_stage size question, so
 *      an existing Membership now always resolves to its real home
 *      (/operations or /driver); in such a race the second request lands
 *      in Operations, where a fresh organization's Overview shows its
 *      current timezone with "Review business basics".
 *   2. A pending Driver invite token in their own account metadata? —
 *      redeem it. Success → /driver. Failure (revoked/stale/foreign) →
 *      /access-unavailable — deliberately NEVER routed to the operator
 *      organization-creation form (§7's own explicit "do not accidentally
 *      route Driver invitees into operator organization creation").
 *   3. Pending operator full name/business name in metadata? — complete
 *      automatically, silently, exactly once. → /onboarding/basics.
 *   4. Nothing traceable at all (the real-world case §9 exists for: an
 *      account created before this fix existed, whose signUp() call
 *      never persisted any pending metadata) — send to the explicit,
 *      user-initiated recovery form at /complete-signup/form. Never a
 *      manual database edit; never silent/automatic.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;

  // Inline auth check (not the shared `requireUser` helper, which calls
  // `next/navigation`'s `redirect()` — built for Server Component/Server
  // Action rendering, not a Route Handler; `NextResponse.redirect` is the
  // correct primitive here).
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", origin));
  }

  const initialResolution = await resolveOrganizationContext();
  if (initialResolution.status === "select-required") {
    return NextResponse.redirect(new URL("/select-organization", origin));
  }
  if (initialResolution.status !== "none") {
    const { role } = initialResolution.context;
    return NextResponse.redirect(new URL(role === "driver" ? "/driver" : "/operations", origin));
  }

  // R4E: zero ACTIVE workspaces is not always "nothing to complete". A Nemryn
  // Platform Admin (PlatformAdminGrant, no Membership) belongs in the control
  // plane; a member whose only workspace Nemryn has suspended is told that
  // below -- never offered organization creation.
  if (await isPlatformAdmin()) {
    return NextResponse.redirect(new URL("/platform", origin));
  }
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const pendingInviteToken =
    typeof metadata.pending_driver_invite_token === "string" ? metadata.pending_driver_invite_token : undefined;

  if (pendingInviteToken) {
    const { error } = await supabase.rpc("redeem_driver_invite", { p_token: pendingInviteToken });
    if (!error) {
      // Parity with the operator-signup continuation: `/join/[token]`'s
      // own pre-confirmation `user_profiles` upsert silently fails (no
      // session yet to satisfy `user_profiles_insert_own`'s self-only
      // RLS check) — this is the first point a real session exists, so
      // it's retried here from the same persisted metadata. Best-effort:
      // `drivers.display_name` (set by redeem_driver_invite itself, from
      // the invite's own admin-specified name) is the Driver-facing
      // source of truth regardless of whether this succeeds.
      const pendingFullName = typeof metadata.pending_full_name === "string" ? metadata.pending_full_name : undefined;
      if (pendingFullName) {
        await supabase.from("user_profiles").upsert({ id: user.id, display_name: pendingFullName });
      }
      return NextResponse.redirect(new URL("/driver", origin));
    }
    return NextResponse.redirect(new URL("/access-unavailable", origin));
  }

  // P1-PILOT-S4B-R4C: a pending STAFF invitation (team invite signup that had
  // to cross an email-confirmation boundary) takes precedence over fresh-
  // organization creation, exactly like the Driver invite above. Success goes
  // to "/" (which resolves the right destination for the invited role); any
  // failure (cancelled / expired / used / foreign) goes to /access-unavailable
  // -- NEVER to the operator organization-creation form. The team-invite
  // signup never persists pending_business_name, so complete_pending_signup
  // below can not create an organization for such a person either.
  const pendingStaffToken =
    typeof metadata.pending_staff_invite_token === "string" ? metadata.pending_staff_invite_token : undefined;
  if (pendingStaffToken) {
    const { error } = await supabase.rpc("accept_staff_invite", { p_token: pendingStaffToken });
    if (!error) {
      const pendingFullName = typeof metadata.pending_full_name === "string" ? metadata.pending_full_name : undefined;
      if (pendingFullName) {
        await supabase.from("user_profiles").upsert({ id: user.id, display_name: pendingFullName });
      }
      return NextResponse.redirect(new URL("/", origin));
    }
    return NextResponse.redirect(new URL("/access-unavailable", origin));
  }

  // (After any pending invitation above, which may legitimately grant a NEW workspace.)
  if ((await getSuspendedOrganizationNames()).length > 0) {
    return NextResponse.redirect(new URL("/access-unavailable", origin));
  }

  const { data: continuation } = await supabase.rpc("complete_pending_signup");
  if (continuation?.created) {
    return NextResponse.redirect(new URL("/onboarding/basics", origin));
  }

  return NextResponse.redirect(new URL("/complete-signup/form", origin));
}
