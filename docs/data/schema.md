# Zenward Platform — Database Schema

**Work item:** P1-E2-S1 — Supabase Schema + RLS Foundation
**Phase:** P1-E2 — Data Architecture
**Status:** Implemented locally, migrations applied and tested. Not deployed to any remote/production project.
**Last updated:** 2026-08-30

This document describes the persistent schema implemented in `supabase/migrations/`. It encodes exactly what [domain-model.md](../product/domain-model.md), [lifecycle-model.md](../product/lifecycle-model.md), and [authorization-model.md](../product/authorization-model.md) confirmed — no new product decisions are made here. See [rls-model.md](../security/rls-model.md) for the security layer and [rls-test-matrix.md](../security/rls-test-matrix.md) for verification.

## Naming convention

`snake_case`, plural table names, matching the work item's own example list exactly (`organizations`, `memberships`, `user_profiles`, `platform_admin_grants`, `drivers`, `passengers`, `facilities`, `vehicles`, `transportation_requests`, `trips`, `trip_assignments`, `trip_events`, `trip_notes`, `trip_exceptions`, `audit_events`).

## Identifiers

UUID primary keys (`gen_random_uuid()`) throughout. UUIDs are identifiers, not secrets — no authorization decision anywhere depends on a UUID being hard to guess (see the adversarial "guess another Trip/TripNote UUID" tests, both DENY). No human-readable reference generation (e.g. `ZW-240829-018`) is implemented in this phase.

## Timestamps

`timestamptz` throughout for anything operationally meaningful (created_at, occurred_at, assigned_at, ended_at, etc.). `updated_at` (maintained by a shared `set_updated_at()` trigger) is added only where a row is genuinely mutated in place after creation — **not** on `trip_events` or `audit_events`, which are append-only by design, and not on `trip_assignments` (mutated once, to close it, but that's `ended_at`/`end_reason`, not a general-purpose `updated_at`).

## `organizations.timezone` — operational timezone (P1-E3-S2C)

Every `timestamptz` above remains an absolute UTC-normalized instant — that never changes. `organizations.timezone` (`text`, `NOT NULL`, added 20260901100000_organization_operational_timezone.sql) is the separate, explicit answer to "what calendar day / local clock time does this instant represent for THIS organization" — the org-scoped counterpart to every `timestamptz` column. Must be a genuine IANA identifier (`America/New_York`) or the literal `UTC`; a `CHECK` constraint (`organizations_timezone_valid_iana`, backed by `public.is_valid_iana_timezone()`, which queries the `pg_timezone_names` system catalog) rejects fixed offsets and abbreviations (`EST`, `GMT-5`) outright — never merely a convention. No application-level UPDATE path exists for it yet (deliberately — work item §6 of P1-E3-S2C: not a self-service feature). Full detail: [operational-timezone.md](../product/operational-timezone.md).

## Enum vs. CHECK strategy — deliberately CHECK, not native ENUM

Every canonical state/role/visibility column (`memberships.role`, `memberships.status`, `transportation_requests.state`, `trips.state`, `trip_notes.visibility`, `trip_exceptions.status`) uses `text` + a `CHECK (... in (...))` constraint, not a native PostgreSQL `ENUM` type. Reason: adding a new allowed value to a `CHECK` constraint is a plain, transaction-safe migration (`DROP CONSTRAINT` / `ADD CONSTRAINT`); altering a native `ENUM` type has real migration friction (`ALTER TYPE ... ADD VALUE` can't run inside the same transaction as other DDL in older Postgres, and the new value can't be used in the same transaction that adds it even where permitted). Given how many of these state lists are explicitly documented as provisional or likely to gain values later (e.g., `trip_exceptions.exception_type`, deliberately left as unconstrained free text — taxonomy not finalized), CHECK constraints keep evolution simple without sacrificing the "no unconstrained free text for canonical states" requirement.

## Entities

Each table's own migration file carries the full column-by-column rationale as SQL comments (`comment on table ...`); this section summarizes tenant ownership and key relationships.

| Table | Classification | Tenant key | Key relationships |
|---|---|---|---|
| `organizations` | SYSTEM-OWNED | self (`id`) | Root — everything else hangs off `organization_id` |
| `memberships` | TENANT-OWNED | `organization_id` | `user_id` → `auth.users`; unique per (org, user) |
| `user_profiles` | USER-OWNED | none | `id` → `auth.users` (1:1) |
| `platform_admin_grants` | SYSTEM-OWNED | none (org-independent) | `user_id` → `auth.users`, unique |
| `drivers` | TENANT-OWNED | `organization_id` | optional `user_id` → `auth.users`, `ON DELETE SET NULL` |
| `passengers` | TENANT-OWNED | `organization_id` | no `user_id` (no self-service accounts) |
| `facilities` | TENANT-OWNED | `organization_id` | — |
| `vehicles` | TENANT-OWNED | `organization_id` | — |
| `transportation_requests` | PUBLIC-INTAKE → TENANT-OWNED | `organization_id` | optional `passenger_id` (composite FK) |
| `trips` | TENANT-OWNED | `organization_id` | `passenger_id` (required), `request_id` (nullable), `pickup_facility_id`/`destination_facility_id` (nullable, soft) — all composite FKs |
| `trip_assignments` | TENANT-OWNED | `organization_id` (direct) | `trip_id`, `driver_id`, `vehicle_id` — all composite FKs |
| `trip_events` | TENANT-OWNED | `organization_id` (direct) | `trip_id` (composite FK) |
| `trip_notes` | TENANT-OWNED | `organization_id` (direct) | `trip_id` (composite FK) |
| `trip_exceptions` | TENANT-OWNED | `organization_id` (direct) | `trip_id` (composite FK) |
| `audit_events` | SYSTEM-OWNED | `organization_id` (direct) | polymorphic `(entity_type, entity_id)` — not FK-able by construction |
| `driver_location_updates` (P1-E3-S7A) | TENANT-OWNED, HIGH RLS RISK | `organization_id` (direct) | `driver_id`, `trip_id`, `assignment_id` — all composite FKs. Append-only history, no separate "latest" table — see [driver-location-architecture.md](../product/driver-location-architecture.md) §5 |

**Not created**, per explicit instruction: a standalone `Requester` table (snapshot fields on `transportation_requests` instead), a generic `Location` table (Trip carries immutable address snapshots instead — see below), an `operations_staff` entity/role, a `platform_admin` Membership role value, and any billing/claims/ratings/route-optimization/clinical-record tables.

## Trip address snapshots

`trips.pickup_description` / `trips.destination_description` are plain, immutable text fields set at trip creation — never re-derived from `passengers` or `facilities`, which may change later. `pickup_facility_id`/`destination_facility_id` are optional, soft (`ON DELETE SET NULL`) references used only for reporting/context linkage. This is the approved hybrid strategy (domain-model.md §J) — no generic `Location` table.

## Tenant-consistency constraints (the critical mechanism)

Every child table that references another tenant-owned table does so via a **composite foreign key** anchored on a `UNIQUE (id, organization_id)` constraint on the parent — never a plain single-column FK for cross-entity references. This makes a cross-tenant relationship (e.g., a Trip in Org A referencing a Driver in Org B) a **schema-level impossibility**, verified directly by the adversarial test suite (tests V/W/X and the constraint-test suite's request/facility/note/exception/event org-consistency checks — all "DATABASE REJECTS", confirmed passing).

Composite-FK relationships implemented:
- `trip_assignments(trip_id, organization_id)` → `trips(id, organization_id)`
- `trip_assignments(driver_id, organization_id)` → `drivers(id, organization_id)`
- `trip_assignments(vehicle_id, organization_id)` → `vehicles(id, organization_id)`
- `trips(request_id, organization_id)` → `transportation_requests(id, organization_id)`
- `trips(passenger_id, organization_id)` → `passengers(id, organization_id)`
- `trips(pickup_facility_id, organization_id)` / `(destination_facility_id, organization_id)` → `facilities(id, organization_id)`, `ON DELETE SET NULL`
- `transportation_requests(passenger_id, organization_id)` → `passengers(id, organization_id)`
- `trip_events(trip_id, organization_id)`, `trip_notes(trip_id, organization_id)`, `trip_exceptions(trip_id, organization_id)` → `trips(id, organization_id)`

`audit_events.(entity_type, entity_id)` is the one deliberate exception — a generic polymorphic reference that cannot be FK-constrained by construction (domain-model.md §26); mitigated by `audit_events` being SYSTEM-OWNED and insert-only via a trusted path (not yet built), which independently derives and stamps the correct `organization_id`, never trusting client input.

## organization_id immutability

Beyond RLS and column-level privilege restrictions (see [rls-model.md](../security/rls-model.md)), every tenant-owned table has a `BEFORE UPDATE` trigger (`prevent_organization_id_change()`, defined once in the first migration and attached per table) that raises an exception if `organization_id` is ever changed — a schema-level guarantee independent of policy logic, verified by the constraint-test suite even when run as the `postgres` superuser (which bypasses RLS entirely but still cannot bypass this trigger).

## Active-assignment constraint

`trip_assignments` has a partial unique index — `UNIQUE (trip_id) WHERE ended_at IS NULL` — enforcing at most one active assignment per trip at the database level. Verified by adversarial test Y (a second active-assignment insert is rejected with a unique-constraint violation).

## Indexes

Beyond the uniqueness/FK-support indexes already implied above:

| Table | Index | Why |
|---|---|---|
| `memberships` | `(user_id, organization_id) WHERE status = 'active'` | The single most frequently evaluated query in the whole RLS model — every helper function runs it |
| `memberships` | `(organization_id)` | Org-admin membership listing |
| `drivers` | `(organization_id)`, `(user_id) WHERE user_id IS NOT NULL` | Org-scoped listing; `current_driver_id()` resolution |
| `passengers`, `facilities`, `vehicles` | `(organization_id)` | Org-scoped listing |
| `transportation_requests` | `(organization_id)`, `(organization_id, state, created_at)` | Org-scoped listing; the review queue, oldest-pending-first |
| `trips` | `(organization_id)`, `(organization_id, state)`, `(organization_id, scheduled_pickup_at)`, `(passenger_id)`, `(request_id) WHERE request_id IS NOT NULL` | Ops board queries by state/schedule; passenger trip history; request→trip lookup |
| `trip_assignments` | `(trip_id)`, `(driver_id)`, `(organization_id)`, plus the active-assignment partial unique index | "Who is on this trip," "this driver's assignments," and the one-active-assignment constraint all in one place |
| `trip_events` | `(trip_id, occurred_at)`, `(organization_id)` | The per-trip timeline read, in order |
| `trip_notes` | `(trip_id)`, `(trip_id, visibility)` | Per-trip notes; visibility-filtered read for driver policies |
| `trip_exceptions` | `(trip_id)`, `(organization_id, status)` | Per-trip exceptions; the "open exceptions" queue |
| `audit_events` | `(organization_id, occurred_at)`, `(entity_type, entity_id)` | Org-scoped audit timeline; "history of this specific row" |
| `driver_location_updates` | `(trip_id, recorded_at DESC)`, `(organization_id, recorded_at DESC)`, `(assignment_id)` | "Latest location per Trip" derivation (`DISTINCT ON`-style query); org-scoped Dispatch reads |

## Generated types

Not generated in this phase — no application code consumes this schema yet (work item §60 explicitly defers connecting application screens). Generation command, for when it's needed: `supabase gen types typescript --local > src/types/database.ts` (do not hand-edit the output).

## Deferred read models

**Driver → Passenger data** has no table-level SELECT grant at all (ZD-080) — see [rls-model.md](../security/rls-model.md) "Driver data minimization" for the full rationale and the candidate future mechanisms (security-invoker view / scoped RPC / trusted server query), none of which are built in this phase.

## Local development

```bash
supabase start      # starts the local stack (see supabase/config.toml for the non-default ports this project uses)
supabase db reset   # re-applies all migrations + supabase/seed.sql fresh
supabase stop        # stops the local stack
```

**Port note:** this project's local Supabase ports are shifted +10 from the CLI's defaults (API 54331, DB 54332, Studio 54333, etc.) because another, unrelated local Supabase project was already running on the default ports on the machine this was built on. See `supabase/config.toml` and `docs/product/product-definition.md` §14 for the underlying environment condition. This has no bearing on any deployed environment — only local dev port selection.

## Nemryn Plus entitlement — `organization_modules` (NP-P1-S1)

**Ownership:** platform-owned. One row per `(organization_id, module)`, `module = 'plus'` only. Separate from `organizations.status` by design (ZD-207, was PD-02), and never read by Core.

**Columns:**
- `status`: `trial | active | expired | cancelled | disabled`.
- `restriction`: `read_only | no_access`, only while `disabled`.
- Trial history: `trial_started_at` and `trial_ends_at` (set together; the start is never cleared, which enforces one trial per organization) and `trial_extension_count` (0..1).
- `access_ends_at`: only while `active`.
- `status_reason` (3–500, internal), `updated_by`, `created_at`, `updated_at`.

**Integrity and access:**
- Triggers: `set_updated_at` and `prevent_organization_id_change`.
- RLS on, no policy, no client or service_role privilege (privilege-contract class A).
- RPCs: [mutation-api.md](./mutation-api.md#nemryn-plus-entitlement-rpcs-np-p1-s1).

## Nemryn Plus public inquiry intake (NP-P2-S7-A)

Migrations: `20261024100000_plus_inquiries_foundation.sql` (tables, constraints) and `20261024110000_plus_inquiries_rpcs.sql` (functions). Canonical column rules: [NP-P2-S7-public-inquiry-intake-design.md](../product/NP-P2-S7-public-inquiry-intake-design.md) §4.

| Table | Ownership / access | Key rules |
|---|---|---|
| `plus_inquiry_public_access` | platform-owned **activation allowlist**; class A (RLS on, no policy, no privilege for any role) | one row per organization; reason 1–500; written only by `platform_set_plus_inquiry_public_access` (ZD-262) |
| `plus_inquiry_forms` | tenant-owned; RLS `plus_can_read`; authenticated SELECT | `unique (organization_id)`; server key `inq_` + 32 hex (unique, stable); status draft / published / disabled; eight-type service subset; `config_version`, `version`; triggers `set_updated_at`, `prevent_organization_id_change` |
| `plus_inquiries` | tenant-owned; RLS `plus_can_read`; column SELECT (never `idempotency_key`) | composite FKs to form and contact; `unique (organization_id, idempotency_key)`; phone / email = the `plus_contacts` CHECKs; closed sets; status new / converted / dismissed with consistent reason, contact and triage columns; `version`; indexes `(organization_id, status, received_at desc, id)`, email, phone digits |
| `plus_inquiry_rate_limit_events` | class A | `inq_` form key, 64-hex client hash, `occurred_at`; no purge (PD-11) |

Additive changes to existing tables:
- `plus_opportunities.inquiry_id`: composite FK, unique where not null, set-once trigger `plus_opportunities_inquiry_immutable`.
- `plus_communication_consents`:
  - `inquiry_id` with a composite FK `(inquiry_id, organization_id, contact_id)`;
  - `captured_via` + `web_form`;
  - `consent_text_version` required iff `web_form`;
  - `plus_consents_web_form_check`;
  - the client column SELECT + `inquiry_id`.
- `plus_activities`: `activity_type` + `inquiry_converted`, with `plus_activities_inquiry_subject_check`.

