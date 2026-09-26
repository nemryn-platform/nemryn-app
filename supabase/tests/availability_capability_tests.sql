-- Nemryn — P1-OPS-PROG5 availability + vehicle capability tests (migration 20260926100000_availability_capability.sql).
--
-- Covers: explicit schedule-configured state, weekly-shift setter validation (split, overnight, end-at-midnight,
-- Sunday->Monday ring overlap, touching boundaries, start = end, bounds), clear -> NOT SET, driver / vehicle
-- unavailability windows, Admin-only vehicle capabilities, trip + recurring wheelchair requirement (set / clear,
-- snapshot onto generated occurrences, no rewrite of existing trips), create_trip / create_recurring_arrangement /
-- occurrence-generator compatibility, direct-write denial, RLS reads, driver own-schedule boundary, cross-tenant
-- denial for every RPC, and function privileges.
-- Same SET ROLE / request.jwt.claim.sub methodology as every other suite. The WHOLE suite runs inside one transaction
-- that is ROLLED BACK at the end, so it can be re-run against any seeded local database.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/availability_capability_tests.sql
--
-- Identities (seed): Org A 10..a1 (admin 20..a1, dispatcher 20..a2, driver users 20..a3 -> driver 30..a1,
-- 20..a4 -> driver 30..a2); Org B 10..b1 (admin 20..b1, driver user 20..b3 -> driver 30..b1).
-- Vehicles: 50..a1, 50..a2 (Org A), 50..b1 (Org B). Passengers: 40..a1 (Org A).

\set ON_ERROR_STOP off
\pset pager off

begin;

create temp table t_ids (k text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

-- ---------------------------------------------------------------------------
-- Schedule: explicit NOT SET by default; admin sets split + overnight + midnight-end + Sunday overnight
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice 'TEST S-1 (no parent row -> NOT SET for every seeded driver): %',
    case when not exists (select 1 from public.driver_weekly_schedules) and not exists (select 1 from public.driver_weekly_shifts) then 'PASS' else 'FAIL' end;
end $$;

do $$
declare v public.driver_schedule_result; n int;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v := public.set_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a1', '[
    {"weekday":1,"start":"08:00","end":"12:00"},
    {"weekday":1,"start":"13:00","end":"17:00"},
    {"weekday":2,"start":"18:00","end":"00:00"},
    {"weekday":3,"start":"00:00","end":"04:00"},
    {"weekday":5,"start":"22:00","end":"06:00"},
    {"weekday":7,"start":"22:00","end":"02:00"},
    {"weekday":1,"start":"02:00","end":"06:00"}
  ]'::jsonb);
  reset role;
  select count(*) into n from public.driver_weekly_shifts where driver_id = '30000000-0000-0000-0000-0000000000a1';
  raise notice 'TEST S-2 (admin: split + overnight + end 00:00 + Sunday overnight touching Monday 02:00 -> CONFIGURED, 7 shifts): %',
    case when v.configured and v.changed and v.shift_count = 7 and n = 7
      and exists (select 1 from public.driver_weekly_schedules where driver_id = '30000000-0000-0000-0000-0000000000a1') then 'PASS' else 'FAIL' end;
end $$;
reset role;

do $$
declare v public.driver_schedule_result;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v := public.set_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a1', '[
    {"weekday":7,"start":"22:00","end":"02:00"},
    {"weekday":1,"start":"02:00","end":"06:00"},
    {"weekday":5,"start":"22:00","end":"06:00"},
    {"weekday":3,"start":"00:00","end":"04:00"},
    {"weekday":2,"start":"18:00","end":"00:00"},
    {"weekday":1,"start":"13:00","end":"17:00"},
    {"weekday":1,"start":"08:00","end":"12:00"}
  ]'::jsonb);
  reset role;
  raise notice 'TEST S-3 (same set, different order -> idempotent, changed=false): %', case when not v.changed then 'PASS' else 'FAIL' end;
end $$;
reset role;

do $$
declare v public.driver_schedule_result;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  v := public.set_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a2', '[{"weekday":2,"start":"09:00","end":"17:00"}]'::jsonb);
  reset role;
  raise notice 'TEST S-4 (dispatcher may configure a schedule): %', case when v.configured and v.changed then 'PASS' else 'FAIL' end;
end $$;
reset role;

-- Invalid inputs -> ZW006 (each in its own block)
do $$
declare cases jsonb[] := array[
  '[{"weekday":7,"start":"22:00","end":"02:00"},{"weekday":1,"start":"01:00","end":"05:00"}]'::jsonb,  -- Sunday overnight vs Monday 01:00 (ring wrap)
  '[{"weekday":1,"start":"08:00","end":"12:00"},{"weekday":1,"start":"11:00","end":"13:00"}]'::jsonb,  -- same-day overlap
  '[{"weekday":5,"start":"22:00","end":"06:00"},{"weekday":6,"start":"05:00","end":"09:00"}]'::jsonb,  -- Friday overnight vs Saturday
  '[{"weekday":1,"start":"09:00","end":"09:00"}]'::jsonb,                                             -- start = end
  '[{"weekday":8,"start":"09:00","end":"10:00"}]'::jsonb,                                             -- weekday 8
  '[{"weekday":0,"start":"09:00","end":"10:00"}]'::jsonb,                                             -- weekday 0
  '[{"weekday":1.5,"start":"09:00","end":"10:00"}]'::jsonb,                                           -- non-integer weekday
  '[{"weekday":1,"start":"24:00","end":"10:00"}]'::jsonb,                                             -- bad time
  '[{"weekday":1,"start":"9:00","end":"10:00"}]'::jsonb,                                              -- bad format
  '[]'::jsonb,                                                                                        -- empty
  '{"weekday":1}'::jsonb                                                                              -- not an array
]; c jsonb; st text; bad int := 0; i int := 0;
begin
  foreach c in array cases loop
    i := i + 1; st := null;
    begin
      set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
      perform public.set_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a2', c);
    exception when others then st := sqlstate;
    end;
    reset role;
    if st is distinct from 'ZW006' then bad := bad + 1; raise notice '  S-5 case % -> %', i, coalesce(st, 'accepted'); end if;
  end loop;
  raise notice 'TEST S-5 (ring wrap Sun->Mon overlap, same-day overlap, Fri->Sat overlap, start=end, bad weekday/time, empty, non-array -> ZW006): %', case when bad = 0 then 'PASS' else 'FAIL' end;
end $$;
reset role;

do $$
declare arr jsonb := '[]'::jsonb; d int; h int; st text;
begin
  for d in 1..7 loop for h in 0..4 loop
    arr := arr || jsonb_build_array(jsonb_build_object('weekday', d, 'start', to_char(make_time(h * 2, 0, 0), 'HH24:MI'), 'end', to_char(make_time(h * 2 + 1, 0, 0), 'HH24:MI')));
  end loop; end loop; -- 35 shifts
  begin
    set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.set_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a2', arr);
  exception when others then st := sqlstate;
  end;
  reset role;
  raise notice 'TEST S-6 (more than 28 shifts -> ZW006): %', case when st = 'ZW006' then 'PASS' else 'FAIL (' || coalesce(st, 'accepted') || ')' end;
end $$;
reset role;

do $$
declare v public.driver_schedule_result; v2 public.driver_schedule_result;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  v := public.clear_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a2');
  v2 := public.clear_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a2');
  reset role;
  raise notice 'TEST S-7 (clear -> NOT SET, shifts cascade; second clear idempotent): %',
    case when v.changed and not v.configured and not v2.changed
      and not exists (select 1 from public.driver_weekly_schedules where driver_id = '30000000-0000-0000-0000-0000000000a2')
      and not exists (select 1 from public.driver_weekly_shifts where driver_id = '30000000-0000-0000-0000-0000000000a2') then 'PASS' else 'FAIL' end;
end $$;
reset role;

do $$
declare st1 text; st2 text; st3 text; st4 text;
begin
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
    perform public.set_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a1', '[{"weekday":1,"start":"08:00","end":"09:00"}]'::jsonb);
  exception when others then st1 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
    perform public.clear_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a1');
  exception when others then st2 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
    perform public.set_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a1', '[{"weekday":1,"start":"08:00","end":"09:00"}]'::jsonb);
  exception when others then st3 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
    perform public.clear_driver_weekly_schedule('30000000-0000-0000-0000-0000000000a1');
  exception when others then st4 := sqlstate; end; reset role;
  raise notice 'TEST S-8 (driver set/clear own schedule denied; foreign admin set/clear denied -> ZW002): %',
    case when st1 = 'ZW002' and st2 = 'ZW002' and st3 = 'ZW002' and st4 = 'ZW002'
      and (select count(*) from public.driver_weekly_shifts where driver_id = '30000000-0000-0000-0000-0000000000a1') = 7 then 'PASS'
    else 'FAIL (' || concat_ws(',', st1, st2, st3, st4) || ')' end;
end $$;
reset role;

do $$
declare a public.audit_events;
begin
  select * into a from public.audit_events where entity_id = '30000000-0000-0000-0000-0000000000a1' and action = 'driver_schedule_set' order by occurred_at desc limit 1;
  raise notice 'TEST S-9 (audit driver_schedule_set: actor recorded, after_data = weekday/time facts only): %',
    case when a.actor_user_id = '20000000-0000-0000-0000-0000000000a1' and jsonb_array_length(a.after_data -> 'shifts') = 7
      and (select bool_and(jsonb_object_keys_ok) from (select (select array_agg(k order by k) from jsonb_object_keys(e) k) = array['end','start','weekday'] as jsonb_object_keys_ok from jsonb_array_elements(a.after_data -> 'shifts') e) q)
      and exists (select 1 from public.audit_events where entity_id = '30000000-0000-0000-0000-0000000000a2' and action = 'driver_schedule_cleared') then 'PASS' else 'FAIL' end;
end $$;

-- ---------------------------------------------------------------------------
-- Driver unavailability windows
-- ---------------------------------------------------------------------------
do $$
declare v public.unavailability_window_result; v2 public.unavailability_window_result; v3 public.unavailability_window_result;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v := public.save_driver_unavailability('30000000-0000-0000-0000-0000000000a1', now() + interval '2 days', now() + interval '3 days');
  reset role;
  insert into t_ids values ('win_a1', v.window_id);
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  v2 := public.save_driver_unavailability('30000000-0000-0000-0000-0000000000a1', now() + interval '2 days', now() + interval '4 days', v.window_id);
  v3 := public.save_driver_unavailability('30000000-0000-0000-0000-0000000000a1', v2.starts_at, v2.ends_at, v.window_id);
  reset role;
  raise notice 'TEST T-1 (admin creates, dispatcher updates, repeat is idempotent; audited add/change): %',
    case when v.changed and v2.changed and not v3.changed
      and exists (select 1 from public.audit_events where entity_id = '30000000-0000-0000-0000-0000000000a1' and action = 'driver_unavailability_added')
      and exists (select 1 from public.audit_events where entity_id = '30000000-0000-0000-0000-0000000000a1' and action = 'driver_unavailability_changed') then 'PASS' else 'FAIL' end;
end $$;
reset role;

do $$
declare st1 text; st2 text; st3 text; st4 text; st5 text; st6 text; w uuid;
begin
  select id into w from t_ids where k = 'win_a1';
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.save_driver_unavailability('30000000-0000-0000-0000-0000000000a1', now() + interval '2 days', now() + interval '2 days');
  exception when others then st1 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.save_driver_unavailability('30000000-0000-0000-0000-0000000000a1', now(), now() + interval '367 days');
  exception when others then st2 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
    perform public.save_driver_unavailability('30000000-0000-0000-0000-0000000000a1', now() + interval '5 days', now() + interval '6 days');
  exception when others then st3 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
    perform public.save_driver_unavailability('30000000-0000-0000-0000-0000000000a1', now() + interval '5 days', now() + interval '6 days');
  exception when others then st4 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
    perform public.delete_driver_unavailability(w);
  exception when others then st5 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.save_driver_unavailability('30000000-0000-0000-0000-0000000000a2', now() + interval '2 days', now() + interval '3 days', w); -- window of A1 via A2
  exception when others then st6 := sqlstate; end; reset role;
  raise notice 'TEST T-2 (ends<=starts / >366 days -> ZW006; driver write, foreign save/delete, cross-driver window id -> ZW002): %',
    case when st1 = 'ZW006' and st2 = 'ZW006' and st3 = 'ZW002' and st4 = 'ZW002' and st5 = 'ZW002' and st6 = 'ZW002' then 'PASS'
    else 'FAIL (' || concat_ws(',', st1, st2, st3, st4, st5, st6) || ')' end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Vehicle out-of-service windows
-- ---------------------------------------------------------------------------
do $$
declare v public.unavailability_window_result; v2 public.unavailability_window_result; d public.unavailability_window_result; st1 text; st2 text;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  v := public.save_vehicle_unavailability('50000000-0000-0000-0000-0000000000a1', now() + interval '1 day', now() + interval '1 day 4 hours');
  v2 := public.save_vehicle_unavailability('50000000-0000-0000-0000-0000000000a1', now() + interval '1 day', now() + interval '1 day 6 hours', v.window_id);
  reset role;
  insert into t_ids values ('vwin', v.window_id);
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
    perform public.save_vehicle_unavailability('50000000-0000-0000-0000-0000000000a1', now() + interval '2 day', now() + interval '2 day 1 hour');
  exception when others then st1 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
    perform public.delete_vehicle_unavailability(v.window_id);
  exception when others then st2 := sqlstate; end; reset role;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  d := public.delete_vehicle_unavailability(v.window_id);
  reset role;
  raise notice 'TEST V-1 (dispatcher creates/updates, admin deletes; driver + foreign denied; vehicles.status untouched): %',
    case when v.changed and v2.changed and d.deleted and st1 = 'ZW002' and st2 = 'ZW002'
      and (select status from public.vehicles where id = '50000000-0000-0000-0000-0000000000a1') = 'active'
      and exists (select 1 from public.audit_events where entity_id = '50000000-0000-0000-0000-0000000000a1' and action = 'vehicle_unavailability_removed') then 'PASS'
    else 'FAIL (' || concat_ws(',', st1, st2) || ')' end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Vehicle capabilities (Organization Admin ONLY)
-- ---------------------------------------------------------------------------
do $$
declare v public.vehicle_capabilities_result; v2 public.vehicle_capabilities_result; st1 text; st2 text; st3 text; st4 text; veh public.vehicles;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v := public.set_vehicle_capabilities('50000000-0000-0000-0000-0000000000a1', true, null, 2, 6);
  v2 := public.set_vehicle_capabilities('50000000-0000-0000-0000-0000000000a1', true, null, 2, 6);
  reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
    perform public.set_vehicle_capabilities('50000000-0000-0000-0000-0000000000a1', false, false, 0, 1);
  exception when others then st1 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
    perform public.set_vehicle_capabilities('50000000-0000-0000-0000-0000000000a1', false, false, 0, 1);
  exception when others then st2 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
    perform public.set_vehicle_capabilities('50000000-0000-0000-0000-0000000000a1', false, false, 0, 1);
  exception when others then st3 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.set_vehicle_capabilities('50000000-0000-0000-0000-0000000000a1', true, true, 21, 6);
  exception when others then st4 := sqlstate; end; reset role;
  select * into veh from public.vehicles where id = '50000000-0000-0000-0000-0000000000a1';
  raise notice 'TEST C-1 (admin sets ramp=true / lift=NULL(unknown) / positions 2 / seats 6; idempotent; dispatcher / driver / foreign -> ZW002; positions 21 -> ZW006; NULL stays unknown): %',
    case when v.changed and not v2.changed and st1 = 'ZW002' and st2 = 'ZW002' and st3 = 'ZW002' and st4 = 'ZW006'
      and veh.wheelchair_ramp and veh.wheelchair_lift is null and veh.wheelchair_positions = 2 and veh.seated_capacity = 6
      and exists (select 1 from public.audit_events where entity_id = veh.id and action = 'vehicle_capabilities_updated') then 'PASS'
    else 'FAIL (' || concat_ws(',', st1, st2, st3, st4) || ')' end;
  raise notice 'TEST C-2 (existing vehicles stay NULL = unknown; no backfill): %',
    case when (select wheelchair_ramp is null and wheelchair_lift is null and wheelchair_positions is null and seated_capacity is null from public.vehicles where id = '50000000-0000-0000-0000-0000000000a2') then 'PASS' else 'FAIL' end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Trip wheelchair requirement + create_trip compatibility
-- ---------------------------------------------------------------------------
do $$
declare v1 public.trip_creation_result; v2 public.trip_creation_result; v3 public.trip_creation_result; a public.audit_events; n int;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v1 := public.create_trip(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P5 wc', p_destination_description => 'd', p_scheduled_pickup_at => now() + interval '1 day', p_requires_wheelchair_access => true);
  v2 := public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'P5 legacy positional', 'd', now() + interval '1 day');
  v3 := public.create_trip(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P5 legacy named 12', p_destination_description => 'd', p_expected_duration_minutes => 30);
  reset role;
  insert into t_ids values ('trip_wc', v1.trip_id), ('trip_legacy', v2.trip_id);
  select * into a from public.audit_events where entity_id = v1.trip_id and action = 'trip_created';
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'create_trip';
  raise notice 'TEST R-1 (create_trip requirement=true stored + audited; legacy positional and 12-arg named callers resolve with NULL; exactly one overload): %',
    case when (select requires_wheelchair_access from public.trips where id = v1.trip_id) is true
      and (a.after_data ->> 'requires_wheelchair_access') = 'true'
      and (select requires_wheelchair_access from public.trips where id = v2.trip_id) is null
      and (select requires_wheelchair_access is null and expected_duration_minutes = 30 from public.trips where id = v3.trip_id)
      and n = 1 then 'PASS' else 'FAIL' end;
exception when others then
  reset role;
  raise notice 'TEST R-1 (create_trip compatibility): FAIL (% %)', sqlstate, sqlerrm;
end $$;
reset role;

do $$
declare t uuid; r1 public.wheelchair_requirement_result; r2 public.wheelchair_requirement_result; r3 public.wheelchair_requirement_result; st1 text; st2 text; st3 text; tdone public.trip_creation_result;
begin
  select id into t from t_ids where k = 'trip_legacy';
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  r1 := public.set_trip_wheelchair_requirement(t, false);
  r2 := public.set_trip_wheelchair_requirement(t, false);
  r3 := public.set_trip_wheelchair_requirement(t, null);
  reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
    perform public.set_trip_wheelchair_requirement(t, true);
  exception when others then st1 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
    perform public.set_trip_wheelchair_requirement(t, true);
  exception when others then st2 := sqlstate; end; reset role;
  update public.trips set state = 'cancelled', cancelled_at = now() where id = (select id from t_ids where k = 'trip_wc');
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.set_trip_wheelchair_requirement((select id from t_ids where k = 'trip_wc'), false);
  exception when others then st3 := sqlstate; end; reset role;
  raise notice 'TEST R-2 (dispatcher sets false, idempotent, clears to NULL; driver + foreign -> ZW002; terminal trip -> ZW004): %',
    case when r1.changed and not r2.changed and r3.changed and (select requires_wheelchair_access from public.trips where id = t) is null
      and st1 = 'ZW002' and st2 = 'ZW002' and st3 = 'ZW004'
      and (select count(*) from public.audit_events where entity_id = t and action = 'trip_wheelchair_requirement_updated') = 2 then 'PASS'
    else 'FAIL (' || concat_ws(',', st1, st2, st3) || ')' end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Recurring requirement: create / legacy create / setter / snapshot onto occurrences / no rewrite
-- ---------------------------------------------------------------------------
do $$
declare a_true public.recurring_arrangement_result; a_false public.recurring_arrangement_result; a_null public.recurring_arrangement_result;
  tz text; svc date;
  o_true public.trip_creation_result; o_false public.trip_creation_result; o_null public.trip_creation_result; o_again public.trip_creation_result;
  r public.wheelchair_requirement_result;
begin
  select timezone into tz from public.organizations where id = '10000000-0000-0000-0000-0000000000a1';
  svc := (now() at time zone tz)::date + 2;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  a_true := public.create_recurring_arrangement(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P5 rc true', p_destination_description => 'd', p_pickup_time => '10:00', p_days_of_week => array[1,2,3,4,5,6,7]::smallint[],
    p_start_date => (now() at time zone tz)::date, p_requires_wheelchair_access => true);
  a_false := public.create_recurring_arrangement(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P5 rc false', p_destination_description => 'd', p_pickup_time => '11:00', p_days_of_week => array[1,2,3,4,5,6,7]::smallint[],
    p_start_date => (now() at time zone tz)::date, p_requires_wheelchair_access => false);
  -- legacy 8-argument named call (no requirement) still resolves -> NULL
  a_null := public.create_recurring_arrangement(p_organization_id => '10000000-0000-0000-0000-0000000000a1', p_passenger_id => '40000000-0000-0000-0000-0000000000a1',
    p_pickup_description => 'P5 rc null', p_destination_description => 'd', p_pickup_time => '12:00', p_days_of_week => array[1,2,3,4,5,6,7]::smallint[],
    p_start_date => (now() at time zone tz)::date);
  o_true := public.create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1', a_true.arrangement_id, svc);
  o_false := public.create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1', a_false.arrangement_id, svc);
  o_null := public.create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1', a_null.arrangement_id, svc);
  reset role;
  raise notice 'TEST RC-1 (arrangement true/false/NULL stored; legacy 8-arg named create resolves; occurrence SNAPSHOT true/false/NULL; linked to arrangement): %',
    case when (select requires_wheelchair_access from public.recurring_arrangements where id = a_true.arrangement_id) is true
      and (select requires_wheelchair_access from public.recurring_arrangements where id = a_false.arrangement_id) is false
      and (select requires_wheelchair_access from public.recurring_arrangements where id = a_null.arrangement_id) is null
      and (select requires_wheelchair_access from public.trips where id = o_true.trip_id) is true
      and (select requires_wheelchair_access from public.trips where id = o_false.trip_id) is false
      and (select requires_wheelchair_access from public.trips where id = o_null.trip_id) is null
      and (select recurring_arrangement_id from public.trips where id = o_true.trip_id) = a_true.arrangement_id
      and o_true.created and o_false.created and o_null.created then 'PASS' else 'FAIL' end;

  -- Change the arrangement afterwards: the existing occurrence is NOT rewritten; idempotent re-call returns it unchanged;
  -- a NEW occurrence (next date) snapshots the NEW value.
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  r := public.set_recurring_wheelchair_requirement('10000000-0000-0000-0000-0000000000a1', a_true.arrangement_id, false);
  o_again := public.create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1', a_true.arrangement_id, svc);
  o_null := public.create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1', a_true.arrangement_id, svc + 1);
  reset role;
  raise notice 'TEST RC-2 (dispatcher changes arrangement true->false: existing occurrence stays true; idempotent re-call returns it (created=false); next occurrence snapshots false; audited): %',
    case when r.changed and (select requires_wheelchair_access from public.trips where id = o_true.trip_id) is true
      and o_again.trip_id = o_true.trip_id and not o_again.created
      and (select requires_wheelchair_access from public.trips where id = o_null.trip_id) is false
      and exists (select 1 from public.audit_events where entity_id = a_true.arrangement_id and action = 'recurring_arrangement_wheelchair_requirement_updated') then 'PASS' else 'FAIL' end;
  insert into t_ids values ('arr_null', a_null.arrangement_id);
exception when others then
  reset role;
  raise notice 'TEST RC-1/RC-2 (recurring requirement): FAIL (% %)', sqlstate, sqlerrm;
end $$;
reset role;

do $$
declare arr uuid; st1 text; st2 text; st3 text; r public.wheelchair_requirement_result;
begin
  select id into arr from t_ids where k = 'arr_null';
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  r := public.set_recurring_wheelchair_requirement('10000000-0000-0000-0000-0000000000a1', arr, true);
  perform public.set_recurring_wheelchair_requirement('10000000-0000-0000-0000-0000000000a1', arr, null);
  reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
    perform public.set_recurring_wheelchair_requirement('10000000-0000-0000-0000-0000000000a1', arr, true);
  exception when others then st1 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
    perform public.set_recurring_wheelchair_requirement('10000000-0000-0000-0000-0000000000a1', arr, true);
  exception when others then st2 := sqlstate; end; reset role;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform public.end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1', arr, 'P5 test end');
  reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.set_recurring_wheelchair_requirement('10000000-0000-0000-0000-0000000000a1', arr, true);
  exception when others then st3 := sqlstate; end; reset role;
  raise notice 'TEST RC-3 (admin set/clear; foreign + driver -> ZW002; ended arrangement -> ZW004; existing arrangements untouched = NULL): %',
    case when r.changed and (select requires_wheelchair_access from public.recurring_arrangements where id = arr) is null
      and st1 = 'ZW002' and st2 = 'ZW002' and st3 = 'ZW004'
      and not exists (select 1 from public.recurring_arrangements where pickup_description not like 'P5 rc%' and requires_wheelchair_access is not null) then 'PASS'
    else 'FAIL (' || concat_ws(',', st1, st2, st3) || ')' end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Direct writes denied; RLS reads; driver own-schedule boundary
-- ---------------------------------------------------------------------------
do $$
declare denied int := 0; total int := 0; stmt text;
begin
  foreach stmt in array array[
    'insert into public.driver_weekly_schedules (driver_id, organization_id) values (''30000000-0000-0000-0000-0000000000a2'', ''10000000-0000-0000-0000-0000000000a1'')',
    'insert into public.driver_weekly_shifts (organization_id, driver_id, weekday, start_time, end_time) values (''10000000-0000-0000-0000-0000000000a1'', ''30000000-0000-0000-0000-0000000000a1'', 4, ''08:00'', ''09:00'')',
    'update public.driver_weekly_shifts set end_time = ''23:00''',
    'delete from public.driver_weekly_schedules',
    'insert into public.driver_unavailability_windows (organization_id, driver_id, starts_at, ends_at) values (''10000000-0000-0000-0000-0000000000a1'', ''30000000-0000-0000-0000-0000000000a1'', now(), now() + interval ''1 hour'')',
    'delete from public.driver_unavailability_windows',
    'insert into public.vehicle_unavailability_windows (organization_id, vehicle_id, starts_at, ends_at) values (''10000000-0000-0000-0000-0000000000a1'', ''50000000-0000-0000-0000-0000000000a1'', now(), now() + interval ''1 hour'')',
    'update public.vehicles set wheelchair_ramp = false where id = ''50000000-0000-0000-0000-0000000000a1''',
    'update public.vehicles set wheelchair_positions = 9 where id = ''50000000-0000-0000-0000-0000000000a1''',
    'update public.trips set requires_wheelchair_access = true where organization_id = ''10000000-0000-0000-0000-0000000000a1''',
    'update public.recurring_arrangements set requires_wheelchair_access = true where organization_id = ''10000000-0000-0000-0000-0000000000a1'''
  ] loop
    total := total + 1;
    begin
      set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
      execute stmt;
      reset role;
      raise notice '  D-1 NOT denied: %', stmt;
    exception when insufficient_privilege then reset role; denied := denied + 1;
      when others then reset role; raise notice '  D-1 other error % for %', sqlstate, stmt;
    end;
  end loop;
  raise notice 'TEST D-1 (direct INSERT/UPDATE/DELETE on new tables + new vehicle/trip/arrangement columns denied to the ADMIN session): %', case when denied = total then 'PASS' else 'FAIL (' || denied || '/' || total || ')' end;
end $$;
reset role;

do $$
declare n_admin int; n_disp int; n_driver int; n_foreign int; n_foreign_w int;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select count(*) into n_admin from public.driver_weekly_shifts; reset role;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2';
  select count(*) into n_disp from public.driver_weekly_shifts; reset role;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
  select (select count(*) from public.driver_weekly_shifts) + (select count(*) from public.driver_weekly_schedules)
       + (select count(*) from public.driver_unavailability_windows) + (select count(*) from public.vehicle_unavailability_windows) into n_driver; reset role;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  select count(*) into n_foreign from public.driver_weekly_shifts;
  select count(*) into n_foreign_w from public.driver_unavailability_windows; reset role;
  raise notice 'TEST L-1 (RLS: Org A admin + dispatcher read Org A shifts; driver reads NOTHING directly; Org B admin reads no Org A rows): %',
    case when n_admin = 7 and n_disp = 7 and n_driver = 0 and n_foreign = 0 and n_foreign_w = 0 then 'PASS'
    else 'FAIL (' || concat_ws(',', n_admin, n_disp, n_driver, n_foreign, n_foreign_w) || ')' end;
end $$;
reset role;

do $$
declare own public.driver_own_schedule_result; other public.driver_own_schedule_result; st1 text; st2 text; st3 text;
begin
  -- a window for driver A2 must never appear in driver A1's own read
  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  perform public.save_driver_unavailability('30000000-0000-0000-0000-0000000000a2', now() + interval '1 day', now() + interval '2 days');
  perform public.save_driver_unavailability('30000000-0000-0000-0000-0000000000a1', now() + interval '20 days', now() + interval '21 days'); -- beyond 14 days
  reset role;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
  own := public.driver_get_own_schedule('10000000-0000-0000-0000-0000000000a1'); reset role;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a4';
  other := public.driver_get_own_schedule('10000000-0000-0000-0000-0000000000a1'); reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b3';
    perform public.driver_get_own_schedule('10000000-0000-0000-0000-0000000000a1');
  exception when others then st1 := sqlstate; end; reset role;
  begin set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
    perform public.driver_get_own_schedule('10000000-0000-0000-0000-0000000000a1');
  exception when others then st2 := sqlstate; end; reset role;
  begin set local role anon;
    perform public.driver_get_own_schedule('10000000-0000-0000-0000-0000000000a1');
  exception when others then st3 := sqlstate; end; reset role;
  raise notice 'TEST O-1 (driver A1 reads ONLY own: driver_id, configured, 7 shifts, 1 window within 14 days, timezone; driver A2 gets own NOT-SET view with only its own window; Org B driver + non-driver admin -> ZW002; anon denied): %',
    case when own.driver_id = '30000000-0000-0000-0000-0000000000a1' and own.configured and jsonb_array_length(own.shifts) = 7
      and jsonb_array_length(own.upcoming_unavailability) = 1 and own.timezone is not null
      and other.driver_id = '30000000-0000-0000-0000-0000000000a2' and not other.configured and jsonb_array_length(other.shifts) = 0
      and jsonb_array_length(other.upcoming_unavailability) = 1
      and st1 = 'ZW002' and st2 = 'ZW002' and st3 = '42501' then 'PASS'
    else 'FAIL (' || concat_ws(',', own.driver_id, own.configured, jsonb_array_length(own.shifts), jsonb_array_length(own.upcoming_unavailability), other.configured, st1, st2, st3) || ')' end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Function privileges (every new / replaced function)
-- ---------------------------------------------------------------------------
do $$
declare bad text := '';
  sig text;
begin
  foreach sig in array array[
    'public.set_driver_weekly_schedule(uuid,jsonb)', 'public.clear_driver_weekly_schedule(uuid)',
    'public.save_driver_unavailability(uuid,timestamptz,timestamptz,uuid)', 'public.delete_driver_unavailability(uuid)',
    'public.save_vehicle_unavailability(uuid,timestamptz,timestamptz,uuid)', 'public.delete_vehicle_unavailability(uuid)',
    'public.set_vehicle_capabilities(uuid,boolean,boolean,integer,integer)', 'public.set_trip_wheelchair_requirement(uuid,boolean)',
    'public.set_recurring_wheelchair_requirement(uuid,uuid,boolean)', 'public.driver_get_own_schedule(uuid)',
    'public.create_trip(uuid,uuid,text,text,timestamptz,timestamptz,uuid,uuid,text,text,uuid,integer,boolean)',
    'public.create_recurring_arrangement(uuid,uuid,text,text,time,smallint[],date,date,boolean)',
    'public.create_trip_for_recurring_occurrence(uuid,uuid,date)'
  ] loop
    if not has_function_privilege('authenticated', sig, 'EXECUTE') or has_function_privilege('anon', sig, 'EXECUTE')
       or has_function_privilege('public', sig, 'EXECUTE')
       or not (select prosecdef and coalesce(array_to_string(proconfig, ','), '') like '%search_path=public, pg_temp%' from pg_proc where oid = sig::regprocedure) then
      bad := bad || sig || ' ';
    end if;
  end loop;
  raise notice 'TEST P-1 (authenticated EXECUTE only; no anon / PUBLIC; SECURITY DEFINER; search_path pinned): %', case when bad = '' then 'PASS' else 'FAIL (' || bad || ')' end;
  raise notice 'TEST P-2 (single overloads: create_trip, create_recurring_arrangement): %',
    case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_trip') = 1
      and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_recurring_arrangement') = 1 then 'PASS' else 'FAIL' end;
  raise notice 'TEST P-3 (privacy: no reason / note / actor column on any new table): %',
    case when not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name in ('driver_weekly_schedules', 'driver_weekly_shifts', 'driver_unavailability_windows', 'vehicle_unavailability_windows')
      and (column_name ~ '(reason|note|comment|description|category|_by)$' or data_type in ('text', 'character varying', 'jsonb'))) then 'PASS' else 'FAIL' end;
end $$;

rollback;

do $$ begin raise notice '=== PROG5 availability + capability test suite complete (rolled back) ==='; end $$;
