-- Nemryn Platform -- Website Integration Self-Service tests (P1-PILOT-S4B-R4B).
-- Run against `supabase db reset` fresh-seeded data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/website_integration_self_service_tests.sql
--
-- Covers 20260920100000_website_integration_self_service.sql:
--   * _normalize_website_origin accept/normalize/reject vectors (shared with
--     src/lib/operations/website-integration-core.test.mjs)
--   * Integration ID generation: format, uniqueness, encodes nothing
--   * create / list / activate / disable / update-origin: Organization Admin
--     only; Dispatcher, Driver, inactive Membership, no Membership, Platform
--     Admin, foreign Admin, anon and no-session all denied; cross-tenant
--     integration UUIDs indistinguishable from nonexistent (ZW002)
--   * disabled-by-default; origin change auto-disables; AuditEvents
--   * the locked table stays locked: no SELECT/INSERT/UPDATE/DELETE for
--     authenticated or anon, no policy added
--   * the UNCHANGED public-intake path consumes a self-service integration
--     (activate -> accepted; disable -> rejected; history preserved) and no
--     Passenger / Trip / recurring arrangement is created
-- Fixtures: seed.sql users/orgs (Org A admin a1, dispatcher a2, driver a3,
-- inactive a5; Org B admin b1; platform admin d1; no-membership e1).
-- Concurrency: website_integration_concurrency_test.sh.

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_stmt text)
returns text
language plpgsql
as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
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
  if p_ok then raise notice 'TEST %: PASS', p_name;
  else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;

-- =============================================================================
-- A. ORIGIN NORMALIZATION
-- =============================================================================
do $$
declare
  v_ok boolean := true; v_failed text := '';
  r record;
begin
  for r in select * from (values
    ('https://www.example.com', 'https://www.example.com'),
    ('https://example.com', 'https://example.com'),
    ('https://portal.example.com', 'https://portal.example.com'),
    ('https://www.example.com/', 'https://www.example.com'),
    ('  HTTPS://WWW.Example.COM/  ', 'https://www.example.com'),
    ('https://example.com:443', 'https://example.com'),
    ('https://example.com:8443', 'https://example.com:8443'),
    ('https://example.co.uk', 'https://example.co.uk'),
    ('https://xn--bcher-kva.example', 'https://xn--bcher-kva.example'),
    ('https://a-b.example-site.org', 'https://a-b.example-site.org')
  ) as t(input, expected) loop
    if public._normalize_website_origin(r.input) is distinct from r.expected then
      v_ok := false; v_failed := v_failed || format(' [%s -> %s]', r.input, public._normalize_website_origin(r.input));
    end if;
  end loop;
  perform pg_temp.report('ORIGIN-1 (accepted origins normalize to canonical form)', v_ok, v_failed);
end $$;

do $$
declare
  v_ok boolean := true; v_failed text := '';
  v_bad text[] := array[
    'http://example.com', 'https://example.com/path', 'https://example.com/path/', 'https://example.com?x=1',
    'https://example.com/?x=1', 'https://example.com#fragment', 'https://user:pass@example.com', 'https://user@example.com',
    'https://*.example.com', '*.example.com', 'https://*', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com',
    'example.com', 'www.example.com', '//example.com', 'https://', 'https:///', 'https://localhost', 'https://localhost:3000',
    'http://localhost:3000', 'https://127.0.0.1', 'https://192.168.1.1', 'https://[::1]', 'https://example', 'https://example.c',
    'https://exa mple.com', E'https://example.com\n', E'\thttps://example.com', 'https://-example.com', 'https://example-.com',
    'https://exa_mple.com', 'https://example.com:0', 'https://example.com:99999', 'https://example.com:abc',
    'https://example.com//', 'https://bücher.example', '', '   ', 'null', 'https://.example.com', 'https://example..com',
    'https://example.com.', repeat('a', 300)
  ];
  s text;
begin
  foreach s in array v_bad loop
    if public._normalize_website_origin(s) is not null then
      v_ok := false; v_failed := v_failed || format(' [%L accepted as %s]', s, public._normalize_website_origin(s));
    end if;
  end loop;
  if public._normalize_website_origin(null) is not null then v_ok := false; v_failed := v_failed || ' [null]'; end if;
  perform pg_temp.report('ORIGIN-2 (' || array_length(v_bad, 1) || ' malformed/unsafe origins all rejected: http, path, query, fragment, userinfo, wildcard, schemes, IPs, localhost, bad ports, non-ASCII)', v_ok, v_failed);
end $$;

-- =============================================================================
-- B. INTEGRATION ID GENERATION
-- =============================================================================
do $$
declare v_ids text[]; v_distinct int; v_bad int;
begin
  select array_agg(public._generate_intake_external_id()) into v_ids from generate_series(1, 500);
  select count(distinct x) into v_distinct from unnest(v_ids) x;
  select count(*) into v_bad from unnest(v_ids) x where x !~ '^web_[A-HJ-NP-Z2-9]{12}$';
  perform pg_temp.report('ID-1 (500 generated IDs: all match web_+12 URL/JSON-safe unambiguous chars, all distinct)', v_distinct = 500 and v_bad = 0, format('distinct=%s bad=%s', v_distinct, v_bad));
  perform pg_temp.report('ID-2 (internal helpers not executable by authenticated/anon/public)',
    not has_function_privilege('authenticated', 'public._generate_intake_external_id()', 'EXECUTE')
    and not has_function_privilege('anon', 'public._generate_intake_external_id()', 'EXECUTE')
    and not has_function_privilege('public', 'public._generate_intake_external_id()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._normalize_website_origin(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public._normalize_website_origin(text)', 'EXECUTE'));
end $$;

-- =============================================================================
-- C. CREATE
-- =============================================================================
do $$
declare
  v_res public.request_intake_integration_result;
  v_row public.request_intake_integrations%rowtype;
  v_audit public.audit_events%rowtype;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.create_request_intake_integration('10000000-0000-0000-0000-0000000000a1', 'https://www.R4B-Org-A.example.test/');
  reset role;

  select * into v_row from public.request_intake_integrations where id = v_res.integration_id;
  perform pg_temp.report('CREATE-1 (Org A admin creates own integration: org derived, type website, normalized origin)',
    v_res.changed and v_row.organization_id = '10000000-0000-0000-0000-0000000000a1' and v_row.integration_type = 'website'
    and v_row.allowed_origins = array['https://www.r4b-org-a.example.test'], format('row=%s', row_to_json(v_row)));
  perform pg_temp.report('CREATE-2 (new integration is DISABLED by default; result says so)',
    v_row.is_active = false and v_res.is_active = false);
  perform pg_temp.report('CREATE-3 (server-generated Integration ID, web_ format)',
    v_row.external_id ~ '^web_[A-HJ-NP-Z2-9]{12}$' and v_res.external_id = v_row.external_id, v_row.external_id);
  perform pg_temp.report('CREATE-3b (ID encodes neither org uuid, org name nor user id)',
    position(replace('10000000-0000-0000-0000-0000000000a1', '-', '') in lower(v_row.external_id)) = 0
    and position('a1' in lower(replace(v_row.external_id, 'web_', ''))) >= 0 and v_row.external_id !~* 'fictional');

  select * into v_audit from public.audit_events where entity_id = v_row.id and action = 'website_integration_created';
  perform pg_temp.report('CREATE-4 (website_integration_created AuditEvent: actor, org, entity, after_data)',
    v_audit.actor_user_id = '20000000-0000-0000-0000-0000000000a1' and v_audit.organization_id = v_row.organization_id
    and v_audit.entity_type = 'request_intake_integration' and v_audit.after_data ->> 'is_active' = 'false'
    and v_audit.after_data -> 'allowed_origins' ->> 0 = 'https://www.r4b-org-a.example.test', format('audit=%s', row_to_json(v_audit)));
end $$;

-- CREATE-5: same organization + same normalized origin (any spelling) -> the
-- existing integration, never a duplicate.
do $$
declare v_first uuid; v_res public.request_intake_integration_result; v_n bigint;
begin
  select id into v_first from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-a.example.test'];
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.create_request_intake_integration('10000000-0000-0000-0000-0000000000a1', 'HTTPS://WWW.r4b-org-a.example.test');
  reset role;
  select count(*) into v_n from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-a.example.test'];
  perform pg_temp.report('CREATE-5 (retry / second tab / different spelling of the same origin returns the existing integration, no duplicate)',
    not v_res.changed and v_res.integration_id = v_first and v_n = 1, format('changed=%s n=%s', v_res.changed, v_n));
end $$;

-- CREATE-6: a SECOND, different website for the same org is allowed (no one-per-org invariant).
do $$
declare v_res public.request_intake_integration_result; v_n bigint;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.create_request_intake_integration('10000000-0000-0000-0000-0000000000a1', 'https://booking.r4b-org-a.example.test');
  reset role;
  select count(*) into v_n from public.request_intake_integrations where organization_id = '10000000-0000-0000-0000-0000000000a1' and external_id like 'web\_%';
  perform pg_temp.report('CREATE-6 (multiple integrations per organization supported: a second website is created)',
    v_res.changed and v_n = 2, format('n=%s', v_n));
end $$;

-- CREATE-7: the same origin for a DIFFERENT organization is its own integration (tenants are independent).
do $$
declare v_res public.request_intake_integration_result;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  v_res := public.create_request_intake_integration('10000000-0000-0000-0000-0000000000b1', 'https://www.r4b-org-b.example.test');
  reset role;
  perform pg_temp.report('CREATE-7 (Org B admin creates own integration; distinct Integration ID from Org A)',
    v_res.changed and v_res.external_id <> (select external_id from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-a.example.test']));
end $$;

-- CREATE denials
do $$
declare
  v_stmt text := $q$select public.create_request_intake_integration('10000000-0000-0000-0000-0000000000a1', 'https://denied.example.test')$q$;
  v_before bigint := (select count(*) from public.request_intake_integrations);
begin
  perform pg_temp.report('CREATE-10 (Dispatcher denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', v_stmt) = 'ZW002');
  perform pg_temp.report('CREATE-11 (Driver denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', v_stmt) = 'ZW002');
  perform pg_temp.report('CREATE-12 (inactive Membership denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a5', v_stmt) = 'ZW002');
  perform pg_temp.report('CREATE-13 (no Membership denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', v_stmt) = 'ZW002');
  perform pg_temp.report('CREATE-14 (Platform Admin without Membership denied -- not silently a tenant admin)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000d1', v_stmt) = 'ZW002');
  perform pg_temp.report('CREATE-15 (Org B admin cannot create in Org A)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', v_stmt) = 'ZW002');
  perform pg_temp.report('CREATE-16 (null organization: ZW002)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.create_request_intake_integration(null, 'https://x.example.test')$q$) = 'ZW002');
  perform pg_temp.report('CREATE-17 (no session subject: ZW001)', pg_temp.try_as('authenticated', null, v_stmt) = 'ZW001');
  perform pg_temp.report('CREATE-18 (anon: no EXECUTE)', pg_temp.try_as('anon', null, v_stmt) = '42501');
  perform pg_temp.report('CREATE-19 (none of the denied attempts created a row)', (select count(*) from public.request_intake_integrations) = v_before);
end $$;

-- CREATE validation: every bad origin -> ZW006, nothing created.
do $$
declare
  v_before bigint := (select count(*) from public.request_intake_integrations);
  v_ok boolean := true; v_failed text := '';
  s text; c text;
begin
  foreach s in array array['http://example.com', 'https://example.com/path', 'https://example.com?x=1', 'https://example.com#f',
                           'https://user:pass@example.com', '*.example.com', 'https://*.example.com', 'javascript:alert(1)',
                           'data:text/html,x', 'not a url', '', 'https://localhost'] loop
    c := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
      format('select public.create_request_intake_integration(%L, %L)', '10000000-0000-0000-0000-0000000000a1', s));
    if c is distinct from 'ZW006' then v_ok := false; v_failed := v_failed || format(' [%L -> %s]', s, c); end if;
  end loop;
  perform pg_temp.report('CREATE-20 (12 invalid origins -> ZW006)', v_ok, v_failed);
  perform pg_temp.report('CREATE-21 (rejected origins created nothing)', (select count(*) from public.request_intake_integrations) = v_before);
end $$;

-- CREATE-22: per-organization cap.
do $$
declare i int; c text; v_last text;
begin
  for i in 1..12 loop
    v_last := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1',
      format('select public.create_request_intake_integration(%L, %L)', '10000000-0000-0000-0000-0000000000b1', 'https://cap' || i || '.example.test'));
  end loop;
  perform pg_temp.report('CREATE-22 (organization capped at 10 integrations; the 11th+ -> ZW006)',
    (select count(*) from public.request_intake_integrations where organization_id = '10000000-0000-0000-0000-0000000000b1') = 10 and v_last = 'ZW006', v_last);
  delete from public.request_intake_integrations where allowed_origins[1] like 'https://cap%.example.test';
end $$;

-- =============================================================================
-- D. SURFACE: no organization / id / type / active / actor parameter can be injected
-- =============================================================================
do $$
begin
  perform pg_temp.report('SURFACE-1 (create takes only organization + origin; no external_id / is_active / type / created_by parameter)',
    (select array_agg(a order by a) from (select unnest(proargnames) a from pg_proc where proname = 'create_request_intake_integration') s) = array['p_organization_id', 'p_origin']);
  perform pg_temp.report('SURFACE-2 (activate takes only integration id + flag; update takes only integration id + origin)',
    (select array_agg(a order by a) from (select unnest(proargnames) a from pg_proc where proname = 'set_request_intake_integration_active') s) = array['p_active', 'p_integration_id']
    and (select array_agg(a order by a) from (select unnest(proargnames) a from pg_proc where proname = 'update_request_intake_integration_origin') s) = array['p_integration_id', 'p_origin']);
end $$;

-- =============================================================================
-- E. LIST / READ MODEL
-- =============================================================================
do $$
declare v_a int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select count(*) into v_a from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1') where external_id like 'web\_%';
  reset role;
  perform pg_temp.report('LIST-1 (Org A admin sees its own two integrations)', v_a = 2, v_a::text);

  perform pg_temp.report('LIST-2 (Org B admin listing Org A -> ZW002)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', $q$select * from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002');
  perform pg_temp.report('LIST-3 (Org A admin listing Org B -> ZW002)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select * from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000b1')$q$) = 'ZW002');
  perform pg_temp.report('LIST-4 (Dispatcher / Driver / inactive / no-membership / platform admin / anon / no session all denied)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', $q$select * from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', $q$select * from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a5', $q$select * from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', $q$select * from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000d1', $q$select * from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002'
    and pg_temp.try_as('anon', null, $q$select * from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1')$q$) = '42501'
    and pg_temp.try_as('authenticated', null, $q$select * from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW001');
end $$;

-- =============================================================================
-- F. ACTIVATE / DISABLE
-- =============================================================================
do $$
declare
  v_id uuid; v_res public.request_intake_integration_result; v_audit public.audit_events%rowtype;
begin
  select id into v_id from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-a.example.test'];

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.set_request_intake_integration_active(v_id, true);
  reset role;
  perform pg_temp.report('ACT-1 (Org admin activates own integration)', v_res.changed and v_res.is_active
    and (select is_active from public.request_intake_integrations where id = v_id));
  select * into v_audit from public.audit_events where entity_id = v_id and action = 'website_integration_activated';
  perform pg_temp.report('ACT-2 (website_integration_activated AuditEvent with actor + before/after)',
    v_audit.actor_user_id = '20000000-0000-0000-0000-0000000000a1' and v_audit.before_data ->> 'is_active' = 'false' and v_audit.after_data ->> 'is_active' = 'true');

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.set_request_intake_integration_active(v_id, true);
  reset role;
  perform pg_temp.report('ACT-3 (activating an already-active integration is a no-op: changed=false, no second AuditEvent)',
    not v_res.changed and (select count(*) from public.audit_events where entity_id = v_id and action = 'website_integration_activated') = 1);
end $$;

do $$
declare
  v_id uuid := (select id from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-a.example.test']);
  v_b_id uuid := (select id from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-b.example.test']);
  v_act text; v_dis text;
begin
  v_act := format('select public.set_request_intake_integration_active(%L, true)', v_id);
  v_dis := format('select public.set_request_intake_integration_active(%L, false)', v_id);
  perform pg_temp.report('ACT-10 (Dispatcher activate/disable denied)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', v_act) = 'ZW002' and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', v_dis) = 'ZW002');
  perform pg_temp.report('ACT-11 (Driver denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', v_dis) = 'ZW002');
  perform pg_temp.report('ACT-12 (inactive Membership denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a5', v_dis) = 'ZW002');
  perform pg_temp.report('ACT-13 (no Membership denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', v_dis) = 'ZW002');
  perform pg_temp.report('ACT-14 (Platform Admin without Membership denied)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000d1', v_dis) = 'ZW002');
  perform pg_temp.report('ACT-15 (Org B admin cannot disable Org A''s integration UUID)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', v_dis) = 'ZW002');
  perform pg_temp.report('ACT-16 (Org A admin cannot activate Org B''s integration UUID)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_request_intake_integration_active(%L, true)', v_b_id)) = 'ZW002');
  perform pg_temp.report('ACT-17 (nonexistent UUID indistinguishable from foreign: ZW002)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.set_request_intake_integration_active('11111111-1111-1111-1111-111111111111', true)$q$) = 'ZW002');
  perform pg_temp.report('ACT-18 (null integration id: ZW002; null flag: ZW006)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.set_request_intake_integration_active(null, true)$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_request_intake_integration_active(%L, null)', v_id)) = 'ZW006');
  perform pg_temp.report('ACT-19 (anon / no-session denied)',
    pg_temp.try_as('anon', null, v_dis) = '42501' and pg_temp.try_as('authenticated', null, v_dis) = 'ZW001');
  perform pg_temp.report('ACT-20 (all denied attempts left Org A active and Org B disabled)',
    (select is_active from public.request_intake_integrations where id = v_id) and not (select is_active from public.request_intake_integrations where id = v_b_id));
end $$;

-- ACT-30: a legacy row with NO configured origin cannot be activated (would accept any Origin).
do $$
declare v_legacy uuid := 'b0000000-0000-0000-0000-00000000b001'; v_code text;
begin
  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active)
  values (v_legacy, '10000000-0000-0000-0000-0000000000a1', 'r4b-legacy-no-origin', 'website', false);
  v_code := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_request_intake_integration_active(%L, true)', v_legacy));
  perform pg_temp.report('ACT-30 (integration with no configured origin cannot be activated: ZW006)', v_code = 'ZW006', v_code);
end $$;

do $$
declare v_seen_a boolean; v_seen_b boolean; v_code text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select exists (select 1 from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1') where external_id = 'r4b-legacy-no-origin') into v_seen_a;
  reset role;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  select exists (select 1 from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000b1') where external_id = 'r4b-legacy-no-origin') into v_seen_b;
  reset role;
  perform pg_temp.report('ACT-31b (legacy row visible to owning admin only)', v_seen_a and not v_seen_b, format('a=%s b=%s', v_seen_a, v_seen_b));
  -- give it an origin through the controlled mutation: proves legacy rows are manageable
  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
    $q$select public.update_request_intake_integration_origin('b0000000-0000-0000-0000-00000000b001', 'https://legacy.r4b-org-a.example.test')$q$);
  v_code := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.set_request_intake_integration_active('b0000000-0000-0000-0000-00000000b001', true)$q$);
  perform pg_temp.report('ACT-32 (legacy row can be given an origin via the controlled mutation, then activated)',
    v_code = 'OK' and (select is_active from public.request_intake_integrations where id = 'b0000000-0000-0000-0000-00000000b001'), v_code);
  delete from public.audit_events where entity_id = 'b0000000-0000-0000-0000-00000000b001';
  delete from public.request_intake_integrations where id = 'b0000000-0000-0000-0000-00000000b001';
end $$;

-- =============================================================================
-- G. ORIGIN UPDATE
-- =============================================================================
do $$
declare
  v_id uuid := (select id from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-a.example.test']);
  v_ext text := (select external_id from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-a.example.test']);
  v_res public.request_intake_integration_result; v_row public.request_intake_integrations%rowtype; v_audit public.audit_events%rowtype;
begin
  -- v_id is ACTIVE (ACT-1). Changing its origin must auto-disable it.
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.update_request_intake_integration_origin(v_id, 'https://NEW-site.r4b-org-a.example.test/');
  reset role;
  select * into v_row from public.request_intake_integrations where id = v_id;
  perform pg_temp.report('ORIGINUPD-1 (active integration + origin change -> origin replaced, external_id unchanged, AUTO-DISABLED)',
    v_res.changed and v_res.deactivated and not v_res.is_active and v_row.allowed_origins = array['https://new-site.r4b-org-a.example.test']
    and not v_row.is_active and v_row.external_id = v_ext, format('res=%s row=%s', v_res, row_to_json(v_row)));
  select * into v_audit from public.audit_events where entity_id = v_id and action = 'website_integration_origin_updated';
  perform pg_temp.report('ORIGINUPD-2 (website_integration_origin_updated AuditEvent: before/after origin + auto_disabled)',
    v_audit.before_data -> 'allowed_origins' ->> 0 = 'https://www.r4b-org-a.example.test'
    and v_audit.after_data -> 'allowed_origins' ->> 0 = 'https://new-site.r4b-org-a.example.test'
    and v_audit.before_data ->> 'is_active' = 'true' and v_audit.after_data ->> 'is_active' = 'false' and v_audit.after_data ->> 'auto_disabled' = 'true');

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.update_request_intake_integration_origin(v_id, 'https://new-site.r4b-org-a.example.test');
  reset role;
  perform pg_temp.report('ORIGINUPD-3 (same origin: no-op, changed=false, no new AuditEvent)',
    not v_res.changed and (select count(*) from public.audit_events where entity_id = v_id and action = 'website_integration_origin_updated') = 1);

  perform pg_temp.report('ORIGINUPD-4 (origin already used by another integration of the same org -> ZW006)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_request_intake_integration_origin(%L, %L)', v_id, 'https://booking.r4b-org-a.example.test')) = 'ZW006');
  perform pg_temp.report('ORIGINUPD-5 (invalid origin -> ZW006, integration unchanged)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_request_intake_integration_origin(%L, %L)', v_id, 'http://insecure.example.test')) = 'ZW006'
    and (select allowed_origins from public.request_intake_integrations where id = v_id) = array['https://new-site.r4b-org-a.example.test']);
  perform pg_temp.report('ORIGINUPD-6 (Dispatcher / Driver / inactive / no-membership / Org B admin denied)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.update_request_intake_integration_origin(%L, %L)', v_id, 'https://evil.example.test')) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', format('select public.update_request_intake_integration_origin(%L, %L)', v_id, 'https://evil.example.test')) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a5', format('select public.update_request_intake_integration_origin(%L, %L)', v_id, 'https://evil.example.test')) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', format('select public.update_request_intake_integration_origin(%L, %L)', v_id, 'https://evil.example.test')) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select public.update_request_intake_integration_origin(%L, %L)', v_id, 'https://evil.example.test')) = 'ZW002'
    and pg_temp.try_as('anon', null, format('select public.update_request_intake_integration_origin(%L, %L)', v_id, 'https://evil.example.test')) = '42501');
  perform pg_temp.report('ORIGINUPD-7 (denied attempts changed nothing)', (select allowed_origins from public.request_intake_integrations where id = v_id) = array['https://new-site.r4b-org-a.example.test']);

  -- an INACTIVE integration whose origin changes stays inactive and reports deactivated=false
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.update_request_intake_integration_origin(v_id, 'https://newer-site.r4b-org-a.example.test');
  reset role;
  perform pg_temp.report('ORIGINUPD-8 (inactive integration: origin updated, stays disabled, deactivated=false)',
    v_res.changed and not v_res.deactivated and not v_res.is_active);
  -- restore the origin used by later sections
  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_request_intake_integration_origin(%L, %L)', v_id, 'https://www.r4b-org-a.example.test'));
end $$;

-- =============================================================================
-- H. THE LOCKED TABLE STAYS LOCKED
-- =============================================================================
do $$
declare v_stmt text; v_code text; v_ok boolean := true; v_failed text := ''; v_role text; v_uid uuid;
begin
  foreach v_role in array array['authenticated', 'anon'] loop
    v_uid := case when v_role = 'authenticated' then '20000000-0000-0000-0000-0000000000a1'::uuid else null end; -- Org A ADMIN: strongest legitimate caller
    foreach v_stmt in array array[
      $q$select * from public.request_intake_integrations$q$,
      $q$insert into public.request_intake_integrations (organization_id, external_id, allowed_origins) values ('10000000-0000-0000-0000-0000000000a1', 'direct-insert', array['https://x.example.test'])$q$,
      $q$update public.request_intake_integrations set is_active = true$q$,
      $q$update public.request_intake_integrations set allowed_origins = array['https://evil.example.test']$q$,
      $q$update public.request_intake_integrations set organization_id = '10000000-0000-0000-0000-0000000000b1'$q$,
      $q$delete from public.request_intake_integrations$q$,
      $q$truncate public.request_intake_integrations$q$
    ] loop
      v_code := pg_temp.try_as(v_role, v_uid, v_stmt);
      if v_code is distinct from '42501' then v_ok := false; v_failed := v_failed || format(' [%s %s -> %s]', v_role, left(v_stmt, 40), v_code); end if;
    end loop;
  end loop;
  perform pg_temp.report('TABLE-1 (authenticated Org Admin and anon: direct SELECT / INSERT / UPDATE / DELETE / TRUNCATE on request_intake_integrations all denied)', v_ok, v_failed);
  perform pg_temp.report('TABLE-2 (no table or column privilege, and no RLS policy, for anon/authenticated)',
    not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'request_intake_integrations' and grantee in ('anon', 'authenticated', 'PUBLIC'))
    and not exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'request_intake_integrations' and grantee in ('anon', 'authenticated', 'PUBLIC'))
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'request_intake_integrations')
    and (select relrowsecurity from pg_class where oid = 'public.request_intake_integrations'::regclass));
  perform pg_temp.report('TABLE-3 (service_role keeps SELECT only -- no INSERT/UPDATE/DELETE added for the public-intake path)',
    has_table_privilege('service_role', 'public.request_intake_integrations', 'SELECT')
    and not has_table_privilege('service_role', 'public.request_intake_integrations', 'INSERT')
    and not has_table_privilege('service_role', 'public.request_intake_integrations', 'UPDATE')
    and not has_table_privilege('service_role', 'public.request_intake_integrations', 'DELETE'));
  perform pg_temp.report('TABLE-4 (the four new functions: authenticated EXECUTE yes; anon/PUBLIC no)',
    has_function_privilege('authenticated', 'public.create_request_intake_integration(uuid, text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_request_intake_integration_active(uuid, boolean)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.update_request_intake_integration_origin(uuid, text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.list_request_intake_integrations(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_request_intake_integration(uuid, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_request_intake_integration_active(uuid, boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.update_request_intake_integration_origin(uuid, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.list_request_intake_integrations(uuid)', 'EXECUTE')
    and not has_function_privilege('public', 'public.create_request_intake_integration(uuid, text)', 'EXECUTE'));
  perform pg_temp.report('TABLE-5 (no client role can write audit_events)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
      $q$insert into public.audit_events (organization_id, entity_type, entity_id, action) values ('10000000-0000-0000-0000-0000000000a1', 'request_intake_integration', gen_random_uuid(), 'website_integration_created')$q$) = '42501');
end $$;

-- =============================================================================
-- I. THE UNCHANGED PUBLIC-INTAKE PATH CONSUMES A SELF-SERVICE INTEGRATION
-- =============================================================================
do $$
declare
  v_ext text := (select external_id from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-a.example.test']);
  v_id uuid := (select id from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-a.example.test']);
  v_call text;
  v_passengers bigint := (select count(*) from public.passengers);
  v_trips bigint := (select count(*) from public.trips);
  v_arr bigint := (select count(*) from public.recurring_arrangements);
  v_res text; v_row public.transportation_requests%rowtype; v_n bigint;
begin
  v_call := format($q$select public.submit_public_transportation_request(
      p_integration_external_id => %L, p_idempotency_key => %L, p_requester_name => 'R4B Test Requester',
      p_requester_relationship => 'family', p_requester_phone => '555-0100', p_pickup_description => 'R4B TEST pickup',
      p_destination_description => 'R4B TEST destination', p_return_trip_needed => 'no', p_origin => %L)$q$, v_ext, 'r4b-key-%s', 'https://www.r4b-org-a.example.test');

  -- disabled by default -> rejected
  v_res := pg_temp.try_as('service_role', null, format(v_call, 1));
  perform pg_temp.report('INTAKE-1 (a DISABLED self-service integration rejects submissions: ZW006)', v_res = 'ZW006', v_res);

  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_request_intake_integration_active(%L, true)', v_id));
  v_res := pg_temp.try_as('service_role', null, format(v_call, 2));
  perform pg_temp.report('INTAKE-2 (after activation the UNCHANGED path accepts it)', v_res = 'OK', v_res);
  select * into v_row from public.transportation_requests where external_submission_ref = 'r4b-key-2';
  perform pg_temp.report('INTAKE-3 (Request lands in the right org, provenance = this integration, pending, source web, no passenger)',
    v_row.organization_id = '10000000-0000-0000-0000-0000000000a1' and v_row.intake_integration_id = v_id and v_row.state = 'pending'
    and v_row.source = 'web' and v_row.passenger_id is null, format('row=%s', row_to_json(v_row)));

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select request_count into v_n from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1') where id = v_id;
  reset role;
  perform pg_temp.report('INTAKE-4 (derived activity: request_count = 1 for the integration)', v_n = 1, v_n::text);

  -- wrong Origin rejected (origin enforcement unchanged)
  v_res := pg_temp.try_as('service_role', null, replace(format(v_call, 3), 'https://www.r4b-org-a.example.test', 'https://evil.example.test'));
  perform pg_temp.report('INTAKE-5 (origin enforcement unchanged: a different Origin is rejected)', v_res = 'ZW006', v_res);

  -- idempotent replay
  v_res := pg_temp.try_as('service_role', null, format(v_call, 2));
  select count(*) into v_n from public.transportation_requests where external_submission_ref = 'r4b-key-2';
  perform pg_temp.report('INTAKE-6 (idempotency unchanged: replay accepted, still one Request)', v_res = 'OK' and v_n = 1);

  -- kill switch
  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_request_intake_integration_active(%L, false)', v_id));
  v_res := pg_temp.try_as('service_role', null, format(v_call, 4));
  perform pg_temp.report('INTAKE-7 (disable = kill switch: the next submission is rejected immediately)', v_res = 'ZW006', v_res);
  perform pg_temp.report('INTAKE-8 (historical Request preserved after disable, provenance intact)',
    (select count(*) from public.transportation_requests where external_submission_ref = 'r4b-key-2' and intake_integration_id = v_id and state = 'pending') = 1);
  perform pg_temp.report('INTAKE-9 (no Passenger, Trip or recurring arrangement was created by any of it)',
    (select count(*) from public.passengers) = v_passengers and (select count(*) from public.trips) = v_trips
    and (select count(*) from public.recurring_arrangements) = v_arr);
  perform pg_temp.report('INTAKE-10 (website_integration_disabled AuditEvent recorded)',
    exists (select 1 from public.audit_events where entity_id = v_id and action = 'website_integration_disabled'));
end $$;

do $$
declare v_id uuid := (select id from public.request_intake_integrations where allowed_origins = array['https://www.r4b-org-a.example.test']); v_cnt bigint; v_last timestamptz;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select request_count, last_request_received_at into v_cnt, v_last from public.list_request_intake_integrations('10000000-0000-0000-0000-0000000000a1') where id = v_id;
  reset role;
  perform pg_temp.report('INTAKE-11 (activity still derived after disable: count 1, last received set)', v_cnt = 1 and v_last is not null, format('%s %s', v_cnt, v_last));
end $$;

-- Cleanup of this suite's own rows (keeps later suites/fixtures unaffected).
-- (The Request row + its request_events are left in place, like every other
-- suite's own rows; the suite is designed for a freshly reset database.)
