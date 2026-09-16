-- Zenward Platform — Request mutation foundation atomicity / forced-
-- failure rollback tests (P1-E1-S2B). Run as postgres.
--
-- Proves that each RPC's primary write + its request_events INSERT roll
-- back as a single unit when the LAST write (the event insert) fails —
-- not merely "no error was observed", but a positive check that the
-- earlier write in that same call was undone. Same mechanism as
-- create_trip_atomicity_tests.sql: a temporary trigger on request_events,
-- installed and removed by this script, never a permanent object.
--
-- Covers log_transportation_request (creation path) and
-- cancel_transportation_request (transition path) — decline/link share
-- the identical single-transaction-function-body structure, so proving
-- the primitive holds for one creation-shaped and one transition-shaped
-- function is representative of all four, matching this repository's own
-- established practice of one atomicity file per feature rather than one
-- per RPC (create_trip_atomicity_tests.sql covers only create_trip, not
-- also the 6 driver_* transitions or assign_trip/reassign_trip, which
-- share the same underlying guarantee).
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/request_mutation_atomicity_tests.sql

\set ON_ERROR_STOP off
\pset pager off

insert into public.transportation_requests (
  id, organization_id, requester_name, requester_relationship, requester_phone,
  pickup_description, destination_description, return_trip_needed, source, state
) values (
  '92200000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1',
  'Fictional Atomicity Cancel Requester', 'self', '555-0190',
  'Fictional atomicity cancel pickup', 'Fictional atomicity cancel destination', 'no', 'phone', 'pending'
);

-- ---------------------------------------------------------------------------
-- Install the forced-failure trigger. Two match conditions, deliberately
-- narrow (never a broad, accidentally-triggered condition that could
-- mask a real bug in an unrelated row):
--   (a) a direct request_id match, for cancel_transportation_request
--       (ATOMIC-2), whose target row already exists with a known id
--       before the call;
--   (b) a join back to the just-inserted transportation_requests row by
--       its distinctive requester_name, for log_transportation_request
--       (ATOMIC-1) — that function never accepts a caller-supplied id
--       (by design, see the migration's own "state is hard-coded, never
--       a parameter" comment), so the new row's id is unpredictable in
--       advance; the requester_name is the only value this test can fix
--       ahead of time. The transportation_requests INSERT happens
--       earlier in the SAME transaction as this request_events INSERT,
--       so it is already visible to this trigger's own query.
-- ---------------------------------------------------------------------------
create or replace function public._test_force_request_event_failure()
returns trigger
language plpgsql
as $$
begin
  if new.request_id = '92200000-0000-0000-0000-0000000000a1' then
    raise exception 'forced failure for request mutation atomicity test' using errcode = 'ZW999';
  end if;

  if new.event_type = 'request_logged' and exists (
    select 1 from public.transportation_requests
    where id = new.request_id and requester_name = 'Fictional Atomicity Log Requester (forced failure)'
  ) then
    raise exception 'forced failure for request mutation atomicity test' using errcode = 'ZW999';
  end if;

  return new;
end;
$$;

create trigger _test_force_request_event_failure_trigger
  before insert on public.request_events
  for each row execute function public._test_force_request_event_failure();

-- =============================================================================
-- ATOMIC-1: log_transportation_request — forced failure must leave no
-- TransportationRequest row at all (the INSERT + the request_events
-- INSERT are one transaction; the fixture request_id above,
-- ...a2, does not exist yet at this point — this call attempts to CREATE
-- it, and that creation must not survive the forced event failure).
-- =============================================================================
do $$
declare v_count_before int; v_count_after int;
begin
  select count(*) into v_count_before from public.transportation_requests where id = '92200000-0000-0000-0000-0000000000a2';

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    -- log_transportation_request never accepts a caller-supplied id, so
    -- this forced-failure test instead targets the OTHER fixture
    -- (...a1, pre-existing, used below for CANCEL) is not applicable here
    -- -- log_transportation_request's own event insert always uses the
    -- NEWLY generated id, which this trigger cannot predict in advance.
    -- Redirect this test to check via a marker: since the new id is
    -- unpredictable, verify instead that NO new pending request with this
    -- fixture's distinctive requester_name exists after a forced failure.
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', 'Fictional Atomicity Log Requester (forced failure)', 'self', '555-0191',
      'Fictional atomicity log pickup', 'Fictional atomicity log destination', 'no', 'phone'
    );
    raise notice 'TEST ATOMIC-1 (log_transportation_request forced failure): FAIL (expected forced failure to propagate, call succeeded)';
  exception when sqlstate 'ZW999' then
    reset role;
    select count(*) into v_count_after from public.transportation_requests
      where requester_name = 'Fictional Atomicity Log Requester (forced failure)';
    if v_count_after = 0 then
      raise notice 'TEST ATOMIC-1 (log_transportation_request forced failure): PASS (no TransportationRequest row survived the forced request_events failure)';
    else
      raise notice 'TEST ATOMIC-1 (log_transportation_request forced failure): FAIL (% row(s) survived)', v_count_after;
    end if;
  end;
end $$;
reset role;

-- =============================================================================
-- ATOMIC-2: cancel_transportation_request — forced failure must leave the
-- Request's state unchanged (still 'pending', not 'cancelled').
-- =============================================================================
do $$
declare v_state_before text; v_state_after text;
begin
  select state into v_state_before from public.transportation_requests where id = '92200000-0000-0000-0000-0000000000a1';

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', '92200000-0000-0000-0000-0000000000a1');
    raise notice 'TEST ATOMIC-2 (cancel_transportation_request forced failure): FAIL (expected forced failure to propagate, call succeeded)';
  exception when sqlstate 'ZW999' then
    reset role;
    select state into v_state_after from public.transportation_requests where id = '92200000-0000-0000-0000-0000000000a1';
    if v_state_after = v_state_before and v_state_after = 'pending' then
      raise notice 'TEST ATOMIC-2 (cancel_transportation_request forced failure): PASS (state rolled back to pending, no partial write)';
    else
      raise notice 'TEST ATOMIC-2 (cancel_transportation_request forced failure): FAIL (state_before=%, state_after=%)', v_state_before, v_state_after;
    end if;
  end;
end $$;
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from public.request_events re
  where re.request_id = '92200000-0000-0000-0000-0000000000a1'
     or exists (
       select 1 from public.transportation_requests tr
       where tr.id = re.request_id and tr.requester_name = 'Fictional Atomicity Log Requester (forced failure)'
     );
  if v_count = 0 then
    raise notice 'TEST ATOMIC-3 (no request_events row committed for either forced-failure attempt): PASS';
  else
    raise notice 'TEST ATOMIC-3 (no request_events row committed for either forced-failure attempt): FAIL (% row(s) persisted)', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Remove the test-only trigger and function.
-- ---------------------------------------------------------------------------
drop trigger _test_force_request_event_failure_trigger on public.request_events;
drop function public._test_force_request_event_failure();

do $$ begin raise notice '=== request_mutation_atomicity_tests.sql complete — review PASS/FAIL lines above ==='; end $$;
