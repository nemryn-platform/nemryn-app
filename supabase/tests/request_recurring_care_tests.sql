-- P1-PILOT-R3 -- Request -> Recurring Care (PR-04): recurring_arrangements.request_id + create_recurring_arrangement
-- p_request_id. Fully transactional (BEGIN ... ROLLBACK): rerunnable, leaves nothing behind (verified after ROLLBACK).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/request_recurring_care_tests.sql
-- Actor identity is the JWT subject (auth.uid()). r3_make returns the new arrangement id or the SQLSTATE (a failed call
-- is rolled back to its own savepoint, so it can never leave a partial write).
begin;

-- ---------------------------------------------------------------------------------------------- fixtures (postgres)
create function public.r3_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
$$;

create function public.r3_request(p_label text, p_state text, p_passenger uuid default '40000000-0000-0000-0000-0000000000a1',
                                  p_org uuid default '10000000-0000-0000-0000-0000000000a1') returns uuid
language sql as $$
  insert into public.transportation_requests (organization_id, passenger_id, requester_name, requester_relationship,
    requester_phone, requester_email, pickup_description, destination_description, return_trip_needed, state, source,
    service_type, recurring_days_of_week, recurring_start_date, recurring_appointment_time, recurring_return_trip_expected,
    assistance_notes, additional_notes)
  values (p_org, p_passenger, 'R3 Requester ' || p_label, 'family', '555-0303', 'r3-requester@example.test',
    'R3 ' || p_label || ' home', 'R3 ' || p_label || ' dialysis', 'yes', p_state, 'phone',
    'dialysis', array[1,3,5]::smallint[], (now() at time zone 'America/New_York')::date + 1, '10:00', true,
    'R3 private assistance note', 'R3 private additional note')
  returning id;
$$;

-- create_recurring_arrangement with (optionally) p_request_id; returns arrangement id or SQLSTATE.
create function public.r3_make(p_request uuid, p_passenger uuid default '40000000-0000-0000-0000-0000000000a1',
                               p_org uuid default '10000000-0000-0000-0000-0000000000a1', p_wheelchair boolean default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.recurring_arrangement_result;
begin
  begin
    r := public.create_recurring_arrangement(p_organization_id => p_org, p_passenger_id => p_passenger,
      p_pickup_description => 'R3 arrangement pickup', p_destination_description => 'R3 arrangement dialysis',
      p_pickup_time => '09:15', p_days_of_week => array[5,1,3]::smallint[],
      p_start_date => (now() at time zone 'America/New_York')::date, p_requires_wheelchair_access => p_wheelchair,
      p_request_id => p_request);
    return r.arrangement_id::text;
  exception when others then
    return sqlstate;
  end;
end $$;

create function public.r3_is_uuid(p text) returns boolean language sql immutable as $$ select p ~ '^[0-9a-f]{8}-' $$;

-- The R3 stranded predicate in SQL (the PostgREST anti-join's meaning): accepted AND no non-cancelled linked Trip AND
-- no linked arrangement of ANY status.
create function public.r3_stranded(p_request uuid) returns boolean language sql stable as $$
  select r.state = 'accepted'
     and not exists (select 1 from public.trips t where t.request_id = r.id and t.organization_id = r.organization_id and t.state <> 'cancelled')
     and not exists (select 1 from public.recurring_arrangements a where a.request_id = r.id and a.organization_id = r.organization_id)
  from public.transportation_requests r where r.id = p_request;
$$;

insert into public.passengers (id, organization_id, display_name, status)
values ('4f000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a1', 'R3 Other Passenger', 'active'),
       ('4f000000-0000-0000-0000-0000000000aa', '10000000-0000-0000-0000-0000000000a1', 'R3 Inactive Passenger', 'inactive');

-- ----------------------------------------------------------------------------------------------- R3-01 / R3-02 legacy callers
do $$
declare r8 public.recurring_arrangement_result; r9 public.recurring_arrangement_result;
begin
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  r8 := public.create_recurring_arrangement(p_organization_id => '10000000-0000-0000-0000-0000000000a1',
    p_passenger_id => '40000000-0000-0000-0000-0000000000a1', p_pickup_description => 'R3 legacy8 pickup',
    p_destination_description => 'd', p_pickup_time => '07:00', p_days_of_week => array[2]::smallint[],
    p_start_date => current_date, p_end_date => null);
  raise notice 'TEST R3-01: %', case when r8.arrangement_id is not null
      and (select request_id is null and requires_wheelchair_access is null from public.recurring_arrangements where id = r8.arrangement_id)
    then 'PASS (legacy 8-argument named caller (no wheelchair, no request) works; request_id NULL)' else 'FAIL' end;
  r9 := public.create_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'R3 legacy9 pickup', 'd', '07:30'::time, array[4]::smallint[], current_date, null::date, true);
  raise notice 'TEST R3-02: %', case when r9.arrangement_id is not null
      and (select request_id is null and requires_wheelchair_access from public.recurring_arrangements where id = r9.arrangement_id)
    then 'PASS (existing 9-argument positional caller with wheelchair works; request_id NULL)' else 'FAIL' end;
end $$;

-- ----------------------------------------------------------------------------------------------- R3-03 / R3-04 linked create
do $$
declare v_req uuid := public.r3_request('r03', 'accepted'); v_res text; v_before timestamptz; a record;
begin
  select updated_at into v_before from public.transportation_requests where id = v_req;
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  v_res := public.r3_make(v_req);
  select * into a from public.recurring_arrangements where id = case when public.r3_is_uuid(v_res) then v_res::uuid end;
  raise notice 'TEST R3-03: %', case when public.r3_is_uuid(v_res) and a.request_id = v_req and a.passenger_id = '40000000-0000-0000-0000-0000000000a1'
      and a.status = 'active' and a.days_of_week = array[1,3,5]::smallint[]
    then 'PASS (accepted same-org Request + matching linked Passenger -> arrangement created with request_id)' else 'FAIL (' || v_res || ')' end;
  raise notice 'TEST R3-04: %', case when (select state = 'accepted' and updated_at = v_before from public.transportation_requests where id = v_req)
      and (select count(*) from public.request_events where request_id = v_req) = 0
    then 'PASS (the Request is untouched: still accepted, updated_at unchanged, no request event)' else 'FAIL' end;
end $$;

-- ----------------------------------------------------------------------------------------------- R3-05..R3-10 Request rules
do $$
declare r_pending text; r_declined text; r_cancelled text; r_foreign text; r_ghost text; r_mismatch text; r_nopass text; r_inactive text;
        v_nopass uuid; v_inactive uuid; n int;
begin
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  r_pending := public.r3_make(public.r3_request('r05', 'pending'));
  r_declined := public.r3_make(public.r3_request('r06', 'declined'));
  r_cancelled := public.r3_make(public.r3_request('r07', 'cancelled'));
  r_foreign := public.r3_make(public.r3_request('r08', 'accepted', '40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1'));
  r_ghost := public.r3_make(gen_random_uuid());
  r_mismatch := public.r3_make(public.r3_request('r09', 'accepted'), '4f000000-0000-0000-0000-0000000000a9');
  v_nopass := public.r3_request('r10', 'accepted', null);
  r_nopass := public.r3_make(v_nopass);
  v_inactive := public.r3_request('r10b', 'accepted', '4f000000-0000-0000-0000-0000000000aa');
  r_inactive := public.r3_make(v_inactive, '4f000000-0000-0000-0000-0000000000aa');
  select count(*) into n from public.recurring_arrangements where pickup_description = 'R3 arrangement pickup' and request_id is not null
    and request_id in (select id from public.transportation_requests where requester_name in
      ('R3 Requester r05', 'R3 Requester r06', 'R3 Requester r07', 'R3 Requester r08', 'R3 Requester r09', 'R3 Requester r10', 'R3 Requester r10b'));
  raise notice 'TEST R3-05: %', case when r_pending = 'ZW006' then 'PASS (pending Request -> ZW006)' else 'FAIL (' || r_pending || ')' end;
  raise notice 'TEST R3-06: %', case when r_declined = 'ZW006' then 'PASS (declined Request -> ZW006)' else 'FAIL (' || r_declined || ')' end;
  raise notice 'TEST R3-07: %', case when r_cancelled = 'ZW006' then 'PASS (cancelled Request -> ZW006)' else 'FAIL (' || r_cancelled || ')' end;
  raise notice 'TEST R3-08: %', case when r_foreign = 'ZW006' and r_ghost = 'ZW006'
    then 'PASS (foreign-tenant Request and nonexistent Request -> the identical ZW006; no oracle)' else format('FAIL (foreign=%s ghost=%s)', r_foreign, r_ghost) end;
  raise notice 'TEST R3-09: %', case when r_mismatch = 'ZW006' then 'PASS (p_passenger_id <> the Request''s linked Passenger -> ZW006)' else 'FAIL (' || r_mismatch || ')' end;
  raise notice 'TEST R3-10: %', case when r_nopass = 'ZW006' and r_inactive = 'ZW006' and n = 0
    then 'PASS (Request without a linked Passenger / with an inactive linked Passenger -> ZW006; nothing created by R3-05..R3-10)'
    else format('FAIL (nopass=%s inactive=%s created=%s)', r_nopass, r_inactive, n) end;
end $$;

-- ----------------------------------------------------------------------------------------------- R3-11..R3-16 authorization
do $$
declare v_req uuid := public.r3_request('r11', 'accepted'); r_admin text; r_disp text; r_driver text; r_inactive text; r_platform text;
        r_none text; r_susp text; r_noauth text;
begin
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1'); r_admin := public.r3_make(v_req);
  perform public.r3_as('20000000-0000-0000-0000-0000000000a2'); r_disp := public.r3_make(v_req);
  perform public.r3_as('20000000-0000-0000-0000-0000000000a3'); r_driver := public.r3_make(v_req);
  perform public.r3_as('20000000-0000-0000-0000-0000000000a5'); r_inactive := public.r3_make(v_req);
  perform public.r3_as('20000000-0000-0000-0000-0000000000d1'); r_platform := public.r3_make(v_req);
  perform public.r3_as('20000000-0000-0000-0000-0000000000e1'); r_none := public.r3_make(v_req);
  update public.organizations set status = 'inactive' where id = '10000000-0000-0000-0000-0000000000a1';
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1'); r_susp := public.r3_make(v_req);
  update public.organizations set status = 'active' where id = '10000000-0000-0000-0000-0000000000a1';
  perform public.r3_as(null); r_noauth := public.r3_make(v_req);
  raise notice 'TEST R3-11: %', case when public.r3_is_uuid(r_admin) then 'PASS (Organization Admin allowed)' else 'FAIL (' || r_admin || ')' end;
  raise notice 'TEST R3-12: %', case when public.r3_is_uuid(r_disp) then 'PASS (Dispatcher allowed; a second arrangement from the same Request)' else 'FAIL (' || r_disp || ')' end;
  raise notice 'TEST R3-13: %', case when r_driver = 'ZW002' then 'PASS (Driver -> ZW002)' else 'FAIL (' || r_driver || ')' end;
  raise notice 'TEST R3-14: %', case when r_inactive = 'ZW002' then 'PASS (inactive membership -> ZW002)' else 'FAIL (' || r_inactive || ')' end;
  raise notice 'TEST R3-15: %', case when r_susp = 'ZW002' then 'PASS (suspended organization -> ZW002)' else 'FAIL (' || r_susp || ')' end;
  raise notice 'TEST R3-15b: %', case when r_platform = 'ZW002' and r_none = 'ZW002' and r_noauth = 'ZW001'
    then 'PASS (Platform Admin without membership / no membership -> ZW002; no auth -> ZW001)' else format('FAIL (platform=%s none=%s noauth=%s)', r_platform, r_none, r_noauth) end;
end $$;

do $$
begin
  set local role anon;
  perform public.create_recurring_arrangement('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
    'a', 'b', '09:00', array[1]::smallint[], current_date, null, null, gen_random_uuid());
  raise notice 'TEST R3-16: FAIL (anon executed create_recurring_arrangement)';
exception when insufficient_privilege then
  raise notice 'TEST R3-16: PASS (anon -> permission denied)';
end $$;
reset role;

-- ----------------------------------------------------------------------------------------------- R3-17..R3-21 lifecycle / fulfilment
do $$
declare v_req uuid := public.r3_request('r17', 'accepted'); v_arr uuid; v_second text; p text; r text; e text;
begin
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  v_arr := public.r3_make(v_req)::uuid;
  perform public.edit_recurring_arrangement('10000000-0000-0000-0000-0000000000a1', v_arr, 'R3 edited pickup', 'R3 edited dest', '10:30', array[2,4]::smallint[], current_date, null);
  perform public.set_recurring_wheelchair_requirement('10000000-0000-0000-0000-0000000000a1', v_arr, true);
  perform public.pause_recurring_arrangement('10000000-0000-0000-0000-0000000000a1', v_arr);
  select request_id::text into p from public.recurring_arrangements where id = v_arr;
  perform public.resume_recurring_arrangement('10000000-0000-0000-0000-0000000000a1', v_arr);
  select request_id::text into r from public.recurring_arrangements where id = v_arr;
  perform public.end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1', v_arr, 'Standing order concluded');
  select request_id::text into e from public.recurring_arrangements where id = v_arr;
  raise notice 'TEST R3-17: %', case when p = v_req::text then 'PASS (request_id retained after edit + wheelchair change + pause)' else 'FAIL (' || coalesce(p, 'null') || ')' end;
  raise notice 'TEST R3-18: %', case when r = v_req::text then 'PASS (request_id retained after resume)' else 'FAIL' end;
  raise notice 'TEST R3-19: %', case when e = v_req::text and (select status from public.recurring_arrangements where id = v_arr) = 'ended'
    then 'PASS (request_id retained after end)' else 'FAIL' end;
  raise notice 'TEST R3-20: %', case when public.r3_stranded(v_req) = false
    then 'PASS (the ONLY linked arrangement is ended -> the Request is still fulfilled, not stranded (D-R3-1); core tests cover the app side)'
    else 'FAIL' end;
  v_second := public.r3_make(v_req);
  raise notice 'TEST R3-21: %', case when public.r3_is_uuid(v_second) and (select count(*) from public.recurring_arrangements where request_id = v_req) = 2
    then 'PASS (a second arrangement may reference the same Request, also after the first ended)' else 'FAIL (' || v_second || ')' end;
end $$;

do $$
declare v_plain uuid := public.r3_request('r20b', 'accepted'); v_cancelled_trip uuid;
begin
  -- stranded predicate truth table (SQL mirror of the Overview / needs=trip anti-join)
  insert into public.trips (organization_id, passenger_id, request_id, state, pickup_description, destination_description)
  values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', v_plain, 'cancelled', 'R3 c', 'R3 c')
  returning id into v_cancelled_trip;
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  if public.r3_stranded(v_plain) then
    perform public.r3_make(v_plain);
    raise notice 'TEST R3-20b: %', case when not public.r3_stranded(v_plain)
      then 'PASS (cancelled-only Trips: stranded; + a linked arrangement: fulfilled)' else 'FAIL (still stranded)' end;
  else
    raise notice 'TEST R3-20b: FAIL (cancelled-only Trips should be stranded)';
  end if;
end $$;

do $$
begin
  raise notice 'TEST R3-22: %', case when not exists (
      select 1 from pg_index i join pg_class c on c.oid = i.indrelid
      where c.relname = 'recurring_arrangements' and i.indisunique
        and (select array_agg(attname::text order by attname) from pg_attribute where attrelid = c.oid and attnum = any (i.indkey)) @> array['request_id'])
    and exists (select 1 from pg_indexes where indexname = 'recurring_arrangements_org_request_idx' and indexdef like '%WHERE (request_id IS NOT NULL)%')
    and (select confdeltype = 'a' and confupdtype = 'a' from pg_constraint where conname = 'recurring_arrangements_request_id_organization_id_fkey')
    and not exists (select 1 from public.recurring_arrangements where request_id is not null and pickup_description not like 'R3 %')
    then 'PASS (no UNIQUE index / constraint on request_id; non-unique partial index; composite FK NO ACTION (no cascade); pre-existing rows NULL)'
    else 'FAIL' end;
end $$;

-- ----------------------------------------------------------------------------------------------- R3-23 / R3-24 occurrences
do $$
declare v_req uuid := public.r3_request('r23', 'accepted'); v_arr uuid; v_trip public.trip_creation_result; t public.trips; svc date;
begin
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  v_arr := public.r3_make(v_req, p_wheelchair => true)::uuid;
  svc := (now() at time zone 'America/New_York')::date;
  while not (extract(isodow from svc)::int = any (array[1,3,5])) loop svc := svc + 1; end loop;
  v_trip := public.create_trip_for_recurring_occurrence('10000000-0000-0000-0000-0000000000a1', v_arr, svc);
  select * into t from public.trips where id = v_trip.trip_id;
  raise notice 'TEST R3-23: %', case when t.recurring_arrangement_id = v_arr and t.request_id is null
    then 'PASS (occurrence Trip links the arrangement only; it does NOT receive the Request id)' else 'FAIL (request_id=' || coalesce(t.request_id::text, 'null') || ')' end;
  raise notice 'TEST R3-24: %', case when t.requires_wheelchair_access is true
    then 'PASS (wheelchair requirement snapshotted onto the occurrence exactly as before)' else 'FAIL' end;
end $$;

-- ----------------------------------------------------------------------------------------------- R3-25 audit
do $$
declare v_req uuid := public.r3_request('r25', 'accepted'); v_arr uuid; v_after jsonb; v_plain uuid; v_plain_after jsonb;
begin
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  v_arr := public.r3_make(v_req)::uuid;
  v_plain := public.r3_make(null)::uuid;
  select after_data into v_after from public.audit_events where entity_id = v_arr and action = 'recurring_arrangement_created';
  select after_data into v_plain_after from public.audit_events where entity_id = v_plain and action = 'recurring_arrangement_created';
  raise notice 'TEST R3-25: %', case when v_after->>'request_id' = v_req::text and not (v_plain_after ? 'request_id')
      and v_after::text !~ '(R3 Requester|555-0303|r3-requester@|private assistance|private additional)'
    then 'PASS (creation audit carries request_id only when supplied; no requester name / phone / email / notes)'
    else 'FAIL (' || v_after::text || ')' end;
end $$;

-- ----------------------------------------------------------------------------------------------- R3-26..R3-28 security
do $$
declare f regprocedure := 'public.create_recurring_arrangement(uuid,uuid,text,text,time,smallint[],date,date,boolean,uuid)'::regprocedure;
begin
  raise notice 'TEST R3-26: %', case when (select count(*) from pg_proc where proname = 'create_recurring_arrangement' and pronamespace = 'public'::regnamespace) = 1
      and to_regprocedure('public.create_recurring_arrangement(uuid,uuid,text,text,time,smallint[],date,date,boolean)') is null
    then 'PASS (exactly one overload -- the 10-argument identity; no transitional 9-argument version)' else 'FAIL' end;
  raise notice 'TEST R3-27: %', case when not has_function_privilege('public', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')
      and has_function_privilege('authenticated', f, 'EXECUTE')
      and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = f)
    then 'PASS (SECURITY DEFINER; search_path pinned; PUBLIC / anon no EXECUTE; authenticated EXECUTE)' else 'FAIL' end;
  raise notice 'TEST R3-28: %', case when not has_table_privilege('authenticated', 'public.recurring_arrangements', 'UPDATE')
      and not has_any_column_privilege('authenticated', 'public.recurring_arrangements', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.recurring_arrangements', 'INSERT')
      and not has_any_column_privilege('authenticated', 'public.trips', 'UPDATE')
      and not has_any_column_privilege('authenticated', 'public.transportation_requests', 'UPDATE')
      and to_regprocedure('public.record_trip_completion_by_operations(uuid,text,timestamptz,text)') is not null
    then 'PASS (no direct recurring_arrangements INSERT / UPDATE; R2B trips / requests revokes and the R2C RPC intact -- full contract via scripts/verify-db-privileges.sh)'
    else 'FAIL' end;
end $$;

-- ----------------------------------------------------------------------------------------------- R3-H hardening: Request
-- mutation guards after conversion (link_request_passenger / cancel_transportation_request)
create function public.r3_link(p_request uuid, p_passenger uuid, p_org uuid default '10000000-0000-0000-0000-0000000000a1') returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.request_passenger_link_result;
begin
  begin
    r := public.link_request_passenger(p_org, p_request, p_passenger);
    return 'OK:' || r.changed;
  exception when others then return sqlstate; end;
end $$;

create function public.r3_cancel(p_request uuid, p_org uuid default '10000000-0000-0000-0000-0000000000a1') returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.request_transition_result;
begin
  begin
    r := public.cancel_transportation_request(p_org, p_request, 'requester_cancelled', null);
    return 'OK:' || r.current_state;
  exception when others then return sqlstate; end;
end $$;

-- An accepted Request (linked to Passenger A1) with one arrangement in the given status.
create function public.r3_converted(p_label text, p_status text) returns uuid
language plpgsql as $$
declare v_req uuid := public.r3_request(p_label, 'accepted'); v_arr uuid;
begin
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  v_arr := public.r3_make(v_req)::uuid;
  if p_status in ('paused', 'ended') then perform public.pause_recurring_arrangement('10000000-0000-0000-0000-0000000000a1', v_arr); end if;
  if p_status = 'ended' then perform public.end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1', v_arr, 'Standing order concluded'); end if;
  if (select status from public.recurring_arrangements where id = v_arr) <> p_status then raise exception 'fixture % not %', p_label, p_status; end if;
  return v_req;
end $$;

do $$
declare v_a uuid := public.r3_request('hA', 'accepted', null); v_b uuid := public.r3_request('hB', 'accepted'); ra text; rb text;
begin
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  ra := public.r3_link(v_a, '40000000-0000-0000-0000-0000000000a1');
  rb := public.r3_cancel(v_b);
  raise notice 'TEST R3-H-A: %', case when ra = 'OK:true' and (select passenger_id from public.transportation_requests where id = v_a) = '40000000-0000-0000-0000-0000000000a1'
    then 'PASS (accepted, no Trip, no arrangement: Link Passenger still allowed)' else 'FAIL (' || ra || ')' end;
  raise notice 'TEST R3-H-B: %', case when rb = 'OK:cancelled' then 'PASS (accepted, no Trip, no arrangement: Cancel still allowed)' else 'FAIL (' || rb || ')' end;
end $$;

do $$
declare v_status text; v_req uuid; rl text; rc text; v_before record; v_after record; n_before int; n_after int; bad text := '';
begin
  foreach v_status in array array['active', 'paused', 'ended'] loop
    v_req := public.r3_converted('h-' || v_status, v_status);
    select state, passenger_id, updated_at into v_before from public.transportation_requests where id = v_req;
    select count(*) into n_before from public.request_events where request_id = v_req;
    perform public.r3_as('20000000-0000-0000-0000-0000000000a2');
    rl := public.r3_link(v_req, '4f000000-0000-0000-0000-0000000000a9');
    rc := public.r3_cancel(v_req);
    select state, passenger_id, updated_at into v_after from public.transportation_requests where id = v_req;
    select count(*) into n_after from public.request_events where request_id = v_req;
    raise notice 'TEST R3-H-%: %', case v_status when 'active' then 'C/F' when 'paused' then 'D/G' else 'E/H' end,
      case when rl = 'ZW004' and rc = 'ZW004' and v_after = v_before and n_after = n_before
             and (select status from public.recurring_arrangements where request_id = v_req) = v_status
        then 'PASS (' || v_status || ' linked arrangement: Link Passenger ZW004 and Cancel ZW004; Request unchanged, no event, arrangement untouched)'
        else format('FAIL (%s link=%s cancel=%s)', v_status, rl, rc) end;
  end loop;
end $$;

do $$
declare v_req uuid := public.r3_converted('hI', 'ended'); rl text; rc text;
begin
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  perform public.r3_make(v_req);
  rl := public.r3_link(v_req, '4f000000-0000-0000-0000-0000000000a9');
  rc := public.r3_cancel(v_req);
  raise notice 'TEST R3-H-I: %', case when rl = 'ZW004' and rc = 'ZW004' and (select count(*) from public.recurring_arrangements where request_id = v_req) = 2
    then 'PASS (multiple linked arrangements (ended + active): same denial)' else format('FAIL (link=%s cancel=%s)', rl, rc) end;
end $$;

do $$
declare v_req uuid := public.r3_request('hJ', 'accepted'); rl text; rc text;
begin
  insert into public.trips (organization_id, passenger_id, request_id, state, pickup_description, destination_description)
  values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', v_req, 'cancelled', 'R3 hJ', 'R3 hJ');
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  rl := public.r3_link(v_req, '4f000000-0000-0000-0000-0000000000a9');
  rc := public.r3_cancel(v_req);
  raise notice 'TEST R3-H-J: %', case when rl = 'ZW004' and rc = 'ZW004'
    then 'PASS (no arrangement but a linked Trip (even cancelled): existing Trip guard unchanged -- ZW004 / ZW004)' else format('FAIL (link=%s cancel=%s)', rl, rc) end;
end $$;

do $$
declare v_a uuid := public.r3_request('hK', 'accepted'); v_b_req uuid; v_b_arr text; ra text; rb_foreign text;
begin
  -- Org B converts its own Request; it can not affect Org A's Request, and Org B can not act on Org A's.
  v_b_req := public.r3_request('hK-B', 'accepted', '40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1');
  perform public.r3_as('20000000-0000-0000-0000-0000000000b1');
  v_b_arr := public.r3_make(v_b_req, '40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1');
  rb_foreign := public.r3_cancel(v_a, '10000000-0000-0000-0000-0000000000a1');
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  ra := public.r3_cancel(v_a);
  raise notice 'TEST R3-H-K: %', case when public.r3_is_uuid(v_b_arr) and ra = 'OK:cancelled' and rb_foreign = 'ZW002'
    then 'PASS (a foreign-tenant arrangement does not affect this organization''s Request (Cancel allowed); the foreign Admin gets ZW002, no oracle)'
    else format('FAIL (b_arr=%s a_cancel=%s foreign=%s)', v_b_arr, ra, rb_foreign) end;
end $$;

do $$
declare v_req uuid := public.r3_converted('hL', 'active');
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-0000000000a1', true);
  begin
    update public.transportation_requests set state = 'cancelled' where id = v_req;
    raise notice 'TEST R3-H-L: FAIL (direct UPDATE was allowed)';
  exception when insufficient_privilege then
    raise notice 'TEST R3-H-L: PASS (Organization Admin: direct UPDATE of transportation_requests -> permission denied)';
  end;
end $$;
reset role;

do $$
declare v_req uuid := public.r3_converted('hM', 'active'); v_second text; v_arrs uuid[];
begin
  perform public.r3_as('20000000-0000-0000-0000-0000000000a2');
  v_second := public.r3_make(v_req);
  raise notice 'TEST R3-H-M: %', case when public.r3_is_uuid(v_second) and (select count(*) from public.recurring_arrangements where request_id = v_req) = 2
    then 'PASS (another recurring arrangement from the same accepted Request still succeeds after the guards)' else 'FAIL (' || v_second || ')' end;
  select array_agg(id) into v_arrs from public.recurring_arrangements where request_id = v_req;
  perform public.r3_as('20000000-0000-0000-0000-0000000000a1');
  perform public.end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1', v_arrs[1], 'Concluded');
  perform public.end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1', v_arrs[2], 'Concluded');
  raise notice 'TEST R3-H-N: %', case when (select state from public.transportation_requests where id = v_req) = 'accepted'
      and (select count(*) from public.recurring_arrangements where request_id = v_req and status = 'ended') = 2
      and not public.r3_stranded(v_req)
    then 'PASS (every linked arrangement ended: Request still accepted, request_id intact, fulfilled -- not stranded)' else 'FAIL' end;
end $$;

rollback;

-- ----------------------------------------------------------------------------------------------- cleanup verification
do $$
begin
  if (select count(*) from pg_proc where proname like 'r3\_%' and pronamespace = 'public'::regnamespace) = 0
     and (select count(*) from public.transportation_requests where requester_name like 'R3 Requester %') = 0
     and (select count(*) from public.recurring_arrangements where pickup_description like 'R3 %') = 0
     and (select count(*) from public.recurring_arrangements where request_id is not null) = 0
     and (select count(*) from public.passengers where display_name like 'R3 %') = 0
     and (select status from public.organizations where id = '10000000-0000-0000-0000-0000000000a1') = 'active' then
    raise notice 'TEST CLEANUP: PASS (rolled back: no helper, Request, arrangement or passenger fixture remains; Org A active)';
  else
    raise notice 'TEST CLEANUP: FAIL';
  end if;
end $$;
