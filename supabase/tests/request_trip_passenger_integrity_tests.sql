-- Zenward Platform — Request->Trip Passenger integrity tests (P1-E1-S2F-A).
--
-- Covers the required test matrix: direct Trip creation (no Request)
-- unaffected, matching-Passenger conversion success, mismatched-
-- Passenger rejection, null-Request-Passenger rejection, inactive-
-- linked-Passenger rejection, accepted-Request additional-Trip
-- matching/mismatched behavior, cross-tenant Passenger rejection
-- (regression), and declined/cancelled Request rejection (regression).
-- Same SET ROLE/request.jwt.claim.sub methodology as every other suite
-- in this repository.
--
-- Fixtures: dedicated rows under this file's own 99000000-...-aN/-bN
-- namespace, created below as postgres. Designed to run ONCE against
-- freshly-seeded data (supabase db reset) — every successful create_trip
-- call is a real, persisting mutation.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/request_trip_passenger_integrity_tests.sql

\set ON_ERROR_STOP off
\pset pager off

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- Passengers: A and B both active/Org A (distinct identities), C inactive/Org A.
insert into public.passengers (id, organization_id, display_name, phone, status) values
  ('99000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'Integrity Passenger A', '555-0910', 'active'),
  ('99000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1', 'Integrity Passenger B', '555-0911', 'active'),
  ('99000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-0000000000a1', 'Integrity Passenger C (inactive)', '555-0912', 'inactive');

-- Requests: pending+A, pending+NULL, pending+inactiveC, accepted+A, declined+A, cancelled+A.
insert into public.transportation_requests (
  id, organization_id, passenger_id, requester_name, requester_relationship,
  requester_phone, pickup_description, destination_description, return_trip_needed, state
) values
  ('99000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000a1',
   'Integrity Requester Pending-A', 'self', '555-0920', 'Integrity pickup B1', 'Integrity destination B1', 'no', 'pending'),
  ('99000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000a1', null,
   'Integrity Requester Pending-Null', 'self', '555-0921', 'Integrity pickup B2', 'Integrity destination B2', 'no', 'pending'),
  ('99000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000a3',
   'Integrity Requester Pending-InactiveC', 'self', '555-0922', 'Integrity pickup B3', 'Integrity destination B3', 'no', 'pending'),
  ('99000000-0000-0000-0000-0000000000b4', '10000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000a1',
   'Integrity Requester Accepted-A', 'self', '555-0923', 'Integrity pickup B4', 'Integrity destination B4', 'yes', 'accepted'),
  ('99000000-0000-0000-0000-0000000000b5', '10000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000a1',
   'Integrity Requester Declined-A', 'self', '555-0924', 'Integrity pickup B5', 'Integrity destination B5', 'no', 'declined'),
  ('99000000-0000-0000-0000-0000000000b6', '10000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000a1',
   'Integrity Requester Cancelled-A', 'self', '555-0925', 'Integrity pickup B6', 'Integrity destination B6', 'no', 'cancelled');

-- Cross-tenant fixtures: Org B passenger + Org B pending request (linked to that same Org B passenger).
insert into public.passengers (id, organization_id, display_name, phone, status) values
  ('99000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000b1', 'Integrity Passenger Org B', '555-0930', 'active');
insert into public.transportation_requests (
  id, organization_id, passenger_id, requester_name, requester_relationship,
  requester_phone, pickup_description, destination_description, return_trip_needed, state
) values
  ('99000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000b1', '99000000-0000-0000-0000-0000000000c1',
   'Integrity Requester Org B', 'self', '555-0931', 'Integrity pickup C2', 'Integrity destination C2', 'no', 'pending');

-- ---------------------------------------------------------------------------
-- TEST A: Direct Trip, no request, active Passenger -> success unchanged
-- ---------------------------------------------------------------------------
do $$
declare v_r public.trip_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin
  v_r := public.create_trip(
    p_organization_id := '10000000-0000-0000-0000-0000000000a1',
    p_passenger_id := '99000000-0000-0000-0000-0000000000a1',
    p_pickup_description := 'Integrity direct pickup',
    p_destination_description := 'Integrity direct destination'
  );
  reset role;
  if v_r.state = 'scheduled' and v_r.created then
    raise notice 'TEST A (direct Trip, no request): PASS (ALLOW)';
  else
    raise notice 'TEST A (direct Trip, no request): FAIL (state=%, created=%)', v_r.state, v_r.created;
  end if;
exception when others then
  reset role;
  raise notice 'TEST A (direct Trip, no request): FAIL (unexpected exception % sqlstate=%)', sqlerrm, sqlstate;
end $$;

-- ---------------------------------------------------------------------------
-- TEST B: Pending Request + linked active Passenger A + Trip Passenger A
-- -> success, Request becomes accepted
-- ---------------------------------------------------------------------------
do $$
declare v_r public.trip_creation_result;
declare v_state text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_r := public.create_trip(
    p_organization_id := '10000000-0000-0000-0000-0000000000a1',
    p_passenger_id := '99000000-0000-0000-0000-0000000000a1',
    p_pickup_description := 'Integrity matching pickup',
    p_destination_description := 'Integrity matching destination',
    p_request_id := '99000000-0000-0000-0000-0000000000b1'
  );
  reset role;
  select state into v_state from public.transportation_requests where id = '99000000-0000-0000-0000-0000000000b1';
  if v_r.created and v_state = 'accepted' then
    raise notice 'TEST B (pending + matching Passenger): PASS (ALLOW, request now accepted)';
  else
    raise notice 'TEST B (pending + matching Passenger): FAIL (created=%, request_state=%)', v_r.created, v_state;
  end if;
exception when others then
  reset role;
  raise notice 'TEST B (pending + matching Passenger): FAIL (unexpected exception % sqlstate=%)', sqlerrm, sqlstate;
end $$;

-- ---------------------------------------------------------------------------
-- TEST C: Pending Request + linked active Passenger A + Trip Passenger B
-- (same org, active) -> rejected; no Trip; Request remains pending;
-- no conversion TripEvent; no audit event.
--
-- Uses its OWN dedicated fixture (b7), independent of TEST B's own
-- mutation of b1, so this file's tests remain order-independent.
-- ---------------------------------------------------------------------------
insert into public.transportation_requests (
  id, organization_id, passenger_id, requester_name, requester_relationship,
  requester_phone, pickup_description, destination_description, return_trip_needed, state
) values
  ('99000000-0000-0000-0000-0000000000b7', '10000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000a1',
   'Integrity Requester Pending-A-ForMismatch', 'self', '555-0926', 'Integrity pickup B7', 'Integrity destination B7', 'no', 'pending');

do $$
declare
  v_trip_count_before int;
  v_event_count_before int;
  v_audit_count_before int;
  v_state_after text;
  v_trip_count_after int;
  v_event_count_after int;
  v_audit_count_after int;
  v_caught_sqlstate text := null;
begin
  select count(*) into v_trip_count_before from public.trips where request_id = '99000000-0000-0000-0000-0000000000b7';
  select count(*) into v_event_count_before from public.trip_events where metadata->>'request_id' = '99000000-0000-0000-0000-0000000000b7';
  select count(*) into v_audit_count_before from public.audit_events where entity_type = 'trip' and after_data->>'request_id' = '99000000-0000-0000-0000-0000000000b7';

  begin
    set local role authenticated;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.create_trip(
      p_organization_id := '10000000-0000-0000-0000-0000000000a1',
      p_passenger_id := '99000000-0000-0000-0000-0000000000a2', -- Passenger B, request is linked to A
      p_pickup_description := 'Integrity mismatch pickup',
      p_destination_description := 'Integrity mismatch destination',
      p_request_id := '99000000-0000-0000-0000-0000000000b7'
    );
    reset role;
  exception when others then
    reset role;
    v_caught_sqlstate := sqlstate;
  end;

  select state into v_state_after from public.transportation_requests where id = '99000000-0000-0000-0000-0000000000b7';
  select count(*) into v_trip_count_after from public.trips where request_id = '99000000-0000-0000-0000-0000000000b7';
  select count(*) into v_event_count_after from public.trip_events where metadata->>'request_id' = '99000000-0000-0000-0000-0000000000b7';
  select count(*) into v_audit_count_after from public.audit_events where entity_type = 'trip' and after_data->>'request_id' = '99000000-0000-0000-0000-0000000000b7';

  if v_caught_sqlstate = 'ZW006' and v_state_after = 'pending'
     and v_trip_count_after = v_trip_count_before
     and v_event_count_after = v_event_count_before
     and v_audit_count_after = v_audit_count_before then
    raise notice 'TEST C (pending + mismatched Passenger): PASS (DENY invalid_input, request still pending, zero new Trip/TripEvent/AuditEvent rows)';
  else
    raise notice 'TEST C (pending + mismatched Passenger): FAIL (sqlstate=%, request_state=%, trips %->%,  events %->%, audits %->%)',
      v_caught_sqlstate, v_state_after, v_trip_count_before, v_trip_count_after, v_event_count_before, v_event_count_after, v_audit_count_before, v_audit_count_after;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- TEST D: Pending Request + passenger_id NULL + supply active Passenger A
-- -> rejected; Request remains pending
-- ---------------------------------------------------------------------------
do $$
declare
  v_caught_sqlstate text := null;
  v_state_after text;
begin
  begin
    set local role authenticated;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.create_trip(
      p_organization_id := '10000000-0000-0000-0000-0000000000a1',
      p_passenger_id := '99000000-0000-0000-0000-0000000000a1',
      p_pickup_description := 'Integrity null-passenger pickup',
      p_destination_description := 'Integrity null-passenger destination',
      p_request_id := '99000000-0000-0000-0000-0000000000b2'
    );
    reset role;
  exception when others then
    reset role;
    v_caught_sqlstate := sqlstate;
  end;
  select state into v_state_after from public.transportation_requests where id = '99000000-0000-0000-0000-0000000000b2';
  if v_caught_sqlstate = 'ZW006' and v_state_after = 'pending' then
    raise notice 'TEST D (pending + NULL Request Passenger): PASS (DENY invalid_input, request still pending)';
  else
    raise notice 'TEST D (pending + NULL Request Passenger): FAIL (sqlstate=%, request_state=%)', v_caught_sqlstate, v_state_after;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- TEST E: Pending Request + linked INACTIVE Passenger A + supply that
-- same Passenger A -> rejected (the pre-existing active-Passenger check
-- already covers this; confirmed explicitly per the phase's own matrix)
-- ---------------------------------------------------------------------------
do $$
declare
  v_caught_sqlstate text := null;
  v_state_after text;
begin
  begin
    set local role authenticated;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.create_trip(
      p_organization_id := '10000000-0000-0000-0000-0000000000a1',
      p_passenger_id := '99000000-0000-0000-0000-0000000000a3', -- inactive
      p_pickup_description := 'Integrity inactive-passenger pickup',
      p_destination_description := 'Integrity inactive-passenger destination',
      p_request_id := '99000000-0000-0000-0000-0000000000b3'
    );
    reset role;
  exception when others then
    reset role;
    v_caught_sqlstate := sqlstate;
  end;
  select state into v_state_after from public.transportation_requests where id = '99000000-0000-0000-0000-0000000000b3';
  if v_caught_sqlstate = 'ZW006' and v_state_after = 'pending' then
    raise notice 'TEST E (pending + inactive linked Passenger): PASS (DENY invalid_input, request still pending)';
  else
    raise notice 'TEST E (pending + inactive linked Passenger): FAIL (sqlstate=%, request_state=%)', v_caught_sqlstate, v_state_after;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- TEST F: Accepted Request + linked active Passenger A + second Trip
-- Passenger A -> success (multi-Trip / return-transportation preserved)
-- ---------------------------------------------------------------------------
do $$
declare v_r public.trip_creation_result;
declare v_state text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_r := public.create_trip(
    p_organization_id := '10000000-0000-0000-0000-0000000000a1',
    p_passenger_id := '99000000-0000-0000-0000-0000000000a1',
    p_pickup_description := 'Integrity second-trip-matching pickup',
    p_destination_description := 'Integrity second-trip-matching destination',
    p_request_id := '99000000-0000-0000-0000-0000000000b4'
  );
  reset role;
  select state into v_state from public.transportation_requests where id = '99000000-0000-0000-0000-0000000000b4';
  if v_r.created and v_state = 'accepted' then
    raise notice 'TEST F (accepted + matching Passenger, second Trip): PASS (ALLOW)';
  else
    raise notice 'TEST F (accepted + matching Passenger, second Trip): FAIL (created=%, request_state=%)', v_r.created, v_state;
  end if;
exception when others then
  reset role;
  raise notice 'TEST F (accepted + matching Passenger, second Trip): FAIL (unexpected exception % sqlstate=%)', sqlerrm, sqlstate;
end $$;

-- ---------------------------------------------------------------------------
-- TEST G: Accepted Request + linked active Passenger A + second Trip
-- Passenger B -> rejected
-- ---------------------------------------------------------------------------
do $$
declare
  v_caught_sqlstate text := null;
  v_trip_count_before int;
  v_trip_count_after int;
begin
  select count(*) into v_trip_count_before from public.trips where request_id = '99000000-0000-0000-0000-0000000000b4';
  begin
    set local role authenticated;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.create_trip(
      p_organization_id := '10000000-0000-0000-0000-0000000000a1',
      p_passenger_id := '99000000-0000-0000-0000-0000000000a2', -- Passenger B
      p_pickup_description := 'Integrity second-trip-mismatch pickup',
      p_destination_description := 'Integrity second-trip-mismatch destination',
      p_request_id := '99000000-0000-0000-0000-0000000000b4'
    );
    reset role;
  exception when others then
    reset role;
    v_caught_sqlstate := sqlstate;
  end;
  select count(*) into v_trip_count_after from public.trips where request_id = '99000000-0000-0000-0000-0000000000b4';
  if v_caught_sqlstate = 'ZW006' and v_trip_count_after = v_trip_count_before then
    raise notice 'TEST G (accepted + mismatched Passenger, second Trip): PASS (DENY invalid_input, no new Trip)';
  else
    raise notice 'TEST G (accepted + mismatched Passenger, second Trip): FAIL (sqlstate=%, trips %->%)', v_caught_sqlstate, v_trip_count_before, v_trip_count_after;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- TEST H: Cross-tenant Passenger (Org A caller, Org B Passenger, no
-- Request involved) -> still rejected as before (regression)
-- ---------------------------------------------------------------------------
do $$
declare
  v_caught_sqlstate text := null;
begin
  begin
    set local role authenticated;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin
    perform public.create_trip(
      p_organization_id := '10000000-0000-0000-0000-0000000000a1',
      p_passenger_id := '99000000-0000-0000-0000-0000000000c1', -- Org B passenger
      p_pickup_description := 'Integrity cross-tenant pickup',
      p_destination_description := 'Integrity cross-tenant destination'
    );
    reset role;
  exception when others then
    reset role;
    v_caught_sqlstate := sqlstate;
  end;
  if v_caught_sqlstate = 'ZW006' then
    raise notice 'TEST H (cross-tenant Passenger): PASS (DENY invalid_input) — regression unaffected by this phase';
  else
    raise notice 'TEST H (cross-tenant Passenger): FAIL (sqlstate=%)', v_caught_sqlstate;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- TEST I: Declined/cancelled Request -> still rejected as before
-- (regression — proves the new passenger check does not run before, or
-- interfere with, the existing state check)
-- ---------------------------------------------------------------------------
do $$
declare
  v_caught_sqlstate text := null;
begin
  begin
    set local role authenticated;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.create_trip(
      p_organization_id := '10000000-0000-0000-0000-0000000000a1',
      p_passenger_id := '99000000-0000-0000-0000-0000000000a1', -- matches the declined request's own passenger
      p_pickup_description := 'Integrity declined-request pickup',
      p_destination_description := 'Integrity declined-request destination',
      p_request_id := '99000000-0000-0000-0000-0000000000b5'
    );
    reset role;
  exception when others then
    reset role;
    v_caught_sqlstate := sqlstate;
  end;
  if v_caught_sqlstate = 'ZW006' then
    raise notice 'TEST I-1 (declined Request, even with matching Passenger): PASS (DENY invalid_input) — regression unaffected';
  else
    raise notice 'TEST I-1 (declined Request, even with matching Passenger): FAIL (sqlstate=%)', v_caught_sqlstate;
  end if;
end $$;

do $$
declare
  v_caught_sqlstate text := null;
begin
  begin
    set local role authenticated;
    set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.create_trip(
      p_organization_id := '10000000-0000-0000-0000-0000000000a1',
      p_passenger_id := '99000000-0000-0000-0000-0000000000a1', -- matches the cancelled request's own passenger
      p_pickup_description := 'Integrity cancelled-request pickup',
      p_destination_description := 'Integrity cancelled-request destination',
      p_request_id := '99000000-0000-0000-0000-0000000000b6'
    );
    reset role;
  exception when others then
    reset role;
    v_caught_sqlstate := sqlstate;
  end;
  if v_caught_sqlstate = 'ZW006' then
    raise notice 'TEST I-2 (cancelled Request, even with matching Passenger): PASS (DENY invalid_input) — regression unaffected';
  else
    raise notice 'TEST I-2 (cancelled Request, even with matching Passenger): FAIL (sqlstate=%)', v_caught_sqlstate;
  end if;
end $$;

do $$ begin raise notice '=== request_trip_passenger_integrity_tests.sql complete — review PASS/FAIL lines above ==='; end $$;
