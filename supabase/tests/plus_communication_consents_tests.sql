-- Nemryn Plus -- communication consent ledger tests (NP-P2-S6-A). ROLLBACK-ONLY (one transaction, rolled back at the end).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_communication_consents_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261023100000_plus_communication_consents.sql (design: docs/product/NP-P2-S6-consent-ledger-design.md, tests
-- P1-P23 in section 7.1; decisions ZD-228 .. ZD-242). Fictional seed fixtures only: Org A admin a1, dispatcher a2, driver
-- a3, inactive dispatcher a5; Org B admin b1; c1 = admin in A + driver in B; d1 = platform admin (no membership); e1 = no
-- membership. Contacts are owner-level fixtures; entitlement and grants are owner-level fixtures (covered elsewhere).
-- Inside one transaction now() is constant: ordering is by seq, and "older evidence" is simulated with explicit times.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table k_results (n serial, name text, ok boolean, detail text);

-- run p_stmt as a role / uid; returns its single text value, or 'ERR:<sqlstate>:<message>'
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

create function pg_temp.mid(p_org uuid, p_uid uuid) returns uuid language sql as $$
  select id from public.memberships where organization_id = p_org and user_id = p_uid;
$$;

create function pg_temp.set_state(p_org uuid, p_state text)
returns void language plpgsql as $$
begin
  delete from public.organization_modules where organization_id = p_org;
  if p_state = 'none' then return; end if;
  insert into public.organization_modules (organization_id, module, status, restriction, trial_started_at, trial_ends_at, access_ends_at, status_reason)
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, null, 'S6-A consents test'
  from (values
    ('trial',     'trial',     null,        now() - interval '1 day',   now() + interval '13 days'),
    ('active',    'active',    null,        null::timestamptz,          null::timestamptz),
    ('expired',   'expired',   null,        now() - interval '20 days', now() - interval '6 days'),
    ('locked',    'disabled',  'no_access', null,                       null)
  ) as s(name, status, restriction, ts, te)
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

-- owner-level contact fixture
create function pg_temp.mkc(p_org uuid, p_name text, p_phone text, p_email text, p_dnc boolean default false)
returns uuid language sql as $$
  insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, do_not_contact, created_by)
  values (p_org, p_name, p_phone, p_email, 'individual', p_dnc,
          (select user_id from public.memberships where organization_id = p_org and role = 'organization_admin' order by created_at limit 1))
  returning id;
$$;

-- record / revoke as a caller -> 'ok:<changed>,<recorded>,<effective>' or 'ERR:<code>:<message>'
create function pg_temp.rec(p_fn text, p_uid uuid, p_org uuid, p_contact uuid, p_ch text, p_pu text, p_key text,
                            p_via text default 'verbal_phone', p_at timestamptz default null, p_note text default null,
                            p_corrects uuid default null)
returns text language sql as $$
  select pg_temp.x('authenticated', p_uid, format(
    'select ''ok:'' || r.changed || '','' || r.recorded_status || '','' || r.effective_status from public.%I(%L::uuid, %L::uuid, %L, %L, %L, %L::timestamptz, %L, %L::uuid, %L) r',
    p_fn, p_org, p_contact, p_ch, p_pu, p_via, p_at, p_note, p_corrects, p_key));
$$;
create function pg_temp.g(p_uid uuid, p_org uuid, p_contact uuid, p_ch text, p_pu text, p_key text,
                          p_via text default 'verbal_phone', p_at timestamptz default null, p_note text default null,
                          p_corrects uuid default null)
returns text language sql as $$ select pg_temp.rec('plus_record_consent', p_uid, p_org, p_contact, p_ch, p_pu, p_key, p_via, p_at, p_note, p_corrects); $$;
create function pg_temp.rv(p_uid uuid, p_org uuid, p_contact uuid, p_ch text, p_pu text, p_key text,
                           p_via text default 'verbal_phone', p_at timestamptz default null, p_note text default null,
                           p_corrects uuid default null)
returns text language sql as $$ select pg_temp.rec('plus_revoke_consent', p_uid, p_org, p_contact, p_ch, p_pu, p_key, p_via, p_at, p_note, p_corrects); $$;

-- the 6-row state as a caller: 'ch/pu=recorded>effective;...' or ERR
create function pg_temp.st(p_uid uuid, p_org uuid, p_contact uuid)
returns text language sql as $$
  select pg_temp.x('authenticated', p_uid, format(
    'select string_agg(channel || ''/'' || purpose || ''='' || recorded_status || ''>'' || effective_status, '';'') from public.plus_get_contact_consents(%L::uuid, %L::uuid)',
    p_org, p_contact));
$$;
-- one pair's effective state through the internal resolver (owner)
create function pg_temp.eff(p_org uuid, p_contact uuid, p_ch text, p_pu text) returns text language sql as $$
  select public._plus_effective_consent(p_org, p_contact, p_ch, p_pu);
$$;
-- history as a caller: 'n|status:via,...' newest first, or ERR
create function pg_temp.hist(p_uid uuid, p_org uuid, p_contact uuid, p_limit integer default 50, p_offset integer default 0)
returns text language sql as $$
  select pg_temp.x('authenticated', p_uid, format(
    'select coalesce(max(total_count)::text, ''0'') || ''|'' || coalesce(string_agg(channel || ''/'' || purpose || '':'' || status || '':'' || captured_via, '','' order by rn), '''') from (select *, row_number() over () rn from public.plus_list_contact_consent_events(%L::uuid, %L::uuid, %L, %L)) h',
    p_org, p_contact, p_limit, p_offset));
$$;
-- direct RLS read (permitted columns only) as a caller: number of visible consent rows of an organization
create function pg_temp.rls(p_uid uuid, p_org uuid) returns text language sql as $$
  select pg_temp.x('authenticated', p_uid, format('select count(id)::text from public.plus_communication_consents where organization_id = %L', p_org));
$$;
-- change ONLY do_not_contact through the released plus_update_contact, as a caller
create function pg_temp.dnc(p_uid uuid, p_org uuid, p_contact uuid, p_dnc boolean) returns text language plpgsql as $$
declare c public.plus_contacts%rowtype;
begin
  select * into c from public.plus_contacts where id = p_contact;
  return pg_temp.x('authenticated', p_uid, format(
    'select ''ok:'' || r.changed from public.plus_update_contact(%L::uuid, %L::uuid, %L::timestamptz, %L, %L, %L, %L, %L, %L, %L::boolean, null::uuid) r',
    p_org, p_contact, c.updated_at, c.display_name, c.phone, c.email, c.contact_kind, c.job_title, c.preferred_channel, p_dnc));
end;
$$;
create function pg_temp.edit(p_uid uuid, p_org uuid, p_contact uuid, p_name text, p_phone text, p_email text, p_channel text, p_dnc boolean)
returns text language plpgsql as $$
declare c public.plus_contacts%rowtype;
begin
  select * into c from public.plus_contacts where id = p_contact;
  return pg_temp.x('authenticated', p_uid, format(
    'select ''ok:'' || r.changed from public.plus_update_contact(%L::uuid, %L::uuid, %L::timestamptz, %L, %L, %L, %L, %L, %L, %L::boolean, null::uuid) r',
    p_org, p_contact, c.updated_at, p_name, p_phone, p_email, c.contact_kind, c.job_title, p_channel, p_dnc));
end;
$$;
create function pg_temp.n(p_contact uuid, p_ch text default null, p_pu text default null) returns bigint language sql as $$
  select count(*) from public.plus_communication_consents
  where contact_id = p_contact and (p_ch is null or channel = p_ch) and (p_pu is null or purpose = p_pu);
$$;
create function pg_temp.naudit(p_contact uuid, p_action text) returns bigint language sql as $$
  select count(*) from public.audit_events where entity_id = p_contact and action = p_action;
$$;
-- everything outside the ledger that a consent write must never touch
create function pg_temp.side() returns text language sql as $$
  select (select count(*) from public.transportation_requests) || '/' || (select count(*) from public.trips) || '/' || (select count(*) from public.passengers)
    || '/' || (select count(*) from public.trip_assignments) || '/' || (select count(*) from public.notification_events)
    || '/' || (select count(*) from public.plus_tasks) || '/' || (select count(*) from public.plus_activities)
    || '/' || (select count(*) from public.plus_opportunities) || '/' || (select count(*) from public.plus_quotes)
    || '/' || (select md5(coalesce(string_agg(c::text, '|' order by c.id), '')) from public.plus_contacts c);
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
  t_tbl constant regclass := 'public.plus_communication_consents'::regclass;
  v text; v2 text; v_side text; v_k1 uuid; v_k2 uuid; v_k3 uuid; v_k4 uuid; v_kb uuid; v_id uuid; v_id2 uuid; v_n bigint;
  v_n2 bigint; v_seq bigint; v_ok boolean; v_cols text;
begin
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_state(c_b, 'active');
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  v_k1 := pg_temp.mkc(c_a, 'S6 Kim Fictional', '(404) 555-0181', 'kim.s6@example.test');
  v_k2 := pg_temp.mkc(c_a, 'S6 Lee Fictional', '404-555-0182', null);              -- phone only
  v_k3 := pg_temp.mkc(c_a, 'S6 Max Fictional', null, 'max.s6@example.test');        -- email only
  v_k4 := pg_temp.mkc(c_a, 'S6 Ana Fictional', '404 555 0184', 'ana.s6@example.test', true);  -- do not contact
  v_kb := pg_temp.mkc(c_b, 'S6 Org B Fictional', '404 555 0185', 'orgb.s6@example.test');
  v_side := pg_temp.side();

  -- =================================================== schema / privileges (items 1-4, 18, 23)
  perform pg_temp.t('S1 RLS on; exactly one policy: SELECT TO authenticated USING plus_can_read(organization_id)',
    (select relrowsecurity from pg_class where oid = t_tbl)
    and (select count(*) from pg_policy where polrelid = t_tbl) = 1
    and exists (select 1 from pg_policy where polrelid = t_tbl and polcmd = 'r' and polroles = array['authenticated'::regrole]::oid[]
                and pg_get_expr(polqual, polrelid) ~ 'plus_can_read\(organization_id\)'));
  perform pg_temp.t('S2 no TABLE-level privilege of any kind for anon / authenticated / service_role / PUBLIC (P3)',
    not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(r),
                  (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(p)
                where has_table_privilege(r.r, t_tbl, p.p))
    and not exists (select 1 from pg_class c, lateral aclexplode(c.relacl) x where c.oid = t_tbl and x.grantee = 0));
  v_cols := (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
             where a.attrelid = t_tbl and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', t_tbl, a.attname, 'SELECT'));
  perform pg_temp.t('S3 authenticated column SELECT = every column EXCEPT address_digest / idempotency_key; no column INSERT / UPDATE; anon / service_role none (ZD-240)',
    v_cols = 'captured_at,captured_via,channel,consent_text_version,contact_id,corrects_consent_id,evidence_note,id,organization_id,purpose,recorded_at,recorded_by,seq,status'
    and not exists (select 1 from pg_attribute a where a.attrelid = t_tbl and a.attnum > 0 and not a.attisdropped
                    and (has_column_privilege('authenticated', t_tbl, a.attname, 'INSERT') or has_column_privilege('authenticated', t_tbl, a.attname, 'UPDATE')
                         or has_column_privilege('anon', t_tbl, a.attname, 'SELECT') or has_column_privilege('service_role', t_tbl, a.attname, 'SELECT'))), v_cols);
  perform pg_temp.t('S4 tenant-isolating composite FKs: (contact_id, organization_id) -> plus_contacts; (corrects_consent_id, organization_id, contact_id) -> self',
    exists (select 1 from pg_constraint where conrelid = t_tbl and conname = 'plus_consents_contact_fkey' and confrelid = 'public.plus_contacts'::regclass
            and pg_get_constraintdef(oid) ~ 'FOREIGN KEY \(contact_id, organization_id\) REFERENCES plus_contacts\(id, organization_id\)')
    and exists (select 1 from pg_constraint where conrelid = t_tbl and conname = 'plus_consents_corrects_fkey' and confrelid = t_tbl
            and pg_get_constraintdef(oid) ~ 'FOREIGN KEY \(corrects_consent_id, organization_id, contact_id\) REFERENCES plus_communication_consents\(id, organization_id, contact_id\)'));
  perform pg_temp.t('S5 P22 every FK targets organizations / auth.users / plus_contacts / this table only (no Core, no future table); no json / jsonb column',
    (select bool_and(confrelid::regclass::text in ('organizations', 'public.organizations', 'auth.users', 'plus_contacts', 'public.plus_contacts',
                                                   'plus_communication_consents', 'public.plus_communication_consents'))
       from pg_constraint where contype = 'f' and conrelid = t_tbl)
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plus_communication_consents' and data_type in ('json', 'jsonb')));
  perform pg_temp.t('S6 named constraints for additive replacement exist (channel, purpose, status, captured_via, text_version, dnc, granted_address)',
    (select count(*) from pg_constraint where conrelid = t_tbl and conname in ('plus_consents_channel_check', 'plus_consents_purpose_check',
       'plus_consents_status_check', 'plus_consents_captured_via_check', 'plus_consents_text_version_check', 'plus_consents_dnc_check',
       'plus_consents_granted_address_check', 'plus_consents_idempotency_key', 'plus_consents_seq_key')) = 9
    and (select attidentity from pg_attribute where attrelid = t_tbl and attname = 'seq') = 'a');
  perform pg_temp.t('S7 append-only triggers: BEFORE UPDATE OR DELETE (row) and BEFORE TRUNCATE (statement), enabled',
    (select count(*) from pg_trigger where tgrelid = t_tbl and not tgisinternal and tgenabled = 'O'
       and tgname in ('plus_consents_append_only', 'plus_consents_no_truncate')) = 2);
  perform pg_temp.t('S8 EXECUTE: the 4 RPCs authenticated only; internals (resolver, digest, append, DNC step, trigger) no client role (P23)',
    (select bool_and(has_function_privilege('authenticated', p, 'execute') and not has_function_privilege('anon', p, 'execute')
                     and not has_function_privilege('service_role', p, 'execute'))
       from unnest(array['public.plus_get_contact_consents(uuid,uuid)', 'public.plus_list_contact_consent_events(uuid,uuid,integer,integer)',
                         'public.plus_record_consent(uuid,uuid,text,text,text,timestamptz,text,uuid,text)',
                         'public.plus_revoke_consent(uuid,uuid,text,text,text,timestamptz,text,uuid,text)']::regprocedure[]) p)
    and (select bool_and(not has_function_privilege(r, p, 'execute'))
       from unnest(array['public._plus_effective_consent(uuid,uuid,text,text)', 'public._plus_consent_address_digest(uuid,text,text,text)',
                         'public._plus_append_consent(text,uuid,uuid,text,text,text,timestamptz,text,uuid,text)',
                         'public._plus_consents_revoke_for_dnc(uuid,uuid)', 'public._plus_consents_append_only()']::regprocedure[]) p,
            unnest(array['anon', 'authenticated', 'service_role']) r));
  perform pg_temp.t('S9 every new SECURITY DEFINER function pins search_path = public, pg_temp',
    (select bool_and(proconfig @> array['search_path=public, pg_temp']) from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('plus_get_contact_consents', 'plus_list_contact_consent_events',
        'plus_record_consent', 'plus_revoke_consent', '_plus_effective_consent', '_plus_append_consent', '_plus_consents_revoke_for_dnc',
        '_plus_consent_address_digest', '_plus_consents_append_only', 'plus_update_contact')));
  perform pg_temp.t('S10 P6 no actor / time / order / digest / status parameter exists; a named call adding one fails (42883)',
    (select string_agg(n, ',') from unnest((select proargnames from pg_proc where oid = 'public.plus_record_consent(uuid,uuid,text,text,text,timestamptz,text,uuid,text)'::regprocedure)) n)
      = 'p_organization_id,p_contact_id,p_channel,p_purpose,p_captured_via,p_captured_at,p_evidence_note,p_corrects_consent_id,p_idempotency_key'
    and (select proargnames from pg_proc where oid = 'public.plus_revoke_consent(uuid,uuid,text,text,text,timestamptz,text,uuid,text)'::regprocedure)
      = (select proargnames from pg_proc where oid = 'public.plus_record_consent(uuid,uuid,text,text,text,timestamptz,text,uuid,text)'::regprocedure)
    and pg_temp.code(pg_temp.x('authenticated', c_a1, format(
      'select r.consent_id::text from public.plus_record_consent(p_organization_id => %L, p_contact_id => %L, p_channel => ''email'', p_purpose => ''marketing'', p_captured_via => ''written'', p_captured_at => null, p_evidence_note => null, p_corrects_consent_id => null, p_idempotency_key => ''s6key-forge-0001'', p_recorded_by => %L) r',
      c_a, v_k1, c_b1))) = '42883'
    and pg_temp.n(v_k1) = 0);
  perform pg_temp.t('S11 plus_update_contact keeps its released signature and grants (authenticated only)',
    to_regprocedure('public.plus_update_contact(uuid,uuid,timestamptz,text,text,text,text,text,text,boolean,uuid)') is not null
    and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'plus_update_contact') = 1
    and has_function_privilege('authenticated', 'public.plus_update_contact(uuid,uuid,timestamptz,text,text,text,text,text,text,boolean,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.plus_update_contact(uuid,uuid,timestamptz,text,text,text,text,text,text,boolean,uuid)', 'execute'));
  perform pg_temp.t('S12 P9 read RPC result columns are exactly the allow-list (no digest, key or note in the state RPC)',
    pg_get_function_result('public.plus_get_contact_consents(uuid,uuid)'::regprocedure)
      = 'TABLE(channel text, purpose text, recorded_status text, effective_status text, latest_consent_id uuid, captured_via text, captured_at timestamp with time zone, recorded_at timestamp with time zone, recorded_by_name text, is_correction boolean)'
    and pg_get_function_result('public.plus_list_contact_consent_events(uuid,uuid,integer,integer)'::regprocedure)
      = 'TABLE(id uuid, channel text, purpose text, status text, captured_via text, captured_at timestamp with time zone, recorded_at timestamp with time zone, recorded_by_name text, evidence_note text, corrects_consent_id uuid, total_count bigint)');

  -- =================================================== record / read happy path (Admin, Plus active)
  v := pg_temp.g(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-k1-email-mkt-1', 'verbal_phone', now() - interval '2 days', 'Said yes on the call');
  perform pg_temp.t('H1 Admin records a grant: changed, granted, consent_on_record', v = 'ok:true,granted,consent_on_record', v);
  select * into v_id from (select id from public.plus_communication_consents where contact_id = v_k1 order by seq desc limit 1) z;
  perform pg_temp.t('H2 server-set fields: recorded_by = caller, recorded_at = now(), captured_at as given, digest = the R1 domain-separated SHA-256',
    (select recorded_by = c_a1 and recorded_at = now() and captured_at = now() - interval '2 days' and captured_via = 'verbal_phone'
            and evidence_note = 'Said yes on the call' and corrects_consent_id is null and consent_text_version is null
            and address_digest = encode(sha256(convert_to('nemryn.plus.consent-address.v1|' || c_a::text || '|email|kim.s6@example.test', 'UTF8')), 'hex')
     from public.plus_communication_consents where id = v_id));
  perform pg_temp.t('H3 state: 6 rows in fixed order; only email/marketing granted; everything else none > no_consent_on_record',
    pg_temp.st(c_a1, c_a, v_k1) = 'email/service_followup=none>no_consent_on_record;email/marketing=granted>consent_on_record;sms/service_followup=none>no_consent_on_record;sms/marketing=none>no_consent_on_record;voice/service_followup=none>no_consent_on_record;voice/marketing=none>no_consent_on_record');
  perform pg_temp.t('H4 audit: exactly one plus_consent_granted row with consent id / channel / purpose / method / correction -- no note, address, digest or key (item 15)',
    pg_temp.naudit(v_k1, 'plus_consent_granted') = 1
    and (select after_data = jsonb_build_object('consent_id', v_id, 'channel', 'email', 'purpose', 'marketing', 'captured_via', 'verbal_phone', 'correction', false)
                and actor_user_id = c_a1 and entity_type = 'plus_contact' and before_data is null
         from public.audit_events where entity_id = v_k1 and action = 'plus_consent_granted'));
  v := pg_temp.g(c_a1, c_a, v_k1, 'sms', 'service_followup', 's6key-k1-sms-sf-1');
  v2 := pg_temp.g(c_a1, c_a, v_k1, 'voice', 'service_followup', 's6key-k1-voice-sf-1', 'in_person');
  perform pg_temp.t('H5 SMS and voice grants bind the phone digits (sms and voice share the phone digest; email differs)',
    v = 'ok:true,granted,consent_on_record' and v2 = 'ok:true,granted,consent_on_record'
    and (select count(distinct address_digest) from public.plus_communication_consents where contact_id = v_k1 and channel in ('sms', 'voice')) = 1
    and (select address_digest from public.plus_communication_consents where contact_id = v_k1 and channel = 'sms')
        = encode(sha256(convert_to('nemryn.plus.consent-address.v1|' || c_a::text || '|phone|4045550181', 'UTF8')), 'hex'));
  perform pg_temp.t('H6 history: newest first by seq, total_count, notes visible to a writer',
    pg_temp.hist(c_a1, c_a, v_k1) = '3|voice/service_followup:granted:in_person,sms/service_followup:granted:verbal_phone,email/marketing:granted:verbal_phone'
    and pg_temp.x('authenticated', c_a1, format('select evidence_note from public.plus_list_contact_consent_events(%L, %L, 50, 0) where channel = ''email''', c_a, v_k1)) = 'Said yes on the call'
    and pg_temp.hist(c_a1, c_a, v_k1, 1, 1) = '3|sms/service_followup:granted:verbal_phone');

  -- =================================================== P1 / P2 cross-tenant
  perform pg_temp.g(c_b1, c_b, v_kb, 'email', 'marketing', 's6key-kb-email-mkt-1');
  perform pg_temp.t('P1 cross-tenant read: Org B admin sees 0 Org A rows; Org A read RPCs with Org B ids -> ZW002; Org A admin sees 0 Org B rows',
    pg_temp.rls(c_b1, c_a) = '0' and pg_temp.rls(c_a1, c_b) = '0'
    and pg_temp.code(pg_temp.st(c_b1, c_a, v_k1)) = 'ZW002' and pg_temp.code(pg_temp.hist(c_b1, c_a, v_k1)) = 'ZW002'
    and pg_temp.code(pg_temp.st(c_a1, c_b, v_kb)) = 'ZW002'
    and pg_temp.code(pg_temp.st(c_a1, c_a, v_kb)) = 'ZW002' and pg_temp.code(pg_temp.hist(c_a1, c_a, v_kb)) = 'ZW002');
  v_n := pg_temp.n(v_kb); v_n2 := pg_temp.n(v_k1);
  perform pg_temp.t('P2 cross-tenant mutation: Org A writer with Org B org, with Org A org + Org B contact, Org B writer with Org A contact -> ZW002; nothing written',
    pg_temp.code(pg_temp.g(c_a1, c_b, v_kb, 'email', 'service_followup', 's6key-x-1')) = 'ZW002'
    and pg_temp.code(pg_temp.rv(c_a1, c_b, v_kb, 'email', 'marketing', 's6key-x-2')) = 'ZW002'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_kb, 'email', 'service_followup', 's6key-x-3')) = 'ZW002'
    and pg_temp.code(pg_temp.rv(c_a1, c_a, v_kb, 'email', 'marketing', 's6key-x-4')) = 'ZW002'
    and pg_temp.code(pg_temp.g(c_b1, c_b, v_k1, 'email', 'service_followup', 's6key-x-5')) = 'ZW002'
    and pg_temp.code(pg_temp.rv(c_b1, c_b, v_k1, 'email', 'marketing', 's6key-x-6')) = 'ZW002'
    and pg_temp.n(v_kb) = v_n and pg_temp.n(v_k1) = v_n2);
  begin
    insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at,
                                                    address_digest, idempotency_key, recorded_by)
    values (c_b, v_k1, 'email', 'marketing', 'granted', 'written', now(), repeat('a', 64), 's6key-fk-mixed-1', c_b1);
    perform pg_temp.t('P2b mixed-tenant row (Org B org + Org A contact) is impossible even for the owner (composite FK)', false);
  exception when foreign_key_violation then perform pg_temp.t('P2b mixed-tenant row (Org B org + Org A contact) is impossible even for the owner (composite FK)', true);
  end;
  begin
    insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at,
                                                    address_digest, evidence_note, corrects_consent_id, idempotency_key, recorded_by)
    values (c_a, v_k3, 'email', 'marketing', 'granted', 'written', now(), repeat('a', 64), 'x', v_id, 's6key-fk-corr-1', c_a1);
    perform pg_temp.t('P5b a correction pointing at another contact''s row is impossible even for the owner (composite self FK)', false);
  exception when foreign_key_violation then perform pg_temp.t('P5b a correction pointing at another contact''s row is impossible even for the owner (composite self FK)', true);
  end;

  -- =================================================== P3 / P4 direct writes and append-only
  perform pg_temp.t('P3 direct DML: authenticated / anon INSERT, UPDATE, DELETE, TRUNCATE and SELECT of hidden columns -> 42501',
    pg_temp.code(pg_temp.x('authenticated', c_a1, format('insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at, address_digest, idempotency_key, recorded_by) values (%L, %L, ''email'', ''service_followup'', ''granted'', ''written'', now(), repeat(''a'', 64), ''s6key-direct-1'', %L) returning id::text', c_a, v_k1, c_a1))) = '42501'
    and pg_temp.code(pg_temp.x('authenticated', c_a1, format('update public.plus_communication_consents set status = ''revoked'' where id = %L returning id::text', v_id))) = '42501'
    and pg_temp.code(pg_temp.x('authenticated', c_a1, format('delete from public.plus_communication_consents where id = %L returning id::text', v_id))) = '42501'
    and pg_temp.code(pg_temp.x('authenticated', c_a1, 'truncate public.plus_communication_consents')) = '42501'
    and pg_temp.code(pg_temp.x('authenticated', c_a1, 'select count(address_digest)::text from public.plus_communication_consents')) = '42501'
    and pg_temp.code(pg_temp.x('authenticated', c_a1, 'select count(idempotency_key)::text from public.plus_communication_consents')) = '42501'
    and pg_temp.code(pg_temp.x('anon', null, 'select count(id)::text from public.plus_communication_consents')) = '42501'
    and pg_temp.code(pg_temp.x('anon', null, format('insert into public.plus_communication_consents (organization_id) values (%L) returning id::text', c_a))) = '42501');
  v_ok := true;
  begin update public.plus_communication_consents set status = 'revoked' where id = v_id; v_ok := false;
  exception when sqlstate 'ZW004' then null; end;
  begin delete from public.plus_communication_consents where id = v_id; v_ok := false;
  exception when sqlstate 'ZW004' then null; end;
  begin truncate public.plus_communication_consents; v_ok := false;
  exception when sqlstate 'ZW004' then null; end;
  begin truncate public.plus_contacts cascade; v_ok := false;
  exception when sqlstate 'ZW004' then null; end;
  perform pg_temp.t('P4 owner-level UPDATE / DELETE / TRUNCATE (also via TRUNCATE plus_contacts CASCADE) -> ZW004 append_only; row unchanged (item 1, T20)',
    v_ok and (select status = 'granted' from public.plus_communication_consents where id = v_id) and pg_temp.n(v_k1) = 3);
  perform pg_temp.t('P4b T20: no public function other than the trigger guard mentions UPDATE or DELETE of plus_communication_consents',
    not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                and prosrc ~* '(update|delete\s+from)\s+(public\.)?plus_communication_consents'));

  -- =================================================== authorization matrix (item 5)
  perform pg_temp.t('A1 Dispatcher without a grant: read RPCs / RLS / record / revoke -> ZW002 / 0',
    pg_temp.code(pg_temp.st(c_a2, c_a, v_k1)) = 'ZW002' and pg_temp.code(pg_temp.hist(c_a2, c_a, v_k1)) = 'ZW002' and pg_temp.rls(c_a2, c_a) = '0'
    and pg_temp.code(pg_temp.g(c_a2, c_a, v_k1, 'email', 'service_followup', 's6key-a2-1')) = 'ZW002'
    and pg_temp.code(pg_temp.rv(c_a2, c_a, v_k1, 'email', 'marketing', 's6key-a2-2')) = 'ZW002');
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  perform pg_temp.t('A2 P10 read-grant Dispatcher: reads state, history and notes; record / revoke -> ZW001',
    pg_temp.code(pg_temp.st(c_a2, c_a, v_k1)) = 'ok' and pg_temp.hist(c_a2, c_a, v_k1) like '3|%' and pg_temp.rls(c_a2, c_a) = '3'
    and pg_temp.x('authenticated', c_a2, format('select evidence_note from public.plus_list_contact_consent_events(%L, %L, 50, 0) where channel = ''email''', c_a, v_k1)) = 'Said yes on the call'
    and pg_temp.code(pg_temp.g(c_a2, c_a, v_k1, 'email', 'service_followup', 's6key-a2-3')) = 'ZW001'
    and pg_temp.code(pg_temp.rv(c_a2, c_a, v_k1, 'email', 'marketing', 's6key-a2-4')) = 'ZW001');
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.g(c_a2, c_a, v_k3, 'email', 'service_followup', 's6key-a2-5', 'email_reply');
  perform pg_temp.t('A3 P10 write-grant Dispatcher records; recorded_by is the Dispatcher', v = 'ok:true,granted,consent_on_record'
    and (select recorded_by from public.plus_communication_consents where idempotency_key = 's6key-a2-5') = c_a2, v);
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  perform pg_temp.t('A4 P10 grant revoked -> ZW002 at once (read and write)',
    pg_temp.code(pg_temp.st(c_a2, c_a, v_k3)) = 'ZW002' and pg_temp.code(pg_temp.rv(c_a2, c_a, v_k3, 'email', 'service_followup', 's6key-a2-6')) = 'ZW002'
    and pg_temp.rls(c_a2, c_a) = '0');
  perform pg_temp.set_grant(c_a, c_a5, 'write');
  perform pg_temp.t('A5 P8 Driver, inactive Dispatcher (even with a write grant), Platform Admin without membership, no-membership user -> ZW002 / 0',
    pg_temp.code(pg_temp.st(c_a3, c_a, v_k1)) = 'ZW002' and pg_temp.rls(c_a3, c_a) = '0' and pg_temp.code(pg_temp.g(c_a3, c_a, v_k1, 'email', 'service_followup', 's6key-a3-1')) = 'ZW002'
    and pg_temp.code(pg_temp.st(c_a5, c_a, v_k1)) = 'ZW002' and pg_temp.code(pg_temp.rv(c_a5, c_a, v_k1, 'email', 'marketing', 's6key-a5-1')) = 'ZW002'
    and pg_temp.code(pg_temp.st(c_d1, c_a, v_k1)) = 'ZW002' and pg_temp.rls(c_d1, c_a) = '0' and pg_temp.code(pg_temp.g(c_d1, c_a, v_k1, 'email', 'service_followup', 's6key-d1-1')) = 'ZW002'
    and pg_temp.code(pg_temp.st(c_e1, c_a, v_k1)) = 'ZW002' and pg_temp.rls(c_e1, c_a) = '0' and pg_temp.code(pg_temp.rv(c_e1, c_a, v_k1, 'email', 'marketing', 's6key-e1-1')) = 'ZW002');
  perform pg_temp.set_grant(c_a, c_a5, 'none');
  perform pg_temp.t('A6 c1 (Admin in A, Driver in B): writes in A; refused in B (ZW002)',
    pg_temp.code(pg_temp.st(c_c1, c_a, v_k1)) = 'ok'
    and pg_temp.code(pg_temp.st(c_c1, c_b, v_kb)) = 'ZW002' and pg_temp.code(pg_temp.g(c_c1, c_b, v_kb, 'sms', 'marketing', 's6key-c1-1')) = 'ZW002');
  perform pg_temp.t('A7 no uid -> ZW001 on read and ZW002 on write; anon -> 42501 on every RPC (item: anonymous callers)',
    pg_temp.code(pg_temp.st(null, c_a, v_k1)) = 'ZW001' and pg_temp.code(pg_temp.hist(null, c_a, v_k1)) = 'ZW001'
    and pg_temp.code(pg_temp.g(null, c_a, v_k1, 'email', 'service_followup', 's6key-nouid-1')) in ('ZW001', 'ZW002')
    and pg_temp.code(pg_temp.x('anon', null, format('select count(*)::text from public.plus_get_contact_consents(%L, %L)', c_a, v_k1))) = '42501'
    and pg_temp.code(pg_temp.x('anon', null, format('select count(*)::text from public.plus_list_contact_consent_events(%L, %L, 10, 0)', c_a, v_k1))) = '42501'
    and pg_temp.code(pg_temp.x('anon', null, format('select r.consent_id::text from public.plus_record_consent(%L, %L, ''email'', ''marketing'', ''written'', null, null, null, ''s6key-anon-1'') r', c_a, v_k1))) = '42501'
    and pg_temp.code(pg_temp.x('anon', null, format('select r.consent_id::text from public.plus_revoke_consent(%L, %L, ''email'', ''marketing'', ''written'', null, null, null, ''s6key-anon-2'') r', c_a, v_k1))) = '42501'
    and pg_temp.code(pg_temp.x('authenticated', c_a1, format('select public._plus_effective_consent(%L, %L, ''email'', ''marketing'')', c_a, v_k1))) = '42501'
    and pg_temp.code(pg_temp.x('authenticated', c_a1, format('select public._plus_consent_address_digest(%L, ''email'', null, ''a@b.test'')', c_a))) = '42501'
    and pg_temp.code(pg_temp.x('authenticated', c_a1, format('select public._plus_consents_revoke_for_dnc(%L, %L)::text', c_a, v_k1))) = '42501');
  update public.organizations set status = 'inactive' where id = c_a;
  perform pg_temp.t('A8 suspended organization: Admin read / record / revoke -> ZW002, RLS 0',
    pg_temp.code(pg_temp.st(c_a1, c_a, v_k1)) = 'ZW002' and pg_temp.rls(c_a1, c_a) = '0'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-susp-1')) = 'ZW002'
    and pg_temp.code(pg_temp.rv(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-susp-2')) = 'ZW002');
  update public.organizations set status = 'active' where id = c_a;

  -- read_only (item 21, R3)
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  perform pg_temp.set_state(c_a, 'expired');
  v_n := pg_temp.n(v_k1);
  perform pg_temp.t('A9 P7 read_only: Admin reads state + history + RLS; record AND revoke -> ZW001; DNC change through plus_update_contact -> ZW001; nothing written',
    pg_temp.code(pg_temp.st(c_a1, c_a, v_k1)) = 'ok' and pg_temp.hist(c_a1, c_a, v_k1) like '3|%' and pg_temp.rls(c_a1, c_a)::int >= 3
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-ro-1')) = 'ZW001'
    and pg_temp.code(pg_temp.rv(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-ro-2')) = 'ZW001'
    and pg_temp.code(pg_temp.dnc(c_a1, c_a, v_k1, true)) = 'ZW001'
    and pg_temp.n(v_k1) = v_n and (select not do_not_contact from public.plus_contacts where id = v_k1));
  perform pg_temp.t('A10 read_only: a write-grant Dispatcher loses read (ZW002, RLS 0) and every write (ZW002)',
    pg_temp.code(pg_temp.st(c_a2, c_a, v_k1)) = 'ZW002' and pg_temp.rls(c_a2, c_a) = '0'
    and pg_temp.code(pg_temp.g(c_a2, c_a, v_k1, 'email', 'service_followup', 's6key-ro-3')) = 'ZW002'
    and pg_temp.code(pg_temp.rv(c_a2, c_a, v_k1, 'email', 'marketing', 's6key-ro-4')) = 'ZW002');
  perform pg_temp.set_state(c_a, 'locked');
  perform pg_temp.t('A11 locked: Admin and grant holder read 0 / ZW002; writes ZW002',
    pg_temp.code(pg_temp.st(c_a1, c_a, v_k1)) = 'ZW002' and pg_temp.rls(c_a1, c_a) = '0' and pg_temp.rls(c_a2, c_a) = '0'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-lk-1')) = 'ZW002'
    and pg_temp.code(pg_temp.rv(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-lk-2')) = 'ZW002');
  perform pg_temp.set_state(c_a, 'none');
  perform pg_temp.t('A12 no entitlement: reads ZW002 / 0, writes ZW002',
    pg_temp.code(pg_temp.st(c_a1, c_a, v_k1)) = 'ZW002' and pg_temp.rls(c_a1, c_a) = '0'
    and pg_temp.code(pg_temp.rv(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-none-1')) = 'ZW002');
  perform pg_temp.set_state(c_a, 'trial');
  perform pg_temp.t('A13 running trial behaves as write',
    pg_temp.g(c_a1, c_a, v_k3, 'sms', 'marketing', 's6key-trial-1', 'written', null, null) = 'ERR:ZW006:invalid_input'  -- k3 has no phone
    and pg_temp.g(c_a1, c_a, v_k3, 'email', 'marketing', 's6key-trial-2', 'written') = 'ok:true,granted,consent_on_record');
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_grant(c_a, c_a2, 'none');

  -- =================================================== ordering, stale evidence, idempotency (items 10-13)
  v := pg_temp.rv(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-ord-1', 'written', now() - interval '1 day', 'Asked to stop offers');
  perform pg_temp.t('O1 P11 grant -> revoke: recorded revoked, effective no_consent_on_record; history kept', v = 'ok:true,revoked,no_consent_on_record'
    and pg_temp.n(v_k1, 'email', 'marketing') = 2 and pg_temp.naudit(v_k1, 'plus_consent_revoked') = 1, v);
  v := pg_temp.g(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-ord-2', 'verbal_phone', now() - interval '3 days');
  perform pg_temp.t('O2 P11 stale evidence: a grant captured BEFORE the latest revocation -> ZW004 stale_evidence; nothing written',
    v = 'ERR:ZW004:stale_evidence' and pg_temp.n(v_k1, 'email', 'marketing') = 2, v);
  v := pg_temp.g(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-ord-3', 'verbal_phone', now() - interval '1 day');
  perform pg_temp.t('O3 P11 revocation then a later (equal-or-newer) grant -> granted again', v = 'ok:true,granted,consent_on_record', v);
  v := pg_temp.rv(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-ord-4', 'written', now() - interval '300 days');
  perform pg_temp.t('O4 P12 backdating cannot reorder: a revocation recorded last with a much older captured_at still wins (revocations never refused for their date)',
    v = 'ok:true,revoked,no_consent_on_record'
    and (select status from public.plus_communication_consents where contact_id = v_k1 and channel = 'email' and purpose = 'marketing' order by seq desc limit 1) = 'revoked', v);
  perform pg_temp.t('O5 item 10 seq is strictly increasing in write order for the pair (unique, identity)',
    (select bool_and(s_next > s) from (select seq s, lead(seq) over (order by recorded_at, seq) s_next from public.plus_communication_consents
       where contact_id = v_k1 and channel = 'email' and purpose = 'marketing') z where s_next is not null)
    and (select array_agg(idempotency_key order by seq) from public.plus_communication_consents where contact_id = v_k1 and channel = 'email' and purpose = 'marketing')
        = array['s6key-k1-email-mkt-1', 's6key-ord-1', 's6key-ord-3', 's6key-ord-4']);
  v_n := pg_temp.n(v_k1); v_n2 := (select count(*) from public.audit_events where entity_id = v_k1);
  v := pg_temp.rv(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-ord-4', 'written', now() - interval '300 days');
  perform pg_temp.t('O6 P13 same key + same statement replayed -> changed=false, nothing written, no audit', v = 'ok:false,revoked,no_consent_on_record'
    and pg_temp.n(v_k1) = v_n and (select count(*) from public.audit_events where entity_id = v_k1) = v_n2, v);
  perform pg_temp.t('O7 P13 same key, different statement (status, pair or contact) -> ZW006 idempotency_conflict; nothing written',
    pg_temp.g(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-ord-4') = 'ERR:ZW006:idempotency_conflict'
    and pg_temp.rv(c_a1, c_a, v_k1, 'sms', 'marketing', 's6key-ord-4') = 'ERR:ZW006:idempotency_conflict'
    and pg_temp.rv(c_a1, c_a, v_k3, 'email', 'marketing', 's6key-ord-4') = 'ERR:ZW006:idempotency_conflict'
    and pg_temp.n(v_k1) = v_n);
  perform pg_temp.t('O8 P13 invalid idempotency keys (null, short, illegal characters) -> ZW006',
    pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', null)) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 'short')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 'bad key with spaces')) = 'ZW006'
    and pg_temp.n(v_k1) = v_n);
  perform pg_temp.t('O9 the same key may be reused by ANOTHER organization (unique per organization)',
    pg_temp.g(c_b1, c_b, v_kb, 'voice', 'marketing', 's6key-ord-4') = 'ok:true,granted,consent_on_record');

  -- =================================================== input validation (P19)
  perform pg_temp.t('V1 P19 caller-supplied system / future methods (do_not_contact, web_form, imported) and unknown values -> ZW006',
    pg_temp.code(pg_temp.rv(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-v-1', 'do_not_contact')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-v-2', 'web_form')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-v-3', 'imported')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'whatsapp', 'service_followup', 's6key-v-4')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'operational', 's6key-v-5')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, null, 'marketing', 's6key-v-6')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-v-7', null)) = 'ZW006');
  perform pg_temp.t('V2 P19 captured_at window (future > 5 min, older than 366 days) and note length (> 500) -> ZW006; blank note = NULL',
    pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-v-8', 'written', now() + interval '10 minutes')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-v-9', 'written', now() - interval '367 days')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-v-10', 'written', null, repeat('n', 501))) = 'ZW006'
    and pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-v-11', 'written', null, '   ') = 'ok:true,granted,consent_on_record');
  perform pg_temp.t('V2b a blank note is stored as NULL',
    (select evidence_note is null from public.plus_communication_consents where idempotency_key = 's6key-v-11'));
  perform pg_temp.t('V3 P16 a grant needs an address for the channel: SMS / voice without a phone, email without an email -> ZW006',
    pg_temp.code(pg_temp.g(c_a1, c_a, v_k3, 'sms', 'service_followup', 's6key-v-12')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k3, 'voice', 'service_followup', 's6key-v-13')) = 'ZW006'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k2, 'email', 'service_followup', 's6key-v-14')) = 'ZW006'
    and pg_temp.rv(c_a1, c_a, v_k2, 'email', 'marketing', 's6key-v-15') = 'ok:true,revoked,no_consent_on_record');  -- a revocation needs no address

  -- =================================================== address binding (item 9, P16)
  perform pg_temp.g(c_a1, c_a, v_k2, 'sms', 'marketing', 's6key-addr-1');
  v := pg_temp.edit(c_a1, c_a, v_k2, 'S6 Lee Fictional', '(404) 555-0182', null, 'phone', false);
  v2 := pg_temp.eff(c_a, v_k2, 'sms', 'marketing');
  perform pg_temp.t('D1a P16 reformatting the phone with the same digits keeps consent_on_record',
    pg_temp.code(v) = 'ok' and v2 = 'consent_on_record', v || ' / ' || v2);
  v := pg_temp.edit(c_a1, c_a, v_k2, 'S6 Lee Fictional', '404-555-0199', null, 'phone', false);
  perform pg_temp.t('D1b P16 grant then the contact''s phone digits change -> address_changed (state RPC shows granted > address_changed)',
    pg_temp.code(v) = 'ok' and pg_temp.eff(c_a, v_k2, 'sms', 'marketing') = 'address_changed'
    and pg_temp.st(c_a1, c_a, v_k2) like '%sms/marketing=granted>address_changed%', v);
  v := pg_temp.g(c_a1, c_a, v_k1, 'email', 'service_followup', 's6key-addr-2');
  v2 := pg_temp.edit(c_a1, c_a, v_k1, 'S6 Kim Fictional', '(404) 555-0181', null, 'phone', false);
  perform pg_temp.t('D2 P16 removing the address entirely also gives address_changed; phone grants are unaffected by the email change',
    v = 'ok:true,granted,consent_on_record' and pg_temp.code(v2) = 'ok'
    and pg_temp.eff(c_a, v_k1, 'email', 'service_followup') = 'address_changed'
    and pg_temp.eff(c_a, v_k1, 'sms', 'service_followup') = 'consent_on_record', v || ' / ' || v2);
  perform pg_temp.t('D3 R1 digests are domain-separated: the same address in Org A and Org B gives different digests; email kind <> phone kind',
    public._plus_consent_address_digest(c_a, 'email', null, 'same@example.test') <> public._plus_consent_address_digest(c_b, 'email', null, 'same@example.test')
    and public._plus_consent_address_digest(c_a, 'email', null, ' SAME@Example.TEST ') = public._plus_consent_address_digest(c_a, 'email', null, 'same@example.test')
    and public._plus_consent_address_digest(c_a, 'sms', '4045550100', null) = public._plus_consent_address_digest(c_a, 'voice', '(404) 555-0100', null)
    and public._plus_consent_address_digest(c_a, 'email', null, '4045550100') <> public._plus_consent_address_digest(c_a, 'sms', '4045550100', null)
    and public._plus_consent_address_digest(c_a, 'email', null, null) is null
    and public._plus_consent_address_digest(c_a, 'sms', 'x', null) is null);

  -- =================================================== DNC (items 7, 8; P14, P15; ZD-233)
  v_side := pg_temp.side();
  perform pg_temp.t('N1 P14 DNC contact: grant -> ZW004 do_not_contact; revocation accepted; every pair suppressed_do_not_contact',
    pg_temp.g(c_a1, c_a, v_k4, 'email', 'service_followup', 's6key-dnc-1') = 'ERR:ZW004:do_not_contact'
    and pg_temp.rv(c_a1, c_a, v_k4, 'email', 'marketing', 's6key-dnc-2', 'written') = 'ok:true,revoked,suppressed_do_not_contact'
    and pg_temp.st(c_a1, c_a, v_k4) !~ '>(consent_on_record|no_consent_on_record|address_changed)'
    and (select count(*) from regexp_matches(pg_temp.st(c_a1, c_a, v_k4), 'suppressed_do_not_contact', 'g')) = 6);
  -- k3: email service_followup (a2), email marketing (trial) granted
  v_n := pg_temp.n(v_k3); v_n2 := pg_temp.naudit(v_k3, 'plus_consent_revoked');
  v := pg_temp.dnc(c_a1, c_a, v_k3, true);
  perform pg_temp.t('N2 P15 DNC switched ON through plus_update_contact: exactly one system revocation per granted pair, none for others; actor = the editor; one audit each; no activity',
    v = 'ok:true'
    and pg_temp.n(v_k3) = v_n + 2
    and (select count(*) from public.plus_communication_consents where contact_id = v_k3 and captured_via = 'do_not_contact'
           and status = 'revoked' and recorded_by = c_a1 and captured_at = now() and evidence_note is null and address_digest is null
           and corrects_consent_id is null and idempotency_key like 'dnc:%') = 2
    and pg_temp.naudit(v_k3, 'plus_consent_revoked') = v_n2 + 2
    and (select bool_and(after_data ->> 'captured_via' = 'do_not_contact' and not (after_data ? 'evidence_note') and not (after_data ? 'address_digest'))
         from public.audit_events where entity_id = v_k3 and action = 'plus_consent_revoked')
    and pg_temp.naudit(v_k3, 'plus_contact_updated') = 1
    and (select count(*) from public.plus_activities where contact_id = v_k3) = 0
    and pg_temp.eff(c_a, v_k3, 'email', 'marketing') = 'suppressed_do_not_contact', v);
  perform pg_temp.t('N3 a system do_not_contact revocation can never be corrected (ZW004), even after DNC is cleared',
    pg_temp.g(c_a1, c_a, v_k3, 'email', 'marketing', 's6key-dnc-3', 'written', null, 'fix',
      (select id from public.plus_communication_consents where contact_id = v_k3 and channel = 'email' and purpose = 'marketing' order by seq desc limit 1))
      in ('ERR:ZW004:do_not_contact', 'ERR:ZW004:illegal_transition'));
  v := pg_temp.dnc(c_a1, c_a, v_k3, false);
  perform pg_temp.t('N4 item 8 DNC cleared: nothing written; NO earlier grant revives (no_consent_on_record everywhere)',
    v = 'ok:true' and pg_temp.n(v_k3) = v_n + 2
    and pg_temp.eff(c_a, v_k3, 'email', 'marketing') = 'no_consent_on_record'
    and pg_temp.eff(c_a, v_k3, 'email', 'service_followup') = 'no_consent_on_record'
    and pg_temp.st(c_a1, c_a, v_k3) !~ '>consent_on_record');
  perform pg_temp.t('N5 after DNC clear: correcting the system revocation -> ZW004; a grant dated before the DNC switch-on -> stale_evidence; a fresh grant works',
    pg_temp.g(c_a1, c_a, v_k3, 'email', 'marketing', 's6key-dnc-4', 'written', now() - interval '1 day', 'restore',
      (select id from public.plus_communication_consents where contact_id = v_k3 and channel = 'email' and purpose = 'marketing' order by seq desc limit 1)) = 'ERR:ZW004:illegal_transition'
    and pg_temp.g(c_a1, c_a, v_k3, 'email', 'marketing', 's6key-dnc-5', 'written', now() - interval '1 day') = 'ERR:ZW004:stale_evidence'
    and pg_temp.g(c_a1, c_a, v_k3, 'email', 'marketing', 's6key-dnc-6', 'written') = 'ok:true,granted,consent_on_record');
  v_n := pg_temp.n(v_k3);
  v := pg_temp.dnc(c_a1, c_a, v_k3, true);
  v_n2 := pg_temp.n(v_k3);
  v2 := pg_temp.edit(c_a1, c_a, v_k3, 'S6 Max F.', null, 'max.s6@example.test', 'email', true);
  perform pg_temp.t('N6a repeated DNC updates: ON with 1 grant -> exactly 1 revocation; an edit while ON writes none',
    v = 'ok:true' and v_n2 = v_n + 1 and pg_temp.code(v2) = 'ok' and pg_temp.n(v_k3) = v_n + 1, v || ' / ' || v2);
  v := pg_temp.dnc(c_a1, c_a, v_k3, false);
  v2 := pg_temp.dnc(c_a1, c_a, v_k3, true);
  perform pg_temp.t('N6b OFF writes none; ON again with nothing granted writes none',
    v = 'ok:true' and v2 = 'ok:true' and pg_temp.n(v_k3) = v_n + 1, v || ' / ' || v2);
  perform pg_temp.dnc(c_a1, c_a, v_k3, false);
  v_id := pg_temp.mkc(c_a, 'S6 Noa Fictional', '404 555 0186', null);
  v := pg_temp.dnc(c_a1, c_a, v_id, true);
  perform pg_temp.t('N7 DNC switch-on with no consent rows at all writes no consent row and keeps the released audit (plus_contact_updated, field names only)',
    v = 'ok:true' and pg_temp.n(v_id) = 0
    and (select after_data from public.audit_events where entity_id = v_id and action = 'plus_contact_updated')
        = jsonb_build_object('fields', jsonb_build_array('do_not_contact')), v);
  perform pg_temp.t('N8 released plus_update_contact semantics unchanged: stale version -> ZW003; identical values -> changed=false (no consent rows)',
    pg_temp.code(pg_temp.x('authenticated', c_a1, format('select ''ok:'' || r.changed from public.plus_update_contact(%L, %L, %L::timestamptz, ''S6 Kim Fictional'', ''(404) 555-0181'', null, ''individual'', null, ''phone'', true, null) r', c_a, v_k1, now() - interval '1 hour'))) = 'ZW003'
    and pg_temp.dnc(c_a1, c_a, v_k2, false) = 'ok:false');
  perform pg_temp.t('N9 item 16/17 consent writes and DNC transitions touch no Request, Trip, Passenger, assignment, notification, task, opportunity, quote or activity',
    split_part(pg_temp.side(), '/', 1) || split_part(pg_temp.side(), '/', 2) || split_part(pg_temp.side(), '/', 3) || split_part(pg_temp.side(), '/', 4)
      || split_part(pg_temp.side(), '/', 5) || split_part(pg_temp.side(), '/', 6) || split_part(pg_temp.side(), '/', 7) || split_part(pg_temp.side(), '/', 8)
      || split_part(pg_temp.side(), '/', 9)
    = split_part(v_side, '/', 1) || split_part(v_side, '/', 2) || split_part(v_side, '/', 3) || split_part(v_side, '/', 4)
      || split_part(v_side, '/', 5) || split_part(v_side, '/', 6) || split_part(v_side, '/', 7) || split_part(v_side, '/', 8)
      || split_part(v_side, '/', 9));

  -- =================================================== archived / redacted (P17, item 6)
  update public.plus_contacts set status = 'archived' where id = v_k2;
  perform pg_temp.t('R1 P17 archived contact: grant -> ZW004; revocation accepted; effective suppressed_archived; still readable',
    pg_temp.g(c_a1, c_a, v_k2, 'voice', 'marketing', 's6key-arc-1') = 'ERR:ZW004:illegal_transition'
    and pg_temp.rv(c_a1, c_a, v_k2, 'sms', 'marketing', 's6key-arc-2', 'written') = 'ok:true,revoked,suppressed_archived'
    and pg_temp.eff(c_a, v_k2, 'sms', 'service_followup') = 'suppressed_archived'
    and pg_temp.code(pg_temp.st(c_a1, c_a, v_k2)) = 'ok');
  update public.plus_contacts set status = 'redacted', phone = null, email = null where id = v_k2;
  perform pg_temp.t('R2 redacted contact: read RPCs, grant and revoke -> ZW002 (no oracle); resolver not_found',
    pg_temp.code(pg_temp.st(c_a1, c_a, v_k2)) = 'ZW002' and pg_temp.code(pg_temp.hist(c_a1, c_a, v_k2)) = 'ZW002'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k2, 'sms', 'marketing', 's6key-red-1')) = 'ZW002'
    and pg_temp.code(pg_temp.rv(c_a1, c_a, v_k2, 'sms', 'marketing', 's6key-red-2')) = 'ZW002'
    and pg_temp.eff(c_a, v_k2, 'sms', 'marketing') = 'not_found');
  perform pg_temp.t('R3 unknown contact id and foreign contact -> resolver not_found; read RPC ZW002',
    pg_temp.eff(c_a, extensions.gen_random_uuid(), 'email', 'marketing') = 'not_found'
    and pg_temp.eff(c_a, v_kb, 'email', 'marketing') = 'not_found'
    and pg_temp.code(pg_temp.st(c_a1, c_a, extensions.gen_random_uuid())) = 'ZW002');
  perform pg_temp.t('R4 item 19 all six effective outcomes are reachable (not_found, suppressed_archived, suppressed_do_not_contact, no_consent_on_record, address_changed, consent_on_record); bad channel -> ZW006',
    pg_temp.eff(c_a, v_k2, 'email', 'marketing') = 'not_found'
    and pg_temp.eff(c_a, v_k4, 'email', 'marketing') = 'suppressed_do_not_contact'
    and pg_temp.eff(c_a, v_k1, 'voice', 'marketing') = 'no_consent_on_record'
    and pg_temp.eff(c_a, v_k1, 'email', 'service_followup') = 'address_changed'
    and pg_temp.eff(c_a, v_k1, 'sms', 'service_followup') = 'consent_on_record'
    and exists (select 1 from k_results where name like 'R1 %' and ok));
  begin
    perform public._plus_effective_consent(c_a, v_k1, 'fax', 'marketing');
    perform pg_temp.t('R5 resolver refuses an unknown channel / purpose (ZW006)', false);
  exception when sqlstate 'ZW006' then perform pg_temp.t('R5 resolver refuses an unknown channel / purpose (ZW006)', true);
  end;

  -- =================================================== corrections (P18, item 14)
  -- k1 sms/service_followup latest = granted (H5)
  v_id := (select id from public.plus_communication_consents where contact_id = v_k1 and channel = 'sms' and purpose = 'service_followup' order by seq desc limit 1);
  perform pg_temp.t('C1 P18 correction without a note -> ZW006; of a row that is not the pair''s latest (or of another pair) -> ZW003',
    pg_temp.code(pg_temp.rv(c_a1, c_a, v_k1, 'sms', 'service_followup', 's6key-cor-1', 'written', null, null, v_id)) = 'ZW006'
    and pg_temp.code(pg_temp.rv(c_a1, c_a, v_k1, 'voice', 'service_followup', 's6key-cor-2', 'written', null, 'wrong pair', v_id)) = 'ZW003'
    and pg_temp.code(pg_temp.rv(c_a1, c_a, v_k1, 'email', 'marketing', 's6key-cor-3', 'written', null, 'not latest',
          (select id from public.plus_communication_consents where idempotency_key = 's6key-k1-email-mkt-1'))) = 'ZW003'
    and pg_temp.code(pg_temp.rv(c_a1, c_a, v_k1, 'sms', 'service_followup', 's6key-cor-4', 'written', null, 'unknown', extensions.gen_random_uuid())) = 'ZW003');
  v := pg_temp.rv(c_a1, c_a, v_k1, 'sms', 'service_followup', 's6key-cor-5', 'written', null, 'Entered for the wrong person', v_id);
  perform pg_temp.t('C2 P18 a valid correction appends a new row referencing the latest; the original row is unchanged; audit correction=true',
    v = 'ok:true,revoked,no_consent_on_record'
    and (select status = 'granted' and corrects_consent_id is null from public.plus_communication_consents where id = v_id)
    and (select corrects_consent_id = v_id and evidence_note = 'Entered for the wrong person' from public.plus_communication_consents where idempotency_key = 's6key-cor-5')
    and (select (after_data ->> 'correction')::boolean from public.audit_events where action = 'plus_consent_revoked' and after_data ->> 'consent_id' = (select id::text from public.plus_communication_consents where idempotency_key = 's6key-cor-5'))
    and pg_temp.x('authenticated', c_a1, format('select is_correction::text from public.plus_get_contact_consents(%L, %L) where channel = ''sms'' and purpose = ''service_followup''', c_a, v_k1)) = 'true', v);
  v_id2 := (select id from public.plus_communication_consents where idempotency_key = 's6key-cor-5');
  perform pg_temp.t('C3 correcting an erroneous revocation with an OLDER captured_at is allowed (the corrected row is not counted as evidence); a second correction of the old row -> ZW003',
    pg_temp.g(c_a1, c_a, v_k1, 'sms', 'service_followup', 's6key-cor-6', 'verbal_phone', now() - interval '5 days', 'The revocation was a mistake', v_id2) = 'ok:true,granted,consent_on_record'
    and pg_temp.code(pg_temp.g(c_a1, c_a, v_k1, 'sms', 'service_followup', 's6key-cor-7', 'verbal_phone', null, 'again', v_id2)) = 'ZW003');
  begin
    insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at,
                                                    address_digest, idempotency_key, recorded_by, corrects_consent_id)
    values (c_a, v_k1, 'email', 'marketing', 'granted', 'written', now(), repeat('a', 64), 's6key-cor-nonote', c_a1, v_id);
    perform pg_temp.t('C4 table CHECKs hold for the owner too: a correction without a note / a DNC grant / a grant without digest / a text version are impossible', false);
  exception when check_violation then
    v_ok := true;
    begin insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at, address_digest, idempotency_key, recorded_by)
          values (c_a, v_k1, 'email', 'marketing', 'granted', 'do_not_contact', now(), repeat('a', 64), 's6key-chk-2', c_a1); v_ok := false;
    exception when check_violation then null; end;
    begin insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at, idempotency_key, recorded_by)
          values (c_a, v_k1, 'email', 'marketing', 'granted', 'written', now(), 's6key-chk-3', c_a1); v_ok := false;
    exception when check_violation then null; end;
    begin insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at, idempotency_key, recorded_by, consent_text_version)
          values (c_a, v_k1, 'email', 'marketing', 'revoked', 'written', now(), 's6key-chk-4', c_a1, 'v1'); v_ok := false;
    exception when check_violation then null; end;
    begin insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via, captured_at, idempotency_key, recorded_by)
          values (c_a, v_k1, 'email', 'marketing', 'revoked', 'written', now() + interval '1 hour', 's6key-chk-5', c_a1); v_ok := false;
    exception when check_violation then null; end;
    perform pg_temp.t('C4 table CHECKs hold for the owner too: a correction without a note / a DNC grant / a grant without digest / a text version are impossible', v_ok);
  end;

  -- =================================================== rollback on failure (item 22)
  create function pg_temp.fail_audit() returns trigger language plpgsql as $f$
  begin
    if new.action in ('plus_consent_granted', 'plus_consent_revoked') then raise exception 'injected_audit_failure' using errcode = 'P0001'; end if;
    return new;
  end;
  $f$;
  create trigger s6_test_fail_audit before insert on public.audit_events for each row execute function pg_temp.fail_audit();
  v_n := (select count(*) from public.plus_communication_consents); v_n2 := (select count(*) from public.audit_events);
  v := pg_temp.g(c_a1, c_a, v_k1, 'voice', 'marketing', 's6key-rb-1');
  v2 := pg_temp.dnc(c_a1, c_a, v_k1, true);
  perform pg_temp.t('F1 item 22 a failure after the consent insert (injected audit failure) rolls back everything: no consent row, no audit, DNC switch-on fully undone (contact unchanged)',
    v like 'ERR:P0001:%' and v2 like 'ERR:P0001:%'
    and (select count(*) from public.plus_communication_consents) = v_n and (select count(*) from public.audit_events) = v_n2
    and (select not do_not_contact from public.plus_contacts where id = v_k1)
    and pg_temp.eff(c_a, v_k1, 'sms', 'service_followup') = 'consent_on_record', v || ' / ' || v2);
  drop trigger s6_test_fail_audit on public.audit_events;
  perform pg_temp.t('F2 after the failure, the same idempotency key works normally (nothing half-written)',
    pg_temp.g(c_a1, c_a, v_k1, 'voice', 'marketing', 's6key-rb-1') = 'ok:true,granted,consent_on_record');

  -- =================================================== final DNC invariant on a fully granted contact (R2 invariant)
  perform pg_temp.g(c_a1, c_a, v_k1, 'sms', 'marketing', 's6key-inv-1');
  perform pg_temp.g(c_a1, c_a, v_k1, 'voice', 'service_followup', 's6key-inv-2');
  v := pg_temp.dnc(c_a1, c_a, v_k1, true);
  v2 := pg_temp.dnc(c_a1, c_a, v_k1, false);
  perform pg_temp.t('I1 R2 invariant: after DNC on -> off, NO pair of the contact has its latest row granted (nothing can revive)',
    v = 'ok:true' and v2 = 'ok:true'
    and not exists (select 1 from (select distinct on (channel, purpose) status from public.plus_communication_consents
                                   where contact_id = v_k1 order by channel, purpose, seq desc) l where l.status = 'granted')
    and pg_temp.st(c_a1, c_a, v_k1) !~ '>consent_on_record');
  perform pg_temp.t('I2 every consent audit row of this run is minimised: keys exactly consent_id / channel / purpose / captured_via / correction',
    (select bool_and((select array_agg(k order by k) from jsonb_object_keys(after_data) k) = array['captured_via', 'channel', 'consent_id', 'correction', 'purpose'])
     from public.audit_events where action in ('plus_consent_granted', 'plus_consent_revoked')));
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from k_results;
select name, detail from k_results where not ok order by n;

rollback;
