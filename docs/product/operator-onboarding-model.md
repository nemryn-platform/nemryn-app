# Zenward Platform — Operator Onboarding Model

**Work item:** P1-E3-S9 — Operator Signup & Business Setup (confirmation-boundary continuation added by P1-E4-S0A1 — Cloud Signup Continuation Fix; the SSR confirmation callback itself, §4B, added by P1-E4-S0A2 — Auth Confirmation Callback Fix)
**Status:** Implemented — `/sign-up`, `/onboarding/*`, `signup_create_organization`, the onboarding checklist, (§4A) the `/complete-signup` continuation, and (§4B) `/auth/confirm` — the actual SSR endpoint the confirmation email links to, establishing the session directly (no manual sign-in required).
**Last updated:** 2026-09-03

Zenward's self-service path from "I run a transportation business" to "I have a usable, real Zenward organization" — for a 1–2 vehicle owner-operator, a growing 3–10 vehicle fleet, or an established 10+ vehicle operator alike. This document is the durable record of that design; see `docs/reports/P1-E3-S9-operator-signup-business-setup-report.txt` for the phase's verification evidence.

## 1. The flow

```
Sign Up
  → (email confirmation, only if the environment requires it — see §4/§4A)
  → Business Stage        /onboarding
  → Business Basics       /onboarding/basics
  → First Vehicle         /onboarding/vehicle          (skippable)
  → Owner-Driver choice   /onboarding/driver           (skippable)
  → First Facility        /onboarding/facility         (skippable)
  → First Passenger       /onboarding/passenger        (skippable)
  → First Trip            /operations/trips/new        (the real, existing New Trip screen — never duplicated)
  → Operations            /operations
```

Every step after Sign Up can be skipped ("Skip for now" / "Not right now") — nothing beyond the 4 fields collected at signup is mandatory. A skipped step simply leaves that item incomplete on the onboarding checklist (§3); the operator returns to it whenever they're ready, through the checklist's own links or by using the real Operations screens (Fleet/Facilities/Passengers/Drivers) directly.

## 2. Sign-up — what's collected and how it's created

**Collected:** full name, email, password, business name — exactly the 4 fields the work item specifies, nothing more.

**Created, atomically, in one transaction (`signup_create_organization`, a SECURITY DEFINER RPC — see `docs/product/onboarding-data-map.md` for the full mutation contract):**
1. The real Supabase Auth user, via `supabase.auth.signUp()` — the ordinary, already-tested auth path. Never a service-role-created account; no service-role credential is ever reachable from the browser (work item §2's own explicit requirement).
2. A `user_profiles` row (display name = the "full name" field).
3. A new `organizations` row (status `active`).
4. The signer-upper's own `memberships` row: `organization_admin`, `active`.

**Atomicity (work item §2 — "failed signup does not leave a broken partial organization/user state"):** the Postgres function body is one implicit transaction — if any step fails, all of it rolls back. The one thing that CANNOT be rolled back by this RPC is the auth user itself, since that's created by a separate, prior `signUp()` call — but that's by design, not a gap: an auth user with no organization yet is the exact same "authenticated, zero Membership" state the platform already handles safely (`/access-unavailable`), not a broken row. See ZD-193.

## 3. Business Stage — emphasis only, never security or schema

"How are you operating today?" (Starting / Growing / Established) is stored on `organizations.business_stage` — a plain, nullable, CHECK-constrained text column. It is:
- **Never** read by any RLS policy or mutation-authorization check (verified: `grep`-checked across every migration).
- **Never** a pricing input — no price is hard-coded anywhere in the application (work item §3's explicit prohibition; see `founding-operator-program.md` from P1-E3-S8C for the separate, business-side pricing conversation).
- **Never** a schema fork — STARTING/GROWING/ESTABLISHED operators use the identical tables, RLS policies, and RPCs. The only place this value currently shapes anything is the sidebar's own progressive-complexity discussion (§5) and, potentially, future presentation tuning — not built this phase beyond the "Drive" nav item (which itself derives from a real linked Driver row, not from `business_stage`).

## 4. Email verification — documented truthfully

Locally (`supabase/config.toml`, `enable_confirmations = false`), `signUp()` returns a real session immediately — no verification gate exists in this environment. The sign-up action does not assume this either way: it checks the actual `signUp()` response, and only proceeds to create the organization immediately if a real `session` came back. If a deployment enables email confirmation (Supabase Cloud's own default), the same code path correctly shows "check your email to confirm your account" instead — and the organization is created once a real session first exists, via the continuation described in §4A, not assumed to happen automatically.

## 4A. The confirmation-boundary continuation (P1-E4-S0A1)

**The gap this closes:** before this fix, `fullName`/`businessName` were only local variables inside the `/sign-up` Server Action's own single invocation. When `signUp()` returned no session (confirmation required), the action returned `needsEmailConfirmation: true` and those values were gone — nothing persisted them anywhere. The person who later confirmed their email and signed in landed on `/access-unavailable` (a real session, zero Memberships) with no way to recover their original signup at all. Found via live cloud testing against a real Supabase Cloud project, not a hypothetical — Supabase's own `enable_confirmations = false` local default meant this path was never exercised until real cloud staging was tested.

**The fix, in order:**
1. **Persist minimum signup intent safely, not authority.** `signUp()`'s `options.data` now carries `pending_full_name`/`pending_business_name` (operator signup) or `pending_driver_invite_token` (Driver invite redemption, see `docs/product/driver-invite-linkage-model.md`). Supabase persists this on the `auth.users` row itself (`raw_user_meta_data`), independent of confirmation state — this is plain display/intent data, never trusted as authorization. The role granted (`organization_admin`, always) and the organization/membership identity are still derived entirely server-side from `auth.uid()` inside SECURITY DEFINER RPCs — metadata never grants privilege by itself.
2. **One authoritative continuation route:** `/complete-signup` (`src/app/complete-signup/route.ts`) — a Route Handler, not a Server Component page. `/` (root) routes every authenticated, zero-Membership visitor here instead of straight to `/access-unavailable`, because a real session can come to exist WITHOUT the person ever submitting `/sign-in`'s own form at all: the `/auth/confirm` SSR callback (§4B — added the following phase, P1-E4-S0A2, once this exact gap was found live) establishes one directly. A check placed only inside `signInAction` would never fire for that path. `/` is the one place ALL authenticated traffic already passes through, so the continuation lives there. (An earlier draft of this point assumed Supabase's own hosted confirmation redirect could establish a session client-side via its URL fragment tokens — §4B found and corrected that assumption: no client-side code in this app ever reads that fragment, so nothing happened with it at all until `/auth/confirm` existed.)
3. **Why a Route Handler, not a page:** an earlier version of this fix put the identical logic in a Server Component page and found, via live local testing (clicking a real Mailpit-delivered confirmation link, not assumed), that a Next.js Server Component's own `redirect()` — issued from a chained client-router navigation, after an internal `await` for the mutating RPC — was silently not followed by the browser, even though the mutation succeeded server-side every time (confirmed directly against the database). A Route Handler always returns a real HTTP redirect response with a `Location` header, which Next's client-side navigation reliably follows.
4. **Exactly-once, not "whichever request got there first."** `complete_pending_signup()` (SECURITY DEFINER RPC) is idempotent by construction: a `pg_advisory_xact_lock` keyed by the caller's own `auth.uid()` serializes concurrent calls from the same person, and an existing-Membership check makes every repeat call a safe no-op. `signup_create_organization` itself stays deliberately non-idempotent (a second call is a legitimate second business — unchanged from §2); `complete_pending_signup()` is the one-shot gate in front of it, not a looser wrapper around it. A genuinely observed local race (Next.js dev-mode firing two GET requests for one navigation) confirmed this: the org/membership were created exactly once regardless, and — since routing "onboarding vs. operations" purely from "did *this specific request* create it" is not itself race-safe — the destination decision instead checks the resolved organization's own `business_stage` (still `null` only for a genuinely brand-new, never-onboarded org), so either request in such a race correctly lands the person in onboarding.
5. **Recovery for an account with no traceable metadata at all** (work item §9 — e.g. an account created before this fix existed): `complete_pending_signup_manual(full_name, business_name)` — the SAME idempotency guard, caller-supplied values instead of metadata, backing an explicit, user-initiated "Complete your organization setup" form at `/complete-signup/form`. Never a manual database edit; never silent/automatic — the person must actively submit it. `/complete-signup` (the Route Handler) only routes here after genuinely finding nothing to auto-complete.
6. **Driver invitees are never routed into operator organization creation.** `/complete-signup` checks for `pending_driver_invite_token` FIRST and returns before ever looking at operator metadata; a failed/revoked/stale invite redemption goes to `/access-unavailable`, never to the organization-creation form (see `docs/product/driver-invite-linkage-model.md` §4).

## 4B. The SSR confirmation callback — `/auth/confirm` (P1-E4-S0A2)

**The gap §4A didn't actually close:** §4A's own original design assumed clicking the confirmation email link would establish a session on its own. Live cloud testing (a real Supabase confirmation email, actually clicked) found otherwise: the person landed back on an unauthenticated state instead of `/complete-signup`. Root cause, confirmed directly (not assumed): Supabase's DEFAULT "Confirm signup" email template links via `{{ .ConfirmationURL }}`, which points at Supabase's own hosted `/auth/v1/verify?token=...&redirect_to=<Site URL>` endpoint. That endpoint verifies the token, then redirects the browser to Site URL with the new session encoded as a URL **fragment** (`#access_token=...&refresh_token=...`) — confirmed by following the exact link with `curl` and reading its `Location` header. A fragment is never sent to any server (browsers don't transmit it in the request); this application has no client-side JavaScript anywhere that reads `window.location.hash` to pick it up, so the session was never established at all — the fragment was simply discarded.

**The fix:** `/auth/confirm` (`src/app/auth/confirm/route.ts`) — a Route Handler implementing Supabase's own canonical Next.js SSR confirmation pattern. Instead of Supabase's hosted redirect, the Confirm Signup email template now links DIRECTLY to this route with `token_hash`/`type` as ordinary, server-readable query parameters (see `docs/deployment/staging-auth-configuration.md` §Required Confirm Signup email template for the exact template text). The route calls `supabase.auth.verifyOtp({ type, token_hash })` on the SERVER Supabase client — which writes the real session cookie directly into the response, via the same cookie adapter every Server Action already uses — then redirects to `/complete-signup`, which continues exactly as §4A describes. On any failure (missing params, an expired or already-used token) it redirects to `/auth/auth-code-error`, a calm, restrained retry state — never a raw Supabase error, never a stack trace. `token_hash` (a genuine, short-lived credential) is never logged anywhere in this route.

**Result — no manual sign-in required after confirmation**, for both operator signup and Driver-invite signup: clicking the email link alone now carries a person all the way to `/onboarding` (or `/driver`, for an invite) in one continuous server-side chain. Verified live, locally, with a real Mailpit-delivered email using this exact template: sign-up → "Check your email" → real link clicked (fresh browser, no prior cookies) → `/complete-signup` → `/onboarding`, zero manual steps in between. Re-verified for Driver invites the same way, landing on `/driver`. Both proven exactly-once (Organization/Membership/UserProfile each confirmed via direct database query), and proven safe against a repeat click of the same link (Supabase's own OTP tokens are single-use — a second `verifyOtp` call for the same `token_hash` fails cleanly, which the route sends to `/auth/auth-code-error` — meaning `/complete-signup` is never even reached a second time from a stale link, structurally, not just by convention).

**A genuine local-dev-only host-mismatch bug found and fixed while building this:** local testing initially showed the SAME symptom (no session established) even after implementing `/auth/confirm` correctly. Root-caused to Next.js's dev server (Turbopack) silently normalizing an incoming request's own `request.url`/`nextUrl` host to `"localhost"` regardless of which literal host (`127.0.0.1` or `localhost`) the browser actually used — so a redirect built from that request targeted a different host than the one whose cookies the session had just been written to, and the browser correctly refused to send `127.0.0.1`-scoped cookies to a `localhost` request. Fixed by aligning local Supabase's own `site_url` to `http://localhost:3000` (`supabase/config.toml`) — matching what Next's dev server actually canonicalizes to, and what `.env.local`'s own `NEXT_PUBLIC_APP_URL` already used. This is a local-environment-only artifact: the real deployed app has exactly one canonical host (`app.zenwardmobility.com`) at all times, so this specific mismatch cannot occur there.

## 4C. Tenant foundation hardening + Settings (P1-PILOT-S4B-R4A)

- **`signup_create_organization` is internal-only.** No client role can execute it (`20260920090000_tenant_settings_foundation.sql`). Before this, any authenticated principal — including a Driver or Dispatcher of an unrelated tenant — could call it directly, any number of times, minting unlimited organizations and Admin Memberships, and two concurrent direct calls from one fresh user produced two organizations. The exactly-once gates (`complete_pending_signup()` / `complete_pending_signup_manual()`, advisory lock + "caller holds no Membership") are now the only self-service creation path; `/sign-up`'s immediate-session branch calls `complete_pending_signup()` (reading the just-persisted signup metadata) instead of the RPC directly. **Product consequence:** one person self-service-creates at most one organization; the earlier "a second call is a legitimate second business" behavior was never reachable from any UI and is no longer reachable from the API either. Belonging to several organizations (an invited Dispatcher/Driver, a future platform-assigned Membership) is unchanged.
- **First-run experience.** `/complete-signup/form` is now presented as an intentional first-run screen ("Welcome to Nemryn — Set up your organization") for an authenticated account with no Membership and no pending signup metadata. Re-submitting (second tab, retry) sends the person to their existing workspace instead of erroring.
- **Settings.** `/operations/settings` (Organization Admin only) and `/operations/settings/organization`. Writes go through `update_organization_settings` (audited `organization_settings_updated`); direct UPDATE of `organizations.name` / `.timezone` is revoked so that is the only path. New columns: `business_phone`, `business_email`, `business_address`, `primary_contact_name`. Onboarding "Business basics" now writes its timezone through the same RPC.

## 5. Progressive complexity (work item §12)

A STARTING (1–2 vehicle) operator is not shown a forked, simplified application — "same platform, progressive emphasis," per the work item's own explicit instruction. What this phase actually built toward that goal:
- The **onboarding checklist** (§3 below is misnamed — see actual §7) itself is the same for every business stage; nothing is hidden based on `business_stage`.
- The **"Drive" sidebar item** (§6, Owner-Operator Mode) is the one genuinely adaptive nav element — it appears only for a person who has a real, linked Driver capability, which is naturally far more common for a 1–2 vehicle owner-operator than a 10+ vehicle established fleet (where the owner is rarely also driving). This is a real, derived fact, not a `business_stage`-keyed toggle.
- **Deliberately not built this phase:** a `business_stage`-driven nav reordering (e.g., promoting "My Trips"/"Drive" above "Dispatch"/"Fleet" for STARTING operators specifically). The 7-item Operations nav (Overview/Trips/Dispatch/Passengers/Facilities/Drivers/Fleet) is identical for every business stage. This is recorded as a deliberate, honest deferral (not a silently-dropped requirement) — see GAP-16 in `docs/product/ui-backend-gap-register.md` — because a rushed nav-personalization change carried real risk of regressing the already-tested, already-working navigation for every OTHER operator size, for a refinement whose UX shape (exactly which items move where, and how) was not specified precisely enough to build safely in the time this phase had.

## 6. Owner-Operator Mode

See `docs/product/owner-operator-mode.md` for the full contract (Membership.role vs. linked Driver row, the security fix this phase required, the "Drive" nav item, and the /driver route-guard relaxation).

## 7. Driver invite/linkage

See `docs/product/driver-invite-linkage-model.md` for the full contract (the highest-risk part of this phase).

## 8. Onboarding checklist (work item §11)

`getOnboardingChecklist()` (`src/lib/operations/onboarding-checklist.ts`) derives 6 items from real, live counts — never a persisted "X% complete" value that could drift from reality:

| Item | Complete when |
|---|---|
| Business profile | Always true once an Organization exists (you cannot reach this screen without one) |
| First vehicle | `vehicles` count > 0 for this org |
| Driver setup | `drivers` count (status=active) > 0 for this org |
| First facility | `facilities` count > 0 for this org |
| First passenger | `passengers` count > 0 for this org |
| First trip | `trips` count > 0 for this org |

The banner (`OnboardingChecklistBanner`, shown on Today's Operations) renders only while incomplete — once every item is true, it stops rendering entirely, with no further persisted state to track or clear. No item is forced mandatory; every item's own link leads either to its dedicated onboarding step or (for "First trip") directly to the real New Trip screen.

## 9. First-Trip success condition (work item §13)

Verified live, end to end, with no manual database editing at any point (`docs/reports/P1-E3-S9-operator-signup-business-setup-report.txt`): sign up → business stage → business basics → add a vehicle → choose to also drive → add a facility → add a passenger → create the first Trip (the real New Trip screen) → land on Trip Detail (which is Operations) → the checklist banner disappears → assign a driver on Dispatch → execute the full lifecycle as that Driver (start → arrived → onboard → start to destination → arrived → complete), including a real reported-and-resolved issue and a real shared location update along the way.

## 10. What this phase deliberately did NOT build

Per the work item's own explicit exclusions: Request Hub, billing, broker integrations, Facility Portal, native Driver app, advanced analytics, geofencing/structured service-area data, a `business_stage`-driven nav reorder (§5), and a general `change_membership_role`/`deactivate_membership` UI (the underlying live-role-check property was verified via direct SQL testing — `docs/reports/...` §Role revocation — but no Operations screen to perform it was built this phase; an org_admin can still do so via a direct, already-safe `memberships` UPDATE, unchanged from before this phase).
