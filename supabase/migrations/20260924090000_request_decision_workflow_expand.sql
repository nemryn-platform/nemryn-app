-- P1-OPS-R1 -- Request acceptance + decision workflow -- EXPAND (1 of 2).
--
-- WHY
-- ----
-- First-customer QA (a real website Request in the new Zenward tenant) showed that a Pending Request offered
-- Decline + Cancel but no Accept, and that the only path to `accepted` was implicit: create_trip flipped
-- pending -> accepted on the first Trip (20260916110000). Passenger linking read as a substitute for a business
-- decision. P1-OPS-R1 makes the decision explicit and separates it from operational readiness (ZD-204).
--
-- TARGET STATE MODEL (the table's 4-value CHECK is UNCHANGED -- no new state, no `ready` state):
--   pending  -> accepted   accept_transportation_request
--   pending  -> declined   decline_transportation_request (reason code required)
--   accepted -> cancelled  cancel_transportation_request  (reason code required; blocked by ANY linked Trip)
--   declined, cancelled: terminal. Readiness (active linked Passenger) stays DERIVED.
--
-- RELEASE SHAPE (P1-OPS-R1R): EXPAND -> deploy app -> CONTRACT, with no window in which the running app breaks.
--   THIS migration (EXPAND) is purely additive for the currently deployed (pre-R1) application:
--     + request_accepted event type, request_events.reason_code / reason_note (+ checks, index)
--     + _validate_request_decision_reason (internal)
--     + accept_transportation_request (new)
--     + decline_transportation_request(uuid, uuid, text, text)  NEW reason-aware overload (p_reason_note has NO
--       default here, so it can never be ambiguous with the legacy 3-argument overload; CONTRACT adds the default)
--     + cancel_transportation_request(uuid, uuid, text, text)   NEW reason-aware overload (accepted -> cancelled)
--     ~ link_request_passenger: widened to pending OR accepted-without-Trips (a superset of the old rule)
--   LEFT UNTOUCHED ON PURPOSE (the old app depends on them until the new app is live):
--     = decline_transportation_request(uuid, uuid, text)  legacy: pending -> declined, optional free-text reason
--     = cancel_transportation_request(uuid, uuid)         legacy: pending -> cancelled, no reason
--     = create_trip                                       legacy: pending|accepted, implicit pending -> accepted
--   Every row the legacy paths can write during the window has a shape production ALREADY contains from before
--   R1 (declines with optional free-text reason, cancels from pending, Requests accepted by their first Trip).
--   No new row shape and no invariant of the target model is violated; the new app never calls them.
--   CONTRACT (20260924091000) drops the two legacy overloads, makes create_trip accepted-only (removing the
--   implicit acceptance), requires a reason on every new decline/cancel event, and adds p_reason_note's default.
--
-- AUTHORIZATION: unchanged model -- has_org_role(org, [organization_admin, dispatcher]) (active Membership +
-- active organization; Driver, inactive Membership, suspended organization, foreign tenant and a bare
-- PlatformAdminGrant all get ZW002). SECURITY DEFINER, pinned search_path, Request-row lock before every state
-- check (ZD-086), `changed` idempotency signal (ZD-090). No table grant, RLS policy or intake change.

-- =============================================================================
-- 1. request_events: new event type + structured decision reason
-- =============================================================================
alter table public.request_events drop constraint request_events_event_type_check;
alter table public.request_events add constraint request_events_event_type_check check (
  event_type in ('request_logged', 'passenger_linked', 'request_accepted', 'request_declined', 'request_cancelled')
);

alter table public.request_events
  add column reason_code text,
  add column reason_note text;

alter table public.request_events add constraint request_events_reason_code_check check (
  reason_code is null
  or (event_type = 'request_declined' and reason_code in (
        'outside_service_area', 'no_availability', 'unsupported_transportation_need',
        'requested_time_unavailable', 'duplicate_request', 'other'))
  or (event_type = 'request_cancelled' and reason_code in (
        'requester_cancelled', 'no_availability', 'unable_to_reach_requester', 'duplicate_request', 'other'))
);

alter table public.request_events add constraint request_events_reason_note_check check (
  reason_note is null or (length(reason_note) between 1 and 500 and btrim(reason_note) = reason_note)
);

alter table public.request_events add constraint request_events_reason_other_note_check check (
  reason_code is distinct from 'other' or reason_note is not null
);

-- The "reason required on every new decline/cancel event" constraint is added in CONTRACT: the legacy decline
-- overload (still live during the deploy window) writes reason-less events exactly as it always has.

comment on column public.request_events.reason_code is
  'P1-OPS-R1. Structured decision reason, set only on request_declined / request_cancelled events (closed per-event set, see request_events_reason_code_check). Required on every event written after the P1-OPS-R1 CONTRACT migration; NULL on earlier events (their optional free-text reason, if any, is metadata.reason).';
comment on column public.request_events.reason_note is
  'P1-OPS-R1. Optional short operator explanation (<= 500 chars) accompanying reason_code; required when reason_code = ''other''. Operator free text -- never copied into audit_events.';

create index request_events_decision_reason_idx
  on public.request_events (organization_id, event_type, reason_code)
  where reason_code is not null;

-- =============================================================================
-- 2. Reason validation helper (internal, owner-only)
-- =============================================================================
-- Returns the normalised note, or raises ZW006. The allowed codes are the same sets the table constraint
-- enforces; validating here keeps the RPC error a clean ZW006 rather than a raw constraint violation.
create function public._validate_request_decision_reason(p_event_type text, p_reason_code text, p_reason_note text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(p_reason_note), '');
begin
  if p_reason_code is null
     or (p_event_type = 'request_declined' and p_reason_code not in (
           'outside_service_area', 'no_availability', 'unsupported_transportation_need',
           'requested_time_unavailable', 'duplicate_request', 'other'))
     or (p_event_type = 'request_cancelled' and p_reason_code not in (
           'requester_cancelled', 'no_availability', 'unable_to_reach_requester', 'duplicate_request', 'other'))
     or p_event_type not in ('request_declined', 'request_cancelled') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_reason_code = 'other' and v_note is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  return v_note;
end;
$$;

comment on function public._validate_request_decision_reason(text, text, text) is
  'INTERNAL, owner-only (no client EXECUTE). P1-OPS-R1 shared reason validation for decline_/cancel_transportation_request. Returns the trimmed note; ZW006 for a missing/unknown code, a note over 500 chars, or `other` without a note.';

revoke all on function public._validate_request_decision_reason(text, text, text) from public, anon, authenticated, service_role;

-- =============================================================================
-- 3. accept_transportation_request -- pending -> accepted (NEW)
-- =============================================================================
create function public.accept_transportation_request(
  p_organization_id uuid,
  p_request_id uuid
)
returns public.request_transition_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.transportation_requests;
  v_result public.request_transition_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Same Request-row lock create_trip / link_request_passenger / decline / cancel take: every decision
  -- and every Trip creation against this Request is serialised here.
  select * into v_request
  from public.transportation_requests
  where id = p_request_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Double-click / concurrent second Accept: safe no-op, no second event.
  if v_request.state = 'accepted' then
    v_result.request_id := v_request.id;
    v_result.organization_id := v_request.organization_id;
    v_result.previous_state := v_request.state;
    v_result.current_state := v_request.state;
    v_result.changed := false;
    return v_result;
  end if;

  -- declined / cancelled are terminal.
  if v_request.state <> 'pending' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- Only `state` changes: no Passenger, Trip, assignment, provenance or requester field is touched.
  update public.transportation_requests set state = 'accepted' where id = p_request_id;

  insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata)
  values (p_organization_id, p_request_id, 'request_accepted', auth.uid(), '{}'::jsonb);

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'transportation_request', p_request_id, 'request_accepted', auth.uid(),
    jsonb_build_object('state', 'pending'), jsonb_build_object('state', 'accepted')
  );

  v_result.request_id := v_request.id;
  v_result.organization_id := v_request.organization_id;
  v_result.previous_state := 'pending';
  v_result.current_state := 'accepted';
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.accept_transportation_request(uuid, uuid) is
  'P1-OPS-R1. Organization Admin / Dispatcher of an ACTIVE organization only (Driver, inactive Membership, suspended organization, foreign tenant, PlatformAdminGrant alone: ZW002). pending -> accepted under a Request-row lock; idempotent no-op when already accepted; ZW004 from declined/cancelled. Writes one request_accepted RequestEvent and one AuditEvent. Never creates a Passenger, Trip or assignment and never touches provenance.';

revoke all on function public.accept_transportation_request(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.accept_transportation_request(uuid, uuid) to authenticated;

-- =============================================================================
-- 4. decline_transportation_request -- pending -> declined, reason REQUIRED
-- =============================================================================
-- New overload beside the legacy (uuid, uuid, text) one (dropped in CONTRACT). p_reason_note deliberately has NO
-- default in EXPAND: with a default, a 3-argument positional call would match both overloads ("is not unique").
-- Callers always pass it (NULL / '' = no note). CONTRACT adds `default null` once the legacy overload is gone.

create function public.decline_transportation_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_reason_code text,
  p_reason_note text
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
  'P1-OPS-R1. Organization Admin / Dispatcher of an ACTIVE organization only (ZW002 otherwise). Only pending -> declined (ZW004 from accepted/cancelled); idempotent no-op when already declined. p_reason_note has no default until the CONTRACT migration (pass NULL). p_reason_code REQUIRED from the closed decline set (outside_service_area, no_availability, unsupported_transportation_need, requested_time_unavailable, duplicate_request, other); p_reason_note optional (<= 500), required for other (ZW006). Reason is stored on the request_declined RequestEvent (reason_code / reason_note); AuditEvent carries the code only.';

revoke all on function public.decline_transportation_request(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.decline_transportation_request(uuid, uuid, text, text) to authenticated;

-- =============================================================================
-- 5. cancel_transportation_request -- accepted -> cancelled, reason REQUIRED
-- =============================================================================
-- New overload beside the legacy (uuid, uuid) one (dropped in CONTRACT). No arity overlap, so the default is safe.
create function public.cancel_transportation_request(
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
  'P1-OPS-R1. Organization Admin / Dispatcher of an ACTIVE organization only (ZW002 otherwise). Only accepted -> cancelled, and only while ZERO Trips exist for the Request (ZW004 from pending/declined, or when any linked Trip exists -- never cascades into Trip cancellation); idempotent no-op when already cancelled. p_reason_code REQUIRED from the closed cancel set (requester_cancelled, no_availability, unable_to_reach_requester, duplicate_request, other); p_reason_note optional (<= 500), required for other (ZW006). Reason stored on the request_cancelled RequestEvent; AuditEvent carries the code only.';

revoke all on function public.cancel_transportation_request(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_transportation_request(uuid, uuid, text, text) to authenticated;

-- Legacy overloads: behaviour UNCHANGED, re-documented as transitional. EXECUTE stays authenticated-only (their
-- existing ACL); the privilege contract lists them as TRANSITIONAL (allowed, must be gone after CONTRACT).
comment on function public.decline_transportation_request(uuid, uuid, text) is
  'LEGACY -- P1-OPS-R1 transitional (EXPAND -> CONTRACT only). Pre-R1 decline used by the previously deployed app: pending -> declined, optional free-text reason in request_events.metadata.reason, no reason code. Dropped by the P1-OPS-R1 CONTRACT migration; the new app calls decline_transportation_request(uuid, uuid, text, text).';
comment on function public.cancel_transportation_request(uuid, uuid) is
  'LEGACY -- P1-OPS-R1 transitional (EXPAND -> CONTRACT only). Pre-R1 cancel used by the previously deployed app: pending -> cancelled (only while no Trip exists), no reason -- the same row shape production already holds from before R1. Dropped by the P1-OPS-R1 CONTRACT migration; the new app calls cancel_transportation_request(uuid, uuid, text, text) (accepted -> cancelled).';

-- =============================================================================
-- 6. link_request_passenger -- legal while pending OR accepted, until a Trip exists
-- =============================================================================
-- Signature, return type, validation and idempotency unchanged. Only the state rule widens: an accepted
-- Request must still be able to get its Passenger (Accept -> Link Passenger -> Create Trip). Once any
-- Trip exists the Request's Passenger is frozen (the Trip carries its own passenger_id, and create_trip
-- requires every further Trip to use the Request's Passenger). Linking never changes the decision state.
create or replace function public.link_request_passenger(
  p_organization_id uuid,
  p_request_id uuid,
  p_passenger_id uuid
)
returns public.request_passenger_link_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  'Organization Admin / Dispatcher only. P1-OPS-R1: legal while the Request is pending OR accepted AND no Trip exists for it yet (ZW004 otherwise -- declined/cancelled, or a Request that already produced a Trip, whose Passenger is frozen). Never changes the Request state. Passenger must exist, same organization, active (ZW006 otherwise, no existence oracle). Idempotent no-op if the Request already links this exact passenger_id.';

-- =============================================================================
-- 7. Table documentation
-- =============================================================================
comment on table public.transportation_requests is
  'PUBLIC-INTAKE -> TENANT-OWNED (domain-model.md §B). Decision lifecycle (P1-OPS-R1): pending -> accepted (accept_transportation_request) | pending -> declined (decline_transportation_request, reason required) ; accepted -> cancelled (cancel_transportation_request, reason required, only while no Trip exists). declined and cancelled are terminal. Operational readiness (linked active Passenger) is derived, never stored. TRANSITIONAL between the P1-OPS-R1 EXPAND and CONTRACT migrations: the legacy decline/cancel overloads and create_trip''s implicit pending -> accepted still exist for the previously deployed app. Every intake path creates state = pending. state and passenger_id are not client-writable; raw client INSERT is retired.';
