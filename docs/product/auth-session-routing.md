# Zenward Platform — Auth, Session & Routing

**Work item:** P1-E3-S1 — Authentication, Session & Role Routing Foundation (the `none` → `/complete-signup` routing below updated by P1-E4-S0A1 — Cloud Signup Continuation Fix, §6; a new `/auth/confirm` SSR route added by P1-E4-S0A2 — Auth Confirmation Callback Fix)
**Status:** Implemented and verified against the actual local Supabase Auth service and the actual running Next.js app — 41 real integration checks pass, plus 204 pre-existing database security assertions unaffected. Not a syntax-only claim.
**Last updated:** 2026-09-03

**New this phase — `/auth/confirm`** (`src/app/auth/confirm/route.ts`): the SSR email-confirmation callback the Confirm Signup email template now links to directly. Reads `token_hash`/`type`, calls `supabase.auth.verifyOtp()` on the server client (establishing the real session cookie in the response), then redirects to `/complete-signup` on success or `/auth/auth-code-error` (a new, calm retry page) on failure. See `docs/product/operator-onboarding-model.md` §4B for the full architecture and root-cause analysis.

This document describes the identity/routing layer built in this phase. It complements [application-auth-boundary.md](../security/application-auth-boundary.md) (the security reasoning) and [application-auth-test-matrix.md](../security/application-auth-test-matrix.md) (the full test record).

## The flow

```
Unauthenticated user
  → /sign-in (email + password)
  → Supabase Auth session (cookie, set by the server client)
  → getUser() — re-validated against the Auth server, not decoded locally
  → getActiveMemberships() — live query, user's own active rows only
  → resolveOrganizationContext() — single auto-selects; multiple require /select-organization
  → role for THAT organization
  → /operations (organization_admin, dispatcher) or /driver (driver)
```

Every step above is resolved server-side, before any protected content renders — there is no client-side route guard anywhere in this layer, and no flash of the wrong role's UI (work item §9).

## Session resolution

- **Browser client** (`src/lib/supabase/client.ts`): publishable key only, for Client Components that need one (none do yet in this phase beyond the sign-in form's own progressive-enhancement path).
- **Server client** (`src/lib/supabase/server.ts`): publishable key + the request's session cookie, used by every Server Component/Server Action/Route Handler. Reads/writes via Next.js's `cookies()` API (async in this Next.js version).
- **Proxy** (`src/proxy.ts` + `src/lib/supabase/proxy.ts` — renamed from `middleware.ts`/`src/lib/supabase/middleware.ts` in P1-E3-S1A; Next.js 16 deprecated the `middleware` file/export convention in favor of `proxy`): refreshes the session cookie on every non-static request (the standard `@supabase/ssr` pattern) and propagates the requested pathname via an `x-zw-pathname` header, which is how the route guards below build an accurate `next=` redirect target — Server Components have no other reliable way to read the current URL. Session-refresh only, same as before the rename — it does not perform route authorization. Lives at `src/proxy.ts`, not the project root: this app's router is under `src/app`, and Next.js resolves the proxy/middleware convention file relative to wherever `app` actually is. A root-level file was one directory too high and was silently never discovered by the build (empty middleware manifest, no "Proxy (Middleware)" build-summary line, handler never invoked) — caught and corrected during P1-E3-S1A's own verification work. See [P1-E3-S1A-auth-compatibility-report.txt](../reports/P1-E3-S1A-auth-compatibility-report.txt) item 5 for the full diagnosis.

`getUser()` (`src/lib/auth/session.ts`) calls Supabase's `auth.getUser()`, which re-validates the token against the Auth server — never `getSession()`, which only decodes the local JWT and would trust a token that's technically well-formed but no longer honored by the server.

## Membership resolution

`getActiveMemberships()` (`src/lib/auth/membership.ts`) queries `memberships` for the current user's own **active** rows, joining `organizations` for the display name. Two things about this query are load-bearing, not incidental:

1. It filters `.eq("user_id", user.id)` **explicitly** — see the "own memberships vs. org admin's team" pitfall below.
2. It filters `.eq("status", "active")` **explicitly** — `memberships_select_self` (the RLS policy this query relies on) deliberately returns a user's own row *regardless* of status (an approved, existing behavior from P1-E2-S1, needed elsewhere), so "active only" is this function's own responsibility, not RLS's.

No service-role key is used anywhere in this layer (work item §17) — every read is the caller's own authenticated session, protected by the same RLS this whole project has built and tested since P1-E2-S1.

## Organization context

`resolveOrganizationContext()` (`src/lib/auth/organization.ts`) returns one of four states:

| Status | Meaning | Behavior |
|---|---|---|
| `none` | Zero active Memberships | → `/complete-signup` (P1-E4-S0A1: tries a pending operator-signup or Driver-invite continuation first; falls through to `/access-unavailable` only if there's genuinely nothing to complete — see `docs/product/operator-onboarding-model.md` §4A) |
| `single` | Exactly one active Membership | Auto-selected, no extra screen |
| `selected` | Multiple Memberships, and the `zw_org_context` cookie names one of them | That organization's role applies |
| `select-required` | Multiple Memberships, no matching cookie | → `/select-organization` |

The `zw_org_context` cookie (httpOnly, `sameSite=lax`, 30-day expiry) holds **only a requested context** — which of the caller's own active Memberships to use. It is never trusted as authorization by itself: every read re-validates it against a fresh `getActiveMemberships()` call, and a value that matches none of the caller's own active Memberships is treated exactly like no cookie at all (work item §22, verified: `FOREIGNORG-1`/`FOREIGNORG-2` in the test matrix). A single-Membership user's real organization always wins regardless of what the cookie says — there's only one legitimate choice for them, so the cookie is irrelevant.

**`organizationTimezone` (added P1-E3-S2C):** `ActiveMembership`/`OrganizationContext` (`src/lib/auth/types.ts`) both carry the resolved Organization's own IANA timezone alongside its name/role — read via the exact same `getActiveMemberships()` embedded join as `organizationName`, never a second lookup and never trusted from the `zw_org_context` cookie (the cookie still names a requested organization only, as above — it carries no timezone data of its own). This is what lets Driver Today (and, later, Operations) interpret a Trip's `timestamptz` fields correctly regardless of which organization is in context or where the server itself is running. Full detail: [operational-timezone.md](./operational-timezone.md).

## Single-org vs. multi-org behavior

Single-Membership: root `/` and any protected route resolve immediately, no extra step. Multi-Membership: `/select-organization` shows the caller's own active Memberships only (organization name + role, no internal tenant metadata — the org UUID appears exactly once per option, inside that option's own hidden form field, never in visible copy), and the selection is **server-validated** against a fresh Membership query before the cookie is set — a user cannot select an organization by supplying an arbitrary UUID (work item §21, verified: `selectOrganizationAction` re-checks `getActiveMemberships()`).

This is deliberately the smallest safe MVP — not a designed org-switcher component (see [component-inventory.md](../design/component-inventory.md) and [application-route-map.md](./application-route-map.md) "Multi-org UX").

## Route table

See [application-route-map.md](./application-route-map.md) "Route access matrix" for the full table (route / auth required / org context required / allowed role / Driver-link required / fallback).

## Revocation semantics

Nothing in this layer is cached across requests. `getActiveMemberships()` and the Driver-linkage check both re-query the database on every protected request. Verified directly, using the **same** authenticated session throughout, no sign-out/sign-in cycle:

- An active Membership toggled to `inactive` mid-session loses access on the very next request (`/operations` → `/access-unavailable`), and regains it immediately when reactivated.
- A `dispatcher` Membership changed to `driver` mid-session loses Operations access on the very next request and is redirected to `/driver` instead — no stale role cache anywhere.
- A role change in one organization does not affect a multi-org user's authorization in a different organization — each organization's role is resolved independently, every time.

Full results: [application-auth-test-matrix.md](../security/application-auth-test-matrix.md) "Same-session revocation".

## Platform Admin treatment

`PlatformAdminGrant` is never consulted by any route guard in this layer. A user who holds only a Platform Admin grant (zero Memberships) is routed to `/access-unavailable`, identical to any other zero-Membership user (work item §39, verified: `PLATFORMADMIN-1`). No Platform Admin UI exists in this phase, and none is implied by anything built here.

## Driver linkage requirement

`requireDriverAccess()` requires, in order: authenticated → active Membership → role=`driver` in the resolved organization → a genuinely linked, active `drivers` row. That last check reuses the **same** `driver_get_profile` RPC the secure Driver read API (P1-E2-S3) already uses — re-deriving `current_driver_id()`'s logic in TypeScript would duplicate, and risk drifting from, the database's own authoritative check (work item §30).

A `driver` Membership with no resolvable Driver row does **not** redirect — redirecting back into `/driver`'s own guard would loop (work item §60). It renders a safe, non-crashing "account not yet set up" state inline instead, with no internal ID exposed and a sign-out action offered (work item §26, verified: `DRIVERLINK-1`).

## Error states

| Application error | When | User sees |
|---|---|---|
| `INVALID_CREDENTIALS` | Wrong email/password, or account doesn't exist | Generic message — never distinguishes the two |
| `SESSION_EXPIRED` | Reserved for a future explicit expiry-detection path | (not yet surfaced — Supabase's own re-auth requirement naturally routes an expired session back through `requireUser`'s redirect) |
| `NO_ACTIVE_MEMBERSHIP` | Authenticated, zero active Memberships | `/access-unavailable`'s calm copy |
| `ORG_CONTEXT_INVALID` | Reserved for a future explicit-selection-failure path | (currently handled by silently re-rendering `/select-organization` rather than a distinct error message) |
| `ROLE_FORBIDDEN` | Reserved | (currently handled by redirecting to the correct surface rather than a bare denial — see "Route table") |
| `DRIVER_LINK_MISSING` | `driver` Membership, no Driver row | The inline account-setup state |

The full 6-code vocabulary (`src/lib/auth/errors.ts`) exists as the stable application-level contract even where this phase's own UI resolves the situation via a redirect rather than displaying the code directly — future screens can rely on the same constants rather than inventing new ones.
