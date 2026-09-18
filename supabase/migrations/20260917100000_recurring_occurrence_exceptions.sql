-- recurring_occurrence_exceptions — deliberate single-date occurrence
-- skips for a RecurringArrangement (P1-E2-S1C). Classification:
-- TENANT-OWNED, direct organization_id, same discipline as every other
-- tenant table.
--
-- This table means EXACTLY ONE thing: "do not expect an occurrence from
-- this arrangement on this specific local service date." It carries no
-- Trip id, no Passenger id, no medical reason, no facility, no return-
-- leg concept, no appointment data, no Driver/Vehicle, no billing —
-- deliberately narrower than the arrangement itself, matching the
-- phase's own explicit exclusion list.
--
-- No ExpectedOccurrence table exists or is created here — "expected"
-- remains a pure derivation (pattern + horizon + lifecycle facts,
-- computed on read by src/lib/operations/recurring-care-core.ts); this
-- table only records the one additional fact a pure derivation cannot
-- know on its own: that a particular date was deliberately excluded by
-- a human decision, not merely absent from the pattern.

create table public.recurring_occurrence_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  recurring_arrangement_id uuid not null,
  service_date date not null,
  reason text not null,
  -- Actor/provenance reference — bare `references auth.users (id)`, no
  -- ON DELETE clause, matching the exact convention confirmed in S1B
  -- (recurring_arrangements.created_by and every other actor-reference
  -- column in this schema: trip_assignments.assigned_by, trip_
  -- exceptions.created_by/resolved_by, trip_events.actor_user_id,
  -- trip_notes.author_user_id, audit_events.actor_user_id, driver_
  -- invites.invited_by/accepted_by). The future controlled skip RPC
  -- derives this from auth.uid() server-side — never client-supplied.
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  -- Composite FK anchored on recurring_arrangements' own (id,
  -- organization_id) uniqueness (established in S1B) — an Org A
  -- exception referencing an Org B arrangement is a schema-level
  -- impossibility, not merely something RLS is trusted to catch. No new
  -- unique(id, organization_id) anchor is added on THIS table — nothing
  -- else in this schema needs to composite-FK against
  -- recurring_occurrence_exceptions, so per the phase's own "only if
  -- required by existing conventions" instruction, none is added.
  foreign key (recurring_arrangement_id, organization_id)
    references public.recurring_arrangements (id, organization_id),
  -- At most one active skip fact per (arrangement, date) — a duplicate
  -- skip for the same arrangement/date adds no new meaning. The same
  -- service_date may of course be skipped for many different
  -- arrangements (no constraint on service_date alone). This unique
  -- constraint also backs the exact lookup shape the future evaluator
  -- needs ((recurring_arrangement_id, service_date)), so no separate
  -- explicit index is added for it — redundant with the constraint's
  -- own backing index.
  unique (recurring_arrangement_id, service_date),
  -- Nonblank + length-bounded, matching recurring_arrangements' own
  -- pickup_description/destination_description bound exactly (2000
  -- chars, itself reused from create_trip's existing runtime
  -- validation) — no new number invented for this table.
  check (btrim(reason) <> '' and char_length(reason) <= 2000)
  -- Deliberately NOT constrained here (P1-E2-S1C §7, by explicit
  -- instruction): service_date is not required to be one of the
  -- arrangement's current days_of_week, is not required to be within
  -- [start_date, end_date], and is not required to be "today or later."
  -- A future pattern edit must not retroactively invalidate a genuine
  -- historical skip record — the evaluator itself is responsible for
  -- ignoring a skip date that is no longer a pattern date under the
  -- CURRENT arrangement facts (see recurring-care-core.ts), never the
  -- database rejecting the historical fact outright.
);

comment on table public.recurring_occurrence_exceptions is
  'TENANT-OWNED (P1-E2-S1C). Records a deliberate single-date skip for one RecurringArrangement — never a Trip, never a status/lifecycle concept, never soft-delete machinery. A future controlled "unskip" RPC deletes the row (S1C §10 — not implemented here) and writes audit_events; the skip table itself is not the audit trail. See docs/reports/p1-e2-s1c-recurring-occurrence-exceptions-assurance-core.txt.';

-- No `updated_at` column exists on this table (an append-then-delete
-- fact, never edited in place) and no INSERT/UPDATE grant exists for any
-- authenticated role (see privileges below) — so neither
-- `set_updated_at` nor `prevent_organization_id_change` is attached.
-- This matches the exact precedent already established for trip_events
-- and audit_events (both also zero-client-UPDATE-grant tables, both
-- also carrying neither trigger) — a trigger guarding against an UPDATE
-- path that cannot exist at all would be dead code, not defense in
-- depth.

create index recurring_occurrence_exceptions_organization_id_idx
  on public.recurring_occurrence_exceptions (organization_id);

alter table public.recurring_occurrence_exceptions enable row level security;

-- =============================================================================
-- Privileges and RLS policies
-- =============================================================================
-- SELECT only. No INSERT/UPDATE/DELETE grant to `authenticated` at all —
-- the application can READ exception facts but cannot write them yet, by
-- design (P1-E2-S1C §9/§10). A future controlled skip/unskip RPC (not
-- this phase) will expose deliberate mutation through the same trusted-
-- path discipline as every other controlled mutation in this schema.
grant select on public.recurring_occurrence_exceptions to authenticated;

create policy recurring_occurrence_exceptions_select_org_operations
  on public.recurring_occurrence_exceptions for select to authenticated
  using (public.has_org_role(organization_id, array['organization_admin', 'dispatcher']));

-- *** No Driver policy of any kind on this table. *** A skip fact is
-- part of the same arrangement-level pattern information ZD-080-style
-- reasoning already excludes Driver from (P1-E2-S1B "DRIVER PRIVACY") —
-- a Driver has no legitimate need to know which dates of a Passenger's
-- standing schedule were deliberately skipped, any more than they need
-- the pattern itself.
--
-- No Platform Admin policy either, for the identical reason already
-- documented and verified for recurring_arrangements in S1B: the
-- actually-implemented Platform Admin standing read scope covers
-- exactly organizations, platform_admin_grants, and audit_events — not
-- Membership (despite domain-model.md's own aspirational matrix), and
-- not any other tenant-operational table. This table stays inside the
-- same "specific, controlled, audited support action, never a blanket
-- policy" set.
