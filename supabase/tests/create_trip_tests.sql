-- Zenward Platform — controlled Trip creation tests (P1-E3-S0A).
--
-- Covers the required test matrix from the work item: role/membership
-- authorization, cross-tenant Passenger/Facility/Request denial, the
-- Request precondition (P1-OPS-R1: accepted only, never transitioned here), the impossibility
-- of caller-chosen initial state, and the direct-INSERT retirement
-- regression. Same SET ROLE/request.jwt.claim.sub methodology as every
-- other suite in this repository.
--
-- Fixtures: dedicated rows under this file's own 92000000-...-aN/-bN
-- namespace, created below as postgres. Designed to run ONCE against
-- freshly-seeded data (supabase db reset) — every successful create_trip
-- call is a real, persisting mutation.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/create_trip_tests.sql

\set ON_ERROR_STOP off
\pset pager off

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into public.transportation_requests (
  id, organization_id, passenger_id, requester_name, requester_relationship,
  requester_phone, pickup_description, destination_description, return_trip_needed, state
) values
  ('93000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
   'Fictional Requester A', 'facility_coordinator', '555-0130', 'Fictional pending request pickup', 'Fictional pending request destination', 'no', 'pending'),
  ('93000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
   'Fictional Requester B', 'family', '555-0131', 'Fictional accepted request pickup', 'Fictional accepted request destination', 'yes', 'accepted'),
  ('93000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
   'Fictional Requester C', 'self', '555-0132', 'Fictional declined request pickup', 'Fictional declined request destination', 'no', 'declined'),
  ('93000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000b1',
   'Fictional Requester D (Org B)', 'self', '555-0230', 'Fictional Org B request pickup', 'Fictional Org B request destination', 'no', 'pending');

-- =============================================================================
-- Role/Membership authorization matrix
-- =============================================================================

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin
  v_r := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination');
  reset role;
  if v_r.state = 'scheduled' and v_r.created then
    raise notice 'TEST ROLE-1 (Org Admin own org): PASS (ALLOW)';
  else
    raise notice 'TEST ROLE-1 (Org Admin own org): FAIL (state=%, created=%)', v_r.state, v_r.created;
  end if;
end $$;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2'; -- Org A dispatcher
  v_r := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination');
  reset role;
  if v_r.state = 'scheduled' and v_r.created then
    raise notice 'TEST ROLE-2 (Dispatcher own org): PASS (ALLOW)';
  else
    raise notice 'TEST ROLE-2 (Dispatcher own org): FAIL (state=%, created=%)', v_r.state, v_r.created;
  end if;
end $$;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3'; -- Driver A1
  begin
    v_r := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination');
    raise notice 'TEST ROLE-3 (Driver own org): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST ROLE-3 (Driver own org): PASS (DENY)';
  when others then
    raise notice 'TEST ROLE-3 (Driver own org): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  update public.memberships set status = 'inactive'
    where organization_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '20000000-0000-0000-0000-0000000000a1';
end $$;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- now-inactive admin
  begin
    v_r := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination');
    raise notice 'TEST ROLE-4 (Inactive Admin): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST ROLE-4 (Inactive Admin): PASS (DENY)';
  when others then
    raise notice 'TEST ROLE-4 (Inactive Admin): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  update public.memberships set status = 'active'
    where organization_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '20000000-0000-0000-0000-0000000000a1';
end $$;

do $$
begin
  update public.memberships set status = 'inactive'
    where organization_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '20000000-0000-0000-0000-0000000000a2';
end $$;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2'; -- now-inactive dispatcher
  begin
    v_r := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination');
    raise notice 'TEST ROLE-5 (Inactive Dispatcher): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST ROLE-5 (Inactive Dispatcher): PASS (DENY)';
  when others then
    raise notice 'TEST ROLE-5 (Inactive Dispatcher): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  update public.memberships set status = 'active'
    where organization_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '20000000-0000-0000-0000-0000000000a2';
end $$;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1'; -- Org B admin, targeting Org A
  begin
    v_r := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination');
    raise notice 'TEST ROLE-6 (Foreign Org Admin): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST ROLE-6 (Foreign Org Admin): PASS (DENY)';
  when others then
    raise notice 'TEST ROLE-6 (Foreign Org Admin): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b2'; -- Org B dispatcher, targeting Org A
  begin
    v_r := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination');
    raise notice 'TEST ROLE-7 (Foreign Dispatcher): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST ROLE-7 (Foreign Dispatcher): PASS (DENY)';
  when others then
    raise notice 'TEST ROLE-7 (Foreign Dispatcher): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000e1'; -- no-membership user
  begin
    v_r := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination');
    raise notice 'TEST ROLE-8 (Random authenticated user): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST ROLE-8 (Random authenticated user): PASS (DENY)';
  when others then
    raise notice 'TEST ROLE-8 (Random authenticated user): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role anon;
  begin
    perform public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination');
    raise notice 'TEST ROLE-9 (anon): FAIL (expected denial, got success)';
  exception when insufficient_privilege then
    raise notice 'TEST ROLE-9 (anon): PASS (DENY at the privilege layer)';
  end;
end $$;
reset role;

-- =============================================================================
-- Passenger / Facility / Request validation matrix
-- =============================================================================

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  begin
    v_r := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000b1', 'Fictional pickup', 'Fictional destination'); -- Org B passenger
    raise notice 'TEST VAL-1 (Foreign Passenger): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST VAL-1 (Foreign Passenger): PASS (DENY / safe inaccessible, invalid_input)';
  when others then
    raise notice 'TEST VAL-1 (Foreign Passenger): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  begin
    v_r := public.create_trip(
      '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination',
      null, null, '60000000-0000-0000-0000-0000000000b1' -- Org B facility as pickup_facility_id
    );
    raise notice 'TEST VAL-2 (Foreign Facility): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST VAL-2 (Foreign Facility): PASS (DENY / safe inaccessible, invalid_input)';
  when others then
    raise notice 'TEST VAL-2 (Foreign Facility): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

-- P1-OPS-R1: a Trip can only be created from an explicitly ACCEPTED Request.
-- A pending Request is rejected (ZW006) and create_trip never transitions it.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  begin
    perform public.create_trip(
      '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination',
      null, null, null, null, null, null,
      '93000000-0000-0000-0000-0000000000a1' -- pending request, same org, linked active Passenger
    );
    raise notice 'TEST VAL-3 (pending Request same org): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST VAL-3 (pending Request same org): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST VAL-3 (pending Request same org): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
declare v_req_state text; v_events int;
begin
  select state into v_req_state from public.transportation_requests where id = '93000000-0000-0000-0000-0000000000a1';
  select count(*) into v_events from public.trip_events
    where organization_id = '10000000-0000-0000-0000-0000000000a1' and event_type = 'request_converted_to_trip'
      and (metadata->>'request_id')::uuid = '93000000-0000-0000-0000-0000000000a1';
  if v_req_state = 'pending' and v_events = 0 then
    raise notice 'TEST VAL-3B (pending Request not auto-accepted, no TripEvent): PASS';
  else
    raise notice 'TEST VAL-3B (pending Request not auto-accepted, no TripEvent): FAIL (state=%, events=%)', v_req_state, v_events;
  end if;
end $$;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  v_r := public.create_trip(
    '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination',
    null, null, null, null, null, null,
    '93000000-0000-0000-0000-0000000000a2' -- already-accepted request (return-leg scenario)
  );
  reset role;
  if v_r.state = 'scheduled' and v_r.created then
    raise notice 'TEST VAL-4 (Valid Request, already accepted -- second/return Trip): PASS (ALLOW, 1:N Request->Trip preserved)';
  else
    raise notice 'TEST VAL-4 (Valid Request, already accepted): FAIL (state=%, created=%)', v_r.state, v_r.created;
  end if;
end $$;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  begin
    v_r := public.create_trip(
      '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination',
      null, null, null, null, null, null,
      '93000000-0000-0000-0000-0000000000a3' -- declined request
    );
    raise notice 'TEST VAL-5 (Declined Request): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST VAL-5 (Declined Request): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST VAL-5 (Declined Request): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  begin
    v_r := public.create_trip(
      '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup', 'Fictional destination',
      null, null, null, null, null, null,
      '93000000-0000-0000-0000-0000000000b1' -- Org B request
    );
    raise notice 'TEST VAL-6 (Foreign Request): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST VAL-6 (Foreign Request): PASS (DENY / safe inaccessible, invalid_input)';
  when others then
    raise notice 'TEST VAL-6 (Foreign Request): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
declare v_r public.trip_creation_result; v_events int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  v_r := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Fictional pickup, no request', 'Fictional destination, no request');
  reset role;
  select count(*) into v_events from public.trip_events where trip_id = v_r.trip_id and event_type = 'trip_scheduled';
  if v_r.state = 'scheduled' and v_r.created and v_events = 1 then
    raise notice 'TEST VAL-7 (No Request, schema permits): PASS (ALLOW, trip_scheduled event recorded)';
  else
    raise notice 'TEST VAL-7 (No Request, schema permits): FAIL (state=%, created=%, events=%)', v_r.state, v_r.created, v_events;
  end if;
end $$;

-- =============================================================================
-- Initial state enforcement
-- =============================================================================

do $$
declare v_arg_count int;
begin
  -- Structural proof: create_trip's signature has no state/initial_state
  -- parameter at all -- the caller has no mechanism to attempt to supply
  -- one (work item: "IMPOSSIBLE / DENY").
  select count(*) into v_arg_count
  from pg_proc where proname = 'create_trip' and pronamespace = 'public'::regnamespace
    and (proargnames::text ilike '%state%');
  if v_arg_count = 0 then
    raise notice 'TEST STATE-1 (arbitrary initial state impossible): PASS (create_trip has no state-named parameter at all -- structurally impossible, not merely rejected at runtime)';
  else
    raise notice 'TEST STATE-1 (arbitrary initial state impossible): FAIL (a state-named parameter exists)';
  end if;
end $$;

do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.trips
    where organization_id = '10000000-0000-0000-0000-0000000000a1'
      and pickup_description like 'Fictional%'
      and state <> 'scheduled';
  if v_bad = 0 then
    raise notice 'TEST STATE-2 (created Trips always state=scheduled): PASS';
  else
    raise notice 'TEST STATE-2 (created Trips always state=scheduled): FAIL (% Trip(s) not scheduled)', v_bad;
  end if;
end $$;

-- =============================================================================
-- Direct trips INSERT regression (must be denied after this phase)
-- =============================================================================

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2'; -- dispatcher, the role that HELD this grant before P1-E3-S0A
  begin
    insert into public.trips (organization_id, passenger_id, pickup_description, destination_description)
      values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'direct insert attempt', 'direct insert attempt');
    raise notice 'TEST DIRECT-INSERT: FAIL (direct INSERT on trips succeeded)';
  exception when insufficient_privilege then
    raise notice 'TEST DIRECT-INSERT: PASS (direct INSERT on trips denied for Dispatcher, ZD-101)';
  end;
end $$;
reset role;

do $$ begin raise notice '=== Controlled Trip creation test suite complete ==='; end $$;
