-- NP-P2-S4.1-S2 -- service type from Nemryn Plus into Core Requests (conversion + rebooking).
--
-- Depends on 20261017100000_core_staff_request_service_type.sql (log_transportation_request(..., p_service_type)).
--
-- 1. plus_convert_opportunity_to_request: SAME signature, CREATE OR REPLACE. The only body change: the opportunity's own
--    service_type is passed to Core (NULL stays NULL; nothing inferred; the opportunity's eight Plus values are a subset
--    of Core's nine, so a valid opportunity service is never refused or replaced).
-- 2. plus_create_rebooking_request: ONE trailing optional parameter, p_service_type text DEFAULT NULL, passed to Core,
--    which validates it. CREATE OR REPLACE cannot change a signature, and keeping the 12-argument function beside a
--    13-argument one with a default would make every existing 12-argument call ambiguous -- so the exact 12-argument
--    identity is DROPPED (no CASCADE; no database object depends on it -- its only caller is the app's server action)
--    and the 13-argument function CREATED: one function, no overload. Existing calls without p_service_type keep
--    working. The replay path returns BEFORE the Core call, so a retry with the same key never creates a second
--    Request and never changes the original service.
-- Bodies are otherwise the 20261015140000 bodies VERBATIM: Plus WRITE + Core role checks, tenancy, the advisory lock,
-- replay, eligibility, the pending-only Core Request, attribution, activities, audit and conversion immutability are
-- unchanged. SECURITY DEFINER, search_path and EXECUTE (authenticated only) are re-asserted.
-- No table, column, CHECK, policy, grant on a table, data backfill or new service value. The Supabase CLI applies the
-- file in one transaction. Release this migration BEFORE the application that sends p_service_type.

create or replace function public.plus_convert_opportunity_to_request(
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
  p_additional_notes text
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
    v_contact.email, null, p_preferred_date, p_preferred_time, p_assistance_notes, p_additional_notes,
    v_opp.service_type);  -- NP-P2-S4.1-S2: the opportunity's own service type (NULL stays NULL; never inferred)

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
comment on function public.plus_convert_opportunity_to_request(uuid, uuid, timestamptz, text, text, text, text, text, date, time, text, text) is
  'NP-P2-S4. Plus WRITE + the Core role that logs Requests. Converts an OPEN private-pay opportunity of p_organization_id into ONE pending Core Request (via log_transportation_request as the caller; requester name / phone / email from the ACTIVE primary contact, source mapped from the opportunity, passenger NULL), records a converted_from_opportunity attribution with the idempotency key, moves the opportunity to converted (converted_at, closed_at), writes request_linked + stage_changed history and a plus_opportunity_converted audit row (ids only) -- all in one transaction. Same key + same opportunity -> the original Request, changed=false, nothing written. Errors: ZW002 unknown / foreign; ZW003 stale; ZW004 already_converted / illegal_transition (lost) / linked_request_exists; ZW006 invalid key, a key of another operation, inactive contact, contact without phone, or invalid Core fields. NP-P2-S4.1-S2: the Core Request carries the opportunity''s own service_type (NULL stays NULL; never inferred or overridden). Never creates a Trip, Passenger link or recurring arrangement.';
revoke all on function public.plus_convert_opportunity_to_request(uuid, uuid, timestamptz, text, text, text, text, text, date, time, text, text) from public, anon, service_role;
grant execute on function public.plus_convert_opportunity_to_request(uuid, uuid, timestamptz, text, text, text, text, text, date, time, text, text) to authenticated;

drop function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text);

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
  p_service_type text default null
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
    v_contact.email, null, p_preferred_date, p_preferred_time, p_assistance_notes, p_additional_notes,
    p_service_type);  -- NP-P2-S4.1-S2: staff choice; validated by Core (canonical nine; blank = NULL; never trimmed)

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
comment on function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text, text) is
  'NP-P2-S4. Plus WRITE + the Core role that logs Requests. Creates ONE new pending Core Request for an existing ACTIVE contact of p_organization_id (via log_transportation_request as the caller; requester details from the contact; staff-entered transport details and source; passenger NULL) and records a rebooking attribution (contact only, no opportunity) with the idempotency key, a request_linked activity and a plus_contact_rebooked audit row (ids only) -- one transaction. No opportunity is created or changed; earlier Requests are untouched; nothing is copied from an earlier Request. Same key + same contact -> the original Request, changed=false (a retry never creates a second Request or changes the original service). NP-P2-S4.1-S2: optional trailing p_service_type (staff choice) is passed to log_transportation_request, which validates it (one of the nine canonical services; omitted / blank = NULL; ZW006 otherwise; organization Services do not restrict it, OD-S1 = A). Errors as plus_convert_opportunity_to_request (ZW002 / ZW006).';
revoke all on function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text, text) from public, anon, service_role;
grant execute on function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text, text) to authenticated;

notify pgrst, 'reload schema';
