-- Nemryn -- P1-OPS-R1 EXPAND-state compatibility tests (P1-OPS-R1R).
--
-- ONLY meaningful on a database migrated through 20260924090000_request_decision_workflow_expand and NOT through
-- 20260924091000_request_decision_workflow_contract -- i.e. the deploy window in which the previously deployed
-- (pre-R1) application and the new application may both be calling the database. Proves:
--   * every pre-R1 call the old app makes still works with its old semantics (legacy decline / cancel overloads,
--     create_trip's implicit pending -> accepted), called both the way PostgREST calls them (named arguments,
--     optional arguments omitted) and positionally, with no "function is not unique" ambiguity;
--   * the new reason-aware RPCs and accept work side by side;
--   * the legacy overloads keep an authenticated-only, role-checked surface.
-- Run (local only):
--   supabase db reset   (with the CONTRACT migration temporarily moved out), then apply the EXPAND file, then
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/request_decision_expand_compat_tests.sql

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.report(p_name text, p_ok boolean) returns void language plpgsql as $$
begin raise notice 'TEST %: %', p_name, case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end; end $$;

-- Runs p_sql as p_role / p_uid; returns 'ok:<first column>' or the SQLSTATE.
create or replace function pg_temp.run_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql into v; reset role; return 'ok:' || coalesce(v, 'null');
  exception when others then reset role; return sqlstate; end;
end $$;

create or replace function pg_temp.state(p_id uuid) returns text language sql as $$ select state from public.transportation_requests where id = p_id $$;

do $$
begin
  perform pg_temp.report('PRE (schema is EXPAND-only: legacy overloads present, contract constraint absent)',
    to_regprocedure('public.decline_transportation_request(uuid,uuid,text)') is not null
    and to_regprocedure('public.cancel_transportation_request(uuid,uuid)') is not null
    and to_regprocedure('public.decline_transportation_request(uuid,uuid,text,text)') is not null
    and to_regprocedure('public.cancel_transportation_request(uuid,uuid,text,text)') is not null
    and to_regprocedure('public.accept_transportation_request(uuid,uuid)') is not null
    and not exists (select 1 from pg_constraint where conname = 'request_events_decision_reason_required'));
end $$;

-- Fixtures (Org A seed; passenger 40..a1 is an active seeded Passenger).
insert into public.transportation_requests (id, organization_id, passenger_id, requester_name, requester_relationship, requester_phone,
  pickup_description, destination_description, return_trip_needed, source, state) values
  ('b7200000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', null, 'R1R Legacy Decline Positional', 'self', '555-0801', 'R1R p', 'R1R d', 'no', 'web', 'pending'),
  ('b7200000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', null, 'R1R Legacy Decline Named', 'self', '555-0802', 'R1R p', 'R1R d', 'no', 'web', 'pending'),
  ('b7200000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000a1', null, 'R1R Legacy Decline No Reason', 'self', '555-0803', 'R1R p', 'R1R d', 'no', 'web', 'pending'),
  ('b7200000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-0000000000a1', null, 'R1R Legacy Cancel Pending', 'self', '555-0804', 'R1R p', 'R1R d', 'no', 'web', 'pending'),
  ('b7200000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-0000000000a1', null, 'R1R Accepted No Trip', 'self', '555-0805', 'R1R p', 'R1R d', 'no', 'web', 'accepted'),
  ('b7200000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'R1R Legacy Create Trip', 'self', '555-0806', 'R1R p', 'R1R d', 'no', 'web', 'pending'),
  ('b7200000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-0000000000a1', null, 'R1R New Decline', 'self', '555-0807', 'R1R p', 'R1R d', 'no', 'web', 'pending'),
  ('b7200000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-0000000000a1', null, 'R1R New Accept Cancel', 'self', '555-0808', 'R1R p', 'R1R d', 'no', 'web', 'pending'),
  ('b7200000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-0000000000a1', null, 'R1R Driver Probe', 'self', '555-0809', 'R1R p', 'R1R d', 'no', 'web', 'pending');

-- ---------------------------------------------------------------------------
-- OLD APP: legacy decline (as PostgREST calls it, and positionally)
-- ---------------------------------------------------------------------------
do $$
declare A constant uuid := '20000000-0000-0000-0000-0000000000a2'; r text;
begin
  r := pg_temp.run_as('authenticated', A, $q$select current_state from public.decline_transportation_request('10000000-0000-0000-0000-0000000000a1', 'b7200000-0000-0000-0000-000000000001', 'Fictional free-text reason')$q$);
  perform pg_temp.report('B-1 legacy decline, 3 positional args: resolves to the legacy overload (no ambiguity), pending -> declined', r = 'ok:declined');
  perform pg_temp.report('B-1b legacy decline keeps legacy shape: metadata.reason, no reason_code',
    (select metadata->>'reason' = 'Fictional free-text reason' and reason_code is null from public.request_events where request_id = 'b7200000-0000-0000-0000-000000000001' and event_type = 'request_declined'));

  r := pg_temp.run_as('authenticated', A, $q$select current_state from public.decline_transportation_request(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_request_id => 'b7200000-0000-0000-0000-000000000002', p_reason => 'Named reason')$q$);
  perform pg_temp.report('B-2 legacy decline, PostgREST-style named args (p_reason)', r = 'ok:declined');

  r := pg_temp.run_as('authenticated', A, $q$select current_state from public.decline_transportation_request(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_request_id => 'b7200000-0000-0000-0000-000000000003')$q$);
  perform pg_temp.report('B-3 legacy decline with the optional reason omitted (old app sends no p_reason when blank)',
    r = 'ok:declined' and (select reason_code is null from public.request_events where request_id = 'b7200000-0000-0000-0000-000000000003' and event_type = 'request_declined'));
end $$;

-- ---------------------------------------------------------------------------
-- OLD APP: legacy cancel -- pending -> cancelled only (never touches accepted / Trips)
-- ---------------------------------------------------------------------------
do $$
declare A constant uuid := '20000000-0000-0000-0000-0000000000a1'; r text;
begin
  r := pg_temp.run_as('authenticated', A, $q$select current_state from public.cancel_transportation_request(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_request_id => 'b7200000-0000-0000-0000-000000000004')$q$);
  perform pg_temp.report('B-4 legacy cancel (named, 2 args): pending -> cancelled exactly as before R1', r = 'ok:cancelled');
  r := pg_temp.run_as('authenticated', A, $q$select current_state from public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', 'b7200000-0000-0000-0000-000000000005')$q$);
  perform pg_temp.report('B-5 legacy cancel can NOT touch an accepted Request (new-model state) -> illegal_transition', r = 'ZW004');
  perform pg_temp.report('B-5b accepted Request untouched', pg_temp.state('b7200000-0000-0000-0000-000000000005') = 'accepted');
end $$;

-- ---------------------------------------------------------------------------
-- OLD APP: create_trip from a pending, passenger-resolved Request still works (implicit acceptance)
-- ---------------------------------------------------------------------------
do $$
declare r text;
begin
  r := pg_temp.run_as('authenticated', '20000000-0000-0000-0000-0000000000a2', $q$select created::text from public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'R1R trip p', 'R1R trip d', null, null, null, null, null, null, 'b7200000-0000-0000-0000-000000000006')$q$);
  perform pg_temp.report('B-6 legacy create_trip from PENDING still succeeds and implicitly accepts (old app Create Trip)',
    r = 'ok:true' and pg_temp.state('b7200000-0000-0000-0000-000000000006') = 'accepted'
    and (select count(*) from public.trips where request_id = 'b7200000-0000-0000-0000-000000000006') = 1);
end $$;

-- ---------------------------------------------------------------------------
-- NEW APP on the same EXPAND schema
-- ---------------------------------------------------------------------------
do $$
declare A constant uuid := '20000000-0000-0000-0000-0000000000a2'; r text;
begin
  r := pg_temp.run_as('authenticated', A, $q$select current_state from public.decline_transportation_request(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_request_id => 'b7200000-0000-0000-0000-000000000007', p_reason_code => 'no_availability', p_reason_note => '')$q$);
  perform pg_temp.report('C-1 new decline (named, as the new app sends it; empty note -> NULL): structured reason stored',
    r = 'ok:declined' and (select reason_code = 'no_availability' and reason_note is null from public.request_events where request_id = 'b7200000-0000-0000-0000-000000000007' and event_type = 'request_declined'));
  r := pg_temp.run_as('authenticated', A, $q$select current_state from public.decline_transportation_request(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_request_id => 'b7200000-0000-0000-0000-000000000008', p_reason_code => 'other')$q$);
  perform pg_temp.report('C-2 new decline WITHOUT p_reason_note is not callable in EXPAND (no default by design) -> 42883, nothing changed',
    r = '42883' and pg_temp.state('b7200000-0000-0000-0000-000000000008') = 'pending');

  r := pg_temp.run_as('authenticated', A, $q$select current_state from public.accept_transportation_request('10000000-0000-0000-0000-0000000000a1', 'b7200000-0000-0000-0000-000000000008')$q$);
  perform pg_temp.report('C-3 accept works in EXPAND', r = 'ok:accepted');
  r := pg_temp.run_as('authenticated', A, $q$select current_state from public.cancel_transportation_request(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_request_id => 'b7200000-0000-0000-0000-000000000008', p_reason_code => 'requester_cancelled', p_reason_note => '')$q$);
  perform pg_temp.report('C-4 new cancel (named 4 args): accepted -> cancelled with reason', r = 'ok:cancelled'
    and (select reason_code = 'requester_cancelled' from public.request_events where request_id = 'b7200000-0000-0000-0000-000000000008' and event_type = 'request_cancelled'));
  r := pg_temp.run_as('authenticated', A, $q$select current_state from public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', 'b7200000-0000-0000-0000-000000000009', 'requester_cancelled')$q$);
  perform pg_temp.report('C-5 new cancel on PENDING -> illegal_transition (3 positional args resolve to the new overload)', r = 'ZW004');
  r := pg_temp.run_as('authenticated', A, $q$select changed::text from public.link_request_passenger('10000000-0000-0000-0000-0000000000a1', 'b7200000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-0000000000a1')$q$);
  perform pg_temp.report('C-6 link Passenger on accepted-without-Trip allowed (widened), state unchanged', r = 'ok:true' and pg_temp.state('b7200000-0000-0000-0000-000000000005') = 'accepted');
  r := pg_temp.run_as('authenticated', A, $q$select created::text from public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'R1R trip p', 'R1R trip d', null, null, null, null, null, null, 'b7200000-0000-0000-0000-000000000005')$q$);
  perform pg_temp.report('C-7 create_trip from ACCEPTED + ready (new app path)', r = 'ok:true' and pg_temp.state('b7200000-0000-0000-0000-000000000005') = 'accepted');
end $$;

-- ---------------------------------------------------------------------------
-- Legacy overload surface stays narrow
-- ---------------------------------------------------------------------------
do $$
declare r1 text; r2 text; r3 text; r4 text;
begin
  perform pg_temp.report('ACL-1 legacy overloads: authenticated EXECUTE only (no anon / service_role / PUBLIC)',
    has_function_privilege('authenticated', 'public.decline_transportation_request(uuid,uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.cancel_transportation_request(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.decline_transportation_request(uuid,uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.cancel_transportation_request(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.decline_transportation_request(uuid,uuid,text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.cancel_transportation_request(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('public', 'public.decline_transportation_request(uuid,uuid,text)', 'EXECUTE')
    and not has_function_privilege('public', 'public.cancel_transportation_request(uuid,uuid)', 'EXECUTE'));
  r1 := pg_temp.run_as('authenticated', '20000000-0000-0000-0000-0000000000a3', $q$select current_state from public.decline_transportation_request('10000000-0000-0000-0000-0000000000a1', 'b7200000-0000-0000-0000-000000000009', 'x')$q$);
  r2 := pg_temp.run_as('authenticated', '20000000-0000-0000-0000-0000000000a3', $q$select current_state from public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', 'b7200000-0000-0000-0000-000000000009')$q$);
  r3 := pg_temp.run_as('authenticated', '20000000-0000-0000-0000-0000000000b1', $q$select current_state from public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', 'b7200000-0000-0000-0000-000000000009')$q$);
  r4 := pg_temp.run_as('authenticated', '20000000-0000-0000-0000-0000000000d1', $q$select current_state from public.decline_transportation_request('10000000-0000-0000-0000-0000000000a1', 'b7200000-0000-0000-0000-000000000009', 'x')$q$);
  perform pg_temp.report('ACL-2 legacy overloads keep role checks: Driver / foreign admin / Platform Admin -> not_found, Request untouched',
    r1 = 'ZW002' and r2 = 'ZW002' and r3 = 'ZW002' and r4 = 'ZW002' and pg_temp.state('b7200000-0000-0000-0000-000000000009') = 'pending');
  perform pg_temp.report('ACL-3 anon can not call either legacy overload',
    pg_temp.run_as('anon', null, $q$select current_state from public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', 'b7200000-0000-0000-0000-000000000009')$q$) = '42501');
end $$;

do $$ begin raise notice '=== request_decision_expand_compat_tests.sql complete — review PASS/FAIL lines above ==='; end $$;
