-- Nemryn Core -- staff-created Request service type (NC-REQUEST-SERVICE-TYPE-S1).
-- ROLLBACK-ONLY (one transaction, rolled back).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/core_staff_request_service_type_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261017100000_core_staff_request_service_type.sql. FICTIONAL seed organizations only: Org A (admin a1,
-- dispatcher a2, driver a3, inactive dispatcher a5) and Org B (admin b1). Calls go through the REAL RPC as the signed-in
-- staff member (role authenticated + JWT subject), exactly like the Log Request server action and the Plus RPCs.

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

-- log a Request as p_uid -> 'ok:<request_id>' or the SQLSTATE.
--   p_mode 'named'        : PostgREST-style named arguments INCLUDING p_service_type
--   p_mode 'omit'         : named arguments WITHOUT p_service_type (the deployed app / 14-argument callers)
--   p_mode 'positional14' : the 14 positional arguments the P2-S4 Plus RPCs use
create function pg_temp.log_as(p_uid uuid, p_org uuid, p_mode text, p_service text default null,
                               p_role text default 'authenticated', p_passenger uuid default null,
                               p_source text default 'phone', p_name text default 'Svc Fictional Requester')
returns text language plpgsql as $$
declare v public.request_creation_result;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    if p_mode = 'omit' then
      select * into v from public.log_transportation_request(
        p_organization_id => p_org, p_requester_name => p_name, p_requester_relationship => 'self',
        p_requester_phone => '404-555-0150', p_pickup_description => 'Fictional svc pickup',
        p_destination_description => 'Fictional svc clinic', p_return_trip_needed => 'no', p_source => p_source,
        p_passenger_id => p_passenger);
    elsif p_mode = 'positional14' then
      select * into v from public.log_transportation_request(
        p_org, p_name, 'self', '404-555-0150', 'Fictional svc pickup', 'Fictional svc clinic', 'no', p_source,
        null, p_passenger, null, null, null, null);
    else
      select * into v from public.log_transportation_request(
        p_organization_id => p_org, p_requester_name => p_name, p_requester_relationship => 'self',
        p_requester_phone => '404-555-0150', p_pickup_description => 'Fictional svc pickup',
        p_destination_description => 'Fictional svc clinic', p_return_trip_needed => 'no', p_source => p_source,
        p_passenger_id => p_passenger, p_service_type => p_service);
    end if;
    reset role;
    return 'ok:' || v.request_id;
  exception when others then
    reset role;
    return sqlstate;
  end;
end;
$$;
-- run one statement as p_uid (role authenticated by default) -> 'OK' or the SQLSTATE
create function pg_temp.call_as(p_uid uuid, p_stmt text, p_role text default 'authenticated')
returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_stmt;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'OK';
end;
$$;
create function pg_temp.rid(p text) returns uuid language sql as $$ select case when p like 'ok:%' then substr(p, 4)::uuid end; $$;
create function pg_temp.svc(p text) returns text language sql as $$
  select coalesce((select coalesce(service_type, '<null>') || '|' || state from public.transportation_requests where id = pg_temp.rid(p)), '<none>');
$$;
create function pg_temp.counts() returns text language sql as $$
  select (select count(*) from public.transportation_requests) || '/' || (select count(*) from public.request_events);
$$;
create function pg_temp.side() returns text language sql as $$
  select (select count(*) from public.passengers) || '/' || (select count(*) from public.trips) || '/' || (select count(*) from public.trip_assignments)
    || '/' || (select count(*) from public.recurring_arrangements) || '/' || (select count(*) from public.notification_events);
$$;

create temp table t_ctx (k text primary key, v text);
insert into t_ctx values ('side0', pg_temp.side());
-- every pre-existing Request, byte for byte (F6)
create temp table t_existing as select r.id, r::text as row_text from public.transportation_requests r;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  c_a3 constant uuid := '20000000-0000-0000-0000-0000000000a3';
  c_a5 constant uuid := '20000000-0000-0000-0000-0000000000a5';
  c_b1 constant uuid := '20000000-0000-0000-0000-0000000000b1';
  c_pax_a constant uuid := '40000000-0000-0000-0000-0000000000a1';
  c_pax_b constant uuid := '40000000-0000-0000-0000-0000000000b1';
  v_fn oid;
  v_r text;
  v_c text;
  v_vals text[];
  v_val text;
  v_bad text;
  v_ok int := 0;
  v_detail text := '';
  v_k uuid; o uuid; o2 uuid;
  v_plus record;
  v_rid uuid;
begin
  -- ===================================================================== A. Function contract
  select p.oid into v_fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'log_transportation_request';
  perform pg_temp.t('A1 exactly ONE log_transportation_request (no overload)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'log_transportation_request') = 1);
  -- NP-PILOT-P1 (20261028100000) appended p_requested_passenger_name text DEFAULT NULL after p_service_type
  perform pg_temp.t('A2 exactly 16 input arguments; identity = the 14 original + service type + requested passenger name',
    (select pronargs from pg_proc where oid = v_fn) = 16
    and v_fn::regprocedure::text = 'log_transportation_request(uuid,text,text,text,text,text,text,text,text,uuid,date,time without time zone,text,text,text,text)',
    v_fn::regprocedure::text);
  perform pg_temp.t('A3 the first 14 parameters keep their names / defaults; then p_service_type and p_requested_passenger_name, both DEFAULT NULL',
    pg_get_function_arguments(v_fn) = 'p_organization_id uuid, p_requester_name text, p_requester_relationship text, p_requester_phone text, p_pickup_description text, p_destination_description text, p_return_trip_needed text, p_source text, p_requester_email text DEFAULT NULL::text, p_passenger_id uuid DEFAULT NULL::uuid, p_preferred_date date DEFAULT NULL::date, p_preferred_time time without time zone DEFAULT NULL::time without time zone, p_assistance_notes text DEFAULT NULL::text, p_additional_notes text DEFAULT NULL::text, p_service_type text DEFAULT NULL::text, p_requested_passenger_name text DEFAULT NULL::text',
    pg_get_function_arguments(v_fn));
  perform pg_temp.t('A4 returns request_creation_result; plpgsql; VOLATILE; SECURITY DEFINER; search_path pinned; owner postgres',
    pg_get_function_result(v_fn) = 'request_creation_result'
    and (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = v_fn) = 'plpgsql'
    and (select provolatile from pg_proc where oid = v_fn) = 'v'
    and (select prosecdef from pg_proc where oid = v_fn)
    and (select proconfig from pg_proc where oid = v_fn) = array['search_path=public, pg_temp']
    and (select pg_get_userbyid(proowner) from pg_proc where oid = v_fn) = 'postgres');
  perform pg_temp.t('A5 EXECUTE: authenticated only (not PUBLIC, anon or service_role)',
    has_function_privilege('authenticated', v_fn, 'EXECUTE') and not has_function_privilege('anon', v_fn, 'EXECUTE')
    and not has_function_privilege('service_role', v_fn, 'EXECUTE')
    and not exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_fn)) a where a.grantee = 0),
    (select proacl::text from pg_proc where oid = v_fn));
  v_r := pg_temp.log_as(c_a1, c_a, 'omit');
  perform pg_temp.t('A6 existing named call WITHOUT p_service_type still works (no ambiguity) -> NULL, pending', pg_temp.svc(v_r) = '<null>|pending', v_r);
  v_r := pg_temp.log_as(c_a1, c_a, 'positional14');
  perform pg_temp.t('A7 existing 14-argument POSITIONAL call (the Plus RPC shape) still works -> NULL, pending', pg_temp.svc(v_r) = '<null>|pending', v_r);

  -- ===================================================================== B. Valid input
  v_vals := array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g'))[1]
                    from pg_constraint c where c.conname = 'transportation_requests_service_type_check');
  perform pg_temp.t('B0 the request CHECK lists exactly the nine canonical values (parity source)',
    v_vals @> array['medical_appointment','dialysis','rehabilitation','hospital_discharge','recurring_care','senior_medical','wheelchair_transportation','other','airport_transportation']
    and cardinality(v_vals) = 9, array_to_string(v_vals, ','));
  foreach v_val in array v_vals loop
    v_r := pg_temp.log_as(c_a1, c_a, 'named', v_val);
    if pg_temp.svc(v_r) = v_val || '|pending' then v_ok := v_ok + 1; else v_detail := v_detail || v_val || '=' || v_r || ' '; end if;
  end loop;
  perform pg_temp.t('B1 every CHECK value (all nine) is accepted by the function and stored exactly; Request pending', v_ok = 9, v_detail);
  v_r := pg_temp.log_as(c_a1, c_a, 'named', null);
  perform pg_temp.t('B2 explicit NULL -> NULL', pg_temp.svc(v_r) = '<null>|pending', v_r);
  v_r := pg_temp.log_as(c_a1, c_a, 'named', '');
  perform pg_temp.t('B3 empty string -> NULL', pg_temp.svc(v_r) = '<null>|pending', v_r);
  v_r := pg_temp.log_as(c_a1, c_a, 'named', '   ');
  perform pg_temp.t('B4 spaces only -> NULL', pg_temp.svc(v_r) = '<null>|pending', v_r);
  v_r := pg_temp.log_as(c_a1, c_a, 'named', E' \t\n ');
  perform pg_temp.t('B5 tabs / newlines only -> NULL', pg_temp.svc(v_r) = '<null>|pending', v_r);
  v_r := pg_temp.log_as(c_a2, c_a, 'named', 'airport_transportation');
  perform pg_temp.t('B6 a Dispatcher can record a service (airport_transportation)', pg_temp.svc(v_r) = 'airport_transportation|pending', v_r);

  -- ===================================================================== C. Invalid input (nothing written)
  v_c := pg_temp.counts();
  v_ok := 0; v_detail := '';
  foreach v_bad in array array['limousine', 'Dialysis', 'DIALYSIS', 'Airport Transportation', 'Wheelchair transportation',
                               'airport', ' dialysis', 'dialysis ', E'dialysis\n', 'wheelchair-transportation', 'medical appointment'] loop
    v_r := pg_temp.log_as(c_a1, c_a, 'named', v_bad);
    if v_r = 'ZW006' then v_ok := v_ok + 1; else v_detail := v_detail || quote_literal(v_bad) || '=' || v_r || ' '; end if;
  end loop;
  perform pg_temp.t('C1 unknown / wrong case / labels / aliases / padded values -> ZW006 (never trimmed, folded or mapped)', v_ok = 11, v_detail);
  perform pg_temp.t('C2 rejected inputs created NO Request and NO request event', pg_temp.counts() = v_c, v_c || ' -> ' || pg_temp.counts());

  -- ===================================================================== D. Tenant Services (OD-S1 = A)
  insert into public.organization_service_offerings (organization_id, service_type) values (c_a, 'dialysis');
  v_r := pg_temp.log_as(c_a1, c_a, 'named', 'wheelchair_transportation');
  perform pg_temp.t('D1 Org A offers ONLY dialysis: staff may still record wheelchair_transportation (Services do not restrict staff)',
    pg_temp.svc(v_r) = 'wheelchair_transportation|pending', v_r);
  v_r := pg_temp.log_as(c_a1, c_a, 'named', 'dialysis');
  perform pg_temp.t('D2 ... and the offered dialysis', pg_temp.svc(v_r) = 'dialysis|pending', v_r);
  perform pg_temp.t('D3 Org A''s configured Services are exactly {dialysis} (what the staff form lists)',
    (select array_agg(service_type) from public.organization_service_offerings where organization_id = c_a) = array['dialysis']);
  v_c := pg_temp.counts();
  perform pg_temp.t('D4 a Driver cannot use a valid service value to log a Request (ZW002), nothing written',
    pg_temp.log_as(c_a3, c_a, 'named', 'dialysis') = 'ZW002' and pg_temp.counts() = v_c);
  delete from public.organization_service_offerings where organization_id = c_a;

  -- ===================================================================== S. Services READ (owner-approved, read-only)
  insert into public.organization_service_offerings (organization_id, service_type) values (c_a, 'dialysis'), (c_a, 'wheelchair_transportation');
  perform set_config('request.jwt.claim.sub', c_a1::text, true); set local role authenticated;
  v_r := array_to_string(public.get_organization_service_offerings(c_a), ','); reset role;
  perform pg_temp.t('S1 Organization Admin reads the enabled Services', v_r = 'dialysis,wheelchair_transportation', v_r);
  perform set_config('request.jwt.claim.sub', c_a2::text, true); set local role authenticated;
  v_r := array_to_string(public.get_organization_service_offerings(c_a), ','); reset role;
  perform pg_temp.t('S2 Dispatcher reads the SAME enabled Services (identifiers only)', v_r = 'dialysis,wheelchair_transportation', v_r);
  perform pg_temp.t('S3 the read returns ONLY text[] of service identifiers (no other configuration data)',
    pg_get_function_result('public.get_organization_service_offerings(uuid)'::regprocedure) = 'text[]'
    and pg_get_function_identity_arguments('public.get_organization_service_offerings(uuid)'::regprocedure) = 'p_organization_id uuid');
  perform pg_temp.t('S4 Driver / inactive Dispatcher / no-membership / Platform Admin without membership -> ZW002; no user -> ZW001; anon -> no EXECUTE',
    pg_temp.call_as(c_a3, 'select public.get_organization_service_offerings(''' || c_a || ''')') = 'ZW002'
    and pg_temp.call_as(c_a5, 'select public.get_organization_service_offerings(''' || c_a || ''')') = 'ZW002'
    and pg_temp.call_as('20000000-0000-0000-0000-0000000000e1', 'select public.get_organization_service_offerings(''' || c_a || ''')') = 'ZW002'
    and pg_temp.call_as('20000000-0000-0000-0000-0000000000d1', 'select public.get_organization_service_offerings(''' || c_a || ''')') = 'ZW002'
    and pg_temp.call_as(null, 'select public.get_organization_service_offerings(''' || c_a || ''')') = 'ZW001'
    and pg_temp.call_as(null, 'select public.get_organization_service_offerings(''' || c_a || ''')', 'anon') = '42501');
  perform pg_temp.t('S5 cross-tenant: Org B admin and Org B dispatcher cannot read Org A Services (ZW002); Org A dispatcher cannot read Org B',
    pg_temp.call_as(c_b1, 'select public.get_organization_service_offerings(''' || c_a || ''')') = 'ZW002'
    and pg_temp.call_as('20000000-0000-0000-0000-0000000000b2', 'select public.get_organization_service_offerings(''' || c_a || ''')') = 'ZW002'
    and pg_temp.call_as(c_a2, 'select public.get_organization_service_offerings(''' || c_b || ''')') = 'ZW002');
  perform pg_temp.t('S6 CHANGING Services stays Organization Admin only: Dispatcher set -> ZW002, nothing changed; Admin set still works',
    pg_temp.call_as(c_a2, 'select public.set_organization_service_offerings(''' || c_a || ''', array[''other''])') = 'ZW002'
    and (select array_agg(service_type order by service_type) from public.organization_service_offerings where organization_id = c_a) = array['dialysis','wheelchair_transportation']
    and pg_temp.call_as(c_a1, 'select public.set_organization_service_offerings(''' || c_a || ''', array[''dialysis'',''wheelchair_transportation''])') = 'OK');
  perform pg_temp.t('S7 no direct table access for Dispatchers (or any client role): SELECT on organization_service_offerings -> 42501; RLS on, no policy',
    pg_temp.call_as(c_a2, 'select count(*) from public.organization_service_offerings') = '42501'
    and not has_table_privilege('authenticated', 'public.organization_service_offerings', 'SELECT')
    and (select relrowsecurity from pg_class where oid = 'public.organization_service_offerings'::regclass)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_service_offerings'));
  perform pg_temp.t('S8 set_organization_service_offerings unchanged: Organization Admin only in its body',
    (select prosrc from pg_proc where oid = 'public.set_organization_service_offerings(uuid,text[])'::regprocedure) ~ 'array\[''organization_admin''\]'
    and (select prosrc from pg_proc where oid = 'public.set_organization_service_offerings(uuid,text[])'::regprocedure) !~ 'dispatcher');
  delete from public.organization_service_offerings where organization_id = c_a;

  -- ===================================================================== E. Security
  v_c := pg_temp.counts();
  perform pg_temp.t('E1 anon role: no EXECUTE (42501)', pg_temp.log_as(null, c_a, 'named', 'dialysis', 'anon') = '42501');
  perform pg_temp.t('E2 authenticated without a user -> ZW001', pg_temp.log_as(null, c_a, 'named', 'dialysis') = 'ZW001');
  perform pg_temp.t('E3 Driver -> ZW002', pg_temp.log_as(c_a3, c_a, 'named', 'other') = 'ZW002');
  perform pg_temp.t('E4 inactive Dispatcher -> ZW002', pg_temp.log_as(c_a5, c_a, 'named', 'other') = 'ZW002');
  perform pg_temp.t('E5 Org B admin into Org A -> ZW002 (foreign tenant, no oracle)', pg_temp.log_as(c_b1, c_a, 'named', 'other') = 'ZW002');
  perform pg_temp.t('E6 refusals wrote nothing', pg_temp.counts() = v_c, v_c || ' -> ' || pg_temp.counts());
  v_r := pg_temp.log_as(c_b1, c_b, 'named', 'senior_medical');
  perform pg_temp.t('E7 Org B admin in Org B works; the Request belongs to Org B',
    pg_temp.svc(v_r) = 'senior_medical|pending' and (select organization_id from public.transportation_requests where id = pg_temp.rid(v_r)) = c_b, v_r);
  perform pg_temp.t('E8 service_role cannot call it (no EXECUTE)', pg_temp.log_as(c_a1, c_a, 'named', 'other', 'service_role') = '42501');

  -- ===================================================================== F. Operational integrity
  v_c := pg_temp.counts();
  v_r := pg_temp.log_as(c_a1, c_a, 'named', 'recurring_care', p_passenger => c_pax_a, p_source => 'facility');
  v_rid := pg_temp.rid(v_r);
  perform pg_temp.t('F1 exactly ONE pending Request and ONE request event for a successful staff log',
    pg_temp.counts() = (split_part(v_c, '/', 1)::int + 1) || '/' || (split_part(v_c, '/', 2)::int + 1), v_c || ' -> ' || pg_temp.counts());
  perform pg_temp.t('F2 the request_logged event keeps its exact structure ({"source": ...} only; no service key)',
    (select string_agg(event_type || '|' || metadata::text || '|' || (actor_user_id = c_a1)::text, ',') from public.request_events where request_id = v_rid)
      = 'request_logged|{"source": "facility"}|true',
    (select string_agg(event_type || '|' || metadata::text, ',') from public.request_events where request_id = v_rid));
  perform pg_temp.t('F3 source, requester, passenger and organization stored as before; state pending',
    (select source || '|' || requester_name || '|' || passenger_id || '|' || organization_id || '|' || state || '|' || service_type
       from public.transportation_requests where id = v_rid)
      = 'facility|Svc Fictional Requester|' || c_pax_a || '|' || c_a || '|pending|recurring_care');
  perform pg_temp.t('F4 recurring_care is a label only: NO recurring arrangement, Trip, assignment, new Passenger or notification',
    pg_temp.side() = (select v from t_ctx where k = 'side0') and not exists (select 1 from public.trips where request_id = v_rid),
    (select v from t_ctx where k = 'side0') || ' -> ' || pg_temp.side());
  perform pg_temp.t('F5 existing validations preserved: bad source / blank requester / foreign or unknown passenger -> ZW006',
    pg_temp.log_as(c_a1, c_a, 'named', 'dialysis', p_source => 'fax') = 'ZW006'
    and pg_temp.log_as(c_a1, c_a, 'named', 'dialysis', p_name => '   ') = 'ZW006'
    and pg_temp.log_as(c_a1, c_a, 'named', 'dialysis', p_passenger => c_pax_b) = 'ZW006'
    and pg_temp.log_as(c_a1, c_a, 'named', 'dialysis', p_passenger => gen_random_uuid()) = 'ZW006');
  perform pg_temp.t('F6 historic Requests unchanged (every pre-existing row byte-identical; none rewritten or backfilled)',
    (select count(*) from t_existing) > 0
    and not exists (select 1 from t_existing e left join public.transportation_requests r on r.id = e.id where r.id is null or r::text <> e.row_text),
    (select count(*) || ' pre-existing rows' from t_existing));

  -- ===================================================================== G. Plus P2-S4 compatibility (unchanged RPCs)
  insert into public.organization_modules (organization_id, module, status, status_reason) values (c_a, 'plus', 'active', 'S1 test fixture');
  insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by)
    values (c_a, 'S1 Plus Fictional', '(404) 555-0181', 's1.plus@example.test', 'individual', c_a1) returning id into v_k;
  insert into public.plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by)
    values (c_a, 'S1 dialysis opportunity', 'qualified', v_k, 'phone', 'dialysis', c_a1) returning id into o;
  insert into public.plus_opportunities (organization_id, title, stage, primary_contact_id, source, created_by)
    values (c_a, 'S1 second opportunity', 'qualified', v_k, 'phone', c_a1) returning id into o2;
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  select * into v_plus from public.plus_convert_opportunity_to_request(c_a, o, (select updated_at from public.plus_opportunities where id = o),
    's1-conv-key-1', 'self', 'Fictional plus pickup', 'Fictional plus clinic', 'no', null, null, null, null);
  reset role;
  perform pg_temp.t('G1 P2-S4 conversion works through the updated Core function: pending Request; since NP-P2-S4.1-S2 it carries the opportunity service (dialysis)',
    v_plus.changed and v_plus.request_state = 'pending'
    and (select coalesce(service_type, '<null>') from public.transportation_requests where id = v_plus.request_id) = 'dialysis'
    and (select stage from public.plus_opportunities where id = o) = 'converted'
    and (select link_method from public.plus_request_attributions where request_id = v_plus.request_id) = 'converted_from_opportunity');
  v_rid := v_plus.request_id;
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  select * into v_plus from public.plus_convert_opportunity_to_request(c_a, o, (select updated_at from public.plus_opportunities where id = o),
    's1-conv-key-1', 'self', 'Fictional plus pickup', 'Fictional plus clinic', 'no', null, null, null, null);
  reset role;
  perform pg_temp.t('G2 conversion replay (same key) returns the same Request, changed=false', not v_plus.changed and v_plus.request_id = v_rid);
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  begin
    perform public.plus_convert_opportunity_to_request(c_a, o, (select updated_at from public.plus_opportunities where id = o),
      's1-conv-key-2', 'self', 'Fictional plus pickup', 'Fictional plus clinic', 'no', null, null, null, null);
    v_r := 'no error';
  exception when others then v_r := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.t('G3 duplicate conversion (new key) still refused: ZW004 already_converted', v_r = 'ZW004 already_converted', v_r);
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  begin
    perform public.plus_update_request_attribution(c_a, v_rid, (select updated_at from public.plus_request_attributions where request_id = v_rid), v_k, null, 'S1 test');
    v_r := 'no error';
  exception when others then v_r := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.t('G4 conversion link still immutable: ZW004 conversion_link_immutable', v_r = 'ZW004 conversion_link_immutable', v_r);
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  select * into v_plus from public.plus_create_rebooking_request(c_a, v_k, 's1-rebook-key-1', 'family', 'Fictional rebook pickup', 'Fictional rebook clinic',
    'yes', 'email', null, null, null, null);
  reset role;
  perform pg_temp.t('G5 P2-S4 rebooking works: pending Request, service_type NULL, rebooking attribution, no opportunity created',
    v_plus.changed and v_plus.request_state = 'pending'
    and (select coalesce(service_type, '<null>') || '|' || source from public.transportation_requests where id = v_plus.request_id) = '<null>|email'
    and (select link_method || '|' || coalesce(opportunity_id::text, '-') from public.plus_request_attributions where request_id = v_plus.request_id) = 'rebooking|-'
    and (select count(*) from public.plus_opportunities where primary_contact_id = v_k) = 2);
  perform pg_temp.t('G6 Plus history intact: request_linked for both Requests; the conversion stage change recorded',
    (select count(*) from public.plus_activities where contact_id = v_k and activity_type = 'request_linked') = 2
    and (select count(*) from public.plus_activities where opportunity_id = o and activity_type = 'stage_changed') = 1);

  -- ===================================================================== H. Airport / intake compatibility
  perform pg_temp.t('H1 website intake functions unchanged in shape: _create_public_request / submit_public_transportation_request still take p_service_type; service_role-only submit',
    exists (select 1 from pg_proc where proname = '_create_public_request' and 'p_service_type' = any(proargnames))
    and has_function_privilege('service_role', 'public.submit_public_transportation_request(text,text,text,text,text,text,text,text,text,date,time,text,text,text,text,text[],date,date,time,boolean,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.submit_public_transportation_request(text,text,text,text,text,text,text,text,text,date,time,text,text,text,text,text[],date,date,time,boolean,text,jsonb)', 'EXECUTE'));
  perform pg_temp.t('H2 the hosted website form still offers 8 services (airport restriction unchanged)',
    pg_get_constraintdef((select oid from pg_constraint where conname = 'website_request_forms_services_check')) !~ 'airport_transportation'
    and pg_get_constraintdef((select oid from pg_constraint where conname = 'organization_service_offerings_service_type_check')) ~ 'airport_transportation');
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as summary from t_results;
rollback;
