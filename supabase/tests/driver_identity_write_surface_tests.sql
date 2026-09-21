-- Nemryn -- Driver identity write-surface tests (P1-PILOT-S5A1R).
--
-- Proves that no client role can directly establish or change drivers.user_id, that
-- the reviewed SECURITY DEFINER primitives still work, and that legitimate Driver
-- administration is preserved. Fixtures live under 99610000-... / 99620000-...
-- (grep-verified unused) and are removed at the end.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/driver_identity_write_surface_tests.sql

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.report(p_name text, p_ok boolean) returns void language plpgsql as $$
begin raise notice 'TEST %: %', p_name, case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end; end $$;

-- Run p_sql as p_role with auth.uid() = p_uid; 'ok' or SQLSTATE.
create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql; reset role; return 'ok';
  exception when others then reset role; return sqlstate; end;
end $$;

-- Scalar as authenticated; 'ERR:<sqlstate>' on error.
create or replace function pg_temp.val_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  set local role authenticated;
  begin execute p_sql into v; reset role; return v;
  exception when others then reset role; return 'ERR:' || sqlstate; end;
end $$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', ('99610000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated',
       'ws-' || n || '@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', ''
from generate_series(1, 9) n;

insert into public.organizations (id, name, timezone) values
  ('99620000-0000-0000-0000-00000000000a', 'WS Org A', 'America/New_York'),
  ('99620000-0000-0000-0000-00000000000b', 'WS Org B', 'America/New_York');

-- u01 admin A | u02 dispatcher A (also the "victim" of arbitrary-user_id attempts) | u03 driver-only A
-- u04 platform admin, NO membership | u05 admin B | u06 invitee | u07 owner-operator (admin A2, self-links) | u08 wrong-email person
insert into public.memberships (organization_id, user_id, role) values
  ('99620000-0000-0000-0000-00000000000a', '99610000-0000-0000-0000-000000000001', 'organization_admin'),
  ('99620000-0000-0000-0000-00000000000a', '99610000-0000-0000-0000-000000000002', 'dispatcher'),
  ('99620000-0000-0000-0000-00000000000a', '99610000-0000-0000-0000-000000000003', 'driver'),
  ('99620000-0000-0000-0000-00000000000b', '99610000-0000-0000-0000-000000000005', 'organization_admin'),
  ('99620000-0000-0000-0000-00000000000a', '99610000-0000-0000-0000-000000000007', 'organization_admin');
insert into public.platform_admin_grants (user_id, note) values ('99610000-0000-0000-0000-000000000004', 'S5A1R test');

insert into public.drivers (id, organization_id, user_id, display_name, phone, status) values
  ('99630000-0000-0000-0000-00000000000a', '99620000-0000-0000-0000-00000000000a', '99610000-0000-0000-0000-000000000003', 'Employee Driver A', '555-0001', 'active'),
  ('99630000-0000-0000-0000-00000000000b', '99620000-0000-0000-0000-00000000000b', null, 'Org B Driver', '555-0002', 'active');

-- ---------------------------------------------------------------------------
-- Privilege surface (catalog level)
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.report('P1 (authenticated has NO INSERT on drivers, table or column level)',
    not has_table_privilege('authenticated', 'public.drivers', 'insert')
    and not has_column_privilege('authenticated', 'public.drivers', 'user_id', 'insert')
    and not has_column_privilege('authenticated', 'public.drivers', 'display_name', 'insert'));
  perform pg_temp.report('P2 (authenticated has NO UPDATE on drivers.user_id / organization_id / id)',
    not has_column_privilege('authenticated', 'public.drivers', 'user_id', 'update')
    and not has_column_privilege('authenticated', 'public.drivers', 'organization_id', 'update')
    and not has_column_privilege('authenticated', 'public.drivers', 'id', 'update'));
  perform pg_temp.report('P3 (anon has no privileges on drivers)',
    not has_table_privilege('anon', 'public.drivers', 'select') and not has_table_privilege('anon', 'public.drivers', 'insert') and not has_table_privilege('anon', 'public.drivers', 'update'));
  perform pg_temp.report('P4 (no INSERT policy remains on drivers: default deny)', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'drivers' and cmd = 'INSERT') = 0);
  perform pg_temp.report('P5 (SELECT surface unchanged: authenticated SELECT; ops read policy present)',
    has_table_privilege('authenticated', 'public.drivers', 'select') and exists (select 1 from pg_policies where tablename = 'drivers' and policyname = 'drivers_select_org_operations'));
  perform pg_temp.report('P6 (legitimate admin UPDATE columns preserved: display_name, phone, status)',
    has_column_privilege('authenticated', 'public.drivers', 'display_name', 'update') and has_column_privilege('authenticated', 'public.drivers', 'phone', 'update') and has_column_privilege('authenticated', 'public.drivers', 'status', 'update'));
end $$;

-- ---------------------------------------------------------------------------
-- A-D. Direct INSERT denied for every client role, with arbitrary user_id
-- ---------------------------------------------------------------------------
do $$
declare
  o_a constant uuid := '99620000-0000-0000-0000-00000000000a';
  o_b constant uuid := '99620000-0000-0000-0000-00000000000b';
  victim constant uuid := '99610000-0000-0000-0000-000000000002';
  v_before bigint;
begin
  select count(*) into v_before from public.drivers;

  perform pg_temp.report('A1 (Organization Admin direct INSERT with ARBITRARY user_id: denied 42501)',
    pg_temp.try_as('authenticated', '99610000-0000-0000-0000-000000000001', format($q$insert into public.drivers (organization_id, user_id, display_name) values (%L, %L, 'Forged Link')$q$, o_a, victim)) = '42501');
  perform pg_temp.report('A2 (Organization Admin direct INSERT with own user_id: denied)',
    pg_temp.try_as('authenticated', '99610000-0000-0000-0000-000000000001', format($q$insert into public.drivers (organization_id, user_id, display_name) values (%L, %L, 'Self Insert')$q$, o_a, '99610000-0000-0000-0000-000000000001')) = '42501');
  perform pg_temp.report('A3 (Organization Admin direct INSERT with NO user_id: denied -- no client INSERT at all)',
    pg_temp.try_as('authenticated', '99610000-0000-0000-0000-000000000001', format($q$insert into public.drivers (organization_id, display_name) values (%L, 'Unlinked Direct')$q$, o_a)) = '42501');
  perform pg_temp.report('B1 (Dispatcher direct INSERT with arbitrary user_id: denied)',
    pg_temp.try_as('authenticated', victim, format($q$insert into public.drivers (organization_id, user_id, display_name) values (%L, %L, 'Disp Forge')$q$, o_a, victim)) = '42501');
  perform pg_temp.report('C1 (Driver direct INSERT: denied)',
    pg_temp.try_as('authenticated', '99610000-0000-0000-0000-000000000003', format($q$insert into public.drivers (organization_id, user_id, display_name) values (%L, %L, 'Driver Forge')$q$, o_a, '99610000-0000-0000-0000-000000000003')) = '42501');
  perform pg_temp.report('D1 (PlatformAdminGrant alone: direct INSERT denied)',
    pg_temp.try_as('authenticated', '99610000-0000-0000-0000-000000000004', format($q$insert into public.drivers (organization_id, user_id, display_name) values (%L, %L, 'Platform Forge')$q$, o_a, '99610000-0000-0000-0000-000000000004')) = '42501');
  perform pg_temp.report('D2 (anon direct INSERT: denied)',
    pg_temp.try_as('anon', null, format($q$insert into public.drivers (organization_id, display_name) values (%L, 'Anon Forge')$q$, o_a)) = '42501');
  perform pg_temp.report('H1 (cross-tenant: Org B admin direct INSERT into Org A: denied)',
    pg_temp.try_as('authenticated', '99610000-0000-0000-0000-000000000005', format($q$insert into public.drivers (organization_id, user_id, display_name) values (%L, %L, 'Cross Forge')$q$, o_a, '99610000-0000-0000-0000-000000000005')) = '42501');
  perform pg_temp.report('A4 (no row was created by any of the attempts)', (select count(*) from public.drivers) = v_before);
end $$;

-- ---------------------------------------------------------------------------
-- I. Direct UPDATE of user_id denied (and cannot smuggle it through other columns)
-- ---------------------------------------------------------------------------
do $$
declare
  o_a constant uuid := '99620000-0000-0000-0000-00000000000a';
  d_a constant uuid := '99630000-0000-0000-0000-00000000000a';
  admin_a constant uuid := '99610000-0000-0000-0000-000000000001';
begin
  perform pg_temp.report('I1 (Organization Admin UPDATE drivers.user_id to another member: denied 42501)',
    pg_temp.try_as('authenticated', admin_a, format($q$update public.drivers set user_id = %L where id = %L$q$, '99610000-0000-0000-0000-000000000002', d_a)) = '42501');
  perform pg_temp.report('I2 (UPDATE user_id to NULL / to self also denied)',
    pg_temp.try_as('authenticated', admin_a, format($q$update public.drivers set user_id = null where id = %L$q$, d_a)) = '42501'
    and pg_temp.try_as('authenticated', admin_a, format($q$update public.drivers set user_id = %L where id = %L$q$, admin_a, d_a)) = '42501');
  perform pg_temp.report('I3 (user_id unchanged after the attempts)', (select user_id from public.drivers where id = d_a) = '99610000-0000-0000-0000-000000000003');
  perform pg_temp.report('I4 (moving a Driver to another organization: denied)',
    pg_temp.try_as('authenticated', admin_a, format($q$update public.drivers set organization_id = %L where id = %L$q$, '99620000-0000-0000-0000-00000000000b', d_a)) = '42501');
end $$;

-- ---------------------------------------------------------------------------
-- J. Legitimate Driver administration preserved
-- ---------------------------------------------------------------------------
do $$
declare
  admin_a constant uuid := '99610000-0000-0000-0000-000000000001';
  d_a constant uuid := '99630000-0000-0000-0000-00000000000a';
  d_b constant uuid := '99630000-0000-0000-0000-00000000000b';
  v_n text;
begin
  perform pg_temp.report('J1 (Organization Admin can list Drivers of own org)', pg_temp.val_as(admin_a, $q$select count(*)::text from public.drivers$q$) = '1');
  perform pg_temp.report('J2 (Dispatcher can read the Driver directory)', pg_temp.val_as('99610000-0000-0000-0000-000000000002', $q$select count(*)::text from public.drivers$q$) = '1');
  v_n := pg_temp.val_as(admin_a, format($q$with u as (update public.drivers set display_name = 'Employee Driver A2', phone = '555-0009' where id = %L returning 1) select count(*)::text from u$q$, d_a));
  perform pg_temp.report('J3 (Organization Admin can edit display_name / phone of own org Driver)',
    v_n = '1' and (select display_name from public.drivers where id = d_a) = 'Employee Driver A2');
  perform pg_temp.report('J4 (Organization Admin can set status inactive/active on own org Driver)',
    pg_temp.val_as(admin_a, format($q$with u as (update public.drivers set status = 'inactive' where id = %L returning 1) select count(*)::text from u$q$, d_a)) = '1'
    and pg_temp.val_as(admin_a, format($q$with u as (update public.drivers set status = 'active' where id = %L returning 1) select count(*)::text from u$q$, d_a)) = '1');
  v_n := pg_temp.val_as(admin_a, format($q$with u as (update public.drivers set display_name = 'Hijack' where id = %L returning 1) select count(*)::text from u$q$, d_b));
  perform pg_temp.report('J5 (cross-tenant: Org A admin cannot see or edit Org B''s Driver)',
    pg_temp.val_as(admin_a, format($q$select count(*)::text from public.drivers where id = %L$q$, d_b)) = '0'
    and v_n = '0'
    and (select display_name from public.drivers where id = d_b) = 'Org B Driver');
  perform pg_temp.report('J6 (Dispatcher cannot edit Drivers)',
    pg_temp.val_as('99610000-0000-0000-0000-000000000002', format($q$with u as (update public.drivers set display_name = 'Nope' where id = %L returning 1) select count(*)::text from u$q$, d_a)) in ('0', 'ERR:42501'));
  perform pg_temp.report('J7 (the Driver''s own view is via RPC: driver_get_profile resolves)',
    pg_temp.val_as('99610000-0000-0000-0000-000000000003', format($q$select (public.driver_get_profile(%L)).driver_id::text$q$, '99620000-0000-0000-0000-00000000000a')) = d_a::text);
end $$;

-- ---------------------------------------------------------------------------
-- E-G. Controlled primitives still work (SECURITY DEFINER, unaffected by the revoke)
-- ---------------------------------------------------------------------------
do $$
declare
  o_a constant uuid := '99620000-0000-0000-0000-00000000000a';
  u7 constant uuid := '99610000-0000-0000-0000-000000000007';
  u6 constant uuid := '99610000-0000-0000-0000-000000000006';
  v text; v_token text;
begin
  v := pg_temp.val_as(u7, format($q$select (l.linked::text || '/' || l.driver_id::text) from public.link_self_as_driver(%L, 'Owner Operator', '555-0100') l$q$, o_a));
  perform pg_temp.report('E1 (link_self_as_driver still works for an Organization Admin)', v like 'true/%');
  perform pg_temp.report('E2 (self-link produced exactly one linked active Driver; Membership role preserved)',
    (select count(*) from public.drivers where organization_id = o_a and user_id = u7 and status = 'active') = 1
    and (select role from public.memberships where organization_id = o_a and user_id = u7) = 'organization_admin');

  v_token := pg_temp.val_as('99610000-0000-0000-0000-000000000001', format($q$select (i.token)::text from public.create_driver_invite(%L, 'ws-6@example.test', 'Invited Person', '555-0200') i$q$, o_a));
  perform pg_temp.report('F1 (Organization Admin can still create a Driver invite)', v_token is not null and v_token not like 'ERR:%');
  perform pg_temp.report('H2 (wrong-email person cannot redeem the invite; no Driver created)',
    pg_temp.try_as('authenticated', '99610000-0000-0000-0000-000000000008', format($q$select public.redeem_driver_invite(%L::uuid)$q$, v_token)) <> 'ok'
    and (select count(*) from public.drivers where user_id = '99610000-0000-0000-0000-000000000008') = 0);
  v := pg_temp.val_as(u6, format($q$select (r.membership_created::text || '/' || r.driver_linked::text) from public.redeem_driver_invite(%L::uuid) r$q$, v_token));
  perform pg_temp.report('F2 (redeem_driver_invite still works: membership + Driver created)', v = 'true/true');
  perform pg_temp.report('G1 (invited Driver has a proper linked Driver identity: user_id, name/phone from the invite, active, driver-only Membership)',
    (select count(*) from public.drivers where organization_id = o_a and user_id = u6 and status = 'active' and display_name = 'Invited Person' and phone = '555-0200') = 1
    and (select role from public.memberships where organization_id = o_a and user_id = u6) = 'driver');
  perform pg_temp.report('G2 (invited Driver resolves via driver_get_profile)', pg_temp.val_as(u6, format($q$select (public.driver_get_profile(%L)).display_name$q$, o_a)) = 'Invited Person');
  perform pg_temp.report('H3 (cross-tenant self-link denied: Org B admin into Org A)', pg_temp.try_as('authenticated', '99610000-0000-0000-0000-000000000005', format($q$select public.link_self_as_driver(%L, 'X', null)$q$, o_a)) = 'ZW002');
  perform pg_temp.report('H4 (Dispatcher self-link still denied)', pg_temp.try_as('authenticated', '99610000-0000-0000-0000-000000000002', format($q$select public.link_self_as_driver(%L, 'X', null)$q$, o_a)) = 'ZW002');
end $$;

-- ---------------------------------------------------------------------------
-- K. S5A1 partial unique index still enforces one active linked Driver per org/user
-- ---------------------------------------------------------------------------
do $$
declare o_a constant uuid := '99620000-0000-0000-0000-00000000000a'; u7 constant uuid := '99610000-0000-0000-0000-000000000007';
begin
  begin
    insert into public.drivers (organization_id, user_id, display_name, status) values (o_a, u7, 'Second Active', 'active');
    perform pg_temp.report('K1 (a second ACTIVE linked Driver for the same org+user is rejected)', false);
  exception when unique_violation then
    perform pg_temp.report('K1 (a second ACTIVE linked Driver for the same org+user is rejected)', true);
  end;
  begin
    insert into public.drivers (organization_id, user_id, display_name, status) values (o_a, u7, 'History Row', 'inactive');
    perform pg_temp.report('K2 (an INACTIVE history row beside the active one is allowed)', true);
  exception when others then
    perform pg_temp.report('K2 (an INACTIVE history row beside the active one is allowed)', false);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Cleanup (always)
-- ---------------------------------------------------------------------------
do $$
declare v_orgs uuid[] := array['99620000-0000-0000-0000-00000000000a', '99620000-0000-0000-0000-00000000000b']::uuid[];
begin
  delete from public.audit_events where organization_id = any (v_orgs);
  delete from public.driver_invites where organization_id = any (v_orgs);
  delete from public.drivers where organization_id = any (v_orgs);
  delete from public.memberships where organization_id = any (v_orgs);
  delete from public.platform_admin_grants where user_id = '99610000-0000-0000-0000-000000000004';
  delete from public.organizations where id = any (v_orgs);
  delete from public.user_profiles where id::text like '99610000-%';
  delete from auth.users where id::text like '99610000-%';
  raise notice 'CLEANUP: orgs left %, users left %', (select count(*) from public.organizations where id = any (v_orgs)), (select count(*) from auth.users where id::text like '99610000-%');
end $$;
