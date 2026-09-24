-- Nemryn -- Request acceptance + decision workflow tests (P1-OPS-R1).
--
-- Database-layer coverage of the P1-OPS-R1 test matrix: website intake still creates pending; explicit
-- accept (no Passenger / Trip side effects, provenance + acquisition untouched, idempotent); decline
-- (pending only, reason REQUIRED, terminal); cancel (accepted only, reason REQUIRED, blocked by any Trip,
-- terminal); Passenger linking never changes the decision; create_trip only from an ACCEPTED Request;
-- authorization (Admin / Dispatcher allowed; Driver, inactive Membership, suspended organization, foreign
-- tenant, Platform Admin without Membership, anon, service_role denied); RequestEvent / AuditEvent shape and
-- the reason constraints. Concurrency lives in request_decision_concurrency_test.sh.
--
-- Fixtures: seeded Org A / Org B users (supabase/seed.sql); dedicated integration 'r1-org-a' and rows under
-- the b7000000-... namespace. Run once against a fresh `supabase db reset`:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/request_decision_workflow_tests.sql

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.report(p_name text, p_ok boolean) returns void language plpgsql as $$
begin raise notice 'TEST %: %', p_name, case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end; end $$;

-- Runs p_sql as p_role / p_uid; returns 'ok' or the SQLSTATE.
create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql; reset role; return 'ok';
  exception when others then reset role; return sqlstate; end;
end $$;

-- Runs a transition RPC as p_uid; returns '<changed>:<current_state>' or 'ERR:<SQLSTATE>'.
create or replace function pg_temp.transition_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v public.request_transition_result;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  set local role authenticated;
  begin execute p_sql into v; reset role; return v.changed::text || ':' || v.current_state;
  exception when others then reset role; return 'ERR:' || sqlstate; end;
end $$;

create or replace function pg_temp.submit(p_key text) returns uuid language plpgsql as $$
declare v public.public_request_submission_result;
begin
  set local role service_role;
  select * into v from public.submit_public_transportation_request(
    p_integration_external_id => 'r1-org-a', p_idempotency_key => p_key, p_requester_name => 'R1 Website Requester',
    p_requester_relationship => 'family', p_requester_phone => '555-0701', p_pickup_description => 'R1 website pickup',
    p_destination_description => 'R1 website destination', p_return_trip_needed => 'no', p_requested_passenger_name => 'R1 Requested Name',
    p_acquisition => jsonb_build_object('utmSource', 'google', 'utmCampaign', 'r1', 'landingPath', '/rides'));
  reset role;
  return (select r.id from public.transportation_requests r join public.request_intake_integrations i on i.id = r.intake_integration_id
          where i.external_id = 'r1-org-a' and r.external_submission_ref = p_key);
end $$;

-- Everything on the Request row except the two columns a decision may change.
create or replace function pg_temp.provenance(p_id uuid) returns jsonb language sql as $$
  select to_jsonb(r) - 'state' - 'updated_at' - 'passenger_id' from public.transportation_requests r where r.id = p_id $$;
create or replace function pg_temp.acq(p_id uuid) returns jsonb language sql as $$
  select to_jsonb(a) from public.request_acquisition_attributions a where a.request_id = p_id $$;
create or replace function pg_temp.state(p_id uuid) returns text language sql as $$
  select state from public.transportation_requests where id = p_id $$;
create or replace function pg_temp.events(p_id uuid, p_type text) returns bigint language sql as $$
  select count(*) from public.request_events where request_id = p_id and event_type = p_type $$;
create or replace function pg_temp.audits(p_id uuid, p_action text) returns bigint language sql as $$
  select count(*) from public.audit_events where entity_type = 'transportation_request' and entity_id = p_id and action = p_action $$;

-- Users (seed.sql): a1 Org A admin, a2 Org A dispatcher, a3 Org A driver, a5 Org A INACTIVE dispatcher,
-- b1 Org B admin, d1 Platform Admin (no Membership).

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active)
  values ('b7000000-0000-0000-0000-00000000a001', '10000000-0000-0000-0000-0000000000a1', 'r1-org-a', 'website', true);
  insert into public.passengers (id, organization_id, display_name, phone, status) values
    ('b7000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000a1', 'R1 Fictional Passenger', '555-0702', 'active');
exception when others then
  raise notice 'FIXTURE FAIL % %', sqlstate, sqlerrm;
end $$;

create temp table r1 (k text primary key, id uuid);
grant all on r1 to authenticated, service_role;
insert into r1 select k, pg_temp.submit('R1-' || k) from unnest(array['w1','w2','w3','w4','w5','w6']) k;

-- ---------------------------------------------------------------------------
-- A / 17. Website intake creates PENDING (and every intake path hard-codes it)
-- ---------------------------------------------------------------------------
do $$
declare v_def text := pg_get_functiondef('public._create_public_request'::regproc);
begin
  perform pg_temp.report('A (website Request created -> pending, source web, no Passenger)',
    (select bool_and(r.state = 'pending' and r.source = 'web' and r.passenger_id is null and r.intake_integration_id is not null)
     from public.transportation_requests r join r1 on r1.id = r.id) and (select count(*) from r1 where id is not null) = 6);
  perform pg_temp.report('A2 (canonical public intake inserts pending, never accepted)',
    v_def like '%''web'', ''pending''%' and v_def not like '%''accepted''%');
end $$;

-- 18. Manual (Operations-logged) Requests also start pending
do $$
declare v public.request_creation_result;
begin
  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-0000000000a2', true);
  set local role authenticated;
  v := public.log_transportation_request('10000000-0000-0000-0000-0000000000a1', 'R1 Phone Requester', 'self', '555-0703',
         'R1 manual pickup', 'R1 manual destination', 'no', 'phone');
  reset role;
  insert into r1 values ('manual', v.request_id);
  perform pg_temp.report('A3 (manual log_transportation_request -> pending)', v.state = 'pending' and pg_temp.state(v.request_id) = 'pending');
end $$;

-- ---------------------------------------------------------------------------
-- Authorization (Q / R / S + inactive, suspended, platform admin, anon, service_role, unauthenticated)
-- ---------------------------------------------------------------------------
do $$
declare v_w5 uuid := (select id from r1 where k = 'w5'); v_sql text;
begin
  v_sql := format('select * from public.accept_transportation_request(%L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w5);
  perform pg_temp.report('Q (Driver accept -> not_found)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a3', v_sql) = 'ERR:ZW002');
  perform pg_temp.report('Q2 (Driver decline -> not_found)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a3',
    format('select * from public.decline_transportation_request(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w5, 'no_availability')) = 'ERR:ZW002');
  perform pg_temp.report('Q3 (Driver cancel -> not_found)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a3',
    format('select * from public.cancel_transportation_request(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w5, 'requester_cancelled')) = 'ERR:ZW002');
  perform pg_temp.report('R (Org B admin, Org A context -> not_found)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000b1', v_sql) = 'ERR:ZW002');
  perform pg_temp.report('R2 (Org B admin, own org context, Org A Request -> not_found)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000b1',
    format('select * from public.accept_transportation_request(%L, %L)', '10000000-0000-0000-0000-0000000000b1', v_w5)) = 'ERR:ZW002');
  perform pg_temp.report('AUTH-inactive (inactive dispatcher -> not_found)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a5', v_sql) = 'ERR:ZW002');
  perform pg_temp.report('AUTH-platform (Platform Admin without Membership -> not_found)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000d1', v_sql) = 'ERR:ZW002');
  perform pg_temp.report('AUTH-unauthenticated (no auth.uid -> unauthorized)', pg_temp.transition_as(null, v_sql) = 'ERR:ZW001');
  perform pg_temp.report('AUTH-anon (no EXECUTE)', pg_temp.try_as('anon', null, v_sql) = '42501');
  perform pg_temp.report('AUTH-service_role (no EXECUTE)', pg_temp.try_as('service_role', null, v_sql) = '42501');

  update public.organizations set status = 'inactive' where id = '10000000-0000-0000-0000-0000000000a1';
  perform pg_temp.report('AUTH-suspended (admin of suspended org -> not_found)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1', v_sql) = 'ERR:ZW002');
  update public.organizations set status = 'active' where id = '10000000-0000-0000-0000-0000000000a1';

  perform pg_temp.report('AUTH-nothing-changed (w5 still pending, no decision events/audits)',
    pg_temp.state(v_w5) = 'pending' and pg_temp.events(v_w5, 'request_accepted') + pg_temp.events(v_w5, 'request_declined') + pg_temp.events(v_w5, 'request_cancelled') = 0
    and pg_temp.audits(v_w5, 'request_accepted') = 0);
end $$;

-- ---------------------------------------------------------------------------
-- E/F/G/T/X. Accept (Dispatcher): pending -> accepted, no side effects, idempotent, provenance intact
-- ---------------------------------------------------------------------------
do $$
declare
  v_w1 uuid := (select id from r1 where k = 'w1');
  v_prov jsonb := pg_temp.provenance((select id from r1 where k = 'w1'));
  v_acq jsonb := pg_temp.acq((select id from r1 where k = 'w1'));
  v_pass bigint := (select count(*) from public.passengers);
  v_trips bigint := (select count(*) from public.trips);
  v_assign bigint := (select count(*) from public.trip_assignments);
  v_sql text; r1v text; r2v text;
  a record;
begin
  v_sql := format('select * from public.accept_transportation_request(%L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w1);
  r1v := pg_temp.transition_as('20000000-0000-0000-0000-0000000000a2', v_sql);
  perform pg_temp.report('E/S (Dispatcher accept: pending -> accepted, changed)', r1v = 'true:accepted' and pg_temp.state(v_w1) = 'accepted');
  perform pg_temp.report('F (accept creates no Passenger, links none)',
    (select count(*) from public.passengers) = v_pass and (select passenger_id from public.transportation_requests where id = v_w1) is null);
  perform pg_temp.report('G (accept creates no Trip / assignment)',
    (select count(*) from public.trips) = v_trips and (select count(*) from public.trip_assignments) = v_assign);
  perform pg_temp.report('X (provenance: intake_integration_id, source, requester, requested name, created_at unchanged)',
    pg_temp.provenance(v_w1) = v_prov and v_prov->>'intake_integration_id' = 'b7000000-0000-0000-0000-00000000a001');
  perform pg_temp.report('X2 (acquisition snapshot unchanged)', v_acq is not null and pg_temp.acq(v_w1) = v_acq);

  r2v := pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1', v_sql);
  perform pg_temp.report('T (second Accept is a no-op: changed=false, ONE event, ONE audit)',
    r2v = 'false:accepted' and pg_temp.events(v_w1, 'request_accepted') = 1 and pg_temp.audits(v_w1, 'request_accepted') = 1);

  select * into a from public.request_events where request_id = v_w1 and event_type = 'request_accepted';
  perform pg_temp.report('EVENT-accept (actor = dispatcher, no reason, empty metadata)',
    a.actor_user_id = '20000000-0000-0000-0000-0000000000a2' and a.reason_code is null and a.metadata = '{}'::jsonb);
  select * into a from public.audit_events where entity_id = v_w1 and action = 'request_accepted';
  perform pg_temp.report('AUDIT-accept (pending -> accepted, actor recorded, no PHI)',
    a.actor_user_id = '20000000-0000-0000-0000-0000000000a2' and a.before_data = '{"state":"pending"}' and a.after_data = '{"state":"accepted"}');
end $$;

-- ---------------------------------------------------------------------------
-- H/I/W/19. Accepted without Passenger -> link (allowed, state unchanged) -> Trip allowed only when ready
-- ---------------------------------------------------------------------------
do $$
declare v_w1 uuid := (select id from r1 where k = 'w1'); v text; v_trip public.trip_creation_result; v_ok boolean;
begin
  v := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format(
    'select public.create_trip(%L, %L, %L, %L, p_request_id => %L)', '10000000-0000-0000-0000-0000000000a1',
    'b7000000-0000-0000-0000-0000000000f1', 'R1 trip pickup', 'R1 trip destination', v_w1));
  perform pg_temp.report('H (accepted + no Passenger: create_trip rejected)', v = 'ZW006' and not exists (select 1 from public.trips where request_id = v_w1));

  v := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format(
    'select public.link_request_passenger(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w1, 'b7000000-0000-0000-0000-0000000000f1'));
  perform pg_temp.report('19a (link Passenger on ACCEPTED Request allowed; state stays accepted)', v = 'ok' and pg_temp.state(v_w1) = 'accepted');

  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-0000000000a2', true);
  set local role authenticated;
  begin
    v_trip := public.create_trip('10000000-0000-0000-0000-0000000000a1', 'b7000000-0000-0000-0000-0000000000f1',
      'R1 trip pickup', 'R1 trip destination', p_request_id => v_w1);
    v_ok := v_trip.created;
  exception when others then v_ok := false; raise notice 'W detail % %', sqlstate, sqlerrm;
  end;
  reset role;
  perform pg_temp.report('I/W (accepted + ready: create_trip allowed; Request stays accepted)',
    v_ok and pg_temp.state(v_w1) = 'accepted' and (select count(*) from public.trips where request_id = v_w1) = 1);

  v := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format(
    'select public.link_request_passenger(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w1, 'b7000000-0000-0000-0000-0000000000f1'));
  perform pg_temp.report('19b (Passenger frozen once a Trip exists: link -> illegal_transition)', v = 'ZW004');

  v := pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1', format(
    'select * from public.cancel_transportation_request(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w1, 'requester_cancelled'));
  perform pg_temp.report('N (accepted with a Trip: Request-level cancel blocked, no cascade)',
    v = 'ERR:ZW004' and pg_temp.state(v_w1) = 'accepted'
    and (select state from public.trips where request_id = v_w1) = 'scheduled' and pg_temp.events(v_w1, 'request_cancelled') = 0);
end $$;

-- ---------------------------------------------------------------------------
-- V/D/19. Pending: link does NOT accept; Trip creation from pending blocked
-- ---------------------------------------------------------------------------
do $$
declare v_w2 uuid := (select id from r1 where k = 'w2'); v text;
begin
  v := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format(
    'select public.link_request_passenger(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w2, 'b7000000-0000-0000-0000-0000000000f1'));
  perform pg_temp.report('19c (link Passenger on PENDING Request does not accept it)', v = 'ok' and pg_temp.state(v_w2) = 'pending'
    and pg_temp.events(v_w2, 'request_accepted') = 0);
  v := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format(
    'select public.create_trip(%L, %L, %L, %L, p_request_id => %L)', '10000000-0000-0000-0000-0000000000a1',
    'b7000000-0000-0000-0000-0000000000f1', 'R1 trip pickup', 'R1 trip destination', v_w2));
  perform pg_temp.report('V (pending + ready Passenger: create_trip BLOCKED, no Trip, still pending)',
    v = 'ZW006' and not exists (select 1 from public.trips where request_id = v_w2) and pg_temp.state(v_w2) = 'pending');
end $$;

-- ---------------------------------------------------------------------------
-- J/K/O. Decline: reason required; pending -> declined; terminal
-- ---------------------------------------------------------------------------
do $$
declare v_w2 uuid := (select id from r1 where k = 'w2'); v text; a record; f text;
begin
  f := 'select * from public.decline_transportation_request(%L, %L, %L, %L)';
  perform pg_temp.report('K (decline without reason code -> invalid_input)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a2',
    format(f, '10000000-0000-0000-0000-0000000000a1', v_w2, null, null)) = 'ERR:ZW006');
  perform pg_temp.report('K2 (decline with unknown / cancel-only code -> invalid_input)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a2',
    format(f, '10000000-0000-0000-0000-0000000000a1', v_w2, 'requester_cancelled', null)) = 'ERR:ZW006');
  perform pg_temp.report('K3 (decline "other" without explanation -> invalid_input)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a2',
    format(f, '10000000-0000-0000-0000-0000000000a1', v_w2, 'other', '   ')) = 'ERR:ZW006');
  perform pg_temp.report('K4 (decline note over 500 chars -> invalid_input)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a2',
    format(f, '10000000-0000-0000-0000-0000000000a1', v_w2, 'no_availability', repeat('x', 501))) = 'ERR:ZW006');
  perform pg_temp.report('K5 (rejected declines changed nothing)', pg_temp.state(v_w2) = 'pending' and pg_temp.events(v_w2, 'request_declined') = 0);

  v := pg_temp.transition_as('20000000-0000-0000-0000-0000000000a2', format(f, '10000000-0000-0000-0000-0000000000a1', v_w2, 'outside_service_area', '  Beyond county line  '));
  perform pg_temp.report('J (pending -> declined with reason)', v = 'true:declined' and pg_temp.state(v_w2) = 'declined');
  select * into a from public.request_events where request_id = v_w2 and event_type = 'request_declined';
  perform pg_temp.report('J2 (reason stored structured on the RequestEvent, note trimmed)',
    a.reason_code = 'outside_service_area' and a.reason_note = 'Beyond county line' and a.actor_user_id = '20000000-0000-0000-0000-0000000000a2');
  select * into a from public.audit_events where entity_id = v_w2 and action = 'request_declined';
  perform pg_temp.report('J3 (AuditEvent carries code only, never the free-text note)',
    a.reason = 'outside_service_area' and a.after_data = '{"state":"declined","reason_code":"outside_service_area"}' and a.before_data = '{"state":"pending"}');

  v := pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1', format(f, '10000000-0000-0000-0000-0000000000a1', v_w2, 'no_availability', null));
  perform pg_temp.report('J4 (double decline: no-op, ONE event, ONE audit)',
    v = 'false:declined' and pg_temp.events(v_w2, 'request_declined') = 1 and pg_temp.audits(v_w2, 'request_declined') = 1);

  perform pg_temp.report('O (declined -> accept blocked)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1',
    format('select * from public.accept_transportation_request(%L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w2)) = 'ERR:ZW004');
  perform pg_temp.report('O2 (declined -> cancel blocked)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1',
    format('select * from public.cancel_transportation_request(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w2, 'requester_cancelled')) = 'ERR:ZW004');
  perform pg_temp.report('O3 (declined -> link Passenger blocked)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
    'select public.link_request_passenger(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w2, 'b7000000-0000-0000-0000-0000000000f1')) = 'ZW004');
  perform pg_temp.report('O4 (declined -> create_trip blocked)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
    'select public.create_trip(%L, %L, %L, %L, p_request_id => %L)', '10000000-0000-0000-0000-0000000000a1',
    'b7000000-0000-0000-0000-0000000000f1', 'R1 trip pickup', 'R1 trip destination', v_w2)) = 'ZW006');
end $$;

-- ---------------------------------------------------------------------------
-- L/M/P. Cancel: accepted only, reason required, terminal
-- ---------------------------------------------------------------------------
do $$
declare v_w3 uuid := (select id from r1 where k = 'w3'); v_w5 uuid := (select id from r1 where k = 'w5'); v text; a record; f text;
  v_prov jsonb := pg_temp.provenance((select id from r1 where k = 'w3'));
begin
  f := 'select * from public.cancel_transportation_request(%L, %L, %L, %L)';
  perform pg_temp.report('M (pending -> cancel BLOCKED; still pending)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1',
    format(f, '10000000-0000-0000-0000-0000000000a1', v_w5, 'requester_cancelled', null)) = 'ERR:ZW004' and pg_temp.state(v_w5) = 'pending');

  perform pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1', format('select * from public.accept_transportation_request(%L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w3));
  perform pg_temp.report('S2 (Org Admin accept allowed)', pg_temp.state(v_w3) = 'accepted');

  perform pg_temp.report('L-reason (cancel without reason -> invalid_input)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1',
    format(f, '10000000-0000-0000-0000-0000000000a1', v_w3, null, null)) = 'ERR:ZW006');
  perform pg_temp.report('L-reason2 (cancel with decline-only code -> invalid_input)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1',
    format(f, '10000000-0000-0000-0000-0000000000a1', v_w3, 'outside_service_area', null)) = 'ERR:ZW006');

  v := pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1', format(f, '10000000-0000-0000-0000-0000000000a1', v_w3, 'other', 'Requester found another provider'));
  perform pg_temp.report('L (accepted + no Trip -> cancelled with reason)', v = 'true:cancelled' and pg_temp.state(v_w3) = 'cancelled');
  select * into a from public.request_events where request_id = v_w3 and event_type = 'request_cancelled';
  perform pg_temp.report('L2 (cancel reason structured on the RequestEvent)', a.reason_code = 'other' and a.reason_note = 'Requester found another provider');
  select * into a from public.audit_events where entity_id = v_w3 and action = 'request_cancelled';
  perform pg_temp.report('L3 (cancel AuditEvent: accepted -> cancelled, code only)',
    a.before_data = '{"state":"accepted"}' and a.after_data = '{"state":"cancelled","reason_code":"other"}' and a.reason = 'other');
  v := pg_temp.transition_as('20000000-0000-0000-0000-0000000000a2', format(f, '10000000-0000-0000-0000-0000000000a1', v_w3, 'requester_cancelled', null));
  perform pg_temp.report('L4 (double cancel: no-op, ONE event)', v = 'false:cancelled' and pg_temp.events(v_w3, 'request_cancelled') = 1 and pg_temp.audits(v_w3, 'request_cancelled') = 1);
  perform pg_temp.report('X3 (provenance unchanged through accept + cancel)', pg_temp.provenance(v_w3) = v_prov);

  perform pg_temp.report('P (cancelled -> accept blocked)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1',
    format('select * from public.accept_transportation_request(%L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w3)) = 'ERR:ZW004');
  perform pg_temp.report('P2 (cancelled -> decline blocked)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a1',
    format('select * from public.decline_transportation_request(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w3, 'no_availability')) = 'ERR:ZW004');
  perform pg_temp.report('P3 (cancelled -> create_trip blocked)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
    'select public.create_trip(%L, %L, %L, %L, p_request_id => %L)', '10000000-0000-0000-0000-0000000000a1',
    'b7000000-0000-0000-0000-0000000000f1', 'R1 trip pickup', 'R1 trip destination', v_w3)) = 'ZW006');
end $$;

-- accepted -> decline is not a legal transition (Cancel is the only way to end an accepted Request)
do $$
declare v_w4 uuid := (select id from r1 where k = 'w4');
begin
  perform pg_temp.transition_as('20000000-0000-0000-0000-0000000000a2', format('select * from public.accept_transportation_request(%L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w4));
  perform pg_temp.report('DECLINE-accepted (accepted -> decline blocked)', pg_temp.transition_as('20000000-0000-0000-0000-0000000000a2',
    format('select * from public.decline_transportation_request(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', v_w4, 'no_availability')) = 'ERR:ZW004'
    and pg_temp.state(v_w4) = 'accepted');
end $$;

-- ---------------------------------------------------------------------------
-- Reason constraints hold even for a direct (owner) write
-- ---------------------------------------------------------------------------
do $$
declare v_w6 uuid := (select id from r1 where k = 'w6'); s1 text; s2 text; s3 text;
begin
  begin insert into public.request_events (organization_id, request_id, event_type) values ('10000000-0000-0000-0000-0000000000a1', v_w6, 'request_declined'); s1 := 'ok';
  exception when others then s1 := sqlstate; end;
  begin insert into public.request_events (organization_id, request_id, event_type, reason_code) values ('10000000-0000-0000-0000-0000000000a1', v_w6, 'request_logged', 'other'); s2 := 'ok';
  exception when others then s2 := sqlstate; end;
  begin insert into public.request_events (organization_id, request_id, event_type, reason_code) values ('10000000-0000-0000-0000-0000000000a1', v_w6, 'request_cancelled', 'other'); s3 := 'ok';
  exception when others then s3 := sqlstate; end;
  perform pg_temp.report('CONSTRAINT (new decline event requires reason_code; reason only on decline/cancel; other requires note)',
    s1 = '23514' and s2 = '23514' and s3 = '23514');
  perform pg_temp.report('CONSTRAINT-legacy (historical reason-less rows are exempt: constraint NOT VALID)',
    (select not convalidated from pg_constraint where conname = 'request_events_decision_reason_required'));
end $$;

-- ---------------------------------------------------------------------------
-- 23. No external notification is produced by a decision
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.report('23 (decisions enqueue no notification events)',
    not exists (select 1 from public.notification_events e join r1 on r1.id = e.entity_id where e.event_type <> 'website_request'));
end $$;

do $$ begin raise notice '=== request_decision_workflow_tests.sql complete — review PASS/FAIL lines above ==='; end $$;
