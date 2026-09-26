-- Zenward Platform — create_trip function privilege audit (P1-E3-S0A).
-- Static introspection only, run as postgres — no actor simulation, no
-- mutation, no fixture dependency. Companion to mutation_privilege_tests.sql
-- (P1-E2-S2) and driver_read_privilege_tests.sql (P1-E2-S3).

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  if has_function_privilege('authenticated', 'public.create_trip(uuid,uuid,text,text,timestamptz,timestamptz,uuid,uuid,text,text,uuid,integer,boolean)'::regprocedure, 'EXECUTE')
     and not has_function_privilege('anon', 'public.create_trip(uuid,uuid,text,text,timestamptz,timestamptz,uuid,uuid,text,text,uuid,integer,boolean)'::regprocedure, 'EXECUTE')
     and not has_function_privilege('public', 'public.create_trip(uuid,uuid,text,text,timestamptz,timestamptz,uuid,uuid,text,text,uuid,integer,boolean)'::regprocedure, 'EXECUTE') then
    raise notice 'CREATE-TRIP-PRIV exposed-authenticated-only: PASS (authenticated yes, anon/PUBLIC no)';
  else
    raise notice 'CREATE-TRIP-PRIV exposed-authenticated-only: FAIL';
  end if;
end $$;

do $$
declare v_p pg_proc%rowtype;
begin
  select * into v_p from pg_proc
  where proname = 'create_trip' and pronamespace = 'public'::regnamespace;
  if v_p.prosecdef and v_p.provolatile = 'v'
     and v_p.proconfig is not null and 'search_path=public, pg_temp' = any(v_p.proconfig)
     and pg_get_userbyid(v_p.proowner) not in ('anon', 'authenticated', 'service_role') then
    raise notice 'CREATE-TRIP-PRIV hardened-definition: PASS (SECURITY DEFINER, VOLATILE (it writes), explicit search_path, trusted owner)';
  else
    raise notice 'CREATE-TRIP-PRIV hardened-definition: FAIL (prosecdef=%, provolatile=%, proconfig=%, owner=%)',
      v_p.prosecdef, v_p.provolatile, v_p.proconfig, pg_get_userbyid(v_p.proowner);
  end if;
end $$;

do $$
begin
  if has_table_privilege('authenticated', 'public.trips', 'INSERT') then
    raise notice 'CREATE-TRIP-PRIV direct-insert-revoked: FAIL (authenticated still holds direct INSERT on trips)';
  else
    raise notice 'CREATE-TRIP-PRIV direct-insert-revoked: PASS (authenticated has no direct INSERT on trips)';
  end if;
end $$;

do $$
declare v_select_ok boolean; v_update_cols text;
begin
  v_select_ok := has_table_privilege('authenticated', 'public.trips', 'SELECT');
  select string_agg(column_name, ',' order by column_name) into v_update_cols
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'trips' and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if v_select_ok and v_update_cols = 'appointment_at,assistance_notes,destination_description,destination_facility_id,instructions,pickup_description,pickup_facility_id,scheduled_pickup_at' then
    raise notice 'CREATE-TRIP-PRIV select-and-update-untouched: PASS (SELECT still granted; UPDATE still exactly the P1-E2-S1 planning-column set, unchanged)';
  else
    raise notice 'CREATE-TRIP-PRIV select-and-update-untouched: FAIL (select=%, update_cols=%)', v_select_ok, v_update_cols;
  end if;
end $$;

do $$
declare v_leftover text;
begin
  select polname into v_leftover from pg_policy
  where polrelid = 'public.trips'::regclass and polname = 'trips_insert_org_operations';
  if v_leftover is null then
    raise notice 'CREATE-TRIP-PRIV superseded-policy-dropped: PASS (trips_insert_org_operations no longer exists)';
  else
    raise notice 'CREATE-TRIP-PRIV superseded-policy-dropped: FAIL (still present: %)', v_leftover;
  end if;
end $$;

do $$ begin raise notice '=== create_trip privilege test suite complete ==='; end $$;
