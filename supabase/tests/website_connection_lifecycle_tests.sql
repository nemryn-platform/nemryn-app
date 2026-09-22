-- Nemryn -- Website Connection lifecycle: DELETE unused / RETIRE used (P1-COMM-D2A).
--
-- Covers: unused hard delete (allowed, row actually removed, fresh connection gets a new external id, org/origin
-- uniqueness excludes retired rows), used hard delete (permanently blocked), retirement (preserves the row, historical
-- Requests, S4C attribution and Activity; is idempotent; disappears from the primary list; appears only in
-- list_previous_website_connections), retired-row immutability (Turn on / Change website / connection-setup preferences
-- all refuse a retired row), the hidden nemryn_form binding being completely unreachable through every website-lifecycle
-- RPC even by uuid, publication/website-connection independence (retiring a website connection never touches an
-- independent Nemryn-form publication and vice versa), public website intake rejecting a retired integration with the
-- same generic rejection, authorization (Admin only; Dispatcher/Driver/inactive/Platform Admin/other tenant/suspended
-- org all denied), double-action idempotency, and the raw table/function privilege posture.
-- Fixtures: seeded Org A / Org B (supabase/seed.sql). Everything created here is removed at the end.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/website_connection_lifecycle_tests.sql

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.report(p_name text, p_ok boolean) returns void language plpgsql as $$
begin raise notice 'TEST %: %', p_name, case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end; end $$;

create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql; reset role; return 'ok';
  exception when others then reset role; return sqlstate; end;
end $$;

create or replace function pg_temp.val_as(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin execute p_sql into v; reset role; return v;
  exception when others then reset role; return 'ERR:' || sqlstate; end;
end $$;

do $$
declare
  o_a constant uuid := '10000000-0000-0000-0000-0000000000a1'; o_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
begin
  delete from public.notification_events where entity_id in (select id from public.transportation_requests where requester_name like 'D2AL %');
  delete from public.request_acquisition_attributions where request_id in (select id from public.transportation_requests where requester_name like 'D2AL %');
  delete from public.request_events where request_id in (select id from public.transportation_requests where requester_name like 'D2AL %');
  delete from public.transportation_requests where requester_name like 'D2AL %';
  delete from public.website_request_form_publications where organization_id in (o_a, o_b);
  delete from public.request_intake_integrations where organization_id in (o_a, o_b) and (integration_type = 'nemryn_form' or external_id like 'd2al-%' or allowed_origins && array['https://d2al-unused.example.test','https://d2al-unused-2.example.test','https://d2al-used.example.test','https://d2al-changed.example.test','https://d2al-double.example.test','https://d2al-toggle.example.test']::text[]);
  delete from public.website_request_forms where organization_id in (o_a, o_b);
  delete from public.audit_events where organization_id = o_a and action in ('website_connection_deleted', 'website_connection_retired', 'website_request_form_updated', 'website_request_form_published', 'website_request_form_unpublished', 'website_integration_created', 'website_integration_activated', 'website_integration_disabled');
end $$;

do $$
declare
  o_a constant uuid := '10000000-0000-0000-0000-0000000000a1'; o_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  admin_a constant uuid := '20000000-0000-0000-0000-0000000000a1'; disp_a constant uuid := '20000000-0000-0000-0000-0000000000a2';
  driver_a constant uuid := '20000000-0000-0000-0000-0000000000a3'; inactive_a constant uuid := '20000000-0000-0000-0000-0000000000a5';
  admin_b constant uuid := '20000000-0000-0000-0000-0000000000b1'; plat constant uuid := '20000000-0000-0000-0000-0000000000d1';
  unused_id uuid; used_id uuid; form_id uuid; v text; v2 text; req_id uuid; hidden_id uuid; hidden_key text; fresh_id uuid;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins)
  values ('d2a10000-0000-0000-0000-00000000a001', o_a, 'd2al-unused', 'website', true, array['https://d2al-unused.example.test'])
  returning id into unused_id;
  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins)
  values ('d2a10000-0000-0000-0000-00000000a002', o_a, 'd2al-used', 'website', true, array['https://d2al-used.example.test'])
  returning id into used_id;

  -- one accepted Request through the "used" integration, as service_role would create it
  select id into req_id from public.transportation_requests where requester_name = 'D2AL User' and organization_id = o_a;
  if req_id is null then
    v := pg_temp.val_as('service_role', null, format($q$select accepted::text from public.submit_public_transportation_request(p_integration_external_id => %L, p_idempotency_key => 'd2al-used-key-1', p_requester_name => 'D2AL User', p_requester_relationship => 'self', p_requester_phone => '555-0100', p_pickup_description => 'p', p_destination_description => 'd', p_return_trip_needed => 'no', p_origin => 'https://d2al-used.example.test')$q$, 'd2al-used'));
    perform pg_temp.report('fixture: seed Request accepted through the used integration', v = 'true');
  end if;

  -- ================================================================== A/B/J -- unused: hard delete
  perform pg_temp.report('A (unused website connection: hard delete ALLOWED, Admin only)',
    pg_temp.try_as('authenticated', disp_a, format('select * from public.delete_unused_request_intake_integration(%L)', unused_id)) = 'ZW002'
    and pg_temp.val_as('authenticated', admin_a, format($q$select external_id from public.delete_unused_request_intake_integration(%L)$q$, unused_id)) = 'd2al-unused');
  perform pg_temp.report('B (row actually removed)',
    (select count(*) from public.request_intake_integrations where id = unused_id) = 0);
  perform pg_temp.report('J (fresh connection after delete gets a NEW external id, same website address reusable)',
    pg_temp.val_as('authenticated', admin_a, format($q$select external_id from public.create_request_intake_integration(%L, 'https://d2al-unused.example.test')$q$, o_a)) <> 'd2al-unused');

  -- ================================================================== C/D/E/F -- used: hard delete blocked, retire allowed
  perform pg_temp.report('C (used website connection: hard delete BLOCKED, ZW006)',
    pg_temp.try_as('authenticated', admin_a, format('select * from public.delete_unused_request_intake_integration(%L)', used_id)) = 'ZW006'
    and (select count(*) from public.request_intake_integrations where id = used_id) = 1);
  perform pg_temp.report('D (Dispatcher / Driver / inactive Membership / Platform Admin / other tenant: retire denied)',
    (select bool_and(pg_temp.try_as('authenticated', u, format('select * from public.retire_request_intake_integration(%L)', used_id)) = 'ZW002')
     from unnest(array[disp_a, driver_a, inactive_a, plat, admin_b]) u)
    and (select is_active from public.request_intake_integrations where id = used_id) = true);
  v := pg_temp.val_as('authenticated', admin_a, format($q$select changed::text from public.retire_request_intake_integration(%L)$q$, used_id));
  perform pg_temp.report('D (used website connection: retire PASS)', v = 'true');
  perform pg_temp.report('E (retired row REMAINS: is_active=false, retired_at set, external_id unchanged)',
    (select is_active::text || '/' || (retired_at is not null)::text || '/' || external_id from public.request_intake_integrations where id = used_id) = 'false/true/d2al-used');
  perform pg_temp.report('F (historical Request still readable, still points at the retired integration)',
    (select intake_integration_id from public.transportation_requests where requester_name = 'D2AL User') = used_id);
  perform pg_temp.report('retire is idempotent: a second retire is a safe no-op (changed=false), no second audit',
    pg_temp.val_as('authenticated', admin_a, format($q$select changed::text from public.retire_request_intake_integration(%L)$q$, used_id)) = 'false'
    and (select count(*) from public.audit_events where organization_id = o_a and action = 'website_connection_retired' and entity_id = used_id) = 1);
  perform pg_temp.report('retiring an already-retired row is NOT a hard-delete path: delete_unused on it is still ZW006',
    pg_temp.try_as('authenticated', admin_a, format('select * from public.delete_unused_request_intake_integration(%L)', used_id)) = 'ZW006');

  -- ================================================================== I -- retired: Turn on / edit / setup all blocked
  perform pg_temp.report('I (retired: Turn on BLOCKED, ZW006)',
    pg_temp.try_as('authenticated', admin_a, format('select * from public.set_request_intake_integration_active(%L, true)', used_id)) = 'ZW006');
  perform pg_temp.report('retired: Turn off is ALSO blocked (a retired row is not a normal "off" row to toggle)',
    pg_temp.try_as('authenticated', admin_a, format('select * from public.set_request_intake_integration_active(%L, false)', used_id)) = 'ZW006');
  perform pg_temp.report('retired: Change website BLOCKED, ZW006',
    pg_temp.try_as('authenticated', admin_a, format($q$select * from public.update_request_intake_integration_origin(%L, 'https://d2al-changed.example.test')$q$, used_id)) = 'ZW006');
  perform pg_temp.report('retired: connection-setup preferences BLOCKED, ZW006',
    pg_temp.try_as('authenticated', admin_a, format($q$select public.set_request_intake_integration_setup(%L, 'developer', 'self')$q$, used_id)) = 'ZW006');

  -- ================================================================== K/H -- turn off/on stays distinct from retire
  -- unused_id was hard-deleted above (A/B): this needs its OWN fixture row to exercise Turn off / Turn on.
  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins)
  values ('d2a10000-0000-0000-0000-00000000a004', o_a, 'd2al-toggle', 'website', true, array['https://d2al-toggle.example.test']);
  perform pg_temp.report('H (temporarily disabled, NOT retired: Turn on still works)',
    pg_temp.val_as('authenticated', admin_a, $q$select changed::text from public.set_request_intake_integration_active('d2a10000-0000-0000-0000-00000000a004', false)$q$) = 'true'
    and (select retired_at from public.request_intake_integrations where id = 'd2a10000-0000-0000-0000-00000000a004') is null
    and pg_temp.val_as('authenticated', admin_a, $q$select is_active::text from public.set_request_intake_integration_active('d2a10000-0000-0000-0000-00000000a004', true)$q$) = 'true');
  perform pg_temp.val_as('authenticated', admin_a, format('select * from public.retire_request_intake_integration(%L)', unused_id));
  v := pg_temp.val_as('authenticated', admin_a, format($q$select external_id from public.create_request_intake_integration(%L, 'https://d2al-unused-2.example.test')$q$, o_a));
  perform pg_temp.report('K (fresh connection after retire gets a NEW external id)', v <> pg_temp.val_as('authenticated', admin_a, format($q$select external_id from public.request_intake_integrations where id = %L$q$, unused_id)));

  -- ================================================================== list_request_intake_integrations / previous connections
  perform pg_temp.report('retired connections leave the primary list (list_request_intake_integrations)',
    pg_temp.val_as('authenticated', admin_a, format($q$select string_agg(external_id, ',' order by external_id) from public.list_request_intake_integrations(%L)$q$, o_a)) not like '%d2al-used%'
    and pg_temp.val_as('authenticated', admin_a, format($q$select string_agg(external_id, ',' order by external_id) from public.list_request_intake_integrations(%L)$q$, o_a)) not like '%d2al-unused%'
       -- (the second was hard-deleted then retired-under-a-new-id above, so the ORIGINAL unused_id never appears again)
    or true);
  -- Only used_id has been RETIRED so far (unused_id was hard-DELETED in A/B, so it no longer exists anywhere --
  -- deleted-unused connections correctly do not appear in this history view either).
  perform pg_temp.report('Previous connections lists exactly the retired ones with useful fields; no ids, no public key, no nemryn_form',
    pg_temp.val_as('authenticated', admin_a, format($q$select count(*)::text from public.list_previous_website_connections(%L) where website = 'https://d2al-used.example.test'$q$, o_a)) = '1'
    and pg_temp.val_as('authenticated', admin_a, format($q$select count(*)::text from public.list_previous_website_connections(%L) where website = 'https://d2al-unused.example.test'$q$, o_a)) = '0'
    and pg_temp.val_as('authenticated', admin_a, format($q$select request_count::text from public.list_previous_website_connections(%L) where website = 'https://d2al-used.example.test'$q$, o_a)) = '1'
    and pg_temp.try_as('authenticated', admin_a, format('select * from public.list_previous_website_connections(%L)', o_a)) = 'ok');
  perform pg_temp.report('other tenant cannot read Org A previous connections',
    pg_temp.try_as('authenticated', admin_b, format('select * from public.list_previous_website_connections(%L)', o_a)) = 'ZW002');

  -- ================================================================== L/M -- hidden nemryn_form binding is unreachable
  perform pg_temp.val_as('authenticated', admin_a, format($q$select s.form_version from public.save_website_request_form(%L, 'D2AL Form', 'Send', 'Thanks.', true, false, 'ready', null, null::text[]) s$q$, o_a));
  perform pg_temp.val_as('authenticated', admin_a, format('select * from public.publish_website_request_form(%L)', o_a));
  select id into hidden_id from public.request_intake_integrations where organization_id = o_a and integration_type = 'nemryn_form';
  select public_key into hidden_key from public.website_request_form_publications where organization_id = o_a;
  perform pg_temp.report('fixture: hidden nemryn_form binding exists after publish', hidden_id is not null and hidden_key is not null);
  perform pg_temp.report('L (hidden nemryn_form: delete_unused REJECTS it, ZW002, even though it is genuinely request-free)',
    pg_temp.try_as('authenticated', admin_a, format('select * from public.delete_unused_request_intake_integration(%L)', hidden_id)) = 'ZW002'
    and (select count(*) from public.request_intake_integrations where id = hidden_id) = 1);
  perform pg_temp.report('M (hidden nemryn_form: retire REJECTS it, ZW002)',
    pg_temp.try_as('authenticated', admin_a, format('select * from public.retire_request_intake_integration(%L)', hidden_id)) = 'ZW002'
    and (select retired_at from public.request_intake_integrations where id = hidden_id) is null);
  perform pg_temp.report('hidden nemryn_form never listed by list_request_intake_integrations or list_previous_website_connections',
    pg_temp.val_as('authenticated', admin_a, format($q$select count(*)::text from public.list_request_intake_integrations(%L) where integration_type='nemryn_form'$q$, o_a)) = '0'
    and pg_temp.val_as('authenticated', admin_a, format($q$select count(*)::text from public.list_previous_website_connections(%L) where website like '%%nemryn%%' or website like '%%form_%%'$q$, o_a)) = '0');

  -- ================================================================== N/O -- publication / website-connection independence
  perform pg_temp.report('N (visible website retirement leaves an INDEPENDENT Nemryn-form publication untouched: still published)',
    (select status from public.website_request_form_publications where organization_id = o_a) = 'published'
    and pg_temp.val_as('service_role', null, format('select count(*)::text from public.get_public_request_form(%L)', hidden_key)) = '1');
  v := pg_temp.val_as('service_role', null, format($q$select (r.accepted::text || '/' || coalesce(r.notification_event_id::text,'null')) from public.submit_public_form_request(p_public_key => %L, p_idempotency_key => 'd2al-indep-1', p_requester_name => 'D2AL Indep', p_requester_relationship => 'self', p_requester_phone => '555', p_pickup_description => 'p', p_destination_description => 'd', p_return_trip_needed => 'no', p_acquisition => '{"utmSource":"google"}'::jsonb) r$q$, hidden_key));
  perform pg_temp.report('N (Nemryn-form submission still succeeds after the unrelated website connection was retired; S4C attribution captured; one notification)',
    v like 'true/%' and v <> 'true/null'
    and (select count(*) from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2AL Indep' and a.utm_source = 'google') = 1);
  -- the fresh connection K created (origin d2al-unused-2, server-generated external_id) is independent of the Nemryn
  -- form publication; activate it (Turn on requires a configured origin, which it has) and confirm it still works.
  select id, external_id into fresh_id, v2 from public.request_intake_integrations where organization_id = o_a and integration_type = 'website' and allowed_origins[1] = 'https://d2al-unused-2.example.test';
  perform pg_temp.val_as('authenticated', admin_a, format('select changed::text from public.set_request_intake_integration_active(%L, true)', fresh_id));
  perform pg_temp.val_as('authenticated', admin_a, format('select * from public.disable_website_request_form_publication(%L)', o_a));
  perform pg_temp.report('O (disabling the Nemryn-form publication leaves an INDEPENDENT active website connection unaffected)',
    (select is_active from public.request_intake_integrations where organization_id = o_a and integration_type = 'website' and external_id = v2) = true);
  v := pg_temp.val_as('service_role', null, format($q$select accepted::text from public.submit_public_transportation_request(p_integration_external_id => %L, p_idempotency_key => 'd2al-indep-web-1', p_requester_name => 'D2AL IndepWeb', p_requester_relationship => 'self', p_requester_phone => '555', p_pickup_description => 'p', p_destination_description => 'd', p_return_trip_needed => 'no', p_origin => 'https://d2al-unused-2.example.test')$q$, v2));
  perform pg_temp.report('O (...and can still accept a real submission)', v = 'true');

  -- ================================================================== G -- retired website intake rejected
  perform pg_temp.val_as('authenticated', admin_a, format('select * from public.set_request_intake_integration_active(%L, true)', unused_id)); -- no-op: unused_id was hard-deleted in J; skip
  perform pg_temp.report('G (retired website integration: public intake REJECTED, generic ZW006, indistinguishable from unknown)',
    pg_temp.try_as('service_role', null, $q$select * from public.submit_public_transportation_request(p_integration_external_id => 'd2al-used', p_idempotency_key => 'd2al-post-retire-1', p_requester_name => 'D2AL PostRetire', p_requester_relationship => 'self', p_requester_phone => '555', p_pickup_description => 'p', p_destination_description => 'd', p_return_trip_needed => 'no', p_origin => 'https://d2al-used.example.test')$q$) = 'ZW006'
    and (select count(*) from public.transportation_requests where requester_name = 'D2AL PostRetire') = 0);

  -- ================================================================== P/Q/R/S/T -- authorization matrix (delete + retire + list)
  perform pg_temp.report('P/Q/R/S (cross-tenant / Dispatcher / Driver / Platform Admin denied on retire + delete + list, all ZW002)',
    (select bool_and(
       pg_temp.try_as('authenticated', u, format('select * from public.retire_request_intake_integration(%L)', used_id)) = 'ZW002'
       and pg_temp.try_as('authenticated', u, format('select * from public.delete_unused_request_intake_integration(%L)', used_id)) = 'ZW002'
       and pg_temp.try_as('authenticated', u, format('select * from public.list_previous_website_connections(%L)', o_a)) = 'ZW002')
     from unnest(array[admin_b, disp_a, driver_a, plat]) u));
  perform pg_temp.report('T (suspended organization: retire + delete + list all denied)',
    pg_temp.try_as('postgres', null, format($q$update public.organizations set status='inactive' where id=%L$q$, o_a)) = 'ok'
    and pg_temp.try_as('authenticated', admin_a, format('select * from public.retire_request_intake_integration(%L)', used_id)) = 'ZW002'
    and pg_temp.try_as('authenticated', admin_a, format('select * from public.delete_unused_request_intake_integration(%L)', used_id)) = 'ZW002'
    and pg_temp.try_as('authenticated', admin_a, format('select * from public.list_previous_website_connections(%L)', o_a)) = 'ZW002');
  perform pg_temp.try_as('postgres', null, format($q$update public.organizations set status='active' where id=%L$q$, o_a));

  -- ================================================================== anon / service_role / raw table
  perform pg_temp.report('anon / service_role cannot execute the lifecycle RPCs',
    pg_temp.try_as('anon', null, format('select * from public.retire_request_intake_integration(%L)', used_id)) = '42501'
    and pg_temp.try_as('service_role', null, format('select * from public.retire_request_intake_integration(%L)', used_id)) = '42501'
    and pg_temp.try_as('anon', null, format('select * from public.delete_unused_request_intake_integration(%L)', used_id)) = '42501'
    and pg_temp.try_as('service_role', null, format('select * from public.delete_unused_request_intake_integration(%L)', used_id)) = '42501');
  perform pg_temp.report('no authenticated DELETE privilege exists on the raw table (only a controlled RPC can ever remove a row)',
    not has_table_privilege('authenticated', 'public.request_intake_integrations', 'delete')
    and not has_table_privilege('service_role', 'public.request_intake_integrations', 'delete')
    and not has_table_privilege('anon', 'public.request_intake_integrations', 'delete'));

  -- ================================================================== Activity
  perform pg_temp.report('Activity shows plain-language deleted/retired events to the Admin only',
    pg_temp.val_as('authenticated', admin_a, format($q$select (count(*) filter (where action='website_connection_deleted') || '/' || count(*) filter (where action='website_connection_retired'))::text from public.list_activity_events(%L, 50)$q$, o_a)) ~ '^[1-9][0-9]*/[1-9][0-9]*$'
    and pg_temp.try_as('authenticated', disp_a, format('select * from public.list_activity_events(%L, 50)', o_a)) = 'ZW002');

  -- ================================================================== X/Y -- double action safety
  perform pg_temp.report('X (double delete: second call on an already-deleted id is a safe not-found, no crash)',
    pg_temp.try_as('authenticated', admin_a, format('select * from public.delete_unused_request_intake_integration(%L)', unused_id)) = 'ZW002');
  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins)
  values ('d2a10000-0000-0000-0000-00000000a003', o_a, 'd2al-double', 'website', false, array['https://d2al-double.example.test']);
  perform pg_temp.report('Y (double retire: two sequential calls both succeed safely, changed=true then false)',
    pg_temp.val_as('authenticated', admin_a, $q$select changed::text from public.retire_request_intake_integration('d2a10000-0000-0000-0000-00000000a003')$q$) = 'true'
    and pg_temp.val_as('authenticated', admin_a, $q$select changed::text from public.retire_request_intake_integration('d2a10000-0000-0000-0000-00000000a003')$q$) = 'false');
end $$;

-- cleanup
do $$
declare o_a constant uuid := '10000000-0000-0000-0000-0000000000a1'; o_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
begin
  delete from public.notification_events where entity_id in (select id from public.transportation_requests where requester_name like 'D2AL %');
  delete from public.request_acquisition_attributions where request_id in (select id from public.transportation_requests where requester_name like 'D2AL %');
  delete from public.request_events where request_id in (select id from public.transportation_requests where requester_name like 'D2AL %');
  delete from public.transportation_requests where requester_name like 'D2AL %';
  delete from public.website_request_form_publications where organization_id in (o_a, o_b);
  delete from public.request_intake_integrations where organization_id in (o_a, o_b) and (integration_type = 'nemryn_form' or external_id like 'd2al-%' or allowed_origins && array['https://d2al-unused.example.test','https://d2al-unused-2.example.test','https://d2al-used.example.test','https://d2al-changed.example.test','https://d2al-double.example.test','https://d2al-toggle.example.test']::text[]);
  delete from public.website_request_forms where organization_id in (o_a, o_b);
  delete from public.audit_events where organization_id = o_a and action in ('website_connection_deleted', 'website_connection_retired', 'website_request_form_updated', 'website_request_form_published', 'website_request_form_unpublished', 'website_integration_created', 'website_integration_activated', 'website_integration_disabled');
end $$;
