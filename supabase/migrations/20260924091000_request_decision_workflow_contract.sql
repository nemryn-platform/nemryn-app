-- P1-OPS-R1 -- Request acceptance + decision workflow -- CONTRACT (2 of 2).
--
-- Apply ONLY after the P1-OPS-R1 application is live (EXPAND -> deploy app -> smoke -> CONTRACT). The new app
-- never calls anything removed or tightened here, so this migration has no effect on a correctly deployed app.
--
-- Removes the transitional bridge that EXPAND (20260924090000) left for the previously deployed app, and enforces
-- the target decision model at the database:
--   - drop decline_transportation_request(uuid, uuid, text)  (legacy: optional free-text reason)
--   - drop cancel_transportation_request(uuid, uuid)         (legacy: pending -> cancelled)
--   - decline_transportation_request(uuid, uuid, text, text): p_reason_note gains `default null` (safe now that the
--     3-argument legacy overload no longer exists; CREATE OR REPLACE may add a default)
--   - create_trip: a Request-linked Trip requires state = 'accepted' (was pending|accepted) and the implicit
--     pending -> accepted transition is removed; acceptance is exclusively accept_transportation_request
--   - request_events_decision_reason_required (NOT VALID): every NEW decline/cancel event must carry a reason_code;
--     historical rows -- including any legacy decline written during the deploy window -- are not re-validated
-- No table grant, RLS policy, intake path or data row is changed.

-- =============================================================================
-- 1. Retire the legacy overloads
-- =============================================================================
drop function public.decline_transportation_request(uuid, uuid, text);
drop function public.cancel_transportation_request(uuid, uuid);

-- =============================================================================
-- 2. decline_transportation_request: p_reason_note defaults to NULL (body unchanged from EXPAND)
-- =============================================================================
create or replace function public.decline_transportation_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_reason_code text,
  p_reason_note text default null
)
returns public.request_transition_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.transportation_requests;
  v_note text;
  v_result public.request_transition_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_note := public._validate_request_decision_reason('request_declined', p_reason_code, p_reason_note);

  select * into v_request
  from public.transportation_requests
  where id = p_request_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_request.state = 'declined' then
    v_result.request_id := v_request.id;
    v_result.organization_id := v_request.organization_id;
    v_result.previous_state := v_request.state;
    v_result.current_state := v_request.state;
    v_result.changed := false;
    return v_result;
  end if;

  -- Only pending -> declined. An accepted Request is ended with Cancel, never Decline.
  if v_request.state <> 'pending' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  update public.transportation_requests set state = 'declined' where id = p_request_id;

  insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata, reason_code, reason_note)
  values (p_organization_id, p_request_id, 'request_declined', auth.uid(), '{}'::jsonb, p_reason_code, v_note);

  -- reason_code only; the operator's free-text note stays on the tenant-visible RequestEvent.
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (
    p_organization_id, 'transportation_request', p_request_id, 'request_declined', auth.uid(),
    jsonb_build_object('state', 'pending'), jsonb_build_object('state', 'declined', 'reason_code', p_reason_code),
    p_reason_code
  );

  v_result.request_id := v_request.id;
  v_result.organization_id := v_request.organization_id;
  v_result.previous_state := 'pending';
  v_result.current_state := 'declined';
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.decline_transportation_request(uuid, uuid, text, text) is
  'P1-OPS-R1. Organization Admin / Dispatcher of an ACTIVE organization only (ZW002 otherwise). Only pending -> declined (ZW004 from accepted/cancelled); idempotent no-op when already declined. p_reason_code REQUIRED from the closed decline set (outside_service_area, no_availability, unsupported_transportation_need, requested_time_unavailable, duplicate_request, other); p_reason_note optional (<= 500), required for other (ZW006). Reason is stored on the request_declined RequestEvent (reason_code / reason_note); AuditEvent carries the code only.';

comment on function public.cancel_transportation_request(uuid, uuid, text, text) is
  'P1-OPS-R1. Organization Admin / Dispatcher of an ACTIVE organization only (ZW002 otherwise). Only accepted -> cancelled, and only while ZERO Trips exist for the Request (ZW004 from pending/declined, or when any linked Trip exists -- never cascades into Trip cancellation); idempotent no-op when already cancelled. p_reason_code REQUIRED from the closed cancel set (requester_cancelled, no_availability, unable_to_reach_requester, duplicate_request, other); p_reason_note optional (<= 500), required for other (ZW006). Reason stored on the request_cancelled RequestEvent; AuditEvent carries the code only.';

-- CREATE OR REPLACE keeps the existing ACL (authenticated EXECUTE only); restated for clarity.
revoke all on function public.decline_transportation_request(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.decline_transportation_request(uuid, uuid, text, text) to authenticated;

-- =============================================================================
-- 3. Every NEW decline / cancel event must carry a reason code
-- =============================================================================
-- NOT VALID: historical rows (pre-R1, and any legacy decline written between EXPAND and CONTRACT) keep their
-- optional free-text reason in metadata.reason and are deliberately not re-validated.
alter table public.request_events add constraint request_events_decision_reason_required check (
  event_type not in ('request_declined', 'request_cancelled') or reason_code is not null
) not valid;

comment on column public.request_events.reason_code is
  'P1-OPS-R1. Structured decision reason, set only on request_declined / request_cancelled events (closed per-event set, see request_events_reason_code_check). Required on every event written since the P1-OPS-R1 CONTRACT migration (request_events_decision_reason_required, NOT VALID); NULL on earlier events (their optional free-text reason, if any, is metadata.reason).';

-- =============================================================================
-- 4. create_trip -- a Request-linked Trip requires state = 'accepted'
-- =============================================================================
-- Signature unchanged (CREATE OR REPLACE keeps the ACL). Body identical to 20260916110000 except inside the
-- p_request_id block: `state = 'accepted'` is now required (was pending|accepted), and the implicit
-- pending -> accepted transition after the Trip INSERT is removed.
create or replace function public.create_trip(
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
  p_request_id uuid default null
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

  -- TransportationRequest relationship: optional, 1:N. Locked FOR UPDATE (the same lock every Request
  -- decision takes). P1-OPS-R1: the Request must have been explicitly ACCEPTED -- pending, declined and
  -- cancelled are all rejected (ZW006, the existing category for an unusable Request). P1-E1-S2F-A: the
  -- Request's own linked Passenger is authoritative and must equal p_passenger_id.
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

  insert into public.trips (
    organization_id, request_id, passenger_id, state,
    scheduled_pickup_at, appointment_at, pickup_description, destination_description,
    pickup_facility_id, destination_facility_id, assistance_notes, instructions
  ) values (
    p_organization_id, p_request_id, p_passenger_id, 'scheduled',
    p_scheduled_pickup_at, p_appointment_at, v_pickup_description, v_destination_description,
    p_pickup_facility_id, p_destination_facility_id, p_assistance_notes, p_instructions
  )
  returning id into v_new_trip_id;

  v_event_type := case when p_request_id is not null then 'request_converted_to_trip' else 'trip_scheduled' end;

  insert into public.trip_events (organization_id, trip_id, event_type, actor_user_id, metadata)
  values (p_organization_id, v_new_trip_id, v_event_type, auth.uid(), jsonb_build_object('request_id', p_request_id));

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'trip', v_new_trip_id, 'trip_created', auth.uid(),
    null,
    jsonb_build_object('state', 'scheduled', 'passenger_id', p_passenger_id, 'request_id', p_request_id)
  );

  v_result.trip_id := v_new_trip_id;
  v_result.organization_id := p_organization_id;
  v_result.state := 'scheduled';
  v_result.created := true;
  return v_result;
end;
$$;

comment on function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid) is
  'Organization Admin / Dispatcher only. The sole controlled path to create a Trip — state is always ''scheduled'', never caller-supplied. Does not assign a Driver/Vehicle (use assign_trip). Non-idempotent by design. When p_request_id is supplied: P1-OPS-R1 -- the Request must be ACCEPTED (pending/declined/cancelled: ZW006) and this function never changes the Request state (acceptance is exclusively accept_transportation_request); P1-E1-S2F-A -- the Request''s own linked passenger_id must be non-null and equal p_passenger_id (ZW006). See docs/data/mutation-api.md for the full contract.';

-- =============================================================================
-- 5. Table documentation (transitional note removed)
-- =============================================================================
comment on table public.transportation_requests is
  'PUBLIC-INTAKE -> TENANT-OWNED (domain-model.md §B). Decision lifecycle (P1-OPS-R1): pending -> accepted (accept_transportation_request) | pending -> declined (decline_transportation_request, reason required) ; accepted -> cancelled (cancel_transportation_request, reason required, only while no Trip exists). declined and cancelled are terminal. Operational readiness (linked active Passenger) is derived, never stored; Trips (1:N, create_trip) require state = accepted. Every intake path creates state = pending. state and passenger_id are not client-writable; raw client INSERT is retired.';
