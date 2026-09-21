-- P1-PILOT-S4C -- Website Intake ACQUISITION ATTRIBUTION foundation.
--
-- Preserves the business acquisition context (UTM source / medium / campaign / content / term, landing
-- and submission PATHS, referrer HOST, form version) that arrives WITH a website transportation
-- Request, as an immutable factual snapshot attached to that Request. No analytics, no dashboards,
-- no guessed classification (Paid / Organic / Direct ...): facts only.
--
-- DESIGN (all under the P1-SEC-01 privilege baseline)
--   * NEW TABLE public.request_acquisition_attributions: one snapshot per Request (unique request_id),
--     organization-aware composite FK to transportation_requests(id, organization_id) so the snapshot's
--     organization can never differ from its Request's. RLS ENABLED with NO policies (default deny) and
--     NO privilege for anon / authenticated / service_role: class A (server / RPC only) in the privilege
--     contract. Written only by the SECURITY DEFINER intake function (as owner); read only through the
--     controlled RPC get_request_acquisition. No trigger, no audit event: request creation is the business
--     event and campaign strings are not copied into immutable audit metadata.
--   * submit_public_transportation_request gains ONE optional trailing parameter p_acquisition jsonb.
--     The old 21-argument signature is DROPPED and recreated with the new trailing default, so there is
--     never an ambiguous overload for PostgREST; every existing caller (positional or named, no
--     acquisition) keeps working unchanged. EXECUTE is restated explicitly: service_role only.
--   * BEST-EFFORT RULE: sanitising and storing attribution runs in a sub-transaction after the Request row
--     exists; unknown keys are ignored, malformed values are dropped, and even an unexpected failure only
--     raises a content-free warning. A valid Request can never be refused because of attribution. If no
--     valid value survives, no snapshot row is created.
--   * IDEMPOTENCY: attribution is written ONLY on the genuinely-new-row path. A replay (same integration +
--     idempotency key) returns the original Request, creates no second attribution and never rewrites the
--     original values, exactly like every other field of the original submission.
--   * PRIVACY: no IP, user agent, fingerprint, cookie, session id, full URL, query string or click id is
--     accepted; paths must be pathnames, the referrer must be a bare hostname, arbitrary JSON is not stored.
--     Not exposed to Drivers, Platform Admin (no tenant content), notifications or audit.
--   * NO BACKFILL: historical Requests have no snapshot; absence means "no acquisition information recorded".
--
-- Deploy order: apply this migration BEFORE (or together with) the application that sends p_acquisition.
-- The previous application keeps working after the migration (the parameter has a default).

-- =============================================================================
-- 1. Table
-- =============================================================================
create table public.request_acquisition_attributions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  request_id uuid not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_path text,
  submission_path text,
  referrer_host text,
  form_version text,
  created_at timestamptz not null default now(),
  -- One immutable snapshot per Request.
  constraint request_acquisition_attributions_request_id_key unique (request_id),
  -- The snapshot belongs to the SAME organization as its Request (schema-level, not RLS-trusted).
  constraint request_acquisition_attributions_request_fkey
    foreign key (request_id, organization_id) references public.transportation_requests (id, organization_id),
  unique (id, organization_id),
  -- A snapshot with no value at all is meaningless: it must not exist.
  constraint request_acquisition_attributions_not_empty check (
    coalesce(utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path, submission_path, referrer_host, form_version) is not null
  ),
  constraint request_acquisition_attributions_lengths check (
    (utm_source is null or (char_length(utm_source) between 1 and 120))
    and (utm_medium is null or (char_length(utm_medium) between 1 and 120))
    and (utm_campaign is null or (char_length(utm_campaign) between 1 and 160))
    and (utm_content is null or (char_length(utm_content) between 1 and 160))
    and (utm_term is null or (char_length(utm_term) between 1 and 160))
    and (landing_path is null or (char_length(landing_path) between 1 and 300))
    and (submission_path is null or (char_length(submission_path) between 1 and 300))
    and (referrer_host is null or (char_length(referrer_host) between 1 and 253))
    and (form_version is null or (char_length(form_version) between 1 and 64))
  ),
  constraint request_acquisition_attributions_paths check (
    (landing_path is null or (landing_path ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$' and landing_path not like '//%'))
    and (submission_path is null or (submission_path ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$' and submission_path not like '//%'))
  ),
  constraint request_acquisition_attributions_referrer_host check (
    referrer_host is null or (referrer_host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' and referrer_host not like '%..%' and referrer_host not like '%-.%' and referrer_host not like '%.-%')
  ),
  constraint request_acquisition_attributions_form_version check (
    form_version is null or form_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
);

comment on table public.request_acquisition_attributions is
  'TENANT-OWNED, immutable. One factual acquisition snapshot per website Request (UTM fields, landing/submission PATH, referrer HOST, form version) captured with the ORIGINAL submission. No client, anon or service_role privilege (privilege contract class A): written only by submit_public_transportation_request (owner), read only through get_request_acquisition. Never edited, never backfilled, never copied to Trip, notifications or audit. Absence of a row means no acquisition information was recorded -- not "direct" or "unknown". Guessed classifications (paid / organic / social / direct) are deliberately NOT stored.';

create index request_acquisition_attributions_organization_id_idx on public.request_acquisition_attributions (organization_id);

create trigger request_acquisition_attributions_prevent_org_change
  before update on public.request_acquisition_attributions
  for each row execute function public.prevent_organization_id_change();

alter table public.request_acquisition_attributions enable row level security;
-- No policy on purpose (default deny), like every server/RPC-only table in this schema. Privileges: none.
revoke all on table public.request_acquisition_attributions from public, anon, authenticated, service_role;

-- =============================================================================
-- 2. Sanitiser (internal): never raises, never trusts, returns only valid known fields or NULL
-- =============================================================================
create function public._sanitize_acquisition(p_acquisition jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_out jsonb := '{}'::jsonb;
  r record;
  v_text text;
begin
  -- Anything that is not a JSON object (null, array, string, number) carries no attribution.
  if p_acquisition is null or jsonb_typeof(p_acquisition) <> 'object' then
    return null;
  end if;

  -- UTM fields: trimmed, non-empty, bounded, no control characters; case preserved.
  for r in select * from (values ('utmSource', 120), ('utmMedium', 120), ('utmCampaign', 160), ('utmContent', 160), ('utmTerm', 160)) as t(k, mx) loop
    if jsonb_typeof(p_acquisition -> r.k) = 'string' then
      v_text := regexp_replace(p_acquisition ->> r.k, '^\s+|\s+$', '', 'g');
      if v_text <> '' and char_length(v_text) <= r.mx and v_text !~ '[[:cntrl:]]' then
        v_out := v_out || jsonb_build_object(r.k, v_text);
      end if;
    end if;
  end loop;

  -- Paths: pathname only (leading /, no scheme, host, query, fragment, protocol-relative // or whitespace).
  for r in select * from (values ('landingPath'), ('submissionPath')) as t(k) loop
    if jsonb_typeof(p_acquisition -> r.k) = 'string' then
      v_text := regexp_replace(p_acquisition ->> r.k, '^\s+|\s+$', '', 'g');
      if char_length(v_text) between 1 and 300
         and v_text ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$'
         and v_text not like '//%' then
        v_out := v_out || jsonb_build_object(r.k, v_text);
      end if;
    end if;
  end loop;

  -- Referrer: bare hostname only (no protocol, port, path, query); hostnames are case-insensitive -> lowercased.
  if jsonb_typeof(p_acquisition -> 'referrerHost') = 'string' then
    v_text := lower(regexp_replace(p_acquisition ->> 'referrerHost', '^\s+|\s+$', '', 'g'));
    if char_length(v_text) between 1 and 253 and v_text ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' and v_text not like '%..%' and v_text not like '%-.%' and v_text not like '%.-%' then
      v_out := v_out || jsonb_build_object('referrerHost', v_text);
    end if;
  end if;

  -- Form version: short safe identifier.
  if jsonb_typeof(p_acquisition -> 'formVersion') = 'string' then
    v_text := regexp_replace(p_acquisition ->> 'formVersion', '^\s+|\s+$', '', 'g');
    if char_length(v_text) between 1 and 64 and v_text ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' then
      v_out := v_out || jsonb_build_object('formVersion', v_text);
    end if;
  end if;

  if v_out = '{}'::jsonb then
    return null;
  end if;
  return v_out;
end;
$$;

comment on function public._sanitize_acquisition(jsonb) is
  'INTERNAL. Reduces an untrusted acquisition object to the closed set of valid fields (UTM x5, landingPath, submissionPath, referrerHost, formVersion); unknown keys ignored, invalid values dropped, NULL when nothing valid remains. Never raises. Mirrored by src/lib/public-intake/website-intake-core.ts. No client / service EXECUTE.';

revoke all on function public._sanitize_acquisition(jsonb) from public, anon, authenticated, service_role;

-- =============================================================================
-- 3. Intake function: replace (drop + create) with the optional trailing p_acquisition
-- =============================================================================
drop function public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text, text[], date, date, time without time zone, boolean, text);

create function public.submit_public_transportation_request(p_integration_external_id text, p_idempotency_key text, p_requester_name text, p_requester_relationship text, p_requester_phone text, p_pickup_description text, p_destination_description text, p_return_trip_needed text, p_requester_email text DEFAULT NULL::text, p_preferred_date date DEFAULT NULL::date, p_preferred_time time without time zone DEFAULT NULL::time without time zone, p_assistance_notes text DEFAULT NULL::text, p_additional_notes text DEFAULT NULL::text, p_origin text DEFAULT NULL::text, p_service_type text DEFAULT NULL::text, p_recurring_days_of_week text[] DEFAULT NULL::text[], p_recurring_start_date date DEFAULT NULL::date, p_recurring_end_date date DEFAULT NULL::date, p_recurring_appointment_time time without time zone DEFAULT NULL::time without time zone, p_recurring_return_trip_expected boolean DEFAULT NULL::boolean, p_requested_passenger_name text DEFAULT NULL::text, p_acquisition jsonb DEFAULT NULL::jsonb)
 RETURNS public_request_submission_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_integration public.request_intake_integrations%rowtype;
  v_idempotency_key text;
  v_requester_name text;
  v_requester_phone text;
  v_requester_email text;
  v_pickup_description text;
  v_destination_description text;
  v_assistance_notes text;
  v_additional_notes text;
  v_service_type text;
  v_recurring_days_of_week smallint[];
  v_requested_passenger_name text;
  v_request_id uuid;
  v_result public.public_request_submission_result;
  v_acquisition jsonb;
begin
  -- -----------------------------------------------------------------------
  -- Deliberately NO `auth.uid() is null` check — unlike every other
  -- mutation RPC in this schema, this one MUST work for a genuinely
  -- anonymous caller (auth.uid() is always NULL for `anon`). Authorization
  -- here is entirely "does p_integration_external_id name an active
  -- integration" — checked below — never an identity check.
  -- -----------------------------------------------------------------------

  -- -----------------------------------------------------------------------
  -- Tenant resolution: the ONLY input that selects an organization.
  -- No p_organization_id parameter exists anywhere in this function's
  -- signature — structurally impossible for a caller to "redirect" a
  -- submission into a different tenant by tampering with any field,
  -- since no field ever names a tenant directly. A nonexistent
  -- external_id and a disabled integration raise the IDENTICAL error
  -- (invalid_input, ZW006) — no existence oracle, exactly mirroring
  -- has_org_role's own "not_found is not_found, regardless of why"
  -- contract used everywhere else in this schema.
  -- -----------------------------------------------------------------------
  if p_integration_external_id is null or btrim(p_integration_external_id) = '' or length(btrim(p_integration_external_id)) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_integration
  from public.request_intake_integrations
  where external_id = btrim(p_integration_external_id)
    and integration_type = 'website';

  if not found or v_integration.is_active is not true then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- R4E: a tenant that Nemryn has suspended (organizations.status <> 'active')
  -- accepts no new public Requests. Same generic invalid_input as any other
  -- rejection -- the public caller can not tell "suspended" from "unknown" or
  -- "disabled". FOR SHARE makes this strict against a concurrent suspension
  -- (the platform status change takes the row lock FOR UPDATE), so no Request
  -- is created after a suspension has committed.
  perform 1 from public.organizations o
  where o.id = v_integration.organization_id and o.status = 'active'
  for share;
  if not found then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Secondary control only (see the column's own comment) — checked
  -- only when the integration has actually configured an allow-list.
  -- Never the authorization boundary; the block above already fully
  -- resolved and validated the tenant before this runs.
  if v_integration.allowed_origins is not null and array_length(v_integration.allowed_origins, 1) > 0 then
    if p_origin is null or not (p_origin = any (v_integration.allowed_origins)) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  -- -----------------------------------------------------------------------
  -- Idempotency key: required, bounded. This is the sole idempotency
  -- input — see section B's own comment for the full mechanism (a
  -- partial unique index on (intake_integration_id,
  -- external_submission_ref), enforced by ON CONFLICT below, never a
  -- client-side disabled-button state).
  -- -----------------------------------------------------------------------
  v_idempotency_key := nullif(btrim(p_idempotency_key), '');
  if v_idempotency_key is null or length(v_idempotency_key) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- Field validation — IDENTICAL bounds to log_transportation_request's
  -- own validation (20260916100000_request_mutation_foundation.sql),
  -- deliberately kept in exact sync rather than diverging: a public
  -- Request and a staff-entered Request must satisfy the same minimum
  -- save contract. No passenger_id parameter exists at all (public
  -- intake must never auto-link/auto-create/auto-merge a Passenger —
  -- locked product decision); no medical intake fields.
  -- -----------------------------------------------------------------------
  v_requester_name := nullif(btrim(p_requester_name), '');
  if v_requester_name is null or length(v_requester_name) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_requester_relationship not in ('self', 'family', 'caregiver', 'facility_coordinator', 'other') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_requester_phone := nullif(btrim(p_requester_phone), '');
  if v_requester_phone is null or length(v_requester_phone) > 50 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_requester_email := nullif(btrim(p_requester_email), '');
  if v_requester_email is not null and length(v_requester_email) > 320 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_pickup_description := nullif(btrim(p_pickup_description), '');
  v_destination_description := nullif(btrim(p_destination_description), '');
  if v_pickup_description is null or v_destination_description is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if length(v_pickup_description) > 2000 or length(v_destination_description) > 2000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_return_trip_needed not in ('yes', 'no', 'not_sure') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_assistance_notes := nullif(btrim(p_assistance_notes), '');
  if v_assistance_notes is not null and length(v_assistance_notes) > 4000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_additional_notes := nullif(btrim(p_additional_notes), '');
  if v_additional_notes is not null and length(v_additional_notes) > 4000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- requestedPassengerName (P1-PILOT-S4B-R2A) — optional free-text
  -- snapshot, same bound as requester_name (200 chars). Deliberately NOT
  -- validated against, matched to, or used to create/find any row in
  -- public.passengers — this value is stored on the Request row ONLY.
  -- -----------------------------------------------------------------------
  v_requested_passenger_name := nullif(btrim(p_requested_passenger_name), '');
  if v_requested_passenger_name is not null and length(v_requested_passenger_name) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- serviceType (P1-PILOT-S4B-R2) — optional (backward compatible with a
  -- future, non-Zenward integration that never sends it), but when
  -- present must be exactly one of the closed allow-list values. Never
  -- coerced to 'other' — an unrecognized value is rejected outright,
  -- matching every other enum field in this function.
  -- -----------------------------------------------------------------------
  v_service_type := nullif(btrim(p_service_type), '');
  if v_service_type is not null and v_service_type not in (
    'medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
    'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- Tenant service offerings (P1-PILOT-S4B-R4C) -- the ONLY behavioral
  -- change to this function. Backwards compatible by construction: an
  -- organization with NO rows in organization_service_offerings has never
  -- explicitly configured what it provides, so intake behaves exactly as
  -- before. Once an admin has saved a configuration (the setter guarantees
  -- at least one enabled service, so "has rows" == "configured"), it is
  -- authoritative: a submitted serviceType the tenant has not enabled is
  -- rejected with the SAME generic invalid_input as every other rejection
  -- (no existence oracle, no new public error). A submission that sends no
  -- serviceType (the field is optional) is unaffected. The organization is
  -- still resolved solely from the integration row above -- nothing the
  -- caller sends can select which offerings are consulted.
  -- -----------------------------------------------------------------------
  if v_service_type is not null
     and exists (select 1 from public.organization_service_offerings o where o.organization_id = v_integration.organization_id)
     and not exists (
       select 1 from public.organization_service_offerings o
       where o.organization_id = v_integration.organization_id and o.service_type = v_service_type
     ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- recurringSchedule (P1-PILOT-S4B-R2) — optional. Absent entirely
  -- (p_recurring_days_of_week IS NULL) means a one-time request, exactly
  -- as before this migration. When present: 1-7 distinct lowercase
  -- weekday-name strings from the fixed set below (the WIRE contract
  -- uses day NAMES, matching Zenward-Web's own `Weekday` type
  -- byte-for-byte; converted here to the canonical ISO weekday-number
  -- smallint[] this table's own recurring_days_of_week column and
  -- recurring_arrangements' own days_of_week already use). This
  -- describes what the requester WANTS ONLY — no Trip, no
  -- recurring_arrangements row, is ever created here.
  -- -----------------------------------------------------------------------
  if p_recurring_days_of_week is not null then
    if p_recurring_start_date is null then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    if cardinality(p_recurring_days_of_week) < 1 or cardinality(p_recurring_days_of_week) > 7 then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    if exists (
      select 1 from unnest(p_recurring_days_of_week) as d
      where d is null or d not in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
    ) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    if (select count(distinct d) from unnest(p_recurring_days_of_week) as d) <> cardinality(p_recurring_days_of_week) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;

    select array_agg(distinct case d
      when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3 when 'thursday' then 4
      when 'friday' then 5 when 'saturday' then 6 when 'sunday' then 7
    end order by case d
      when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3 when 'thursday' then 4
      when 'friday' then 5 when 'saturday' then 6 when 'sunday' then 7
    end)
    into v_recurring_days_of_week
    from unnest(p_recurring_days_of_week) as d;

    if not public._is_canonical_days_of_week(v_recurring_days_of_week) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  elsif p_recurring_start_date is not null then
    -- start_date without days_of_week is malformed (mirrors the table's
    -- own atomic CHECK) — reject rather than silently drop.
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_recurring_end_date is not null and p_recurring_start_date is not null and p_recurring_end_date < p_recurring_start_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- The Request itself. organization_id is v_integration.organization_id
  -- — resolved internally two steps above, never a parameter. state is
  -- hard-coded 'pending' and source is hard-coded 'web' — neither is
  -- ever a parameter. passenger_id is never set (omitted entirely —
  -- defaults to its own column default of NULL) — requested_passenger_
  -- name is a PLAIN COLUMN on this same row, never a value that touches
  -- passenger_id, and never used to look up, match, or create any row in
  -- public.passengers.
  --
  -- Idempotency: ON CONFLICT targets the exact partial unique index from
  -- the S4A foundation migration. Two concurrent identical submissions
  -- (same integration, same idempotency key) are safe purely from this
  -- single atomic statement. requested_passenger_name is just one more
  -- column on the SAME row — it does not change this mechanism at all,
  -- and a replay with a DIFFERENT requested_passenger_name never updates
  -- the already-committed row (ON CONFLICT DO NOTHING, not DO UPDATE).
  -- -----------------------------------------------------------------------
  insert into public.transportation_requests (
    organization_id, requester_name, requester_relationship, requester_phone, requester_email,
    pickup_description, destination_description, preferred_date, preferred_time,
    return_trip_needed, assistance_notes, additional_notes, source, state,
    intake_integration_id, external_submission_ref,
    service_type, recurring_days_of_week, recurring_start_date, recurring_end_date,
    recurring_appointment_time, recurring_return_trip_expected,
    requested_passenger_name
  ) values (
    v_integration.organization_id, v_requester_name, p_requester_relationship, v_requester_phone, v_requester_email,
    v_pickup_description, v_destination_description, p_preferred_date, p_preferred_time,
    p_return_trip_needed, v_assistance_notes, v_additional_notes, 'web', 'pending',
    v_integration.id, v_idempotency_key,
    v_service_type, v_recurring_days_of_week, p_recurring_start_date, p_recurring_end_date,
    p_recurring_appointment_time, p_recurring_return_trip_expected,
    v_requested_passenger_name
  )
  on conflict (intake_integration_id, external_submission_ref)
    where intake_integration_id is not null and external_submission_ref is not null
  do nothing
  returning id into v_request_id;

  if v_request_id is null then
    -- Idempotent replay: another (possibly concurrent) call with the
    -- SAME integration + idempotency key already created the row. Never
    -- treated as an error — the caller's own submission was received
    -- exactly once either way. The FIRST accepted submission's own
    -- requested_passenger_name (and every other field) is preserved
    -- unchanged; this replay's own (possibly different) value is
    -- discarded, never applied as an update.
    select id into v_request_id
    from public.transportation_requests
    where intake_integration_id = v_integration.id and external_submission_ref = v_idempotency_key;
  else
    -- Only logged for the genuinely-new-row path — a replay never
    -- produces a second request_events row. actor_user_id is NULL (no
    -- authenticated identity exists for this caller). No PII/free-text
    -- field is copied into metadata — only the safe, internal
    -- integration id (requested_passenger_name is NOT logged here
    -- either, same reasoning as serviceType/recurringSchedule: it lives
    -- on the Request row itself already).
    insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata)
    values (
      v_integration.organization_id, v_request_id, 'request_logged', null,
      jsonb_build_object('source', 'web', 'intake_integration_id', v_integration.id)
    );

    -- P1-PILOT-S4C: optional acquisition attribution SNAPSHOT for this genuinely-new
    -- Request, written in THIS transaction by the function owner (service_role needs
    -- no table privilege). Best-effort by design: a valid Request must NEVER fail
    -- because of marketing attribution, so sanitising and storing happen inside a
    -- sub-transaction whose failure only downgrades to a warning (no content logged).
    -- Reaching here only on the new-row path means an idempotent replay can never add,
    -- change or duplicate attribution; unique(request_id) is the backstop.
    begin
      v_acquisition := public._sanitize_acquisition(p_acquisition);
      if v_acquisition is not null then
        insert into public.request_acquisition_attributions (
          organization_id, request_id,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          landing_path, submission_path, referrer_host, form_version
        ) values (
          v_integration.organization_id, v_request_id,
          v_acquisition ->> 'utmSource', v_acquisition ->> 'utmMedium', v_acquisition ->> 'utmCampaign',
          v_acquisition ->> 'utmContent', v_acquisition ->> 'utmTerm',
          v_acquisition ->> 'landingPath', v_acquisition ->> 'submissionPath',
          v_acquisition ->> 'referrerHost', v_acquisition ->> 'formVersion'
        )
        on conflict (request_id) do nothing;
      end if;
    exception when others then
      raise warning 'website intake: acquisition attribution not stored';
    end;

    -- P1-PILOT-S4B-R4D: durable notification event, written in THIS transaction
    -- and ONLY on the genuinely-new-row path (an idempotent replay never reaches
    -- here, so it can never notify twice). Recipients are resolved LIVE at
    -- dispatch time; no address or Request content is copied into the event.
    v_result.notification_event_id := public._enqueue_notification_event(
      v_integration.organization_id, 'website_request', 'transportation_request', v_request_id
    );
  end if;

  v_result.accepted := true;
  return v_result;
end;
$function$;

comment on function public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) is
  'SERVER-ONLY (service_role). The sole path by which a Request can be created via public tenant-website intake -- reachable ONLY through the Nemryn-owned Route Handler. No organization_id parameter: the organization is resolved entirely from p_integration_external_id. state always pending, source always web; no passenger_id, no Trip. Idempotent per (integration, idempotency key). When the resolved organization has configured service offerings, a supplied p_service_type it has not enabled is rejected with the same generic invalid_input. R4D: on the genuinely-new path only, a notification_events row is enqueued in the same transaction and its id returned (notification_event_id); replays return null. S4C: optional p_acquisition jsonb (UTM / landing+submission path / referrer host / form version) is sanitised and stored as one immutable snapshot on the genuinely-new path only, best-effort -- it can never cause a valid Request to be rejected, an invalid or absent value creates no snapshot, a replay never adds or rewrites one. Every rejection is the identical invalid_input (ZW006) -- no existence oracle.';

revoke all on function public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) to service_role;

-- =============================================================================
-- 4. Controlled read: Organization Admin / Dispatcher of the Request's organization only
-- =============================================================================
create function public.get_request_acquisition(p_organization_id uuid, p_request_id uuid)
returns table (
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  landing_path text, submission_path text, referrer_host text, form_version text,
  captured_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  -- Same authorization semantics as the Request Hub: Organization Admin or Dispatcher of THIS organization
  -- (active Membership, active organization). Driver, inactive Membership, foreign organization and a
  -- Platform Admin without a Membership are the identical ZW002 (no existence oracle).
  if p_organization_id is null or p_request_id is null
     or not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Zero rows = no acquisition information recorded (or not this organization's Request).
  return query
  select a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.utm_term,
         a.landing_path, a.submission_path, a.referrer_host, a.form_version, a.created_at
  from public.request_acquisition_attributions a
  where a.organization_id = p_organization_id and a.request_id = p_request_id;
end;
$$;

comment on function public.get_request_acquisition(uuid, uuid) is
  'Organization Admin / Dispatcher of p_organization_id only (Driver, inactive, foreign organization, Platform Admin without Membership: ZW002). Returns the single immutable acquisition snapshot of that Request, or zero rows when none was recorded. The raw table has no client privilege; this is the only read path.';

revoke all on function public.get_request_acquisition(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_request_acquisition(uuid, uuid) to authenticated;
