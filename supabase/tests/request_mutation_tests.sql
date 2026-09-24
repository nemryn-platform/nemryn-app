-- Zenward Platform — Request mutation foundation tests (P1-E1-S2B).
--
-- Covers the required test matrix for log_transportation_request,
-- link_request_passenger, decline_transportation_request, and
-- cancel_transportation_request: role/membership authorization,
-- cross-tenant denial, field validation, lifecycle-transition legality,
-- idempotent no-op behavior, and request_events generation/attribution.
-- Same SET ROLE/request.jwt.claim.sub methodology as every other suite
-- in this repository (see create_trip_tests.sql).
--
-- Fixtures: dedicated rows under this file's own 92000000-...-aN
-- namespace, created below as postgres. Designed to run ONCE against
-- freshly-seeded data (supabase db reset).
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/request_mutation_tests.sql

-- P1-OPS-R1: updated to the decision workflow — decline/cancel take a required
-- reason_code (+ note), cancel is accepted -> cancelled (no Trips), and
-- link_request_passenger is legal while pending or accepted until a Trip exists.
-- Accept and the full matrix live in request_decision_workflow_tests.sql.

\set ON_ERROR_STOP off
\pset pager off

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into public.passengers (id, organization_id, display_name, phone, status) values
  ('92000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 'Fictional RM Active Passenger A', '555-0150', 'active'),
  ('92000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', 'Fictional RM Inactive Passenger A', '555-0151', 'inactive'),
  ('92000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000b1', 'Fictional RM Active Passenger B', '555-0250', 'active');

insert into public.transportation_requests (
  id, organization_id, passenger_id, requester_name, requester_relationship,
  requester_phone, pickup_description, destination_description, return_trip_needed, source, state
) values
  -- r1: pending, Org A — consumed by DECLINE-1/DECLINE-IDEMPOTENT-1
  ('92000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-0000000000a1', null,
   'Fictional RM Requester 1', 'family', '555-0160', 'Fictional RM pickup 1', 'Fictional RM destination 1', 'no', 'phone', 'pending'),
  -- r2: ACCEPTED (P1-OPS-R1), Org A, zero linked trips — consumed by CANCEL-1/CANCEL-IDEMPOTENT-1
  ('92000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-0000000000a1', null,
   'Fictional RM Requester 2', 'self', '555-0161', 'Fictional RM pickup 2', 'Fictional RM destination 2', 'no', 'facility', 'accepted'),
  -- r3: pending, Org A — consumed by LINK-1/LINK-IDEMPOTENT-1
  ('92000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-0000000000a1', null,
   'Fictional RM Requester 3', 'caregiver', '555-0162', 'Fictional RM pickup 3', 'Fictional RM destination 3', 'yes', 'email', 'pending'),
  -- r4: accepted, Org A (fixture-seeded directly) — read-only for DECLINE-2
  ('92000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000001',
   'Fictional RM Requester 4', 'self', '555-0163', 'Fictional RM pickup 4', 'Fictional RM destination 4', 'no', 'web', 'accepted'),
  -- r5: declined, Org A — read-only across LINK-5/CANCEL-4
  ('92000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-0000000000a1', null,
   'Fictional RM Requester 5', 'other', '555-0164', 'Fictional RM pickup 5', 'Fictional RM destination 5', 'no', 'other', 'declined'),
  -- r6: cancelled, Org A — read-only across LINK-6/DECLINE-3
  ('92000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-0000000000a1', null,
   'Fictional RM Requester 6', 'family', '555-0165', 'Fictional RM pickup 6', 'Fictional RM destination 6', 'no', 'phone', 'cancelled'),
  -- r7: ACCEPTED, Org A, with a linked Trip already (cancelled-state Trip, deliberately — proves ANY linked Trip blocks cancellation and freezes the Passenger regardless of its own state) — read-only across CANCEL-2/LINK-4
  ('92000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000001',
   'Fictional RM Requester 7', 'self', '555-0166', 'Fictional RM pickup 7', 'Fictional RM destination 7', 'no', 'phone', 'accepted'),
  -- r8: pending, Org B — consumed by the cross-tenant DECLINE/CANCEL/LINK tests
  ('92000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-0000000000b1', null,
   'Fictional RM Requester 8 (Org B)', 'self', '555-0260', 'Fictional RM Org B pickup', 'Fictional RM Org B destination', 'no', 'phone', 'pending');

insert into public.trips (
  id, organization_id, request_id, passenger_id, state, pickup_description, destination_description
) values (
  '92000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000017',
  '92000000-0000-0000-0000-000000000001', 'cancelled', 'Fictional RM linked trip pickup', 'Fictional RM linked trip destination'
);

-- =============================================================================
-- log_transportation_request
-- =============================================================================

do $$
declare v_r public.request_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin
  v_r := public.log_transportation_request(
    '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'family', '555-0170',
    'Fictional log pickup', 'Fictional log destination', 'no', 'phone'
  );
  reset role;
  if v_r.state = 'pending' and v_r.created then
    raise notice 'TEST LOG-ROLE-1 (Org Admin own org): PASS (ALLOW, state=pending)';
  else
    raise notice 'TEST LOG-ROLE-1 (Org Admin own org): FAIL (state=%, created=%)', v_r.state, v_r.created;
  end if;
end $$;
reset role;

do $$
declare v_r public.request_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2'; -- Org A dispatcher
  v_r := public.log_transportation_request(
    '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'family', '555-0170',
    'Fictional log pickup', 'Fictional log destination', 'no', 'phone'
  );
  reset role;
  if v_r.state = 'pending' and v_r.created then
    raise notice 'TEST LOG-ROLE-2 (Dispatcher own org): PASS (ALLOW)';
  else
    raise notice 'TEST LOG-ROLE-2 (Dispatcher own org): FAIL (state=%, created=%)', v_r.state, v_r.created;
  end if;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3'; -- Driver A1
  begin
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'family', '555-0170',
      'Fictional log pickup', 'Fictional log destination', 'no', 'phone'
    );
    raise notice 'TEST LOG-ROLE-3 (Driver own org): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST LOG-ROLE-3 (Driver own org): PASS (DENY)';
  when others then
    raise notice 'TEST LOG-ROLE-3 (Driver own org): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role anon;
  begin
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'family', '555-0170',
      'Fictional log pickup', 'Fictional log destination', 'no', 'phone'
    );
    raise notice 'TEST LOG-ROLE-4 (anon/unauthenticated): FAIL (expected denial, got success)';
  exception when insufficient_privilege then
    raise notice 'TEST LOG-ROLE-4 (anon/unauthenticated): PASS (DENY at the privilege layer)';
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1'; -- Org B admin
  begin
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'family', '555-0170',
      'Fictional log pickup', 'Fictional log destination', 'no', 'phone'
    );
    raise notice 'TEST LOG-ROLE-5 (Foreign Org Admin, org A target): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST LOG-ROLE-5 (Foreign Org Admin, org A target): PASS (DENY)';
  when others then
    raise notice 'TEST LOG-ROLE-5 (Foreign Org Admin, org A target): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'family', '555-0170',
      'Fictional log pickup', 'Fictional log destination', 'no', 'carrier_pigeon'
    );
    raise notice 'TEST LOG-VAL-1 (invalid source): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST LOG-VAL-1 (invalid source): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST LOG-VAL-1 (invalid source): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'family', '555-0170',
      'Fictional log pickup', 'Fictional log destination', 'no', 'phone',
      null, '99999999-0000-0000-0000-000000000000'
    );
    raise notice 'TEST LOG-VAL-2 (nonexistent passenger): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST LOG-VAL-2 (nonexistent passenger): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST LOG-VAL-2 (nonexistent passenger): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'family', '555-0170',
      'Fictional log pickup', 'Fictional log destination', 'no', 'phone',
      null, '92000000-0000-0000-0000-000000000003' -- Org B passenger
    );
    raise notice 'TEST LOG-VAL-3 (cross-tenant passenger): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST LOG-VAL-3 (cross-tenant passenger): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST LOG-VAL-3 (cross-tenant passenger): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'family', '555-0170',
      'Fictional log pickup', 'Fictional log destination', 'no', 'phone',
      null, '92000000-0000-0000-0000-000000000002' -- inactive Org A passenger
    );
    raise notice 'TEST LOG-VAL-4 (inactive passenger): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST LOG-VAL-4 (inactive passenger): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST LOG-VAL-4 (inactive passenger): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'not_a_real_relationship', '555-0170',
      'Fictional log pickup', 'Fictional log destination', 'no', 'phone'
    );
    raise notice 'TEST LOG-VAL-5 (invalid requester_relationship): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST LOG-VAL-5 (invalid requester_relationship): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST LOG-VAL-5 (invalid requester_relationship): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', 'Fictional Log Requester', 'family', '555-0170',
      'Fictional log pickup', 'Fictional log destination', 'maybe', 'phone'
    );
    raise notice 'TEST LOG-VAL-6 (invalid return_trip_needed): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST LOG-VAL-6 (invalid return_trip_needed): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST LOG-VAL-6 (invalid return_trip_needed): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.log_transportation_request(
      '10000000-0000-0000-0000-0000000000a1', '   ', 'family', '555-0170',
      'Fictional log pickup', 'Fictional log destination', 'no', 'phone'
    );
    raise notice 'TEST LOG-VAL-7 (blank requester_name): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST LOG-VAL-7 (blank requester_name): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST LOG-VAL-7 (blank requester_name): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
declare v_r public.request_creation_result; v_event_count int; v_actor uuid;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_r := public.log_transportation_request(
    '10000000-0000-0000-0000-0000000000a1', 'Fictional Event Requester', 'family', '555-0171',
    'Fictional event pickup', 'Fictional event destination', 'no', 'facility'
  );
  reset role;
  select count(*), (array_agg(actor_user_id))[1] into v_event_count, v_actor
    from public.request_events where request_id = v_r.request_id and event_type = 'request_logged';
  if v_event_count = 1 and v_actor = '20000000-0000-0000-0000-0000000000a1' then
    raise notice 'TEST LOG-EVENT-1 (request_logged event + correct actor): PASS';
  else
    raise notice 'TEST LOG-EVENT-1 (request_logged event + correct actor): FAIL (count=%, actor=%)', v_event_count, v_actor;
  end if;
end $$;
reset role;

-- =============================================================================
-- link_request_passenger
-- =============================================================================

do $$
declare v_r public.request_passenger_link_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_r := public.link_request_passenger(
    '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000013', '92000000-0000-0000-0000-000000000001'
  );
  reset role;
  if v_r.passenger_id = '92000000-0000-0000-0000-000000000001' and v_r.changed then
    raise notice 'TEST LINK-1 (valid pending request, valid passenger): PASS (ALLOW, changed=true)';
  else
    raise notice 'TEST LINK-1 (valid pending request, valid passenger): FAIL (passenger_id=%, changed=%)', v_r.passenger_id, v_r.changed;
  end if;
end $$;
reset role;

do $$
declare v_r public.request_passenger_link_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2'; -- different Org A caller, same passenger, same request
  v_r := public.link_request_passenger(
    '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000013', '92000000-0000-0000-0000-000000000001'
  );
  reset role;
  if v_r.changed = false and v_r.passenger_id = '92000000-0000-0000-0000-000000000001' then
    raise notice 'TEST LINK-IDEMPOTENT-1 (re-link same passenger): PASS (no-op, changed=false)';
  else
    raise notice 'TEST LINK-IDEMPOTENT-1 (re-link same passenger): FAIL (changed=%)', v_r.changed;
  end if;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.link_request_passenger(
      '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000011', '92000000-0000-0000-0000-000000000003' -- Org B passenger
    );
    raise notice 'TEST LINK-2 (cross-tenant passenger): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST LINK-2 (cross-tenant passenger): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST LINK-2 (cross-tenant passenger): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.link_request_passenger(
      '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000011', '92000000-0000-0000-0000-000000000002' -- inactive
    );
    raise notice 'TEST LINK-3 (inactive passenger): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW006' then
    raise notice 'TEST LINK-3 (inactive passenger): PASS (DENY, invalid_input)';
  when others then
    raise notice 'TEST LINK-3 (inactive passenger): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.link_request_passenger(
      '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000017', '92000000-0000-0000-0000-000000000001' -- accepted request WITH a linked Trip
    );
    raise notice 'TEST LINK-4 (accepted request with a linked Trip): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW004' then
    raise notice 'TEST LINK-4 (accepted request with a linked Trip): PASS (DENY, illegal_transition)';
  when others then
    raise notice 'TEST LINK-4 (accepted request with a linked Trip): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.link_request_passenger(
      '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000015', '92000000-0000-0000-0000-000000000001' -- declined
    );
    raise notice 'TEST LINK-5 (declined request): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW004' then
    raise notice 'TEST LINK-5 (declined request): PASS (DENY, illegal_transition)';
  when others then
    raise notice 'TEST LINK-5 (declined request): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.link_request_passenger(
      '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000016', '92000000-0000-0000-0000-000000000001' -- cancelled
    );
    raise notice 'TEST LINK-6 (cancelled request): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW004' then
    raise notice 'TEST LINK-6 (cancelled request): PASS (DENY, illegal_transition)';
  when others then
    raise notice 'TEST LINK-6 (cancelled request): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3'; -- Driver
  begin
    perform public.link_request_passenger(
      '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000011', '92000000-0000-0000-0000-000000000001'
    );
    raise notice 'TEST LINK-ROLE-1 (Driver): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST LINK-ROLE-1 (Driver): PASS (DENY)';
  when others then
    raise notice 'TEST LINK-ROLE-1 (Driver): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin, referencing Org B's own request under Org A's org id
  begin
    perform public.link_request_passenger(
      '10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000018', '92000000-0000-0000-0000-000000000001'
    );
    raise notice 'TEST LINK-CROSS-ORG-1 (Org B request via Org A context): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST LINK-CROSS-ORG-1 (Org B request via Org A context): PASS (DENY, not_found)';
  when others then
    raise notice 'TEST LINK-CROSS-ORG-1 (Org B request via Org A context): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
declare v_event_count int; v_actor uuid;
begin
  select count(*), (array_agg(actor_user_id))[1] into v_event_count, v_actor
    from public.request_events where request_id = '92000000-0000-0000-0000-000000000013' and event_type = 'passenger_linked';
  if v_event_count = 1 and v_actor = '20000000-0000-0000-0000-0000000000a1' then
    raise notice 'TEST LINK-EVENT-1 (passenger_linked event + correct actor): PASS';
  else
    raise notice 'TEST LINK-EVENT-1 (passenger_linked event + correct actor): FAIL (count=%, actor=%)', v_event_count, v_actor;
  end if;
end $$;

-- =============================================================================
-- decline_transportation_request
-- =============================================================================

do $$
declare v_r public.request_transition_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_r := public.decline_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000011', 'other', 'Fictional decline reason');
  reset role;
  if v_r.current_state = 'declined' and v_r.changed then
    raise notice 'TEST DECLINE-1 (pending -> declined): PASS (ALLOW, changed=true)';
  else
    raise notice 'TEST DECLINE-1 (pending -> declined): FAIL (current_state=%, changed=%)', v_r.current_state, v_r.changed;
  end if;
end $$;
reset role;

do $$
declare v_reason text;
begin
  select reason_code || '|' || reason_note into v_reason
    from public.request_events where request_id = '92000000-0000-0000-0000-000000000011' and event_type = 'request_declined';
  if v_reason = 'other|Fictional decline reason' then
    raise notice 'TEST DECLINE-EVENT-1 (structured reason persisted on the event): PASS';
  else
    raise notice 'TEST DECLINE-EVENT-1 (structured reason persisted on the event): FAIL (reason=%)', v_reason;
  end if;
end $$;

do $$
declare v_r public.request_transition_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  v_r := public.decline_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000011', 'no_availability');
  reset role;
  if v_r.changed = false and v_r.current_state = 'declined' then
    raise notice 'TEST DECLINE-IDEMPOTENT-1 (decline already-declined): PASS (no-op, changed=false)';
  else
    raise notice 'TEST DECLINE-IDEMPOTENT-1 (decline already-declined): FAIL (changed=%)', v_r.changed;
  end if;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.decline_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000014', 'no_availability'); -- accepted
    raise notice 'TEST DECLINE-2 (accepted request): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW004' then
    raise notice 'TEST DECLINE-2 (accepted request): PASS (DENY, illegal_transition)';
  when others then
    raise notice 'TEST DECLINE-2 (accepted request): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.decline_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000016', 'no_availability'); -- cancelled
    raise notice 'TEST DECLINE-3 (cancelled request): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW004' then
    raise notice 'TEST DECLINE-3 (cancelled request): PASS (DENY, illegal_transition)';
  when others then
    raise notice 'TEST DECLINE-3 (cancelled request): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3'; -- Driver
  begin
    perform public.decline_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000012', 'no_availability');
    raise notice 'TEST DECLINE-ROLE-1 (Driver): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST DECLINE-ROLE-1 (Driver): PASS (DENY)';
  when others then
    raise notice 'TEST DECLINE-ROLE-1 (Driver): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.decline_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000018', 'no_availability'); -- Org B request
    raise notice 'TEST DECLINE-CROSS-ORG-1 (Org B request via Org A context): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST DECLINE-CROSS-ORG-1 (Org B request via Org A context): PASS (DENY, not_found)';
  when others then
    raise notice 'TEST DECLINE-CROSS-ORG-1 (Org B request via Org A context): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

-- =============================================================================
-- cancel_transportation_request
-- =============================================================================

do $$
declare v_r public.request_transition_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_r := public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000012', 'requester_cancelled');
  reset role;
  if v_r.current_state = 'cancelled' and v_r.changed then
    raise notice 'TEST CANCEL-1 (accepted + zero trips -> cancelled): PASS (ALLOW, changed=true)';
  else
    raise notice 'TEST CANCEL-1 (accepted + zero trips -> cancelled): FAIL (current_state=%, changed=%)', v_r.current_state, v_r.changed;
  end if;
end $$;
reset role;

do $$
declare v_r public.request_transition_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  v_r := public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000012', 'requester_cancelled');
  reset role;
  if v_r.changed = false and v_r.current_state = 'cancelled' then
    raise notice 'TEST CANCEL-IDEMPOTENT-1 (cancel already-cancelled): PASS (no-op, changed=false)';
  else
    raise notice 'TEST CANCEL-IDEMPOTENT-1 (cancel already-cancelled): FAIL (changed=%)', v_r.changed;
  end if;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000017', 'requester_cancelled'); -- accepted, but has a linked (cancelled-state) Trip
    raise notice 'TEST CANCEL-2 (accepted + ANY linked Trip, including a cancelled one): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW004' then
    raise notice 'TEST CANCEL-2 (accepted + ANY linked Trip, including a cancelled one): PASS (DENY, illegal_transition)';
  when others then
    raise notice 'TEST CANCEL-2 (accepted + ANY linked Trip, including a cancelled one): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000013', 'requester_cancelled'); -- pending
    raise notice 'TEST CANCEL-3 (pending request): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW004' then
    raise notice 'TEST CANCEL-3 (pending request): PASS (DENY, illegal_transition)';
  when others then
    raise notice 'TEST CANCEL-3 (pending request): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000015', 'requester_cancelled'); -- declined
    raise notice 'TEST CANCEL-4 (declined request): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW004' then
    raise notice 'TEST CANCEL-4 (declined request): PASS (DENY, illegal_transition)';
  when others then
    raise notice 'TEST CANCEL-4 (declined request): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3'; -- Driver
  begin
    perform public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000011', 'requester_cancelled');
    raise notice 'TEST CANCEL-ROLE-1 (Driver): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST CANCEL-ROLE-1 (Driver): PASS (DENY)';
  when others then
    raise notice 'TEST CANCEL-ROLE-1 (Driver): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    perform public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-000000000018', 'requester_cancelled'); -- Org B request
    raise notice 'TEST CANCEL-CROSS-ORG-1 (Org B request via Org A context): FAIL (expected denial, got success)';
  exception when sqlstate 'ZW002' then
    raise notice 'TEST CANCEL-CROSS-ORG-1 (Org B request via Org A context): PASS (DENY, not_found)';
  when others then
    raise notice 'TEST CANCEL-CROSS-ORG-1 (Org B request via Org A context): FAIL (wrong error % %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;

do $$
declare v_event_count int; v_actor uuid;
begin
  select count(*), (array_agg(actor_user_id))[1] into v_event_count, v_actor
    from public.request_events where request_id = '92000000-0000-0000-0000-000000000012' and event_type = 'request_cancelled';
  if v_event_count = 1 and v_actor = '20000000-0000-0000-0000-0000000000a1' then
    raise notice 'TEST CANCEL-EVENT-1 (request_cancelled event + correct actor): PASS';
  else
    raise notice 'TEST CANCEL-EVENT-1 (request_cancelled event + correct actor): FAIL (count=%, actor=%)', v_event_count, v_actor;
  end if;
end $$;

do $$ begin raise notice '=== request_mutation_tests.sql complete — review PASS/FAIL lines above ==='; end $$;
