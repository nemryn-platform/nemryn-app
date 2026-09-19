-- Zenward Platform — function privilege / direct-invocation abuse tests
-- (P1-E2-S1A SECURITY DEFINER exposure audit). Run as postgres.
--
-- Covers what the Node-based RPC probe (used during the audit to exercise
-- the real PostgREST/GoTrue network path — see rls-test-matrix.md) checks
-- over HTTP, as a permanent, reproducible SQL regression: real ACLs, and
-- the same live SET ROLE technique used by the main adversarial suite.

\set ON_ERROR_STOP off
\pset pager off

-- No function in the public schema grants EXECUTE to PUBLIC.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('public', p.oid, 'EXECUTE');
  if v_bad is null then
    raise notice 'FUNCTION-PRIV no-public-execute: PASS (no function grants EXECUTE to PUBLIC)';
  else
    raise notice 'FUNCTION-PRIV no-public-execute: FAIL (PUBLIC can execute: %)', v_bad;
  end if;
end $$;

-- No function in the public schema grants EXECUTE to anon, EXCEPT the
-- one deliberate, reviewed exception below (P1-E3-S9,
-- get_driver_invite_preview) — an unauthenticated invite recipient must
-- be able to preview "you've been invited to join {org} as a driver"
-- BEFORE they have an account to sign in with. The function itself is
-- narrow, read-only, token-gated (a 122-bit random UUID is the
-- credential), and returns only organization_name/display_name/email/
-- status — never organization_id or any other invite column (see
-- 20260903100200_driver_invites.sql).
--
-- P1-PILOT-S4A originally added submit_public_transportation_request to
-- this same allowlist (anon/authenticated held EXECUTE on it directly).
-- P1-PILOT-S4B revoked that grant entirely — the function is now
-- service_role-only, reachable ONLY through the Nemryn-owned Next.js
-- Route Handler (see 20260919120000_public_intake_ingress_hardening.sql
-- and TEST S4B-1/S4B-2/S4B-3 in public_request_intake_tests.sql, which
-- prove anon/authenticated/PUBLIC all get insufficient_privilege calling
-- it directly). It is deliberately NOT listed here any longer: this test
-- now asserts anon holds NO EXECUTE on it at all, the stronger S4B
-- invariant, not a weaker one.
--
-- Any OTHER anon-executable function still fails this test, unchanged.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and p.proname <> 'get_driver_invite_preview';
  if v_bad is null then
    raise notice 'FUNCTION-PRIV no-anon-execute: PASS (anon cannot execute any public-schema function, except the deliberate get_driver_invite_preview exception, P1-E3-S9)';
  else
    raise notice 'FUNCTION-PRIV no-anon-execute: FAIL (anon can execute: %)', v_bad;
  end if;
end $$;

-- The 5 RLS helpers grant EXECUTE to authenticated (required for RLS policy
-- evaluation); the 2 trigger-support functions do not (they're never
-- called directly, only as triggers).
do $$
declare v_missing text;
begin
  select string_agg(fn, ', ') into v_missing
  from unnest(array['is_org_member','has_org_role','current_driver_id','is_driver_assigned_to_trip','is_platform_admin']) as fn
  where not has_function_privilege('authenticated', ('public.' || fn)::regproc, 'EXECUTE');
  if v_missing is null then
    raise notice 'FUNCTION-PRIV authenticated-has-helpers: PASS (authenticated can execute all 5 RLS helpers)';
  else
    raise notice 'FUNCTION-PRIV authenticated-has-helpers: FAIL (missing execute on: %)', v_missing;
  end if;
end $$;

do $$
begin
  if has_function_privilege('authenticated', 'public.set_updated_at()'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.prevent_organization_id_change()'::regprocedure, 'EXECUTE') then
    raise notice 'FUNCTION-PRIV trigger-fns-not-executable: FAIL (authenticated can execute a trigger-support function directly)';
  else
    raise notice 'FUNCTION-PRIV trigger-fns-not-executable: PASS (neither trigger-support function is directly executable by authenticated)';
  end if;
end $$;

-- All 5 SECURITY DEFINER helpers are owned by a trusted migration role, not
-- an application-facing role.
do $$
declare v_bad text;
begin
  select string_agg(p.proname || ' owned by ' || pg_get_userbyid(p.proowner), ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and pg_get_userbyid(p.proowner) in ('anon', 'authenticated', 'service_role');
  if v_bad is null then
    raise notice 'FUNCTION-PRIV trusted-ownership: PASS (no SECURITY DEFINER function is owned by an application-facing role)';
  else
    raise notice 'FUNCTION-PRIV trusted-ownership: FAIL (%)', v_bad;
  end if;
end $$;

-- public schema is not CREATE-able by anon/authenticated/PUBLIC (search_path safety precondition).
do $$
begin
  if has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('authenticated', 'public', 'CREATE')
     or has_schema_privilege('public', 'public', 'CREATE') then
    raise notice 'FUNCTION-PRIV public-schema-not-writable: FAIL (an untrusted role can CREATE in public — search_path=public,pg_temp is unsafe)';
  else
    raise notice 'FUNCTION-PRIV public-schema-not-writable: PASS (anon/authenticated/PUBLIC cannot CREATE in public — search_path=public,pg_temp remains safe)';
  end if;
end $$;

-- current_driver_id() abuse check: a driver never gets another org's (or
-- another person's) driver id back — only their own, or null.
do $$
declare v_own uuid; v_cross uuid;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3'; -- Driver A1's linked user
  select current_driver_id('10000000-0000-0000-0000-0000000000a1'::uuid) into v_own;   -- own org
  select current_driver_id('10000000-0000-0000-0000-0000000000b1'::uuid) into v_cross; -- Org B, not a member
  if v_own = '30000000-0000-0000-0000-0000000000a1'::uuid and v_cross is null then
    raise notice 'FUNCTION-PRIV current_driver_id-scoped: PASS (returns own id for own org=%, null for a foreign org)', v_own;
  else
    raise notice 'FUNCTION-PRIV current_driver_id-scoped: FAIL (own=%, cross=% — expected own id and null)', v_own, v_cross;
  end if;
end $$;
reset role;

do $$ begin raise notice '=== Function privilege test suite complete ==='; end $$;
