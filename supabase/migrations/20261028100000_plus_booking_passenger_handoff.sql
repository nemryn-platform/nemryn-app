-- =============================================================================
-- NP-PILOT-P1 -- Growth -> Core handoff: passenger at conversion / rebooking (owner decisions D1 + D2 + D3).
--
-- Both Plus booking RPCs get TWO trailing optional parameters:
--   p_passenger_id uuid DEFAULT NULL             an existing ACTIVE passenger of the organization, linked ATOMICALLY:
--                                                passed to Core's own log_transportation_request (which already accepts and
--                                                validates it) after a read-only pre-check here -- a refused passenger
--                                                raises BEFORE the Request exists, so no Request / attribution / conversion
--                                                is left behind (D2).
--   p_requested_passenger_name text DEFAULT NULL  the rider's name for a NEW passenger, passed to Core and stored in the
--                                                existing transportation_requests.requested_passenger_name snapshot (1-200
--                                                chars, no control characters), which Core's Add New Passenger already
--                                                prefills from (D1; D3 = staff confirm "the requester is the rider").
-- Core stays the only writer of Core tables: section 1 gives Core's own log_transportation_request ONE trailing optional
-- p_requested_passenger_name (validated like the website intake's snapshot, stored in the existing column); the Plus
-- RPCs pass it through. No Plus function writes a Core table directly.
-- Exactly one of them, or neither (today's behaviour). The replay path returns BEFORE either is read: a retry with the same
-- key returns the original Request unchanged. Core keeps passenger creation, approval, scheduling and dispatch (D4).
--
-- Compatibility: CREATE OR REPLACE cannot change a signature, and keeping the old identity beside a longer one with
-- defaults would make existing calls ambiguous -- so each exact identity is DROPPED (no CASCADE; no database object
-- depends on them: verified pg_depend / prosrc) and the longer function CREATED: one function each, no overload. Calls
-- that omit the new parameters (the deployed app) keep working unchanged. Bodies are otherwise the 20261017110000
-- bodies VERBATIM (authority checks, advisory lock, replay, eligibility, pending-only Core Request, attribution,
-- activities, audit (unchanged, ids only) and service type). SECURITY DEFINER, search_path and
-- EXECUTE (authenticated only) re-asserted. No table, column, CHECK, policy or table grant changes; no backfill.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Core: log_transportation_request(..., p_service_type, p_requested_passenger_name DEFAULT NULL)
--    Body VERBATIM from 20261017100000 except the snapshot validation + column. Same DROP + CREATE reasoning as there:
--    no pg_depend dependents; its only database callers are the two Plus booking RPCs (re-created below with 16-argument
--    positional calls); the deployed app's named calls omit the new parameter and keep working.
-- -----------------------------------------------------------------------------
drop function public.log_transportation_request(
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text, text
);

create function public.log_transportation_request(
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
  p_additional_notes text default null,
  p_service_type text default null,
  p_requested_passenger_name text default null
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
  v_service_type text;
  v_requested_passenger_name text;
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
  -- Service requested (optional; NC-REQUEST-SERVICE-TYPE-S1). Omitted, NULL,
  -- empty or whitespace-only -> NULL (nothing inferred). Any other value must
  -- be EXACTLY one of the nine canonical identifiers -- never trimmed, never
  -- case-folded, never mapped from a label -- the same closed set as
  -- transportation_requests_service_type_check (the final guard) and
  -- _create_public_request. Owner decision OD-S1 = A: the organization's
  -- configured Services do NOT restrict staff-recorded Requests (they govern
  -- what the public may request); the staff UI lists them.
  -- -----------------------------------------------------------------------
  if p_service_type is null or p_service_type !~ '\S' then
    v_service_type := null;
  elsif p_service_type in (
    'medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
    'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other',
    'airport_transportation'
  ) then
    v_service_type := p_service_type;
  else
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- Requested passenger name (optional; NP-PILOT-P1): the same free-text
  -- SNAPSHOT the website intake records (1-200 characters after trimming;
  -- blank = NULL), now also accepted from staff. Never a Passenger record;
  -- Add New Passenger prefills from it and staff confirm.
  -- -----------------------------------------------------------------------
  v_requested_passenger_name := nullif(btrim(p_requested_passenger_name), '');
  if v_requested_passenger_name is not null
     and (length(v_requested_passenger_name) > 200 or v_requested_passenger_name ~ '[[:cntrl:]]') then
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
    return_trip_needed, assistance_notes, additional_notes, source, state, service_type, requested_passenger_name
  ) values (
    p_organization_id, p_passenger_id, v_requester_name, p_requester_relationship, v_requester_phone,
    v_requester_email, v_pickup_description, v_destination_description, p_preferred_date, p_preferred_time,
    p_return_trip_needed, v_assistance_notes, v_additional_notes, p_source, 'pending', v_service_type, v_requested_passenger_name
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
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text, text, text
) is
  'Organization Admin / Dispatcher only. The sole controlled path to create a TransportationRequest — state is always ''pending'', never caller-supplied. Optional passenger_id is validated exactly like create_trip''s own passenger check. Optional p_service_type (NC-REQUEST-SERVICE-TYPE-S1): omitted / NULL / blank = not specified (NULL); otherwise exactly one of the nine canonical service identifiers (never trimmed, case-folded or mapped from a label), else ZW006; the organization''s configured Services do not restrict staff-recorded Requests (OD-S1 = A). Optional p_requested_passenger_name (NP-PILOT-P1): the requested-passenger snapshot (1-200 chars after trimming, no control characters; blank = NULL), never a Passenger record. Non-idempotent by design (no natural idempotency key for recording new demand), matching create_trip''s own documented reasoning.';

revoke all on function public.log_transportation_request(
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text, text, text
) from public, anon, service_role;
grant execute on function public.log_transportation_request(
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text, text, text
) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. Plus booking RPCs: optional passenger (atomic) or rider-name snapshot, passed to Core
-- -----------------------------------------------------------------------------
drop function public.plus_convert_opportunity_to_request(uuid, uuid, timestamptz, text, text, text, text, text, date, time, text, text);

create function public.plus_convert_opportunity_to_request(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_requester_relationship text,
  p_pickup_description text,
  p_destination_description text,
  p_return_trip_needed text,
  p_preferred_date date,
  p_preferred_time time,
  p_assistance_notes text,
  p_additional_notes text,
  p_passenger_id uuid default null,
  p_requested_passenger_name text default null
)
returns public.plus_booking_request_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_prior public.plus_request_attributions%rowtype;
  v_opp public.plus_opportunities%rowtype;
  v_contact public.plus_contacts%rowtype;
  v_core public.request_creation_result;
  v_result public.plus_booking_request_result;
  v_rider_name text := nullif(btrim(coalesce(p_requested_passenger_name, '')), '');
begin
  -- authority FIRST, on every call (including a replay): Plus write + the Core role that may log Requests
  perform public._require_plus_write(p_organization_id);
  perform public._plus_require_core_request_read(p_organization_id);
  v_key := public._plus_require_idempotency_key(p_idempotency_key);

  -- one operation per (organization, key) at a time: a double click / retry waits here, then sees the first result
  perform pg_advisory_xact_lock(hashtext('plus-booking:' || p_organization_id::text || ':' || v_key)::bigint);

  select * into v_prior from public.plus_request_attributions a
  where a.organization_id = p_organization_id and a.conversion_idempotency_key = v_key;
  if found then
    if v_prior.link_method = 'converted_from_opportunity' and v_prior.opportunity_id = p_opportunity_id then
      v_result.request_id := v_prior.request_id; v_result.contact_id := v_prior.contact_id;
      v_result.opportunity_id := v_prior.opportunity_id; v_result.changed := false;
      select r.state into v_result.request_state from public.transportation_requests r
      where r.id = v_prior.request_id and r.organization_id = p_organization_id;
      return v_result;                                                 -- replay: the original Request, nothing written
    end if;
    raise exception 'invalid_input' using errcode = 'ZW006';           -- a key of another operation never returns its Request
  end if;

  select * into v_opp from public.plus_opportunities o
  where o.id = p_opportunity_id and o.organization_id = p_organization_id and o.channel = 'private_pay'
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_opp.stage = 'converted' then
    raise exception 'already_converted' using errcode = 'ZW004';
  end if;
  if v_opp.stage = 'lost' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if v_opp.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  -- an opportunity already linked to an existing Request (P2-S3) is not converted again into a second Request
  if exists (select 1 from public.plus_request_attributions a
             where a.organization_id = p_organization_id and a.opportunity_id = v_opp.id) then
    raise exception 'linked_request_exists' using errcode = 'ZW004';
  end if;

  -- NP-PILOT-P1: an existing passenger OR a rider name for a new one -- never both. The passenger must be ACTIVE in this
  -- organization (read here for a precise error code; Core's own log_transportation_request re-validates it inside this
  -- same transaction, and Plus never locks or writes Core rows). Any refusal raises, so the whole function rolls back:
  -- no Request, attribution, stage change or history is left behind.
  if p_passenger_id is not null and v_rider_name is not null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_rider_name is not null and (length(v_rider_name) > 200 or v_rider_name ~ '[[:cntrl:]]') then
    raise exception 'invalid_passenger_name' using errcode = 'ZW006';
  end if;
  if p_passenger_id is not null then
    if not exists (select 1 from public.passengers p
                   where p.id = p_passenger_id and p.organization_id = p_organization_id and p.status = 'active') then
      raise exception 'passenger_unavailable' using errcode = 'ZW006';
    end if;
  end if;

  select * into v_contact from public.plus_contacts c
  where c.id = v_opp.primary_contact_id and c.organization_id = p_organization_id
  for share;
  if not found or v_contact.status = 'redacted' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_contact.status <> 'active' then
    raise exception 'contact_not_active' using errcode = 'ZW006';
  end if;
  if v_contact.phone is null then
    raise exception 'contact_phone_required' using errcode = 'ZW006';   -- Core requires a requester phone
  end if;

  -- the Core Request, through Core's own RPC, as the signed-in staff member (Core re-checks the role and validates)
  v_core := public.log_transportation_request(
    p_organization_id, v_contact.display_name, p_requester_relationship, v_contact.phone,
    p_pickup_description, p_destination_description, p_return_trip_needed, public._plus_core_request_source(v_opp.source),
    v_contact.email, p_passenger_id, p_preferred_date, p_preferred_time, p_assistance_notes, p_additional_notes,
    v_opp.service_type,  -- NP-P2-S4.1-S2: the opportunity's own service type (NULL stays NULL; never inferred)
    v_rider_name);       -- NP-PILOT-P1: the staff-entered rider name snapshot (Core validates and stores it)

  insert into public.plus_request_attributions (request_id, organization_id, contact_id, opportunity_id, link_method,
                                                conversion_idempotency_key, linked_by)
  values (v_core.request_id, p_organization_id, v_contact.id, v_opp.id, 'converted_from_opportunity', v_key, auth.uid());

  update public.plus_opportunities o set stage = 'converted', converted_at = now(), closed_at = now()
  where o.id = v_opp.id;

  insert into public.plus_activities (organization_id, contact_id, opportunity_id, request_id, activity_type, body, actor_user_id, occurred_at)
  values (p_organization_id, v_contact.id, v_opp.id, v_core.request_id, 'request_linked', null, auth.uid(), now());
  insert into public.plus_activities (organization_id, opportunity_id, activity_type, from_stage, to_stage, actor_user_id, occurred_at)
  values (p_organization_id, v_opp.id, 'stage_changed', v_opp.stage, 'converted', auth.uid(), now());
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_opportunity', v_opp.id, 'plus_opportunity_converted', auth.uid(),
          jsonb_build_object('stage', v_opp.stage),
          jsonb_build_object('stage', 'converted', 'request_id', v_core.request_id, 'contact_id', v_contact.id,
                             'link_method', 'converted_from_opportunity'));

  v_result.request_id := v_core.request_id; v_result.contact_id := v_contact.id; v_result.opportunity_id := v_opp.id;
  v_result.request_state := v_core.state; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_convert_opportunity_to_request(uuid, uuid, timestamptz, text, text, text, text, text, date, time, text, text, uuid, text) is
  'NP-P2-S4 / NP-PILOT-P1. Plus WRITE + the Core role that logs Requests. Converts an OPEN private-pay opportunity of p_organization_id into ONE pending Core Request (via log_transportation_request as the caller; requester from the ACTIVE primary contact; source mapped; the opportunity''s service type), records a converted_from_opportunity attribution with the idempotency key, moves the opportunity to converted, writes history and an audit row (ids / booleans only) -- one transaction. NP-PILOT-P1: optional p_passenger_id (an ACTIVE passenger of the organization, linked atomically through Core; ZW006 passenger_unavailable otherwise, nothing created) OR optional p_requested_passenger_name (rider name snapshot for a new passenger, 1-200 chars; ZW006 invalid_passenger_name) -- never both (ZW006). Same key + same opportunity -> the original Request, changed=false, nothing written or relinked. Errors: ZW002 unknown / foreign; ZW003 stale; ZW004 already_converted / illegal_transition / linked_request_exists; ZW006 invalid input. Never creates a Trip, Passenger record or recurring arrangement.';
revoke all on function public.plus_convert_opportunity_to_request(uuid, uuid, timestamptz, text, text, text, text, text, date, time, text, text, uuid, text) from public, anon, service_role;
grant execute on function public.plus_convert_opportunity_to_request(uuid, uuid, timestamptz, text, text, text, text, text, date, time, text, text, uuid, text) to authenticated;

drop function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text, text);

create function public.plus_create_rebooking_request(
  p_organization_id uuid,
  p_contact_id uuid,
  p_idempotency_key text,
  p_requester_relationship text,
  p_pickup_description text,
  p_destination_description text,
  p_return_trip_needed text,
  p_source text,
  p_preferred_date date,
  p_preferred_time time,
  p_assistance_notes text,
  p_additional_notes text,
  p_service_type text default null,
  p_passenger_id uuid default null,
  p_requested_passenger_name text default null
)
returns public.plus_booking_request_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_prior public.plus_request_attributions%rowtype;
  v_contact public.plus_contacts%rowtype;
  v_core public.request_creation_result;
  v_result public.plus_booking_request_result;
  v_rider_name text := nullif(btrim(coalesce(p_requested_passenger_name, '')), '');
begin
  perform public._require_plus_write(p_organization_id);
  perform public._plus_require_core_request_read(p_organization_id);
  v_key := public._plus_require_idempotency_key(p_idempotency_key);

  perform pg_advisory_xact_lock(hashtext('plus-booking:' || p_organization_id::text || ':' || v_key)::bigint);

  select * into v_prior from public.plus_request_attributions a
  where a.organization_id = p_organization_id and a.conversion_idempotency_key = v_key;
  if found then
    if v_prior.link_method = 'rebooking' and v_prior.contact_id = p_contact_id then
      v_result.request_id := v_prior.request_id; v_result.contact_id := v_prior.contact_id;
      v_result.opportunity_id := null; v_result.changed := false;
      select r.state into v_result.request_state from public.transportation_requests r
      where r.id = v_prior.request_id and r.organization_id = p_organization_id;
      return v_result;
    end if;
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- NP-PILOT-P1: an existing passenger OR a rider name for a new one -- never both. The passenger must be ACTIVE in this
  -- organization (read here for a precise error code; Core's own log_transportation_request re-validates it inside this
  -- same transaction, and Plus never locks or writes Core rows). Any refusal raises, so the whole function rolls back:
  -- no Request, attribution, stage change or history is left behind.
  if p_passenger_id is not null and v_rider_name is not null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_rider_name is not null and (length(v_rider_name) > 200 or v_rider_name ~ '[[:cntrl:]]') then
    raise exception 'invalid_passenger_name' using errcode = 'ZW006';
  end if;
  if p_passenger_id is not null then
    if not exists (select 1 from public.passengers p
                   where p.id = p_passenger_id and p.organization_id = p_organization_id and p.status = 'active') then
      raise exception 'passenger_unavailable' using errcode = 'ZW006';
    end if;
  end if;

  select * into v_contact from public.plus_contacts c
  where c.id = p_contact_id and c.organization_id = p_organization_id
  for share;
  if not found or v_contact.status = 'redacted' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_contact.status <> 'active' then
    raise exception 'contact_not_active' using errcode = 'ZW006';
  end if;
  if v_contact.phone is null then
    raise exception 'contact_phone_required' using errcode = 'ZW006';
  end if;

  v_core := public.log_transportation_request(
    p_organization_id, v_contact.display_name, p_requester_relationship, v_contact.phone,
    p_pickup_description, p_destination_description, p_return_trip_needed, p_source,
    v_contact.email, p_passenger_id, p_preferred_date, p_preferred_time, p_assistance_notes, p_additional_notes,
    p_service_type,  -- NP-P2-S4.1-S2: staff choice; validated by Core (canonical nine; blank = NULL; never trimmed)
    v_rider_name);   -- NP-PILOT-P1: the staff-entered rider name snapshot (Core validates and stores it)

  insert into public.plus_request_attributions (request_id, organization_id, contact_id, opportunity_id, link_method,
                                                conversion_idempotency_key, linked_by)
  values (v_core.request_id, p_organization_id, v_contact.id, null, 'rebooking', v_key, auth.uid());
  insert into public.plus_activities (organization_id, contact_id, request_id, activity_type, body, actor_user_id, occurred_at)
  values (p_organization_id, v_contact.id, v_core.request_id, 'request_linked', null, auth.uid(), now());
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_contact', v_contact.id, 'plus_contact_rebooked', auth.uid(), null,
          jsonb_build_object('request_id', v_core.request_id, 'link_method', 'rebooking'));

  v_result.request_id := v_core.request_id; v_result.contact_id := v_contact.id; v_result.opportunity_id := null;
  v_result.request_state := v_core.state; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text, text, uuid, text) is
  'NP-P2-S4 / NP-PILOT-P1. Plus WRITE + the Core role that logs Requests. Creates ONE new pending Core Request for an existing ACTIVE contact (requester from the contact; staff transport details, source and optional service type validated by Core) with a rebooking attribution, activity and audit row (ids / booleans only) -- one transaction. NP-PILOT-P1: optional p_passenger_id (ACTIVE passenger of the organization, linked atomically through Core; ZW006 passenger_unavailable otherwise, nothing created) OR optional p_requested_passenger_name (rider name snapshot for a new passenger) -- never both. Same key + same contact -> the original Request, changed=false, nothing written or relinked.';
revoke all on function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text, text, uuid, text) from public, anon, service_role;
grant execute on function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
