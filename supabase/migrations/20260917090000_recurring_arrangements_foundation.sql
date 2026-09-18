-- recurring_arrangements — Recurring Care Assurance domain foundation
-- (P1-E2-S1B, locked by P1-E2-S1A/P1-E2-S1A1 — see docs/reports/
-- p1-e2-s1a-recurring-care-assurance-foundation-audit.txt and
-- docs/reports/p1-e2-s1a1-recurring-care-domain-decision-lock.txt for
-- the full product/architecture reasoning behind every choice below).
--
-- Classification: TENANT-OWNED, direct organization_id, same discipline
-- as every other tenant table in this schema. Represents a STANDING
-- transportation PATTERN ("Mrs. Cole needs dialysis transport Mon/Wed/
-- Fri, 8:00 AM"), never an individual Trip and never a
-- TransportationRequest — those remain exactly what they already are
-- (domain-model.md §F/§B). No recurrence EVALUATION exists yet (S1C
-- owns expected-date generation + the assurance evaluator); no skip-date
-- exception mechanism exists yet (also S1C); no lifecycle mutation RPC
-- exists yet (S1D owns create/edit/pause/resume/end). This migration is
-- structural foundation only — the table is readable by authorized
-- Operations users the moment this migration applies, but not writable
-- by the application at all until S1D ships its controlled RPCs. That is
-- intentional, not an oversight.

-- =============================================================================
-- Days-of-week validator/canonicalizer
-- =============================================================================
-- PostgreSQL CHECK constraints cannot contain a subquery directly (a hard
-- syntactic restriction, not merely a style preference) — the dedup/sort
-- logic below therefore lives inside this small, pure, IMMUTABLE helper
-- function, and the table's own CHECK constraint calls it as a single
-- function-call expression only. ISO weekday numbering (1=Monday...
-- 7=Sunday) is chosen specifically because it is the exact vocabulary
-- Postgres's own EXTRACT(ISODOW FROM ...) already returns — the future
-- S1C evaluator composes with this representation with zero translation
-- layer (docs/reports/p1-e2-s1a1-... "DAYS-OF-WEEK REPRESENTATION").
--
-- Returns true only when the array is non-null, has at least one
-- element, every element is a real ISO weekday in [1,7] with no NULLs,
-- has no duplicate values, AND is already in canonical ascending order —
-- an unsorted or duplicate-containing array is REJECTED outright (never
-- silently normalized by this function), so canonicalization is the
-- responsibility of the future S1D write path, not a database-side
-- auto-correction.
--
-- Underscore-prefixed per this project's own established convention for
-- internal-only helpers never meant to be called directly by application
-- code (matching `_is_valid_trip_transition`,
-- 20260831100200_controlled_trip_mutations.sql) — revoked from `public`
-- below and deliberately never granted to `authenticated` at all: no
-- legitimate direct-client code path needs to call it (the table has no
-- authenticated INSERT/UPDATE grant in this phase at all — see RLS
-- below — and any future S1D RPC runs SECURITY DEFINER, which evaluates
-- this CHECK under the RPC owner's own privilege, not the caller's,
-- exactly like every other CHECK-backing validator in this schema).
create or replace function public._is_canonical_days_of_week(p_days smallint[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select
    p_days is not null
    and cardinality(p_days) >= 1
    and not exists (
      select 1 from unnest(p_days) as d
      where d is null or d < 1 or d > 7
    )
    and p_days = (
      select array_agg(distinct d order by d)
      from unnest(p_days) as d
      where d is not null
    );
$$;

comment on function public._is_canonical_days_of_week(smallint[]) is
  'True only for a non-empty, duplicate-free, ascending-sorted array of ISO weekday numbers (1=Monday..7=Sunday) with no out-of-range or NULL elements. Backs recurring_arrangements.days_of_week''s CHECK constraint. Internal-only: revoked from public, never granted to authenticated — no direct-client code path exists that needs to call it, and the future S1D controlled RPC evaluates this CHECK under its own SECURITY DEFINER privilege.';

revoke all on function public._is_canonical_days_of_week(smallint[]) from public;

-- =============================================================================
-- recurring_arrangements
-- =============================================================================
create table public.recurring_arrangements (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  passenger_id uuid not null,
  pickup_description text not null,
  destination_description text not null,
  -- Wall-clock local time, paired with `timezone` below — a repeating
  -- commitment ("8:00 AM"), never a single timestamptz instant the way
  -- Trip.scheduled_pickup_at is.
  pickup_time time without time zone not null,
  days_of_week smallint[] not null,
  start_date date not null,
  -- Nullable: open-ended standing care vs. a known end (e.g. "8 weeks of
  -- post-surgical PT").
  end_date date,
  -- Timezone SNAPSHOT, not a live read of organizations.timezone — a
  -- later Organization timezone change must never silently reinterpret
  -- an already-standing schedule's own wall-clock meaning (the exact
  -- same immutable-snapshot reasoning already proven for Trip's own
  -- pickup/destination address fields, domain-model.md §J). Reuses the
  -- SAME validated-IANA mechanism already built and proven for
  -- organizations.timezone (20260901100000_organization_operational_
  -- timezone.sql) — no second validator introduced.
  timezone text not null,
  status text not null default 'active',
  -- Set the instant status transitions to 'paused'; cleared back to null
  -- on resume. Doubles as the assurance evaluator's own deterministic
  -- "no new expected occurrences from this local date onward" cutoff —
  -- deliberately not a second, separate pause_effective_date concept
  -- (docs/reports/p1-e2-s1a1-... "PAUSE SEMANTICS").
  paused_at timestamptz,
  ended_at timestamptz,
  ended_reason text,
  -- Actor/provenance reference — bare `references auth.users (id)`, no
  -- ON DELETE clause, matching every other actor-reference column in
  -- this schema exactly (trip_assignments.assigned_by,
  -- trip_exceptions.created_by/resolved_by, trip_events.actor_user_id,
  -- trip_notes.author_user_id, audit_events.actor_user_id,
  -- driver_invites.invited_by/accepted_by) — never SET NULL (that shape
  -- is reserved specifically for drivers.user_id's own distinct,
  -- explicitly-documented case) and never CASCADE (reserved for true
  -- identity-owning tables: user_profiles, memberships,
  -- platform_admin_grants). Nullable, like every one of those
  -- precedents. The future S1D create RPC derives this from auth.uid()
  -- server-side — never client-supplied.
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  -- Composite FK anchored on passengers' own (id, organization_id)
  -- uniqueness — the standard cross-tenant-leakage mitigation already
  -- used for every such reference in this schema (domain-model.md §N):
  -- an Org A arrangement referencing an Org B passenger is a
  -- schema-level impossibility, not merely something RLS is trusted to
  -- catch.
  foreign key (passenger_id, organization_id) references public.passengers (id, organization_id),
  -- Status vocabulary is exactly these three values, no others.
  check (status in ('active', 'paused', 'ended')),
  -- Static row-shape integrity for paused_at, exactly three permitted
  -- shapes (P1-E2-S1B1 — corrected from S1B's own original one-directional
  -- version, which allowed the invalid active+paused_at combination):
  --   active  -> paused_at IS NULL (an active arrangement was never left
  --              mid-pause; this also pins down the locked S1A1 resume
  --              semantics — resuming clears paused_at back to null, so an
  --              active row can never legitimately carry a stale value).
  --   paused  -> paused_at IS NOT NULL (an arrangement cannot BE paused
  --              without recording when).
  --   ended   -> paused_at is intentionally UNCONSTRAINED either way.
  --              S1A1 did not settle whether ending FROM a paused state
  --              retains or clears paused_at, and this migration still
  --              does not presume an answer — both an arrangement ended
  --              directly from active (paused_at null) and one ended from
  --              paused (paused_at non-null, retained as history) must
  --              remain valid row shapes. S1D decides and enforces the
  --              actual transition procedurally; no schema surgery is
  --              required here for either eventual choice.
  check (
    (status = 'active' and paused_at is null)
    or (status = 'paused' and paused_at is not null)
    or status = 'ended'
  ),
  -- Static row-shape integrity for ended_at/ended_reason, exactly two
  -- permitted shapes: a non-ended arrangement (active or paused) must
  -- carry neither (this direction was already locked in S1B); an ended
  -- arrangement must carry both a timestamp and a real, non-blank reason
  -- — mirrors trips.cancellation_reason and trip_assignments.end_reason's
  -- own existing mandatory-reason precedent for terminal/closing
  -- transitions exactly.
  check (
    (status in ('active', 'paused') and ended_at is null and ended_reason is null)
    or (status = 'ended' and ended_at is not null and ended_reason is not null and btrim(ended_reason) <> '')
  ),
  check (end_date is null or end_date >= start_date),
  -- Nonblank + length-bounded, matching create_trip's own existing
  -- runtime validation of pickup_description/destination_description
  -- exactly (20260916110000_request_trip_passenger_integrity.sql: btrim
  -- nonblank, max 2000 chars) — enforced here at the TABLE level rather
  -- than only in a future RPC, since this migration's own charter is a
  -- structural foundation that must reject malformed data even before
  -- any RPC exists to validate it first.
  check (btrim(pickup_description) <> '' and char_length(pickup_description) <= 2000),
  check (btrim(destination_description) <> '' and char_length(destination_description) <= 2000),
  check (public.is_valid_iana_timezone(timezone)),
  check (public._is_canonical_days_of_week(days_of_week))
);

comment on table public.recurring_arrangements is
  'TENANT-OWNED (P1-E2-S1B). A standing recurring transportation PATTERN, never an individual Trip and never a TransportationRequest. No recurrence evaluation, skip-date exception mechanism, or lifecycle mutation RPC exists yet (S1C/S1C/S1D respectively) — this table is read-only to the application until S1D ships. See docs/reports/p1-e2-s1a1-recurring-care-domain-decision-lock.txt for the full locked domain contract.';

comment on column public.recurring_arrangements.timezone is
  'IANA timezone SNAPSHOT captured from organizations.timezone at creation time (future S1D RPC) — never re-read live. Protects an already-standing schedule''s own wall-clock meaning from a later Organization timezone change.';

comment on column public.recurring_arrangements.days_of_week is
  'ISO weekday numbers (1=Monday..7=Sunday, matching EXTRACT(ISODOW FROM date)), non-empty, deduplicated, canonically ascending — enforced by _is_canonical_days_of_week(). Not an RRULE, not a cron expression, not free text (locked, P1-E2-S1A1).';

comment on column public.recurring_arrangements.paused_at is
  'Set when status transitions to paused; cleared on resume. Also serves as the assurance evaluator''s own deterministic "no new expected occurrences from this local date onward" cutoff while paused.';

create trigger recurring_arrangements_set_updated_at
  before update on public.recurring_arrangements
  for each row execute function public.set_updated_at();

create trigger recurring_arrangements_prevent_org_change
  before update on public.recurring_arrangements
  for each row execute function public.prevent_organization_id_change();

-- Baseline tenant-scoped retrieval, matching every other table's own
-- organization_id index.
create index recurring_arrangements_organization_id_idx
  on public.recurring_arrangements (organization_id);

-- Supports the S1C evaluator's own primary query shape: "active
-- arrangements for my org" (and, later, filtering by status generally).
create index recurring_arrangements_org_status_idx
  on public.recurring_arrangements (organization_id, status);

-- Supports "arrangements for this passenger" (a Passenger-detail-style
-- lookup, and the composite-FK's own natural query direction).
create index recurring_arrangements_org_passenger_idx
  on public.recurring_arrangements (organization_id, passenger_id);

-- No GIN index on days_of_week — a 14-day evaluator operates over an
-- already-bounded set of active arrangements per organization (typically
-- small at MVP scale); adding GIN indexing now would be premature
-- optimization for a query pattern S1C hasn't even written yet
-- (P1-E2-S1B §13's own explicit instruction).

alter table public.recurring_arrangements enable row level security;

-- =============================================================================
-- trips.recurring_arrangement_id — the authoritative Trip link
-- =============================================================================
-- Permanently nullable: the overwhelming majority of Trips are, and will
-- remain, ordinary one-off Trips with no arrangement at all; every
-- existing production Trip row remains valid (this column defaults to
-- NULL for all of them); recurrence never becomes mandatory for Trip.
--
-- This is the EXPLICIT link P1-E2-S1A1 corrected into the domain
-- foundation (moved out of the originally-proposed S1E) — an inferred
-- match (passenger + date + pickup/destination text) was identified as
-- fragile by the audit itself and is not used. No uniqueness constraint
-- of any kind is added on (recurring_arrangement_id, service_date) or
-- similar — an occurrence date may legitimately carry more than one
-- linked Trip (outbound + return being the clearest current example;
-- P1-E2-S1A1 "MULTIPLE TRIPS PER DATE").
alter table public.trips
  add column recurring_arrangement_id uuid;

comment on column public.trips.recurring_arrangement_id is
  'Nullable, permanent. Links this Trip to the RecurringArrangement it fulfills an occurrence of — NULL for every ordinary one-off Trip. Explicit link, never inferred (P1-E2-S1A1). Composite-FK protected against cross-org reference. No uniqueness constraint: multiple Trips (e.g. outbound + return) may legitimately share one arrangement, even on the same date.';

-- Composite FK anchored on recurring_arrangements' own (id,
-- organization_id) uniqueness — the identical cross-tenant-leakage
-- mitigation already used for every other Trip reference (passenger_id,
-- request_id, pickup_facility_id, destination_facility_id).
alter table public.trips
  add constraint trips_recurring_arrangement_id_org_fkey
  foreign key (recurring_arrangement_id, organization_id)
  references public.recurring_arrangements (id, organization_id);

-- Partial index, mirroring trips_request_id_idx's own existing exact
-- shape (only non-null values are ever queried by this column).
create index trips_recurring_arrangement_id_idx
  on public.trips (recurring_arrangement_id)
  where recurring_arrangement_id is not null;

-- =============================================================================
-- Privileges and RLS policies
-- =============================================================================
-- SELECT only. No INSERT/UPDATE/DELETE grant to `authenticated` at all —
-- matching the exact precedent already established for trip_events and
-- audit_events (both structurally similar: a table with real lifecycle/
-- security semantics that is deliberately NOT client-writable until a
-- controlled RPC mechanism exists). Raw client mutation is therefore not
-- merely policy-denied, it is impossible at the grant level regardless
-- of any future policy addition mistake — defense in depth. S1D
-- introduces the controlled create/edit/pause/resume/end RPCs; no
-- INSERT/UPDATE/DELETE policy is added here in anticipation of them.
grant select on public.recurring_arrangements to authenticated;

create policy recurring_arrangements_select_org_operations
  on public.recurring_arrangements for select to authenticated
  using (public.has_org_role(organization_id, array['organization_admin', 'dispatcher']));

-- *** CRITICAL: no Driver policy of any kind on this table. ***
-- Mirrors ZD-080's own "no generic Driver SELECT on Passenger, ever"
-- rule by identical reasoning (P1-E2-S1A1 "DRIVER PRIVACY") — a standing
-- recurring pattern reveals more about a Passenger's routine than any
-- single Trip does, so it deserves at least the same protection, never
-- less. A Driver continues to see only the individual Trip they are
-- assigned to, through the existing, unmodified, assignment-scoped
-- trips_select_assigned_driver policy — nothing about the broader
-- pattern is ever exposed merely because a Driver holds one linked
-- Trip's assignment. No Driver policy exists on this table, deliberately,
-- and none is planned at any future phase without a new, separately
-- reviewed product decision.
--
-- No Platform Admin policy either — verified directly against the
-- actually-implemented RLS policies (20260830131700_rls_policies.sql),
-- not assumed from domain-model.md's own aspirational access matrix
-- alone: `is_platform_admin()` backs a policy on exactly THREE tables
-- today — organizations, platform_admin_grants, audit_events — never
-- memberships (domain-model.md's matrix lists Platform Admin C/R/U on
-- Membership as a future-tense aspiration; no such policy actually
-- exists in the shipped migration). Every other tenant-operational
-- table requires a specific, controlled, audited support action instead
-- of a blanket policy. No repository-wide invariant conflicts with
-- keeping RecurringArrangement inside that same "controlled support
-- action, not standing policy" set, so none is added here.
