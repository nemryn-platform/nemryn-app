-- NC-INTAKE-AIRPORT-S1 -- Core public-intake service contract: + airport_transportation (ninth structured service).
--
-- WHY: Zenward Mobility offers Airport Transportation (pre-arranged travel to or from airports). Its website sends
-- structured requests through the existing TRUSTED website intake (submit_public_transportation_request ->
-- _create_public_request). The closed service allow-list rejected the value, so the website gates the service.
--
-- WHAT (forward-only, additive; no earlier migration modified; no new table, column, function or grant):
--   1. transportation_requests_service_type_check: + 'airport_transportation' (still NULL-able; all existing rows
--      already satisfy the narrower list, so validation cannot fail).
--   2. organization_service_offerings_service_type_check: + 'airport_transportation', so an operator that has
--      configured its Services can enable it (intake only accepts a service the organization offers, once it has
--      configured any).
--   3. _create_public_request: allow-list + 'airport_transportation'. The body is otherwise IDENTICAL to the deployed
--      definition (20260921150000; verified equal to production): same signature, SECURITY DEFINER, search_path,
--      idempotency, recurring-schedule validation, offerings check, pending state, acquisition snapshot. CREATE OR
--      REPLACE keeps its ACL (no client EXECUTE) and comment.
--   4. set_organization_service_offerings: allow-list + 'airport_transportation'; otherwise IDENTICAL to
--      20260920110000 (verified equal to production); ACL kept.
--
-- NOT changed, deliberately: Nemryn-hosted website request forms (website_request_forms / publications checks,
-- save_website_request_form, _public_form_service_types) still offer the eight existing services -- offering Airport
-- there is a separate product decision; and Nemryn Plus opportunity service types (plus_opportunities) are untouched.
--
-- The value is stored and shown as itself: it is never remapped to 'other' and is NOT a medical service. Nothing here
-- creates a Trip, Passenger, assignment, quote, payment, Plus record or outbound message; the Request is 'pending' and
-- awaits normal Operations review. No enum is involved (text CHECKs only), so no special transaction handling is needed.
--
-- ORDERING: 20261015135000 sorts after the production head 20261015130000 and before the unreleased Plus P2-S4
-- migration 20261015140000; the two are independent (no shared object).

-- =============================================================================
-- 1. Core Request service type
-- =============================================================================
alter table public.transportation_requests drop constraint transportation_requests_service_type_check;
alter table public.transportation_requests
  add constraint transportation_requests_service_type_check check (
    service_type is null or service_type = any (array[
  'medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge', 'recurring_care', 'senior_medical',
  'wheelchair_transportation', 'other', 'airport_transportation'
    ]::text[])
  );

-- =============================================================================
-- 2. Organization service offerings
-- =============================================================================
alter table public.organization_service_offerings drop constraint organization_service_offerings_service_type_check;
alter table public.organization_service_offerings
  add constraint organization_service_offerings_service_type_check check (
    service_type = any (array[
  'medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge', 'recurring_care', 'senior_medical',
  'wheelchair_transportation', 'other', 'airport_transportation'
    ]::text[])
  );

-- =============================================================================
-- 3. Trusted website intake core (allow-list only)
-- =============================================================================
create or replace function public._create_public_request(p_integration_id uuid, p_idempotency_key text, p_requester_name text, p_requester_relationship text, p_requester_phone text,
  p_pickup_description text, p_destination_description text, p_return_trip_needed text,
  p_requester_email text default null, p_preferred_date date default null, p_preferred_time time without time zone default null,
  p_assistance_notes text default null, p_additional_notes text default null, p_service_type text default null,
  p_recurring_days_of_week text[] default null, p_recurring_start_date date default null, p_recurring_end_date date default null,
  p_recurring_appointment_time time without time zone default null, p_recurring_return_trip_expected boolean default null,
  p_requested_passenger_name text default null, p_acquisition jsonb default null)
returns public.public_request_submission_result
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_integration public.request_intake_integrations%rowtype;
  v_idempotency_key text;
  v_requester_name text;
  v_requester_phone text;
  v_requester_email text;
  v_pickup_description text;
  v_destination_description text;
  v_assistance_notes text;
  v_additional_notes text;
  v_service_type text;
  v_recurring_days_of_week smallint[];
  v_requested_passenger_name text;
  v_request_id uuid;
  v_result public.public_request_submission_result;
  v_acquisition jsonb;
begin
  select * into v_integration from public.request_intake_integrations where id = p_integration_id for share;
  if not found or v_integration.retired_at is not null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_idempotency_key := nullif(btrim(p_idempotency_key), '');
  if v_idempotency_key is null or length(v_idempotency_key) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

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

  v_assistance_notes := nullif(btrim(p_assistance_notes), '');
  if v_assistance_notes is not null and length(v_assistance_notes) > 4000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_additional_notes := nullif(btrim(p_additional_notes), '');
  if v_additional_notes is not null and length(v_additional_notes) > 4000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_requested_passenger_name := nullif(btrim(p_requested_passenger_name), '');
  if v_requested_passenger_name is not null and length(v_requested_passenger_name) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_service_type := nullif(btrim(p_service_type), '');
  if v_service_type is not null and v_service_type not in (
    'medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
    'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other',
    'airport_transportation'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if v_service_type is not null
     and exists (select 1 from public.organization_service_offerings o where o.organization_id = v_integration.organization_id)
     and not exists (
       select 1 from public.organization_service_offerings o
       where o.organization_id = v_integration.organization_id and o.service_type = v_service_type
     ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_recurring_days_of_week is not null then
    if p_recurring_start_date is null then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    if cardinality(p_recurring_days_of_week) < 1 or cardinality(p_recurring_days_of_week) > 7 then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    if exists (
      select 1 from unnest(p_recurring_days_of_week) as d
      where d is null or d not in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
    ) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    if (select count(distinct d) from unnest(p_recurring_days_of_week) as d) <> cardinality(p_recurring_days_of_week) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;

    select array_agg(distinct case d
      when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3 when 'thursday' then 4
      when 'friday' then 5 when 'saturday' then 6 when 'sunday' then 7
    end order by case d
      when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3 when 'thursday' then 4
      when 'friday' then 5 when 'saturday' then 6 when 'sunday' then 7
    end)
    into v_recurring_days_of_week
    from unnest(p_recurring_days_of_week) as d;

    if not public._is_canonical_days_of_week(v_recurring_days_of_week) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  elsif p_recurring_start_date is not null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_recurring_end_date is not null and p_recurring_start_date is not null and p_recurring_end_date < p_recurring_start_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  insert into public.transportation_requests (
    organization_id, requester_name, requester_relationship, requester_phone, requester_email,
    pickup_description, destination_description, preferred_date, preferred_time,
    return_trip_needed, assistance_notes, additional_notes, source, state,
    intake_integration_id, external_submission_ref,
    service_type, recurring_days_of_week, recurring_start_date, recurring_end_date,
    recurring_appointment_time, recurring_return_trip_expected,
    requested_passenger_name
  ) values (
    v_integration.organization_id, v_requester_name, p_requester_relationship, v_requester_phone, v_requester_email,
    v_pickup_description, v_destination_description, p_preferred_date, p_preferred_time,
    p_return_trip_needed, v_assistance_notes, v_additional_notes, 'web', 'pending',
    v_integration.id, v_idempotency_key,
    v_service_type, v_recurring_days_of_week, p_recurring_start_date, p_recurring_end_date,
    p_recurring_appointment_time, p_recurring_return_trip_expected,
    v_requested_passenger_name
  )
  on conflict (intake_integration_id, external_submission_ref)
    where intake_integration_id is not null and external_submission_ref is not null
  do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select id into v_request_id
    from public.transportation_requests
    where intake_integration_id = v_integration.id and external_submission_ref = v_idempotency_key;
  else
    insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata)
    values (
      v_integration.organization_id, v_request_id, 'request_logged', null,
      jsonb_build_object('source', 'web', 'intake_integration_id', v_integration.id)
    );

    begin
      v_acquisition := public._sanitize_acquisition(p_acquisition);
      if v_acquisition is not null then
        insert into public.request_acquisition_attributions (
          organization_id, request_id,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          landing_path, submission_path, referrer_host, form_version
        ) values (
          v_integration.organization_id, v_request_id,
          v_acquisition ->> 'utmSource', v_acquisition ->> 'utmMedium', v_acquisition ->> 'utmCampaign',
          v_acquisition ->> 'utmContent', v_acquisition ->> 'utmTerm',
          v_acquisition ->> 'landingPath', v_acquisition ->> 'submissionPath',
          v_acquisition ->> 'referrerHost', v_acquisition ->> 'formVersion'
        )
        on conflict (request_id) do nothing;
      end if;
    exception when others then
      raise warning 'website intake: acquisition attribution not stored';
    end;

    v_result.notification_event_id := public._enqueue_notification_event(
      v_integration.organization_id, 'website_request', 'transportation_request', v_request_id
    );
  end if;

  v_result.accepted := true;
  return v_result;
end;
$function$;


-- =============================================================================
-- 4. Services & Intake settings (allow-list only)
-- =============================================================================
create or replace function public.set_organization_service_offerings(p_organization_id uuid, p_service_types text[])
returns public.organization_service_offerings_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new text[];
  v_before text[];
  v_result public.organization_service_offerings_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_service_types is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select coalesce(array_agg(distinct s order by s), array[]::text[]) into v_new
  from unnest(p_service_types) s where s is not null;

  -- At least one service must be enabled; every value must be canonical.
  if coalesce(array_length(v_new, 1), 0) = 0
     or exists (select 1 from unnest(v_new) s where s not in (
          'medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
          'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other',
          'airport_transportation')) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Serialize concurrent saves for the organization.
  perform 1 from public.organizations where id = p_organization_id for update;

  select coalesce(array_agg(service_type order by service_type), array[]::text[]) into v_before
  from public.organization_service_offerings where organization_id = p_organization_id;

  v_result.organization_id := p_organization_id;
  v_result.first_configuration := coalesce(array_length(v_before, 1), 0) = 0;

  if v_before = v_new then
    v_result.changed := false;
    return v_result;
  end if;

  delete from public.organization_service_offerings
  where organization_id = p_organization_id and service_type <> all (v_new);

  insert into public.organization_service_offerings (organization_id, service_type)
  select p_organization_id, s from unnest(v_new) s
  on conflict do nothing;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'organization', p_organization_id,
          case when v_result.first_configuration then 'organization_services_configured' else 'organization_service_offerings_updated' end,
          auth.uid(),
          jsonb_build_object('service_types', to_jsonb(v_before)),
          jsonb_build_object('service_types', to_jsonb(v_new)));

  v_result.changed := true;
  return v_result;
end;
$$;

