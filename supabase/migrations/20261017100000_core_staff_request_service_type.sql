-- NC-REQUEST-SERVICE-TYPE-S1 -- staff-created Requests may record an OPTIONAL structured service type.
--
-- public.log_transportation_request gains ONE trailing parameter, p_service_type text DEFAULT NULL. Everything else
-- (the first 14 parameters: names, types, order and defaults; RETURNS request_creation_result; plpgsql; VOLATILE;
-- SECURITY DEFINER; search_path; authorization; validation; the pending-only INSERT; the request_logged event) is
-- reproduced VERBATIM from 20260916100000_request_mutation_foundation.sql (section D), the function's only
-- definition. The only body changes are the service-type validation block and storing it in service_type.
--
-- WHY DROP + CREATE (not CREATE OR REPLACE, not a second overload):
--   * CREATE OR REPLACE cannot change a function's input signature.
--   * Keeping the 14-argument function beside a 15-argument one whose last parameter has a default would make every
--     existing 14-argument call (PostgREST named calls from the deployed app; the two positional calls inside
--     plus_convert_opportunity_to_request / plus_create_rebooking_request) match BOTH: "function is not unique".
--   * A trailing parameter WITH a default keeps every existing call valid, so ONE function is enough.
-- DEPENDENCIES (verified in production, NC-REQUEST-SERVICE-TYPE-S0 section 3): no pg_depend dependents (no view, rule,
-- default, trigger or constraint). Its only database callers are the two P2-S4 Plus RPCs, which resolve the name when
-- they execute. The DROP therefore names the exact 14-argument identity and uses NO CASCADE: if anything unexpected
-- depended on it, the migration fails here and nothing changes.
--
-- ATOMICITY: the Supabase CLI applies each migration file inside ONE transaction, so other sessions see either the
-- old function or the new one -- never neither -- and any failure rolls the whole file back.
-- DATA: no table, column, CHECK, RLS policy, trigger or existing row changes. transportation_requests.service_type and
-- its nine-value CHECK already exist (20261015135000); historic Requests keep NULL (no backfill, no inference: OD-S2).
-- ALSO (owner-approved, read-only, narrowly scoped): get_organization_service_offerings admits Dispatchers as well as
-- Organization Admins of the same organization, so the staff Log Request form can list the enabled Services (see the
-- section at the end). set_organization_service_offerings and the table's access are unchanged (Admin-only writes).
-- ORDER: release this migration BEFORE the application that sends p_service_type. The currently deployed application
-- never sends it and keeps working (the parameter defaults to NULL).

drop function public.log_transportation_request(
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text
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
  p_service_type text default null
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
    return_trip_needed, assistance_notes, additional_notes, source, state, service_type
  ) values (
    p_organization_id, p_passenger_id, v_requester_name, p_requester_relationship, v_requester_phone,
    v_requester_email, v_pickup_description, v_destination_description, p_preferred_date, p_preferred_time,
    p_return_trip_needed, v_assistance_notes, v_additional_notes, p_source, 'pending', v_service_type
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
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text, text
) is
  'Organization Admin / Dispatcher only. The sole controlled path to create a TransportationRequest — state is always ''pending'', never caller-supplied. Optional passenger_id is validated exactly like create_trip''s own passenger check. Optional p_service_type (NC-REQUEST-SERVICE-TYPE-S1): omitted / NULL / blank = not specified (NULL); otherwise exactly one of the nine canonical service identifiers (never trimmed, case-folded or mapped from a label), else ZW006; the organization''s configured Services do not restrict staff-recorded Requests (OD-S1 = A). Non-idempotent by design (no natural idempotency key for recording new demand), matching create_trip''s own documented reasoning.';

revoke all on function public.log_transportation_request(
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text, text
) from public, anon, service_role;
grant execute on function public.log_transportation_request(
  uuid, text, text, text, text, text, text, text, text, uuid, date, time, text, text, text
) to authenticated;

-- =============================================================================
-- Services READ for Dispatchers (owner-approved with NC-REQUEST-SERVICE-TYPE-S1)
-- =============================================================================
-- The staff Log Request form lists the organization's enabled Services (OD-S1 = A), and Dispatchers log Requests every
-- day, so the existing read RPC now admits an ACTIVE Organization Admin OR Dispatcher of p_organization_id. Nothing
-- else changes: same signature, SECURITY DEFINER, search_path and EXECUTE grant (authenticated only); it still returns
-- ONLY the enabled canonical service identifiers (text[]) -- no other configuration or administrative data. Drivers,
-- inactive members, users without a membership in that organization (including a Platform Admin without one) and other
-- tenants still get ZW002; anonymous still ZW001 / no EXECUTE. CHANGING Services
-- (set_organization_service_offerings) stays Organization Admin only, and the organization_service_offerings table
-- keeps RLS on with no policy and no client grant. The body below is the 20260920110000 body with only the role array
-- widened.
create or replace function public.get_organization_service_offerings(p_organization_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_out text[];
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select coalesce(array_agg(service_type order by service_type), array[]::text[]) into v_out
  from public.organization_service_offerings where organization_id = p_organization_id;
  return v_out;
end;
$$;


comment on function public.get_organization_service_offerings(uuid) is
  'Organization Admin or Dispatcher of p_organization_id (active membership). The enabled canonical service types only; an empty array means never configured. Read-only. Changing them stays Organization Admin only (set_organization_service_offerings). Dispatcher read added with NC-REQUEST-SERVICE-TYPE-S1 for the staff Log Request form.';

revoke all on function public.get_organization_service_offerings(uuid) from public, anon, service_role;
grant execute on function public.get_organization_service_offerings(uuid) to authenticated;

-- PostgREST also reloads through its DDL event triggers; this makes the reload explicit.
notify pgrst, 'reload schema';
