-- Nemryn Core -- trusted website intake: airport_transportation service contract (NC-INTAKE-AIRPORT-S1).
-- ROLLBACK-ONLY (one transaction, rolled back).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/core_intake_airport_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261015135000_core_intake_airport_service_type.sql. FICTIONAL seed organizations only (Org A / Org B, admin
-- a1); integrations are created here and removed by the rollback. Calls go through the REAL trusted path
-- (submit_public_transportation_request as service_role, exactly like the server route).

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
-- submit through the trusted intake RPC as service_role -> 'new:<request_id>' / 'replay:<request_id>' / '<sqlstate>'
create function pg_temp.submit(p_ext text, p_key text, p_service text, p_pickup text default 'Fictional 1 Airport Way',
                               p_origin text default null, p_days text[] default null, p_acq jsonb default null)
returns text language plpgsql as $$
declare v public.public_request_submission_result;
begin
  set local role service_role;
  begin
    select * into v from public.submit_public_transportation_request(
      p_integration_external_id => p_ext, p_idempotency_key => p_key, p_requester_name => 'Airport Fictional Requester',
      p_requester_relationship => 'self', p_requester_phone => '404-555-0188', p_pickup_description => p_pickup,
      p_destination_description => 'Fictional Regional Airport, Terminal N', p_return_trip_needed => 'no', p_origin => p_origin,
      p_service_type => p_service, p_preferred_date => date '2026-11-20', p_preferred_time => time '05:15',
      p_recurring_days_of_week => p_days,
      p_recurring_start_date => case when p_days is null then null else date '2026-11-02' end,
      p_recurring_end_date => case when p_days is null then null else date '2026-11-30' end,
      p_recurring_appointment_time => case when p_days is null then null else time '06:30' end,
      p_recurring_return_trip_expected => case when p_days is null then null else true end,
      p_acquisition => p_acq);
    reset role;
    return case when v.notification_event_id is null then 'replay' else 'new' end || ':' ||
           (select r.id from public.transportation_requests r join public.request_intake_integrations i on i.id = r.intake_integration_id
            where i.external_id = p_ext and r.external_submission_ref = btrim(p_key));
  exception when others then
    reset role;
    return sqlstate;
  end;
end;
$$;
create function pg_temp.rid(p text) returns uuid language sql as $$ select nullif(split_part(p, ':', 2), '')::uuid; $$;
create function pg_temp.side() returns text language sql as $$
  select (select count(*) from public.passengers) || '/' || (select count(*) from public.trips) || '/' || (select count(*) from public.trip_assignments)
    || '/' || (select count(*) from public.recurring_arrangements) || '/' || (select count(*) from public.plus_contacts)
    || '/' || (select count(*) from public.plus_opportunities) || '/' || (select count(*) from public.plus_request_attributions)
    || '/' || (select count(*) from public.plus_agent_recommendations) || '/' || (select count(*) from public.plus_tasks);
$$;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  eight constant text[] := array['medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge', 'recurring_care',
                                 'senior_medical', 'wheelchair_transportation', 'other'];
  v text; v2 text; v_ok boolean; r uuid; r2 uuid; v_side text; v_n bigint; v_m bigint; s text;
begin
  -- fixtures: Org A has NO configured offerings and NO Plus entitlement (Core-only operator); Org B likewise
  delete from public.organization_service_offerings where organization_id in (c_a, c_b);
  delete from public.organization_modules where organization_id in (c_a, c_b);
  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active) values
    ('a9000000-0000-0000-0000-0000000a1f01', c_a, 'airport-org-a', 'website', true),
    ('a9000000-0000-0000-0000-0000000a1f02', c_b, 'airport-org-b', 'website', true),
    ('a9000000-0000-0000-0000-0000000a1f03', c_a, 'airport-org-a-off', 'website', false),
    ('a9000000-0000-0000-0000-0000000a1f04', c_a, 'airport-org-a-origin', 'website', true);
  update public.request_intake_integrations set allowed_origins = array['https://zenward-fictional.example.test']
  where id = 'a9000000-0000-0000-0000-0000000a1f04';
  v_side := pg_temp.side();

  -- ============================================== schema
  perform pg_temp.t('S1 transportation_requests CHECK: the eight existing values + airport_transportation; NULL still allowed',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'transportation_requests_service_type_check')
      ~ 'service_type IS NULL' and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'transportation_requests_service_type_check') ~ 'airport_transportation'
    and (select bool_and((select pg_get_constraintdef(oid) from pg_constraint where conname = 'transportation_requests_service_type_check') ~ ('''' || e || '''')) from unnest(eight) e));
  perform pg_temp.t('S2 organization_service_offerings CHECK: the eight existing values + airport_transportation',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'organization_service_offerings_service_type_check') ~ 'airport_transportation'
    and (select bool_and((select pg_get_constraintdef(oid) from pg_constraint where conname = 'organization_service_offerings_service_type_check') ~ ('''' || e || '''')) from unnest(eight) e));
  perform pg_temp.t('S3 replaced functions keep their signature, SECURITY DEFINER, pinned search_path and ACL (intake core: no client EXECUTE; offerings: authenticated only)',
    (select count(*) from pg_proc where proname = '_create_public_request') = 1
    and (select count(*) from pg_proc where proname = 'set_organization_service_offerings') = 1
    and (select prosecdef and proconfig::text ~ 'search_path' and not has_function_privilege('authenticated', oid, 'EXECUTE')
                and not has_function_privilege('anon', oid, 'EXECUTE') and not has_function_privilege('service_role', oid, 'EXECUTE')
         from pg_proc where proname = '_create_public_request')
    and (select prosecdef and has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE')
         from pg_proc where proname = 'set_organization_service_offerings')
    and has_function_privilege('service_role', 'public.submit_public_transportation_request(text,text,text,text,text,text,text,text,text,date,time,text,text,text,text,text[],date,date,time,boolean,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.submit_public_transportation_request(text,text,text,text,text,text,text,text,text,date,time,text,text,text,text,text[],date,date,time,boolean,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.submit_public_transportation_request(text,text,text,text,text,text,text,text,text,date,time,text,text,text,text,text[],date,date,time,boolean,text,jsonb)', 'EXECUTE'));
  perform pg_temp.t('S4 a direct authenticated / anon write to transportation_requests is still refused',
    not has_table_privilege('authenticated', 'public.transportation_requests', 'INSERT') and not has_table_privilege('anon', 'public.transportation_requests', 'INSERT'));

  -- ============================================== intake: existing services + airport
  v_ok := true; v := '';
  foreach s in array eight loop
    v2 := pg_temp.submit('airport-org-a', 'existing-' || s, s);
    if v2 not like 'new:%' or (select service_type from public.transportation_requests where id = pg_temp.rid(v2)) is distinct from s then v_ok := false; v := v || s || '=' || v2 || ' '; end if;
  end loop;
  perform pg_temp.t('I1 each of the eight existing services is still accepted and stored exactly', v_ok, v);
  v_n := (select count(*) from public.transportation_requests);
  v := pg_temp.submit('airport-org-a', 'airport-key-0001', 'airport_transportation');
  r := pg_temp.rid(v);
  perform pg_temp.t('I2 airport_transportation is accepted: ONE new Request for Org A (the integration''s organization), pending, source web',
    v like 'new:%' and (select count(*) from public.transportation_requests) = v_n + 1
    and (select organization_id = c_a and state = 'pending' and source = 'web' and intake_integration_id = 'a9000000-0000-0000-0000-0000000a1f01'
         from public.transportation_requests where id = r), v);
  perform pg_temp.t('I3 the service type is stored EXACTLY as airport_transportation (never remapped to other or a medical type)',
    (select service_type from public.transportation_requests where id = r) = 'airport_transportation');
  v_n := (select count(*) from public.transportation_requests);
  v := pg_temp.submit('airport-org-a', 'unknown-key-0001', 'airport') || ' ' || pg_temp.submit('airport-org-a', 'unknown-key-0002', 'Airport_Transportation')
       || ' ' || pg_temp.submit('airport-org-a', 'unknown-key-0003', 'airport-transportation') || ' ' || pg_temp.submit('airport-org-a', 'unknown-key-0004', 'limousine');
  perform pg_temp.t('I4 unknown / near-miss service types are rejected (ZW006, the generic refusal); no Request',
    v = 'ZW006 ZW006 ZW006 ZW006' and (select count(*) from public.transportation_requests) = v_n, v);

  -- ============================================== idempotency (existing contract, unchanged)
  v_n := (select count(*) from public.transportation_requests);
  v := pg_temp.submit('airport-org-a', 'airport-key-0001', 'airport_transportation');
  perform pg_temp.t('I5 a valid retry with the same key returns the SAME Request (replay); no second Request', v = 'replay:' || r and (select count(*) from public.transportation_requests) = v_n, v);
  v := pg_temp.submit('airport-org-a', 'airport-key-0001', 'dialysis', 'A conflicting pickup');
  perform pg_temp.t('I6 same key + conflicting payload follows the existing contract: the FIRST Request is returned unchanged (service and pickup kept); no second Request',
    v = 'replay:' || r and (select service_type = 'airport_transportation' and pickup_description = 'Fictional 1 Airport Way' from public.transportation_requests where id = r)
    and (select count(*) from public.transportation_requests) = v_n, v);
  perform pg_temp.t('I7 Core history: exactly one request_logged event and one notification for the airport Request (replays add none)',
    (select count(*) from public.request_events where request_id = r and event_type = 'request_logged') = 1
    and (select count(*) from public.notification_events where entity_id = r) = 1);

  -- ============================================== tenancy / authorization
  v := pg_temp.submit('airport-org-b', 'airport-key-b001', 'airport_transportation');
  perform pg_temp.t('T1 Org B''s integration creates Org B''s Request only (the integration decides the organization; the payload cannot)',
    v like 'new:%' and (select organization_id from public.transportation_requests where id = pg_temp.rid(v)) = c_b, v);
  v_n := (select count(*) from public.transportation_requests where organization_id = c_a);
  v := pg_temp.submit('airport-org-a-off', 'airport-key-off1', 'airport_transportation') || ' ' || pg_temp.submit('no-such-integration', 'airport-key-none', 'airport_transportation')
       || ' ' || pg_temp.submit('airport-org-a-origin', 'airport-key-org1', 'airport_transportation', 'Fictional', 'https://evil.example.test');
  perform pg_temp.t('T2 inactive integration, unknown integration and a disallowed Origin are refused generically; no Request for Org A',
    v !~ 'new|replay' and (select count(*) from public.transportation_requests where organization_id = c_a) = v_n, v);
  v := pg_temp.submit('airport-org-a-origin', 'airport-key-org2', 'airport_transportation', 'Fictional 2', 'https://zenward-fictional.example.test');
  perform pg_temp.t('T3 the bound Origin is accepted for airport (existing origin binding unchanged)', v like 'new:%', v);
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role anon;
  begin
    perform public.submit_public_transportation_request('airport-org-a', 'airport-key-anon', 'X', 'self', '404-555-0100', 'p', 'd', 'no');
    v := 'allowed';
  exception when others then v := sqlstate;
  end;
  reset role;
  perform pg_temp.t('T4 anon cannot call the intake RPC directly (42501): only the server route (service_role) can', v = '42501', v);

  -- ============================================== offerings (an operator that configured its services)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  perform public.set_organization_service_offerings(c_a, array['wheelchair_transportation', 'dialysis']);
  reset role;
  v := pg_temp.submit('airport-org-a', 'offer-key-0001', 'airport_transportation');
  perform pg_temp.t('O1 an organization that configured Services without Airport rejects airport requests (existing offerings rule)', v = 'ZW006', v);
  set local role authenticated;
  perform public.set_organization_service_offerings(c_a, array['wheelchair_transportation', 'dialysis', 'airport_transportation']);
  reset role;
  v := pg_temp.submit('airport-org-a', 'offer-key-0002', 'airport_transportation');
  v2 := pg_temp.submit('airport-org-a', 'offer-key-0003', 'wheelchair_transportation');
  perform pg_temp.t('O2 after the operator enables Airport in Services, airport requests are accepted; wheelchair still works',
    v like 'new:%' and v2 like 'new:%' and (select service_type from public.transportation_requests where id = pg_temp.rid(v)) = 'airport_transportation', v || ' ' || v2);
  set local role authenticated;
  begin
    perform public.set_organization_service_offerings(c_a, array['airport_transportation', 'helicopter']);
    v := 'allowed';
  exception when others then v := sqlstate;
  end;
  reset role;
  perform pg_temp.t('O3 Services still rejects unknown values (ZW006); airport_transportation alone is a valid selection',
    v = 'ZW006' and (select array_agg(service_type order by service_type) from public.organization_service_offerings where organization_id = c_a)
                    = array['airport_transportation', 'dialysis', 'wheelchair_transportation']);
  delete from public.organization_service_offerings where organization_id = c_a;

  -- ============================================== recurring + acquisition + boundary
  v := pg_temp.submit('airport-org-a', 'airport-recur-01', 'airport_transportation', 'Fictional 3', null, array['monday', 'friday']);
  v2 := pg_temp.submit('airport-org-a', 'recurring-care-01', 'recurring_care', 'Fictional 4', null, array['tuesday']);
  perform pg_temp.t('R1 recurring schedules are validated and stored exactly as before (airport and recurring care)',
    v like 'new:%' and v2 like 'new:%'
    and (select recurring_days_of_week = array[1, 5]::smallint[] and recurring_start_date = date '2026-11-02' from public.transportation_requests where id = pg_temp.rid(v))
    and (select recurring_days_of_week = array[2]::smallint[] from public.transportation_requests where id = pg_temp.rid(v2)), v || ' ' || v2);
  v := pg_temp.submit('airport-org-a', 'airport-bad-rec1', 'airport_transportation', 'Fictional 5', null, array['someday']);
  perform pg_temp.t('R2 an invalid recurring schedule is still refused for airport (ZW006)', v = 'ZW006', v);
  v := pg_temp.submit('airport-org-a', 'airport-acq-0001', 'airport_transportation', 'Fictional 6', null, null,
                      jsonb_build_object('utmSource', 'google', 'utmMedium', 'cpc', 'landingPath', '/services/airport-transportation'));
  perform pg_temp.t('A1 the website acquisition snapshot is stored for an airport Request (existing behaviour)',
    (select utm_source = 'google' and utm_medium = 'cpc' and landing_path = '/services/airport-transportation'
     from public.request_acquisition_attributions where request_id = pg_temp.rid(v)), v);
  perform pg_temp.t('B1 nothing beyond the pending Request: no Passenger, Trip, assignment, recurring arrangement, Plus contact / opportunity / attribution / recommendation / task',
    pg_temp.side() = v_side and not exists (select 1 from public.transportation_requests where intake_integration_id::text like 'a9000000-0000-0000-0000-0000000a1f%' and (passenger_id is not null or state <> 'pending')),
    pg_temp.side());
  perform pg_temp.t('B2 no Plus entitlement was needed: Org A has no organization_modules row and received every airport Request',
    not exists (select 1 from public.organization_modules where organization_id = c_a)
    and (select count(*) from public.transportation_requests where organization_id = c_a and service_type = 'airport_transportation') >= 5);
  perform pg_temp.t('B3 a NULL service type (integrations that send none) is still accepted',
    pg_temp.submit('airport-org-a', 'no-service-0001', null) like 'new:%');
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from t_results;
select name, detail from t_results where not ok order by n;

rollback;
