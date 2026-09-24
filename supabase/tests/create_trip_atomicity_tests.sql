-- Zenward Platform — create_trip atomicity / forced-failure rollback test
-- (P1-E3-S0A, work item §17/§25). Run as postgres.
--
-- Proves that Trip INSERT + TripEvent INSERT + AuditEvent INSERT (+ the
-- conditional TransportationRequest UPDATE) roll back as a single unit
-- when the LAST write fails — not merely "no error was observed", but a
-- positive check that every earlier write in that same call was undone.
-- Same mechanism as mutation_atomicity_tests.sql (P1-E2-S2): a temporary
-- trigger on audit_events, installed and removed by this script, never a
-- permanent object.

\set ON_ERROR_STOP off
\pset pager off

insert into public.passengers (id, organization_id, display_name, phone, status) values
  ('94000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'Fictional Atomicity Test Passenger', '555-0140', 'active');

insert into public.transportation_requests (
  id, organization_id, passenger_id, requester_name, requester_relationship,
  requester_phone, pickup_description, destination_description, return_trip_needed, state
) values (
  '94000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '94000000-0000-0000-0000-0000000000a1',
  'Fictional Atomicity Requester', 'self', '555-0141', 'Fictional atomicity pickup', 'Fictional atomicity destination', 'no', 'accepted'
);

-- ---------------------------------------------------------------------------
-- Install the forced-failure trigger: fails specifically when this Trip
-- creation's AuditEvent references the dedicated atomicity-test Passenger.
-- ---------------------------------------------------------------------------
create or replace function public._test_force_trip_creation_audit_failure()
returns trigger
language plpgsql
as $$
begin
  if new.entity_type = 'trip' and new.action = 'trip_created'
     and new.after_data->>'passenger_id' = '94000000-0000-0000-0000-0000000000a1' then
    raise exception 'forced failure for create_trip atomicity test' using errcode = 'ZW999';
  end if;
  return new;
end;
$$;

create trigger _test_force_trip_creation_audit_failure_trigger
  before insert on public.audit_events
  for each row execute function public._test_force_trip_creation_audit_failure();

-- ---------------------------------------------------------------------------
-- Attempt a create_trip call whose AuditEvent insert is forced to fail.
-- Expect: the whole call fails, and NOTHING it did persists -- no Trip
-- row, no TripEvent row, and the TransportationRequest is untouched
-- (P1-OPS-R1: Request must already be 'accepted'; create_trip never changes it).
-- ---------------------------------------------------------------------------
do $$
declare
  v_trips_before int; v_events_before int; v_req_state_before text;
begin
  select count(*) into v_trips_before from public.trips where passenger_id = '94000000-0000-0000-0000-0000000000a1';
  select count(*) into v_events_before from public.trip_events where organization_id = '10000000-0000-0000-0000-0000000000a1' and event_type = 'request_converted_to_trip';
  select state into v_req_state_before from public.transportation_requests where id = '94000000-0000-0000-0000-0000000000a1';

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2'; -- dispatcher
  begin
    perform public.create_trip(
      '10000000-0000-0000-0000-0000000000a1', '94000000-0000-0000-0000-0000000000a1',
      'Fictional atomicity trip pickup', 'Fictional atomicity trip destination',
      null, null, null, null, null, null,
      '94000000-0000-0000-0000-0000000000a1'
    );
    raise notice 'TEST ATOMIC-1: FAIL (expected the forced failure to propagate, but the call succeeded)';
  exception when sqlstate 'ZW999' then
    reset role;
    declare
      v_trips_after int; v_events_after int; v_req_state_after text;
    begin
      select count(*) into v_trips_after from public.trips where passenger_id = '94000000-0000-0000-0000-0000000000a1';
      select count(*) into v_events_after from public.trip_events where organization_id = '10000000-0000-0000-0000-0000000000a1' and event_type = 'request_converted_to_trip';
      select state into v_req_state_after from public.transportation_requests where id = '94000000-0000-0000-0000-0000000000a1';

      if v_trips_after = v_trips_before and v_trips_after = 0
         and v_events_after = v_events_before
         and v_req_state_after = v_req_state_before and v_req_state_after = 'accepted' then
        raise notice 'TEST ATOMIC-1: PASS (forced late failure rolled back everything: no Trip row, no TripEvent row, TransportationRequest still accepted)';
      else
        raise notice 'TEST ATOMIC-1: FAIL (partial write survived -- trips: before=% after=%, events: before=% after=%, request_state: before=% after=%)',
          v_trips_before, v_trips_after, v_events_before, v_events_after, v_req_state_before, v_req_state_after;
      end if;
    end;
  end;
end $$;
reset role;

do $$
declare v_count int;
begin
  select count(*) into v_count from public.audit_events where after_data->>'passenger_id' = '94000000-0000-0000-0000-0000000000a1';
  if v_count = 0 then
    raise notice 'TEST ATOMIC-2: PASS (no audit_events row referencing the atomicity-test passenger was ever committed)';
  else
    raise notice 'TEST ATOMIC-2: FAIL (% row(s) persisted)', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Remove the test-only trigger and function.
-- ---------------------------------------------------------------------------
drop trigger _test_force_trip_creation_audit_failure_trigger on public.audit_events;
drop function public._test_force_trip_creation_audit_failure();

do $$ begin raise notice '=== create_trip atomicity (forced-failure) test suite complete ==='; end $$;
