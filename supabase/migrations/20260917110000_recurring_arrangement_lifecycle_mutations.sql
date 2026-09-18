-- P1-E2-S1D — Recurring Arrangement Lifecycle + Occurrence Exception
-- Mutations.
--
-- Introduces the ONLY trusted application mutation paths for
-- recurring_arrangements and recurring_occurrence_exceptions — both
-- tables have carried zero authenticated INSERT/UPDATE/DELETE grant
-- since they were created (S1B/S1C), by explicit design, in anticipation
-- of this exact phase. Reuses every established convention from
-- 20260831100200_controlled_trip_mutations.sql and
-- 20260916100000_request_mutation_foundation.sql exactly, audited fresh
-- before writing anything below:
--   - The 6-code error contract (ZD-085): ZW001 unauthorized, ZW002
--     not_found (no existence oracle — cross-tenant and nonexistent are
--     deliberately indistinguishable), ZW003 stale_state, ZW004
--     illegal_transition, ZW005 assignment_conflict (not used in this
--     migration — no assignment concept here), ZW006 invalid_input.
--   - `organization_id` is a REQUESTED CONTEXT, never authority on its
--     own (create_trip/log_transportation_request/link_request_passenger
--     convention) — every function re-validates it live via
--     `has_org_role(p_organization_id, ...)` against the caller's own
--     current, ACTIVE Membership, and the target row's own lookup is
--     ALSO scoped by `organization_id = p_organization_id` in the same
--     WHERE clause as its id — double-checked, never trusted from the
--     parameter alone. auth.uid() is the sole actor identity; no
--     function accepts a caller-supplied actor/user id anywhere.
--   - Row-level `FOR UPDATE` locking before any state-legality check
--     (ZD-086), same fixed order every function uses (target row first,
--     nothing else needs locking in this schema shape).
--   - The `changed: boolean` idempotency signal (ZD-090) on every
--     result type — false means a safe no-op, true means a real
--     mutation happened; an idempotent no-op never writes a duplicate
--     audit_events row (mirrors resolve_trip_exception's own precedent
--     exactly).
--   - SECURITY DEFINER, explicit `set search_path = public, pg_temp`,
--     `revoke all ... from public` + `grant execute ... to authenticated`
--     only (never anon, never PUBLIC) on every exposed function.
--   - No dynamic SQL anywhere in this migration.
--
-- One controlled RPC per legal action (not a single generic "mutate"
-- function), matching the driver_start_to_pickup/driver_arrive_at_pickup/
-- etc. one-function-per-edge precedent exactly — the action is fixed by
-- which function was called, never a caller-supplied verb/target-state
-- parameter.
--
-- SCOPE BOUNDARY: this migration does NOT touch trips.recurring_
-- arrangement_id (S1E owns the controlled Trip-creation integration —
-- create_trip itself is not modified here), does not add any UI/server
-- action, and does not modify recurring-care-core.ts/recurring-care.ts
-- (the S1C read model composes whatever these RPCs write, unchanged).

-- =============================================================================
-- A. Composite return types
-- =============================================================================
-- One shared shape for all 5 arrangement-lifecycle RPCs (create/edit/
-- pause/resume/end) — mirrors trip_exception_result being shared across
-- report_trip_exception/resolve_trip_exception: each of these functions
-- answers the identical question, "what is the current state of this
-- RecurringArrangement now?"
create type public.recurring_arrangement_result as (
  arrangement_id uuid,
  organization_id uuid,
  passenger_id uuid,
  pickup_description text,
  destination_description text,
  pickup_time time,
  days_of_week smallint[],
  start_date date,
  end_date date,
  timezone text,
  status text,
  paused_at timestamptz,
  ended_at timestamptz,
  ended_reason text,
  created_by uuid,
  created_at timestamptz,
  changed boolean
);

comment on type public.recurring_arrangement_result is
  'Shared return shape for create_recurring_arrangement, edit_recurring_arrangement, pause_recurring_arrangement, resume_recurring_arrangement, and end_recurring_arrangement — each describes "the current state of one RecurringArrangement row" (mirrors trip_exception_result). changed=false on an idempotent no-op (pause-when-paused, resume-when-active, end-when-ended); changed=true whenever a real mutation happened, including create/edit (which have no no-op path).';

create type public.recurring_occurrence_exception_result as (
  exception_id uuid,
  arrangement_id uuid,
  organization_id uuid,
  service_date date,
  reason text,
  created_by uuid,
  created_at timestamptz,
  changed boolean
);

comment on type public.recurring_occurrence_exception_result is
  'Shared return shape for skip_recurring_occurrence and unskip_recurring_occurrence. On skip''s idempotent no-op (already skipped), returns the REAL already-persisted reason, never the caller''s redundant one. On unskip''s idempotent no-op (nothing to remove), exception_id/reason are null and changed=false.';

-- =============================================================================
-- B. create_recurring_arrangement — the sole controlled creation path.
-- =============================================================================
-- Mirrors create_trip's own structure closely: auth -> live role check ->
-- explicit field validation (all ZW006, no existence oracle) -> Passenger
-- validation (identical shape to create_trip's own passenger check,
-- REQUIRED here — a standing commitment always has a Passenger, unlike
-- Trip's optional linkage concerns) -> organization timezone SNAPSHOT
-- (never caller-suppliable) -> INSERT with status hard-coded 'active',
-- paused_at/ended_at/ended_reason hard-coded NULL, created_by hard-coded
-- auth.uid() -> one audit_events row.
--
-- PASSENGER STATUS DECISION (work item §6, audited against create_trip's
-- own existing convention before locking, not invented fresh): create_trip
-- already requires status='active' for its own (required) passenger_id
-- parameter (20260916110000_request_trip_passenger_integrity.sql,
-- unchanged). The identical rule is reused here, unweakened: an inactive
-- Passenger cannot truthfully receive a NEW standing transportation
-- commitment — the composite FK alone is not weakened either way (an
-- inactive Passenger's id still satisfies the FK; the additional
-- status='active' predicate is enforced here in the RPC, exactly where
-- create_trip enforces its own equivalent rule, not as a schema
-- constraint).
create or replace function public.create_recurring_arrangement(
  p_organization_id uuid,
  p_passenger_id uuid,
  p_pickup_description text,
  p_destination_description text,
  p_pickup_time time,
  p_days_of_week smallint[],
  p_start_date date,
  p_end_date date default null
)
returns public.recurring_arrangement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pickup_description text;
  v_destination_description text;
  v_days_of_week smallint[];
  v_timezone text;
  v_new public.recurring_arrangements;
  v_result public.recurring_arrangement_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- ---------------------------------------------------------------------
  -- Field validation — same nonblank/length-bound style as create_trip's
  -- own pickup/destination validation (2000 chars, reused unchanged).
  -- ---------------------------------------------------------------------
  v_pickup_description := nullif(btrim(p_pickup_description), '');
  v_destination_description := nullif(btrim(p_destination_description), '');
  if v_pickup_description is null or v_destination_description is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if length(v_pickup_description) > 2000 or length(v_destination_description) > 2000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_pickup_time is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_start_date is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- ---------------------------------------------------------------------
  -- days_of_week NORMALIZATION (work item §7) — caller may supply any
  -- order, with duplicates; canonicalized here to a deduplicated,
  -- ascending array BEFORE the INSERT reaches the table's own
  -- _is_canonical_days_of_week CHECK, which REJECTS (never normalizes) a
  -- non-canonical array. UI clients are never required to understand
  -- canonical storage ordering.
  -- ---------------------------------------------------------------------
  select array_agg(distinct d order by d) into v_days_of_week
  from unnest(p_days_of_week) as d
  where d is not null;

  if v_days_of_week is null or cardinality(v_days_of_week) = 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if exists (select 1 from unnest(v_days_of_week) as d where d < 1 or d > 7) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  -- Defensive final assertion (mirrors report_trip_exception's own
  -- duplicated-validation style) — by construction this can never fail
  -- given the two checks above, but confirms the table's own CHECK will
  -- never be reached in a rejecting state, giving a clean ZW006 instead
  -- of a raw constraint-violation error in the impossible event of a
  -- coding regression here. Callable directly despite carrying no
  -- authenticated grant: this function's own elevated SECURITY DEFINER
  -- execution context, not the caller's privilege, is what's in effect
  -- (identical reasoning to _lock_driver_active_assignment's own internal-
  -- only call sites).
  if not public._is_canonical_days_of_week(v_days_of_week) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- ---------------------------------------------------------------------
  -- Passenger: required, same organization, active (see this function's
  -- own header comment for why active is required, audited against
  -- create_trip's own identical rule). No existence oracle — nonexistent
  -- and foreign-org both produce the same ZW006.
  -- ---------------------------------------------------------------------
  if p_passenger_id is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not exists (
    select 1 from public.passengers
    where id = p_passenger_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- ---------------------------------------------------------------------
  -- Timezone SNAPSHOT (work item §5) — read live from Organization.timezone
  -- at creation time only, never caller-suppliable, never re-read after
  -- this INSERT (matches recurring_arrangements.timezone's own column
  -- comment from S1B, written in anticipation of exactly this RPC).
  -- Unreachable NULL branch: has_org_role already proved an active
  -- Membership row exists in p_organization_id, and memberships.
  -- organization_id references organizations(id) — an organization row
  -- with no timezone (NOT NULL since P1-E3-S2C) cannot exist. Checked
  -- anyway, per this codebase's own established defensive-check style.
  -- ---------------------------------------------------------------------
  select timezone into v_timezone from public.organizations where id = p_organization_id;
  if v_timezone is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- ---------------------------------------------------------------------
  -- The arrangement itself. status/paused_at/ended_at/ended_reason/
  -- created_by are all hard-coded — never a parameter, never caller-
  -- influenced in any way (work item §5), exactly mirroring create_trip's
  -- own hard-coded 'scheduled' state.
  -- ---------------------------------------------------------------------
  insert into public.recurring_arrangements (
    organization_id, passenger_id, pickup_description, destination_description,
    pickup_time, days_of_week, start_date, end_date, timezone, status, created_by
  ) values (
    p_organization_id, p_passenger_id, v_pickup_description, v_destination_description,
    p_pickup_time, v_days_of_week, p_start_date, p_end_date, v_timezone, 'active', auth.uid()
  )
  returning * into v_new;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'recurring_arrangement', v_new.id, 'recurring_arrangement_created', auth.uid(),
    null,
    jsonb_build_object(
      'passenger_id', v_new.passenger_id, 'pickup_description', v_new.pickup_description,
      'destination_description', v_new.destination_description, 'pickup_time', v_new.pickup_time,
      'days_of_week', v_new.days_of_week, 'start_date', v_new.start_date, 'end_date', v_new.end_date,
      'timezone', v_new.timezone, 'status', v_new.status
    )
  );

  v_result.arrangement_id := v_new.id;
  v_result.organization_id := v_new.organization_id;
  v_result.passenger_id := v_new.passenger_id;
  v_result.pickup_description := v_new.pickup_description;
  v_result.destination_description := v_new.destination_description;
  v_result.pickup_time := v_new.pickup_time;
  v_result.days_of_week := v_new.days_of_week;
  v_result.start_date := v_new.start_date;
  v_result.end_date := v_new.end_date;
  v_result.timezone := v_new.timezone;
  v_result.status := v_new.status;
  v_result.paused_at := v_new.paused_at;
  v_result.ended_at := v_new.ended_at;
  v_result.ended_reason := v_new.ended_reason;
  v_result.created_by := v_new.created_by;
  v_result.created_at := v_new.created_at;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date) is
  'Organization Admin / Dispatcher only. The sole controlled path to create a RecurringArrangement — status is always ''active'', paused_at/ended_at/ended_reason always NULL, created_by always auth.uid(), timezone always an Organization.timezone SNAPSHOT at creation time — none of these five fields is ever caller-influenced. Passenger must exist, same organization, status=''active'' (ZW006 otherwise, no existence oracle — same rule create_trip already enforces for its own passenger_id). days_of_week is normalized (deduplicated, ascending) before write; caller may supply any order. Non-idempotent by design (no natural idempotency key for creating new standing demand), matching create_trip/log_transportation_request.';

revoke all on function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date) from public;
grant execute on function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date) to authenticated;

-- =============================================================================
-- C. edit_recurring_arrangement — pattern-field mutation only.
-- =============================================================================
-- Legal only while active or paused (ZW004 from ended). Never touches
-- status/paused_at/ended_at/ended_reason/passenger_id/timezone/
-- organization_id/created_by — those are either immutable identity
-- (§8: passenger_id, timezone, organization_id, created_by) or owned by
-- their own dedicated lifecycle RPCs (status/paused_at/ended_at/
-- ended_reason). Never touches trips (no bulk update, no cascade, no
-- schedule rewrite) — an existing linked Trip is an already-independent
-- operational record, untouched by a later pattern edit (§10).
create or replace function public.edit_recurring_arrangement(
  p_organization_id uuid,
  p_arrangement_id uuid,
  p_pickup_description text,
  p_destination_description text,
  p_pickup_time time,
  p_days_of_week smallint[],
  p_start_date date,
  p_end_date date default null
)
returns public.recurring_arrangement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_arrangement public.recurring_arrangements;
  v_pickup_description text;
  v_destination_description text;
  v_days_of_week smallint[];
  v_result public.recurring_arrangement_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_arrangement
  from public.recurring_arrangements
  where id = p_arrangement_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_arrangement.status = 'ended' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  v_pickup_description := nullif(btrim(p_pickup_description), '');
  v_destination_description := nullif(btrim(p_destination_description), '');
  if v_pickup_description is null or v_destination_description is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if length(v_pickup_description) > 2000 or length(v_destination_description) > 2000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_pickup_time is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_start_date is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select array_agg(distinct d order by d) into v_days_of_week
  from unnest(p_days_of_week) as d
  where d is not null;

  if v_days_of_week is null or cardinality(v_days_of_week) = 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if exists (select 1 from unnest(v_days_of_week) as d where d < 1 or d > 7) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not public._is_canonical_days_of_week(v_days_of_week) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  update public.recurring_arrangements
    set pickup_description = v_pickup_description,
        destination_description = v_destination_description,
        pickup_time = p_pickup_time,
        days_of_week = v_days_of_week,
        start_date = p_start_date,
        end_date = p_end_date
    where id = p_arrangement_id
    returning * into v_arrangement;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'recurring_arrangement', v_arrangement.id, 'recurring_arrangement_edited', auth.uid(),
    jsonb_build_object(
      'pickup_description', v_arrangement.pickup_description, 'destination_description', v_arrangement.destination_description,
      'pickup_time', v_arrangement.pickup_time, 'days_of_week', v_arrangement.days_of_week,
      'start_date', v_arrangement.start_date, 'end_date', v_arrangement.end_date
    ),
    jsonb_build_object(
      'pickup_description', v_pickup_description, 'destination_description', v_destination_description,
      'pickup_time', p_pickup_time, 'days_of_week', v_days_of_week,
      'start_date', p_start_date, 'end_date', p_end_date
    )
  );

  v_result.arrangement_id := v_arrangement.id;
  v_result.organization_id := v_arrangement.organization_id;
  v_result.passenger_id := v_arrangement.passenger_id;
  v_result.pickup_description := v_arrangement.pickup_description;
  v_result.destination_description := v_arrangement.destination_description;
  v_result.pickup_time := v_arrangement.pickup_time;
  v_result.days_of_week := v_arrangement.days_of_week;
  v_result.start_date := v_arrangement.start_date;
  v_result.end_date := v_arrangement.end_date;
  v_result.timezone := v_arrangement.timezone;
  v_result.status := v_arrangement.status;
  v_result.paused_at := v_arrangement.paused_at;
  v_result.ended_at := v_arrangement.ended_at;
  v_result.ended_reason := v_arrangement.ended_reason;
  v_result.created_by := v_arrangement.created_by;
  v_result.created_at := v_arrangement.created_at;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.edit_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date) is
  'Organization Admin / Dispatcher only. Edits ONLY pickup_description/destination_description/pickup_time/days_of_week/start_date/end_date — status/paused_at/ended_at/ended_reason/passenger_id/timezone/organization_id/created_by are structurally unreachable from this function''s own UPDATE statement (each is simply never mentioned in its SET list). Legal only while active or paused (ZW004 from ended). Never touches linked Trips (no bulk update, no cascade, no schedule rewrite) — affects only future derived occurrences with no independent Trip record yet. days_of_week is normalized identically to create_recurring_arrangement. No idempotency no-op path (always writes one audit_events row per call, matching create_trip''s own non-idempotent-by-design posture — no test in this phase requires edit idempotency).';

revoke all on function public.edit_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date) from public;
grant execute on function public.edit_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date) to authenticated;

-- =============================================================================
-- D. pause_recurring_arrangement
-- =============================================================================
-- Legal: active -> paused only. Idempotent no-op if already paused
-- (changed=false, paused_at NOT touched, no duplicate audit event).
-- ZW004 if ended (terminal). No reason parameter (work item §11 —
-- deliberately kept minimal; no existing mutation convention in this
-- schema strongly favors an optional reason for a non-terminal,
-- reversible transition like this one, unlike cancel_trip/
-- end_recurring_arrangement's own REQUIRED reason for a genuinely
-- terminal/destructive action).
create or replace function public.pause_recurring_arrangement(
  p_organization_id uuid,
  p_arrangement_id uuid
)
returns public.recurring_arrangement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_arrangement public.recurring_arrangements;
  v_result public.recurring_arrangement_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_arrangement
  from public.recurring_arrangements
  where id = p_arrangement_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_arrangement.status = 'paused' then
    v_result.arrangement_id := v_arrangement.id;
    v_result.organization_id := v_arrangement.organization_id;
    v_result.passenger_id := v_arrangement.passenger_id;
    v_result.pickup_description := v_arrangement.pickup_description;
    v_result.destination_description := v_arrangement.destination_description;
    v_result.pickup_time := v_arrangement.pickup_time;
    v_result.days_of_week := v_arrangement.days_of_week;
    v_result.start_date := v_arrangement.start_date;
    v_result.end_date := v_arrangement.end_date;
    v_result.timezone := v_arrangement.timezone;
    v_result.status := v_arrangement.status;
    v_result.paused_at := v_arrangement.paused_at;
    v_result.ended_at := v_arrangement.ended_at;
    v_result.ended_reason := v_arrangement.ended_reason;
    v_result.created_by := v_arrangement.created_by;
    v_result.created_at := v_arrangement.created_at;
    v_result.changed := false;
    return v_result;
  end if;

  if v_arrangement.status <> 'active' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  update public.recurring_arrangements
    set status = 'paused', paused_at = now()
    where id = p_arrangement_id
    returning * into v_arrangement;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'recurring_arrangement', v_arrangement.id, 'recurring_arrangement_paused', auth.uid(),
    jsonb_build_object('status', 'active', 'paused_at', null),
    jsonb_build_object('status', 'paused', 'paused_at', v_arrangement.paused_at)
  );

  v_result.arrangement_id := v_arrangement.id;
  v_result.organization_id := v_arrangement.organization_id;
  v_result.passenger_id := v_arrangement.passenger_id;
  v_result.pickup_description := v_arrangement.pickup_description;
  v_result.destination_description := v_arrangement.destination_description;
  v_result.pickup_time := v_arrangement.pickup_time;
  v_result.days_of_week := v_arrangement.days_of_week;
  v_result.start_date := v_arrangement.start_date;
  v_result.end_date := v_arrangement.end_date;
  v_result.timezone := v_arrangement.timezone;
  v_result.status := v_arrangement.status;
  v_result.paused_at := v_arrangement.paused_at;
  v_result.ended_at := v_arrangement.ended_at;
  v_result.ended_reason := v_arrangement.ended_reason;
  v_result.created_by := v_arrangement.created_by;
  v_result.created_at := v_arrangement.created_at;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.pause_recurring_arrangement(uuid, uuid) is
  'Organization Admin / Dispatcher only. Legal only active -> paused (ZW004 from ended). Idempotent no-op if already paused (changed=false, paused_at NOT touched, no duplicate audit event). Never touches linked Trips or occurrence exceptions. No reason parameter (deliberately minimal, work item §11).';

revoke all on function public.pause_recurring_arrangement(uuid, uuid) from public;
grant execute on function public.pause_recurring_arrangement(uuid, uuid) to authenticated;

-- =============================================================================
-- E. resume_recurring_arrangement
-- =============================================================================
-- Legal: paused -> active only. Idempotent no-op if already active. ZW004
-- if ended.
create or replace function public.resume_recurring_arrangement(
  p_organization_id uuid,
  p_arrangement_id uuid
)
returns public.recurring_arrangement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_arrangement public.recurring_arrangements;
  v_previous_paused_at timestamptz;
  v_result public.recurring_arrangement_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_arrangement
  from public.recurring_arrangements
  where id = p_arrangement_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_arrangement.status = 'active' then
    v_result.arrangement_id := v_arrangement.id;
    v_result.organization_id := v_arrangement.organization_id;
    v_result.passenger_id := v_arrangement.passenger_id;
    v_result.pickup_description := v_arrangement.pickup_description;
    v_result.destination_description := v_arrangement.destination_description;
    v_result.pickup_time := v_arrangement.pickup_time;
    v_result.days_of_week := v_arrangement.days_of_week;
    v_result.start_date := v_arrangement.start_date;
    v_result.end_date := v_arrangement.end_date;
    v_result.timezone := v_arrangement.timezone;
    v_result.status := v_arrangement.status;
    v_result.paused_at := v_arrangement.paused_at;
    v_result.ended_at := v_arrangement.ended_at;
    v_result.ended_reason := v_arrangement.ended_reason;
    v_result.created_by := v_arrangement.created_by;
    v_result.created_at := v_arrangement.created_at;
    v_result.changed := false;
    return v_result;
  end if;

  if v_arrangement.status <> 'paused' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  v_previous_paused_at := v_arrangement.paused_at;

  update public.recurring_arrangements
    set status = 'active', paused_at = null
    where id = p_arrangement_id
    returning * into v_arrangement;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'recurring_arrangement', v_arrangement.id, 'recurring_arrangement_resumed', auth.uid(),
    jsonb_build_object('status', 'paused', 'paused_at', v_previous_paused_at),
    jsonb_build_object('status', 'active', 'paused_at', null)
  );

  v_result.arrangement_id := v_arrangement.id;
  v_result.organization_id := v_arrangement.organization_id;
  v_result.passenger_id := v_arrangement.passenger_id;
  v_result.pickup_description := v_arrangement.pickup_description;
  v_result.destination_description := v_arrangement.destination_description;
  v_result.pickup_time := v_arrangement.pickup_time;
  v_result.days_of_week := v_arrangement.days_of_week;
  v_result.start_date := v_arrangement.start_date;
  v_result.end_date := v_arrangement.end_date;
  v_result.timezone := v_arrangement.timezone;
  v_result.status := v_arrangement.status;
  v_result.paused_at := v_arrangement.paused_at;
  v_result.ended_at := v_arrangement.ended_at;
  v_result.ended_reason := v_arrangement.ended_reason;
  v_result.created_by := v_arrangement.created_by;
  v_result.created_at := v_arrangement.created_at;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.resume_recurring_arrangement(uuid, uuid) is
  'Organization Admin / Dispatcher only. Legal only paused -> active (ZW004 from ended). Idempotent no-op if already active. paused_at is cleared to NULL on a real resume. Never touches linked Trips or occurrence exceptions.';

revoke all on function public.resume_recurring_arrangement(uuid, uuid) from public;
grant execute on function public.resume_recurring_arrangement(uuid, uuid) to authenticated;

-- =============================================================================
-- F. end_recurring_arrangement
-- =============================================================================
-- Legal: active -> ended OR paused -> ended. Requires a nonblank reason.
-- Idempotent no-op if already ended (original ended_reason/ended_at
-- preserved, never overwritten by a later caller's own reason).
--
-- LOCKED PROCEDURAL DECISION (work item §13): the UPDATE below never
-- mentions paused_at in its SET list at all — so ending from 'active'
-- leaves paused_at at its already-NULL value (unchanged), and ending
-- from 'paused' leaves paused_at at whatever timestamp it already held
-- (retained as historical context) — the exact locked behavior for BOTH
-- cases, achieved with zero branching, not two different code paths that
-- could drift out of sync with each other.
create or replace function public.end_recurring_arrangement(
  p_organization_id uuid,
  p_arrangement_id uuid,
  p_reason text
)
returns public.recurring_arrangement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_arrangement public.recurring_arrangements;
  v_reason text;
  v_previous_status text;
  v_previous_paused_at timestamptz;
  v_result public.recurring_arrangement_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Reason required, same bound as cancel_trip/record_no_show's own
  -- terminal-reason validation (recurring_arrangements.ended_reason
  -- carries no column-level length CHECK — only nonblank — so this RPC
  -- supplies the same 500-char ceiling this schema already uses for
  -- every other terminal-transition reason, rather than leaving it
  -- unbounded).
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_arrangement
  from public.recurring_arrangements
  where id = p_arrangement_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_arrangement.status = 'ended' then
    v_result.arrangement_id := v_arrangement.id;
    v_result.organization_id := v_arrangement.organization_id;
    v_result.passenger_id := v_arrangement.passenger_id;
    v_result.pickup_description := v_arrangement.pickup_description;
    v_result.destination_description := v_arrangement.destination_description;
    v_result.pickup_time := v_arrangement.pickup_time;
    v_result.days_of_week := v_arrangement.days_of_week;
    v_result.start_date := v_arrangement.start_date;
    v_result.end_date := v_arrangement.end_date;
    v_result.timezone := v_arrangement.timezone;
    v_result.status := v_arrangement.status;
    v_result.paused_at := v_arrangement.paused_at;
    v_result.ended_at := v_arrangement.ended_at;
    v_result.ended_reason := v_arrangement.ended_reason;
    v_result.created_by := v_arrangement.created_by;
    v_result.created_at := v_arrangement.created_at;
    v_result.changed := false;
    return v_result;
  end if;

  -- Only active/paused remain (the table's own 3-value status CHECK
  -- makes any other value unreachable) — both are legal starting points
  -- for end, so no further transition-legality check is needed here.
  v_previous_status := v_arrangement.status;
  v_previous_paused_at := v_arrangement.paused_at;

  update public.recurring_arrangements
    set status = 'ended', ended_at = now(), ended_reason = v_reason
    where id = p_arrangement_id
    returning * into v_arrangement;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (
    p_organization_id, 'recurring_arrangement', v_arrangement.id, 'recurring_arrangement_ended', auth.uid(),
    jsonb_build_object('status', v_previous_status, 'paused_at', v_previous_paused_at),
    jsonb_build_object('status', 'ended', 'ended_at', v_arrangement.ended_at, 'ended_reason', v_arrangement.ended_reason, 'paused_at', v_arrangement.paused_at),
    v_reason
  );

  v_result.arrangement_id := v_arrangement.id;
  v_result.organization_id := v_arrangement.organization_id;
  v_result.passenger_id := v_arrangement.passenger_id;
  v_result.pickup_description := v_arrangement.pickup_description;
  v_result.destination_description := v_arrangement.destination_description;
  v_result.pickup_time := v_arrangement.pickup_time;
  v_result.days_of_week := v_arrangement.days_of_week;
  v_result.start_date := v_arrangement.start_date;
  v_result.end_date := v_arrangement.end_date;
  v_result.timezone := v_arrangement.timezone;
  v_result.status := v_arrangement.status;
  v_result.paused_at := v_arrangement.paused_at;
  v_result.ended_at := v_arrangement.ended_at;
  v_result.ended_reason := v_arrangement.ended_reason;
  v_result.created_by := v_arrangement.created_by;
  v_result.created_at := v_arrangement.created_at;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.end_recurring_arrangement(uuid, uuid, text) is
  'Organization Admin / Dispatcher only. Legal from active OR paused -> ended (terminal; the table''s own status CHECK makes any other starting value unreachable). Reason required (1-500 chars). LOCKED: ending from active leaves paused_at NULL; ending from paused RETAINS the existing paused_at as historical context — both achieved by never mentioning paused_at in this function''s own UPDATE SET list, not by branching. Idempotent no-op if already ended — the ORIGINAL ended_at/ended_reason are never overwritten by a later, redundant end call. Never touches linked Trips or occurrence exceptions (no cascade, no cancellation, no cleanup) — both remain exactly as they were.';

revoke all on function public.end_recurring_arrangement(uuid, uuid, text) from public;
grant execute on function public.end_recurring_arrangement(uuid, uuid, text) to authenticated;

-- =============================================================================
-- G. skip_recurring_occurrence
-- =============================================================================
-- Creates a recurring_occurrence_exceptions row. Locks the ARRANGEMENT
-- row FOR UPDATE (not merely reads it) for two reasons at once: (1) its
-- CURRENT facts (start/end/days_of_week/status/paused_at) are exactly
-- what SKIP DATE VALIDITY must check against, and (2) this is also the
-- serialization boundary that makes concurrent duplicate-skip requests
-- for the SAME arrangement safe — a second concurrent call blocks on
-- this same lock until the first commits, then re-reads the now-current
-- exception set and correctly takes the idempotent no-op path (identical
-- technique to link_request_passenger/cancel_transportation_request
-- using the parent Request row's own lock as their serialization
-- boundary). No ON CONFLICT clause is used or needed — the lock alone is
-- a complete solution, and it is what this codebase already establishes
-- as the standard technique for this exact class of problem.
create or replace function public.skip_recurring_occurrence(
  p_organization_id uuid,
  p_arrangement_id uuid,
  p_service_date date,
  p_reason text
)
returns public.recurring_occurrence_exception_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_arrangement public.recurring_arrangements;
  v_reason text;
  v_local_today date;
  v_paused_effective_date date;
  v_existing public.recurring_occurrence_exceptions;
  v_new public.recurring_occurrence_exceptions;
  v_result public.recurring_occurrence_exception_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Same nonblank/length bound as the table's own CHECK (btrim <> ''
  -- and <=2000 chars, 20260917100000) — validated here first for a
  -- clean ZW006 rather than a raw constraint-violation error.
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null or length(v_reason) > 2000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_service_date is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_arrangement
  from public.recurring_arrangements
  where id = p_arrangement_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- An ended arrangement accepts NO new skip, for any date, unconditionally
  -- (work item §16, no date-specific carve-out) — categorized ZW004:
  -- unlike the date-specific checks below (which describe whether THIS
  -- particular date is valid), this describes whether the ACTION ITSELF
  -- is available at all given the arrangement's own terminal lifecycle
  -- state, the same class of gate edit_recurring_arrangement/pause/
  -- resume already use ZW004 for.
  if v_arrangement.status = 'ended' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- Arrangement-local "today" — the wall-clock date `now()` falls on in
  -- THIS arrangement's own timezone (the same one-way instant->local-date
  -- conversion technique day-bounds.ts's own localDateKey uses at the
  -- application layer, expressed here as Postgres's own equivalent
  -- built-in AT TIME ZONE construct rather than reimplemented by hand).
  v_local_today := (now() at time zone v_arrangement.timezone)::date;

  -- SKIP DATE VALIDITY (work item §16) — every check below is ZW006,
  -- describing "this specific requested date does not describe a
  -- legitimate current pattern occurrence," never the arrangement's own
  -- lifecycle state (that was already gated above for 'ended', and is
  -- gated below for 'paused' with its own date-relative rule).
  if p_service_date < v_arrangement.start_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_arrangement.end_date is not null and p_service_date > v_arrangement.end_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_service_date < v_local_today then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not (extract(isodow from p_service_date)::smallint = any (v_arrangement.days_of_week)) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if v_arrangement.status = 'paused' and v_arrangement.paused_at is not null then
    v_paused_effective_date := (v_arrangement.paused_at at time zone v_arrangement.timezone)::date;
    if p_service_date >= v_paused_effective_date then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  -- Idempotency (work item §17): the arrangement row lock above already
  -- serializes this check against any concurrent identical request.
  select * into v_existing
  from public.recurring_occurrence_exceptions
  where recurring_arrangement_id = p_arrangement_id and service_date = p_service_date;

  if found then
    v_result.exception_id := v_existing.id;
    v_result.arrangement_id := v_existing.recurring_arrangement_id;
    v_result.organization_id := v_existing.organization_id;
    v_result.service_date := v_existing.service_date;
    v_result.reason := v_existing.reason;
    v_result.created_by := v_existing.created_by;
    v_result.created_at := v_existing.created_at;
    v_result.changed := false;
    return v_result;
  end if;

  insert into public.recurring_occurrence_exceptions (organization_id, recurring_arrangement_id, service_date, reason, created_by)
  values (v_arrangement.organization_id, p_arrangement_id, p_service_date, v_reason, auth.uid())
  returning * into v_new;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    v_arrangement.organization_id, 'recurring_arrangement', p_arrangement_id, 'recurring_occurrence_skipped', auth.uid(),
    null, jsonb_build_object('service_date', v_new.service_date, 'reason', v_new.reason)
  );

  v_result.exception_id := v_new.id;
  v_result.arrangement_id := v_new.recurring_arrangement_id;
  v_result.organization_id := v_new.organization_id;
  v_result.service_date := v_new.service_date;
  v_result.reason := v_new.reason;
  v_result.created_by := v_new.created_by;
  v_result.created_at := v_new.created_at;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.skip_recurring_occurrence(uuid, uuid, date, text) is
  'Organization Admin / Dispatcher only. Creates a deliberate single-date skip. Reason required (1-2000 chars). service_date must currently be a legitimate pattern occurrence: on/after start_date, on/before end_date (if set), on/after the arrangement-local current date, on a matching weekday, and (if paused) before the pause-effective local date (ZW006 for any of these); an ended arrangement rejects unconditionally (ZW004). Idempotent no-op if already skipped for this exact (arrangement, date) — returns the REAL, original reason, never overwritten. The arrangement row lock this function takes is also the serialization boundary that guarantees exactly one exception row and exactly one audit event under concurrent identical requests.';

revoke all on function public.skip_recurring_occurrence(uuid, uuid, date, text) from public;
grant execute on function public.skip_recurring_occurrence(uuid, uuid, date, text) to authenticated;

-- =============================================================================
-- H. unskip_recurring_occurrence
-- =============================================================================
-- Removes an existing skip fact. Deliberately does NOT re-validate
-- current pattern facts (work item §18) — a skip created when the date
-- was a legitimate pattern occurrence remains removable even after a
-- later pattern edit, pause, or end changes what "legitimate" would mean
-- today; reversal of an existing explicit fact must never become
-- impossible because later facts changed. Only the exception row itself
-- is locked (mirrors resolve_trip_exception's own simpler single-row-lock
-- shape) — no arrangement-level validity recomputation is needed or
-- performed.
create or replace function public.unskip_recurring_occurrence(
  p_organization_id uuid,
  p_arrangement_id uuid,
  p_service_date date
)
returns public.recurring_occurrence_exception_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exception public.recurring_occurrence_exceptions;
  v_result public.recurring_occurrence_exception_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_service_date is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_exception
  from public.recurring_occurrence_exceptions
  where recurring_arrangement_id = p_arrangement_id
    and organization_id = p_organization_id
    and service_date = p_service_date
  for update;

  if not found then
    -- Idempotent successful no-op (work item §18) — nothing to remove is
    -- not an error, whether because it was never skipped, was already
    -- unskipped by a concurrent/earlier call, or the arrangement/
    -- organization_id combination does not resolve to a real row (no
    -- existence oracle beyond this).
    v_result.exception_id := null;
    v_result.arrangement_id := p_arrangement_id;
    v_result.organization_id := p_organization_id;
    v_result.service_date := p_service_date;
    v_result.reason := null;
    v_result.created_by := null;
    v_result.created_at := null;
    v_result.changed := false;
    return v_result;
  end if;

  delete from public.recurring_occurrence_exceptions where id = v_exception.id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'recurring_arrangement', p_arrangement_id, 'recurring_occurrence_unskipped', auth.uid(),
    jsonb_build_object('service_date', v_exception.service_date, 'reason', v_exception.reason), null
  );

  v_result.exception_id := v_exception.id;
  v_result.arrangement_id := v_exception.recurring_arrangement_id;
  v_result.organization_id := v_exception.organization_id;
  v_result.service_date := v_exception.service_date;
  v_result.reason := v_exception.reason;
  v_result.created_by := v_exception.created_by;
  v_result.created_at := v_exception.created_at;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.unskip_recurring_occurrence(uuid, uuid, date) is
  'Organization Admin / Dispatcher only. Removes an existing skip fact for (arrangement, date) — no soft-delete, the row is actually DELETEd, with one audit_events row capturing the removed fact for history. Idempotent successful no-op if no such skip exists (changed=false, no audit event) — covers "never skipped," "already unskipped," and a nonexistent/foreign-org arrangement_id/organization_id combination alike, with no existence oracle. Deliberately does NOT require the date to still be a current pattern occurrence — a stale skip (pattern since changed, arrangement since paused/ended) remains removable, matching this codebase''s own general preference for reversibility of an existing explicit fact over re-validating it against facts that changed afterward.';

revoke all on function public.unskip_recurring_occurrence(uuid, uuid, date) from public;
grant execute on function public.unskip_recurring_occurrence(uuid, uuid, date) to authenticated;
