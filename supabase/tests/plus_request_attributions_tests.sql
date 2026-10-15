-- Nemryn Plus -- request attribution tests (NP-P2-S3). ROLLBACK-ONLY (one transaction, rolled back).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_request_attributions_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261015130000_plus_request_attributions.sql. FICTIONAL seed fixtures only (Org A admin a1, dispatcher a2,
-- driver a3, inactive dispatcher a5; Org B admin b1; c1 admin in A + driver in B; d1 platform admin; e1 no membership).
-- Core Requests, contacts and opportunities are created here as owner-level fictional fixtures. Side effects are
-- evaluated into variables BEFORE assertions. Inside one transaction now() is constant: stale versions are simulated
-- with a different timestamp. Section Z (last) temporarily replaces a Plus helper INSIDE this transaction to simulate a
-- Plus user WITHOUT the Core request role; the rollback restores it.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table t_results (n serial, name text, ok boolean, detail text);

create function pg_temp.val_as(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute p_stmt into v; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return v;
end;
$$;
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
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, 'P2-S3 attribution test'
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
create function pg_temp.contact(p_org uuid, p_name text, p_creator uuid) returns uuid language sql as $$
  insert into public.plus_contacts (organization_id, display_name, email, contact_kind, created_by)
  values (p_org, p_name, lower(replace(p_name, ' ', '.')) || '@example.test', 'individual', p_creator) returning id;
$$;
create function pg_temp.opp(p_org uuid, p_contact uuid, p_title text, p_creator uuid) returns uuid language sql as $$
  insert into public.plus_opportunities (organization_id, title, primary_contact_id, source, created_by)
  values (p_org, p_title, p_contact, 'phone', p_creator) returning id;
$$;
-- a fictional Core Request (owner-level fixture)
create function pg_temp.req(p_org uuid, p_name text, p_state text) returns uuid language sql as $$
  insert into public.transportation_requests (organization_id, requester_name, requester_relationship, requester_phone,
    pickup_description, destination_description, return_trip_needed, state, source, service_type)
  values (p_org, p_name, 'self', '(404) 555-0199', 'Fictional pickup ' || p_name, 'Fictional clinic ' || p_name, 'no', p_state, 'phone', 'dialysis')
  returning id;
$$;
create function pg_temp.lnk(p_uid uuid, p_org uuid, p_req uuid, p_contact uuid, p_opp uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed || '':'' || coalesce(r.contact_id::text, ''-'') || '':'' || coalesce(r.opportunity_id::text, ''-'') from public.plus_link_request(%L::uuid, %L::uuid, %L::uuid, %L::uuid) r',
    p_org, p_req, p_contact, p_opp)), 'NULL');
$$;
create function pg_temp.fix(p_uid uuid, p_org uuid, p_req uuid, p_expected timestamptz, p_contact uuid, p_opp uuid, p_reason text) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed || '':'' || coalesce(r.contact_id::text, ''-'') || '':'' || coalesce(r.opportunity_id::text, ''-'') from public.plus_update_request_attribution(%L::uuid, %L::uuid, %L::timestamptz, %L::uuid, %L::uuid, %L) r',
    p_org, p_req, p_expected, p_contact, p_opp, p_reason)), 'NULL');
$$;
create function pg_temp.getattr(p_uid uuid, p_org uuid, p_req uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select coalesce(string_agg(coalesce(contact_name, ''-'') || ''|'' || coalesce(opportunity_title, ''-'') || ''|'' || link_method, '',''), ''none'') from public.plus_get_request_attribution(%L::uuid, %L::uuid)',
    p_org, p_req)), 'NULL');
$$;
create function pg_temp.lstattr(p_uid uuid, p_org uuid, p_contact uuid, p_opp uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select count(*)::text from public.plus_list_request_attributions(%L::uuid, %L::uuid, %L::uuid, 100, 0)', p_org, p_contact, p_opp)), 'NULL');
$$;
create function pg_temp.summ(p_uid uuid, p_org uuid, p_ids uuid[]) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select coalesce(string_agg(state || ''/'' || coalesce(decision_reason_code, ''-'') || ''/'' || trips_total || ''/'' || passenger_linked, '','' order by state), ''none'') from public.plus_get_request_summaries(%L::uuid, %L::uuid[])',
    p_org, p_ids)), 'NULL');
$$;
create function pg_temp.rls(p_uid uuid, p_org uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format('select count(*)::text from public.plus_request_attributions where organization_id = %L', p_org)), 'NULL');
$$;
create function pg_temp.upo(p_uid uuid, p_org uuid, p_opp uuid, p_contact uuid, p_title text, p_expected timestamptz default null)
returns text language plpgsql as $$
declare v text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  begin
    select 'changed=' || r.changed into v from public.plus_update_opportunity(p_org, p_opp,
      coalesce(p_expected, (select updated_at from public.plus_opportunities where id = p_opp)), p_contact, p_title, 'quote', null, 'phone',
      null, null, null, 'none', null) r;
  exception when others then v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end;
$$;
create function pg_temp.ver(p_req uuid) returns timestamptz language sql as $$ select updated_at from public.plus_request_attributions where request_id = p_req; $$;
-- a fingerprint of every Core table P2-S3 must never change (request rows incl. state and updated_at, events, acquisition,
-- passengers, trips, assignments, recurring care)
create function pg_temp.core_fp() returns text language sql as $$
  select md5(coalesce((select string_agg(id::text || state || updated_at::text || coalesce(passenger_id::text, ''), ',' order by id) from public.transportation_requests), ''))
    || '/' || (select count(*) from public.request_events) || '/' || (select count(*) from public.request_acquisition_attributions)
    || '/' || (select count(*) from public.passengers) || '/' || (select count(*) from public.trips) || '/' || (select count(*) from public.trip_assignments)
    || '/' || (select count(*) from public.recurring_arrangements);
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
  v text; v2 text; v3 text; v_fp text; v_n bigint; v_m bigint; v_ts timestamptz; v_ok boolean;
  k1 uuid; k2 uuid; k3 uuid; k_arch uuid; k_b uuid;
  p1 uuid; p2 uuid; p3 uuid; p_b uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r_dec uuid; r_acc uuid; r_can uuid; r_free uuid; r_b uuid;
  v_req_before text;
begin
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_state(c_b, 'active');
  k1 := pg_temp.contact(c_a, 'Attrib Pat Fictional', c_a1);
  k2 := pg_temp.contact(c_a, 'Attrib Sam Fictional', c_a1);
  k3 := pg_temp.contact(c_a, 'Attrib Lee Fictional', c_a1);
  k_arch := pg_temp.contact(c_a, 'Attrib Archived Fictional', c_a1);
  update public.plus_contacts set status = 'archived' where id = k_arch;
  k_b := pg_temp.contact(c_b, 'Attrib In B Fictional', c_b1);
  p1 := pg_temp.opp(c_a, k1, 'Attrib weekly rides', c_a1);
  p2 := pg_temp.opp(c_a, k2, 'Attrib clinic rides', c_a1);
  p3 := pg_temp.opp(c_a, k3, 'Attrib rehab rides', c_a1);
  p_b := pg_temp.opp(c_b, k_b, 'Attrib B rides', c_b1);
  r1 := pg_temp.req(c_a, 'AttribReq One', 'pending');
  r2 := pg_temp.req(c_a, 'AttribReq Two', 'pending');
  r3 := pg_temp.req(c_a, 'AttribReq Three', 'pending');
  r4 := pg_temp.req(c_a, 'AttribReq Four', 'pending');
  r5 := pg_temp.req(c_a, 'AttribReq Five', 'pending');
  r_dec := pg_temp.req(c_a, 'AttribReq Declined', 'declined');
  insert into public.request_events (organization_id, request_id, event_type, actor_user_id, reason_code)
  values (c_a, r_dec, 'request_declined', c_a1, 'outside_service_area');
  r_acc := pg_temp.req(c_a, 'AttribReq Accepted', 'accepted');
  r_can := pg_temp.req(c_a, 'AttribReq Cancelled', 'cancelled');
  insert into public.request_events (organization_id, request_id, event_type, actor_user_id, reason_code)
  values (c_a, r_can, 'request_cancelled', c_a1, 'requester_cancelled');
  r_free := pg_temp.req(c_a, 'AttribReq Never Linked', 'pending');
  r_b := pg_temp.req(c_b, 'AttribReq In B', 'pending');
  v_fp := pg_temp.core_fp();

  -- ============================================== schema / privileges
  perform pg_temp.t('S1 RLS on; one SELECT policy TO authenticated = plus_can_read AND the transportation_requests read role; authenticated SELECT only',
    (select relrowsecurity from pg_class where oid = 'public.plus_request_attributions'::regclass)
    and (select count(*) from pg_policy where polrelid = 'public.plus_request_attributions'::regclass) = 1
    and exists (select 1 from pg_policy where polrelid = 'public.plus_request_attributions'::regclass and polcmd = 'r'
                and pg_get_expr(polqual, polrelid) ~ 'plus_can_read\(organization_id\)'
                and position((select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'transportation_requests_select_org_operations')
                             in pg_get_expr(polqual, polrelid)) > 0
                and polroles = array['authenticated'::regrole]::oid[])
    and (select string_agg(grantee || ':' || privilege_type, ',') from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'plus_request_attributions' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) = 'authenticated:SELECT');
  v := pg_temp.val_as('authenticated', c_a1, format('insert into public.plus_request_attributions (request_id, organization_id, contact_id, link_method, linked_by) values (%L, %L, %L, ''linked_existing_request'', %L) returning 1', r_free, c_a, k1, c_a1))
       || pg_temp.val_as('authenticated', c_a1, 'update public.plus_request_attributions set contact_id = null returning 1')
       || pg_temp.val_as('authenticated', c_a1, 'delete from public.plus_request_attributions returning 1')
       || pg_temp.val_as('anon', null, 'select count(*)::text from public.plus_request_attributions');
  perform pg_temp.t('S2 direct INSERT / UPDATE / DELETE as an entitled Admin, and anon SELECT -> 42501', v = 'ERR:42501ERR:42501ERR:42501ERR:42501', v);
  perform pg_temp.t('S3 canonical columns only: no referral_account_id (P3), no JSON; plus_accounts still absent',
    (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'plus_request_attributions')
    = 'request_id,organization_id,contact_id,opportunity_id,link_method,conversion_idempotency_key,linked_by,linked_at,updated_at'
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plus_request_attributions' and data_type in ('json', 'jsonb'))
    and to_regclass('public.plus_accounts') is null);
  perform pg_temp.t('S4 request_id is the PRIMARY KEY; composite FKs to transportation_requests / plus_contacts / plus_opportunities; named checks',
    exists (select 1 from pg_constraint where conrelid = 'public.plus_request_attributions'::regclass and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (request_id)')
    and exists (select 1 from pg_constraint where conname = 'plus_request_attributions_request_fkey'
                and pg_get_constraintdef(oid) = 'FOREIGN KEY (request_id, organization_id) REFERENCES transportation_requests(id, organization_id)')
    and exists (select 1 from pg_constraint where conname = 'plus_request_attributions_contact_fkey'
                and pg_get_constraintdef(oid) = 'FOREIGN KEY (contact_id, organization_id) REFERENCES plus_contacts(id, organization_id)')
    and exists (select 1 from pg_constraint where conname = 'plus_request_attributions_opportunity_fkey'
                and pg_get_constraintdef(oid) = 'FOREIGN KEY (opportunity_id, organization_id) REFERENCES plus_opportunities(id, organization_id)')
    and (select count(*) from pg_constraint where conrelid = 'public.plus_request_attributions'::regclass
         and conname in ('plus_request_attributions_subject_check', 'plus_request_attributions_link_method_check', 'plus_request_attributions_idempotency_check')) = 3
    and (select bool_and(confrelid::regclass::text in ('organizations', 'public.organizations', 'auth.users', 'plus_contacts', 'public.plus_contacts',
                                                       'plus_opportunities', 'public.plus_opportunities', 'transportation_requests', 'public.transportation_requests'))
         from pg_constraint where contype = 'f' and conrelid = 'public.plus_request_attributions'::regclass));
  begin
    insert into public.plus_request_attributions (request_id, organization_id, link_method, linked_by) values (r_free, c_a, 'linked_existing_request', c_a1);
    v := 'inserted';
  exception when check_violation then v := 'check';
  end;
  perform pg_temp.t('S5 at least one dimension (subject check): neither refused', v = 'check', v);
  v := '';
  begin insert into public.plus_request_attributions (request_id, organization_id, contact_id, link_method, linked_by) values (r_b, c_a, k1, 'linked_existing_request', c_a1); v := v || 'x';
  exception when foreign_key_violation then v := v || 'fk'; end;
  begin insert into public.plus_request_attributions (request_id, organization_id, contact_id, link_method, linked_by) values (r_free, c_a, k_b, 'linked_existing_request', c_a1); v := v || 'x';
  exception when foreign_key_violation then v := v || 'fk'; end;
  begin insert into public.plus_request_attributions (request_id, organization_id, opportunity_id, link_method, linked_by) values (r_free, c_a, p_b, 'linked_existing_request', c_a1); v := v || 'x';
  exception when foreign_key_violation then v := v || 'fk'; end;
  perform pg_temp.t('S6 composite FKs: an Org A attribution can never point at an Org B Request, contact or opportunity', v = 'fkfkfk', v);
  v := '';
  begin insert into public.plus_request_attributions (request_id, organization_id, contact_id, link_method, conversion_idempotency_key, linked_by)
        values (r_free, c_a, k1, 'linked_existing_request', 'idem-key-123456', c_a1); v := v || 'x';
  exception when check_violation then v := v || 'ck'; end;
  begin insert into public.plus_request_attributions (request_id, organization_id, contact_id, link_method, linked_by) values (r_free, c_a, k1, 'booked', c_a1); v := v || 'x';
  exception when check_violation then v := v || 'ck'; end;
  perform pg_temp.t('S7 link_method closed set (conversion / rebooking reserved); an idempotency key only for conversion / rebooking', v = 'ckck', v);
  perform pg_temp.t('S8 RPCs authenticated-only; internals have no client EXECUTE; SECURITY DEFINER + pinned search_path',
    (select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE'))
       from pg_proc p where p.proname in ('plus_link_request', 'plus_update_request_attribution', 'plus_get_request_attribution',
                                          'plus_list_request_attributions', 'plus_get_request_summaries'))
    and (select bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                         and not has_function_privilege('service_role', p.oid, 'EXECUTE'))
       from pg_proc p where p.proname in ('_plus_require_core_request_read', '_plus_resolve_attribution'))
    and (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'])
       from pg_proc p where p.proname in ('plus_link_request', 'plus_update_request_attribution', 'plus_get_request_attribution', 'plus_list_request_attributions',
                                          'plus_get_request_summaries', '_plus_require_core_request_read', '_plus_resolve_attribution')));
  perform pg_temp.t('S9 activities: request_id composite FK; subject widened to (contact, opportunity, request); request_linked / attribution_changed; reason required',
    exists (select 1 from pg_constraint where conname = 'plus_activities_request_fkey'
            and pg_get_constraintdef(oid) = 'FOREIGN KEY (request_id, organization_id) REFERENCES transportation_requests(id, organization_id)')
    and exists (select 1 from pg_constraint where conname = 'plus_activities_subject_check' and pg_get_constraintdef(oid) ~ 'num_nonnulls\(contact_id, opportunity_id, request_id\) >= 1')
    and exists (select 1 from pg_constraint where conname = 'plus_activities_activity_type_check' and pg_get_constraintdef(oid) ~ 'request_linked' and pg_get_constraintdef(oid) ~ 'attribution_changed')
    and exists (select 1 from pg_constraint where conname = 'plus_activities_request_subject_check')
    and exists (select 1 from pg_constraint where conname = 'plus_activities_body_required_check' and pg_get_constraintdef(oid) ~ 'attribution_changed'));

  -- ============================================== link
  v := pg_temp.lnk(c_a1, c_a, r1, k1, null);
  perform pg_temp.t('L1 Admin links an existing Request to a contact: linked_existing_request, no idempotency key, linked_by = caller',
    v = 'changed=true:' || k1 || ':-'
    and (select link_method = 'linked_existing_request' and conversion_idempotency_key is null and linked_by = c_a1 and contact_id = k1 and opportunity_id is null
         from public.plus_request_attributions where request_id = r1), v);
  perform pg_temp.t('L2 one request_linked activity (request + contact, no body) and an audit row with ids only',
    (select count(*) from public.plus_activities where request_id = r1) = 1
    and (select activity_type = 'request_linked' and contact_id = k1 and opportunity_id is null and body is null and actor_user_id = c_a1
         from public.plus_activities where request_id = r1)
    and (select count(*) from public.audit_events where entity_id = r1 and action = 'plus_request_linked') = 1
    and (select after_data = jsonb_build_object('contact_id', k1, 'opportunity_id', null, 'link_method', 'linked_existing_request')
         from public.audit_events where entity_id = r1 and action = 'plus_request_linked'));
  v := pg_temp.lnk(c_a1, c_a, r1, k1, null);
  perform pg_temp.t('L3 the same link again -> changed=false, no second row or activity',
    v = 'changed=false:' || k1 || ':-' and (select count(*) from public.plus_activities where request_id = r1) = 1, v);
  v := pg_temp.lnk(c_a1, c_a, r1, k2, null);
  perform pg_temp.t('L4 a Request already attributed differently -> ZW004 (use the correction workflow); row unchanged',
    v = 'ERR:ZW004' and (select contact_id from public.plus_request_attributions where request_id = r1) = k1, v);
  v := pg_temp.lnk(c_a1, c_a, r2, null, p1);
  perform pg_temp.t('L5 opportunity only: the contact dimension is the opportunity''s primary contact', v = 'changed=true:' || k1 || ':' || p1, v);
  v := pg_temp.lnk(c_a1, c_a, r3, k2, p2);
  v2 := pg_temp.lnk(c_a1, c_a, r4, k1, p2);
  perform pg_temp.t('L6 opportunity + its own contact ok; opportunity + a DIFFERENT contact -> ZW006 (inconsistent pair)',
    v = 'changed=true:' || k2 || ':' || p2 and v2 = 'ERR:ZW006' and not exists (select 1 from public.plus_request_attributions where request_id = r4), v || ' ' || v2);
  v := pg_temp.lnk(c_a1, c_a, r4, k_arch, null) || pg_temp.lnk(c_a1, c_a, r4, null, null);
  perform pg_temp.t('L7 archived contact -> ZW006; no dimension -> ZW006', v = 'ERR:ZW006ERR:ZW006', v);
  v := pg_temp.lnk(c_a1, c_a, gen_random_uuid(), k1, null) || pg_temp.lnk(c_a1, c_a, r_b, k1, null);
  perform pg_temp.t('L8 unknown Request and an Org B Request (cross-tenant Core lookup) -> ZW002, indistinguishable', v = 'ERR:ZW002ERR:ZW002', v);
  v := pg_temp.lnk(c_a1, c_a, r4, k_b, null) || pg_temp.lnk(c_a1, c_a, r4, null, p_b) || pg_temp.lnk(c_a1, c_a, r4, gen_random_uuid(), null);
  perform pg_temp.t('L9 valid Org A Request with an Org B / unknown contact or Org B opportunity -> ZW002 (mixed-tenant injection)',
    v = 'ERR:ZW002ERR:ZW002ERR:ZW002' and not exists (select 1 from public.plus_request_attributions where request_id = r4), v);
  v := pg_temp.lnk(c_a1, c_b, r_b, k_b, null) || pg_temp.lnk(c_a1, c_b, r1, k1, null);
  perform pg_temp.t('L10 a caller cannot act under another organization id (browser-supplied org is never trusted)', v = 'ERR:ZW002ERR:ZW002', v);
  v_req_before := (select string_agg(id::text || state || updated_at::text, ',' order by id) from public.transportation_requests where id in (r_dec, r_acc, r_can));
  v := pg_temp.lnk(c_a1, c_a, r_dec, k3, null) || pg_temp.lnk(c_a1, c_a, r_acc, null, p3) || pg_temp.lnk(c_a1, c_a, r_can, k3, null);
  perform pg_temp.t('L11 Requests in any Core state (declined / accepted / cancelled) can be linked; their state and version are untouched',
    v ~ '^changed=true.*changed=true.*changed=true' and v_req_before = (select string_agg(id::text || state || updated_at::text, ',' order by id)
                                                                         from public.transportation_requests where id in (r_dec, r_acc, r_can)), v);
  perform pg_temp.t('L12 linking never changes the opportunity stage (no automatic conversion)',
    (select bool_and(stage = 'new_inquiry') from public.plus_opportunities where id in (p1, p2, p3)));

  -- ============================================== correction
  v := pg_temp.fix(c_a1, c_a, r1, pg_temp.ver(r1), k2, null, '  ') || pg_temp.fix(c_a1, c_a, r1, pg_temp.ver(r1), k2, null, 'no')
       || pg_temp.fix(c_a1, c_a, r1, pg_temp.ver(r1), k2, null, repeat('x', 501));
  perform pg_temp.t('U1 a correction reason is required (3-500) -> ZW006', v = 'ERR:ZW006ERR:ZW006ERR:ZW006', v);
  v := pg_temp.fix(c_a1, c_a, r1, pg_temp.ver(r1) - interval '1 second', k2, null, 'Wrong person picked');
  perform pg_temp.t('U2 stale version -> ZW003, nothing changed', v = 'ERR:ZW003' and (select contact_id from public.plus_request_attributions where request_id = r1) = k1, v);
  v_ts := pg_temp.ver(r1);
  v_n := (select count(*) from public.plus_activities where request_id = r1);
  v := pg_temp.fix(c_a1, c_a, r1, v_ts, k1, null, 'Same as before');
  perform pg_temp.t('U3 identical dimensions -> changed=false, no history entry, version unchanged',
    v = 'changed=false:' || k1 || ':-' and (select count(*) from public.plus_activities where request_id = r1) = v_n and pg_temp.ver(r1) = v_ts, v);
  v_ts := pg_temp.ver(r1);
  v := pg_temp.fix(c_a1, c_a, r1, v_ts, k2, null, 'Booked for Sam, not Pat');
  perform pg_temp.t('U4 contact corrected: row updated; link_method / linked_by / linked_at never change',
    v = 'changed=true:' || k2 || ':-'
    and (select contact_id = k2 and link_method = 'linked_existing_request' and linked_by = c_a1 and conversion_idempotency_key is null
         from public.plus_request_attributions where request_id = r1), v);
  perform pg_temp.t('U5 truthful history: attribution_changed on the NEW contact and on the contact it moved away from (reason as body); audit old / new ids',
    (select count(*) from public.plus_activities where request_id = r1 and activity_type = 'attribution_changed' and body = 'Booked for Sam, not Pat') = 2
    and exists (select 1 from public.plus_activities where request_id = r1 and activity_type = 'attribution_changed' and contact_id = k2)
    and exists (select 1 from public.plus_activities where request_id = r1 and activity_type = 'attribution_changed' and contact_id = k1)
    and (select before_data = jsonb_build_object('contact_id', k1, 'opportunity_id', null) and after_data = jsonb_build_object('contact_id', k2, 'opportunity_id', null)
         from public.audit_events where entity_id = r1 and action = 'plus_request_attribution_changed'));
  v := pg_temp.fix(c_a1, c_a, r1, pg_temp.ver(r1), k1, p2, 'Wrong pair') || pg_temp.fix(c_a1, c_a, r1, pg_temp.ver(r1), null, p_b, 'Foreign')
       || pg_temp.fix(c_a1, c_a, r1, pg_temp.ver(r1), k_b, null, 'Foreign') || pg_temp.fix(c_a1, c_a, r1, pg_temp.ver(r1), k_arch, null, 'Archived')
       || pg_temp.fix(c_a1, c_a, r1, pg_temp.ver(r1), null, null, 'Nothing');
  perform pg_temp.t('U6 correction keeps consistency: mismatched pair ZW006; foreign opportunity / contact ZW002; archived contact ZW006; no dimension ZW006',
    v = 'ERR:ZW006ERR:ZW002ERR:ZW002ERR:ZW006ERR:ZW006', v);
  v := pg_temp.fix(c_a1, c_a, r1, pg_temp.ver(r1), null, p2, 'Linked to the clinic opportunity');
  perform pg_temp.t('U7 corrected to an opportunity: its primary contact is used; unchanged contact gets ONE row (not a second "moved away" row)',
    v = 'changed=true:' || k2 || ':' || p2
    and (select count(*) from public.plus_activities where request_id = r1 and body = 'Linked to the clinic opportunity') = 1, v);
  v := pg_temp.fix(c_a1, c_a, r_free, now(), k1, null, 'Not attributed') || pg_temp.fix(c_a1, c_a, gen_random_uuid(), now(), k1, null, 'Unknown')
       || pg_temp.fix(c_a1, c_a, r_b, now(), k1, null, 'Foreign');
  perform pg_temp.t('U8 unattributed / unknown / Org B Request -> ZW002', v = 'ERR:ZW002ERR:ZW002ERR:ZW002', v);
  -- an unchanged archived contact may stay (history) while the opportunity dimension is removed
  perform pg_temp.lnk(c_a1, c_a, r5, null, p3);
  update public.plus_contacts set status = 'archived' where id = k3;
  v := pg_temp.fix(c_a1, c_a, r5, pg_temp.ver(r5), k3, null, 'Opportunity was a duplicate');
  perform pg_temp.t('U9 an unchanged ARCHIVED contact may stay on a correction (history), the removed opportunity gets its own row',
    v = 'changed=true:' || k3 || ':-' and exists (select 1 from public.plus_activities where request_id = r5 and activity_type = 'attribution_changed'
                                                   and opportunity_id = p3 and contact_id is null), v);
  update public.plus_contacts set status = 'active' where id = k3;
  perform pg_temp.t('U10 corrections never delete rows', (select count(*) from public.plus_request_attributions where organization_id = c_a) = 7);

  -- ============================================== reads
  v := pg_temp.getattr(c_a1, c_a, r1) || ' ' || pg_temp.getattr(c_a1, c_a, r_free) || ' ' || pg_temp.getattr(c_a1, c_a, r_b) || ' ' || pg_temp.getattr(c_a1, c_a, gen_random_uuid());
  perform pg_temp.t('R1 get attribution: names + method for an attributed Request; none for an unattributed one; Org B / unknown -> ZW002',
    v = 'Attrib Sam Fictional|Attrib clinic rides|linked_existing_request none ERR:ZW002 ERR:ZW002', v);
  v := pg_temp.lstattr(c_a1, c_a, k2, null) || '/' || pg_temp.lstattr(c_a1, c_a, null, p2) || '/' || pg_temp.lstattr(c_a1, c_a, k2, p2)
       || '/' || pg_temp.lstattr(c_a1, c_a, null, null) || '/' || pg_temp.lstattr(c_a1, c_a, k_b, null) || '/' || pg_temp.lstattr(c_a1, c_a, null, p_b);
  perform pg_temp.t('R2 list by contact / by opportunity; both or neither ZW006; foreign subject ZW002', v = '2/2/ERR:ZW006/ERR:ZW006/ERR:ZW002/ERR:ZW002', v);
  v := pg_temp.summ(c_a1, c_a, array[r_dec, r_acc, r_can, r_free, r_b, gen_random_uuid()]);
  perform pg_temp.t('R3 summaries: real Core state + decline / cancel reason CODE; unattributed / foreign / unknown ids omitted (no oracle)',
    v = 'accepted/-/0/false,cancelled/requester_cancelled/0/false,declined/outside_service_area/0/false', v);
  perform pg_temp.t('R4 summaries expose ONLY allow-listed facts (never phone, email, pickup / destination text, notes, passenger fields)',
    (select string_agg(a, ',' order by o) from unnest(
       (select proargnames from pg_proc where proname = 'plus_get_request_summaries'),
       (select proargmodes from pg_proc where proname = 'plus_get_request_summaries')) with ordinality x(a, m, o) where m = 't')
    = 'request_id,state,source,service_type,created_at,preferred_date,passenger_linked,decision_reason_code,trips_total,trips_completed,trips_cancelled,first_completed_at,arrangement_count,arrangement_status'
    and (select prosrc !~* '(requester_phone|requester_email|pickup_description|destination_description|assistance_notes|additional_notes|instructions|trip_notes|reason_note)'
         from pg_proc where proname = 'plus_get_request_summaries'));
  update public.transportation_requests set state = 'accepted' where id = r1;
  v := pg_temp.summ(c_a1, c_a, array[r1]);
  perform pg_temp.t('R5 status is derived LIVE from Core (no copy, no sync trigger): a Core change shows immediately; attribution untouched',
    v like 'accepted/%' and (select contact_id = k2 and opportunity_id = p2 from public.plus_request_attributions where request_id = r1)
    and not exists (select 1 from pg_trigger t where t.tgrelid = 'public.transportation_requests'::regclass and not t.tgisinternal
                    and pg_get_triggerdef(t.oid) ~ 'plus_'), v);
  update public.transportation_requests set state = 'pending' where id = r1;
  v := pg_temp.summ(c_a1, c_a, array[]::uuid[]) || pg_temp.summ(c_a1, c_a, (select array_agg(gen_random_uuid()) from generate_series(1, 201)));
  perform pg_temp.t('R6 summaries: 1-200 ids (ZW006 otherwise)', v = 'ERR:ZW006ERR:ZW006', v);
  v := pg_temp.val_as('authenticated', c_a1, format('select count(*)::text from public.plus_list_contact_activities(%L::uuid, %L::uuid, 100, 0) where activity_type in (''request_linked'', ''attribution_changed'')', c_a, k2))
       || '/' || pg_temp.val_as('authenticated', c_a1, format('select count(*)::text from public.plus_list_opportunity_activities(%L::uuid, %L::uuid, 100, 0) where activity_type = ''request_linked''', c_a, p1));
  perform pg_temp.t('R7 the request history appears on the existing contact / opportunity timelines', v = '3/1', v);

  -- ============================================== activity integrity
  v := pg_temp.val_as('authenticated', c_a1, 'update public.plus_activities set body = ''x'' where activity_type = ''request_linked'' returning 1')
       || pg_temp.val_as('authenticated', c_a1, 'delete from public.plus_activities where activity_type = ''request_linked'' returning 1');
  perform pg_temp.t('A1 append-only: no client update / delete; no Plus function updates or deletes plus_activities', v = 'ERR:42501ERR:42501'
    and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                    and p.prosrc ~* '(update\s+(public\.)?plus_activities|delete\s+from\s+(public\.)?plus_activities)'), v);
  perform pg_temp.t('A2 data minimization: request history never copies Core text (request_linked body NULL; correction body = the staff reason only)',
    (select bool_and(body is null) from public.plus_activities where activity_type = 'request_linked')
    and not exists (select 1 from public.plus_activities a join public.transportation_requests r on r.id = a.request_id
                    where a.body is not null and (a.body ~ r.pickup_description or a.body ~ r.requester_phone or a.body ~ r.requester_name)));
  perform pg_temp.t('A3 audit rows carry ids only (no names, phone, email or address)',
    not exists (select 1 from public.audit_events where action in ('plus_request_linked', 'plus_request_attribution_changed')
                and (coalesce(after_data::text, '') ~* '(fictional|@|pickup|clinic|requester)' or coalesce(before_data::text, '') ~* '(fictional|@|pickup|clinic|requester)')));

  -- ============================================== permissions
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.getattr(c_a2, c_a, r1) || ' ' || pg_temp.lnk(c_a2, c_a, r4, k2, null);
  perform pg_temp.t('P1 WRITE-grant Dispatcher (holds the Core request role) can read and link', v = 'Attrib Sam Fictional|Attrib clinic rides|linked_existing_request changed=true:' || k2 || ':-', v);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v := pg_temp.getattr(c_a2, c_a, r1) || ' ' || pg_temp.lstattr(c_a2, c_a, k2, null) || ' ' || pg_temp.summ(c_a2, c_a, array[r_dec]) || ' ' || pg_temp.rls(c_a2, c_a);
  v2 := pg_temp.lnk(c_a2, c_a, r_free, k2, null) || pg_temp.fix(c_a2, c_a, r4, pg_temp.ver(r4), k1, null, 'Read grant tries');
  perform pg_temp.t('P2 READ-grant Dispatcher: get / list / summaries / RLS read; link and correction -> ZW001',
    v = 'Attrib Sam Fictional|Attrib clinic rides|linked_existing_request 3 declined/outside_service_area/0/false 8' and v2 = 'ERR:ZW001ERR:ZW001', v || ' | ' || v2);
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  v := pg_temp.getattr(c_a2, c_a, r1) || pg_temp.lnk(c_a2, c_a, r_free, k2, null) || pg_temp.summ(c_a2, c_a, array[r1]) || pg_temp.rls(c_a2, c_a);
  perform pg_temp.t('P3 revoked grant: ZW002 everywhere, RLS 0 rows', v = 'ERR:ZW002ERR:ZW002ERR:ZW0020', v);
  v := pg_temp.getattr(c_a5, c_a, r1) || pg_temp.rls(c_a5, c_a);
  perform pg_temp.t('P4 inactive Dispatcher: ZW002, RLS 0', v = 'ERR:ZW0020', v);
  v := pg_temp.getattr(c_a3, c_a, r1) || pg_temp.lnk(c_a3, c_a, r_free, k1, null) || pg_temp.rls(c_a3, c_a)
       || pg_temp.getattr(c_e1, c_a, r1) || pg_temp.rls(c_e1, c_a) || pg_temp.getattr(c_d1, c_a, r1) || pg_temp.rls(c_d1, c_a);
  perform pg_temp.t('P5 Driver, no-membership user, Platform Admin without membership: no access', v = 'ERR:ZW002ERR:ZW0020ERR:ZW0020ERR:ZW0020', v);
  v := pg_temp.val_as('authenticated', null, format('select count(*)::text from public.plus_get_request_attribution(%L::uuid, %L::uuid)', c_a, r1))
       || pg_temp.val_as('anon', null, format('select count(*)::text from public.plus_get_request_summaries(%L::uuid, array[%L::uuid])', c_a, r1));
  perform pg_temp.t('P6 no uid -> ZW001; anon -> 42501', v = 'ERR:ZW001ERR:42501', v);
  perform pg_temp.set_state(c_a, 'expired');
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.getattr(c_a1, c_a, r1) || ' ' || pg_temp.lnk(c_a1, c_a, r_free, k1, null) || pg_temp.fix(c_a1, c_a, r4, pg_temp.ver(r4), k1, null, 'Expired try')
       || ' ' || pg_temp.getattr(c_a2, c_a, r1);
  perform pg_temp.t('P7 expired Plus: Admin keeps read; link / correction ZW001; write-grant Dispatcher loses access (ZW002)',
    v = 'Attrib Sam Fictional|Attrib clinic rides|linked_existing_request ERR:ZW001ERR:ZW001 ERR:ZW002', v);
  perform pg_temp.set_state(c_a, 'locked');
  v := pg_temp.getattr(c_a1, c_a, r1) || pg_temp.rls(c_a1, c_a);
  perform pg_temp.t('P8 locked Plus: ZW002, RLS 0, rows retained', v = 'ERR:ZW0020' and (select count(*) from public.plus_request_attributions where organization_id = c_a) = 8, v);
  perform pg_temp.set_state(c_a, 'none');
  perform pg_temp.t('P9 no entitlement: ZW002', pg_temp.getattr(c_a1, c_a, r1) = 'ERR:ZW002');
  perform pg_temp.set_state(c_a, 'active');
  update public.organizations set status = 'inactive' where id = c_a;
  v := pg_temp.getattr(c_a1, c_a, r1) || pg_temp.lnk(c_a1, c_a, r_free, k1, null) || pg_temp.rls(c_a1, c_a);
  perform pg_temp.t('P10 suspended organization: ZW002, RLS 0', v = 'ERR:ZW002ERR:ZW0020', v);
  update public.organizations set status = 'active' where id = c_a;
  v := pg_temp.getattr(c_b1, c_a, r1) || pg_temp.lnk(c_b1, c_a, r_free, k1, null) || pg_temp.summ(c_b1, c_a, array[r1]) || pg_temp.rls(c_b1, c_a)
       || ' ' || pg_temp.summ(c_b1, c_b, array[r1, r_dec]) || ' ' || pg_temp.lnk(c_b1, c_b, r1, k_b, null);
  perform pg_temp.t('P11 cross-tenant: Org B Admin gets ZW002 / 0 rows for Org A; Org A ids under Org B are omitted or ZW002',
    v = 'ERR:ZW002ERR:ZW002ERR:ZW0020 none ERR:ZW002', v);
  v := pg_temp.getattr(c_c1, c_a, r1) || ' ' || pg_temp.getattr(c_c1, c_b, r_b);
  perform pg_temp.t('P12 multi-organization c1 (Admin in A, Driver in B): A yes, B never', v = 'Attrib Sam Fictional|Attrib clinic rides|linked_existing_request ERR:ZW002', v);

  -- ============================================== Growth Agent compatibility
  v := pg_temp.val_as('authenticated', c_a1, format('select (r).created::text from (select public.plus_run_growth_agent_review(%L::uuid) r) x', c_a));
  perform pg_temp.t('G1 the Growth Agent still runs; it never reads or writes attributions, Core Requests or request text',
    v ~ '^[0-9]+$'
    and not exists (select 1 from pg_proc where proname ~ '^(_?plus_.*agent|plus_growth_dashboard|plus_list_attention_opportunities)' and prosrc ~ '(plus_request_attributions|transportation_requests)'), v);
  perform pg_temp.t('G2 no attribution row was created by anything but plus_link_request (8 links), and no stage changed',
    (select count(*) from public.plus_request_attributions where organization_id = c_a) = 8
    and (select bool_and(stage = 'new_inquiry') from public.plus_opportunities where id in (p1, p2, p3)));

  -- ============================================== Core
  perform pg_temp.t('K1 no Core Request, request event, acquisition snapshot, Passenger, Trip, assignment or Recurring Care changed by P2-S3 (R5 restored)',
    pg_temp.core_fp() = v_fp);
  perform pg_temp.t('K2 no Core function or policy references plus_request_attributions; no Plus function writes Core tables',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                and p.proname !~ '^(plus_|_plus_|_require_plus_)' and p.prosrc ~ 'plus_request_attributions')
    and not exists (select 1 from pg_policy where polrelid::regclass::text !~ '^(public\.)?plus_' and coalesce(pg_get_expr(polqual, polrelid), '') ~ 'plus_')
    and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ~ '^(plus_|_plus_)'
      and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(transportation_requests|request_events|request_acquisition_attributions|passengers|trips|recurring_arrangements|trip_assignments)\M'));
  perform pg_temp.t('K3 no Plus function locks a Core row (FOR UPDATE / SHARE on Core tables)',
    not exists (select 1 from pg_proc p where p.proname ~ '^(plus_|_plus_)'
                and p.prosrc ~* 'from\s+(public\.)?transportation_requests[^;]*for\s+(update|no key update|share|key share)'));

  -- ============================================== C. conversion-key contract (NP-P2-S3-R1; schema readiness for P2-S4)
  -- Owner-level fixtures written directly (the RPCs never write these values); removed again after the section.
  v := '';
  for v_n in 1..5 loop
    r_free := pg_temp.req(c_a, 'AttribReq Key ' || v_n, 'pending');
    begin
      -- (NP-P2-S4: rebooking-shaped rows -- contact only -- since an opportunity is converted at most once)
      insert into public.plus_request_attributions (request_id, organization_id, contact_id, opportunity_id, link_method, conversion_idempotency_key, linked_by)
      values (r_free, c_a, k2, null, 'rebooking',
              case v_n when 1 then repeat('k', 7) when 2 then repeat('k', 8) when 3 then repeat('k', 200) when 4 then repeat('k', 201) else repeat('k', 8) end, c_a1);
      v := v || 'ok';
    exception when check_violation then v := v || 'ck'; when unique_violation then v := v || 'uq';
    end;
  end loop;
  r_free := pg_temp.req(c_b, 'AttribReq Key B', 'pending');
  begin
    insert into public.plus_request_attributions (request_id, organization_id, contact_id, link_method, conversion_idempotency_key, linked_by)
    values (r_free, c_b, k_b, 'rebooking', repeat('k', 8), c_b1);
    v := v || '/otherorg-ok';
  exception when unique_violation then v := v || '/otherorg-uq';
  end;
  perform pg_temp.t('C1 conversion key: 8-200 characters (Core intake convention), conversion / rebooking only, unique per organization (not across organizations)',
    v = 'ckokokckuq/otherorg-ok', v);
  delete from public.plus_request_attributions where conversion_idempotency_key is not null;
  perform pg_temp.t('C2 P2-S3 RPCs never produce a conversion or rebooking: only the NP-P2-S4 RPCs name those link methods (plus guards that compare them); every P2-S3 row is linked_existing_request without a key',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                and p.prosrc ~ '''(converted_from_opportunity|rebooking)'''
                and p.proname not in ('plus_convert_opportunity_to_request', 'plus_create_rebooking_request',
                                      'plus_update_request_attribution', '_plus_opportunity_conversion_guard'))
    and (select bool_and(link_method = 'linked_existing_request' and conversion_idempotency_key is null) from public.plus_request_attributions));
  perform pg_temp.t('C3 manual attribution never converts: only plus_convert_opportunity_to_request sets an opportunity stage to converted',
    not exists (select 1 from pg_proc p where p.proname ~ '^(plus_|_plus_)' and p.proname <> 'plus_convert_opportunity_to_request'
                and p.prosrc ~* 'set[^;]*stage\s*=\s*''converted''')
    and not exists (select 1 from public.plus_opportunities where stage = 'converted'));

  -- ============================================== B. opportunity contact consistency (NP-P2-S3-R2, owner-approved option B)
  -- p1 (primary contact k1) already has a linked Request (L5: r2). p3 (k3) is linked to r_acc (L11).
  v_fp := pg_temp.core_fp();
  v_ts := (select updated_at from public.plus_opportunities where id = p1);
  v_n := (select count(*) from public.audit_events where entity_id = p1 and action = 'plus_opportunity_updated');
  v := pg_temp.upo(c_a1, c_a, p1, k2, 'Attrib weekly rides');
  perform pg_temp.t('OB1 linked opportunity: a contact change is refused with ZW004 linked_requests; opportunity, attribution and audit untouched',
    v = 'ERR:ZW004:linked_requests'
    and (select primary_contact_id = k1 and updated_at = v_ts from public.plus_opportunities where id = p1)
    and (select contact_id = k1 and opportunity_id = p1 from public.plus_request_attributions where request_id = r2)
    and (select count(*) from public.audit_events where entity_id = p1 and action = 'plus_opportunity_updated') = v_n, v);
  v := pg_temp.upo(c_a1, c_a, p1, k1, 'Attrib weekly rides renamed');
  perform pg_temp.t('OB2 linked opportunity: every other field stays editable (contact unchanged)',
    v = 'changed=true' and (select title = 'Attrib weekly rides renamed' and primary_contact_id = k1 from public.plus_opportunities where id = p1), v);
  p_b := pg_temp.opp(c_a, k1, 'Unlinked OB3', c_a1);   -- (reuses the p_b variable: an Org A opportunity with no linked Request)
  v := pg_temp.upo(c_a1, c_a, p_b, k2, 'Unlinked OB3');
  perform pg_temp.t('OB3 an opportunity without linked Requests still changes contact normally',
    v = 'changed=true' and (select primary_contact_id from public.plus_opportunities where id = p_b) = k2, v);
  v := pg_temp.upo(c_a1, c_a, p1, k2, 'Attrib weekly rides renamed', now() - interval '1 day');
  perform pg_temp.t('OB4 stale version on a linked opportunity -> ZW003 (version check precedes the linked check)', v like 'ERR:ZW003:%', v);
  update public.plus_opportunities set stage = 'lost', lost_reason = 'price', closed_at = now() where id = p3;
  v := pg_temp.upo(c_a1, c_a, p3, k2, 'Attrib rehab rides');
  perform pg_temp.t('OB5 closed opportunity behaviour unchanged: ZW004 illegal_transition (not linked_requests)', v = 'ERR:ZW004:illegal_transition', v);
  update public.plus_opportunities set stage = 'new_inquiry', lost_reason = null, closed_at = null where id = p3;
  v := pg_temp.upo(c_b1, c_a, p1, k2, 'x') || ' ' || pg_temp.upo(c_a1, c_a, p1, k_b, 'Attrib weekly rides renamed')
       || ' ' || pg_temp.upo(c_a1, c_a, p_b, k_arch, 'Unlinked OB3');
  perform pg_temp.t('OB6 tenancy and same-organization rules unchanged: Org B caller ZW002; Org B contact ZW002; archived contact ZW006',
    v ~ '^ERR:ZW002:\S+ ERR:ZW002:\S+ ERR:ZW006:', v);
  -- the documented correction flow: correct each linked Request first, then change the contact, then re-link
  v := pg_temp.fix(c_a1, c_a, r2, pg_temp.ver(r2), k1, null, 'Opportunity belongs to Sam, not Pat')
       || ' ' || pg_temp.upo(c_a1, c_a, p1, k2, 'Attrib weekly rides renamed')
       || ' ' || pg_temp.fix(c_a1, c_a, r2, pg_temp.ver(r2), null, p1, 'Re-linked to the corrected opportunity');
  perform pg_temp.t('OB7 correction flow: unlink the Request (reason) -> change the contact -> re-link explicitly; the pair is consistent again',
    v = 'changed=true:' || k1 || ':- changed=true changed=true:' || k2 || ':' || p1
    and (select primary_contact_id from public.plus_opportunities where id = p1) = k2
    and (select contact_id = k2 and opportunity_id = p1 and link_method = 'linked_existing_request' from public.plus_request_attributions where request_id = r2), v);
  perform pg_temp.t('OB8 audit history is truthful: two explicit corrections with their reasons; the contact change audited once after the Request was unlinked',
    (select count(*) from public.plus_activities where request_id = r2 and activity_type = 'attribution_changed'
       and body in ('Opportunity belongs to Sam, not Pat', 'Re-linked to the corrected opportunity')) >= 2
    and (select count(*) from public.audit_events where entity_id = r2 and action = 'plus_request_attribution_changed') = 2
    and (select count(*) from public.audit_events where entity_id = p1 and action = 'plus_opportunity_updated'
         and after_data -> 'fields' ? 'contact') = 1);
  perform pg_temp.t('OB9 no Core Request, event, acquisition, Passenger, Trip, assignment or Recurring Care changed by any of it', pg_temp.core_fp() = v_fp);
  perform pg_temp.t('OB10 the replaced plus_update_opportunity keeps one overload, SECURITY DEFINER, pinned search_path, authenticated-only EXECUTE',
    (select count(*) from pg_proc where proname = 'plus_update_opportunity') = 1
    and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] and has_function_privilege('authenticated', oid, 'EXECUTE')
                and not has_function_privilege('anon', oid, 'EXECUTE') and not has_function_privilege('service_role', oid, 'EXECUTE')
         from pg_proc where proname = 'plus_update_opportunity'));

  -- ============================================== Z. Plus WITHOUT the Core request role (simulated; rolled back)
  -- No such person exists today (every Plus user is an Organization Admin or a granted Dispatcher, both of whom hold
  -- the Core request-read role). PD-18 would create one. Simulate it by making the Org A Driver a Plus WRITER for this
  -- transaction only, then prove the Core-role check alone refuses every request-scoped read and write.
  create or replace function public._plus_member_access(p_organization_id uuid) returns text
  language sql stable security definer set search_path = public, pg_temp
  as $f$ select case when auth.uid() = '20000000-0000-0000-0000-0000000000a3'::uuid then 'write' else 'none' end $f$;
  v_ok := pg_temp.val_as('authenticated', c_a3, format('select public.plus_can_read(%L::uuid)::text', c_a)) = 'true'
          and pg_temp.val_as('authenticated', c_a3, format('select public.plus_can_write(%L::uuid)::text', c_a)) = 'true';
  v := pg_temp.getattr(c_a3, c_a, r1) || pg_temp.lstattr(c_a3, c_a, k2, null) || pg_temp.summ(c_a3, c_a, array[r1]) || pg_temp.rls(c_a3, c_a)
       || pg_temp.lnk(c_a3, c_a, r_free, k1, null) || pg_temp.fix(c_a3, c_a, r1, pg_temp.ver(r1), k1, null, 'No core role');
  perform pg_temp.t('Z1 a Plus user WITHOUT the Core request role: every request read / write ZW002, RLS 0 rows (simulated, rolled back)',
    v_ok and v = 'ERR:ZW002ERR:ZW002ERR:ZW0020ERR:ZW002ERR:ZW002', v);
  -- FINDING for any future PD-18 design: plus_activities is readable with Plus alone, so request-HISTORY rows expose
  -- opaque request ids, the entry type and time, and staff correction reasons -- but never a Core Request fact.
  v := pg_temp.val_as('authenticated', c_a3, format('select count(*)::text from public.plus_activities where organization_id = %L and request_id is not null', c_a))
       || '/' || pg_temp.val_as('authenticated', c_a3, format('select count(*)::text from public.transportation_requests where organization_id = %L', c_a))
       || '/' || pg_temp.val_as('authenticated', c_a3, format('select count(*)::text from public.request_events where organization_id = %L', c_a));
  perform pg_temp.t('Z2 FINDING (PD-18 input): a Plus reader WITHOUT the Core role sees request-history activity rows (opaque ids) but 0 Core Requests / events',
    split_part(v, '/', 1)::int > 0 and split_part(v, '/', 2) = '0' and split_part(v, '/', 3) = '0', v);
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from t_results;
select name, detail from t_results where not ok order by n;

rollback;
