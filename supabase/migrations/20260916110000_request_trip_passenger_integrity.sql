-- Request→Trip Passenger integrity hardening (P1-E1-S2F-A).
--
-- Request Hub (P1-E1-S2D/S2E/S2E-R1) established a product invariant:
-- a pending Request is ready for conversion only once it has a linked
-- ACTIVE Passenger, resolved explicitly and authoritatively via
-- link_request_passenger — never inferred, never auto-matched. Before
-- building the S2F Convert-to-Trip UI, this migration confirms and
-- closes a real gap in `create_trip` (20260831120000_controlled_trip_
-- creation.sql) that would otherwise let that invariant be silently
-- violated at the one layer that actually matters: the database.
--
-- CONFIRMED GAP (read directly from the function body, and reproduced
-- live against a fresh `supabase db reset` before writing this
-- migration — see docs/reports/p1-e1-s2f-a-request-trip-passenger-
-- integrity.txt §3/§4 for the full source trace and live transcript):
-- when `p_request_id is not null`, the ONLY checks performed against
-- the locked Request row are `not found` and
-- `state not in ('pending', 'accepted')` — there is no comparison of
-- any kind between `v_request.passenger_id` and the caller-supplied
-- `p_passenger_id`, and no check that `v_request.passenger_id is not
-- null`. Both of the following succeeded, live, before this migration:
--   1. `create_trip(p_passenger_id => Passenger B, p_request_id =>
--      <Request linked to Passenger A>)`, both Passengers same-org and
--      active — created a Trip carrying Passenger B while the Request
--      it was "converted from" still carries Passenger A. Request
--      Passenger and linked Trip Passenger could silently drift apart.
--   2. `create_trip(p_passenger_id => any valid active Passenger,
--      p_request_id => <Request with passenger_id IS NULL>)` — a
--      Request that never went through `link_request_passenger` at
--      all (Request Hub would still show it as "Passenger needed")
--      could be converted directly, bypassing the entire Passenger-
--      resolution/readiness model Request Hub is built around.
--
-- LOCKED INVARIANT (this migration adds exactly this, nothing more):
-- when `p_request_id is not null`, the Request's OWN linked Passenger
-- becomes authoritative — `v_request.passenger_id` must be non-null
-- AND must equal `p_passenger_id`. The pre-existing, unchanged
-- Passenger validation above (same organization, `status = 'active'`)
-- already guarantees the resolved Passenger is legitimate; this
-- migration only adds the missing cross-reference between the Request
-- and the Trip being created from it. `is distinct from` covers both
-- failure shapes (NULL and mismatch) in one comparison — the same
-- idiom `link_request_passenger`'s own idempotency check already uses
-- elsewhere in this codebase (20260916100000_request_mutation_
-- foundation.sql) — categorized ZW006 `invalid_input`, matching every
-- other Request/Passenger validation failure immediately adjacent to
-- it; no new error code was introduced, per explicit instruction.
--
-- EXPLICITLY UNCHANGED, confirmed by inspection of the diff below:
-- `p_request_id is null` (direct Trip creation) is byte-identical to
-- before — this hardening applies ONLY inside the existing
-- `if p_request_id is not null then ... end if;` block, after the
-- existing state check, evaluated against the SAME row already locked
-- `for update` for that check (no new lock, no new race — the
-- existing Request-row lock already serializes this exactly the same
-- way it already serializes the state check immediately above it).
-- Accepted Requests may still legitimately produce additional Trips
-- (return-transportation, multi-Trip) — this invariant does not change
-- that; it only requires every such additional Trip to still carry the
-- SAME Passenger the Request itself resolved to, never a different one.
-- Passenger validation, Facility validation, address validation,
-- scheduling validation, the Trip INSERT itself, the pending→accepted
-- transition, TripEvent, AuditEvent, the return type, SECURITY
-- DEFINER, search_path, and the EXECUTE grant are all completely
-- unchanged — this is a single additional guard clause, nothing else.
--
-- Signature is UNCHANGED (same 11 parameters, same order, same types,
-- same return type) — CREATE OR REPLACE FUNCTION alone is sufficient;
-- no DROP FUNCTION is needed (unlike 20260901120000_reassignment_
-- concurrency_hardening.sql, which added a new parameter and therefore
-- required one to avoid a second competing overload — not applicable
-- here, since no parameter is added, removed, or reordered).

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
  -- ---------------------------------------------------------------------
  -- Authorization: live-checked, org-scoped, Organization Admin/Dispatcher
  -- only. organization_id is a REQUESTED context, never trusted authority
  -- on its own (work item §7) — has_org_role re-validates it against the
  -- caller's actual, current Membership every call. Failure is uniformly
  -- ZW002 not_found, matching every other ops-role mutation function
  -- (ZD-085 convention) — a Driver, an inactive Membership, and a foreign-
  -- org caller are indistinguishable from each other or from a bad
  -- organization_id, by design.
  -- ---------------------------------------------------------------------
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- ---------------------------------------------------------------------
  -- Address snapshot validation (work item §12/§13). Only rules already
  -- canonical (NOT NULL on both columns) or technically obvious (no blank
  -- text, a sane length ceiling, logically impossible time ordering) are
  -- enforced — no invented business rule (minimum notice, service hours,
  -- etc.), per explicit instruction.
  -- ---------------------------------------------------------------------
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

  -- ---------------------------------------------------------------------
  -- Passenger validation: required, same organization, active. Same
  -- ZW006 categorization as assign_trip's Driver/Vehicle validation
  -- (P1-E2-S2) for consistency across the mutation API — nonexistent and
  -- foreign-org both produce the identical error, no existence oracle
  -- (work item §10).
  -- ---------------------------------------------------------------------
  if p_passenger_id is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not exists (
    select 1 from public.passengers
    where id = p_passenger_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- ---------------------------------------------------------------------
  -- Facility validation (work item §11): optional (the canonical model
  -- allows address snapshots with no Facility reference at all), but
  -- where supplied, must be tenant-consistent and active.
  -- ---------------------------------------------------------------------
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

  -- ---------------------------------------------------------------------
  -- TransportationRequest relationship (work item §9): optional — a Trip
  -- may be created with no Request (Operations-originated) or from an
  -- existing Request. Never assumed 1:1 — a Request already `accepted`
  -- (a prior Trip, e.g. an outbound leg) may legitimately produce another
  -- (e.g. a return leg); only `declined`/`cancelled` requests are
  -- rejected as no longer usable. Locked FOR UPDATE for the duration of
  -- this transaction, consistent with the established lock-before-write
  -- discipline (ZD-086), since this function may write to it.
  --
  -- P1-E1-S2F-A: once the same-tenant Request is established under that
  -- same lock, its OWN linked Passenger becomes authoritative — the
  -- Request must actually have a linked Passenger, and it must be the
  -- exact same Passenger this call is creating a Trip for. `is distinct
  -- from` covers both "Request was never resolved" (passenger_id IS
  -- NULL) and "caller supplied a different Passenger than the Request
  -- resolved to" in one comparison. Evaluated against v_request, which
  -- was just loaded under the row lock immediately above — never
  -- against stale client-supplied data, so a concurrent
  -- link_request_passenger call on the same Request cannot race this
  -- check (whichever transaction commits its lock first is the one the
  -- other re-reads).
  -- ---------------------------------------------------------------------
  if p_request_id is not null then
    select * into v_request
    from public.transportation_requests
    where id = p_request_id and organization_id = p_organization_id
    for update;

    if not found then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;

    if v_request.state not in ('pending', 'accepted') then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;

    if v_request.passenger_id is distinct from p_passenger_id then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- The Trip itself. state is hard-coded 'scheduled' — never a parameter,
  -- never caller-influenced in any way (work item §8). Terminal
  -- timestamps are never set here (all default NULL). organization_id is
  -- the same live-validated value used for every check above, not
  -- re-derived from anything caller-suppliable after the fact.
  -- ---------------------------------------------------------------------
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

  -- Request lifecycle: pending -> accepted, system-driven, exactly as the
  -- table's own original comment anticipated ("triggered by first Trip
  -- creation") but which nothing before this migration actually
  -- implemented. Only advances from 'pending'; already-'accepted' is left
  -- untouched (a return-leg Trip from an already-accepted Request is not
  -- a state change).
  if p_request_id is not null and v_request.state = 'pending' then
    update public.transportation_requests set state = 'accepted' where id = p_request_id;
  end if;

  -- ---------------------------------------------------------------------
  -- TripEvent (work item §15): exactly one event, reusing the existing
  -- allow-listed vocabulary — no new event_type was needed.
  -- 'request_converted_to_trip' when a Request produced this Trip,
  -- 'trip_scheduled' for a Trip created with no Request. Not a lifecycle
  -- *transition* event (no prior state existed to transition from), so
  -- it is deliberately distinct from the 6 driver_* progression events.
  -- ---------------------------------------------------------------------
  v_event_type := case when p_request_id is not null then 'request_converted_to_trip' else 'trip_scheduled' end;

  insert into public.trip_events (organization_id, trip_id, event_type, actor_user_id, metadata)
  values (p_organization_id, v_new_trip_id, v_event_type, auth.uid(), jsonb_build_object('request_id', p_request_id));

  -- ---------------------------------------------------------------------
  -- AuditEvent (work item §16): Trip creation is a material
  -- administrative mutation, same reasoning as ZD-087's "materially
  -- changes responsibility or reaches a terminal disposition" test
  -- extended to "brings a new tenant-operational record into existence."
  -- Metadata deliberately minimal: no Passenger PII (name/phone), no
  -- free-text pickup/destination — only identifiers and the fixed initial
  -- state, matching every other AuditEvent in this codebase.
  -- ---------------------------------------------------------------------
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
  'Organization Admin / Dispatcher only. The sole controlled path to create a Trip — state is always ''scheduled'', never caller-supplied. Does not assign a Driver/Vehicle (work item §14 — use assign_trip separately, a deliberate command-boundary decision). Non-idempotent by design (work item §18) — no duplicate-submission detection is attempted here; a legitimate identical-looking Trip is not evidence of an accidental resubmit. P1-E1-S2F-A: when p_request_id is supplied, the Request''s own linked passenger_id must be non-null and must equal p_passenger_id (ZW006 otherwise) — a Request must be resolved via link_request_passenger before it can be converted; a Trip can never be created for a Passenger different from the one the Request itself resolved to. See docs/data/mutation-api.md for the full contract.';

revoke all on function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid) from public;
grant execute on function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid) to authenticated;
