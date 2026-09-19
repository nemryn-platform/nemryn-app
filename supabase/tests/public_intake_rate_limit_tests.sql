-- Zenward Platform — durable public-intake rate-limit tests
-- (P1-PILOT-S4B). Run as postgres (superuser/BYPASSRLS) with role
-- switches inline, mirroring public_request_intake_tests.sql's own
-- established convention.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  delete from public.public_intake_rate_limit_events where integration_external_id like 's4b-rl-test-%' or client_key like 's4b-rl-client-%';
end $$;

-- =============================================================================
-- 16. Rate limit is enforced (per-client).
-- =============================================================================
do $$
declare v_allowed boolean;
declare v_denied_count int := 0;
declare v_allowed_count int := 0;
declare v_result public.rate_limit_check_result;
declare i int;
begin
  for i in 1..12 loop
    set local role service_role;
    select * into v_result from public.check_and_record_public_intake_rate_limit('s4b-rl-test-integration-a', 's4b-rl-client-per-client-test');
    reset role;
    if v_result.allowed then
      v_allowed_count := v_allowed_count + 1;
    else
      v_denied_count := v_denied_count + 1;
    end if;
  end loop;

  -- The function's own documented per-client threshold is 8/hour.
  if v_allowed_count = 8 and v_denied_count = 4 then
    raise notice 'TEST 16 rate-limit-per-client-enforced: PASS (8 allowed, 4 denied out of 12 attempts -- matches the documented 8/hour per-client threshold exactly)';
  else
    raise notice 'TEST 16 rate-limit-per-client-enforced: FAIL (allowed=%, denied=% out of 12 attempts -- expected 8 allowed, 4 denied)', v_allowed_count, v_denied_count;
  end if;
end $$;

-- =============================================================================
-- Per-integration threshold enforced independently of the per-client one
-- (a burst of DIFFERENT clients against the SAME integration still hits
-- the integration-wide cap).
-- =============================================================================
do $$
declare v_result public.rate_limit_check_result;
declare v_denied_count int := 0;
declare v_allowed_count int := 0;
declare i int;
begin
  delete from public.public_intake_rate_limit_events where integration_external_id = 's4b-rl-test-integration-b';
  for i in 1..125 loop
    set local role service_role;
    select * into v_result from public.check_and_record_public_intake_rate_limit('s4b-rl-test-integration-b', 's4b-rl-client-distinct-' || i);
    reset role;
    if v_result.allowed then
      v_allowed_count := v_allowed_count + 1;
    else
      v_denied_count := v_denied_count + 1;
    end if;
  end loop;

  -- The function's own documented per-integration threshold is 120/hour.
  if v_allowed_count = 120 and v_denied_count = 5 then
    raise notice 'TEST rate-limit-per-integration-enforced: PASS (120 allowed, 5 denied out of 125 attempts from 125 DISTINCT clients -- matches the documented 120/hour per-integration threshold exactly, proving the integration-wide cap is independent of the per-client one)';
  else
    raise notice 'TEST rate-limit-per-integration-enforced: FAIL (allowed=%, denied=% out of 125 attempts -- expected 120 allowed, 5 denied)', v_allowed_count, v_denied_count;
  end if;
end $$;

-- =============================================================================
-- 18. One integration cannot consume/alter another integration's limiter
-- state.
-- =============================================================================
do $$
declare v_result public.rate_limit_check_result;
declare v_other_integration_count int;
begin
  delete from public.public_intake_rate_limit_events where integration_external_id in ('s4b-rl-test-isolated-x', 's4b-rl-test-isolated-y');

  set local role service_role;
  select * into v_result from public.check_and_record_public_intake_rate_limit('s4b-rl-test-isolated-x', 's4b-rl-client-isolation-test');
  reset role;

  select count(*) into v_other_integration_count
  from public.public_intake_rate_limit_events
  where integration_external_id = 's4b-rl-test-isolated-y';

  if v_result.allowed and v_other_integration_count = 0 then
    raise notice 'TEST 18 integration-limiter-isolation: PASS (integration X''s own attempt never touched integration Y''s own counter)';
  else
    raise notice 'TEST 18 integration-limiter-isolation: FAIL (allowed=%, unexpected Y-counter rows=%)', v_result.allowed, v_other_integration_count;
  end if;
end $$;

-- =============================================================================
-- 19. Public caller cannot bypass the HTTP anti-abuse path by invoking
-- the rate-limit RPC (or the submission RPC) directly -- both are
-- service_role-only, exactly like submit_public_transportation_request
-- itself (see TEST S4B-1/S4B-2/S4B-3 in public_request_intake_tests.sql
-- for the submission RPC's own equivalent proof).
-- =============================================================================
do $$
begin
  set local role anon;
  perform public.check_and_record_public_intake_rate_limit('s4b-rl-test-bypass', 's4b-rl-client-bypass');
  raise notice 'TEST 19a anon-cannot-execute-rate-limit-rpc-directly: FAIL (call succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST 19a anon-cannot-execute-rate-limit-rpc-directly: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform public.check_and_record_public_intake_rate_limit('s4b-rl-test-bypass', 's4b-rl-client-bypass');
  raise notice 'TEST 19b authenticated-cannot-execute-rate-limit-rpc-directly: FAIL (call succeeded, should be permission denied)';
exception when insufficient_privilege then
  raise notice 'TEST 19b authenticated-cannot-execute-rate-limit-rpc-directly: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

-- =============================================================================
-- The rate-limit ledger table itself is fully closed to direct
-- anon/authenticated access, matching request_intake_integrations' own
-- zero-grant posture exactly.
-- =============================================================================
do $$
begin
  set local role anon;
  perform 1 from public.public_intake_rate_limit_events limit 1;
  raise notice 'TEST rate-limit-table-closed-anon: FAIL (select succeeded)';
exception when insufficient_privilege then
  raise notice 'TEST rate-limit-table-closed-anon: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform 1 from public.public_intake_rate_limit_events limit 1;
  raise notice 'TEST rate-limit-table-closed-authenticated: FAIL (select succeeded)';
exception when insufficient_privilege then
  raise notice 'TEST rate-limit-table-closed-authenticated: PASS (permission denied: %)', sqlerrm;
end $$;
reset role;

-- =============================================================================
-- Fails closed on malformed input (empty integration key or client key)
-- rather than silently skipping the check.
-- =============================================================================
do $$
declare v_result public.rate_limit_check_result;
begin
  set local role service_role;
  select * into v_result from public.check_and_record_public_intake_rate_limit('', 's4b-rl-client-empty-integration');
  reset role;
  if v_result.allowed then
    raise notice 'TEST rate-limit-fails-closed-empty-integration: FAIL (empty integration key was allowed)';
  else
    raise notice 'TEST rate-limit-fails-closed-empty-integration: PASS (empty integration key denied, fails closed)';
  end if;
end $$;

-- =============================================================================
-- CLEANUP
-- =============================================================================
delete from public.public_intake_rate_limit_events
where integration_external_id like 's4b-rl-test-%' or client_key like 's4b-rl-client-%';
