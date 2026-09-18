-- Zenward Platform — Controlled Recurring Occurrence -> Trip creation
-- tests (P1-E2-S1E). Run against `supabase db reset` fresh-seeded data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/recurring_trip_creation_tests.sql
--
-- Covers create_trip_for_recurring_occurrence and its internal
-- _organization_local_to_utc DST-safe helper. METHODOLOGY: identical to
-- recurring_arrangement_mutation_tests.sql — `SET ROLE authenticated` +
-- `SET request.jwt.claim.sub`, both set INSIDE a `do $$ ... $$` block.
-- All fixture dates are relative to real "today" via CURRENT_DATE
-- arithmetic, never hardcoded to one specific calendar date.

\set ON_ERROR_STOP off
\pset pager off

-- =============================================================================
-- SECTION 1: _organization_local_to_utc — DST safety (§26)
-- =============================================================================

-- TEST DST-01. Normal date, no DST edge.
do $$
declare v_status text; v_utc timestamptz;
begin
  select status, utc into v_status, v_utc from public._organization_local_to_utc('2026-09-21'::date, '08:00'::time, 'America/New_York');
  if v_status = 'ok' and v_utc = '2026-09-21T12:00:00Z'::timestamptz then
    raise notice 'TEST DST-01: PASS (normal date resolves correctly: %)', v_utc;
  else raise notice 'TEST DST-01: FAIL (status=%, utc=%)', v_status, v_utc; end if;
end $$;

-- TEST DST-02. Spring-forward gap (2026-03-08, NY: 2:00 AM -> 3:00 AM) — 2:30 AM is nonexistent.
do $$
declare v_status text;
begin
  select status into v_status from public._organization_local_to_utc('2026-03-08'::date, '02:30'::time, 'America/New_York');
  if v_status = 'nonexistent' then
    raise notice 'TEST DST-02: PASS (spring-forward gap correctly detected as nonexistent, never silently guessed)';
  else raise notice 'TEST DST-02: FAIL (status=%)', v_status; end if;
end $$;

-- TEST DST-02b. Just before/after the spring-forward gap both resolve OK, with the correct differing UTC offset.
do $$
declare v_before_utc timestamptz; v_after_utc timestamptz;
begin
  select utc into v_before_utc from public._organization_local_to_utc('2026-03-08'::date, '01:30'::time, 'America/New_York');
  select utc into v_after_utc from public._organization_local_to_utc('2026-03-08'::date, '03:30'::time, 'America/New_York');
  if v_before_utc = '2026-03-08T06:30:00Z'::timestamptz and v_after_utc = '2026-03-08T07:30:00Z'::timestamptz then
    raise notice 'TEST DST-02b: PASS (before=% at EST, after=% at EDT — correct offset change)', v_before_utc, v_after_utc;
  else raise notice 'TEST DST-02b: FAIL (before=%, after=%)', v_before_utc, v_after_utc; end if;
end $$;

-- TEST DST-03. Fall-back repeated hour (2026-11-01, NY: 2:00 AM -> 1:00 AM) — 1:30 AM is ambiguous.
do $$
declare v_status text;
begin
  select status into v_status from public._organization_local_to_utc('2026-11-01'::date, '01:30'::time, 'America/New_York');
  if v_status = 'ambiguous' then
    raise notice 'TEST DST-03: PASS (fall-back repeated hour correctly detected as ambiguous, never silently guessed)';
  else raise notice 'TEST DST-03: FAIL (status=%)', v_status; end if;
end $$;

-- TEST DST-03b. Just before/after the fall-back repeated hour both resolve OK, with the correct differing UTC offset.
do $$
declare v_before_utc timestamptz; v_after_utc timestamptz;
begin
  select utc into v_before_utc from public._organization_local_to_utc('2026-11-01'::date, '00:30'::time, 'America/New_York');
  select utc into v_after_utc from public._organization_local_to_utc('2026-11-01'::date, '03:30'::time, 'America/New_York');
  if v_before_utc = '2026-11-01T04:30:00Z'::timestamptz and v_after_utc = '2026-11-01T08:30:00Z'::timestamptz then
    raise notice 'TEST DST-03b: PASS (before=% at EDT, after=% at EST — correct offset change)', v_before_utc, v_after_utc;
  else raise notice 'TEST DST-03b: FAIL (before=%, after=%)', v_before_utc, v_after_utc; end if;
end $$;

-- =============================================================================
-- SECTION 2: Fixtures
-- =============================================================================
do $$
declare v_next_mon date := current_date + ((8 - extract(isodow from current_date)::int) % 7);
begin
  -- Main daily active arrangement.
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
  values ('9a100000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'RTC main pickup', 'RTC main dest', '08:00', array[1,2,3,4,5,6,7]::smallint[], current_date - interval '1 year', 'America/New_York', 'active');

  -- Before-start arrangement (Wednesday-only, starts 60 days out).
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
  values ('9a100000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'RTC before-start', 'RTC dest', '08:00', array[3]::smallint[], current_date + interval '60 days', 'America/New_York', 'active');

  -- After-end arrangement (Wednesday-only, ends in 3 days).
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, end_date, timezone, status)
  values ('9a100000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'RTC after-end', 'RTC dest', '08:00', array[3]::smallint[], current_date - interval '1 year', current_date + interval '3 days', 'America/New_York', 'active');

  -- Paused arrangement, daily, cutoff = today+2.
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, paused_at)
  values ('9a100000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'RTC paused', 'RTC dest', '08:00', array[1,2,3,4,5,6,7]::smallint[], current_date - interval '1 year', 'America/New_York', 'paused',
    ((current_date + 2)::text || 'T16:00:00Z')::timestamptz);

  -- Ended arrangement, daily, ended-effective cutoff = today+2 (a still-legitimate pre-cutoff date must remain creatable).
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, ended_at, ended_reason)
  values ('9a100000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'RTC ended', 'RTC dest', '08:00', array[1,2,3,4,5,6,7]::smallint[], current_date - interval '1 year', 'America/New_York', 'ended',
    ((current_date + 2)::text || 'T16:00:00Z')::timestamptz, 'test end');

  -- Skipped date on the main arrangement.
  insert into public.recurring_occurrence_exceptions (organization_id, recurring_arrangement_id, service_date, reason)
  values ('10000000-0000-0000-0000-0000000000a1', '9a100000-0000-0000-0000-0000000000a1', current_date + 1, 'test skip');

  -- Org B arrangement (isolation).
  insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
  values ('9a100000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000b1', 'RTC org B', 'RTC dest', '08:00', array[1,2,3,4,5,6,7]::smallint[], current_date - interval '1 year', 'America/Chicago', 'active');
end $$;

-- =============================================================================
-- SECTION 3: SERVICE-DATE VALIDATION (§25)
-- =============================================================================

-- TEST RTC-01. Non-pattern weekday rejected (main arrangement is daily — use a Wednesday-only arrangement instead to get a genuine mismatch: reuse before-start's own pattern by picking a non-Wednesday date within its eventual range is awkward; instead assert directly against the paused arrangement's daily pattern by requesting a date NOT in [1..7] is impossible, so this test uses arrangement a2 (Wednesday-only) with a Monday date that is otherwise in-range).
do $$
declare v_target date;
begin
  select min(d::date) into v_target from generate_series((current_date+61)::timestamp, (current_date+75)::timestamp, interval '1 day') as d where extract(isodow from d) = 1;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a2'::uuid, v_target);
  raise notice 'TEST RTC-01: FAIL (non-pattern weekday accepted)';
exception when others then
  raise notice 'TEST RTC-01: PASS (non-pattern weekday denied: %)', sqlerrm;
end $$;
reset role;

-- TEST RTC-02. Before-start rejected.
do $$
declare v_target date;
begin
  select min(d::date) into v_target from generate_series((current_date+25)::timestamp, (current_date+35)::timestamp, interval '1 day') as d where extract(isodow from d) = 3;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a2'::uuid, v_target);
  raise notice 'TEST RTC-02: FAIL (before-start date accepted)';
exception when others then
  raise notice 'TEST RTC-02: PASS (before-start denied: %)', sqlerrm;
end $$;
reset role;

-- TEST RTC-03. After-end rejected.
do $$
declare v_target date;
begin
  select min(d::date) into v_target from generate_series((current_date+4)::timestamp, (current_date+14)::timestamp, interval '1 day') as d where extract(isodow from d) = 3;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a3'::uuid, v_target);
  raise notice 'TEST RTC-03: FAIL (after-end date accepted)';
exception when others then
  raise notice 'TEST RTC-03: PASS (after-end denied: %)', sqlerrm;
end $$;
reset role;

-- TEST RTC-04. Past date rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, current_date - 1);
  raise notice 'TEST RTC-04: FAIL (past date accepted)';
exception when others then
  raise notice 'TEST RTC-04: PASS (past date denied: %)', sqlerrm;
end $$;
reset role;

-- TEST RTC-05. Skipped date rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, current_date + 1);
  raise notice 'TEST RTC-05: FAIL (skipped date accepted)';
exception when others then
  raise notice 'TEST RTC-05: PASS (skipped date denied: %)', sqlerrm;
end $$;
reset role;

-- TEST RTC-06. Date on/after pause cutoff rejected; date before cutoff succeeds.
do $$
declare v_cutoff date := current_date + 2;
declare v_before_cutoff date := current_date + 1;
declare v_result public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a4'::uuid, v_cutoff);
    raise notice 'TEST RTC-06a: FAIL (on/after pause-cutoff date accepted)';
  exception when others then
    raise notice 'TEST RTC-06a: PASS (on/after pause-cutoff denied: %)', sqlerrm;
  end;
  select * into v_result from create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a4'::uuid, v_before_cutoff);
  if v_result.created then
    raise notice 'TEST RTC-06b: PASS (date before pause-cutoff succeeds)';
  else raise notice 'TEST RTC-06b: FAIL'; end if;
end $$;
reset role;

-- TEST RTC-07. Ended arrangement: date on/after the ended-effective cutoff rejected, but a date BEFORE it still succeeds (the deliberate divergence from skip_recurring_occurrence's own stricter unconditional-ended rule, §25).
do $$
declare v_cutoff date := current_date + 2;
declare v_before_cutoff date := current_date + 1;
declare v_result public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a5'::uuid, v_cutoff);
    raise notice 'TEST RTC-07a: FAIL (on/after ended-cutoff date accepted)';
  exception when others then
    raise notice 'TEST RTC-07a: PASS (on/after ended-cutoff denied: %)', sqlerrm;
  end;
  select * into v_result from create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a5'::uuid, v_before_cutoff);
  if v_result.created then
    raise notice 'TEST RTC-07b: PASS (pre-cutoff date on an ENDED arrangement still succeeds — legitimate catch-up, unlike skip''s own stricter rule)';
  else raise notice 'TEST RTC-07b: FAIL'; end if;
end $$;
reset role;

-- =============================================================================
-- SECTION 4: CORE CREATION BEHAVIOR (§24/§26/§30/§31)
-- =============================================================================

-- TEST RTC-08. Missing -> Trip created -> scheduled, correct shape.
do $$
declare v_target date;
declare v_result public.trip_creation_result;
declare v_trip public.trips;
declare v_expected_utc timestamptz;
begin
  select min(d::date) into v_target from generate_series((current_date+5)::timestamp, (current_date+12)::timestamp, interval '1 day') as d;
  -- Computed as postgres, BEFORE switching role below — the internal-only
  -- helper has no grant to authenticated at all (by design), so this
  -- independent expected-value computation must happen while still
  -- running as the connection's own default role.
  select utc into v_expected_utc from public._organization_local_to_utc(v_target, '08:00'::time, 'America/New_York');

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';

  select * into v_result from create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, v_target);
  select * into v_trip from public.trips where id = v_result.trip_id;

  if v_result.created
     and v_result.state = 'scheduled'
     and v_trip.recurring_arrangement_id = '9a100000-0000-0000-0000-0000000000a1'::uuid
     and v_trip.passenger_id = '40000000-0000-0000-0000-0000000000a1'::uuid
     and v_trip.pickup_description = 'RTC main pickup'
     and v_trip.destination_description = 'RTC main dest'
     and v_trip.scheduled_pickup_at = v_expected_utc
     and v_trip.state = 'scheduled'
  then
    raise notice 'TEST RTC-08: PASS (Trip created with correct passenger/descriptions/recurring_arrangement_id/scheduled_pickup_at=%)', v_trip.scheduled_pickup_at;
  else
    raise notice 'TEST RTC-08: FAIL (trip=%)', row_to_json(v_trip);
  end if;
end $$;
reset role;

-- TEST RTC-09. No Driver/Vehicle assignment automatically created.
do $$
declare v_target date := current_date + 6; -- distinct from RTC-08's own +5
declare v_result public.trip_creation_result;
declare v_assignment_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select * into v_result from create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, v_target);
  select count(*) into v_assignment_count from public.trip_assignments where trip_id = v_result.trip_id;
  if v_assignment_count = 0 then
    raise notice 'TEST RTC-09: PASS (no Driver/Vehicle assignment auto-created)';
  else raise notice 'TEST RTC-09: FAIL (assignment_count=%)', v_assignment_count; end if;
end $$;
reset role;

-- TEST RTC-10. Double submission (sequential) -> exactly one Trip, second returns created=false with the SAME trip_id.
do $$
declare v_target date;
declare v_result1 public.trip_creation_result;
declare v_result2 public.trip_creation_result;
declare v_trip_count int;
begin
  select min(d::date) into v_target from generate_series((current_date+13)::timestamp, (current_date+13)::timestamp, interval '1 day') as d; -- day 13, distinct from prior tests' own picks
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result1 from create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, v_target);
  select * into v_result2 from create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, v_target);
  select count(*) into v_trip_count from public.trips where recurring_arrangement_id = '9a100000-0000-0000-0000-0000000000a1' and scheduled_pickup_at::date = v_target;
  if v_result1.created and not v_result2.created and v_result1.trip_id = v_result2.trip_id and v_trip_count = 1 then
    raise notice 'TEST RTC-10: PASS (double submission -> exactly 1 Trip, second call idempotent no-op returning the SAME trip)';
  else raise notice 'TEST RTC-10: FAIL (created1=%, created2=%, same_trip=%, trip_count=%)', v_result1.created, v_result2.created, v_result1.trip_id = v_result2.trip_id, v_trip_count; end if;
end $$;
reset role;

-- TEST RTC-11. Cancelled Trip + create -> genuine replacement (never resurrects/rewrites the cancelled one).
do $$
declare v_target date;
declare v_cancelled_trip_id uuid;
declare v_result public.trip_creation_result;
begin
  select min(d::date) into v_target from generate_series((current_date+14)::timestamp, (current_date+14)::timestamp, interval '1 day') as d;
  insert into public.trips (id, organization_id, passenger_id, recurring_arrangement_id, state, scheduled_pickup_at, pickup_description, destination_description, cancelled_at, cancellation_reason)
  values (gen_random_uuid(), '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '9a100000-0000-0000-0000-0000000000a1', 'cancelled',
    (v_target::text || 'T12:00:00Z')::timestamptz, 'old', 'old', now(), 'test cancel')
  returning id into v_cancelled_trip_id;

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, v_target);

  if v_result.created and v_result.trip_id <> v_cancelled_trip_id then
    raise notice 'TEST RTC-11: PASS (a genuine replacement Trip was created, cancelled Trip untouched)';
  else raise notice 'TEST RTC-11: FAIL (created=%, same_as_cancelled=%)', v_result.created, v_result.trip_id = v_cancelled_trip_id; end if;

  -- Confirm the cancelled Trip's own row is unchanged.
  if exists (select 1 from public.trips where id = v_cancelled_trip_id and state = 'cancelled' and pickup_description = 'old') then
    raise notice 'TEST RTC-11b: PASS (cancelled Trip row completely unmodified)';
  else raise notice 'TEST RTC-11b: FAIL (cancelled Trip was mutated)'; end if;
end $$;
reset role;

-- TEST RTC-12. Audit behavior: exactly one 'trip_created' (from create_trip) and one 'recurring_occurrence_trip_created' (from this RPC) event per real creation; no new audit events on the idempotent no-op.
do $$
declare v_target date;
declare v_result1 public.trip_creation_result;
declare v_result2 public.trip_creation_result;
declare v_trip_created_count int;
declare v_recurring_event_count int;
begin
  select min(d::date) into v_target from generate_series((current_date+8)::timestamp, (current_date+8)::timestamp, interval '1 day') as d;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select * into v_result1 from create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, v_target);
  select * into v_result2 from create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, v_target);
  reset role;

  select count(*) into v_trip_created_count from public.audit_events where entity_id = v_result1.trip_id and action = 'trip_created';
  select count(*) into v_recurring_event_count from public.audit_events where entity_type = 'recurring_arrangement' and action = 'recurring_occurrence_trip_created' and after_data->>'trip_id' = v_result1.trip_id::text;

  if v_trip_created_count = 1 and v_recurring_event_count = 1 then
    raise notice 'TEST RTC-12: PASS (exactly 1 trip_created event + 1 recurring_occurrence_trip_created event, no duplicates from the idempotent no-op retry)';
  else raise notice 'TEST RTC-12: FAIL (trip_created=%, recurring_event=%)', v_trip_created_count, v_recurring_event_count; end if;
end $$;

-- =============================================================================
-- SECTION 5: AUTHORIZATION / ISOLATION
-- =============================================================================

-- TEST RTC-13. Driver denied.
do $$
declare v_target date;
begin
  select min(d::date) into v_target from generate_series((current_date+6)::timestamp, (current_date+6)::timestamp, interval '1 day') as d;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
  perform create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, v_target);
  raise notice 'TEST RTC-13: FAIL (Driver create succeeded)';
exception when others then
  raise notice 'TEST RTC-13: PASS (Driver denied: %)', sqlerrm;
end $$;
reset role;

-- TEST RTC-14. Forged organization rejected.
do $$
declare v_target date;
begin
  select min(d::date) into v_target from generate_series((current_date+7)::timestamp, (current_date+7)::timestamp, interval '1 day') as d;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  perform create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000b1'::uuid, '9a100000-0000-0000-0000-0000000000a1'::uuid, v_target);
  raise notice 'TEST RTC-14: FAIL (Org B actor against Org A arrangement succeeded)';
exception when others then
  raise notice 'TEST RTC-14: PASS (cross-org forged access denied: %)', sqlerrm;
end $$;
reset role;

-- TEST RTC-15. Org isolation: Org B admin can create for Org B's own arrangement.
do $$
declare v_target date;
declare v_result public.trip_creation_result;
begin
  select min(d::date) into v_target from generate_series((current_date+9)::timestamp, (current_date+9)::timestamp, interval '1 day') as d;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  select * into v_result from create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000b1'::uuid, '9a100000-0000-0000-0000-0000000000b1'::uuid, v_target);
  if v_result.created and v_result.organization_id = '10000000-0000-0000-0000-0000000000b1'::uuid then
    raise notice 'TEST RTC-15: PASS (Org B admin creates normally for Org B''s own arrangement)';
  else raise notice 'TEST RTC-15: FAIL'; end if;
end $$;
reset role;

-- =============================================================================
-- SECTION 6: FUNCTION PRIVILEGES
-- =============================================================================

-- TEST RTC-16. PUBLIC cannot execute create_trip_for_recurring_occurrence or _organization_local_to_utc.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_trip_for_recurring_occurrence', '_organization_local_to_utc')
    and has_function_privilege('public', p.oid, 'EXECUTE');
  if v_bad is null then
    raise notice 'TEST RTC-16: PASS (PUBLIC cannot execute either new function)';
  else raise notice 'TEST RTC-16: FAIL (PUBLIC can execute: %)', v_bad; end if;
end $$;

do $$ begin raise notice '=== Recurring Trip creation test suite complete ==='; end $$;
