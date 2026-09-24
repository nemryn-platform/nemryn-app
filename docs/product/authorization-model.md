# Zenward Mobility — Roles, Permissions & Authorization Model

**Work item:** P1-E1-S3 — Roles, Permissions & Authorization Model, amended by P1-E1-S3A — Driver Data Minimization Amendment
**Phase:** P1 — Core Product Architecture
**Status:** Draft, pending review — Authorization Security Gate: READY (see end of document)
**Last updated:** 2026-08-30

This document defines WHO may access WHAT and WHO may perform WHICH ACTION, on top of [domain-model.md](./domain-model.md) and [lifecycle-model.md](./lifecycle-model.md). **No tables, RLS policies, migrations, RPCs, middleware, or auth code exist yet.** This is the authorization model the schema and policies will encode.

---

## A. Authorization overview

Zenward is **database-enforced authorization**: RLS first, deny by default, least privilege. Frontend controls — hidden buttons, disabled inputs, route guards, an `activeOrganizationId` in client state — are conveniences, never security boundaries. Every permission decision in this document must remain true when a user bypasses the UI entirely: calls the Supabase REST API directly, guesses a UUID, edits a payload, sends a forged `organization_id`, hits an unexpected route, or keeps using a session after their membership was revoked.

## B. Identity model

Five layers, kept explicitly separate (extends domain-model.md §H):

| Layer | What it answers | Table |
|---|---|---|
| **Auth User** | Who is logged in | Supabase `auth.users` |
| **UserProfile** | Display identity, org-independent | UserProfile |
| **Membership** | Which organizations can this identity act within, and as what | Membership |
| **Operational profile** | Role-specific operational resources (Driver is the one that needs its own table; staff roles need none beyond Membership) | Driver |
| **Global platform grant** | Cross-organization platform authority, entirely orthogonal to Membership | PlatformAdminGrant |

None of these substitute for another. A Driver row existing does not imply an active Membership. An active Membership does not imply a linked Driver row. A PlatformAdminGrant is never expressed through Membership or UserProfile.

## C. MVP role model

**Three organization-scoped roles, and Operations Staff is confirmed removed as a separate role:**

- `organization_admin`
- `dispatcher`
- `driver`

**Operations Staff decision:** every permission evaluated in P1-E1-S1 and P1-E1-S2 for "Dispatcher" and "Operations Staff" was identical — both were treated as the same tier throughout the confirmed access matrices. Per the explicit instruction to collapse identical-permission roles rather than preserve a label from prior UI copy, **`operations_staff` is not introduced.** `dispatcher` is the one canonical operations role. If a genuine permission difference is ever identified (not just a title preference), that's a new role, added deliberately — not a default.

Plus, outside the Membership role set entirely: **PlatformAdminGrant** (global, system-owned) and **public requester** (not a role — capability-based access through a controlled boundary, no standing database identity at all).

## D. Platform Admin model

Confirmed architecture (unchanged from domain-model.md §B/§L):

```
Auth User
 ├── Membership → organization-scoped role
 └── PlatformAdminGrant → global platform authority
```

`Membership.role = platform_admin` is never used. `UserProfile.is_admin` is never used. Client-controlled JWT data is never treated as the canonical grant — the PlatformAdminGrant row is.

**Platform Admin does not receive unrestricted browser-level SELECT across every tenant table.** Two categories of platform action, evaluated separately:

**Direct platform-wide read — genuinely required, granted at the RLS level:**
- Organization (platform oversight, support routing)
- PlatformAdminGrant (managing other grants)
- Membership (read-only — support/troubleshooting access issues; low sensitivity, high support value)
- AuditEvent (read-only, across organizations — security investigation and compliance oversight)

**Not granted as a standing RLS read, even to Platform Admin** — Passenger, Trip, TripAssignment, TripEvent, TripNote, TripException, TransportationRequest, Driver, Vehicle, Facility. If genuine cross-organization support access to one of these is ever needed, it goes through a specific, controlled, audited support action (a narrow RPC requiring a reason and producing an AuditEvent) — never a blanket SELECT policy that lets a platform admin browse any organization's operational data at will. Passenger data in particular never gets a platform-wide read path of any kind without an explicit, separately-approved decision.

**Privileged mutation** (a lifecycle correction, a role change override, anything outside a normal actor's own permitted actions) always requires: a verified PlatformAdminGrant, an explicit named action (never a raw table write), a mandatory reason, and a resulting AuditEvent. There is no invisible platform-admin bypass anywhere in this model.

## E. Organization Admin permissions

Restricted to their own organization in every case below — never another organization's data, ever.

| Area | Permission |
|---|---|
| Organization settings | Read, update (not create — organization creation remains a platform-level action, domain-model.md §B) |
| Membership | Invite, read, deactivate, change role among `{organization_admin, dispatcher, driver}` (never anything resembling platform admin — that value doesn't exist in this set) |
| Driver profile | Create, read, update, deactivate |
| Vehicle | Create, read, update |
| Facility | Create, read, update |
| Passenger | Create, read, update |
| TransportationRequest | Read, review (accept/decline) |
| Trip | Create, read, update planning fields, cancel |
| TripAssignment | Assign, reassign |
| TripNote | Create/read, both visibility classes |
| TripException | Create, resolve |
| AuditEvent | Read (own organization) |

**Organization Admin must never:** grant Platform Admin (impossible by construction — no such value exists on Membership); access another organization's data under any circumstance; mutate AuditEvent directly (INSERT/UPDATE/DELETE — reads only, writes are system-only per domain-model.md §25); or bypass the controlled transition boundary for Trip lifecycle changes — an Organization Admin's cancellation or no-show action is a named, audited action, not a raw `UPDATE trips SET state = ...`, same as everyone else (lifecycle-model.md §O).

## F. Dispatcher permissions

The operations role for day-to-day work, deliberately narrower than Organization Admin where identity/access management and fleet administration are concerned (least privilege):

| Area | Permission |
|---|---|
| TransportationRequest | Read, review (accept/decline) |
| Passenger | Create, read, update |
| Facility | Create, read, update |
| Trip | Create (from request or internal), read, update planning fields (while non-terminal), cancel |
| TripAssignment | Assign, reassign |
| TripEvent | Read (creation happens only through the controlled transition boundary, never a direct insert by any human role) |
| TripNote | Create/read, both visibility classes |
| TripException | Create, resolve |
| Driver | Read only — **not** create/deactivate (kept with Organization Admin, since onboarding/removing a driver has access-management implications) |
| Vehicle | Read only — **not** create/update (kept with Organization Admin; day-to-day dispatch needs to *use* vehicles for assignment, not administer the fleet) |
| AuditEvent | No access |

**Dispatcher must never:** manage organization membership; change any user's role; touch PlatformAdminGrant in any way; alter TripEvent or AuditEvent history; access another organization; delete a historical TripAssignment.

## G. Driver permissions

The narrowest role, gated by the full relationship chain, never by knowing an ID:

```
auth.uid() → active Membership (in the target org) → linked Driver profile
  → active/relevant TripAssignment → permitted Trip relationship
```

**May access:**
- Own Driver profile
- Own assignments (TripAssignment rows where `driver_id` resolves to them — including their own past, superseded ones)
- The specific Trip(s) required to perform those assignments
- Passenger *information* necessary for an assigned trip (display name, phone number where operationally required, permitted assistance/companion information, driver-visible instructions) — **not** direct SELECT access to the Passenger table itself. See §M.
- Pickup/destination and permitted assistance information for an assigned trip
- `driver_visible` TripNotes on an assigned trip (never `operations_only`)
- TripExceptions on their own assigned trip
- Their own relevant TripEvent timeline

**May perform:**
- Allowed controlled Trip transitions on their own active assignment (start to pickup, arrived at pickup, passenger onboard, start to destination, arrived at destination, complete)
- Create a `driver_visible` TripNote on their own assigned trip
- Create a TripException on their own assigned trip
- Request (not execute) a cancellation, via a TripException

**Must never:**
- Receive generic direct SELECT access to the Passenger table, or any Passenger field beyond the minimum-necessary set for a specific assigned trip (§M) — RLS controls rows, but never by itself guarantees minimum-necessary *column* exposure, so table-level SELECT is not the mechanism used here at all
- Browse the organization's passengers, trips, drivers, or vehicles generally
- Read another driver's assignment, in this organization or any other
- Self-assign, reassign, or change `driver_id`/`vehicle_id` on any assignment
- Mutate `organization_id` anywhere
- Manage Membership in any form
- Read or reclassify an `operations_only` TripNote, or reclassify any note's visibility at all
- Resolve a TripException (create/report only)
- Edit or delete a TripEvent
- Move a Trip to an arbitrary state outside a permitted transition
- Access any data belonging to another organization

## H. Public intake permissions

Public requester is **not an organization role** and holds **no standing database access of any kind.** The only capability is submitting a TransportationRequest through the controlled server-side intake boundary (domain-model.md §L) — a capability, not a membership.

Explicitly, at all times: no anonymous SELECT on TransportationRequest; no anonymous UPDATE; no anonymous DELETE; no passenger-list access; no facility-list access (unless a future, deliberately designed public directory is separately approved — domain-model.md §Q); no organization access of any form.

**Future Facility User:** deferred, not designed. The architecture doesn't preclude a future `facility_coordinator`-equivalent concept, most naturally a Facility-scoped construct distinct from Organization Membership (domain-model.md §I) — no role is created for it now, and no permissions are drafted for it.

## I. Entity CRUD matrix

Actors: **Pub** (unauthenticated public) · **AuthNM** (authenticated, no membership in the target org) · **OA** (organization_admin) · **Disp** (dispatcher) · **Drv** (driver) · **PA** (platform_admin) · **Sys** (trusted server/system).

`C`reate `R`ead `U`pdate `D`elete. `(own)` = scoped to the actor's own record/assignment. `(ctrl)` = only through a controlled action/boundary, never a raw table write.

| Entity | Pub | AuthNM | OA | Disp | Drv | PA | Sys |
|---|---|---|---|---|---|---|---|
| Organization | — | — | R,U(own org) | R(own org) | R(own org) | C,R,U(all) | C |
| Membership | — | R(own rows) | C,R,U(own org) | R(own org) | R(own row) | R(all),U(role/deactivate) | C |
| UserProfile | — | C,R,U(own row) | R(org members) | R(org members) | R(own row) | R(all) | — |
| PlatformAdminGrant | — | R(own grant) | — | — | — | R(all) | C,U(ctrl, privileged path only) |
| Driver | — | — | C,R,U | R | R(own row) | R(all, support) | — |
| Passenger | — | — | C,R,U | C,R,U | **no table SELECT** — minimum-necessary fields only, via controlled projection (§M) | — | — |
| Facility | — | — | C,R,U | C,R,U | R(org) | — | — |
| Vehicle | — | — | C,R,U | R | R(assigned vehicle) | — | — |
| TransportationRequest | C(ctrl) | C(ctrl) | R,U(review) | R,U(review) | — | — | C(ctrl) |
| Trip | — | — | C,R,U(planning),U(cancel,ctrl) | C,R,U(planning),U(cancel,ctrl) | R(own),U(ctrl transitions only) | — | U(ctrl) |
| TripAssignment | — | — | C,U(reassign) | C,U(reassign) | R(own) | — | — |
| TripEvent | — | — | R | R | R(own trip) | R(all) | C(ctrl, on every transition) |
| TripNote | — | — | C,R,U(visibility) | C,R,U(visibility) | C(driver_visible, own trip),R(driver_visible, own trip) | — | — |
| TripException | — | — | C,R,U(resolve) | C,R,U(resolve) | C(own trip),R(own trip) | — | — |
| AuditEvent | — | — | R(own org) | — | — | R(all) | C(ctrl, on every tracked mutation) |

Nothing in this matrix grants Pub or AuthNM standing access beyond the one controlled TransportationRequest creation path. No actor other than Sys ever gets a direct write to AuditEvent.

## J. Action authorization matrix

Many Zenward operations are deliberately **not** generic UPDATE grants. The list from the work item is refined below — one generic `transition_trip_state` action was rejected in favor of naming each transition explicitly, matching the "small, single-purpose" policy philosophy (§Q) rather than one action covering six different real operations.

| Action | Allowed actors | Notes |
|---|---|---|
| `review_transportation_request` | Dispatcher, Org Admin | Accept (`pending → accepted`) or decline (`pending → declined`, reason required); cancel an accepted Request with no Trips (`accepted → cancelled`, reason required) — P1-OPS-R1 |
| `create_trip_from_request` | Dispatcher, Org Admin | Request must already be `accepted` with an active linked Passenger; never changes Request state (P1-OPS-R1) |
| `create_internal_trip` | Dispatcher, Org Admin | No TransportationRequest behind it |
| `edit_trip_planning_details` | Dispatcher, Org Admin | Only while Trip is non-terminal |
| `cancel_trip` | Dispatcher, Org Admin | Driver may request via TripException, never executes |
| `record_no_show` | Dispatcher, Org Admin, Driver (own active assignment) | From `en_route_to_pickup`/`arrived_at_pickup` only |
| `assign_driver` | Dispatcher, Org Admin | |
| `assign_vehicle` | Dispatcher, Org Admin | |
| `reassign_trip` | Dispatcher, Org Admin | Close-then-insert, atomic |
| `start_trip_to_pickup` | Driver (own active assignment) | Replaces generic "transition_trip_state" for this edge |
| `mark_arrived_at_pickup` | Driver (own active assignment) | |
| `mark_passenger_onboard` | Driver (own active assignment) | |
| `start_trip_to_destination` | Driver (own active assignment) | |
| `mark_arrived_at_destination` | Driver (own active assignment) | |
| `complete_trip` | Driver (own active assignment) | Requires `arrived_at_destination` first |
| `create_trip_note` | Dispatcher, Org Admin (either visibility); Driver (`driver_visible`, own trip) | |
| `change_trip_note_visibility` | Dispatcher, Org Admin only | Never Driver, even on their own note |
| `create_trip_exception` | Dispatcher, Org Admin (any type); Driver (own assigned trip) | |
| `resolve_trip_exception` | Dispatcher, Org Admin only | Never Driver |
| `deactivate_membership` | Organization Admin, Platform Admin | |
| `change_membership_role` | Organization Admin (within `{organization_admin, dispatcher, driver}`), Platform Admin | |
| `create_driver_profile` | Organization Admin | Not Dispatcher (least privilege) |
| `deactivate_driver` | Organization Admin | |
| `create_vehicle` | Organization Admin | Not Dispatcher |
| `update_vehicle` | Organization Admin | Not Dispatcher |
| `platform_correction` | Platform Admin only | Mandatory reason + AuditEvent, always |

## K. Field-level mutation rules

Generic Trip UPDATE is dangerous — different fields have different owners:

| Field group | Examples | Who may mutate | How |
|---|---|---|---|
| **Planning fields** | pickup/destination snapshot, scheduled date, appointment time, preferred pickup time, instructions | Dispatcher, Organization Admin | Normal update, only while Trip is non-terminal — never once `completed`/`cancelled`/`no_show` |
| **Lifecycle fields** | `current_state`, terminal timestamps (`completed_at`, etc.) | Nobody, directly | Only through the controlled transition boundary (`start_trip_to_pickup`, `cancel_trip`, etc.) — never a raw field UPDATE, not even by Organization Admin |
| **Tenant fields** | `organization_id` | Nobody, ever, for any ordinary role | Set once at creation from trusted server context; immutable after (§18) |
| **Reference fields** | `request_id`, `passenger_id` | Nobody, ordinarily, after creation | A wrong reference is a data-entry mistake, corrected only through the privileged administrative path, not a normal dispatcher edit |

Driver never has direct write access to planning fields, lifecycle fields (outside their own permitted transitions), tenant fields, or reference fields — their only Trip mutation surface is the named transition actions in §J.

## L. organization_id immutability

**For every tenant-owned table, `organization_id` is immutable for ordinary roles after row creation — no exceptions, no role gets an UPDATE grant on this column.** At creation time, ownership is always determined or validated from trusted server-side context (the acting user's verified membership, or the intake boundary's configured operating organization for public requests) — never trusted from client-supplied data. This applies uniformly across Membership, Driver, Passenger, Facility, Vehicle, TransportationRequest, Trip, TripAssignment, TripEvent, TripNote, TripException, and AuditEvent.

## M. Passenger, Facility, Vehicle, TransportationRequest, TripAssignment, TripEvent, TripNote, TripException, AuditEvent access — key rules

Most of these are already captured in §I/§J; the notable rules worth stating explicitly:

- **Passenger — confirmed, amended at P1-E1-S3A: Driver receives no generic direct SELECT on the canonical Passenger table at all**, not even a row-scoped one. This supersedes the earlier framing in this section (which had reduced the risk to "an existence check through the assignment chain" but still described it as a table-level SELECT grant). The reason is structural, not a tightening for its own sake: **RLS controls rows, but does not by itself guarantee minimum-necessary *column* exposure** — a Driver-scoped SELECT policy on Passenger, however narrowly row-scoped, would still return every column in the row unless a separate, easy-to-forget column-privilege layer were also correctly maintained. Removing table SELECT entirely removes that whole failure mode by construction.

  Instead, Driver-required passenger *information* — potentially: display name, phone number where operationally required, pickup information, destination information, permitted assistance requirements, companion information where relevant, and driver-visible instructions — is delivered through a **controlled, assignment-scoped read model**, not a table grant. Three implementation shapes are viable; schema/API design chooses the safest/simplest of these, not decided here:
  - a narrowly defined security-invoker view exposing only the driver-relevant columns, itself still gated by the full chain below;
  - a carefully scoped RPC returning exactly the fields a driver needs for one trip;
  - a trusted server query (server-side, service-role or equivalent) returning an explicit, fixed field set to the client — never a passthrough of a raw table row.

  **Do not build a universal Passenger read helper of any kind** — no single function/view/RPC that, given any passenger or trip identifier, returns passenger data broadly; every implementation must be scoped to one specific, currently-active, currently-assigned trip.

  The full authorization chain, restated precisely for this specific access path:

  ```
  auth user
    → active Membership
    → linked Driver
    → active/relevant TripAssignment
    → same Organization
    → permitted Trip
    → minimum-necessary driver data projection
  ```

  Direct knowledge of a `passenger_id` or `trip_id` grants nothing on its own — every link in the chain above must independently hold. Exactly which fields belong in "minimum-necessary" is a schema/API-design-time question (the bulleted list above is illustrative, not a finalized field set) — the principle, not the field list, is what's confirmed here.
- **Facility:** Driver reads only what's necessary for an assigned trip; no organization-wide facility browsing is granted to Driver unless a future product need justifies it (not assumed here). Public access remains none.
- **Vehicle:** Driver reads only their currently assigned vehicle, not the fleet. Dispatcher reads for assignment purposes but does not administer vehicles (§F).
- **TransportationRequest:** Driver gets no standing access at all — trip execution never requires exposing the inbound request record to a driver.
- **TripAssignment:** creation/reassignment happens only through the named operations actions (§J), never a raw Driver INSERT/UPDATE/DELETE. Historical rows are never deleted by any ordinary role.
- **TripEvent:** creation happens only through the controlled transition boundary or an equivalent trusted path — no human role gets a direct INSERT permission that lets them fabricate an event type unconnected to an actual permitted transition.
- **TripNote:** visibility classes and their access rules are exactly as confirmed in domain-model.md §B (entity 13) — restated in §I/§J above.
- **TripException:** Driver creates/reports on their own assigned trip; only Dispatcher/Organization Admin resolve.
- **AuditEvent:** no ordinary role writes it directly, ever; reads are organization-scoped for Organization Admin, all-organization for Platform Admin, none for Dispatcher or Driver.

## N. Membership lifecycle security

**States: `active`, `inactive` — the minimal set.** `invited`/`pending`/`suspended` are not added as separate domain-level states: an invitation not yet accepted is better represented by a nullable `accepted_at` timestamp on an otherwise-`active`-or-not-yet-relevant row than a new state, and "suspended" carries no behavioral difference from "inactive" — the *why* belongs in a reason field, not a new status value. This mirrors the same minimal-state philosophy already applied to TripAssignment and TripException.

**The critical rule: an inactive Membership grants zero organization access.** This must hold even if the auth session remains valid, the browser still holds tokens, a linked Driver profile still exists, or a client route remains reachable. This is only true in practice if RLS evaluates **live** Membership state on every request — never a cached or JWT-embedded role/status claim trusted as authoritative. **Recommendation: at MVP, RLS helper functions query the Membership table directly on each evaluation; no custom JWT claim is used for authorization-critical role/status data.** If a performance-motivated claim cache is introduced later, it must never be trusted for the active/inactive gate without a live check alongside it.

## O. Role changes

Permissions always follow the **current** Membership row read live from the database — never a UI's stale idea of what role a user has. Because RLS re-evaluates on every query (not once at login), a role change (`dispatcher → driver`, `organization_admin → dispatcher`, membership deactivation) takes effect on the very next database request — **no forced logout, token refresh, or special session reset is required**, provided the live-lookup recommendation in §N is followed. Database truth over stale claims, always.

## P. Multi-organization access

A user may hold multiple Membership rows, each with its own independent role. Authorization is always evaluated **for the specific organization the target row belongs to** — never a global "what's this user's role" lookup, and never stored as a single role on UserProfile. `organization_admin` in Org A and `dispatcher` in Org B on the same person are two entirely independent facts; an admin action attempted against Org B, by a user who is only a dispatcher there, is denied regardless of their standing in Org A.

## Q. Active organization context

A frontend `activeOrganizationId` selection is a **UI convenience only** — it decides what the interface currently displays, nothing more. It is never treated as proof of access. Every database row and every action independently validates the acting user's real, live Membership against that row's actual `organization_id` — a forged, stale, or simply wrong client-side `activeOrganizationId` has no effect on what the database will or won't return.

## R. Platform Admin / service role distinction

These are never the same thing:

| | Identity | Scope | Bypasses RLS? |
|---|---|---|---|
| **Service role** | System/infrastructure credential, no human identity | Whatever the specific server-side code path needs | Yes, entirely — which is exactly why it's restricted to trusted server code only (domain-model.md §L) |
| **Platform Admin** | A specific human, verified via PlatformAdminGrant | Deliberately scoped per §D — some direct reads, privileged mutations only through named, audited actions | No — Platform Admin access is still an authorization decision, evaluated and logged, not a raw credential swap |

**Service role usage principles:** controlled public intake (assigning `organization_id` server-side), administrative/system maintenance tasks, and trusted functions where no ordinary authenticated context exists. It is never used for ordinary user-initiated operations merely because it's more convenient than exercising real RLS — ordinary application functionality should go through real RLS whenever a real authenticated actor exists.

## S. Hard delete policy

**No ordinary hard DELETE, for any role, on:** Trip, TripAssignment, TripEvent, TripNote, TripException, AuditEvent, TransportationRequest, Driver (once any assignment history exists), Passenger (once any trip history exists). History matters more than tidiness for every one of these — `cancelled`/`resolved`/`inactive`/deactivated states exist specifically so nothing operationally meaningful is ever removed.

**Plausible narrow exceptions, only when provably zero historical references exist:** a Vehicle or Facility record added in error and never referenced by any TripAssignment/Trip; a Membership invited and never accepted. Even these are edge cases, not routine capabilities, and remain Organization Admin/Platform Admin actions, never a Dispatcher or Driver capability. No archive-field mechanism is introduced at this phase (per instruction) — this section documents philosophy, not a schema.

## T. RLS helper recommendations (not implemented)

| Helper | Purpose | Safety notes |
|---|---|---|
| `is_org_member(org_id)` | Active Membership check for the calling user in a specific org | Single-purpose; must query Membership live, not a cached claim |
| `has_org_role(org_id, allowed_roles)` | Role check within an org, implying active membership | Built on top of `is_org_member`; never grants based on a role value not present in Membership's actual allowed set |
| `current_driver_id(org_id)` | Resolves `auth.uid()` → the caller's Driver.id *for a specific organization* (a person may have separate Driver rows per org) | Narrow, single lookup; never returns a driver id from a different org than requested |
| `is_driver_assigned_to_trip(trip_id)` | Confirms the resolved driver has an active TripAssignment for this specific trip | Must independently verify organization consistency internally (Trip.organization_id = Assignment.organization_id = the driver's own org), not just assignment existence |
| `is_platform_admin()` | Checks the PlatformAdminGrant table for the current user | Must follow the SECURITY DEFINER rules in domain-model.md §L/§28: explicit `search_path`, validates `auth.uid()`, no dynamic SQL, never returns true from any input path other than a genuine grant row |

**General safety rules for all of the above:** each answers exactly one narrow question; none becomes a general-purpose "is this allowed" oracle. Any SECURITY DEFINER implementation must guard against recursive RLS (a helper reading a table that itself has RLS referencing the same helper) by being deliberately narrow and independently audited — these functions run with elevated context by necessity, which is precisely why they must stay minimal and never accept dynamic/arbitrary input that widens their effective capability.

**Explicitly excluded from this list, and from any future addition: a universal Passenger read helper** (e.g., a `get_passenger(passenger_id)` that returns passenger data given any identifier). Driver access to passenger information is never resolved by a passenger-keyed lookup — it is always resolved by starting from the driver's own active assignment and projecting only the fields needed for that one trip (§M). None of the five helpers above return passenger data; the eventual view/RPC/trusted-query that does must be its own narrowly-scoped mechanism, chosen at schema/API design time, not a generic helper reused across contexts.

## U. Future RLS policy shapes (illustrative, no SQL)

Policies should be small, clearly named, single-purpose, role-aware, and tenant-aware — never one large policy enumerating every role and exception. Illustrative future naming:

```
trips_select_org_operations          -- OA/Dispatcher read within their org
trips_select_assigned_driver         -- Driver read, own assignment only
trip_notes_select_operations         -- OA/Dispatcher read, both visibility classes
trip_notes_select_assigned_driver_visible  -- Driver read, driver_visible only, own trip
trip_assignments_select_own_driver   -- Driver read, own assignments only
audit_events_select_org_admin        -- OA read, own org only
audit_events_select_platform_admin   -- PA read, all orgs
```

**Implementation update (P1-E2-S1 → P1-E2-S3):** the three Driver-scoped policies above (`trips_select_assigned_driver`, `trip_notes_select_assigned_driver_visible`, `trip_assignments_select_own_driver`) were built exactly as illustrated in P1-E2-S1, then **retired** in P1-E2-S3 once the controlled Driver read API existed to replace them — RLS controls rows, not columns, and each was found to expose more columns than a Driver needs (full rationale: [driver-data-minimization.md](../security/driver-data-minimization.md), ZD-096). The OA/Dispatcher policies above remain exactly as illustrated, unchanged. This section is left as originally written (it documents the pre-implementation plan) rather than rewritten in place — see [rls-model.md](../security/rls-model.md) "Policy inventory" for the actual, current policy list.

## Authorization test matrix

The full adversarial suite (restated from the work item) that future implementation must pass, alongside the RLS matrix in domain-model.md §O and the transition matrix in lifecycle-model.md §S:

| Test | Scenario | Expected |
|---|---|---|
| A | Org Admin A reads an Org A Trip | ALLOW |
| B | Org Admin A reads an Org B Trip | DENY |
| C | Dispatcher A edits an allowed planning field on an Org A Trip | ALLOW |
| D | Dispatcher A attempts an `organization_id` change | DENY |
| E | Driver A reads their assigned Trip | ALLOW |
| F | Driver A reads another driver's Trip in the same org | DENY |
| G | Driver A reads an Org B Trip | DENY |
| H | Driver A reads the Passenger needed for their assigned Trip | ALLOW |
| I | Driver A browses another, unrelated Passenger | DENY |
| J | Driver A reads an `operations_only` TripNote | DENY |
| K | Driver A reads a `driver_visible` note on their own Trip | ALLOW |
| L | Driver A creates a `driver_visible` note on their own Trip | ALLOW, through the permitted action |
| M | Driver A creates a note on another driver's Trip | DENY |
| N | Driver A executes a valid transition on their own Trip | ALLOW, through the controlled transition boundary |
| O | Driver A sends an arbitrary raw Trip UPDATE | DENY |
| P | A now-inactive Membership repeats a previously valid request | DENY |
| Q | A user who is Org A admin and Org B driver attempts an admin action in Org B | DENY |
| R | A public user creates a TransportationRequest through the controlled intake path | ALLOW |
| S | A public user attempts to SELECT TransportationRequest | DENY |
| T | Dispatcher attempts to read or write PlatformAdminGrant | DENY |
| U | Organization Admin attempts to grant Platform Admin to anyone | DENY |
| V | Driver attempts to resolve a TripException | DENY |
| W | Any normal role attempts to DELETE a TripEvent | DENY |
| X | A Platform Admin correction is attempted without a recorded reason/AuditEvent | DENY by architecture — the action path doesn't accept the mutation without both |
| Y | A client bypasses the UI and calls the Supabase REST API directly | Same authorization result as through the application |
| Z | A forged `activeOrganizationId` (client) or `organization_id` (payload) is supplied | DENY / ignored — the database re-derives ownership from real Membership and row data, never client-supplied context |

**Role-change-specific tests, additionally required:**

| Test | Scenario | Expected |
|---|---|---|
| RC1 | `dispatcher → driver`: prior dispatcher permissions immediately unavailable, driver permissions immediately available, no re-login | Reflects live DB state on next request |
| RC2 | `organization_admin → dispatcher`: membership-management actions immediately denied | Same |
| RC3 | `active → inactive` membership: all organization access denied on the very next request | Same |
| RC4 | Driver's membership removed while a session is already open (existing token still valid) | Next request denied — live check, not session-cached |
| RC5 | Multi-org user switches their frontend "active organization" selection | The switch changes nothing about actual access — access was already, and remains, evaluated per-row against real Membership, regardless of what the UI displays |

## Storage security alignment

Restated, unchanged from domain-model.md §L invariant 13: any future Supabase Storage access must derive from the same Organization/Membership/Driver-assignment/visibility rules as database RLS — a secured table never implies its associated storage bucket is secured. Storage remains its own explicit, later security gate, not something inherited for free.

## Open questions

None of the following block the Authorization Security Gate — each is either already flagged upstream as non-blocking or is a refinement opportunity, not a missing decision that secure enforcement depends on:

1. **Exact minimum-necessary Passenger field set for Driver projection** (which specific fields from the illustrative list in §M — display name, phone, pickup/destination, assistance/companion info, instructions — end up in the actual view/RPC/query, vs. the full record Organization Admin/Dispatcher see) — a schema-design-time question. The *mechanism* (no table SELECT; controlled projection only) is now confirmed and no longer open — only the exact field list remains.
2. **Driver acknowledgement of assignment and driver decline capability** — carried over from lifecycle-model.md, still unresolved, still non-blocking.
3. **Whether Vehicle/Facility should ever permit true hard DELETE for zero-history rows** — a minor implementation convenience question, not a security requirement either way.
4. **Whether a future custom JWT claim cache is ever introduced for performance** — if so, it must be paired with the live-check discipline in §N; not needed at MVP.

## Security invariants

Consolidating this phase's contributions to the running security-invariant list (domain-model.md §R, lifecycle-model.md throughout):

1. Authorization is enforced at the database (RLS) and the controlled transition boundary — never only in UI, route guards, or client-side role checks.
2. `operations_staff` does not exist as a role; `dispatcher` is the one canonical operations-tier role, adopted only because no genuine permission difference was ever identified — not a default preference.
3. PlatformAdminGrant is the only representation of platform-wide authority; it is never expressed via `Membership.role`, `UserProfile.is_admin`, or any client-controlled claim.
4. Platform Admin does not receive standing, unrestricted, cross-organization SELECT on operational tenant tables (Passenger, Trip, TripAssignment, TripEvent, TripNote, TripException, TransportationRequest, Driver, Vehicle, Facility) — only on Organization, PlatformAdminGrant, Membership, and AuditEvent. Anything beyond that is a controlled, audited support action, never a blanket policy.
5. `organization_id` is immutable for every ordinary role, on every tenant-owned table, after row creation — with no exceptions carved out anywhere in this model.
6. Driver access to any resource requires the full live relationship chain (auth user → active membership → linked Driver → active assignment → organization consistency → permitted relationship) — knowing an ID alone grants nothing.
7. Trip lifecycle, planning, tenant, and reference fields have different owners and different mutation paths (§K) — no actor gets unrestricted UPDATE on a Trip row as a whole.
8. Membership active/inactive status is evaluated live on every request; an inactive membership grants zero access regardless of session/token state, and no cached claim is trusted for this check.
9. Authorization is always evaluated for the specific target organization of the row in question — never a single global role, never inherited from a user's strongest role anywhere.
10. A frontend "active organization" selection is never authorization — only ever a display convenience.
11. Hard DELETE is presumptively denied for every entity with plausible historical significance (§S); deactivation/cancellation/resolution states exist specifically so history is never destroyed by routine action.
12. RLS helper functions are narrow, single-purpose, and never become a general-permission oracle; none is a universal bypass.
13. Service-role usage is restricted to genuinely system-level paths — never substituted for real RLS merely for convenience when an authenticated actor exists.
14. Storage security must be designed to the same standard as database RLS when its time comes — never assumed inherited from table-level policies.
15. **Driver receives no generic direct SELECT on the Passenger table, under any RLS policy shape** (P1-E1-S3A) — row-level scoping alone is never treated as sufficient for Passenger, because RLS controls rows but not column exposure. Driver-required passenger information is delivered only through a controlled, assignment-scoped projection (a narrow view, RPC, or trusted server query), never a table grant, and never a universal passenger-lookup helper.

---

## Security gate

**AUTHORIZATION SECURITY GATE — READY** *(re-confirmed at P1-E1-S3A)*

Every requirement is met: MVP organization roles are finalized (`organization_admin`, `dispatcher`, `driver` — Operations Staff explicitly removed, not preserved by default); the Platform Admin model is finalized (PlatformAdminGrant, with an explicit, justified boundary on what it does and doesn't get direct read access to); Driver access scope is explicit and chain-based (§G); **the Passenger/Driver access rule is now explicit at the correct layer** — no generic Driver SELECT on the Passenger table at all, with a controlled, assignment-scoped projection instead (§M, security invariant 15) — closing the gap between row-level RLS and column-level minimum-necessary exposure that the original pass had left implicit; TripNote visibility is fully integrated into the role model (§I/§J/§M); TripException rights are explicit (create ≠ resolve); Membership inactivity behavior is explicit and requires live evaluation, not cached claims (§N); multi-organization authorization is explicit and per-row (§P); the service-role boundary is explicit and distinguished from Platform Admin (§R); the action matrix is complete and refined beyond the initial list (§J); the CRUD matrix is complete across all 15 entities and 7 actors (§I), now reflecting the amended Passenger row; a future RLS helper strategy is defined with safety notes, explicitly excluding any universal Passenger helper (§T); and the adversarial authorization test matrix, including role-change-specific tests, is defined (§Authorization test matrix).

The remaining open questions (§Open questions) are refinements — the exact minimum-necessary Passenger field list (mechanism now confirmed, field list still schema-design-time), driver acknowledgement/decline, narrow hard-delete edge cases, and a hypothetical future JWT claim cache — none of which prevent secure RLS schema design for anything already specified.
