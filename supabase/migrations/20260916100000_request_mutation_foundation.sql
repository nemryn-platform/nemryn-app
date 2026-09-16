-- P1-E1-S2B — Request Mutation Foundation.
--
-- Closes the lifecycle-integrity gap identified in the P1-E1-S2A audit
-- (docs/reports/p1-e1-s2a-request-hub-product-workflow-audit.txt §8/§29):
-- `transportation_requests.state` and `.passenger_id` were directly
-- client-writable via a plain column-privileged UPDATE, with zero
-- business-rule enforcement of legal transitions — the same class of gap
-- GAP-1 already closed for `trips.state` via `create_trip`
-- (ZD-101/ZD-102). This migration establishes the same pattern for
-- TransportationRequest: narrow, SECURITY DEFINER RPCs are the only
-- controlled path for every lifecycle-sensitive write, and the
-- equivalent raw client privileges are retired in the same migration
-- that introduces the controlled replacement — never left open as a
-- silent bypass (the same "retire once the controlled path exists"
-- discipline as ZD-092/ZD-096/ZD-101).
--
-- Reuses every established convention exactly: the 6-code error contract
-- (ZD-085 — ZW001 unauthorized, ZW002 not_found/no existence oracle,
-- ZW004 illegal_transition, ZW006 invalid_input), live authorization via
-- `has_org_role` (never a caller-supplied identity), row-level `FOR
-- UPDATE` locking before any state-legality check (ZD-086), an explicit
-- composite return type per function (no wildcard serialization), the
-- `changed: boolean` idempotency signal (ZD-090) for every transition
-- RPC, `trip_events`' own proven append-only/allow-listed shape for the
-- new `request_events` table, and `create_trip`'s own "requested context,
-- never authority on its own" treatment of `p_organization_id`.
--
-- LOCKED PRODUCT DECISIONS carried forward unchanged from the phase
-- brief (all cross-referenced against the S2A audit, not re-litigated
-- here): "Create Trip" remains the sole acceptance action — no
-- `accept_transportation_request` is added, and `create_trip` itself is
-- NOT modified in this migration (audited for compatibility below and
-- found fully compatible as-is). Public intake remains deferred. No
-- recurring-care schema is added. `trips.leg` is NOT added. Operator/
-- action attribution lives exclusively in `request_events.actor_user_id`
-- — no `created_by`/`declined_by`/`declined_at` columns are added.

-- =============================================================================
-- A. transportation_requests.source
-- =============================================================================
-- Small constrained set, additive, NOT NULL with a safe backfill default
-- for existing rows (the 2 seed fixtures and any real historical row) —
-- `other` is the honest answer for a row whose actual originating channel
-- was never captured, never a fabricated specific channel. New
-- log_transportation_request() calls always supply an explicit,
-- validated value going forward (see below) — the column default exists
-- only for safe backfill / any other write path, not as an invitation to
-- omit it.
alter table public.transportation_requests
  add column source text not null default 'other'
    check (source in ('phone', 'facility', 'email', 'web', 'other'));

comment on column public.transportation_requests.source is
  'How this request reached the organization. Existing rows before this migration are backfilled to ''other'' (their real channel was never captured) — never inferred as a specific channel. log_transportation_request() always requires an explicit, validated value for new rows.';

-- =============================================================================
-- B. request_events — append-only request lifecycle history
-- =============================================================================
-- Mirrors public.trip_events exactly (20260830131200_trip_events.sql):
-- allow-listed event_type, tenant-safe composite FK back to the owning
-- Request, no UPDATE/DELETE grant to any role ever, no INSERT grant to
-- authenticated — only the SECURITY DEFINER functions below (running as
-- the function owner, which bypasses RLS for its own writes exactly as
-- create_trip already does for trip_events/audit_events) ever write a
-- row here. First-release event types cover only the actions this
-- foundation actually implements — no speculative vocabulary.
--
-- This is deliberately NOT a duplicate of trip_events and NOT a reuse of
-- audit_events: trip_events is keyed to trip_id (not extensible to a
-- Request without a schema change of its own), and audit_events'
-- existing SELECT policy is Organization Admin + Platform Admin ONLY —
-- Dispatcher has no access to it at all (authorization-model.md §46),
-- which would silently hide request history from one of the two roles
-- Request Hub itself serves. A small, dedicated, dispatcher-visible
-- table — the exact S2A audit finding (§26/§28) — is the correct fit.
create table public.request_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  request_id uuid not null,
  event_type text not null check (
    event_type in ('request_logged', 'passenger_linked', 'request_declined', 'request_cancelled')
  ),
  actor_user_id uuid references auth.users (id),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  foreign key (request_id, organization_id) references public.transportation_requests (id, organization_id)
);

comment on table public.request_events is
  'TENANT-OWNED, append-only, allow-listed event_type values only — mirrors trip_events exactly. No INSERT/UPDATE/DELETE grant to authenticated at all; every row is written by a trusted SECURITY DEFINER request-mutation function. request_converted_to_trip remains authoritative as a trip_events row (on the Trip side) — this table does not duplicate it.';

create index request_events_request_id_occurred_idx on public.request_events (request_id, occurred_at);
create index request_events_organization_id_idx on public.request_events (organization_id);

alter table public.request_events enable row level security;

-- SELECT only, for organization_admin/dispatcher, same organization —
-- the same two roles (and only those two) already granted access to
-- transportation_requests itself. Driver gets no policy at all (no
-- standing access, matching every other Request-adjacent table). No
-- anonymous grant of any kind.
grant select on public.request_events to authenticated;

create policy request_events_select_org_operations
  on public.request_events for select to authenticated
  using (public.has_org_role(organization_id, array['organization_admin', 'dispatcher']));

-- =============================================================================
-- C. Composite return types
-- =============================================================================
-- Mirrors trip_creation_result/trip_transition_result exactly
-- (20260831100100_mutation_result_types.sql) — small, typed,
-- self-documenting results, never a wildcard jsonb blob.
create type public.request_creation_result as (
  request_id uuid,
  organization_id uuid,
  state text,
  created boolean
);

comment on type public.request_creation_result is
  'Return shape for log_transportation_request. `created` is always true — like create_trip, this function is deliberately non-idempotent (no natural idempotency key exists for "record a new piece of demand"); the field exists for return-shape consistency with trip_creation_result, not because a no-op path exists here.';

create type public.request_transition_result as (
  request_id uuid,
  organization_id uuid,
  previous_state text,
  current_state text,
  changed boolean
);

comment on type public.request_transition_result is
  'Return shape for decline_transportation_request and cancel_transportation_request. Mirrors trip_transition_result exactly. previous_state/current_state describe the state actually observed at the end of the call — on an idempotent no-op they are equal.';

create type public.request_passenger_link_result as (
  request_id uuid,
  organization_id uuid,
  passenger_id uuid,
  changed boolean
);

comment on type public.request_passenger_link_result is
  'Return shape for link_request_passenger. Not a state transition (state remains pending throughout), so this is a distinct, smaller shape rather than a re-use of request_transition_result.';

-- =============================================================================
-- D. log_transportation_request — the sole controlled creation path
-- =============================================================================
-- Mirrors create_trip's own structure closely: auth -> live role check ->
-- explicit field validation (all ZW006, no existence oracle) -> optional
-- Passenger validation (identical shape to create_trip's own passenger
-- check) -> INSERT with state hard-coded 'pending' (never a parameter,
-- never caller-influenced in any way, exactly matching create_trip's own
-- 'scheduled' literal) -> one request_events row.
--
-- LOCKED DECISION: this is an authoritative RPC, not a raw client
-- INSERT, specifically because Nemryn will eventually have multiple
-- trusted UI clients (web/mobile/desktop) and request creation needs one
-- authoritative, testable business boundary shared by all of them
-- (rather than re-implementing field validation identically in every
-- client). The raw INSERT grant is retired below (section G), the same
-- migration that introduces this replacement.
create or replace function public.log_transportation_request(
  p_organization_id uuid,
  p_requester_name text,
  p_requester_relationship text,
  p_requester_phone text,
  p_pickup_description text,
  p_destination_description text,
  p_return_trip_needed text,
  p_source text,
  p_requester_email text default null,
  p_passenger_id uuid default null,
  p_preferred_date date default null,
  p_preferred_time time default null,
  p_assistance_notes text default null,
  p_additional_notes text default null
)
returns public.request_creation_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requester_name text;
  v_requester_phone text;
  v_requester_email text;
  v_pickup_description text;
  v_destination_description text;
  v_assistance_notes text;
  v_additional_notes text;
  v_new_request_id uuid;
  v_result public.request_creation_result;
begin
  -- -----------------------------------------------------------------------
  -- Authorization: identical shape to create_trip. organization_id is a
  -- REQUESTED context, never authority on its own — has_org_role
  -- re-validates it against the caller's actual, current, ACTIVE
  -- Membership every call. Failure is uniformly ZW002 not_found (a
  -- Driver, an inactive Membership, and a foreign-org caller are
  -- indistinguishable from each other or from a bad organization_id).
  -- -----------------------------------------------------------------------
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- -----------------------------------------------------------------------
  -- Field validation — matches the S2A-established minimum save contract
  -- exactly (docs/reports/p1-e1-s2a-request-hub-product-workflow-audit.txt
  -- §11): required fields are the table's own NOT NULL columns, nothing
  -- stricter. requester_relationship/return_trip_needed/source are
  -- revalidated here (even though the table's own CHECK constraints
  -- would also reject an invalid value) so a bad value produces a clean
  -- ZW006 rather than a raw constraint-violation error — the same
  -- defensive-duplication style create_trip already uses for NOT NULL.
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

  if p_source not in ('phone', 'facility', 'email', 'web', 'other') then
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
  -- Passenger (optional): identical validation shape to create_trip's own
  -- passenger check — must exist, same organization, active. No
  -- existence oracle (nonexistent and foreign-org both produce ZW006).
  -- -----------------------------------------------------------------------
  if p_passenger_id is not null and not exists (
    select 1 from public.passengers
    where id = p_passenger_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- The Request itself. state is hard-coded 'pending' — never a
  -- parameter, never caller-influenced in any way, exactly mirroring
  -- create_trip's own hard-coded 'scheduled'.
  -- -----------------------------------------------------------------------
  insert into public.transportation_requests (
    organization_id, passenger_id, requester_name, requester_relationship, requester_phone,
    requester_email, pickup_description, destination_description, preferred_date, preferred_time,
    return_trip_needed, assistance_notes, additional_notes, source, state
  ) values (
    p_organization_id, p_passenger_id, v_requester_name, p_requester_relationship, v_requester_phone,
    v_requester_email, v_pickup_description, v_destination_description, p_preferred_date, p_preferred_time,
    p_return_trip_needed, v_assistance_notes, v_additional_notes, p_source, 'pending'
  )
  returning id into v_new_request_id;

  insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata)
  values (p_organization_id, v_new_request_id, 'request_logged', auth.uid(), jsonb_build_object('source', p_source));

  v_result.request_id := v_new_request_id;
  v_result.organization_id := p_organization_id;
  v_result.state := 'pending';
  v_result.created := true;
  return v_result;
end;
$$;

comment on function public.log_transportation_request(
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text
) is
  'Organization Admin / Dispatcher only. The sole controlled path to create a TransportationRequest — state is always ''pending'', never caller-supplied. Optional passenger_id is validated exactly like create_trip''s own passenger check. Non-idempotent by design (no natural idempotency key for recording new demand), matching create_trip''s own documented reasoning.';

revoke all on function public.log_transportation_request(
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text
) from public;
grant execute on function public.log_transportation_request(
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text
) to authenticated;

-- =============================================================================
-- E. link_request_passenger
-- =============================================================================
-- Only legal while the Request is still 'pending' — accepted/declined/
-- cancelled are all rejected. This is a deliberately narrower rule than
-- "any non-terminal state": once a Request has produced a Trip
-- (state = 'accepted'), passenger reassignment on the ORIGINAL Request is
-- prohibited in this first release (locked decision) — the Trip already
-- carries its own passenger_id, independently correct regardless of what
-- the Request's own field says afterward.
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

  -- Lock before any state-legality check (ZD-086) — this is also the
  -- shared serialization boundary against a concurrent create_trip call
  -- on the SAME request (create_trip locks this exact row FOR UPDATE
  -- too), so a passenger link and a concurrent conversion cannot race:
  -- whichever transaction acquires the lock first commits (or rolls
  -- back) before the other proceeds, and the other then re-reads the
  -- now-current state.
  select * into v_request
  from public.transportation_requests
  where id = p_request_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_request.state != 'pending' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- Explicit organization + active-status validation, identical shape to
  -- create_trip's own passenger check — never trusted merely because RLS
  -- would otherwise hide a foreign-org row from a subsequent read.
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
  'Organization Admin / Dispatcher only. Legal only while the Request is still pending (ZW004 otherwise — includes accepted, where passenger reassignment is deliberately prohibited in this first release). Passenger must exist, same organization, active (ZW006 otherwise, no existence oracle). Idempotent no-op if the Request already links this exact passenger_id.';

revoke all on function public.link_request_passenger(uuid, uuid, uuid) from public;
grant execute on function public.link_request_passenger(uuid, uuid, uuid) to authenticated;

-- =============================================================================
-- F. decline_transportation_request / cancel_transportation_request
-- =============================================================================
-- Both: pending is the only legal starting state. No
-- accept_transportation_request exists and none is added here — "Create
-- Trip" (create_trip) remains the sole acceptance action, unchanged
-- (locked decision, audited for compatibility in this migration's own
-- header comment and confirmed unmodified below).
create or replace function public.decline_transportation_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_reason text default null
)
returns public.request_transition_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.transportation_requests;
  v_reason text;
  v_result public.request_transition_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Optional free text, no reason-category taxonomy (locked decision).
  -- Never discarded: persisted directly in the request_events row below,
  -- never only logged.
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_request
  from public.transportation_requests
  where id = p_request_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Idempotent no-op takes priority over the illegal-transition check
  -- when the target state already holds, matching cancel_trip's own
  -- established precedence (ZD-090).
  if v_request.state = 'declined' then
    v_result.request_id := v_request.id;
    v_result.organization_id := v_request.organization_id;
    v_result.previous_state := v_request.state;
    v_result.current_state := v_request.state;
    v_result.changed := false;
    return v_result;
  end if;

  -- Only pending -> declined is legal. accepted -> declined and
  -- cancelled -> declined are both rejected (locked decision).
  if v_request.state != 'pending' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  update public.transportation_requests set state = 'declined' where id = p_request_id;

  insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata)
  values (
    p_organization_id, p_request_id, 'request_declined', auth.uid(),
    case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end
  );

  v_result.request_id := v_request.id;
  v_result.organization_id := v_request.organization_id;
  v_result.previous_state := v_request.state;
  v_result.current_state := 'declined';
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.decline_transportation_request(uuid, uuid, text) is
  'Organization Admin / Dispatcher only. Only pending -> declined is legal (ZW004 from accepted or cancelled). Idempotent no-op if already declined. Optional free-text reason (<=500 chars) is persisted in request_events.metadata, never discarded and never a structured category.';

revoke all on function public.decline_transportation_request(uuid, uuid, text) from public;
grant execute on function public.decline_transportation_request(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.cancel_transportation_request(
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
  v_has_trips boolean;
  v_result public.request_transition_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Same shared-lock serialization boundary as link_request_passenger:
  -- create_trip locks this exact row FOR UPDATE before ever inserting a
  -- Trip against it, so by the time this transaction holds the lock, no
  -- concurrent create_trip call can be mid-flight against this Request —
  -- either it already committed (and this transaction will see the
  -- resulting accepted state / linked Trip below), or it is blocked
  -- behind this transaction's own lock and will correctly see
  -- state = 'cancelled' once this transaction commits.
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

  -- Only pending -> cancelled is legal. accepted -> cancelled and
  -- declined -> cancelled are both rejected.
  if v_request.state != 'pending' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- LOCKED SAFE RULE: ANY linked Trip row blocks cancellation, regardless
  -- of that Trip's own current state (scheduled/completed/cancelled/
  -- no_show/anything else) — once a Trip has ever been created from this
  -- Request, demand has already crossed into Trip lifecycle and must be
  -- managed there, never cascaded from here. Evaluated inside the same
  -- transaction as the state check above, under the same Request-row
  -- lock, so this can never race against a concurrent create_trip.
  select exists (
    select 1 from public.trips where request_id = p_request_id and organization_id = p_organization_id
  ) into v_has_trips;

  if v_has_trips then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  update public.transportation_requests set state = 'cancelled' where id = p_request_id;

  insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata)
  values (p_organization_id, p_request_id, 'request_cancelled', auth.uid(), '{}'::jsonb);

  v_result.request_id := v_request.id;
  v_result.organization_id := v_request.organization_id;
  v_result.previous_state := v_request.state;
  v_result.current_state := 'cancelled';
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.cancel_transportation_request(uuid, uuid) is
  'Organization Admin / Dispatcher only. Only pending -> cancelled is legal, AND only while zero linked Trip rows exist (any linked Trip, regardless of its own state, blocks cancellation — locked decision, no automatic cascade into Trip cancellation). Idempotent no-op if already cancelled.';

revoke all on function public.cancel_transportation_request(uuid, uuid) from public;
grant execute on function public.cancel_transportation_request(uuid, uuid) to authenticated;

-- =============================================================================
-- G. Direct client-write privilege remediation
-- =============================================================================
-- Retires the raw INSERT path now that log_transportation_request is the
-- sole controlled creation path — same reasoning and same migration-time
-- discipline as ZD-101's retirement of the raw `trips` INSERT grant once
-- create_trip existed (20260831120100_retire_direct_trip_insert.sql):
-- the prior INSERT grant had NO column restriction at all, meaning a raw
-- client INSERT could set `state` to any of the 4 allowed values at
-- creation time even after this migration's own UPDATE-side remediation
-- below — the identical GAP-1 vulnerability class, reachable via INSERT
-- instead of UPDATE. Closed in the same migration that introduces the
-- controlled replacement, not left open.
drop policy if exists transportation_requests_insert_org_operations on public.transportation_requests;
revoke insert on public.transportation_requests from authenticated;

-- Narrows the UPDATE column grant: removes `state` (closes the S2A
-- lifecycle-integrity gap — mirrors trips.state's own established
-- exclusion from its equivalent grant) and `passenger_id` (now governed
-- exclusively by link_request_passenger, per the locked decision).
-- `source` joins the remaining safe descriptive-field set (correcting a
-- miscategorized intake channel later is not a lifecycle-integrity
-- concern, unlike state or passenger_id). Every other previously-granted
-- descriptive column is preserved unchanged.
revoke update on public.transportation_requests from authenticated;
grant update (
  requester_name, requester_relationship, requester_phone, requester_email,
  pickup_description, destination_description, preferred_date, preferred_time,
  return_trip_needed, assistance_notes, additional_notes, source
) on public.transportation_requests to authenticated;

comment on table public.transportation_requests is
  'PUBLIC-INTAKE -> TENANT-OWNED (domain-model.md §B). Lifecycle: pending -> accepted (system-driven, via create_trip on first Trip creation) | declined | cancelled, all via the controlled RPCs added in P1-E1-S2B (log_transportation_request, link_request_passenger, decline_transportation_request, cancel_transportation_request). As of P1-E1-S2B, `state` and `passenger_id` are no longer directly client-writable, and raw client INSERT is retired — every lifecycle-sensitive write goes through a SECURITY DEFINER RPC, mirroring create_trip''s own retirement of the raw `trips` INSERT grant (ZD-101). No anonymous access of any kind exists in this phase — public intake remains deferred to a future trusted server-side path.';
