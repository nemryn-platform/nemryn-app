-- Zenward Platform — Request mutation foundation privilege audit
-- (P1-E1-S2B). Static introspection (function/table/column privileges)
-- plus a small live SELECT-visibility matrix for request_events.
-- Companion to create_trip_privilege_tests.sql — same conventions.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/request_mutation_privilege_tests.sql

\set ON_ERROR_STOP off
\pset pager off

-- ---------------------------------------------------------------------------
-- Fixtures — this file must be runnable in isolation against a fresh
-- reset (the established authoritative per-file method), so it seeds its
-- own request_events rows directly as postgres rather than depending on
-- request_mutation_tests.sql having run first.
-- ---------------------------------------------------------------------------
insert into public.transportation_requests (
  id, organization_id, requester_name, requester_relationship, requester_phone,
  pickup_description, destination_description, return_trip_needed, source, state
) values
  ('92100000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1',
   'Fictional Priv Test Requester A', 'self', '555-0180', 'Fictional priv pickup A', 'Fictional priv destination A', 'no', 'phone', 'pending'),
  ('92100000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1',
   'Fictional Priv Test Requester B', 'self', '555-0280', 'Fictional priv pickup B', 'Fictional priv destination B', 'no', 'phone', 'pending');

insert into public.request_events (organization_id, request_id, event_type, actor_user_id) values
  ('10000000-0000-0000-0000-0000000000a1', '92100000-0000-0000-0000-0000000000a1', 'request_logged', '20000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-0000000000b1', '92100000-0000-0000-0000-0000000000b1', 'request_logged', '20000000-0000-0000-0000-0000000000b1');

-- =============================================================================
-- Function exposure: authenticated only, never anon/PUBLIC
-- =============================================================================

do $$
begin
  if has_function_privilege('authenticated', 'public.log_transportation_request(uuid,text,text,text,text,text,text,text,text,uuid,date,time,text,text)'::regprocedure, 'EXECUTE')
     and not has_function_privilege('anon', 'public.log_transportation_request(uuid,text,text,text,text,text,text,text,text,uuid,date,time,text,text)'::regprocedure, 'EXECUTE')
     and not has_function_privilege('public', 'public.log_transportation_request(uuid,text,text,text,text,text,text,text,text,uuid,date,time,text,text)'::regprocedure, 'EXECUTE') then
    raise notice 'REQ-PRIV log_transportation_request exposed-authenticated-only: PASS';
  else
    raise notice 'REQ-PRIV log_transportation_request exposed-authenticated-only: FAIL';
  end if;
end $$;

do $$
begin
  if has_function_privilege('authenticated', 'public.link_request_passenger(uuid,uuid,uuid)'::regprocedure, 'EXECUTE')
     and not has_function_privilege('anon', 'public.link_request_passenger(uuid,uuid,uuid)'::regprocedure, 'EXECUTE')
     and not has_function_privilege('public', 'public.link_request_passenger(uuid,uuid,uuid)'::regprocedure, 'EXECUTE') then
    raise notice 'REQ-PRIV link_request_passenger exposed-authenticated-only: PASS';
  else
    raise notice 'REQ-PRIV link_request_passenger exposed-authenticated-only: FAIL';
  end if;
end $$;

do $$
begin
  if has_function_privilege('authenticated', 'public.decline_transportation_request(uuid,uuid,text)'::regprocedure, 'EXECUTE')
     and not has_function_privilege('anon', 'public.decline_transportation_request(uuid,uuid,text)'::regprocedure, 'EXECUTE')
     and not has_function_privilege('public', 'public.decline_transportation_request(uuid,uuid,text)'::regprocedure, 'EXECUTE') then
    raise notice 'REQ-PRIV decline_transportation_request exposed-authenticated-only: PASS';
  else
    raise notice 'REQ-PRIV decline_transportation_request exposed-authenticated-only: FAIL';
  end if;
end $$;

do $$
begin
  if has_function_privilege('authenticated', 'public.cancel_transportation_request(uuid,uuid)'::regprocedure, 'EXECUTE')
     and not has_function_privilege('anon', 'public.cancel_transportation_request(uuid,uuid)'::regprocedure, 'EXECUTE')
     and not has_function_privilege('public', 'public.cancel_transportation_request(uuid,uuid)'::regprocedure, 'EXECUTE') then
    raise notice 'REQ-PRIV cancel_transportation_request exposed-authenticated-only: PASS';
  else
    raise notice 'REQ-PRIV cancel_transportation_request exposed-authenticated-only: FAIL';
  end if;
end $$;

-- =============================================================================
-- Hardened definition: SECURITY DEFINER, explicit search_path, trusted owner
-- =============================================================================

do $$
declare v_p pg_proc%rowtype; v_name text;
begin
  for v_name in select unnest(array['log_transportation_request', 'link_request_passenger', 'decline_transportation_request', 'cancel_transportation_request'])
  loop
    select * into v_p from pg_proc where proname = v_name and pronamespace = 'public'::regnamespace;
    if v_p.prosecdef and v_p.proconfig is not null and 'search_path=public, pg_temp' = any(v_p.proconfig)
       and pg_get_userbyid(v_p.proowner) not in ('anon', 'authenticated', 'service_role') then
      raise notice 'REQ-PRIV % hardened-definition: PASS (SECURITY DEFINER, explicit search_path, trusted owner)', v_name;
    else
      raise notice 'REQ-PRIV % hardened-definition: FAIL (prosecdef=%, proconfig=%, owner=%)', v_name, v_p.prosecdef, v_p.proconfig, pg_get_userbyid(v_p.proowner);
    end if;
  end loop;
end $$;

-- =============================================================================
-- transportation_requests: raw client INSERT retired, state/passenger_id
-- no longer directly UPDATE-able
-- =============================================================================

do $$
begin
  if has_table_privilege('authenticated', 'public.transportation_requests', 'INSERT') then
    raise notice 'REQ-PRIV direct-insert-revoked: FAIL (authenticated still holds direct INSERT on transportation_requests)';
  else
    raise notice 'REQ-PRIV direct-insert-revoked: PASS (authenticated has no direct INSERT on transportation_requests)';
  end if;
end $$;

do $$
declare v_leftover text;
begin
  select polname into v_leftover from pg_policy
  where polrelid = 'public.transportation_requests'::regclass and polname = 'transportation_requests_insert_org_operations';
  if v_leftover is null then
    raise notice 'REQ-PRIV superseded-insert-policy-dropped: PASS (transportation_requests_insert_org_operations no longer exists)';
  else
    raise notice 'REQ-PRIV superseded-insert-policy-dropped: FAIL (still present: %)', v_leftover;
  end if;
end $$;

do $$
declare v_update_cols text;
begin
  select string_agg(column_name, ',' order by column_name) into v_update_cols
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'transportation_requests' and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if v_update_cols = 'additional_notes,assistance_notes,destination_description,pickup_description,preferred_date,preferred_time,requester_email,requester_name,requester_phone,requester_relationship,return_trip_needed,source'
     and v_update_cols not like '%state%' and v_update_cols not like '%passenger_id%' then
    raise notice 'REQ-PRIV state-and-passenger-id-not-directly-updatable: PASS (UPDATE grant is exactly the safe descriptive set: %)', v_update_cols;
  else
    raise notice 'REQ-PRIV state-and-passenger-id-not-directly-updatable: FAIL (update_cols=%)', v_update_cols;
  end if;
end $$;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    update public.transportation_requests set state = 'accepted' where organization_id = '10000000-0000-0000-0000-0000000000a1' and false;
    -- WHERE false means zero rows are touched even if the grant existed --
    -- this test is purely about whether the privilege-layer check fires at
    -- parse/plan time for an UPDATE targeting a non-granted column, which
    -- Postgres does regardless of how many rows would actually match.
    raise notice 'REQ-PRIV raw-update-state-rejected: FAIL (expected insufficient_privilege, statement was accepted)';
  exception when insufficient_privilege then
    raise notice 'REQ-PRIV raw-update-state-rejected: PASS (DENY at the privilege layer)';
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    update public.transportation_requests set passenger_id = '92100000-0000-0000-0000-0000000000a1' where organization_id = '10000000-0000-0000-0000-0000000000a1' and false;
    raise notice 'REQ-PRIV raw-update-passenger-id-rejected: FAIL (expected insufficient_privilege, statement was accepted)';
  exception when insufficient_privilege then
    raise notice 'REQ-PRIV raw-update-passenger-id-rejected: PASS (DENY at the privilege layer)';
  end;
end $$;
reset role;

-- =============================================================================
-- request_events: no client write of any kind, SELECT scoped correctly
-- =============================================================================

do $$
begin
  if has_table_privilege('authenticated', 'public.request_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.request_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.request_events', 'DELETE') then
    raise notice 'REQ-PRIV request-events-no-client-write: FAIL (authenticated holds INSERT/UPDATE/DELETE on request_events)';
  else
    raise notice 'REQ-PRIV request-events-no-client-write: PASS (authenticated has SELECT only)';
  end if;
end $$;

do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    insert into public.request_events (organization_id, request_id, event_type, actor_user_id)
    values ('10000000-0000-0000-0000-0000000000a1', '92100000-0000-0000-0000-0000000000a1', 'request_logged', auth.uid());
    raise notice 'REQ-PRIV raw-request-events-insert-rejected: FAIL (expected insufficient_privilege, insert succeeded)';
  exception when insufficient_privilege then
    raise notice 'REQ-PRIV raw-request-events-insert-rejected: PASS (DENY at the privilege layer)';
  end;
end $$;
reset role;

do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3'; -- Driver, Org A
  select count(*) into v_count from public.request_events where organization_id = '10000000-0000-0000-0000-0000000000a1';
  reset role;
  if v_count = 0 then
    raise notice 'REQ-PRIV driver-select-request-events-rejected: PASS (RLS hides all rows from Driver)';
  else
    raise notice 'REQ-PRIV driver-select-request-events-rejected: FAIL (Driver saw % row(s))', v_count;
  end if;
end $$;
reset role;

do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a2'; -- Dispatcher, Org A
  select count(*) into v_count from public.request_events where organization_id = '10000000-0000-0000-0000-0000000000a1';
  reset role;
  if v_count > 0 then
    raise notice 'REQ-PRIV dispatcher-select-own-org-request-events-allowed: PASS (Dispatcher saw % own-org row(s))', v_count;
  else
    raise notice 'REQ-PRIV dispatcher-select-own-org-request-events-allowed: FAIL (Dispatcher saw zero rows, expected at least one from request_mutation_tests.sql fixtures)';
  end if;
end $$;
reset role;

do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin
  select count(*) into v_count from public.request_events where organization_id = '10000000-0000-0000-0000-0000000000b1'; -- Org B rows
  reset role;
  if v_count = 0 then
    raise notice 'REQ-PRIV cross-org-request-events-hidden: PASS (Org A admin sees zero Org B rows)';
  else
    raise notice 'REQ-PRIV cross-org-request-events-hidden: FAIL (Org A admin saw % Org B row(s))', v_count;
  end if;
end $$;
reset role;

do $$ begin raise notice '=== request_mutation_privilege_tests.sql complete — review PASS/FAIL lines above ==='; end $$;
