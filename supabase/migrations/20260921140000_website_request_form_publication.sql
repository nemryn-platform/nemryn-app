-- =============================================================================
-- P1-COMM-D2 -- Universal Website Request Form: PUBLICATION + public form primitives
-- =============================================================================
-- FORM CONFIGURATION != PUBLICATION.
--   website_request_forms              (D1) = "what should our passenger form contain?" (authoring, Draft / Ready)
--   website_request_form_publications  (D2) = "where / how is that form publicly available?" (Published / Disabled)
--   request_intake_integrations             = the delivery BINDING every Request already hangs off (provenance, idempotency)
-- A publication carries an immutable-per-publish SNAPSHOT of the form content and the version it was published at, so what a
-- passenger sees, and the S4C formVersion recorded with their Request, never changes underneath them when an Admin edits the form.
--
-- INTAKE BINDING. A publication owns one hidden request_intake_integrations row of the NEW integration_type 'nemryn_form'
-- (no allowed_origins; created/reused by publish_website_request_form, never by the operator). Every existing website path
-- (submit_public_transportation_request, CORS, Platform Admin health, the operator's connection list) filters
-- integration_type = 'website', so a form binding can NEVER be reached through the website-origin endpoint, and a website
-- integration can never be reached through the public form. No Origin is fabricated anywhere.
--
-- REQUEST CREATION. The canonical creation logic is NOT duplicated: the body of submit_public_transportation_request after
-- tenant/origin resolution is extracted, unchanged, into the owner-only primitive _create_public_request(integration id, ...).
-- Both delivery modes call it: (A) website intake (after its integration + suspension + Origin checks) and (B) the published
-- Nemryn form (after its publication + suspension + snapshot checks).
--
-- SEC-01: new table = class A (RLS on, no policy, every privilege revoked incl. service_role). New authenticated RPCs (Org Admin
-- only): get_website_request_form_publication, publish_website_request_form, disable_website_request_form_publication. New
-- service_role RPCs (exactly these two, EXECUTE only): get_public_request_form, submit_public_form_request. Internal, no grant:
-- _create_public_request, _public_form_service_types.

-- =============================================================================
-- 1. Binding type
-- =============================================================================
alter table public.request_intake_integrations drop constraint request_intake_integrations_integration_type_check;
alter table public.request_intake_integrations
  add constraint request_intake_integrations_integration_type_check check (integration_type in ('website', 'nemryn_form'));
alter table public.request_intake_integrations
  add constraint request_intake_integrations_form_binding_no_origins check (integration_type <> 'nemryn_form' or allowed_origins is null);

-- The operator's connection list shows website connections only; the form binding is an internal delivery detail.
create or replace function public.list_request_intake_integrations(p_organization_id uuid)
returns table (
  id uuid, integration_type text, external_id text, is_active boolean, allowed_origins text[],
  created_at timestamptz, request_count bigint, last_request_received_at timestamptz,
  connection_method text, website_manager text
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

  if p_organization_id is null
     or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  return query
  select i.id, i.integration_type, i.external_id, i.is_active, i.allowed_origins, i.created_at,
         count(r.id)::bigint,
         max(r.created_at),
         i.connection_method, i.website_manager
  from public.request_intake_integrations i
  left join public.transportation_requests r
    on r.intake_integration_id = i.id and r.organization_id = i.organization_id
  where i.organization_id = p_organization_id
    and i.integration_type = 'website'
  group by i.id
  order by i.created_at, i.id;
end;
$$;
revoke all on function public.list_request_intake_integrations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_request_intake_integrations(uuid) to authenticated;

-- =============================================================================
-- 2. Publication table
-- =============================================================================
create table public.website_request_form_publications (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  form_id uuid not null,
  intake_integration_id uuid not null,
  -- Opaque addressing identifier (NOT a secret; the form is intentionally public): 'form_' + 128 bits of CSPRNG as hex.
  public_key text not null,
  status text not null default 'published' check (status in ('published', 'disabled')),
  -- The SNAPSHOT a passenger sees (copied from website_request_forms at publish time).
  published_version integer not null check (published_version >= 1),
  -- Every version ever published under this key: a passenger may still hold an older published version open.
  published_versions integer[] not null,
  title text not null,
  intro_text text,
  submit_label text not null,
  confirmation_message text not null,
  offered_service_types text[],
  allow_recurring boolean not null,
  require_service_choice boolean not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- MVP: ONE publication per form (and one form per organization). IDs / composite keys keep this expandable.
  constraint website_request_form_publications_form_id_key unique (form_id),
  constraint website_request_form_publications_integration_key unique (intake_integration_id),
  constraint website_request_form_publications_public_key_key unique (public_key),
  unique (id, organization_id),
  constraint website_request_form_publications_form_fk foreign key (form_id, organization_id) references public.website_request_forms (id, organization_id),
  constraint website_request_form_publications_integration_fk foreign key (intake_integration_id, organization_id) references public.request_intake_integrations (id, organization_id),
  constraint website_request_form_publications_public_key_format check (public_key ~ '^form_[0-9a-f]{32}$'),
  constraint website_request_form_publications_versions_check check (published_version = any (published_versions)),
  constraint website_request_form_publications_title_check check (char_length(title) between 1 and 120 and title !~ '[[:cntrl:]]'),
  constraint website_request_form_publications_submit_label_check check (char_length(submit_label) between 1 and 40 and submit_label !~ '[[:cntrl:]]'),
  constraint website_request_form_publications_confirmation_check check (
    char_length(confirmation_message) between 1 and 400 and regexp_replace(confirmation_message, E'[\\n\\r]', '', 'g') !~ '[[:cntrl:]]'),
  constraint website_request_form_publications_intro_check check (
    intro_text is null or (char_length(intro_text) between 1 and 600 and regexp_replace(intro_text, E'[\\n\\r]', '', 'g') !~ '[[:cntrl:]]')),
  constraint website_request_form_publications_services_check check (
    offered_service_types is null or (cardinality(offered_service_types) >= 1
      and offered_service_types <@ array['medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge', 'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other']::text[]))
);

alter table public.website_request_form_publications enable row level security;
revoke all on table public.website_request_form_publications from public, anon, authenticated, service_role;

comment on table public.website_request_form_publications is
  'P1-COMM-D2. WHERE/HOW the organization''s Nemryn form is publicly available (Published | Disabled; "Not published" = no row). Carries the published SNAPSHOT + version so a passenger''s formVersion evidence never lies. Class A: RLS on, no policy, NO privilege for anon / authenticated / service_role; read/written only by SECURITY DEFINER functions (Org Admin RPCs + the two service_role public-form RPCs).';

-- =============================================================================
-- 3. Internal helpers (no grant to any role)
-- =============================================================================
-- The services a published form may show/accept RIGHT NOW: the snapshot subset (or every canonical service) intersected with
-- what the organization currently offers (Services & Intake is the only source of truth; unconfigured = nothing restricted).
create function public._public_form_service_types(p_organization_id uuid, p_offered text[])
returns text[]
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(s.v order by s.ord), '{}'::text[])
  from unnest(array['medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge', 'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other']::text[])
       with ordinality as s(v, ord)
  where (p_offered is null or s.v = any (p_offered))
    and (not exists (select 1 from public.organization_service_offerings o where o.organization_id = p_organization_id)
         or exists (select 1 from public.organization_service_offerings o where o.organization_id = p_organization_id and o.service_type = s.v));
$$;
comment on function public._public_form_service_types(uuid, text[]) is
  'INTERNAL. Effective service list of a published form: snapshot subset (NULL = all) intersected with the organization''s current offerings (no rows = unrestricted), canonical order. No client / service EXECUTE.';
revoke all on function public._public_form_service_types(uuid, text[]) from public, anon, authenticated, service_role;

-- =============================================================================
-- 4. The canonical Request-creation primitive, extracted from submit_public_transportation_request
--    (everything AFTER tenant / suspension / Origin resolution, moved verbatim).
-- =============================================================================
create function public._create_public_request(p_integration_id uuid, p_idempotency_key text, p_requester_name text, p_requester_relationship text, p_requester_phone text,
  p_pickup_description text, p_destination_description text, p_return_trip_needed text,
  p_requester_email text default null, p_preferred_date date default null, p_preferred_time time without time zone default null,
  p_assistance_notes text default null, p_additional_notes text default null, p_service_type text default null,
  p_recurring_days_of_week text[] default null, p_recurring_start_date date default null, p_recurring_end_date date default null,
  p_recurring_appointment_time time without time zone default null, p_recurring_return_trip_expected boolean default null,
  p_requested_passenger_name text default null, p_acquisition jsonb default null)
returns public.public_request_submission_result
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  select * into v_integration from public.request_intake_integrations where id = p_integration_id;
  if not found then
    raise exception 'invalid_input' using errcode = 'ZW006';
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

comment on function public._create_public_request(uuid, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) is
  'INTERNAL, owner-only (no client / service EXECUTE). The ONE canonical public-Request creation logic (field validation identical to log_transportation_request, tenant service offerings, recurring request description, idempotent insert per (integration, key), request_events, S4C attribution snapshot, notification enqueue). Callers must already have resolved and authorised the integration: submit_public_transportation_request (website: integration + suspension + Origin) and submit_public_form_request (published Nemryn form: publication + suspension + snapshot rules). Same generic invalid_input (ZW006) for every rejection.';
revoke all on function public._create_public_request(uuid, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) from public, anon, authenticated, service_role;

-- =============================================================================
-- 5. Website intake: unchanged behaviour, now delegating to the shared primitive
-- =============================================================================
create or replace function public.submit_public_transportation_request(p_integration_external_id text, p_idempotency_key text, p_requester_name text, p_requester_relationship text, p_requester_phone text, p_pickup_description text, p_destination_description text, p_return_trip_needed text, p_requester_email text DEFAULT NULL::text, p_preferred_date date DEFAULT NULL::date, p_preferred_time time without time zone DEFAULT NULL::time without time zone, p_assistance_notes text DEFAULT NULL::text, p_additional_notes text DEFAULT NULL::text, p_origin text DEFAULT NULL::text, p_service_type text DEFAULT NULL::text, p_recurring_days_of_week text[] DEFAULT NULL::text[], p_recurring_start_date date DEFAULT NULL::date, p_recurring_end_date date DEFAULT NULL::date, p_recurring_appointment_time time without time zone DEFAULT NULL::time without time zone, p_recurring_return_trip_expected boolean DEFAULT NULL::boolean, p_requested_passenger_name text DEFAULT NULL::text, p_acquisition jsonb DEFAULT NULL::jsonb)
 RETURNS public_request_submission_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_integration public.request_intake_integrations%rowtype;
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

  return public._create_public_request(
    p_integration_id => v_integration.id,
    p_idempotency_key => p_idempotency_key, p_requester_name => p_requester_name, p_requester_relationship => p_requester_relationship,
    p_requester_phone => p_requester_phone, p_pickup_description => p_pickup_description, p_destination_description => p_destination_description,
    p_return_trip_needed => p_return_trip_needed, p_requester_email => p_requester_email, p_preferred_date => p_preferred_date,
    p_preferred_time => p_preferred_time, p_assistance_notes => p_assistance_notes, p_additional_notes => p_additional_notes,
    p_service_type => p_service_type, p_recurring_days_of_week => p_recurring_days_of_week, p_recurring_start_date => p_recurring_start_date,
    p_recurring_end_date => p_recurring_end_date, p_recurring_appointment_time => p_recurring_appointment_time,
    p_recurring_return_trip_expected => p_recurring_return_trip_expected, p_requested_passenger_name => p_requested_passenger_name,
    p_acquisition => p_acquisition);
end;
$function$;

revoke all on function public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) to service_role;

-- =============================================================================
-- 6. Organization Admin RPCs: read / publish / disable
-- =============================================================================
create type public.website_request_form_publication_state as (
  public_key text, publication_status text, published_version integer, published_at timestamptz,
  request_count bigint, last_request_received_at timestamptz
);
create type public.website_request_form_publish_result as (
  public_key text, publication_status text, published_version integer, changed boolean
);

create function public.get_website_request_form_publication(p_organization_id uuid)
returns setof public.website_request_form_publication_state
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  return query
  select p.public_key, p.status, p.published_version, p.published_at,
         count(r.id)::bigint, max(r.created_at)
  from public.website_request_form_publications p
  left join public.transportation_requests r
    on r.intake_integration_id = p.intake_integration_id and r.organization_id = p.organization_id
  where p.organization_id = p_organization_id
  group by p.id;
end;
$$;
comment on function public.get_website_request_form_publication(uuid) is
  'Organization Admin of p_organization_id only (Dispatcher, Driver, inactive Membership, suspended or foreign organization, Platform Admin without Membership: ZW002). Returns the organization''s publication state (public key, Published | Disabled, published version, request count / last request received through the published form) or no row when never published. Never returns ids.';
revoke all on function public.get_website_request_form_publication(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_website_request_form_publication(uuid) to authenticated;

create function public.publish_website_request_form(p_organization_id uuid)
returns public.website_request_form_publish_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form public.website_request_forms%rowtype;
  v_pub public.website_request_form_publications%rowtype;
  v_integration_id uuid;
  v_external_id text;
  v_key text;
  v_attempt int := 0;
  v_result public.website_request_form_publish_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Serialise publish / disable per organization (parallel publishes converge on ONE publication + ONE binding).
  perform pg_advisory_xact_lock(hashtextextended('website_request_form_publication:' || p_organization_id::text, 0));

  select * into v_form from public.website_request_forms where organization_id = p_organization_id for share;
  if not found or v_form.status <> 'ready' then
    raise exception 'invalid_input' using errcode = 'ZW006';   -- a Draft (or missing) form can not be published
  end if;

  select * into v_pub from public.website_request_form_publications where form_id = v_form.id for update;

  if not found then
    -- First publish: create the hidden delivery binding + the publication. The operator never sees or creates either.
    loop
      v_attempt := v_attempt + 1;
      v_external_id := public._generate_intake_external_id();
      begin
        insert into public.request_intake_integrations (organization_id, external_id, integration_type, is_active, allowed_origins, connection_method)
        values (p_organization_id, v_external_id, 'nemryn_form', true, null, 'nemryn_form')
        returning id into v_integration_id;
        exit;
      exception when unique_violation then
        if v_attempt >= 5 then raise; end if;
      end;
    end loop;

    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      v_key := 'form_' || encode(extensions.gen_random_bytes(16), 'hex');
      begin
        insert into public.website_request_form_publications (
          organization_id, form_id, intake_integration_id, public_key, status, published_version, published_versions,
          title, intro_text, submit_label, confirmation_message, offered_service_types, allow_recurring, require_service_choice
        ) values (
          p_organization_id, v_form.id, v_integration_id, v_key, 'published', v_form.version, array[v_form.version],
          v_form.title, v_form.intro_text, v_form.submit_label, v_form.confirmation_message, v_form.offered_service_types,
          v_form.allow_recurring, v_form.require_service_choice
        ) returning * into v_pub;
        exit;
      exception when unique_violation then
        if v_attempt >= 5 then raise; end if;
      end;
    end loop;

    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
    values (p_organization_id, 'website_request_form_publication', v_pub.id, 'website_request_form_published', auth.uid(), null,
            jsonb_build_object('status', 'published', 'version', v_pub.published_version, 'first', true));

    v_result.public_key := v_pub.public_key; v_result.publication_status := v_pub.status;
    v_result.published_version := v_pub.published_version; v_result.changed := true;
    return v_result;
  end if;

  -- Already published at exactly the form's current version: an identical publish is a no-op (no audit, no rewrite).
  if v_pub.status = 'published' and v_pub.published_version = v_form.version then
    v_result.public_key := v_pub.public_key; v_result.publication_status := v_pub.status;
    v_result.published_version := v_pub.published_version; v_result.changed := false;
    return v_result;
  end if;

  update public.request_intake_integrations
  set is_active = true, connection_method = 'nemryn_form'
  where id = v_pub.intake_integration_id and organization_id = p_organization_id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'website_request_form_publication', v_pub.id, 'website_request_form_published', auth.uid(), null,
          jsonb_build_object('status', 'published', 'version', v_form.version,
                             'previous_status', v_pub.status, 'previous_version', v_pub.published_version));

  update public.website_request_form_publications
  set status = 'published',
      published_version = v_form.version,
      published_versions = case when v_form.version = any (published_versions) then published_versions else array_append(published_versions, v_form.version) end,
      title = v_form.title, intro_text = v_form.intro_text, submit_label = v_form.submit_label,
      confirmation_message = v_form.confirmation_message, offered_service_types = v_form.offered_service_types,
      allow_recurring = v_form.allow_recurring, require_service_choice = v_form.require_service_choice,
      published_at = now(), updated_at = now()
  where id = v_pub.id
  returning * into v_pub;

  v_result.public_key := v_pub.public_key; v_result.publication_status := v_pub.status;
  v_result.published_version := v_pub.published_version; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.publish_website_request_form(uuid) is
  'Organization Admin of an ACTIVE organization only (ZW002 otherwise). Requires the organization''s form to be Ready (ZW006 for Draft / missing). First call creates the hidden intake binding (integration_type nemryn_form) and the publication with a server-generated opaque public key, snapshotting the form; later calls publish an UPDATE (new snapshot + version) or re-enable a disabled publication under the SAME public key. Publishing the already-published current version is a no-op (changed=false, no audit). Editing the form never changes a live publication -- only this RPC does. Audit website_request_form_published.';
revoke all on function public.publish_website_request_form(uuid) from public, anon, authenticated, service_role;
grant execute on function public.publish_website_request_form(uuid) to authenticated;

create function public.disable_website_request_form_publication(p_organization_id uuid)
returns public.website_request_form_publish_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pub public.website_request_form_publications%rowtype;
  v_result public.website_request_form_publish_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('website_request_form_publication:' || p_organization_id::text, 0));

  select * into v_pub from public.website_request_form_publications where organization_id = p_organization_id for update;
  if not found then
    v_result.changed := false;   -- never published: nothing to disable
    return v_result;
  end if;

  v_result.public_key := v_pub.public_key; v_result.published_version := v_pub.published_version;
  if v_pub.status = 'disabled' then
    v_result.publication_status := 'disabled'; v_result.changed := false;
    return v_result;
  end if;

  update public.website_request_form_publications set status = 'disabled', updated_at = now() where id = v_pub.id;
  update public.request_intake_integrations set is_active = false
  where id = v_pub.intake_integration_id and organization_id = p_organization_id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'website_request_form_publication', v_pub.id, 'website_request_form_unpublished', auth.uid(), null,
          jsonb_build_object('status', 'disabled', 'version', v_pub.published_version));

  v_result.publication_status := 'disabled'; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.disable_website_request_form_publication(uuid) is
  'Organization Admin of an ACTIVE organization only. Disables the public form: the hosted URL and embed become unavailable and new submissions are rejected; the publication row (and every historical Request) is kept, and publishing again re-enables the same public key. Idempotent (already disabled / never published: changed=false). Audit website_request_form_unpublished.';
revoke all on function public.disable_website_request_form_publication(uuid) from public, anon, authenticated, service_role;
grant execute on function public.disable_website_request_form_publication(uuid) to authenticated;

-- =============================================================================
-- 7. Public (service_role only, via the Nemryn Route Handlers): read + submit
-- =============================================================================
create function public.get_public_request_form(p_public_key text)
returns table (
  organization_name text, title text, intro_text text, submit_label text, confirmation_message text,
  service_types text[], allow_recurring boolean, require_service_choice boolean, form_version integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := lower(btrim(coalesce(p_public_key, '')));
begin
  -- Malformed, unknown, unpublished, disabled and suspended-organization keys are indistinguishable: no rows.
  if v_key !~ '^form_[0-9a-f]{32}$' then
    return;
  end if;

  return query
  select o.name, p.title, p.intro_text, p.submit_label, p.confirmation_message,
         public._public_form_service_types(p.organization_id, p.offered_service_types),
         p.allow_recurring,
         (p.require_service_choice and cardinality(public._public_form_service_types(p.organization_id, p.offered_service_types)) > 0),
         p.published_version
  from public.website_request_form_publications p
  join public.organizations o on o.id = p.organization_id
  join public.request_intake_integrations i on i.id = p.intake_integration_id and i.organization_id = p.organization_id
  where p.public_key = v_key
    and p.status = 'published'
    and o.status = 'active'
    and i.integration_type = 'nemryn_form'
    and i.is_active;
end;
$$;
comment on function public.get_public_request_form(text) is
  'SERVER-ONLY (service_role). Returns the PUBLIC passenger-facing configuration of an ACTIVE published form (organization display name, snapshot copy, effective service list = snapshot subset intersected with current Services & Intake, recurring / service-choice flags, published version) or NO row for a malformed, unknown, unpublished, disabled or suspended-organization key -- all identical. Never returns an organization / form / integration id or any private setting.';
revoke all on function public.get_public_request_form(text) from public, anon, authenticated, service_role;
grant execute on function public.get_public_request_form(text) to service_role;

create function public.submit_public_form_request(p_public_key text, p_idempotency_key text, p_requester_name text, p_requester_relationship text, p_requester_phone text, p_pickup_description text, p_destination_description text, p_return_trip_needed text, p_requester_email text default null, p_preferred_date date default null, p_preferred_time time without time zone default null, p_assistance_notes text default null, p_additional_notes text default null, p_service_type text default null, p_recurring_days_of_week text[] default null, p_recurring_start_date date default null, p_recurring_end_date date default null, p_recurring_appointment_time time without time zone default null, p_recurring_return_trip_expected boolean default null, p_requested_passenger_name text default null, p_acquisition jsonb default null)
returns public.public_request_submission_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := lower(btrim(coalesce(p_public_key, '')));
  v_pub public.website_request_form_publications%rowtype;
  v_services text[];
  v_service text := nullif(btrim(p_service_type), '');
  v_declared integer;
  v_acq jsonb;
begin
  -- Tenant resolution: the ONLY input that selects an organization is the opaque public key. No organization / integration
  -- id parameter exists. Every rejection below is the identical invalid_input (no existence oracle).
  if v_key !~ '^form_[0-9a-f]{32}$' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- FOR SHARE: a concurrent publish / disable (FOR UPDATE) serialises with this submission.
  select * into v_pub from public.website_request_form_publications where public_key = v_key and status = 'published' for share;
  if not found then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  perform 1 from public.request_intake_integrations i
  where i.id = v_pub.intake_integration_id and i.organization_id = v_pub.organization_id
    and i.integration_type = 'nemryn_form' and i.is_active
  for share;
  if not found then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- A suspended organization accepts no new Requests (same rule as website intake; FOR SHARE vs the platform's FOR UPDATE).
  perform 1 from public.organizations o where o.id = v_pub.organization_id and o.status = 'active' for share;
  if not found then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- The submission must fit the PUBLISHED form: only services it currently offers, the service choice if required, and
  -- recurring requests only when the form allows them. (Organization service offerings are enforced again in the primitive.)
  v_services := public._public_form_service_types(v_pub.organization_id, v_pub.offered_service_types);
  if v_service is null then
    if v_pub.require_service_choice and cardinality(v_services) > 0 then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  elsif not (v_service = any (v_services)) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not v_pub.allow_recurring
     and (p_recurring_days_of_week is not null or p_recurring_start_date is not null or p_recurring_end_date is not null
          or p_recurring_appointment_time is not null or p_recurring_return_trip_expected is not null) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- formVersion is SERVER-authoritative evidence: the version the passenger's page rendered, but only if it really was one of
  -- this publication's published versions (a passenger may still hold the previous published version open); anything else is
  -- replaced by the current published version. A client can never make it name a version that was never published.
  v_acq := case when jsonb_typeof(p_acquisition) = 'object' then p_acquisition else '{}'::jsonb end;
  if jsonb_typeof(v_acq -> 'formVersion') = 'string' and (v_acq ->> 'formVersion') ~ '^nemryn-form-v[0-9]{1,9}$' then
    v_declared := substring(v_acq ->> 'formVersion' from '[0-9]+$')::integer;
  end if;
  if v_declared is null or not (v_declared = any (v_pub.published_versions)) then
    v_declared := v_pub.published_version;
  end if;
  v_acq := v_acq || jsonb_build_object('formVersion', 'nemryn-form-v' || v_declared::text);

  return public._create_public_request(
    p_integration_id => v_pub.intake_integration_id,
    p_idempotency_key => p_idempotency_key, p_requester_name => p_requester_name,
    p_requester_relationship => p_requester_relationship, p_requester_phone => p_requester_phone,
    p_pickup_description => p_pickup_description, p_destination_description => p_destination_description,
    p_return_trip_needed => p_return_trip_needed, p_requester_email => p_requester_email,
    p_preferred_date => p_preferred_date, p_preferred_time => p_preferred_time,
    p_assistance_notes => p_assistance_notes, p_additional_notes => p_additional_notes,
    p_service_type => v_service, p_recurring_days_of_week => p_recurring_days_of_week,
    p_recurring_start_date => p_recurring_start_date, p_recurring_end_date => p_recurring_end_date,
    p_recurring_appointment_time => p_recurring_appointment_time,
    p_recurring_return_trip_expected => p_recurring_return_trip_expected,
    p_requested_passenger_name => p_requested_passenger_name, p_acquisition => v_acq);
end;
$$;
comment on function public.submit_public_form_request(text, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) is
  'SERVER-ONLY (service_role). Creates a Request from a published Nemryn form through the shared canonical primitive. The organization is resolved solely from the opaque public key (no organization / integration id parameter); unknown, unpublished, disabled and suspended-organization keys, a service the form / organization does not offer, a missing required service choice and a recurring request on a form that does not allow them are all the identical invalid_input (ZW006). Idempotent per (form binding, idempotency key). The recorded S4C formVersion is server-authoritative (a client-declared version is honoured only if it was actually published). Never creates a Passenger, Trip or Recurring Arrangement.';
revoke all on function public.submit_public_form_request(text, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_public_form_request(text, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) to service_role;

-- =============================================================================
-- 8. Activity whitelist (+ published / unpublished)
-- =============================================================================
create or replace function public.list_activity_events(p_organization_id uuid, p_limit integer DEFAULT 30, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, occurred_at timestamp with time zone, action text, actor_name text, before_data jsonb, after_data jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_actions constant text[] := array[
    'organization_created', 'organization_settings_updated', 'organization_operating_schedule_updated',
    'organization_services_configured', 'organization_service_offerings_updated',
    'website_integration_created', 'website_integration_activated', 'website_integration_disabled',
    'website_integration_origin_updated',
    'staff_invitation_created', 'staff_invitation_resent', 'staff_invitation_cancelled', 'staff_invitation_accepted',
    'membership_role_changed', 'membership_deactivated', 'membership_reactivated',
    'notification_preferences_updated',
    'platform_organization_suspended', 'platform_organization_reactivated',
    'driver_self_linked', 'driver_self_reactivated',
    'website_request_form_updated', 'website_request_form_published', 'website_request_form_unpublished'
  ];
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  return query
  select a.id, a.occurred_at, a.action,
         case when a.action like 'platform\_%' then 'Nemryn'
              when a.actor_user_id is null then null
              else coalesce(nullif(btrim(p.display_name), ''), u.email::text) end,
         a.before_data, a.after_data
  from public.audit_events a
  left join public.user_profiles p on p.id = a.actor_user_id
  left join auth.users u on u.id = a.actor_user_id
  where a.organization_id = p_organization_id
    and a.action = any (c_actions)
    and (p_before_at is null or (a.occurred_at, a.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by a.occurred_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 51));
end;
$function$;

revoke all on function public.list_activity_events(uuid, integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_activity_events(uuid, integer, timestamptz, uuid) to authenticated;
