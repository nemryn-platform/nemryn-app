-- Nemryn -- Website Request Form PUBLICATION + public form primitives (P1-COMM-D2).
--
-- Covers: form/publication separation, Draft can't publish, first publish creates the hidden 'nemryn_form' binding and an opaque
-- public key, idempotent publish, publish UPDATE vs edit (snapshot), disable / re-enable under the same key, the two service_role
-- public RPCs (read + submit), neutral unavailability (unknown / malformed / unpublished / disabled / suspended), submission rules
-- (services, service choice, recurring), idempotent replay, server-authoritative formVersion, best-effort acquisition, no
-- Passenger / Trip / Recurring side effects, the website endpoint being unable to reach a form binding, authorization matrix
-- (Admin only), raw table + function privilege posture, tenant isolation, Activity.
-- Fixtures: seeded Org A / Org B (supabase/seed.sql). Everything created here is removed at the end.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/website_request_form_publication_tests.sql

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

-- SQL text for one public-form submission through the service_role RPC. p_extra is a raw ", p_x => ..." tail.
create or replace function pg_temp.sub_sql(p_key text, p_idem text, p_extra text default '') returns text language sql as $$
  select format($q$select (r.accepted::text || '/' || coalesce(r.notification_event_id::text, 'null')) from public.submit_public_form_request(
    p_public_key => %L, p_idempotency_key => %L, p_requester_name => 'D2 Tester', p_requester_relationship => 'family',
    p_requester_phone => '555-0100', p_pickup_description => 'D2 pickup', p_destination_description => 'D2 destination',
    p_return_trip_needed => 'no' %s) r$q$, p_key, p_idem, p_extra) $$;

do $$
declare
  o_a constant uuid := '10000000-0000-0000-0000-0000000000a1'; o_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
begin
  delete from public.notification_events where entity_id in (select id from public.transportation_requests where requester_name like 'D2 %');
  delete from public.request_acquisition_attributions where request_id in (select id from public.transportation_requests where requester_name like 'D2 %');
  delete from public.request_events where request_id in (select id from public.transportation_requests where requester_name like 'D2 %');
  delete from public.transportation_requests where requester_name like 'D2 %';
  delete from public.website_request_form_publications where organization_id in (o_a, o_b);
  delete from public.request_intake_integrations where organization_id in (o_a, o_b) and integration_type = 'nemryn_form';
  delete from public.website_request_forms where organization_id in (o_a, o_b);
  delete from public.request_intake_integrations where external_id like 'd2-%';
  delete from public.organization_service_offerings where organization_id in (o_a, o_b);
  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins) values
    ('d2000000-0000-0000-0000-00000000a001', o_a, 'd2-site-a', 'website', true, array['https://d2-site-a.example.test']);
end $$;

do $$
declare
  o_a constant uuid := '10000000-0000-0000-0000-0000000000a1'; o_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  admin_a constant uuid := '20000000-0000-0000-0000-0000000000a1'; disp_a constant uuid := '20000000-0000-0000-0000-0000000000a2';
  driver_a constant uuid := '20000000-0000-0000-0000-0000000000a3'; inactive_a constant uuid := '20000000-0000-0000-0000-0000000000a5';
  admin_b constant uuid := '20000000-0000-0000-0000-0000000000b1'; plat constant uuid := '20000000-0000-0000-0000-0000000000d1';
  save_draft text; save_ready text; key_a text; key_b text; v text; n bigint; pax0 bigint; trips0 bigint; rec0 bigint; k2 text;
begin
  save_draft := format($q$select s.form_version::text || '/' || s.status from public.save_website_request_form(%L, %L, %L, %L, true, false, 'draft', %L, null::text[]) s$q$,
    o_a, 'Book a ride', 'Send request', 'Thanks. We will contact you.', 'Tell us about your trip.');
  save_ready := replace(save_draft, '''draft''', '''ready''');

  -- ---------------------------------------------------------------- publish gate
  perform pg_temp.report('PU1a (no form configured yet: publish refused, ZW006)',
    pg_temp.try_as('authenticated', admin_a, format('select * from public.publish_website_request_form(%L)', o_a)) = 'ZW006');
  perform pg_temp.val_as('authenticated', admin_a, save_draft);
  perform pg_temp.report('PU1b (Draft form can NOT be published, ZW006; nothing created)',
    pg_temp.try_as('authenticated', admin_a, format('select * from public.publish_website_request_form(%L)', o_a)) = 'ZW006'
    and (select count(*) from public.website_request_form_publications where organization_id = o_a) = 0
    and (select count(*) from public.request_intake_integrations where organization_id = o_a and integration_type = 'nemryn_form') = 0);
  perform pg_temp.report('PU1c (never published: get publication returns no row; disable is a harmless no-op)',
    pg_temp.val_as('authenticated', admin_a, format('select count(*)::text from public.get_website_request_form_publication(%L)', o_a)) = '0'
    and pg_temp.val_as('authenticated', admin_a, format('select changed::text from public.disable_website_request_form_publication(%L)', o_a)) = 'false');
  perform pg_temp.val_as('authenticated', admin_a, save_ready);

  -- ---------------------------------------------------------------- first publish
  v := pg_temp.val_as('authenticated', admin_a, format($q$select p.public_key || '|' || p.publication_status || '|' || p.published_version::text || '|' || p.changed::text from public.publish_website_request_form(%L) p$q$, o_a));
  key_a := split_part(v, '|', 1);
  perform pg_temp.report('PU2a (Ready form publishes: opaque key form_<32 hex>, published, version 1, changed)',
    key_a ~ '^form_[0-9a-f]{32}$' and split_part(v, '|', 2) = 'published' and split_part(v, '|', 3) = '1' and split_part(v, '|', 4) = 'true');
  perform pg_temp.report('PU2b (the hidden binding: ONE integration of type nemryn_form, active, no allowed origins, D1 method nemryn_form)',
    (select count(*) from public.request_intake_integrations where organization_id = o_a and integration_type = 'nemryn_form' and is_active and allowed_origins is null and connection_method = 'nemryn_form') = 1);
  perform pg_temp.report('PU2c (public key contains no organization / form / integration identifier)',
    key_a not like '%' || replace(o_a::text, '-', '') || '%'
    and key_a !~ (select replace(f.id::text, '-', '') from public.website_request_forms f where f.organization_id = o_a)
    and (select count(*) from public.audit_events where organization_id = o_a and action = 'website_request_form_published') = 1);
  v := pg_temp.val_as('authenticated', admin_a, format($q$select p.public_key || '|' || p.changed::text from public.publish_website_request_form(%L) p$q$, o_a));
  perform pg_temp.report('PU3 (identical publish is a no-op: same key, changed=false, one publication, one binding, no new audit)',
    v = key_a || '|false'
    and (select count(*) from public.website_request_form_publications where organization_id = o_a) = 1
    and (select count(*) from public.request_intake_integrations where organization_id = o_a and integration_type = 'nemryn_form') = 1
    and (select count(*) from public.audit_events where organization_id = o_a and action = 'website_request_form_published') = 1);

  -- ---------------------------------------------------------------- separation from the website connection surface
  perform pg_temp.report('PU4a (operator connection list shows website connections only, never the form binding)',
    pg_temp.val_as('authenticated', admin_a, format($q$select string_agg(external_id, ',' order by external_id) from public.list_request_intake_integrations(%L)$q$, o_a)) = 'd2-site-a');
  perform pg_temp.report('PU4b (the website-origin endpoint can NOT reach a form binding, ZW006)',
    pg_temp.try_as('service_role', null, format($q$select * from public.submit_public_transportation_request(%L, 'd2-bind-1', 'D2 Tester', 'self', '555', 'p', 'd', 'no', null, null, null, null, null, 'https://x.example.test')$q$,
      (select external_id from public.request_intake_integrations where organization_id = o_a and integration_type = 'nemryn_form'))) = 'ZW006');
  perform pg_temp.report('PU4c (a form binding can not carry an origin allow-list: CHECK)',
    pg_temp.try_as('postgres', null, format($q$update public.request_intake_integrations set allowed_origins = array['https://x.example.test'] where organization_id = %L and integration_type = 'nemryn_form'$q$, o_a)) <> 'ok');
  perform pg_temp.report('PU4d (state: get publication reports published / version 1 / zero requests)',
    pg_temp.val_as('authenticated', admin_a, format($q$select p.publication_status || '/' || p.published_version || '/' || p.request_count from public.get_website_request_form_publication(%L) p$q$, o_a)) = 'published/1/0');

  -- ---------------------------------------------------------------- authorization matrix
  perform pg_temp.report('PU5a (publish / disable / get: Dispatcher, Driver, inactive Membership, Platform Admin, other tenant Admin -> ZW002)',
    (select bool_and(pg_temp.try_as('authenticated', u, format('select * from public.publish_website_request_form(%L)', o_a)) = 'ZW002'
                 and pg_temp.try_as('authenticated', u, format('select * from public.disable_website_request_form_publication(%L)', o_a)) = 'ZW002'
                 and pg_temp.try_as('authenticated', u, format('select * from public.get_website_request_form_publication(%L)', o_a)) = 'ZW002')
     from unnest(array[disp_a, driver_a, inactive_a, plat, admin_b]) u)
    and (select status from public.website_request_form_publications where organization_id = o_a) = 'published');
  perform pg_temp.report('PU5b (anon and service_role can not execute the Admin RPCs)',
    pg_temp.try_as('anon', null, format('select * from public.publish_website_request_form(%L)', o_a)) = '42501'
    and pg_temp.try_as('service_role', null, format('select * from public.publish_website_request_form(%L)', o_a)) = '42501'
    and pg_temp.try_as('anon', null, format('select * from public.disable_website_request_form_publication(%L)', o_a)) = '42501'
    and pg_temp.try_as('service_role', null, format('select * from public.get_website_request_form_publication(%L)', o_a)) = '42501');
  perform pg_temp.report('PU5c (raw publication table: anon / authenticated / service_role denied; RLS on, no policy)',
    (select bool_and(pg_temp.try_as(r, case when r = 'authenticated' then admin_a end, 'select * from public.website_request_form_publications') = '42501') from unnest(array['anon', 'authenticated', 'service_role']) r)
    and (select relrowsecurity from pg_class where oid = 'public.website_request_form_publications'::regclass)
    and (select count(*) from pg_policies where tablename = 'website_request_form_publications') = 0);
  perform pg_temp.report('PU5d (public RPC privileges: service_role runs get/submit only; anon + authenticated neither; internal helpers no grant)',
    has_function_privilege('service_role', 'public.get_public_request_form(text)', 'execute')
    and not has_function_privilege('anon', 'public.get_public_request_form(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.get_public_request_form(text)', 'execute')
    and not has_function_privilege('anon', 'public.submit_public_form_request(text,text,text,text,text,text,text,text,text,date,time without time zone,text,text,text,text[],date,date,time without time zone,boolean,text,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.submit_public_form_request(text,text,text,text,text,text,text,text,text,date,time without time zone,text,text,text,text[],date,date,time without time zone,boolean,text,jsonb)', 'execute')
    and not has_function_privilege('service_role', 'public._create_public_request(uuid,text,text,text,text,text,text,text,text,date,time without time zone,text,text,text,text[],date,date,time without time zone,boolean,text,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public._create_public_request(uuid,text,text,text,text,text,text,text,text,date,time without time zone,text,text,text,text[],date,date,time without time zone,boolean,text,jsonb)', 'execute')
    and not has_table_privilege('service_role', 'public.website_request_form_publications', 'select'));

  -- ---------------------------------------------------------------- public read
  perform pg_temp.report('PU6a (published: service_role reads the public config, exactly one row, public columns only)',
    pg_temp.val_as('service_role', null, format($q$select count(*)::text from public.get_public_request_form(%L)$q$, key_a)) = '1'
    and (select count(*) from unnest((select proargnames from pg_proc where oid = 'public.get_public_request_form(text)'::regprocedure)) pa where pa in ('organization_id', 'form_id', 'intake_integration_id', 'id', 'public_key', 'external_id')) = 0);
  perform pg_temp.report('PU6b (public config content: org display name, snapshot copy, canonical services, version 1; no ids)',
    pg_temp.val_as('service_role', null, format($q$select organization_name || '|' || title || '|' || submit_label || '|' || cardinality(service_types)::text || '|' || allow_recurring::text || '|' || require_service_choice::text || '|' || form_version::text from public.get_public_request_form(%L)$q$, key_a))
      = (select name from public.organizations where id = o_a) || '|Book a ride|Send request|8|true|false|1'
);
  perform pg_temp.report('PU6c (unknown / malformed / empty / null key: zero rows, identical to a disabled one)',
    (select bool_and(coalesce(pg_temp.val_as('service_role', null, format('select count(*)::text from public.get_public_request_form(%L)', k)), 'x') = '0')
       from unnest(array['form_' || repeat('0', 32), 'form_xyz', '', 'FORM', 'a''b']) k)
    and pg_temp.val_as('service_role', null, 'select count(*)::text from public.get_public_request_form(null)') = '0');
  perform pg_temp.report('PU6d (anon / authenticated can not read it)',
    pg_temp.try_as('anon', null, format('select * from public.get_public_request_form(%L)', key_a)) = '42501'
    and pg_temp.try_as('authenticated', admin_a, format('select * from public.get_public_request_form(%L)', key_a)) = '42501');

  -- ---------------------------------------------------------------- valid submission + no side effects
  select count(*) into pax0 from public.passengers where organization_id = o_a;
  select count(*) into trips0 from public.trips where organization_id = o_a;
  select count(*) into rec0 from public.recurring_arrangements where organization_id = o_a;
  v := pg_temp.val_as('service_role', null, pg_temp.sub_sql(key_a, 'D2-IDEM-1', $q$, p_requested_passenger_name => 'D2 Passenger', p_acquisition => '{"utmSource":"google","utmMedium":"cpc","landingPath":"/dialysis","submissionPath":"/request","referrerHost":"google.com"}'::jsonb$q$));
  perform pg_temp.report('PU7a (valid submission: accepted, ONE Request, a notification event returned)', v like 'true/%' and v <> 'true/null'
    and (select count(*) from public.transportation_requests where requester_name = 'D2 Tester') = 1);
  perform pg_temp.report('PU7b (Request provenance: source web / pending / bound to THIS organization''s form binding; org from the key only)',
    (select r.source || '/' || r.state || '/' || (r.organization_id = o_a)::text || '/' || (i.integration_type)
       from public.transportation_requests r join public.request_intake_integrations i on i.id = r.intake_integration_id where r.requester_name = 'D2 Tester') = 'web/pending/true/nemryn_form');
  perform pg_temp.report('PU7c (no auto Passenger, no auto Trip, no auto Recurring Arrangement)',
    (select count(*) from public.passengers where organization_id = o_a) = pax0 and (select count(*) from public.trips where organization_id = o_a) = trips0
    and (select count(*) from public.recurring_arrangements where organization_id = o_a) = rec0
    and (select passenger_id from public.transportation_requests where requester_name = 'D2 Tester') is null);
  perform pg_temp.report('PU7d (S4C attribution: ONE snapshot with the supplied values + server-authoritative formVersion nemryn-form-v1)',
    (select count(*) from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2 Tester') = 1
    and (select a.utm_source || '/' || a.utm_medium || '/' || a.landing_path || '/' || a.referrer_host || '/' || a.form_version from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2 Tester')
        = 'google/cpc//dialysis/google.com/nemryn-form-v1');
  v := pg_temp.val_as('service_role', null, pg_temp.sub_sql(key_a, 'D2-IDEM-1', $q$, p_acquisition => '{"utmSource":"REWRITTEN"}'::jsonb$q$));
  perform pg_temp.report('PU8 (idempotent replay: accepted, NO second notification, still ONE Request, ONE snapshot, original values kept)',
    v = 'true/null' and (select count(*) from public.transportation_requests where requester_name = 'D2 Tester') = 1
    and (select count(*) from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2 Tester') = 1
    and (select count(*) from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2 Tester' and a.utm_source = 'google') = 1
    and (select count(*) from public.notification_events where entity_id = (select id from public.transportation_requests where requester_name = 'D2 Tester')) = 1);
  perform pg_temp.report('PU9 (get publication now counts the Request received through the form)',
    pg_temp.val_as('authenticated', admin_a, format($q$select p.request_count::text from public.get_website_request_form_publication(%L) p$q$, o_a)) = '1');

  -- ---------------------------------------------------------------- invalid + best-effort acquisition + formVersion
  perform pg_temp.report('PU10a (invalid required data: no Request)',
    pg_temp.try_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-BAD-1'), '''D2 pickup''', '''   ''')) = 'ZW006'
    and pg_temp.try_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-BAD-2'), '''family''', '''cousin''')) = 'ZW006'
    and (select count(*) from public.transportation_requests where external_submission_ref like 'D2-BAD%') = 0);
  v := pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-BADACQ-1', $q$, p_acquisition => '{"utmSource":"","landingPath":"https://x.example/a?b=1","referrerHost":"https://google.com/x","formVersion":"bad version!","gclid":"abc","ipAddress":"203.0.113.9"}'::jsonb$q$), 'D2 Tester', 'D2 BadAcq'));
  perform pg_temp.report('PU10b (garbage acquisition: Request STILL accepted; snapshot holds ONLY the server formVersion; no click id / IP / URL stored)',
    v like 'true/%'
    and (select a.form_version || '/' || coalesce(a.utm_source, '-') || '/' || coalesce(a.landing_path, '-') || '/' || coalesce(a.referrer_host, '-')
           from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2 BadAcq') = 'nemryn-form-v1/-/-/-');
  v := pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-NOACQ-1'), 'D2 Tester', 'D2 NoAcq'));
  perform pg_temp.report('PU10c (no acquisition at all: accepted; the snapshot carries the published formVersion)',
    v like 'true/%' and (select a.form_version from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2 NoAcq') = 'nemryn-form-v1');

  -- ---------------------------------------------------------------- editing != publishing; publish UPDATE; snapshot + formVersion honesty
  perform pg_temp.val_as('authenticated', admin_a, replace(replace(save_ready, 'Book a ride', 'Book a ride v2'), 'Send request', 'Send v2'));
  perform pg_temp.report('PU11a (EDITING the form does not change the live publication: still v1 snapshot)',
    pg_temp.val_as('service_role', null, format($q$select title || '|' || form_version::text from public.get_public_request_form(%L)$q$, key_a)) = 'Book a ride|1'
    and (select version from public.website_request_forms where organization_id = o_a) = 2);
  v := pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-V-UNPUB', $q$, p_acquisition => '{"formVersion":"nemryn-form-v2"}'::jsonb$q$), 'D2 Tester', 'D2 VUnpub'));
  perform pg_temp.report('PU11b (a client claiming an UNPUBLISHED version 2 is recorded as the published version 1)',
    (select a.form_version from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2 VUnpub') = 'nemryn-form-v1');
  v := pg_temp.val_as('authenticated', admin_a, format($q$select p.published_version::text || '/' || p.changed::text from public.publish_website_request_form(%L) p$q$, o_a));
  perform pg_temp.report('PU11c (publish UPDATE: version 2, changed, SAME public key, one publication, second audit)',
    v = '2/true' and (select public_key from public.website_request_form_publications where organization_id = o_a) = key_a
    and (select published_versions::text from public.website_request_form_publications where organization_id = o_a) = '{1,2}'
    and (select count(*) from public.audit_events where organization_id = o_a and action = 'website_request_form_published') = 2);
  perform pg_temp.report('PU11d (public config now serves the v2 snapshot)',
    pg_temp.val_as('service_role', null, format($q$select title || '|' || submit_label || '|' || form_version::text from public.get_public_request_form(%L)$q$, key_a)) = 'Book a ride v2|Send v2|2');
  v := pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-V-OLD', $q$, p_acquisition => '{"formVersion":"nemryn-form-v1"}'::jsonb$q$), 'D2 Tester', 'D2 VOld'));
  perform pg_temp.report('PU11e (a passenger who still holds published v1 open: accepted and recorded as v1, not rewritten to v2)',
    v like 'true/%' and (select a.form_version from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2 VOld') = 'nemryn-form-v1');
  perform pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-V-99', $q$, p_acquisition => '{"formVersion":"nemryn-form-v99"}'::jsonb$q$), 'D2 Tester', 'D2 V99'));
  perform pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-V-CUR', $q$, p_acquisition => '{"formVersion":"nemryn-form-v2"}'::jsonb$q$), 'D2 Tester', 'D2 VCur'));
  perform pg_temp.report('PU11f (a never-published version 99 is replaced by the current version; the current one is kept)',
    (select a.form_version from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2 V99') = 'nemryn-form-v2'
    and (select a.form_version from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name = 'D2 VCur') = 'nemryn-form-v2');
  -- form back to Draft: authoring state does not un-publish
  perform pg_temp.val_as('authenticated', admin_a, save_draft);
  perform pg_temp.report('PU12 (form moved back to Draft: the live publication is untouched; Draft can not publish again)',
    (select status from public.website_request_form_publications where organization_id = o_a) = 'published'
    and pg_temp.val_as('service_role', null, format('select count(*)::text from public.get_public_request_form(%L)', key_a)) = '1'
    and pg_temp.try_as('authenticated', admin_a, format('select * from public.publish_website_request_form(%L)', o_a)) = 'ZW006');
  perform pg_temp.val_as('authenticated', admin_a, save_ready);

  -- ---------------------------------------------------------------- services / service choice / recurring
  insert into public.organization_service_offerings (organization_id, service_type) values (o_a, 'dialysis'), (o_a, 'medical_appointment');
  perform pg_temp.report('PU13a (Services & Intake respected: the public config lists ONLY the currently offered services)',
    pg_temp.val_as('service_role', null, format($q$select array_to_string(service_types, ',') from public.get_public_request_form(%L)$q$, key_a)) = 'medical_appointment,dialysis');
  v := pg_temp.try_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-SVC-1', ', p_service_type => ''rehabilitation'''), 'D2 Tester', 'D2 SvcBad'));
  k2 := pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-SVC-2', ', p_service_type => ''dialysis'''), 'D2 Tester', 'D2 SvcOk'));
  perform pg_temp.report('PU13b (a service the organization does not offer is rejected; an offered one is accepted)',
    v = 'ZW006' and k2 like 'true/%' and (select service_type from public.transportation_requests where requester_name = 'D2 SvcOk') = 'dialysis');
  -- a subset form, published: only dialysis; require service choice; no recurring
  perform pg_temp.val_as('authenticated', admin_a, format($q$select s.form_version from public.save_website_request_form(%L, 'Dialysis rides', 'Request', 'Thanks.', false, true, 'ready', null, array['dialysis']::text[]) s$q$, o_a));
  perform pg_temp.val_as('authenticated', admin_a, format('select * from public.publish_website_request_form(%L)', o_a));
  perform pg_temp.report('PU13c (published subset: config lists dialysis only and requires the choice; recurring is off)',
    pg_temp.val_as('service_role', null, format($q$select array_to_string(service_types, ',') || '|' || require_service_choice::text || '|' || allow_recurring::text from public.get_public_request_form(%L)$q$, key_a)) = 'dialysis|true|false');
  v := pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-SUB-4', ', p_service_type => ''dialysis'''), 'D2 Tester', 'D2 SubOk'));
  perform pg_temp.report('PU13d (an org-offered service the FORM does not offer is rejected; missing required service rejected; recurring rejected)',
    pg_temp.try_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-SUB-1', ', p_service_type => ''medical_appointment'''), 'D2 Tester', 'D2 SubBad')) = 'ZW006'
    and pg_temp.try_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-SUB-2'), 'D2 Tester', 'D2 SubNone')) = 'ZW006'
    and pg_temp.try_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-SUB-3', ', p_service_type => ''dialysis'', p_recurring_days_of_week => array[''monday'']::text[], p_recurring_start_date => current_date + 7'), 'D2 Tester', 'D2 SubRec')) = 'ZW006'
    and v like 'true/%'
    and (select count(*) from public.transportation_requests where requester_name in ('D2 SvcBad', 'D2 SubBad', 'D2 SubNone', 'D2 SubRec')) = 0);
  -- recurring allowed when the form allows it
  perform pg_temp.val_as('authenticated', admin_a, format($q$select s.form_version from public.save_website_request_form(%L, 'Rides', 'Request', 'Thanks.', true, false, 'ready', null, null::text[]) s$q$, o_a));
  perform pg_temp.val_as('authenticated', admin_a, format('select * from public.publish_website_request_form(%L)', o_a));
  k2 := pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-REC-1', ', p_recurring_days_of_week => array[''monday'',''wednesday'']::text[], p_recurring_start_date => current_date + 7'), 'D2 Tester', 'D2 RecOk'));
  perform pg_temp.report('PU13e (recurring request on a form that allows it: accepted as a DESCRIPTION only, no arrangement created)',
    k2 like 'true/%' and (select recurring_days_of_week::text from public.transportation_requests where requester_name = 'D2 RecOk') = '{1,3}'
    and (select count(*) from public.recurring_arrangements where organization_id = o_a) = rec0);

  -- ---------------------------------------------------------------- disable / re-enable
  v := pg_temp.val_as('authenticated', admin_a, format($q$select p.publication_status || '/' || p.changed::text from public.disable_website_request_form_publication(%L) p$q$, o_a));
  perform pg_temp.report('PU14a (disable: disabled/changed; publication row + history kept; binding inactive; audit unpublished)',
    v = 'disabled/true' and (select status from public.website_request_form_publications where organization_id = o_a) = 'disabled'
    and (select count(*) from public.request_intake_integrations where organization_id = o_a and integration_type = 'nemryn_form' and not is_active) = 1
    and (select count(*) from public.audit_events where organization_id = o_a and action = 'website_request_form_unpublished') = 1
    and (select count(*) from public.transportation_requests where requester_name like 'D2 %') >= 1);
  perform pg_temp.report('PU14b (disabled: public config = zero rows and submissions rejected; identical to an unknown key)',
    pg_temp.val_as('service_role', null, format('select count(*)::text from public.get_public_request_form(%L)', key_a)) = '0'
    and pg_temp.try_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-DIS-1'), 'D2 Tester', 'D2 Disabled')) = 'ZW006'
    and (select count(*) from public.transportation_requests where requester_name = 'D2 Disabled') = 0
    and pg_temp.try_as('service_role', null, replace(pg_temp.sub_sql('form_' || repeat('a', 32), 'D2-DIS-2'), 'D2 Tester', 'D2 Unknown')) = 'ZW006');
  perform pg_temp.report('PU14c (disable is idempotent: changed=false, no second audit)',
    pg_temp.val_as('authenticated', admin_a, format('select changed::text from public.disable_website_request_form_publication(%L)', o_a)) = 'false'
    and (select count(*) from public.audit_events where organization_id = o_a and action = 'website_request_form_unpublished') = 1);
  v := pg_temp.val_as('authenticated', admin_a, format($q$select p.public_key || '/' || p.publication_status || '/' || p.changed::text from public.publish_website_request_form(%L) p$q$, o_a));
  perform pg_temp.report('PU14d (publish again re-enables under the SAME public key; binding active again; still one publication)',
    v = key_a || '/published/true' and (select count(*) from public.website_request_form_publications where organization_id = o_a) = 1
    and (select count(*) from public.request_intake_integrations where organization_id = o_a and integration_type = 'nemryn_form' and is_active) = 1
    and pg_temp.val_as('service_role', null, format('select count(*)::text from public.get_public_request_form(%L)', key_a)) = '1');

  -- ---------------------------------------------------------------- suspended organization
  update public.organizations set status = 'inactive' where id = o_a;
  perform pg_temp.report('PU15 (suspended organization: config unavailable, submission rejected, Admin can not publish/disable)',
    pg_temp.val_as('service_role', null, format('select count(*)::text from public.get_public_request_form(%L)', key_a)) = '0'
    and pg_temp.try_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-SUSP-1'), 'D2 Tester', 'D2 Susp')) = 'ZW006'
    and pg_temp.try_as('authenticated', admin_a, format('select * from public.publish_website_request_form(%L)', o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', admin_a, format('select * from public.disable_website_request_form_publication(%L)', o_a)) = 'ZW002');
  update public.organizations set status = 'active' where id = o_a;

  -- ---------------------------------------------------------------- tenant isolation
  perform pg_temp.val_as('authenticated', admin_b, format($q$select s.form_version from public.save_website_request_form(%L, 'B rides', 'Go', 'Thanks B.', true, false, 'ready', null, null::text[]) s$q$, o_b));
  key_b := split_part(pg_temp.val_as('authenticated', admin_b, format($q$select p.public_key || '|x' from public.publish_website_request_form(%L) p$q$, o_b)), '|', 1);
  perform pg_temp.report('PU16a (two organizations: distinct opaque keys, each resolves ONLY its own organization)',
    key_b ~ '^form_[0-9a-f]{32}$' and key_b <> key_a
    and pg_temp.val_as('service_role', null, format('select title from public.get_public_request_form(%L)', key_b)) = 'B rides'
    and pg_temp.val_as('service_role', null, format('select title from public.get_public_request_form(%L)', key_a)) = 'Rides');
  perform pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_b, 'D2-B-1'), 'D2 Tester', 'D2 OrgB'));
  k2 := pg_temp.val_as('service_role', null, replace(pg_temp.sub_sql(key_a, 'D2-B-1'), 'D2 Tester', 'D2 OrgAsame'));
  perform pg_temp.report('PU16b (a submission through Org B''s key lands ONLY in Org B; Org A''s idempotency key namespace is separate)',
    (select organization_id from public.transportation_requests where requester_name = 'D2 OrgB') = o_b
    and k2 like 'true/%' and (select organization_id from public.transportation_requests where requester_name = 'D2 OrgAsame') = o_a);
  perform pg_temp.report('PU16c (Org B Admin can not publish / disable Org A; Org A Admin can not read Org B''s publication)',
    pg_temp.try_as('authenticated', admin_b, format('select * from public.disable_website_request_form_publication(%L)', o_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', admin_a, format('select * from public.get_website_request_form_publication(%L)', o_b)) = 'ZW002');

  -- ---------------------------------------------------------------- website endpoint + Activity
  perform pg_temp.report('PU17 (existing website intake through submit_public_transportation_request still works from its approved origin)',
    pg_temp.val_as('service_role', null, $q$select accepted::text from public.submit_public_transportation_request('d2-site-a', 'D2-WEB-1', 'D2 Web', 'self', '555', 'p', 'd', 'no', null, null, null, null, null, 'https://d2-site-a.example.test')$q$) = 'true'
    and pg_temp.try_as('service_role', null, $q$select * from public.submit_public_transportation_request('d2-site-a', 'D2-WEB-2', 'D2 Web2', 'self', '555', 'p', 'd', 'no', null, null, null, null, null, 'https://evil.example.test')$q$) = 'ZW006');
  perform pg_temp.report('PU18 (Activity shows the publish / unpublish events to the Admin only)',
    pg_temp.val_as('authenticated', admin_a, format($q$select (count(*) filter (where action = 'website_request_form_published') || '/' || count(*) filter (where action = 'website_request_form_unpublished'))::text from public.list_activity_events(%L, 50)$q$, o_a)) ~ '^[2-9]/1$'
    and pg_temp.try_as('authenticated', disp_a, format('select * from public.list_activity_events(%L, 50)', o_a)) = 'ZW002');
end $$;

-- cleanup
do $$
declare o_a constant uuid := '10000000-0000-0000-0000-0000000000a1'; o_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
begin
  delete from public.notification_events where entity_id in (select id from public.transportation_requests where requester_name like 'D2 %');
  delete from public.request_acquisition_attributions where request_id in (select id from public.transportation_requests where requester_name like 'D2 %');
  delete from public.request_events where request_id in (select id from public.transportation_requests where requester_name like 'D2 %');
  delete from public.transportation_requests where requester_name like 'D2 %';
  delete from public.website_request_form_publications where organization_id in (o_a, o_b);
  delete from public.request_intake_integrations where organization_id in (o_a, o_b) and (integration_type = 'nemryn_form' or external_id like 'd2-%');
  delete from public.website_request_forms where organization_id in (o_a, o_b);
  delete from public.organization_service_offerings where organization_id in (o_a, o_b);
end $$;
