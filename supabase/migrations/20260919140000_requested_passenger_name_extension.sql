-- P1-PILOT-S4B-R2A — Structured Requested Passenger Name.
--
-- R2's own report flagged that Zenward-Web collects a `passengerName`
-- Nemryn's public intake never had a field for, and suggested folding it
-- into `additionalNotes` as a stopgap. This migration replaces that
-- workaround with a proper, first-class, structured intake field —
-- passenger name is genuine intake information, not a note.
--
-- CRITICAL DISTINCTION, enforced structurally, not just by convention:
-- a REQUESTED passenger name is NOT a Passenger entity. This column is a
-- plain, free-text SNAPSHOT of what the requester typed — exactly the
-- same category of data `requester_name` already is on this same table
-- (see that table's own original comment: "Requester is snapshot fields
-- here, not a standalone table (ZD-045)"). It is NEVER a foreign key,
-- never resolved/matched against `passengers`, and never assigns,
-- changes, or influences `transportation_requests.passenger_id` in any
-- way — that column remains exclusively set by the existing, unrelated
-- `link_request_passenger` operator-controlled RPC, completely untouched
-- by this migration. No Passenger row is ever created, matched, or
-- linked by this migration or by `submit_public_transportation_request`.

-- =============================================================================
-- A. transportation_requests.requested_passenger_name
-- =============================================================================
-- Named to make the snapshot/entity distinction unambiguous at a glance
-- (never `passenger_name`, which could be misread as a column belonging
-- to the `passengers` table, and never anything resembling `passenger_id`
-- or `passenger_display_name` — the latter is an existing, DIFFERENT
-- concept: a *joined, live* Passenger's own display_name surfaced through
-- driver-read result types, e.g. 20260831110000_driver_read_result_
-- types.sql — this column is neither of those). Nullable, no length
-- CHECK at the table level — matching `requester_name`'s/`pickup_
-- description`'s own established convention for this table's other
-- free-text snapshot fields (length is bounded at the application/RPC
-- layer, not by a table CHECK, for every other text snapshot field here).
alter table public.transportation_requests
  add column requested_passenger_name text;

comment on column public.transportation_requests.requested_passenger_name is
  'P1-PILOT-S4B-R2A. A free-text SNAPSHOT of the passenger name the requester supplied at submission time -- NOT a foreign key, NOT matched or reconciled against public.passengers in any way, NOT the same value as passenger_id''s own linked Passenger.display_name. Populated only by submit_public_transportation_request (the public website-intake path); NULL for every pre-existing row and every staff-entered Request that does not set it. Persists unchanged as historical intake context even after an operator links a real Passenger via link_request_passenger -- never overwritten, never used to auto-create or auto-match a Passenger.';

-- =============================================================================
-- B. submit_public_transportation_request — one new trailing optional
-- parameter
-- =============================================================================
-- Same pattern as P1-PILOT-S4B-R2's own six-parameter extension: strictly
-- additive (one new parameter, `default null`, appended after the
-- existing 20), so every pre-existing caller (the Route Handler, every
-- existing SQL test invoking the RPC with fewer positional args) keeps
-- working unchanged. Postgres treats the longer parameter list as a
-- DISTINCT overload, so the now-orphaned 20-parameter overload is
-- explicitly dropped at the end of this section — exactly one
-- authoritative version of this security-sensitive function exists at
-- any time, never two coexisting overloads with independently-drifting
-- grants.
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
  end if;

  v_result.accepted := true;
  return v_result;
end;
$$;

comment on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean, text
) is
  'SERVER-ONLY (service_role), as of P1-PILOT-S4B. The sole path by which a Request can be created via public tenant-website intake — reachable ONLY through the Nemryn-owned Next.js Route Handler (src/app/api/public-intake/website/route.ts). No organization_id parameter exists anywhere in this signature — the organization is resolved entirely from p_integration_external_id via request_intake_integrations. state is always ''pending'' and source is always ''web'', never caller-supplied. No passenger_id parameter exists — public intake never auto-links, auto-creates, or auto-merges a Passenger. P1-PILOT-S4B-R2 added p_service_type (closed allow-list) and a REQUESTED recurring schedule (p_recurring_days_of_week/p_recurring_start_date/p_recurring_end_date/p_recurring_appointment_time/p_recurring_return_trip_expected) -- creates no Trip series, no recurring_arrangements row. P1-PILOT-S4B-R2A adds p_requested_passenger_name: a plain free-text SNAPSHOT stored on the Request row (transportation_requests.requested_passenger_name), NEVER matched/resolved/linked against public.passengers and NEVER touching passenger_id in any way -- linking a real Passenger remains exclusively link_request_passenger''s own job, unaffected by this parameter. Idempotent: the SAME (integration, p_idempotency_key) pair never creates more than one Request, enforced by transportation_requests_intake_idempotency_idx and ON CONFLICT DO NOTHING (never DO UPDATE) -- a replay with different field values, including a different requested_passenger_name, never modifies the already-committed row. A disabled or nonexistent integration, and every field-validation failure, all raise the identical invalid_input (ZW006) — no existence oracle.';

revoke all on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean, text
) from public, anon, authenticated;
grant execute on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean, text
) to service_role;

-- Drop the now-orphaned 20-parameter overload (20260919130000's own
-- signature) — exactly one version of this security-sensitive function
-- must exist at any time.
drop function if exists public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean
);
