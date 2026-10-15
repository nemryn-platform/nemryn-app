-- NP-P2-S4 -- Opportunity-to-booking conversion & rebooking.
--
-- Canonical design: docs/product/plus-product-spec.md 4.4 and roadmap (P2-S4: "RPCs only; one pending Request; T13,
-- T17"); docs/product/plus-domain-model.md section 10; docs/security/plus-access-model.md section 4 (Plus -> Core write:
-- "only to create a pending Request" through Core's log_transportation_request, which re-checks the Core role;
-- passenger_id always NULL).
--
-- WHAT (forward-only; NO new table; earlier migrations untouched):
--   plus_convert_opportunity_to_request -- one pending Core Request from an eligible private-pay opportunity, its
--     converted_from_opportunity attribution, the opportunity -> converted, history and audit -- ONE transaction.
--   plus_create_rebooking_request      -- one pending Core Request for an existing contact, a rebooking attribution
--     (no opportunity) -- ONE transaction.
--   Database-enforced shape of conversion / rebooking attributions, at most one conversion per opportunity, and a
--   deferred guard so NO path can set an opportunity to 'converted' without its conversion attribution.
--   plus_update_request_attribution (P2-S3) replaced forward-only: conversion links are immutable history; rebooking
--   links never gain an opportunity.
--
-- BOUNDARY: Core stays the authority. The Request is created ONLY through public.log_transportation_request, called as
-- the signed-in staff member (its own has_org_role check applies; it hard-codes state 'pending' and writes the Core
-- request_logged event with that actor). passenger_id is always NULL. No Trip, Passenger, passenger link, assignment or
-- recurring arrangement is created, and no transportation text is copied into Plus tables or audit rows.
--
-- REPLAY SAFETY: Core request creation is intentionally not idempotent. Every call carries a client idempotency key
-- (8-200 characters, plus_request_attributions_idempotency_check), serialized per (organization, key) by a transaction
-- advisory lock and stored on the attribution (unique per organization). A replay of the SAME operation returns the
-- original Request with changed=false and writes nothing; the key is never proof of authority (every check re-runs
-- first).
--
-- LOCK ORDER (no cycle with any existing writer): advisory(org, key) -> opportunity FOR UPDATE -> contact FOR SHARE ->
-- Core insert (log_transportation_request) -> attribution / activities / audit. Every existing Plus writer takes the
-- opportunity before the contact; none takes this advisory lock.

-- =============================================================================
-- 1. attribution shape for the two new link methods (every existing row is linked_existing_request and validates)
-- =============================================================================
alter table public.plus_request_attributions
  add constraint plus_request_attributions_method_shape_check check (
    (link_method <> 'converted_from_opportunity'
       or (opportunity_id is not null and contact_id is not null and conversion_idempotency_key is not null))
    and (link_method <> 'rebooking'
       or (opportunity_id is null and contact_id is not null and conversion_idempotency_key is not null))
  );
-- an opportunity is converted at most once
create unique index plus_request_attributions_one_conversion_idx
  on public.plus_request_attributions (opportunity_id) where link_method = 'converted_from_opportunity';

-- =============================================================================
-- 2. 'converted' only with its conversion attribution (database-enforced; checked at commit)
-- =============================================================================
create function public._plus_opportunity_conversion_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.stage = 'converted' and not exists (
    select 1 from public.plus_request_attributions a
    where a.organization_id = new.organization_id and a.opportunity_id = new.id and a.link_method = 'converted_from_opportunity'
  ) then
    raise exception 'conversion_requires_request' using errcode = 'ZW004';
  end if;
  return null;
end;
$$;
comment on function public._plus_opportunity_conversion_guard() is
  'NP-P2-S4. INTERNAL trigger function (deferred constraint trigger on plus_opportunities). An opportunity may be (or become) converted only if a converted_from_opportunity attribution exists for it at commit -- i.e. only through plus_convert_opportunity_to_request, which creates the Core Request in the same transaction.';
revoke all on function public._plus_opportunity_conversion_guard() from public, anon, authenticated, service_role;

create constraint trigger plus_opportunities_conversion_guard
  after insert or update of stage on public.plus_opportunities
  deferrable initially deferred
  for each row when (new.stage = 'converted')
  execute function public._plus_opportunity_conversion_guard();

-- =============================================================================
-- 3. helpers (internal)
-- =============================================================================
-- Opportunity source -> Core transportation_requests.source (closed sets on both sides).
create function public._plus_core_request_source(p_opportunity_source text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_opportunity_source
    when 'phone' then 'phone'
    when 'email' then 'email'
    when 'facility' then 'facility'
    when 'website' then 'web'
    when 'web_inquiry' then 'web'
    else 'other'                       -- referral, walk_in, event, advertising, other
  end;
$$;
comment on function public._plus_core_request_source(text) is
  'NP-P2-S4. INTERNAL. Maps a plus_opportunities.source to a transportation_requests.source: phone/email/facility unchanged; website and web_inquiry -> web; referral, walk_in, event, advertising, other -> other.';
revoke all on function public._plus_core_request_source(text) from public, anon, authenticated, service_role;

-- Validates and normalizes a client idempotency key (not proof of anything; only replay identity).
create function public._plus_require_idempotency_key(p_key text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := btrim(p_key);
begin
  if v is null or v !~ '^[A-Za-z0-9._:-]{8,200}$' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  return v;
end;
$$;
comment on function public._plus_require_idempotency_key(text) is
  'NP-P2-S4. INTERNAL. A conversion / rebooking idempotency key: 8-200 characters of [A-Za-z0-9._:-] (matches plus_request_attributions_idempotency_check); ZW006 otherwise.';
revoke all on function public._plus_require_idempotency_key(text) from public, anon, authenticated, service_role;

create type public.plus_booking_request_result as (
  request_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  request_state text,
  changed boolean
);
comment on type public.plus_booking_request_result is
  'NP-P2-S4. Result of plus_convert_opportunity_to_request / plus_create_rebooking_request. changed=false: a replay of the same operation (same key) -- the ORIGINAL Request is returned and nothing was written. request_state is the Request''s current Core state.';

-- =============================================================================
-- 4. conversion
-- =============================================================================
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
    v_contact.email, null, p_preferred_date, p_preferred_time, p_assistance_notes, p_additional_notes);

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
  'NP-P2-S4. Plus WRITE + the Core role that logs Requests. Converts an OPEN private-pay opportunity of p_organization_id into ONE pending Core Request (via log_transportation_request as the caller; requester name / phone / email from the ACTIVE primary contact, source mapped from the opportunity, passenger NULL), records a converted_from_opportunity attribution with the idempotency key, moves the opportunity to converted (converted_at, closed_at), writes request_linked + stage_changed history and a plus_opportunity_converted audit row (ids only) -- all in one transaction. Same key + same opportunity -> the original Request, changed=false, nothing written. Errors: ZW002 unknown / foreign; ZW003 stale; ZW004 already_converted / illegal_transition (lost) / linked_request_exists; ZW006 invalid key, a key of another operation, inactive contact, contact without phone, or invalid Core fields. Never creates a Trip, Passenger link or recurring arrangement.';
revoke all on function public.plus_convert_opportunity_to_request(uuid, uuid, timestamptz, text, text, text, text, text, date, time, text, text) from public, anon;
grant execute on function public.plus_convert_opportunity_to_request(uuid, uuid, timestamptz, text, text, text, text, text, date, time, text, text) to authenticated;

-- =============================================================================
-- 5. rebooking
-- =============================================================================
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
    v_contact.email, null, p_preferred_date, p_preferred_time, p_assistance_notes, p_additional_notes);

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
comment on function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text) is
  'NP-P2-S4. Plus WRITE + the Core role that logs Requests. Creates ONE new pending Core Request for an existing ACTIVE contact of p_organization_id (via log_transportation_request as the caller; requester details from the contact; staff-entered transport details and source; passenger NULL) and records a rebooking attribution (contact only, no opportunity) with the idempotency key, a request_linked activity and a plus_contact_rebooked audit row (ids only) -- one transaction. No opportunity is created or changed; earlier Requests are untouched; nothing is copied from an earlier Request. Same key + same contact -> the original Request, changed=false. Errors as plus_convert_opportunity_to_request (ZW002 / ZW006).';
revoke all on function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text) from public, anon;
grant execute on function public.plus_create_rebooking_request(uuid, uuid, text, text, text, text, text, text, date, time, text, text) to authenticated;

-- =============================================================================
-- 6. plus_update_request_attribution (P2-S3): conversion links are history; rebooking links stay contact-only
-- =============================================================================
-- Forward-only CREATE OR REPLACE (identical signature, grants kept). Body identical to 20261015130000 except the two
-- NP-P2-S4 checks after the version check.
create or replace function public.plus_update_request_attribution(
  p_organization_id uuid,
  p_request_id uuid,
  p_expected_updated_at timestamptz,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_reason text
)
returns public.plus_request_attribution_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_old public.plus_request_attributions%rowtype;
  v_new public.plus_request_attributions%rowtype;
  v_dims record;
  v_gone_contact uuid;
  v_gone_opportunity uuid;
  v_result public.plus_request_attribution_result;
begin
  perform public._require_plus_write(p_organization_id);
  perform public._plus_require_core_request_read(p_organization_id);
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  select * into v_old from public.plus_request_attributions a
  where a.request_id = p_request_id and a.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  -- NP-P2-S4: a conversion link records that the Request was CREATED from that opportunity -- it is history and is never
  -- corrected; a rebooking link belongs to a contact only (it may be moved to another contact, never to an opportunity).
  if v_old.link_method = 'converted_from_opportunity' then
    raise exception 'conversion_link_immutable' using errcode = 'ZW004';
  end if;
  if v_old.link_method = 'rebooking' and p_opportunity_id is not null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  select * into v_dims from public._plus_resolve_attribution(p_organization_id, p_contact_id, p_opportunity_id, v_old.contact_id);

  v_result.request_id := v_old.request_id;
  if v_old.contact_id is not distinct from v_dims.contact_id and v_old.opportunity_id is not distinct from v_dims.opportunity_id then
    v_result.contact_id := v_old.contact_id; v_result.opportunity_id := v_old.opportunity_id;
    v_result.updated_at := v_old.updated_at; v_result.changed := false;   -- nothing changes: no history entry
    return v_result;
  end if;

  -- link_method, linked_by and linked_at are history and never change
  update public.plus_request_attributions a set contact_id = v_dims.contact_id, opportunity_id = v_dims.opportunity_id
  where a.request_id = v_old.request_id
  returning * into v_new;

  -- history on the NEW subjects (the reason is the staff-entered body) ...
  insert into public.plus_activities (organization_id, contact_id, opportunity_id, request_id, activity_type, body, actor_user_id, occurred_at)
  values (p_organization_id, v_new.contact_id, v_new.opportunity_id, v_new.request_id, 'attribution_changed', v_reason, auth.uid(), now());
  -- ... and on any subject the Request was moved AWAY from, so its timeline stays truthful
  v_gone_contact := case when v_old.contact_id is distinct from v_new.contact_id then v_old.contact_id end;
  v_gone_opportunity := case when v_old.opportunity_id is distinct from v_new.opportunity_id then v_old.opportunity_id end;
  if num_nonnulls(v_gone_contact, v_gone_opportunity) > 0 then
    insert into public.plus_activities (organization_id, contact_id, opportunity_id, request_id, activity_type, body, actor_user_id, occurred_at)
    values (p_organization_id, v_gone_contact, v_gone_opportunity, v_new.request_id, 'attribution_changed', v_reason, auth.uid(), now());
  end if;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_request_attribution', v_new.request_id, 'plus_request_attribution_changed', auth.uid(),
          jsonb_build_object('contact_id', v_old.contact_id, 'opportunity_id', v_old.opportunity_id),
          jsonb_build_object('contact_id', v_new.contact_id, 'opportunity_id', v_new.opportunity_id));

  v_result.contact_id := v_new.contact_id; v_result.opportunity_id := v_new.opportunity_id;
  v_result.updated_at := v_new.updated_at; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_update_request_attribution(uuid, uuid, timestamptz, uuid, uuid, text) is
  'NP-P2-S3; NP-P2-S4. Plus WRITE + Core request read. Corrects an existing attribution''s contact / opportunity with a required reason (3-500). Row lock + p_expected_updated_at (ZW003 when stale); unknown / foreign / unattributed -> ZW002. Same consistency rules as plus_link_request (an unchanged archived contact may stay). Identical dimensions -> changed=false, no history. Never deletes the row; link_method / linked_by / linked_at never change. Writes attribution_changed history on the new subjects and on any subject the Request moved away from (body = reason) and an audit row (old / new ids only). Never touches the Core Request. NP-P2-S4: a converted_from_opportunity link is immutable history (ZW004 conversion_link_immutable); a rebooking link never gains an opportunity (ZW006).';

revoke all on function public.plus_update_request_attribution(uuid, uuid, timestamptz, uuid, uuid, text) from public, anon;
grant execute on function public.plus_update_request_attribution(uuid, uuid, timestamptz, uuid, uuid, text) to authenticated;
