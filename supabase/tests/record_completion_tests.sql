-- P1-PILOT-R2C -- record_trip_completion_by_operations (PR-02 dispatcher completion recovery).
-- Fully transactional (BEGIN ... ROLLBACK): rerunnable, leaves nothing behind (verified after the ROLLBACK).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/record_completion_tests.sql
-- Actor identity is the JWT subject (auth.uid()). Fixture Trips are driven to their state through the REAL Driver RPCs
-- (so the lifecycle event chain is genuine, not inserted). r2c_call returns 'OK:<previous>:<current>' or the SQLSTATE
-- (a failed call is rolled back to its own savepoint, so it can never leave a partial write).
begin;

-- ---------------------------------------------------------------------------------------------- fixtures (postgres)
create function public.r2c_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
$$;

create function public.r2c_call(p_trip uuid, p_expected text, p_completed_at timestamptz,
                                p_note text default 'Driver phone unavailable; completion confirmed by phone.') returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.trip_transition_result;
begin
  begin
    r := public.record_trip_completion_by_operations(p_trip, p_expected, p_completed_at, p_note);
    return 'OK:' || r.previous_state || ':' || r.current_state || ':' || r.changed;
  exception when others then
    return sqlstate;
  end;
end $$;

create function public.r2c_driver(p_trip uuid, p_rpc text, p_expected text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.trip_transition_result;
begin
  begin
    execute format('select * from public.%I($1, $2)', p_rpc) into r using p_trip, p_expected;
    return 'OK:' || r.previous_state || ':' || r.current_state || ':' || r.changed;
  exception when others then
    return sqlstate;
  end;
end $$;

-- A scheduled Org A Trip with an active assignment (Driver A1 / Van A1), driven to p_state through the real Driver
-- (and, for cancelled / no_show, Operations) RPCs. Leaves the JWT subject cleared.
create function public.r2c_trip(p_label text, p_state text) returns uuid
language plpgsql as $$
declare v_trip uuid; v_steps text[][] := array[
  ['driver_start_to_pickup', 'scheduled', 'en_route_to_pickup'],
  ['driver_arrive_at_pickup', 'en_route_to_pickup', 'arrived_at_pickup'],
  ['driver_mark_passenger_onboard', 'arrived_at_pickup', 'passenger_onboard'],
  ['driver_start_to_destination', 'passenger_onboard', 'en_route_to_destination'],
  ['driver_arrive_at_destination', 'en_route_to_destination', 'arrived_at_destination'],
  ['driver_complete_trip', 'arrived_at_destination', 'completed']];
  i int; v_target text := p_state; v_res text;
begin
  insert into public.trips (organization_id, passenger_id, state, scheduled_pickup_at, pickup_description, destination_description)
  values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'scheduled', now() - interval '2 hours',
          'R2C ' || p_label || ' pickup', 'R2C ' || p_label || ' clinic')
  returning id into v_trip;
  insert into public.trip_assignments (organization_id, trip_id, driver_id, vehicle_id, assigned_by)
  values ('10000000-0000-0000-0000-0000000000a1', v_trip, '30000000-0000-0000-0000-0000000000a1',
          '50000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1');
  if p_state = 'cancelled' then v_target := 'scheduled'; end if;
  if p_state = 'no_show' then v_target := 'arrived_at_pickup'; end if;
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a3');
  for i in 1 .. array_length(v_steps, 1) loop
    exit when (select state from public.trips where id = v_trip) = v_target;
    v_res := public.r2c_driver(v_trip, v_steps[i][1], v_steps[i][2]);
    if v_res not like 'OK:%' then raise exception 'fixture step % failed: %', v_steps[i][1], v_res; end if;
  end loop;
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  if p_state = 'cancelled' then perform public.cancel_trip(v_trip, 'R2C fixture cancel'); end if;
  if p_state = 'no_show' then perform public.record_no_show(v_trip, 'R2C fixture no-show'); end if;
  perform public.r2c_as(null);
  if (select state from public.trips where id = v_trip) <> p_state then raise exception 'fixture % not in %', p_label, p_state; end if;
  return v_trip;
end $$;

grant execute on function public.r2c_as(uuid) to authenticated, anon;

-- Shared post-condition for a successful recovery.
create function public.r2c_verify(p_trip uuid, p_prev text, p_completed_at timestamptz, p_actor uuid, p_note text) returns text
language plpgsql as $$
declare t public.trips; n_active int; n_closed int; e record; a record; n_evt int; n_aud int;
begin
  select * into t from public.trips where id = p_trip;
  select count(*) filter (where ended_at is null), count(*) filter (where ended_at is not null and end_reason = 'trip_completed')
    into n_active, n_closed from public.trip_assignments where trip_id = p_trip;
  select count(*) into n_evt from public.trip_events where trip_id = p_trip and event_type = 'completion_recorded_by_operations';
  select * into e from public.trip_events where trip_id = p_trip and event_type = 'completion_recorded_by_operations';
  select count(*) into n_aud from public.audit_events where entity_id = p_trip and action = 'trip_completion_recorded_by_operations';
  select * into a from public.audit_events where entity_id = p_trip and action = 'trip_completion_recorded_by_operations';
  if t.state <> 'completed' then return 'state=' || t.state; end if;
  if t.completed_at is distinct from p_completed_at then return 'completed_at=' || t.completed_at; end if;
  if n_active <> 0 or n_closed <> 1 then return format('assignments active=%s closed=%s', n_active, n_closed); end if;
  if n_evt <> 1 then return 'events=' || n_evt; end if;
  if e.actor_user_id <> p_actor or e.metadata->>'previous_state' <> p_prev
     or (e.metadata->>'recorded_completed_at')::timestamptz <> p_completed_at or (e.metadata->>'note_present')::boolean is not true
     or (select count(*) from jsonb_object_keys(e.metadata)) <> 3 then return 'event=' || row_to_json(e); end if;
  if n_aud <> 1 then return 'audits=' || n_aud; end if;
  if a.actor_user_id <> p_actor or a.reason <> p_note or a.before_data <> jsonb_build_object('state', p_prev)
     or a.after_data->>'state' <> 'completed' or (a.after_data->>'completed_at')::timestamptz <> p_completed_at
     or (select count(*) from jsonb_object_keys(a.after_data)) <> 2 then return 'audit=' || row_to_json(a); end if;
  if exists (select 1 from public.trip_events where trip_id = p_trip and event_type = 'trip_completed') then return 'trip_completed present'; end if;
  return 'ok';
end $$;

-- ----------------------------------------------------------------------------------------------- C1..C3 eligible states
do $$
declare v_trip uuid; v_at timestamptz; v_res text; v_chk text;
begin
  v_trip := public.r2c_trip('c1', 'passenger_onboard'); v_at := now() - interval '1 minute';
  update public.trip_events set occurred_at = now() - interval '30 minutes' where trip_id = v_trip;
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2c_call(v_trip, 'passenger_onboard', v_at, '  Driver phone unavailable; completion confirmed by phone.  ');
  v_chk := public.r2c_verify(v_trip, 'passenger_onboard', v_at, '20000000-0000-0000-0000-0000000000a1',
                             'Driver phone unavailable; completion confirmed by phone.');
  if v_res = 'OK:passenger_onboard:completed:true' and v_chk = 'ok' then
    raise notice 'TEST C1: PASS (passenger_onboard -> completed; completed_at = stated time; assignment closed once, end_reason trip_completed; ONE recovery event; ONE audit with the trimmed note)';
  else
    raise notice 'TEST C1: FAIL (res=% chk=%)', v_res, v_chk;
  end if;
end $$;

do $$
declare v_trip uuid; v_at timestamptz := now(); v_res text; v_chk text;
begin
  v_trip := public.r2c_trip('c2', 'en_route_to_destination');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a2');
  v_res := public.r2c_call(v_trip, 'en_route_to_destination', v_at);
  v_chk := public.r2c_verify(v_trip, 'en_route_to_destination', v_at, '20000000-0000-0000-0000-0000000000a2',
                             'Driver phone unavailable; completion confirmed by phone.');
  if v_res = 'OK:en_route_to_destination:completed:true' and v_chk = 'ok' then
    raise notice 'TEST C2: PASS (en_route_to_destination -> completed; same post-conditions; Dispatcher actor recorded)';
  else
    raise notice 'TEST C2: FAIL (res=% chk=%)', v_res, v_chk;
  end if;
end $$;

do $$
declare v_trip uuid; v_at timestamptz := now() + interval '2 minutes'; v_res text; v_chk text;
begin
  v_trip := public.r2c_trip('c3', 'arrived_at_destination');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2c_call(v_trip, 'arrived_at_destination', v_at);
  v_chk := public.r2c_verify(v_trip, 'arrived_at_destination', v_at, '20000000-0000-0000-0000-0000000000a1',
                             'Driver phone unavailable; completion confirmed by phone.');
  if v_res = 'OK:arrived_at_destination:completed:true' and v_chk = 'ok' then
    raise notice 'TEST C3: PASS (arrived_at_destination -> completed; completed_at within the 5-minute future allowance)';
  else
    raise notice 'TEST C3: FAIL (res=% chk=%)', v_res, v_chk;
  end if;
end $$;

-- ----------------------------------------------------------------------------------------------- C4..C9 ineligible states
do $$
declare v_state text; v_trip uuid; v_res text; v_stale text; v_bad text := ''; v_writes int;
begin
  foreach v_state in array array['scheduled', 'en_route_to_pickup', 'arrived_at_pickup', 'completed', 'cancelled', 'no_show'] loop
    v_trip := public.r2c_trip('c4-' || v_state, v_state);
    perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
    v_res := public.r2c_call(v_trip, v_state, now());
    v_stale := public.r2c_call(v_trip, 'passenger_onboard', now());
    select (select count(*) from public.trip_events where trip_id = v_trip and event_type = 'completion_recorded_by_operations')
         + (select count(*) from public.audit_events where entity_id = v_trip and action = 'trip_completion_recorded_by_operations')
      into v_writes;
    if v_res <> 'ZW004' or v_stale <> 'ZW003' or v_writes <> 0 or (select state from public.trips where id = v_trip) <> v_state then
      v_bad := v_bad || format(' %s:res=%s stale=%s writes=%s', v_state, v_res, v_stale, v_writes);
    end if;
    raise notice 'TEST C%: %', 4 + array_position(array['scheduled', 'en_route_to_pickup', 'arrived_at_pickup', 'completed', 'cancelled', 'no_show'], v_state) - 1,
      case when v_res = 'ZW004' and v_stale = 'ZW003' and v_writes = 0
           then 'PASS (' || v_state || ' denied: ZW004 with the matching expected state, ZW003 with a stale one; nothing written)'
           else 'FAIL (' || v_state || ' res=' || v_res || ' stale=' || v_stale || ' writes=' || v_writes || ')' end;
  end loop;
end $$;

-- ----------------------------------------------------------------------------------------------- C10..C16 authorization
do $$
declare v_trip uuid; v_res text;
begin
  v_trip := public.r2c_trip('c10', 'passenger_onboard');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2c_call(v_trip, 'passenger_onboard', now());
  raise notice 'TEST C10: %', case when v_res = 'OK:passenger_onboard:completed:true' then 'PASS (Organization Admin allowed)' else 'FAIL (res=' || v_res || ')' end;
  v_trip := public.r2c_trip('c11', 'passenger_onboard');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a2');
  v_res := public.r2c_call(v_trip, 'passenger_onboard', now());
  raise notice 'TEST C11: %', case when v_res = 'OK:passenger_onboard:completed:true' then 'PASS (Dispatcher allowed)' else 'FAIL (res=' || v_res || ')' end;
end $$;

do $$
declare v_trip uuid; r_driver text; r_orgb text; r_inactive text; r_none text; r_platform text; r_susp text; r_ghost text; r_noauth text; v_after text;
begin
  v_trip := public.r2c_trip('c12', 'passenger_onboard');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a3'); r_driver := public.r2c_call(v_trip, 'passenger_onboard', now());
  perform public.r2c_as('20000000-0000-0000-0000-0000000000b1'); r_orgb := public.r2c_call(v_trip, 'passenger_onboard', now());
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a5'); r_inactive := public.r2c_call(v_trip, 'passenger_onboard', now());
  perform public.r2c_as('20000000-0000-0000-0000-0000000000e1'); r_none := public.r2c_call(v_trip, 'passenger_onboard', now());
  perform public.r2c_as('20000000-0000-0000-0000-0000000000d1'); r_platform := public.r2c_call(v_trip, 'passenger_onboard', now());
  update public.organizations set status = 'inactive' where id = '10000000-0000-0000-0000-0000000000a1';
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1'); r_susp := public.r2c_call(v_trip, 'passenger_onboard', now());
  update public.organizations set status = 'active' where id = '10000000-0000-0000-0000-0000000000a1';
  r_ghost := public.r2c_call(gen_random_uuid(), 'passenger_onboard', now());
  perform public.r2c_as(null); r_noauth := public.r2c_call(v_trip, 'passenger_onboard', now());
  select state into v_after from public.trips where id = v_trip;
  raise notice 'TEST C12: %', case when r_driver = 'ZW002' then 'PASS (the assigned Driver -> ZW002)' else 'FAIL (' || r_driver || ')' end;
  raise notice 'TEST C13: %', case when r_orgb = 'ZW002' then 'PASS (foreign tenant Admin -> ZW002)' else 'FAIL (' || r_orgb || ')' end;
  raise notice 'TEST C14: %', case when r_inactive = 'ZW002' then 'PASS (inactive Dispatcher membership -> ZW002)' else 'FAIL (' || r_inactive || ')' end;
  raise notice 'TEST C15: %', case when r_susp = 'ZW002' then 'PASS (suspended organization -> ZW002 for its own Admin)' else 'FAIL (' || r_susp || ')' end;
  raise notice 'TEST C15b: %', case when r_none = 'ZW002' and r_platform = 'ZW002' and r_ghost = 'ZW002' and r_noauth = 'ZW001' and v_after = 'passenger_onboard'
    then 'PASS (no membership / Platform Admin without membership / nonexistent Trip -> identical ZW002, no oracle; no auth -> ZW001; Trip untouched)'
    else format('FAIL (none=%s platform=%s ghost=%s noauth=%s state=%s)', r_none, r_platform, r_ghost, r_noauth, v_after) end;
end $$;

do $$
begin
  set local role anon;
  perform public.record_trip_completion_by_operations(gen_random_uuid(), 'passenger_onboard', now(), 'Confirmed by phone call');
  raise notice 'TEST C16: FAIL (anon executed record_trip_completion_by_operations)';
exception when insufficient_privilege then
  raise notice 'TEST C16: PASS (anon -> permission denied)';
end $$;
reset role;

-- ----------------------------------------------------------------------------------------------- C17..C19 note
do $$
declare v_trip uuid; r_null text; r_blank text; r_9 text; r_10 text; r_501 text; v_trip2 uuid; r_500 text; v_reason text;
begin
  v_trip := public.r2c_trip('c17', 'passenger_onboard');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  r_null := public.r2c_call(v_trip, 'passenger_onboard', now(), null);
  r_blank := public.r2c_call(v_trip, 'passenger_onboard', now(), '     ');
  r_9 := public.r2c_call(v_trip, 'passenger_onboard', now(), '  123456789  ');
  r_501 := public.r2c_call(v_trip, 'passenger_onboard', now(), repeat('x', 501));
  raise notice 'TEST C17: %', case when r_null = 'ZW006' and r_blank = 'ZW006' then 'PASS (missing / blank note -> ZW006)' else format('FAIL (null=%s blank=%s)', r_null, r_blank) end;
  raise notice 'TEST C18: %', case when r_9 = 'ZW006' then 'PASS (9 characters after trimming -> ZW006)' else 'FAIL (' || r_9 || ')' end;
  raise notice 'TEST C19: %', case when r_501 = 'ZW006' then 'PASS (501 characters -> ZW006)' else 'FAIL (' || r_501 || ')' end;
  r_10 := public.r2c_call(v_trip, 'passenger_onboard', now(), '  1234567890  ');
  v_trip2 := public.r2c_trip('c19b', 'passenger_onboard');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  r_500 := public.r2c_call(v_trip2, 'passenger_onboard', now(), repeat('y', 500));
  select reason into v_reason from public.audit_events where entity_id = v_trip and action = 'trip_completion_recorded_by_operations';
  raise notice 'TEST C19b: %', case when r_10 like 'OK:%' and r_500 like 'OK:%' and v_reason = '1234567890'
    then 'PASS (boundaries: exactly 10 after trimming and exactly 500 accepted; stored trimmed)' else format('FAIL (10=%s 500=%s reason=%s)', r_10, r_500, v_reason) end;
end $$;

-- ----------------------------------------------------------------------------------------------- C20..C22 time / assignment
do $$
declare v_trip uuid; r_future text; r_null text; r_ok text;
begin
  v_trip := public.r2c_trip('c20', 'passenger_onboard');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  r_future := public.r2c_call(v_trip, 'passenger_onboard', now() + interval '5 minutes 1 second');
  r_null := public.r2c_call(v_trip, 'passenger_onboard', null);
  r_ok := public.r2c_call(v_trip, 'passenger_onboard', now() + interval '5 minutes');
  raise notice 'TEST C20: %', case when r_future = 'ZW006' and r_null = 'ZW006' and r_ok like 'OK:%'
    then 'PASS (completed_at > now + 5 min -> ZW006; missing completed_at -> ZW006 (never inferred); exactly now + 5 min accepted)'
    else format('FAIL (future=%s null=%s edge=%s)', r_future, r_null, r_ok) end;
end $$;

do $$
declare v_trip uuid; v_last timestamptz; r_before text; r_equal text;
begin
  v_trip := public.r2c_trip('c21', 'en_route_to_destination');
  update public.trip_events set occurred_at = now() - interval '40 minutes' where trip_id = v_trip and event_type <> 'en_route_to_destination';
  update public.trip_events set occurred_at = now() - interval '10 minutes' where trip_id = v_trip and event_type = 'en_route_to_destination'
    returning occurred_at into v_last;
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  r_before := public.r2c_call(v_trip, 'en_route_to_destination', v_last - interval '1 second');
  r_equal := public.r2c_call(v_trip, 'en_route_to_destination', v_last);
  raise notice 'TEST C21: %', case when r_before = 'ZW006' and r_equal like 'OK:%'
    then 'PASS (completed_at before the latest lifecycle event -> ZW006; equal to it accepted)'
    else format('FAIL (before=%s equal=%s)', r_before, r_equal) end;
end $$;

do $$
declare v_trip uuid; v_res text; v_state text; n int;
begin
  insert into public.trips (organization_id, passenger_id, state, scheduled_pickup_at, pickup_description, destination_description)
  values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'passenger_onboard', now() - interval '1 hour',
          'R2C c22 pickup', 'R2C c22 clinic') returning id into v_trip;
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r2c_call(v_trip, 'passenger_onboard', now());
  select state into v_state from public.trips where id = v_trip;
  select count(*) into n from public.trip_assignments where trip_id = v_trip;
  raise notice 'TEST C22: %', case when v_res = 'ZW006' and v_state = 'passenger_onboard' and n = 0
    then 'PASS (no active assignment -> ZW006 integrity failure; no assignment created; Trip untouched)'
    else format('FAIL (res=%s state=%s assignments=%s)', v_res, v_state, n) end;
end $$;

-- ----------------------------------------------------------------------------------------------- C23 / C24 races
do $$
declare v_trip uuid; r_driver text; r_ops text; r_ops2 text; n_completed int; n_recovery int; n_closed int; v_completed_at timestamptz;
begin
  v_trip := public.r2c_trip('c23', 'arrived_at_destination');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a3');
  r_driver := public.r2c_driver(v_trip, 'driver_complete_trip', 'arrived_at_destination');
  select completed_at into v_completed_at from public.trips where id = v_trip;
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a2');
  r_ops := public.r2c_call(v_trip, 'arrived_at_destination', now() - interval '1 minute');
  r_ops2 := public.r2c_call(v_trip, 'completed', now() - interval '1 minute');
  select count(*) into n_completed from public.trip_events where trip_id = v_trip and event_type = 'trip_completed';
  select count(*) into n_recovery from public.trip_events where trip_id = v_trip and event_type = 'completion_recorded_by_operations';
  select count(*) into n_closed from public.trip_assignments where trip_id = v_trip and end_reason = 'trip_completed';
  raise notice 'TEST C23: %', case when r_driver like 'OK:%' and r_ops = 'ZW003' and r_ops2 = 'ZW004' and n_completed = 1 and n_recovery = 0 and n_closed = 1
      and (select completed_at from public.trips where id = v_trip) = v_completed_at
    then 'PASS (Driver completes first: recovery with the old state -> ZW003, with the new state -> ZW004; one trip_completed, no recovery event, one closure, completed_at unchanged)'
    else format('FAIL (driver=%s ops=%s ops2=%s completed=%s recovery=%s closed=%s)', r_driver, r_ops, r_ops2, n_completed, n_recovery, n_closed) end;
end $$;

do $$
declare v_trip uuid; v_trip2 uuid; v_at timestamptz := now(); r_ops text; r_driver text; r_driver2 text;
        n_completed int; n_recovery int; n_closed int; n_active int; v_completed_at timestamptz;
begin
  v_trip := public.r2c_trip('c24', 'arrived_at_destination');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  r_ops := public.r2c_call(v_trip, 'arrived_at_destination', v_at);
  -- The Driver's pending taps carry the old state. The Driver path checks its ACTIVE assignment before the state, and
  -- recovery closed that assignment, so the rejection code is ZW001 ("no longer available for this trip") -- the same
  -- code a Driver receives after an Operations cancel. Either way: rejected, nothing written.
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a3');
  r_driver := public.r2c_driver(v_trip, 'driver_complete_trip', 'arrived_at_destination');
  v_trip2 := public.r2c_trip('c24b', 'passenger_onboard');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a2');
  perform public.r2c_call(v_trip2, 'passenger_onboard', now());
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a3');
  r_driver2 := public.r2c_driver(v_trip2, 'driver_start_to_destination', 'passenger_onboard');
  select completed_at into v_completed_at from public.trips where id = v_trip;
  select count(*) into n_completed from public.trip_events where trip_id in (v_trip, v_trip2) and event_type in ('trip_completed', 'en_route_to_destination', 'arrived_at_destination');
  select count(*) into n_recovery from public.trip_events where trip_id = v_trip and event_type = 'completion_recorded_by_operations';
  select count(*) filter (where end_reason = 'trip_completed'), count(*) filter (where ended_at is null)
    into n_closed, n_active from public.trip_assignments where trip_id = v_trip;
  raise notice 'TEST C24: %', case when r_ops like 'OK:%' and r_driver = 'ZW001' and r_driver2 = 'ZW001'
      and n_recovery = 1 and n_closed = 1 and n_active = 0 and v_completed_at = v_at
      and n_completed = (select count(*) from public.trip_events where trip_id = v_trip and event_type in ('en_route_to_destination', 'arrived_at_destination'))
    then 'PASS (Operations completes first: the Driver''s stale complete / start-to-destination taps are rejected (ZW001); no trip_completed, no new milestone, one recovery event, one closure, completed_at unchanged)'
    else format('FAIL (ops=%s driver=%s driver2=%s recovery=%s closed=%s active=%s completed_at=%s)', r_ops, r_driver, r_driver2, n_recovery, n_closed, n_active, v_completed_at) end;
end $$;

-- ----------------------------------------------------------------------------------------------- C25 no fabrication
do $$
declare v_trip uuid; v_types text;
begin
  v_trip := public.r2c_trip('c25', 'passenger_onboard');
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  perform public.r2c_call(v_trip, 'passenger_onboard', now());
  select string_agg(event_type, ',' order by event_type) into v_types from public.trip_events where trip_id = v_trip;
  raise notice 'TEST C25: %', case when v_types = 'arrived_at_pickup,completion_recorded_by_operations,en_route_to_pickup,passenger_onboard'
    then 'PASS (recovery from passenger_onboard: only the real Driver events + one recovery event; NO en_route_to_destination / arrived_at_destination / trip_completed)'
    else 'FAIL (events=' || v_types || ')' end;
end $$;

-- ----------------------------------------------------------------------------------------------- C26 assignment history
do $$
declare v_trip uuid; v_first uuid; v_before jsonb; v_after jsonb; n int; v_active uuid;
begin
  v_trip := public.r2c_trip('c26', 'passenger_onboard');
  select id into v_active from public.trip_assignments where trip_id = v_trip and ended_at is null;
  insert into public.trip_assignments (organization_id, trip_id, driver_id, vehicle_id, assigned_by, assigned_at, ended_at, end_reason)
  values ('10000000-0000-0000-0000-0000000000a1', v_trip, '30000000-0000-0000-0000-0000000000a2', null,
          '20000000-0000-0000-0000-0000000000a1', now() - interval '3 hours', now() - interval '150 minutes', 'reassigned')
  returning id into v_first;
  select to_jsonb(ta) into v_before from public.trip_assignments ta where id = v_first;
  perform public.r2c_as('20000000-0000-0000-0000-0000000000a1');
  perform public.r2c_call(v_trip, 'passenger_onboard', now());
  select to_jsonb(ta) into v_after from public.trip_assignments ta where id = v_first;
  select count(*) into n from public.trip_assignments where trip_id = v_trip;
  raise notice 'TEST C26: %', case when n = 2 and v_before = v_after
      and (select end_reason = 'trip_completed' and ended_at is not null and driver_id = '30000000-0000-0000-0000-0000000000a1'
           from public.trip_assignments where id = v_active)
    then 'PASS (assignment history retained: the earlier reassigned row unchanged; the active row closed in place, never deleted or re-pointed)'
    else format('FAIL (rows=%s before=%s after=%s)', n, v_before, v_after) end;
end $$;

-- ----------------------------------------------------------------------------------------------- C27 / C28 security
do $$
declare f regprocedure := 'public.record_trip_completion_by_operations(uuid,text,timestamptz,text)'::regprocedure;
begin
  if not has_function_privilege('public', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')
     and has_function_privilege('authenticated', f, 'EXECUTE')
     and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = f)
     and (select prorettype = 'public.trip_transition_result'::regtype from pg_proc where oid = f)
     and (select count(*) from pg_proc where proname = 'record_trip_completion_by_operations' and pronamespace = 'public'::regnamespace) = 1 then
    raise notice 'TEST C27: PASS (single overload; SECURITY DEFINER; search_path pinned; returns trip_transition_result; PUBLIC / anon no EXECUTE; authenticated EXECUTE)';
  else
    raise notice 'TEST C27: FAIL';
  end if;
end $$;

do $$
declare v_def text := pg_get_constraintdef((select oid from pg_constraint where conname = 'trip_events_event_type_check'));
begin
  if v_def like '%completion_recorded_by_operations%' and v_def like '%trip_completed%' and v_def like '%trip_details_updated%'
     and not has_table_privilege('authenticated', 'public.trips', 'UPDATE') and not has_any_column_privilege('authenticated', 'public.trips', 'UPDATE')
     and not has_any_column_privilege('authenticated', 'public.trip_assignments', 'UPDATE')
     and not has_table_privilege('authenticated', 'public.trip_events', 'INSERT')
     and not has_table_privilege('authenticated', 'public.audit_events', 'INSERT') then
    raise notice 'TEST C28: PASS (vocabulary extended, existing types intact; no direct trips / trip_assignments UPDATE and no trip_events / audit_events INSERT for authenticated -- full contract via scripts/verify-db-privileges.sh)';
  else
    raise notice 'TEST C28: FAIL';
  end if;
end $$;

rollback;

-- ----------------------------------------------------------------------------------------------- cleanup verification
do $$
begin
  if (select count(*) from pg_proc where proname like 'r2c\_%' and pronamespace = 'public'::regnamespace) = 0
     and (select count(*) from public.trips where pickup_description like 'R2C %') = 0
     and (select count(*) from public.trip_events where event_type = 'completion_recorded_by_operations') = 0
     and (select count(*) from public.audit_events where action = 'trip_completion_recorded_by_operations') = 0
     and (select status from public.organizations where id = '10000000-0000-0000-0000-0000000000a1') = 'active' then
    raise notice 'TEST CLEANUP: PASS (rolled back: no helper, fixture Trip, recovery event or audit row remains; Org A active)';
  else
    raise notice 'TEST CLEANUP: FAIL';
  end if;
end $$;
