-- Nemryn Platform -- Platform Admin foundation tests (P1-PILOT-S4B-R4E).
-- Run against `supabase db reset` fresh-seeded data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/platform_admin_foundation_tests.sql
--
-- Covers 20260920130000_platform_admin_foundation.sql: Platform Admin authority
-- (PlatformAdminGrant only), aggregate-only read models, the single lifecycle
-- mutation, lifecycle ENFORCEMENT through the shared helpers / public intake /
-- invitations, retention of all tenant data, multi-organization isolation,
-- Platform-vs-Membership authority separation, and the platform activity feed.
-- Seed fixtures: Org A admin a1, dispatcher a2, driver a3 (Driver 30..a1),
-- inactive dispatcher a5; Org B admin b1, dispatcher b2, driver b3 (Driver 30..b1);
-- c1 = admin in A + driver in B; d1 = platform admin (no membership);
-- e1 = no membership.

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute p_stmt; exception when others then reset role; return sqlstate; end;
  reset role;
  return 'OK';
end;
$$;

create or replace function pg_temp.val_as(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute p_stmt into v; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return v;
end;
$$;

create or replace function pg_temp.report(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  if p_ok then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;

-- fixtures (owner level): an active integration in each of Org A and Org B, a
-- pending staff invitation in Org B for e1, and notification_events in Org B.
insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins)
values ('e4000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'r4e-int-org-a', 'website', true, array['https://a.r4e.example']),
       ('e4000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'r4e-int-org-b', 'website', true, array['https://b.r4e.example']);

-- snapshot of Org B's tenant data BEFORE any lifecycle change
create temp table r4e_snap as
select (select count(*) from public.memberships where organization_id = '10000000-0000-0000-0000-0000000000b1') as mem,
       (select count(*) filter (where status = 'active') from public.memberships where organization_id = '10000000-0000-0000-0000-0000000000b1') as mem_active,
       (select count(*) from public.drivers where organization_id = '10000000-0000-0000-0000-0000000000b1') as drv,
       (select count(*) from public.trips where organization_id = '10000000-0000-0000-0000-0000000000b1') as trp,
       (select count(*) from public.transportation_requests where organization_id = '10000000-0000-0000-0000-0000000000b1') as req,
       (select count(*) from public.request_intake_integrations where organization_id = '10000000-0000-0000-0000-0000000000b1') as itg;
grant select on r4e_snap to public;

-- =============================================================================
-- A. AUTHORIZATION -- PlatformAdminGrant only
-- =============================================================================
do $$
declare
  v_d1 uuid := '20000000-0000-0000-0000-0000000000d1';
  v_fns text[] := array[
    'select * from public.platform_get_overview()',
    'select * from public.platform_list_organizations()',
    $q$select * from public.platform_get_organization('10000000-0000-0000-0000-0000000000a1')$q$,
    $q$select * from public.platform_list_organization_integrations('10000000-0000-0000-0000-0000000000a1')$q$,
    'select * from public.platform_list_notification_attention()',
    'select * from public.platform_list_activity()'];
  v_f text; v_ok boolean := true; v_bad text := '';
  v_u uuid;
begin
  foreach v_f in array v_fns loop
    if pg_temp.try_as('authenticated', v_d1, v_f) <> 'OK' then v_ok := false; v_bad := v_bad || ' d1-denied:' || v_f; end if;
  end loop;
  perform pg_temp.report('PA-1 (Platform Admin with NO Membership can execute every platform read model)', v_ok, v_bad);

  v_ok := true; v_bad := '';
  foreach v_u in array array['20000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-0000000000a2','20000000-0000-0000-0000-0000000000a3',
                             '20000000-0000-0000-0000-0000000000b1','20000000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-0000000000e1']::uuid[] loop
    foreach v_f in array v_fns loop
      if pg_temp.try_as('authenticated', v_u, v_f) <> 'ZW002' then v_ok := false; v_bad := v_bad || ' ' || right(v_u::text, 2) || ':' || left(v_f, 40); end if;
    end loop;
  end loop;
  perform pg_temp.report('PA-2 (Org Admin / Dispatcher / Driver / multi-org / no-membership: every platform function ZW002)', v_ok, v_bad);

  v_ok := true;
  foreach v_f in array v_fns loop
    if pg_temp.try_as('authenticated', null, v_f) <> 'ZW001' then v_ok := false; end if;
    if pg_temp.try_as('anon', null, v_f) <> '42501' then v_ok := false; end if;
  end loop;
  perform pg_temp.report('PA-3 (no session: ZW001; anon: no EXECUTE at all)', v_ok);

  perform pg_temp.report('PA-4 (lifecycle mutation: Org Admin, Dispatcher, Driver, no-membership -> ZW002; anon -> permission denied; no session ZW001)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', $q$select public.set_platform_organization_status('10000000-0000-0000-0000-0000000000b1', 'inactive', 'trying it')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.set_platform_organization_status('10000000-0000-0000-0000-0000000000a1', 'inactive', 'self suspend')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', $q$select public.set_platform_organization_status('10000000-0000-0000-0000-0000000000a1', 'inactive', 'dispatcher')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', $q$select public.set_platform_organization_status('10000000-0000-0000-0000-0000000000a1', 'inactive', 'driver')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', $q$select public.set_platform_organization_status('10000000-0000-0000-0000-0000000000a1', 'inactive', 'nobody')$q$) = 'ZW002'
    and pg_temp.try_as('anon', null, $q$select public.set_platform_organization_status('10000000-0000-0000-0000-0000000000a1', 'inactive', 'anon')$q$) = '42501'
    and pg_temp.try_as('authenticated', null, $q$select public.set_platform_organization_status('10000000-0000-0000-0000-0000000000a1', 'inactive', 'anon')$q$) = 'ZW001'
    and (select status from public.organizations where id = '10000000-0000-0000-0000-0000000000a1') = 'active'
    and (select status from public.organizations where id = '10000000-0000-0000-0000-0000000000b1') = 'active');

  perform pg_temp.report('PA-5 (internal guard _require_platform_admin is not executable by any client role)',
    pg_temp.try_as('authenticated', v_d1, 'select public._require_platform_admin()') = '42501'
    and pg_temp.try_as('anon', null, 'select public._require_platform_admin()') = '42501');

  perform pg_temp.report('PA-6 (direct status write is impossible for a tenant Admin: column grant + RLS; status unchanged)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', $q$update public.organizations set status = 'inactive' where id = '10000000-0000-0000-0000-0000000000b1'$q$) <> 'OK'
    or (select status from public.organizations where id = '10000000-0000-0000-0000-0000000000b1') = 'active');
end $$;
reset role;

-- =============================================================================
-- B. PRIVACY BOUNDARY -- no tenant table access for Platform Admin
-- =============================================================================
do $$
declare
  v_d1 uuid := '20000000-0000-0000-0000-0000000000d1';
  v_t text; v_n text; v_ok boolean := true; v_bad text := '';
begin
  foreach v_t in array array['transportation_requests','passengers','trips','trip_events','trip_notes','trip_exceptions','drivers','vehicles','facilities','memberships','audit_events','request_intake_integrations','notification_events','staff_invites','recurring_arrangements'] loop
    v_n := pg_temp.val_as('authenticated', v_d1, format('select count(*)::text from public.%I', v_t));
    if v_n is distinct from '0' and v_n is distinct from 'ERR:42501' then v_ok := false; v_bad := v_bad || ' ' || v_t || '=' || coalesce(v_n, 'null'); end if;
  end loop;
  perform pg_temp.report('PB-1 (Platform Admin reads ZERO rows -- or is denied outright -- on every tenant-content table, incl. audit_events; the broad audit policy is gone)', v_ok, v_bad);

  perform pg_temp.report('PB-2 (read-model column lists carry counts/metadata only: no names, phones, addresses, notes, emails, ids of records, secrets)',
    (select count(*) from information_schema.parameters p
      where p.specific_schema = 'public' and p.parameter_mode = 'OUT'
        and p.specific_name in (select r.specific_name from information_schema.routines r where r.routine_schema = 'public' and r.routine_name like 'platform\_%')
        and p.parameter_name not like '%\_count' and (p.parameter_name ~* '(passenger|requester|pickup|destination|note|description|phone|address|email|token|secret|password|external|recipient|driver_name|display_name)')) = 0);
  perform pg_temp.report('PB-3 (Platform Admin direct SELECT on organizations: ZERO rows -- organization information comes only through the platform_* read functions)',
    pg_temp.val_as('authenticated', v_d1, 'select count(*)::text from public.organizations') = '0'
    and pg_temp.val_as('authenticated', v_d1, 'select (count(*) >= 2)::text from public.platform_list_organizations()') = 'true'
    and pg_temp.val_as('authenticated', v_d1, $q$select (name is not null)::text from public.platform_get_organization('10000000-0000-0000-0000-0000000000a1')$q$) = 'true'
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organizations' and policyname = 'organizations_select_platform_admin'));
  perform pg_temp.report('PB-4 (ordinary members still read exactly their OWN organization row; a Platform Admin holding a Membership reads only that organization)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', 'select count(*)::text || string_agg(name, '','') from public.organizations') like '1%'
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000b1', 'select count(*)::text from public.organizations') = '1'
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000c1', 'select count(*)::text from public.organizations') = '2');
end $$;
reset role;

-- =============================================================================
-- C. READ MODELS
-- =============================================================================
do $$
declare v_d1 uuid := '20000000-0000-0000-0000-0000000000d1'; v_a uuid := '10000000-0000-0000-0000-0000000000a1';
begin
  perform pg_temp.report('RM-1 (overview: totals consistent, admin count = grants)',
    pg_temp.val_as('authenticated', v_d1, 'select (total_organizations = active_organizations + suspended_organizations and platform_admin_count = (select count(*) from public.platform_admin_grants) and integrations_total >= 2 and integrations_active >= 2)::text from public.platform_get_overview()') = 'true');

  perform pg_temp.report('RM-2 (directory: counts equal a direct owner-level count for Org A)',
    pg_temp.val_as('authenticated', v_d1, $q$select (select concat_ws('/', active_staff_count, driver_count, trip_count, request_count, integrations_total, integrations_active) from public.platform_list_organizations('Org A') where organization_id = '10000000-0000-0000-0000-0000000000a1')$q$)
    = (select concat_ws('/',
         (select count(*) from public.memberships m where m.organization_id = v_a and m.status = 'active' and m.role in ('organization_admin','dispatcher')),
         (select count(*) from public.drivers where organization_id = v_a),
         (select count(*) from public.trips where organization_id = v_a),
         (select count(*) from public.transportation_requests where organization_id = v_a), 1, 1)));
end $$;
reset role;

do $$
declare v_d1 uuid := '20000000-0000-0000-0000-0000000000d1';
begin
  perform pg_temp.report('RM-3 (directory: search substring, wildcard characters are literal, status filter, bad status ZW006, long search ZW006)',
    pg_temp.val_as('authenticated', v_d1, $q$select count(*)::text from public.platform_list_organizations('Org A')$q$)::int >= 1
    and pg_temp.val_as('authenticated', v_d1, $q$select count(*)::text from public.platform_list_organizations('%')$q$) = '0'
    and pg_temp.val_as('authenticated', v_d1, $q$select count(*)::text from public.platform_list_organizations('_')$q$) = '0'
    and pg_temp.val_as('authenticated', v_d1, $q$select count(*)::text from public.platform_list_organizations(null, 'inactive')$q$) = '0'
    and pg_temp.try_as('authenticated', v_d1, $q$select * from public.platform_list_organizations(null, 'deleted')$q$) = 'ZW006'
    and pg_temp.try_as('authenticated', v_d1, format('select * from public.platform_list_organizations(%L)', repeat('x', 101))) = 'ZW006');

  perform pg_temp.report('RM-4 (directory pagination: limit clamped to 50, stable order, offset pages are disjoint, total_count on every row)',
    pg_temp.val_as('authenticated', v_d1, format('select (count(*) = 1 and max(total_count) = %s)::text from public.platform_list_organizations(null, null, 1, 0)', (select count(*) from public.organizations))) = 'true'
    and pg_temp.val_as('authenticated', v_d1, $q$select (a.organization_id <> b.organization_id)::text from public.platform_list_organizations(null, null, 1, 0) a, public.platform_list_organizations(null, null, 1, 1) b$q$) = 'true'
    and pg_temp.val_as('authenticated', v_d1, $q$select (count(*) <= 50)::text from public.platform_list_organizations(null, null, 5000, 0)$q$) = 'true');

  perform pg_temp.report('RM-5 (detail: counts match an owner-level count; unknown / null organization ZW002)',
    pg_temp.val_as('authenticated', v_d1, $q$select concat_ws('/', active_admin_count, passenger_count, vehicle_count, driver_count) from public.platform_get_organization('10000000-0000-0000-0000-0000000000a1')$q$)
    = (select concat_ws('/',
         (select count(*) from public.memberships where organization_id = '10000000-0000-0000-0000-0000000000a1' and status = 'active' and role = 'organization_admin'),
         (select count(*) from public.passengers where organization_id = '10000000-0000-0000-0000-0000000000a1'),
         (select count(*) from public.vehicles where organization_id = '10000000-0000-0000-0000-0000000000a1'),
         (select count(*) from public.drivers where organization_id = '10000000-0000-0000-0000-0000000000a1')))
    and pg_temp.try_as('authenticated', v_d1, $q$select * from public.platform_get_organization('99999999-9999-9999-9999-999999999999')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', v_d1, $q$select * from public.platform_get_organization(null)$q$) = 'ZW002');

  perform pg_temp.report('RM-6 (integration health: origin, active flag, counts; no integration id or external id column)',
    pg_temp.val_as('authenticated', v_d1, $q$select (allowed_origins[1] = 'https://a.r4e.example' and is_active and request_count >= 0)::text from public.platform_list_organization_integrations('10000000-0000-0000-0000-0000000000a1')$q$) = 'true'
    and not exists (select 1 from information_schema.parameters where specific_schema = 'public' and parameter_mode = 'OUT'
       and specific_name in (select specific_name from information_schema.routines where routine_name = 'platform_list_organization_integrations')
       and parameter_name in ('id', 'external_id', 'integration_id')));
end $$;
reset role;

-- notification health: seed events in Org B (owner level), then read as d1
insert into public.notification_events (id, organization_id, event_type, entity_type, entity_id, status, failure_reason, created_at, attempted_at)
values
 ('e4100000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b1', 'website_request', 'transportation_request', 'e4200000-0000-0000-0000-000000000001', 'failed', 'provider_error', now() - interval '2 hours', now() - interval '2 hours'),
 ('e4100000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000b1', 'website_request', 'transportation_request', 'e4200000-0000-0000-0000-000000000002', 'dispatching', null, now() - interval '3 hours', now() - interval '3 hours'),
 ('e4100000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000b1', 'trip_exception', 'trip_exception', 'e4200000-0000-0000-0000-000000000003', 'dispatching', null, now(), now()),
 ('e4100000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-0000000000b1', 'website_request', 'transportation_request', 'e4200000-0000-0000-0000-000000000004', 'sent', null, now(), now()),
 ('e4100000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-0000000000b1', 'website_request', 'transportation_request', 'e4200000-0000-0000-0000-000000000005', 'pending', null, now() - interval '1 hour', null);

do $$
declare v_d1 uuid := '20000000-0000-0000-0000-0000000000d1'; v_b text := '10000000-0000-0000-0000-0000000000b1';
begin
  perform pg_temp.report('NH-1 (org detail notification counts by status; stuck = dispatching/pending > 15 min only; last failure category)',
    pg_temp.val_as('authenticated', v_d1, format($q$select (notif_failed = 1 and notif_dispatching = 2 and notif_sent = 1 and notif_pending = 1 and notif_stuck = 2
        and last_failure_reason = 'provider_error')::text from public.platform_get_organization(%L)$q$, v_b)) = 'true');
  perform pg_temp.report('NH-2 (attention list: failed + stuck only, fresh dispatching / sent excluded; fixed vocabulary; flags stuck)',
    pg_temp.val_as('authenticated', v_d1, $q$select (count(*) = 3 and count(*) filter (where is_stuck) = 2 and bool_and(organization_name is not null))::text from public.platform_list_notification_attention(50) where organization_id = '10000000-0000-0000-0000-0000000000b1'$q$) = 'true');
  perform pg_temp.report('NH-3 (overview counts include the failed and stuck events; nothing was mutated by reading)',
    pg_temp.val_as('authenticated', v_d1, 'select (notifications_failed >= 1 and notifications_stuck >= 2)::text from public.platform_get_overview()') = 'true'
    and (select count(*) from public.notification_events where organization_id = v_b::uuid and status = 'dispatching') = 2);
  perform pg_temp.report('NH-4 (attention list exposes no recipient / content / provider columns)',
    not exists (select 1 from information_schema.parameters where specific_schema = 'public' and parameter_mode = 'OUT'
      and specific_name in (select specific_name from information_schema.routines where routine_name = 'platform_list_notification_attention')
      and parameter_name ~* '(recipient|email|body|detail|provider|response|entity)'));
end $$;
reset role;

-- =============================================================================
-- D. LIFECYCLE MUTATION -- validation, audit, idempotency
-- =============================================================================
do $$
declare v_d1 uuid := '20000000-0000-0000-0000-0000000000d1'; v_b text := '10000000-0000-0000-0000-0000000000b1';
begin
  perform pg_temp.report('LC-1 (validation: bad status, null status, missing / blank / 2-char / 501-char reason -> ZW006; unknown org ZW002)',
    pg_temp.try_as('authenticated', v_d1, format('select public.set_platform_organization_status(%L, ''archived'', ''valid reason'')', v_b)) = 'ZW006'
    and pg_temp.try_as('authenticated', v_d1, format('select public.set_platform_organization_status(%L, null, ''valid reason'')', v_b)) = 'ZW006'
    and pg_temp.try_as('authenticated', v_d1, format('select public.set_platform_organization_status(%L, ''inactive'', null)', v_b)) = 'ZW006'
    and pg_temp.try_as('authenticated', v_d1, format('select public.set_platform_organization_status(%L, ''inactive'', ''   '')', v_b)) = 'ZW006'
    and pg_temp.try_as('authenticated', v_d1, format('select public.set_platform_organization_status(%L, ''inactive'', ''ab'')', v_b)) = 'ZW006'
    and pg_temp.try_as('authenticated', v_d1, format('select public.set_platform_organization_status(%L, ''inactive'', %L)', v_b, repeat('x', 501))) = 'ZW006'
    and pg_temp.try_as('authenticated', v_d1, $q$select public.set_platform_organization_status('99999999-9999-9999-9999-999999999999', 'inactive', 'valid reason')$q$) = 'ZW002'
    and (select status from public.organizations where id = v_b::uuid) = 'active'
    and not exists (select 1 from public.audit_events where action like 'platform\_%'));

  perform pg_temp.report('LC-2 (already active + reactivate request: idempotent no-op, no audit)',
    pg_temp.val_as('authenticated', v_d1, format('select (public.set_platform_organization_status(%L, ''active'', ''nothing to do'')).changed::text', v_b)) = 'false'
    and not exists (select 1 from public.audit_events where action like 'platform\_%'));
end $$;
reset role;

-- a Driver invitation's token / staff invite fixture in Org B while still ACTIVE
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
create temp table r4e_invite as
select (public.create_staff_invite('10000000-0000-0000-0000-0000000000b1', 'no-membership@example.test', 'dispatcher')).token as token;
reset role;
grant select on r4e_invite to public;

-- multi-org baseline: c1 works in Org A and (as a driver) in Org B before suspension
do $$
declare v_c1 uuid := '20000000-0000-0000-0000-0000000000c1';
begin
  perform pg_temp.report('MO-0 (baseline: multi-org c1 is Admin in A and a member of B, both operable)',
    pg_temp.val_as('authenticated', v_c1, $q$select public.has_org_role('10000000-0000-0000-0000-0000000000a1', array['organization_admin'])::text$q$) = 'true'
    and pg_temp.val_as('authenticated', v_c1, $q$select public.is_org_member('10000000-0000-0000-0000-0000000000b1')::text$q$) = 'true'
    and pg_temp.val_as('authenticated', v_c1, $q$select (public.current_driver_id('10000000-0000-0000-0000-0000000000b1') is not null)::text$q$) = 'true');
end $$;
reset role;

-- =============================================================================
-- E. SUSPEND Org B (as Platform Admin d1)
-- =============================================================================
do $$
declare v_d1 uuid := '20000000-0000-0000-0000-0000000000d1'; v_b text := '10000000-0000-0000-0000-0000000000b1';
declare v_out text;
begin
  v_out := pg_temp.val_as('authenticated', v_d1, format('select (r.changed::text || ''/'' || r.status) from public.set_platform_organization_status(%L, ''inactive'', ''Pilot pause requested by owner'') r', v_b));
  perform pg_temp.report('LC-3 (suspend: changed=true, status inactive)', v_out = 'true/inactive' and (select status from public.organizations where id = v_b::uuid) = 'inactive', v_out);
  perform pg_temp.report('LC-4 (suspend AuditEvent: action, actor = d1 from auth.uid(), before/after status, reason stored)',
    exists (select 1 from public.audit_events where organization_id = v_b::uuid and action = 'platform_organization_suspended' and actor_user_id = v_d1
      and before_data = '{"status":"active"}'::jsonb and after_data = '{"status":"inactive"}'::jsonb and reason = 'Pilot pause requested by owner' and entity_type = 'organization' and entity_id = v_b::uuid));
  v_out := pg_temp.val_as('authenticated', v_d1, format('select (r.changed::text) from public.set_platform_organization_status(%L, ''inactive'', ''again'') r', v_b));
  perform pg_temp.report('LC-5 (repeat suspend: idempotent, no second audit)',
    v_out = 'false'
    and (select count(*) from public.audit_events where organization_id = v_b::uuid and action = 'platform_organization_suspended') = 1);
end $$;
reset role;

-- =============================================================================
-- F. ENFORCEMENT while suspended
-- =============================================================================
do $$
declare
  v_b text := '10000000-0000-0000-0000-0000000000b1'; v_a text := '10000000-0000-0000-0000-0000000000a1';
  b1 uuid := '20000000-0000-0000-0000-0000000000b1'; b2 uuid := '20000000-0000-0000-0000-0000000000b2'; b3 uuid := '20000000-0000-0000-0000-0000000000b3';
  c1 uuid := '20000000-0000-0000-0000-0000000000c1'; a1 uuid := '20000000-0000-0000-0000-0000000000a1';
begin
  perform pg_temp.report('EN-1 (Org Admin of a suspended org: has_org_role / is_org_member false)',
    pg_temp.val_as('authenticated', b1, format('select (public.has_org_role(%L, array[''organization_admin'']) or public.is_org_member(%L))::text', v_b, v_b)) = 'false');
  perform pg_temp.report('EN-2 (Dispatcher of a suspended org: denied)',
    pg_temp.val_as('authenticated', b2, format('select (public.has_org_role(%L, array[''dispatcher'', ''organization_admin'']) or public.is_org_member(%L))::text', v_b, v_b)) = 'false');
  perform pg_temp.report('EN-3 (Driver of a suspended org: current_driver_id null; driver_get_profile denied)',
    pg_temp.val_as('authenticated', b3, format('select (public.current_driver_id(%L) is null)::text', v_b)) = 'true'
    and pg_temp.try_as('authenticated', b3, format('select * from public.driver_get_profile(%L)', v_b)) <> 'OK');
  perform pg_temp.report('EN-4 (RLS: staff of a suspended org read ZERO requests / trips / drivers / passengers; a Driver reads zero assigned trips)',
    pg_temp.val_as('authenticated', b1, 'select (select count(*) from public.transportation_requests)::text || (select count(*) from public.trips) || (select count(*) from public.drivers) || (select count(*) from public.passengers)') = '0000'
    and pg_temp.val_as('authenticated', b3, 'select (select count(*) from public.trips)::text') = '0');
  perform pg_temp.report('EN-5 (tenant RPCs deny a suspended org: settings, notification settings, team, integrations, activity -> ZW002)',
    pg_temp.try_as('authenticated', b1, format('select public.update_organization_settings(%L, ''{"business_phone":"555-0100"}''::jsonb)', v_b)) = 'ZW002'
    and pg_temp.try_as('authenticated', b1, format('select * from public.get_notification_settings(%L)', v_b)) = 'ZW002'
    and pg_temp.try_as('authenticated', b1, format('select public.set_notification_settings(%L, ''website_request'', array[''dispatcher''])', v_b)) = 'ZW002'
    and pg_temp.try_as('authenticated', b1, format('select public.create_staff_invite(%L, ''x1@example.test'', ''dispatcher'')', v_b)) = 'ZW002'
    and pg_temp.try_as('authenticated', b1, format('select public.set_organization_service_offerings(%L, array[''medical_appointments''])', v_b)) = 'ZW002'
    and pg_temp.try_as('authenticated', b1, format('select * from public.list_request_intake_integrations(%L)', v_b)) = 'ZW002'
    and pg_temp.try_as('authenticated', b1, format('select * from public.list_activity_events(%L)', v_b)) = 'ZW002');
  perform pg_temp.report('EN-6 (a member can still READ their own suspended organization row incl. status, and only their own)',
    pg_temp.val_as('authenticated', b1, 'select string_agg(status, '','') from public.organizations') = 'inactive'
    and pg_temp.val_as('authenticated', b1, 'select count(*)::text from public.organizations') = '1');
  perform pg_temp.report('EN-7 (multi-org c1: Org A still fully operable, Org B unavailable; auth user not blocked globally)',
    pg_temp.val_as('authenticated', c1, format('select public.has_org_role(%L, array[''organization_admin''])::text', v_a)) = 'true'
    and pg_temp.val_as('authenticated', c1, format('select public.is_org_member(%L)::text', v_b)) = 'false'
    and pg_temp.val_as('authenticated', c1, format('select (public.current_driver_id(%L) is null)::text', v_b)) = 'true'
    and pg_temp.val_as('authenticated', c1, format('select count(*)::text from public.get_notification_settings(%L)', v_a)) = '2'
    and pg_temp.val_as('authenticated', c1, 'select count(*)::text from public.organizations') = '2');
  perform pg_temp.report('EN-8 (Org A unaffected for everyone: a1 admin, a2 dispatcher, a3 driver)',
    pg_temp.val_as('authenticated', a1, format('select public.has_org_role(%L, array[''organization_admin''])::text', v_a)) = 'true'
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.has_org_role(%L, array[''dispatcher''])::text', v_a)) = 'true'
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a3', format('select (public.current_driver_id(%L) is not null)::text', v_a)) = 'true');
  perform pg_temp.report('EN-9 (invitation acceptance into a suspended org -> ZW003 stale_state; Membership not created)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', format('select public.accept_staff_invite(%L)', (select token from r4e_invite))) = 'ZW003'
    and not exists (select 1 from public.memberships where organization_id = v_b::uuid and user_id = '20000000-0000-0000-0000-0000000000e1'));
end $$;
reset role;

-- public intake: suspended org rejects with the generic error; active org accepts
do $$
declare v_r text;
begin
  set local role service_role;
  begin
    perform public.submit_public_transportation_request('r4e-int-org-b', 'R4E-SUSP-1', 'R4E Requester', 'self', '555-0300', 'R4E pickup', 'R4E destination', 'no', null, null, null, null, null, 'https://b.r4e.example');
    v_r := 'ACCEPTED';
  exception when others then v_r := sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform pg_temp.report('IN-1 (suspended org + ACTIVE integration: intake rejected with the generic invalid_input ZW006; message reveals nothing)', v_r = 'ZW006:invalid_input', v_r);
  perform pg_temp.report('IN-2 (no Request and no notification event created by the rejected submission)',
    not exists (select 1 from public.transportation_requests where external_submission_ref = 'R4E-SUSP-1')
    and (select count(*) from public.notification_events where organization_id = '10000000-0000-0000-0000-0000000000b1') = 5);
  set local role service_role;
  begin
    perform public.submit_public_transportation_request('r4e-int-org-a', 'R4E-ACTIVE-1', 'R4E Requester A', 'self', '555-0301', 'R4E pickup', 'R4E destination', 'no', null, null, null, null, null, 'https://a.r4e.example');
    v_r := 'ACCEPTED';
  exception when others then v_r := sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform pg_temp.report('IN-3 (Org A, unaffected: same call accepted; notification event enqueued)', v_r = 'ACCEPTED'
    and exists (select 1 from public.notification_events e join public.transportation_requests r on r.id = e.entity_id where r.external_submission_ref = 'R4E-ACTIVE-1'), v_r);
end $$;
reset role;

-- retention: NOTHING tenant-side was changed by suspending
do $$
declare v_b uuid := '10000000-0000-0000-0000-0000000000b1';
begin
  perform pg_temp.report('RT-1 (suspension retained every Membership, Driver, Trip, Request, Integration, notification event; no Membership/Driver status rewritten)',
    (select mem = (select count(*) from public.memberships where organization_id = v_b)
        and mem_active = (select count(*) filter (where status = 'active') from public.memberships where organization_id = v_b)
        and drv = (select count(*) from public.drivers where organization_id = v_b)
        and trp = (select count(*) from public.trips where organization_id = v_b)
        and req = (select count(*) from public.transportation_requests where organization_id = v_b)
        and itg = (select count(*) from public.request_intake_integrations where organization_id = v_b) from r4e_snap)
    and (select bool_and(is_active) from public.request_intake_integrations where organization_id = v_b)
    and (select count(*) from public.drivers where organization_id = v_b and status = 'active') = (select drv from r4e_snap));
  perform pg_temp.report('RT-2 (platform directory still counts the suspended org and shows status inactive)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000d1', $q$select (status = 'inactive' and trip_count = (select trp from r4e_snap))::text from public.platform_list_organizations('Org B') where organization_id = '10000000-0000-0000-0000-0000000000b1'$q$) = 'true'
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000d1', $q$select count(*)::text from public.platform_list_organizations(null, 'inactive')$q$) = '1');
end $$;
reset role;

-- =============================================================================
-- G. REACTIVATE
-- =============================================================================
do $$
declare v_d1 uuid := '20000000-0000-0000-0000-0000000000d1'; v_b text := '10000000-0000-0000-0000-0000000000b1';
  b1 uuid := '20000000-0000-0000-0000-0000000000b1'; v_r text; v_out text;
begin
  v_out := pg_temp.val_as('authenticated', v_d1, format('select (r.changed::text || ''/'' || r.status) from public.set_platform_organization_status(%L, ''active'', ''Owner confirmed resume'') r', v_b));
  perform pg_temp.report('RA-1 (reactivate: changed=true, status active, audited platform_organization_reactivated with actor and reason)',
    v_out = 'true/active'
    and exists (select 1 from public.audit_events where organization_id = v_b::uuid and action = 'platform_organization_reactivated' and actor_user_id = v_d1
       and before_data = '{"status":"inactive"}'::jsonb and after_data = '{"status":"active"}'::jsonb and reason = 'Owner confirmed resume'));
  perform pg_temp.report('RA-2 (same Memberships work again with NO re-provisioning: admin, dispatcher, driver, and settings read)',
    pg_temp.val_as('authenticated', b1, format('select public.has_org_role(%L, array[''organization_admin''])::text', v_b)) = 'true'
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000b2', format('select public.has_org_role(%L, array[''dispatcher''])::text', v_b)) = 'true'
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000b3', format('select (public.current_driver_id(%L) is not null)::text', v_b)) = 'true'
    and pg_temp.val_as('authenticated', b1, format('select count(*)::text from public.get_notification_settings(%L)', v_b)) = '2'
    and pg_temp.val_as('authenticated', b1, 'select (count(*) > 0)::text from public.trips') = 'true');
  set local role service_role;
  begin
    perform public.submit_public_transportation_request('r4e-int-org-b', 'R4E-REACT-1', 'R4E Requester B', 'self', '555-0302', 'R4E pickup', 'R4E destination', 'no', null, null, null, null, null, 'https://b.r4e.example');
    v_r := 'ACCEPTED';
  exception when others then v_r := sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform pg_temp.report('RA-3 (reactivated org: the SAME integration accepts again; integration id unchanged; earlier data intact)',
    v_r = 'ACCEPTED'
    and exists (select 1 from public.request_intake_integrations where id = 'e4000000-0000-0000-0000-0000000000b1' and external_id = 'r4e-int-org-b' and is_active)
    and (select count(*) from public.request_intake_integrations where organization_id = v_b::uuid) = (select itg from r4e_snap), v_r);
  perform pg_temp.report('RA-4 (reactivation left multi-org c1 with both orgs again)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000c1', format('select public.is_org_member(%L)::text', v_b)) = 'true');
  perform pg_temp.report('RA-5 (pending invitation can be accepted again after reactivation)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', format('select public.accept_staff_invite(%L)', (select token from r4e_invite))) = 'OK');
end $$;
reset role;

-- =============================================================================
-- H. ACTIVITY (platform feed + tenant presentation)
-- =============================================================================
do $$
declare v_d1 uuid := '20000000-0000-0000-0000-0000000000d1';
begin
  perform pg_temp.report('AC-1 (platform activity: exactly the two lifecycle actions, newest first, org name + actor + reason; no other audit rows)',
    pg_temp.val_as('authenticated', v_d1, $q$select string_agg(action, ',' order by occurred_at desc, id desc) from public.platform_list_activity()$q$) = 'platform_organization_reactivated,platform_organization_suspended'
    and pg_temp.val_as('authenticated', v_d1, $q$select (bool_and(organization_name is not null) and bool_and(actor_name is not null) and bool_and(reason is not null))::text from public.platform_list_activity()$q$) = 'true');
  perform pg_temp.report('AC-2 (platform activity keyset pagination: limit 1 then before-cursor gives the other, then none)',
    pg_temp.val_as('authenticated', v_d1, $q$select (select count(*) from public.platform_list_activity(1))::text$q$) = '1'
    and pg_temp.val_as('authenticated', v_d1, $q$select a.action from public.platform_list_activity(1) a$q$) = 'platform_organization_reactivated'
    and pg_temp.val_as('authenticated', v_d1, $q$select b.action from public.platform_list_activity(1) a, public.platform_list_activity(1, a.occurred_at, a.id) b$q$) = 'platform_organization_suspended');
  perform pg_temp.report('AC-3 (tenant Admin of B sees the platform actions as "Nemryn", status-only before/after, NO reason and no platform admin identity)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000b1', $q$select string_agg(action || '/' || actor_name || '/' || (after_data ->> 'status') || '/' || (after_data ? 'reason')::text, ';' order by occurred_at) from public.list_activity_events('10000000-0000-0000-0000-0000000000b1') where action like 'platform%'$q$)
      = 'platform_organization_suspended/Nemryn/inactive/false;platform_organization_reactivated/Nemryn/active/false');
  perform pg_temp.report('AC-4 (Org A admin never sees Org B''s platform actions; platform activity is not callable by tenant users)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select count(*)::text from public.list_activity_events('10000000-0000-0000-0000-0000000000a1') where action like 'platform%'$q$) = '0'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', 'select * from public.platform_list_activity()') = 'ZW002');
end $$;
reset role;

-- =============================================================================
-- I. AUTHORITY SEPARATION: Platform Admin + Membership
-- =============================================================================
insert into public.platform_admin_grants (user_id, note) values ('20000000-0000-0000-0000-0000000000a2', 'R4E test grant: Org A dispatcher');
insert into public.memberships (organization_id, user_id, role, status) values ('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000d1', 'dispatcher', 'active');

do $$
declare v_a text := '10000000-0000-0000-0000-0000000000a1'; a2 uuid := '20000000-0000-0000-0000-0000000000a2'; d1 uuid := '20000000-0000-0000-0000-0000000000d1';
begin
  perform pg_temp.report('SEP-1 (Platform Admin d1 WITH a Dispatcher Membership in A: tenant permissions come from THAT role only -- dispatcher yes, organization_admin no)',
    pg_temp.val_as('authenticated', d1, format('select public.has_org_role(%L, array[''dispatcher''])::text', v_a)) = 'true'
    and pg_temp.val_as('authenticated', d1, format('select public.has_org_role(%L, array[''organization_admin''])::text', v_a)) = 'false'
    and pg_temp.try_as('authenticated', d1, format('select public.set_notification_settings(%L, ''website_request'', array[''dispatcher''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', d1, format('select public.update_organization_settings(%L, ''{"business_phone":"555-0100"}''::jsonb)', v_a)) = 'ZW002');
  perform pg_temp.report('SEP-2 (Dispatcher a2 WITH a PlatformAdminGrant: platform functions work, but tenant Admin authority is NOT gained; Org B stays denied)',
    pg_temp.try_as('authenticated', a2, 'select * from public.platform_get_overview()') = 'OK'
    and pg_temp.val_as('authenticated', a2, format('select public.has_org_role(%L, array[''organization_admin''])::text', v_a)) = 'false'
    and pg_temp.try_as('authenticated', a2, format('select public.set_notification_settings(%L, ''website_request'', array[''dispatcher''])', v_a)) = 'ZW002'
    and pg_temp.val_as('authenticated', a2, $q$select public.is_org_member('10000000-0000-0000-0000-0000000000b1')::text$q$) = 'false');
  perform pg_temp.report('SEP-3 (PlatformAdminGrant alone never satisfies has_org_role / is_org_member / current_driver_id for any org)',
    pg_temp.val_as('authenticated', d1, $q$select public.is_org_member('10000000-0000-0000-0000-0000000000b1')::text$q$) = 'false'
    and pg_temp.val_as('authenticated', d1, $q$select public.has_org_role('10000000-0000-0000-0000-0000000000b1', array['organization_admin','dispatcher','driver'])::text$q$) = 'false'
    and pg_temp.val_as('authenticated', d1, $q$select (public.current_driver_id('10000000-0000-0000-0000-0000000000b1') is null)::text$q$) = 'true');
end $$;
reset role;

-- Platform Admin without Membership: every tenant mutation family denied (Org A active)
do $$
declare v_a text := '10000000-0000-0000-0000-0000000000a1'; p uuid := '20000000-0000-0000-0000-0000000000fe';
begin
  -- a Platform Admin with no Membership anywhere (fresh synthetic user)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', p, 'authenticated', 'authenticated', 'r4e-platform-only@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', '');
  insert into public.platform_admin_grants (user_id, note) values (p, 'R4E test: platform only');
  perform pg_temp.report('TM-1 (Platform Admin, NO Membership: settings / integrations / services / team / notification prefs / schedule mutations all ZW002)',
    pg_temp.try_as('authenticated', p, format('select public.update_organization_settings(%L, ''{"business_phone":"555-0100"}''::jsonb)', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', p, format('select public.create_request_intake_integration(%L, ''https://evil.example'')', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', p, format('select public.set_organization_service_offerings(%L, array[''medical_appointments''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', p, format('select public.create_staff_invite(%L, ''pa-invite@example.test'', ''organization_admin'')', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', p, format('select public.set_notification_settings(%L, ''website_request'', array[''dispatcher''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', p, format('select public.update_organization_operating_schedule(%L, array[1,2]::smallint[], ''08:00'', ''17:00'')', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', p, $q$select public.change_membership_role((select id from public.memberships where user_id = '20000000-0000-0000-0000-0000000000a2' limit 1), 'organization_admin')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', p, format('select * from public.list_request_intake_integrations(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', p, format('select * from public.list_activity_events(%L)', v_a)) = 'ZW002');
  perform pg_temp.report('TM-2 (the only tenant-affecting Platform mutation is lifecycle status: Org A settings unchanged by all of the above)',
    (select business_phone is distinct from '555-0100' from public.organizations where id = v_a::uuid)
    and not exists (select 1 from public.staff_invites where lower(email) = 'pa-invite@example.test')
    and (select count(*) from public.request_intake_integrations where organization_id = v_a::uuid) = 1);
end $$;
reset role;

-- =============================================================================
-- J. EXPOSURE
-- =============================================================================
do $$
begin
  perform pg_temp.report('EX-1 (every platform_* function and set_platform_organization_status: no PUBLIC / anon EXECUTE; authenticated only)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'platform\_%' or p.proname = 'set_platform_organization_status')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')
             or not has_function_privilege('authenticated', p.oid, 'execute'))) = 0
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'platform\_%' or p.proname = 'set_platform_organization_status')) = 7);
  perform pg_temp.report('EX-2 (all new definer functions pin search_path)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'platform\_%' or p.proname in ('set_platform_organization_status', '_require_platform_admin'))
        and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) = 0);
  perform pg_temp.report('EX-3 (no direct client write path to organizations.status remains: no UPDATE grant on the column for authenticated / anon)',
    not has_column_privilege('authenticated', 'public.organizations', 'status', 'update')
    and not has_column_privilege('anon', 'public.organizations', 'status', 'update'));
  perform pg_temp.report('EX-4 (no platform impersonation / support-session function exists)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ~* '(impersonat|support_session|login_as|act_as)') = 0);
end $$;

-- =============================================================================
-- cleanup (owner level) -- restore the seeded state for the other suites
-- =============================================================================
delete from public.notification_events where organization_id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
delete from public.request_events where request_id in (select id from public.transportation_requests where external_submission_ref like 'R4E-%');
delete from public.transportation_requests where external_submission_ref like 'R4E-%';
delete from public.request_intake_integrations where id in ('e4000000-0000-0000-0000-0000000000a1', 'e4000000-0000-0000-0000-0000000000b1');
delete from public.memberships where user_id = '20000000-0000-0000-0000-0000000000d1' and organization_id = '10000000-0000-0000-0000-0000000000a1';
delete from public.memberships where user_id = '20000000-0000-0000-0000-0000000000e1';
delete from public.staff_invites where organization_id = '10000000-0000-0000-0000-0000000000b1';
delete from public.platform_admin_grants where user_id in ('20000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-0000000000fe');
delete from auth.users where id = '20000000-0000-0000-0000-0000000000fe';
delete from public.audit_events where organization_id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
update public.organizations set status = 'active' where status <> 'active';
