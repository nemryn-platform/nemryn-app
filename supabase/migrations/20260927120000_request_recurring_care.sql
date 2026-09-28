-- =============================================================================
-- P1-PILOT-R3 -- Request -> Recurring Care (PR-04) (database part).
-- Spec: docs/reports/p1-pilot-r2a-trip-correction-recovery-spec.txt section 21, superseded where they differ by the
-- R3 owner decisions D-R3-1..D-R3-5 (recorded in docs/reports/p1-pilot-r3-request-recurring-care-implementation.txt).
--
--   1. recurring_arrangements.request_id uuid NULL -- the originating accepted Request. Same-organization composite FK
--      (request_id, organization_id) -> transportation_requests (id, organization_id), default NO ACTION (the pattern
--      trips.request_id already uses; nothing cascades -- Requests and arrangements are operational history).
--      NOT unique: one Request may legitimately produce several arrangements (D-R3-2, e.g. a separate return schedule).
--      Non-unique partial index for the Request -> arrangements lookups / anti-join. No backfill: existing rows NULL.
--   2. create_recurring_arrangement gains ONE trailing p_request_id uuid DEFAULT NULL (9 -> 10 args; the 9-arg
--      version is dropped, so exactly one overload remains; every existing named / positional caller still resolves).
--      NULL = the unchanged behaviour. Supplied = the create_trip rule (accepted, same org, linked Passenger =
--      p_passenger_id); the Request state is never changed (D-R3-3); request_id is added to the existing
--      recurring_arrangement_created audit (scalar id only -- never requester data).
-- request_id is set only here: edit / pause / resume / end never touch it (they update named columns only), and
-- occurrence Trips keep using recurring_arrangement_id only (create_trip_for_recurring_occurrence is unchanged).
--   3. Pre-release hardening: link_request_passenger and cancel_transportation_request also refuse (ZW004) once ANY
--      recurring arrangement references the Request (active, paused or ended), matching their existing Trip guard.
-- No other schema change. No grant change on any table. No service-role path.
-- =============================================================================

-- 1. request_id ------------------------------------------------------------------------------------------------------
alter table public.recurring_arrangements add column request_id uuid;
alter table public.recurring_arrangements
  add constraint recurring_arrangements_request_id_organization_id_fkey
  foreign key (request_id, organization_id) references public.transportation_requests (id, organization_id);
create index recurring_arrangements_org_request_idx
  on public.recurring_arrangements (organization_id, request_id) where request_id is not null;

comment on column public.recurring_arrangements.request_id is
  'P1-PILOT-R3 (PR-04): the accepted transportation Request this arrangement was created from (NULL for arrangements created directly). Set only at creation by create_recurring_arrangement; never edited. Not unique: a Request may produce several arrangements. Any linked arrangement -- active, paused or ended -- fulfils the Request historically (D-R3-1).';

-- 2. create_recurring_arrangement (9 -> 10 args) ---------------------------------------------------------------------
drop function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date, boolean);

create function public.create_recurring_arrangement(
  p_organization_id uuid,
  p_passenger_id uuid,
  p_pickup_description text,
  p_destination_description text,
  p_pickup_time time,
  p_days_of_week smallint[],
  p_start_date date,
  p_end_date date default null,
  p_requires_wheelchair_access boolean default null,
  p_request_id uuid default null
)
returns public.recurring_arrangement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pickup_description text;
  v_destination_description text;
  v_days_of_week smallint[];
  v_timezone text;
  v_new public.recurring_arrangements;
  v_request public.transportation_requests;
  v_result public.recurring_arrangement_result;
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

  if p_pickup_time is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_start_date is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select array_agg(distinct d order by d) into v_days_of_week
  from unnest(p_days_of_week) as d
  where d is not null;

  if v_days_of_week is null or cardinality(v_days_of_week) = 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if exists (select 1 from unnest(v_days_of_week) as d where d < 1 or d > 7) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not public._is_canonical_days_of_week(v_days_of_week) then
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

  -- P1-PILOT-R3 (PR-04): optional originating Request -- the create_trip rule. Same organization (derived from the
  -- already-authorized organization, never a separate client value), ACCEPTED, and its linked Passenger must be exactly
  -- p_passenger_id (whose active status is enforced just above). Any failure is the identical ZW006 (no oracle). The
  -- Request is read under FOR SHARE (a concurrent decision change waits) and is NEVER modified: its state stays as is.
  if p_request_id is not null then
    select * into v_request
    from public.transportation_requests
    where id = p_request_id and organization_id = p_organization_id
    for share;
    if not found or v_request.state <> 'accepted' or v_request.passenger_id is distinct from p_passenger_id then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  select timezone into v_timezone from public.organizations where id = p_organization_id;
  if v_timezone is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  insert into public.recurring_arrangements (
    organization_id, passenger_id, pickup_description, destination_description,
    pickup_time, days_of_week, start_date, end_date, timezone, status, created_by, requires_wheelchair_access, request_id
  ) values (
    p_organization_id, p_passenger_id, v_pickup_description, v_destination_description,
    p_pickup_time, v_days_of_week, p_start_date, p_end_date, v_timezone, 'active', auth.uid(), p_requires_wheelchair_access,
    p_request_id
  )
  returning * into v_new;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'recurring_arrangement', v_new.id, 'recurring_arrangement_created', auth.uid(),
    null,
    jsonb_build_object(
      'passenger_id', v_new.passenger_id, 'pickup_description', v_new.pickup_description,
      'destination_description', v_new.destination_description, 'pickup_time', v_new.pickup_time,
      'days_of_week', v_new.days_of_week, 'start_date', v_new.start_date, 'end_date', v_new.end_date,
      'timezone', v_new.timezone, 'status', v_new.status,
      'requires_wheelchair_access', v_new.requires_wheelchair_access
    ) || case when v_new.request_id is not null then jsonb_build_object('request_id', v_new.request_id) else '{}'::jsonb end
  );

  v_result.arrangement_id := v_new.id;
  v_result.organization_id := v_new.organization_id;
  v_result.passenger_id := v_new.passenger_id;
  v_result.pickup_description := v_new.pickup_description;
  v_result.destination_description := v_new.destination_description;
  v_result.pickup_time := v_new.pickup_time;
  v_result.days_of_week := v_new.days_of_week;
  v_result.start_date := v_new.start_date;
  v_result.end_date := v_new.end_date;
  v_result.timezone := v_new.timezone;
  v_result.status := v_new.status;
  v_result.paused_at := v_new.paused_at;
  v_result.ended_at := v_new.ended_at;
  v_result.ended_reason := v_new.ended_reason;
  v_result.created_by := v_new.created_by;
  v_result.created_at := v_new.created_at;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date, boolean, uuid) is
  'Organization Admin / Dispatcher only. The sole controlled path to create a RecurringArrangement — status is always ''active'', paused_at/ended_at/ended_reason always NULL, created_by always auth.uid(), timezone always an Organization.timezone SNAPSHOT at creation time — none of these five fields is ever caller-influenced. Passenger must exist, same organization, status=''active'' (ZW006 otherwise, no existence oracle — same rule create_trip already enforces for its own passenger_id). days_of_week is normalized (deduplicated, ascending) before write; caller may supply any order. Non-idempotent by design (no natural idempotency key for creating new standing demand), matching create_trip/log_transportation_request. P1-OPS-PROG5 (Q4): optional p_requires_wheelchair_access (NULL = not specified), snapshotted onto occurrence trips at creation. P1-PILOT-R3 (PR-04): optional p_request_id — the originating Request must be in the same organization, ACCEPTED, with its linked Passenger = p_passenger_id (ZW006 otherwise, no oracle); stored as recurring_arrangements.request_id (never changed afterwards) and added to the creation audit; the Request itself is never modified.';

revoke all on function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date, boolean, uuid) from public;
grant execute on function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date, boolean, uuid) to authenticated;


-- 3. Request mutation guards after conversion (P1-PILOT-R3 pre-release hardening) ------------------------------------
-- Found in local review: the UI hid Cancel / Link Passenger once Recurring Care existed, but both RPCs checked only for
-- Trips. Both now also refuse (ZW004, the existing "operational work already exists" code) when ANY recurring
-- arrangement references the Request, whatever its status. Everything else in both functions is unchanged; grants are
-- kept by CREATE OR REPLACE (same identity).
create or replace function public.link_request_passenger(p_organization_id uuid, p_request_id uuid, p_passenger_id uuid)
 RETURNS request_passenger_link_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
declare
  v_request public.transportation_requests;
  v_result public.request_passenger_link_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_passenger_id is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_request
  from public.transportation_requests
  where id = p_request_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_request.state not in ('pending', 'accepted') then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  if exists (select 1 from public.trips where request_id = p_request_id and organization_id = p_organization_id) then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- P1-PILOT-R3: once ANY recurring arrangement (active, paused or ended -- D-R3-1) was created from this Request,
  -- its Passenger relationship is fixed: the arrangement carries its own passenger_id and request_id. Same code as the
  -- Trip guard above; organization from the authorized Request row (no oracle).
  if exists (select 1 from public.recurring_arrangements where request_id = p_request_id and organization_id = p_organization_id) then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  if not exists (
    select 1 from public.passengers
    where id = p_passenger_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if v_request.passenger_id is not distinct from p_passenger_id then
    v_result.request_id := v_request.id;
    v_result.organization_id := v_request.organization_id;
    v_result.passenger_id := v_request.passenger_id;
    v_result.changed := false;
    return v_result;
  end if;

  update public.transportation_requests set passenger_id = p_passenger_id where id = p_request_id;

  insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata)
  values (p_organization_id, p_request_id, 'passenger_linked', auth.uid(), jsonb_build_object('passenger_id', p_passenger_id));

  v_result.request_id := v_request.id;
  v_result.organization_id := v_request.organization_id;
  v_result.passenger_id := p_passenger_id;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.link_request_passenger(uuid, uuid, uuid) is
  'Organization Admin / Dispatcher only. P1-OPS-R1: legal while the Request is pending OR accepted AND no Trip exists for it yet (ZW004 otherwise -- declined/cancelled, or a Request that already produced a Trip, whose Passenger is frozen). Never changes the Request state. Passenger must exist, same organization, active (ZW006 otherwise, no existence oracle). Idempotent no-op if the Request already links this exact passenger_id. P1-PILOT-R3: also ZW004 once any recurring arrangement (active, paused or ended) references the Request.';

create or replace function public.cancel_transportation_request(p_organization_id uuid, p_request_id uuid, p_reason_code text, p_reason_note text DEFAULT NULL::text)
 RETURNS request_transition_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
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

  v_note := public._validate_request_decision_reason('request_cancelled', p_reason_code, p_reason_note);

  -- create_trip takes this same lock before inserting a Trip, so the linked-Trip check below can not race
  -- a concurrent Trip creation.
  select * into v_request
  from public.transportation_requests
  where id = p_request_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_request.state = 'cancelled' then
    v_result.request_id := v_request.id;
    v_result.organization_id := v_request.organization_id;
    v_result.previous_state := v_request.state;
    v_result.current_state := v_request.state;
    v_result.changed := false;
    return v_result;
  end if;

  -- Only accepted -> cancelled. A pending Request is ended with Decline.
  if v_request.state <> 'accepted' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- Unchanged locked rule: ANY linked Trip (any Trip state) blocks Request-level cancellation. Trips are
  -- cancelled individually on the Trip; nothing cascades from here.
  if exists (select 1 from public.trips where request_id = p_request_id and organization_id = p_organization_id) then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- P1-PILOT-R3: ANY linked recurring arrangement (active, paused or ended) also blocks Request-level cancellation.
  -- The standing order is managed in Recurring Care; nothing cascades (the arrangement is never ended, paused, deleted
  -- or modified from here) and the Request stays the accepted historical intake record. The Request row lock above
  -- serializes with create_recurring_arrangement's FOR SHARE read of the same row.
  if exists (select 1 from public.recurring_arrangements where request_id = p_request_id and organization_id = p_organization_id) then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  update public.transportation_requests set state = 'cancelled' where id = p_request_id;

  insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata, reason_code, reason_note)
  values (p_organization_id, p_request_id, 'request_cancelled', auth.uid(), '{}'::jsonb, p_reason_code, v_note);

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (
    p_organization_id, 'transportation_request', p_request_id, 'request_cancelled', auth.uid(),
    jsonb_build_object('state', 'accepted'), jsonb_build_object('state', 'cancelled', 'reason_code', p_reason_code),
    p_reason_code
  );

  v_result.request_id := v_request.id;
  v_result.organization_id := v_request.organization_id;
  v_result.previous_state := 'accepted';
  v_result.current_state := 'cancelled';
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.cancel_transportation_request(uuid, uuid, text, text) is
  'P1-OPS-R1. Organization Admin / Dispatcher of an ACTIVE organization only (ZW002 otherwise). Only accepted -> cancelled, and only while ZERO Trips exist for the Request (ZW004 from pending/declined, or when any linked Trip exists -- never cascades into Trip cancellation); idempotent no-op when already cancelled. p_reason_code REQUIRED from the closed cancel set (requester_cancelled, no_availability, unable_to_reach_requester, duplicate_request, other); p_reason_note optional (<= 500), required for other (ZW006). Reason stored on the request_cancelled RequestEvent; AuditEvent carries the code only. P1-PILOT-R3: also ZW004 once any recurring arrangement (active, paused or ended) references the Request; nothing cascades to the arrangement.';
