-- Zenward Platform — Recurring Arrangement lifecycle + occurrence exception
-- MUTATION tests (P1-E2-S1D). Run against `supabase db reset` fresh-seeded
-- data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/recurring_arrangement_mutation_tests.sql
--
-- Covers the 7 new controlled RPCs: create/edit/pause/resume/end_
-- recurring_arrangement, skip/unskip_recurring_occurrence. METHODOLOGY:
-- identical to recurring_arrangement_foundation_tests.sql/rls_adversarial_
-- tests.sql — `SET ROLE authenticated` + `SET request.jwt.claim.sub =
-- '<user-uuid>'`, BOTH set INSIDE a `do $$ ... $$` block (a single implicit
-- transaction) alongside the RPC call itself, since `SET LOCAL` outside an
-- explicit transaction only lives for the remainder of the SAME top-level
-- statement.
--
-- "Today" is real system time (see docs/reports/p1-e2-s1d-... PREFLIGHT for
-- the exact date this suite was authored/run against) in both
-- America/New_York (Org A) and America/Chicago (Org B). All fixture dates
-- below are expressed relative to that same real "today," matching the
-- live-validation convention already established in S1C.

\set ON_ERROR_STOP off
\pset pager off

-- =============================================================================
-- Shared fixtures
-- =============================================================================
-- An inactive Passenger, Org A — needed for CREATE-12 (no seed fixture for
-- this exists yet).
do $$
begin
  insert into public.passengers (id, organization_id, display_name, status)
  values ('41000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'Inactive Passenger A1', 'inactive');
end $$;

-- =============================================================================
-- SECTION 1: CREATE
-- =============================================================================

-- CREATE-01. Org Admin create succeeds.
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'CREATE-01 Pickup', 'CREATE-01 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  if v_result.arrangement_id is not null and v_result.changed then
    raise notice 'TEST CREATE-01: PASS (Org Admin create succeeded, id=%)', v_result.arrangement_id;
  else raise notice 'TEST CREATE-01: FAIL'; end if;
end $$;
reset role;

-- CREATE-02. Dispatcher create succeeds.
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select * into v_result from create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'CREATE-02 Pickup', 'CREATE-02 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  if v_result.arrangement_id is not null and v_result.changed then
    raise notice 'TEST CREATE-02: PASS (Dispatcher create succeeded)';
  else raise notice 'TEST CREATE-02: FAIL'; end if;
end $$;
reset role;

-- CREATE-03. Driver denied.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
  perform create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'CREATE-03 Pickup', 'CREATE-03 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  raise notice 'TEST CREATE-03: FAIL (Driver create succeeded)';
exception when others then
  raise notice 'TEST CREATE-03: PASS (Driver denied: %)', sqlerrm;
end $$;
reset role;

-- CREATE-04. Inactive membership denied.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a5';
  perform create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'CREATE-04 Pickup', 'CREATE-04 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  raise notice 'TEST CREATE-04: FAIL (inactive membership create succeeded)';
exception when others then
  raise notice 'TEST CREATE-04: PASS (inactive membership denied: %)', sqlerrm;
end $$;
reset role;

-- CREATE-05. Anonymous denied.
do $$
begin
  set local role anon;
  perform create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'CREATE-05 Pickup', 'CREATE-05 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  raise notice 'TEST CREATE-05: FAIL (anon create succeeded)';
exception when others then
  raise notice 'TEST CREATE-05: PASS (anon denied: %)', sqlerrm;
end $$;
reset role;

-- CREATE-06. Forged organization rejected (Org A actor, Org B's org id).
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000b1'::uuid, '40000000-0000-0000-0000-0000000000b1'::uuid,
    'CREATE-06 Pickup', 'CREATE-06 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  raise notice 'TEST CREATE-06: FAIL (forged organization create succeeded)';
exception when others then
  raise notice 'TEST CREATE-06: PASS (forged organization denied: %)', sqlerrm;
end $$;
reset role;

-- CREATE-07. Timezone derived from Organization (Org A = America/New_York, never caller-suppliable — no parameter exists for it at all).
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'CREATE-07 Pickup', 'CREATE-07 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  if v_result.timezone = 'America/New_York' then
    raise notice 'TEST CREATE-07: PASS (timezone derived from Organization: %)', v_result.timezone;
  else raise notice 'TEST CREATE-07: FAIL (got %)', v_result.timezone; end if;
end $$;
reset role;

-- CREATE-08. created_by derived from auth.uid().
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select * into v_result from create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'CREATE-08 Pickup', 'CREATE-08 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  if v_result.created_by = '20000000-0000-0000-0000-0000000000a2'::uuid then
    raise notice 'TEST CREATE-08: PASS (created_by = auth.uid())';
  else raise notice 'TEST CREATE-08: FAIL (got %)', v_result.created_by; end if;
end $$;
reset role;

-- CREATE-09. status always active.
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'CREATE-09 Pickup', 'CREATE-09 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  if v_result.status = 'active' and v_result.paused_at is null and v_result.ended_at is null and v_result.ended_reason is null then
    raise notice 'TEST CREATE-09: PASS (status=active, paused_at/ended_at/ended_reason all null)';
  else raise notice 'TEST CREATE-09: FAIL (status=%, paused_at=%, ended_at=%, ended_reason=%)', v_result.status, v_result.paused_at, v_result.ended_at, v_result.ended_reason; end if;
end $$;
reset role;

-- CREATE-10. Weekday normalization works ([5,1,3,3] -> {1,3,5}).
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'CREATE-10 Pickup', 'CREATE-10 Dest', '08:00'::time, array[5,1,3,3]::smallint[], '2026-01-01'::date, null);
  if v_result.days_of_week = array[1,3,5]::smallint[] then
    raise notice 'TEST CREATE-10: PASS ([5,1,3,3] normalized to %)', v_result.days_of_week;
  else raise notice 'TEST CREATE-10: FAIL (got %)', v_result.days_of_week; end if;
end $$;
reset role;

-- CREATE-11. Cross-org Passenger rejected (Org A context, Org B passenger).
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000b1'::uuid,
    'CREATE-11 Pickup', 'CREATE-11 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  raise notice 'TEST CREATE-11: FAIL (cross-org passenger create succeeded)';
exception when others then
  raise notice 'TEST CREATE-11: PASS (cross-org passenger denied: %)', sqlerrm;
end $$;
reset role;

-- CREATE-12. Inactive Passenger rejected (locked decision, work item §6).
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '41000000-0000-0000-0000-0000000000a1'::uuid,
    'CREATE-12 Pickup', 'CREATE-12 Dest', '08:00'::time, array[1,3,5]::smallint[], '2026-01-01'::date, null);
  raise notice 'TEST CREATE-12: FAIL (inactive passenger create succeeded)';
exception when others then
  raise notice 'TEST CREATE-12: PASS (inactive passenger denied: %)', sqlerrm;
end $$;
reset role;

-- =============================================================================
-- SECTION 2: EDIT
-- =============================================================================

-- EDIT fixture: one active arrangement, one paused, one ended, all with a
-- linked Trip to prove "linked Trips unchanged."
do $$
begin
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
  values ('e1000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'EDIT active orig', 'EDIT active dest orig', '08:00', array[1,3,5]::smallint[], '2026-01-01', 'America/New_York', 'active');
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, paused_at)
  values ('e1000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'EDIT paused orig', 'EDIT paused dest orig', '08:00', array[1,3,5]::smallint[], '2026-01-01', 'America/New_York', 'paused', now());
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, ended_at, ended_reason)
  values ('e1000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'EDIT ended orig', 'EDIT ended dest orig', '08:00', array[1,3,5]::smallint[], '2026-01-01', 'America/New_York', 'ended', now(), 'test end');
  insert into public.trips (id, organization_id, passenger_id, recurring_arrangement_id, state, scheduled_pickup_at, pickup_description, destination_description)
  values ('e2000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'e1000000-0000-0000-0000-0000000000a1', 'scheduled', now() + interval '1 day', 'Trip P', 'Trip D');
end $$;

-- EDIT-01. Active edit succeeds.
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from edit_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000a1'::uuid,
    'EDIT active NEW', 'EDIT active dest NEW', '09:00'::time, array[2,4]::smallint[], '2026-02-01'::date, '2026-12-01'::date);
  if v_result.changed and v_result.pickup_description = 'EDIT active NEW' and v_result.days_of_week = array[2,4]::smallint[] then
    raise notice 'TEST EDIT-01: PASS (active edit succeeded)';
  else raise notice 'TEST EDIT-01: FAIL'; end if;
end $$;
reset role;

-- EDIT-02. Paused edit succeeds.
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from edit_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000a2'::uuid,
    'EDIT paused NEW', 'EDIT paused dest NEW', '09:00'::time, array[2,4]::smallint[], '2026-02-01'::date, null);
  if v_result.changed and v_result.pickup_description = 'EDIT paused NEW' and v_result.status = 'paused' then
    raise notice 'TEST EDIT-02: PASS (paused edit succeeded, status remains paused)';
  else raise notice 'TEST EDIT-02: FAIL'; end if;
end $$;
reset role;

-- EDIT-03. Ended edit rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform edit_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000a3'::uuid,
    'EDIT ended NEW', 'EDIT ended dest NEW', '09:00'::time, array[2,4]::smallint[], '2026-02-01'::date, null);
  raise notice 'TEST EDIT-03: FAIL (ended edit succeeded)';
exception when others then
  raise notice 'TEST EDIT-03: PASS (ended edit denied: %)', sqlerrm;
end $$;
reset role;

-- EDIT-04/05/06/07. Passenger/timezone/organization/created_by cannot
-- change (structurally — no parameter exists for any of them; verified
-- directly against the row after EDIT-01's own edit above).
do $$
declare v_row public.recurring_arrangements;
begin
  select * into v_row from public.recurring_arrangements where id = 'e1000000-0000-0000-0000-0000000000a1';
  if v_row.passenger_id = '40000000-0000-0000-0000-0000000000a1'::uuid
     and v_row.timezone = 'America/New_York'
     and v_row.organization_id = '10000000-0000-0000-0000-0000000000a1'::uuid
     and v_row.created_by is null -- fixture inserted as postgres, never set — proves edit didn't touch it either way
  then
    raise notice 'TEST EDIT-04/05/06/07: PASS (passenger_id/timezone/organization_id/created_by all unchanged by edit_recurring_arrangement)';
  else
    raise notice 'TEST EDIT-04/05/06/07: FAIL (passenger_id=%, timezone=%, organization_id=%, created_by=%)', v_row.passenger_id, v_row.timezone, v_row.organization_id, v_row.created_by;
  end if;
end $$;

-- EDIT-08. Linked Trip unchanged.
do $$
declare v_trip public.trips;
begin
  select * into v_trip from public.trips where id = 'e2000000-0000-0000-0000-0000000000a1';
  if v_trip.pickup_description = 'Trip P' and v_trip.destination_description = 'Trip D' and v_trip.recurring_arrangement_id = 'e1000000-0000-0000-0000-0000000000a1'::uuid then
    raise notice 'TEST EDIT-08: PASS (linked Trip completely unchanged by the arrangement edit)';
  else raise notice 'TEST EDIT-08: FAIL (trip was mutated)'; end if;
end $$;

-- EDIT-09. Weekday normalization works (already exercised structurally by
-- EDIT-01/02 above, both of which passed unsorted-safe input — re-asserted
-- explicitly here with a duplicate-containing array).
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from edit_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000a1'::uuid,
    'EDIT norm', 'EDIT norm dest', '09:00'::time, array[7,1,1,4]::smallint[], '2026-02-01'::date, null);
  if v_result.days_of_week = array[1,4,7]::smallint[] then
    raise notice 'TEST EDIT-09: PASS ([7,1,1,4] normalized to %)', v_result.days_of_week;
  else raise notice 'TEST EDIT-09: FAIL (got %)', v_result.days_of_week; end if;
end $$;
reset role;

-- =============================================================================
-- SECTION 3: PAUSE
-- =============================================================================

do $$
begin
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
  values ('e1000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'PAUSE active', 'PAUSE dest', '08:00', array[1,3,5]::smallint[], '2026-01-01', 'America/New_York', 'active');
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, ended_at, ended_reason)
  values ('e1000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'PAUSE ended', 'PAUSE dest', '08:00', array[1,3,5]::smallint[], '2026-01-01', 'America/New_York', 'ended', now(), 'test end');
  insert into public.trips (id, organization_id, passenger_id, recurring_arrangement_id, state, scheduled_pickup_at, pickup_description, destination_description)
  values ('e2000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'e1000000-0000-0000-0000-0000000000b1', 'scheduled', now() + interval '1 day', 'Trip P', 'Trip D');
end $$;

-- PAUSE-01/02. active -> paused, paused_at set.
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from pause_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000b1'::uuid);
  if v_result.changed and v_result.status = 'paused' and v_result.paused_at is not null then
    raise notice 'TEST PAUSE-01/02: PASS (active -> paused, paused_at=%)', v_result.paused_at;
  else raise notice 'TEST PAUSE-01/02: FAIL (status=%, paused_at=%)', v_result.status, v_result.paused_at; end if;
end $$;
reset role;

-- PAUSE-03. Repeat pause idempotent.
do $$
declare v_before timestamptz; v_result public.recurring_arrangement_result; v_audit_count int;
begin
  select paused_at into v_before from public.recurring_arrangements where id = 'e1000000-0000-0000-0000-0000000000b1';
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select * into v_result from pause_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000b1'::uuid);
  reset role;
  select count(*) into v_audit_count from public.audit_events where entity_id = 'e1000000-0000-0000-0000-0000000000b1' and action = 'recurring_arrangement_paused';
  if not v_result.changed and v_result.paused_at = v_before and v_audit_count = 1 then
    raise notice 'TEST PAUSE-03: PASS (repeat pause is idempotent no-op, paused_at unchanged, exactly 1 audit event total)';
  else raise notice 'TEST PAUSE-03: FAIL (changed=%, paused_at=%/%, audit_count=%)', v_result.changed, v_result.paused_at, v_before, v_audit_count; end if;
end $$;
reset role;

-- PAUSE-04. Ended pause rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform pause_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000b2'::uuid);
  raise notice 'TEST PAUSE-04: FAIL (pausing an ended arrangement succeeded)';
exception when others then
  raise notice 'TEST PAUSE-04: PASS (ended pause denied: %)', sqlerrm;
end $$;
reset role;

-- PAUSE-05. No linked Trip changed.
do $$
declare v_trip public.trips;
begin
  select * into v_trip from public.trips where id = 'e2000000-0000-0000-0000-0000000000b1';
  if v_trip.state = 'scheduled' and v_trip.pickup_description = 'Trip P' then
    raise notice 'TEST PAUSE-05: PASS (linked Trip completely unchanged by pause)';
  else raise notice 'TEST PAUSE-05: FAIL'; end if;
end $$;

-- =============================================================================
-- SECTION 4: RESUME
-- =============================================================================

do $$
begin
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, paused_at)
  values ('e1000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'RESUME paused', 'RESUME dest', '08:00', array[1,3,5]::smallint[], '2026-01-01', 'America/New_York', 'paused', now());
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, ended_at, ended_reason)
  values ('e1000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'RESUME ended', 'RESUME dest', '08:00', array[1,3,5]::smallint[], '2026-01-01', 'America/New_York', 'ended', now(), 'test end');
end $$;

-- RESUME-01/02. paused -> active, paused_at cleared.
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from resume_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000c1'::uuid);
  if v_result.changed and v_result.status = 'active' and v_result.paused_at is null then
    raise notice 'TEST RESUME-01/02: PASS (paused -> active, paused_at cleared)';
  else raise notice 'TEST RESUME-01/02: FAIL (status=%, paused_at=%)', v_result.status, v_result.paused_at; end if;
end $$;
reset role;

-- RESUME-03. Repeat resume idempotent.
do $$
declare v_result public.recurring_arrangement_result; v_audit_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select * into v_result from resume_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000c1'::uuid);
  reset role;
  select count(*) into v_audit_count from public.audit_events where entity_id = 'e1000000-0000-0000-0000-0000000000c1' and action = 'recurring_arrangement_resumed';
  if not v_result.changed and v_audit_count = 1 then
    raise notice 'TEST RESUME-03: PASS (repeat resume is idempotent no-op, exactly 1 audit event total)';
  else raise notice 'TEST RESUME-03: FAIL (changed=%, audit_count=%)', v_result.changed, v_audit_count; end if;
end $$;
reset role;

-- RESUME-04. Ended resume rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform resume_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000c2'::uuid);
  raise notice 'TEST RESUME-04: FAIL (resuming an ended arrangement succeeded)';
exception when others then
  raise notice 'TEST RESUME-04: PASS (ended resume denied: %)', sqlerrm;
end $$;
reset role;

-- =============================================================================
-- SECTION 5: END
-- =============================================================================

do $$
begin
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
  values ('e1000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'END from active', 'END dest', '08:00', array[1,3,5]::smallint[], '2026-01-01', 'America/New_York', 'active');
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, paused_at)
  values ('e1000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'END from paused', 'END dest', '08:00', array[1,3,5]::smallint[], '2026-01-01', 'America/New_York', 'paused', '2026-06-01T12:00:00Z');
  insert into public.trips (id, organization_id, passenger_id, recurring_arrangement_id, state, scheduled_pickup_at, pickup_description, destination_description)
  values ('e2000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'e1000000-0000-0000-0000-0000000000d1', 'scheduled', now() + interval '1 day', 'Trip P', 'Trip D');
end $$;

-- END-04 (checked first: reason required, blank rejected).
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000d1'::uuid, '   ');
  raise notice 'TEST END-04: FAIL (blank reason accepted)';
exception when others then
  raise notice 'TEST END-04: PASS (blank reason rejected: %)', sqlerrm;
end $$;
reset role;

-- END-01/03. active -> ended, ended_at set, paused_at remains NULL.
do $$
declare v_result public.recurring_arrangement_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000d1'::uuid, 'discharged');
  if v_result.changed and v_result.status = 'ended' and v_result.ended_at is not null and v_result.ended_reason = 'discharged' and v_result.paused_at is null then
    raise notice 'TEST END-01/03: PASS (active -> ended, ended_at set, paused_at remains NULL)';
  else raise notice 'TEST END-01/03: FAIL (status=%, ended_at=%, ended_reason=%, paused_at=%)', v_result.status, v_result.ended_at, v_result.ended_reason, v_result.paused_at; end if;
end $$;
reset role;

-- END-02/05. paused -> ended, RETAINS the original paused_at.
do $$
declare v_original_paused_at timestamptz; v_result public.recurring_arrangement_result;
begin
  select paused_at into v_original_paused_at from public.recurring_arrangements where id = 'e1000000-0000-0000-0000-0000000000d2';
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000d2'::uuid, 'discharged from paused');
  if v_result.changed and v_result.status = 'ended' and v_result.paused_at = v_original_paused_at then
    raise notice 'TEST END-02/05: PASS (paused -> ended, paused_at RETAINED as historical context: %)', v_result.paused_at;
  else raise notice 'TEST END-02/05: FAIL (paused_at=% expected %)', v_result.paused_at, v_original_paused_at; end if;
end $$;
reset role;

-- END-06/07. Repeat end idempotent, original ended_reason preserved.
do $$
declare v_result public.recurring_arrangement_result; v_audit_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select * into v_result from end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e1000000-0000-0000-0000-0000000000d1'::uuid, 'a completely different later reason');
  reset role;
  select count(*) into v_audit_count from public.audit_events where entity_id = 'e1000000-0000-0000-0000-0000000000d1' and action = 'recurring_arrangement_ended';
  if not v_result.changed and v_result.ended_reason = 'discharged' and v_audit_count = 1 then
    raise notice 'TEST END-06/07: PASS (repeat end is idempotent no-op, ORIGINAL reason preserved: "%", exactly 1 audit event total)', v_result.ended_reason;
  else raise notice 'TEST END-06/07: FAIL (changed=%, ended_reason=%, audit_count=%)', v_result.changed, v_result.ended_reason, v_audit_count; end if;
end $$;
reset role;

-- END-08. No linked Trip changed.
do $$
declare v_trip public.trips;
begin
  select * into v_trip from public.trips where id = 'e2000000-0000-0000-0000-0000000000d1';
  if v_trip.state = 'scheduled' and v_trip.pickup_description = 'Trip P' then
    raise notice 'TEST END-08: PASS (linked Trip completely unchanged by end)';
  else raise notice 'TEST END-08: FAIL'; end if;
end $$;

-- =============================================================================
-- SECTION 6: SKIP
-- =============================================================================
-- All dates below are expressed relative to real "today" via CURRENT_DATE
-- arithmetic so this file remains correct on any future re-run, never
-- hardcoded to one specific calendar date.
do $$
declare
  v_today date := current_date; -- server date; Org A's own arrangement-local "today" is independently re-derived by the RPC itself from now()/timezone, never trusted from this fixture setup
  v_next_mon date;
  v_paused_cutoff date;
begin
  -- Next Monday on/after today (ISO weekday 1) — used as the pattern for
  -- the main SKIP arrangement (Mon/Wed/Fri).
  v_next_mon := v_today + ((8 - extract(isodow from v_today)::int) % 7);

  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
  values ('e3000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'SKIP main', 'SKIP dest', '08:00', array[1,3,5]::smallint[], v_today - interval '1 year', 'America/New_York', 'active');

  -- Before-start arrangement: Wednesday-only, start_date far in the future.
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
  values ('e3000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'SKIP before-start', 'SKIP dest', '08:00', array[3]::smallint[], v_today + interval '60 days', 'America/New_York', 'active');

  -- After-end arrangement: Wednesday-only, end_date in the near future.
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, end_date, timezone, status)
  values ('e3000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'SKIP after-end', 'SKIP dest', '08:00', array[3]::smallint[], v_today - interval '1 year', v_today + interval '3 days', 'America/New_York', 'active');

  -- Paused arrangement: daily pattern, paused effective 2 days from now
  -- (local America/New_York noon, unambiguous).
  v_paused_cutoff := v_today + 2;
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, paused_at)
  values ('e3000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'SKIP paused', 'SKIP dest', '08:00', array[1,2,3,4,5,6,7]::smallint[], v_today - interval '1 year', 'America/New_York', 'paused',
    (v_paused_cutoff::text || 'T16:00:00Z')::timestamptz); -- 16:00 UTC = noon EDT/EST-ish, safely mid-day either way

  -- Ended arrangement: daily pattern.
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, ended_at, ended_reason)
  values ('e3000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'SKIP ended', 'SKIP dest', '08:00', array[1,2,3,4,5,6,7]::smallint[], v_today - interval '1 year', 'America/New_York', 'ended', now(), 'test end');
end $$;

-- SKIP-01. Valid current/future pattern date succeeds (next Monday).
do $$
declare v_next_mon date := current_date + ((8 - extract(isodow from current_date)::int) % 7);
declare v_result public.recurring_occurrence_exception_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a1'::uuid, v_next_mon, 'SKIP-01 valid date');
  if v_result.changed and v_result.service_date = v_next_mon and v_result.reason = 'SKIP-01 valid date' then
    raise notice 'TEST SKIP-01: PASS (valid current/future pattern date % skipped)', v_next_mon;
  else raise notice 'TEST SKIP-01: FAIL'; end if;
end $$;
reset role;

-- SKIP-02. Non-pattern weekday rejected (main arrangement is Mon/Wed/Fri;
-- pick the Tuesday immediately after v_next_mon).
do $$
declare v_next_mon date := current_date + ((8 - extract(isodow from current_date)::int) % 7);
declare v_tuesday date := v_next_mon + 1;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a1'::uuid, v_tuesday, 'wrong weekday');
  raise notice 'TEST SKIP-02: FAIL (non-pattern weekday % accepted)', v_tuesday;
exception when others then
  raise notice 'TEST SKIP-02: PASS (non-pattern weekday denied: %)', sqlerrm;
end $$;
reset role;

-- SKIP-03. Before-start rejected (e3...a2 starts 60 days out; try a
-- Wednesday 30 days out, matching weekday but before start).
do $$
declare v_target date;
begin
  select min(d::date) into v_target from generate_series((current_date + 25)::timestamp, (current_date + 35)::timestamp, interval '1 day') as d where extract(isodow from d) = 3;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a2'::uuid, v_target, 'before start');
  raise notice 'TEST SKIP-03: FAIL (before-start date % accepted)', v_target;
exception when others then
  raise notice 'TEST SKIP-03: PASS (before-start denied: %)', sqlerrm;
end $$;
reset role;

-- SKIP-04. After-end rejected (e3...a3 ends 3 days out; try a Wednesday
-- well past that).
do $$
declare v_target date;
begin
  select min(d::date) into v_target from generate_series((current_date + 4)::timestamp, (current_date + 14)::timestamp, interval '1 day') as d where extract(isodow from d) = 3;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a3'::uuid, v_target, 'after end');
  raise notice 'TEST SKIP-04: FAIL (after-end date % accepted)', v_target;
exception when others then
  raise notice 'TEST SKIP-04: PASS (after-end denied: %)', sqlerrm;
end $$;
reset role;

-- SKIP-05. Past date rejected (main arrangement started a year ago; pick
-- the most recent PAST Monday/Wednesday/Friday).
do $$
declare v_target date;
begin
  select max(d::date) into v_target from generate_series((current_date - 7)::timestamp, (current_date - 1)::timestamp, interval '1 day') as d where extract(isodow from d) in (1,3,5);
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a1'::uuid, v_target, 'past date');
  raise notice 'TEST SKIP-05: FAIL (past date % accepted)', v_target;
exception when others then
  raise notice 'TEST SKIP-05: PASS (past date denied: %)', sqlerrm;
end $$;
reset role;

-- SKIP-06. Date at/after pause cutoff rejected; a date BEFORE the cutoff
-- still succeeds (daily paused arrangement, cutoff = today+2).
do $$
declare v_cutoff date := current_date + 2;
declare v_before_cutoff date := current_date + 1;
declare v_result public.recurring_occurrence_exception_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  -- On/after cutoff: rejected.
  begin
    perform skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a4'::uuid, v_cutoff, 'on cutoff');
    raise notice 'TEST SKIP-06a: FAIL (on/after pause-cutoff date % accepted)', v_cutoff;
  exception when others then
    raise notice 'TEST SKIP-06a: PASS (on/after pause-cutoff denied: %)', sqlerrm;
  end;
  -- Before cutoff: still a legitimate pattern date, succeeds.
  select * into v_result from skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a4'::uuid, v_before_cutoff, 'before cutoff');
  if v_result.changed then
    raise notice 'TEST SKIP-06b: PASS (date before pause-cutoff % still succeeds)', v_before_cutoff;
  else raise notice 'TEST SKIP-06b: FAIL'; end if;
end $$;
reset role;

-- SKIP-07. Ended arrangement rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a5'::uuid, current_date + 1, 'ended arrangement');
  raise notice 'TEST SKIP-07: FAIL (ended arrangement skip accepted)';
exception when others then
  raise notice 'TEST SKIP-07: PASS (ended arrangement denied: %)', sqlerrm;
end $$;
reset role;

-- SKIP-08/09. Duplicate skip idempotent, original reason preserved.
do $$
declare v_next_mon date := current_date + ((8 - extract(isodow from current_date)::int) % 7);
declare v_result public.recurring_occurrence_exception_result; v_audit_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select * into v_result from skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a1'::uuid, v_next_mon, 'a completely different later reason');
  reset role;
  select count(*) into v_audit_count from public.audit_events where entity_id = 'e3000000-0000-0000-0000-0000000000a1' and action = 'recurring_occurrence_skipped';
  if not v_result.changed and v_result.reason = 'SKIP-01 valid date' and v_audit_count = 1 then
    raise notice 'TEST SKIP-08/09: PASS (duplicate skip is idempotent no-op, ORIGINAL reason preserved: "%", exactly 1 audit event total)', v_result.reason;
  else raise notice 'TEST SKIP-08/09: FAIL (changed=%, reason=%, audit_count=%)', v_result.changed, v_result.reason, v_audit_count; end if;
end $$;
reset role;

-- =============================================================================
-- SECTION 7: UNSKIP
-- =============================================================================

-- UNSKIP-01. Existing skip removed.
do $$
declare v_next_mon date := current_date + ((8 - extract(isodow from current_date)::int) % 7);
declare v_result public.recurring_occurrence_exception_result; v_remaining int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from unskip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a1'::uuid, v_next_mon);
  select count(*) into v_remaining from public.recurring_occurrence_exceptions where recurring_arrangement_id = 'e3000000-0000-0000-0000-0000000000a1' and service_date = v_next_mon;
  if v_result.changed and v_remaining = 0 then
    raise notice 'TEST UNSKIP-01: PASS (existing skip removed, 0 rows remain)';
  else raise notice 'TEST UNSKIP-01: FAIL (changed=%, remaining=%)', v_result.changed, v_remaining; end if;
end $$;
reset role;

-- UNSKIP-02. Missing skip idempotent.
do $$
declare v_result public.recurring_occurrence_exception_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from unskip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a1'::uuid, current_date + 1);
  if not v_result.changed and v_result.exception_id is null then
    raise notice 'TEST UNSKIP-02: PASS (missing skip is idempotent successful no-op)';
  else raise notice 'TEST UNSKIP-02: FAIL'; end if;
end $$;
reset role;

-- UNSKIP-03. Stale/non-pattern skip can still be removed (skip a valid
-- date, then edit the pattern to exclude that weekday, then unskip).
do $$
declare
  v_next_wed date;
  v_skip_result public.recurring_occurrence_exception_result;
  v_unskip_result public.recurring_occurrence_exception_result;
begin
  select min(d::date) into v_next_wed from generate_series(current_date::timestamp, (current_date + 7)::timestamp, interval '1 day') as d where extract(isodow from d) = 3;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';

  select * into v_skip_result from skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a1'::uuid, v_next_wed, 'will become stale');
  if not v_skip_result.changed then
    raise notice 'TEST UNSKIP-03: FAIL (setup: skip did not succeed)';
    return;
  end if;

  -- Edit the pattern to Mon/Fri only — Wednesday is no longer a pattern day.
  perform edit_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a1'::uuid,
    'SKIP main', 'SKIP dest', '08:00'::time, array[1,5]::smallint[], (current_date - interval '1 year')::date, null);

  select * into v_unskip_result from unskip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a1'::uuid, v_next_wed);
  if v_unskip_result.changed then
    raise notice 'TEST UNSKIP-03: PASS (stale/non-pattern skip removed successfully after the pattern changed)';
  else raise notice 'TEST UNSKIP-03: FAIL (unskip of a now-stale date did not succeed)'; end if;
end $$;
reset role;

-- UNSKIP-04. Ended arrangement's old skip can still be removed.
do $$
declare
  v_target date := current_date; -- today, distinct from SKIP-06's own use of current_date+1 on this same arrangement
  v_skip_result public.recurring_occurrence_exception_result;
  v_unskip_result public.recurring_occurrence_exception_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';

  select * into v_skip_result from skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a4'::uuid, v_target, 'will be orphaned by end');
  if not v_skip_result.changed then
    raise notice 'TEST UNSKIP-04: FAIL (setup: skip did not succeed — arrangement a4 may already be past its pause cutoff for this date)';
    return;
  end if;

  perform end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a4'::uuid, 'ended for UNSKIP-04');

  select * into v_unskip_result from unskip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a4'::uuid, v_target);
  if v_unskip_result.changed then
    raise notice 'TEST UNSKIP-04: PASS (ended arrangement''s old skip removed successfully)';
  else raise notice 'TEST UNSKIP-04: FAIL (unskip after end did not succeed)'; end if;
end $$;
reset role;

-- =============================================================================
-- SECTION 8: AUDIT
-- =============================================================================

-- AUDIT-01/02/03/04/05: exactly one event per real mutation, no event for
-- an idempotent no-op, actor/organization correct, before/after shape
-- appropriate — spot-checked against the CREATE-01 arrangement created at
-- the very top of this file plus a fresh pause/resume no-op pair.
do $$
declare
  v_arrangement_id uuid;
  v_create_count int;
  v_actor uuid;
  v_org uuid;
  v_after jsonb;
  v_pause_result public.recurring_arrangement_result;
  v_pause_count_before int;
  v_pause_count_after int;
begin
  select id into v_arrangement_id from public.recurring_arrangements where pickup_description = 'CREATE-01 Pickup';

  select count(*) into v_create_count
    from public.audit_events where entity_id = v_arrangement_id and action = 'recurring_arrangement_created';

  select actor_user_id, organization_id, after_data into v_actor, v_org, v_after
    from public.audit_events where entity_id = v_arrangement_id and action = 'recurring_arrangement_created'
    limit 1;

  if v_create_count = 1
     and v_actor = '20000000-0000-0000-0000-0000000000a1'::uuid
     and v_org = '10000000-0000-0000-0000-0000000000a1'::uuid
     and v_after ? 'passenger_id' and v_after ? 'days_of_week' and v_after ? 'status'
  then
    raise notice 'TEST AUDIT-01/03/04/05: PASS (exactly 1 create audit event, actor=%, org correct, after_data carries operational fields)', v_actor;
  else
    raise notice 'TEST AUDIT-01/03/04/05: FAIL (count=%, actor=%, org=%, after=%)', v_create_count, v_actor, v_org, v_after;
  end if;

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select count(*) into v_pause_count_before from public.audit_events where entity_id = v_arrangement_id and action = 'recurring_arrangement_paused';
  perform pause_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, v_arrangement_id); -- real pause
  perform pause_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, v_arrangement_id); -- idempotent no-op
  select count(*) into v_pause_count_after from public.audit_events where entity_id = v_arrangement_id and action = 'recurring_arrangement_paused';

  if v_pause_count_after - v_pause_count_before = 1 then
    raise notice 'TEST AUDIT-02: PASS (one real pause + one idempotent no-op pause = exactly 1 new audit event, not 2)';
  else raise notice 'TEST AUDIT-02: FAIL (expected +1, got +%)', v_pause_count_after - v_pause_count_before; end if;
end $$;
reset role;

-- =============================================================================
-- SECTION 9: PRIVILEGES
-- =============================================================================

-- PRIV-01. PUBLIC cannot execute any of the 7 new functions.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_recurring_arrangement','edit_recurring_arrangement','pause_recurring_arrangement',
                       'resume_recurring_arrangement','end_recurring_arrangement','skip_recurring_occurrence','unskip_recurring_occurrence')
    and has_function_privilege('public', p.oid, 'EXECUTE');
  if v_bad is null then
    raise notice 'TEST PRIV-01: PASS (PUBLIC cannot execute any of the 7 new RPCs)';
  else raise notice 'TEST PRIV-01: FAIL (PUBLIC can execute: %)', v_bad; end if;
end $$;

-- PRIV-02. Driver cannot execute successfully (create + skip spot-checked).
do $$
declare v_denied int := 0;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
  begin
    perform create_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
      'x', 'x', '08:00'::time, array[1]::smallint[], '2026-01-01'::date, null);
  exception when others then v_denied := v_denied + 1; end;
  begin
    perform skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, 'e3000000-0000-0000-0000-0000000000a1'::uuid, current_date + 1, 'x');
  exception when others then v_denied := v_denied + 1; end;
  if v_denied = 2 then
    raise notice 'TEST PRIV-02: PASS (Driver denied on both create and skip)';
  else raise notice 'TEST PRIV-02: FAIL (denied %/2)', v_denied; end if;
end $$;
reset role;

-- PRIV-04. Raw table mutation still blocked (both tables, all 3 verbs).
do $$
declare v_denied int := 0;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    insert into public.recurring_arrangements (organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone)
    values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'raw', 'raw', '08:00', array[1]::smallint[], '2026-01-01', 'America/New_York');
  exception when others then v_denied := v_denied + 1; end;
  begin
    update public.recurring_arrangements set status = 'ended' where id = 'e1000000-0000-0000-0000-0000000000a1';
  exception when others then v_denied := v_denied + 1; end;
  begin
    delete from public.recurring_arrangements where id = 'e1000000-0000-0000-0000-0000000000a1';
  exception when others then v_denied := v_denied + 1; end;
  begin
    insert into public.recurring_occurrence_exceptions (organization_id, recurring_arrangement_id, service_date, reason)
    values ('10000000-0000-0000-0000-0000000000a1', 'e3000000-0000-0000-0000-0000000000a1', current_date + 1, 'raw');
  exception when others then v_denied := v_denied + 1; end;
  if v_denied = 4 then
    raise notice 'TEST PRIV-04: PASS (raw INSERT/UPDATE/DELETE on recurring_arrangements, raw INSERT on recurring_occurrence_exceptions, all still blocked)';
  else raise notice 'TEST PRIV-04: FAIL (denied %/4)', v_denied; end if;
end $$;
reset role;

-- PRIV-05. Trip recurring link raw mutation still blocked (unchanged from
-- before S1D — this migration never granted UPDATE on this column).
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  update public.trips set recurring_arrangement_id = 'e1000000-0000-0000-0000-0000000000a1' where id = 'e2000000-0000-0000-0000-0000000000a1';
  raise notice 'TEST PRIV-05: FAIL (raw UPDATE of trips.recurring_arrangement_id succeeded)';
exception when others then
  raise notice 'TEST PRIV-05: PASS (raw UPDATE of trips.recurring_arrangement_id denied: %)', sqlerrm;
end $$;
reset role;

do $$ begin raise notice '=== Recurring Arrangement mutation test suite complete ==='; end $$;
