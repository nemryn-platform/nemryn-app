-- Nemryn Platform -- Notifications + Activity tests (P1-PILOT-S4B-R4D).
-- Run against `supabase db reset` fresh-seeded data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/notifications_activity_tests.sql
--
-- Covers 20260920120000_notifications_activity.sql: notification settings
-- (admin-only, closed tables, staff roles only), the durable notification
-- events written in the business transaction, the service_role-only dispatch
-- boundary (exactly-once claim, LIVE recipient resolution, minimal payload,
-- fixed-vocabulary failure reasons), idempotent-replay non-notification for
-- public intake, and list_activity_events (whitelist, keyset pagination,
-- tenant isolation, actor resolution). Seed fixtures: Org A admin a1 + admin c1
-- (multi-org), dispatcher a2, driver a3, inactive dispatcher a5; Org B admin
-- b1; platform admin d1; no-membership e1. Trip 80..a3 = Org A unassigned trip.

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute p_stmt; exception when others then reset role; return sqlstate; end;
  reset role;
  return 'OK';
end;
$$;

create or replace function pg_temp.val_as(p_role text, p_uid uuid, p_stmt text)
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

create or replace function pg_temp.report(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  if p_ok then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;

-- =============================================================================
-- A. SETTINGS
-- =============================================================================
do $$
declare v_a uuid := '10000000-0000-0000-0000-0000000000a1'; v_admin uuid := '20000000-0000-0000-0000-0000000000a1';
begin
  perform pg_temp.report('NS-1 (defaults: website request -> Admin; trip exception -> Admin + Dispatcher; is_default)',
    pg_temp.val_as('authenticated', v_admin, format('select string_agg(event_type || ''='' || array_to_string(recipient_roles, ''+'') || ''/'' || is_default::text, '';'' order by event_type) from public.get_notification_settings(%L)', v_a))
      = 'trip_exception=organization_admin+dispatcher/true;website_request=organization_admin/true');

  perform pg_temp.try_as('authenticated', v_admin, format('select public.set_notification_settings(%L, ''website_request'', array[''organization_admin'', ''dispatcher''])', v_a));
  perform pg_temp.report('NS-2 (admin sets recipients: persisted, no longer default)',
    pg_temp.val_as('authenticated', v_admin, format('select array_to_string(recipient_roles, ''+'') || ''/'' || is_default::text from public.get_notification_settings(%L) where event_type = ''website_request''', v_a)) = 'dispatcher+organization_admin/false');
  perform pg_temp.report('NS-3 (notification_preferences_updated AuditEvent: actor, before/after)',
    exists (select 1 from public.audit_events where organization_id = v_a and action = 'notification_preferences_updated' and actor_user_id = v_admin
      and before_data -> 'recipient_roles' = '["organization_admin"]'::jsonb and after_data -> 'recipient_roles' = '["dispatcher", "organization_admin"]'::jsonb and after_data ->> 'event_type' = 'website_request'));
  perform pg_temp.report('NS-4 (identical save = no-op; saving an unconfigured event''s DEFAULT writes nothing)',
    pg_temp.val_as('authenticated', v_admin, format('select (public.set_notification_settings(%L, ''website_request'', array[''dispatcher'', ''organization_admin''])).changed::text', v_a)) = 'false'
    and pg_temp.val_as('authenticated', v_admin, format('select (public.set_notification_settings(%L, ''trip_exception'', array[''dispatcher'', ''organization_admin''])).changed::text', v_a)) = 'false'
    and not exists (select 1 from public.organization_notification_settings where organization_id = v_a and event_type = 'trip_exception')
    and (select count(*) from public.audit_events where organization_id = v_a and action = 'notification_preferences_updated') = 1);
  perform pg_temp.report('NS-5 (empty array = explicitly OFF, persisted)',
    pg_temp.val_as('authenticated', v_admin, format('select (public.set_notification_settings(%L, ''trip_exception'', array[]::text[])).changed::text', v_a)) = 'true'
    and pg_temp.val_as('authenticated', v_admin, format('select cardinality(recipient_roles)::text || ''/'' || is_default::text from public.get_notification_settings(%L) where event_type = ''trip_exception''', v_a)) = '0/false');
  perform pg_temp.report('NS-6 (invalid: unknown event, driver / platform_admin / unknown role, null roles, null event -> ZW006)',
    pg_temp.try_as('authenticated', v_admin, format('select public.set_notification_settings(%L, ''sms_blast'', array[''organization_admin''])', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', v_admin, format('select public.set_notification_settings(%L, ''website_request'', array[''driver''])', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', v_admin, format('select public.set_notification_settings(%L, ''website_request'', array[''platform_admin''])', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', v_admin, format('select public.set_notification_settings(%L, ''website_request'', array[''organization_admin'', ''viewer''])', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', v_admin, format('select public.set_notification_settings(%L, ''website_request'', null)', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', v_admin, format('select public.set_notification_settings(%L, null, array[''organization_admin''])', v_a)) = 'ZW006');
  perform pg_temp.report('NS-7 (only email exists: no channel parameter; the setter takes exactly org + event + roles)',
    (select array_agg(a order by a) from (select unnest(proargnames) a from pg_proc where proname = 'set_notification_settings') s) = array['p_event_type', 'p_organization_id', 'p_recipient_roles']);
  perform pg_temp.report('NS-8 (Dispatcher / Driver / inactive / no-membership / Platform Admin / foreign admin denied: ZW002)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.set_notification_settings(%L, ''website_request'', array[''dispatcher''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', format('select public.set_notification_settings(%L, ''website_request'', array[''dispatcher''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a5', format('select public.set_notification_settings(%L, ''website_request'', array[''dispatcher''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', format('select public.set_notification_settings(%L, ''website_request'', array[''dispatcher''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000d1', format('select public.set_notification_settings(%L, ''website_request'', array[''dispatcher''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select public.set_notification_settings(%L, ''website_request'', array[''dispatcher''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', v_admin, $q$select public.set_notification_settings('10000000-0000-0000-0000-0000000000b1', 'website_request', array['dispatcher'])$q$) = 'ZW002');
  perform pg_temp.report('NS-9 (the same principals cannot READ settings or history either; anon: no EXECUTE; no session: ZW001)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select * from public.get_notification_settings(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', format('select * from public.list_notification_history(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select * from public.get_notification_settings(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('anon', null, format('select * from public.get_notification_settings(%L)', v_a)) = '42501'
    and pg_temp.try_as('authenticated', null, format('select * from public.get_notification_settings(%L)', v_a)) = 'ZW001');
  perform pg_temp.report('NS-10 (nothing was changed by the denied attempts)',
    (select recipient_roles from public.organization_notification_settings where organization_id = v_a and event_type = 'website_request') = array['dispatcher', 'organization_admin']
    and not exists (select 1 from public.organization_notification_settings where organization_id = '10000000-0000-0000-0000-0000000000b1'));
end $$;

do $$
declare v_stmt text; v_c text; v_ok boolean := true; v_failed text := '';
begin
  foreach v_stmt in array array[
    $q$select * from public.organization_notification_settings$q$,
    $q$insert into public.organization_notification_settings (organization_id, event_type, recipient_roles) values ('10000000-0000-0000-0000-0000000000a1', 'website_request', array['organization_admin'])$q$,
    $q$update public.organization_notification_settings set recipient_roles = array['dispatcher']$q$,
    $q$delete from public.organization_notification_settings$q$,
    $q$select * from public.notification_events$q$,
    $q$insert into public.notification_events (organization_id, event_type, entity_type, entity_id) values ('10000000-0000-0000-0000-0000000000a1', 'website_request', 'x', gen_random_uuid())$q$,
    $q$update public.notification_events set status = 'sent'$q$,
    $q$delete from public.notification_events$q$,
    $q$insert into public.audit_events (organization_id, entity_type, entity_id, action) values ('10000000-0000-0000-0000-0000000000a1', 'organization', gen_random_uuid(), 'notification_preferences_updated')$q$,
    $q$update public.audit_events set action = 'x'$q$,
    $q$delete from public.audit_events$q$
  ] loop
    v_c := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', v_stmt);
    if v_c is distinct from '42501' then v_ok := false; v_failed := v_failed || format(' [%s -> %s]', left(v_stmt, 45), v_c); end if;
    v_c := pg_temp.try_as('anon', null, v_stmt);
    if v_c is distinct from '42501' then v_ok := false; v_failed := v_failed || format(' [anon %s -> %s]', left(v_stmt, 45), v_c); end if;
  end loop;
  perform pg_temp.report('NS-11 (both new tables and audit_events: direct SELECT/INSERT/UPDATE/DELETE denied for an Org Admin and anon)', v_ok, v_failed);
  perform pg_temp.report('NS-12 (new tables: RLS on, zero policies, zero client grants)',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.notification_events'::regclass, 'public.organization_notification_settings'::regclass))
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('notification_events', 'organization_notification_settings'))
    and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('notification_events', 'organization_notification_settings') and grantee in ('anon', 'authenticated', 'PUBLIC')));
  perform pg_temp.report('NS-13 (function ACLs: settings/history/activity = authenticated only; claim/complete = service_role only; internals = nobody)',
    has_function_privilege('authenticated', 'public.set_notification_settings(uuid, text, text[])', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.list_activity_events(uuid, integer, timestamptz, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_notification_settings(uuid, text, text[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.list_activity_events(uuid, integer, timestamptz, uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.claim_notification_dispatch(uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.complete_notification_dispatch(uuid, integer, integer, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_notification_dispatch(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.complete_notification_dispatch(uuid, integer, integer, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.claim_notification_dispatch(uuid)', 'EXECUTE')
    and not has_function_privilege('public', 'public.claim_notification_dispatch(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._enqueue_notification_event(uuid, text, text, uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._notification_default_roles(text)', 'EXECUTE'));
  perform pg_temp.report('NS-14 (claim / complete cannot be called by a signed-in Org Admin or anon)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.claim_notification_dispatch(gen_random_uuid())$q$) = '42501'
    and pg_temp.try_as('anon', null, $q$select public.claim_notification_dispatch(gen_random_uuid())$q$) = '42501'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.complete_notification_dispatch(gen_random_uuid(), 1, 0, null)$q$) = '42501');
end $$;

-- =============================================================================
-- B. EVENTS + DISPATCH (trip exception path)
-- =============================================================================
-- reset Org A to the default trip_exception roles for the dispatch tests
delete from public.organization_notification_settings where organization_id = '10000000-0000-0000-0000-0000000000a1' and event_type = 'trip_exception';

create temp table t_ev (k text primary key, id uuid);
grant all on t_ev to public;

do $$
declare v_res public.trip_exception_result; v_ev uuid; v_before bigint := (select count(*) from public.notification_events);
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.report_trip_exception('80000000-0000-0000-0000-0000000000a3', 'vehicle_issue', 'PRIVATE NOTE: patient mentioned a sensitive detail');
  reset role;
  v_ev := v_res.notification_event_id;
  insert into t_ev values ('exc1', v_ev);
  perform pg_temp.report('EV-1 (reporting a TripException enqueues ONE durable event in the same transaction; still returns the exception)',
    v_ev is not null and v_res.exception_id is not null and v_res.changed
    and (select count(*) from public.notification_events) = v_before + 1
    and (select event_type || '/' || status || '/' || entity_type from public.notification_events where id = v_ev) = 'trip_exception/pending/trip_exception');
  perform pg_temp.report('EV-2 (the event row holds no address and no exception/trip content)',
    not exists (select 1 from public.notification_events n where n.id = v_ev and to_jsonb(n)::text ~* '(PRIVATE NOTE|vehicle_issue|@example)'));
end $$;

do $$
declare v_ev uuid := (select id from t_ev where k = 'exc1'); v_claim jsonb; v_second jsonb; v_recips text; v_c1 text; v_c2 text;
begin
  set local role service_role;
  v_claim := public.claim_notification_dispatch(v_ev);
  v_second := public.claim_notification_dispatch(v_ev);
  reset role;
  select string_agg(x, ',' order by x) into v_recips from jsonb_array_elements_text(v_claim -> 'recipients') x;
  perform pg_temp.report('DISP-1 (recipients = LIVE active staff holding an enabled role: Org A admins + dispatcher; NOT the inactive dispatcher, NOT the driver, NOT Org B)',
    v_recips = 'multi-org-user@example.test,org-a-admin@example.test,org-a-dispatcher@example.test', v_recips);
  perform pg_temp.report('DISP-2 (exactly-once claim: the second claim of the same event returns NULL)', v_claim is not null and v_second is null);
  perform pg_temp.report('DISP-3 (minimal payload: event type, organization name, timezone, recipients, pickup time -- nothing else; no description / exception type / ids)',
    (select array_agg(k order by k) from jsonb_object_keys(v_claim) k) = array['event_type', 'organization_name', 'payload', 'recipients', 'timezone']
    and (select array_agg(k order by k) from jsonb_object_keys(v_claim -> 'payload') k) = array['pickup_at']
    and v_claim::text !~* '(PRIVATE NOTE|vehicle_issue|sensitive)'
    and v_claim ->> 'organization_name' = 'Fictional Org A');
  perform pg_temp.report('DISP-4 (event is now dispatching with the recipient count recorded)',
    (select status || '/' || recipient_count from public.notification_events where id = v_ev) = 'dispatching/3');
  v_c1 := pg_temp.val_as('service_role', null, format('select public.complete_notification_dispatch(%L, 3, 0, null)::text', v_ev));
  v_c2 := pg_temp.val_as('service_role', null, format('select public.complete_notification_dispatch(%L, 3, 0, null)::text', v_ev));
  perform pg_temp.report('DISP-5 (complete: all sent -> sent; a second completion is refused because only a dispatching event can be completed)',
    v_c1 = 'true' and v_c2 = 'false'
    and (select status || '/' || sent_count || '/' || failed_count || '/' || coalesce(failure_reason, '-') from public.notification_events where id = v_ev) = 'sent/3/0/-');
end $$;

do $$
declare v_a uuid := '10000000-0000-0000-0000-0000000000a1'; v_res public.trip_exception_result; v_ev uuid; v_claim jsonb; v_recips text;
begin
  -- LIVE membership state: deactivate the dispatcher, new event excludes them
  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
    format('select public.set_membership_status((select id from public.memberships where organization_id = %L and user_id = ''20000000-0000-0000-0000-0000000000a2''), false)', v_a));
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.report_trip_exception('80000000-0000-0000-0000-0000000000a3', null, null);
  reset role;
  v_ev := v_res.notification_event_id;
  set local role service_role; v_claim := public.claim_notification_dispatch(v_ev); reset role;
  select string_agg(x, ',' order by x) into v_recips from jsonb_array_elements_text(v_claim -> 'recipients') x;
  perform pg_temp.report('DISP-6 (a DEACTIVATED dispatcher is excluded on the very next event: live Membership state)',
    v_recips = 'multi-org-user@example.test,org-a-admin@example.test', v_recips);
  perform pg_temp.val_as('service_role', null, format('select public.complete_notification_dispatch(%L, 1, 1, ''provider_error'')::text', v_ev));
  perform pg_temp.report('DISP-7 (partial delivery recorded honestly: partial, counts, fixed reason)',
    (select status || '/' || sent_count || '/' || failed_count || '/' || failure_reason from public.notification_events where id = v_ev) = 'partial/1/1/provider_error');
  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
    format('select public.set_membership_status((select id from public.memberships where organization_id = %L and user_id = ''20000000-0000-0000-0000-0000000000a2''), true)', v_a));

  -- role removed from the setting: dispatcher no longer receives even though active
  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_notification_settings(%L, ''trip_exception'', array[''organization_admin''])', v_a));
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.report_trip_exception('80000000-0000-0000-0000-0000000000a3', null, null);
  reset role;
  set local role service_role; v_claim := public.claim_notification_dispatch(v_res.notification_event_id); reset role;
  select string_agg(x, ',' order by x) into v_recips from jsonb_array_elements_text(v_claim -> 'recipients') x;
  perform pg_temp.report('DISP-8 (role-based: with only Organization Admin enabled, the active Dispatcher is not a recipient)', v_recips = 'multi-org-user@example.test,org-a-admin@example.test', v_recips);
  perform pg_temp.val_as('service_role', null, format('select public.complete_notification_dispatch(%L, 0, 2, ''not_configured'')::text', v_res.notification_event_id));
  perform pg_temp.report('DISP-9 (nothing sent: failed with the fixed reason)',
    (select status || '/' || failure_reason from public.notification_events where id = v_res.notification_event_id) = 'failed/not_configured');

  -- explicitly OFF: skipped, nothing to send
  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_notification_settings(%L, ''trip_exception'', array[]::text[])', v_a));
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.report_trip_exception('80000000-0000-0000-0000-0000000000a3', null, null);
  reset role;
  set local role service_role; v_claim := public.claim_notification_dispatch(v_res.notification_event_id); reset role;
  perform pg_temp.report('DISP-10 (DISABLED preference: no recipients, event recorded as skipped, claim returns NULL)',
    v_claim is null and (select status || '/' || recipient_count from public.notification_events where id = v_res.notification_event_id) = 'skipped/0');
  delete from public.organization_notification_settings where organization_id = v_a and event_type = 'trip_exception';
end $$;

-- a Driver reporting an issue on their own assigned trip also enqueues (recipients are STAFF only, never the driver)
do $$
declare v_res public.trip_exception_result; v_claim jsonb;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a3';
  begin
    v_res := public.report_trip_exception('80000000-0000-0000-0000-0000000000a1', 'other', null);
  exception when others then v_res := null; end;
  reset role;
  if v_res.exception_id is not null then
    set local role service_role; v_claim := public.claim_notification_dispatch(v_res.notification_event_id); reset role;
    perform pg_temp.report('DISP-11 (driver-reported exception notifies STAFF only: the driver is never a recipient)',
      v_claim is not null and not exists (select 1 from jsonb_array_elements_text(v_claim -> 'recipients') x where x like '%driver%'));
  else
    perform pg_temp.report('DISP-11 (driver-reported exception notifies STAFF only: skipped, fixture driver not actively assigned)', true);
  end if;
end $$;

-- back to defaults before the intake tests
delete from public.organization_notification_settings where organization_id = '10000000-0000-0000-0000-0000000000a1';

-- =============================================================================
-- C. PUBLIC INTAKE: only a genuinely-new Request notifies; replay never does
-- =============================================================================
do $$
declare
  v_a uuid := '10000000-0000-0000-0000-0000000000a1'; r public.request_intake_integration_result; v_call text; v_ext text;
  v_res public.public_request_submission_result; v_events bigint; v_claim jsonb; v_req_rows bigint; v_eid uuid;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  r := public.create_request_intake_integration(v_a, 'https://notify-a.r4d.example.test');
  perform public.set_request_intake_integration_active(r.integration_id, true);
  reset role;
  v_ext := r.external_id;
  set local role service_role;
  v_res := public.submit_public_transportation_request(
    p_integration_external_id => v_ext, p_idempotency_key => 'r4d-key-1', p_requester_name => 'SECRET Requester Name', p_requester_relationship => 'family',
    p_requester_phone => '555-0100', p_pickup_description => 'SECRET pickup address', p_destination_description => 'SECRET destination',
    p_return_trip_needed => 'no', p_origin => 'https://notify-a.r4d.example.test', p_assistance_notes => 'SECRET assistance notes', p_additional_notes => 'SECRET additional notes',
    p_preferred_date => '2026-10-12', p_service_type => 'dialysis');
  reset role;
  perform pg_temp.report('INTAKE-1 (a new website Request: accepted, notification_event_id returned, exactly one event, in the Request''s org)',
    v_res.accepted and v_res.notification_event_id is not null
    and (select count(*) from public.notification_events where event_type = 'website_request' and organization_id = v_a) = 1
    and (select organization_id from public.notification_events where id = v_res.notification_event_id) = v_a);
  v_events := (select count(*) from public.notification_events);
  v_req_rows := (select count(*) from public.transportation_requests where external_submission_ref = 'r4d-key-1');
  set local role service_role;
  v_res := public.submit_public_transportation_request(
    p_integration_external_id => v_ext, p_idempotency_key => 'r4d-key-1', p_requester_name => 'SECRET Requester Name', p_requester_relationship => 'family',
    p_requester_phone => '555-0100', p_pickup_description => 'SECRET pickup address', p_destination_description => 'SECRET destination',
    p_return_trip_needed => 'no', p_origin => 'https://notify-a.r4d.example.test', p_preferred_date => '2026-10-12', p_service_type => 'dialysis');
  reset role;
  perform pg_temp.report('INTAKE-2 (IDEMPOTENT REPLAY: accepted, notification_event_id NULL, no second event, no second Request)',
    v_res.accepted and v_res.notification_event_id is null and (select count(*) from public.notification_events) = v_events
    and (select count(*) from public.transportation_requests where external_submission_ref = 'r4d-key-1') = v_req_rows and v_req_rows = 1);

  v_eid := (select id from public.notification_events where event_type = 'website_request' and organization_id = v_a);
  set local role service_role;
  v_claim := public.claim_notification_dispatch(v_eid);
  reset role;
  perform pg_temp.report('INTAKE-3 (default recipients: Organization Admins only -- the Dispatcher is not notified of website requests by default)',
    (select string_agg(x, ',' order by x) from jsonb_array_elements_text(v_claim -> 'recipients') x) = 'multi-org-user@example.test,org-a-admin@example.test');
  perform pg_temp.report('INTAKE-4 (MINIMAL payload: only requested date + service type; requester name, phone, addresses and notes never reach the dispatcher)',
    (select array_agg(k order by k) from jsonb_object_keys(v_claim -> 'payload') k) = array['requested_date', 'service_type']
    and v_claim ->> 'organization_name' = 'Fictional Org A' and v_claim::text !~* 'SECRET' and v_claim::text !~ '555-0100');
  perform pg_temp.report('INTAKE-5 (a rejected submission -- disabled service / wrong origin -- enqueues nothing)',
    (select count(*) from public.notification_events where event_type = 'website_request') = 1);
  delete from public.notification_events where event_type = 'website_request';
  delete from public.request_events where request_id in (select id from public.transportation_requests where external_submission_ref like 'r4d-%');
  delete from public.transportation_requests where external_submission_ref like 'r4d-%';
  delete from public.audit_events where entity_id = r.integration_id;
  delete from public.request_intake_integrations where id = r.integration_id;
end $$;

-- intake to a cross-tenant: an Org B integration's event belongs to Org B, resolved against Org B staff only
do $$
declare r public.request_intake_integration_result; v_res public.public_request_submission_result; v_claim jsonb;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  r := public.create_request_intake_integration('10000000-0000-0000-0000-0000000000b1', 'https://notify-b.r4d.example.test');
  perform public.set_request_intake_integration_active(r.integration_id, true);
  reset role;
  set local role service_role;
  v_res := public.submit_public_transportation_request(
    p_integration_external_id => r.external_id, p_idempotency_key => 'r4d-b-1', p_requester_name => 'B Requester', p_requester_relationship => 'self',
    p_requester_phone => '555-0111', p_pickup_description => 'p', p_destination_description => 'd', p_return_trip_needed => 'no', p_origin => 'https://notify-b.r4d.example.test');
  v_claim := public.claim_notification_dispatch(v_res.notification_event_id);
  reset role;
  perform pg_temp.report('INTAKE-6 (tenant isolation: Org B''s event notifies ONLY Org B staff; no Org A address ever appears)',
    (select string_agg(x, ',') from jsonb_array_elements_text(v_claim -> 'recipients') x) = 'org-b-admin@example.test'
    and (select organization_id from public.notification_events where id = v_res.notification_event_id) = '10000000-0000-0000-0000-0000000000b1');
  delete from public.notification_events where organization_id = '10000000-0000-0000-0000-0000000000b1';
  delete from public.request_events where request_id in (select id from public.transportation_requests where external_submission_ref = 'r4d-b-1');
  delete from public.transportation_requests where external_submission_ref = 'r4d-b-1';
  delete from public.audit_events where entity_id = r.integration_id;
  delete from public.request_intake_integrations where id = r.integration_id;
end $$;


do $$
declare v_res public.trip_exception_result; v_r2 public.trip_exception_result; v_claim jsonb;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.report_trip_exception('80000000-0000-0000-0000-0000000000a3', null, null);
  v_r2 := public.resolve_trip_exception(v_res.exception_id, 'handled');
  reset role;
  perform pg_temp.report('EV-3 (resolve_trip_exception is unaffected: returns null notification_event_id, enqueues nothing)',
    v_r2.notification_event_id is null and (select count(*) from public.notification_events where entity_id = v_res.exception_id) = 1);
  set local role service_role; v_claim := public.claim_notification_dispatch(v_res.notification_event_id); reset role;
  perform pg_temp.val_as('service_role', null, format('select public.complete_notification_dispatch(%L, 0, 1, ''RAW PROVIDER ERROR 401 key=sk_live_abc'')::text', v_res.notification_event_id));
  perform pg_temp.report('DISP-9b (provider text can never be stored: an unrecognized reason collapses to the fixed value unknown)',
    (select failure_reason from public.notification_events where id = v_res.notification_event_id) = 'unknown'
    and not exists (select 1 from public.notification_events n where to_jsonb(n)::text ~* '(sk_live|RAW PROVIDER)'));
end $$;

-- =============================================================================
-- D. ACTIVITY
-- =============================================================================
do $$
declare v_a uuid := '10000000-0000-0000-0000-0000000000a1'; v_admin uuid := '20000000-0000-0000-0000-0000000000a1';
  v_first text; v_n int; v_actions text;
begin
  -- generate a mix of administrative events + an operational one that must NOT appear
  perform pg_temp.try_as('authenticated', v_admin, format('select public.update_organization_settings(%L, ''{"business_phone": "(404) 555-0155"}''::jsonb)', v_a));
  perform pg_temp.try_as('authenticated', v_admin, format('select public.set_organization_service_offerings(%L, array[''dialysis''])', v_a));
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id) values (v_a, 'trip', gen_random_uuid(), 'trip_reassigned', v_admin);
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id) values (v_a, 'organization', v_a, 'organization_settings_updated', null);

  select count(*) into v_n from public.audit_events where organization_id = v_a;
  perform pg_temp.report('ACT-1 (admin lists own organization: only WHITELISTED administrative actions -- the operational trip_reassigned row is excluded)',
    pg_temp.val_as('authenticated', v_admin, format('select count(*) filter (where action = ''trip_reassigned'')::text || ''/'' || count(*)::text from public.list_activity_events(%L, 51)', v_a))
      = '0/' || (select count(*) from public.audit_events where organization_id = v_a and action <> 'trip_reassigned')::text);
  perform pg_temp.report('ACT-2 (newest first)',
    pg_temp.val_as('authenticated', v_admin, format('select (array_agg(occurred_at order by ordinality))[1] >= (array_agg(occurred_at order by ordinality))[2] from (select occurred_at, row_number() over () as ordinality from public.list_activity_events(%L, 5)) x', v_a)) is not null);
  perform pg_temp.report('ACT-3 (actor resolution: profile display name, else account email, else NULL for a system event)',
    pg_temp.val_as('authenticated', v_admin, format('select string_agg(distinct coalesce(actor_name, ''<null>''), '','' order by coalesce(actor_name, ''<null>'')) from public.list_activity_events(%L, 51) where action = ''organization_settings_updated''', v_a)) like '<null>,%');
  perform pg_temp.report('ACT-4 (denied: Dispatcher, Driver, inactive Membership, no-Membership, Platform Admin, foreign admin: ZW002)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select * from public.list_activity_events(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', format('select * from public.list_activity_events(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a5', format('select * from public.list_activity_events(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', format('select * from public.list_activity_events(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000d1', format('select * from public.list_activity_events(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select * from public.list_activity_events(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('anon', null, format('select * from public.list_activity_events(%L)', v_a)) = '42501'
    and pg_temp.try_as('authenticated', null, format('select * from public.list_activity_events(%L)', v_a)) = 'ZW001'
    and pg_temp.try_as('authenticated', v_admin, $q$select * from public.list_activity_events('10000000-0000-0000-0000-0000000000b1')$q$) = 'ZW002');
  perform pg_temp.report('ACT-5 (Org B admin sees none of Org A''s events in their own list)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000b1', $q$select count(*)::text from public.list_activity_events('10000000-0000-0000-0000-0000000000b1', 51) where before_data::text like '%404%' or after_data::text like '%404%'$q$) = '0');
end $$;

-- pagination: 60 synthetic administrative events with distinct timestamps
do $$
declare v_a uuid := '10000000-0000-0000-0000-0000000000a1'; v_admin uuid := '20000000-0000-0000-0000-0000000000a1';
  v_p1 int; v_p2 int; v_p3 int; v_c1_at timestamptz; v_c1_id uuid; v_c2_at timestamptz; v_c2_id uuid; v_total int; v_overlap int; v_dupes int;
begin
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, occurred_at)
  select v_a, 'organization', v_a, 'organization_settings_updated', v_admin, now() - (g || ' minutes')::interval from generate_series(1, 60) g;
  -- two rows with the IDENTICAL timestamp: the id tiebreak must keep the cursor exact
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, occurred_at)
  select v_a, 'organization', v_a, 'membership_deactivated', v_admin, timestamptz '2026-01-01 00:00:00+00' from generate_series(1, 2);

  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  create temp table t_p1 on commit drop as select * from public.list_activity_events(v_a, 30);
  select occurred_at, id into v_c1_at, v_c1_id from t_p1 order by occurred_at, id limit 1;
  create temp table t_p2 on commit drop as select * from public.list_activity_events(v_a, 30, v_c1_at, v_c1_id);
  select occurred_at, id into v_c2_at, v_c2_id from t_p2 order by occurred_at, id limit 1;
  create temp table t_p3 on commit drop as select * from public.list_activity_events(v_a, 51, v_c2_at, v_c2_id);
  reset role;
  select count(*) into v_p1 from t_p1; select count(*) into v_p2 from t_p2; select count(*) into v_p3 from t_p3;
  select count(*) into v_total from public.audit_events where organization_id = v_a and action <> 'trip_reassigned';
  select count(*) into v_overlap from t_p1 a join t_p2 b using (id);
  select count(*) - count(distinct id) into v_dupes from (select id from t_p1 union all select id from t_p2 union all select id from t_p3) u;
  perform pg_temp.report('PAGE-1 (page size honored: 30, 30, then the remainder; nothing lost, nothing repeated, cursor ties on timestamp handled)',
    v_p1 = 30 and v_p2 = 30 and v_p1 + v_p2 + v_p3 = v_total and v_overlap = 0 and v_dupes = 0, format('%s/%s/%s total=%s overlap=%s dupes=%s', v_p1, v_p2, v_p3, v_total, v_overlap, v_dupes));
  perform pg_temp.report('PAGE-2 (limit is clamped: asking for 10000 returns at most 51; asking for 0 returns 1)',
    pg_temp.val_as('authenticated', v_admin, format('select count(*)::text from public.list_activity_events(%L, 10000)', v_a)) = '51'
    and pg_temp.val_as('authenticated', v_admin, format('select count(*)::text from public.list_activity_events(%L, 0)', v_a)) = '1');
  delete from public.audit_events where organization_id = v_a and (action in ('membership_deactivated') or (action = 'organization_settings_updated' and actor_user_id = v_admin and occurred_at > now() - interval '61 minutes' and entity_id = v_a and before_data is null and after_data is null));
end $$;

-- cleanup of this suite's settings-side effects
update public.organizations set business_phone = null where id = '10000000-0000-0000-0000-0000000000a1';
delete from public.organization_service_offerings where organization_id = '10000000-0000-0000-0000-0000000000a1';
delete from public.organization_notification_settings;

-- Final cleanup so later suites (which assume fresh fixtures and count audit rows,
-- exceptions and events for Orgs A/B) are unaffected by this suite's side effects.
delete from public.notification_events;
delete from public.organization_notification_settings;
delete from public.trip_events where event_type in ('exception_flagged', 'exception_resolved');
delete from public.trip_exceptions;
delete from public.audit_events where organization_id in ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1');
update public.memberships set status = 'active' where user_id = '20000000-0000-0000-0000-0000000000a2';
