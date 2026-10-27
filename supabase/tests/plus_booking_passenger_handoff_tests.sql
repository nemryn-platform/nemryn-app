-- Nemryn Plus -- passenger at conversion / rebooking (NP-PILOT-P1, migration 20261028100000). ROLLBACK-ONLY.
--   docker exec -i supabase_db_NemrynS1Iso psql -U postgres -d postgres -f - < supabase/tests/plus_booking_passenger_handoff_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- FICTIONAL seed fixtures only (Org A admin a1, driver a3; Org B admin b1). Side effects are evaluated into variables
-- BEFORE assertions. A refused passenger / rider name must leave NOTHING behind: no Request, attribution, activity, audit,
-- opportunity change -- and must not consume the idempotency key.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table t_results (n serial, name text, ok boolean, detail text);

create function pg_temp.t(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;
create function pg_temp.contact(p_org uuid, p_name text, p_creator uuid) returns uuid language sql as $$
  insert into public.plus_contacts (organization_id, display_name, phone, contact_kind, created_by)
  values (p_org, p_name, '(404) 555-0123', 'individual', p_creator) returning id;
$$;
create function pg_temp.opp(p_org uuid, p_contact uuid, p_title text, p_creator uuid) returns uuid language sql as $$
  insert into public.plus_opportunities (organization_id, title, stage, primary_contact_id, source, created_by)
  values (p_org, p_title, 'qualified', p_contact, 'phone', p_creator) returning id;
$$;
create function pg_temp.passenger(p_org uuid, p_name text, p_status text default 'active') returns uuid language sql as $$
  insert into public.passengers (organization_id, display_name, phone, status) values (p_org, p_name, '404-555-0177', p_status) returning id;
$$;
-- convert as a caller -> 'changed=<bool>:<request_id>' / 'ERR:<sqlstate>:<message>'
create function pg_temp.conv(p_uid uuid, p_org uuid, p_opp uuid, p_key text, p_passenger uuid, p_name text)
returns text language plpgsql as $$
declare v text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    select 'changed=' || r.changed || ':' || r.request_id into v
    from public.plus_convert_opportunity_to_request(p_org, p_opp, (select updated_at from public.plus_opportunities where id = p_opp), p_key,
      'family', 'Fictional pickup 1 Elm', 'Fictional clinic', 'no', null, null, null, null, p_passenger, p_name) r;
  exception when others then v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end;
$$;
create function pg_temp.rebook(p_uid uuid, p_org uuid, p_contact uuid, p_key text, p_passenger uuid, p_name text)
returns text language plpgsql as $$
declare v text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    select 'changed=' || r.changed || ':' || r.request_id into v
    from public.plus_create_rebooking_request(p_org, p_contact, p_key, 'family', 'Fictional pickup 2 Oak', 'Fictional clinic', 'no', 'phone',
      null, null, null, null, null, p_passenger, p_name) r;
  exception when others then v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end;
$$;
create function pg_temp.rid(p_text text) returns uuid language sql as $$ select nullif(split_part(p_text, ':', 2), '')::uuid; $$;
-- everything a booking writes, as one comparable fingerprint
create function pg_temp.footprint(p_org uuid) returns text language sql as $$
  select (select count(*) from public.transportation_requests where organization_id = p_org) || '/'
      || (select count(*) from public.plus_request_attributions where organization_id = p_org) || '/'
      || (select count(*) from public.plus_activities where organization_id = p_org) || '/'
      || (select count(*) from public.audit_events where organization_id = p_org) || '/'
      || (select count(*) from public.request_events e join public.transportation_requests r on r.id = e.request_id where r.organization_id = p_org) || '/'
      || (select count(*) from public.passengers where organization_id = p_org) || '/'
      || (select count(*) from public.plus_opportunities where organization_id = p_org and stage = 'converted');
$$;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a3 constant uuid := '20000000-0000-0000-0000-0000000000a3';
  c_b1 constant uuid := '20000000-0000-0000-0000-0000000000b1';
  k uuid; k_b uuid; o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o_b uuid;
  p_ok uuid; p_other uuid; p_inactive uuid; p_b uuid;
  v text; v2 text; v3 text; v4 text; fp text; r1 uuid; r2 uuid;
begin
  delete from public.organization_modules where organization_id in (c_a, c_b);
  insert into public.organization_modules (organization_id, module, status, status_reason)
  values (c_a, 'plus', 'active', 'pilot-p1 handoff test'), (c_b, 'plus', 'active', 'pilot-p1 handoff test');
  k := pg_temp.contact(c_a, 'Handoff Dee Fictional', c_a1);
  k_b := pg_temp.contact(c_b, 'Handoff In B Fictional', c_b1);
  o1 := pg_temp.opp(c_a, k, 'Handoff linked', c_a1);
  o2 := pg_temp.opp(c_a, k, 'Handoff rider name', c_a1);
  o3 := pg_temp.opp(c_a, k, 'Handoff refused', c_a1);
  o4 := pg_temp.opp(c_a, k, 'Handoff driver probe', c_a1);
  o5 := pg_temp.opp(c_a, k, 'Handoff legacy', c_a1);
  o_b := pg_temp.opp(c_b, k_b, 'Handoff in B', c_b1);
  p_ok := pg_temp.passenger(c_a, 'Handoff Rose Fictional');
  p_other := pg_temp.passenger(c_a, 'Handoff Other Fictional');
  p_inactive := pg_temp.passenger(c_a, 'Handoff Old Fictional', 'inactive');
  p_b := pg_temp.passenger(c_b, 'Handoff B Rider Fictional');

  -- ---------------------------------------------------------------- signatures
  perform pg_temp.t('S1 exactly one function per name; new trailing parameters DEFAULT NULL; SECURITY DEFINER; pinned search_path; EXECUTE authenticated only',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('log_transportation_request', 'plus_convert_opportunity_to_request', 'plus_create_rebooking_request')) = 3
    and to_regprocedure('public.plus_convert_opportunity_to_request(uuid,uuid,timestamptz,text,text,text,text,text,date,time,text,text,uuid,text)') is not null
    and to_regprocedure('public.plus_create_rebooking_request(uuid,uuid,text,text,text,text,text,text,date,time,text,text,text,uuid,text)') is not null
    and to_regprocedure('public.log_transportation_request(uuid,text,text,text,text,text,text,text,text,uuid,date,time,text,text,text,text)') is not null
    and (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
           and pg_get_function_arguments(p.oid) ~ 'p_requested_passenger_name text DEFAULT NULL::text$'
           and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
           and not has_function_privilege('service_role', p.oid, 'execute'))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
           and p.proname in ('log_transportation_request', 'plus_convert_opportunity_to_request', 'plus_create_rebooking_request')));

  -- ---------------------------------------------------------------- existing passenger, linked atomically
  v := pg_temp.conv(c_a1, c_a, o1, 'handoff-o1-key-0001', p_ok, null);
  r1 := pg_temp.rid(v);
  perform pg_temp.t('P1 conversion with an ACTIVE same-organization passenger: one pending Request linked to it, no snapshot, opportunity converted',
    v like 'changed=true:%' and (select state || '|' || passenger_id || '|' || coalesce(requested_passenger_name, '-') from public.transportation_requests where id = r1) = 'pending|' || p_ok || '|-'
    and (select stage from public.plus_opportunities where id = o1) = 'converted', v);
  perform pg_temp.t('P2 the audit row stays ids-only (no passenger / rider name text)',
    not exists (select 1 from public.audit_events where organization_id = c_a and (after_data::text ilike '%Rose Fictional%' or coalesce(before_data::text, '') ilike '%Rose Fictional%')));

  -- ---------------------------------------------------------------- new rider name snapshot (D1 / D3)
  v := pg_temp.conv(c_a1, c_a, o2, 'handoff-o2-key-0001', null, '  Nia Newrider Fictional  ');
  r2 := pg_temp.rid(v);
  perform pg_temp.t('N1 conversion with a rider name: Request has NO passenger and the trimmed snapshot; no Passenger record is created',
    v like 'changed=true:%' and (select coalesce(passenger_id::text, '-') || '|' || requested_passenger_name from public.transportation_requests where id = r2) = '-|Nia Newrider Fictional'
    and not exists (select 1 from public.passengers where display_name ilike '%Newrider%'), v);
  perform pg_temp.t('N2 the requester stays the contact (requester_name / relationship unchanged by the rider name)',
    (select requester_name || '|' || requester_relationship from public.transportation_requests where id = r2) = 'Handoff Dee Fictional|family');

  -- ---------------------------------------------------------------- refusals leave nothing behind
  fp := pg_temp.footprint(c_a);
  v := pg_temp.conv(c_a1, c_a, o3, 'handoff-o3-key-0001', p_inactive, null);
  v2 := pg_temp.conv(c_a1, c_a, o3, 'handoff-o3-key-0001', p_b, null);
  v3 := pg_temp.conv(c_a1, c_a, o3, 'handoff-o3-key-0001', gen_random_uuid(), null);
  perform pg_temp.t('R1 inactive / OTHER-organization / unknown passenger -> ZW006 passenger_unavailable; nothing written (requests, attributions, activities, audit, events, passengers, conversions)',
    v = 'ERR:ZW006:passenger_unavailable' and v2 = 'ERR:ZW006:passenger_unavailable' and v3 = 'ERR:ZW006:passenger_unavailable'
    and pg_temp.footprint(c_a) = fp and (select stage from public.plus_opportunities where id = o3) = 'qualified', v || ' ' || v2 || ' ' || v3 || ' ' || fp || ' -> ' || pg_temp.footprint(c_a));
  v := pg_temp.conv(c_a1, c_a, o3, 'handoff-o3-key-0002', p_other, 'Somebody Fictional');
  v2 := pg_temp.conv(c_a1, c_a, o3, 'handoff-o3-key-0003', null, repeat('x', 201));
  v3 := pg_temp.conv(c_a1, c_a, o3, 'handoff-o3-key-0004', null, 'Bad' || chr(10) || 'Name');
  v4 := pg_temp.conv(c_a1, c_a, o3, 'handoff-o3-key-0005', null, 'Tab' || chr(9) || 'Name');
  perform pg_temp.t('R2 passenger AND name -> invalid_input; 201 characters / newline / tab -> invalid_passenger_name; nothing written',
    v = 'ERR:ZW006:invalid_input' and v2 = 'ERR:ZW006:invalid_passenger_name' and v3 = 'ERR:ZW006:invalid_passenger_name' and v4 = 'ERR:ZW006:invalid_passenger_name'
    and pg_temp.footprint(c_a) = fp, v || ' ' || v2 || ' ' || v3 || ' ' || v4);
  v := pg_temp.conv(c_a1, c_a, o3, 'handoff-o3-key-0001', null, '   ');
  perform pg_temp.t('R3 a refused attempt does NOT consume its key: the same key then converts normally (blank name = no snapshot)',
    v like 'changed=true:%' and (select coalesce(passenger_id::text, '-') || '|' || coalesce(requested_passenger_name, '-') from public.transportation_requests where id = pg_temp.rid(v)) = '-|-', v);
  v := pg_temp.conv(c_a1, c_a, o4, 'handoff-o4-key-0001', null, repeat('y', 200));
  perform pg_temp.t('R4 exactly 200 characters is accepted', v like 'changed=true:%', v);

  -- ---------------------------------------------------------------- authority before passenger (no existence oracle)
  fp := pg_temp.footprint(c_a);
  v := pg_temp.conv(c_a3, c_a, o5, 'handoff-o5-key-0001', p_b, null);
  v2 := pg_temp.conv(c_b1, c_a, o5, 'handoff-o5-key-0002', p_ok, null);
  v3 := pg_temp.conv(c_b1, c_b, o_b, 'handoff-ob-key-0001', p_ok, null);
  perform pg_temp.t('A1 a driver / an Org B admin are refused by authority (ZW002 not_found, the established P5 contract) before any passenger is looked at; Org B converting with an Org A passenger -> passenger_unavailable',
    v = 'ERR:ZW002:not_found' and v2 = 'ERR:ZW002:not_found' and v3 = 'ERR:ZW006:passenger_unavailable' and pg_temp.footprint(c_a) = fp
    and (select stage from public.plus_opportunities where id = o_b) = 'qualified', v || ' ' || v2 || ' ' || v3);

  -- ---------------------------------------------------------------- idempotent replay never changes the original
  fp := pg_temp.footprint(c_a);
  v := pg_temp.conv(c_a1, c_a, o1, 'handoff-o1-key-0001', p_other, null);
  v2 := pg_temp.conv(c_a1, c_a, o1, 'handoff-o1-key-0001', null, 'Replay Name Fictional');
  v3 := pg_temp.conv(c_a1, c_a, o1, 'handoff-o1-key-0001', p_inactive, null);
  perform pg_temp.t('I1 replay with a different / no / inactive passenger or a name returns the ORIGINAL Request (changed=false); its passenger and snapshot unchanged; nothing written',
    v = 'changed=false:' || r1 and v2 = 'changed=false:' || r1 and v3 = 'changed=false:' || r1
    and (select passenger_id::text || '|' || coalesce(requested_passenger_name, '-') from public.transportation_requests where id = r1) = p_ok || '|-'
    and pg_temp.footprint(c_a) = fp, v || ' ' || v2 || ' ' || v3);

  -- ---------------------------------------------------------------- rebooking
  v := pg_temp.rebook(c_a1, c_a, k, 'handoff-rb-key-0001', p_ok, null);
  v2 := pg_temp.rebook(c_a1, c_a, k, 'handoff-rb-key-0002', null, 'Rebook Rider Fictional');
  fp := pg_temp.footprint(c_a);
  v3 := pg_temp.rebook(c_a1, c_a, k, 'handoff-rb-key-0003', p_inactive, null);
  v4 := pg_temp.rebook(c_a1, c_a, k, 'handoff-rb-key-0004', p_b, null);
  perform pg_temp.t('B1 rebooking: passenger linked atomically; rider name stored as snapshot; inactive / other-organization refused with nothing written',
    v like 'changed=true:%' and v2 like 'changed=true:%'
    and (select passenger_id from public.transportation_requests where id = pg_temp.rid(v)) = p_ok
    and (select coalesce(passenger_id::text, '-') || '|' || requested_passenger_name from public.transportation_requests where id = pg_temp.rid(v2)) = '-|Rebook Rider Fictional'
    and v3 = 'ERR:ZW006:passenger_unavailable' and v4 = 'ERR:ZW006:passenger_unavailable' and pg_temp.footprint(c_a) = fp, v || ' ' || v2 || ' ' || v3 || ' ' || v4);
  v := pg_temp.rebook(c_a1, c_a, k, 'handoff-rb-key-0001', p_other, null);
  perform pg_temp.t('B2 rebooking replay with another passenger returns the original Request unchanged',
    v = 'changed=false:' || pg_temp.rid(pg_temp.rebook(c_a1, c_a, k, 'handoff-rb-key-0001', null, null))
    and (select passenger_id from public.transportation_requests where id = pg_temp.rid(v)) = p_ok, v);

  -- ---------------------------------------------------------------- Core's own RPC (Operations New Request)
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  begin
    select r.request_id::text into v from public.log_transportation_request(
      p_organization_id => c_a, p_requester_name => 'Core Caller Fictional', p_requester_relationship => 'family',
      p_requester_phone => '(404) 555-0144', p_pickup_description => 'Fictional pickup 3 Ash', p_destination_description => 'Fictional clinic',
      p_return_trip_needed => 'no', p_source => 'phone', p_requested_passenger_name => ' Core Rider Fictional ') r;
  exception when others then v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  begin
    select r.request_id::text into v2 from public.log_transportation_request(
      p_organization_id => c_a, p_requester_name => 'Core Caller Fictional', p_requester_relationship => 'family',
      p_requester_phone => '(404) 555-0144', p_pickup_description => 'Fictional pickup 4 Ash', p_destination_description => 'Fictional clinic',
      p_return_trip_needed => 'no', p_source => 'phone', p_requested_passenger_name => repeat('z', 201)) r;
  exception when others then v2 := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  begin
    select r.request_id::text into v3 from public.log_transportation_request(
      p_organization_id => c_a, p_requester_name => 'Core Caller Fictional', p_requester_relationship => 'self',
      p_requester_phone => '(404) 555-0144', p_pickup_description => 'Fictional pickup 5 Ash', p_destination_description => 'Fictional clinic',
      p_return_trip_needed => 'no', p_source => 'phone') r;
  exception when others then v3 := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform pg_temp.t('C1 Core log_transportation_request: trimmed snapshot stored; 201 characters -> invalid_input; the legacy call without the new argument stores no snapshot',
    (select requested_passenger_name from public.transportation_requests where id = v::uuid) = 'Core Rider Fictional'
    and v2 = 'ERR:ZW006:invalid_input'
    and (select coalesce(requested_passenger_name, '-') from public.transportation_requests where id = v3::uuid) = '-', v || ' ' || v2 || ' ' || v3);

  perform pg_temp.t('Z1 no Passenger record was created by any booking in this suite (Core keeps passenger creation)',
    (select count(*) from public.passengers where organization_id in (c_a, c_b) and display_name like 'Handoff%') = 4
    and not exists (select 1 from public.passengers where display_name ~ '(Newrider|Rebook Rider|Core Rider|Replay Name)'));
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from t_results;
select name, detail from t_results where not ok order by n;

rollback;
