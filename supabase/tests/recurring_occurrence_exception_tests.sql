-- Zenward Platform — Recurring Occurrence Exception (skip-date) foundation
-- tests (P1-E2-S1C). Run against `supabase db reset` fresh-seeded data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/recurring_occurrence_exception_tests.sql
--
-- Covers: table/CHECK constraints, organization-aware composite FK to
-- recurring_arrangements, the (arrangement, date) uniqueness constraint,
-- RLS read access (Org Admin/Dispatcher same-org only, no Driver, no
-- anon, no inactive membership), and the mutation boundary (no raw
-- client INSERT/UPDATE/DELETE at all — a future controlled skip/unskip
-- RPC, not this phase, owns mutation). No skip/unskip RPC exists yet;
-- nothing here tests one.
--
-- METHODOLOGY: identical to recurring_arrangement_foundation_tests.sql
-- and rls_adversarial_tests.sql — `SET ROLE authenticated` + `SET
-- request.jwt.claim.sub = '<user-uuid>'`. Fixtures from supabase/seed.sql
-- (fictional data only); a shared recurring_arrangement fixture is
-- created (as postgres) for every test in this file to reference, and
-- removed at the end.

\set ON_ERROR_STOP off
\pset pager off

-- Shared fixture arrangement (Org A), used by every test below.
do $$
begin
  insert into public.recurring_arrangements
    (id, organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('9b000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'Exception Fixture Pickup', 'Exception Fixture Destination', '08:00', array[1,3,5]::smallint[], '2026-09-01', 'America/New_York');
  insert into public.recurring_arrangements
    (id, organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('9b000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000b1',
     'Exception Fixture Pickup B', 'Exception Fixture Destination B', '08:00', array[2,4]::smallint[], '2026-09-01', 'America/Chicago');
end $$;

-- =============================================================================
-- TABLE / CONSTRAINTS
-- =============================================================================

-- REX-01. A valid exception row is accepted (DB-owner fixture path).
do $$
declare v_id uuid;
begin
  insert into public.recurring_occurrence_exceptions
    (organization_id, recurring_arrangement_id, service_date, reason)
  values
    ('10000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000a1', '2026-09-21', 'holiday')
  returning id into v_id;
  if v_id is not null then raise notice 'TEST REX-01: PASS (valid exception row accepted)';
  else raise notice 'TEST REX-01: FAIL'; end if;
  delete from public.recurring_occurrence_exceptions where id = v_id;
end $$;

-- REX-02. Blank (empty-string) reason rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_occurrence_exceptions
      (organization_id, recurring_arrangement_id, service_date, reason)
    values
      ('10000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000a1', '2026-09-21', '');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST REX-02: FAIL (blank reason accepted)';
  else raise notice 'TEST REX-02: PASS (blank reason rejected)'; end if;
end $$;

-- REX-03. Whitespace-only reason rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_occurrence_exceptions
      (organization_id, recurring_arrangement_id, service_date, reason)
    values
      ('10000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000a1', '2026-09-21', '   ');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST REX-03: FAIL (whitespace-only reason accepted)';
  else raise notice 'TEST REX-03: PASS (whitespace-only reason rejected)'; end if;
end $$;

-- REX-04. Duplicate (arrangement, date) rejected.
do $$
declare v_id uuid;
declare v_failed boolean := false;
begin
  insert into public.recurring_occurrence_exceptions
    (organization_id, recurring_arrangement_id, service_date, reason)
  values
    ('10000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000a1', '2026-09-23', 'first skip')
  returning id into v_id;

  begin
    insert into public.recurring_occurrence_exceptions
      (organization_id, recurring_arrangement_id, service_date, reason)
    values
      ('10000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000a1', '2026-09-23', 'duplicate skip');
    v_failed := true;
  exception when unique_violation then null;
  end;

  if v_failed then raise notice 'TEST REX-04: FAIL (duplicate arrangement/date accepted)';
  else raise notice 'TEST REX-04: PASS (duplicate arrangement/date rejected)'; end if;
  delete from public.recurring_occurrence_exceptions where id = v_id;
end $$;

-- REX-04b. The SAME service_date skipped for a DIFFERENT arrangement is
-- legal (no constraint on service_date alone).
do $$
declare v_id1 uuid;
declare v_id2 uuid;
begin
  insert into public.recurring_occurrence_exceptions
    (organization_id, recurring_arrangement_id, service_date, reason)
  values
    ('10000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000a1', '2026-09-23', 'org A skip')
  returning id into v_id1;
  insert into public.recurring_occurrence_exceptions
    (organization_id, recurring_arrangement_id, service_date, reason)
  values
    ('10000000-0000-0000-0000-0000000000b1', '9b000000-0000-0000-0000-0000000000b1', '2026-09-23', 'org B skip, same date')
  returning id into v_id2;
  if v_id1 is not null and v_id2 is not null then
    raise notice 'TEST REX-04b: PASS (same service_date skipped for two different arrangements is legal)';
  else raise notice 'TEST REX-04b: FAIL'; end if;
  delete from public.recurring_occurrence_exceptions where id in (v_id1, v_id2);
end $$;

-- REX-05. Cross-org arrangement reference rejected at the FK level (Org A
-- exception row, Org B arrangement).
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_occurrence_exceptions
      (organization_id, recurring_arrangement_id, service_date, reason)
    values
      ('10000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000b1', '2026-09-21', 'forged cross-org link');
    v_failed := true;
  exception when foreign_key_violation then null;
  end;
  if v_failed then raise notice 'TEST REX-05: FAIL (cross-org arrangement reference accepted)';
  else raise notice 'TEST REX-05: PASS (cross-org arrangement reference rejected at FK level)'; end if;
end $$;

-- =============================================================================
-- RLS / READ (fixture exception row created and shared across this section)
-- =============================================================================
do $$
begin
  insert into public.recurring_occurrence_exceptions
    (id, organization_id, recurring_arrangement_id, service_date, reason)
  values
    ('9c000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000a1',
     '2026-09-25', 'RLS fixture skip');
end $$;

-- REX-06. Org A admin SELECT same org.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select count(*) into v_count from public.recurring_occurrence_exceptions where id = '9c000000-0000-0000-0000-0000000000a1';
  if v_count = 1 then raise notice 'TEST REX-06: PASS (Org A admin sees Org A exception)';
  else raise notice 'TEST REX-06: FAIL (expected 1, got %)', v_count; end if;
end $$;
reset role;

-- REX-07. Org A dispatcher SELECT same org.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select count(*) into v_count from public.recurring_occurrence_exceptions where id = '9c000000-0000-0000-0000-0000000000a1';
  if v_count = 1 then raise notice 'TEST REX-07: PASS (Org A dispatcher sees Org A exception)';
  else raise notice 'TEST REX-07: FAIL (expected 1, got %)', v_count; end if;
end $$;
reset role;

-- REX-08. Org B admin blocked from Org A's exception.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  select count(*) into v_count from public.recurring_occurrence_exceptions where id = '9c000000-0000-0000-0000-0000000000a1';
  if v_count = 0 then raise notice 'TEST REX-08: PASS (Org B admin cannot see Org A exception)';
  else raise notice 'TEST REX-08: FAIL (expected 0, got %)', v_count; end if;
end $$;
reset role;

-- REX-09. Driver blocked.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
  select count(*) into v_count from public.recurring_occurrence_exceptions where id = '9c000000-0000-0000-0000-0000000000a1';
  if v_count = 0 then raise notice 'TEST REX-09: PASS (Driver cannot read any occurrence exception)';
  else raise notice 'TEST REX-09: FAIL (expected 0, got % — CRITICAL: Driver privacy violated)', v_count; end if;
end $$;
reset role;

-- REX-10. Inactive membership blocked.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a5'; -- inactive dispatcher
  select count(*) into v_count from public.recurring_occurrence_exceptions where id = '9c000000-0000-0000-0000-0000000000a1';
  if v_count = 0 then raise notice 'TEST REX-10: PASS (inactive membership sees zero exceptions)';
  else raise notice 'TEST REX-10: FAIL (expected 0, got %)', v_count; end if;
end $$;
reset role;

-- REX-11. Anonymous blocked.
do $$
declare v_count int;
begin
  set local role anon;
  select count(*) into v_count from public.recurring_occurrence_exceptions;
  raise notice 'TEST REX-11: FAIL (anon SELECT succeeded, returned % rows)', v_count;
exception when others then
  raise notice 'TEST REX-11: PASS (anon denied: %)', sqlerrm;
end $$;
reset role;

-- =============================================================================
-- MUTATION BOUNDARY — no raw client mutation of any kind, for any role.
-- =============================================================================

-- REX-12. Org Admin raw INSERT rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  insert into public.recurring_occurrence_exceptions
    (organization_id, recurring_arrangement_id, service_date, reason)
  values
    ('10000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000a1', '2026-09-28', 'attempted raw insert');
  raise notice 'TEST REX-12: FAIL (Org Admin raw INSERT succeeded)';
exception when others then
  raise notice 'TEST REX-12: PASS (Org Admin raw INSERT denied: %)', sqlerrm;
end $$;
reset role;

-- REX-13. Raw UPDATE rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  update public.recurring_occurrence_exceptions set reason = 'hacked'
    where id = '9c000000-0000-0000-0000-0000000000a1';
  raise notice 'TEST REX-13: FAIL (raw UPDATE succeeded)';
exception when others then
  raise notice 'TEST REX-13: PASS (raw UPDATE denied: %)', sqlerrm;
end $$;
reset role;

-- REX-14. Raw DELETE rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  delete from public.recurring_occurrence_exceptions where id = '9c000000-0000-0000-0000-0000000000a1';
  raise notice 'TEST REX-14: FAIL (raw DELETE succeeded)';
exception when others then
  raise notice 'TEST REX-14: PASS (raw DELETE denied: %)', sqlerrm;
end $$;
reset role;

-- REX-15. Driver raw mutation rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
  insert into public.recurring_occurrence_exceptions
    (organization_id, recurring_arrangement_id, service_date, reason)
  values
    ('10000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000a1', '2026-09-28', 'attempted driver insert');
  raise notice 'TEST REX-15: FAIL (Driver raw INSERT succeeded)';
exception when others then
  raise notice 'TEST REX-15: PASS (Driver raw mutation denied: %)', sqlerrm;
end $$;
reset role;

-- REX-16. No cross-tenant forged write path — an Org A actor cannot
-- INSERT a row claiming Org B, even against Org B's own real arrangement.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  insert into public.recurring_occurrence_exceptions
    (organization_id, recurring_arrangement_id, service_date, reason)
  values
    ('10000000-0000-0000-0000-0000000000b1', '9b000000-0000-0000-0000-0000000000b1', '2026-09-28', 'forged cross-org write');
  raise notice 'TEST REX-16: FAIL (forged cross-org INSERT succeeded)';
exception when others then
  raise notice 'TEST REX-16: PASS (forged cross-org INSERT denied: %)', sqlerrm;
end $$;
reset role;

do $$
begin
  delete from public.recurring_occurrence_exceptions where id = '9c000000-0000-0000-0000-0000000000a1';
end $$;

-- =============================================================================
-- NO EXISTING TRIP/ARRANGEMENT RLS REGRESSION — spot check that adding
-- this table did not disturb recurring_arrangements' own S1B/S1B1 RLS.
-- =============================================================================

-- REX-17. Org A admin still sees the shared arrangement fixture from this
-- same file (recurring_arrangements RLS untouched by this migration).
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select count(*) into v_count from public.recurring_arrangements where id = '9b000000-0000-0000-0000-0000000000a1';
  if v_count = 1 then raise notice 'TEST REX-17: PASS (recurring_arrangements RLS unaffected by this migration)';
  else raise notice 'TEST REX-17: FAIL (expected 1, got %)', v_count; end if;
end $$;
reset role;

-- REX-18. Existing Trip RLS (a real seeded Trip) still works unaffected.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select count(*) into v_count from public.trips where id = '80000000-0000-0000-0000-0000000000a1';
  if v_count = 1 then raise notice 'TEST REX-18: PASS (existing Trip RLS unaffected by this migration)';
  else raise notice 'TEST REX-18: FAIL (expected 1, got %)', v_count; end if;
end $$;
reset role;

do $$
begin
  delete from public.recurring_arrangements where id in ('9b000000-0000-0000-0000-0000000000a1', '9b000000-0000-0000-0000-0000000000b1');
end $$;
