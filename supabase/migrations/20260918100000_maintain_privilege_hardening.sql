-- P1-E2-S1G — MAINTAIN Privilege Hardening (version-safe).
--
-- Closes the ONE remaining item S1D1 explicitly carried forward: after
-- that phase's own TRUNCATE/REFERENCES/TRIGGER revocation
-- (20260917120000_client_privilege_surface_hardening.sql), anon/
-- authenticated still inherited the PostgreSQL 17+ MAINTAIN privilege
-- (governs VACUUM/ANALYZE/CLUSTER/REINDEX/REFRESH MATERIALIZED VIEW/
-- LOCK TABLE on a table) from the SAME pre-existing `postgres`-owner
-- default ACL for schema public — S1D1's own migration deliberately
-- scoped itself to only the 3 privileges its own phase spec named,
-- leaving `m` (MAINTAIN) as the one remaining letter in that ACL string
-- for anon/authenticated, confirmed directly via pg_default_acl at the
-- time (see that migration's own OPEN ISSUES).
--
-- PRODUCTION VERSION AUDIT (P1-E2-S1G §8, performed BEFORE writing any
-- statement below): `supabase projects list` (safe, read-only project
-- metadata — no credentials exposed, no data touched) confirmed the
-- linked production project ("ZenwardApp Staging",
-- wyocbivzgrbekuyqdfts, status ACTIVE_HEALTHY) runs PostgreSQL
-- 17.6.1.166 (postgres_engine "17"); the local development database
-- independently confirmed PostgreSQL 17.6 via `show server_version;`.
-- Both environments are PostgreSQL 17.x — MAINTAIN is therefore
-- genuinely present and revocable in BOTH, not merely assumed to be.
--
-- VERSION-SAFE BY CONSTRUCTION REGARDLESS (§9): even though local and
-- production currently agree, every MAINTAIN-specific statement below is
-- wrapped in a guarded PL/pgSQL DO block using EXECUTE (dynamic SQL),
-- gated on `current_setting('server_version_num')::int >= 170000`
-- (Postgres's own server_version_num encoding for 17.0, the version
-- MAINTAIN was introduced in) — this is not merely a defensive nicety:
-- GRANT/REVOKE/ALTER DEFAULT PRIVILEGES are not part of PL/pgSQL's own
-- small set of natively-embeddable statement types, so reaching them at
-- all already requires EXECUTE (dynamic SQL); the same EXECUTE
-- requirement conveniently also means the literal text "MAINTAIN" is
-- never seen by any SQL parser until the dynamic string is actually
-- submitted at runtime, which only happens inside the version-gated
-- branch. On any hypothetical future PostgreSQL < 17 target, this
-- migration parses and runs cleanly end to end, taking the `else`
-- branch (a plain diagnostic notice, no privilege change attempted) —
-- never a parse-time failure on unsupported MAINTAIN syntax.
--
-- SCOPE — identical discipline to S1D1, not widened: ONLY anon and
-- authenticated are touched, in exactly the same two statements S1D1
-- itself used (current-table REVOKE + future-table ALTER DEFAULT
-- PRIVILEGES for role `postgres`, the confirmed-unchanged role every
-- migration in this repository still runs as). service_role/postgres/
-- supabase_admin are not mentioned in either statement. No RLS policy
-- is touched. No SELECT/INSERT/UPDATE/DELETE privilege, table-level or
-- column-level, is touched.
do $outer$
declare
  v_version_num int := current_setting('server_version_num')::int;
begin
  if v_version_num >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
    execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated';
    raise notice 'MAINTAIN privilege hardening applied (server_version_num=%, PostgreSQL 17+): anon/authenticated no longer hold MAINTAIN on any current public table, nor will they inherit it on any future table created by postgres.', v_version_num;
  else
    raise notice 'MAINTAIN privilege hardening skipped: server_version_num=% (< 170000, PostgreSQL < 17) — MAINTAIN does not exist as a grantable table privilege on this server, so there is nothing to revoke here. No other statement in this migration executes.', v_version_num;
  end if;
end $outer$;

comment on schema public is
  'Application schema. As of P1-E2-S1G, anon/authenticated hold no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on any table here, current or future, on any PostgreSQL 17+ server (see 20260917120000_client_privilege_surface_hardening.sql for TRUNCATE/REFERENCES/TRIGGER, this migration for MAINTAIN) — SELECT/INSERT/UPDATE/DELETE remain exactly as each table''s own owning migration explicitly granted them, unaffected, working together with each table''s own RLS policies exactly as before.';
