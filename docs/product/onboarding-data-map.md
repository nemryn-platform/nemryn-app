# Zenward Platform — Onboarding Data Map

**Work item:** P1-E3-S9 — Operator Signup & Business Setup (2 new RPCs added by P1-E4-S0A1 — Cloud Signup Continuation Fix, §3/§9)
**Status:** Implemented.
**Last updated:** 2026-09-03

Every mutation the onboarding flow performs, its source, and its authorization boundary — matching the field-by-field discipline every other `*-data-map.md` in this project already follows.

## New schema this phase

| Table/column | Purpose |
|---|---|
| `organizations.business_stage` | text, nullable, CHECK IN (starting/growing/established) — self-reported operator size |
| `organizations.service_area_description` | text, nullable, ≤1000 chars — plain free-text service area, no geofencing |
| `driver_invites` (new table) | Tenant-owned invite record — see `driver-invite-linkage-model.md` |

## New RPCs this phase

| RPC | Callable by | Effect |
|---|---|---|
| `signup_create_organization(business_name, display_name, business_stage, timezone)` | Any authenticated user | Atomically creates UserProfile + Organization + the caller's own `organization_admin` Membership |
| `link_self_as_driver(organization_id, display_name, phone)` | Organization Admin of the org (S5A1; was any active member) | Creates/reuses a Driver row linked to the caller's own `auth.uid()` — never touches Membership.role |
| `create_driver_invite(organization_id, email, display_name, phone)` | Organization Admin, own org | Creates/refreshes a pending `driver_invites` row |
| `revoke_driver_invite(invite_id)` | Organization Admin, own org, pending only | Marks an invite revoked |
| `get_driver_invite_preview(token)` | Public (anon + authenticated) | Minimum-necessary invite preview — org name, invited name, email, status only |
| `redeem_driver_invite(token)` | Any authenticated user whose account email matches the invite | Atomically creates driver Membership (if none exists) + links/reuses Driver row + marks invite accepted |
| `complete_pending_signup()` | Any authenticated user | **P1-E4-S0A1** — the email-confirmation-boundary continuation. Idempotent (advisory lock + existing-Membership guard): reads `pending_full_name`/`pending_business_name` from the caller's own `auth.users.raw_user_meta_data` and calls `signup_create_organization` with them exactly once. No-op if the caller already has a Membership, or if no pending metadata exists. See `docs/product/operator-onboarding-model.md` §4A. |
| `complete_pending_signup_manual(full_name, business_name)` | Any authenticated user | **P1-E4-S0A1** — the explicit recovery-form variant of the above, for an account with no traceable pending metadata at all. Same idempotency guard, caller-supplied values. Backs `/complete-signup/form`. |

## New column grants this phase (all narrow, additive, documented per-migration)

| Column | Grant | Why |
|---|---|---|
| `organizations.business_stage` | UPDATE, org_admin (via existing `organizations_update_org_admin` policy) | Business Stage onboarding step |
| `organizations.service_area_description` | UPDATE, org_admin | Business Basics onboarding step |
| `organizations.timezone` | UPDATE, org_admin | **A real, pre-existing gap found this phase** — P1-E3-S2C added this column but never granted client UPDATE at all (timezone was set-once, no self-service feature existed yet). Business Basics is the first legitimate need; the grant is added here, org-scoped via the existing policy, IANA-validated via the existing CHECK constraint. |

## Revoked grant this phase

| Column | Change | Why |
|---|---|---|
| `drivers.user_id` | Removed from the client UPDATE column grant | A real, previously-unexercised but live-exploitable gap — see `driver-invite-linkage-model.md` §4. |

## Onboarding step → mutation map

| Step | Route | Mutation | Mechanism |
|---|---|---|---|
| Sign Up | `/sign-up` | Auth user + UserProfile + Organization + Membership | `signup_create_organization` |
| Business Stage | `/onboarding` | `organizations.business_stage` | Plain column UPDATE (existing RLS + new grant) |
| Business Basics | `/onboarding/basics` | `organizations.timezone`, `organizations.service_area_description` | Plain column UPDATE (existing RLS + new grants) |
| First Vehicle | `/onboarding/vehicle` | New `vehicles` row | Plain INSERT via the SAME `createVehicleAction` the real Fleet screen uses (GAP-14, already-safe RLS) |
| Owner-Driver choice | `/onboarding/driver` | New/reused `drivers` row | `link_self_as_driver` |
| First Facility | `/onboarding/facility` | New `facilities` row | Plain INSERT via the SAME `createFacilityAction` the real Facilities screen uses (GAP-13, already-safe RLS) |
| First Passenger | `/onboarding/passenger` | New `passengers` row | The SAME, pre-existing `addPassengerAction` New Trip already used (P1-E3-S7) |
| First Trip | `/operations/trips/new` | New `trips` row | The real, unmodified New Trip screen and `create_trip` RPC — never duplicated |

No onboarding step invents a new mutation path where a real, already-tested one already existed — every step after Sign Up and Business Stage/Basics reuses exactly the same Server Action or RPC the corresponding real Operations screen uses.

## Vehicle / Facility / Passenger CRUD (work item §7/§8/§9 — closes GAP-14/GAP-13/GAP-12)

All three follow the identical shape: a direct, RLS-protected INSERT/UPDATE (never an RPC — none of the three has a lifecycle machine to protect, unlike Trip), using RLS that was ALREADY safe and org+role-scoped before this phase touched anything (confirmed in the original GAP entries, re-confirmed here before building):

| Entity | Create | Edit | Notes |
|---|---|---|---|
| Vehicle | `createVehicleAction` | `updateVehicleAction` | Only `label`/`status` — no fabricated wheelchair/stretcher/ambulatory capability column (schema has none) |
| Facility | `createFacilityAction` | `updateFacilityAction` | `name`/address fields/`status` — Facility remains a distinct entity from Organization throughout |
| Passenger | `addPassengerAction` (pre-existing, reused) | `updatePassengerAction` | `display_name`/`phone`/`assistance_notes`/`status` — deactivate is the same form's Status field, never a hard DELETE |

## Onboarding checklist

`getOnboardingChecklist(organizationId)` — 5 real `count`-only queries (vehicles/drivers/facilities/passengers/trips), no new schema. See `operator-onboarding-model.md` §8.
