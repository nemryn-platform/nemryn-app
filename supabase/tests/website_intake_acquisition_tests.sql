-- Nemryn -- Website Intake ACQUISITION ATTRIBUTION tests (P1-PILOT-S4C).
--
-- Covers: the optional acquisition object (accepted / partial / malformed / all-invalid / unknown keys),
-- the best-effort rule (attribution can never block a valid Request), atomicity, one-snapshot-per-Request,
-- idempotent replay (original values never rewritten, no second snapshot, one notification), unchanged
-- rejections (origin, disabled integration, disabled service offering), no auto Passenger / Trip /
-- Recurring Arrangement, tenant isolation, Driver / Platform Admin / anon / service_role denial, the
-- immutable-evidence constraints, the sanitiser boundaries, and the P1-SEC-01 privilege posture of the new
-- objects. Mirrors public_request_intake_tests.sql: run as postgres with inline role switches; the intake
-- function is invoked as service_role exactly like the Route Handler does.
--
-- Fixtures: seeded Org A / Org B and their seeded users (supabase/seed.sql); dedicated integrations
-- 's4c-*' / ids a9000000-...; everything created here is removed at the end.
--
-- Run with:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/website_intake_acquisition_tests.sql

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.report(p_name text, p_ok boolean) returns void language plpgsql as $$
begin raise notice 'TEST %: %', p_name, case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end; end $$;

-- Submit through the public RPC as service_role (the Route Handler's identity). Returns 'accepted:<new|replay>' or the SQLSTATE.
create or replace function pg_temp.submit(p_ext text, p_key text, p_acq jsonb default null, p_origin text default null, p_service text default null) returns text language plpgsql as $$
declare v public.public_request_submission_result;
begin
  set local role service_role;
  begin
    select * into v from public.submit_public_transportation_request(
      p_integration_external_id => p_ext, p_idempotency_key => p_key, p_requester_name => 'S4C Requester',
      p_requester_relationship => 'self', p_requester_phone => '555-0177', p_pickup_description => 'S4C TEST Pickup',
      p_destination_description => 'S4C TEST Destination', p_return_trip_needed => 'no', p_origin => p_origin,
      p_service_type => p_service, p_acquisition => p_acq);
    reset role;
    return 'accepted:' || case when v.notification_event_id is null then 'replay' else 'new' end;
  exception when others then
    reset role;
    return sqlstate;
  end;
end $$;

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

create or replace function pg_temp.req_id(p_ext text, p_key text) returns uuid language sql as $$
  select r.id from public.transportation_requests r join public.request_intake_integrations i on i.id = r.intake_integration_id
  where i.external_id = p_ext and r.external_submission_ref = p_key $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
do $$
begin
  delete from public.request_intake_integrations where external_id like 's4c-%';
  insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active) values
    ('a9000000-0000-0000-0000-00000000a001', '10000000-0000-0000-0000-0000000000a1', 's4c-org-a', 'website', true),
    ('a9000000-0000-0000-0000-00000000a002', '10000000-0000-0000-0000-0000000000a1', 's4c-org-a-disabled', 'website', false),
    ('a9000000-0000-0000-0000-00000000a003', '10000000-0000-0000-0000-0000000000b1', 's4c-org-b', 'website', true),
    ('a9000000-0000-0000-0000-00000000a004', '10000000-0000-0000-0000-0000000000a1', 's4c-org-a-locked', 'website', true);
  update public.request_intake_integrations set allowed_origins = array['https://acme-clinic.example.test'] where id = 'a9000000-0000-0000-0000-00000000a004';
end $$;

-- ---------------------------------------------------------------------------
-- A-F. Payload matrix
-- ---------------------------------------------------------------------------
do $$
declare
  r text; a record; v_id uuid;
  v_pass_before bigint; v_trips_before bigint; v_rec_before bigint; v_pass_after bigint; v_trips_after bigint; v_rec_after bigint;
begin
  select count(*) into v_pass_before from public.passengers; select count(*) into v_trips_before from public.trips; select count(*) into v_rec_before from public.recurring_arrangements;

  -- A. old payload, no acquisition
  r := pg_temp.submit('s4c-org-a', 'A-1');
  v_id := pg_temp.req_id('s4c-org-a', 'A-1');
  perform pg_temp.report('A (old payload without acquisition: accepted; NO attribution row)', r = 'accepted:new' and v_id is not null
    and not exists (select 1 from public.request_acquisition_attributions where request_id = v_id));
  r := pg_temp.submit('s4c-org-a', 'A-2', 'null'::jsonb);
  perform pg_temp.report('A2 (explicit null acquisition: accepted, no row)', r = 'accepted:new' and not exists (select 1 from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'A-2')));

  -- B. full valid
  r := pg_temp.submit('s4c-org-a', 'B-1', jsonb_build_object('utmSource','google','utmMedium','cpc','utmCampaign','Dialysis_Transport','utmContent','ad-variant-A','utmTerm','dialysis ride near me',
        'landingPath','/dialysis-transportation','submissionPath','/request-transportation','referrerHost','google.com','formVersion','request-v2'));
  v_id := pg_temp.req_id('s4c-org-a', 'B-1');
  select * into a from public.request_acquisition_attributions where request_id = v_id;
  perform pg_temp.report('B (full valid acquisition: accepted; exactly one snapshot with every value, case preserved)',
    r = 'accepted:new' and a.utm_source = 'google' and a.utm_medium = 'cpc' and a.utm_campaign = 'Dialysis_Transport' and a.utm_content = 'ad-variant-A'
    and a.utm_term = 'dialysis ride near me' and a.landing_path = '/dialysis-transportation' and a.submission_path = '/request-transportation'
    and a.referrer_host = 'google.com' and a.form_version = 'request-v2' and a.organization_id = '10000000-0000-0000-0000-0000000000a1'
    and (select count(*) from public.request_acquisition_attributions where request_id = v_id) = 1);

  -- C. partial valid
  r := pg_temp.submit('s4c-org-a', 'C-1', jsonb_build_object('utmSource', 'newsletter', 'landingPath', '/'));
  select * into a from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'C-1');
  perform pg_temp.report('C (partial acquisition: accepted; only the supplied valid values stored)',
    r = 'accepted:new' and a.utm_source = 'newsletter' and a.landing_path = '/' and a.utm_medium is null and a.utm_campaign is null and a.referrer_host is null and a.form_version is null);

  -- D. some malformed
  r := pg_temp.submit('s4c-org-a', 'D-1', jsonb_build_object('utmSource', '  Facebook  ', 'utmMedium', '   ', 'utmCampaign', 12345, 'landingPath', 'https://example.com/dialysis',
        'submissionPath', '/request?utm_source=google', 'referrerHost', 'https://google.com/search', 'formVersion', 'bad version!', 'utmContent', E'line\nbreak'));
  select * into a from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'D-1');
  perform pg_temp.report('D (some malformed: accepted; invalid values dropped, the trimmed valid one kept)',
    r = 'accepted:new' and a.utm_source = 'Facebook' and a.utm_medium is null and a.utm_campaign is null and a.landing_path is null and a.submission_path is null
    and a.referrer_host is null and a.form_version is null and a.utm_content is null);

  -- E. all invalid
  r := pg_temp.submit('s4c-org-a', 'E-1', jsonb_build_object('utmSource', '', 'landingPath', '/x#frag', 'referrerHost', 'no spaces allowed', 'formVersion', '', 'utmMedium', repeat('m', 121)));
  perform pg_temp.report('E (all acquisition invalid: accepted; NO snapshot)', r = 'accepted:new' and not exists (select 1 from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'E-1')));
  r := pg_temp.submit('s4c-org-a', 'E-2', '"just a string"'::jsonb);
  perform pg_temp.report('E2 (acquisition of the wrong JSON type: accepted; no snapshot)', r = 'accepted:new' and not exists (select 1 from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'E-2')));
  r := pg_temp.submit('s4c-org-a', 'E-3', '[1,2,3]'::jsonb);
  perform pg_temp.report('E3 (acquisition as an array: accepted; no snapshot)', r = 'accepted:new' and not exists (select 1 from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'E-3')));

  -- F. unknown keys ignored (privacy: nothing beyond the closed set is ever stored)
  r := pg_temp.submit('s4c-org-a', 'F-1', jsonb_build_object('utmSource', 'partner', 'gclid', 'abc123', 'fbclid', 'x', 'ipAddress', '203.0.113.9', 'userAgent', 'Mozilla/5.0', 'fingerprint', 'zz',
        'referrer', 'https://google.com/full/url?q=1', 'metadata', jsonb_build_object('a', 1)));
  select * into a from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'F-1');
  perform pg_temp.report('F (unknown acquisition keys ignored: accepted; only utm_source stored; no click ids / IP / UA / full referrer anywhere)',
    r = 'accepted:new' and a.utm_source = 'partner' and a.utm_medium is null and a.landing_path is null and a.referrer_host is null
    and not exists (select 1 from public.request_acquisition_attributions x where x.request_id = a.request_id and to_jsonb(x)::text ~* '(gclid|abc123|203\.0\.113|Mozilla|fingerprint|full/url)')
    and not exists (select 1 from public.transportation_requests q where q.id = a.request_id and to_jsonb(q)::text ~* '(gclid|abc123|203\.0\.113|Mozilla|fingerprint|full/url)'));
  r := pg_temp.submit('s4c-org-a', 'F-2', jsonb_build_object('gclid', 'only-unknown', 'ip', '1.2.3.4'));
  perform pg_temp.report('F2 (an acquisition object of only unknown keys: accepted; no snapshot)', r = 'accepted:new' and not exists (select 1 from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'F-2')));

  -- M / N / O. no auto Passenger, Trip or Recurring Arrangement
  select count(*) into v_pass_after from public.passengers; select count(*) into v_trips_after from public.trips; select count(*) into v_rec_after from public.recurring_arrangements;
  perform pg_temp.report('M (no auto Passenger: none created, passenger_id null on every S4C Request)', v_pass_after = v_pass_before
    and not exists (select 1 from public.transportation_requests q join public.request_intake_integrations i on i.id = q.intake_integration_id where i.external_id like 's4c-%' and q.passenger_id is not null));
  perform pg_temp.report('N (no auto Trip)', v_trips_after = v_trips_before);
  perform pg_temp.report('O (no auto Recurring Arrangement)', v_rec_after = v_rec_before);
end $$;

-- ---------------------------------------------------------------------------
-- G. Idempotent replay; P. notification exactly once
-- ---------------------------------------------------------------------------
do $$
declare r1 text; r2 text; r3 text; v_id uuid; a record; v_notifs bigint;
begin
  r1 := pg_temp.submit('s4c-org-a', 'G-1', jsonb_build_object('utmSource', 'original', 'utmCampaign', 'first', 'landingPath', '/first'));
  v_id := pg_temp.req_id('s4c-org-a', 'G-1');
  r2 := pg_temp.submit('s4c-org-a', 'G-1', jsonb_build_object('utmSource', 'REWRITTEN', 'utmCampaign', 'second', 'landingPath', '/second', 'formVersion', 'v9'));
  r3 := pg_temp.submit('s4c-org-a', 'G-1', null);
  select * into a from public.request_acquisition_attributions where request_id = v_id;
  perform pg_temp.report('G (replay with DIFFERENT / missing acquisition: same Request, exactly one snapshot, ORIGINAL values unchanged)',
    r1 = 'accepted:new' and r2 = 'accepted:replay' and r3 = 'accepted:replay'
    and (select count(*) from public.transportation_requests where id = v_id) = 1
    and (select count(*) from public.request_acquisition_attributions where request_id = v_id) = 1
    and a.utm_source = 'original' and a.utm_campaign = 'first' and a.landing_path = '/first' and a.form_version is null);
  select count(*) into v_notifs from public.notification_events where entity_id = v_id and event_type = 'website_request';
  perform pg_temp.report('P (notification exactly once across the original and both replays)', v_notifs = 1);

  -- replay of a Request that originally carried NO acquisition must not create one later
  perform pg_temp.submit('s4c-org-a', 'G-2', null);
  perform pg_temp.submit('s4c-org-a', 'G-2', jsonb_build_object('utmSource', 'late'));
  perform pg_temp.report('G2 (a replay never ADDS a snapshot to a Request that had none: it belongs to the original submission)',
    not exists (select 1 from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'G-2')));

  perform pg_temp.report('P2 (a new Request with acquisition enqueues exactly one notification and copies NO acquisition value into events)',
    (select count(*) from public.notification_events where entity_id = pg_temp.req_id('s4c-org-a', 'B-1')) = 1
    and not exists (select 1 from public.request_events e where e.request_id = pg_temp.req_id('s4c-org-a', 'B-1') and e.metadata::text ~* '(google|Dialysis_Transport|request-v2|utm)')
    and not exists (select 1 from public.audit_events x where x.entity_id = pg_temp.req_id('s4c-org-a', 'B-1')));
end $$;

-- ---------------------------------------------------------------------------
-- H / I / K. Unchanged rejections (with acquisition supplied: it must not change any outcome)
-- ---------------------------------------------------------------------------
do $$
declare acq jsonb := jsonb_build_object('utmSource', 'google', 'landingPath', '/x'); r text;
begin
  r := pg_temp.submit('s4c-org-a-locked', 'H-1', acq, 'https://evil.example.test');
  perform pg_temp.report('H (wrong origin: still rejected ZW006; no Request, no snapshot)', r = 'ZW006' and pg_temp.req_id('s4c-org-a-locked', 'H-1') is null);
  r := pg_temp.submit('s4c-org-a-locked', 'H-2', acq, 'https://acme-clinic.example.test');
  perform pg_temp.report('H2 (correct origin: accepted with snapshot)', r = 'accepted:new' and exists (select 1 from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a-locked', 'H-2')));
  r := pg_temp.submit('s4c-org-a-disabled', 'I-1', acq);
  perform pg_temp.report('I (disabled integration: still rejected ZW006; nothing stored)', r = 'ZW006' and pg_temp.req_id('s4c-org-a-disabled', 'I-1') is null);
  r := pg_temp.submit('no-such-integration', 'I-2', acq);
  perform pg_temp.report('I2 (unknown integration: same generic rejection)', r = 'ZW006');

  -- K. service offering not enabled -> rejected exactly as before
  insert into public.organization_service_offerings (organization_id, service_type) values ('10000000-0000-0000-0000-0000000000a1', 'dialysis');
  r := pg_temp.submit('s4c-org-a', 'K-1', acq, null, 'wheelchair_transportation');
  perform pg_temp.report('K (service offering not enabled by the tenant: still rejected ZW006; nothing stored)', r = 'ZW006' and pg_temp.req_id('s4c-org-a', 'K-1') is null);
  r := pg_temp.submit('s4c-org-a', 'K-2', acq, null, 'dialysis');
  perform pg_temp.report('K2 (enabled service offering: accepted with snapshot)', r = 'accepted:new' and exists (select 1 from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'K-2')));
  delete from public.organization_service_offerings where organization_id = '10000000-0000-0000-0000-0000000000a1' and service_type = 'dialysis';
end $$;

-- ---------------------------------------------------------------------------
-- BEST-EFFORT RULE: even an internal attribution failure cannot block a valid Request
-- ---------------------------------------------------------------------------
do $$
declare r text; v_id uuid;
begin
  alter table public.request_acquisition_attributions add constraint zz_s4c_force_fail check (utm_source is distinct from 'FORCE_FAIL');
  r := pg_temp.submit('s4c-org-a', 'BE-1', jsonb_build_object('utmSource', 'FORCE_FAIL', 'utmMedium', 'x'));
  v_id := pg_temp.req_id('s4c-org-a', 'BE-1');
  perform pg_temp.report('BE (attribution insert FAILS internally: the valid Request is still accepted, committed and notified; no snapshot)',
    r = 'accepted:new' and v_id is not null and not exists (select 1 from public.request_acquisition_attributions where request_id = v_id)
    and (select count(*) from public.notification_events where entity_id = v_id) = 1);
  alter table public.request_acquisition_attributions drop constraint zz_s4c_force_fail;
end $$;

-- ---------------------------------------------------------------------------
-- Sanitiser boundaries (internal function, as owner)
-- ---------------------------------------------------------------------------
do $$
declare s jsonb;
  function_ok boolean;
begin
  s := public._sanitize_acquisition(jsonb_build_object('utmSource', repeat('a', 120), 'utmMedium', repeat('m', 121), 'utmCampaign', repeat('c', 160), 'utmContent', repeat('x', 161), 'utmTerm', repeat('t', 160)));
  perform pg_temp.report('S1 (utm length limits: 120/120/160/160/160 kept at the limit, one over dropped)',
    s ? 'utmSource' and not s ? 'utmMedium' and s ? 'utmCampaign' and not s ? 'utmContent' and s ? 'utmTerm');
  s := public._sanitize_acquisition(jsonb_build_object('utmCampaign', '  Spring_SALE-2026  '));
  perform pg_temp.report('S2 (trimmed; case NOT altered)', s ->> 'utmCampaign' = 'Spring_SALE-2026');
  perform pg_temp.report('S3 (control characters, whitespace-only and non-string values dropped)',
    public._sanitize_acquisition(jsonb_build_object('utmSource', E'a\tb', 'utmMedium', E'\u0007', 'utmTerm', '   ', 'utmContent', 5, 'utmCampaign', true)) is null);
  s := public._sanitize_acquisition(jsonb_build_object('landingPath', '/dialysis-transportation', 'submissionPath', '/request-transportation'));
  perform pg_temp.report('S4 (valid pathnames kept)', s ->> 'landingPath' = '/dialysis-transportation' and s ->> 'submissionPath' = '/request-transportation');
  perform pg_temp.report('S5 (invalid paths dropped: full URL, query, fragment, protocol-relative, no leading slash, whitespace, backslash)',
    public._sanitize_acquisition(jsonb_build_object('landingPath', 'https://example.com/dialysis')) is null
    and public._sanitize_acquisition(jsonb_build_object('landingPath', '/request?utm_source=google')) is null
    and public._sanitize_acquisition(jsonb_build_object('landingPath', '/request#form')) is null
    and public._sanitize_acquisition(jsonb_build_object('landingPath', '//evil.example/x')) is null
    and public._sanitize_acquisition(jsonb_build_object('landingPath', 'dialysis')) is null
    and public._sanitize_acquisition(jsonb_build_object('landingPath', '/with space')) is null
    and public._sanitize_acquisition(jsonb_build_object('landingPath', E'/back\\slash')) is null
    and public._sanitize_acquisition(jsonb_build_object('landingPath', '/' || repeat('p', 300))) is null
    and public._sanitize_acquisition(jsonb_build_object('landingPath', '/' || repeat('p', 299))) is not null);
  perform pg_temp.report('S6 (referrerHost: bare hostname kept and lowercased; protocol / path / query / port / double-dot dropped)',
    public._sanitize_acquisition(jsonb_build_object('referrerHost', 'Google.COM')) ->> 'referrerHost' = 'google.com'
    and public._sanitize_acquisition(jsonb_build_object('referrerHost', 'www.facebook.com')) ->> 'referrerHost' = 'www.facebook.com'
    and public._sanitize_acquisition(jsonb_build_object('referrerHost', 'localhost')) ->> 'referrerHost' = 'localhost'
    and public._sanitize_acquisition(jsonb_build_object('referrerHost', 'https://google.com')) is null
    and public._sanitize_acquisition(jsonb_build_object('referrerHost', 'google.com/path')) is null
    and public._sanitize_acquisition(jsonb_build_object('referrerHost', 'google.com?q=1')) is null
    and public._sanitize_acquisition(jsonb_build_object('referrerHost', 'google.com:443')) is null
    and public._sanitize_acquisition(jsonb_build_object('referrerHost', 'a..b')) is null
    and public._sanitize_acquisition(jsonb_build_object('referrerHost', 'bad-.com')) is null
    and public._sanitize_acquisition(jsonb_build_object('referrerHost', 'bad.-com')) is null
    and public._sanitize_acquisition(jsonb_build_object('referrerHost', repeat('a', 254))) is null);
  perform pg_temp.report('S7 (formVersion: safe short identifier; spaces / symbols / 65 chars dropped)',
    public._sanitize_acquisition(jsonb_build_object('formVersion', 'request-v2')) ->> 'formVersion' = 'request-v2'
    and public._sanitize_acquisition(jsonb_build_object('formVersion', 'intake_2026_09')) ->> 'formVersion' = 'intake_2026_09'
    and public._sanitize_acquisition(jsonb_build_object('formVersion', 'bad version')) is null
    and public._sanitize_acquisition(jsonb_build_object('formVersion', '-leading')) is null
    and public._sanitize_acquisition(jsonb_build_object('formVersion', repeat('v', 65))) is null
    and public._sanitize_acquisition(jsonb_build_object('formVersion', repeat('v', 64))) is not null);
  perform pg_temp.report('S8 (non-object input, arrays, scalars and only-unknown-keys carry nothing)',
    public._sanitize_acquisition(null) is null and public._sanitize_acquisition('[]'::jsonb) is null and public._sanitize_acquisition('"x"'::jsonb) is null
    and public._sanitize_acquisition('5'::jsonb) is null and public._sanitize_acquisition('{"gclid":"x","ip":"1.1.1.1"}'::jsonb) is null and public._sanitize_acquisition('{}'::jsonb) is null);
end $$;

-- ---------------------------------------------------------------------------
-- Immutable-evidence / integrity constraints (as owner)
-- ---------------------------------------------------------------------------
do $$
declare v_req uuid := pg_temp.req_id('s4c-org-a', 'B-1'); v_req_b uuid; r text;
begin
  perform pg_temp.submit('s4c-org-b', 'ORGB-1', jsonb_build_object('utmSource', 'org-b-secret-campaign'));
  v_req_b := pg_temp.req_id('s4c-org-b', 'ORGB-1');
  begin insert into public.request_acquisition_attributions (organization_id, request_id, utm_source) values ('10000000-0000-0000-0000-0000000000a1', v_req, 'dup'); r := 'inserted';
  exception when unique_violation then r := 'unique'; when others then r := sqlstate; end;
  perform pg_temp.report('DB1 (a second snapshot for the same Request is rejected: unique(request_id))', r = 'unique');
  begin insert into public.request_acquisition_attributions (organization_id, request_id, utm_source) values ('10000000-0000-0000-0000-0000000000b1', v_req, 'wrong-org'); r := 'inserted';
  exception when foreign_key_violation then r := 'fk'; when unique_violation then r := 'unique'; when others then r := sqlstate; end;
  perform pg_temp.report('DB2 (snapshot organization must equal its Request organization: composite FK)', r in ('fk', 'unique'));
  delete from public.request_acquisition_attributions where request_id = pg_temp.req_id('s4c-org-a', 'C-1');
  begin insert into public.request_acquisition_attributions (organization_id, request_id) values ('10000000-0000-0000-0000-0000000000a1', pg_temp.req_id('s4c-org-a', 'C-1')); r := 'inserted';
  exception when check_violation then r := 'check'; when others then r := sqlstate; end;
  perform pg_temp.report('DB3 (an EMPTY snapshot cannot exist: check constraint)', r = 'check');
  begin insert into public.request_acquisition_attributions (organization_id, request_id, landing_path) values ('10000000-0000-0000-0000-0000000000a1', pg_temp.req_id('s4c-org-a', 'C-1'), 'https://x.example/a'); r := 'inserted';
  exception when check_violation then r := 'check'; when others then r := sqlstate; end;
  perform pg_temp.report('DB4 (a full URL can never be stored as a path, even by the owner: check constraint)', r = 'check');
  begin update public.request_acquisition_attributions set organization_id = '10000000-0000-0000-0000-0000000000b1' where request_id = v_req; r := 'updated';
  exception when others then r := 'blocked'; end;
  perform pg_temp.report('DB5 (organization_id of a snapshot cannot be changed)', r = 'blocked');
end $$;

-- ---------------------------------------------------------------------------
-- Read model authorization, tenant isolation, Driver / Platform Admin / anon / service_role
-- ---------------------------------------------------------------------------
do $$
declare
  o_a constant uuid := '10000000-0000-0000-0000-0000000000a1'; o_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  admin_a constant uuid := '20000000-0000-0000-0000-0000000000a1'; disp_a constant uuid := '20000000-0000-0000-0000-0000000000a2';
  driver_a constant uuid := '20000000-0000-0000-0000-0000000000a3'; inactive_a constant uuid := '20000000-0000-0000-0000-0000000000a5';
  admin_b constant uuid := '20000000-0000-0000-0000-0000000000b1'; plat constant uuid := '20000000-0000-0000-0000-0000000000d1';
  req_a uuid := pg_temp.req_id('s4c-org-a', 'B-1'); req_b uuid := pg_temp.req_id('s4c-org-b', 'ORGB-1');
  q_a text; q_b text;
begin
  q_a := format('select utm_campaign || ''/'' || referrer_host || ''/'' || form_version from public.get_request_acquisition(%L, %L)', o_a, req_a);
  perform pg_temp.report('R1 (Org A Admin reads the snapshot through the controlled RPC)', pg_temp.val_as('authenticated', admin_a, q_a) = 'Dialysis_Transport/google.com/request-v2');
  perform pg_temp.report('R2 (Org A Dispatcher reads it too: Request Hub authorization semantics)', pg_temp.val_as('authenticated', disp_a, q_a) = 'Dialysis_Transport/google.com/request-v2');
  perform pg_temp.report('R3 (a Request with no snapshot returns zero rows)', pg_temp.val_as('authenticated', admin_a, format('select count(*)::text from public.get_request_acquisition(%L, %L)', o_a, pg_temp.req_id('s4c-org-a', 'A-1'))) = '0');
  perform pg_temp.report('R4 (DRIVER: denied ZW002 -- attribution never reaches the Driver)', pg_temp.try_as('authenticated', driver_a, q_a) = 'ZW002');
  perform pg_temp.report('R5 (inactive Membership denied ZW002)', pg_temp.try_as('authenticated', inactive_a, q_a) = 'ZW002');
  perform pg_temp.report('R6 (PlatformAdminGrant alone: denied ZW002 -- no raw tenant attribution)', pg_temp.try_as('authenticated', plat, q_a) = 'ZW002');
  perform pg_temp.report('R7 (Org B Admin cannot read Org A attribution: with Org A id ZW002; with own org id zero rows)',
    pg_temp.try_as('authenticated', admin_b, q_a) = 'ZW002'
    and pg_temp.val_as('authenticated', admin_b, format('select count(*)::text from public.get_request_acquisition(%L, %L)', o_b, req_a)) = '0');
  q_b := format('select utm_source from public.get_request_acquisition(%L, %L)', o_b, req_b);
  perform pg_temp.report('R8 (each tenant reads only its own; Org A cannot read Org B either)',
    pg_temp.val_as('authenticated', admin_b, q_b) = 'org-b-secret-campaign'
    and pg_temp.try_as('authenticated', admin_a, q_b) = 'ZW002'
    and pg_temp.val_as('authenticated', admin_a, format('select count(*)::text from public.get_request_acquisition(%L, %L)', o_a, req_b)) = '0');
  perform pg_temp.report('R9 (anon and service_role cannot execute the read RPC: 42501; unauthenticated authenticated -> ZW001)',
    pg_temp.try_as('anon', null, q_a) = '42501' and pg_temp.try_as('service_role', null, q_a) = '42501' and pg_temp.try_as('authenticated', null, q_a) = 'ZW001');
  perform pg_temp.report('R10 (null ids: generic ZW002)', pg_temp.try_as('authenticated', admin_a, 'select * from public.get_request_acquisition(null, null)') = 'ZW002');

  perform pg_temp.report('T1 (raw table: NO privilege for anon / authenticated / service_role -- 42501 on select and insert for each)',
    pg_temp.try_as('anon', null, 'select * from public.request_acquisition_attributions') = '42501'
    and pg_temp.try_as('authenticated', admin_a, 'select * from public.request_acquisition_attributions') = '42501'
    and pg_temp.try_as('service_role', null, 'select * from public.request_acquisition_attributions') = '42501'
    and pg_temp.try_as('authenticated', admin_a, format($q$insert into public.request_acquisition_attributions (organization_id, request_id, utm_source) values (%L, %L, 'x')$q$, o_a, req_a)) = '42501'
    and pg_temp.try_as('service_role', null, format($q$insert into public.request_acquisition_attributions (organization_id, request_id, utm_source) values (%L, %L, 'x')$q$, o_a, req_a)) = '42501'
    and pg_temp.try_as('authenticated', plat, 'select * from public.request_acquisition_attributions') = '42501'
    and pg_temp.try_as('authenticated', driver_a, 'select * from public.request_acquisition_attributions') = '42501'
    and pg_temp.try_as('authenticated', admin_a, 'update public.request_acquisition_attributions set utm_source = ''x''') = '42501'
    and pg_temp.try_as('authenticated', admin_a, 'delete from public.request_acquisition_attributions') = '42501');
  perform pg_temp.report('T2 (RLS enabled with NO policy: default deny as a second layer)',
    (select relrowsecurity from pg_class where oid = 'public.request_acquisition_attributions'::regclass)
    and not exists (select 1 from pg_policies where tablename = 'request_acquisition_attributions'));
  perform pg_temp.report('T3 (function EXECUTE exactly as intended: intake = service_role only; read RPC = authenticated only; sanitiser = nobody)',
    has_function_privilege('service_role', 'public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time, text, text, text, text, text[], date, date, time, boolean, text, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time, text, text, text, text, text[], date, date, time, boolean, text, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time, text, text, text, text, text[], date, date, time, boolean, text, jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.get_request_acquisition(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.get_request_acquisition(uuid, uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.get_request_acquisition(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public._sanitize_acquisition(jsonb)', 'execute')
    and not has_function_privilege('service_role', 'public._sanitize_acquisition(jsonb)', 'execute'));
  perform pg_temp.report('T4 (exactly ONE submit_public_transportation_request overload exists: no ambiguity for PostgREST)',
    (select count(*) from pg_proc where proname = 'submit_public_transportation_request' and pronamespace = 'public'::regnamespace) = 1);
  perform pg_temp.report('T5 (Driver RPCs do not expose acquisition: no driver_* function returns an acquisition column)',
    not exists (select 1 from pg_proc p where p.proname like 'driver\_%' and pronamespace = 'public'::regnamespace and pg_get_function_result(p.oid) ~* '(utm_|landing_path|referrer_host|form_version)'));
end $$;

-- ---------------------------------------------------------------------------
-- Cleanup (always)
-- ---------------------------------------------------------------------------
do $$
declare v_ids uuid[];
begin
  select array_agg(r.id) into v_ids from public.transportation_requests r join public.request_intake_integrations i on i.id = r.intake_integration_id where i.external_id like 's4c-%';
  delete from public.notification_events where entity_id = any (coalesce(v_ids, '{}'));
  delete from public.request_acquisition_attributions where request_id = any (coalesce(v_ids, '{}'));
  delete from public.request_events where request_id = any (coalesce(v_ids, '{}'));
  delete from public.transportation_requests where id = any (coalesce(v_ids, '{}'));
  delete from public.public_intake_rate_limit_events where true;
  delete from public.request_intake_integrations where external_id like 's4c-%';
  raise notice 'CLEANUP: s4c requests left %, integrations left %',
    (select count(*) from public.transportation_requests where pickup_description like 'S4C TEST%'), (select count(*) from public.request_intake_integrations where external_id like 's4c-%');
end $$;
