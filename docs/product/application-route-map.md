# Zenward Platform — Application Route Map

**Work item:** P1-E3-S0 — Stitch UI Ingestion & Implementation Mapping, amended by P1-E3-S1 — Authentication, Session & Role Routing Foundation (auth/org-context routes implemented, route access matrix added), amended by P1-E3-S9 — Operator Signup & Business Setup (`/sign-up`, `/onboarding/*`, `/join/[token]` added; `/driver/*` guard relaxed for Owner-Operator Mode)
**Status:** P1-E3-S0's route plan was planning-only. P1-E3-S1 implemented the auth/routing shell described below — `/sign-in`, `/select-organization`, `/access-unavailable`, root `/`, and server-side guards on `/operations/*`/`/driver/*` all exist and are tested (docs/security/application-auth-test-matrix.md). P1-E3-S9 added the self-service onboarding surface. The Stitch screens themselves remain unimplemented placeholders, as this phase intended. **P1-E4-S0 confirmed every route below is fully environment-portable** — no route, redirect, or cookie in this map depends on a hardcoded host; see `docs/deployment/staging-architecture.md` for the cloud-deployment picture and `docs/deployment/environment-variable-inventory.md` for exactly what IS environment-specific (3 env vars, none of them a route).
**Last updated:** 2026-09-03

Proposed route structure derived from the Stitch references and the existing (already-scaffolded, placeholder-only) Next.js route tree under `src/app/`. P1-E3-S0 did not create routes; P1-E3-S1 implemented the auth/context routes this document already proposed, plus the server-side guards described in [auth-session-routing.md](./auth-session-routing.md).

**P1-E3-S1 update — the vestigial public homepage placeholder was removed.** `src/app/(public)/page.tsx` predated the Zenward-Web marketing-site separation (ZD-079) and existed only "to verify shared public-site primitives" before that separation was complete — it is not the real marketing homepage (that lives entirely in Zenward-Web) and had no functional purpose left once auth-aware root routing (work item §27) needed to own `/`. Removed rather than left in conflict with the new `src/app/page.tsx`. `/request-transportation` and `/healthcare-providers` — the other two routes in that same `(public)` route group — were left untouched; whether they still belong in this repository at all, now that Zenward-Web is the settled home for public marketing surfaces, is flagged here as an open question for a future phase, not decided or acted on in this one.

## Existing scaffold (confirmed by inspection, not modified)

```
src/app/operations/            layout.tsx, page.tsx (Overview stub)
src/app/operations/trips/      page.tsx, [tripId]/page.tsx, new/page.tsx
src/app/operations/dispatch/   page.tsx
src/app/operations/passengers/ page.tsx
src/app/operations/facilities/ page.tsx
src/app/operations/drivers/    page.tsx
src/app/operations/fleet/      page.tsx
src/app/operations/billing/    page.tsx
src/app/operations/reports/    page.tsx
src/app/driver/                layout.tsx, page.tsx (Today stub)
src/app/driver/trips/          page.tsx, [tripId]/page.tsx
src/app/driver/history/        page.tsx
src/app/driver/profile/        page.tsx
```

Every one of these is a placeholder rendering `OperationsRouteStub`/`DriverRouteStub` — confirmed by reading `src/app/operations/page.tsx` directly (explicit comment: "Placeholder only... the real Overview screen is a later, canonical-screen work item"). No auth, no data fetching, no Supabase client exists anywhere in `src/` (confirmed: `grep -rl "supabase" src/` returns nothing).

## Operations routes

| Route | Screen (Stitch ref) | Roles | Desktop/mobile behavior | Nav label | Icon (existing mapping) | Notes |
|---|---|---|---|---|---|---|
| `/operations` | Today's Operations (01) | organization_admin, dispatcher | Desktop/tablet primary; see responsive boundary below | Overview | `SquaresFour` | Default landing page for Ops roles |
| `/operations/trips` | (list view — no dedicated Stitch reference; implied by Trip Detail's breadcrumb "Trips ›") | organization_admin, dispatcher | Desktop/tablet | Trips | `Path` (Route not in Phosphor — ZD-035) | **REAL as of P1-E3-S8B1** — search/date/assignment filters, server-side pagination. See operations-surface-map.md |
| `/operations/trips/[tripId]` | Trip Detail (02) | organization_admin, dispatcher | Desktop/tablet | — (detail, not nav-level) | — | |
| `/operations/trips/new` | Internal New Trip (05) | organization_admin, dispatcher | Desktop/tablet | — (reached via "New Trip" CTA, not nav-level) | — | REAL since P1-E3-S7 |
| `/operations/dispatch` | Dispatch Board (03) | organization_admin, dispatcher | Desktop/tablet — dense 3-column layout, not viable narrow | Dispatch | `NavigationArrow` | |
| `/operations/passengers` | (no dedicated reference) | organization_admin, dispatcher | Desktop/tablet | Passengers | `Users` | **REAL as of P1-E3-S8B1** (list + Add Passenger; Edit/Deactivate deferred). See operations-surface-map.md |
| `/operations/facilities` | (no dedicated reference) | organization_admin, dispatcher | Desktop/tablet | Facilities | `Buildings` | **REAL as of P1-E3-S8B1** (read-only list; Create/Edit deferred). See operations-surface-map.md |
| `/operations/drivers` | (no dedicated reference) | organization_admin, dispatcher | Desktop/tablet | Drivers | `IdentificationCard` | **REAL as of P1-E3-S8B1** (read-only list; no fake Availability; onboarding deferred to P1-E3-S9). See operations-surface-map.md |
| `/operations/fleet` | (no dedicated reference) | organization_admin, dispatcher | Desktop/tablet | Fleet | `Van` | **REAL as of P1-E3-S8B1** (read-only list; Create/Edit deferred). See operations-surface-map.md |
| `/operations/billing` | (no dedicated reference) | organization_admin only (billing is an admin-sensitive concern — role split not yet confirmed by any reference) | Desktop/tablet | — (removed from visible nav, P1-E3-S8B1) | `Receipt` | **UNLINKED as of P1-E3-S8B1** — route file kept (honestly-labeled stub), but no sidebar entry leads to it anymore; role restriction remains a recommendation, not yet confirmed |
| `/operations/reports` | (no dedicated reference, "Export Day Sheet" hints at related capability) | organization_admin, dispatcher | Desktop/tablet | — (removed from visible nav, P1-E3-S8B1) | `ChartBar` | **UNLINKED as of P1-E3-S8B1** — same treatment as Billing above |
| `/operations/settings` (implied by sidebar footer, no dedicated route file confirmed) | — | organization_admin only (org settings) | Desktop/tablet | — (removed from visible nav, P1-E3-S8B1) | `Gear` | **No route file exists** — confirmed absent (not merely unconfirmed); the sidebar's own broken link to it was removed this phase rather than building an empty page to avoid the 404 |

## Driver routes

| Route | Screen (Stitch ref) | Roles | Desktop/mobile behavior | Nav label | Notes |
|---|---|---|---|---|---|
| `/driver` | Driver Today (06) | driver | Mobile-first, 390-430px minimum | Today | Default landing page for Driver role |
| `/driver/trips` | Driver Trips (07) | driver | Mobile-first | Trips | Active/upcoming only (`driver_list_active_trips`) |
| `/driver/trips/[tripId]` | Driver Active Trip (04) | driver | Mobile-first | — (detail, not nav-level) | |
| `/driver/history` | (no dedicated reference) | driver | Mobile-first | History | **No Stitch reference provided** — see gap register; maps to `driver_list_trip_history` |
| `/driver/profile` | (no dedicated reference) | driver | Mobile-first | Profile | **No Stitch reference provided** — maps to `driver_get_profile` |

## Shared / auth / utility routes

No Stitch reference covered any of these — built directly against the design system in P1-E3-S1, not fabricated from a missing mockup:

| Route | Purpose | Public/Protected |
|---|---|---|
| `/sign-in` | Email + password entry point | Public |
| `/sign-up` | **P1-E3-S9** — self-service operator signup (full name/email/password/business name) | Public |
| `/select-organization` | Multi-Membership organization selection | Protected (auth required; no org context required — that's what it resolves) |
| `/access-unavailable` | Authenticated, zero active Memberships | Protected (auth required) |
| `/` | Role-resolution landing — never renders visible content itself, always redirects | Protected (redirects unauthenticated visitors to `/sign-in`) |
| `/onboarding` | **P1-E3-S9** — Business Stage (step 1 of 6) | Protected (auth + org context, same guard as `/operations`) |
| `/onboarding/basics` | **P1-E3-S9** — Business Basics (timezone, service area) | Protected |
| `/onboarding/vehicle` | **P1-E3-S9** — First Vehicle (reuses the real Fleet mutation) | Protected |
| `/onboarding/driver` | **P1-E3-S9** — Owner-Driver choice | Protected |
| `/onboarding/facility` | **P1-E3-S9** — First Facility (reuses the real Facilities mutation) | Protected |
| `/onboarding/passenger` | **P1-E3-S9** — First Passenger (reuses the real, pre-existing Add Passenger action); the final step redirects into the real `/operations/trips/new` for "First Trip" — never a duplicated form | Protected |
| `/join/[token]` | **P1-E3-S9** — Driver invite landing/redemption. The token itself is the credential (a 122-bit random UUID) — the page works for an unauthenticated visitor via the narrow, anon-callable `get_driver_invite_preview` RPC, then requires real sign-up/sign-in to redeem | Public (preview only; redemption requires auth) |
| `/complete-signup` | **P1-E4-S0A1** — a Route Handler (not a rendered page), the authoritative continuation for a zero-Membership authenticated visitor: tries pending Driver-invite redemption, then pending operator-signup completion, then falls through to `/complete-signup/form` or `/access-unavailable`. See `docs/product/operator-onboarding-model.md` §4A. | Protected (auth required) |
| `/complete-signup/form` | **P1-E4-S0A1** — the explicit, user-initiated "Complete your organization setup" recovery form, reached only when `/complete-signup` found nothing to auto-complete | Protected (auth required) |
| `/auth/confirm` | **P1-E4-S0A2** — a Route Handler, the SSR email-confirmation callback the Confirm Signup email template links to (`token_hash`/`type` → `verifyOtp()` → real session cookie → `/complete-signup`). See `docs/product/operator-onboarding-model.md` §4B. | Public (the token IS the authority — same "no existence oracle" framing as `/join/[token]`) |
| `/auth/auth-code-error` | **P1-E4-S0A2** — the calm retry state `/auth/confirm` redirects to on any failure (missing/expired/already-used token) | Public |

## Route access matrix (work item §70)

| Route | Auth required | Org context required | Allowed role | Driver link required | Fallback |
|---|---|---|---|---|---|
| `/` | No (redirects if absent) | No | N/A — resolves destination | No | `/sign-in` (unauthenticated) → role-based destination |
| `/sign-in` | No | No | N/A | No | Redirects to `/` if already authenticated |
| `/sign-up` | No | No | N/A | No | Redirects to `/` if already authenticated |
| `/select-organization` | Yes | No (resolves it) | Any role, in any of the caller's own Memberships | No | `/complete-signup` if zero Memberships (P1-E4-S0A1); onward redirect if only one (nothing to select) |
| `/access-unavailable` | Yes | No | N/A | No | `/sign-in` if unauthenticated |
| `/complete-signup`, `/complete-signup/form` | Yes | No (this IS the zero-Membership case) | N/A | No | `/sign-in` if unauthenticated; onward redirect if a Membership already exists (idempotent re-visit) |
| `/onboarding`, `/onboarding/*` | Yes | Yes (same resolution as Operations) | `organization_admin`, `dispatcher` | No | Identical fallback chain to `/operations` — see `requireOnboardingAccess` |
| `/join/[token]` | No (preview); Yes (redeem) | No | N/A — the token IS the authority, not any Membership | No | Wrong-email/revoked/already-accepted states rendered inline, never a redirect |
| `/operations` | Yes | Yes | `organization_admin`, `dispatcher` | No | `/sign-in` → `/select-organization` → `/driver` (if role=driver) → `/complete-signup` → `/access-unavailable` |
| `/operations/*` | Yes | Yes | `organization_admin`, `dispatcher` | No | Same as `/operations` |
| `/driver` | Yes | Yes | `driver`, **or `organization_admin`/`dispatcher` with a real linked Driver row (P1-E3-S9, Owner-Operator Mode — see `docs/product/owner-operator-mode.md`)** | Yes (inline safe state if missing, never a redirect) | `/sign-in` → `/select-organization` → `/operations` (if Ops role with NO linked Driver row) → `/complete-signup` → `/access-unavailable` |
| `/driver/*` | Yes | Yes | Same as `/driver` | Yes | Same as `/driver` |

## Responsive surface split (work item §7-9)

- **Operations** (`/operations/*`): desktop/tablet primary. The Dispatch Board (03) in particular is a dense 3-column layout that cannot be meaningfully compressed below roughly **1024px** without losing the grid's own information density — this is documented as the **intended minimum Operations width**, not implemented as an enforced breakpoint in this phase. Below that width, Operations should show a deliberate "use a larger screen" message rather than auto-morphing into a cramped mobile dashboard (work item §8) — the exact fallback UI is deferred, not designed here.
- **Driver** (`/driver/*`): mobile-first, must work at 390px/430px and common Android/iPhone widths (work item §9). All 4 driver reference images already demonstrate this correctly (full-width primary CTAs, bottom tab bar, single-column card stacks) — no redesign is implied, only implementation against the existing pattern.

## Auth boundary — implemented in P1-E3-S1

| Session state | Routing behavior |
|---|---|
| Unauthenticated | → `/sign-in` |
| Authenticated, `organization_admin`/`dispatcher` Membership | → `/operations` |
| Authenticated, `driver` Membership | → `/driver` (or the inline account-setup state if no linked Driver row) |
| Authenticated, multi-org user | → `/select-organization` (see "Multi-org UX" below — the smallest-safe-approach recommendation there is what got built) |
| Authenticated, zero Membership anywhere | → `/complete-signup` (P1-E4-S0A1 §6: tries a pending operator-signup or Driver-invite continuation first; falls through to `/access-unavailable` only if nothing to complete — see `docs/product/operator-onboarding-model.md` §4A) |
| Authenticated, Platform Admin only (no Membership) | → `/complete-signup` → `/access-unavailable` (no pending signup/invite metadata to complete), identical in the end to any other zero-Membership user — **not** a tenant-Operations bypass (work item §39). Platform Admin's own console remains out of scope. |

Full verification: [application-auth-test-matrix.md](../security/application-auth-test-matrix.md).

## Multi-org UX (work item §34) — implemented in P1-E3-S1

No Stitch reference includes an organization switcher — this section originally recorded the gap as PRODUCT UX DECISION REQUIRED with a recommended smallest-safe approach. That recommendation is what got built: a single active Membership auto-resolves with no extra screen; more than one active Membership shows `/select-organization`, a plain, functional list of the caller's own organizations + role (using existing design-system primitives, not a newly-designed switcher component) rather than a full org-switcher UI. Server-validated (work item §21) — see [auth-session-routing.md](./auth-session-routing.md) "Organization context". A **richer** switcher (e.g. changing organization context from within `/operations` without a full re-selection screen) remains a legitimate future enhancement once the actual UX is designed — not attempted here.
