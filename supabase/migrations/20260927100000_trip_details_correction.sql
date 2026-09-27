-- =============================================================================
-- P1-PILOT-R2B -- Trip correction + stranded-work visibility (database part).
-- Spec: docs/reports/p1-pilot-r2a-trip-correction-recovery-spec.txt (owner decisions D-1..D-6 recorded there).
--
--   1. trip_events.event_type gains 'trip_details_updated' (additive; existing rows unaffected).
--   2. update_trip_details(...) -- the ONLY way to correct a Trip's own planning details after creation:
--        audited, row-locked, optimistic-concurrency (updated_at token), lifecycle field matrix, recurring /
--        en-route service-date protection, create_trip's own validation rules, no-op writes nothing.
--   3. PR-15: authenticated loses ALL direct UPDATE on public.trips (8 planning columns); the now-inert
--      trips_update_org_operations policy is dropped. Every Trip mutation is now an audited RPC.
--   4. SEC-HYGIENE-2 (owner decision D-2): authenticated loses the 12 descriptive-column UPDATE grants on
--      public.transportation_requests; the now-inert transportation_requests_update_org_operations policy is dropped.
--      Request decisions / linking / intake / trip creation all run through their existing SECURITY DEFINER RPCs.
--   Implementation-time inventory (R2A section 2, re-verified for R2B): zero application .update()/.upsert()/.insert()/
--   .delete() calls against either table and zero SECURITY INVOKER writers -- nothing depends on the revoked grants.
-- No other schema change. No service-role path.
-- =============================================================================

-- 1. trip_events vocabulary ----------------------------------------------------------------------------------------
alter table public.trip_events drop constraint trip_events_event_type_check;
alter table public.trip_events add constraint trip_events_event_type_check check (event_type = any (array[
  'trip_scheduled', 'en_route_to_pickup', 'arrived_at_pickup', 'passenger_onboard', 'en_route_to_destination',
  'arrived_at_destination', 'trip_completed', 'trip_cancelled', 'no_show_recorded', 'driver_assigned',
  'driver_reassigned', 'assignment_ended', 'note_added', 'exception_flagged', 'exception_resolved',
  'request_converted_to_trip',
  'trip_details_updated'
]));

-- 2. update_trip_details ---------------------------------------------------------------------------------------------
create type public.trip_details_update_result as (
  trip_id uuid,
  changed boolean,
  changed_fields text[],
  updated_at timestamptz
);

create function public.update_trip_details(
  p_trip_id uuid,
  p_expected_updated_at timestamptz,
  p_scheduled_pickup_at timestamptz,
  p_appointment_at timestamptz,
  p_pickup_description text,
  p_pickup_facility_id uuid,
  p_destination_description text,
  p_destination_facility_id uuid,
  p_instructions text,
  p_assistance_notes text
)
returns public.trip_details_update_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips;
  v_org_timezone text;
  v_arrangement_timezone text;
  v_pickup_description text;
  v_destination_description text;
  v_instructions text;
  v_assistance_notes text;
  v_changed text[] := array[]::text[];
  v_editable text[];
  v_field text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_updated_at timestamptz;
  v_result public.trip_details_update_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  -- Organization is derived from the Trip row itself (never a client parameter). Driver / foreign tenant / inactive
  -- membership / suspended organization / Platform Admin without membership / not found: all the identical ZW002.
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found or not public.has_org_role(v_trip.organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Optimistic concurrency: the caller's view must still be current (another edit, a driver lifecycle step, a
  -- duration / wheelchair change all bump updated_at).
  if p_expected_updated_at is null or v_trip.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  -- create_trip's own validation rules (descriptions trimmed, required, <= 2000; appointment >= pickup; facilities
  -- same organization + active). Optional text: trimmed, blank -> NULL.
  v_pickup_description := nullif(btrim(p_pickup_description), '');
  v_destination_description := nullif(btrim(p_destination_description), '');
  if v_pickup_description is null or v_destination_description is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if length(v_pickup_description) > 2000 or length(v_destination_description) > 2000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  v_instructions := nullif(btrim(p_instructions), '');
  v_assistance_notes := nullif(btrim(p_assistance_notes), '');

  -- A scheduled pickup, once present, can never be cleared.
  if v_trip.scheduled_pickup_at is not null and p_scheduled_pickup_at is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Changed set (compared after normalizing BOTH sides, so whitespace-only differences are a no-op).
  if p_scheduled_pickup_at is distinct from v_trip.scheduled_pickup_at then v_changed := array_append(v_changed, 'scheduled_pickup_at'); end if;
  if p_appointment_at is distinct from v_trip.appointment_at then v_changed := array_append(v_changed, 'appointment_at'); end if;
  if v_pickup_description is distinct from nullif(btrim(v_trip.pickup_description), '') then v_changed := array_append(v_changed, 'pickup_description'); end if;
  if p_pickup_facility_id is distinct from v_trip.pickup_facility_id then v_changed := array_append(v_changed, 'pickup_facility_id'); end if;
  if v_destination_description is distinct from nullif(btrim(v_trip.destination_description), '') then v_changed := array_append(v_changed, 'destination_description'); end if;
  if p_destination_facility_id is distinct from v_trip.destination_facility_id then v_changed := array_append(v_changed, 'destination_facility_id'); end if;
  if v_instructions is distinct from nullif(btrim(v_trip.instructions), '') then v_changed := array_append(v_changed, 'instructions'); end if;
  if v_assistance_notes is distinct from nullif(btrim(v_trip.assistance_notes), '') then v_changed := array_append(v_changed, 'assistance_notes'); end if;

  -- No-op: no UPDATE, no updated_at bump, no audit, no event.
  if cardinality(v_changed) = 0 then
    v_result.trip_id := v_trip.id;
    v_result.changed := false;
    v_result.changed_fields := v_changed;
    v_result.updated_at := v_trip.updated_at;
    return v_result;
  end if;

  -- Appointment vs pickup (only when either timing field actually changes).
  if ('scheduled_pickup_at' = any (v_changed) or 'appointment_at' = any (v_changed))
     and p_scheduled_pickup_at is not null and p_appointment_at is not null
     and p_appointment_at < p_scheduled_pickup_at then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Facilities: same organization + active, enforced only for a CHANGED id (an unchanged, later-deactivated facility
  -- never blocks an unrelated correction).
  if 'pickup_facility_id' = any (v_changed) and p_pickup_facility_id is not null and not exists (
    select 1 from public.facilities where id = p_pickup_facility_id and organization_id = v_trip.organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if 'destination_facility_id' = any (v_changed) and p_destination_facility_id is not null and not exists (
    select 1 from public.facilities where id = p_destination_facility_id and organization_id = v_trip.organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Recurring occurrence identity = the ARRANGEMENT-local date of scheduled_pickup_at (the same expression
  -- create_trip_for_recurring_occurrence and recurring-care use). It can never move to another occurrence date, in
  -- any state (ZW006: a rule of the record, not of the lifecycle).
  if 'scheduled_pickup_at' = any (v_changed) and v_trip.recurring_arrangement_id is not null
     and v_trip.scheduled_pickup_at is not null then
    select timezone into v_arrangement_timezone from public.recurring_arrangements where id = v_trip.recurring_arrangement_id;
    if (p_scheduled_pickup_at at time zone v_arrangement_timezone)::date
       <> (v_trip.scheduled_pickup_at at time zone v_arrangement_timezone)::date then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  -- Lifecycle field matrix (owner-approved, D-5). A changed field that is locked in the current state: ZW004.
  v_editable := case v_trip.state
    when 'scheduled' then array['scheduled_pickup_at', 'appointment_at', 'pickup_description', 'pickup_facility_id',
                                'destination_description', 'destination_facility_id', 'instructions', 'assistance_notes']
    when 'en_route_to_pickup' then array['scheduled_pickup_at', 'appointment_at', 'pickup_description', 'pickup_facility_id',
                                'destination_description', 'destination_facility_id', 'instructions', 'assistance_notes']
    when 'arrived_at_pickup' then array['appointment_at', 'destination_description', 'destination_facility_id',
                                'instructions', 'assistance_notes']
    when 'passenger_onboard' then array['appointment_at', 'destination_description', 'destination_facility_id', 'instructions']
    when 'en_route_to_destination' then array['appointment_at', 'destination_description', 'destination_facility_id', 'instructions']
    else array[]::text[]  -- arrived_at_destination, completed, cancelled, no_show: all owned details locked
  end;
  foreach v_field in array v_changed loop
    if not (v_field = any (v_editable)) then
      raise exception 'illegal_transition' using errcode = 'ZW004';
    end if;
  end loop;

  -- en_route_to_pickup (D-5 amendment): the pickup TIME may change, but never its ORGANIZATION-local service DATE --
  -- the driver is already travelling for that date. A first pickup on a pickup-less trip has no date to keep.
  if v_trip.state = 'en_route_to_pickup' and 'scheduled_pickup_at' = any (v_changed) and v_trip.scheduled_pickup_at is not null then
    select timezone into v_org_timezone from public.organizations where id = v_trip.organization_id;
    if (p_scheduled_pickup_at at time zone v_org_timezone)::date
       <> (v_trip.scheduled_pickup_at at time zone v_org_timezone)::date then
      raise exception 'illegal_transition' using errcode = 'ZW004';
    end if;
  end if;

  -- Before / after: changed owned fields only (D-1: descriptions / instructions / assistance text included; never any
  -- Passenger or Requester data).
  foreach v_field in array v_changed loop
    v_before := v_before || jsonb_build_object(v_field, case v_field
      when 'scheduled_pickup_at' then to_jsonb(v_trip.scheduled_pickup_at)
      when 'appointment_at' then to_jsonb(v_trip.appointment_at)
      when 'pickup_description' then to_jsonb(v_trip.pickup_description)
      when 'pickup_facility_id' then to_jsonb(v_trip.pickup_facility_id)
      when 'destination_description' then to_jsonb(v_trip.destination_description)
      when 'destination_facility_id' then to_jsonb(v_trip.destination_facility_id)
      when 'instructions' then to_jsonb(v_trip.instructions)
      when 'assistance_notes' then to_jsonb(v_trip.assistance_notes)
    end);
    v_after := v_after || jsonb_build_object(v_field, case v_field
      when 'scheduled_pickup_at' then to_jsonb(p_scheduled_pickup_at)
      when 'appointment_at' then to_jsonb(p_appointment_at)
      when 'pickup_description' then to_jsonb(v_pickup_description)
      when 'pickup_facility_id' then to_jsonb(p_pickup_facility_id)
      when 'destination_description' then to_jsonb(v_destination_description)
      when 'destination_facility_id' then to_jsonb(p_destination_facility_id)
      when 'instructions' then to_jsonb(v_instructions)
      when 'assistance_notes' then to_jsonb(v_assistance_notes)
    end);
  end loop;
  v_after := v_after || jsonb_build_object('trip_state', v_trip.state);

  -- Only the changed columns are written; unchanged columns keep their stored representation.
  update public.trips set
    scheduled_pickup_at = case when 'scheduled_pickup_at' = any (v_changed) then p_scheduled_pickup_at else scheduled_pickup_at end,
    appointment_at = case when 'appointment_at' = any (v_changed) then p_appointment_at else appointment_at end,
    pickup_description = case when 'pickup_description' = any (v_changed) then v_pickup_description else pickup_description end,
    pickup_facility_id = case when 'pickup_facility_id' = any (v_changed) then p_pickup_facility_id else pickup_facility_id end,
    destination_description = case when 'destination_description' = any (v_changed) then v_destination_description else destination_description end,
    destination_facility_id = case when 'destination_facility_id' = any (v_changed) then p_destination_facility_id else destination_facility_id end,
    instructions = case when 'instructions' = any (v_changed) then v_instructions else instructions end,
    assistance_notes = case when 'assistance_notes' = any (v_changed) then v_assistance_notes else assistance_notes end
  where id = v_trip.id
  returning updated_at into v_updated_at;

  -- Operational timeline: field NAMES only, never corrected values; never a lifecycle event.
  insert into public.trip_events (organization_id, trip_id, event_type, actor_user_id, metadata)
  values (v_trip.organization_id, v_trip.id, 'trip_details_updated', auth.uid(),
          jsonb_build_object('changed_fields', to_jsonb(v_changed), 'trip_state', v_trip.state));

  -- Administrative history (Organization Admin readable only).
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_trip.organization_id, 'trip', v_trip.id, 'trip_details_updated', auth.uid(), v_before, v_after);

  v_result.trip_id := v_trip.id;
  v_result.changed := true;
  v_result.changed_fields := v_changed;
  v_result.updated_at := v_updated_at;
  return v_result;
end;
$$;

comment on function public.update_trip_details(uuid, timestamptz, timestamptz, timestamptz, text, uuid, text, uuid, text, text) is
  'P1-PILOT-R2B (PR-01). Organization Admin / Dispatcher of the Trip''s organization only (otherwise ZW002, no oracle). The sole path to correct a Trip''s own planning details: scheduled_pickup_at, appointment_at, pickup/destination description + facility, instructions, assistance_notes (full replacement). Never touches passenger_id, request_id, recurring_arrangement_id, state, duration, wheelchair requirement, lifecycle timestamps or assignments. Row-locked; p_expected_updated_at must equal trips.updated_at (ZW003 otherwise). create_trip validation (ZW006); a set pickup can not be cleared (ZW006); a recurring occurrence keeps its arrangement-local service date (ZW006). Lifecycle matrix: scheduled + en_route_to_pickup all fields (en_route: same organization-local pickup date only); arrived_at_pickup appointment/destination/instructions/assistance; passenger_onboard + en_route_to_destination appointment/destination/instructions; arrived_at_destination + terminal none (ZW004). No-op writes nothing (changed=false). Otherwise one audit_events row (trip_details_updated; changed fields before/after + trip_state) and one trip_events row (trip_details_updated; field names only).';

revoke all on function public.update_trip_details(uuid, timestamptz, timestamptz, timestamptz, text, uuid, text, uuid, text, text) from public;
grant execute on function public.update_trip_details(uuid, timestamptz, timestamptz, timestamptz, text, uuid, text, uuid, text, text) to authenticated;

-- 3. PR-15: no direct UPDATE on trips ---------------------------------------------------------------------------------
revoke update (appointment_at, assistance_notes, destination_description, destination_facility_id, instructions,
               pickup_description, pickup_facility_id, scheduled_pickup_at) on public.trips from authenticated;
revoke update on public.trips from authenticated;
drop policy trips_update_org_operations on public.trips;

-- 4. SEC-HYGIENE-2: no direct UPDATE on transportation_requests -------------------------------------------------------
revoke update (additional_notes, assistance_notes, destination_description, pickup_description, preferred_date,
               preferred_time, requester_email, requester_name, requester_phone, requester_relationship,
               return_trip_needed, source) on public.transportation_requests from authenticated;
revoke update on public.transportation_requests from authenticated;
drop policy transportation_requests_update_org_operations on public.transportation_requests;
