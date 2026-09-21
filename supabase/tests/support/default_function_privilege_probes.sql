-- P1-SEC-01R -- transactional probes of PostgreSQL's default FUNCTION privileges.
-- Every block is BEGIN ... ROLLBACK: nothing persists. Run against the local stack:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/support/default_function_privilege_probes.sql
-- The output is the evidence behind the strategy chosen in
-- supabase/migrations/20260921110000_production_privilege_baseline_hardening.sql.
-- (Section 5 needs the postgres role to be allowed to create event triggers, which the Supabase image permits.)
\pset pager off
\set ON_ERROR_STOP off

\echo
\echo === 1. WHY a new function is executable by PUBLIC: the BUILT-IN default ACL (pristine defaults) ===
begin;
alter default privileges for role postgres grant execute on functions to public;   -- drop our global row -> pristine
select 'global pg_default_acl rows for postgres/functions' as what, count(*) as n from pg_default_acl where defaclrole = 'postgres'::regrole and defaclnamespace = 0 and defaclobjtype = 'f';
select 'acldefault(function, postgres) = the built-in default' as what, acldefault('f'::"char", 'postgres'::regrole)::text as acl;
create function public.zz_p1() returns int language sql as $$ select 1 $$;
select 'new function in public: proacl' as what, coalesce(proacl::text, 'NULL (=> built-in default)') as proacl,
       (select exists (select 1 from aclexplode(coalesce(proacl, acldefault('f'::"char", proowner))) x where x.grantee = 0)) as public_exec,
       has_function_privilege('anon', 'public.zz_p1()', 'execute') as anon_can_execute
from pg_proc where proname = 'zz_p1';
rollback;

\echo
\echo === 2. Can a SCHEMA-SCOPED default (IN SCHEMA public) remove the built-in PUBLIC grant?  EXPECT: NO ===
begin;
alter default privileges for role postgres grant execute on functions to public;   -- pristine
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
create function public.zz_p2() returns int language sql as $$ select 1 $$;
select 'after IN SCHEMA public REVOKE ... FROM PUBLIC: public_exec (t = still granted)' as what,
       (select exists (select 1 from aclexplode(coalesce(proacl, acldefault('f'::"char", proowner))) x where x.grantee = 0)) as public_exec
from pg_proc where proname = 'zz_p2';
rollback;

\echo
\echo === 3. GLOBAL revoke removes it; scope = every schema; a schema-scoped GRANT adds PUBLIC back for that schema only ===
begin;
alter default privileges for role postgres grant execute on functions to public;   -- pristine
alter default privileges for role postgres revoke execute on functions from public;
create schema zz_other;
create schema zz_other_regranted;
alter default privileges for role postgres in schema zz_other_regranted grant execute on functions to public;
create function public.zz_p3() returns int language sql as $$ select 1 $$;
create function zz_other.zz_p3() returns int language sql as $$ select 1 $$;
create function zz_other_regranted.zz_p3() returns int language sql as $$ select 1 $$;
select p.oid::regprocedure::text as function,
       (select exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) x where x.grantee = 0)) as public_exec
from pg_proc p where p.proname = 'zz_p3' order by 1;
rollback;

\echo
\echo === 4. FUTURE create extension by postgres (citext, a trusted extension) under three default-ACL designs ===
\echo -- 4a pristine (what production does today) / 4b global revoke only / 4c global revoke + schema extensions re-grant (FINAL)
begin;
alter default privileges for role postgres grant execute on functions to public;
create extension citext with schema extensions;
select '4a pristine' as design, count(*) filter (where exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) x where x.grantee = 0)) as fns_with_public_exec, count(*) as fns, pg_get_userbyid(min(p.proowner)) as owner
from pg_proc p join pg_depend d on d.objid = p.oid and d.deptype = 'e' join pg_extension e on e.oid = d.refobjid and e.extname = 'citext';
rollback;
begin;
alter default privileges for role postgres grant execute on functions to public;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema extensions revoke all on functions from public;
create extension citext with schema extensions;
select '4b global only' as design, count(*) filter (where exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) x where x.grantee = 0)) as fns_with_public_exec, count(*) as fns, pg_get_userbyid(min(p.proowner)) as owner
from pg_proc p join pg_depend d on d.objid = p.oid and d.deptype = 'e' join pg_extension e on e.oid = d.refobjid and e.extname = 'citext';
rollback;
begin;
alter default privileges for role postgres grant execute on functions to public;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema extensions grant execute on functions to public;
create extension citext with schema extensions;
select '4c FINAL' as design, count(*) filter (where exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) x where x.grantee = 0)) as fns_with_public_exec, count(*) as fns, pg_get_userbyid(min(p.proowner)) as owner
from pg_proc p join pg_depend d on d.objid = p.oid and d.deptype = 'e' join pg_extension e on e.oid = d.refobjid and e.extname = 'citext';
set local role authenticated;
select '4c FINAL: authenticated can still use the extension' as what, ('A'::extensions.citext = 'a'::extensions.citext) as works;
rollback;
\echo -- NOTE: the extension functions are owned by supabase_admin (supautils elevates CREATE EXTENSION), so the postgres default
\echo -- ACLs do not touch them in ANY design; the schema-scoped re-grant only matters for extension objects owned by postgres
\echo -- (production pgcrypto / uuid-ossp / pg_stat_statements are). Same probe, forcing postgres ownership of a function in schema extensions:
begin;
alter default privileges for role postgres grant execute on functions to public;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema extensions revoke execute on functions from public;   -- remove the schema-scoped re-grant (if the baseline migration added it) to isolate the global-only case
create function extensions.zz_ext_like_global_only() returns int language sql as $$ select 1 $$;
alter default privileges for role postgres in schema extensions grant execute on functions to public;
create function extensions.zz_ext_like_final() returns int language sql as $$ select 1 $$;
select p.proname, pg_get_userbyid(p.proowner) as owner,
       (select exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) x where x.grantee = 0)) as public_exec
from pg_proc p where p.proname in ('zz_ext_like_global_only', 'zz_ext_like_final') order by 1;
rollback;

\echo
\echo === 5. Alternative: a DDL event trigger that revokes PUBLIC on new public functions ===
select rolname, rolsuper from pg_roles where rolname = 'postgres';
begin;
create function public.zz_evt() returns event_trigger language plpgsql as $$ begin null; end $$;
create event trigger zz_evt_trg on ddl_command_end execute function public.zz_evt();
select 'event trigger creatable by postgres in this environment (mechanism exists, but see the strategy note)' as what, count(*) as n from pg_event_trigger where evtname = 'zz_evt_trg';
rollback;
select 'platform event triggers already present (owner shows who manages them)' as what, evtname, pg_get_userbyid(evtowner) as owner from pg_event_trigger order by 2;

\echo
\echo === 6. FINAL DESIGN (run AFTER the baseline migration): new objects created by postgres ===
begin;
create table public.zz_final_t (id int primary key);
create sequence public.zz_final_s;
create function public.zz_final_f() returns int language sql as $$ select 1 $$;
create schema zz_final_other;
create function zz_final_other.f() returns int language sql as $$ select 1 $$;
create function extensions.zz_final_ext() returns int language sql as $$ select 1 $$;
select 'public table   : anon / authenticated / service_role hold any privilege?' as what,
       has_any_column_privilege('anon', 'public.zz_final_t', 'select,insert,update,references') or has_table_privilege('anon', 'public.zz_final_t', 'delete,truncate,trigger')  as anon,
       has_any_column_privilege('authenticated', 'public.zz_final_t', 'select,insert,update,references') or has_table_privilege('authenticated', 'public.zz_final_t', 'delete,truncate,trigger') as authenticated,
       has_any_column_privilege('service_role', 'public.zz_final_t', 'select,insert,update,references') or has_table_privilege('service_role', 'public.zz_final_t', 'delete,truncate,trigger') as service_role;
select 'public sequence: anon / authenticated / service_role' as what,
       has_sequence_privilege('anon', 'public.zz_final_s', 'usage,select,update') as anon,
       has_sequence_privilege('authenticated', 'public.zz_final_s', 'usage,select,update') as authenticated,
       has_sequence_privilege('service_role', 'public.zz_final_s', 'usage,select,update') as service_role;
select f as function, has_function_privilege('anon', f, 'execute') as anon, has_function_privilege('authenticated', f, 'execute') as authenticated, has_function_privilege('service_role', f, 'execute') as service_role,
       (select exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) x where x.grantee = 0)) as public_exec
from (values ('public.zz_final_f()'), ('zz_final_other.f()'), ('extensions.zz_final_ext()')) v(f) join pg_proc p on p.oid = v.f::regprocedure order by 1;
rollback;
