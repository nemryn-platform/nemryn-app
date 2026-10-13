-- Nemryn Plus -- versioned (optimistic-concurrency) entitlement mutation tests (NP-P1-S2-R1). ROLLBACK-ONLY.
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_entitlement_versioned_tests.sql
-- Covers 20261013140000_plus_entitlement_optimistic_concurrency.sql. Inside one transaction now() is constant, so a
-- "stale" version is simulated as a timestamp different from the row's real updated_at.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table v_results (n serial, name text, ok boolean, detail text);

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
  insert into v_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;

-- Versioned set as a given caller; returns 'changed=<bool>' or 'ERR:<sqlstate>'.
create function pg_temp.vset(p_uid uuid, p_org uuid, p_status text, p_days integer, p_restr text, p_expected timestamptz)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid,
    format('select ''changed='' || (public.platform_set_organization_module(%L, ''plus'', %L, %s, null, %s, ''versioned test'', %s)).changed',
      p_org, p_status, coalesce(p_days::text, 'null'), coalesce(quote_literal(p_restr), 'null'), coalesce(quote_literal(p_expected) || '::timestamptz', 'null::timestamptz'))), 'NULL');
$$;

create function pg_temp.vext(p_uid uuid, p_org uuid, p_days integer, p_expected timestamptz)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid,
    format('select ''changed='' || (public.platform_extend_plus_trial(%L, %s, ''versioned extend'', %s)).changed',
      p_org, p_days, coalesce(quote_literal(p_expected) || '::timestamptz', 'null::timestamptz'))), 'NULL');
$$;

create function pg_temp.audits(p_org uuid) returns bigint language sql as $$
  select count(*) from public.audit_events where organization_id = p_org and action = 'platform_plus_access_changed';
$$;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  c_d1 constant uuid := '20000000-0000-0000-0000-0000000000d1';
  v text;
  v_ver timestamptz;
  v_row text;
begin
  -- ---------------------------------------------------------------- privileges / authority
  perform pg_temp.t('V1 versioned RPCs: authenticated EXECUTE only (no anon / PUBLIC)',
    has_function_privilege('authenticated', 'public.platform_set_organization_module(uuid,text,text,integer,timestamptz,text,text,timestamptz)', 'execute')
    and has_function_privilege('authenticated', 'public.platform_extend_plus_trial(uuid,integer,text,timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.platform_set_organization_module(uuid,text,text,integer,timestamptz,text,text,timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.platform_extend_plus_trial(uuid,integer,text,timestamptz)', 'execute'));
  perform pg_temp.t('V2 Org Admin / Dispatcher cannot call the versioned set (ZW002)',
    pg_temp.vset(c_a1, c_a, 'trial', null, null, null) = 'ERR:ZW002' and pg_temp.vset(c_a2, c_a, 'trial', null, null, null) = 'ERR:ZW002');
  perform pg_temp.t('V3 no uid -> ZW001', pg_temp.vset(null, c_a, 'trial', null, null, null) = 'ERR:ZW001');
  perform pg_temp.t('V4 unknown organization -> ZW002', pg_temp.vset(c_d1, '10000000-0000-0000-0000-00000000dead', 'trial', null, null, null) = 'ERR:ZW002');

  -- ---------------------------------------------------------------- no row yet
  perform pg_temp.t('V5 no row but a version expected -> ZW003, nothing written',
    pg_temp.vset(c_d1, c_a, 'trial', null, null, now()) = 'ERR:ZW003' and not exists (select 1 from public.organization_modules where organization_id = c_a) and pg_temp.audits(c_a) = 0);
  v := pg_temp.vset(c_d1, c_a, 'trial', null, null, null);
  perform pg_temp.t('V6 no row + expected NULL -> trial starts (S1 rules), one audit', v = 'changed=true' and pg_temp.audits(c_a) = 1, v);
  select updated_at into v_ver from public.organization_modules where organization_id = c_a;

  -- ---------------------------------------------------------------- row exists
  perform pg_temp.t('V7 row exists but expected NULL -> ZW003, unchanged, no audit',
    pg_temp.vset(c_d1, c_a, 'active', null, null, null) = 'ERR:ZW003'
    and (select status from public.organization_modules where organization_id = c_a) = 'trial' and pg_temp.audits(c_a) = 1);
  perform pg_temp.t('V8 stale version -> ZW003, unchanged, no audit',
    pg_temp.vset(c_d1, c_a, 'active', null, null, v_ver - interval '1 second') = 'ERR:ZW003'
    and (select status from public.organization_modules where organization_id = c_a) = 'trial' and pg_temp.audits(c_a) = 1);
  perform pg_temp.t('V9 matching version but S1 rule (no trial restart) still applies -> ZW004',
    pg_temp.vset(c_d1, c_a, 'trial', 14, null, v_ver) = 'ERR:ZW004' and pg_temp.audits(c_a) = 1);
  perform pg_temp.t('V10 extend with a stale version -> ZW003, no extension',
    pg_temp.vext(c_d1, c_a, 5, v_ver - interval '1 second') = 'ERR:ZW003'
    and (select trial_extension_count from public.organization_modules where organization_id = c_a) = 0);
  v := pg_temp.vext(c_d1, c_a, 5, v_ver);
  perform pg_temp.t('V11 extend with the current version -> extended once, audited', v = 'changed=true'
    and (select trial_extension_count from public.organization_modules where organization_id = c_a) = 1 and pg_temp.audits(c_a) = 2, v);
  select updated_at into v_ver from public.organization_modules where organization_id = c_a;
  v := pg_temp.vset(c_d1, c_a, 'active', null, null, v_ver);
  perform pg_temp.t('V12 matching version -> change applied, audited', v = 'changed=true'
    and (select status from public.organization_modules where organization_id = c_a) = 'active' and pg_temp.audits(c_a) = 3, v);
  select updated_at into v_ver from public.organization_modules where organization_id = c_a;
  v := pg_temp.vset(c_d1, c_a, 'active', null, null, v_ver);
  perform pg_temp.t('V13 identical change with the current version -> idempotent no-op, no audit', v = 'changed=false' and pg_temp.audits(c_a) = 3, v);
  v := pg_temp.vset(c_d1, c_a, 'disabled', null, 'no_access', v_ver);
  perform pg_temp.t('V14 disable (no access) with the current version -> applied', v = 'changed=true'
    and (select restriction from public.organization_modules where organization_id = c_a) = 'no_access', v);

  -- ---------------------------------------------------------------- isolation / compatibility
  perform pg_temp.t('V15 versioned changes never touch Org B or organizations.status',
    not exists (select 1 from public.organization_modules where organization_id = c_b)
    and (select status from public.organizations where id = c_a) = 'active' and pg_temp.audits(c_b) = 0);
  v := pg_temp.val_as('authenticated', c_d1, format($q$select 'changed=' || (public.platform_set_organization_module(%L, 'plus', 'active', null, null, null, 'unversioned compat')).changed$q$, c_b));
  perform pg_temp.t('V16 unversioned S1 signature still works (EXPAND: deployed app compatibility)', v = 'changed=true', v);
  perform pg_temp.t('V17 versioned overloads are SECURITY DEFINER with pinned search_path',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.oid in ('public.platform_set_organization_module(uuid,text,text,integer,timestamptz,text,text,timestamptz)'::regprocedure,
                     'public.platform_extend_plus_trial(uuid,integer,text,timestamptz)'::regprocedure)
       and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 2);
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from v_results;
select name, detail from v_results where not ok order by n;

rollback;
