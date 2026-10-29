-- Nemryn Plus -- access helper tests (NP-P1-S2). ROLLBACK-ONLY (one transaction, rolled back at the end).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_access_helpers_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261013120000_plus_access_helpers.sql: plus_can_read / plus_can_write / _require_plus_write /
-- _require_plus_admin_write across every effective state, role, tenant and membership / organization status.
-- Seed fixtures: Org A admin a1, dispatcher a2, driver a3, inactive dispatcher a5; c1 = admin in A + driver in B;
-- Org B admin b1; d1 = platform admin (no membership); e1 = no membership.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table h_results (n serial, name text, ok boolean, detail text);

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

-- Owner-level call of an internal guard with a given auth.uid() (guards have no client EXECUTE by design).
create function pg_temp.guard(p_fn text, p_uid uuid, p_org uuid)
returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute format('select public.%I(%L)', p_fn, p_org); exception when others then return sqlstate; end;
  return 'OK';
end;
$$;

create function pg_temp.t(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into h_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;

-- "<read>/<write>" for a caller.
create function pg_temp.rw(p_uid uuid, p_org uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format('select public.plus_can_read(%L)::text', p_org)), 'NULL')
      || '/' || coalesce(pg_temp.val_as('authenticated', p_uid, format('select public.plus_can_write(%L)::text', p_org)), 'NULL');
$$;

-- Owner-level entitlement fixture (the platform RPCs are covered by plus_entitlement_tests.sql).
create function pg_temp.set_state(p_org uuid, p_state text)
returns void language plpgsql as $$
begin
  delete from public.organization_modules where organization_id = p_org;
  if p_state = 'none' then return; end if;
  insert into public.organization_modules (organization_id, module, status, restriction, trial_started_at, trial_ends_at, access_ends_at, status_reason)
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, s.ae, 'S2 helper test'
  from (values
    ('trial',         'trial',     null,        now() - interval '1 day',  now() + interval '13 days', null::timestamptz),
    ('active',        'active',    null,        null,                     null,                      null),
    ('active_ending', 'active',    null,        null,                     null,                      now() + interval '5 days'),
    ('trial_elapsed', 'trial',     null,        now() - interval '15 days', now() - interval '1 second', null),
    ('active_elapsed','active',    null,        null,                     null,                      now() - interval '1 second'),
    ('expired',       'expired',   null,        now() - interval '20 days', now() - interval '6 days', null),
    ('cancelled',     'cancelled', null,        null,                     null,                      null),
    ('disabled_ro',   'disabled',  'read_only', null,                     null,                      null),
    ('locked',        'disabled',  'no_access', null,                     null,                      null)
  ) as s(name, status, restriction, ts, te, ae)
  where s.name = p_state;
  if not found then raise exception 'unknown fixture state %', p_state; end if;
end;
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
  v_state text;
  v_expect text;
  v_uid uuid;
  v_name text;
begin
  -- ------------------------------------------------------------------ privileges
  perform pg_temp.t('P1 plus_can_read / plus_can_write: authenticated EXECUTE, no anon / PUBLIC',
    has_function_privilege('authenticated', 'public.plus_can_read(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.plus_can_write(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.plus_can_read(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.plus_can_write(uuid)', 'execute'));
  perform pg_temp.t('P2 guards: no EXECUTE for anon / authenticated / service_role',
    not has_function_privilege('anon', 'public._require_plus_write(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public._require_plus_write(uuid)', 'execute')
    and not has_function_privilege('service_role', 'public._require_plus_write(uuid)', 'execute')
    and not has_function_privilege('anon', 'public._require_plus_admin_write(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public._require_plus_admin_write(uuid)', 'execute')
    and not has_function_privilege('service_role', 'public._require_plus_admin_write(uuid)', 'execute'));
  perform pg_temp.t('P3 authenticated calling a guard directly -> 42501',
    pg_temp.val_as('authenticated', c_a1, format('select public._require_plus_write(%L)::text', c_a)) = 'ERR:42501');
  perform pg_temp.t('P4 anon calling plus_can_read -> 42501',
    pg_temp.val_as('anon', null, format('select public.plus_can_read(%L)::text', c_a)) = 'ERR:42501');
  perform pg_temp.t('P5 all four helpers are SECURITY DEFINER with a pinned search_path',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('plus_can_read', 'plus_can_write', '_require_plus_write', '_require_plus_admin_write')
       and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 4);
  perform pg_temp.t('P6 no Core function references the Plus helpers or organization_modules',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      -- Plus functions themselves (plus_*, _plus_*, _require_plus_*; NP-P1-S3 adds _plus_member_access and the
      -- plus_*_member_access RPCs) and the platform entitlement RPCs are allowed; every other function is Core.
      and p.proname !~ '^(plus_|_plus_|_require_plus_)'
      and p.proname not in ('platform_set_organization_module', 'platform_extend_plus_trial', 'platform_get_organization_module')
      -- NP-FIN-P1 FU-2 (narrow): billing_create_invoice_draft (NP-BILL-P1 R3 / ZD-274) may call plus_can_read ONLY,
      -- to gate the optional read-only quote import; any other Plus reference in it still fails this check.
      and not (p.proname = 'billing_create_invoice_draft'
               and regexp_replace(p.prosrc, 'plus_can_read', '', 'g') !~ 'plus_can_(read|write)|_require_plus_|organization_modules|_plus_entitlement_state')
      and (p.prosrc ~ 'plus_can_(read|write)|_require_plus_|organization_modules|_plus_entitlement_state')));

  -- ------------------------------------------------------------------ Org A Admin across every effective state
  foreach v_state in array array['none', 'trial', 'active', 'active_ending', 'trial_elapsed', 'active_elapsed',
                                 'expired', 'cancelled', 'disabled_ro', 'locked'] loop
    perform pg_temp.set_state(c_a, v_state);
    v_expect := case
      when v_state in ('trial', 'active', 'active_ending') then 'true/true'
      when v_state in ('trial_elapsed', 'active_elapsed', 'expired', 'cancelled', 'disabled_ro') then 'true/false'
      else 'false/false' end;
    perform pg_temp.t('S Org A admin, Plus ' || v_state || ' -> read/write ' || v_expect, pg_temp.rw(c_a1, c_a) = v_expect, pg_temp.rw(c_a1, c_a));
    perform pg_temp.t('S guard _require_plus_write, Plus ' || v_state,
      pg_temp.guard('_require_plus_write', c_a1, c_a) = case v_expect when 'true/true' then 'OK' when 'true/false' then 'ZW001' else 'ZW002' end,
      pg_temp.guard('_require_plus_write', c_a1, c_a));
    perform pg_temp.t('S guard _require_plus_admin_write, Plus ' || v_state,
      pg_temp.guard('_require_plus_admin_write', c_a1, c_a) = case v_expect when 'true/true' then 'OK' when 'true/false' then 'ZW001' else 'ZW002' end,
      pg_temp.guard('_require_plus_admin_write', c_a1, c_a));
    -- nobody else ever reads or writes Org A's Plus data, in any state
    foreach v_uid in array array[c_a2, c_a3, c_a5, c_b1, c_d1, c_e1] loop
      v_name := case v_uid when c_a2 then 'dispatcher' when c_a3 then 'driver' when c_a5 then 'inactive dispatcher'
                 when c_b1 then 'Org B admin' when c_d1 then 'platform admin w/o membership' else 'no-membership user' end;
      perform pg_temp.t('R ' || v_name || ', Org A Plus ' || v_state || ' -> false/false', pg_temp.rw(v_uid, c_a) = 'false/false', pg_temp.rw(v_uid, c_a));
      perform pg_temp.t('R ' || v_name || ', guard -> ZW002, Org A Plus ' || v_state, pg_temp.guard('_require_plus_write', v_uid, c_a) = 'ZW002',
        pg_temp.guard('_require_plus_write', v_uid, c_a));
    end loop;
  end loop;

  -- ------------------------------------------------------------------ cross-tenant / multi-org
  perform pg_temp.set_state(c_a, 'none');
  perform pg_temp.set_state(c_b, 'active');
  perform pg_temp.t('X Org B entitled, Org A not: Org B admin on B true/true', pg_temp.rw(c_b1, c_b) = 'true/true');
  perform pg_temp.t('X Org A admin on Org B false/false', pg_temp.rw(c_a1, c_b) = 'false/false');
  perform pg_temp.t('X Org A admin on Org A (no Plus) false/false', pg_temp.rw(c_a1, c_a) = 'false/false');
  perform pg_temp.t('X Org A admin guard on Org B -> ZW002', pg_temp.guard('_require_plus_write', c_a1, c_b) = 'ZW002');
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.t('X multi-org c1 (admin in A, driver in B): true/true in A, false/false in B',
    pg_temp.rw(c_c1, c_a) = 'true/true' and pg_temp.rw(c_c1, c_b) = 'false/false', pg_temp.rw(c_c1, c_a) || ' ' || pg_temp.rw(c_c1, c_b));

  -- ------------------------------------------------------------------ membership / organization status
  update public.memberships set status = 'inactive' where organization_id = c_a and user_id = c_c1;
  perform pg_temp.t('M inactive Org A admin (c1) -> false/false and guard ZW002',
    pg_temp.rw(c_c1, c_a) = 'false/false' and pg_temp.guard('_require_plus_write', c_c1, c_a) = 'ZW002');
  update public.memberships set status = 'active' where organization_id = c_a and user_id = c_c1;
  update public.organizations set status = 'inactive' where id = c_a;
  perform pg_temp.t('M suspended Org A with Plus active -> admin false/false and guard ZW002',
    pg_temp.rw(c_a1, c_a) = 'false/false' and pg_temp.guard('_require_plus_write', c_a1, c_a) = 'ZW002');
  update public.organizations set status = 'active' where id = c_a;
  perform pg_temp.t('M reactivated Org A -> admin true/true again', pg_temp.rw(c_a1, c_a) = 'true/true');

  -- ------------------------------------------------------------------ edge inputs
  perform pg_temp.t('E null organization -> false/false', pg_temp.rw(c_a1, null) = 'false/false', pg_temp.rw(c_a1, null));
  perform pg_temp.t('E unknown organization -> false/false', pg_temp.rw(c_a1, '10000000-0000-0000-0000-00000000dead') = 'false/false');
  perform pg_temp.t('E guard without uid -> ZW001', pg_temp.guard('_require_plus_write', null, c_a) = 'ZW001');
  perform pg_temp.t('E admin guard without uid -> ZW001', pg_temp.guard('_require_plus_admin_write', null, c_a) = 'ZW001');
  perform pg_temp.t('E authenticated without uid -> false/false', pg_temp.rw(null, c_a) = 'false/false');
  perform pg_temp.t('E helpers never write: organizations.status untouched, one Org A row',
    (select status from public.organizations where id = c_a) = 'active'
    and (select count(*) from public.organization_modules where organization_id = c_a) = 1);
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from h_results;
select name, detail from h_results where not ok order by n;

rollback;
