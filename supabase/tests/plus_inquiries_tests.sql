-- Nemryn Plus -- public inquiry intake tests (NP-P2-S7-A). ROLLBACK-ONLY (one transaction, rolled back at the end).
--   docker exec -i supabase_db_NemrynS1Iso psql -U postgres -d postgres -f - < supabase/tests/plus_inquiries_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261024100000_plus_inquiries_foundation.sql + 20261024110000_plus_inquiries_rpcs.sql (design:
-- docs/product/NP-P2-S7-public-inquiry-intake-design.md; ZD-243 .. ZD-263). Fictional seed fixtures only: Org A admin a1,
-- dispatcher a2, driver a3, inactive dispatcher a5; Org B admin b1; d1 = platform admin (no membership); e1 = no
-- membership. Inside one transaction now() is constant: "older" evidence is simulated with explicit timestamps.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table k_results (n serial, name text, ok boolean, detail text);
create temp table k (name text primary key, v text);
grant select on k to authenticated, service_role, anon;

create function pg_temp.x(p_role text, p_uid uuid, p_stmt text)
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
create function pg_temp.code(p text) returns text language sql as $$
  select case when p like 'ERR:%' then split_part(p, ':', 2) else 'ok' end;
$$;
create function pg_temp.t(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into k_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;
create function pg_temp.kv(p text) returns text language sql as $$ select v from k where name = p; $$;
create function pg_temp.mid(p_org uuid, p_uid uuid) returns uuid language sql as $$
  select id from public.memberships where organization_id = p_org and user_id = p_uid;
$$;
create function pg_temp.set_state(p_org uuid, p_state text) returns void language plpgsql as $$
begin
  delete from public.organization_modules where organization_id = p_org;
  if p_state = 'none' then return; end if;
  insert into public.organization_modules (organization_id, module, status, restriction, trial_started_at, trial_ends_at, access_ends_at, status_reason)
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, null, 'S7-A inquiries test'
  from (values ('active', 'active', null, null::timestamptz, null::timestamptz),
               ('expired', 'expired', null, now() - interval '20 days', now() - interval '6 days'),
               ('locked', 'disabled', 'no_access', null, null)) as s(name, status, restriction, ts, te)
  where s.name = p_state;
end;
$$;
create function pg_temp.set_grant(p_org uuid, p_uid uuid, p_access text) returns void language plpgsql as $$
begin
  update public.membership_module_grants set revoked_at = now(), revoked_by = '20000000-0000-0000-0000-0000000000a1'
  where membership_id = pg_temp.mid(p_org, p_uid) and revoked_at is null;
  if p_access <> 'none' then
    insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by)
    values (p_org, pg_temp.mid(p_org, p_uid), 'plus', p_access, '20000000-0000-0000-0000-0000000000a1');
  end if;
end;
$$;
create function pg_temp.mkc(p_org uuid, p_name text, p_phone text, p_email text, p_dnc boolean default false, p_status text default 'active')
returns uuid language sql as $$
  insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, do_not_contact, status, created_by)
  values (p_org, p_name, p_phone, p_email, 'individual', p_dnc, p_status,
          (select user_id from public.memberships where organization_id = p_org and role = 'organization_admin' order by created_at limit 1))
  returning id;
$$;
-- public submission as service_role -> 'status:changed' or ERR
create function pg_temp.sub(p_key text, p_idem text, p_name text, p_phone text, p_email text,
                            p_reply text default null, p_type text default 'quote', p_service text default null,
                            p_question text default 'How much is a ride? (fictional)', p_cf boolean default null,
                            p_cm boolean default null, p_rel text default null, p_tf text default null,
                            p_acq jsonb default null, p_ver integer default null)
returns text language sql as $$
  select pg_temp.x('service_role', null, format(
    'select r.status || '':'' || r.changed from public.submit_plus_inquiry(%L, %L, %s, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L::boolean, %L::boolean, %L::jsonb) r',
    p_key, p_idem, coalesce(p_ver::text, (select config_version::text from public.plus_inquiry_forms where public_key = p_key), '1'),
    p_name, p_phone, p_email, p_reply, p_rel, p_type, p_service, p_tf, p_question, p_cf, p_cm, p_acq));
$$;
create function pg_temp.inq(p_idem text) returns uuid language sql as $$
  select id from public.plus_inquiries where idempotency_key = p_idem;
$$;
create function pg_temp.ver(p_id uuid) returns integer language sql as $$ select version from public.plus_inquiries where id = p_id; $$;
create function pg_temp.fver(p_org uuid) returns integer language sql as $$ select version from public.plus_inquiry_forms where organization_id = p_org; $$;
-- conversion as a caller -> 'outcome|granted|skipped' or ERR
create function pg_temp.conv(p_uid uuid, p_org uuid, p_inq uuid, p_mode text, p_contact uuid default null,
                             p_confirm boolean default false, p_fill boolean default false, p_ack boolean default false,
                             p_ver integer default null)
returns text language sql as $$
  select pg_temp.x('authenticated', p_uid, format(
    'select r.outcome || ''|'' || r.consent_granted || ''|'' || array_to_string(r.consent_skipped, '','') from public.plus_convert_inquiry(%L::uuid, %L::uuid, %s, %L, %L::uuid, %L::boolean, %L::boolean, null, null, %L::boolean) r',
    p_org, p_inq, coalesce(p_ver, pg_temp.ver(p_inq)), p_mode, p_contact, p_confirm, p_fill, p_ack));
$$;
create function pg_temp.dis(p_uid uuid, p_org uuid, p_inq uuid, p_reason text, p_note text default null, p_ver integer default null)
returns text language sql as $$
  select pg_temp.x('authenticated', p_uid, format('select r.status from public.plus_dismiss_inquiry(%L::uuid, %L::uuid, %s, %L, %L) r',
    p_org, p_inq, coalesce(p_ver, pg_temp.ver(p_inq)), p_reason, p_note));
$$;
create function pg_temp.reo(p_uid uuid, p_org uuid, p_inq uuid, p_ver integer default null)
returns text language sql as $$
  select pg_temp.x('authenticated', p_uid, format('select r.status from public.plus_reopen_inquiry(%L::uuid, %L::uuid, %s) r',
    p_org, p_inq, coalesce(p_ver, pg_temp.ver(p_inq))));
$$;
create function pg_temp.core_counts() returns text language sql as $$
  select (select count(*) from public.transportation_requests) || '/' || (select count(*) from public.passengers) || '/' ||
         (select count(*) from public.trips) || '/' || (select count(*) from public.notification_events);
$$;

-- ---------------------------------------------------------------- fixtures
select pg_temp.set_state('10000000-0000-0000-0000-0000000000a1', 'active');
select pg_temp.set_state('10000000-0000-0000-0000-0000000000b1', 'active');
select pg_temp.set_grant('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a2', 'none');
delete from public.plus_inquiry_public_access;   -- the activation allowlist starts empty in every environment
delete from public.organization_service_offerings where organization_id = '10000000-0000-0000-0000-0000000000a1';
insert into k values ('core0', pg_temp.core_counts());

-- ================================================================= A. tables, RLS, grants
select pg_temp.t('A1 the four new tables exist with RLS enabled',
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
     and relname in ('plus_inquiry_forms', 'plus_inquiries', 'plus_inquiry_public_access', 'plus_inquiry_rate_limit_events')) = 4);
select pg_temp.t('A2 allowlist + rate-limit ledger are class A: no privilege for anon / authenticated / service_role',
  not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(r),
                            (values ('plus_inquiry_public_access'), ('plus_inquiry_rate_limit_events')) t(t),
                            (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(p)
              where has_table_privilege(r.r, 'public.' || t.t, p.p))
  and not has_any_column_privilege('authenticated', 'public.plus_inquiry_public_access', 'SELECT'));
select pg_temp.t('A3 forms: authenticated SELECT only; inquiries: column SELECT except idempotency_key; service_role none',
  has_table_privilege('authenticated', 'public.plus_inquiry_forms', 'SELECT')
  and not has_table_privilege('authenticated', 'public.plus_inquiry_forms', 'INSERT')
  and not has_table_privilege('authenticated', 'public.plus_inquiries', 'SELECT')
  and has_column_privilege('authenticated', 'public.plus_inquiries', 'question', 'SELECT')
  and not has_column_privilege('authenticated', 'public.plus_inquiries', 'idempotency_key', 'SELECT')
  and not has_any_column_privilege('service_role', 'public.plus_inquiries', 'SELECT')
  and not has_table_privilege('service_role', 'public.plus_inquiry_forms', 'SELECT')
  and not has_table_privilege('anon', 'public.plus_inquiry_forms', 'SELECT'));

-- ================================================================= B. direct DML denied
select pg_temp.t('B1 direct INSERT by authenticated / anon / service_role is denied on every new table',
  (select bool_and(pg_temp.code(pg_temp.x(r, '20000000-0000-0000-0000-0000000000a1', s)) = '42501')
   from (values ('authenticated'), ('anon'), ('service_role')) r(r),
        (values ('insert into public.plus_inquiry_public_access (organization_id, reason, enabled_by) values (''10000000-0000-0000-0000-0000000000a1'', ''x'', ''20000000-0000-0000-0000-0000000000a1'') returning ''x'''),
                ('insert into public.plus_inquiry_rate_limit_events (form_public_key, client_key) values (''inq_' || repeat('0', 32) || ''', ''' || repeat('a', 64) || ''') returning ''x'''),
                ('insert into public.plus_inquiry_forms (organization_id, headline, consent_text_version, created_by, updated_by) values (''10000000-0000-0000-0000-0000000000a1'', ''h'', ''plus-inquiry-consent-v1'', ''20000000-0000-0000-0000-0000000000a1'', ''20000000-0000-0000-0000-0000000000a1'') returning ''x''')) s(s)));

-- ================================================================= C. function EXECUTE boundaries
select pg_temp.t('C1 anon / authenticated cannot execute the service_role public RPCs (42501)',
  (select bool_and(pg_temp.code(pg_temp.x(r, '20000000-0000-0000-0000-0000000000a1', s)) = '42501')
   from (values ('anon'), ('authenticated')) r(r),
        (values ('select count(*)::text from public.get_public_plus_inquiry_form(''inq_' || repeat('0', 32) || ''')'),
                ('select (public.check_and_record_plus_inquiry_rate_limit(''inq_' || repeat('0', 32) || ''', ''' || repeat('a', 64) || ''')).allowed::text'),
                ('select (public.submit_plus_inquiry(''inq_' || repeat('0', 32) || ''', ''k-123456'', 1, ''n'', ''404 555 0100'', null, null, null, ''quote'', null, null, ''q'', null, null, null)).status')) s(s)));
select pg_temp.t('C2 anon cannot execute staff / platform RPCs; service_role cannot execute staff RPCs (42501)',
  pg_temp.code(pg_temp.x('anon', null, 'select count(*)::text from public.plus_get_inquiry_form(''10000000-0000-0000-0000-0000000000a1'')')) = '42501'
  and pg_temp.code(pg_temp.x('anon', null, 'select (public.platform_set_plus_inquiry_public_access(''10000000-0000-0000-0000-0000000000a1'', true, ''x'')).changed::text')) = '42501'
  and pg_temp.code(pg_temp.x('service_role', null, 'select public.plus_count_new_inquiries(''10000000-0000-0000-0000-0000000000a1'')::text')) = '42501');
select pg_temp.t('C3 internal helpers are not executable by any client or service role',
  not exists (select 1 from pg_proc p, (values ('anon'), ('authenticated'), ('service_role')) r(r)
              where p.pronamespace = 'public'::regnamespace and p.proname like '\_plus\_inquiry%' and has_function_privilege(r.r, p.oid, 'execute')));

-- ================================================================= D. activation allowlist (refinement A)
select pg_temp.t('D1 the allowlist is empty; an Org Admin cannot enable their own organization (ZW002)',
  (select count(*) from public.plus_inquiry_public_access) = 0
  and pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1',
        'select (public.platform_set_plus_inquiry_public_access(''10000000-0000-0000-0000-0000000000a1'', true, ''self'')).changed::text')) = 'ZW002');
select pg_temp.t('D2 Platform Admin: reason required (ZW006); unknown organization (ZW002)',
  pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000d1',
        'select (public.platform_set_plus_inquiry_public_access(''10000000-0000-0000-0000-0000000000a1'', true, '' '')).changed::text')) = 'ZW006'
  and pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000d1',
        'select (public.platform_set_plus_inquiry_public_access(''10000000-0000-0000-0000-0000000000ee'', true, ''x'')).changed::text')) = 'ZW002');

-- ================================================================= E. form configuration and publication
-- NOTE: a statement's plain subqueries read the snapshot taken when the statement started, so every check that must see
-- a write made through pg_temp.x / pg_temp.sub / pg_temp.conv records that write in k in an EARLIER statement.
insert into k values ('E1w', pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1',
    'select r.status || '':'' || r.changed from public.plus_save_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', '' Ask us anything '', null, array[''dialysis'',''medical_appointment''], null) r'));
select pg_temp.t('E1 Org Admin creates a draft form: server key inq_ + 32 hex, consent text version set by the server',
  pg_temp.kv('E1w') = 'draft:true'
  and (select public_key ~ '^inq_[0-9a-f]{32}$' and headline = 'Ask us anything' and consent_text_version = 'plus-inquiry-consent-v1'
              and offered_service_types = array['medical_appointment','dialysis'] from public.plus_inquiry_forms where organization_id = '10000000-0000-0000-0000-0000000000a1'));
insert into k select 'keyA', public_key from public.plus_inquiry_forms where organization_id = '10000000-0000-0000-0000-0000000000a1';
select pg_temp.t('E2 save: airport_transportation / duplicate / unknown service ZW006; stale version ZW003; create twice ZW003',
  (select bool_and(pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
     'select r.changed::text from public.plus_save_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', ''H'', null, %L::text[], %s) r', s, pg_temp.fver('10000000-0000-0000-0000-0000000000a1')))) = 'ZW006')
   from (values ('{airport_transportation}'), ('{dialysis,dialysis}'), ('{teleport}'), ('{null}')) v(s))
  and pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1',
        'select r.changed::text from public.plus_save_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', ''H'', null, ''{}'', 99) r')) = 'ZW003'
  and pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1',
        'select r.changed::text from public.plus_save_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', ''H'', null, ''{}'', null) r')) = 'ZW003');
select pg_temp.t('E3 a Dispatcher with a WRITE grant cannot configure the form (admin-only, ZW002); a driver ZW002',
  pg_temp.code((select pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a2',
     'select r.changed::text from public.plus_save_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', ''H'', null, ''{}'', 1) r')
     from (select pg_temp.set_grant('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a2', 'write')) g)) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a3',
     'select r.changed::text from public.plus_save_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', ''H'', null, ''{}'', 1) r')) = 'ZW002');
select pg_temp.set_grant('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a2', 'none');
select pg_temp.t('E4 publishing is refused until Nemryn enables the organization (ZW004); the draft is not public',
  pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
     'select r.status from public.plus_publish_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', %s) r', pg_temp.fver('10000000-0000-0000-0000-0000000000a1')))) = 'ZW004'
  and pg_temp.x('service_role', null, format('select count(*)::text from public.get_public_plus_inquiry_form(%L)', pg_temp.kv('keyA'))) = '0'
  and pg_temp.sub(pg_temp.kv('keyA'), 'e4-draft-0001', 'Fictional Draft', '404 555 0110', null) = 'unavailable:false');
insert into k values ('E5w', pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000d1',
    'select (public.platform_set_plus_inquiry_public_access(''10000000-0000-0000-0000-0000000000a1'', true, ''Synthetic S7-A test'')).changed::text'));
select pg_temp.t('E5 Platform Admin enables Org A (audited with the reason); a repeat is changed=false',
  pg_temp.kv('E5w') = 'true'
  and pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000d1',
    'select (public.platform_set_plus_inquiry_public_access(''10000000-0000-0000-0000-0000000000a1'', true, ''again'')).changed::text') = 'false'
  and exists (select 1 from public.audit_events where action = 'platform_plus_inquiry_public_access_changed' and reason = 'Synthetic S7-A test')
  and pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000d1',
    'select enabled::text from public.platform_get_plus_inquiry_public_access(''10000000-0000-0000-0000-0000000000a1'')') = 'true');
select pg_temp.t('E6 publish succeeds after activation; public config returns the org name, headline and offered services',
  pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
     'select r.status from public.plus_publish_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', %s) r', pg_temp.fver('10000000-0000-0000-0000-0000000000a1'))) = 'published'
  and pg_temp.x('service_role', null, format('select organization_name || ''|'' || headline || ''|'' || array_to_string(service_types, '','') || ''|'' || consent_text_version from public.get_public_plus_inquiry_form(%L)', pg_temp.kv('keyA')))
      = (select name from public.organizations where id = '10000000-0000-0000-0000-0000000000a1') || '|Ask us anything|medical_appointment,dialysis|plus-inquiry-consent-v1');
select pg_temp.t('E7 the staff view shows public_access_enabled and the service options (eight, never airport)',
  pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1',
    'select public_access_enabled || ''|'' || cardinality(service_options) || ''|'' || (''airport_transportation'' = any (service_options)) from public.plus_get_inquiry_form(''10000000-0000-0000-0000-0000000000a1'')') = 'true|8|false');

-- ================================================================= F. public availability negatives (one rule)
select pg_temp.t('F1 malformed, unknown and Core form_ keys are unavailable',
  pg_temp.sub('not-a-key', 'f1-key-0001', 'X', '404 555 0111', null) = 'unavailable:false'
  and pg_temp.sub('inq_' || repeat('f', 32), 'f1-key-0002', 'X', '404 555 0111', null) = 'unavailable:false'
  and pg_temp.sub('form_' || repeat('a', 32), 'f1-key-0003', 'X', '404 555 0111', null) = 'unavailable:false');
update public.organizations set status = 'inactive' where id = '10000000-0000-0000-0000-0000000000a1';
insert into k values ('f_inactive', pg_temp.sub(pg_temp.kv('keyA'), 'f2-key-0001', 'X', '404 555 0111', null));
update public.organizations set status = 'active' where id = '10000000-0000-0000-0000-0000000000a1';
select pg_temp.set_state('10000000-0000-0000-0000-0000000000a1', 'expired');
insert into k values ('f_readonly', pg_temp.sub(pg_temp.kv('keyA'), 'f2-key-0002', 'X', '404 555 0111', null));
select pg_temp.set_state('10000000-0000-0000-0000-0000000000a1', 'locked');
insert into k values ('f_locked', pg_temp.sub(pg_temp.kv('keyA'), 'f2-key-0003', 'X', '404 555 0111', null));
select pg_temp.set_state('10000000-0000-0000-0000-0000000000a1', 'none');
insert into k values ('f_none', pg_temp.sub(pg_temp.kv('keyA'), 'f2-key-0004', 'X', '404 555 0111', null));
select pg_temp.set_state('10000000-0000-0000-0000-0000000000a1', 'active');
delete from public.plus_inquiry_public_access where organization_id = '10000000-0000-0000-0000-0000000000a1';
insert into k values ('f_notallowed', pg_temp.sub(pg_temp.kv('keyA'), 'f2-key-0005', 'X', '404 555 0111', null));
insert into public.plus_inquiry_public_access (organization_id, reason, enabled_by) values ('10000000-0000-0000-0000-0000000000a1', 'restored', '20000000-0000-0000-0000-0000000000d1');
select pg_temp.t('F2 suspended org, read_only, locked, none and not-allowlisted are all unavailable; nothing stored',
  pg_temp.kv('f_inactive') = 'unavailable:false' and pg_temp.kv('f_readonly') = 'unavailable:false' and pg_temp.kv('f_locked') = 'unavailable:false'
  and pg_temp.kv('f_none') = 'unavailable:false' and pg_temp.kv('f_notallowed') = 'unavailable:false'
  and not exists (select 1 from public.plus_inquiries where idempotency_key like 'f2-key-%'));

-- ================================================================= G/H/O. submission
insert into k values ('aud0', (select count(*)::text from public.audit_events));
insert into k values ('crm0', (select count(*) from public.plus_contacts) || '/' || (select count(*) from public.plus_opportunities) || '/' || (select count(*) from public.plus_communication_consents));
insert into k values ('G1w', pg_temp.sub(pg_temp.kv('keyA'), 'g1-key-0001', ' Fictional Person One ', '404 555 0121', ' G1@Example.TEST ', p_service => 'dialysis',
              p_acq => '{"utmSource":"newsletter","referrerHost":"Example.Org","landingPath":"/pricing","organizationId":"x"}'));
select pg_temp.t('G1 a valid submission is accepted (changed) and stores exactly one inquiry; consent ticks default false',
  pg_temp.kv('G1w') = 'accepted:true'
  and (select count(*) from public.plus_inquiries where idempotency_key = 'g1-key-0001') = 1
  and (select status = 'new' and name = 'Fictional Person One' and email = 'g1@example.test' and not consent_followup and not consent_marketing
              and consent_text_version = 'plus-inquiry-consent-v1' and form_config_version = 1 and utm_source = 'newsletter'
              and referrer_host = 'example.org' and landing_path = '/pricing' and service_type = 'dialysis'
       from public.plus_inquiries where idempotency_key = 'g1-key-0001'));
select pg_temp.t('O1 a submission creates no contact, opportunity, consent, audit row, Core Request, Passenger, Trip or notification',
  ((select count(*) from public.plus_contacts) || '/' || (select count(*) from public.plus_opportunities) || '/' || (select count(*) from public.plus_communication_consents)) = pg_temp.kv('crm0')
  and (select count(*)::text from public.audit_events) = pg_temp.kv('aud0')
  and pg_temp.core_counts() = pg_temp.kv('core0'));
select pg_temp.t('H1 the same idempotency key again -> accepted, changed=false, still one row',
  pg_temp.sub(pg_temp.kv('keyA'), 'g1-key-0001', 'Someone Else', '404 555 0199', null) = 'accepted:false'
  and (select count(*) from public.plus_inquiries where idempotency_key = 'g1-key-0001') = 1
  and (select name from public.plus_inquiries where idempotency_key = 'g1-key-0001') = 'Fictional Person One');
select pg_temp.t('G2 closed schema: every invalid field is refused (status invalid) and nothing is stored',
  (select bool_and(r = 'invalid:false') from (values
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0001', 'No Reach', null, null)),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0002', 'Bad Email', null, 'not-an-email')),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0003', 'Bad Phone', '12', null)),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0004', 'Reply Phone', null, 'r@example.test', p_reply => 'phone')),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0005', 'Bad Type', '404 555 0122', null, p_type => 'invoice')),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0006', 'Airport', '404 555 0122', null, p_service => 'airport_transportation')),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0007', 'Not Offered', '404 555 0122', null, p_service => 'rehabilitation')),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0008', 'Empty Q', '404 555 0122', null, p_question => '  ')),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0009', 'Long Q', '404 555 0122', null, p_question => repeat('x', 501))),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0010', repeat('n', 121), '404 555 0122', null)),
     (pg_temp.sub(pg_temp.kv('keyA'), 'bad key!', 'Bad Key', '404 555 0122', null)),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0012', 'Bad Rel', '404 555 0122', null, p_rel => 'boss')),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0013', 'Bad Time', '404 555 0122', null, p_tf => 'tuesday 3pm')),
     (pg_temp.sub(pg_temp.kv('keyA'), 'g2-key-0014', 'Bad Reply', '404 555 0122', null, p_reply => 'fax'))) v(r))
  and not exists (select 1 from public.plus_inquiries where idempotency_key like 'g2-key-%' or idempotency_key = 'bad key!'));
select pg_temp.t('G3 a submission against an older config version is form_changed (not stored)',
  pg_temp.sub(pg_temp.kv('keyA'), 'g3-key-0001', 'Old Version', '404 555 0123', null, p_ver => 7) = 'form_changed:false'
  and pg_temp.inq('g3-key-0001') is null);

-- ================================================================= I. rate limit (sequential; concurrency in the .sh test)
select pg_temp.t('I1 5 per client per hour, then refused; another client is still allowed; malformed keys fail closed',
  (select string_agg(pg_temp.x('service_role', null, format('select (public.check_and_record_plus_inquiry_rate_limit(%L, %L)).allowed::text', pg_temp.kv('keyA'), repeat('1', 64))), ',')
   from generate_series(1, 6)) = 'true,true,true,true,true,false'
  and pg_temp.x('service_role', null, format('select (public.check_and_record_plus_inquiry_rate_limit(%L, %L)).allowed::text', pg_temp.kv('keyA'), repeat('2', 64))) = 'true'
  and pg_temp.x('service_role', null, format('select (public.check_and_record_plus_inquiry_rate_limit(%L, %L)).allowed::text', 'form_x', repeat('3', 64))) = 'false'
  and pg_temp.x('service_role', null, format('select (public.check_and_record_plus_inquiry_rate_limit(%L, %L)).allowed::text', pg_temp.kv('keyA'), '10.0.0.1')) = 'false');
insert into k values ('I2w', (select count(*) filter (where pg_temp.x('service_role', null, format('select (public.check_and_record_plus_inquiry_rate_limit(%L, %L)).allowed::text',
            pg_temp.kv('keyA'), lpad(to_hex(g), 64, 'a'))) = 'true') from generate_series(1, 70) g)::text);
select pg_temp.t('I2 60 per form per hour across clients, then refused',
  pg_temp.kv('I2w') = '54'  -- 6 already recorded by I1
  and (select count(*) from public.plus_inquiry_rate_limit_events where form_public_key = pg_temp.kv('keyA')) = 60);

-- ================================================================= D/F. tenant and role isolation of staff reads
select pg_temp.t('D3 Org A admin reads the inbox; Org B admin, Platform Admin, no-membership, driver, inactive and a no-grant dispatcher get ZW002',
  pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', 'select public.plus_count_new_inquiries(''10000000-0000-0000-0000-0000000000a1'')::text') = '1'
  and (select bool_and(pg_temp.code(pg_temp.x('authenticated', u, 'select count(*)::text from public.plus_list_inquiries(''10000000-0000-0000-0000-0000000000a1'', ''all'', null, 25, 0)')) = 'ZW002')
       from (values ('20000000-0000-0000-0000-0000000000b1'::uuid), ('20000000-0000-0000-0000-0000000000d1'), ('20000000-0000-0000-0000-0000000000e1'),
                    ('20000000-0000-0000-0000-0000000000a3'), ('20000000-0000-0000-0000-0000000000a5'), ('20000000-0000-0000-0000-0000000000a2')) u(u)));
select pg_temp.t('D4 RLS: Org A admin sees Org A inquiries; Org B admin and Platform Admin see none; the idempotency key is not readable (42501)',
  pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', 'select count(id)::text from public.plus_inquiries') = '1'
  and pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000b1', 'select count(id)::text from public.plus_inquiries') = '0'
  and pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000d1', 'select count(id)::text from public.plus_inquiries') = '0'
  and pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', 'select max(idempotency_key) from public.plus_inquiries')) = '42501');
select pg_temp.t('D5 Org B admin cannot read, dismiss or convert an Org A inquiry, even with its id (ZW002)',
  pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select name from public.plus_get_inquiry(''10000000-0000-0000-0000-0000000000b1'', %L)', pg_temp.inq('g1-key-0001')))) = 'ZW002'
  and pg_temp.code(pg_temp.dis('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', pg_temp.inq('g1-key-0001'), 'spam')) = 'ZW002'
  and pg_temp.code(pg_temp.conv('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', pg_temp.inq('g1-key-0001'), 'create')) = 'ZW002'
  and (select status from public.plus_inquiries where id = pg_temp.inq('g1-key-0001')) = 'new');
select pg_temp.t('F3 READ grant: reads the inbox but every triage write is ZW001; read_only admin reads but cannot write (ZW001); locked ZW002',
  pg_temp.code((select pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select name from public.plus_get_inquiry(''10000000-0000-0000-0000-0000000000a1'', %L)', pg_temp.inq('g1-key-0001')))
                from (select pg_temp.set_grant('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a2', 'read')) g)) = 'ok'
  and pg_temp.code(pg_temp.dis('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('g1-key-0001'), 'spam')) = 'ZW001'
  and pg_temp.code(pg_temp.conv('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('g1-key-0001'), 'create')) = 'ZW001'
  and pg_temp.code((select pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select name from public.plus_get_inquiry(''10000000-0000-0000-0000-0000000000a1'', %L)', pg_temp.inq('g1-key-0001')))
                from (select pg_temp.set_state('10000000-0000-0000-0000-0000000000a1', 'expired')) s)) = 'ok'
  and pg_temp.code(pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('g1-key-0001'), 'create')) = 'ZW001'
  and pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', 'select r.changed::text from public.plus_save_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', ''H'', null, ''{}'', 1) r')) = 'ZW001'
  and pg_temp.code((select pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', 'select public.plus_count_new_inquiries(''10000000-0000-0000-0000-0000000000a1'')::text')
                from (select pg_temp.set_state('10000000-0000-0000-0000-0000000000a1', 'locked')) s)) = 'ZW002');
select pg_temp.set_state('10000000-0000-0000-0000-0000000000a1', 'active');
select pg_temp.set_grant('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a2', 'none');

-- ================================================================= lifecycle: dismiss / reopen
select pg_temp.sub(pg_temp.kv('keyA'), 'l1-key-0001', 'Fictional Dismiss', '404 555 0131', null);
insert into k values ('L1a', pg_temp.code(pg_temp.dis('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('l1-key-0001'), 'other')));
insert into k values ('L1b', pg_temp.code(pg_temp.dis('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('l1-key-0001'), 'spam', null, 99)));
insert into k values ('L1c', pg_temp.dis('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('l1-key-0001'), 'spam'));
insert into k values ('L1d', pg_temp.code(pg_temp.dis('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('l1-key-0001'), 'spam')));
select pg_temp.t('L1 dismiss: "other" needs a note (ZW006); stale version ZW003; dismiss works; dismiss again ZW004',
  pg_temp.kv('L1a') = 'ZW006' and pg_temp.kv('L1b') = 'ZW003' and pg_temp.kv('L1c') = 'dismissed' and pg_temp.kv('L1d') = 'ZW004'
  and (select status = 'dismissed' and dismiss_reason = 'spam' and triaged_by is not null from public.plus_inquiries where id = pg_temp.inq('l1-key-0001'))
  and exists (select 1 from public.audit_events where action = 'plus_inquiry_dismissed' and entity_id = pg_temp.inq('l1-key-0001')),
  pg_temp.kv('L1a') || ',' || pg_temp.kv('L1b') || ',' || pg_temp.kv('L1c') || ',' || pg_temp.kv('L1d'));
insert into k values ('L2a', pg_temp.reo('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('l1-key-0001')));
insert into k values ('L2b', pg_temp.code(pg_temp.reo('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('l1-key-0001'))));
select pg_temp.t('L2 a dismissed inquiry reopens to new (triage fields cleared); reopening a new one is ZW004',
  pg_temp.kv('L2a') = 'new' and pg_temp.kv('L2b') = 'ZW004'
  and (select dismiss_reason is null and triaged_at is null and triaged_by is null from public.plus_inquiries where id = pg_temp.inq('l1-key-0001')),
  pg_temp.kv('L2a') || ',' || pg_temp.kv('L2b'));

-- ================================================================= J/N. conversion (create) + consent mapping
select pg_temp.sub(pg_temp.kv('keyA'), 'j1-key-0001', 'Fictional Convert One', '(404) 555-0141', 'j1@example.test',
                   p_type => 'availability', p_service => 'medical_appointment', p_cf => true, p_cm => true, p_rel => 'family');
insert into k values ('crmJ', (select count(*) from public.plus_contacts) || '/' || (select count(*) from public.plus_opportunities));
insert into k values ('J1w', pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('j1-key-0001'), 'create'));
select pg_temp.t('J1 convert (create): one contact + one private-pay opportunity; 4 web_form grants (email/voice x follow-up/marketing), no sms',
  pg_temp.kv('J1w') = 'converted|4|'
  and ((select count(*) from public.plus_contacts) || '/' || (select count(*) from public.plus_opportunities))
      = (split_part(pg_temp.kv('crmJ'), '/', 1)::int + 1) || '/' || (split_part(pg_temp.kv('crmJ'), '/', 2)::int + 1));
select pg_temp.t('J2 the opportunity: new_inquiry, web_inquiry, inquiry type / service copied, inquiry_id set; the contact: family_caregiver',
  (select o.stage = 'new_inquiry' and o.source = 'web_inquiry' and o.channel = 'private_pay' and o.inquiry_type = 'availability'
          and o.service_type = 'medical_appointment' and o.primary_contact_id = i.contact_id and c.contact_kind = 'family_caregiver'
          and c.do_not_contact = false and i.status = 'converted' and i.triaged_by = '20000000-0000-0000-0000-0000000000a1'
   from public.plus_inquiries i join public.plus_opportunities o on o.inquiry_id = i.id join public.plus_contacts c on c.id = i.contact_id
   where i.id = pg_temp.inq('j1-key-0001')));
select pg_temp.t('N1 consent rows: web_form, captured_at = submission time, text version, inquiry_id; effective consent_on_record; sms none',
  (select count(*) = 4 and bool_and(c.captured_via = 'web_form' and c.status = 'granted' and c.captured_at = i.received_at
                                    and c.consent_text_version = 'plus-inquiry-consent-v1' and c.inquiry_id = i.id and c.channel in ('email', 'voice'))
   from public.plus_communication_consents c join public.plus_inquiries i on i.id = c.inquiry_id where i.id = pg_temp.inq('j1-key-0001'))
  and public._plus_effective_consent('10000000-0000-0000-0000-0000000000a1', (select contact_id from public.plus_inquiries where id = pg_temp.inq('j1-key-0001')), 'voice', 'marketing') = 'consent_on_record'
  and public._plus_effective_consent('10000000-0000-0000-0000-0000000000a1', (select contact_id from public.plus_inquiries where id = pg_temp.inq('j1-key-0001')), 'sms', 'service_followup') = 'no_consent_on_record');
select pg_temp.t('J3 one inquiry_converted activity (no body) and one plus_inquiry_converted audit row; no Core row created',
  (select count(*) from public.plus_activities where activity_type = 'inquiry_converted' and body is null
     and opportunity_id = (select id from public.plus_opportunities where inquiry_id = pg_temp.inq('j1-key-0001'))) = 1
  and (select count(*) from public.audit_events where action = 'plus_inquiry_converted' and entity_id = pg_temp.inq('j1-key-0001')) = 1
  and pg_temp.core_counts() = pg_temp.kv('core0'));
select pg_temp.t('J4 converted is final: convert again ZW004, dismiss ZW004, reopen ZW004; stale version ZW003',
  pg_temp.code(pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('j1-key-0001'), 'create')) = 'ZW004'
  and pg_temp.code(pg_temp.dis('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('j1-key-0001'), 'spam')) = 'ZW004'
  and pg_temp.code(pg_temp.reo('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('j1-key-0001'))) = 'ZW004'
  and pg_temp.code(pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('j1-key-0001'), 'create', p_ver => 1)) = 'ZW003');
select pg_temp.sub(pg_temp.kv('keyA'), 'j5-key-0001', 'Fictional Only Followup', null, 'j5@example.test', p_cf => true);
select pg_temp.sub(pg_temp.kv('keyA'), 'j5-key-0002', 'Fictional No Ticks', '404 555 0152', 'j5b@example.test');
insert into k values ('J5a', pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('j5-key-0001'), 'create'));
insert into k values ('J5b', pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('j5-key-0002'), 'create'));
select pg_temp.t('J5 only the follow-up box ticked with email only -> 1 grant (email/service_followup); no boxes ticked -> 0 grants',
  pg_temp.kv('J5a') = 'converted|1|'
  and (select string_agg(channel || '/' || purpose, ',') from public.plus_communication_consents where inquiry_id = pg_temp.inq('j5-key-0001')) = 'email/service_followup'
  and pg_temp.kv('J5b') = 'converted|0|'
  and not exists (select 1 from public.plus_communication_consents where inquiry_id = pg_temp.inq('j5-key-0002')));

-- ================================================================= duplicates: create warns, never merges
select pg_temp.mkc('10000000-0000-0000-0000-0000000000a1', 'Fictional Existing Dup', '404 555 0161', 'dup@example.test');
select pg_temp.sub(pg_temp.kv('keyA'), 'k1-key-0001', 'Fictional Dup Person', '404 555 0199', 'dup@example.test', p_cf => true);
insert into k values ('crmK', (select count(*)::text from public.plus_contacts));
select pg_temp.t('K1 duplicate hints list the matching contact (email); create without confirmation writes NOTHING (possible_duplicates)',
  pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select string_agg(kind || '':'' || match_on, '','') from public.plus_list_inquiry_duplicate_hints(''10000000-0000-0000-0000-0000000000a1'', %L)', pg_temp.inq('k1-key-0001'))) like '%contact:email%'
  and pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('k1-key-0001'), 'create') = 'possible_duplicates|0|'
  and (select count(*)::text from public.plus_contacts) = pg_temp.kv('crmK')
  and (select status from public.plus_inquiries where id = pg_temp.inq('k1-key-0001')) = 'new');
insert into k values ('K2w', pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('k1-key-0001'), 'create', p_confirm => true));
select pg_temp.t('K2 confirmed create makes a SECOND contact (never merges) and converts',
  pg_temp.kv('K2w') like 'converted|%'
  and (select count(*) from public.plus_contacts where email = 'dup@example.test') = 2);

-- ================================================================= link: no overwrite, blanks only when asked, archived / foreign / redacted
insert into k values ('cPop', pg_temp.mkc('10000000-0000-0000-0000-0000000000a1', 'Fictional Populated', '404 555 0171', 'kept@example.test')::text);
insert into k values ('cBlank', pg_temp.mkc('10000000-0000-0000-0000-0000000000a1', 'Fictional Blank Email', '404 555 0172', null)::text);
insert into k values ('cBlank2', pg_temp.mkc('10000000-0000-0000-0000-0000000000a1', 'Fictional Blank Email 2', '404 555 0173', null)::text);
insert into k values ('cArch', pg_temp.mkc('10000000-0000-0000-0000-0000000000a1', 'Fictional Archived', '404 555 0174', null, false, 'archived')::text);
insert into k values ('cB', pg_temp.mkc('10000000-0000-0000-0000-0000000000b1', 'Fictional Org B Contact', '404 555 0175', null)::text);
select pg_temp.sub(pg_temp.kv('keyA'), 'm1-key-0001', 'Fictional Link One', '404 555 0171', 'other@example.test', p_cf => true);
insert into k values ('M1w', pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('m1-key-0001'), 'link', pg_temp.kv('cPop')::uuid, p_fill => true));
select pg_temp.t('M1 link with fill: populated phone / email are NEVER overwritten; email mismatch -> no email grant; voice matches -> granted',
  pg_temp.kv('M1w') = 'converted|1|email/service_followup:address_mismatch'
  and (select email = 'kept@example.test' and phone = '404 555 0171' from public.plus_contacts where id = pg_temp.kv('cPop')::uuid));
select pg_temp.sub(pg_temp.kv('keyA'), 'm2-key-0001', 'Fictional Link Two', '404 555 0172', 'filled@example.test', p_cf => true);
select pg_temp.sub(pg_temp.kv('keyA'), 'm2-key-0002', 'Fictional Link Three', '404 555 0173', 'notfilled@example.test', p_cf => true);
insert into k values ('M2a', pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('m2-key-0001'), 'link', pg_temp.kv('cBlank')::uuid, p_fill => true));
insert into k values ('M2b', pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('m2-key-0002'), 'link', pg_temp.kv('cBlank2')::uuid));
select pg_temp.t('M2 fill=true fills a BLANK email (audited) and its grant follows; fill=false leaves it blank (no_contact_address)',
  pg_temp.kv('M2a') = 'converted|2|'
  and (select email from public.plus_contacts where id = pg_temp.kv('cBlank')::uuid) = 'filled@example.test'
  and exists (select 1 from public.audit_events where action = 'plus_contact_updated' and entity_id = pg_temp.kv('cBlank')::uuid and after_data ->> 'source' = 'inquiry_conversion')
  and pg_temp.kv('M2b') = 'converted|1|email/service_followup:no_contact_address'
  and (select email from public.plus_contacts where id = pg_temp.kv('cBlank2')::uuid) is null);
select pg_temp.sub(pg_temp.kv('keyA'), 'm3-key-0001', 'Fictional Link Bad', '404 555 0176', null);
insert into k values ('cRed', pg_temp.mkc('10000000-0000-0000-0000-0000000000a1', 'Fictional Redact', '404 555 0177', null)::text);
update public.plus_contacts set status = 'redacted', display_name = 'Redacted contact', phone = null, email = null where id = pg_temp.kv('cRed')::uuid;
select pg_temp.t('M3 link to an archived contact ZW004, a foreign (Org B) contact ZW002, a redacted contact ZW002; nothing written',
  pg_temp.code(pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('m3-key-0001'), 'link', pg_temp.kv('cArch')::uuid)) = 'ZW004'
  and pg_temp.code(pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('m3-key-0001'), 'link', pg_temp.kv('cB')::uuid)) = 'ZW002'
  and pg_temp.code(pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('m3-key-0001'), 'link',
        (select id from public.plus_contacts where display_name = 'Redacted contact' and organization_id = '10000000-0000-0000-0000-0000000000a1' limit 1))) = 'ZW002'
  and (select status from public.plus_inquiries where id = pg_temp.inq('m3-key-0001')) = 'new');

-- ================================================================= L. do-not-contact precedence
insert into k values ('cDnc', pg_temp.mkc('10000000-0000-0000-0000-0000000000a1', 'Fictional DNC', '404 555 0181', 'dnc@example.test', true)::text);
select pg_temp.sub(pg_temp.kv('keyA'), 'p1-key-0001', 'Fictional DNC Asks', '404 555 0181', 'dnc@example.test', p_cf => true, p_cm => true);
select pg_temp.t('P1 linking a do-not-contact contact without acknowledgement is ZW004 and writes nothing',
  pg_temp.code(pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('p1-key-0001'), 'link', pg_temp.kv('cDnc')::uuid)) = 'ZW004'
  and (select status from public.plus_inquiries where id = pg_temp.inq('p1-key-0001')) = 'new'
  and not exists (select 1 from public.plus_opportunities where primary_contact_id = pg_temp.kv('cDnc')::uuid));
insert into k values ('P2w', pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('p1-key-0001'), 'link', pg_temp.kv('cDnc')::uuid, p_ack => true));
select pg_temp.t('P2 acknowledged: converted with ZERO consent rows (every ticked pair skipped do_not_contact); DNC stays on; ack audited',
  pg_temp.kv('P2w') = 'converted|0|email/service_followup:do_not_contact,voice/service_followup:do_not_contact,email/marketing:do_not_contact,voice/marketing:do_not_contact'
  and not exists (select 1 from public.plus_communication_consents where contact_id = pg_temp.kv('cDnc')::uuid)
  and (select do_not_contact from public.plus_contacts where id = pg_temp.kv('cDnc')::uuid)
  and (select (after_data ->> 'do_not_contact_acknowledged')::boolean from public.audit_events where action = 'plus_inquiry_converted' and entity_id = pg_temp.inq('p1-key-0001')));

-- ================================================================= stale / old evidence
insert into k values ('cRev', pg_temp.mkc('10000000-0000-0000-0000-0000000000a1', 'Fictional Revoked', '404 555 0191', 'rev@example.test')::text);
select pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
  'select r.changed::text from public.plus_revoke_consent(''10000000-0000-0000-0000-0000000000a1'', %L, ''email'', ''service_followup'', ''written'', null, ''Asked to stop (fictional)'', null, ''s7a-rev-0001'') r', pg_temp.kv('cRev')));
select pg_temp.sub(pg_temp.kv('keyA'), 'q1-key-0001', 'Fictional Stale', '404 555 0191', 'rev@example.test', p_cf => true);
update public.plus_inquiries set received_at = now() - interval '2 days' where id = pg_temp.inq('q1-key-0001');
select pg_temp.sub(pg_temp.kv('keyA'), 'q2-key-0001', 'Fictional Too Old', '404 555 0192', null, p_cf => true);
update public.plus_inquiries set received_at = now() - interval '400 days' where id = pg_temp.inq('q2-key-0001');
insert into k values ('Q1w', pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('q1-key-0001'), 'link', pg_temp.kv('cRev')::uuid));
select pg_temp.t('Q1 a submission older than the pair''s latest revocation is NOT granted (stale_evidence); the other channel is',
  pg_temp.kv('Q1w') = 'converted|1|email/service_followup:stale_evidence'
  and public._plus_effective_consent('10000000-0000-0000-0000-0000000000a1', pg_temp.kv('cRev')::uuid, 'email', 'service_followup') = 'no_consent_on_record');
select pg_temp.t('Q2 a submission older than 366 days is not granted (evidence_too_old)',
  pg_temp.conv('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', pg_temp.inq('q2-key-0001'), 'create') = 'converted|0|voice/service_followup:evidence_too_old');

-- ================================================================= M. S6 ledger compatibility
select pg_temp.t('S1 the S6 staff path still refuses captured_via web_form (ZW006) -- web_form rows come only from conversion',
  pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
    'select r.changed::text from public.plus_record_consent(''10000000-0000-0000-0000-0000000000a1'', %L, ''email'', ''marketing'', ''web_form'', null, null, null, ''s7a-webform-staff'') r', pg_temp.kv('cPop')))) = 'ZW006');
select pg_temp.t('S2 ledger CHECKs: web_form without inquiry_id / without text version, a web_form revocation and a staff row with a text version are all refused',
  (select bool_and(pg_temp.code(pg_temp.x('postgres', null, s)) = '23514') from (values
    (format('insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at, address_digest, consent_text_version, idempotency_key, recorded_by) values (''10000000-0000-0000-0000-0000000000a1'', %L, ''email'', ''marketing'', ''granted'', ''web_form'', now(), repeat(''a'', 64), ''plus-inquiry-consent-v1'', ''s7a-chk-0001'', ''20000000-0000-0000-0000-0000000000a1'') returning ''x''', pg_temp.kv('cPop'))),
    (format('insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at, address_digest, inquiry_id, idempotency_key, recorded_by) values (''10000000-0000-0000-0000-0000000000a1'', %L, ''voice'', ''marketing'', ''granted'', ''web_form'', now(), repeat(''a'', 64), %L, ''s7a-chk-0002'', ''20000000-0000-0000-0000-0000000000a1'') returning ''x''', pg_temp.kv('cPop'), pg_temp.inq('m1-key-0001'))),
    (format('insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at, consent_text_version, inquiry_id, idempotency_key, recorded_by) values (''10000000-0000-0000-0000-0000000000a1'', %L, ''voice'', ''marketing'', ''revoked'', ''web_form'', now(), ''plus-inquiry-consent-v1'', %L, ''s7a-chk-0003'', ''20000000-0000-0000-0000-0000000000a1'') returning ''x''', pg_temp.kv('cPop'), pg_temp.inq('m1-key-0001'))),
    (format('insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at, address_digest, consent_text_version, idempotency_key, recorded_by) values (''10000000-0000-0000-0000-0000000000a1'', %L, ''email'', ''marketing'', ''granted'', ''written'', now(), repeat(''a'', 64), ''plus-inquiry-consent-v1'', ''s7a-chk-0004'', ''20000000-0000-0000-0000-0000000000a1'') returning ''x''', pg_temp.kv('cPop')))) v(s)));
select pg_temp.t('S3 a web_form row can only cite an inquiry converted to THE SAME contact (composite FK, 23503)',
  pg_temp.code(pg_temp.x('postgres', null, format('insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at, address_digest, consent_text_version, inquiry_id, idempotency_key, recorded_by) values (''10000000-0000-0000-0000-0000000000a1'', %L, ''voice'', ''marketing'', ''granted'', ''web_form'', now(), repeat(''a'', 64), ''plus-inquiry-consent-v1'', %L, ''s7a-chk-0005'', ''20000000-0000-0000-0000-0000000000a1'') returning ''x''',
    pg_temp.kv('cBlank'), pg_temp.inq('m1-key-0001')))) = '23503');
select pg_temp.t('S4 web_form rows are append-only like every ledger row (UPDATE / DELETE -> ZW004)',
  pg_temp.code(pg_temp.x('postgres', null, format('update public.plus_communication_consents set evidence_note = ''x'' where inquiry_id = %L returning ''x''', pg_temp.inq('j1-key-0001')))) = 'ZW004'
  and pg_temp.code(pg_temp.x('postgres', null, format('delete from public.plus_communication_consents where inquiry_id = %L returning ''x''', pg_temp.inq('j1-key-0001')))) = 'ZW004');
insert into k values ('S5w', pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
    'select ''ok:'' || r.changed from public.plus_contacts c, lateral public.plus_update_contact(c.organization_id, c.id, c.updated_at, c.display_name, c.phone, c.email, c.contact_kind, c.job_title, c.preferred_channel, true, null) r where c.id = %L',
    (select contact_id from public.plus_inquiries where id = pg_temp.inq('j1-key-0001')))));
select pg_temp.t('S5 switching DNC on after a conversion revokes the web_form grants (ZD-233 unchanged)',
  pg_temp.kv('S5w') = 'ok:true'
  and (select count(*) from (select distinct on (channel, purpose) status from public.plus_communication_consents
        where contact_id = (select contact_id from public.plus_inquiries where id = pg_temp.inq('j1-key-0001')) order by channel, purpose, seq desc) l
       where status = 'granted') = 0);

-- ================================================================= opportunity link integrity
-- an opportunity without an inquiry (own fixture: a fresh seed has none)
with x as (
  insert into public.plus_opportunities (organization_id, title, primary_contact_id, source, created_by)
  values ('10000000-0000-0000-0000-0000000000a1', 'Fictional manual opportunity', pg_temp.kv('cPop')::uuid, 'phone', '20000000-0000-0000-0000-0000000000a1')
  returning id)
insert into k select 'oppNoInq', id::text from x;
select pg_temp.t('R1 inquiry_id is set once (change -> ZW004) and unique (a second opportunity with it -> 23505)',
  pg_temp.code(pg_temp.x('postgres', null, format('update public.plus_opportunities set inquiry_id = %L where inquiry_id = %L returning ''x''', pg_temp.inq('j5-key-0001'), pg_temp.inq('j1-key-0001')))) = 'ZW004'
  and pg_temp.code(pg_temp.x('postgres', null, format('update public.plus_opportunities set inquiry_id = %L where id = %L returning ''x''', pg_temp.inq('j1-key-0001'), pg_temp.kv('oppNoInq')))) = '23505');

-- ================================================================= N. service-type compatibility (refinement C)
insert into public.organization_service_offerings (organization_id, service_type) values
  ('10000000-0000-0000-0000-0000000000a1', 'dialysis'), ('10000000-0000-0000-0000-0000000000a1', 'airport_transportation');
select pg_temp.t('N2 options = eight Plus types INTERSECT the organization''s offerings: airport offered by the org is still never an option',
  pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', 'select array_to_string(service_options, '','') from public.plus_get_inquiry_form(''10000000-0000-0000-0000-0000000000a1'')') = 'dialysis');
select pg_temp.t('N3 a service the form offers but the organization no longer does is refused at submission; public config hides it',
  pg_temp.sub(pg_temp.kv('keyA'), 'n3-key-0001', 'Fictional Svc', '404 555 0201', null, p_service => 'medical_appointment') = 'invalid:false'
  and pg_temp.sub(pg_temp.kv('keyA'), 'n3-key-0002', 'Fictional Svc 2', '404 555 0202', null, p_service => 'dialysis') = 'accepted:true'
  and pg_temp.x('service_role', null, format('select array_to_string(service_types, '','') from public.get_public_plus_inquiry_form(%L)', pg_temp.kv('keyA'))) = 'dialysis');
select pg_temp.t('N4 saving a service the organization does not offer is ZW006',
  pg_temp.code(pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
    'select r.changed::text from public.plus_save_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', ''Ask us anything'', null, array[''medical_appointment''], %s) r', pg_temp.fver('10000000-0000-0000-0000-0000000000a1')))) = 'ZW006');

-- ================================================================= form edit / disable / re-publish
insert into k values ('E8a', pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format(
    'select r.config_version::text from public.plus_save_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', ''Questions welcome'', ''Fictional intro'', array[''dialysis''], %s) r', pg_temp.fver('10000000-0000-0000-0000-0000000000a1'))));
insert into k values ('E8b', pg_temp.sub(pg_temp.kv('keyA'), 'e8-key-0001', 'Old Page', '404 555 0211', null, p_ver => 1));
insert into k values ('E8c', pg_temp.sub(pg_temp.kv('keyA'), 'e8-key-0002', 'New Page', '404 555 0212', null));
select pg_temp.t('E8 a live edit increments config_version; a person on the old version gets form_changed',
  pg_temp.kv('E8a') = '2' and pg_temp.kv('E8b') = 'form_changed:false' and pg_temp.kv('E8c') = 'accepted:true'
  and (select form_config_version from public.plus_inquiries where idempotency_key = 'e8-key-0002') = 2);
select pg_temp.t('E9 disable stops the public form at once (same key kept); re-publish restores it; disabling a draft is ZW004',
  pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select r.status from public.plus_disable_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', %s) r', pg_temp.fver('10000000-0000-0000-0000-0000000000a1'))) = 'disabled'
  and pg_temp.sub(pg_temp.kv('keyA'), 'e9-key-0001', 'After Disable', '404 555 0221', null) = 'unavailable:false'
  and pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select r.status from public.plus_publish_inquiry_form(''10000000-0000-0000-0000-0000000000a1'', %s) r', pg_temp.fver('10000000-0000-0000-0000-0000000000a1'))) = 'published'
  and (select public_key from public.plus_inquiry_forms where organization_id = '10000000-0000-0000-0000-0000000000a1') = pg_temp.kv('keyA')
  and pg_temp.code((select pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000b1', 'select r.status from public.plus_disable_inquiry_form(''10000000-0000-0000-0000-0000000000b1'', 1) r')
        from (select pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000b1', 'select r.status from public.plus_save_inquiry_form(''10000000-0000-0000-0000-0000000000b1'', ''B form'', null, ''{}'', null) r')) s)) = 'ZW004');
select pg_temp.t('E10 removing the allowlist entry makes a PUBLISHED form unavailable immediately (Platform Admin, audited)',
  pg_temp.x('authenticated', '20000000-0000-0000-0000-0000000000d1',
    'select (public.platform_set_plus_inquiry_public_access(''10000000-0000-0000-0000-0000000000a1'', false, ''End of synthetic test'')).changed::text') = 'true'
  and pg_temp.sub(pg_temp.kv('keyA'), 'e10-key-0001', 'After Removal', '404 555 0231', null) = 'unavailable:false'
  and pg_temp.x('service_role', null, format('select count(*)::text from public.get_public_plus_inquiry_form(%L)', pg_temp.kv('keyA'))) = '0');

-- ================================================================= O. no Core side effects across the whole run
select pg_temp.t('O2 across every submission and conversion above: no Core Request, Passenger, Trip or notification was created',
  pg_temp.core_counts() = pg_temp.kv('core0'));

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' from k_results;
select n, name, detail from k_results where not ok order by n;
rollback;
