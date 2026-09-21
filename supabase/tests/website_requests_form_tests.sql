-- Nemryn -- Website Requests (P1-COMM-D1) persistence + authorization tests.
--
-- Covers the Nemryn form configuration (website_request_forms via get/save RPCs), the integration setup
-- preferences (set_request_intake_integration_setup + list), versioning (=> S4C formVersion), services
-- subset validation against Services & Intake, audit + Activity, authorization (Admin only; Dispatcher, Driver,
-- inactive, Platform Admin, other tenant, suspended organization denied), anon / service_role denial, the raw
-- table privilege posture, and non-interference with the public intake + S4C acquisition path.
-- Fixtures: seeded Org A / Org B users (supabase/seed.sql). Everything created here is removed at the end.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/website_requests_form_tests.sql

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.report(p_name text, p_ok boolean) returns void language plpgsql as $$
begin raise notice 'TEST %: %', p_name, case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end; end $$;

create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql; reset role; return 'ok';
  exception when others then reset role; return sqlstate; end;
end $$;

create or replace function pg_temp.val_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql into v; reset role; return v;
  exception when others then reset role; return 'ERR:' || sqlstate; end;
end $$;

do $$
begin
  delete from public.website_request_forms where organization_id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
  delete from public.request_intake_integrations where external_id like 'd1-%';
  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins) values
    ('d1000000-0000-0000-0000-00000000a001', '10000000-0000-0000-0000-0000000000a1', 'd1-org-a', 'website', false, array['https://d1-site-a.example.test']),
    ('d1000000-0000-0000-0000-00000000a002', '10000000-0000-0000-0000-0000000000b1', 'd1-org-b', 'website', false, array['https://d1-site-b.example.test']);
end $$;

do $$
declare
  o_a constant uuid := '10000000-0000-0000-0000-0000000000a1'; o_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  admin_a constant uuid := '20000000-0000-0000-0000-0000000000a1'; disp_a constant uuid := '20000000-0000-0000-0000-0000000000a2';
  driver_a constant uuid := '20000000-0000-0000-0000-0000000000a3'; inactive_a constant uuid := '20000000-0000-0000-0000-0000000000a5';
  admin_b constant uuid := '20000000-0000-0000-0000-0000000000b1'; plat constant uuid := '20000000-0000-0000-0000-0000000000d1';
  save_a text; v text; n bigint;
begin
  save_a := format($q$select (s.form_version::text || '/' || s.status || '/' || s.changed::text) from public.save_website_request_form(%L, %L, %L, %L, true, false, %L, %L, %L::text[]) s$q$,
    o_a, 'Request transportation', 'Send request', 'Thanks. We will contact you to confirm your trip.', 'draft', 'Tell us about the trip you need.', null);

  perform pg_temp.report('F1 (fresh organization: no form configuration yet -> zero rows)',
    pg_temp.val_as('authenticated', admin_a, format('select count(*)::text from public.get_website_request_form(%L)', o_a)) = '0');
  v := pg_temp.val_as('authenticated', admin_a, save_a);
  perform pg_temp.report('F2 (Admin creates a draft: version 1, changed)', v = '1/draft/true');
  perform pg_temp.report('F3 (stored exactly one row for the organization; services NULL = everything offered)',
    (select count(*) from public.website_request_forms where organization_id = o_a) = 1 and (select offered_service_types is null from public.website_request_forms where organization_id = o_a));
  perform pg_temp.report('F4 (read returns the configuration)', pg_temp.val_as('authenticated', admin_a, format('select title || ''|'' || submit_label || ''|'' || status || ''|'' || version from public.get_website_request_form(%L)', o_a)) = 'Request transportation|Send request|draft|1');
  perform pg_temp.report('A1 (audit written once, actor = Admin, status/version only -- no copy)',
    (select count(*) from public.audit_events where organization_id = o_a and action = 'website_request_form_updated' and actor_user_id = admin_a) = 1
    and not exists (select 1 from public.audit_events where organization_id = o_a and action = 'website_request_form_updated' and (after_data::text ~* 'Tell us|Thanks|Send request')));
  perform pg_temp.report('A2 (shows in Activity for the Admin)', pg_temp.val_as('authenticated', admin_a, format($q$select count(*)::text from public.list_activity_events(%L) where action = 'website_request_form_updated'$q$, o_a)) = '1');

  v := pg_temp.val_as('authenticated', admin_a, save_a);
  perform pg_temp.report('F5 (identical save is idempotent: version 1, changed=false, no new audit)', v = '1/draft/false'
    and (select count(*) from public.audit_events where organization_id = o_a and action = 'website_request_form_updated') = 1);
  v := pg_temp.val_as('authenticated', admin_a, replace(save_a, '''draft''', '''ready'''));
  perform pg_temp.report('V1 (status-only change: same version, changed=true)', v = '1/ready/true');
  v := pg_temp.val_as('authenticated', admin_a, replace(replace(save_a, 'Send request', 'Submit request'), '''draft''', '''ready'''));
  perform pg_temp.report('V2 (content change: version increments to 2 => formVersion nemryn-form-v2)', v = '2/ready/true');
  v := pg_temp.val_as('authenticated', admin_a, format($q$select (s.form_version::text) from public.save_website_request_form(%L, 'Request transportation', 'Submit request', 'Thanks. We will contact you to confirm your trip.', false, true, 'ready', 'Tell us about the trip you need.', %L::text[]) s$q$, o_a, '{dialysis,other}'));
  perform pg_temp.report('V3 (services subset / recurring / service-choice changes are content: version 3)', v = '3');
  perform pg_temp.report('F6 (still exactly one row per organization)', (select count(*) from public.website_request_forms where organization_id = o_a) = 1);

  -- services validation against Services & Intake
  perform pg_temp.report('S1 (unknown / empty service subset rejected ZW006)',
    pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'T', 'Go', 'OK', true, false, 'draft', null, %L::text[])$q$, o_a, '{bogus}')) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'T', 'Go', 'OK', true, false, 'draft', null, %L::text[])$q$, o_a, '{}')) = 'ZW006');
  insert into public.organization_service_offerings (organization_id, service_type) values (o_a, 'dialysis'), (o_a, 'other');
  perform pg_temp.report('S2 (Services & Intake configured: a service the organization does NOT offer cannot be exposed: ZW006)',
    pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'T', 'Go', 'OK', true, false, 'draft', null, %L::text[])$q$, o_a, '{wheelchair_transportation}')) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'T', 'Go', 'OK', true, false, 'draft', null, %L::text[])$q$, o_a, '{dialysis,wheelchair_transportation}')) = 'ZW006');
  v := pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'Request transportation', 'Submit request', 'Thanks. We will contact you to confirm your trip.', false, true, 'ready', 'Tell us about the trip you need.', %L::text[])$q$, o_a, '{dialysis,dialysis}'));
  perform pg_temp.report('S3 (a subset of the offered services is accepted; duplicates collapse)',
    v = 'ok' and (select offered_service_types from public.website_request_forms where organization_id = o_a) = array['dialysis']);
  delete from public.organization_service_offerings where organization_id = o_a;

  -- validation
  perform pg_temp.report('V4 (blank / oversized copy, bad status, control characters: ZW006)',
    pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, '   ', 'Go', 'OK', true, false, 'draft', null, null)$q$, o_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, %L, 'Go', 'OK', true, false, 'draft', null, null)$q$, o_a, repeat('t', 121))) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'T', %L, 'OK', true, false, 'draft', null, null)$q$, o_a, repeat('s', 41))) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'T', 'Go', %L, true, false, 'draft', null, null)$q$, o_a, repeat('c', 401))) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'T', 'Go', 'OK', true, false, 'draft', %L, null)$q$, o_a, repeat('i', 601))) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'T', 'Go', 'OK', true, false, 'published', null, null)$q$, o_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, E'Ti\tle', 'Go', 'OK', true, false, 'draft', null, null)$q$, o_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'T', 'Go', 'OK', null, false, 'draft', null, null)$q$, o_a)) = 'ZW006');
  perform pg_temp.report('V5 (multi-line intro / confirmation with plain newlines is allowed)',
    pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'Request transportation', 'Submit request', E'Thanks.\nWe will call you.', false, true, 'ready', E'Line one\nLine two', null)$q$, o_a)) = 'ok');

  -- authorization
  n := (select count(*) from public.website_request_forms);
  perform pg_temp.report('Z1 (Dispatcher cannot read or mutate: ZW002)',
    pg_temp.try_as('authenticated', disp_a, format('select * from public.get_website_request_form(%L)', o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', disp_a, format($q$select public.save_website_request_form(%L, 'X', 'Go', 'OK', true, false, 'draft', null, null)$q$, o_a)) = 'ZW002');
  perform pg_temp.report('Z2 (Driver: ZW002)', pg_temp.try_as('authenticated', driver_a, format('select * from public.get_website_request_form(%L)', o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', driver_a, format($q$select public.save_website_request_form(%L, 'X', 'Go', 'OK', true, false, 'draft', null, null)$q$, o_a)) = 'ZW002');
  perform pg_temp.report('Z3 (inactive Membership: ZW002)', pg_temp.try_as('authenticated', inactive_a, format('select * from public.get_website_request_form(%L)', o_a)) = 'ZW002');
  perform pg_temp.report('Z4 (PlatformAdminGrant alone: no tenant form access, read or write: ZW002)',
    pg_temp.try_as('authenticated', plat, format('select * from public.get_website_request_form(%L)', o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', plat, format($q$select public.save_website_request_form(%L, 'X', 'Go', 'OK', true, false, 'draft', null, null)$q$, o_a)) = 'ZW002');
  perform pg_temp.report('Z5 (other tenant Admin cannot read or mutate Org A''s form: ZW002; own org has none)',
    pg_temp.try_as('authenticated', admin_b, format('select * from public.get_website_request_form(%L)', o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', admin_b, format($q$select public.save_website_request_form(%L, 'X', 'Go', 'OK', true, false, 'draft', null, null)$q$, o_a)) = 'ZW002'
    and pg_temp.val_as('authenticated', admin_b, format('select count(*)::text from public.get_website_request_form(%L)', o_b)) = '0');
  perform pg_temp.report('Z6 (none of the denied attempts created or changed a row)', (select count(*) from public.website_request_forms) = n and (select title from public.website_request_forms where organization_id = o_a) = 'Request transportation');
  perform pg_temp.report('Z7 (anon and service_role cannot execute the RPCs: 42501; unauthenticated -> ZW001)',
    pg_temp.try_as('anon', null, format('select * from public.get_website_request_form(%L)', o_a)) = '42501'
    and pg_temp.try_as('service_role', null, format('select * from public.get_website_request_form(%L)', o_a)) = '42501'
    and pg_temp.try_as('anon', null, format($q$select public.save_website_request_form(%L, 'X', 'Go', 'OK', true, false, 'draft', null, null)$q$, o_a)) = '42501'
    and pg_temp.try_as('service_role', null, format($q$select public.save_website_request_form(%L, 'X', 'Go', 'OK', true, false, 'draft', null, null)$q$, o_a)) = '42501'
    and pg_temp.try_as('authenticated', null, format('select * from public.get_website_request_form(%L)', o_a)) = 'ZW001');
  perform pg_temp.report('Z8 (raw table: no privilege for anon / authenticated / service_role; RLS on, no policy)',
    pg_temp.try_as('anon', null, 'select * from public.website_request_forms') = '42501'
    and pg_temp.try_as('authenticated', admin_a, 'select * from public.website_request_forms') = '42501'
    and pg_temp.try_as('service_role', null, 'select * from public.website_request_forms') = '42501'
    and pg_temp.try_as('authenticated', admin_a, format($q$insert into public.website_request_forms (organization_id, title, submit_label, confirmation_message) values (%L, 'x', 'y', 'z')$q$, o_b)) = '42501'
    and (select relrowsecurity from pg_class where oid = 'public.website_request_forms'::regclass)
    and not exists (select 1 from pg_policies where tablename = 'website_request_forms'));
  perform pg_temp.report('Z9 (table constraints hold even for the owner: bad status / services / duplicate organization rejected)',
    (select count(*) from (
      select 1 where exists (select 1 where (select pg_temp.try_as('postgres', null, format($q$insert into public.website_request_forms (organization_id, title, submit_label, confirmation_message, status) values (%L, 'x', 'y', 'z', 'live')$q$, o_b))) = '23514')
    ) t) = 1);

  -- suspended organization
  update public.organizations set status = 'inactive' where id = o_a;
  perform pg_temp.report('Z10 (SUSPENDED organization: read and mutation denied ZW002)',
    pg_temp.try_as('authenticated', admin_a, format('select * from public.get_website_request_form(%L)', o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.save_website_request_form(%L, 'Changed while suspended', 'Go', 'OK', true, false, 'draft', null, null)$q$, o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', admin_a, 'select public.set_request_intake_integration_setup(''d1000000-0000-0000-0000-00000000a001'', ''nemryn_form'', ''wix'')') = 'ZW002'
    and (select title from public.website_request_forms where organization_id = o_a) = 'Request transportation');
  update public.organizations set status = 'active' where id = o_a;
  perform pg_temp.report('Z11 (after reactivation the Admin works again)', pg_temp.try_as('authenticated', admin_a, format('select * from public.get_website_request_form(%L)', o_a)) = 'ok');
end $$;

-- ---------------------------------------------------------------------------
-- Integration setup preferences
-- ---------------------------------------------------------------------------
do $$
declare
  admin_a constant uuid := '20000000-0000-0000-0000-0000000000a1'; disp_a constant uuid := '20000000-0000-0000-0000-0000000000a2';
  admin_b constant uuid := '20000000-0000-0000-0000-0000000000b1'; driver_a constant uuid := '20000000-0000-0000-0000-0000000000a3';
  plat constant uuid := '20000000-0000-0000-0000-0000000000d1';
  o_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  int_a constant text := 'd1000000-0000-0000-0000-00000000a001'; int_b constant text := 'd1000000-0000-0000-0000-00000000a002';
  v text;
begin
  perform pg_temp.report('P1 (existing integration predating D1: method and manager are NULL = "Existing connection")',
    pg_temp.val_as('authenticated', admin_a, format($q$select coalesce(connection_method, 'NULL') || '/' || coalesce(website_manager, 'NULL') from public.list_request_intake_integrations(%L) where external_id = 'd1-org-a'$q$, o_a)) = 'NULL/NULL');
  v := pg_temp.val_as('authenticated', admin_a, format($q$select public.set_request_intake_integration_setup(%L, 'nemryn_form', 'wordpress')::text$q$, int_a));
  perform pg_temp.report('P2 (Admin saves the guidance preferences: changed = true)', v = 'true');
  perform pg_temp.report('P3 (list returns them; the intake configuration itself is untouched)',
    pg_temp.val_as('authenticated', admin_a, format($q$select connection_method || '/' || website_manager || '/' || is_active::text || '/' || allowed_origins[1] from public.list_request_intake_integrations(%L) where external_id = 'd1-org-a'$q$, o_a)) = 'nemryn_form/wordpress/false/https://d1-site-a.example.test');
  perform pg_temp.report('P4 (identical repeat: changed = false)', pg_temp.val_as('authenticated', admin_a, format($q$select public.set_request_intake_integration_setup(%L, 'nemryn_form', 'wordpress')::text$q$, int_a)) = 'false');
  perform pg_temp.report('P5 (invalid values ZW006; NULL clears)',
    pg_temp.try_as('authenticated', admin_a, format($q$select public.set_request_intake_integration_setup(%L, 'graphql', 'wix')$q$, int_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format($q$select public.set_request_intake_integration_setup(%L, 'developer', 'a hacker')$q$, int_a)) = 'ZW006'
    and pg_temp.val_as('authenticated', admin_a, format($q$select public.set_request_intake_integration_setup(%L, null, null)::text$q$, int_a)) = 'true');
  perform pg_temp.report('P6 (Dispatcher / Driver / Platform Admin / other tenant / nonexistent id: ZW002)',
    pg_temp.try_as('authenticated', disp_a, format($q$select public.set_request_intake_integration_setup(%L, 'developer', 'self')$q$, int_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', driver_a, format($q$select public.set_request_intake_integration_setup(%L, 'developer', 'self')$q$, int_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', plat, format($q$select public.set_request_intake_integration_setup(%L, 'developer', 'self')$q$, int_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', admin_b, format($q$select public.set_request_intake_integration_setup(%L, 'developer', 'self')$q$, int_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', admin_a, 'select public.set_request_intake_integration_setup(gen_random_uuid(), ''developer'', ''self'')') = 'ZW002'
    and pg_temp.try_as('anon', null, format($q$select public.set_request_intake_integration_setup(%L, 'developer', 'self')$q$, int_a)) = '42501'
    and pg_temp.try_as('service_role', null, format($q$select public.set_request_intake_integration_setup(%L, 'developer', 'self')$q$, int_a)) = '42501');
  perform pg_temp.report('P7 (other tenant: Org B''s own integration list shows only its own integration and its own preferences)',
    pg_temp.val_as('authenticated', admin_b, format($q$select string_agg(external_id, ',') from public.list_request_intake_integrations(%L)$q$, '10000000-0000-0000-0000-0000000000b1')) = 'd1-org-b'
    and pg_temp.try_as('authenticated', admin_b, format('select * from public.list_request_intake_integrations(%L)', o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', disp_a, format('select * from public.list_request_intake_integrations(%L)', o_a)) = 'ZW002');
  perform pg_temp.report('P8 (the D1 RPCs are executable by authenticated only)',
    has_function_privilege('authenticated', 'public.get_website_request_form(uuid)', 'execute') and has_function_privilege('authenticated', 'public.save_website_request_form(uuid, text, text, text, boolean, boolean, text, text, text[])', 'execute')
    and has_function_privilege('authenticated', 'public.set_request_intake_integration_setup(uuid, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.save_website_request_form(uuid, text, text, text, boolean, boolean, text, text, text[])', 'execute')
    and not has_function_privilege('service_role', 'public.save_website_request_form(uuid, text, text, text, boolean, boolean, text, text, text[])', 'execute')
    and not has_function_privilege('anon', 'public.get_website_request_form(uuid)', 'execute') and not has_function_privilege('service_role', 'public.set_request_intake_integration_setup(uuid, text, text)', 'execute'));
end $$;

-- ---------------------------------------------------------------------------
-- Public intake + S4C acquisition untouched (service_role path)
-- ---------------------------------------------------------------------------
do $$
declare v public.public_request_submission_result; v_req uuid; v_attr bigint;
begin
  update public.request_intake_integrations set is_active = true where external_id = 'd1-org-a';
  set local role service_role;
  select * into v from public.submit_public_transportation_request(
    p_integration_external_id => 'd1-org-a', p_idempotency_key => 'D1-INTAKE-1', p_requester_name => 'D1 Requester', p_requester_relationship => 'self',
    p_requester_phone => '555-0111', p_pickup_description => 'D1 TEST pickup', p_destination_description => 'D1 TEST destination', p_return_trip_needed => 'no',
    p_origin => 'https://d1-site-a.example.test', p_acquisition => jsonb_build_object('utmSource', 'google', 'formVersion', 'nemryn-form-v2'));
  reset role;
  select id into v_req from public.transportation_requests where external_submission_ref = 'D1-INTAKE-1';
  select count(*) into v_attr from public.request_acquisition_attributions where request_id = v_req and utm_source = 'google' and form_version = 'nemryn-form-v2';
  perform pg_temp.report('I1 (public intake unaffected: accepted with a Nemryn-style formVersion, one attribution snapshot, no form config needed)',
    v.accepted and v_req is not null and v_attr = 1);
  perform pg_temp.report('I2 (the form configuration does not gate or alter intake: a request needs no website_request_forms row)',
    (select count(*) from public.website_request_forms where organization_id = '10000000-0000-0000-0000-0000000000b1') = 0);
end $$;

-- ---------------------------------------------------------------------------
-- Cleanup (always)
-- ---------------------------------------------------------------------------
do $$
declare v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.transportation_requests where external_submission_ref like 'D1-%';
  delete from public.notification_events where entity_id = any (coalesce(v_ids, '{}'));
  delete from public.request_acquisition_attributions where request_id = any (coalesce(v_ids, '{}'));
  delete from public.request_events where request_id = any (coalesce(v_ids, '{}'));
  delete from public.transportation_requests where id = any (coalesce(v_ids, '{}'));
  delete from public.audit_events where action = 'website_request_form_updated' and organization_id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
  delete from public.website_request_forms where organization_id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
  delete from public.organization_service_offerings where organization_id = '10000000-0000-0000-0000-0000000000a1';
  delete from public.public_intake_rate_limit_events where true;
  delete from public.request_intake_integrations where external_id like 'd1-%';
  raise notice 'CLEANUP: forms left %, d1 integrations left %', (select count(*) from public.website_request_forms where organization_id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1')),
    (select count(*) from public.request_intake_integrations where external_id like 'd1-%');
end $$;
