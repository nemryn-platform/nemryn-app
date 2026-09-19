-- P1-PILOT-S4B-R2 — Structured Website Intake Contract Extension.
--
-- Extends the ALREADY-HARDENED S4A/S4B public intake contract with two
-- structured, optional fields Zenward-Web's own current form already
-- collects: `serviceType` (a closed allow-list) and `recurringSchedule`
-- (a small, explicit REQUESTED-schedule shape — see below). This
-- migration changes NOTHING about the existing security architecture:
-- `submit_public_transportation_request` remains service_role-only
-- (20260919120000), tenant resolution remains entirely
-- integrationExternalId -> request_intake_integrations ->
-- organization_id, idempotency remains the same partial unique index +
-- ON CONFLICT DO NOTHING, and this phase adds no Trip/Passenger/Driver/
-- Vehicle side effect of any kind — a `recurringSchedule` describes what
-- the requester WANTS, never an actual Trip series, exactly like a
-- one-time Request's own `preferred_date`/`preferred_time` never create
-- a Trip on their own either.
--
-- NOTE ON `passengerName`: verified directly against the current,
-- deployed contract (website-intake-core.ts's own ALLOWED_KEYS,
-- submit_public_transportation_request's own 14-parameter signature) —
-- Nemryn's public intake has NEVER accepted a `passengerName` field, in
-- S4A or S4B. A prior report (p1-pilot-s4b-pilot-website-intake-
-- production-activation.txt, PART 5) incorrectly listed `passengerName?`
-- as part of the preserved contract; that was an error in that report,
-- not a feature that ever existed in code. This migration does NOT add
-- a passengerName column or parameter — out of scope for this phase,
-- which is chartered to extend serviceType/recurringSchedule only.

-- =============================================================================
-- A. transportation_requests — additive structured columns
-- =============================================================================
-- Per this schema's own established, explicit preference for typed
-- columns over an "ad hoc jsonb blob" for structured domain data (see
-- 20260831100100_mutation_result_types.sql's own comment) and the
-- existing `recurring_arrangements.days_of_week smallint[]` precedent
-- (20260917090000) for exactly this kind of weekday-set data, this adds
-- typed columns rather than a JSONB column. All nullable — NULL for
-- every existing row, every staff-entered row, and every public-intake
-- row that does not include them (backward compatible with any future
-- non-Zenward integration that never sends either field).
alter table public.transportation_requests
  add column service_type text,
  add column recurring_days_of_week smallint[],
  add column recurring_start_date date,
  add column recurring_end_date date,
  add column recurring_appointment_time time,
  add column recurring_return_trip_expected boolean;

comment on column public.transportation_requests.service_type is
  'P1-PILOT-S4B-R2. Optional, closed allow-list (see the CHECK constraint) of which service the requester selected — currently populated only by the public website-intake path; NULL for every pre-existing row and every staff-entered row that does not set it. Purely descriptive/informational for the operator reviewing the Request; never drives any automated behavior.';

comment on column public.transportation_requests.recurring_days_of_week is
  'P1-PILOT-S4B-R2. The REQUESTED recurring days, ISO weekday numbers (1=Monday..7=Sunday), reusing recurring_arrangements'' own _is_canonical_days_of_week() canonical-format CHECK for consistency. This describes what the requester asked for on an UNREVIEWED public Request — it is NOT a recurring_arrangements row and creates NO Trip series. NULL unless a recurring schedule was requested; when non-NULL, recurring_start_date is also always non-NULL (see the paired CHECK below).';

comment on column public.transportation_requests.recurring_start_date is
  'P1-PILOT-S4B-R2. Requested first date of a requested recurring schedule. NULL unless recurring_days_of_week is also set (paired CHECK below) — never independently meaningful.';

comment on column public.transportation_requests.recurring_end_date is
  'P1-PILOT-S4B-R2. Optional requested last date (open-ended if NULL, exactly like recurring_arrangements.end_date''s own convention). When present, always >= recurring_start_date (CHECK below).';

comment on column public.transportation_requests.recurring_appointment_time is
  'P1-PILOT-S4B-R2. Optional typical requested appointment time for a requested recurring schedule.';

comment on column public.transportation_requests.recurring_return_trip_expected is
  'P1-PILOT-S4B-R2. Optional strict boolean — whether the requester expects a return trip on the recurring days. NULL means not specified, distinct from false.';

-- Closed allow-list — matches Zenward-Web's own SERVICE_TYPES exactly
-- (src/lib/request-intake/service-types.ts in that repository). Kept as
-- a plain CHECK, not a lookup table, mirroring `source`'s own
-- established CHECK-constrained-enum convention on this same table
-- (20260916100000).
alter table public.transportation_requests
  add constraint transportation_requests_service_type_check
  check (
    service_type is null or service_type in (
      'medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
      'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other'
    )
  );

-- Reuses public._is_canonical_days_of_week (20260917090000) unchanged —
-- the exact same non-empty/duplicate-free/ascending/in-range rule
-- recurring_arrangements.days_of_week already enforces, applied here to
-- a REQUESTED (not yet reviewed or confirmed) schedule.
alter table public.transportation_requests
  add constraint transportation_requests_recurring_days_canonical_check
  check (recurring_days_of_week is null or public._is_canonical_days_of_week(recurring_days_of_week));

-- A requested schedule is atomic: days_of_week and start_date are both
-- present or both absent — never one without the other. Defense in
-- depth on top of the RPC's own identical check below (this schema's
-- established double-validation convention — see e.g.
-- log_transportation_request's own field bounds mirrored by
-- website-intake-core.ts's pure pre-check).
alter table public.transportation_requests
  add constraint transportation_requests_recurring_schedule_atomic_check
  check ((recurring_days_of_week is null) = (recurring_start_date is null));

alter table public.transportation_requests
  add constraint transportation_requests_recurring_end_after_start_check
  check (recurring_end_date is null or recurring_start_date is null or recurring_end_date >= recurring_start_date);

-- =============================================================================
-- B. submit_public_transportation_request — extended, not replaced
-- =============================================================================
-- Six new parameters, ALL appended after the existing 14 (all `default
-- null`) — the existing positional signature for every already-existing
-- caller is unaffected; this is a strictly additive, backward-compatible
-- extension. `create or replace function` with the SAME name but a NEW,
-- LONGER parameter list creates an independent overload at the Postgres
-- level, so every GRANT/REVOKE/COMMENT below must reference the new,
-- complete 20-parameter type list explicitly (the old 14-parameter
-- overload remains grantless/revoked from the fix below -- see the
-- final DROP at the end of this section, which removes the now-orphaned
-- old overload rather than leaving two coexisting versions of this
-- security-sensitive function).
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
  p_recurring_return_trip_expected boolean default null
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
  -- recurring_arrangements' own days_of_week already use, so this
  -- REQUESTED schedule and a future CONFIRMED recurring_arrangements
  -- row share one consistent internal representation). This describes
  -- what the requester WANTS ONLY — no Trip, no recurring_arrangements
  -- row, is ever created here; an operator reviews and, if appropriate,
  -- separately creates an actual recurring arrangement through the
  -- existing Recurring Care workflow.
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
  -- ever a parameter, mirroring log_transportation_request's own
  -- hard-coded 'pending' and create_trip's own hard-coded 'scheduled'.
  -- passenger_id is never set (omitted entirely — defaults to its own
  -- column default of NULL).
  --
  -- Idempotency: ON CONFLICT targets the exact partial unique index from
  -- the S4A foundation migration. Two concurrent identical submissions
  -- (same integration, same idempotency key) are safe purely from this
  -- single atomic statement — the index enforces mutual exclusion at the
  -- database level; whichever transaction's INSERT commits first wins,
  -- the other observes a conflict and DOES NOTHING, then re-selects the
  -- now-committed row below. serviceType/recurringSchedule are just two
  -- more columns on the SAME row — they do not change this mechanism at
  -- all.
  -- -----------------------------------------------------------------------
  insert into public.transportation_requests (
    organization_id, requester_name, requester_relationship, requester_phone, requester_email,
    pickup_description, destination_description, preferred_date, preferred_time,
    return_trip_needed, assistance_notes, additional_notes, source, state,
    intake_integration_id, external_submission_ref,
    service_type, recurring_days_of_week, recurring_start_date, recurring_end_date,
    recurring_appointment_time, recurring_return_trip_expected
  ) values (
    v_integration.organization_id, v_requester_name, p_requester_relationship, v_requester_phone, v_requester_email,
    v_pickup_description, v_destination_description, p_preferred_date, p_preferred_time,
    p_return_trip_needed, v_assistance_notes, v_additional_notes, 'web', 'pending',
    v_integration.id, v_idempotency_key,
    v_service_type, v_recurring_days_of_week, p_recurring_start_date, p_recurring_end_date,
    p_recurring_appointment_time, p_recurring_return_trip_expected
  )
  on conflict (intake_integration_id, external_submission_ref)
    where intake_integration_id is not null and external_submission_ref is not null
  do nothing
  returning id into v_request_id;

  if v_request_id is null then
    -- Idempotent replay: another (possibly concurrent) call with the
    -- SAME integration + idempotency key already created the row. Never
    -- treated as an error — the caller's own submission was received
    -- exactly once either way.
    select id into v_request_id
    from public.transportation_requests
    where intake_integration_id = v_integration.id and external_submission_ref = v_idempotency_key;
  else
    -- Only logged for the genuinely-new-row path — a replay never
    -- produces a second request_events row, matching every other
    -- idempotent no-op in this schema (e.g. link_request_passenger's own
    -- changed=false path, which also skips its own event insert).
    -- actor_user_id is NULL (no authenticated identity exists for this
    -- caller) — request_events.actor_user_id already allows NULL (no
    -- schema change needed). No PII/free-text field is copied into
    -- metadata — only the safe, internal integration id, matching S4A's
    -- own established convention exactly (serviceType/recurringSchedule
    -- are NOT logged here either, same reasoning: they are on the
    -- Request row itself already, and metadata stays minimal/safe).
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
  text, text[], date, date, time, boolean
) is
  'SERVER-ONLY (service_role), as of P1-PILOT-S4B. The sole path by which a Request can be created via public tenant-website intake — reachable ONLY through the Nemryn-owned Next.js Route Handler (src/app/api/public-intake/website/route.ts). No organization_id parameter exists anywhere in this signature — the organization is resolved entirely from p_integration_external_id via request_intake_integrations. state is always ''pending'' and source is always ''web'', never caller-supplied. No passenger_id parameter exists — public intake never auto-links, auto-creates, or auto-merges a Passenger. P1-PILOT-S4B-R2 adds two OPTIONAL structured fields: p_service_type (closed allow-list) and p_recurring_days_of_week/p_recurring_start_date/p_recurring_end_date/p_recurring_appointment_time/p_recurring_return_trip_expected (a REQUESTED, not confirmed, recurring schedule — creates no Trip series, no recurring_arrangements row). Idempotent: the SAME (integration, p_idempotency_key) pair never creates more than one Request, enforced by transportation_requests_intake_idempotency_idx and ON CONFLICT DO NOTHING, safe under genuine concurrent submission. A disabled or nonexistent integration, and every field-validation failure, all raise the identical invalid_input (ZW006) — no existence oracle.';

revoke all on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean
) from public, anon, authenticated;
grant execute on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean
) to service_role;

-- Drop the now-orphaned 14-parameter overload (20260919090000/
-- 20260919120000's own signature) — Postgres treats a longer parameter
-- list as a DISTINCT overload, not a replacement, so without this the
-- old 14-arg version would still exist (already service_role-only per
-- 20260919120000, so not itself a new privilege-surface regression, but
-- an unused, confusing duplicate this migration removes rather than
-- leaves behind).
drop function if exists public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text
);
