-- Nemryn Platform -- Tenant Foundation + Settings tests (P1-PILOT-S4B-R4A).
-- Run against `supabase db reset` fresh-seeded data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/tenant_settings_foundation_tests.sql
--
-- Covers 20260920090000_tenant_settings_foundation.sql:
--   * update_organization_settings -- Organization Admin only; Dispatcher /
--     Driver / inactive Membership / no Membership / Platform Admin / foreign
--     org / nonexistent org / anon / no session all denied; validation;
--     patch semantics; AuditEvent; no-op writes nothing.
--   * direct column UPDATE of organizations.name / timezone / the new
--     profile columns is denied; INSERT/DELETE on organizations and
--     INSERT on memberships remain denied (no generic table privilege).
--   * signup_create_organization is internal-only (no client role can call
--     it); the exactly-once gates complete_pending_signup[_manual] are the
--     only self-service organization-creation path: creates Organization +
--     Admin Membership + UserProfile + AuditEvent atomically, exactly once,
--     refuses an existing member, exposes no user/org/role parameter.
--
-- Method: SET ROLE + request.jwt.claim.sub inside a helper, same mechanism
-- as every other suite (mirrors what PostgREST produces). Fixtures: seed.sql
-- users/orgs plus this file's own fresh users under 96000000-...-eN.
-- Concurrency for organization creation lives in
-- tenant_org_creation_concurrency_test.sh (real parallel sessions).

\set ON_ERROR_STOP off
\pset pager off

-- ---------------------------------------------------------------------------
-- Helpers (session-local, dropped with the connection)
-- ---------------------------------------------------------------------------
-- Runs a statement as a role/user and reports 'OK' or the SQLSTATE.
create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_stmt text)
returns text
language plpgsql
as $$
begin
  execute format('set local role %I', p_role);
  if p_uid is not null then
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
  else
    perform set_config('request.jwt.claim.sub', '', true);
  end if;
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

create or replace function pg_temp.report(p_name text, p_ok boolean, p_detail text default '')
returns void
language plpgsql
as $$
begin
  if p_ok then
    raise notice 'TEST %: PASS', p_name;
  else
    raise notice 'TEST %: FAIL (%)', p_name, p_detail;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: fresh, memberless auth users.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token
) values
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'r4a-fresh-1@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'r4a-fresh-2@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-0000-0000-0000000000e3', 'authenticated', 'authenticated', 'r4a-fresh-3@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-0000-0000-0000000000e4', 'authenticated', 'authenticated', 'r4a-fresh-4@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', '')
on conflict (id) do nothing;

-- =============================================================================
-- A. ORGANIZATION SETTINGS MUTATION
-- Org A: admin a1, dispatcher a2, driver a3, inactive dispatcher a5.
-- Org B: admin b1. Platform admin d1. No-membership e1.
-- =============================================================================

-- SET-1/2: Organization Admin updates own org -- values trimmed, email
-- lowercased, persisted; AuditEvent written with changed-fields-only.
do $$
declare
  v_res public.organization_settings_result;
  v_org public.organizations%rowtype;
  v_audit public.audit_events%rowtype;
  v_audits_before bigint;
begin
  select count(*) into v_audits_before from public.audit_events
    where organization_id = '10000000-0000-0000-0000-0000000000a1' and action = 'organization_settings_updated';

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.update_organization_settings('10000000-0000-0000-0000-0000000000a1', jsonb_build_object(
    'name', '  R4A Renamed Org A  ',
    'timezone', 'America/Chicago',
    'business_phone', ' (404) 555-0100 ',
    'business_email', '  Dispatch@R4A-Org-A.Example ',
    'business_address', E'1 Test Way\nAtlanta, GA 30301',
    'primary_contact_name', 'Pat Operator'
  ));
  reset role;

  select * into v_org from public.organizations where id = '10000000-0000-0000-0000-0000000000a1';
  perform pg_temp.report('SET-1 (admin updates own org profile)',
    v_res.changed and v_res.organization_id = v_org.id
    and v_org.name = 'R4A Renamed Org A' and v_org.timezone = 'America/Chicago'
    and v_org.business_phone = '(404) 555-0100' and v_org.business_email = 'dispatch@r4a-org-a.example'
    and v_org.business_address like '1 Test Way%' and v_org.primary_contact_name = 'Pat Operator',
    format('changed=%s org=%s', v_res.changed, row_to_json(v_org)));

  select * into v_audit from public.audit_events
    where organization_id = v_org.id and action = 'organization_settings_updated'
    order by occurred_at desc, id limit 1;
  perform pg_temp.report('SET-2 (AuditEvent: entity, actor, changed-fields before/after)',
    (select count(*) from public.audit_events where organization_id = v_org.id and action = 'organization_settings_updated') = v_audits_before + 1
    and v_audit.entity_type = 'organization' and v_audit.entity_id = v_org.id
    and v_audit.actor_user_id = '20000000-0000-0000-0000-0000000000a1'
    and v_audit.before_data ->> 'name' is not null and v_audit.after_data ->> 'name' = 'R4A Renamed Org A'
    and v_audit.after_data ->> 'timezone' = 'America/Chicago' and v_audit.before_data ->> 'timezone' = 'America/New_York',
    format('audit=%s', row_to_json(v_audit)));
end $$;

-- SET-3: resubmitting identical values is a no-op: changed=false, no new AuditEvent.
do $$
declare
  v_res public.organization_settings_result;
  v_before bigint;
begin
  select count(*) into v_before from public.audit_events where action = 'organization_settings_updated';
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.update_organization_settings('10000000-0000-0000-0000-0000000000a1', jsonb_build_object(
    'name', 'R4A Renamed Org A', 'timezone', 'America/Chicago', 'business_email', 'dispatch@r4a-org-a.example'));
  reset role;
  perform pg_temp.report('SET-3 (identical resubmit: changed=false, no AuditEvent)',
    not v_res.changed and (select count(*) from public.audit_events where action = 'organization_settings_updated') = v_before,
    format('changed=%s', v_res.changed));
end $$;

-- SET-4: patch semantics -- absent keys untouched; blank clears an optional field.
do $$
declare v_org public.organizations%rowtype;
begin
  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
    $q$select public.update_organization_settings('10000000-0000-0000-0000-0000000000a1', '{"business_phone": "", "primary_contact_name": null}'::jsonb)$q$);
  select * into v_org from public.organizations where id = '10000000-0000-0000-0000-0000000000a1';
  perform pg_temp.report('SET-4 (blank/null clears optional field; absent keys untouched)',
    v_org.business_phone is null and v_org.primary_contact_name is null
    and v_org.name = 'R4A Renamed Org A' and v_org.business_email = 'dispatch@r4a-org-a.example',
    format('org=%s', row_to_json(v_org)));
end $$;

-- SET-5..10: every non-admin / non-member caller is denied with the SAME ZW002.
do $$
declare
  v_probe text := $q$select public.update_organization_settings('10000000-0000-0000-0000-0000000000a1', '{"name": "HIJACK"}'::jsonb)$q$;
begin
  perform pg_temp.report('SET-5 (Dispatcher denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', v_probe) = 'ZW002');
  perform pg_temp.report('SET-6 (Driver denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', v_probe) = 'ZW002');
  perform pg_temp.report('SET-7 (inactive Membership denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a5', v_probe) = 'ZW002');
  perform pg_temp.report('SET-8 (no Membership anywhere denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', v_probe) = 'ZW002');
  perform pg_temp.report('SET-9 (Platform Admin without Membership denied -- unchanged: no platform UPDATE path existed)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000d1', v_probe) = 'ZW002');
  perform pg_temp.report('SET-10 (Org B admin cannot mutate Org A)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', v_probe) = 'ZW002');
  perform pg_temp.report('SET-11 (Org A admin cannot mutate Org B)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
      $q$select public.update_organization_settings('10000000-0000-0000-0000-0000000000b1', '{"name": "HIJACK"}'::jsonb)$q$) = 'ZW002');
  perform pg_temp.report('SET-12 (nonexistent org id indistinguishable from foreign: ZW002)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
      $q$select public.update_organization_settings('11111111-1111-1111-1111-111111111111', '{"name": "X"}'::jsonb)$q$) = 'ZW002');
  perform pg_temp.report('SET-13 (null org id: ZW002)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
      $q$select public.update_organization_settings(null, '{"name": "X"}'::jsonb)$q$) = 'ZW002');
  perform pg_temp.report('SET-14 (authenticated role, no session subject: ZW001)',
    pg_temp.try_as('authenticated', null, v_probe) = 'ZW001');
  perform pg_temp.report('SET-15 (anon has no EXECUTE)',
    pg_temp.try_as('anon', null, v_probe) = '42501');
  perform pg_temp.report('SET-16 (nothing was hijacked: Org A / Org B names intact)',
    (select name from public.organizations where id = '10000000-0000-0000-0000-0000000000a1') = 'R4A Renamed Org A'
    and (select name from public.organizations where id = '10000000-0000-0000-0000-0000000000b1') = 'Fictional Org B');
end $$;

-- SET-20..: validation -- all ZW006, and nothing changes.
do $$
declare
  v_snapshot text := (select row_to_json(o)::text from public.organizations o where id = '10000000-0000-0000-0000-0000000000a1');
  v_uid uuid := '20000000-0000-0000-0000-0000000000a1';
  v_stmt text;
  v_bad text[] := array[
    $j${"name": ""}$j$,
    $j${"name": "   "}$j$,
    $j${"name": null}$j$,
    $j${"timezone": "EST"}$j$,
    $j${"timezone": "Eastern"}$j$,
    $j${"timezone": ""}$j$,
    $j${"timezone": "Mars/Olympus"}$j$,
    $j${"business_email": "not-an-email"}$j$,
    $j${"business_email": "a@b"}$j$,
    $j${"business_phone": "123"}$j$,
    $j${"business_phone": "call me maybe"}$j$,
    $j${"status": "inactive"}$j$,
    $j${"business_stage": "established"}$j$,
    $j${"id": "11111111-1111-1111-1111-111111111111"}$j$,
    $j${"organization_id": "10000000-0000-0000-0000-0000000000b1"}$j$,
    $j${"name": 5}$j$,
    $j${"name": ["a"]}$j$,
    $j${"name": {"a": 1}}$j$,
    '[]',
    '"just a string"',
    'null'
  ];
  v_ok boolean := true;
  v_failed text := '';
  v_code text;
begin
  foreach v_stmt in array v_bad loop
    v_code := pg_temp.try_as('authenticated', v_uid,
      format('select public.update_organization_settings(%L, %L::jsonb)', '10000000-0000-0000-0000-0000000000a1', v_stmt));
    if v_code is distinct from 'ZW006' then
      v_ok := false;
      v_failed := v_failed || format(' [%s -> %s]', v_stmt, v_code);
    end if;
  end loop;
  perform pg_temp.report('SET-20 (21 invalid payloads: blank/oversize-free name, bad tz, bad email/phone, unknown or privileged keys, non-string values, non-object patch -> ZW006)', v_ok, v_failed);

  v_code := pg_temp.try_as('authenticated', v_uid,
    format('select public.update_organization_settings(%L, jsonb_build_object(''name'', %L))', '10000000-0000-0000-0000-0000000000a1', repeat('n', 201)));
  perform pg_temp.report('SET-21 (name > 200 chars -> ZW006)', v_code = 'ZW006', v_code);
  v_code := pg_temp.try_as('authenticated', v_uid,
    format('select public.update_organization_settings(%L, jsonb_build_object(''business_address'', %L))', '10000000-0000-0000-0000-0000000000a1', repeat('a', 501)));
  perform pg_temp.report('SET-22 (address > 500 chars -> ZW006)', v_code = 'ZW006', v_code);

  perform pg_temp.report('SET-23 (rejected payloads left the organization row byte-identical)',
    v_snapshot = (select row_to_json(o)::text from public.organizations o where id = '10000000-0000-0000-0000-0000000000a1'));
end $$;

-- SET-24: a rejected mutation is atomic -- a valid field bundled with an invalid one is not applied.
do $$
declare v_code text;
begin
  v_code := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
    $q$select public.update_organization_settings('10000000-0000-0000-0000-0000000000a1', '{"name": "Should Not Apply", "timezone": "EST"}'::jsonb)$q$);
  perform pg_temp.report('SET-24 (valid + invalid bundle: rejected, nothing applied)',
    v_code = 'ZW006' and (select name from public.organizations where id = '10000000-0000-0000-0000-0000000000a1') = 'R4A Renamed Org A', v_code);
end $$;

-- =============================================================================
-- B. DIRECT TABLE PRIVILEGE SURFACE
-- =============================================================================
do $$
declare
  v_cols text;
  v_stmt text;
  v_code text;
  v_ok boolean := true;
  v_failed text := '';
begin
  -- Column-level UPDATE grants on organizations are now exactly the three
  -- descriptive columns that keep their own narrow grants.
  select string_agg(column_name, ',' order by column_name) into v_cols
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'organizations' and grantee = 'authenticated' and privilege_type = 'UPDATE';
  perform pg_temp.report('PRIV-1 (organizations UPDATE columns for authenticated = business_stage,service_area_description,status)',
    v_cols = 'business_stage,service_area_description,status' and not has_table_privilege('authenticated', 'public.organizations', 'UPDATE'), v_cols);

  -- Direct writes as the Org A ADMIN (the strongest legitimate caller) are denied.
  foreach v_stmt in array array[
    $q$update public.organizations set name = 'direct' where id = '10000000-0000-0000-0000-0000000000a1'$q$,
    $q$update public.organizations set timezone = 'America/Denver' where id = '10000000-0000-0000-0000-0000000000a1'$q$,
    $q$update public.organizations set business_phone = '5550100000' where id = '10000000-0000-0000-0000-0000000000a1'$q$,
    $q$update public.organizations set business_email = 'x@y.example' where id = '10000000-0000-0000-0000-0000000000a1'$q$,
    $q$update public.organizations set business_address = 'x' where id = '10000000-0000-0000-0000-0000000000a1'$q$,
    $q$update public.organizations set primary_contact_name = 'x' where id = '10000000-0000-0000-0000-0000000000a1'$q$,
    $q$insert into public.organizations (name, timezone) values ('direct insert', 'America/New_York')$q$,
    $q$delete from public.organizations where id = '10000000-0000-0000-0000-0000000000a1'$q$
  ] loop
    v_code := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', v_stmt);
    if v_code is distinct from '42501' then
      v_ok := false;
      v_failed := v_failed || format(' [%s -> %s]', v_stmt, v_code);
    end if;
  end loop;
  perform pg_temp.report('PRIV-2 (admin: direct UPDATE of name/timezone/profile columns, INSERT, DELETE on organizations all denied)', v_ok, v_failed);

  -- A fresh user cannot mint a Membership for themselves anywhere (RLS: has_org_role).
  v_code := pg_temp.try_as('authenticated', '96000000-0000-0000-0000-0000000000e4',
    $q$insert into public.memberships (organization_id, user_id, role, status) values ('10000000-0000-0000-0000-0000000000a1', '96000000-0000-0000-0000-0000000000e4', 'organization_admin', 'active')$q$);
  perform pg_temp.report('PRIV-3 (fresh user cannot INSERT themselves an admin Membership into an existing org)', v_code = '42501', v_code);

  -- ...nor into an org that does not exist yet / by any other route.
  v_code := pg_temp.try_as('authenticated', '96000000-0000-0000-0000-0000000000e4',
    $q$insert into public.audit_events (organization_id, entity_type, entity_id, action) values ('10000000-0000-0000-0000-0000000000a1', 'organization', '10000000-0000-0000-0000-0000000000a1', 'organization_created')$q$);
  perform pg_temp.report('PRIV-4 (no client role can write audit_events directly)', v_code = '42501', v_code);

  perform pg_temp.report('PRIV-5 (update_organization_settings ACL: postgres + authenticated only; no anon, no PUBLIC)',
    has_function_privilege('authenticated', 'public.update_organization_settings(uuid, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.update_organization_settings(uuid, jsonb)', 'EXECUTE')
    and not has_function_privilege('public', 'public.update_organization_settings(uuid, jsonb)', 'EXECUTE'));
end $$;

-- =============================================================================
-- C. READ ISOLATION
-- =============================================================================
do $$
declare v_own int; v_foreign int; v_phone text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2'; -- Org A dispatcher
  select count(*) into v_own from public.organizations where id = '10000000-0000-0000-0000-0000000000a1';
  select count(*) into v_foreign from public.organizations where id = '10000000-0000-0000-0000-0000000000b1';
  reset role;
  perform pg_temp.report('READ-1 (Org A member reads own org row, zero rows of Org B)', v_own = 1 and v_foreign = 0, format('own=%s foreign=%s', v_own, v_foreign));

  -- Give Org B a distinguishable phone (owner role), prove Org A users never see it.
  update public.organizations set business_phone = '(212) 555-0199' where id = '10000000-0000-0000-0000-0000000000b1';
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin
  select business_phone into v_phone from public.organizations where business_phone = '(212) 555-0199';
  reset role;
  perform pg_temp.report('READ-2 (Org A admin cannot read Org B business profile columns)', v_phone is null, coalesce(v_phone, 'null'));
  update public.organizations set business_phone = null where id = '10000000-0000-0000-0000-0000000000b1';
end $$;

-- =============================================================================
-- D. SELF-SERVICE ORGANIZATION CREATION AUTHORITY
-- =============================================================================
do $$
begin
  perform pg_temp.report('CREATE-1 (signup_create_organization: authenticated has NO EXECUTE)',
    not has_function_privilege('authenticated', 'public.signup_create_organization(text, text, text, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.signup_create_organization(text, text, text, text)', 'EXECUTE')
    and not has_function_privilege('public', 'public.signup_create_organization(text, text, text, text)', 'EXECUTE'));
  perform pg_temp.report('CREATE-2 (direct call as authenticated fresh user -> insufficient_privilege)',
    pg_temp.try_as('authenticated', '96000000-0000-0000-0000-0000000000e3',
      $q$select public.signup_create_organization('Direct Bypass Org', 'Bypass', null, 'America/New_York')$q$) = '42501');
  perform pg_temp.report('CREATE-3 (anon direct call denied)',
    pg_temp.try_as('anon', null, $q$select public.signup_create_organization('Anon Bypass Org', 'Bypass', null, 'America/New_York')$q$) = '42501');
  perform pg_temp.report('CREATE-4 (the two gates remain executable by authenticated, not by anon)',
    has_function_privilege('authenticated', 'public.complete_pending_signup()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.complete_pending_signup_manual(text, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.complete_pending_signup()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.complete_pending_signup_manual(text, text)', 'EXECUTE'));

  -- No parameter through which a caller could inject an owner/admin user id,
  -- an organization id, a role, or a created_by identity.
  perform pg_temp.report('CREATE-5 (gate signatures expose only names -- no user id / org id / role / created_by parameter)',
    (select array_agg(a order by a) from (select unnest(proargnames) a from pg_proc where proname = 'complete_pending_signup_manual') s) = array['p_business_name', 'p_full_name']
    and (select coalesce(array_length(proargnames, 1), 0) from pg_proc where proname = 'complete_pending_signup') = 0);
end $$;

-- CREATE-10..: a genuinely fresh authenticated user creates exactly one org
-- through the gate: Organization + Admin Membership + UserProfile + AuditEvent.
do $$
declare
  v_res public.organization_signup_result;
  v_org public.organizations%rowtype;
  v_membership public.memberships%rowtype;
  v_orgs bigint; v_members bigint;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '96000000-0000-0000-0000-0000000000e1';
  v_res := public.complete_pending_signup_manual('Fresh Owner', '  R4A Fresh Transport Co  ');
  reset role;

  select * into v_org from public.organizations where id = v_res.organization_id;
  select * into v_membership from public.memberships where id = v_res.membership_id;

  perform pg_temp.report('CREATE-10 (fresh user: organization created, trimmed name, active)',
    v_res.created and v_org.name = 'R4A Fresh Transport Co' and v_org.status = 'active', format('res=%s org=%s', v_res, row_to_json(v_org)));
  perform pg_temp.report('CREATE-11 (caller became Organization Admin, active, in exactly that org)',
    v_membership.user_id = '96000000-0000-0000-0000-0000000000e1' and v_membership.role = 'organization_admin'
    and v_membership.status = 'active' and v_membership.organization_id = v_org.id, format('m=%s', row_to_json(v_membership)));
  perform pg_temp.report('CREATE-12 (UserProfile created with the given display name)',
    exists (select 1 from public.user_profiles where id = '96000000-0000-0000-0000-0000000000e1' and display_name = 'Fresh Owner'));
  perform pg_temp.report('CREATE-13 (organization_created AuditEvent, actor = caller)',
    exists (select 1 from public.audit_events where organization_id = v_org.id and action = 'organization_created' and actor_user_id = '96000000-0000-0000-0000-0000000000e1'));

  -- Double submit / retry: exactly-once.
  set local role authenticated;
  set local request.jwt.claim.sub = '96000000-0000-0000-0000-0000000000e1';
  v_res := public.complete_pending_signup_manual('Fresh Owner', 'R4A Fresh Transport Co Duplicate');
  reset role;
  select count(*) into v_orgs from public.organizations where name like 'R4A Fresh Transport Co%';
  select count(*) into v_members from public.memberships where user_id = '96000000-0000-0000-0000-0000000000e1';
  perform pg_temp.report('CREATE-14 (second submit by the same user: created=false, still exactly 1 org and 1 Membership)',
    not v_res.created and v_orgs = 1 and v_members = 1, format('created=%s orgs=%s members=%s', v_res.created, v_orgs, v_members));

  -- The new tenant is isolated: another fresh user (and Org A's admin) cannot see it.
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  perform 1 from public.organizations where id = v_org.id;
  reset role;
  perform pg_temp.report('CREATE-15 (Org A admin cannot see the new tenant)', not found);
  set local role authenticated;
  set local request.jwt.claim.sub = '96000000-0000-0000-0000-0000000000e2';
  perform 1 from public.organizations where id = v_org.id;
  reset role;
  perform pg_temp.report('CREATE-16 (another fresh user cannot see the new tenant)', not found);

  -- The new admin can configure it through the SAME audited path.
  set local role authenticated;
  set local request.jwt.claim.sub = '96000000-0000-0000-0000-0000000000e1';
  perform public.update_organization_settings(v_org.id, '{"timezone": "America/Los_Angeles", "business_email": "ops@r4a-fresh.example"}'::jsonb);
  reset role;
  perform pg_temp.report('CREATE-17 (new admin configures own org via update_organization_settings)',
    (select timezone from public.organizations where id = v_org.id) = 'America/Los_Angeles');
end $$;

-- CREATE-20..: eligibility -- an existing member (any role) creates nothing.
do $$
declare
  v_orgs_before bigint := (select count(*) from public.organizations);
  v_members_before bigint := (select count(*) from public.memberships);
  v_res public.organization_signup_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2'; -- Org A dispatcher
  v_res := public.complete_pending_signup_manual('Dispatcher', 'Dispatcher Side Org');
  reset role;
  perform pg_temp.report('CREATE-20 (existing Dispatcher: gate refuses, created=false)', not v_res.created);

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3'; -- Org A driver
  v_res := public.complete_pending_signup_manual('Driver', 'Driver Side Org');
  reset role;
  perform pg_temp.report('CREATE-21 (existing Driver: gate refuses, created=false)', not v_res.created);

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a5'; -- inactive Membership
  v_res := public.complete_pending_signup_manual('Inactive', 'Inactive Side Org');
  reset role;
  perform pg_temp.report('CREATE-22 (holder of an inactive Membership: gate refuses, created=false)', not v_res.created);

  perform pg_temp.report('CREATE-23 (none of those attempts created an organization or Membership)',
    (select count(*) from public.organizations) = v_orgs_before and (select count(*) from public.memberships) = v_members_before);
end $$;

-- CREATE-30..: authentication required; atomic rollback on invalid input.
do $$
declare
  v_orgs bigint := (select count(*) from public.organizations);
  v_members bigint := (select count(*) from public.memberships);
  v_profiles bigint := (select count(*) from public.user_profiles);
  v_code text;
begin
  perform pg_temp.report('CREATE-30 (no session subject: ZW001)',
    pg_temp.try_as('authenticated', null, $q$select public.complete_pending_signup_manual('X', 'Y')$q$) = 'ZW001');
  perform pg_temp.report('CREATE-31 (anon: no EXECUTE)',
    pg_temp.try_as('anon', null, $q$select public.complete_pending_signup_manual('X', 'Y')$q$) = '42501');

  v_code := pg_temp.try_as('authenticated', '96000000-0000-0000-0000-0000000000e2', $q$select public.complete_pending_signup_manual('Someone', '   ')$q$);
  perform pg_temp.report('CREATE-32 (blank organization name -> ZW006)', v_code = 'ZW006', v_code);
  v_code := pg_temp.try_as('authenticated', '96000000-0000-0000-0000-0000000000e2',
    format('select public.complete_pending_signup_manual(%L, %L)', 'Someone', repeat('o', 201)));
  perform pg_temp.report('CREATE-33 (organization name > 200 chars -> ZW006)', v_code = 'ZW006', v_code);
  perform pg_temp.report('CREATE-34 (rejected creation left no Organization, Membership or UserProfile behind)',
    (select count(*) from public.organizations) = v_orgs and (select count(*) from public.memberships) = v_members
    and (select count(*) from public.user_profiles) = v_profiles);
end $$;

-- CREATE-40: an in-flight Driver-invite invitee is not silently converted --
-- the gate itself is role-agnostic (a person with NO Membership may create an
-- org through the explicit form); the route layer (complete-signup/route.ts)
-- is what keeps invitees out. Asserted here only as the DB contract: a user
-- who already redeemed an invite (holds a driver Membership) is refused.
do $$
declare v_res public.organization_signup_result;
begin
  insert into public.memberships (organization_id, user_id, role, status)
  values ('10000000-0000-0000-0000-0000000000a1', '96000000-0000-0000-0000-0000000000e3', 'driver', 'active');
  set local role authenticated;
  set local request.jwt.claim.sub = '96000000-0000-0000-0000-0000000000e3';
  v_res := public.complete_pending_signup_manual('Invitee', 'Invitee Side Org');
  reset role;
  perform pg_temp.report('CREATE-40 (redeemed driver invitee cannot mint an organization)', not v_res.created);
  delete from public.memberships where user_id = '96000000-0000-0000-0000-0000000000e3';
end $$;

-- =============================================================================
-- Restore Org A to seed values so later suites see unmodified fixtures.
-- =============================================================================
update public.organizations
set name = 'Fictional Org A', timezone = 'America/New_York',
    business_phone = null, business_email = null, business_address = null, primary_contact_name = null
where id = '10000000-0000-0000-0000-0000000000a1';
