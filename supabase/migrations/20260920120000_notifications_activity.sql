-- P1-PILOT-S4B-R4D -- Notifications + Activity (tenant Settings).
--
-- A. NOTIFICATIONS. Two closed tables and a small set of definer functions:
--    * notification_events -- a DURABLE event written in the SAME transaction as
--      the business change that makes it true (a genuinely-new public website
--      Request; a newly reported TripException). It carries no recipient
--      address and no Request/Trip content -- only what happened, where, and the
--      delivery outcome (counts + a fixed-vocabulary reason). An idempotent
--      replay never reaches the enqueue, so it can never notify twice.
--    * organization_notification_settings -- per (organization, event) the STAFF
--      roles that receive it. No row = the code-level default; a row with an
--      empty array = explicitly off.
--    Dispatch is server-side and best-effort: claim_notification_dispatch
--    (service_role only) atomically flips pending -> dispatching (exactly one
--    claimer wins), resolves recipients from LIVE Membership state, and returns
--    a minimal payload; complete_notification_dispatch records the outcome. A
--    provider failure therefore never rolls back the business transaction and
--    is recorded honestly (failed/partial + a fixed reason, never provider text).
--    Only events Nemryn can identify at an authoritative moment are offered.
--    "Upcoming unassigned trip" and "Recurring care gap" need periodic
--    evaluation (no scheduler exists) and "Proof needs review" is a DERIVED read-
--    time state, not a persisted moment, so none of the three is offered.
-- B. ACTIVITY. list_activity_events projects the EXISTING audit_events (no
--    second audit table) for an Organization Admin, restricted to a whitelist of
--    administrative actions and paged by a (occurred_at, id) cursor.
-- Nothing here grants a client role INSERT/UPDATE/DELETE on any table.

-- =============================================================================
-- A1. notification_events
-- =============================================================================
create table public.notification_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  event_type text not null check (event_type in ('website_request', 'trip_exception')),
  entity_type text not null,
  entity_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'dispatching', 'sent', 'partial', 'failed', 'skipped')),
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  failure_reason text check (failure_reason is null or failure_reason in ('provider_error', 'not_configured', 'build_failed', 'unknown')),
  created_at timestamptz not null default now(),
  attempted_at timestamptz,
  completed_at timestamptz,
  unique (event_type, entity_id)
);

comment on table public.notification_events is
  'TENANT-OWNED, closed (RLS on, no policy, no grant). One row per notifiable business event, written in the same transaction as the event itself. Holds NO recipient address and NO Request/Trip content -- only the event reference and the delivery outcome (status, counts, a fixed-vocabulary failure_reason; never provider text). unique(event_type, entity_id) makes a duplicate notification for one entity structurally impossible.';

create index notification_events_org_created_idx on public.notification_events (organization_id, created_at desc);

alter table public.notification_events enable row level security;
revoke all on public.notification_events from anon, authenticated;

-- =============================================================================
-- A2. organization_notification_settings
-- =============================================================================
create table public.organization_notification_settings (
  organization_id uuid not null references public.organizations (id),
  event_type text not null check (event_type in ('website_request', 'trip_exception')),
  recipient_roles text[] not null
    check (recipient_roles <@ array['organization_admin', 'dispatcher']::text[]),
  updated_at timestamptz not null default now(),
  primary key (organization_id, event_type)
);

comment on table public.organization_notification_settings is
  'TENANT-OWNED, closed. Which STAFF roles receive each notification event. No row = the default for that event; a row with an empty array = explicitly off. Roles only -- never Drivers, never stored addresses (recipients are resolved from live Membership state at dispatch).';

alter table public.organization_notification_settings enable row level security;
revoke all on public.organization_notification_settings from anon, authenticated;

create or replace function public._notification_default_roles(p_event_type text)
returns text[]
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case p_event_type
    when 'website_request' then array['organization_admin']::text[]
    when 'trip_exception' then array['organization_admin', 'dispatcher']::text[]
  end;
$$;
revoke all on function public._notification_default_roles(text) from public, anon, authenticated;

-- Enqueue: called only from inside other SECURITY DEFINER business functions.
create or replace function public._enqueue_notification_event(
  p_organization_id uuid, p_event_type text, p_entity_type text, p_entity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.notification_events (organization_id, event_type, entity_type, entity_id)
  values (p_organization_id, p_event_type, p_entity_type, p_entity_id)
  on conflict (event_type, entity_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public._enqueue_notification_event(uuid, text, text, uuid) from public, anon, authenticated;

-- ---- return-type additions (the Route Handler / server actions need the id) ----
alter type public.public_request_submission_result add attribute notification_event_id uuid;
alter type public.trip_exception_result add attribute notification_event_id uuid;

comment on type public.public_request_submission_result is
  'Return shape for submit_public_transportation_request. `accepted` is true both for a genuinely new Request and for an idempotent replay. `notification_event_id` is non-null ONLY for the genuinely-new path (server-side use by the Route Handler to trigger the notification; never returned to the public caller, whose HTTP response is unchanged); a replay yields null and therefore can never notify again.';

-- =============================================================================
-- A3. the two business functions gain ONE thing: the in-transaction enqueue
-- =============================================================================
create or replace function public.submit_public_transportation_request(
  p_integration_external_id text,
  p_idempotency_key text,
  p_requester_name text,
  p_requester_relationship text,
  p_requester_phone text,
  p_pickup_description text,
  p_destination_description text,
  p_return_trip_needed text,
  p_requester_email text default null,
  p_preferred_date date default null,
  p_preferred_time time default null,
  p_assistance_notes text default null,
  p_additional_notes text default null,
  p_origin text default null,
  p_service_type text default null,
  p_recurring_days_of_week text[] default null,
  p_recurring_start_date date default null,
  p_recurring_end_date date default null,
  p_recurring_appointment_time time default null,
  p_recurring_return_trip_expected boolean default null,
  p_requested_passenger_name text default null
)
returns public.public_request_submission_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

comment on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean, text
) is
  'SERVER-ONLY (service_role). The sole path by which a Request can be created via public tenant-website intake -- reachable ONLY through the Nemryn-owned Route Handler. No organization_id parameter: the organization is resolved entirely from p_integration_external_id. state always pending, source always web; no passenger_id, no Trip. Idempotent per (integration, idempotency key). When the resolved organization has configured service offerings, a supplied p_service_type it has not enabled is rejected with the same generic invalid_input. R4D: on the genuinely-new path only, a notification_events row is enqueued in the same transaction and its id returned (notification_event_id); replays return null. Every rejection is the identical invalid_input (ZW006) -- no existence oracle.';

revoke all on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean, text
) from public, anon, authenticated;
grant execute on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean, text
) to service_role;

create or replace function public.report_trip_exception(
  p_trip_id uuid,
  p_exception_type text default null,
  p_description text default null
)
returns public.trip_exception_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips;
  v_is_ops boolean;
  v_assignment public.trip_assignments;
  v_exception_id uuid;
  v_created_at timestamptz;
  v_notification_event_id uuid;
  v_result public.trip_exception_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_is_ops := public.has_org_role(v_trip.organization_id, array['organization_admin', 'dispatcher']);

  if not v_is_ops then
    -- Driver path (P1-E3-S8A): CURRENTLY ACTIVE assignment required, not
    -- merely "ever assigned." _lock_driver_active_assignment resolves the
    -- caller's Driver row within v_trip.organization_id itself (returning
    -- a null-fielded row for a caller with no Membership/Driver row in
    -- that org at all), so this one check alone already covers: wrong
    -- org, no Driver row, inactive Driver/Membership (current_driver_id's
    -- own ZD-100 correction), never assigned, reassigned away, and
    -- terminal Trip (see the migration-level comment above) — all
    -- collapsing to the identical ZW002, no existence oracle.
    v_assignment := public._lock_driver_active_assignment(p_trip_id, v_trip.organization_id);
    if v_assignment.id is null then
      raise exception 'not_found' using errcode = 'ZW002';
    end if;
  end if;

  if p_description is not null and length(btrim(p_description)) = 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_description is not null and length(p_description) > 2000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  insert into public.trip_exceptions (
    organization_id, trip_id, exception_type, description, status, created_by
  ) values (
    v_trip.organization_id, p_trip_id, nullif(btrim(p_exception_type), ''), nullif(btrim(p_description), ''),
    'open', auth.uid()
  )
  returning id, created_at into v_exception_id, v_created_at;

  insert into public.trip_events (organization_id, trip_id, event_type, actor_user_id, metadata)
  values (v_trip.organization_id, p_trip_id, 'exception_flagged', auth.uid(),
    jsonb_build_object('exception_id', v_exception_id));

  -- P1-PILOT-S4B-R4D: durable notification event in the SAME transaction (see
  -- _enqueue_notification_event). Recipients are resolved live at dispatch.
  v_notification_event_id := public._enqueue_notification_event(
    v_trip.organization_id, 'trip_exception', 'trip_exception', v_exception_id
  );

  v_result.exception_id := v_exception_id;
  v_result.trip_id := p_trip_id;
  v_result.organization_id := v_trip.organization_id;
  v_result.exception_type := nullif(btrim(p_exception_type), '');
  v_result.description := nullif(btrim(p_description), '');
  v_result.status := 'open';
  v_result.created_by := auth.uid();
  v_result.resolved_by := null;
  v_result.resolved_at := null;
  v_result.resolution_note := null;
  v_result.created_at := v_created_at;
  v_result.changed := true;
  v_result.notification_event_id := v_notification_event_id;
  return v_result;
end;
$$;

comment on function public.report_trip_exception(uuid, text, text) is
  'Organization Admin/Dispatcher (any Trip in their org) OR the Trip''s own CURRENTLY-assigned Driver (live _lock_driver_active_assignment). Creates a new open TripException (created_by=auth.uid(), status open), writes one trip_events row (exception_flagged) and, R4D, one notification_events row in the same transaction (its id returned as notification_event_id for the server-side dispatcher). No AuditEvent. The ONLY way any actor creates a TripException.';

revoke all on function public.report_trip_exception(uuid, text, text) from public;
grant execute on function public.report_trip_exception(uuid, text, text) to authenticated;

-- =============================================================================
-- A4. settings read / write (Organization Admin only)
-- =============================================================================
create or replace function public.get_notification_settings(p_organization_id uuid)
returns table (event_type text, recipient_roles text[], is_default boolean)
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
  select e.event_type, coalesce(s.recipient_roles, public._notification_default_roles(e.event_type)), s.event_type is null
  from (values ('website_request'), ('trip_exception')) as e(event_type)
  left join public.organization_notification_settings s
    on s.organization_id = p_organization_id and s.event_type = e.event_type
  order by e.event_type desc;
end;
$$;
comment on function public.get_notification_settings(uuid) is
  'Organization Admin of p_organization_id only. The effective recipient roles per notification event (explicit setting, else the default).';
revoke all on function public.get_notification_settings(uuid) from public;
grant execute on function public.get_notification_settings(uuid) to authenticated;

create type public.notification_settings_result as (
  changed boolean
);

create or replace function public.set_notification_settings(
  p_organization_id uuid, p_event_type text, p_recipient_roles text[]
)
returns public.notification_settings_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new text[];
  v_before text[];
  v_result public.notification_settings_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_event_type is null or p_event_type not in ('website_request', 'trip_exception') or p_recipient_roles is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select coalesce(array_agg(distinct r order by r), array[]::text[]) into v_new
  from unnest(p_recipient_roles) r where r is not null;
  -- only staff roles can ever receive staff notifications (never a Driver)
  if exists (select 1 from unnest(v_new) r where r not in ('organization_admin', 'dispatcher')) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  perform 1 from public.organizations where id = p_organization_id for update;

  select recipient_roles into v_before from public.organization_notification_settings
  where organization_id = p_organization_id and event_type = p_event_type;
  if not found then
    v_before := public._notification_default_roles(p_event_type);
    -- unconfigured and identical to the default: nothing to record
    if (select array_agg(x order by x) from unnest(v_before) x) = v_new then
      v_result.changed := false;
      return v_result;
    end if;
  elsif v_before = v_new then
    v_result.changed := false;
    return v_result;
  end if;

  insert into public.organization_notification_settings (organization_id, event_type, recipient_roles)
  values (p_organization_id, p_event_type, v_new)
  on conflict (organization_id, event_type) do update set recipient_roles = excluded.recipient_roles, updated_at = now();

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'organization', p_organization_id, 'notification_preferences_updated', auth.uid(),
          jsonb_build_object('event_type', p_event_type, 'recipient_roles', to_jsonb(v_before)),
          jsonb_build_object('event_type', p_event_type, 'recipient_roles', to_jsonb(v_new)));

  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.set_notification_settings(uuid, text, text[]) is
  'Organization Admin of p_organization_id only. Sets the STAFF roles (organization_admin | dispatcher; empty = off) that receive one notification event (website_request | trip_exception). Anything else -> ZW006. Audited as notification_preferences_updated with before/after; an identical save is a no-op. There is no channel parameter: email is the only channel.';
revoke all on function public.set_notification_settings(uuid, text, text[]) from public;
grant execute on function public.set_notification_settings(uuid, text, text[]) to authenticated;

-- recent delivery outcomes (evidence that notifications are actually going out)
create or replace function public.list_notification_history(p_organization_id uuid, p_limit integer default 10)
returns table (created_at timestamptz, event_type text, status text, recipient_count integer, sent_count integer)
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
  select n.created_at, n.event_type, n.status, n.recipient_count, n.sent_count
  from public.notification_events n
  where n.organization_id = p_organization_id
  order by n.created_at desc, n.id desc
  limit greatest(1, least(coalesce(p_limit, 10), 25));
end;
$$;
comment on function public.list_notification_history(uuid, integer) is
  'Organization Admin of p_organization_id only. The most recent notification events for that organization (type, outcome, counts). No recipient addresses, no entity ids, no failure text.';
revoke all on function public.list_notification_history(uuid, integer) from public;
grant execute on function public.list_notification_history(uuid, integer) to authenticated;

-- =============================================================================
-- A5. dispatch boundary (service_role only)
-- =============================================================================
-- Returns NULL when there is nothing to send (unknown/already-claimed event, or
-- no eligible recipient) -- and in the no-recipient case records the event as
-- skipped. Recipients come from LIVE Membership state: active staff Memberships
-- (organization_admin / dispatcher) holding a role the organization enabled for
-- this event, with a real account email. Drivers, inactive Memberships and other
-- organizations can never appear. Payload is deliberately minimal.
create or replace function public.claim_notification_dispatch(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.notification_events%rowtype;
  v_roles text[];
  v_recipients text[];
  v_org public.organizations%rowtype;
  v_payload jsonb := '{}'::jsonb;
begin
  select * into v_event from public.notification_events where id = p_event_id for update;
  if not found or v_event.status <> 'pending' then
    return null;
  end if;

  select recipient_roles into v_roles from public.organization_notification_settings
  where organization_id = v_event.organization_id and event_type = v_event.event_type;
  if not found then
    v_roles := public._notification_default_roles(v_event.event_type);
  end if;

  select coalesce(array_agg(distinct lower(u.email::text)), array[]::text[]) into v_recipients
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.organization_id = v_event.organization_id
    and m.status = 'active'
    and m.role in ('organization_admin', 'dispatcher')
    and m.role = any (v_roles)
    and u.email is not null and length(btrim(u.email)) > 0;

  if coalesce(array_length(v_recipients, 1), 0) = 0 then
    update public.notification_events
    set status = 'skipped', attempted_at = now(), completed_at = now(), recipient_count = 0
    where id = v_event.id;
    return null;
  end if;

  update public.notification_events
  set status = 'dispatching', attempted_at = now(), recipient_count = array_length(v_recipients, 1)
  where id = v_event.id;

  select * into v_org from public.organizations where id = v_event.organization_id;

  if v_event.event_type = 'website_request' then
    select jsonb_build_object('requested_date', r.preferred_date, 'service_type', r.service_type) into v_payload
    from public.transportation_requests r
    where r.id = v_event.entity_id and r.organization_id = v_event.organization_id;
  elsif v_event.event_type = 'trip_exception' then
    select jsonb_build_object('pickup_at', t.scheduled_pickup_at) into v_payload
    from public.trip_exceptions x
    join public.trips t on t.id = x.trip_id and t.organization_id = x.organization_id
    where x.id = v_event.entity_id and x.organization_id = v_event.organization_id;
  end if;

  return jsonb_build_object(
    'event_type', v_event.event_type,
    'organization_name', v_org.name,
    'timezone', v_org.timezone,
    'recipients', to_jsonb(v_recipients),
    'payload', coalesce(v_payload, '{}'::jsonb)
  );
end;
$$;
comment on function public.claim_notification_dispatch(uuid) is
  'SERVER-ONLY (service_role). Atomically claims one PENDING notification event (exactly one concurrent caller wins; the rest get NULL), resolves recipients from LIVE Membership state (active organization_admin/dispatcher holding a role the organization enabled for this event) and returns the minimal email payload. No eligible recipient -> the event is recorded as skipped and NULL is returned.';
revoke all on function public.claim_notification_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.claim_notification_dispatch(uuid) to service_role;

create or replace function public.complete_notification_dispatch(
  p_event_id uuid, p_sent integer, p_failed integer, p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_reason text;
begin
  v_reason := case when p_failed > 0 then
    case when p_reason in ('provider_error', 'not_configured', 'build_failed') then p_reason else 'unknown' end
  end;
  v_status := case
    when coalesce(p_failed, 0) = 0 and coalesce(p_sent, 0) > 0 then 'sent'
    when coalesce(p_sent, 0) = 0 then 'failed'
    else 'partial'
  end;

  update public.notification_events
  set status = v_status, sent_count = greatest(coalesce(p_sent, 0), 0), failed_count = greatest(coalesce(p_failed, 0), 0),
      failure_reason = v_reason, completed_at = now()
  where id = p_event_id and status = 'dispatching';
  return found;
end;
$$;
comment on function public.complete_notification_dispatch(uuid, integer, integer, text) is
  'SERVER-ONLY (service_role). Records the outcome of a claimed dispatch: sent / partial / failed with counts and a FIXED-vocabulary failure_reason (provider_error | not_configured | build_failed | unknown) -- never provider text. Only a dispatching event can be completed.';
revoke all on function public.complete_notification_dispatch(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.complete_notification_dispatch(uuid, integer, integer, text) to service_role;

-- =============================================================================
-- B. ACTIVITY
-- =============================================================================
create or replace function public.list_activity_events(
  p_organization_id uuid,
  p_limit integer default 30,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (id uuid, occurred_at timestamptz, action text, actor_name text, before_data jsonb, after_data jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c_actions constant text[] := array[
    'organization_created', 'organization_settings_updated', 'organization_operating_schedule_updated',
    'organization_services_configured', 'organization_service_offerings_updated',
    'website_integration_created', 'website_integration_activated', 'website_integration_disabled',
    'website_integration_origin_updated',
    'staff_invitation_created', 'staff_invitation_resent', 'staff_invitation_cancelled', 'staff_invitation_accepted',
    'membership_role_changed', 'membership_deactivated', 'membership_reactivated',
    'notification_preferences_updated'
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
         case when a.actor_user_id is null then null else coalesce(nullif(btrim(p.display_name), ''), u.email::text) end,
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
$$;
comment on function public.list_activity_events(uuid, integer, timestamptz, uuid) is
  'Organization Admin of p_organization_id only (Dispatcher, Driver, inactive, foreign, Platform Admin without Membership: ZW002). Newest-first page of that organization''s ADMINISTRATIVE audit_events, restricted to a whitelist of actions (operational trip/request audit rows are never returned), keyset-paged by (occurred_at, id). Returns raw before/after only to the server-side projector (src/lib/operations/activity-core.ts), which maps them to human text; nothing raw reaches the browser. The actor is the profile display name (else account email); null actor -> null.';
revoke all on function public.list_activity_events(uuid, integer, timestamptz, uuid) from public;
grant execute on function public.list_activity_events(uuid, integer, timestamptz, uuid) to authenticated;
