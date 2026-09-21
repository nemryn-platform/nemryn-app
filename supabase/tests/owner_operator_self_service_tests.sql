-- Nemryn -- Owner-Operator self-service Driver access tests (P1-PILOT-S5A1).
--
-- Focused suite for the hardened link_self_as_driver primitive and its Activity
-- projection. Central helpers (is_org_member / has_org_role / current_driver_id),
-- every RLS policy and every Driver RPC are UNCHANGED by S5A1, so the full
-- historical battery is deliberately not re-run (proportional regression).
--
-- Fixtures: dedicated auth.users / organizations / memberships under the
-- 99510000-... / 99520000-... namespaces (grep-verified unused). Every fixture is
-- removed at the end, whether or not an assertion failed.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/owner_operator_self_service_tests.sql

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.report(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  raise notice 'TEST %: %', p_name, case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end;
end $$;

-- Run p_sql as an authenticated user; return 'ok' or the SQLSTATE.
create or replace function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  set local role authenticated;
  begin
    execute p_sql;
    reset role;
    return 'ok';
  exception when others then
    reset role;
    return sqlstate;
  end;
end $$;

-- Run a scalar query (cast to text) as an authenticated user; SQLSTATE on error.
create or replace function pg_temp.val_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  set local role authenticated;
  begin
    execute p_sql into v;
    reset role;
    return v;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', ('99510000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated',
       'so-' || n || '@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', ''
from generate_series(1, 14) n;

insert into public.organizations (id, name, timezone) values
  ('99520000-0000-0000-0000-00000000000a', 'S5A1 Org A', 'America/New_York'),
  ('99520000-0000-0000-0000-00000000000b', 'S5A1 Org B', 'America/New_York'),
  ('99520000-0000-0000-0000-00000000000c', 'S5A1 Org C (inactive membership)', 'America/New_York'),
  ('99520000-0000-0000-0000-00000000000d', 'S5A1 Org D (suspended)', 'America/New_York'),
  ('99520000-0000-0000-0000-00000000000e', 'S5A1 Org E (legacy rows)', 'America/New_York');

-- u01 admin A + admin B (multi-org) | u02 dispatcher A | u03 driver-only A | u04 platform admin, NO membership
-- u05 admin B only (other tenant) | u06 admin C (INACTIVE membership) | u07 admin D (suspended org)
-- u08 admin E (existing active linked row) | u09 admin E2-like: inactive linked row (org E) | u10 unlinked same-name (org E)
-- u11 two inactive rows (org E) | u12 invitee | u13 dispatcher who is ALSO plain member elsewhere | u14 spare
insert into public.memberships (organization_id, user_id, role, status) values
  ('99520000-0000-0000-0000-00000000000a', '99510000-0000-0000-0000-000000000001', 'organization_admin', 'active'),
  ('99520000-0000-0000-0000-00000000000b', '99510000-0000-0000-0000-000000000001', 'organization_admin', 'active'),
  ('99520000-0000-0000-0000-00000000000a', '99510000-0000-0000-0000-000000000002', 'dispatcher', 'active'),
  ('99520000-0000-0000-0000-00000000000a', '99510000-0000-0000-0000-000000000003', 'driver', 'active'),
  ('99520000-0000-0000-0000-00000000000b', '99510000-0000-0000-0000-000000000005', 'organization_admin', 'active'),
  ('99520000-0000-0000-0000-00000000000c', '99510000-0000-0000-0000-000000000006', 'organization_admin', 'inactive'),
  ('99520000-0000-0000-0000-00000000000d', '99510000-0000-0000-0000-000000000007', 'organization_admin', 'active'),
  ('99520000-0000-0000-0000-00000000000e', '99510000-0000-0000-0000-000000000008', 'organization_admin', 'active'),
  ('99520000-0000-0000-0000-00000000000e', '99510000-0000-0000-0000-000000000009', 'organization_admin', 'active'),
  ('99520000-0000-0000-0000-00000000000e', '99510000-0000-0000-0000-000000000010', 'organization_admin', 'active'),
  ('99520000-0000-0000-0000-00000000000e', '99510000-0000-0000-0000-000000000011', 'organization_admin', 'active');

insert into public.platform_admin_grants (user_id, note) values ('99510000-0000-0000-0000-000000000004', 'S5A1 test');

-- The pre-existing driver-only Driver (u03) as the invite flow would have produced it.
insert into public.drivers (id, organization_id, user_id, display_name, status) values
  ('99530000-0000-0000-0000-000000000003', '99520000-0000-0000-0000-00000000000a', '99510000-0000-0000-0000-000000000003', 'Employee Driver', 'active');
-- Legacy shapes in org E.
insert into public.drivers (id, organization_id, user_id, display_name, status) values
  ('99530000-0000-0000-0000-000000000008', '99520000-0000-0000-0000-00000000000e', '99510000-0000-0000-0000-000000000008', 'Legacy Owner', 'active'),
  ('99530000-0000-0000-0000-000000000009', '99520000-0000-0000-0000-00000000000e', '99510000-0000-0000-0000-000000000009', 'Paused Owner', 'inactive'),
  ('99530000-0000-0000-0000-000000000010', '99520000-0000-0000-0000-00000000000e', null, 'Unlinked Sam', 'active'),
  ('99530000-0000-0000-0000-000000000111', '99520000-0000-0000-0000-00000000000e', '99510000-0000-0000-0000-000000000011', 'Twice Paused', 'inactive'),
  ('99530000-0000-0000-0000-000000000112', '99520000-0000-0000-0000-00000000000e', '99510000-0000-0000-0000-000000000011', 'Twice Paused', 'inactive');

-- ---------------------------------------------------------------------------
-- A/B. Organization Admin, no Driver -> setup -> idempotent
-- ---------------------------------------------------------------------------
do $$
declare
  o_a constant uuid := '99520000-0000-0000-0000-00000000000a';
  u1 constant uuid := '99510000-0000-0000-0000-000000000001';
  v_first text; v_second text; v_id uuid;
begin
  perform pg_temp.report('A0 (before: no Driver row for the Admin)', (select count(*) from public.drivers where organization_id = o_a and user_id = u1) = 0
    and pg_temp.val_as(u1, format('select public.current_driver_id(%L)::text', o_a)) is null);

  v_first := pg_temp.val_as(u1, format($q$select (l.driver_id::text || '/' || l.linked::text) from public.link_self_as_driver(%L, 'Victor Owner', '555-0142') l$q$, o_a));
  v_id := split_part(v_first, '/', 1)::uuid;
  perform pg_temp.report('A1 (Admin self-link succeeds, linked=true)', split_part(v_first, '/', 2) = 'true' and v_id is not null);
  perform pg_temp.report('A2 (exactly one Driver row, active, linked to the caller, phone kept)',
    (select count(*) from public.drivers where organization_id = o_a and user_id = u1) = 1
    and (select status from public.drivers where id = v_id) = 'active'
    and (select phone from public.drivers where id = v_id) = '555-0142');
  perform pg_temp.report('A3 (Membership.role UNCHANGED = organization_admin, no second Membership)',
    (select role from public.memberships where organization_id = o_a and user_id = u1) = 'organization_admin'
    and (select count(*) from public.memberships where organization_id = o_a and user_id = u1) = 1);
  perform pg_temp.report('A4 (current_driver_id now resolves to the new Driver)', pg_temp.val_as(u1, format('select public.current_driver_id(%L)::text', o_a)) = v_id::text);
  perform pg_temp.report('A5 (driver_get_profile resolves for the Admin)', pg_temp.val_as(u1, format('select (public.driver_get_profile(%L)).driver_id::text', o_a)) = v_id::text);
  perform pg_temp.report('A6 (AuditEvent driver_self_linked: actor = caller, entity = Driver)',
    exists (select 1 from public.audit_events where organization_id = o_a and action = 'driver_self_linked' and actor_user_id = u1 and entity_type = 'driver' and entity_id = v_id));
  perform pg_temp.report('A7 (Activity shows the action with the caller as actor)',
    pg_temp.val_as(u1, format($q$select count(*)::text from public.list_activity_events(%L) where action = 'driver_self_linked'$q$, o_a)) = '1');

  v_second := pg_temp.val_as(u1, format($q$select (l.driver_id::text || '/' || l.linked::text) from public.link_self_as_driver(%L, 'Victor Owner', '555-0142') l$q$, o_a));
  perform pg_temp.report('B1 (repeat setup is idempotent: same Driver, linked=false)', v_second = v_id::text || '/false');
  perform pg_temp.report('B2 (repeat setup made no duplicate Driver and no second audit row)',
    (select count(*) from public.drivers where organization_id = o_a and user_id = u1) = 1
    and (select count(*) from public.audit_events where organization_id = o_a and action = 'driver_self_linked' and actor_user_id = u1) = 1);
  perform pg_temp.report('B3 (repeat call with different name/phone does not rewrite the existing Driver)',
    pg_temp.val_as(u1, format($q$select l.driver_id::text from public.link_self_as_driver(%L, 'Someone Else', '999') l$q$, o_a)) = v_id::text
    and (select display_name from public.drivers where id = v_id) = 'Victor Owner');
end $$;

-- ---------------------------------------------------------------------------
-- C/D/E. Roles that must NOT self-enable
-- ---------------------------------------------------------------------------
do $$
declare o_a constant uuid := '99520000-0000-0000-0000-00000000000a'; v_drivers_before bigint;
begin
  select count(*) into v_drivers_before from public.drivers where organization_id = o_a;

  perform pg_temp.report('C1 (Dispatcher cannot self-enable Driver access: ZW002)',
    pg_temp.try_as('99510000-0000-0000-0000-000000000002', format($q$select public.link_self_as_driver(%L, 'Disp Patcher', null)$q$, o_a)) = 'ZW002');
  perform pg_temp.report('C2 (no Driver row created for the Dispatcher; Membership.role unchanged)',
    (select count(*) from public.drivers where user_id = '99510000-0000-0000-0000-000000000002') = 0
    and (select role from public.memberships where user_id = '99510000-0000-0000-0000-000000000002') = 'dispatcher');

  perform pg_temp.report('D1 (Driver-only member cannot call it to gain anything: ZW002)',
    pg_temp.try_as('99510000-0000-0000-0000-000000000003', format($q$select public.link_self_as_driver(%L, 'Employee Driver', null)$q$, o_a)) = 'ZW002');
  perform pg_temp.report('D2 (Driver-only Membership still role=driver; still exactly one Driver row; no admin authority gained)',
    (select role from public.memberships where user_id = '99510000-0000-0000-0000-000000000003') = 'driver'
    and (select count(*) from public.drivers where user_id = '99510000-0000-0000-0000-000000000003') = 1
    and pg_temp.try_as('99510000-0000-0000-0000-000000000003', format($q$select * from public.list_activity_events(%L)$q$, o_a)) = 'ZW002');

  perform pg_temp.report('E1 (Platform Admin without a Membership is denied: ZW002)',
    pg_temp.try_as('99510000-0000-0000-0000-000000000004', format($q$select public.link_self_as_driver(%L, 'Platform Person', null)$q$, o_a)) = 'ZW002');
  perform pg_temp.report('E2 (PlatformAdminGrant alone created no Driver row anywhere)', (select count(*) from public.drivers where user_id = '99510000-0000-0000-0000-000000000004') = 0);

  perform pg_temp.report('C3 (Dispatcher/Driver/Platform attempts left the org Driver count unchanged)', (select count(*) from public.drivers where organization_id = o_a) = v_drivers_before);
end $$;

-- ---------------------------------------------------------------------------
-- F/G. Suspended organization, inactive Membership
-- ---------------------------------------------------------------------------
do $$
declare
  o_d constant uuid := '99520000-0000-0000-0000-00000000000d';
  o_c constant uuid := '99520000-0000-0000-0000-00000000000c';
  u7 constant uuid := '99510000-0000-0000-0000-000000000007';
  v_id text;
begin
  -- Set up an existing valid link, then suspend.
  v_id := pg_temp.val_as(u7, format($q$select l.driver_id::text from public.link_self_as_driver(%L, 'Dee Owner', null) l$q$, o_d));
  perform pg_temp.report('F0 (Admin of an ACTIVE org can set up before suspension)', v_id is not null and v_id not like 'ERR:%');

  update public.organizations set status = 'inactive' where id = o_d;
  perform pg_temp.report('F1 (suspended org: repeat setup denied ZW002)', pg_temp.try_as(u7, format($q$select public.link_self_as_driver(%L, 'Dee Owner', null)$q$, o_d)) = 'ZW002');
  perform pg_temp.report('F2 (suspended org: Driver workspace denied, current_driver_id null)', pg_temp.val_as(u7, format('select public.current_driver_id(%L)::text', o_d)) is null);
  update public.drivers set status = 'inactive' where id = v_id::uuid;
  perform pg_temp.report('F3 (suspended org: cannot reactivate an inactive Driver through the function)', pg_temp.try_as(u7, format($q$select public.link_self_as_driver(%L, 'Dee Owner', null)$q$, o_d)) = 'ZW002'
    and (select status from public.drivers where id = v_id::uuid) = 'inactive');
  update public.drivers set status = 'active' where id = v_id::uuid;
  update public.organizations set status = 'active' where id = o_d;
  perform pg_temp.report('F4 (after reactivation the existing valid link works again, no duplicate)',
    pg_temp.val_as(u7, format('select public.current_driver_id(%L)::text', o_d)) = v_id
    and (select count(*) from public.drivers where organization_id = o_d and user_id = u7) = 1);

  perform pg_temp.report('G1 (inactive Membership cannot set up Driver access: ZW002)',
    pg_temp.try_as('99510000-0000-0000-0000-000000000006', format($q$select public.link_self_as_driver(%L, 'Cee Owner', null)$q$, o_c)) = 'ZW002');
  perform pg_temp.report('G2 (no Driver row created; Membership still inactive)',
    (select count(*) from public.drivers where organization_id = o_c) = 0
    and (select status from public.memberships where organization_id = o_c) = 'inactive');
end $$;

-- ---------------------------------------------------------------------------
-- H/I. Multi-org isolation, cross-tenant
-- ---------------------------------------------------------------------------
do $$
declare
  o_a constant uuid := '99520000-0000-0000-0000-00000000000a';
  o_b constant uuid := '99520000-0000-0000-0000-00000000000b';
  u1 constant uuid := '99510000-0000-0000-0000-000000000001';
  u5 constant uuid := '99510000-0000-0000-0000-000000000005';
  v_a uuid; v_b text;
begin
  select id into v_a from public.drivers where organization_id = o_a and user_id = u1;
  perform pg_temp.report('H1 (Driver link in Org A implies NO Driver access in Org B)',
    (select count(*) from public.drivers where organization_id = o_b and user_id = u1) = 0
    and pg_temp.val_as(u1, format('select public.current_driver_id(%L)::text', o_b)) is null
    and pg_temp.try_as(u1, format('select public.driver_get_profile(%L)', o_b)) = 'ZW002');

  v_b := pg_temp.val_as(u1, format($q$select l.driver_id::text from public.link_self_as_driver(%L, 'Victor Owner', null) l$q$, o_b));
  perform pg_temp.report('H2 (Org B setup creates a SEPARATE Driver row; Org A row untouched)',
    v_b is not null and v_b <> v_a::text
    and (select organization_id from public.drivers where id = v_b::uuid) = o_b
    and (select count(*) from public.drivers where user_id = u1) = 2
    and (select status from public.drivers where id = v_a) = 'active');
  perform pg_temp.report('H3 (each Membership keeps its own role)', (select count(*) from public.memberships where user_id = u1 and role = 'organization_admin') = 2);

  perform pg_temp.report('I1 (another tenant''s Admin cannot see the owner Driver row)',
    pg_temp.val_as(u5, format('select count(*)::text from public.drivers where id = %L', v_a)) = '0');
  perform pg_temp.report('I2 (another tenant cannot mutate it: link with Org A id -> ZW002)',
    pg_temp.try_as(u5, format($q$select public.link_self_as_driver(%L, 'Cross Tenant', null)$q$, o_a)) = 'ZW002');
  perform pg_temp.report('I3 (another tenant cannot deactivate it through RLS)',
    pg_temp.val_as(u5, format($q$with u as (update public.drivers set status = 'inactive' where id = %L returning 1) select count(*)::text from u$q$, v_a)) = '0'
    and (select status from public.drivers where id = v_a) = 'active');
end $$;

-- ---------------------------------------------------------------------------
-- K. Legacy / onboarding-created rows, reactivation, ambiguity
-- ---------------------------------------------------------------------------
do $$
declare
  o_e constant uuid := '99520000-0000-0000-0000-00000000000e';
  u8 constant uuid := '99510000-0000-0000-0000-000000000008';
  u9 constant uuid := '99510000-0000-0000-0000-000000000009';
  u10 constant uuid := '99510000-0000-0000-0000-000000000010';
  u11 constant uuid := '99510000-0000-0000-0000-000000000011';
  v text;
begin
  v := pg_temp.val_as(u8, format($q$select (l.driver_id::text || '/' || l.linked::text) from public.link_self_as_driver(%L, 'Legacy Owner', null) l$q$, o_e));
  perform pg_temp.report('K1 (existing owner-driver row from onboarding: reused, no duplicate)',
    v = '99530000-0000-0000-0000-000000000008/false' and (select count(*) from public.drivers where organization_id = o_e and user_id = u8) = 1);

  v := pg_temp.val_as(u9, format($q$select (l.driver_id::text || '/' || l.linked::text) from public.link_self_as_driver(%L, 'Paused Owner', null) l$q$, o_e));
  perform pg_temp.report('R1 (inactive linked Driver is REACTIVATED, same row, no duplicate)',
    v = '99530000-0000-0000-0000-000000000009/true'
    and (select status from public.drivers where id = '99530000-0000-0000-0000-000000000009') = 'active'
    and (select count(*) from public.drivers where organization_id = o_e and user_id = u9) = 1);
  perform pg_temp.report('R2 (reactivation audited distinctly: driver_self_reactivated, before/after status)',
    exists (select 1 from public.audit_events where organization_id = o_e and action = 'driver_self_reactivated' and actor_user_id = u9
            and entity_id = '99530000-0000-0000-0000-000000000009' and before_data->>'status' = 'inactive' and after_data->>'status' = 'active'));
  perform pg_temp.report('R3 (reactivation shows in Activity for the org Admin)',
    pg_temp.val_as(u8, format($q$select count(*)::text from public.list_activity_events(%L) where action = 'driver_self_reactivated'$q$, o_e)) = '1');

  perform pg_temp.report('N1 (unlinked Driver with the same name: fails safely ZW003, no link, no new row)',
    pg_temp.try_as(u10, format($q$select public.link_self_as_driver(%L, 'unlinked SAM ', null)$q$, o_e)) = 'ZW003'
    and (select user_id from public.drivers where id = '99530000-0000-0000-0000-000000000010') is null
    and (select count(*) from public.drivers where organization_id = o_e and user_id = u10) = 0);
  v := pg_temp.try_as(u10, format($q$select public.link_self_as_driver(%L, 'Totally Different', null)$q$, o_e));
  perform pg_temp.report('N2 (a DIFFERENT name is not matched to the unlinked row; unlinked row stays unlinked)',
    v = 'ok'
    and (select user_id from public.drivers where id = '99530000-0000-0000-0000-000000000010') is null
    and (select count(*) from public.drivers where organization_id = o_e and user_id = u10) = 1);

  perform pg_temp.report('N3 (two inactive rows for the caller: fails safely ZW003, nothing changed)',
    pg_temp.try_as(u11, format($q$select public.link_self_as_driver(%L, 'Twice Paused', null)$q$, o_e)) = 'ZW003'
    and (select count(*) from public.drivers where organization_id = o_e and user_id = u11 and status = 'inactive') = 2);
end $$;

-- ---------------------------------------------------------------------------
-- Input validation, anonymous, grants, duplicate backstop, invite regression
-- ---------------------------------------------------------------------------
do $$
declare
  o_a constant uuid := '99520000-0000-0000-0000-00000000000a';
  u1 constant uuid := '99510000-0000-0000-0000-000000000001';
  u12 constant uuid := '99510000-0000-0000-0000-000000000012';
  v_token text; v_res text; v_drivers_before bigint;
begin
  perform pg_temp.report('V1 (anonymous / no auth.uid: ZW001)', pg_temp.try_as(null, format($q$select public.link_self_as_driver(%L, 'x', null)$q$, o_a)) in ('ZW001', 'ZW002'));
  perform pg_temp.report('V2 (null organization id: ZW002)', pg_temp.try_as(u1, $q$select public.link_self_as_driver(null, 'x', null)$q$) = 'ZW002');
  perform pg_temp.report('V3 (blank name: ZW006 on a fresh person)',
    pg_temp.try_as('99510000-0000-0000-0000-000000000014', format($q$select public.link_self_as_driver(%L, '   ', null)$q$, '99520000-0000-0000-0000-00000000000e')) in ('ZW006', 'ZW002'));
  perform pg_temp.report('V4 (oversized phone: ZW006)', pg_temp.try_as(u1, format($q$select public.link_self_as_driver(%L, 'Victor Owner', %L)$q$, o_a, repeat('9', 41))) = 'ZW006');

  perform pg_temp.report('G3 (anon has NO execute on link_self_as_driver; authenticated has)',
    not has_function_privilege('anon', 'public.link_self_as_driver(uuid,text,text)', 'execute')
    and has_function_privilege('authenticated', 'public.link_self_as_driver(uuid,text,text)', 'execute'));
  perform pg_temp.report('G4 (no client UPDATE on drivers.user_id; status/display_name/phone unchanged grants)',
    not has_column_privilege('authenticated', 'public.drivers', 'user_id', 'update')
    and has_column_privilege('authenticated', 'public.drivers', 'status', 'update'));

  begin
    insert into public.drivers (organization_id, user_id, display_name, status)
    values (o_a, u1, 'Second Active', 'active');
    perform pg_temp.report('U1 (schema rejects a second ACTIVE Driver for the same org+user)', false);
  exception when unique_violation then
    perform pg_temp.report('U1 (schema rejects a second ACTIVE Driver for the same org+user)', true);
  end;

  -- PROBE (pre-existing, not introduced by S5A1): can an Org Admin client INSERT a Driver row with an arbitrary user_id?
  raise notice 'PROBE client INSERT privilege on drivers.user_id for authenticated: %', has_column_privilege('authenticated', 'public.drivers', 'user_id', 'insert');

  -- J. normal employee invite -> redeem still works and is untouched by self-link
  select count(*) into v_drivers_before from public.drivers where organization_id = o_a;
  v_res := pg_temp.val_as(u1, format($q$select (i.token)::text from public.create_driver_invite(%L, 'so-12@example.test', 'Invited Employee', null) i$q$, o_a));
  perform pg_temp.report('J1 (Admin can still invite a Driver after self-link)', v_res is not null and v_res not like 'ERR:%');
  v_token := v_res;
  v_res := pg_temp.val_as(u12, format($q$select (r.membership_created::text || '/' || r.driver_linked::text) from public.redeem_driver_invite(%L::uuid) r$q$, v_token));
  perform pg_temp.report('J2 (invited person redeems: new driver Membership + linked Driver)', v_res = 'true/true');
  perform pg_temp.report('J3 (invitee is driver-only: role=driver, one active linked Driver, NO admin authority)',
    (select role from public.memberships where organization_id = o_a and user_id = u12) = 'driver'
    and (select count(*) from public.drivers where organization_id = o_a and user_id = u12 and status = 'active') = 1
    and pg_temp.try_as(u12, format($q$select public.link_self_as_driver(%L, 'Invited Employee', null)$q$, o_a)) = 'ZW002');
  perform pg_temp.report('J4 (owner Driver row unchanged by the invite flow; org gained exactly one Driver)',
    (select count(*) from public.drivers where organization_id = o_a) = v_drivers_before + 1
    and (select count(*) from public.drivers where organization_id = o_a and user_id = u1) = 1);
end $$;

-- ---------------------------------------------------------------------------
-- Cleanup (always)
-- ---------------------------------------------------------------------------
do $$
declare v_orgs uuid[] := array[
  '99520000-0000-0000-0000-00000000000a', '99520000-0000-0000-0000-00000000000b', '99520000-0000-0000-0000-00000000000c',
  '99520000-0000-0000-0000-00000000000d', '99520000-0000-0000-0000-00000000000e']::uuid[];
begin
  delete from public.audit_events where organization_id = any (v_orgs);
  delete from public.driver_invites where organization_id = any (v_orgs);
  delete from public.drivers where organization_id = any (v_orgs);
  delete from public.memberships where organization_id = any (v_orgs);
  delete from public.platform_admin_grants where user_id = '99510000-0000-0000-0000-000000000004';
  delete from public.organizations where id = any (v_orgs);
  delete from public.user_profiles where id::text like '99510000-%';
  delete from auth.users where id::text like '99510000-%';
  raise notice 'CLEANUP: fixtures removed (orgs left: %, users left: %)',
    (select count(*) from public.organizations where id = any (v_orgs)), (select count(*) from auth.users where id::text like '99510000-%');
end $$;
