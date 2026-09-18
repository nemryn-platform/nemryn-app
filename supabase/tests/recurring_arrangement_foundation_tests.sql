-- Zenward Platform — Recurring Arrangement domain foundation tests
-- (P1-E2-S1B). Run against `supabase db reset` fresh-seeded data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/recurring_arrangement_foundation_tests.sql
--
-- Covers: table/CHECK constraints (status, timezone, days_of_week,
-- dates, text bounds), organization-aware composite FKs (Passenger,
-- Trip link), RLS read access (Org Admin/Dispatcher same-org only, no
-- Driver, no anon, no inactive membership), the mutation boundary (no
-- raw client INSERT/UPDATE/DELETE on recurring_arrangements at all —
-- S1D owns the future controlled RPCs), and the new
-- trips.recurring_arrangement_id column's own privilege (not raw-
-- client-writable via the existing narrow Trip update-column grant).
--
-- No recurrence evaluation exists yet (S1C) — nothing here tests
-- expected-date generation, skip-dates, or assurance state; there is
-- none to test.
--
-- METHODOLOGY for RLS tests: `SET ROLE authenticated` +
-- `SET request.jwt.claim.sub = '<user-uuid>'`, the same technique
-- rls_adversarial_tests.sql already establishes (postgres is a
-- superuser with BYPASSRLS, so SET ROLE is required to actually become
-- subject to RLS). Fixtures for org/user/passenger/trip ids come from
-- supabase/seed.sql (fictional data only); rows this file itself
-- creates are cleaned up inline, as postgres, after each test.

\set ON_ERROR_STOP off
\pset pager off

-- Fixture ids used throughout (from seed.sql):
--   Org A = 10000000-0000-0000-0000-0000000000a1, Org B = ...b1
--   Org A admin = 20000000-...-a1, dispatcher = ...a2, inactive = ...a5, driver = ...a3
--   Org B admin = 20000000-...-b1
--   Org A passenger = 40000000-...-a1, Org B passenger = ...b1
--   Org A trips = 80000000-...-a1/a2/a3, Org B trip = 80000000-...-b1

-- =============================================================================
-- TABLE / CONSTRAINTS
-- =============================================================================

-- RA-01. A fully valid arrangement insert succeeds.
do $$
declare v_id uuid;
begin
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'Test Pickup', 'Test Destination', '08:00', array[1,3,5]::smallint[], '2026-09-01', 'America/New_York')
  returning id into v_id;
  if v_id is not null then
    raise notice 'TEST RA-01: PASS (valid arrangement insert succeeds)';
  else
    raise notice 'TEST RA-01: FAIL';
  end if;
  delete from public.recurring_arrangements where id = v_id;
end $$;

-- RA-02. Invalid status rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'bogus');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-02: FAIL (invalid status accepted)';
  else raise notice 'TEST RA-02: PASS (invalid status rejected)'; end if;
end $$;

-- RA-03. Invalid timezone rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'EST');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-03: FAIL (invalid timezone EST accepted)';
  else raise notice 'TEST RA-03: PASS (invalid timezone rejected, reuses is_valid_iana_timezone)'; end if;
end $$;

-- RA-04. Empty days_of_week rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', '{}'::smallint[], '2026-09-01', 'America/New_York');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-04: FAIL (empty days_of_week accepted)';
  else raise notice 'TEST RA-04: PASS (empty days_of_week rejected)'; end if;
end $$;

-- RA-05. Duplicate weekdays rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1,1,3]::smallint[], '2026-09-01', 'America/New_York');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-05: FAIL (duplicate weekday {1,1,3} accepted)';
  else raise notice 'TEST RA-05: PASS (duplicate weekday rejected)'; end if;
end $$;

-- RA-06. Unsorted weekdays rejected (not auto-normalized by the table itself).
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[5,3,1]::smallint[], '2026-09-01', 'America/New_York');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-06: FAIL (unsorted weekday {5,3,1} accepted)';
  else raise notice 'TEST RA-06: PASS (unsorted weekday rejected, canonical ascending order required)'; end if;
end $$;

-- RA-07. Weekday outside 1..7 rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[0,1]::smallint[], '2026-09-01', 'America/New_York');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-07: FAIL (out-of-range weekday {0,1} accepted)';
  else raise notice 'TEST RA-07: PASS (out-of-range weekday rejected)'; end if;
end $$;

-- RA-08. end_date before start_date rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, end_date, timezone)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-10', '2026-09-01', 'America/New_York');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-08: FAIL (end_date before start_date accepted)';
  else raise notice 'TEST RA-08: PASS (end_date before start_date rejected)'; end if;
end $$;

-- RA-09. Blank pickup_description rejected (whitespace-only, not just empty string).
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       '   ', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-09: FAIL (whitespace-only pickup_description accepted)';
  else raise notice 'TEST RA-09: PASS (blank pickup_description rejected)'; end if;
end $$;

-- RA-10. Blank destination_description rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', '', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-10: FAIL (blank destination_description accepted)';
  else raise notice 'TEST RA-10: PASS (blank destination_description rejected)'; end if;
end $$;

-- RA-11. status='ended' without ended_at rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, ended_reason)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'ended', 'no longer needed');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-11: FAIL (ended without ended_at accepted)';
  else raise notice 'TEST RA-11: PASS (ended without ended_at rejected)'; end if;
end $$;

-- RA-12. status='ended' without a non-blank ended_reason rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, ended_at)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'ended', now());
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-12: FAIL (ended without ended_reason accepted)';
  else raise notice 'TEST RA-12: PASS (ended without ended_reason rejected)'; end if;
end $$;

-- RA-13. A valid ended shape (status + ended_at + non-blank ended_reason) is accepted.
do $$
declare v_id uuid;
begin
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone, status, ended_at, ended_reason)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'ended', now(), 'care ended')
  returning id into v_id;
  if v_id is not null then raise notice 'TEST RA-13: PASS (valid ended shape accepted)';
  else raise notice 'TEST RA-13: FAIL'; end if;
  delete from public.recurring_arrangements where id = v_id;
end $$;

-- RA-14. status='paused' without paused_at rejected.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'paused');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-14: FAIL (paused without paused_at accepted)';
  else raise notice 'TEST RA-14: PASS (paused without paused_at rejected)'; end if;
end $$;

-- =============================================================================
-- STATUS-SHAPE HARDENING (P1-E2-S1B1) — the exact locked matrix: ACTIVE
-- (paused_at NULL, ended_at/ended_reason NULL), PAUSED (paused_at NOT
-- NULL, ended_at/ended_reason NULL), ENDED (ended_at + non-blank
-- ended_reason required, paused_at UNCONSTRAINED either way — both
-- ending directly from active and ending from paused, retaining
-- paused_at as history, are legal row shapes). Corrects S1B's own
-- original one-directional constraint, which allowed the invalid
-- active+paused_at combination.
-- =============================================================================

-- RA-36. ACTIVE + paused_at NULL -> accept.
do $$
declare v_id uuid;
begin
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone, status, paused_at)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'active', null)
  returning id into v_id;
  if v_id is not null then raise notice 'TEST RA-36: PASS (active + paused_at NULL accepted)';
  else raise notice 'TEST RA-36: FAIL'; end if;
  delete from public.recurring_arrangements where id = v_id;
end $$;

-- RA-37. ACTIVE + paused_at NOT NULL -> reject (the gap this hardening closes).
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, paused_at)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'active', now());
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-37: FAIL (active + paused_at NOT NULL accepted — S1B1 gap not closed)';
  else raise notice 'TEST RA-37: PASS (active + paused_at NOT NULL rejected)'; end if;
end $$;

-- RA-38. ACTIVE + ended_at set -> reject.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, ended_at)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'active', now());
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-38: FAIL (active + ended_at accepted)';
  else raise notice 'TEST RA-38: PASS (active + ended_at rejected)'; end if;
end $$;

-- RA-39. ACTIVE + ended_reason set -> reject.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, ended_reason)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'active', 'premature reason');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-39: FAIL (active + ended_reason accepted)';
  else raise notice 'TEST RA-39: PASS (active + ended_reason rejected)'; end if;
end $$;

-- RA-40. PAUSED + paused_at NOT NULL -> accept.
do $$
declare v_id uuid;
begin
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone, status, paused_at)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'paused', now())
  returning id into v_id;
  if v_id is not null then raise notice 'TEST RA-40: PASS (paused + paused_at NOT NULL accepted)';
  else raise notice 'TEST RA-40: FAIL'; end if;
  delete from public.recurring_arrangements where id = v_id;
end $$;

-- RA-41. PAUSED + paused_at NULL -> reject (same fact as RA-14, restated
-- explicitly as part of the locked matrix).
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, paused_at)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'paused', null);
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-41: FAIL (paused + paused_at NULL accepted)';
  else raise notice 'TEST RA-41: PASS (paused + paused_at NULL rejected)'; end if;
end $$;

-- RA-42. PAUSED + ended_at set -> reject.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, paused_at, ended_at)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'paused', now(), now());
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-42: FAIL (paused + ended_at accepted)';
  else raise notice 'TEST RA-42: PASS (paused + ended_at rejected)'; end if;
end $$;

-- RA-43. PAUSED + ended_reason set -> reject.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, paused_at, ended_reason)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'paused', now(), 'premature reason');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-43: FAIL (paused + ended_reason accepted)';
  else raise notice 'TEST RA-43: PASS (paused + ended_reason rejected)'; end if;
end $$;

-- RA-44. ENDED + ended_at + nonblank reason + paused_at NULL (ended
-- directly from active) -> accept.
do $$
declare v_id uuid;
begin
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone, status, paused_at, ended_at, ended_reason)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'ended', null, now(), 'ended from active')
  returning id into v_id;
  if v_id is not null then raise notice 'TEST RA-44: PASS (ended from active: paused_at NULL accepted)';
  else raise notice 'TEST RA-44: FAIL'; end if;
  delete from public.recurring_arrangements where id = v_id;
end $$;

-- RA-45. ENDED + ended_at + nonblank reason + paused_at NOT NULL (ended
-- directly from paused, paused_at retained as history) -> accept. This is
-- the exact compatibility case S1A1/S1D need: ending from paused must
-- remain legal without this migration presuming whether paused_at is
-- cleared or retained.
do $$
declare v_id uuid;
begin
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone, status, paused_at, ended_at, ended_reason)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'ended', now() - interval '1 day', now(), 'ended from paused')
  returning id into v_id;
  if v_id is not null then raise notice 'TEST RA-45: PASS (ended from paused: paused_at NOT NULL accepted, retained as history)';
  else raise notice 'TEST RA-45: FAIL'; end if;
  delete from public.recurring_arrangements where id = v_id;
end $$;

-- RA-46. ENDED + ended_at NULL -> reject (restates RA-11 as part of the
-- locked matrix, alongside the new paused_at cases).
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, ended_reason)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'ended', 'valid reason');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-46: FAIL (ended + ended_at NULL accepted)';
  else raise notice 'TEST RA-46: PASS (ended + ended_at NULL rejected)'; end if;
end $$;

-- RA-47. ENDED + ended_reason NULL -> reject (restates RA-12).
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, ended_at)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'ended', now());
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-47: FAIL (ended + ended_reason NULL accepted)';
  else raise notice 'TEST RA-47: PASS (ended + ended_reason NULL rejected)'; end if;
end $$;

-- RA-48. ENDED + blank (empty-string) ended_reason -> reject.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, ended_at, ended_reason)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'ended', now(), '');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-48: FAIL (ended + blank ended_reason accepted)';
  else raise notice 'TEST RA-48: PASS (ended + blank ended_reason rejected)'; end if;
end $$;

-- RA-49. ENDED + whitespace-only ended_reason -> reject.
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status, ended_at, ended_reason)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'ended', now(), '   ');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-49: FAIL (ended + whitespace-only ended_reason accepted)';
  else raise notice 'TEST RA-49: PASS (ended + whitespace-only ended_reason rejected)'; end if;
end $$;

-- RA-50. Invalid status -> reject (restates RA-02 as part of the locked matrix).
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone, status)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York', 'not_a_real_status');
    v_failed := true;
  exception when check_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-50: FAIL (invalid status accepted)';
  else raise notice 'TEST RA-50: PASS (invalid status rejected)'; end if;
end $$;

-- =============================================================================
-- TENANCY / FK
-- =============================================================================

-- RA-15. Same-org Passenger reference accepted.
do $$
declare v_id uuid;
begin
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York')
  returning id into v_id;
  if v_id is not null then raise notice 'TEST RA-15: PASS (same-org passenger accepted)';
  else raise notice 'TEST RA-15: FAIL'; end if;
  delete from public.recurring_arrangements where id = v_id;
end $$;

-- RA-16. Cross-org Passenger reference rejected at the FK level (Org A
-- arrangement, Org B passenger).
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.recurring_arrangements
      (organization_id, passenger_id, pickup_description, destination_description,
       pickup_time, days_of_week, start_date, timezone)
    values
      ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000b1',
       'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York');
    v_failed := true;
  exception when foreign_key_violation then null;
  end;
  if v_failed then raise notice 'TEST RA-16: FAIL (cross-org passenger reference accepted)';
  else raise notice 'TEST RA-16: PASS (cross-org passenger reference rejected at FK level)'; end if;
end $$;

-- RA-17. Same-org Trip -> Arrangement link accepted.
do $$
declare v_arr_id uuid;
declare v_ok boolean := false;
begin
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York')
  returning id into v_arr_id;

  update public.trips set recurring_arrangement_id = v_arr_id
    where id = '80000000-0000-0000-0000-0000000000a1';
  select (recurring_arrangement_id = v_arr_id) into v_ok
    from public.trips where id = '80000000-0000-0000-0000-0000000000a1';

  if v_ok then raise notice 'TEST RA-17: PASS (same-org Trip->Arrangement link accepted)';
  else raise notice 'TEST RA-17: FAIL'; end if;

  update public.trips set recurring_arrangement_id = null where id = '80000000-0000-0000-0000-0000000000a1';
  delete from public.recurring_arrangements where id = v_arr_id;
end $$;

-- RA-18. Cross-org Trip -> Arrangement link rejected at the FK level (Org B
-- Trip attempting to reference an Org A arrangement).
do $$
declare v_arr_id uuid;
declare v_failed boolean := false;
begin
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York')
  returning id into v_arr_id;

  begin
    update public.trips set recurring_arrangement_id = v_arr_id
      where id = '80000000-0000-0000-0000-0000000000b1';
    v_failed := true;
  exception when foreign_key_violation then null;
  end;

  if v_failed then raise notice 'TEST RA-18: FAIL (cross-org Trip->Arrangement link accepted)';
  else raise notice 'TEST RA-18: PASS (cross-org Trip->Arrangement link rejected at FK level)'; end if;

  delete from public.recurring_arrangements where id = v_arr_id;
end $$;

-- RA-19. trips.recurring_arrangement_id is nullable and every ordinary
-- one-off Trip (the overwhelming majority) remains valid with it unset.
do $$
declare v_count int;
begin
  select count(*) into v_count from public.trips where recurring_arrangement_id is null;
  if v_count > 0 then raise notice 'TEST RA-19: PASS (% existing Trip rows remain valid with recurring_arrangement_id NULL)', v_count;
  else raise notice 'TEST RA-19: FAIL'; end if;
end $$;

-- RA-20 / RA-21. Multiple Trips may share the same arrangement, including
-- on the same service date (e.g. outbound + return) — no uniqueness
-- constraint of any kind blocks this.
do $$
declare v_arr_id uuid;
declare v_count int;
begin
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York')
  returning id into v_arr_id;

  update public.trips set recurring_arrangement_id = v_arr_id, scheduled_pickup_at = '2026-09-21T13:00:00Z'
    where id = '80000000-0000-0000-0000-0000000000a1';
  update public.trips set recurring_arrangement_id = v_arr_id, scheduled_pickup_at = '2026-09-21T17:00:00Z'
    where id = '80000000-0000-0000-0000-0000000000a2';

  select count(*) into v_count from public.trips
    where recurring_arrangement_id = v_arr_id and scheduled_pickup_at::date = '2026-09-21';

  if v_count = 2 then raise notice 'TEST RA-20/21: PASS (2 Trips on the same service date legally share one arrangement)';
  else raise notice 'TEST RA-20/21: FAIL (expected 2, got %)', v_count; end if;

  update public.trips set recurring_arrangement_id = null where id in ('80000000-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-0000000000a2');
  delete from public.recurring_arrangements where id = v_arr_id;
end $$;

-- =============================================================================
-- RLS / READ (fixture arrangement created and shared across this section)
-- =============================================================================
do $$
begin
  insert into public.recurring_arrangements
    (id, organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('9a000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'RLS Fixture Pickup', 'RLS Fixture Destination', '08:00', array[1,3,5]::smallint[], '2026-09-01', 'America/New_York');
end $$;

-- RA-22. Org A admin sees Org A arrangements.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select count(*) into v_count from public.recurring_arrangements where id = '9a000000-0000-0000-0000-0000000000a1';
  if v_count = 1 then raise notice 'TEST RA-22: PASS (Org A admin sees Org A arrangement)';
  else raise notice 'TEST RA-22: FAIL (expected 1, got %)', v_count; end if;
end $$;
reset role;

-- RA-23. Org A dispatcher sees Org A arrangements.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select count(*) into v_count from public.recurring_arrangements where id = '9a000000-0000-0000-0000-0000000000a1';
  if v_count = 1 then raise notice 'TEST RA-23: PASS (Org A dispatcher sees Org A arrangement)';
  else raise notice 'TEST RA-23: FAIL (expected 1, got %)', v_count; end if;
end $$;
reset role;

-- RA-24. Org B admin cannot see Org A arrangements.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  select count(*) into v_count from public.recurring_arrangements where id = '9a000000-0000-0000-0000-0000000000a1';
  if v_count = 0 then raise notice 'TEST RA-24: PASS (Org B admin cannot see Org A arrangement)';
  else raise notice 'TEST RA-24: FAIL (expected 0, got %)', v_count; end if;
end $$;
reset role;

-- RA-25. Driver cannot read any arrangement, even for an org they belong to.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
  select count(*) into v_count from public.recurring_arrangements where id = '9a000000-0000-0000-0000-0000000000a1';
  if v_count = 0 then raise notice 'TEST RA-25: PASS (Driver cannot read any RecurringArrangement row)';
  else raise notice 'TEST RA-25: FAIL (expected 0, got % — CRITICAL: Driver privacy violated)', v_count; end if;
end $$;
reset role;

-- RA-26. Anonymous/unauthenticated cannot read (no grant to anon at all).
do $$
declare v_count int;
begin
  set local role anon;
  select count(*) into v_count from public.recurring_arrangements;
  raise notice 'TEST RA-26: FAIL (anon SELECT succeeded, returned % rows)', v_count;
exception when others then
  raise notice 'TEST RA-26: PASS (anon denied: %)', sqlerrm;
end $$;
reset role;

-- RA-27. Inactive membership cannot read, same organization.
do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a5'; -- inactive dispatcher
  select count(*) into v_count from public.recurring_arrangements where id = '9a000000-0000-0000-0000-0000000000a1';
  if v_count = 0 then raise notice 'TEST RA-27: PASS (inactive membership sees zero arrangements)';
  else raise notice 'TEST RA-27: FAIL (expected 0, got %)', v_count; end if;
end $$;
reset role;

-- =============================================================================
-- MUTATION BOUNDARY — no raw client mutation of any kind, for any role.
-- S1D owns the future controlled create/edit/pause/resume/end RPCs; until
-- then this table is read-only to the application, deliberately.
-- =============================================================================

-- RA-28. Org Admin raw INSERT rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York');
  raise notice 'TEST RA-28: FAIL (Org Admin raw INSERT succeeded)';
exception when others then
  raise notice 'TEST RA-28: PASS (Org Admin raw INSERT denied: %)', sqlerrm;
end $$;
reset role;

-- RA-29. Dispatcher raw INSERT rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York');
  raise notice 'TEST RA-29: FAIL (Dispatcher raw INSERT succeeded)';
exception when others then
  raise notice 'TEST RA-29: PASS (Dispatcher raw INSERT denied: %)', sqlerrm;
end $$;
reset role;

-- RA-30. Raw UPDATE rejected (Org Admin attempting to edit the RLS-visible fixture).
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  update public.recurring_arrangements set pickup_description = 'Hacked'
    where id = '9a000000-0000-0000-0000-0000000000a1';
  raise notice 'TEST RA-30: FAIL (raw UPDATE succeeded)';
exception when others then
  raise notice 'TEST RA-30: PASS (raw UPDATE denied: %)', sqlerrm;
end $$;
reset role;

-- RA-31. Raw DELETE rejected.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  delete from public.recurring_arrangements where id = '9a000000-0000-0000-0000-0000000000a1';
  raise notice 'TEST RA-31: FAIL (raw DELETE succeeded)';
exception when others then
  raise notice 'TEST RA-31: PASS (raw DELETE denied: %)', sqlerrm;
end $$;
reset role;

-- RA-32. Driver raw mutation rejected (attempt, as a Driver, to insert).
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York');
  raise notice 'TEST RA-32: FAIL (Driver raw INSERT succeeded)';
exception when others then
  raise notice 'TEST RA-32: PASS (Driver raw mutation denied: %)', sqlerrm;
end $$;
reset role;

-- RA-33. A forged organization_id cannot be used to create a cross-org row
-- (subsumed by the blanket no-INSERT-grant boundary above, but stated
-- explicitly: an Org A actor cannot INSERT a row claiming Org B).
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  insert into public.recurring_arrangements
    (organization_id, passenger_id, pickup_description, destination_description,
     pickup_time, days_of_week, start_date, timezone)
  values
    ('10000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000b1',
     'P', 'D', '08:00', array[1]::smallint[], '2026-09-01', 'America/New_York');
  raise notice 'TEST RA-33: FAIL (forged cross-org INSERT succeeded)';
exception when others then
  raise notice 'TEST RA-33: PASS (forged cross-org INSERT denied: %)', sqlerrm;
end $$;
reset role;

do $$
begin
  delete from public.recurring_arrangements where id = '9a000000-0000-0000-0000-0000000000a1';
end $$;

-- =============================================================================
-- TRIP COLUMN PRIVILEGE — the new trips.recurring_arrangement_id column
-- must not become client-writable merely because it was added to a table
-- that already has a narrow, pre-existing update-column grant.
-- =============================================================================

-- RA-34. `authenticated` cannot raw-set trips.recurring_arrangement_id via
-- column privilege (static introspection, matching mutation_privilege_
-- tests.sql's own has_table_privilege/has_column_privilege methodology).
do $$
begin
  if has_column_privilege('authenticated', 'public.trips', 'recurring_arrangement_id', 'UPDATE') then
    raise notice 'TEST RA-34: FAIL (authenticated has UPDATE privilege on trips.recurring_arrangement_id)';
  else
    raise notice 'TEST RA-34: PASS (authenticated has no UPDATE privilege on trips.recurring_arrangement_id)';
  end if;
end $$;

-- RA-34b. Live confirmation, not just static introspection: an
-- authenticated Org Admin attempting to set the column directly via UPDATE
-- is denied.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  update public.trips set recurring_arrangement_id = gen_random_uuid()
    where id = '80000000-0000-0000-0000-0000000000a1';
  raise notice 'TEST RA-34b: FAIL (raw client UPDATE of trips.recurring_arrangement_id succeeded)';
exception when others then
  raise notice 'TEST RA-34b: PASS (raw client UPDATE of trips.recurring_arrangement_id denied: %)', sqlerrm;
end $$;
reset role;

-- RA-35. Existing legitimate Trip mutation (a column that IS in the narrow
-- grant list) remains usable — this migration must not have accidentally
-- narrowed or broken the pre-existing Trip update grant.
do $$
declare v_before text;
declare v_after text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select instructions into v_before from public.trips where id = '80000000-0000-0000-0000-0000000000a1';
  update public.trips set instructions = 'S1B regression check' where id = '80000000-0000-0000-0000-0000000000a1';
  select instructions into v_after from public.trips where id = '80000000-0000-0000-0000-0000000000a1';
  if v_after = 'S1B regression check' then
    raise notice 'TEST RA-35: PASS (existing legitimate Trip field update still works)';
  else
    raise notice 'TEST RA-35: FAIL (expected update to apply, before=% after=%)', v_before, v_after;
  end if;
end $$;
reset role;
do $$
begin
  update public.trips set instructions = null where id = '80000000-0000-0000-0000-0000000000a1';
end $$;
