-- Nemryn Plus -- opportunity conversion & rebooking tests (NP-P2-S4). ROLLBACK-ONLY (one transaction, rolled back).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_conversion_rebooking_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261015140000_plus_conversion_rebooking.sql. FICTIONAL seed fixtures only (Org A admin a1, dispatcher a2,
-- driver a3, inactive dispatcher a5; Org B admin b1; c1 admin in A + driver in B; d1 platform admin; e1 no membership).
-- Contacts / opportunities / Requests are owner-level fictional fixtures. Side effects are evaluated into variables
-- BEFORE assertions. Inside one transaction now() is constant: "stale" versions are simulated with an earlier timestamp.

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
create function pg_temp.set_state(p_org uuid, p_state text)
returns void language plpgsql as $$
begin
  delete from public.organization_modules where organization_id = p_org;
  if p_state = 'none' then return; end if;
  insert into public.organization_modules (organization_id, module, status, restriction, trial_started_at, trial_ends_at, status_reason)
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, 'P2-S4 conversion test'
  from (values ('active', 'active', null, null::timestamptz, null::timestamptz),
               ('expired', 'expired', null, now() - interval '20 days', now() - interval '6 days'),
               ('locked', 'disabled', 'no_access', null, null)) as s(name, status, restriction, ts, te)
  where s.name = p_state;
end;
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
create function pg_temp.contact(p_org uuid, p_name text, p_creator uuid, p_phone text default '(404) 555-0123') returns uuid language sql as $$
  insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by)
  values (p_org, p_name, p_phone, lower(replace(p_name, ' ', '.')) || '@example.test', 'individual', p_creator) returning id;
$$;
create function pg_temp.opp(p_org uuid, p_contact uuid, p_title text, p_creator uuid, p_source text default 'phone', p_stage text default 'qualified')
returns uuid language sql as $$
  insert into public.plus_opportunities (organization_id, title, stage, primary_contact_id, source, created_by)
  values (p_org, p_title, p_stage, p_contact, p_source, p_creator) returning id;
$$;
create function pg_temp.req(p_org uuid, p_name text) returns uuid language sql as $$
  insert into public.transportation_requests (organization_id, requester_name, requester_relationship, requester_phone,
    pickup_description, destination_description, return_trip_needed, state, source)
  values (p_org, p_name, 'self', '(404) 555-0199', 'Fictional earlier pickup', 'Fictional earlier clinic', 'no', 'pending', 'phone') returning id;
$$;
-- convert as a caller -> 'changed=<bool>:<request_id>' / 'ERR:<sqlstate>:<message>'
create function pg_temp.conv(p_uid uuid, p_org uuid, p_opp uuid, p_key text, p_expected timestamptz default null,
                             p_pickup text default 'Fictional pickup 12 Elm', p_dest text default 'Fictional dialysis center',
                             p_rel text default 'self', p_return text default 'no')
returns text language plpgsql as $$
declare v text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    select 'changed=' || r.changed || ':' || r.request_id into v
    from public.plus_convert_opportunity_to_request(p_org, p_opp,
      coalesce(p_expected, (select updated_at from public.plus_opportunities where id = p_opp)), p_key,
      p_rel, p_pickup, p_dest, p_return, date '2026-11-02', time '09:30', 'Fictional: needs a little help with steps', null) r;
  exception when others then v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end;
$$;
create function pg_temp.rebook(p_uid uuid, p_org uuid, p_contact uuid, p_key text, p_source text default 'phone',
                               p_pickup text default 'Fictional pickup 12 Elm')
returns text language plpgsql as $$
declare v text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    select 'changed=' || r.changed || ':' || r.request_id into v
    from public.plus_create_rebooking_request(p_org, p_contact, p_key, 'family', p_pickup, 'Fictional rehab clinic', 'yes', p_source,
                                              date '2026-11-09', null, null, null) r;
  exception when others then v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end;
$$;
create function pg_temp.rid(p_text text) returns uuid language sql as $$ select nullif(split_part(p_text, ':', 2), '')::uuid; $$;
create function pg_temp.nreq() returns bigint language sql as $$ select count(*) from public.transportation_requests; $$;
create function pg_temp.core_side() returns text language sql as $$
  select (select count(*) from public.passengers) || '/' || (select count(*) from public.trips) || '/' || (select count(*) from public.trip_assignments)
    || '/' || (select count(*) from public.recurring_arrangements) || '/' || (select count(*) from public.request_acquisition_attributions);
$$;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  c_a3 constant uuid := '20000000-0000-0000-0000-0000000000a3';
  c_a5 constant uuid := '20000000-0000-0000-0000-0000000000a5';
  c_b1 constant uuid := '20000000-0000-0000-0000-0000000000b1';
  c_c1 constant uuid := '20000000-0000-0000-0000-0000000000c1';
  c_d1 constant uuid := '20000000-0000-0000-0000-0000000000d1';
  c_e1 constant uuid := '20000000-0000-0000-0000-0000000000e1';
  v text; v2 text; v3 text; v_n bigint; v_m bigint; v_side text; v_ok boolean; r1 uuid; r_old uuid; r_rb uuid;
  k1 uuid; k2 uuid; k_nophone uuid; k_arch uuid; k_b uuid;
  o1 uuid; o_lost uuid; o_linked uuid; o_web uuid; o_misc uuid; o_perm uuid; o_b uuid; o_stale uuid; o_fail uuid; o_c1 uuid;
  v_audit bigint; v_acts bigint; v_events bigint; v_attr bigint;
begin
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_state(c_b, 'active');
  k1 := pg_temp.contact(c_a, 'Conv Pat Fictional', c_a1);
  k2 := pg_temp.contact(c_a, 'Conv Sam Fictional', c_a1);
  k_nophone := pg_temp.contact(c_a, 'Conv Nophone Fictional', c_a1, null);
  k_arch := pg_temp.contact(c_a, 'Conv Archived Fictional', c_a1);
  k_b := pg_temp.contact(c_b, 'Conv In B Fictional', c_b1);
  o1 := pg_temp.opp(c_a, k1, 'Conv weekly dialysis', c_a1);
  o_lost := pg_temp.opp(c_a, k1, 'Conv lost one', c_a1);
  update public.plus_opportunities set stage = 'lost', lost_reason = 'price', closed_at = now() where id = o_lost;
  o_linked := pg_temp.opp(c_a, k2, 'Conv manually linked', c_a1);
  o_web := pg_temp.opp(c_a, k2, 'Conv from website', c_a1, 'website');
  o_misc := pg_temp.opp(c_a, k2, 'Conv from referral', c_a1, 'referral');
  o_perm := pg_temp.opp(c_a, k2, 'Conv permissions', c_a1);
  o_stale := pg_temp.opp(c_a, k2, 'Conv stale', c_a1);
  o_fail := pg_temp.opp(c_a, k2, 'Conv failing attribution', c_a1);
  o_b := pg_temp.opp(c_b, k_b, 'Conv in B', c_b1);
  r_old := pg_temp.req(c_a, 'Conv earlier request');
  update public.plus_contacts set status = 'archived' where id = k_arch;
  v_side := pg_temp.core_side();

  -- ============================================== V. successful conversion (1-8)
  v_n := pg_temp.nreq();
  v := pg_temp.conv(c_a1, c_a, o1, 'conv-o1-key-0001');
  r1 := pg_temp.rid(v);
  perform pg_temp.t('V1 conversion: changed=true and EXACTLY ONE new Core Request, pending, created through log_transportation_request',
    v like 'changed=true:%' and pg_temp.nreq() = v_n + 1
    and (select state = 'pending' from public.transportation_requests where id = r1)
    and (select count(*) from public.request_events where request_id = r1 and event_type = 'request_logged' and actor_user_id = c_a1) = 1, v);
  perform pg_temp.t('V2 attribution: converted_from_opportunity, contact = the opportunity''s primary contact, key stored, linked_by = caller',
    (select link_method = 'converted_from_opportunity' and contact_id = k1 and opportunity_id = o1 and conversion_idempotency_key = 'conv-o1-key-0001'
            and linked_by = c_a1 from public.plus_request_attributions where request_id = r1));
  perform pg_temp.t('V3 the opportunity is converted with converted_at and closed_at set',
    (select stage = 'converted' and converted_at is not null and closed_at is not null and lost_reason is null from public.plus_opportunities where id = o1));
  perform pg_temp.t('V4 history: ONE request_linked (contact + opportunity + request, no body), ONE stage_changed qualified -> converted, ONE audit (ids only)',
    (select count(*) from public.plus_activities where request_id = r1 and activity_type = 'request_linked' and contact_id = k1 and opportunity_id = o1 and body is null) = 1
    and (select count(*) from public.plus_activities where opportunity_id = o1 and activity_type = 'stage_changed' and from_stage = 'qualified' and to_stage = 'converted') = 1
    and (select count(*) from public.audit_events where entity_id = o1 and action = 'plus_opportunity_converted') = 1
    and (select after_data = jsonb_build_object('stage', 'converted', 'request_id', r1, 'contact_id', k1, 'link_method', 'converted_from_opportunity')
         from public.audit_events where entity_id = o1 and action = 'plus_opportunity_converted'));
  perform pg_temp.t('V5 requester mapped from the Growth contact (name, phone, email); relationship and transport details from staff input; passenger NULL',
    (select requester_name = 'Conv Pat Fictional' and requester_phone = '(404) 555-0123' and requester_email = 'conv.pat.fictional@example.test'
            and requester_relationship = 'self' and pickup_description = 'Fictional pickup 12 Elm' and destination_description = 'Fictional dialysis center'
            and preferred_date = date '2026-11-02' and preferred_time = time '09:30' and return_trip_needed = 'no' and passenger_id is null
     from public.transportation_requests where id = r1));
  perform pg_temp.t('V6 no Passenger, Trip, assignment, recurring arrangement or acquisition snapshot is created', pg_temp.core_side() = v_side, pg_temp.core_side());
  perform pg_temp.t('V7 transport text is stored only in Core: no Plus activity body or audit row contains pickup / destination / assistance text',
    not exists (select 1 from public.plus_activities where body ~* '(Elm|dialysis center|steps)')
    and not exists (select 1 from public.audit_events where coalesce(after_data::text, '') ~* '(Elm|dialysis center|steps|555)'));
  v := pg_temp.conv(c_a1, c_a, o_web, 'conv-web-key-0001');
  v2 := pg_temp.conv(c_a1, c_a, o_misc, 'conv-misc-key-0001');
  perform pg_temp.t('V8 source mapping: phone -> phone, website -> web, referral -> other; full map of every opportunity source',
    (select source from public.transportation_requests where id = r1) = 'phone'
    and (select source from public.transportation_requests where id = pg_temp.rid(v)) = 'web'
    and (select source from public.transportation_requests where id = pg_temp.rid(v2)) = 'other'
    and (select string_agg(s || '>' || public._plus_core_request_source(s), ',' order by s) from unnest(array['advertising','email','event','facility','other','phone','referral','walk_in','web_inquiry','website']) s)
      = 'advertising>other,email>email,event>other,facility>facility,other>other,phone>phone,referral>other,walk_in>other,web_inquiry>web,website>web', v || ' ' || v2);

  -- ============================================== I. idempotency (9-12)
  v_n := pg_temp.nreq();
  select count(*) into v_acts from public.plus_activities where opportunity_id = o1;
  select count(*) into v_audit from public.audit_events where entity_id = o1;
  select count(*) into v_events from public.request_events where request_id = r1;
  v := pg_temp.conv(c_a1, c_a, o1, 'conv-o1-key-0001');
  perform pg_temp.t('I1 same-key replay returns the ORIGINAL Request, changed=false; no new Request, history, audit or Core event',
    v = 'changed=false:' || r1 and pg_temp.nreq() = v_n
    and (select count(*) from public.plus_activities where opportunity_id = o1) = v_acts
    and (select count(*) from public.audit_events where entity_id = o1) = v_audit
    and (select count(*) from public.request_events where request_id = r1) = v_events, v);
  v := pg_temp.conv(c_a1, c_a, o1, 'conv-o1-key-DIFF1');
  perform pg_temp.t('I2 already converted + a different key -> ZW004 already_converted; no second Request', v = 'ERR:ZW004:already_converted' and pg_temp.nreq() = v_n, v);
  v := pg_temp.conv(c_a1, c_a, o_perm, 'conv-o1-key-0001');
  v2 := pg_temp.rebook(c_a1, c_a, k2, 'conv-o1-key-0001');
  perform pg_temp.t('I3 a key of another operation (other opportunity, or a rebooking of another contact) -> ZW006; never returns someone else''s Request',
    v = 'ERR:ZW006:invalid_input' and v2 = 'ERR:ZW006:invalid_input' and pg_temp.nreq() = v_n
    and (select stage from public.plus_opportunities where id = o_perm) = 'qualified', v || ' ' || v2);
  perform public.plus_link_request(c_a, r_old, null, o_linked) from (select set_config('request.jwt.claim.sub', c_a1::text, true)) x;
  v := pg_temp.conv(c_a1, c_a, o_linked, 'conv-linked-key-01');
  perform pg_temp.t('I4 an opportunity already linked to an existing Request (P2-S3) is NOT converted into a second Request -> ZW004 linked_request_exists',
    v = 'ERR:ZW004:linked_request_exists' and pg_temp.nreq() = v_n and (select stage from public.plus_opportunities where id = o_linked) = 'qualified', v);
  v := pg_temp.conv(c_a1, c_a, o_perm, 'short') || ' ' || pg_temp.conv(c_a1, c_a, o_perm, 'bad key with spaces') || ' ' || pg_temp.conv(c_a1, c_a, o_perm, repeat('k', 201));
  perform pg_temp.t('I5 idempotency key: 8-200 of [A-Za-z0-9._:-] (ZW006 otherwise)', v = 'ERR:ZW006:invalid_input ERR:ZW006:invalid_input ERR:ZW006:invalid_input', v);

  -- ============================================== F. failures roll back everything (13-15)
  v_n := pg_temp.nreq();
  select count(*) into v_attr from public.plus_request_attributions;
  v := pg_temp.conv(c_a1, c_a, o_perm, 'conv-bad-pickup-1', null, '   ')
       || ' ' || pg_temp.conv(c_a1, c_a, o_perm, 'conv-bad-rel-0001', null, 'Fictional pickup', 'Fictional clinic', 'neighbour')
       || ' ' || pg_temp.conv(c_a1, c_a, o_perm, 'conv-bad-ret-0001', null, 'Fictional pickup', 'Fictional clinic', 'self', 'maybe');
  perform pg_temp.t('F1 invalid transport inputs (refused by Core) -> ZW006 and NOTHING is written: no Request, attribution, stage change or history',
    v = 'ERR:ZW006:invalid_input ERR:ZW006:invalid_input ERR:ZW006:invalid_input' and pg_temp.nreq() = v_n
    and (select count(*) from public.plus_request_attributions) = v_attr and (select stage from public.plus_opportunities where id = o_perm) = 'qualified'
    and not exists (select 1 from public.plus_activities where opportunity_id = o_perm), v);
  update public.plus_opportunities set primary_contact_id = k_nophone where id = o_stale;
  v := pg_temp.conv(c_a1, c_a, o_stale, 'conv-nophone-0001');
  update public.plus_opportunities set primary_contact_id = k_arch where id = o_stale;
  v2 := pg_temp.conv(c_a1, c_a, o_stale, 'conv-archived-001');
  update public.plus_opportunities set primary_contact_id = k2 where id = o_stale;
  perform pg_temp.t('F2 a contact without a phone (Core requires one) or an archived contact -> ZW006 before any Core write',
    v = 'ERR:ZW006:contact_phone_required' and v2 = 'ERR:ZW006:contact_not_active' and pg_temp.nreq() = v_n, v || ' ' || v2);
  -- attribution insert fails AFTER the Core Request was created -> the Core Request rolls back with it
  create function pg_temp.fail_attr() returns trigger language plpgsql as $f$
  begin
    if new.conversion_idempotency_key = 'conv-fail-attr-01' then raise exception 'simulated attribution failure'; end if;
    return new;
  end;
  $f$;
  create trigger zz_test_fail_attr before insert on public.plus_request_attributions for each row execute function pg_temp.fail_attr();
  v := pg_temp.conv(c_a1, c_a, o_fail, 'conv-fail-attr-01');
  drop trigger zz_test_fail_attr on public.plus_request_attributions;
  perform pg_temp.t('F3 an attribution failure after Core creation rolls the Core Request back too: no orphan Request, no stage change, no history',
    v like 'ERR:P0001:simulated attribution failure%' and pg_temp.nreq() = v_n
    and not exists (select 1 from public.transportation_requests where requester_name = 'Conv Sam Fictional' and pickup_description = 'Fictional pickup 12 Elm'
                    and created_at = now() and id not in (select request_id from public.plus_request_attributions))
    and (select stage from public.plus_opportunities where id = o_fail) = 'qualified' and not exists (select 1 from public.plus_activities where opportunity_id = o_fail), v);

  -- ============================================== P. authority (16-24)
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.conv(c_a2, c_a, o_perm, 'conv-disp-key-0001');
  perform pg_temp.t('P1 a WRITE-grant Dispatcher (holds the Core role) converts', v like 'changed=true:%', v);
  v_n := pg_temp.nreq();
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v := pg_temp.conv(c_a2, c_a, o_stale, 'conv-read-key-0001') || ' ' || pg_temp.rebook(c_a2, c_a, k2, 'rebook-read-key-01');
  perform pg_temp.t('P2 READ grant: conversion and rebooking -> ZW001', v = 'ERR:ZW001:unauthorized ERR:ZW001:unauthorized', v);
  v := pg_temp.conv(c_a2, c_a, o_perm, 'conv-disp-key-0001');
  perform pg_temp.t('P3 replay re-checks authority: the converting Dispatcher, now read-only, cannot even replay (ZW001)', v = 'ERR:ZW001:unauthorized', v);
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  v := pg_temp.conv(c_a2, c_a, o_stale, 'conv-revk-key-0001');
  perform pg_temp.t('P4 revoked grant -> ZW002', v = 'ERR:ZW002:not_found', v);
  v := pg_temp.conv(c_a5, c_a, o_stale, 'conv-inac-key-0001') || ' ' || pg_temp.conv(c_a3, c_a, o_stale, 'conv-drvr-key-0001')
       || ' ' || pg_temp.conv(c_d1, c_a, o_stale, 'conv-padm-key-0001') || ' ' || pg_temp.conv(c_e1, c_a, o_stale, 'conv-nomb-key-0001')
       || ' ' || pg_temp.conv(null, c_a, o_stale, 'conv-nouid-key-001');
  perform pg_temp.t('P5 inactive Dispatcher, Driver, Platform Admin without membership, no-membership user -> ZW002; no uid -> ZW001',
    v = 'ERR:ZW002:not_found ERR:ZW002:not_found ERR:ZW002:not_found ERR:ZW002:not_found ERR:ZW001:unauthorized' and pg_temp.nreq() = v_n, v);
  perform pg_temp.set_state(c_a, 'expired');
  v := pg_temp.conv(c_a1, c_a, o_stale, 'conv-expd-key-0001') || ' ' || pg_temp.rebook(c_a1, c_a, k2, 'rebook-expd-key-01');
  perform pg_temp.set_state(c_a, 'locked');
  v2 := pg_temp.conv(c_a1, c_a, o_stale, 'conv-lckd-key-0001');
  perform pg_temp.set_state(c_a, 'active');
  update public.organizations set status = 'inactive' where id = c_a;
  v3 := pg_temp.conv(c_a1, c_a, o_stale, 'conv-susp-key-0001');
  update public.organizations set status = 'active' where id = c_a;
  perform pg_temp.t('P6 expired Plus -> ZW001 (conversion and rebooking); locked -> ZW002; suspended organization -> ZW002',
    v = 'ERR:ZW001:unauthorized ERR:ZW001:unauthorized' and v2 = 'ERR:ZW002:not_found' and v3 = 'ERR:ZW002:not_found' and pg_temp.nreq() = v_n, v || ' | ' || v2 || ' | ' || v3);
  v := pg_temp.conv(c_b1, c_a, o_stale, 'conv-orgb-key-0001') || ' ' || pg_temp.conv(c_a1, c_a, o_b, 'conv-forn-key-0001')
       || ' ' || pg_temp.conv(c_a1, c_b, o_b, 'conv-forg-key-0001') || ' ' || pg_temp.rebook(c_a1, c_a, k_b, 'rebook-forn-key-01')
       || ' ' || pg_temp.conv(c_a1, c_a, gen_random_uuid(), 'conv-unkn-key-0001');
  perform pg_temp.t('P7 foreign / unknown ids: Org B caller, Org B opportunity, Org B organization id, Org B contact, unknown opportunity -> ZW002 (no oracle)',
    v = 'ERR:ZW002:not_found ERR:ZW002:not_found ERR:ZW002:not_found ERR:ZW002:not_found ERR:ZW002:not_found' and pg_temp.nreq() = v_n, v);
  o_c1 := pg_temp.opp(c_a, k2, 'Conv by c1', c_a1);
  v := pg_temp.conv(c_c1, c_a, o_c1, 'conv-c1in-key-0001') || ' ' || pg_temp.conv(c_c1, c_b, o_b, 'conv-c1b-key-00001');
  perform pg_temp.t('P8 multi-organization c1 (Admin in A, Driver in B): converts in A; in B -> ZW002',
    split_part(v, ' ', 1) like 'changed=true:%' and split_part(v, ' ', 2) = 'ERR:ZW002:not_found', v);

  -- ============================================== S. stage rules (25-27)
  v_n := pg_temp.nreq();
  v := pg_temp.conv(c_a1, c_a, o_lost, 'conv-lost-key-0001') || ' ' || pg_temp.conv(c_a1, c_a, o_perm, 'conv-agin-key-0001');
  perform pg_temp.t('S1 lost -> ZW004 illegal_transition; already converted -> ZW004 already_converted',
    v = 'ERR:ZW004:illegal_transition ERR:ZW004:already_converted' and pg_temp.nreq() = v_n, v);
  v := pg_temp.conv(c_a1, c_a, o_stale, 'conv-stal-key-0001', now() - interval '1 day');
  perform pg_temp.t('S2 stale opportunity version -> ZW003; nothing written', v = 'ERR:ZW003:stale_state' and pg_temp.nreq() = v_n, v);
  begin
    set constraints plus_opportunities_conversion_guard immediate;
    update public.plus_opportunities set stage = 'converted', converted_at = now(), closed_at = now() where id = o_stale;
    v := 'allowed';
  exception when sqlstate 'ZW004' then v := 'ZW004:' || sqlerrm;
  end;
  set constraints plus_opportunities_conversion_guard deferred;
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  begin
    perform public.plus_change_opportunity_stage(c_a, o_stale, (select updated_at from public.plus_opportunities where id = o_stale), 'converted', null);
    v2 := 'allowed';
  exception when others then v2 := sqlstate;
  end;
  reset role;
  perform pg_temp.t('S3 converted cannot be impersonated: a direct update without a conversion attribution fails the database guard; the stage RPC refuses converted',
    v = 'ZW004:conversion_requires_request' and v2 = 'ZW006' and (select stage from public.plus_opportunities where id = o_stale) = 'qualified', v || ' ' || v2);
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  begin
    perform public.plus_update_opportunity(c_a, o1, (select updated_at from public.plus_opportunities where id = o1), k2, 'Conv weekly dialysis',
                                           'quote', null, 'phone', null, null, null, 'none', null);
    v := 'allowed';
  exception when others then v := sqlstate || ':' || sqlerrm;
  end;
  begin
    perform public.plus_update_request_attribution(c_a, r1, (select updated_at from public.plus_request_attributions where request_id = r1), k1, null, 'Try to detach the conversion');
    v2 := 'allowed';
  exception when others then v2 := sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform pg_temp.t('S4 P2-S3 rules intact: a converted opportunity is closed to edits (ZW004); a conversion link is immutable history (ZW004 conversion_link_immutable)',
    v = 'ZW004:illegal_transition' and v2 = 'ZW004:conversion_link_immutable', v || ' ' || v2);

  -- ============================================== R. rebooking (28-31)
  v_n := pg_temp.nreq();
  select count(*) into v_m from public.plus_opportunities where organization_id = c_a;
  v3 := (select string_agg(id::text || state || updated_at::text, ',' order by id) from public.transportation_requests where organization_id = c_a);
  v := pg_temp.rebook(c_a1, c_a, k1, 'rebook-k1-key-0001', 'email');
  r_rb := pg_temp.rid(v);
  perform pg_temp.t('R1 rebooking: ONE new pending Request for the contact (requester from the contact; staff details; source as chosen; passenger NULL)',
    v like 'changed=true:%' and pg_temp.nreq() = v_n + 1
    and (select state = 'pending' and requester_name = 'Conv Pat Fictional' and requester_relationship = 'family' and source = 'email'
                and return_trip_needed = 'yes' and passenger_id is null from public.transportation_requests where id = r_rb), v);
  perform pg_temp.t('R2 rebooking attribution: contact only (no opportunity), link_method rebooking, key stored; one request_linked; one audit',
    (select link_method = 'rebooking' and contact_id = k1 and opportunity_id is null and conversion_idempotency_key = 'rebook-k1-key-0001'
     from public.plus_request_attributions where request_id = r_rb)
    and (select count(*) from public.plus_activities where request_id = r_rb and activity_type = 'request_linked' and contact_id = k1 and opportunity_id is null) = 1
    and (select count(*) from public.audit_events where entity_id = k1 and action = 'plus_contact_rebooked'
         and after_data = jsonb_build_object('request_id', r_rb, 'link_method', 'rebooking')) = 1);
  perform pg_temp.t('R3 rebooking creates NO opportunity and changes no existing opportunity or earlier Request',
    (select count(*) from public.plus_opportunities where organization_id = c_a) = v_m
    and v3 = (select string_agg(id::text || state || updated_at::text, ',' order by id) from public.transportation_requests where organization_id = c_a and id <> r_rb));
  v_n := pg_temp.nreq();
  v := pg_temp.rebook(c_a1, c_a, k1, 'rebook-k1-key-0001', 'email');
  v2 := pg_temp.rebook(c_a1, c_a, k2, 'rebook-k1-key-0001');
  perform pg_temp.t('R4 rebooking replay: same key + same contact -> the original Request, changed=false; same key for another contact -> ZW006',
    v = 'changed=false:' || r_rb and v2 = 'ERR:ZW006:invalid_input' and pg_temp.nreq() = v_n, v || ' ' || v2);
  v := pg_temp.rebook(c_a1, c_a, k_arch, 'rebook-arch-key-01') || ' ' || pg_temp.rebook(c_a1, c_a, k_nophone, 'rebook-noph-key-01')
       || ' ' || pg_temp.rebook(c_a1, c_a, k1, 'rebook-bad-src-001', 'fax') || ' ' || pg_temp.rebook(c_a1, c_a, gen_random_uuid(), 'rebook-unkn-key-01');
  perform pg_temp.t('R5 rebooking refusals: archived contact / no phone / invalid Core source -> ZW006; unknown contact -> ZW002; nothing written',
    v = 'ERR:ZW006:contact_not_active ERR:ZW006:contact_phone_required ERR:ZW006:invalid_input ERR:ZW002:not_found' and pg_temp.nreq() = v_n, v);
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  begin
    perform public.plus_update_request_attribution(c_a, r_rb, (select updated_at from public.plus_request_attributions where request_id = r_rb), k1, o_c1, 'Attach an opportunity');
    v := 'allowed';
  exception when others then v := sqlstate;
  end;
  begin
    perform public.plus_update_request_attribution(c_a, r_rb, (select updated_at from public.plus_request_attributions where request_id = r_rb), k2, null, 'Booked for Sam actually');
    v2 := 'ok';
  exception when others then v2 := sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform pg_temp.t('R6 a rebooking link may move to another contact (with a reason) but never gains an opportunity (ZW006); link_method stays rebooking',
    v = 'ZW006' and v2 = 'ok' and (select contact_id = k2 and opportunity_id is null and link_method = 'rebooking' from public.plus_request_attributions where request_id = r_rb), v || ' ' || v2);
  perform pg_temp.t('R7 the linked lists show both: the contact''s Requests include its conversion; the opportunity lists its converted Request',
    (select count(*) from public.plus_request_attributions where contact_id = k1 and link_method = 'converted_from_opportunity') = 1
    and (select count(*) from public.plus_request_attributions where opportunity_id = o1) = 1);

  -- ============================================== G. surface, outbound, agent, Core (32-34)
  perform pg_temp.t('G1 grants: the two RPCs are authenticated-only; the 3 internals have no client EXECUTE; all SECURITY DEFINER where needed with a pinned search_path',
    (select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                     and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'])
       from pg_proc p where p.proname in ('plus_convert_opportunity_to_request', 'plus_create_rebooking_request'))
    and (select bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                         and not has_function_privilege('service_role', p.oid, 'EXECUTE') and p.proconfig @> array['search_path=public, pg_temp'])
       from pg_proc p where p.proname in ('_plus_opportunity_conversion_guard', '_plus_core_request_source', '_plus_require_idempotency_key')));
  perform pg_temp.t('G2 Core is written ONLY through log_transportation_request: no Plus function inserts / updates / deletes Core tables; only the two RPCs call it',
    not exists (select 1 from pg_proc p where p.proname ~ '^(plus_|_plus_)'
                and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(transportation_requests|request_events|passengers|trips|trip_assignments|recurring_arrangements|request_acquisition_attributions)\M')
    and (select string_agg(proname, ',' order by proname) from pg_proc where proname ~ '^(plus_|_plus_)' and prosrc ~ 'log_transportation_request')
        = 'plus_convert_opportunity_to_request,plus_create_rebooking_request');
  perform pg_temp.t('G3 no outbound communication: the new functions use no pg_net / http / email / SMS / notification path',
    not exists (select 1 from pg_proc where proname in ('plus_convert_opportunity_to_request', 'plus_create_rebooking_request', '_plus_opportunity_conversion_guard')
                and prosrc ~* '(net\.|http|smtp|sms|send_|notification)'));
  v := pg_temp.conv(c_a1, c_a, o_stale, 'unused-key-g4-0001', now() - interval '1 day');   -- (stale: nothing written)
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  perform public.plus_run_growth_agent_review(c_a);
  reset role;
  perform pg_temp.t('G4 the Growth Agent cannot convert or rebook: no agent / dashboard function references the P2-S4 RPCs or Core creation; converted opportunities are not agent candidates',
    not exists (select 1 from pg_proc where proname ~ '^(_?plus_.*agent|plus_growth_dashboard|plus_list_attention_opportunities)'
                and prosrc ~ '(plus_convert_opportunity_to_request|plus_create_rebooking_request|log_transportation_request)')
    and not exists (select 1 from public._plus_agent_candidates(c_a, null) c join public.plus_opportunities o on o.id = c.opportunity_id where o.stage = 'converted')
    and not exists (select 1 from public.plus_agent_recommendations r join public.plus_opportunities o on o.id = r.opportunity_id
                    where o.stage = 'converted' and r.status = 'pending'));
  -- ============================================== X. NP-P2-S4-R1 review additions
  -- replay AFTER Core changed the Request's status: same Request, its CURRENT Core state, nothing written
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  perform public.decline_transportation_request(c_a, r1, 'outside_service_area', null);
  perform public.accept_transportation_request(c_a, r_rb);
  reset role;
  v_n := pg_temp.nreq();
  select count(*) into v_acts from public.plus_activities where organization_id = c_a;
  select count(*) into v_audit from public.audit_events where organization_id = c_a;
  select count(*) into v_events from public.request_events where request_id in (r1, r_rb);
  perform set_config('request.jwt.claim.sub', c_a1::text, true);
  set local role authenticated;
  select r.changed || ':' || r.request_id || ':' || r.request_state into v
  from public.plus_convert_opportunity_to_request(c_a, o1, now(), 'conv-o1-key-0001', 'self', 'x', 'y', 'no', null, null, null, null) r;
  select r.changed || ':' || r.request_id || ':' || r.request_state into v2
  from public.plus_create_rebooking_request(c_a, k2, 'rebook-k1-key-0001', 'self', 'x', 'y', 'no', 'phone', null, null, null, null) r;
  reset role;
  perform pg_temp.t('X1 a retry AFTER Core changed the Request (declined / accepted) returns the SAME Request with its CURRENT Core state; nothing new is written',
    v = 'false:' || r1 || ':declined' and v2 = 'false:' || r_rb || ':accepted' and pg_temp.nreq() = v_n
    and (select count(*) from public.plus_activities where organization_id = c_a) = v_acts
    and (select count(*) from public.audit_events where organization_id = c_a) = v_audit
    and (select count(*) from public.request_events where request_id in (r1, r_rb)) = v_events, v || ' ' || v2);
  -- (the rebooking replay above used the NEW contact k2: R6 moved that link to k2; the original key + its current contact)
  -- the conversion guard cannot be satisfied by an unrelated attribution of the same opportunity
  begin
    set constraints plus_opportunities_conversion_guard immediate;
    update public.plus_opportunities set stage = 'converted', converted_at = now(), closed_at = now() where id = o_linked;
    v := 'allowed';
  exception when sqlstate 'ZW004' then v := 'ZW004:' || sqlerrm;
  end;
  set constraints plus_opportunities_conversion_guard deferred;
  perform pg_temp.t('X2 the guard is exact: an opportunity with a MANUAL (linked_existing_request) attribution still cannot be set converted',
    v = 'ZW004:conversion_requires_request' and (select stage from public.plus_opportunities where id = o_linked) = 'qualified', v);
  v := '';
  begin
    insert into public.plus_request_attributions (request_id, organization_id, contact_id, opportunity_id, link_method, conversion_idempotency_key, linked_by)
    values (pg_temp.req(c_a, 'Conv cross-org probe'), c_a, k_b, o_b, 'converted_from_opportunity', 'cross-org-probe-01', c_a1);
    v := 'inserted';
  exception when foreign_key_violation then v := 'fk';
  end;
  perform pg_temp.t('X3 a conversion attribution can never join an Org A Request to an Org B opportunity / contact (composite FKs)', v = 'fk', v);
  perform pg_temp.t('X4 one conversion per opportunity at the database level (partial unique index), whatever the key',
    exists (select 1 from pg_indexes where indexname = 'plus_request_attributions_one_conversion_idx' and indexdef ~ 'UNIQUE.*\(opportunity_id\).*converted_from_opportunity'));

  perform pg_temp.t('G5 across the whole suite: no Passenger, Trip, assignment, recurring arrangement or acquisition snapshot was created', pg_temp.core_side() = v_side, pg_temp.core_side());
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from t_results;
select name, detail from t_results where not ok order by n;

rollback;
