-- Zenward Platform — client (anon/authenticated) database privilege
-- surface tests (P1-E2-S1D1). Run against `supabase db reset`
-- fresh-seeded data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/client_privilege_surface_tests.sql
--
-- Proves the client privilege surface hardening
-- (20260917120000_client_privilege_surface_hardening.sql): anon and
-- authenticated hold no TRUNCATE/REFERENCES/TRIGGER on any current
-- public-schema table, and any FUTURE table created under the `postgres`
-- role (the role every migration in this repository runs as) will not
-- silently reacquire them either. Also re-proves that this hardening
-- changed nothing about the intentional SELECT/INSERT/UPDATE/DELETE
-- surface, the RLS-adjacent raw-mutation boundary, or the 7 S1D
-- SECURITY DEFINER mutation RPCs — all dynamic, schema-wide
-- introspection, never a fixed table list that could silently drift out
-- of sync with the schema.

\set ON_ERROR_STOP off
\pset pager off

-- =============================================================================
-- SECTION 1: NO TRUNCATE/REFERENCES/TRIGGER FOR CLIENT ROLES, SCHEMA-WIDE
-- =============================================================================

-- TEST 1. anon has NO TRUNCATE on any public-schema table.
do $$
declare v_bad text;
begin
  select string_agg(t.tablename, ', ') into v_bad
  from pg_tables t
  where t.schemaname = 'public'
    and has_table_privilege('anon', t.schemaname||'.'||quote_ident(t.tablename), 'TRUNCATE');
  if v_bad is null then
    raise notice 'TEST CLIENT-PRIV-01: PASS (anon has TRUNCATE on zero public tables)';
  else
    raise notice 'TEST CLIENT-PRIV-01: FAIL (anon can TRUNCATE: %)', v_bad;
  end if;
end $$;

-- TEST 2. authenticated has NO TRUNCATE on any public-schema table.
do $$
declare v_bad text;
begin
  select string_agg(t.tablename, ', ') into v_bad
  from pg_tables t
  where t.schemaname = 'public'
    and has_table_privilege('authenticated', t.schemaname||'.'||quote_ident(t.tablename), 'TRUNCATE');
  if v_bad is null then
    raise notice 'TEST CLIENT-PRIV-02: PASS (authenticated has TRUNCATE on zero public tables)';
  else
    raise notice 'TEST CLIENT-PRIV-02: FAIL (authenticated can TRUNCATE: %)', v_bad;
  end if;
end $$;

-- TEST 3. anon has NO TRIGGER on any public-schema table.
do $$
declare v_bad text;
begin
  select string_agg(t.tablename, ', ') into v_bad
  from pg_tables t
  where t.schemaname = 'public'
    and has_table_privilege('anon', t.schemaname||'.'||quote_ident(t.tablename), 'TRIGGER');
  if v_bad is null then
    raise notice 'TEST CLIENT-PRIV-03: PASS (anon has TRIGGER on zero public tables)';
  else
    raise notice 'TEST CLIENT-PRIV-03: FAIL (anon can TRIGGER: %)', v_bad;
  end if;
end $$;

-- TEST 4. authenticated has NO TRIGGER on any public-schema table.
do $$
declare v_bad text;
begin
  select string_agg(t.tablename, ', ') into v_bad
  from pg_tables t
  where t.schemaname = 'public'
    and has_table_privilege('authenticated', t.schemaname||'.'||quote_ident(t.tablename), 'TRIGGER');
  if v_bad is null then
    raise notice 'TEST CLIENT-PRIV-04: PASS (authenticated has TRIGGER on zero public tables)';
  else
    raise notice 'TEST CLIENT-PRIV-04: FAIL (authenticated can TRIGGER: %)', v_bad;
  end if;
end $$;

-- TEST 5. anon has NO REFERENCES on any public-schema table.
do $$
declare v_bad text;
begin
  select string_agg(t.tablename, ', ') into v_bad
  from pg_tables t
  where t.schemaname = 'public'
    and has_table_privilege('anon', t.schemaname||'.'||quote_ident(t.tablename), 'REFERENCES');
  if v_bad is null then
    raise notice 'TEST CLIENT-PRIV-05: PASS (anon has REFERENCES on zero public tables)';
  else
    raise notice 'TEST CLIENT-PRIV-05: FAIL (anon has REFERENCES: %)', v_bad;
  end if;
end $$;

-- TEST 6. authenticated has NO REFERENCES on any public-schema table.
do $$
declare v_bad text;
begin
  select string_agg(t.tablename, ', ') into v_bad
  from pg_tables t
  where t.schemaname = 'public'
    and has_table_privilege('authenticated', t.schemaname||'.'||quote_ident(t.tablename), 'REFERENCES');
  if v_bad is null then
    raise notice 'TEST CLIENT-PRIV-06: PASS (authenticated has REFERENCES on zero public tables)';
  else
    raise notice 'TEST CLIENT-PRIV-06: FAIL (authenticated has REFERENCES: %)', v_bad;
  end if;
end $$;

-- =============================================================================
-- SECTION 2: NAMED SPOT CHECKS (trips / recurring_arrangements /
-- recurring_occurrence_exceptions) — explicit, not merely implied by the
-- schema-wide checks above.
-- =============================================================================

-- TEST 7. Named-table spot check: neither client role holds TRUNCATE/
-- REFERENCES/TRIGGER on any of the three explicitly-named tables.
do $$
declare v_bad text;
begin
  select string_agg(combo, ', ') into v_bad
  from (
    select role || ':' || tbl || ':' || priv as combo
    from unnest(array['anon','authenticated']) as role
    cross join unnest(array['trips','recurring_arrangements','recurring_occurrence_exceptions']) as tbl
    cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) as priv
    where has_table_privilege(role, 'public.'||tbl, priv)
  ) x;
  if v_bad is null then
    raise notice 'TEST CLIENT-PRIV-07: PASS (neither anon nor authenticated holds TRUNCATE/REFERENCES/TRIGGER on trips, recurring_arrangements, or recurring_occurrence_exceptions)';
  else
    raise notice 'TEST CLIENT-PRIV-07: FAIL (%)', v_bad;
  end if;
end $$;

-- TEST 8. Live raw TRUNCATE attempt, authenticated, on all three named
-- tables — genuinely denied (not merely inferred from has_table_privilege),
-- with zero data loss (the permission check happens before any row is
-- touched).
do $$
declare v_denied int := 0;
declare v_before_trips int; declare v_after_trips int;
begin
  select count(*) into v_before_trips from public.trips;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin truncate public.trips; exception when others then v_denied := v_denied + 1; end;
  begin truncate public.recurring_arrangements; exception when others then v_denied := v_denied + 1; end;
  begin truncate public.recurring_occurrence_exceptions; exception when others then v_denied := v_denied + 1; end;
  reset role;
  select count(*) into v_after_trips from public.trips;
  if v_denied = 3 and v_before_trips = v_after_trips then
    raise notice 'TEST CLIENT-PRIV-08: PASS (authenticated live TRUNCATE denied on all 3 named tables, trip row count unchanged: %)', v_after_trips;
  else
    raise notice 'TEST CLIENT-PRIV-08: FAIL (denied %/3, trips before=% after=%)', v_denied, v_before_trips, v_after_trips;
  end if;
end $$;
reset role;

-- TEST 9. Live raw TRUNCATE attempt, anon, on all three named tables.
do $$
declare v_denied int := 0;
begin
  set local role anon;
  begin truncate public.trips; exception when others then v_denied := v_denied + 1; end;
  begin truncate public.recurring_arrangements; exception when others then v_denied := v_denied + 1; end;
  begin truncate public.recurring_occurrence_exceptions; exception when others then v_denied := v_denied + 1; end;
  if v_denied = 3 then
    raise notice 'TEST CLIENT-PRIV-09: PASS (anon live TRUNCATE denied on all 3 named tables)';
  else
    raise notice 'TEST CLIENT-PRIV-09: FAIL (denied %/3)', v_denied;
  end if;
end $$;
reset role;

-- =============================================================================
-- SECTION 3: SERVICE_ROLE UNAFFECTED (proving this hardening did not
-- over-revoke the trusted backend role).
-- =============================================================================

-- TEST 10. service_role privileges are completely untouched.
do $$
declare v_missing text;
begin
  select string_agg(t.tablename, ', ') into v_missing
  from pg_tables t
  where t.schemaname = 'public'
    and not (
      has_table_privilege('service_role', t.schemaname||'.'||quote_ident(t.tablename), 'TRUNCATE')
      and has_table_privilege('service_role', t.schemaname||'.'||quote_ident(t.tablename), 'REFERENCES')
      and has_table_privilege('service_role', t.schemaname||'.'||quote_ident(t.tablename), 'TRIGGER')
    );
  if v_missing is null then
    raise notice 'TEST CLIENT-PRIV-10: PASS (service_role retains TRUNCATE/REFERENCES/TRIGGER on all public tables, unaffected by this client-role-only hardening)';
  else
    raise notice 'TEST CLIENT-PRIV-10: FAIL (service_role lost a privilege on: %)', v_missing;
  end if;
end $$;

-- =============================================================================
-- SECTION 4: DEFAULT ACL — FUTURE TABLES WILL NOT REACQUIRE THESE
-- PRIVILEGES.
-- =============================================================================

-- TEST 11. pg_default_acl introspection: the default ACL for tables
-- created by `postgres` (the role every migration in this repository
-- runs as) in schema public no longer includes D(TRUNCATE)/x(REFERENCES)/
-- t(TRIGGER) for anon or authenticated.
do $$
declare v_acl aclitem[];
declare v_bad boolean := false;
declare v_item aclitem;
begin
  select defaclacl into v_acl
  from pg_default_acl da
  join pg_namespace n on n.oid = da.defaclnamespace
  where n.nspname = 'public' and defaclobjtype = 'r' and defaclrole = 'postgres'::regrole;

  foreach v_item in array v_acl loop
    -- Isolate ONLY the privileges substring (between "=" and "/") —
    -- neither the grantee name ("authenticated" itself contains a
    -- literal 't') nor the grantor name ("postgres" contains a literal
    -- 't' too) may leak into the D/x/t check.
    if (split_part(v_item::text, '=', 1) = 'anon' or split_part(v_item::text, '=', 1) = 'authenticated')
       and (split_part(split_part(v_item::text, '=', 2), '/', 1) ~ '[Dxt]') then
      v_bad := true;
    end if;
  end loop;

  if not v_bad then
    raise notice 'TEST CLIENT-PRIV-11: PASS (default ACL for future postgres-owned public tables grants anon/authenticated no TRUNCATE(D)/REFERENCES(x)/TRIGGER(t) — acl=%)', v_acl;
  else
    raise notice 'TEST CLIENT-PRIV-11: FAIL (default ACL still includes D/x/t for a client role — acl=%)', v_acl;
  end if;
end $$;

-- TEST 12. Live probe: a table created by postgres RIGHT NOW, inside a
-- transaction that is always rolled back (never a permanent object),
-- genuinely inherits no TRUNCATE/REFERENCES/TRIGGER for either client
-- role — the strongest possible proof, stronger than ACL-string parsing
-- alone. The CREATE TABLE and the assertion both run inside the SAME
-- ambient transaction (a `do $$ ... $$` block never commits on its own);
-- the top-level ROLLBACK after it undoes the CREATE TABLE completely, so
-- no permanent object is ever left behind.
begin;
create table public._client_priv_default_acl_probe (id uuid primary key default extensions.gen_random_uuid());
do $$
declare v_bad boolean := false;
begin
  if has_table_privilege('anon', 'public._client_priv_default_acl_probe', 'TRUNCATE')
     or has_table_privilege('anon', 'public._client_priv_default_acl_probe', 'REFERENCES')
     or has_table_privilege('anon', 'public._client_priv_default_acl_probe', 'TRIGGER')
     or has_table_privilege('authenticated', 'public._client_priv_default_acl_probe', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public._client_priv_default_acl_probe', 'REFERENCES')
     or has_table_privilege('authenticated', 'public._client_priv_default_acl_probe', 'TRIGGER')
  then
    v_bad := true;
  end if;
  if not v_bad then
    raise notice 'TEST CLIENT-PRIV-12: PASS (a table created by postgres in public RIGHT NOW inherits no TRUNCATE/REFERENCES/TRIGGER for anon or authenticated — the default ACL hardening protects future tables, not just the 20 that existed at migration time)';
  else
    raise notice 'TEST CLIENT-PRIV-12: FAIL (a newly-created table inherited a revoked privilege for a client role)';
  end if;
end $$;
rollback;
-- Confirm the probe table left no permanent trace.
select case when to_regclass('public._client_priv_default_acl_probe') is null
  then 'TEST CLIENT-PRIV-12b: PASS (probe table does not exist after rollback, no permanent object left behind)'
  else 'TEST CLIENT-PRIV-12b: FAIL (probe table still exists)' end as probe_cleanup_check;

-- =============================================================================
-- SECTION 5: LEGITIMATE ACCESS UNCHANGED
-- =============================================================================

-- TEST 13. authenticated still has SELECT where intended (spot check:
-- trips, recurring_arrangements, recurring_occurrence_exceptions,
-- organizations).
do $$
declare v_missing text;
begin
  select string_agg(tbl, ', ') into v_missing
  from unnest(array['trips','recurring_arrangements','recurring_occurrence_exceptions','organizations']) as tbl
  where not has_table_privilege('authenticated', 'public.'||tbl, 'SELECT');
  if v_missing is null then
    raise notice 'TEST CLIENT-PRIV-13: PASS (authenticated retains intended SELECT on all 4 spot-checked tables)';
  else
    raise notice 'TEST CLIENT-PRIV-13: FAIL (authenticated lost SELECT on: %)', v_missing;
  end if;
end $$;

-- TEST 14. Intended narrow Trip UPDATE columns remain exactly as before
-- (column-level, not table-level) — the same 8-column set established by
-- prior phases: appointment_at, assistance_notes, destination_description,
-- destination_facility_id, instructions, pickup_description,
-- pickup_facility_id, scheduled_pickup_at. recurring_arrangement_id/state/
-- passenger_id/organization_id/request_id/cancellation_reason/
-- cancelled_at/completed_at/no_show_at/created_at/updated_at/id remain
-- NOT UPDATE-granted.
do $$
declare v_expected text[] := array['appointment_at','assistance_notes','destination_description','destination_facility_id','instructions','pickup_description','pickup_facility_id','scheduled_pickup_at'];
declare v_actual text[];
declare v_table_level boolean;
begin
  select array_agg(column_name order by column_name) into v_actual
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'trips' and grantee = 'authenticated' and privilege_type = 'UPDATE';

  v_table_level := has_table_privilege('authenticated', 'public.trips', 'UPDATE');

  if v_actual = (select array_agg(x order by x) from unnest(v_expected) as x) and not v_table_level then
    raise notice 'TEST CLIENT-PRIV-14: PASS (trips UPDATE remains column-scoped to exactly the intended 8 columns, no table-level UPDATE): %', v_actual;
  else
    raise notice 'TEST CLIENT-PRIV-14: FAIL (columns=%, table_level_update=%)', v_actual, v_table_level;
  end if;
end $$;

-- TEST 15. RecurringArrangement raw INSERT remains blocked.
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  insert into public.recurring_arrangements (organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone)
  values ('10000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'x', 'x', '08:00', array[1]::smallint[], '2026-01-01', 'America/New_York');
  raise notice 'TEST CLIENT-PRIV-15: FAIL (raw INSERT on recurring_arrangements succeeded)';
exception when others then
  raise notice 'TEST CLIENT-PRIV-15: PASS (raw INSERT on recurring_arrangements denied: %)', sqlerrm;
end $$;
reset role;

-- TEST 16. RecurringOccurrenceException raw INSERT remains blocked.
do $$
declare v_arr_id uuid;
begin
  select id into v_arr_id from public.recurring_arrangements limit 1;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  insert into public.recurring_occurrence_exceptions (organization_id, recurring_arrangement_id, service_date, reason)
  values ('10000000-0000-0000-0000-0000000000a1', coalesce(v_arr_id, gen_random_uuid()), current_date + 1, 'x');
  raise notice 'TEST CLIENT-PRIV-16: FAIL (raw INSERT on recurring_occurrence_exceptions succeeded)';
exception when others then
  raise notice 'TEST CLIENT-PRIV-16: PASS (raw INSERT on recurring_occurrence_exceptions denied: %)', sqlerrm;
end $$;
reset role;

-- TEST 17. S1D RPC execution remains usable for an authorized Organization
-- Admin — a minimal create -> pause -> resume -> skip -> unskip -> end
-- lifecycle, proving SECURITY DEFINER execution is completely unaffected
-- by revoking these three client table privileges (they were never
-- required for a SECURITY DEFINER function's own internal writes in the
-- first place — the function owner's privilege, not the caller's, is
-- what governs its internal reads/writes).
do $$
declare
  v_create public.recurring_arrangement_result;
  v_pause public.recurring_arrangement_result;
  v_resume public.recurring_arrangement_result;
  v_skip public.recurring_occurrence_exception_result;
  v_unskip public.recurring_occurrence_exception_result;
  v_end public.recurring_arrangement_result;
  v_target date;
  v_ok boolean := true;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';

  select * into v_create from create_recurring_arrangement(
    '10000000-0000-0000-0000-0000000000a1'::uuid, '40000000-0000-0000-0000-0000000000a1'::uuid,
    'CLIENT-PRIV-17 fixture', 'CLIENT-PRIV-17 dest', '08:00'::time, array[1,2,3,4,5,6,7]::smallint[], '2026-01-01'::date, null);
  if v_create.arrangement_id is null then v_ok := false; end if;

  select * into v_pause from pause_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, v_create.arrangement_id);
  if not v_pause.changed or v_pause.status <> 'paused' then v_ok := false; end if;

  select * into v_resume from resume_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, v_create.arrangement_id);
  if not v_resume.changed or v_resume.status <> 'active' then v_ok := false; end if;

  select min(d::date) into v_target from generate_series(current_date::timestamp, (current_date+3)::timestamp, interval '1 day') as d;
  select * into v_skip from skip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, v_create.arrangement_id, v_target, 'CLIENT-PRIV-17 skip');
  if not v_skip.changed then v_ok := false; end if;

  select * into v_unskip from unskip_recurring_occurrence('10000000-0000-0000-0000-0000000000a1'::uuid, v_create.arrangement_id, v_target);
  if not v_unskip.changed then v_ok := false; end if;

  select * into v_end from end_recurring_arrangement('10000000-0000-0000-0000-0000000000a1'::uuid, v_create.arrangement_id, 'CLIENT-PRIV-17 cleanup');
  if not v_end.changed or v_end.status <> 'ended' then v_ok := false; end if;

  if v_ok then
    raise notice 'TEST CLIENT-PRIV-17: PASS (create/pause/resume/skip/unskip/end all succeed normally for an authorized Organization Admin after privilege hardening)';
  else
    raise notice 'TEST CLIENT-PRIV-17: FAIL (one or more RPC calls in the lifecycle did not behave as expected)';
  end if;
end $$;
reset role;
delete from public.audit_events where entity_id in (select id from public.recurring_arrangements where pickup_description = 'CLIENT-PRIV-17 fixture');
delete from public.recurring_arrangements where pickup_description = 'CLIENT-PRIV-17 fixture';

-- =============================================================================
-- SECTION 6: MAINTAIN PRIVILEGE (P1-E2-S1G §9) — the one item S1D1 itself
-- explicitly carried forward. Version-gated exactly like the migration
-- itself: on any server where server_version_num < 170000 (PostgreSQL
-- < 17), MAINTAIN does not exist as a grantable table privilege at all,
-- so these tests report PASS with an explicit "not applicable on this
-- server" note rather than attempting a check `has_table_privilege`
-- itself would raise an error evaluating on such a server.
-- =============================================================================

-- TEST 18. anon/authenticated hold no MAINTAIN on any public-schema table.
do $$
declare v_bad text;
declare v_version_num int := current_setting('server_version_num')::int;
begin
  if v_version_num < 170000 then
    raise notice 'TEST CLIENT-PRIV-18: PASS (not applicable — server_version_num=% is PostgreSQL < 17, MAINTAIN does not exist as a grantable privilege on this server)', v_version_num;
  else
    select string_agg(t.tablename||':'||role, ', ') into v_bad
    from pg_tables t
    cross join unnest(array['anon','authenticated']) as role
    where t.schemaname = 'public'
      and has_table_privilege(role, t.schemaname||'.'||quote_ident(t.tablename), 'MAINTAIN');
    if v_bad is null then
      raise notice 'TEST CLIENT-PRIV-18: PASS (anon/authenticated hold MAINTAIN on zero public tables)';
    else
      raise notice 'TEST CLIENT-PRIV-18: FAIL (MAINTAIN still held: %)', v_bad;
    end if;
  end if;
end $$;

-- TEST 19. Default ACL: future postgres-owned public tables will not
-- re-grant MAINTAIN to anon/authenticated.
do $$
declare v_acl aclitem[];
declare v_bad boolean := false;
declare v_item aclitem;
declare v_version_num int := current_setting('server_version_num')::int;
begin
  if v_version_num < 170000 then
    raise notice 'TEST CLIENT-PRIV-19: PASS (not applicable — server_version_num=% is PostgreSQL < 17)', v_version_num;
  else
    select defaclacl into v_acl
    from pg_default_acl da
    join pg_namespace n on n.oid = da.defaclnamespace
    where n.nspname = 'public' and defaclobjtype = 'r' and defaclrole = 'postgres'::regrole;

    foreach v_item in array v_acl loop
      if (split_part(v_item::text, '=', 1) = 'anon' or split_part(v_item::text, '=', 1) = 'authenticated')
         and (split_part(split_part(v_item::text, '=', 2), '/', 1) ~ 'm') then
        v_bad := true;
      end if;
    end loop;

    if not v_bad then
      raise notice 'TEST CLIENT-PRIV-19: PASS (default ACL for future postgres-owned public tables grants anon/authenticated no MAINTAIN — acl=%)', v_acl;
    else
      raise notice 'TEST CLIENT-PRIV-19: FAIL (default ACL still includes MAINTAIN(m) for a client role — acl=%)', v_acl;
    end if;
  end if;
end $$;

-- TEST 20. service_role retains MAINTAIN — this hardening is client-role-only, exactly like S1D1's own TRUNCATE/REFERENCES/TRIGGER scope.
do $$
declare v_missing text;
declare v_version_num int := current_setting('server_version_num')::int;
begin
  if v_version_num < 170000 then
    raise notice 'TEST CLIENT-PRIV-20: PASS (not applicable — server_version_num=% is PostgreSQL < 17)', v_version_num;
  else
    select string_agg(t.tablename, ', ') into v_missing
    from pg_tables t
    where t.schemaname = 'public'
      and not has_table_privilege('service_role', t.schemaname||'.'||quote_ident(t.tablename), 'MAINTAIN');
    if v_missing is null then
      raise notice 'TEST CLIENT-PRIV-20: PASS (service_role retains MAINTAIN on all public tables, unaffected by this client-role-only hardening)';
    else
      raise notice 'TEST CLIENT-PRIV-20: FAIL (service_role lost MAINTAIN on: %)', v_missing;
    end if;
  end if;
end $$;

do $$ begin raise notice '=== Client privilege surface test suite complete ==='; end $$;
