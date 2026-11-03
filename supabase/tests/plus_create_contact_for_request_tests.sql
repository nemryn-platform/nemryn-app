-- Nemryn Plus -- create a contact from a Core Request (NP-CORE-PLUS-REQUEST-02A). ROLLBACK-ONLY (one transaction).
--   docker exec -i supabase_db_NemrynS1Iso psql -U postgres -d postgres -f - < supabase/tests/plus_create_contact_for_request_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261102100000_plus_create_contact_for_request.sql. FICTIONAL seed fixtures only (Org A admin a1, dispatcher
-- a2, driver a3, inactive dispatcher a5; Org B admin b1; c1 admin in A + driver in B; d1 platform admin; e1 no
-- membership). Requests, contacts and opportunities are created here as owner-level fictional fixtures; names use
-- "Fictional", phones the 555-01xx range, emails example.test. Side effects are evaluated into variables BEFORE
-- assertions. Enablement is done through the Platform Admin RPC inside this transaction; the rollback removes it.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table t_results (n serial, name text, ok boolean, detail text);

-- runs p_stmt as p_role / p_uid; returns its single text value, or ERR:<sqlstate>:<message>
create function pg_temp.val_as(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute p_stmt into v; exception when others then reset role; return 'ERR:' || sqlstate || ':' || sqlerrm; end;
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
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, '02A request contact test'
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
create function pg_temp.contact(p_org uuid, p_name text, p_email text, p_phone text, p_creator uuid) returns uuid language sql as $$
  insert into public.plus_contacts (organization_id, display_name, email, phone, contact_kind, created_by)
  values (p_org, p_name, p_email, p_phone, 'individual', p_creator) returning id;
$$;
create function pg_temp.req(p_org uuid, p_name text, p_passenger uuid, p_passenger_name text) returns uuid language sql as $$
  insert into public.transportation_requests (organization_id, requester_name, requester_relationship, requester_phone, requester_email,
    pickup_description, destination_description, return_trip_needed, state, source, service_type, passenger_id, requested_passenger_name)
  values (p_org, p_name, 'family', '(404) 555-0142', 'requester.fictional@example.test', 'Fictional pickup ' || p_name,
          'Fictional clinic ' || p_name, 'no', 'pending', 'phone', 'dialysis', p_passenger, p_passenger_name)
  returning id;
$$;
-- the RPC under test; returns outcome:contact:possible_duplicates or ERR:<sqlstate>:<message>
create function pg_temp.cc(p_uid uuid, p_org uuid, p_req uuid, p_name text, p_phone text, p_email text,
                           p_kind text default 'family_caregiver', p_channel text default 'phone', p_dnc boolean default false,
                           p_owner uuid default null, p_confirm boolean default false) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.outcome || '':'' || coalesce(r.contact_id::text, ''-'') || '':'' || r.possible_duplicates from public.plus_create_contact_for_request(%L::uuid, %L::uuid, %L, %L, %L, %L, %L, %L::boolean, %L::uuid, %L::boolean) r',
    p_org, p_req, p_name, p_phone, p_email, p_kind, p_channel, p_dnc, p_owner, p_confirm)), 'NULL');
$$;
create function pg_temp.pset(p_uid uuid, p_org uuid, p_enabled boolean, p_class text, p_reason text) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.enabled || '':'' || coalesce(r.data_class, ''-'') || '':'' || r.changed from public.platform_set_plus_request_contact_enablement(%L::uuid, %L::boolean, %L, %L) r',
    p_org, p_enabled, p_class, p_reason)), 'NULL');
$$;
create function pg_temp.pget(p_uid uuid, p_org uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.enabled || '':'' || coalesce(r.data_class, ''-'') || '':'' || coalesce(r.reason, ''-'') from public.platform_get_plus_request_contact_enablement(%L::uuid) r', p_org)), 'NULL');
$$;
create function pg_temp.vis(p_role text, p_uid uuid, p_org uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as(p_role, p_uid, format('select public.plus_request_contact_enabled(%L::uuid)::text', p_org)), 'NULL');
$$;
-- every Plus write surface this feature could touch, per organization
create function pg_temp.plus_fp(p_org uuid) returns text language sql as $$
  select (select count(*) from public.plus_contacts where organization_id = p_org)
    || '/' || (select count(*) from public.plus_request_attributions where organization_id = p_org)
    || '/' || (select count(*) from public.plus_activities where organization_id = p_org)
    || '/' || (select count(*) from public.audit_events where organization_id = p_org)
    || '/' || (select count(*) from public.plus_opportunities where organization_id = p_org)
    || '/' || (select count(*) from public.plus_communication_consents where organization_id = p_org)
    || '/' || (select count(*) from public.plus_tasks where organization_id = p_org)
    || '/' || (select count(*) from public.plus_quotes where organization_id = p_org);
$$;
-- every Core table the feature must never change (Requests incl. state / updated_at / passenger, events, acquisition,
-- passengers, trips, assignments, recurring care, billing). ctid is included because now() is constant inside this one
-- transaction: any UPDATE -- even a no-op one -- writes a new row version with a new ctid.
create function pg_temp.core_fp() returns text language sql as $$
  select md5(coalesce((select string_agg(id::text || ctid::text || state || updated_at::text || coalesce(passenger_id::text, '') || requester_name
                                         || requester_phone || coalesce(requester_email, '') || coalesce(requested_passenger_name, ''), ',' order by id)
                       from public.transportation_requests), ''))
    || '/' || (select count(*) from public.request_events) || '/' || (select count(*) from public.request_acquisition_attributions)
    || '/' || md5(coalesce((select string_agg(id::text || ctid::text || updated_at::text, ',' order by id) from public.passengers), ''))
    || '/' || (select count(*) from public.trips) || '/' || (select count(*) from public.trip_assignments)
    || '/' || (select count(*) from public.recurring_arrangements)
    || '/' || (select count(*) from public.billing_invoices) || '/' || (select count(*) from public.billing_payments);
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
  c_pa constant uuid := '40000000-0000-0000-0000-0000000000a1';   -- seed Passenger in Org A
  v text; v2 text; v3 text; v_fa text; v_fb text; v_core text; v_n bigint; v_ok boolean; v_id uuid;
  k_dup uuid; k_arch uuid; k_linked uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r_pass uuid; r_linked uuid; r_b uuid; r_dnc uuid;
begin
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_state(c_b, 'active');
  k_dup := pg_temp.contact(c_a, 'Dup Pat Fictional', 'dup.pat@example.test', '(404) 555-0110', c_a1);
  k_arch := pg_temp.contact(c_a, 'Archived Ray Fictional', 'archived.ray@example.test', null, c_a1);
  update public.plus_contacts set status = 'archived' where id = k_arch;
  k_linked := pg_temp.contact(c_a, 'Already Linked Fictional', 'already.linked@example.test', null, c_a1);
  r1 := pg_temp.req(c_a, 'ReqContact One Fictional', null, null);
  r2 := pg_temp.req(c_a, 'ReqContact Two Fictional', null, null);
  r3 := pg_temp.req(c_a, 'ReqContact Three Fictional', null, null);
  r4 := pg_temp.req(c_a, 'ReqContact Four Fictional', null, null);
  r5 := pg_temp.req(c_a, 'ReqContact Five Fictional', null, null);
  r6 := pg_temp.req(c_a, 'ReqContact Six Fictional', null, null);
  r7 := pg_temp.req(c_a, 'ReqContact Seven Fictional', null, null);
  r_dnc := pg_temp.req(c_a, 'ReqContact Dnc Fictional', null, null);
  r_pass := pg_temp.req(c_a, 'ReqContact Requester Ann Fictional', c_pa, 'Passenger Zed Fictional');
  r_linked := pg_temp.req(c_a, 'ReqContact Linked Fictional', null, null);
  insert into public.plus_request_attributions (request_id, organization_id, contact_id, link_method, linked_by)
  values (r_linked, c_a, k_linked, 'linked_existing_request', c_a1);
  r_b := pg_temp.req(c_b, 'ReqContact In B Fictional', null, null);
  v_core := pg_temp.core_fp();

  -- ============================================== S. schema / privileges
  perform pg_temp.t('S1 enablement table is class A: RLS on, no policy, no privilege for anon / authenticated / service_role / PUBLIC',
    (select relrowsecurity from pg_class where oid = 'public.plus_request_contact_enablements'::regclass)
    and (select count(*) from pg_policy where polrelid = 'public.plus_request_contact_enablements'::regclass) = 0
    and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'plus_request_contact_enablements'
                    and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')));
  v := pg_temp.val_as('authenticated', c_a1, 'select count(*)::text from public.plus_request_contact_enablements')
       || '|' || pg_temp.val_as('authenticated', c_d1, format('insert into public.plus_request_contact_enablements (organization_id, data_class, reason, enabled_by) values (%L, ''synthetic'', ''x'', %L) returning 1', c_a, c_d1))
       || '|' || pg_temp.val_as('anon', null, 'select count(*)::text from public.plus_request_contact_enablements');
  perform pg_temp.t('S2 direct SELECT / INSERT on the enablement table (Org Admin, Platform Admin, anon) -> 42501', v ~ '^ERR:42501:[^|]*\|ERR:42501:[^|]*\|ERR:42501:', v);
  perform pg_temp.t('S3 the migration enables NO organization (table empty after migration + seed)',
    (select count(*) from public.plus_request_contact_enablements) = 0);
  perform pg_temp.t('S4 four new functions: one overload each, SECURITY DEFINER, pinned search_path, EXECUTE authenticated only',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
       ('plus_create_contact_for_request', 'platform_set_plus_request_contact_enablement', 'platform_get_plus_request_contact_enablement', 'plus_request_contact_enabled')
       and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
       and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('service_role', p.oid, 'EXECUTE')) = 4
    and (select count(*) from pg_proc where proname in ('plus_create_contact_for_request', 'platform_set_plus_request_contact_enablement',
         'platform_get_plus_request_contact_enablement', 'plus_request_contact_enabled')) = 4);
  perform pg_temp.t('S5 the create function never names a requester or passenger column (boundary: values come from staff only)',
    (select prosrc !~* '(requester_(name|phone|email|relationship|user_id)|passenger_id|requested_passenger_name|public\.passengers)'
       from pg_proc where proname = 'plus_create_contact_for_request')
    and (select prosrc ~ 'plus_create_contact\(' and prosrc ~ 'plus_link_request\(' from pg_proc where proname = 'plus_create_contact_for_request'));
  begin
    insert into public.plus_request_contact_enablements (organization_id, data_class, reason, enabled_by) values (c_b, 'live', 'owner insert', c_d1);
    v := 'inserted';
  exception when check_violation then v := 'check_violation';
  end;
  perform pg_temp.t('S6 data_class CHECK refuses ''live'' even for a direct owner INSERT', v = 'check_violation', v);
  perform pg_temp.t('S7 released signatures unchanged: plus_create_contact / plus_link_request keep one overload each',
    (select count(*) from pg_proc where proname = 'plus_create_contact') = 1 and (select count(*) from pg_proc where proname = 'plus_link_request') = 1
    and (select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'plus_create_contact')
        = 'p_organization_id uuid, p_display_name text, p_phone text, p_email text, p_contact_kind text, p_job_title text, p_preferred_channel text, p_do_not_contact boolean, p_owner_membership_id uuid, p_confirm_possible_duplicate boolean'
    and (select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'plus_link_request')
        = 'p_organization_id uuid, p_request_id uuid, p_contact_id uuid, p_opportunity_id uuid');

  -- ============================================== G. activation guard (Org A NOT enabled yet)
  v_fa := pg_temp.plus_fp(c_a);
  v := pg_temp.cc(c_a1, c_a, r1, 'Guard Ann Fictional', '(404) 555-0120', 'guard.ann@example.test');
  perform pg_temp.t('G1 disabled organization: an Admin with Plus write gets ZW004 request_contact_not_enabled; nothing written',
    v = 'ERR:ZW004:request_contact_not_enabled' and pg_temp.plus_fp(c_a) = v_fa, v);
  v := pg_temp.cc(c_a1, c_a, gen_random_uuid(), 'Guard Ann Fictional', '(404) 555-0120', null)
       || '|' || pg_temp.cc(c_a1, c_a, r1, 'Dup Pat Fictional', null, 'dup.pat@example.test');
  perform pg_temp.t('G2 disabled: the gate precedes request existence and duplicate checks (no oracle) -> both ZW004',
    v = 'ERR:ZW004:request_contact_not_enabled|ERR:ZW004:request_contact_not_enabled', v);
  v := pg_temp.pset(c_a1, c_a, true, 'synthetic', 'self enable') || '|' || pg_temp.pset(c_b1, c_a, true, 'synthetic', 'x')
       || '|' || pg_temp.pset(c_a2, c_a, true, 'synthetic', 'x') || '|' || pg_temp.pset(c_e1, c_a, true, 'synthetic', 'x')
       || '|' || pg_temp.pset(null, c_a, true, 'synthetic', 'x')
       || '|' || coalesce(pg_temp.val_as('anon', null, format('select public.platform_set_plus_request_contact_enablement(%L::uuid, true, ''synthetic'', ''x'')::text', c_a)), 'NULL')
       || '|' || pg_temp.pget(c_a1, c_a);
  perform pg_temp.t('G3 only Platform Admins manage the allowlist: own Org Admin / foreign Admin / dispatcher / non-member ZW002; no uid ZW001; anon 42501; get as Org Admin ZW002',
    v ~ '^ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW001:[^|]*\|ERR:42501:[^|]*\|ERR:ZW002:'
    and (select count(*) from public.plus_request_contact_enablements) = 0, v);
  v := pg_temp.pset(c_d1, c_a, true, 'live', 'real tenant') || '|' || pg_temp.pset(c_d1, c_a, true, null, 'no class')
       || '|' || pg_temp.pset(c_d1, c_a, true, 'synthetic', '   ') || '|' || pg_temp.pset(c_d1, c_a, true, 'synthetic', repeat('x', 501))
       || '|' || pg_temp.pset(c_d1, c_a, null, 'synthetic', 'null flag') || '|' || pg_temp.pset(c_d1, gen_random_uuid(), true, 'synthetic', 'unknown org');
  perform pg_temp.t('G4 Platform Admin input rules: live / NULL class / blank / long reason / NULL flag ZW006; unknown organization ZW002; nothing stored',
    v ~ '^ERR:ZW006:[^|]*\|ERR:ZW006:[^|]*\|ERR:ZW006:[^|]*\|ERR:ZW006:[^|]*\|ERR:ZW006:[^|]*\|ERR:ZW002:'
    and (select count(*) from public.plus_request_contact_enablements) = 0, v);
  v_n := (select count(*) from public.audit_events where action = 'platform_plus_request_contact_enablement_changed');
  v := pg_temp.pset(c_d1, c_a, true, 'synthetic', 'Fictional Org A test enablement') || '|' || pg_temp.pset(c_d1, c_a, true, 'synthetic', 'again')
       || '|' || pg_temp.pget(c_d1, c_a) || '|' || pg_temp.pget(c_d1, c_b);
  perform pg_temp.t('G5 Platform Admin enables Org A (synthetic): changed once, idempotent repeat, get shows it; Org B stays disabled; one audit row with reason, no contact data',
    v = 'true:synthetic:true|true:synthetic:false|true:synthetic:Fictional Org A test enablement|false:-:-'
    and (select count(*) from public.audit_events where action = 'platform_plus_request_contact_enablement_changed') = v_n + 1
    and exists (select 1 from public.audit_events where action = 'platform_plus_request_contact_enablement_changed' and organization_id = c_a
                and entity_type = 'organization' and entity_id = c_a and actor_user_id = c_d1 and reason = 'Fictional Org A test enablement'
                and before_data = '{"enabled": false, "data_class": null}'::jsonb and after_data = '{"enabled": true, "data_class": "synthetic"}'::jsonb), v);
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  v := pg_temp.vis('authenticated', c_a1, c_a) || '|' || pg_temp.vis('authenticated', c_a2, c_a) || '|' || pg_temp.vis('authenticated', c_a3, c_a)
       || '|' || pg_temp.vis('authenticated', c_b1, c_a) || '|' || pg_temp.vis('authenticated', c_e1, c_a) || '|' || pg_temp.vis('authenticated', c_d1, c_a)
       || '|' || pg_temp.vis('authenticated', c_b1, c_b) || '|' || pg_temp.vis('anon', null, c_a);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v := v || '|' || pg_temp.vis('authenticated', c_a2, c_a);
  perform pg_temp.t('G6 visibility helper: Org A Admin true; no-grant dispatcher / driver / foreign Admin / non-member / Platform Admin false; Org B (not enabled) false; anon 42501; read-grant dispatcher true',
    v ~ '^true\|false\|false\|false\|false\|false\|false\|ERR:42501:[^|]*\|true$', v);

  -- ============================================== A. access matrix (Org A enabled)
  v_fa := pg_temp.plus_fp(c_a);
  v_n := (select count(*) from public.audit_events where organization_id = c_a);
  v := pg_temp.cc(c_a1, c_a, r1, '  Ann Reviewed Fictional ', ' (404) 555-0121 ', '  Ann.Reviewed@Example.TEST ');
  v_id := nullif(split_part(v, ':', 2), '-')::uuid;
  perform pg_temp.t('A1 Admin with Plus write: outcome linked; one active contact with trimmed / lower-cased values and the submitted kind',
    v like 'linked:%:0' and exists (select 1 from public.plus_contacts where id = v_id and organization_id = c_a and status = 'active'
      and display_name = 'Ann Reviewed Fictional' and phone = '(404) 555-0121' and email = 'ann.reviewed@example.test'
      and contact_kind = 'family_caregiver' and preferred_channel = 'phone' and do_not_contact = false and created_by = c_a1 and job_title is null), v);
  perform pg_temp.t('A2 exactly one attribution: linked_existing_request, no opportunity, no idempotency key, linked_by the caller',
    (select count(*) from public.plus_request_attributions where request_id = r1) = 1
    and exists (select 1 from public.plus_request_attributions where request_id = r1 and contact_id = v_id and opportunity_id is null
                and link_method = 'linked_existing_request' and conversion_idempotency_key is null and linked_by = c_a1));
  perform pg_temp.t('A3 writes: +1 contact, +1 attribution, +1 request_linked activity, +3 audit rows; no opportunity, consent, task or quote',
    pg_temp.plus_fp(c_a) = (split_part(v_fa, '/', 1)::int + 1) || '/' || (split_part(v_fa, '/', 2)::int + 1) || '/' || (split_part(v_fa, '/', 3)::int + 1)
      || '/' || (split_part(v_fa, '/', 4)::int + 3) || '/' || split_part(v_fa, '/', 5) || '/' || split_part(v_fa, '/', 6)
      || '/' || split_part(v_fa, '/', 7) || '/' || split_part(v_fa, '/', 8)
    and exists (select 1 from public.plus_activities where request_id = r1 and contact_id = v_id and activity_type = 'request_linked' and body is null),
    pg_temp.plus_fp(c_a) || ' vs ' || v_fa);
  perform pg_temp.t('A4 audit: plus_contact_created + plus_request_linked + plus_contact_created_from_request ({request_id} only); no contact value in any of them',
    (select count(*) from public.audit_events where organization_id = c_a and entity_id = v_id and action = 'plus_contact_created') = 1
    and (select count(*) from public.audit_events where organization_id = c_a and entity_id = r1 and action = 'plus_request_linked') = 1
    and (select count(*) from public.audit_events where organization_id = c_a and entity_id = v_id and action = 'plus_contact_created_from_request'
         and entity_type = 'plus_contact' and actor_user_id = c_a1 and before_data is null and after_data = jsonb_build_object('request_id', r1)) = 1
    and not exists (select 1 from public.audit_events where organization_id = c_a
                    and (coalesce(after_data::text, '') || coalesce(before_data::text, '') || coalesce(reason, '')) ~* '(ann|reviewed|555-0121|example\.test)'));
  v := pg_temp.cc(c_a1, c_a, r1, 'Ann Reviewed Fictional', '(404) 555-0121', 'ann.reviewed@example.test');
  perform pg_temp.t('A5 replay of the same submission after commit: already_linked with the SAME contact; nothing written',
    v = 'already_linked:' || v_id || ':0' and (select count(*) from public.audit_events where organization_id = c_a) = v_n + 3, v);
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.cc(c_a2, c_a, r2, 'Dispatcher Made Fictional', '(404) 555-0122', null);
  perform pg_temp.t('A6 Dispatcher with an active WRITE grant: linked', v like 'linked:%:0', v);
  v_fa := pg_temp.plus_fp(c_a);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v := pg_temp.cc(c_a2, c_a, r3, 'Read Grant Fictional', '(404) 555-0123', null);
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  v := v || '|' || pg_temp.cc(c_a2, c_a, r3, 'No Grant Fictional', '(404) 555-0123', null);
  perform pg_temp.t('A7 Dispatcher with a READ grant ZW001; without a grant ZW002; nothing written', v ~ '^ERR:ZW001:[^|]*\|ERR:ZW002:' and pg_temp.plus_fp(c_a) = v_fa, v);
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  perform pg_temp.set_state(c_a, 'expired');
  v := pg_temp.cc(c_a1, c_a, r3, 'Read Only Fictional', '(404) 555-0123', null) || '|' || pg_temp.cc(c_a2, c_a, r3, 'Read Only Fictional', '(404) 555-0123', null);
  perform pg_temp.set_state(c_a, 'locked');
  v := v || '|' || pg_temp.cc(c_a1, c_a, r3, 'Locked Fictional', '(404) 555-0123', null);
  perform pg_temp.set_state(c_a, 'none');
  v := v || '|' || pg_temp.cc(c_a1, c_a, r3, 'No Plus Fictional', '(404) 555-0123', null);
  perform pg_temp.set_state(c_a, 'active');
  update public.organizations set status = 'inactive' where id = c_a;
  v := v || '|' || pg_temp.cc(c_a1, c_a, r3, 'Suspended Fictional', '(404) 555-0123', null);
  update public.organizations set status = 'active' where id = c_a;
  perform pg_temp.t('A8 read_only Admin ZW001; read_only grant holder ZW002; locked ZW002; no Plus ZW002; suspended organization ZW002; nothing written (allowlist row does not help)',
    v ~ '^ERR:ZW001:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW002:' and pg_temp.plus_fp(c_a) = v_fa, v);
  v := pg_temp.cc(c_a3, c_a, r3, 'Driver Fictional', '(404) 555-0123', null) || '|' || pg_temp.cc(c_a5, c_a, r3, 'Inactive Fictional', '(404) 555-0123', null)
       || '|' || pg_temp.cc(c_e1, c_a, r3, 'Nobody Fictional', '(404) 555-0123', null) || '|' || pg_temp.cc(c_d1, c_a, r3, 'Platform Fictional', '(404) 555-0123', null)
       || '|' || pg_temp.cc(null, c_a, r3, 'No Uid Fictional', '(404) 555-0123', null)
       || '|' || coalesce(pg_temp.val_as('anon', null, format('select (public.plus_create_contact_for_request(%L::uuid, %L::uuid, ''Anon Fictional'', ''(404) 555-0123'', null, ''individual'', ''phone'', false, null, false)).outcome', c_a, r3)), 'NULL');
  perform pg_temp.t('A9 driver / inactive dispatcher / non-member / Platform Admin without membership ZW002; no uid ZW001; anon 42501; nothing written',
    v ~ '^ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW001:[^|]*\|ERR:42501:' and pg_temp.plus_fp(c_a) = v_fa, v);

  -- ============================================== X. organization isolation
  v_fb := pg_temp.plus_fp(c_b);
  v := pg_temp.cc(c_b1, c_a, r3, 'Foreign Admin Fictional', '(404) 555-0124', null)
       || '|' || pg_temp.cc(c_a1, c_a, r_b, 'Foreign Request Fictional', '(404) 555-0124', null)
       || '|' || pg_temp.cc(c_a1, c_b, r_b, 'Other Org Fictional', '(404) 555-0124', null)
       || '|' || pg_temp.cc(c_c1, c_b, r_b, 'Driver In B Fictional', '(404) 555-0124', null)
       || '|' || pg_temp.cc(c_a1, c_a, r3, 'Foreign Owner Fictional', '(404) 555-0124', null, 'individual', 'phone', false, pg_temp.mid(c_b, c_b1))
       || '|' || pg_temp.cc(c_a1, c_a, gen_random_uuid(), 'Unknown Request Fictional', '(404) 555-0124', null)
       || '|' || pg_temp.cc(c_a1, c_a, null, 'Null Request Fictional', '(404) 555-0124', null);
  perform pg_temp.t('X1 Org B Admin on Org A ZW002; Org B Request via Org A ZW002; Org A Admin on Org B ZW002; Org B driver ZW002; Org B owner handle ZW006; unknown / NULL Request ZW002',
    v ~ '^ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW006:[^|]*\|ERR:ZW002:[^|]*\|ERR:ZW002:', v);
  perform pg_temp.t('X2 nothing written in either organization by any refused cross-tenant call', pg_temp.plus_fp(c_a) = v_fa and pg_temp.plus_fp(c_b) = v_fb);
  v := pg_temp.cc(c_b1, c_b, r_b, 'Org B Own Fictional', '(404) 555-0125', null);
  perform pg_temp.t('X3 enablement is per organization: Org B Admin on its OWN Request while Org B is not enabled -> ZW004 not enabled', v = 'ERR:ZW004:request_contact_not_enabled', v);

  -- ============================================== D. duplicates
  v_fa := pg_temp.plus_fp(c_a);
  v := pg_temp.cc(c_a1, c_a, r3, 'Someone Else Fictional', null, 'DUP.PAT@example.test')
       || '|' || pg_temp.cc(c_a1, c_a, r3, 'Someone Else Fictional', '404.555.0110', null)
       || '|' || pg_temp.cc(c_a1, c_a, r3, 'dup pat fictional', '(404) 555-0199', null)
       || '|' || pg_temp.cc(c_a1, c_a, r3, 'Someone Else Fictional', null, 'archived.ray@example.test');
  perform pg_temp.t('D1 possible duplicates by email (case-insensitive), phone digits, name (case-insensitive) and an ARCHIVED match: outcome possible_duplicates; NOTHING written',
    v = 'possible_duplicates:-:1|possible_duplicates:-:1|possible_duplicates:-:1|possible_duplicates:-:1' and pg_temp.plus_fp(c_a) = v_fa
    and not exists (select 1 from public.plus_request_attributions where request_id = r3), v);
  v := pg_temp.cc(c_a1, c_a, r3, 'Dup Pat Fictional', '(404) 555-0110', 'dup.pat@example.test', 'individual', 'phone', false, null, true);
  v_id := nullif(split_part(v, ':', 2), '-')::uuid;
  perform pg_temp.t('D2 confirmed: a NEW contact is created and linked (never merged); the existing contact is untouched',
    v like 'linked:%:1' and v_id <> k_dup and (select contact_id from public.plus_request_attributions where request_id = r3) = v_id
    and (select count(*) from public.plus_contacts where organization_id = c_a and lower(display_name) = 'dup pat fictional') = 2
    and exists (select 1 from public.audit_events where entity_id = v_id and action = 'plus_contact_created' and after_data = '{"possible_duplicates_confirmed": 1}'::jsonb), v);
  v := pg_temp.cc(c_a1, c_a, r3, 'Dup Pat Fictional', '(404) 555-0110', 'dup.pat@example.test', 'individual', 'phone', false, null, true);
  perform pg_temp.t('D3 a second confirmed submission for the same Request (sequential double submit): already_linked, no second contact',
    v = 'already_linked:' || v_id || ':0' and (select count(*) from public.plus_contacts where organization_id = c_a and lower(display_name) = 'dup pat fictional') = 2, v);

  -- ============================================== R. already-attributed Requests
  v_fa := pg_temp.plus_fp(c_a);
  v := pg_temp.cc(c_a1, c_a, r_linked, 'New Person Fictional', '(404) 555-0126', null)
       || '|' || pg_temp.cc(c_a1, c_a, r_linked, 'Dup Pat Fictional', null, 'dup.pat@example.test');
  perform pg_temp.t('R1 a Request already linked to another contact: already_linked with THAT contact (before any duplicate check); nothing written; the link is unchanged',
    v = 'already_linked:' || k_linked || ':0|already_linked:' || k_linked || ':0' and pg_temp.plus_fp(c_a) = v_fa
    and (select contact_id from public.plus_request_attributions where request_id = r_linked) = k_linked, v);

  -- ============================================== V. validation (released rules; ZW006; nothing written)
  v := pg_temp.cc(c_a1, c_a, r4, 'No Address Fictional', null, null)
       || '|' || pg_temp.cc(c_a1, c_a, r4, 'Bad Email Fictional', null, 'not-an-email')
       || '|' || pg_temp.cc(c_a1, c_a, r4, 'Bad Phone Fictional', 'call me maybe', null)
       || '|' || pg_temp.cc(c_a1, c_a, r4, 'Short Phone Fictional', '555-01', null)
       || '|' || pg_temp.cc(c_a1, c_a, r4, repeat('N', 201), '(404) 555-0127', null)
       || '|' || pg_temp.cc(c_a1, c_a, r4, '   ', '(404) 555-0127', null)
       || '|' || pg_temp.cc(c_a1, c_a, r4, 'Bad Kind Fictional', '(404) 555-0127', null, 'passenger')
       || '|' || pg_temp.cc(c_a1, c_a, r4, 'Bad Channel Fictional', '(404) 555-0127', null, 'individual', 'sms')
       || '|' || pg_temp.cc(c_a1, c_a, r4, 'Driver Owner Fictional', '(404) 555-0127', null, 'individual', 'phone', false, pg_temp.mid(c_a, c_a3));
  perform pg_temp.t('V1 no phone or email / bad email / bad phone / too few digits / name over 200 / blank name / unknown kind / unknown channel / ineligible owner -> ZW006 each',
    v = 'ERR:ZW006:invalid_input|ERR:ZW006:invalid_input|ERR:ZW006:invalid_input|ERR:ZW006:invalid_input|ERR:ZW006:invalid_input|ERR:ZW006:invalid_input|ERR:ZW006:invalid_input|ERR:ZW006:invalid_input|ERR:ZW006:invalid_input', v);
  perform pg_temp.t('V2 no partial write from any invalid submission (no contact, attribution, activity or audit row)',
    pg_temp.plus_fp(c_a) = v_fa and not exists (select 1 from public.plus_request_attributions where request_id = r4));
  v := pg_temp.cc(c_a1, c_a, r4, 'Owned Fictional', '(404) 555-0128', null, 'facility_staff', 'email', false, pg_temp.mid(c_a, c_a2));
  perform pg_temp.t('V3 an eligible owner (Dispatcher with a write grant) and every submitted field are kept as given',
    v like 'linked:%' and exists (select 1 from public.plus_contacts where id = nullif(split_part(v, ':', 2), '-')::uuid
      and owner_user_id = c_a2 and contact_kind = 'facility_staff' and preferred_channel = 'email'), v);

  -- ============================================== N. requester vs passenger
  v := pg_temp.cc(c_a1, c_a, r_pass, 'Ann Requester Edited Fictional', '(404) 555-0129', null, 'family_caregiver');
  v_id := nullif(split_part(v, ':', 2), '-')::uuid;
  perform pg_temp.t('N1 a Request with a linked Passenger and a different requested passenger name: the contact holds ONLY the staff-submitted values',
    v like 'linked:%' and exists (select 1 from public.plus_contacts where id = v_id and display_name = 'Ann Requester Edited Fictional'
      and phone = '(404) 555-0129' and email is null)
    and not exists (select 1 from public.plus_contacts c, public.passengers p where c.id = v_id and p.id = c_pa
                    and (c.display_name ilike '%' || p.display_name || '%' or c.display_name ilike '%Zed%')), v);
  perform pg_temp.t('N2 Core requester values were NOT copied: the stored email is not the Request''s requester_email, the phone is not its requester_phone',
    not exists (select 1 from public.plus_contacts c join public.transportation_requests r on r.id = r_pass
                where c.id = v_id and (c.email is not distinct from r.requester_email or c.phone = r.requester_phone)));
  perform pg_temp.t('N3 plus_contacts still has no passenger / address / health column, and the Passenger row is unchanged by any call',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plus_contacts'
                and column_name ~ '(passenger|address|birth|health|insurance|trip)')
    and pg_temp.core_fp() = v_core);

  -- ============================================== C. consent / do-not-contact
  perform pg_temp.t('C1 no consent row exists for any contact created here; a new contact resolves to no_consent_on_record on every channel / purpose',
    not exists (select 1 from public.plus_communication_consents where organization_id = c_a)
    and (select bool_and(public._plus_effective_consent(c_a, v_id, ch, pu) = 'no_consent_on_record')
         from (values ('email'), ('voice'), ('sms')) a(ch), (values ('service_followup'), ('marketing')) b(pu)));
  v := pg_temp.cc(c_a1, c_a, r_dnc, 'Dnc Ticked Fictional', '(404) 555-0130', null, 'individual', 'none', true);
  v_id := nullif(split_part(v, ':', 2), '-')::uuid;
  perform pg_temp.t('C2 Do not contact as ticked by staff is stored; resolver = suppressed_do_not_contact; still no consent row (nothing inferred)',
    v like 'linked:%' and (select do_not_contact from public.plus_contacts where id = v_id)
    and public._plus_effective_consent(c_a, v_id, 'voice', 'service_followup') = 'suppressed_do_not_contact'
    and not exists (select 1 from public.plus_communication_consents where organization_id = c_a), v);
  perform pg_temp.t('C3 do_not_contact is never set by the function itself: every other contact created here has do_not_contact = false',
    not exists (select 1 from public.plus_contacts c join public.plus_request_attributions a on a.contact_id = c.id
                where a.organization_id = c_a and a.request_id <> r_dnc and a.request_id <> r_linked and c.do_not_contact));

  -- ============================================== O. no opportunity / Core mutation
  perform pg_temp.t('O1 no opportunity, task or quote was created in Org A by any call; no attribution carries an opportunity',
    not exists (select 1 from public.plus_opportunities where organization_id = c_a)
    and not exists (select 1 from public.plus_tasks where organization_id = c_a)
    and not exists (select 1 from public.plus_quotes where organization_id = c_a)
    and not exists (select 1 from public.plus_request_attributions where organization_id = c_a and opportunity_id is not null));
  perform pg_temp.t('O2 no Core Request (state, updated_at, passenger, requester fields), event, acquisition, Passenger, Trip, assignment, Recurring Care or billing row changed',
    pg_temp.core_fp() = v_core);

  -- ============================================== DIS. disable
  v_fa := pg_temp.plus_fp(c_a);
  v := pg_temp.pset(c_a1, c_a, false, null, 'self disable') || '|' || pg_temp.pset(c_d1, c_a, false, 'live', 'bad class') || '|' || pg_temp.pset(c_d1, c_a, false, null, '')
       || '|' || pg_temp.pset(c_d1, c_a, false, null, 'Fictional test complete') || '|' || pg_temp.pset(c_d1, c_a, false, null, 'again')
       || '|' || pg_temp.vis('authenticated', c_a1, c_a) || '|' || pg_temp.cc(c_a1, c_a, r5, 'After Disable Fictional', '(404) 555-0131', null);
  perform pg_temp.t('DIS1 disable: Org Admin ZW002; bad class / blank reason ZW006; Platform Admin disables once (idempotent repeat); helper false; creation ZW004 not enabled',
    v ~ '^ERR:ZW002:[^|]*\|ERR:ZW006:[^|]*\|ERR:ZW006:[^|]*\|false:-:true\|false:-:false\|false\|ERR:ZW004:request_contact_not_enabled$'
    and (select count(*) from public.plus_request_contact_enablements) = 0, v);
  perform pg_temp.t('DIS2 the disable is audited with its reason; nothing else written by the refused creation',
    exists (select 1 from public.audit_events where action = 'platform_plus_request_contact_enablement_changed' and organization_id = c_a
            and reason = 'Fictional test complete' and after_data = '{"enabled": false, "data_class": null}'::jsonb)
    and split_part(pg_temp.plus_fp(c_a), '/', 1) = split_part(v_fa, '/', 1)
    and split_part(pg_temp.plus_fp(c_a), '/', 2) = split_part(v_fa, '/', 2)
    and split_part(pg_temp.plus_fp(c_a), '/', 3) = split_part(v_fa, '/', 3)
    and split_part(pg_temp.plus_fp(c_a), '/', 4)::int = split_part(v_fa, '/', 4)::int + 1);
  -- the released paths are unchanged and NOT gated (documented scope of the guard): direct create + link still work
  v := coalesce(pg_temp.val_as('authenticated', c_a1, format(
         'select (public.plus_create_contact(%L::uuid, ''Released Path Fictional'', ''(404) 555-0132'', null, ''individual'', null, ''phone'', false, null, false)).changed::text', c_a)), 'NULL');
  perform pg_temp.t('DIS3 released plus_create_contact is unchanged and not gated by the new allowlist (documented guard scope)', v = 'true', v);
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from t_results;
select name, detail from t_results where not ok order by n;

rollback;
