# Zenward Platform — Owner-Operator Mode

**Work item:** P1-E3-S9 — Operator Signup & Business Setup, §4
**Status:** Implemented — `link_self_as_driver`, the relaxed `/driver/*` route guard, the sidebar's conditional "Drive" item.
**Last updated:** 2026-09-03

Supports the reality that one person may genuinely be Owner + Dispatcher + Driver — without collapsing roles insecurely.

## 1. The two identity layers stay fully separate

Exactly as `docs/product/authorization-model.md` §B already established, before this phase existed:

```
Membership.role     — governs Operations authorization (organization_admin/dispatcher/driver)
drivers table        — governs Driver-execution authorization (a linked, active Driver row)
```

**"A Driver row existing does not imply an active Membership. An active Membership does not imply a linked Driver row."** This phase adds a THIRD legitimate combination to that existing principle: an active `organization_admin`/`dispatcher` Membership **plus** a linked, active Driver row, both for the same person, in the same organization. Membership.role is **never** changed by any part of this feature — an owner who links themselves as a driver is, for every Operations-authorization purpose, still exactly the `organization_admin` they were before.

## 2. `link_self_as_driver` — the controlled mutation

`link_self_as_driver(p_organization_id, p_display_name, p_phone)` — SECURITY DEFINER, requires an active **Organization Admin** Membership in the target (active) org (S5A1 — originally any active member), and **only ever links `auth.uid()` to a Driver row for themselves** — there is no parameter that could target a different person. Idempotent: a repeat call for the same person+org reuses the existing Driver row rather than creating a duplicate.

This is deliberately separate from the driver-invite/redemption flow (`docs/product/driver-invite-linkage-model.md`) — self-linking is a same-person, self-service action; inviting is an admin-acting-on-someone-else's-behalf action, and carries the correspondingly heavier verification (email match, token, admin-only creation).

## 3. The real gap this phase found and fixed: `current_driver_id()`

**Before this phase**, `current_driver_id()` (the function every Driver-scoped RLS policy and RPC ultimately calls) required the caller's Membership to have `role = 'driver'` specifically — a deliberate fix from an earlier phase (P1-E2-S3, ZD-100) that closed a real vulnerability: an inactive Membership retaining Driver access through a stale `drivers.status = 'active'` row.

That fix, while correct at the time, made Owner-Operator Mode structurally impossible: an `organization_admin` who self-links a Driver row keeps `role = 'organization_admin'` (by design, §1) — so `role = 'driver'` could never be true for them, and every driver-scoped check would deny them regardless of a real, active, correctly-linked Driver row. Found via direct live testing while building this feature, not assumed.

**The fix** (`20260903100700_current_driver_id_owner_operator_mode.sql`) relaxes the check from `m.role = 'driver'` to simply `m.status = 'active'` (any role) — preserving ZD-100's actual security property exactly (an inactive Membership, of ANY role, still denies Driver access, verified via a re-run of the original DETAIL-6 test plus a new dedicated test in `operator_onboarding_tests.sql`), while correctly allowing the one new case this phase deliberately introduces. See ZD-194.

## 4. Route guard relaxation — navigation only, never a new security boundary

`requireDriverAccess` (`src/lib/auth/authorization.ts`) previously redirected any non-`driver`-role Membership straight to `/operations` before ever checking for a linked Driver row. It now also lets `organization_admin`/`dispatcher` roles through to the SAME `driver_get_profile` RPC check every Driver already goes through — if it resolves (a real linked Driver row exists), they see `/driver/*`; if not, they're redirected to `/operations` exactly as before. **This changes navigation only** — the actual data access `/driver/*` performs is, and always was, gated entirely by `current_driver_id()`/`driver_get_profile` resolving from the real `drivers` table, never by Membership.role.

## 5. The "Drive" sidebar item

`OperationsSidebar` renders one additional nav item, "Drive" (linking to `/driver`), **only** when `current_driver_id()` genuinely resolves for the signed-in person in the current org — a real, live check (`src/app/operations/layout.tsx`), never inferred from `business_stage` or any other proxy. Appended to the existing 7-item nav, never replacing anything (work item §12: "Same platform, progressive emphasis").

## 6. Returning to Operations from the Driver view

A dual-hat person's `/driver/*` header shows a "Back to Operations" icon (in addition to the ordinary Sign Out) — shown only when `Membership.role !== 'driver'` for the resolved org (i.e., only for someone who reached `/driver` via the relaxed guard as their SECOND hat, not an ordinary Driver-only account, who has no "Operations" to go back to).

## 7. Verified live

`docs/reports/P1-E3-S9-operator-signup-business-setup-report.txt` — a real signup → business stage → business basics → vehicle → "yes, I also drive" → the owner reaching `/driver` and seeing the real Driver Today screen → the "Back to Operations" link working → their Membership role confirmed unchanged in the database throughout.

## 8. S5A1 — Settings → My Access, and the hardened primitive

**Work item:** P1-PILOT-S5A1 — Owner-Operator Self-Service Driver Access. Migration `20260921090000_owner_operator_self_service_driver_access.sql`.

The same human can be owner, Organization Admin and Driver with **one account** — no second email, no invitation to themselves, no support intervention. Membership role and Driver identity remain two separate concepts; this never converts an Organization Admin into a "driver role".

**One primitive.** `link_self_as_driver` is the only implementation. First-run onboarding ("Do you also drive?") and Settings → My Access both reach it through one server helper (`enableSelfDriverAccess`, `src/lib/operations/self-driver.ts`).

**What S5A1 changed in the primitive**

| Situation | Behaviour |
|---|---|
| Caller is not an Organization Admin of an active organization (Dispatcher, Driver, inactive Membership, suspended org, foreign org, Platform Admin without a Membership) | `ZW002`, nothing written |
| Active linked Driver already exists | returned unchanged (idempotent; audit not repeated) |
| Exactly one inactive linked Driver | **reactivated** (same row, history intact), audit `driver_self_reactivated` |
| More than one inactive linked Driver for the caller | `ZW003` (`driver_identity_conflict`) — never guessed |
| No linked Driver, but an **unlinked** Driver in the org has the same name | `ZW003` — ownership is never inferred from a name or phone |
| No linked Driver | new Driver row created, audit `driver_self_linked` |

A partial unique index (`drivers_one_active_link_per_user_org_idx`) makes two active Driver rows for one (organization, auth user) impossible, and the function serialises per (organization, user) with an advisory lock so a double-submit is idempotent.

**My Access** (`/operations/settings/my-access`, Organization Admin only, like all Settings) shows the account, organization, Operations access and Driver access (Not set up / Active / Inactive), never ids or raw codes. "Drive" appears in the Operations sidebar only when `current_driver_id()` resolves for the current organization — being an Organization Admin alone never shows it. Driver access is per organization; nothing global.

**Deliberately deferred: self-deactivation.** No controlled "deactivate Driver" mutation exists anywhere in the product today (only a raw Organization Admin UPDATE grant on `drivers.status`, unused by the UI). Building one needs: an active-assignment check (an assignment is active when `trip_assignments.ended_at IS NULL`), a block with the message "You still have an active trip assignment. Complete or reassign it before turning off Driver access.", an audit action, and Activity copy. It is a later, separately reviewed capability. Restoring an inactive Driver (activation path) is supported.

**S5A1R — no client INSERT on `drivers`.** Migration `20260921100000_retire_direct_driver_insert.sql` revokes INSERT on `public.drivers` from `authenticated` and drops the now-unreachable `drivers_insert_org_admin` policy. Before it, an Organization Admin could directly INSERT a Driver row with an arbitrary `user_id` (S9 had closed only the UPDATE side). The invariant is now enforced by privileges: **a Driver ↔ auth-user link is established only by `link_self_as_driver` and `redeem_driver_invite`** (both SECURITY DEFINER, unaffected). No application code inserted into `drivers` from the client; the Drivers directory, Dispatch and Operations Brief only SELECT. Organization Admin UPDATE of `display_name`, `phone`, `status` is unchanged; `user_id` is not updatable by any client role. Tests: `supabase/tests/driver_identity_write_surface_tests.sql`.
