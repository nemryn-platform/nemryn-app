-- Nemryn — P1-OPS-PROG4 trip expected duration tests (migration 20260925100000_trip_expected_duration.sql).
--
-- Covers: create_trip duration / organization-default snapshot semantics, bounds 1..2880, old-caller
-- compatibility, Request-linked creation, recurring occurrence snapshot, set_trip_expected_duration,
-- update_organization_trip_defaults, role / cross-tenant denial, and direct-column-write denial.
-- Same SET ROLE / request.jwt.claim.sub methodology as every other suite. The WHOLE suite runs inside one
-- transaction that is ROLLED BACK at the end, so it can be re-run against any seeded local database.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/trip_expected_duration_tests.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

-- Fixtures (Org A = 10..a1 / admin 20..a1 / dispatcher 20..a2 / driver 20..a3; Org B = 10..b1 / admin 20..b1)
update public.organizations set default_trip_duration_minutes = null where id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
insert into public.transportation_requests (id, organization_id, passenger_id, requester_name, requester_relationship,
  requester_phone, pickup_description, destination_description, return_trip_needed, state)
values ('95000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
  'PROG4 Requester', 'self', '555-0400', 'PROG4 req pickup', 'PROG4 req destination', 'no', 'accepted');
create temp table t_ids (k text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

-- ---------------------------------------------------------------------------
-- create_trip: no duration + no default -> UNKNOWN (NULL/NULL)
-- ---------------------------------------------------------------------------
do $$
declare v public.trip_creation_result; t public.trips;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'P4 none', 'P4 dest', now() + interval '1 day');
  reset role;
  select * into t from public.trips where id = v.trip_id;
  insert into t_ids values ('none', v.trip_id);
  raise notice 'TEST CT-1 (no duration, no default -> unknown): %', case when t.expected_duration_minutes is null and t.expected_duration_source is null then 'PASS' else 'FAIL' end;
end $$;
reset role;

-- explicit duration -> source 'trip'
do $$
declare v public.trip_creation_result; t public.trips;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  v := public.create_trip(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P4 explicit', p_destination_description => 'P4 dest', p_scheduled_pickup_at => now() + interval '1 day', p_expected_duration_minutes => 45);
  reset role;
  select * into t from public.trips where id = v.trip_id;
  raise notice 'TEST CT-2 (explicit 45 -> trip, dispatcher): %', case when t.expected_duration_minutes = 45 and t.expected_duration_source = 'trip' then 'PASS' else 'FAIL' end;
end $$;
reset role;

-- bounds: 1 and 2880 accepted; 0 and 2881 rejected (ZW006)
do $$
declare v public.trip_creation_result; t1 public.trips; t2 public.trips; ok0 boolean := false; ok2881 boolean := false;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v := public.create_trip(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P4 one', p_destination_description => 'd', p_expected_duration_minutes => 1);
  select * into t1 from public.trips where id = v.trip_id;
  v := public.create_trip(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P4 max', p_destination_description => 'd', p_expected_duration_minutes => 2880);
  select * into t2 from public.trips where id = v.trip_id;
  begin
    v := public.create_trip(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
      p_pickup_description => 'P4 zero', p_destination_description => 'd', p_expected_duration_minutes => 0);
  exception when sqlstate 'ZW006' then ok0 := true; end;
  begin
    v := public.create_trip(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
      p_pickup_description => 'P4 over', p_destination_description => 'd', p_expected_duration_minutes => 2881);
  exception when sqlstate 'ZW006' then ok2881 := true; end;
  reset role;
  raise notice 'TEST CT-3 (1 and 2880 accepted): %', case when t1.expected_duration_minutes = 1 and t2.expected_duration_minutes = 2880 then 'PASS' else 'FAIL' end;
  raise notice 'TEST CT-4 (0 rejected ZW006): %', case when ok0 then 'PASS' else 'FAIL' end;
  raise notice 'TEST CT-5 (2881 rejected ZW006): %', case when ok2881 then 'PASS' else 'FAIL' end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Organization default: admin sets it; snapshot; override; change does not touch existing trips
-- ---------------------------------------------------------------------------
do $$
declare r public.organization_trip_defaults_result; r2 public.organization_trip_defaults_result;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  r := public.update_organization_trip_defaults('10000000-0000-0000-0000-0000000000a1', 50);
  r2 := public.update_organization_trip_defaults('10000000-0000-0000-0000-0000000000a1', 50);
  reset role;
  raise notice 'TEST OD-1 (admin sets default 50; changed then idempotent): %', case when r.changed and not r2.changed and r.default_trip_duration_minutes = 50 then 'PASS' else 'FAIL' end;
  raise notice 'TEST OD-2 (default audited): %', case when exists (select 1 from public.audit_events where entity_id = '10000000-0000-0000-0000-0000000000a1' and action = 'organization_trip_defaults_updated' and after_data->>'default_trip_duration_minutes' = '50') then 'PASS' else 'FAIL' end;
end $$;
reset role;

do $$
declare v public.trip_creation_result; v2 public.trip_creation_result; t public.trips; t2 public.trips;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'P4 default', 'P4 dest', now() + interval '1 day');
  v2 := public.create_trip(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P4 override', p_destination_description => 'd', p_expected_duration_minutes => 90);
  reset role;
  select * into t from public.trips where id = v.trip_id;
  select * into t2 from public.trips where id = v2.trip_id;
  insert into t_ids values ('default', v.trip_id);
  raise notice 'TEST CT-6 (default only -> snapshot 50 organization_default): %', case when t.expected_duration_minutes = 50 and t.expected_duration_source = 'organization_default' then 'PASS' else 'FAIL' end;
  raise notice 'TEST CT-7 (explicit overrides default -> 90 trip): %', case when t2.expected_duration_minutes = 90 and t2.expected_duration_source = 'trip' then 'PASS' else 'FAIL' end;
end $$;
reset role;

do $$
declare r public.organization_trip_defaults_result; t public.trips; tn public.trips;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  r := public.update_organization_trip_defaults('10000000-0000-0000-0000-0000000000a1', 75);
  reset role;
  select * into t from public.trips where id = (select id from t_ids where k = 'default');
  select * into tn from public.trips where id = (select id from t_ids where k = 'none');
  raise notice 'TEST OD-3 (changing default does not modify existing trips): %', case when t.expected_duration_minutes = 50 and t.expected_duration_source = 'organization_default' and tn.expected_duration_minutes is null then 'PASS' else 'FAIL' end;
end $$;
reset role;

-- Old-caller compatibility: the 11 pre-PROG4 named arguments still resolve (and snapshot the default 75)
do $$
declare v public.trip_creation_result; t public.trips;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v := public.create_trip(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P4 legacy', p_destination_description => 'd', p_scheduled_pickup_at => now() + interval '2 days', p_appointment_at => null,
    p_pickup_facility_id => null, p_destination_facility_id => null, p_assistance_notes => null, p_instructions => null, p_request_id => null);
  reset role;
  select * into t from public.trips where id = v.trip_id;
  raise notice 'TEST COMPAT-1 (legacy 11 named args resolve; default snapshot): %', case when v.created and t.expected_duration_minutes = 75 then 'PASS' else 'FAIL' end;
  raise notice 'TEST COMPAT-2 (exactly one create_trip overload): %', case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_trip') = 1 then 'PASS' else 'FAIL' end;
end $$;
reset role;

-- Request-linked create_trip with an explicit duration
do $$
declare v public.trip_creation_result; t public.trips;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v := public.create_trip(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P4 from request', p_destination_description => 'd', p_request_id => '95000000-0000-0000-0000-0000000000a1', p_expected_duration_minutes => 30);
  reset role;
  select * into t from public.trips where id = v.trip_id;
  raise notice 'TEST REQ-1 (Request-linked create with duration 30): %', case when t.request_id = '95000000-0000-0000-0000-0000000000a1' and t.expected_duration_minutes = 30 and t.expected_duration_source = 'trip' then 'PASS' else 'FAIL' end;
end $$;
reset role;

-- Recurring occurrence snapshots the organization default in force (75)
do $$
declare v_arr uuid; v_date date; r record; t public.trips;
begin
  insert into public.recurring_arrangements (organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, created_by)
  values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'P4 rec pickup', 'P4 rec dest', '09:00', '{1,2,3,4,5,6,7}',
          (now() at time zone 'America/New_York')::date, 'America/New_York', '20000000-0000-0000-0000-0000000000a1')
  returning id into v_arr;
  v_date := (now() at time zone 'America/New_York')::date + 3;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select * into r from public.create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1', v_arr, v_date);
  reset role;
  select * into t from public.trips where id = r.trip_id;
  raise notice 'TEST REC-1 (recurring occurrence resolves positional create_trip + snapshots default 75): %', case when t.recurring_arrangement_id = v_arr and t.expected_duration_minutes = 75 and t.expected_duration_source = 'organization_default' then 'PASS' else 'FAIL' end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- set_trip_expected_duration
-- ---------------------------------------------------------------------------
do $$
declare r public.trip_expected_duration_result; r2 public.trip_expected_duration_result; r3 public.trip_expected_duration_result; t public.trips; v_trip uuid;
begin
  v_trip := (select id from t_ids where k = 'default');
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  r := public.set_trip_expected_duration(v_trip, 40);
  r2 := public.set_trip_expected_duration(v_trip, 40);
  r3 := public.set_trip_expected_duration(v_trip, null);
  reset role;
  select * into t from public.trips where id = v_trip;
  raise notice 'TEST SET-1 (dispatcher sets 40 -> trip, changed): %', case when r.changed and r.expected_duration_minutes = 40 and r.expected_duration_source = 'trip' then 'PASS' else 'FAIL' end;
  raise notice 'TEST SET-2 (idempotent re-set -> changed false): %', case when not r2.changed then 'PASS' else 'FAIL' end;
  raise notice 'TEST SET-3 (clear -> UNKNOWN; default 75 NOT re-applied): %', case when r3.changed and t.expected_duration_minutes is null and t.expected_duration_source is null then 'PASS' else 'FAIL' end;
  raise notice 'TEST SET-4 (audited): %', case when (select count(*) from public.audit_events where entity_id = v_trip and action = 'trip_expected_duration_updated') = 2 then 'PASS' else 'FAIL' end;
end $$;
reset role;

do $$
declare ok_bound boolean := false; ok_term boolean := false; v_trip uuid;
begin
  v_trip := (select id from t_ids where k = 'none');
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin perform public.set_trip_expected_duration(v_trip, 2881); exception when sqlstate 'ZW006' then ok_bound := true; end;
  reset role;
  update public.trips set state = 'cancelled', cancelled_at = now() where id = v_trip;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin perform public.set_trip_expected_duration(v_trip, 30); exception when sqlstate 'ZW004' then ok_term := true; end;
  reset role;
  raise notice 'TEST SET-5 (2881 rejected ZW006): %', case when ok_bound then 'PASS' else 'FAIL' end;
  raise notice 'TEST SET-6 (terminal trip rejected ZW004): %', case when ok_term then 'PASS' else 'FAIL' end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Authorization / adversarial
-- ---------------------------------------------------------------------------
do $$
declare v_trip uuid := (select id from t_ids where k = 'default'); results text := '';
begin
  -- Driver of the same org
  begin
    set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
    perform public.set_trip_expected_duration(v_trip, 20); results := results || 'driver-set:ALLOWED ';
  exception when sqlstate 'ZW002' then results := results || 'driver-set:denied '; end;
  reset role;
  begin
    set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
    perform public.update_organization_trip_defaults('10000000-0000-0000-0000-0000000000a1', 20); results := results || 'driver-default:ALLOWED ';
  exception when sqlstate 'ZW002' then results := results || 'driver-default:denied '; end;
  reset role;
  -- Dispatcher cannot change the organization default
  begin
    set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
    perform public.update_organization_trip_defaults('10000000-0000-0000-0000-0000000000a1', 20); results := results || 'dispatcher-default:ALLOWED ';
  exception when sqlstate 'ZW002' then results := results || 'dispatcher-default:denied '; end;
  reset role;
  -- Org B admin / dispatcher against Org A
  begin
    set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
    perform public.set_trip_expected_duration(v_trip, 20); results := results || 'orgB-admin-set:ALLOWED ';
  exception when sqlstate 'ZW002' then results := results || 'orgB-admin-set:denied '; end;
  reset role;
  begin
    set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b2';
    perform public.set_trip_expected_duration(v_trip, 20); results := results || 'orgB-dispatcher-set:ALLOWED ';
  exception when sqlstate 'ZW002' then results := results || 'orgB-dispatcher-set:denied '; end;
  reset role;
  begin
    set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
    perform public.update_organization_trip_defaults('10000000-0000-0000-0000-0000000000a1', 20); results := results || 'orgB-admin-default:ALLOWED ';
  exception when sqlstate 'ZW002' then results := results || 'orgB-admin-default:denied '; end;
  reset role;
  raise notice 'TEST AUTH-1 (driver / dispatcher-default / cross-tenant all denied ZW002): % [%]',
    case when results not like '%ALLOWED%' then 'PASS' else 'FAIL' end, results;
end $$;
reset role;

do $$
declare ok1 boolean := false; ok2 boolean := false; ok3 boolean := false; v_trip uuid := (select id from t_ids where k = 'default'); n int;
begin
  begin
    set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    update public.trips set expected_duration_minutes = 10, expected_duration_source = 'trip' where id = v_trip;
  exception when insufficient_privilege then ok1 := true; end;
  reset role;
  begin
    set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    update public.organizations set default_trip_duration_minutes = 10 where id = '10000000-0000-0000-0000-0000000000a1';
  exception when insufficient_privilege then ok2 := true; end;
  reset role;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  select count(*) into n from public.trips where id = v_trip;
  reset role;
  ok3 := n = 0;
  raise notice 'TEST DIRECT-1 (client UPDATE of trips duration columns denied): %', case when ok1 then 'PASS' else 'FAIL' end;
  raise notice 'TEST DIRECT-2 (client UPDATE of organizations default denied): %', case when ok2 then 'PASS' else 'FAIL' end;
  raise notice 'TEST TENANT-1 (Org B cannot read Org A trip incl. duration): %', case when ok3 then 'PASS' else 'FAIL' end;
end $$;
reset role;

do $$
begin
  raise notice 'TEST PRIV-1 (no column UPDATE grant on new columns): %', case when not exists (
    select 1 from information_schema.column_privileges where table_schema = 'public' and grantee in ('authenticated', 'anon')
      and privilege_type <> 'SELECT'
      and ((table_name = 'trips' and column_name in ('expected_duration_minutes', 'expected_duration_source'))
        or (table_name = 'organizations' and column_name = 'default_trip_duration_minutes'))) then 'PASS' else 'FAIL' end;
  raise notice 'TEST PRIV-2 (new RPCs: authenticated yes, anon/public no, search_path pinned): %', case when
    has_function_privilege('authenticated', 'public.set_trip_expected_duration(uuid,integer)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.update_organization_trip_defaults(uuid,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_trip_expected_duration(uuid,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.update_organization_trip_defaults(uuid,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_trip(uuid,uuid,text,text,timestamptz,timestamptz,uuid,uuid,text,text,uuid,integer)', 'EXECUTE')
    and (select bool_and(p.proconfig::text like '%search_path=public, pg_temp%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('create_trip', 'set_trip_expected_duration', 'update_organization_trip_defaults'))
    then 'PASS' else 'FAIL' end;
end $$;

rollback;

do $$ begin raise notice '=== Trip expected duration test suite complete (rolled back) ==='; end $$;
