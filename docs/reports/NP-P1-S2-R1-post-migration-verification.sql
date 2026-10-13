-- NP-P1-S2-R1 -- POST-MIGRATION VERIFICATION (READ-ONLY). Production project wyocbivzgrbekuyqdfts.
-- Run AFTER `supabase db push --linked` has applied 20261013120000 and 20261013140000, BEFORE the S2 app is promoted.
-- Every statement is a SELECT: nothing is written, granted, revoked or locked. Expected results are given per query.
-- Then run supabase/tests/privilege_contract_tests.sql (also a single read-only SELECT): expected 0 of 29 violations.

-- Q1. Migration head. Expected: the last three rows are 20261013100000, 20261013120000, 20261013140000.
select version, name from supabase_migrations.schema_migrations order by version desc limit 3;

-- Q2. The six NP-P1-S2 / R1 functions: present, SECURITY DEFINER, pinned search_path.
-- Expected 6 rows, each security_definer = t and search_path_pinned = t.
select p.oid::regprocedure as signature,
       p.prosecdef as security_definer,
       exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') as search_path_pinned
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid::regprocedure::text in (
    'plus_can_read(uuid)',
    'plus_can_write(uuid)',
    '_require_plus_write(uuid)',
    '_require_plus_admin_write(uuid)',
    'platform_set_organization_module(uuid,text,text,integer,timestamp with time zone,text,text,timestamp with time zone)',
    'platform_extend_plus_trial(uuid,integer,text,timestamp with time zone)')
order by 1;

-- Q3. EXECUTE grants. Expected:
--   plus_can_read / plus_can_write / both versioned RPCs: authenticated = t, anon = f, public = f
--   _require_plus_write / _require_plus_admin_write:       authenticated = f, anon = f, public = f
select s.sig,
       has_function_privilege('authenticated', s.sig, 'execute') as authenticated,
       has_function_privilege('anon', s.sig, 'execute') as anon,
       exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = s.sig::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as public
from (values
  ('public.plus_can_read(uuid)'),
  ('public.plus_can_write(uuid)'),
  ('public._require_plus_write(uuid)'),
  ('public._require_plus_admin_write(uuid)'),
  ('public.platform_set_organization_module(uuid,text,text,integer,timestamptz,text,text,timestamptz)'),
  ('public.platform_extend_plus_trial(uuid,integer,text,timestamptz)')) s(sig)
order by 1;

-- Q4. EXPAND compatibility: the S1 (unversioned) signatures still exist for the currently deployed app (cea620a).
-- Expected 2 rows, authenticated = t.
select s.sig, has_function_privilege('authenticated', s.sig, 'execute') as authenticated
from (values
  ('public.platform_set_organization_module(uuid,text,text,integer,timestamptz,text,text)'),
  ('public.platform_extend_plus_trial(uuid,integer,text)')) s(sig);

-- Q5. Data untouched (the migrations create functions only). Compare with the same query run BEFORE the push:
-- Zenward Mobility keeps its internal trial history; Nemryn Pilot Simulation keeps its state; no new rows.
select o.name, m.module, m.status, m.restriction, m.trial_started_at, m.trial_ends_at, m.trial_extension_count, m.updated_at
from public.organization_modules m join public.organizations o on o.id = m.organization_id
order by o.name, m.module;

-- Q6. Plus audit trail untouched by the migrations. Expected: identical to the pre-push count.
select organization_id, count(*) as plus_audit_events, max(occurred_at) as latest
from public.audit_events where action = 'platform_plus_access_changed' group by 1 order by 1;
