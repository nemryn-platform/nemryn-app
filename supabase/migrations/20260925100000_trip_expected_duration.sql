-- P1-OPS-PROG4B -- Trip time extent (GAP-11): expected duration + optional organization default.
-- Source of truth: docs/reports/p1-ops-prog4a-trip-time-extent-overlap-spec.txt (owner decisions Q1–Q7 final).
--
-- ONE expand-only migration. Purely additive:
--   + trips.expected_duration_minutes integer NULL (1..2880) + trips.expected_duration_source text NULL
--     ('trip' | 'organization_default'), value/source coherent. No backfill: every existing Trip stays UNKNOWN.
--   + organizations.default_trip_duration_minutes integer NULL (1..2880). No Nemryn platform default.
--   ~ create_trip gains ONE trailing parameter p_expected_duration_minutes integer DEFAULT NULL and snapshots the
--     organization default at creation (explicit -> 'trip'; else default -> 'organization_default'; else NULL/NULL).
--     The 11-argument function is dropped and the 12-argument one created in the same transaction, so there is
--     never a lasting second overload. Existing named-argument callers and create_trip_for_recurring_occurrence's
--     positional 5-argument call both resolve to it unchanged.
--   + set_trip_expected_duration          (Organization Admin / Dispatcher; non-terminal Trips; audited)
--   + update_organization_trip_defaults   (Organization Admin only; never touches Trips; audited)
-- The planned end (scheduled_pickup_at + duration) is DERIVED, never stored. 2880 is an integrity ceiling only,
-- never a default. No new column grant: the new columns are written ONLY through these SECURITY DEFINER RPCs.
-- No RLS change (the new columns inherit trips_select_org_operations / organizations_select_members).

-- =============================================================================
-- 1. Columns
-- =============================================================================
alter table public.trips
  add column expected_duration_minutes integer,
  add column expected_duration_source text;

alter table public.trips
  add constraint trips_expected_duration_minutes_range
    check (expected_duration_minutes is null or expected_duration_minutes between 1 and 2880),
  add constraint trips_expected_duration_source_valid
    check (expected_duration_source is null or expected_duration_source in ('trip', 'organization_default')),
  add constraint trips_expected_duration_source_coherent
    check ((expected_duration_minutes is null) = (expected_duration_source is null));

comment on column public.trips.expected_duration_minutes is
  'P1-OPS-PROG4. Planned trip duration in minutes (1..2880, an integrity ceiling -- never a default). NULL = UNKNOWN: no extent, no overlap claim. The planned end is derived (scheduled_pickup_at + duration), never stored, and is a PLAN, never a lifecycle fact. Written only by create_trip (explicit value or organization-default snapshot) and set_trip_expected_duration.';
comment on column public.trips.expected_duration_source is
  'P1-OPS-PROG4. ''trip'' = entered for this trip; ''organization_default'' = snapshot of organizations.default_trip_duration_minutes when the trip was created. NULL exactly when expected_duration_minutes is NULL.';

alter table public.organizations
  add column default_trip_duration_minutes integer;

alter table public.organizations
  add constraint organizations_default_trip_duration_minutes_range
    check (default_trip_duration_minutes is null or default_trip_duration_minutes between 1 and 2880);

comment on column public.organizations.default_trip_duration_minutes is
  'P1-OPS-PROG4. Optional organization default trip duration (1..2880). Snapshotted onto a trip by create_trip only when no duration is entered; changing it never modifies existing trips. NULL = no default (there is no Nemryn platform default). Written only by update_organization_trip_defaults (Organization Admin).';

-- =============================================================================
-- 2. create_trip -- trailing p_expected_duration_minutes + default snapshot
-- =============================================================================
drop function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid);

create function public.create_trip(
  p_organization_id uuid,
  p_passenger_id uuid,
  p_pickup_description text,
  p_destination_description text,
  p_scheduled_pickup_at timestamptz default null,
  p_appointment_at timestamptz default null,
  p_pickup_facility_id uuid default null,
  p_destination_facility_id uuid default null,
  p_assistance_notes text default null,
  p_instructions text default null,
  p_request_id uuid default null,
  p_expected_duration_minutes integer default null
)
returns public.trip_creation_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pickup_description text;
  v_destination_description text;
  v_request public.transportation_requests;
  v_event_type text;
  v_new_trip_id uuid;
  v_duration integer;
  v_duration_source text;
  v_result public.trip_creation_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_pickup_description := nullif(btrim(p_pickup_description), '');
  v_destination_description := nullif(btrim(p_destination_description), '');
  if v_pickup_description is null or v_destination_description is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if length(v_pickup_description) > 2000 or length(v_destination_description) > 2000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_scheduled_pickup_at is not null and p_appointment_at is not null
     and p_appointment_at < p_scheduled_pickup_at then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- P1-OPS-PROG4: explicit duration must be within the integrity ceiling.
  if p_expected_duration_minutes is not null and (p_expected_duration_minutes < 1 or p_expected_duration_minutes > 2880) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_passenger_id is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not exists (
    select 1 from public.passengers
    where id = p_passenger_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_pickup_facility_id is not null and not exists (
    select 1 from public.facilities
    where id = p_pickup_facility_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_destination_facility_id is not null and not exists (
    select 1 from public.facilities
    where id = p_destination_facility_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_request_id is not null then
    select * into v_request
    from public.transportation_requests
    where id = p_request_id and organization_id = p_organization_id
    for update;

    if not found then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;

    if v_request.state <> 'accepted' then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;

    if v_request.passenger_id is distinct from p_passenger_id then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  -- P1-OPS-PROG4 snapshot semantics: explicit value -> 'trip'; otherwise the organization default IN FORCE NOW
  -- -> 'organization_default'; otherwise UNKNOWN (NULL/NULL). Never re-evaluated later.
  if p_expected_duration_minutes is not null then
    v_duration := p_expected_duration_minutes;
    v_duration_source := 'trip';
  else
    select default_trip_duration_minutes into v_duration from public.organizations where id = p_organization_id;
    v_duration_source := case when v_duration is null then null else 'organization_default' end;
  end if;

  insert into public.trips (
    organization_id, request_id, passenger_id, state,
    scheduled_pickup_at, appointment_at, pickup_description, destination_description,
    pickup_facility_id, destination_facility_id, assistance_notes, instructions,
    expected_duration_minutes, expected_duration_source
  ) values (
    p_organization_id, p_request_id, p_passenger_id, 'scheduled',
    p_scheduled_pickup_at, p_appointment_at, v_pickup_description, v_destination_description,
    p_pickup_facility_id, p_destination_facility_id, p_assistance_notes, p_instructions,
    v_duration, v_duration_source
  )
  returning id into v_new_trip_id;

  v_event_type := case when p_request_id is not null then 'request_converted_to_trip' else 'trip_scheduled' end;

  insert into public.trip_events (organization_id, trip_id, event_type, actor_user_id, metadata)
  values (p_organization_id, v_new_trip_id, v_event_type, auth.uid(), jsonb_build_object('request_id', p_request_id));

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'trip', v_new_trip_id, 'trip_created', auth.uid(),
    null,
    jsonb_build_object('state', 'scheduled', 'passenger_id', p_passenger_id, 'request_id', p_request_id,
                       'expected_duration_minutes', v_duration, 'expected_duration_source', v_duration_source)
  );

  v_result.trip_id := v_new_trip_id;
  v_result.organization_id := p_organization_id;
  v_result.state := 'scheduled';
  v_result.created := true;
  return v_result;
end;
$$;

comment on function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid, integer) is
  'Organization Admin / Dispatcher only. The sole controlled path to create a Trip — state is always ''scheduled'', never caller-supplied. Does not assign a Driver/Vehicle (use assign_trip). Non-idempotent by design. When p_request_id is supplied: the Request must be ACCEPTED (pending/declined/cancelled: ZW006), this function never changes the Request state, and the Request''s linked passenger_id must equal p_passenger_id (ZW006). P1-OPS-PROG4: optional p_expected_duration_minutes (1..2880, ZW006 otherwise); when omitted, the organization default in force is snapshotted (source organization_default), else the duration stays UNKNOWN. See docs/data/mutation-api.md.';

revoke all on function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid, integer) from public;
grant execute on function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid, integer) to authenticated;

-- =============================================================================
-- 3. set_trip_expected_duration -- Organization Admin / Dispatcher, non-terminal Trips
-- =============================================================================
create type public.trip_expected_duration_result as (
  trip_id uuid,
  expected_duration_minutes integer,
  expected_duration_source text,
  changed boolean
);

create function public.set_trip_expected_duration(
  p_trip_id uuid,
  p_expected_duration_minutes integer
)
returns public.trip_expected_duration_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips;
  v_new_source text;
  v_result public.trip_expected_duration_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found or not public.has_org_role(v_trip.organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_expected_duration_minutes is not null and (p_expected_duration_minutes < 1 or p_expected_duration_minutes > 2880) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- A finished Trip's plan is history: completed / cancelled / no_show cannot be re-planned.
  if v_trip.state in ('completed', 'cancelled', 'no_show') then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- NULL clears to UNKNOWN (the organization default is NOT re-applied); a value is always source 'trip'.
  v_new_source := case when p_expected_duration_minutes is null then null else 'trip' end;

  v_result.trip_id := v_trip.id;
  if v_trip.expected_duration_minutes is not distinct from p_expected_duration_minutes
     and v_trip.expected_duration_source is not distinct from v_new_source then
    v_result.expected_duration_minutes := v_trip.expected_duration_minutes;
    v_result.expected_duration_source := v_trip.expected_duration_source;
    v_result.changed := false;
    return v_result;
  end if;

  update public.trips
  set expected_duration_minutes = p_expected_duration_minutes, expected_duration_source = v_new_source
  where id = v_trip.id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_trip.organization_id, 'trip', v_trip.id, 'trip_expected_duration_updated', auth.uid(),
          jsonb_build_object('expected_duration_minutes', v_trip.expected_duration_minutes, 'expected_duration_source', v_trip.expected_duration_source),
          jsonb_build_object('expected_duration_minutes', p_expected_duration_minutes, 'expected_duration_source', v_new_source));

  v_result.expected_duration_minutes := p_expected_duration_minutes;
  v_result.expected_duration_source := v_new_source;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.set_trip_expected_duration(uuid, integer) is
  'P1-OPS-PROG4. Organization Admin / Dispatcher of the Trip''s organization only (otherwise ZW002). Sets (1..2880, source trip) or clears (NULL -> UNKNOWN; the organization default is not re-applied) a non-terminal Trip''s expected duration; completed/cancelled/no_show -> ZW004. Row-locked, idempotent (changed), audited as trip_expected_duration_updated. Never touches assignments and never checks overlaps (overlap is a warning, not a rule).';

revoke all on function public.set_trip_expected_duration(uuid, integer) from public;
grant execute on function public.set_trip_expected_duration(uuid, integer) to authenticated;

-- =============================================================================
-- 4. update_organization_trip_defaults -- Organization Admin only
-- =============================================================================
create type public.organization_trip_defaults_result as (
  organization_id uuid,
  default_trip_duration_minutes integer,
  changed boolean
);

create function public.update_organization_trip_defaults(
  p_organization_id uuid,
  p_default_trip_duration_minutes integer
)
returns public.organization_trip_defaults_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.organizations%rowtype;
  v_result public.organization_trip_defaults_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_default_trip_duration_minutes is not null and (p_default_trip_duration_minutes < 1 or p_default_trip_duration_minutes > 2880) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_before from public.organizations where id = p_organization_id for update;

  v_result.organization_id := p_organization_id;
  v_result.default_trip_duration_minutes := p_default_trip_duration_minutes;
  if v_before.default_trip_duration_minutes is not distinct from p_default_trip_duration_minutes then
    v_result.changed := false;
    return v_result;
  end if;

  update public.organizations
  set default_trip_duration_minutes = p_default_trip_duration_minutes
  where id = p_organization_id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'organization', p_organization_id, 'organization_trip_defaults_updated', auth.uid(),
          jsonb_build_object('default_trip_duration_minutes', v_before.default_trip_duration_minutes),
          jsonb_build_object('default_trip_duration_minutes', p_default_trip_duration_minutes));

  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.update_organization_trip_defaults(uuid, integer) is
  'P1-OPS-PROG4. Organization Admin of p_organization_id only (Dispatcher, Driver, foreign tenant: ZW002). Sets (1..2880) or clears (NULL) the optional default trip duration used ONLY for trips created afterwards; never modifies existing trips. Idempotent (changed), audited as organization_trip_defaults_updated.';

revoke all on function public.update_organization_trip_defaults(uuid, integer) from public;
grant execute on function public.update_organization_trip_defaults(uuid, integer) to authenticated;
