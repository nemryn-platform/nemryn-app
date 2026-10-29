-- Nemryn Plus -- Contacts + activity timeline tests (NP-P1-S4). ROLLBACK-ONLY (one transaction, rolled back at the end).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_contacts_activities_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261014100000_plus_contacts_activities.sql. Fictional seed fixtures only: Org A admin a1, dispatcher a2,
-- driver a3, inactive dispatcher a5; Org B admin b1, dispatcher b2; c1 = admin in A + driver in B; d1 = platform admin
-- (no membership); e1 = no membership. Grants are owner-level fixtures (the grant RPCs are covered by S3's suite).
-- Inside one transaction now() is constant, so "stale" versions are simulated with a different timestamp.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table k_results (n serial, name text, ok boolean, detail text);

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
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, null, 'S4 contacts test'
  from (values
    ('trial',     'trial',     null,        now() - interval '1 day',   now() + interval '13 days'),
    ('active',    'active',    null,        null::timestamptz,          null::timestamptz),
    ('expired',   'expired',   null,        now() - interval '20 days', now() - interval '6 days'),
    ('locked',    'disabled',  'no_access', null,                       null)
  ) as s(name, status, restriction, ts, te)
  where s.name = p_state;
end;
$$;

-- Owner-level grant fixture: revoke whatever is active, then (unless 'none') insert a new active grant.
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

-- create as a caller -> 'changed=<b>,dups=<n>' or ERR
create function pg_temp.mk(p_uid uuid, p_org uuid, p_name text, p_phone text, p_email text,
                           p_kind text default 'individual', p_title text default null, p_channel text default 'phone',
                           p_dnc boolean default false, p_owner uuid default null, p_confirm boolean default false)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed || '',dups='' || coalesce(r.possible_duplicates, 0) from public.plus_create_contact(%L::uuid, %L, %L, %L, %L, %L, %L, %L::boolean, %L::uuid, %L::boolean) r',
    p_org, p_name, p_phone, p_email, p_kind, p_title, p_channel, p_dnc, p_owner, p_confirm)), 'NULL');
$$;
create function pg_temp.cid(p_org uuid, p_name text) returns uuid language sql as $$
  select id from public.plus_contacts where organization_id = p_org and display_name = p_name order by created_at, id limit 1;
$$;
create function pg_temp.ver(p_contact uuid) returns timestamptz language sql as $$
  select updated_at from public.plus_contacts where id = p_contact;
$$;
-- update all editable fields as a caller
create function pg_temp.upd(p_uid uuid, p_org uuid, p_contact uuid, p_expected timestamptz, p_name text, p_phone text, p_email text,
                            p_kind text default 'individual', p_title text default null, p_channel text default 'phone',
                            p_dnc boolean default false, p_owner uuid default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed from public.plus_update_contact(%L::uuid, %L::uuid, %L::timestamptz, %L, %L, %L, %L, %L, %L, %L::boolean, %L::uuid) r',
    p_org, p_contact, p_expected, p_name, p_phone, p_email, p_kind, p_title, p_channel, p_dnc, p_owner)), 'NULL');
$$;
create function pg_temp.arc(p_uid uuid, p_org uuid, p_contact uuid, p_expected timestamptz, p_reason text default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed from public.plus_archive_contact(%L::uuid, %L::uuid, %L::timestamptz, %L) r',
    p_org, p_contact, p_expected, p_reason)), 'NULL');
$$;
create function pg_temp.lg(p_uid uuid, p_org uuid, p_contact uuid, p_type text, p_body text, p_at timestamptz default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed from public.plus_log_contact_activity(%L::uuid, %L::uuid, %L, %L, %L::timestamptz) r',
    p_org, p_contact, p_type, p_body, p_at)), 'NULL');
$$;
create function pg_temp.lst(p_uid uuid, p_org uuid, p_search text default null, p_kind text default null, p_status text default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select count(*)::text from public.plus_list_contacts(%L::uuid, %L, %L, %L, 100, 0)', p_org, p_search, p_kind, p_status)), 'NULL');
$$;
create function pg_temp.get(p_uid uuid, p_org uuid, p_contact uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select display_name from public.plus_get_contact(%L::uuid, %L::uuid)', p_org, p_contact)), 'NULL');
$$;
create function pg_temp.acts(p_uid uuid, p_org uuid, p_contact uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select count(*)::text from public.plus_list_contact_activities(%L::uuid, %L::uuid, 100, 0)', p_org, p_contact)), 'NULL');
$$;
-- direct RLS read as a caller: number of visible contact rows of an organization
create function pg_temp.rls(p_uid uuid, p_org uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ((select count(*) from public.plus_contacts where organization_id = %L) + (select count(*) from public.plus_activities where organization_id = %L))::text', p_org, p_org)), 'NULL');
$$;
create function pg_temp.acount(p_contact uuid, p_type text default null) returns bigint language sql as $$
  select count(*) from public.plus_activities where contact_id = p_contact and (p_type is null or activity_type = p_type);
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
  c_b2 constant uuid := '20000000-0000-0000-0000-0000000000b2';
  c_c1 constant uuid := '20000000-0000-0000-0000-0000000000c1';
  c_d1 constant uuid := '20000000-0000-0000-0000-0000000000d1';
  c_e1 constant uuid := '20000000-0000-0000-0000-0000000000e1';
  v text; v_c uuid; v_c2 uuid; v_bc uuid; v_ver timestamptz; v_n bigint;
  v_core_before text; v_core_after text; v_rec record; v_s6 uuid;
begin
  v_core_before := (select count(*) from public.transportation_requests)::text || '/' || (select count(*) from public.passengers)::text
                   || '/' || (select count(*) from public.trips)::text || '/' || (select count(*) from public.facilities)::text;

  -- =================================================== schema / privileges / minimisation
  perform pg_temp.t('K1 RLS on; exactly one SELECT policy per table, TO authenticated, using plus_can_read(organization_id)',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.plus_contacts'::regclass, 'public.plus_activities'::regclass))
    and (select count(*) from pg_policy where polrelid in ('public.plus_contacts'::regclass, 'public.plus_activities'::regclass)) = 2
    and not exists (select 1 from pg_policy where polrelid in ('public.plus_contacts'::regclass, 'public.plus_activities'::regclass)
                    and (polcmd <> 'r' or pg_get_expr(polqual, polrelid) !~ 'plus_can_read\(organization_id\)'
                         or polroles <> array['authenticated'::regrole]::oid[])));
  perform pg_temp.t('K2 table privileges: authenticated SELECT only; anon / service_role / PUBLIC nothing',
    (select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants
      where table_schema = 'public' and table_name in ('plus_contacts', 'plus_activities') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC'))
    = 'authenticated:SELECT,authenticated:SELECT');
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.t('K3 direct INSERT / UPDATE / DELETE as authenticated (even an entitled Admin) -> 42501',
    pg_temp.val_as('authenticated', c_a1, format($q$insert into public.plus_contacts (organization_id, display_name, email, contact_kind, created_by) values (%L, 'X', 'x@example.test', 'other', %L) returning 'x'$q$, c_a, c_a1)) = 'ERR:42501'
    and pg_temp.val_as('authenticated', c_a1, 'update public.plus_contacts set display_name = ''Y'' returning ''x''') = 'ERR:42501'
    and pg_temp.val_as('authenticated', c_a1, 'delete from public.plus_contacts returning ''x''') = 'ERR:42501'
    and pg_temp.val_as('authenticated', c_a1, 'update public.plus_activities set body = ''Y'' returning ''x''') = 'ERR:42501'
    and pg_temp.val_as('authenticated', c_a1, 'delete from public.plus_activities returning ''x''') = 'ERR:42501'
    and pg_temp.val_as('anon', null, 'select count(*)::text from public.plus_contacts') = 'ERR:42501');
  perform pg_temp.t('K4 RPC EXECUTE: authenticated only (no anon); internal helpers have no client EXECUTE',
    (select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('plus_list_contacts', 'plus_get_contact', 'plus_list_contact_activities', 'plus_find_contact_matches',
                         'plus_list_contact_owner_options', 'plus_create_contact', 'plus_update_contact', 'plus_archive_contact', 'plus_log_contact_activity'))
    and (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                         and not has_function_privilege('service_role', p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('_plus_user_can_write', '_plus_contact_matches', '_plus_staff_name', '_plus_resolve_owner')));
  perform pg_temp.t('K5 all 13 S4 functions are SECURITY DEFINER with a pinned search_path',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('plus_list_contacts', 'plus_get_contact', 'plus_list_contact_activities', 'plus_find_contact_matches',
                         'plus_list_contact_owner_options', 'plus_create_contact', 'plus_update_contact', 'plus_archive_contact',
                         'plus_log_contact_activity', '_plus_user_can_write', '_plus_contact_matches', '_plus_staff_name', '_plus_resolve_owner')
       and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 13);
  perform pg_temp.t('K6 data minimisation: exactly the canonical contact columns (no account / passenger / DOB / address / health / insurance field)',
    (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'plus_contacts')
    = 'id,organization_id,display_name,phone,email,contact_kind,job_title,preferred_channel,do_not_contact,owner_user_id,status,created_by,created_at,updated_at');
  -- K7-K9 describe the CURRENT shape: S4 columns plus the additive P2-S1 opportunity subject (20261014120000).
  perform pg_temp.t('K7 activity columns: contact + opportunity + request subjects, plus (NP-P2-S5-S3B, ZD-222) the quote reference + event status; no account yet, no metadata json',
    (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'plus_activities')
    = 'id,organization_id,contact_id,activity_type,body,from_stage,to_stage,actor_user_id,occurred_at,recorded_at,opportunity_id,request_id,quote_id,quote_status'
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('plus_contacts', 'plus_activities') and data_type in ('json', 'jsonb')));
  perform pg_temp.t('K8 no dependency on future tables: every FK targets organizations, auth.users, plus_contacts, plus_opportunities, (NP-P2-S3) transportation_requests or (NP-P2-S5-S3B) plus_quotes',
    (select bool_and(confrelid::regclass::text in ('organizations', 'public.organizations', 'auth.users', 'plus_contacts', 'public.plus_contacts',
                                                   'plus_opportunities', 'public.plus_opportunities',
                                                   'transportation_requests', 'public.transportation_requests',
                                                   'plus_quotes', 'public.plus_quotes'))
       from pg_constraint where contype = 'f' and conrelid in ('public.plus_contacts'::regclass, 'public.plus_activities'::regclass))
    -- (plus_tasks ships in NP-P2-S2; accounts remain future)
    and to_regclass('public.plus_accounts') is null);
  perform pg_temp.t('K9 named constraints for deterministic additive replacement exist (subject check widened by P2-S1 and P2-S3)',
    (select count(*) from pg_constraint where conrelid = 'public.plus_activities'::regclass
       and conname in ('plus_activities_subject_check', 'plus_activities_activity_type_check', 'plus_activities_contact_fkey')) = 3
    and exists (select 1 from pg_constraint where conname = 'plus_activities_subject_check' and pg_get_constraintdef(oid) ~ 'num_nonnulls\(contact_id, opportunity_id, request_id\) >= 1'));

  -- =================================================== create + validation + normalisation (Admin, Plus active)
  v := pg_temp.mk(c_a1, c_a, '  Dana Fictional  ', ' (404) 555-0100 ', '  Dana.F@Example.TEST ', 'family_caregiver', ' Daughter ');
  v_c := pg_temp.cid(c_a, 'Dana Fictional');
  perform pg_temp.t('V1 Admin creates a contact: name / phone / title trimmed, email trimmed + lower-cased, created_by = caller', v = 'changed=true,dups=0'
    and (select phone = '(404) 555-0100' and email = 'dana.f@example.test' and job_title = 'Daughter' and created_by = c_a1 and status = 'active'
         and preferred_channel = 'phone' and do_not_contact = false from public.plus_contacts where id = v_c), v);
  perform pg_temp.t('V2 create audited once (plus_contact_created) without copying contact values',
    (select count(*) from public.audit_events where entity_id = v_c and action = 'plus_contact_created') = 1
    and (select coalesce(after_data::text, '') !~ 'dana|555|example' from public.audit_events where entity_id = v_c and action = 'plus_contact_created'));
  perform pg_temp.t('V3 neither phone nor email -> ZW006', pg_temp.mk(c_a1, c_a, 'No Reach', null, '  ') = 'ERR:ZW006');
  perform pg_temp.t('V4 name empty / 201 chars -> ZW006; 200 chars ok',
    pg_temp.mk(c_a1, c_a, '   ', null, 'n1@example.test') = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, repeat('n', 201), null, 'n2@example.test') = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, repeat('n', 200), null, 'n3@example.test') = 'changed=true,dups=0');
  perform pg_temp.t('V5 invalid email (no @, spaces, 255 chars) -> ZW006',
    pg_temp.mk(c_a1, c_a, 'E1', null, 'not-an-email') = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, 'E2', null, 'a b@example.test') = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, 'E3', null, repeat('a', 243) || '@example.test') = 'ERR:ZW006');
  perform pg_temp.t('V6 phone: letters / too few digits / 41 chars -> ZW006; an extension is accepted',
    pg_temp.mk(c_a1, c_a, 'P1', 'call me', null) = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, 'P2', '555-01', null) = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, 'P3', repeat('1', 41), null) = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, 'P4 Ext', '+1 404 555 0101 x42', null) = 'changed=true,dups=0');
  perform pg_temp.t('V7 closed sets: unknown contact_kind / preferred_channel -> ZW006; job title 121 -> ZW006',
    pg_temp.mk(c_a1, c_a, 'K1', null, 'k1@example.test', 'patient') = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, 'K2', null, 'k2@example.test', 'individual', null, 'sms') = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, 'K3', null, 'k3@example.test', 'individual', repeat('t', 121)) = 'ERR:ZW006');
  perform pg_temp.t('V8 every canonical contact kind is accepted',
    pg_temp.mk(c_a1, c_a, 'Kind individual', null, 'ki1@example.test', 'individual') = 'changed=true,dups=0'
    and pg_temp.mk(c_a1, c_a, 'Kind facility', null, 'ki2@example.test', 'facility_staff') = 'changed=true,dups=0'
    and pg_temp.mk(c_a1, c_a, 'Kind referral', null, 'ki3@example.test', 'referral_source') = 'changed=true,dups=0'
    and pg_temp.mk(c_a1, c_a, 'Kind other', null, 'ki4@example.test', 'other', null, 'none', true) = 'changed=true,dups=0');

  -- =================================================== duplicate warnings (never merged)
  v_n := (select count(*) from public.plus_contacts where organization_id = c_a);
  perform pg_temp.t('D1 same email in another case -> warning, NOTHING written',
    pg_temp.mk(c_a1, c_a, 'Someone Else', null, 'DANA.F@example.test') = 'changed=false,dups=1'
    and (select count(*) from public.plus_contacts where organization_id = c_a) = v_n);
  perform pg_temp.t('D2 same phone formatted differently -> warning', pg_temp.mk(c_a1, c_a, 'Another Person', '404.555.0100', null) = 'changed=false,dups=1');
  perform pg_temp.t('D3 same name (case-insensitive) -> warning', pg_temp.mk(c_a1, c_a, 'DANA fictional', '+1 678 555 0199', null) = 'changed=false,dups=1');
  v := pg_temp.mk(c_a1, c_a, 'Dana Fictional', '404-555-0100', 'dana.f@example.test', 'individual', null, 'phone', false, null, true);
  perform pg_temp.t('D4 confirmed duplicate is created as a SEPARATE contact (duplicates allowed, no merge)',
    v = 'changed=true,dups=1' and (select count(*) from public.plus_contacts where organization_id = c_a and display_name = 'Dana Fictional') = 2, v);
  perform pg_temp.t('D5 find matches reports what matched (email, phone, name)',
    pg_temp.val_as('authenticated', c_a1, format($q$select string_agg(match_on, '|') from public.plus_find_contact_matches(%L, 'dana fictional', '(404) 555 0100', 'Dana.F@example.test', null)$q$, c_a))
      = 'email,phone,name|email,phone,name');
  perform pg_temp.set_state(c_b, 'active');
  perform pg_temp.t('D6 matching is per organization: the same email in Org B is not a duplicate in B, and B never sees A''s',
    pg_temp.mk(c_b1, c_b, 'Dana In B', null, 'dana.f@example.test') = 'changed=true,dups=0'
    and pg_temp.val_as('authenticated', c_b1, format($q$select count(*)::text from public.plus_find_contact_matches(%L, 'Dana Fictional', null, 'dana.f@example.test', null)$q$, c_b)) = '1');
  v_bc := pg_temp.cid(c_b, 'Dana In B');

  -- =================================================== owners
  v := pg_temp.mk(c_a1, c_a, 'Owned By Admin', null, 'o1@example.test', 'individual', null, 'email', false, pg_temp.mid(c_a, c_a1));
  perform pg_temp.t('O1 owner = an Organization Admin of the organization -> ok', v = 'changed=true,dups=0'
    and (select owner_user_id = c_a1 from public.plus_contacts where id = pg_temp.cid(c_a, 'Owned By Admin')), v);
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  perform pg_temp.t('O2 owner = Dispatcher without a grant -> ZW006',
    pg_temp.mk(c_a1, c_a, 'O2', null, 'o2@example.test', 'individual', null, 'phone', false, pg_temp.mid(c_a, c_a2)) = 'ERR:ZW006');
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  perform pg_temp.t('O3 owner = Dispatcher with a READ grant -> ZW006',
    pg_temp.mk(c_a1, c_a, 'O3', null, 'o3@example.test', 'individual', null, 'phone', false, pg_temp.mid(c_a, c_a2)) = 'ERR:ZW006');
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  perform pg_temp.t('O4 owner = Dispatcher with a WRITE grant -> ok',
    pg_temp.mk(c_a1, c_a, 'O4', null, 'o4@example.test', 'individual', null, 'phone', false, pg_temp.mid(c_a, c_a2)) = 'changed=true,dups=0');
  perform pg_temp.t('O5 owner = Driver, inactive member, or another organization''s membership -> ZW006',
    pg_temp.mk(c_a1, c_a, 'O5a', null, 'o5a@example.test', 'individual', null, 'phone', false, pg_temp.mid(c_a, c_a3)) = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, 'O5b', null, 'o5b@example.test', 'individual', null, 'phone', false, pg_temp.mid(c_a, c_a5)) = 'ERR:ZW006'
    and pg_temp.mk(c_a1, c_a, 'O5c', null, 'o5c@example.test', 'individual', null, 'phone', false, pg_temp.mid(c_b, c_b1)) = 'ERR:ZW006');
  perform pg_temp.t('O6 owner options: Admins + write-grant Dispatchers only (no read grant, driver, inactive); no user ids',
    pg_temp.val_as('authenticated', c_a1, format('select string_agg(membership_id::text, '','' order by membership_id) from public.plus_list_contact_owner_options(%L)', c_a))
      = (select string_agg(id::text, ',' order by id) from public.memberships where organization_id = c_a and status = 'active'
         and (role = 'organization_admin' or user_id = c_a2))
    and (select count(*) from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name
         where r.routine_name = 'plus_list_contact_owner_options' and p.parameter_mode = 'OUT' and p.parameter_name like '%user%') = 0);

  -- =================================================== update + optimistic concurrency
  v_ver := pg_temp.ver(v_c);
  perform pg_temp.t('U1 stale version -> ZW003, nothing changed',
    pg_temp.upd(c_a1, c_a, v_c, v_ver - interval '1 second', 'Dana Renamed', '(404) 555-0100', 'dana.f@example.test', 'family_caregiver', 'Daughter') = 'ERR:ZW003'
    and (select display_name from public.plus_contacts where id = v_c) = 'Dana Fictional');
  v := pg_temp.upd(c_a1, c_a, v_c, v_ver, 'Dana Fictional', '(404) 555-0100', 'dana.f@example.test', 'family_caregiver', 'Daughter');
  perform pg_temp.t('U2 identical values with the current version -> changed=false, nothing written, no audit', v = 'changed=false'
    and (select count(*) from public.audit_events where entity_id = v_c and action = 'plus_contact_updated') = 0, v);
  v := pg_temp.upd(c_a1, c_a, v_c, v_ver, 'Dana F. Fictional', '(404) 555-0100', 'NEW.Dana@example.test', 'family_caregiver', 'Daughter', 'email', true, pg_temp.mid(c_a, c_a2));
  perform pg_temp.t('U3 real change with the current version -> applied; email normalised; do_not_contact stored', v = 'changed=true'
    and (select display_name = 'Dana F. Fictional' and email = 'new.dana@example.test' and do_not_contact and preferred_channel = 'email'
         and owner_user_id = c_a2 from public.plus_contacts where id = v_c), v);
  perform pg_temp.t('U4 audit lists the changed FIELD NAMES only (no values)',
    (select after_data -> 'fields' from public.audit_events where entity_id = v_c and action = 'plus_contact_updated')
      = '["display_name", "email", "preferred_channel", "do_not_contact", "owner"]'::jsonb
    and (select after_data::text !~ 'dana|example' from public.audit_events where entity_id = v_c and action = 'plus_contact_updated'));
  perform pg_temp.t('U5 owner change appended an owner_changed activity', pg_temp.acount(v_c, 'owner_changed') = 1);
  perform pg_temp.t('U6 edit cannot remove both phone and email -> ZW006',
    pg_temp.upd(c_a1, c_a, v_c, pg_temp.ver(v_c), 'Dana F. Fictional', null, null) = 'ERR:ZW006');
  perform pg_temp.t('U7 unknown / foreign / NULL contact -> ZW002',
    pg_temp.upd(c_a1, c_a, gen_random_uuid(), now(), 'X', null, 'x@example.test') = 'ERR:ZW002'
    and pg_temp.upd(c_a1, c_a, v_bc, pg_temp.ver(v_bc), 'X', null, 'x@example.test') = 'ERR:ZW002'
    and pg_temp.upd(c_a1, c_a, null, now(), 'X', null, 'x@example.test') = 'ERR:ZW002');
  -- (side effects first, assertions after: Postgres does not guarantee left-to-right evaluation inside one AND)
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v := pg_temp.upd(c_a1, c_a, v_c, pg_temp.ver(v_c), 'Dana F. Fictional', '(404) 555-0100', 'new.dana@example.test', 'family_caregiver', 'Granddaughter', 'email', true, pg_temp.mid(c_a, c_a2));
  v_c2 := pg_temp.cid(c_a, 'O4');
  perform pg_temp.t('U8a an owner who later lost write access is KEPT on an unrelated edit', v = 'changed=true'
    and (select owner_user_id = c_a2 and job_title = 'Granddaughter' from public.plus_contacts where id = v_c), v);
  v := pg_temp.upd(c_a1, c_a, v_c2, pg_temp.ver(v_c2), 'O4', null, 'o4@example.test', 'individual', null, 'phone', false, null);
  perform pg_temp.t('U8b owner removed (NULL owner allowed)', v = 'changed=true' and (select owner_user_id is null from public.plus_contacts where id = v_c2), v);
  v := pg_temp.upd(c_a1, c_a, v_c2, pg_temp.ver(v_c2), 'O4', null, 'o4@example.test', 'individual', null, 'phone', false, pg_temp.mid(c_a, c_a2));
  perform pg_temp.t('U8c ... but that member cannot be NEWLY assigned while lacking write access -> ZW006', v = 'ERR:ZW006', v);
  perform pg_temp.set_grant(c_a, c_a2, 'write');

  -- =================================================== activities (append-only)
  v := pg_temp.lg(c_a1, c_a, v_c, 'note', '  Prefers morning calls.  ')
    || pg_temp.lg(c_a1, c_a, v_c, 'call_logged', 'Called about a ride next week.')
    || pg_temp.lg(c_a1, c_a, v_c, 'email_logged', 'Sent our service area by email.')
    || pg_temp.lg(c_a1, c_a, v_c, 'meeting_logged', 'Met at the community event.', now() - interval '2 days');
  perform pg_temp.t('L1 log a note, a call, an email and a meeting -> four rows by the caller',
    v = 'changed=truechanged=truechanged=truechanged=true'
    and (select count(*) from public.plus_activities where contact_id = v_c and actor_user_id = c_a1
         and activity_type in ('note', 'call_logged', 'email_logged', 'meeting_logged')) = 4
    and exists (select 1 from public.plus_activities where contact_id = v_c and body = 'Prefers morning calls.'));
  perform pg_temp.t('L2 duplicate submission of the same entry within 30 s -> changed=false, not written twice',
    pg_temp.lg(c_a1, c_a, v_c, 'note', 'Prefers morning calls.') = 'changed=false' and pg_temp.acount(v_c, 'note') = 1);
  perform pg_temp.t('L3 body required (empty / whitespace) and <= 2000 -> ZW006',
    pg_temp.lg(c_a1, c_a, v_c, 'note', '   ') = 'ERR:ZW006' and pg_temp.lg(c_a1, c_a, v_c, 'note', null) = 'ERR:ZW006'
    and pg_temp.lg(c_a1, c_a, v_c, 'note', repeat('b', 2001)) = 'ERR:ZW006' and pg_temp.lg(c_a1, c_a, v_c, 'note', repeat('b', 2000)) = 'changed=true');
  perform pg_temp.t('L4 system / future / fake types cannot be logged (owner_changed, record_archived, stage_changed, quote_sent, consent_recorded) -> ZW006',
    pg_temp.lg(c_a1, c_a, v_c, 'owner_changed', 'x') = 'ERR:ZW006' and pg_temp.lg(c_a1, c_a, v_c, 'record_archived', 'x') = 'ERR:ZW006'
    and pg_temp.lg(c_a1, c_a, v_c, 'stage_changed', 'x') = 'ERR:ZW006' and pg_temp.lg(c_a1, c_a, v_c, 'quote_sent', 'x') = 'ERR:ZW006'
    and pg_temp.lg(c_a1, c_a, v_c, 'consent_recorded', 'x') = 'ERR:ZW006');
  perform pg_temp.t('L5 occurred_at: future (> 5 min) or > 366 days back -> ZW006',
    pg_temp.lg(c_a1, c_a, v_c, 'call_logged', 'future', now() + interval '1 hour') = 'ERR:ZW006'
    and pg_temp.lg(c_a1, c_a, v_c, 'call_logged', 'ancient', now() - interval '400 days') = 'ERR:ZW006');
  begin
    insert into public.plus_activities (organization_id, contact_id, activity_type, body, actor_user_id) values (c_a, null, 'note', 'x', c_a1);
    perform pg_temp.t('L6 subject check: an activity without a contact is impossible', false);
  exception when check_violation then perform pg_temp.t('L6 subject check: an activity without a contact is impossible', true);
  end;
  begin
    insert into public.plus_activities (organization_id, contact_id, activity_type, body, actor_user_id) values (c_b, v_c, 'note', 'x', c_b1);
    perform pg_temp.t('L7 composite FK: an Org B activity on an Org A contact is impossible', false);
  exception when foreign_key_violation then perform pg_temp.t('L7 composite FK: an Org B activity on an Org A contact is impossible', true);
  end;
  begin
    insert into public.plus_activities (organization_id, contact_id, activity_type, from_stage, to_stage, actor_user_id) values (c_a, v_c, 'stage_changed', 'new', 'won', c_a1);
    perform pg_temp.t('L8 stage_changed (P2-S1) is not an S4 type even at the table level', false);
  exception when check_violation then perform pg_temp.t('L8 stage_changed (P2-S1) is not an S4 type even at the table level', true);
  end;
  perform pg_temp.t('L9 immutability: no function updates or deletes plus_activities; no UPDATE / DELETE privilege for any role',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                and p.prosrc ~* '(update\s+(public\.)?plus_activities|delete\s+from\s+(public\.)?plus_activities)')
    and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'plus_activities'
                    and privilege_type in ('UPDATE', 'DELETE', 'INSERT', 'TRUNCATE') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')));
  perform pg_temp.t('L10 timeline newest first with the actor''s name; recorded_at kept for back-dated entries',
    pg_temp.val_as('authenticated', c_a1, format('select activity_type from public.plus_list_contact_activities(%L, %L, 1, 0)', c_a, v_c)) <> 'meeting_logged'
    and pg_temp.val_as('authenticated', c_a1, format('select string_agg(distinct actor_name, '','') from public.plus_list_contact_activities(%L, %L, 100, 0)', c_a, v_c)) is not null
    and exists (select 1 from public.plus_activities where contact_id = v_c and activity_type = 'meeting_logged' and recorded_at > occurred_at));

  -- =================================================== archive
  v_c2 := pg_temp.cid(c_a, 'O4');
  perform pg_temp.t('A1 archive with a stale version -> ZW003', pg_temp.arc(c_a1, c_a, v_c2, pg_temp.ver(v_c2) - interval '1 second') = 'ERR:ZW003'
    and (select status from public.plus_contacts where id = v_c2) = 'active');
  v := pg_temp.arc(c_a1, c_a, v_c2, pg_temp.ver(v_c2), '  No longer interested  ');
  perform pg_temp.t('A2 archive -> status archived, record_archived activity (reason as body), audit; the row is kept', v = 'changed=true'
    and (select status from public.plus_contacts where id = v_c2) = 'archived'
    and exists (select 1 from public.plus_activities where contact_id = v_c2 and activity_type = 'record_archived' and body = 'No longer interested')
    and (select count(*) from public.audit_events where entity_id = v_c2 and action = 'plus_contact_archived') = 1, v);
  perform pg_temp.t('A3 duplicate archive -> changed=false, no second activity',
    pg_temp.arc(c_a1, c_a, v_c2, pg_temp.ver(v_c2)) = 'changed=false' and pg_temp.acount(v_c2, 'record_archived') = 1);
  perform pg_temp.t('A4 archived = read-only history: edit and log -> ZW004; detail and timeline still readable',
    pg_temp.upd(c_a1, c_a, v_c2, pg_temp.ver(v_c2), 'O4', null, 'o4@example.test') = 'ERR:ZW004'
    and pg_temp.lg(c_a1, c_a, v_c2, 'note', 'late note') = 'ERR:ZW004'
    and pg_temp.get(c_a1, c_a, v_c2) = 'O4' and pg_temp.acts(c_a1, c_a, v_c2)::int >= 1);
  perform pg_temp.t('A5 list: active by default; archived and all on request',
    pg_temp.lst(c_a1, c_a, 'O4') = '0' and pg_temp.lst(c_a1, c_a, 'O4', null, 'archived') = '1' and pg_temp.lst(c_a1, c_a, 'O4', null, 'all') = '1');
  perform pg_temp.t('A6 archive reason > 500 -> ZW006', pg_temp.arc(c_a1, c_a, v_c, pg_temp.ver(v_c), repeat('r', 501)) = 'ERR:ZW006');

  -- =================================================== list / search
  perform pg_temp.t('S1 search by name (case-insensitive substring), email and phone digits',
    pg_temp.lst(c_a1, c_a, 'dana f.') = '1' and pg_temp.lst(c_a1, c_a, 'NEW.DANA@') = '1' and pg_temp.lst(c_a1, c_a, '555-0100') = '2');
  perform pg_temp.t('S2 LIKE wildcards in the search are literal (no "%" match-all)', pg_temp.lst(c_a1, c_a, '%') = '0' and pg_temp.lst(c_a1, c_a, '_') = '0');
  perform pg_temp.t('S3 filter by kind', pg_temp.lst(c_a1, c_a, null, 'referral_source') = '1' and pg_temp.lst(c_a1, c_a, null, 'family_caregiver') = '1');
  perform pg_temp.t('S4 bad filters / page sizes -> ZW006',
    pg_temp.lst(c_a1, c_a, null, 'patient') = 'ERR:ZW006' and pg_temp.lst(c_a1, c_a, null, null, 'deleted') = 'ERR:ZW006'
    and pg_temp.val_as('authenticated', c_a1, format('select count(*)::text from public.plus_list_contacts(%L, null, null, null, 101, 0)', c_a)) = 'ERR:ZW006');
  perform pg_temp.t('S5 pagination: total_count is the filtered total on every page',
    pg_temp.val_as('authenticated', c_a1, format('select string_agg(distinct total_count::text, '','') from public.plus_list_contacts(%L, null, null, ''all'', 2, 1)', c_a))
      = (select count(*)::text from public.plus_contacts where organization_id = c_a));

  -- =================================================== S3 permission matrix (Plus active unless stated)
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.lst(c_a2, c_a) || '|' || pg_temp.get(c_a2, c_a, v_c) || '|' || pg_temp.mk(c_a2, c_a, 'By Dispatcher', null, 'bydisp@example.test');
  v := v || '|' || pg_temp.lg(c_a2, c_a, v_c, 'call_logged', 'Dispatcher call.');
  v_c2 := pg_temp.cid(c_a, 'By Dispatcher');
  v := v || '|' || pg_temp.upd(c_a2, c_a, v_c2, pg_temp.ver(v_c2), 'By Dispatcher', '404 555 0177', 'bydisp@example.test');
  v := v || '|' || pg_temp.arc(c_a2, c_a, v_c2, pg_temp.ver(v_c2));
  perform pg_temp.t('P1 WRITE-grant Dispatcher: list, read, create, edit, log, archive',
    v ~ '^[1-9][0-9]*\|Dana F\. Fictional\|changed=true,dups=0\|changed=true\|changed=true\|changed=true$', v);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  perform pg_temp.t('P2 READ-grant Dispatcher: list / detail / timeline / RLS read ok',
    pg_temp.lst(c_a2, c_a)::int > 0 and pg_temp.get(c_a2, c_a, v_c) = 'Dana F. Fictional' and pg_temp.acts(c_a2, c_a, v_c)::int > 0
    and pg_temp.rls(c_a2, c_a)::int > 0);
  perform pg_temp.t('P3 READ-grant Dispatcher: create / edit / archive / log / owner options -> ZW001 (visible, not permitted)',
    pg_temp.mk(c_a2, c_a, 'Read Try', null, 'readtry@example.test') = 'ERR:ZW001'
    and pg_temp.upd(c_a2, c_a, v_c, pg_temp.ver(v_c), 'X', null, 'x@example.test') = 'ERR:ZW001'
    and pg_temp.arc(c_a2, c_a, v_c, pg_temp.ver(v_c)) = 'ERR:ZW001'
    and pg_temp.lg(c_a2, c_a, v_c, 'note', 'read try') = 'ERR:ZW001'
    and pg_temp.val_as('authenticated', c_a2, format('select count(*)::text from public.plus_list_contact_owner_options(%L)', c_a)) = 'ERR:ZW001');
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  perform pg_temp.t('P4 Dispatcher without a grant / revoked: no list, detail, timeline (ZW002), RLS 0 rows, no write',
    pg_temp.lst(c_a2, c_a) = 'ERR:ZW002' and pg_temp.get(c_a2, c_a, v_c) = 'ERR:ZW002' and pg_temp.acts(c_a2, c_a, v_c) = 'ERR:ZW002'
    and pg_temp.rls(c_a2, c_a) = '0' and pg_temp.mk(c_a2, c_a, 'No Grant', null, 'nogrant@example.test') = 'ERR:ZW002');
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  update public.memberships set status = 'inactive' where id = pg_temp.mid(c_a, c_a2);
  perform pg_temp.t('P5 deactivated Dispatcher (grant still unrevoked): ZW002 and RLS 0',
    pg_temp.lst(c_a2, c_a) = 'ERR:ZW002' and pg_temp.rls(c_a2, c_a) = '0' and pg_temp.lg(c_a2, c_a, v_c, 'note', 'inactive') = 'ERR:ZW002');
  update public.memberships set status = 'active' where id = pg_temp.mid(c_a, c_a2);
  perform pg_temp.t('P6 Driver, no-membership user, Platform Admin without membership: ZW002 everywhere, RLS 0',
    pg_temp.lst(c_a3, c_a) = 'ERR:ZW002' and pg_temp.rls(c_a3, c_a) = '0' and pg_temp.get(c_a3, c_a, v_c) = 'ERR:ZW002'
    and pg_temp.lst(c_e1, c_a) = 'ERR:ZW002' and pg_temp.rls(c_e1, c_a) = '0'
    and pg_temp.lst(c_d1, c_a) = 'ERR:ZW002' and pg_temp.rls(c_d1, c_a) = '0' and pg_temp.get(c_d1, c_a, v_c) = 'ERR:ZW002'
    and pg_temp.mk(c_d1, c_a, 'PA Try', null, 'patry@example.test') = 'ERR:ZW002');
  perform pg_temp.t('P7 no uid -> ZW001; anon -> 42501',
    pg_temp.lst(null, c_a) = 'ERR:ZW001'
    and pg_temp.val_as('anon', null, format('select count(*)::text from public.plus_list_contacts(%L, null, null, null, 10, 0)', c_a)) = 'ERR:42501');
  update public.organizations set status = 'inactive' where id = c_a;
  perform pg_temp.t('P8 suspended organization: Admin and write-grant Dispatcher -> ZW002, RLS 0',
    pg_temp.lst(c_a1, c_a) = 'ERR:ZW002' and pg_temp.rls(c_a1, c_a) = '0' and pg_temp.lst(c_a2, c_a) = 'ERR:ZW002'
    and pg_temp.mk(c_a1, c_a, 'Suspended', null, 'susp@example.test') = 'ERR:ZW002');
  update public.organizations set status = 'active' where id = c_a;
  perform pg_temp.set_state(c_a, 'expired');
  perform pg_temp.t('P9 expired Plus: Admin can still list / read / see the timeline; every write -> ZW001',
    pg_temp.lst(c_a1, c_a)::int > 0 and pg_temp.get(c_a1, c_a, v_c) = 'Dana F. Fictional' and pg_temp.acts(c_a1, c_a, v_c)::int > 0
    and pg_temp.rls(c_a1, c_a)::int > 0
    and pg_temp.mk(c_a1, c_a, 'Expired Try', null, 'exp@example.test') = 'ERR:ZW001'
    and pg_temp.upd(c_a1, c_a, v_c, pg_temp.ver(v_c), 'X', null, 'x@example.test') = 'ERR:ZW001'
    and pg_temp.arc(c_a1, c_a, v_c, pg_temp.ver(v_c)) = 'ERR:ZW001'
    and pg_temp.lg(c_a1, c_a, v_c, 'note', 'expired') = 'ERR:ZW001');
  perform pg_temp.t('P10 expired Plus: the WRITE-grant Dispatcher loses everything (ZW002, RLS 0)',
    pg_temp.lst(c_a2, c_a) = 'ERR:ZW002' and pg_temp.rls(c_a2, c_a) = '0' and pg_temp.lg(c_a2, c_a, v_c, 'note', 'x') = 'ERR:ZW002');
  perform pg_temp.set_state(c_a, 'locked');
  perform pg_temp.t('P11 locked Plus: Admin -> ZW002 and RLS 0 (records retained, not readable)',
    pg_temp.lst(c_a1, c_a) = 'ERR:ZW002' and pg_temp.rls(c_a1, c_a) = '0' and pg_temp.get(c_a1, c_a, v_c) = 'ERR:ZW002'
    and (select count(*) from public.plus_contacts where organization_id = c_a) > 0);
  perform pg_temp.set_state(c_a, 'none');
  perform pg_temp.t('P12 no entitlement: Admin -> ZW002', pg_temp.lst(c_a1, c_a) = 'ERR:ZW002' and pg_temp.rls(c_a1, c_a) = '0');
  perform pg_temp.set_state(c_a, 'trial');
  perform pg_temp.t('P13 trial (write): Admin full access again', pg_temp.lst(c_a1, c_a)::int > 0
    and pg_temp.lg(c_a1, c_a, v_c, 'note', 'During the trial.') = 'changed=true');

  -- =================================================== cross-tenant / forged ids
  perform pg_temp.t('X1 Org B Admin calling with Org A''s id -> ZW002 for every RPC',
    pg_temp.lst(c_b1, c_a) = 'ERR:ZW002' and pg_temp.get(c_b1, c_a, v_c) = 'ERR:ZW002' and pg_temp.acts(c_b1, c_a, v_c) = 'ERR:ZW002'
    and pg_temp.mk(c_b1, c_a, 'B into A', null, 'bintoa@example.test') = 'ERR:ZW002'
    and pg_temp.upd(c_b1, c_a, v_c, pg_temp.ver(v_c), 'X', null, 'x@example.test') = 'ERR:ZW002'
    and pg_temp.arc(c_b1, c_a, v_c, pg_temp.ver(v_c)) = 'ERR:ZW002' and pg_temp.lg(c_b1, c_a, v_c, 'note', 'x') = 'ERR:ZW002');
  perform pg_temp.t('X2 forged id: Org B Admin, own org id, Org A contact id -> ZW002 (same answer as unknown: no existence oracle)',
    pg_temp.get(c_b1, c_b, v_c) = 'ERR:ZW002' and pg_temp.get(c_b1, c_b, gen_random_uuid()) = 'ERR:ZW002'
    and pg_temp.acts(c_b1, c_b, v_c) = 'ERR:ZW002'
    and pg_temp.upd(c_b1, c_b, v_c, pg_temp.ver(v_c), 'X', null, 'x@example.test') = 'ERR:ZW002'
    and pg_temp.arc(c_b1, c_b, v_c, pg_temp.ver(v_c)) = 'ERR:ZW002' and pg_temp.lg(c_b1, c_b, v_c, 'note', 'x') = 'ERR:ZW002'
    and (select display_name from public.plus_contacts where id = v_c) = 'Dana F. Fictional');
  perform pg_temp.t('X3 RLS: each Admin sees only their own organization''s contacts',
    pg_temp.val_as('authenticated', c_b1, 'select string_agg(distinct organization_id::text, '','') from public.plus_contacts') = c_b::text
    and pg_temp.val_as('authenticated', c_a1, 'select string_agg(distinct organization_id::text, '','') from public.plus_contacts') = c_a::text
    and pg_temp.rls(c_a1, c_b) = '0' and pg_temp.rls(c_b1, c_a) = '0');
  perform pg_temp.t('X4 multi-organization identity c1 (Admin in A, Driver in B): A yes, B never',
    pg_temp.lst(c_c1, c_a)::int > 0 and pg_temp.lst(c_c1, c_b) = 'ERR:ZW002' and pg_temp.rls(c_c1, c_b) = '0');
  perform pg_temp.t('X5 Org B Dispatcher (no grant in B) sees nothing in B or A',
    pg_temp.lst(c_b2, c_b) = 'ERR:ZW002' and pg_temp.lst(c_b2, c_a) = 'ERR:ZW002' and pg_temp.rls(c_b2, c_a) = '0');

  -- =================================================== NP-P2-S6-A: plus_update_contact DNC transition (ZD-233)
  perform pg_temp.mk(c_a1, c_a, 'S6 Dnc Fictional', '404 555 0190', 's6dnc@example.test');
  v_s6 := pg_temp.cid(c_a, 'S6 Dnc Fictional');
  v := pg_temp.val_as('authenticated', c_a1, format(
    'select r.recorded_status from public.plus_record_consent(%L, %L, ''email'', ''marketing'', ''written'', null, null, null, ''s6-contacts-suite-1'') r', c_a, v_s6));
  perform pg_temp.t('U-DNC0 a consent grant is recorded on the contact (fixture)', v = 'granted', v);
  v := pg_temp.upd(c_a1, c_a, v_s6, pg_temp.ver(v_s6), 'S6 Dnc Fictional', '404 555 0190', 's6dnc@example.test', 'individual', null, 'phone', true);
  perform pg_temp.t('U-DNC1 switching Do not contact ON keeps the released result and audit, and appends exactly one system revocation for the granted pair (no activity)',
    v = 'changed=true'
    and (select do_not_contact from public.plus_contacts where id = v_s6)
    and (select after_data from public.audit_events where entity_id = v_s6 and action = 'plus_contact_updated') = jsonb_build_object('fields', jsonb_build_array('do_not_contact'))
    and (select count(*) from public.plus_communication_consents where contact_id = v_s6 and status = 'revoked' and captured_via = 'do_not_contact') = 1
    and pg_temp.acount(v_s6) = 0, v);
  v := pg_temp.upd(c_a1, c_a, v_s6, pg_temp.ver(v_s6), 'S6 Dnc Fictional', '404 555 0190', 's6dnc@example.test', 'individual', null, 'phone', false);
  perform pg_temp.t('U-DNC2 switching it OFF writes no consent row and revives nothing (latest row stays revoked)',
    v = 'changed=true'
    and (select count(*) from public.plus_communication_consents where contact_id = v_s6) = 2
    and (select status from public.plus_communication_consents where contact_id = v_s6 order by seq desc limit 1) = 'revoked', v);

  -- =================================================== Core isolation
  v_core_after := (select count(*) from public.transportation_requests)::text || '/' || (select count(*) from public.passengers)::text
                  || '/' || (select count(*) from public.trips)::text || '/' || (select count(*) from public.facilities)::text;
  perform pg_temp.t('C1 no Core record created (Requests / Passengers / Trips / Facilities unchanged)', v_core_before = v_core_after, v_core_before || ' -> ' || v_core_after);
  perform pg_temp.t('C2 no Core function references plus_contacts / plus_activities / Plus helpers',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname !~ '^(plus_|_plus_|_require_plus_)'
      and p.proname not in ('platform_set_organization_module', 'platform_extend_plus_trial', 'platform_get_organization_module')
      -- NP-FIN-P1 FU-2 (narrow): billing_create_invoice_draft (NP-BILL-P1 R3 / ZD-274) may call plus_can_read ONLY,
      -- to gate the optional read-only quote import; any other Plus reference in it still fails this check.
      and not (p.proname = 'billing_create_invoice_draft'
               and regexp_replace(p.prosrc, 'plus_can_read', '', 'g') !~ 'plus_contacts|plus_activities|plus_can_(read|write)|_require_plus_|_plus_member_access')
      and p.prosrc ~ 'plus_contacts|plus_activities|plus_can_(read|write)|_require_plus_|_plus_member_access'));
  perform pg_temp.t('C3 no Core RLS policy references Plus objects',
    not exists (select 1 from pg_policy where polrelid::regclass::text !~ '^(public\.)?plus_'
      and coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '') ~ 'plus_|membership_module_grants|organization_modules'));
  perform pg_temp.t('C4 Plus permissions confer no Core role: a write-grant Dispatcher is still not an Organization Admin',
    pg_temp.val_as('authenticated', c_a2, format('select public.has_org_role(%L, array[''organization_admin''])::text', c_a)) = 'false');
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from k_results;
select name, detail from k_results where not ok order by n;

rollback;
