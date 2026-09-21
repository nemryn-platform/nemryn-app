-- Nemryn -- privilege baseline BEHAVIOUR tests (P1-SEC-01).
--
-- Complements privilege_contract_tests.sql (which asserts the ACL catalog) by exercising the
-- baseline through real roles: anon, authenticated, service_role, and Platform Admin. Every
-- denial is asserted at the SQL PRIVILEGE layer (42501) -- i.e. it does not depend on RLS --
-- and the intended positive paths are asserted to still work.
--
-- Fixtures: 99710000-... users, 99720000-... organizations (grep-verified unused); removed at
-- the end. The default-privilege probe runs inside a transaction that is rolled back.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/privilege_baseline_behavior_tests.sql

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.report(p_name text, p_ok boolean) returns void language plpgsql as $$
begin raise notice 'TEST %: %', p_name, case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end; end $$;

-- Run p_sql as p_role with auth.uid() = p_uid; 'ok' or the SQLSTATE.
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

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', ('99710000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated',
       'pb-' || n || '@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', ''
from generate_series(1, 6) n;

insert into public.organizations (id, name, timezone) values
  ('99720000-0000-0000-0000-00000000000a', 'PB Org A', 'America/New_York'),
  ('99720000-0000-0000-0000-00000000000b', 'PB Org B', 'America/New_York');
-- u1 admin A | u2 dispatcher A | u3 driver A | u4 platform admin (no membership) | u5 admin B | u6 spare
insert into public.memberships (organization_id, user_id, role) values
  ('99720000-0000-0000-0000-00000000000a', '99710000-0000-0000-0000-000000000001', 'organization_admin'),
  ('99720000-0000-0000-0000-00000000000a', '99710000-0000-0000-0000-000000000002', 'dispatcher'),
  ('99720000-0000-0000-0000-00000000000a', '99710000-0000-0000-0000-000000000003', 'driver'),
  ('99720000-0000-0000-0000-00000000000b', '99710000-0000-0000-0000-000000000005', 'organization_admin');
insert into public.platform_admin_grants (user_id, note) values ('99710000-0000-0000-0000-000000000004', 'P1-SEC-01 test');
insert into public.drivers (id, organization_id, user_id, display_name, status) values
  ('99730000-0000-0000-0000-00000000000a', '99720000-0000-0000-0000-00000000000a', '99710000-0000-0000-0000-000000000003', 'PB Driver A', 'active');

-- ---------------------------------------------------------------------------
-- anon: no table privilege (checked at the privilege layer, so RLS is not the reason)
-- ---------------------------------------------------------------------------
do $$
declare t text; v_all boolean := true; v_res text; v_bad text := '';
begin
  for t in select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' loop
    v_res := pg_temp.try_as('anon', null, format('select 1 from public.%I limit 1', t));
    if v_res <> '42501' then v_all := false; v_bad := v_bad || ' ' || t || ':' || v_res; end if;
  end loop;
  perform pg_temp.report('ANON-1 (anon SELECT on EVERY public table is a privilege error 42501)' || v_bad, v_all);

  perform pg_temp.report('ANON-2 (anon INSERT into drivers / trips / organizations: 42501)',
    pg_temp.try_as('anon', null, $q$insert into public.drivers (organization_id, display_name) values (gen_random_uuid(), 'x')$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$insert into public.trips (organization_id) values (gen_random_uuid())$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$insert into public.organizations (name, timezone) values ('x', 'UTC')$q$) = '42501');
  perform pg_temp.report('ANON-3 (anon UPDATE / DELETE on drivers and memberships: 42501)',
    pg_temp.try_as('anon', null, $q$update public.drivers set status = 'inactive'$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$delete from public.drivers$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$update public.memberships set role = 'organization_admin'$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$delete from public.memberships$q$) = '42501');
  perform pg_temp.report('ANON-4 (anon TRUNCATE denied)', pg_temp.try_as('anon', null, $q$truncate public.audit_events$q$) = '42501');
  perform pg_temp.report('ANON-5 (anon cannot EXECUTE product RPCs: assign_trip, link_self_as_driver, create_trip, is_platform_admin, platform_get_overview, submit_public_transportation_request)',
    pg_temp.try_as('anon', null, $q$select public.assign_trip(gen_random_uuid(), gen_random_uuid(), null)$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$select public.link_self_as_driver(gen_random_uuid(), 'x', null)$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$select public.is_platform_admin()$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$select public.platform_get_overview()$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$select public.has_org_role(gen_random_uuid(), array['organization_admin'])$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$select public.signup_create_organization('x', 'y', null, 'UTC')$q$) = '42501');
  perform pg_temp.report('ANON-6 (anon CAN still execute the two pre-sign-in invite previews; they run and answer not_found (ZW002) for an unknown token, not a privilege error)',
    pg_temp.try_as('anon', null, $q$select * from public.get_driver_invite_preview(gen_random_uuid())$q$) in ('ok', 'ZW002')
    and pg_temp.try_as('anon', null, $q$select * from public.get_staff_invite_preview('nonexistent-token')$q$) in ('ok', 'ZW002'));
  perform pg_temp.report('ANON-7 (anon cannot touch the rate-limit sequence)', pg_temp.try_as('anon', null, $q$select nextval('public.public_intake_rate_limit_events_id_seq')$q$) = '42501');
end $$;

-- ---------------------------------------------------------------------------
-- authenticated: least privilege
-- ---------------------------------------------------------------------------
do $$
declare
  admin_a constant uuid := '99710000-0000-0000-0000-000000000001';
  admin_b constant uuid := '99710000-0000-0000-0000-000000000005';
  d_a constant uuid := '99730000-0000-0000-0000-00000000000a';
  o_a constant uuid := '99720000-0000-0000-0000-00000000000a';
  t text; v_all boolean := true; v_res text;
begin
  for t in select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' loop
    v_res := pg_temp.try_as('authenticated', admin_a, format('delete from public.%I', t));
    if v_res <> '42501' then v_all := false; raise notice 'DEBUG delete % -> %', t, v_res; end if;
  end loop;
  perform pg_temp.report('AUTH-1 (authenticated DELETE is a privilege error 42501 on EVERY public table)', v_all);
  perform pg_temp.report('AUTH-2 (authenticated TRUNCATE denied)', pg_temp.try_as('authenticated', admin_a, $q$truncate public.trips$q$) = '42501');
  perform pg_temp.report('AUTH-3 (audit_events / platform_admin_grants have NO direct client read: 42501; Activity still works via RPC)',
    pg_temp.try_as('authenticated', admin_a, $q$select 1 from public.audit_events limit 1$q$) = '42501'
    and pg_temp.try_as('authenticated', '99710000-0000-0000-0000-000000000004', $q$select 1 from public.platform_admin_grants limit 1$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, format($q$select * from public.list_activity_events(%L)$q$, o_a)) = 'ok'
    and pg_temp.val_as('authenticated', '99710000-0000-0000-0000-000000000004', 'select public.is_platform_admin()::text') = 'true');
  perform pg_temp.report('AUTH-4 (server-only tables are unreadable by clients: staff_invites, notification_events, request_intake_integrations, public_intake_rate_limit_events, organization_service_offerings, organization_notification_settings)',
    pg_temp.try_as('authenticated', admin_a, $q$select 1 from public.staff_invites limit 1$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, $q$select 1 from public.notification_events limit 1$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, $q$select 1 from public.request_intake_integrations limit 1$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, $q$select 1 from public.public_intake_rate_limit_events limit 1$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, $q$select 1 from public.organization_service_offerings limit 1$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, $q$select 1 from public.organization_notification_settings limit 1$q$) = '42501');
  perform pg_temp.report('AUTH-5 (direct writes on tables whose only writers are RPCs: 42501 -- trips INSERT, trip_assignments INSERT, memberships INSERT/UPDATE, drivers INSERT, driver_invites INSERT, trip_events INSERT)',
    pg_temp.try_as('authenticated', admin_a, format($q$insert into public.trips (organization_id) values (%L)$q$, o_a)) = '42501'
    and pg_temp.try_as('authenticated', admin_a, format($q$insert into public.trip_assignments (organization_id, trip_id, driver_id) values (%L, gen_random_uuid(), %L)$q$, o_a, d_a)) = '42501'
    and pg_temp.try_as('authenticated', admin_a, format($q$insert into public.memberships (organization_id, user_id, role) values (%L, %L, 'organization_admin')$q$, o_a, '99710000-0000-0000-0000-000000000006')) = '42501'
    and pg_temp.try_as('authenticated', admin_a, $q$update public.memberships set role = 'organization_admin'$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, format($q$insert into public.drivers (organization_id, user_id, display_name) values (%L, %L, 'x')$q$, o_a, '99710000-0000-0000-0000-000000000006')) = '42501'
    and pg_temp.try_as('authenticated', admin_a, format($q$insert into public.driver_invites (organization_id, email, display_name) values (%L, 'a@b.test', 'x')$q$, o_a)) = '42501'
    and pg_temp.try_as('authenticated', admin_a, format($q$insert into public.trip_events (organization_id, trip_id) values (%L, gen_random_uuid())$q$, o_a)) = '42501');
  perform pg_temp.report('AUTH-6 (Driver identity: direct INSERT of a Driver with arbitrary user_id and direct UPDATE of drivers.user_id both 42501)',
    pg_temp.try_as('authenticated', admin_a, format($q$insert into public.drivers (organization_id, user_id, display_name) values (%L, %L, 'Forged')$q$, o_a, '99710000-0000-0000-0000-000000000002')) = '42501'
    and pg_temp.try_as('authenticated', admin_a, format($q$update public.drivers set user_id = %L where id = %L$q$, '99710000-0000-0000-0000-000000000002', d_a)) = '42501');
  -- positive paths preserved
  perform pg_temp.report('AUTH-7 (legit direct paths still work: Admin edits a Driver name; Admin inserts a Facility/Vehicle/Passenger in own org; profile upsert)',
    pg_temp.val_as('authenticated', admin_a, format($q$with u as (update public.drivers set display_name = 'PB Driver A2' where id = %L returning 1) select count(*)::text from u$q$, d_a)) = '1'
    and pg_temp.try_as('authenticated', admin_a, format($q$insert into public.facilities (organization_id, name) values (%L, 'PB Facility')$q$, o_a)) = 'ok'
    and pg_temp.try_as('authenticated', admin_a, format($q$insert into public.passengers (organization_id, display_name) values (%L, 'PB Passenger')$q$, o_a)) = 'ok'
    and pg_temp.try_as('authenticated', admin_a, format($q$insert into public.user_profiles (id, display_name) values (%L, 'PB Admin') on conflict (id) do update set display_name = excluded.display_name$q$, admin_a)) = 'ok');
  perform pg_temp.report('AUTH-8 (legit reads still work: Admin sees own org drivers/facilities via RLS; RPC API callable: has_org_role, current_driver_id)',
    pg_temp.val_as('authenticated', admin_a, 'select count(*)::text from public.drivers') = '1'
    and pg_temp.val_as('authenticated', admin_a, format($q$select public.has_org_role(%L, array['organization_admin'])::text$q$, o_a)) = 'true');
  perform pg_temp.report('AUTH-9 (cross-tenant still blocked: Org B admin sees 0 Org A drivers/facilities and cannot edit them)',
    pg_temp.val_as('authenticated', admin_b, format('select count(*)::text from public.drivers where organization_id = %L', o_a)) = '0'
    and pg_temp.val_as('authenticated', admin_b, format($q$with u as (update public.drivers set display_name = 'Hijack' where id = %L returning 1) select count(*)::text from u$q$, d_a)) = '0'
    and pg_temp.val_as('authenticated', admin_b, format('select count(*)::text from public.facilities where organization_id = %L', o_a)) = '0');
  perform pg_temp.report('AUTH-10 (internal helpers are NOT callable by clients: _driver_execute_trip_transition, _lock_org_admins, _enqueue_notification_event, _require_platform_admin, signup_create_organization)',
    pg_temp.try_as('authenticated', admin_a, $q$select public._lock_org_admins(gen_random_uuid())$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, $q$select public._require_platform_admin()$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, $q$select public.signup_create_organization('x', 'y', null, 'UTC')$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, $q$select public._enqueue_notification_event(gen_random_uuid(), 'x', 'y', null)$q$) = '42501');
  perform pg_temp.report('AUTH-11 (server-only RPCs are NOT callable by authenticated: submit_public_transportation_request, check_and_record_public_intake_rate_limit, claim_notification_dispatch)',
    pg_temp.try_as('authenticated', admin_a, $q$select public.claim_notification_dispatch(gen_random_uuid())$q$) = '42501'
    and pg_temp.try_as('authenticated', admin_a, $q$select public.check_and_record_public_intake_rate_limit('a', 'b')$q$) = '42501');
end $$;

-- ---------------------------------------------------------------------------
-- Platform Admin without a Membership: control plane only, no tenant content bypass
-- ---------------------------------------------------------------------------
do $$
declare pa constant uuid := '99710000-0000-0000-0000-000000000004'; o_a constant uuid := '99720000-0000-0000-0000-00000000000a';
begin
  perform pg_temp.report('PLAT-1 (Platform Admin sees ZERO tenant rows in drivers / trips / passengers / facilities / memberships)',
    pg_temp.val_as('authenticated', pa, 'select (select count(*) from public.drivers)::text || (select count(*) from public.trips) || (select count(*) from public.passengers) || (select count(*) from public.facilities) || (select count(*) from public.memberships)') = '00000');
  perform pg_temp.report('PLAT-2 (Platform Admin control plane still works via RPC: platform_get_overview, platform_list_organizations)',
    pg_temp.try_as('authenticated', pa, $q$select * from public.platform_get_overview()$q$) = 'ok'
    and pg_temp.try_as('authenticated', pa, $q$select * from public.platform_list_organizations(null, null, 10, 0)$q$) = 'ok');
  perform pg_temp.report('PLAT-3 (Platform Admin has no tenant authority: link_self_as_driver / list_activity_events -> ZW002; no direct client write)',
    pg_temp.try_as('authenticated', pa, format($q$select public.link_self_as_driver(%L, 'x', null)$q$, o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', pa, format($q$select * from public.list_activity_events(%L)$q$, o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', pa, format($q$insert into public.drivers (organization_id, user_id, display_name) values (%L, %L, 'x')$q$, o_a, pa)) = '42501');
  perform pg_temp.report('PLAT-4 (a tenant Admin is not a Platform Admin: platform_get_overview -> ZW002)',
    pg_temp.try_as('authenticated', '99710000-0000-0000-0000-000000000001', $q$select * from public.platform_get_overview()$q$) = 'ZW002');
end $$;

-- ---------------------------------------------------------------------------
-- service_role: server-only surface, nothing more
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.report('SVC-1 (service_role can read request_intake_integrations -- the website-intake CORS lookup)',
    pg_temp.try_as('service_role', null, $q$select allowed_origins from public.request_intake_integrations where is_active limit 1$q$) = 'ok');
  perform pg_temp.report('SVC-2 (service_role has NO other direct table access: trips, drivers, memberships, organizations, audit_events)',
    pg_temp.try_as('service_role', null, $q$select 1 from public.trips limit 1$q$) = '42501'
    and pg_temp.try_as('service_role', null, $q$select 1 from public.drivers limit 1$q$) = '42501'
    and pg_temp.try_as('service_role', null, $q$select 1 from public.memberships limit 1$q$) = '42501'
    and pg_temp.try_as('service_role', null, $q$select 1 from public.audit_events limit 1$q$) = '42501'
    and pg_temp.try_as('service_role', null, $q$delete from public.drivers$q$) = '42501'
    and pg_temp.try_as('service_role', null, $q$truncate public.trips$q$) = '42501');
  perform pg_temp.report('SVC-3 (service_role EXECUTE reaches the four server-only RPCs; they answer, not a privilege error)',
    pg_temp.try_as('service_role', null, $q$select public.check_and_record_public_intake_rate_limit('pb-test-key', 'pb-test-ip')$q$) <> '42501'
    and pg_temp.try_as('service_role', null, $q$select public.claim_notification_dispatch(gen_random_uuid())$q$) <> '42501'
    and pg_temp.try_as('service_role', null, $q$select public.complete_notification_dispatch(gen_random_uuid(), 0, 0, 'unknown')$q$) <> '42501'
    and pg_temp.try_as('service_role', null, $q$select public.submit_public_transportation_request('no-such-integration', 'https://example.test', 'k', 'x', 'y', 'z', 'a@b.test', null, null, null, null, null, null, null, null, null, null, null, null, null, null)$q$) <> '42501');
  perform pg_temp.report('SVC-4 (service_role is NOT a general RPC caller: assign_trip, link_self_as_driver, platform_get_overview, set_platform_organization_status -> 42501)',
    pg_temp.try_as('service_role', null, $q$select public.assign_trip(gen_random_uuid(), gen_random_uuid(), null)$q$) = '42501'
    and pg_temp.try_as('service_role', null, $q$select public.link_self_as_driver(gen_random_uuid(), 'x', null)$q$) = '42501'
    and pg_temp.try_as('service_role', null, $q$select public.platform_get_overview()$q$) = '42501'
    and pg_temp.try_as('service_role', null, $q$select public.set_platform_organization_status(gen_random_uuid(), 'inactive', 'x')$q$) = '42501');
end $$;

-- ---------------------------------------------------------------------------
-- Default privileges: a NEW object gets NO client privilege (probe rolled back)
-- ---------------------------------------------------------------------------
begin;
create table public.zz_privilege_probe (id int primary key);
create sequence public.zz_privilege_probe_seq;
create function public.zz_privilege_probe_fn() returns int language sql as $$ select 1 $$;
do $$
declare v_bad text := '';
begin
  if has_table_privilege('anon', 'public.zz_privilege_probe', 'select') or has_table_privilege('authenticated', 'public.zz_privilege_probe', 'select') or has_table_privilege('service_role', 'public.zz_privilege_probe', 'select')
     or has_table_privilege('anon', 'public.zz_privilege_probe', 'insert') or has_table_privilege('authenticated', 'public.zz_privilege_probe', 'insert') or has_table_privilege('authenticated', 'public.zz_privilege_probe', 'delete') then
    v_bad := v_bad || ' table';
  end if;
  if has_sequence_privilege('anon', 'public.zz_privilege_probe_seq', 'usage') or has_sequence_privilege('authenticated', 'public.zz_privilege_probe_seq', 'usage') or has_sequence_privilege('service_role', 'public.zz_privilege_probe_seq', 'usage') then
    v_bad := v_bad || ' sequence';
  end if;
  if has_function_privilege('anon', 'public.zz_privilege_probe_fn()', 'execute') or has_function_privilege('authenticated', 'public.zz_privilege_probe_fn()', 'execute') or has_function_privilege('service_role', 'public.zz_privilege_probe_fn()', 'execute') then
    v_bad := v_bad || ' function';
  end if;
  if exists (select 1 from aclexplode(coalesce((select proacl from pg_proc where proname = 'zz_privilege_probe_fn'), acldefault('f'::"char", 'postgres'::regrole))) x where x.grantee = 0) then
    v_bad := v_bad || ' function-PUBLIC';
  end if;
  perform pg_temp.report('DEF-1 (a NEW table, sequence and function created by postgres in public receive NO anon / authenticated / service_role / PUBLIC privilege)' || v_bad, v_bad = '');
end $$;
rollback;

-- P1-SEC-01R: the function default is a GLOBAL default of role postgres with ONE documented schema-scoped exception.
begin;
create schema zz_privilege_probe_schema;
create function zz_privilege_probe_schema.f() returns int language sql as $$ select 1 $$;
create function extensions.zz_privilege_probe_ext() returns int language sql as $$ select 1 $$;
create function public.zz_privilege_probe_grant() returns int language sql as $$ select 1 $$;
do $$
begin
  perform pg_temp.report('DEF-2 (a function postgres creates in a NEW unrelated schema is default-deny: no PUBLIC / anon / authenticated / service_role EXECUTE)',
    not has_function_privilege('anon', 'zz_privilege_probe_schema.f()', 'execute') and not has_function_privilege('authenticated', 'zz_privilege_probe_schema.f()', 'execute')
    and not has_function_privilege('service_role', 'zz_privilege_probe_schema.f()', 'execute'));
  perform pg_temp.report('DEF-3 (documented exception: a vendor-style function in schema extensions keeps PUBLIC EXECUTE, exactly as before the baseline)',
    has_function_privilege('authenticated', 'extensions.zz_privilege_probe_ext()', 'execute') and has_function_privilege('anon', 'extensions.zz_privilege_probe_ext()', 'execute'));
  -- deny-by-default must not hide a DELIBERATE grant: an explicit grant is honoured
  grant execute on function public.zz_privilege_probe_grant() to authenticated;
  perform pg_temp.report('DEF-4 (an explicit GRANT on a new public function works and reaches ONLY the named role)',
    has_function_privilege('authenticated', 'public.zz_privilege_probe_grant()', 'execute')
    and not has_function_privilege('anon', 'public.zz_privilege_probe_grant()', 'execute')
    and not has_function_privilege('service_role', 'public.zz_privilege_probe_grant()', 'execute'));
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Cleanup (always)
-- ---------------------------------------------------------------------------
do $$
declare v_orgs uuid[] := array['99720000-0000-0000-0000-00000000000a', '99720000-0000-0000-0000-00000000000b']::uuid[];
begin
  delete from public.audit_events where organization_id = any (v_orgs);
  delete from public.facilities where organization_id = any (v_orgs);
  delete from public.passengers where organization_id = any (v_orgs);
  delete from public.drivers where organization_id = any (v_orgs);
  delete from public.memberships where organization_id = any (v_orgs);
  delete from public.platform_admin_grants where user_id = '99710000-0000-0000-0000-000000000004';
  delete from public.organizations where id = any (v_orgs);
  delete from public.user_profiles where id::text like '99710000-%';
  delete from auth.users where id::text like '99710000-%';
  delete from public.public_intake_rate_limit_events where true;
  raise notice 'CLEANUP: orgs left %, users left %', (select count(*) from public.organizations where id = any (v_orgs)), (select count(*) from auth.users where id::text like '99710000-%');
end $$;
