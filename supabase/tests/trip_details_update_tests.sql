-- P1-PILOT-R2B -- update_trip_details + direct-UPDATE revocation (PR-01, PR-15, SEC-HYGIENE-2).
-- Fully transactional (BEGIN ... ROLLBACK): rerunnable, leaves nothing behind.
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/trip_details_update_tests.sql
-- Actor identity is the JWT subject (auth.uid()); the helper below runs update_trip_details with the Trip's CURRENT
-- values overridden by a jsonb patch and returns 'OK:<changed>:<fields>' or the SQLSTATE (a failed call is rolled back
-- to its own savepoint, so it can never leave a partial write). Role-level (anon / direct-table) checks use SET ROLE.
begin;

-- ---------------------------------------------------------------------------------------------- fixtures (postgres)
create function public.r2b_t(p_trip uuid, p_over jsonb, p_token timestamptz default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.trips; r public.trip_details_update_result;
begin
  select * into t from public.trips where id = p_trip;
  begin
    r := public.update_trip_details(p_trip, coalesce(p_token, t.updated_at),
      case when p_over ? 'scheduled_pickup_at' then (p_over->>'scheduled_pickup_at')::timestamptz else t.scheduled_pickup_at end,
      case when p_over ? 'appointment_at' then (p_over->>'appointment_at')::timestamptz else t.appointment_at end,
      case when p_over ? 'pickup_description' then p_over->>'pickup_description' else t.pickup_description end,
      case when p_over ? 'pickup_facility_id' then (p_over->>'pickup_facility_id')::uuid else t.pickup_facility_id end,
      case when p_over ? 'destination_description' then p_over->>'destination_description' else t.destination_description end,
      case when p_over ? 'destination_facility_id' then (p_over->>'destination_facility_id')::uuid else t.destination_facility_id end,
      case when p_over ? 'instructions' then p_over->>'instructions' else t.instructions end,
      case when p_over ? 'assistance_notes' then p_over->>'assistance_notes' else t.assistance_notes end);
    return 'OK:' || r.changed || ':' || array_to_string(r.changed_fields, ',');
  exception when others then
    return sqlstate;
  end;
end $$;

create function public.r2b_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true);
$$;

-- local day D (organization-local, America/New_York) three days out; every fixture Trip starts "an hour old"
create temp table r2b_ctx as
select ((now() at time zone 'America/New_York')::date + 3) as d;

create function public.r2b_at(p_day_offset int, p_hm text) returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select (((select d from r2b_ctx) + p_day_offset) + p_hm::time) at time zone 'America/New_York';
$$;

create function public.r2b_trip(p_label text, p_state text, p_pickup timestamptz default public.r2b_at(0, '10:00')) returns uuid
language sql as $$
  insert into public.trips (organization_id, passenger_id, state, scheduled_pickup_at, pickup_description,
                            destination_description, updated_at, created_at)
  values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', p_state, p_pickup,
          'R2B ' || p_label || ' pickup', 'R2B ' || p_label || ' clinic', now() - interval '1 hour', now() - interval '1 hour')
  returning id;
$$;

grant execute on function public.r2b_as(uuid), public.r2b_at(int, text) to authenticated;

insert into public.facilities (id, organization_id, name, status)
values ('6f000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a1', 'R2B inactive clinic', 'inactive');

-- ----------------------------------------------------------------------------------------------- TD-01 scheduled, all
do $$
declare v_trip uuid := public.r2b_trip('td01', 'scheduled'); v_res text; v_audit record; v_event record;
begin
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2b_t(v_trip, jsonb_build_object(
    'scheduled_pickup_at', public.r2b_at(1, '09:15'), 'appointment_at', public.r2b_at(1, '10:00'),
    'pickup_description', ' New pickup  ', 'pickup_facility_id', '60000000-0000-0000-0000-0000000000a1',
    'destination_description', 'New clinic', 'destination_facility_id', '60000000-0000-0000-0000-0000000000a1',
    'instructions', 'Ring bell', 'assistance_notes', 'Walker'));
  select count(*) n, max((select count(*) from jsonb_object_keys(before_data))) nb, bool_and(after_data ? 'trip_state') ts,
         max(after_data->>'pickup_description') pd, max(before_data->>'pickup_description') bpd
    into v_audit from public.audit_events where entity_id = v_trip and action = 'trip_details_updated';
  select count(*) n, max(jsonb_array_length(metadata->'changed_fields')) nf,
         bool_and((select count(*) from jsonb_object_keys(metadata)) = 2) only_names
    into v_event from public.trip_events where trip_id = v_trip and event_type = 'trip_details_updated';
  if v_res like 'OK:true:%' and array_length(string_to_array(split_part(v_res, ':', 3), ','), 1) = 8
     and v_audit.n = 1 and v_audit.nb = 8 and v_audit.ts and v_audit.pd = 'New pickup' and v_audit.bpd = 'R2B td01 pickup'
     and v_event.n = 1 and v_event.nf = 8 and v_event.only_names then
    raise notice 'TEST TD-01: PASS (scheduled: all 8 fields; trimmed; one audit with before/after of 8 fields + trip_state; one event, names only)';
  else
    raise notice 'TEST TD-01: FAIL (res=% audit=% event=%)', v_res, row_to_json(v_audit), row_to_json(v_event);
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-02 no-op
do $$
declare v_trip uuid := public.r2b_trip('td02', 'scheduled'); v_before timestamptz; v_after timestamptz; v_res text; n int;
begin
  update public.trips set instructions = '  Same  ', updated_at = updated_at where id = v_trip;
  select updated_at into v_before from public.trips where id = v_trip;
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2b_t(v_trip, jsonb_build_object('pickup_description', '  R2B td02 pickup ', 'instructions', 'Same'));
  select updated_at into v_after from public.trips where id = v_trip;
  select (select count(*) from public.audit_events where entity_id = v_trip and action = 'trip_details_updated')
       + (select count(*) from public.trip_events where trip_id = v_trip and event_type = 'trip_details_updated') into n;
  if v_res = 'OK:false:' and v_before = v_after and n = 0 then
    raise notice 'TEST TD-02: PASS (whitespace-only differences = no-op: changed=false, no UPDATE, no audit, no event)';
  else
    raise notice 'TEST TD-02: FAIL (res=% before=% after=% rows=%)', v_res, v_before, v_after, n;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-03 / TD-04 stale
do $$
declare v_trip uuid := public.r2b_trip('td03', 'scheduled'); v_res text; v_ins text;
begin
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2b_t(v_trip, '{"instructions":"x"}', now() - interval '2 days');
  select coalesce(instructions, '<null>') into v_ins from public.trips where id = v_trip;
  if v_res = 'ZW003' and v_ins = '<null>' then
    raise notice 'TEST TD-03: PASS (stale updated_at token -> ZW003, nothing written)';
  else
    raise notice 'TEST TD-03: FAIL (res=% instructions=%)', v_res, v_ins;
  end if;
end $$;

do $$
declare v_trip uuid := public.r2b_trip('td04', 'scheduled'); v_token timestamptz; v_res text;
begin
  insert into public.trip_assignments (organization_id, trip_id, driver_id, assigned_by)
  values ('10000000-0000-0000-0000-0000000000a1', v_trip, '30000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1');
  select updated_at into v_token from public.trips where id = v_trip;
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a3');
  perform public.driver_start_to_pickup(v_trip, 'scheduled');
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2b_t(v_trip, '{"instructions":"x"}', v_token);
  if v_res = 'ZW003' and (select state from public.trips where id = v_trip) = 'en_route_to_pickup' then
    raise notice 'TEST TD-04: PASS (token taken before a real driver lifecycle step -> ZW003)';
  else
    raise notice 'TEST TD-04: FAIL (res=%)', v_res;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-05 en_route_to_pickup
do $$
declare v_trip uuid := public.r2b_trip('td05', 'en_route_to_pickup'); a text; b text; c text; e text; f text;
begin
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  a := public.r2b_t(v_trip, jsonb_build_object('scheduled_pickup_at', public.r2b_at(0, '11:30')));   -- same local date
  b := public.r2b_t(v_trip, jsonb_build_object('scheduled_pickup_at', public.r2b_at(1, '11:30')));   -- next local date
  c := public.r2b_t(v_trip, '{"pickup_description":"Corrected pickup address"}');
  e := public.r2b_t(v_trip, '{"assistance_notes":"Bring the step stool","destination_description":"Other clinic","instructions":"Side door"}');
  f := public.r2b_t(v_trip, jsonb_build_object('scheduled_pickup_at', public.r2b_at(0, '23:59')));   -- still same date
  if a = 'OK:true:scheduled_pickup_at' and b = 'ZW004' and c = 'OK:true:pickup_description'
     and e like 'OK:true:%' and f = 'OK:true:scheduled_pickup_at' then
    raise notice 'TEST TD-05: PASS (en_route_to_pickup: same-local-date time change + pickup/destination/instructions/assistance allowed; date change ZW004)';
  else
    raise notice 'TEST TD-05: FAIL (%, %, %, %, %)', a, b, c, e, f;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-06 arrived_at_pickup
do $$
declare v_trip uuid := public.r2b_trip('td06', 'arrived_at_pickup'); a text; b text; c text; e text;
begin
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  a := public.r2b_t(v_trip, jsonb_build_object('scheduled_pickup_at', public.r2b_at(0, '10:30')));
  b := public.r2b_t(v_trip, '{"pickup_description":"Elsewhere"}');
  c := public.r2b_t(v_trip, '{"pickup_facility_id":"60000000-0000-0000-0000-0000000000a1"}');
  e := public.r2b_t(v_trip, jsonb_build_object('appointment_at', public.r2b_at(0, '12:00'), 'destination_description', 'Diverted clinic',
                                              'destination_facility_id', '60000000-0000-0000-0000-0000000000a1', 'instructions', 'x', 'assistance_notes', 'y'));
  if a = 'ZW004' and b = 'ZW004' and c = 'ZW004' and e like 'OK:true:%' then
    raise notice 'TEST TD-06: PASS (arrived_at_pickup: pickup time / pickup / pickup facility locked; appointment / destination / instructions / assistance allowed)';
  else
    raise notice 'TEST TD-06: FAIL (%, %, %, %)', a, b, c, e;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-07 / TD-08 onboard + en_route_to_destination
do $$
declare s text; v_trip uuid; a text; b text; c text; e text; ok boolean := true; detail text := '';
begin
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  foreach s in array array['passenger_onboard', 'en_route_to_destination'] loop
    v_trip := public.r2b_trip('td07 ' || s, s);
    a := public.r2b_t(v_trip, jsonb_build_object('appointment_at', public.r2b_at(0, '12:00'), 'destination_description', 'Diverted', 'instructions', 'Hospital B'));
    b := public.r2b_t(v_trip, jsonb_build_object('scheduled_pickup_at', public.r2b_at(0, '10:05')));
    c := public.r2b_t(v_trip, '{"pickup_description":"Elsewhere"}');
    e := public.r2b_t(v_trip, '{"assistance_notes":"late note"}');
    ok := ok and a like 'OK:true:%' and b = 'ZW004' and c = 'ZW004' and e = 'ZW004';
    detail := detail || s || '=' || a || '/' || b || '/' || c || '/' || e || ' ';
  end loop;
  if ok then
    raise notice 'TEST TD-07: PASS (passenger_onboard + en_route_to_destination: appointment / destination / instructions allowed; pickup time, pickup, assistance locked)';
  else
    raise notice 'TEST TD-07: FAIL (%)', detail;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-09 / TD-10 locked states
do $$
declare s text; v_trip uuid; r text; ok boolean := true; detail text := '';
begin
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  foreach s in array array['arrived_at_destination', 'completed', 'cancelled', 'no_show'] loop
    v_trip := public.r2b_trip('td09 ' || s, s);
    r := public.r2b_t(v_trip, '{"instructions":"too late"}');
    ok := ok and r = 'ZW004'; detail := detail || s || '=' || r || ' ';
    r := public.r2b_t(v_trip, '{}');   -- a no-op is still a no-op (nothing written)
    ok := ok and r = 'OK:false:'; detail := detail || r || ' ';
  end loop;
  if ok then
    raise notice 'TEST TD-09: PASS (arrived_at_destination / completed / cancelled / no_show: every owned field locked (ZW004); no-op writes nothing)';
  else
    raise notice 'TEST TD-09: FAIL (%)', detail;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-11 validation
do $$
declare v_trip uuid := public.r2b_trip('td11', 'scheduled'); v_fac_trip uuid := public.r2b_trip('td11 fac', 'scheduled');
        r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text; r8 text;
begin
  update public.trips set pickup_facility_id = '6f000000-0000-0000-0000-0000000000a9' where id = v_fac_trip;  -- later-inactive facility
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  r1 := public.r2b_t(v_trip, '{"pickup_description":"   "}');
  r2 := public.r2b_t(v_trip, jsonb_build_object('destination_description', repeat('x', 2001)));
  r3 := public.r2b_t(v_trip, jsonb_build_object('appointment_at', public.r2b_at(0, '09:00')));            -- before 10:00 pickup
  r4 := public.r2b_t(v_trip, '{"pickup_facility_id":"60000000-0000-0000-0000-0000000000b1"}');          -- other organization
  r5 := public.r2b_t(v_trip, '{"destination_facility_id":"6f000000-0000-0000-0000-0000000000a9"}');     -- inactive, changed
  r6 := public.r2b_t(v_fac_trip, '{"instructions":"unrelated edit"}');                                   -- inactive, unchanged
  r7 := public.r2b_t(v_trip, '{"scheduled_pickup_at":null}');                                           -- clear pickup
  r8 := public.r2b_t(v_trip, '{"pickup_description":"nope","destination_description":""}');
  if r1 = 'ZW006' and r2 = 'ZW006' and r3 = 'ZW006' and r4 = 'ZW006' and r5 = 'ZW006' and r6 = 'OK:true:instructions'
     and r7 = 'ZW006' and r8 = 'ZW006' then
    raise notice 'TEST TD-11: PASS (blank / oversized description, appointment before pickup, foreign facility, newly-set inactive facility, clearing pickup -> ZW006; unchanged inactive facility tolerated)';
  else
    raise notice 'TEST TD-11: FAIL (%, %, %, %, %, %, %, %)', r1, r2, r3, r4, r5, r6, r7, r8;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-12 first pickup
do $$
declare v_trip uuid := public.r2b_trip('td12', 'scheduled', null); v_res text;
begin
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2b_t(v_trip, jsonb_build_object('scheduled_pickup_at', public.r2b_at(2, '08:00')));
  if v_res = 'OK:true:scheduled_pickup_at' and (select scheduled_pickup_at from public.trips where id = v_trip) = public.r2b_at(2, '08:00') then
    raise notice 'TEST TD-12: PASS (a pickup-less scheduled Trip receives its first pickup)';
  else
    raise notice 'TEST TD-12: FAIL (res=%)', v_res;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-13 recurring date rule
do $$
declare v_arr uuid; v_trip uuid; a text; b text; c text;
begin
  insert into public.recurring_arrangements (organization_id, passenger_id, pickup_description, destination_description,
    pickup_time, days_of_week, start_date, timezone, status, created_by)
  values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'R2B rc pickup', 'R2B rc clinic',
          '10:00', array[1,2,3,4,5,6,7]::smallint[], (select d from r2b_ctx), 'America/New_York', 'active', '20000000-0000-0000-0000-0000000000a1')
  returning id into v_arr;
  v_trip := public.r2b_trip('td13', 'scheduled');
  update public.trips set recurring_arrangement_id = v_arr where id = v_trip;
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  a := public.r2b_t(v_trip, jsonb_build_object('scheduled_pickup_at', public.r2b_at(0, '07:00')));   -- same arrangement date
  b := public.r2b_t(v_trip, jsonb_build_object('scheduled_pickup_at', public.r2b_at(1, '07:00')));   -- other date (scheduled!)
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  c := (public.create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1', v_arr, (select d from r2b_ctx))).created::text;
  if a = 'OK:true:scheduled_pickup_at' and b = 'ZW006' and c = 'false'
     and (select recurring_arrangement_id from public.trips where id = v_trip) = v_arr then
    raise notice 'TEST TD-13: PASS (recurring occurrence: same-date time change applied; other date ZW006 even while scheduled; occurrence still matched to its date)';
  else
    raise notice 'TEST TD-13: FAIL (%, %, created=%)', a, b, c;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-14 request-linked date change
do $$
declare v_req uuid; v_trip uuid; v_res text; t public.trips;
begin
  insert into public.transportation_requests (organization_id, passenger_id, requester_name, requester_relationship,
    requester_phone, pickup_description, destination_description, return_trip_needed, state, source)
  values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'R2B requester', 'self', '555-0100',
          'R2B req pickup', 'R2B req clinic', 'no', 'accepted', 'phone') returning id into v_req;
  v_trip := public.r2b_trip('td14', 'scheduled');
  update public.trips set request_id = v_req where id = v_trip;
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2b_t(v_trip, jsonb_build_object('scheduled_pickup_at', public.r2b_at(4, '14:00')));
  select * into t from public.trips where id = v_trip;
  if v_res = 'OK:true:scheduled_pickup_at' and t.request_id = v_req and t.passenger_id = '40000000-0000-0000-0000-0000000000a1'
     and t.recurring_arrangement_id is null and t.state = 'scheduled' then
    raise notice 'TEST TD-14: PASS (request-linked scheduled Trip moves date; request_id / passenger_id / recurring link / state untouched)';
  else
    raise notice 'TEST TD-14: FAIL (res=%)', v_res;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-15 assignment retained
do $$
declare v_trip uuid := public.r2b_trip('td15', 'scheduled'); v_before text; v_after text; v_res text;
begin
  insert into public.trip_assignments (organization_id, trip_id, driver_id, assigned_by)
  values ('10000000-0000-0000-0000-0000000000a1', v_trip, '30000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-0000000000a1');
  select string_agg(id || ':' || driver_id || ':' || coalesce(vehicle_id::text, '') || ':' || coalesce(ended_at::text, ''), ',') into v_before
    from public.trip_assignments where trip_id = v_trip;
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2b_t(v_trip, jsonb_build_object('scheduled_pickup_at', public.r2b_at(0, '22:00')));   -- e.g. outside hours
  select string_agg(id || ':' || driver_id || ':' || coalesce(vehicle_id::text, '') || ':' || coalesce(ended_at::text, ''), ',') into v_after
    from public.trip_assignments where trip_id = v_trip;
  if v_res like 'OK:true:%' and v_before = v_after then
    raise notice 'TEST TD-15: PASS (time change never unassigns / reassigns: assignment rows identical)';
  else
    raise notice 'TEST TD-15: FAIL (res=% before=% after=%)', v_res, v_before, v_after;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-16 authorization matrix
do $$
declare v_trip uuid := public.r2b_trip('td16', 'scheduled'); r_disp text; r_driver text; r_orgb text; r_inactive text; r_none text; r_platform text; r_susp text; r_after text;
begin
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a2'); r_disp := public.r2b_t(v_trip, '{"instructions":"dispatcher edit"}');
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a3'); r_driver := public.r2b_t(v_trip, '{"instructions":"driver edit"}');
  perform public.r2b_as('20000000-0000-0000-0000-0000000000b1'); r_orgb := public.r2b_t(v_trip, '{"instructions":"foreign edit"}');
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a5'); r_inactive := public.r2b_t(v_trip, '{"instructions":"inactive edit"}');
  perform public.r2b_as('20000000-0000-0000-0000-0000000000e1'); r_none := public.r2b_t(v_trip, '{"instructions":"no membership"}');
  perform public.r2b_as('20000000-0000-0000-0000-0000000000d1'); r_platform := public.r2b_t(v_trip, '{"instructions":"platform"}');
  update public.organizations set status = 'inactive' where id = '10000000-0000-0000-0000-0000000000a1';
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1'); r_susp := public.r2b_t(v_trip, '{"instructions":"suspended"}');
  update public.organizations set status = 'active' where id = '10000000-0000-0000-0000-0000000000a1';
  r_after := public.r2b_t(v_trip, '{"instructions":"admin edit"}');
  if r_disp = 'OK:true:instructions' and r_driver = 'ZW002' and r_orgb = 'ZW002' and r_inactive = 'ZW002' and r_none = 'ZW002'
     and r_platform = 'ZW002' and r_susp = 'ZW002' and r_after = 'OK:true:instructions' then
    raise notice 'TEST TD-16: PASS (Dispatcher + Admin allowed; Driver / foreign tenant / inactive membership / no membership / Platform Admin / suspended organization -> ZW002)';
  else
    raise notice 'TEST TD-16: FAIL (disp=% driver=% orgB=% inactive=% none=% platform=% suspended=% admin=%)', r_disp, r_driver, r_orgb, r_inactive, r_none, r_platform, r_susp, r_after;
  end if;
end $$;

do $$
declare v_trip uuid := public.r2b_trip('td16b', 'scheduled'); v_res text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  v_res := public.r2b_t(v_trip, '{"instructions":"anonymous"}');
  if v_res = 'ZW001' then
    raise notice 'TEST TD-16b: PASS (no authenticated user -> ZW001)';
  else
    raise notice 'TEST TD-16b: FAIL (res=%)', v_res;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-17 function privileges
do $$
declare f regprocedure := 'public.update_trip_details(uuid,timestamptz,timestamptz,timestamptz,text,uuid,text,uuid,text,text)'::regprocedure;
begin
  if not has_function_privilege('public', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')
     and has_function_privilege('authenticated', f, 'EXECUTE')
     and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = f)
     and (select count(*) from pg_proc where proname = 'update_trip_details' and pronamespace = 'public'::regnamespace) = 1 then
    raise notice 'TEST TD-17: PASS (single overload; SECURITY DEFINER; search_path pinned; PUBLIC / anon no EXECUTE; authenticated EXECUTE)';
  else
    raise notice 'TEST TD-17: FAIL';
  end if;
end $$;

do $$
begin
  set local role anon;
  perform public.update_trip_details(gen_random_uuid(), now(), null, null, 'a', null, 'b', null, null, null);
  raise notice 'TEST TD-17b: FAIL (anon executed update_trip_details)';
exception when insufficient_privilege then
  raise notice 'TEST TD-17b: PASS (anon -> permission denied)';
end $$;
reset role;

-- ----------------------------------------------------------------------------------------------- TD-18 / TD-19 direct UPDATE revoked
do $$
declare v_trip uuid := public.r2b_trip('td18', 'scheduled'); c text; denied int := 0;
begin
  set local role authenticated;
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  foreach c in array array['instructions', 'scheduled_pickup_at', 'pickup_description', 'assistance_notes'] loop
    begin
      execute format('update public.trips set %I = %I where id = %L', c, c, v_trip);
    exception when insufficient_privilege then denied := denied + 1;
    end;
  end loop;
  if denied = 4 then
    raise notice 'TEST TD-18: PASS (Organization Admin: direct UPDATE of trips planning columns -> permission denied)';
  else
    raise notice 'TEST TD-18: FAIL (denied %/4)', denied;
  end if;
end $$;
reset role;

do $$
declare c text; denied int := 0;
begin
  set local role authenticated;
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  foreach c in array array['requester_name', 'pickup_description', 'assistance_notes', 'preferred_date', 'state', 'passenger_id'] loop
    begin
      execute format('update public.transportation_requests set %I = %I where organization_id = %L', c, c, '10000000-0000-0000-0000-0000000000a1');
    exception when insufficient_privilege then denied := denied + 1;
    end;
  end loop;
  if denied = 6 and not has_table_privilege('authenticated', 'public.transportation_requests', 'UPDATE')
     and not has_table_privilege('authenticated', 'public.trips', 'UPDATE')
     and not exists (select 1 from information_schema.column_privileges where grantee = 'authenticated' and privilege_type = 'UPDATE'
                     and table_schema = 'public' and table_name in ('trips', 'transportation_requests')) then
    raise notice 'TEST TD-19: PASS (Organization Admin: direct UPDATE of transportation_requests -> permission denied; no UPDATE privilege on either table)';
  else
    raise notice 'TEST TD-19: FAIL (denied %/6)', denied;
  end if;
end $$;
reset role;

-- ----------------------------------------------------------------------------------------------- TD-20 Request RPC workflows still work
do $$
declare r1 uuid; r2 uuid; r3 uuid; v_trip uuid; s1 text; s2 text; s3 text;
begin
  set local role authenticated;
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  r1 := (public.log_transportation_request('10000000-0000-0000-0000-0000000000a1', 'R2B flow one', 'self', '555-0101',
          'R2B flow pickup', 'R2B flow clinic', 'no', 'phone', null, null, null, null, null, null)).request_id;
  perform public.link_request_passenger('10000000-0000-0000-0000-0000000000a1', r1, '40000000-0000-0000-0000-0000000000a1');
  perform public.accept_transportation_request('10000000-0000-0000-0000-0000000000a1', r1);
  v_trip := (public.create_trip('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
              'R2B flow pickup', 'R2B flow clinic', public.r2b_at(1, '08:00'), p_request_id => r1)).trip_id;
  r2 := (public.log_transportation_request('10000000-0000-0000-0000-0000000000a1', 'R2B flow two', 'family', '555-0102',
          'R2B flow pickup', 'R2B flow clinic', 'yes', 'phone', null, null, null, null, null, null)).request_id;
  perform public.decline_transportation_request('10000000-0000-0000-0000-0000000000a1', r2, 'no_availability', null);
  r3 := (public.log_transportation_request('10000000-0000-0000-0000-0000000000a1', 'R2B flow three', 'self', '555-0103',
          'R2B flow pickup', 'R2B flow clinic', 'no', 'phone', null, null, null, null, null, null)).request_id;
  perform public.accept_transportation_request('10000000-0000-0000-0000-0000000000a1', r3);
  perform public.cancel_transportation_request('10000000-0000-0000-0000-0000000000a1', r3, 'requester_cancelled', null);
  select state into s1 from public.transportation_requests where id = r1;
  select state into s2 from public.transportation_requests where id = r2;
  select state into s3 from public.transportation_requests where id = r3;
  if s1 = 'accepted' and v_trip is not null and (select request_id from public.trips where id = v_trip) = r1
     and (select passenger_id from public.transportation_requests where id = r1) = '40000000-0000-0000-0000-0000000000a1'
     and s2 = 'declined' and s3 = 'cancelled' then
    raise notice 'TEST TD-20: PASS (without any direct UPDATE grant: log, link Passenger, accept, create Trip from Request, decline, cancel all succeed via their RPCs)';
  else
    raise notice 'TEST TD-20: FAIL (s1=% s2=% s3=% trip=%)', s1, s2, s3, v_trip;
  end if;
end $$;
reset role;

-- ----------------------------------------------------------------------------------------------- TD-21 changed-fields-only audit
do $$
declare v_trip uuid := public.r2b_trip('td21', 'scheduled'); v_res text; v_before text; v_after text; v_meta text;
begin
  perform public.r2b_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2b_t(v_trip, '{"assistance_notes":"Uses a cane"}');
  select (select string_agg(k, ',' order by k) from jsonb_object_keys(before_data) k),
         (select string_agg(k, ',' order by k) from jsonb_object_keys(after_data) k)
    into v_before, v_after from public.audit_events where entity_id = v_trip and action = 'trip_details_updated';
  select metadata::text into v_meta from public.trip_events where trip_id = v_trip and event_type = 'trip_details_updated';
  if v_res = 'OK:true:assistance_notes' and v_before = 'assistance_notes' and v_after = 'assistance_notes,trip_state'
     and v_meta not like '%cane%' and v_meta like '%assistance_notes%' then
    raise notice 'TEST TD-21: PASS (audit before/after carry only the changed field (+trip_state); trip_events carries the field name, never the value)';
  else
    raise notice 'TEST TD-21: FAIL (res=% before=% after=% meta=%)', v_res, v_before, v_after, v_meta;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- TD-22 event vocabulary
-- P1-PILOT-R2C -- deliberate expectation change: R2B pinned "no R2C type pre-created"; the R2C migration now adds
-- completion_recorded_by_operations (tested in record_completion_tests.sql). Still pinned: trip_details_updated present,
-- lifecycle types intact.
do $$
begin
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'trip_events_event_type_check')) like '%trip_details_updated%'
     and pg_get_constraintdef((select oid from pg_constraint where conname = 'trip_events_event_type_check')) like '%trip_completed%'
     and pg_get_constraintdef((select oid from pg_constraint where conname = 'trip_events_event_type_check')) like '%completion_recorded_by_operations%' then
    raise notice 'TEST TD-22: PASS (trip_events vocabulary: trip_details_updated present; lifecycle types intact; R2C completion_recorded_by_operations added by its own migration)';
  else
    raise notice 'TEST TD-22: FAIL';
  end if;
end $$;

rollback;
