-- Nemryn Plus -- service type through conversion & rebooking (NP-P2-S4.1-S2). ROLLBACK-ONLY (one transaction).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_booking_service_type_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261017110000_plus_booking_service_type.sql (on top of 20261017100000). FICTIONAL seed fixtures only:
-- Org A admin a1, dispatcher a2, driver a3, inactive dispatcher a5; Org B admin b1. Calls go through the REAL RPCs as the
-- signed-in staff member, exactly like the booking server actions.

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
create function pg_temp.mid(p_org uuid, p_uid uuid) returns uuid language sql as $$
  select id from public.memberships where organization_id = p_org and user_id = p_uid;
$$;
create function pg_temp.set_grant(p_org uuid, p_uid uuid, p_access text)
returns void language plpgsql as $$
begin
  update public.membership_module_grants set revoked_at = now(), revoked_by = '20000000-0000-0000-0000-0000000000a1'
  where membership_id = pg_temp.mid(p_org, p_uid) and revoked_at is null;
  if p_access <> 'none' then
    insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by)
    values (p_org, pg_temp.mid(p_org, p_uid), 'plus', p_access, '20000000-0000-0000-0000-0000000000a1');
  end if;
end;
$$;
create function pg_temp.contact(p_org uuid, p_name text, p_creator uuid) returns uuid language sql as $$
  insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by)
  values (p_org, p_name, '(404) 555-0123', lower(replace(p_name, ' ', '.')) || '@example.test', 'individual', p_creator) returning id;
$$;
create function pg_temp.opp(p_org uuid, p_contact uuid, p_title text, p_creator uuid, p_service text) returns uuid language sql as $$
  insert into public.plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by)
  values (p_org, p_title, 'qualified', p_contact, 'phone', p_service, p_creator) returning id;
$$;
-- convert as a caller -> 'ok:<request_id>:<changed>' / sqlstate || ':' || message
create function pg_temp.conv(p_uid uuid, p_org uuid, p_opp uuid, p_key text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  set local role authenticated;
  begin
    select 'ok:' || r.request_id || ':' || r.changed into v
    from public.plus_convert_opportunity_to_request(p_org, p_opp, (select updated_at from public.plus_opportunities where id = p_opp), p_key,
      'self', 'Fictional svc pickup', 'Fictional svc clinic', 'no', null, null, null, null) r;
  exception when others then v := sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end;
$$;
-- rebook as a caller. p_mode: 'named' (with p_service_type), 'omit' (named, WITHOUT it), 'positional12' (old 12 args)
create function pg_temp.rebook(p_uid uuid, p_org uuid, p_contact uuid, p_key text, p_mode text, p_service text default null,
                               p_role text default 'authenticated') returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    if p_mode = 'omit' then
      select 'ok:' || r.request_id || ':' || r.changed into v from public.plus_create_rebooking_request(
        p_organization_id => p_org, p_contact_id => p_contact, p_idempotency_key => p_key, p_requester_relationship => 'self',
        p_pickup_description => 'Fictional rb pickup', p_destination_description => 'Fictional rb clinic', p_return_trip_needed => 'no',
        p_source => 'phone', p_preferred_date => null, p_preferred_time => null, p_assistance_notes => null, p_additional_notes => null) r;
    elsif p_mode = 'positional12' then
      select 'ok:' || r.request_id || ':' || r.changed into v from public.plus_create_rebooking_request(
        p_org, p_contact, p_key, 'self', 'Fictional rb pickup', 'Fictional rb clinic', 'no', 'email', null, null, null, null) r;
    else
      select 'ok:' || r.request_id || ':' || r.changed into v from public.plus_create_rebooking_request(
        p_organization_id => p_org, p_contact_id => p_contact, p_idempotency_key => p_key, p_requester_relationship => 'self',
        p_pickup_description => 'Fictional rb pickup', p_destination_description => 'Fictional rb clinic', p_return_trip_needed => 'no',
        p_source => 'phone', p_preferred_date => null, p_preferred_time => null, p_assistance_notes => null, p_additional_notes => null,
        p_service_type => p_service) r;
    end if;
  exception when others then v := sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end;
$$;
create function pg_temp.rid(p text) returns uuid language sql as $$ select case when p like 'ok:%' then split_part(p, ':', 2)::uuid end; $$;
create function pg_temp.svc(p text) returns text language sql as $$
  select coalesce((select coalesce(service_type, '<null>') || '|' || state from public.transportation_requests where id = pg_temp.rid(p)), '<none>');
$$;
create function pg_temp.counts() returns text language sql as $$
  select (select count(*) from public.transportation_requests) || '/' || (select count(*) from public.request_events) || '/'
      || (select count(*) from public.plus_request_attributions) || '/' || (select count(*) from public.plus_activities) || '/'
      || (select count(*) from public.plus_opportunities);
$$;
create function pg_temp.side() returns text language sql as $$
  select (select count(*) from public.passengers) || '/' || (select count(*) from public.trips) || '/' || (select count(*) from public.trip_assignments)
    || '/' || (select count(*) from public.recurring_arrangements) || '/' || (select count(*) from public.notification_events);
$$;
create temp table t_ctx (name text primary key, val text);
insert into t_ctx values ('side0', pg_temp.side());

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  c_a3 constant uuid := '20000000-0000-0000-0000-0000000000a3';
  c_a5 constant uuid := '20000000-0000-0000-0000-0000000000a5';
  c_b1 constant uuid := '20000000-0000-0000-0000-0000000000b1';
  v_svc text; v_r text; v_c text; v_ok int := 0; v_detail text := '';
  v_k uuid; v_kb uuid; v_o uuid; v_rid uuid; v_n int := 0;
  v_plus8 text[] := array['medical_appointment','dialysis','rehabilitation','hospital_discharge','recurring_care','senior_medical','wheelchair_transportation','other'];
  v_core9 text[];
begin
  insert into public.organization_modules (organization_id, module, status, status_reason) values (c_a, 'plus', 'active', 'S2 test'), (c_b, 'plus', 'active', 'S2 test');
  v_core9 := array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g'))[1] from pg_constraint c where c.conname = 'transportation_requests_service_type_check');

  -- ===================================================================== R. RPC contract
  perform pg_temp.t('R1 exactly ONE plus_create_rebooking_request; 13 args; last p_service_type text DEFAULT NULL',
    (select count(*) from pg_proc where proname = 'plus_create_rebooking_request') = 1
    and (select pronargs from pg_proc where proname = 'plus_create_rebooking_request') = 13
    and pg_get_function_arguments((select oid from pg_proc where proname = 'plus_create_rebooking_request')) like '%p_additional_notes text, p_service_type text DEFAULT NULL::text');
  perform pg_temp.t('R2 plus_convert_opportunity_to_request keeps its 12-argument signature (one function)',
    (select count(*) from pg_proc where proname = 'plus_convert_opportunity_to_request') = 1
    and (select oid::regprocedure::text from pg_proc where proname = 'plus_convert_opportunity_to_request')
      = 'plus_convert_opportunity_to_request(uuid,uuid,timestamp with time zone,text,text,text,text,text,date,time without time zone,text,text)');
  perform pg_temp.t('R3 both: SECURITY DEFINER, search_path pinned, EXECUTE authenticated only (not PUBLIC / anon / service_role)',
    (select bool_and(p.prosecdef and p.proconfig = array['search_path=public, pg_temp'] and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')
       and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))
     from pg_proc p where p.proname in ('plus_convert_opportunity_to_request', 'plus_create_rebooking_request')));

  -- ===================================================================== A. Conversion carries the opportunity's service
  v_k := pg_temp.contact(c_a, 'S2 Conv Fictional', c_a1);
  foreach v_svc in array v_plus8 loop
    v_o := pg_temp.opp(c_a, v_k, 'S2 opp ' || v_svc, c_a1, v_svc);
    v_r := pg_temp.conv(c_a1, c_a, v_o, 's2-conv-' || v_svc);
    if pg_temp.svc(v_r) = v_svc || '|pending' and (select stage from public.plus_opportunities where id = v_o) = 'converted'
       and (select link_method || '|' || opportunity_id from public.plus_request_attributions where request_id = pg_temp.rid(v_r)) = 'converted_from_opportunity|' || v_o
    then v_ok := v_ok + 1; else v_detail := v_detail || v_svc || '=' || v_r || '/' || pg_temp.svc(v_r) || ' '; end if;
  end loop;
  perform pg_temp.t('A1 all eight Plus opportunity services -> the pending Core Request carries EXACTLY that service; attribution + Converted kept', v_ok = 8, v_detail);
  v_o := pg_temp.opp(c_a, v_k, 'S2 opp null', c_a1, null);
  v_r := pg_temp.conv(c_a1, c_a, v_o, 's2-conv-null');
  perform pg_temp.t('A2 NULL opportunity service -> Request service NULL (nothing inferred)', pg_temp.svc(v_r) = '<null>|pending', v_r);
  v_o := (select id from public.plus_opportunities where title = 'S2 opp dialysis');
  v_c := pg_temp.counts();
  perform pg_temp.t('A3 a converted opportunity cannot be converted again (new key) -> ZW004 already_converted; nothing written',
    pg_temp.conv(c_a1, c_a, v_o, 's2-conv-again') = 'ZW004:already_converted' and pg_temp.counts() = v_c);
  v_r := pg_temp.conv(c_a1, c_a, v_o, 's2-conv-dialysis');
  perform pg_temp.t('A4 conversion replay (same key) -> the same Request, changed=false, service unchanged (dialysis)',
    v_r like 'ok:%:false' and pg_temp.svc(v_r) = 'dialysis|pending' and pg_temp.counts() = v_c, v_r);
  v_o := pg_temp.opp(c_a, v_k, 'S2 opp manual', c_a1, 'rehabilitation');
  insert into public.transportation_requests (organization_id, requester_name, requester_relationship, requester_phone,
    pickup_description, destination_description, return_trip_needed, state, source)
  values (c_a, 'S2 Manual Fictional', 'self', '404-555-0101', 'Fictional earlier pickup', 'Fictional earlier clinic', 'no', 'pending', 'phone')
  returning id into v_rid;
  insert into public.plus_request_attributions (request_id, organization_id, contact_id, opportunity_id, link_method, linked_by)
    values (v_rid, c_a, v_k, v_o, 'linked_existing_request', c_a1);
  perform pg_temp.t('A5 manually linked opportunity still refused (ZW004 linked_request_exists)', pg_temp.conv(c_a1, c_a, v_o, 's2-conv-manual') = 'ZW004:linked_request_exists');
  v_rid := pg_temp.rid(pg_temp.conv(c_a1, c_a, (select id from public.plus_opportunities where title = 'S2 opp other'), 's2-conv-other'));
  perform set_config('request.jwt.claim.sub', c_a1::text, true); set local role authenticated;
  begin
    perform public.plus_update_request_attribution(c_a, v_rid, (select updated_at from public.plus_request_attributions where request_id = v_rid), v_k, null, 'S2 test');
    v_r := 'no error';
  exception when others then v_r := sqlstate || ' ' || sqlerrm; end;
  reset role;
  perform pg_temp.t('A6 conversion link still immutable (ZW004 conversion_link_immutable)', v_r = 'ZW004 conversion_link_immutable', v_r);

  -- ===================================================================== B. Rebooking service choice
  v_kb := pg_temp.contact(c_a, 'S2 Rebook Fictional', c_a1);
  v_ok := 0; v_detail := '';
  foreach v_svc in array v_core9 loop
    v_r := pg_temp.rebook(c_a1, c_a, v_kb, 's2-rb-' || v_svc, 'named', v_svc);
    if pg_temp.svc(v_r) = v_svc || '|pending' and (select link_method || '|' || coalesce(opportunity_id::text, '-') from public.plus_request_attributions where request_id = pg_temp.rid(v_r)) = 'rebooking|-'
    then v_ok := v_ok + 1; else v_detail := v_detail || v_svc || '=' || v_r || ' '; end if;
  end loop;
  perform pg_temp.t('B1 all nine Core services (incl. airport_transportation) -> stored exactly; pending; rebooking attribution, no opportunity',
    v_ok = 9 and cardinality(v_core9) = 9 and 'airport_transportation' = any(v_core9), v_detail);
  perform pg_temp.t('B2 explicit NULL / empty / whitespace-only -> NULL',
    pg_temp.svc(pg_temp.rebook(c_a1, c_a, v_kb, 's2-rb-null', 'named', null)) = '<null>|pending'
    and pg_temp.svc(pg_temp.rebook(c_a1, c_a, v_kb, 's2-rb-empty', 'named', '')) = '<null>|pending'
    and pg_temp.svc(pg_temp.rebook(c_a1, c_a, v_kb, 's2-rb-space', 'named', E'  \t ')) = '<null>|pending');
  perform pg_temp.t('B3 existing calls WITHOUT p_service_type still work: named (12 args) and positional (12 args) -> NULL',
    pg_temp.svc(pg_temp.rebook(c_a1, c_a, v_kb, 's2-rb-omit', 'omit')) = '<null>|pending'
    and pg_temp.svc(pg_temp.rebook(c_a1, c_a, v_kb, 's2-rb-pos12', 'positional12')) = '<null>|pending');
  v_c := pg_temp.counts(); v_ok := 0; v_detail := '';
  foreach v_svc in array array['limousine', 'Dialysis', 'Airport Transportation', 'airport', ' dialysis', 'dialysis ', E'dialysis\n'] loop
    v_r := pg_temp.rebook(c_a1, c_a, v_kb, 's2-rb-bad-' || md5(v_svc), 'named', v_svc);
    if v_r = 'ZW006:invalid_input' then v_ok := v_ok + 1; else v_detail := v_detail || quote_literal(v_svc) || '=' || v_r || ' '; end if;
  end loop;
  perform pg_temp.t('B4 invalid / wrong case / label / alias / padded values -> ZW006 (Core validation)', v_ok = 7, v_detail);
  perform pg_temp.t('B5 refused rebookings wrote NOTHING (no Request, event, attribution, activity)', pg_temp.counts() = v_c, v_c || ' -> ' || pg_temp.counts());
  v_c := pg_temp.counts();
  v_r := pg_temp.rebook(c_a1, c_a, v_kb, 's2-rb-dialysis', 'named', 'wheelchair_transportation');
  perform pg_temp.t('B6 retry with the SAME key but another service -> the ORIGINAL Request (changed=false), service still dialysis, nothing written',
    v_r like 'ok:%:false' and pg_temp.svc(v_r) = 'dialysis|pending' and pg_temp.counts() = v_c, v_r || ' ' || pg_temp.svc(v_r));
  perform pg_temp.t('B7 rebooking never creates an opportunity', (select count(*) from public.plus_opportunities where primary_contact_id = v_kb) = 0);

  -- ===================================================================== C. Services policy (OD-S1 = A)
  insert into public.organization_service_offerings (organization_id, service_type) values (c_a, 'dialysis');
  perform pg_temp.t('C1 Org A offers ONLY dialysis: a valid unconfigured service (airport) is still accepted by the authorized RPC',
    pg_temp.svc(pg_temp.rebook(c_a1, c_a, v_kb, 's2-rb-unconf', 'named', 'airport_transportation')) = 'airport_transportation|pending');
  v_o := pg_temp.opp(c_a, v_k, 'S2 opp unconf', c_a1, 'senior_medical');
  perform pg_temp.t('C2 ... and a conversion of a senior_medical opportunity keeps senior_medical (never replaced with NULL)',
    pg_temp.svc(pg_temp.conv(c_a1, c_a, v_o, 's2-conv-unconf')) = 'senior_medical|pending');
  delete from public.organization_service_offerings where organization_id = c_a;

  -- ===================================================================== D. Authorization
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v_o := pg_temp.opp(c_a, v_k, 'S2 opp disp', c_a1, 'dialysis');
  perform pg_temp.t('D1 WRITE-grant Dispatcher: rebooking with a service and conversion work',
    pg_temp.svc(pg_temp.rebook(c_a2, c_a, v_kb, 's2-rb-disp', 'named', 'rehabilitation')) = 'rehabilitation|pending'
    and pg_temp.svc(pg_temp.conv(c_a2, c_a, v_o, 's2-conv-disp')) = 'dialysis|pending');
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v_o := pg_temp.opp(c_a, v_k, 'S2 opp ro', c_a1, 'dialysis');
  v_c := pg_temp.counts();  -- after the fixture opportunity
  perform pg_temp.t('D2 READ-grant Dispatcher (no Plus WRITE) -> ZW001 for both',
    pg_temp.rebook(c_a2, c_a, v_kb, 's2-rb-ro', 'named', 'dialysis') = 'ZW001:unauthorized' and pg_temp.conv(c_a2, c_a, v_o, 's2-conv-ro') = 'ZW001:unauthorized');
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  perform pg_temp.t('D3 Dispatcher without a Plus grant -> ZW002', pg_temp.rebook(c_a2, c_a, v_kb, 's2-rb-nogrant', 'named', 'dialysis') = 'ZW002:not_found');
  perform pg_temp.t('D4 Driver / inactive Dispatcher -> ZW002',
    pg_temp.rebook(c_a3, c_a, v_kb, 's2-rb-drv', 'named', 'dialysis') = 'ZW002:not_found' and pg_temp.rebook(c_a5, c_a, v_kb, 's2-rb-inact', 'named', 'dialysis') = 'ZW002:not_found');
  perform pg_temp.t('D5 foreign organization: Org B admin on Org A contact / opportunity -> ZW002 (no oracle)',
    pg_temp.rebook(c_b1, c_a, v_kb, 's2-rb-foreign', 'named', 'dialysis') = 'ZW002:not_found' and pg_temp.conv(c_b1, c_a, v_o, 's2-conv-foreign') = 'ZW002:not_found');
  perform pg_temp.t('D6 no user -> ZW001; anon role -> no EXECUTE (42501)',
    pg_temp.rebook(null, c_a, v_kb, 's2-rb-nouid', 'named', 'dialysis') = 'ZW001:unauthorized'
    and pg_temp.rebook(null, c_a, v_kb, 's2-rb-anon', 'named', 'dialysis', 'anon') like '42501:%');
  perform pg_temp.t('D7 refusals wrote nothing', pg_temp.counts() = v_c, v_c || ' -> ' || pg_temp.counts());

  -- ===================================================================== E. Operational integrity
  perform pg_temp.t('E1 no Trip, Passenger, assignment, recurring arrangement or notification created by any conversion / rebooking',
    pg_temp.side() = (select val from t_ctx where name = 'side0'), (select val from t_ctx where name = 'side0') || ' -> ' || pg_temp.side());
  perform pg_temp.t('E2 every Plus-created Request is pending and was logged by Core''s own request_logged event ({source} only)',
    not exists (select 1 from public.plus_request_attributions a join public.transportation_requests r on r.id = a.request_id
                where a.link_method in ('converted_from_opportunity', 'rebooking') and (r.state <> 'pending'
                  or (select count(*) from public.request_events e where e.request_id = r.id and e.event_type = 'request_logged' and e.metadata ? 'source' and not e.metadata ? 'service_type') <> 1)));
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as summary from t_results;
rollback;
