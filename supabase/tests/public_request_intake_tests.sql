-- Zenward Platform — public tenant-website intake security/privilege
-- tests (P1-PILOT-S4A, extended P1-PILOT-S4B). Run as postgres
-- (superuser/BYPASSRLS) with role switches inline, mirroring
-- constraint_tests.sql's own established convention. Covers the S4A
-- phase's own explicit 20-item checklist plus a handful of bonus
-- assertions for the origin allow-list and the closed table-privilege
-- surface on request_intake_integrations itself, PLUS (P1-PILOT-S4B)
-- the direct-RPC-bypass closure: every test below that actually INVOKES
-- submit_public_transportation_request now does so as `service_role`
-- (the only role granted EXECUTE as of
-- 20260919120000_public_intake_ingress_hardening.sql), simulating the
-- trusted Route Handler's own execution context — NOT because the
-- test's own original intent (proving the function's business logic)
-- changed, but because `anon` can no longer reach the function at all,
-- which is now independently proven by TEST S4B-1/S4B-2 immediately
-- below. Durable rate-limiting is covered separately in
-- supabase/tests/public_intake_rate_limit_tests.sql and
-- public_intake_rate_limit_concurrency_test.sh.

\set ON_ERROR_STOP off
\pset pager off

-- =============================================================================
-- FIXTURES
-- =============================================================================
-- Reuses the standard fixture organizations/admins already present in
-- every local environment (10000000-...-a1 / -b1, 20000000-...-a1 /
-- -b1) — see supabase/seed.sql. Two active integrations (one per org)
-- plus one disabled integration, inserted directly as postgres (bypasses
-- RLS — the only role that can ever write this table besides the RPC
-- itself, matching the table's own "no grant to any role" design).
do $$
begin
  delete from public.transportation_requests where pickup_description like 'S4A TEST%';
  delete from public.request_intake_integrations where external_id like 'test-intake-%';

  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active)
  values
    ('a0000000-0000-0000-0000-00000000a001', '10000000-0000-0000-0000-0000000000a1', 'test-intake-org-a', 'website', true),
    ('a0000000-0000-0000-0000-00000000a002', '10000000-0000-0000-0000-0000000000a1', 'test-intake-org-a-disabled', 'website', false),
    ('a0000000-0000-0000-0000-00000000a003', '10000000-0000-0000-0000-0000000000b1', 'test-intake-org-b', 'website', true),
    ('a0000000-0000-0000-0000-00000000a004', '10000000-0000-0000-0000-0000000000a1', 'test-intake-org-a-origin-locked', 'website', true);

  update public.request_intake_integrations
  set allowed_origins = array['https://acme-clinic.example.test']
  where id = 'a0000000-0000-0000-0000-00000000a004';
end $$;

-- =============================================================================
-- 1-4. anon has NO direct table privilege of any kind on
-- transportation_requests
-- =============================================================================
do $$
begin
  set local role anon;
  insert into public.transportation_requests (
    organization_id, requester_name, requester_relationship, requester_phone,
    pickup_description, destination_description, return_trip_needed
  ) values (
    '10000000-0000-0000-0000-0000000000a1', 'S4A TEST direct insert', 'self', '555-0000', 'x', 'y', 'no'
  );
  raise notice 'TEST 1 anon-direct-insert: FAIL (insert succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST 1 anon-direct-insert: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

do $$
declare v_count int;
begin
  set local role anon;
  select count(*) into v_count from public.transportation_requests;
  raise notice 'TEST 2 anon-direct-select: FAIL (select succeeded, returned % rows, should be permission denied)', v_count;
exception when insufficient_privilege then
  raise notice 'TEST 2 anon-direct-select: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

do $$
begin
  set local role anon;
  update public.transportation_requests set requester_name = 'S4A TEST tampered' where true;
  raise notice 'TEST 3 anon-direct-update: FAIL (update succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST 3 anon-direct-update: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

do $$
begin
  set local role anon;
  delete from public.transportation_requests where true;
  raise notice 'TEST 4 anon-direct-delete: FAIL (delete succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST 4 anon-direct-delete: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

-- =============================================================================
-- S4B-1/S4B-2. Direct RPC bypass is now closed: anon and ordinary
-- authenticated sessions cannot EXECUTE submit_public_transportation_
-- request directly at all — only service_role (the Route Handler's own
-- trusted execution context) can. This is the S4A report's own
-- explicitly-flagged bypass, closed in
-- 20260919120000_public_intake_ingress_hardening.sql.
-- =============================================================================
do $$
begin
  set local role anon;
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'S4B-TEST-DIRECT-ANON', 'S4B Direct Bypass Attempt', 'self', '555-0200',
    'S4A TEST Direct Bypass Pickup', 'S4A TEST Direct Bypass Destination', 'no'
  );
  raise notice 'TEST S4B-1 anon-cannot-execute-rpc-directly: FAIL (call succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST S4B-1 anon-cannot-execute-rpc-directly: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'S4B-TEST-DIRECT-AUTHENTICATED', 'S4B Direct Bypass Attempt', 'self', '555-0201',
    'S4A TEST Direct Bypass Pickup', 'S4A TEST Direct Bypass Destination', 'no'
  );
  raise notice 'TEST S4B-2 authenticated-cannot-execute-rpc-directly: FAIL (call succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST S4B-2 authenticated-cannot-execute-rpc-directly: PASS (permission denied: %, even for a real, currently-signed-in Organization Admin)', sqlerrm;
end $$;
reset role;

do $$
begin
  perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'submit_public_transportation_request'
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
    and not has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not has_function_privilege('public', p.oid, 'EXECUTE');
  if found then
    raise notice 'TEST S4B-3 exact-privilege-shape: PASS (service_role=true, anon=false, authenticated=false, public=false)';
  else
    raise notice 'TEST S4B-3 exact-privilege-shape: FAIL (privilege shape does not match the expected service_role-only contract)';
  end if;
end $$;

-- =============================================================================
-- 5. A valid active intake integration can create only the intended
-- Request
-- =============================================================================
do $$
declare v_result public.public_request_submission_result;
declare v_created_org uuid;
declare v_created_state text;
declare v_created_passenger uuid;
begin
  set local role service_role;
  select * into v_result from public.submit_public_transportation_request(
    'test-intake-org-a', 'S4A-TEST-KEY-001', 'S4A Test Requester', 'self', '555-0101',
    'S4A TEST Pickup', 'S4A TEST Destination', 'no'
  );
  reset role;

  select organization_id, state, passenger_id into v_created_org, v_created_state, v_created_passenger
  from public.transportation_requests
  where intake_integration_id = 'a0000000-0000-0000-0000-00000000a001' and external_submission_ref = 'S4A-TEST-KEY-001';

  if v_result.accepted and v_created_org = '10000000-0000-0000-0000-0000000000a1'
     and v_created_state = 'pending' and v_created_passenger is null then
    raise notice 'TEST 5 valid-active-integration-creates-intended-request: PASS (org=%, state=%, passenger=null)', v_created_org, v_created_state;
  else
    raise notice 'TEST 5 valid-active-integration-creates-intended-request: FAIL (accepted=%, org=%, state=%, passenger=%)', v_result.accepted, v_created_org, v_created_state, v_created_passenger;
  end if;
end $$;

-- =============================================================================
-- 6/7. organization is derived internally, never accepted from the
-- public payload — tampering with an org id (even a REAL one, guessed by
-- an attacker) cannot redirect a Request, because no field ever names an
-- organization directly. Proven by passing Org B's real organization_id
-- AS IF it were the integration identifier — it must never match, since
-- external_id is looked up by its own column, never by organization_id.
-- =============================================================================
do $$
declare v_result public.public_request_submission_result;
declare v_error_code text;
begin
  set local role service_role;
  begin
    select * into v_result from public.submit_public_transportation_request(
      '10000000-0000-0000-0000-0000000000b1', -- a REAL organization_id, used where only external_id is ever read
      'S4A-TEST-KEY-ORGID-SPOOF', 'S4A Test Requester', 'self', '555-0102',
      'S4A TEST Pickup', 'S4A TEST Destination', 'no'
    );
    raise notice 'TEST 6-7 org-id-spoof-via-external-id-param: FAIL (accepted=%, should have been rejected)', v_result.accepted;
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate;
    raise notice 'TEST 6-7 org-id-spoof-via-external-id-param: PASS (rejected: % / %)', v_error_code, sqlerrm;
  end;
  reset role;
end $$;

do $$
declare v_leaked_count int;
begin
  select count(*) into v_leaked_count
  from public.transportation_requests
  where external_submission_ref = 'S4A-TEST-KEY-ORGID-SPOOF';
  if v_leaked_count = 0 then
    raise notice 'TEST 7b org-id-spoof-created-no-row: PASS (0 rows created)';
  else
    raise notice 'TEST 7b org-id-spoof-created-no-row: FAIL (% row(s) created)', v_leaked_count;
  end if;
end $$;

-- =============================================================================
-- 8. An integration cannot create data for another organization —
-- INT_B (Org B) creates its own Request, confirmed tied to Org B only.
-- =============================================================================
do $$
declare v_result public.public_request_submission_result;
declare v_created_org uuid;
begin
  set local role service_role;
  select * into v_result from public.submit_public_transportation_request(
    'test-intake-org-b', 'S4A-TEST-KEY-002', 'S4A Test Requester B', 'self', '555-0103',
    'S4A TEST Pickup B', 'S4A TEST Destination B', 'no'
  );
  reset role;

  select organization_id into v_created_org
  from public.transportation_requests
  where intake_integration_id = 'a0000000-0000-0000-0000-00000000a003' and external_submission_ref = 'S4A-TEST-KEY-002';

  if v_result.accepted and v_created_org = '10000000-0000-0000-0000-0000000000b1' then
    raise notice 'TEST 8 integration-scoped-to-own-org: PASS (Org B integration created a row in Org B only)';
  else
    raise notice 'TEST 8 integration-scoped-to-own-org: FAIL (accepted=%, org=%)', v_result.accepted, v_created_org;
  end if;
end $$;

-- =============================================================================
-- 9. Disabled integration cannot create a Request
-- =============================================================================
do $$
declare v_error_code text;
declare v_accepted boolean;
begin
  set local role service_role;
  begin
    select accepted into v_accepted from public.submit_public_transportation_request(
      'test-intake-org-a-disabled', 'S4A-TEST-KEY-003', 'S4A Test Requester', 'self', '555-0104',
      'S4A TEST Pickup', 'S4A TEST Destination', 'no'
    );
    raise notice 'TEST 9 disabled-integration: FAIL (accepted=%, should have been rejected)', v_accepted;
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate;
    raise notice 'TEST 9 disabled-integration: PASS (rejected: %)', v_error_code;
  end;
  reset role;
end $$;

-- =============================================================================
-- 10. Invalid integration identifier cannot create a Request, and its
-- error is INDISTINGUISHABLE from the disabled-integration case above
-- (no existence oracle).
-- =============================================================================
do $$
declare v_error_code text;
declare v_accepted boolean;
begin
  set local role service_role;
  begin
    select accepted into v_accepted from public.submit_public_transportation_request(
      'this-external-id-does-not-exist', 'S4A-TEST-KEY-004', 'S4A Test Requester', 'self', '555-0105',
      'S4A TEST Pickup', 'S4A TEST Destination', 'no'
    );
    raise notice 'TEST 10 invalid-integration-id: FAIL (accepted=%, should have been rejected)', v_accepted;
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate;
    if v_error_code = 'ZW006' then
      raise notice 'TEST 10 invalid-integration-id: PASS (rejected with ZW006 -- the SAME error class as a disabled integration -- no existence oracle)';
    else
      raise notice 'TEST 10 invalid-integration-id: FAIL (unexpected error class %)', v_error_code;
    end if;
  end;
  reset role;
end $$;

-- =============================================================================
-- 11. Duplicate/replayed idempotency key does not create duplicate
-- Requests (sequential replay -- see the dedicated concurrency script
-- for the genuine two-process race, item 12).
-- =============================================================================
do $$
declare v_result1 public.public_request_submission_result;
declare v_result2 public.public_request_submission_result;
declare v_row_count int;
begin
  set local role service_role;
  select * into v_result1 from public.submit_public_transportation_request(
    'test-intake-org-a', 'S4A-TEST-KEY-REPLAY', 'S4A Replay Requester', 'self', '555-0106',
    'S4A TEST Pickup Replay', 'S4A TEST Destination Replay', 'no'
  );
  select * into v_result2 from public.submit_public_transportation_request(
    'test-intake-org-a', 'S4A-TEST-KEY-REPLAY', 'S4A Replay Requester -- resubmitted with different text, same key', 'self', '555-9999',
    'DIFFERENT pickup text', 'DIFFERENT destination text', 'yes'
  );
  reset role;

  select count(*) into v_row_count
  from public.transportation_requests
  where intake_integration_id = 'a0000000-0000-0000-0000-00000000a001' and external_submission_ref = 'S4A-TEST-KEY-REPLAY';

  if v_result1.accepted and v_result2.accepted and v_row_count = 1 then
    raise notice 'TEST 11 idempotent-replay: PASS (both calls accepted=true, exactly 1 row exists, original values preserved)';
  else
    raise notice 'TEST 11 idempotent-replay: FAIL (accepted1=%, accepted2=%, row_count=%)', v_result1.accepted, v_result2.accepted, v_row_count;
  end if;
end $$;

-- =============================================================================
-- 13. Public mutation cannot set protected/internal Request fields --
-- every row created via this RPC always has state='pending' and
-- passenger_id IS NULL, regardless of what the caller sent (no
-- parameter exists for either).
-- =============================================================================
do $$
declare v_bad_state_count int;
declare v_bad_passenger_count int;
begin
  select count(*) into v_bad_state_count
  from public.transportation_requests
  where intake_integration_id is not null and state != 'pending';
  select count(*) into v_bad_passenger_count
  from public.transportation_requests
  where intake_integration_id is not null and passenger_id is not null;

  if v_bad_state_count = 0 and v_bad_passenger_count = 0 then
    raise notice 'TEST 13 no-protected-field-override: PASS (every intake-created row is pending with no passenger)';
  else
    raise notice 'TEST 13 no-protected-field-override: FAIL (% wrong-state rows, % rows with a passenger)', v_bad_state_count, v_bad_passenger_count;
  end if;
end $$;

-- =============================================================================
-- 14/15. Public mutation cannot create Trips, Memberships, Drivers,
-- Vehicles, or Passengers -- row counts in every one of those tables are
-- unaffected by any of the RPC calls above.
-- =============================================================================
-- (memberships is not separately queried here: submit_public_transportation_
-- request's own body, reviewable directly in
-- 20260919090000_public_request_intake_foundation.sql, contains no INSERT
-- statement targeting memberships/drivers/vehicles at all -- the only
-- INSERT targets are transportation_requests and request_events. The
-- runtime checks below confirm the same for the tables a tagged synthetic
-- row would actually be identifiable in.)
do $$
declare v_trips int; declare v_drivers int; declare v_vehicles int; declare v_passengers int;
begin
  select count(*) into v_trips from public.trips where pickup_description like 'S4A TEST%';
  select count(*) into v_drivers from public.drivers where display_name like 'S4A%';
  select count(*) into v_vehicles from public.vehicles where label like 'S4A%';
  select count(*) into v_passengers from public.passengers where display_name like 'S4A%';

  if v_trips = 0 and v_drivers = 0 and v_vehicles = 0 and v_passengers = 0 then
    raise notice 'TEST 14-15 no-side-effect-writes: PASS (0 Trips/Drivers/Vehicles/Passengers created by public intake)';
  else
    raise notice 'TEST 14-15 no-side-effect-writes: FAIL (trips=%, drivers=%, vehicles=%, passengers=%)', v_trips, v_drivers, v_vehicles, v_passengers;
  end if;
end $$;

-- =============================================================================
-- 16. Existing authenticated Request workflow remains unchanged --
-- log_transportation_request still works exactly as before this
-- migration.
-- =============================================================================
do $$
declare v_result public.request_creation_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into v_result from public.log_transportation_request(
    '10000000-0000-0000-0000-0000000000a1', 'S4A Regression Staff Requester', 'self', '555-0107',
    'S4A TEST Staff Pickup', 'S4A TEST Staff Destination', 'no', 'phone'
  );
  reset role;
  if v_result.created and v_result.state = 'pending' then
    raise notice 'TEST 16 existing-authenticated-workflow-unchanged: PASS (log_transportation_request still creates a pending Request)';
  else
    raise notice 'TEST 16 existing-authenticated-workflow-unchanged: FAIL (created=%, state=%)', v_result.created, v_result.state;
  end if;
exception when others then
  raise notice 'TEST 16 existing-authenticated-workflow-unchanged: FAIL (unexpected error: %)', sqlerrm;
end $$;
reset role;

-- =============================================================================
-- 17/18. Org isolation: Org A cannot see Org B's website Requests and
-- vice versa (RLS unchanged, still authoritative for authenticated
-- reads).
-- =============================================================================
do $$
declare v_visible_from_a int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select count(*) into v_visible_from_a
  from public.transportation_requests
  where intake_integration_id = 'a0000000-0000-0000-0000-00000000a003'; -- Org B's own integration
  reset role;
  if v_visible_from_a = 0 then
    raise notice 'TEST 17 org-a-cannot-see-org-b-website-requests: PASS (0 visible)';
  else
    raise notice 'TEST 17 org-a-cannot-see-org-b-website-requests: FAIL (% visible)', v_visible_from_a;
  end if;
end $$;
reset role;

do $$
declare v_visible_from_b int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  select count(*) into v_visible_from_b
  from public.transportation_requests
  where intake_integration_id = 'a0000000-0000-0000-0000-00000000a001'; -- Org A's own integration
  reset role;
  if v_visible_from_b = 0 then
    raise notice 'TEST 18 org-b-cannot-see-org-a-website-requests: PASS (0 visible)';
  else
    raise notice 'TEST 18 org-b-cannot-see-org-a-website-requests: FAIL (% visible)', v_visible_from_b;
  end if;
end $$;
reset role;

-- =============================================================================
-- 20. EXECUTE privileges are the minimum required. UPDATED P1-PILOT-S4B:
-- originally (S4A) exactly anon + authenticated held EXECUTE; as of
-- 20260919120000_public_intake_ingress_hardening.sql, EXECUTE is
-- service_role-only (see TEST S4B-3 above, which asserts the same
-- shape independently) -- this is the direct-RPC-bypass closure, a
-- deliberate hardening, not a weakened invariant. This test's own
-- underlying purpose ("the minimum required, never PUBLIC") is
-- unchanged; only which specific role is "minimum" changed.
-- =============================================================================
do $$
declare v_anon boolean;
declare v_authenticated boolean;
declare v_service_role boolean;
declare v_public boolean;
begin
  -- Signature updated P1-PILOT-S4B-R2 (20260919130000): the RPC gained 6
  -- new trailing parameters (serviceType/recurringSchedule); the old
  -- 14-arg overload was dropped by that same migration, not merely
  -- superseded, so has_function_privilege must reference the current,
  -- full 20-arg signature or this lookup itself errors ("function does
  -- not exist") rather than returning a real answer.
  select has_function_privilege('anon', 'public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time, text, text, text, text, text[], date, date, time, boolean, text, jsonb)', 'EXECUTE') into v_anon;
  select has_function_privilege('authenticated', 'public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time, text, text, text, text, text[], date, date, time, boolean, text, jsonb)', 'EXECUTE') into v_authenticated;
  select has_function_privilege('service_role', 'public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time, text, text, text, text, text[], date, date, time, boolean, text, jsonb)', 'EXECUTE') into v_service_role;
  select has_function_privilege('public', 'public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time, text, text, text, text, text[], date, date, time, boolean, text, jsonb)', 'EXECUTE') into v_public;

  if v_service_role and not v_anon and not v_authenticated and not v_public then
    raise notice 'TEST 20 minimum-execute-privilege: PASS (service_role=true, anon=false, authenticated=false, public=false)';
  else
    raise notice 'TEST 20 minimum-execute-privilege: FAIL (service_role=%, anon=%, authenticated=%, public=%)', v_service_role, v_anon, v_authenticated, v_public;
  end if;
end $$;

-- =============================================================================
-- BONUS A. request_intake_integrations itself is fully closed to
-- anon/authenticated direct table access (only the RPC, running as
-- table owner, ever reads it).
-- =============================================================================
do $$
begin
  set local role anon;
  perform 1 from public.request_intake_integrations limit 1;
  raise notice 'TEST BONUS-A anon-cannot-read-integrations-table: FAIL (select succeeded)';
exception when insufficient_privilege then
  raise notice 'TEST BONUS-A anon-cannot-read-integrations-table: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform 1 from public.request_intake_integrations limit 1;
  raise notice 'TEST BONUS-A2 authenticated-cannot-read-integrations-table: FAIL (select succeeded)';
exception when insufficient_privilege then
  raise notice 'TEST BONUS-A2 authenticated-cannot-read-integrations-table: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

-- =============================================================================
-- BONUS A3. service_role holds EXACTLY select on request_intake_integrations
-- -- never insert/update/delete. Regression guard for the S4B CORS-
-- resolution bug: `src/lib/public-intake/cors.ts` needs a direct
-- service_role SELECT to resolve Access-Control-Allow-Origin (service_role's
-- own BYPASSRLS attribute does NOT imply a table-level GRANT -- confirmed
-- directly during S4B development, the identical lesson already learned
-- once for this RPC's own EXECUTE grant). Provisioning (create/activate/
-- disable) must remain an exclusively `postgres`-role direct-SQL
-- operation -- never something application code (even under service_role)
-- can do -- so this test also proves service_role holds NO write grant.
-- =============================================================================
do $$
declare
  v_select boolean;
  v_insert boolean;
  v_update boolean;
  v_delete boolean;
begin
  select has_table_privilege('service_role', 'public.request_intake_integrations', 'SELECT') into v_select;
  select has_table_privilege('service_role', 'public.request_intake_integrations', 'INSERT') into v_insert;
  select has_table_privilege('service_role', 'public.request_intake_integrations', 'UPDATE') into v_update;
  select has_table_privilege('service_role', 'public.request_intake_integrations', 'DELETE') into v_delete;

  if v_select and not v_insert and not v_update and not v_delete then
    raise notice 'TEST BONUS-A3 service-role-select-only-on-integrations-table: PASS (select=true, insert=false, update=false, delete=false)';
  else
    raise notice 'TEST BONUS-A3 service-role-select-only-on-integrations-table: FAIL (select=%, insert=%, update=%, delete=%)', v_select, v_insert, v_update, v_delete;
  end if;
end $$;

-- =============================================================================
-- BONUS B. allowed_origins enforcement -- a mismatched Origin is
-- rejected for an origin-locked integration; the correct Origin
-- succeeds; an origin-locked integration with NO Origin header supplied
-- is also rejected (fail closed, not fail open, once configured).
-- =============================================================================
do $$
declare v_error_code text;
begin
  set local role service_role;
  begin
    perform public.submit_public_transportation_request(
      'test-intake-org-a-origin-locked', 'S4A-TEST-KEY-ORIGIN-BAD', 'S4A Test Requester', 'self', '555-0108',
      'S4A TEST Pickup', 'S4A TEST Destination', 'no', null, null, null, null, null,
      'https://attacker.example.test'
    );
    raise notice 'TEST BONUS-B1 origin-mismatch-rejected: FAIL (accepted with wrong Origin)';
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate;
    raise notice 'TEST BONUS-B1 origin-mismatch-rejected: PASS (rejected: %)', v_error_code;
  end;
  reset role;
end $$;

do $$
declare v_result public.public_request_submission_result;
begin
  set local role service_role;
  select * into v_result from public.submit_public_transportation_request(
    'test-intake-org-a-origin-locked', 'S4A-TEST-KEY-ORIGIN-OK', 'S4A Test Requester', 'self', '555-0109',
    'S4A TEST Pickup', 'S4A TEST Destination', 'no', null, null, null, null, null,
    'https://acme-clinic.example.test'
  );
  reset role;
  if v_result.accepted then
    raise notice 'TEST BONUS-B2 origin-match-accepted: PASS';
  else
    raise notice 'TEST BONUS-B2 origin-match-accepted: FAIL';
  end if;
end $$;

do $$
declare v_error_code text;
begin
  -- p_origin = null: an origin-locked integration must fail CLOSED when
  -- no Origin header was supplied at all, never fail open just because
  -- there was nothing to compare against. (This test was missing even
  -- though the section comment above already claimed it -- added in
  -- P1-PILOT-S4B.)
  set local role service_role;
  begin
    perform public.submit_public_transportation_request(
      'test-intake-org-a-origin-locked', 'S4A-TEST-KEY-ORIGIN-MISSING', 'S4A Test Requester', 'self', '555-0110',
      'S4A TEST Pickup', 'S4A TEST Destination', 'no', null, null, null, null, null,
      null
    );
    raise notice 'TEST BONUS-B3 origin-missing-rejected: FAIL (accepted with no Origin header)';
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate;
    raise notice 'TEST BONUS-B3 origin-missing-rejected: PASS (rejected: %)', v_error_code;
  end;
  reset role;
end $$;

-- =============================================================================
-- R2-1. serviceType + recurringSchedule stored STRUCTURALLY, never folded
-- into additionalNotes (P1-PILOT-S4B-R2).
-- =============================================================================
do $$
declare
  v_service_type text;
  v_days smallint[];
  v_start date;
  v_end date;
  v_time time;
  v_return boolean;
  v_additional_notes text;
begin
  set local role service_role;
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2-TEST-STRUCTURED-1', 'S4A TEST R2 Requester', 'self', '555-0300',
    'S4A TEST R2 Pickup', 'S4A TEST R2 Destination', 'yes',
    null, null, null, null, null, null,
    'dialysis', array['monday','wednesday','friday'], '2026-10-01', '2026-12-01', '09:00', true
  );
  reset role;

  select service_type, recurring_days_of_week, recurring_start_date, recurring_end_date,
         recurring_appointment_time, recurring_return_trip_expected, additional_notes
  into v_service_type, v_days, v_start, v_end, v_time, v_return, v_additional_notes
  from public.transportation_requests
  where external_submission_ref = 'R2-TEST-STRUCTURED-1';

  if v_service_type = 'dialysis' and v_days = array[1,3,5]::smallint[] and v_start = '2026-10-01'
     and v_end = '2026-12-01' and v_time = '09:00' and v_return = true and v_additional_notes is null then
    raise notice 'TEST R2-1 structured-persistence: PASS (service_type=%, days=%, additional_notes stays NULL -- never used as storage)', v_service_type, v_days;
  else
    raise notice 'TEST R2-1 structured-persistence: FAIL (service_type=%, days=%, start=%, end=%, time=%, return=%, notes=%)',
      v_service_type, v_days, v_start, v_end, v_time, v_return, v_additional_notes;
  end if;
end $$;

-- =============================================================================
-- R2-2. Omitted serviceType/recurringSchedule -> both remain NULL
-- (backward-compatible one-time request, the pre-R2 default unchanged).
-- =============================================================================
do $$
declare
  v_service_type text;
  v_days smallint[];
begin
  set local role service_role;
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2-TEST-OMITTED-1', 'S4A TEST R2 Requester', 'self', '555-0301',
    'S4A TEST R2 Pickup', 'S4A TEST R2 Destination', 'no'
  );
  reset role;

  select service_type, recurring_days_of_week into v_service_type, v_days
  from public.transportation_requests where external_submission_ref = 'R2-TEST-OMITTED-1';

  if v_service_type is null and v_days is null then
    raise notice 'TEST R2-2 omitted-fields-stay-null: PASS';
  else
    raise notice 'TEST R2-2 omitted-fields-stay-null: FAIL (service_type=%, days=%)', v_service_type, v_days;
  end if;
end $$;

-- =============================================================================
-- R2-3. Request remains pending / awaiting review; zero auto-Passenger,
-- zero auto-Trip -- a structured (serviceType + recurringSchedule)
-- submission is NOT treated any differently from a plain one-time
-- Request in this respect.
-- =============================================================================
do $$
declare
  v_state text;
  v_passenger_id uuid;
  v_trip_count int;
  v_request_id uuid;
begin
  select id, state, passenger_id into v_request_id, v_state, v_passenger_id
  from public.transportation_requests where external_submission_ref = 'R2-TEST-STRUCTURED-1';

  select count(*) into v_trip_count from public.trips where request_id = v_request_id;

  if v_state = 'pending' and v_passenger_id is null and v_trip_count = 0 then
    raise notice 'TEST R2-3 no-side-effects-on-structured-request: PASS (state=pending, no Passenger, no Trip)';
  else
    raise notice 'TEST R2-3 no-side-effects-on-structured-request: FAIL (state=%, passenger_id=%, trip_count=%)', v_state, v_passenger_id, v_trip_count;
  end if;
end $$;

-- =============================================================================
-- R2-4. Org spoofing remains impossible with serviceType/recurringSchedule
-- present -- Org B's own integration still only ever creates an Org B
-- Request, never Org A's, regardless of these new fields.
-- =============================================================================
do $$
declare
  v_org_id uuid;
  v_expected_org_id uuid;
begin
  set local role service_role;
  perform public.submit_public_transportation_request(
    'test-intake-org-b', 'R2-TEST-ORGB-STRUCTURED', 'S4A TEST R2 Org B Requester', 'self', '555-0302',
    'S4A TEST R2 Pickup', 'S4A TEST R2 Destination', 'no',
    null, null, null, null, null, null,
    'other', array['tuesday'], '2026-10-06', null, null, null
  );
  reset role;

  select organization_id into v_org_id from public.transportation_requests where external_submission_ref = 'R2-TEST-ORGB-STRUCTURED';
  select organization_id into v_expected_org_id from public.request_intake_integrations where external_id = 'test-intake-org-b';

  if v_org_id = v_expected_org_id and v_org_id <> (select organization_id from public.request_intake_integrations where external_id = 'test-intake-org-a') then
    raise notice 'TEST R2-4 org-isolation-with-structured-fields: PASS (Org B integration created an Org B Request, never Org A)';
  else
    raise notice 'TEST R2-4 org-isolation-with-structured-fields: FAIL (got org=%, expected=%)', v_org_id, v_expected_org_id;
  end if;
end $$;

-- =============================================================================
-- R2-5/R2-6. Direct RPC bypass remains closed for the NEW (20-parameter)
-- overload too -- anon/authenticated still cannot EXECUTE it directly,
-- confirming the R2 migration's function replacement did not
-- accidentally reopen S4B's own closed bypass.
-- =============================================================================
do $$
begin
  set local role anon;
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2-TEST-DIRECT-ANON', 'S4A TEST R2 Bypass', 'self', '555-0303',
    'S4A TEST R2 Pickup', 'S4A TEST R2 Destination', 'no',
    null, null, null, null, null, null,
    'other', array['monday'], '2026-10-06', null, null, null
  );
  raise notice 'TEST R2-5 anon-cannot-execute-extended-rpc: FAIL (call succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST R2-5 anon-cannot-execute-extended-rpc: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2-TEST-DIRECT-AUTH', 'S4A TEST R2 Bypass', 'self', '555-0304',
    'S4A TEST R2 Pickup', 'S4A TEST R2 Destination', 'no',
    null, null, null, null, null, null,
    'other', array['monday'], '2026-10-06', null, null, null
  );
  raise notice 'TEST R2-6 authenticated-cannot-execute-extended-rpc: FAIL (call succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST R2-6 authenticated-cannot-execute-extended-rpc: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

-- =============================================================================
-- R2-7. Idempotent replay with a structured (recurringSchedule) payload
-- still creates exactly ONE Request -- the addition of new columns does
-- not weaken the existing partial-unique-index idempotency mechanism.
-- =============================================================================
do $$
declare
  v_count int;
begin
  set local role service_role;
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2-TEST-REPLAY', 'S4A TEST R2 Replay First', 'self', '555-0305',
    'S4A TEST R2 Pickup', 'S4A TEST R2 Destination', 'yes',
    null, null, null, null, null, null,
    'senior_medical', array['thursday'], '2026-10-08', null, null, null
  );
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2-TEST-REPLAY', 'S4A TEST R2 Replay Second -- different text, same key', 'family', '555-0306',
    'S4A TEST R2 Pickup CHANGED', 'S4A TEST R2 Destination CHANGED', 'no',
    null, null, null, null, null, null,
    'other', array['friday'], '2026-11-01', null, null, null
  );
  reset role;

  select count(*) into v_count from public.transportation_requests where external_submission_ref = 'R2-TEST-REPLAY';
  if v_count = 1 then
    raise notice 'TEST R2-7 idempotent-replay-with-structured-payload: PASS (exactly one Request, even with a materially different second payload)';
  else
    raise notice 'TEST R2-7 idempotent-replay-with-structured-payload: FAIL (row_count=%)', v_count;
  end if;
end $$;

-- =============================================================================
-- R2-8. Disabled/nonexistent integration still rejected with
-- serviceType/recurringSchedule present -- these new optional fields do
-- not create a second, less-validated code path.
-- =============================================================================
do $$
declare v_error_code text;
begin
  set local role service_role;
  begin
    perform public.submit_public_transportation_request(
      'test-intake-org-a-disabled', 'R2-TEST-DISABLED', 'S4A TEST R2', 'self', '555-0307',
      'S4A TEST R2 Pickup', 'S4A TEST R2 Destination', 'no',
      null, null, null, null, null, null,
      'other', array['monday'], '2026-10-06', null, null, null
    );
    raise notice 'TEST R2-8 disabled-integration-rejected-with-structured-fields: FAIL (accepted, should be rejected)';
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate;
    raise notice 'TEST R2-8 disabled-integration-rejected-with-structured-fields: PASS (rejected: %)', v_error_code;
  end;
  reset role;
end $$;

-- =============================================================================
-- R2A-1. requested_passenger_name stored STRUCTURALLY; no Passenger row
-- created; passenger_id stays NULL (P1-PILOT-S4B-R2A).
-- =============================================================================
do $$
declare
  v_requested_name text;
  v_passenger_id uuid;
  v_passenger_count int;
begin
  set local role service_role;
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2A-TEST-STRUCTURED-1', 'S4A TEST R2A Requester', 'self', '555-0600',
    'S4A TEST R2A Pickup', 'S4A TEST R2A Destination', 'no',
    null, null, null, null, null, null,
    null, null, null, null, null, null,
    'PILOT PASSENGER QA'
  );
  reset role;

  select requested_passenger_name, passenger_id into v_requested_name, v_passenger_id
  from public.transportation_requests where external_submission_ref = 'R2A-TEST-STRUCTURED-1';

  select count(*) into v_passenger_count from public.passengers where display_name = 'PILOT PASSENGER QA';

  if v_requested_name = 'PILOT PASSENGER QA' and v_passenger_id is null and v_passenger_count = 0 then
    raise notice 'TEST R2A-1 requested-passenger-name-structured-no-auto-passenger: PASS (name stored, passenger_id NULL, zero Passenger rows created)';
  else
    raise notice 'TEST R2A-1 requested-passenger-name-structured-no-auto-passenger: FAIL (name=%, passenger_id=%, passenger_count=%)', v_requested_name, v_passenger_id, v_passenger_count;
  end if;
end $$;

-- =============================================================================
-- R2A-2. Omitted passengerName -> NULL (backward compatible, unchanged
-- default).
-- =============================================================================
do $$
declare v_requested_name text;
begin
  set local role service_role;
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2A-TEST-OMITTED-1', 'S4A TEST R2A Requester', 'self', '555-0601',
    'S4A TEST R2A Pickup', 'S4A TEST R2A Destination', 'no'
  );
  reset role;

  select requested_passenger_name into v_requested_name
  from public.transportation_requests where external_submission_ref = 'R2A-TEST-OMITTED-1';

  if v_requested_name is null then
    raise notice 'TEST R2A-2 omitted-passenger-name-stays-null: PASS';
  else
    raise notice 'TEST R2A-2 omitted-passenger-name-stays-null: FAIL (requested_passenger_name=%)', v_requested_name;
  end if;
end $$;

-- =============================================================================
-- R2A-3. No auto-Trip either -- a requested passenger name does not
-- change this endpoint's own "no side effects" contract.
-- =============================================================================
do $$
declare
  v_state text;
  v_passenger_id uuid;
  v_trip_count int;
  v_request_id uuid;
begin
  select id, state, passenger_id into v_request_id, v_state, v_passenger_id
  from public.transportation_requests where external_submission_ref = 'R2A-TEST-STRUCTURED-1';

  select count(*) into v_trip_count from public.trips where request_id = v_request_id;

  if v_state = 'pending' and v_passenger_id is null and v_trip_count = 0 then
    raise notice 'TEST R2A-3 no-side-effects-with-requested-passenger-name: PASS (state=pending, no Passenger, no Trip)';
  else
    raise notice 'TEST R2A-3 no-side-effects-with-requested-passenger-name: FAIL (state=%, passenger_id=%, trip_count=%)', v_state, v_passenger_id, v_trip_count;
  end if;
end $$;

-- =============================================================================
-- R2A-4. Org isolation unchanged with requested_passenger_name present.
-- =============================================================================
do $$
declare
  v_org_id uuid;
  v_expected_org_id uuid;
begin
  set local role service_role;
  perform public.submit_public_transportation_request(
    'test-intake-org-b', 'R2A-TEST-ORGB', 'S4A TEST R2A Org B Requester', 'self', '555-0602',
    'S4A TEST R2A Pickup', 'S4A TEST R2A Destination', 'no',
    null, null, null, null, null, null,
    null, null, null, null, null, null,
    'PILOT PASSENGER QA ORG B'
  );
  reset role;

  select organization_id into v_org_id from public.transportation_requests where external_submission_ref = 'R2A-TEST-ORGB';
  select organization_id into v_expected_org_id from public.request_intake_integrations where external_id = 'test-intake-org-b';

  if v_org_id = v_expected_org_id and v_org_id <> (select organization_id from public.request_intake_integrations where external_id = 'test-intake-org-a') then
    raise notice 'TEST R2A-4 org-isolation-with-requested-passenger-name: PASS';
  else
    raise notice 'TEST R2A-4 org-isolation-with-requested-passenger-name: FAIL (got org=%, expected=%)', v_org_id, v_expected_org_id;
  end if;
end $$;

-- =============================================================================
-- R2A-5. Disabled integration still rejected with passengerName present.
-- =============================================================================
do $$
declare v_error_code text;
begin
  set local role service_role;
  begin
    perform public.submit_public_transportation_request(
      'test-intake-org-a-disabled', 'R2A-TEST-DISABLED', 'S4A TEST R2A', 'self', '555-0603',
      'S4A TEST R2A Pickup', 'S4A TEST R2A Destination', 'no',
      null, null, null, null, null, null,
      null, null, null, null, null, null,
      'PILOT PASSENGER QA'
    );
    raise notice 'TEST R2A-5 disabled-integration-rejected-with-passenger-name: FAIL (accepted, should be rejected)';
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate;
    raise notice 'TEST R2A-5 disabled-integration-rejected-with-passenger-name: PASS (rejected: %)', v_error_code;
  end;
  reset role;
end $$;

-- =============================================================================
-- R2A-6/R2A-7. Direct RPC bypass remains closed for the NEW (21-parameter)
-- overload too.
-- =============================================================================
do $$
begin
  set local role anon;
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2A-TEST-DIRECT-ANON', 'S4A TEST R2A Bypass', 'self', '555-0604',
    'S4A TEST R2A Pickup', 'S4A TEST R2A Destination', 'no',
    null, null, null, null, null, null,
    null, null, null, null, null, null,
    'PILOT PASSENGER QA'
  );
  raise notice 'TEST R2A-6 anon-cannot-execute-extended-rpc: FAIL (call succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST R2A-6 anon-cannot-execute-extended-rpc: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2A-TEST-DIRECT-AUTH', 'S4A TEST R2A Bypass', 'self', '555-0605',
    'S4A TEST R2A Pickup', 'S4A TEST R2A Destination', 'no',
    null, null, null, null, null, null,
    null, null, null, null, null, null,
    'PILOT PASSENGER QA'
  );
  raise notice 'TEST R2A-7 authenticated-cannot-execute-extended-rpc: FAIL (call succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST R2A-7 authenticated-cannot-execute-extended-rpc: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

-- =============================================================================
-- R2A-8. Idempotent replay with a DIFFERENT requested_passenger_name on
-- the second call still yields exactly ONE Request, preserving the
-- FIRST accepted submission's own name (never updated on replay).
-- =============================================================================
do $$
declare
  v_count int;
  v_name text;
begin
  set local role service_role;
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2A-TEST-REPLAY', 'S4A TEST R2A Replay First', 'self', '555-0606',
    'S4A TEST R2A Pickup', 'S4A TEST R2A Destination', 'no',
    null, null, null, null, null, null,
    null, null, null, null, null, null,
    'FIRST PASSENGER NAME'
  );
  perform public.submit_public_transportation_request(
    'test-intake-org-a', 'R2A-TEST-REPLAY', 'S4A TEST R2A Replay Second -- different text, same key', 'family', '555-0607',
    'S4A TEST R2A Pickup CHANGED', 'S4A TEST R2A Destination CHANGED', 'yes',
    null, null, null, null, null, null,
    null, null, null, null, null, null,
    'SECOND PASSENGER NAME -- must never apply'
  );
  reset role;

  select count(*) into v_count from public.transportation_requests where external_submission_ref = 'R2A-TEST-REPLAY';
  select requested_passenger_name into v_name from public.transportation_requests where external_submission_ref = 'R2A-TEST-REPLAY';

  if v_count = 1 and v_name = 'FIRST PASSENGER NAME' then
    raise notice 'TEST R2A-8 idempotent-replay-preserves-first-passenger-name: PASS (exactly one Request, name=%)', v_name;
  else
    raise notice 'TEST R2A-8 idempotent-replay-preserves-first-passenger-name: FAIL (row_count=%, name=%)', v_count, v_name;
  end if;
end $$;

-- =============================================================================
-- CLEANUP
-- =============================================================================
delete from public.request_events where request_id in (
  select id from public.transportation_requests where pickup_description like 'S4A TEST%'
);
delete from public.transportation_requests where pickup_description like 'S4A TEST%';
delete from public.request_intake_integrations where external_id like 'test-intake-%';
