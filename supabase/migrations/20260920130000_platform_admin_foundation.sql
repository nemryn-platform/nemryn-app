-- P1-PILOT-S4B-R4E -- Platform Admin foundation (Nemryn control plane).
--
-- PLATFORM ADMIN != ORGANIZATION ADMIN. A PlatformAdminGrant never satisfies
-- has_org_role / is_org_member / current_driver_id (those are Membership-only,
-- unchanged in that respect). Platform Admin gets controlled, aggregate-only
-- SECURITY DEFINER read models and exactly ONE tenant-affecting mutation:
-- organization lifecycle status.
--
-- A. LIFECYCLE ENFORCEMENT (audit result: before this migration
--    organizations.status ('active'|'inactive') was stored but enforced NOWHERE:
--    no helper, policy, RPC or intake path read it). The smallest coherent
--    shared enforcement is applied at the three authorization helpers every
--    tenant RLS policy and every SECURITY DEFINER tenant RPC already routes
--    through (is_org_member, has_org_role, current_driver_id, hence also
--    is_driver_assigned_to_trip), plus the two paths that do not use them:
--    public website intake and invitation acceptance. Memberships, Drivers,
--    Requests, Trips, integrations are never touched -- no cascade; status and
--    Membership status stay separate concepts. Reactivation restores access
--    with zero re-provisioning.
-- B. PLATFORM READ MODELS: aggregate counts only. No tenant table is granted to
--    Platform Admin; nothing returns request/trip/passenger content or
--    recipient addresses or provider text.
-- C. set_platform_organization_status: audited, idempotent, reason-required.
-- D. Platform activity = existing audit_events with a deliberate action
--    whitelist (platform_organization_suspended / _reactivated); the broad
--    Platform Admin SELECT policies on audit_events AND organizations are
--    DROPPED (Platform Admin organization information now comes only through
--    the controlled platform_* read functions; ordinary members keep reading
--    their OWN organization row via organizations_select_members).
-- E. Tenant Settings > Activity gains a deliberate, safe presentation of the two
--    platform actions ("by Nemryn"; the internal reason is never returned).

-- ============================================================================
-- A1. authorization helpers: the organization must be active
-- ============================================================================
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and o.status = 'active'
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any (p_roles)
      and o.status = 'active'
  );
$$;

create or replace function public.current_driver_id(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id
  from public.drivers d
  where d.organization_id = p_org_id
    and d.user_id = auth.uid()
    and d.status = 'active'
    and exists (
      select 1
      from public.memberships m
      join public.organizations o on o.id = m.organization_id
      where m.organization_id = p_org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and o.status = 'active'
    )
  limit 1;
$$;

comment on function public.is_org_member(uuid) is
  'True iff the calling user has an ACTIVE membership in the given organization AND that organization is active (R4E: a suspended organization is not operable). Live lookup every call. A PlatformAdminGrant never satisfies this.';
comment on function public.has_org_role(uuid, text[]) is
  'True iff the calling user has an ACTIVE membership in the given organization with one of the given roles AND that organization is active (R4E). Membership-only: a PlatformAdminGrant never satisfies this.';
comment on function public.current_driver_id(uuid) is
  'Resolves auth.uid() to the caller''s Driver.id within a SPECIFIC organization. Null unless the caller has an active Driver row AND an active Membership there AND the organization is active (R4E: a suspended organization revokes Driver access without touching the Driver or Membership rows).';

-- A2. a member may still READ their own organization row (name/status) while it
-- is suspended -- the application needs it to say "this workspace is suspended"
-- instead of behaving as if the person had no access. This grants no operation:
-- every other policy and RPC goes through the helpers above.
drop policy if exists organizations_select_members on public.organizations;
create policy organizations_select_members
  on public.organizations for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.organization_id = organizations.id
      and m.user_id = auth.uid()
      and m.status = 'active'
  ));

-- ============================================================================
-- A3. public intake + invitation acceptance (paths not using the helpers)
-- ============================================================================
create or replace function public.submit_public_transportation_request(
  p_integration_external_id text,
  p_idempotency_key text,
  p_requester_name text,
  p_requester_relationship text,
  p_requester_phone text,
  p_pickup_description text,
  p_destination_description text,
  p_return_trip_needed text,
  p_requester_email text default null,
  p_preferred_date date default null,
  p_preferred_time time default null,
  p_assistance_notes text default null,
  p_additional_notes text default null,
  p_origin text default null,
  p_service_type text default null,
  p_recurring_days_of_week text[] default null,
  p_recurring_start_date date default null,
  p_recurring_end_date date default null,
  p_recurring_appointment_time time default null,
  p_recurring_return_trip_expected boolean default null,
  p_requested_passenger_name text default null
)
returns public.public_request_submission_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
begin
  -- -----------------------------------------------------------------------
  -- Deliberately NO `auth.uid() is null` check — unlike every other
  -- mutation RPC in this schema, this one MUST work for a genuinely
  -- anonymous caller (auth.uid() is always NULL for `anon`). Authorization
  -- here is entirely "does p_integration_external_id name an active
  -- integration" — checked below — never an identity check.
  -- -----------------------------------------------------------------------

  -- -----------------------------------------------------------------------
  -- Tenant resolution: the ONLY input that selects an organization.
  -- No p_organization_id parameter exists anywhere in this function's
  -- signature — structurally impossible for a caller to "redirect" a
  -- submission into a different tenant by tampering with any field,
  -- since no field ever names a tenant directly. A nonexistent
  -- external_id and a disabled integration raise the IDENTICAL error
  -- (invalid_input, ZW006) — no existence oracle, exactly mirroring
  -- has_org_role's own "not_found is not_found, regardless of why"
  -- contract used everywhere else in this schema.
  -- -----------------------------------------------------------------------
  if p_integration_external_id is null or btrim(p_integration_external_id) = '' or length(btrim(p_integration_external_id)) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_integration
  from public.request_intake_integrations
  where external_id = btrim(p_integration_external_id)
    and integration_type = 'website';

  if not found or v_integration.is_active is not true then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- R4E: a tenant that Nemryn has suspended (organizations.status <> 'active')
  -- accepts no new public Requests. Same generic invalid_input as any other
  -- rejection -- the public caller can not tell "suspended" from "unknown" or
  -- "disabled". FOR SHARE makes this strict against a concurrent suspension
  -- (the platform status change takes the row lock FOR UPDATE), so no Request
  -- is created after a suspension has committed.
  perform 1 from public.organizations o
  where o.id = v_integration.organization_id and o.status = 'active'
  for share;
  if not found then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Secondary control only (see the column's own comment) — checked
  -- only when the integration has actually configured an allow-list.
  -- Never the authorization boundary; the block above already fully
  -- resolved and validated the tenant before this runs.
  if v_integration.allowed_origins is not null and array_length(v_integration.allowed_origins, 1) > 0 then
    if p_origin is null or not (p_origin = any (v_integration.allowed_origins)) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  -- -----------------------------------------------------------------------
  -- Idempotency key: required, bounded. This is the sole idempotency
  -- input — see section B's own comment for the full mechanism (a
  -- partial unique index on (intake_integration_id,
  -- external_submission_ref), enforced by ON CONFLICT below, never a
  -- client-side disabled-button state).
  -- -----------------------------------------------------------------------
  v_idempotency_key := nullif(btrim(p_idempotency_key), '');
  if v_idempotency_key is null or length(v_idempotency_key) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- Field validation — IDENTICAL bounds to log_transportation_request's
  -- own validation (20260916100000_request_mutation_foundation.sql),
  -- deliberately kept in exact sync rather than diverging: a public
  -- Request and a staff-entered Request must satisfy the same minimum
  -- save contract. No passenger_id parameter exists at all (public
  -- intake must never auto-link/auto-create/auto-merge a Passenger —
  -- locked product decision); no medical intake fields.
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

  v_assistance_notes := nullif(btrim(p_assistance_notes), '');
  if v_assistance_notes is not null and length(v_assistance_notes) > 4000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_additional_notes := nullif(btrim(p_additional_notes), '');
  if v_additional_notes is not null and length(v_additional_notes) > 4000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- requestedPassengerName (P1-PILOT-S4B-R2A) — optional free-text
  -- snapshot, same bound as requester_name (200 chars). Deliberately NOT
  -- validated against, matched to, or used to create/find any row in
  -- public.passengers — this value is stored on the Request row ONLY.
  -- -----------------------------------------------------------------------
  v_requested_passenger_name := nullif(btrim(p_requested_passenger_name), '');
  if v_requested_passenger_name is not null and length(v_requested_passenger_name) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- serviceType (P1-PILOT-S4B-R2) — optional (backward compatible with a
  -- future, non-Zenward integration that never sends it), but when
  -- present must be exactly one of the closed allow-list values. Never
  -- coerced to 'other' — an unrecognized value is rejected outright,
  -- matching every other enum field in this function.
  -- -----------------------------------------------------------------------
  v_service_type := nullif(btrim(p_service_type), '');
  if v_service_type is not null and v_service_type not in (
    'medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
    'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- Tenant service offerings (P1-PILOT-S4B-R4C) -- the ONLY behavioral
  -- change to this function. Backwards compatible by construction: an
  -- organization with NO rows in organization_service_offerings has never
  -- explicitly configured what it provides, so intake behaves exactly as
  -- before. Once an admin has saved a configuration (the setter guarantees
  -- at least one enabled service, so "has rows" == "configured"), it is
  -- authoritative: a submitted serviceType the tenant has not enabled is
  -- rejected with the SAME generic invalid_input as every other rejection
  -- (no existence oracle, no new public error). A submission that sends no
  -- serviceType (the field is optional) is unaffected. The organization is
  -- still resolved solely from the integration row above -- nothing the
  -- caller sends can select which offerings are consulted.
  -- -----------------------------------------------------------------------
  if v_service_type is not null
     and exists (select 1 from public.organization_service_offerings o where o.organization_id = v_integration.organization_id)
     and not exists (
       select 1 from public.organization_service_offerings o
       where o.organization_id = v_integration.organization_id and o.service_type = v_service_type
     ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- recurringSchedule (P1-PILOT-S4B-R2) — optional. Absent entirely
  -- (p_recurring_days_of_week IS NULL) means a one-time request, exactly
  -- as before this migration. When present: 1-7 distinct lowercase
  -- weekday-name strings from the fixed set below (the WIRE contract
  -- uses day NAMES, matching Zenward-Web's own `Weekday` type
  -- byte-for-byte; converted here to the canonical ISO weekday-number
  -- smallint[] this table's own recurring_days_of_week column and
  -- recurring_arrangements' own days_of_week already use). This
  -- describes what the requester WANTS ONLY — no Trip, no
  -- recurring_arrangements row, is ever created here.
  -- -----------------------------------------------------------------------
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
    -- start_date without days_of_week is malformed (mirrors the table's
    -- own atomic CHECK) — reject rather than silently drop.
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_recurring_end_date is not null and p_recurring_start_date is not null and p_recurring_end_date < p_recurring_start_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- The Request itself. organization_id is v_integration.organization_id
  -- — resolved internally two steps above, never a parameter. state is
  -- hard-coded 'pending' and source is hard-coded 'web' — neither is
  -- ever a parameter. passenger_id is never set (omitted entirely —
  -- defaults to its own column default of NULL) — requested_passenger_
  -- name is a PLAIN COLUMN on this same row, never a value that touches
  -- passenger_id, and never used to look up, match, or create any row in
  -- public.passengers.
  --
  -- Idempotency: ON CONFLICT targets the exact partial unique index from
  -- the S4A foundation migration. Two concurrent identical submissions
  -- (same integration, same idempotency key) are safe purely from this
  -- single atomic statement. requested_passenger_name is just one more
  -- column on the SAME row — it does not change this mechanism at all,
  -- and a replay with a DIFFERENT requested_passenger_name never updates
  -- the already-committed row (ON CONFLICT DO NOTHING, not DO UPDATE).
  -- -----------------------------------------------------------------------
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
    -- Idempotent replay: another (possibly concurrent) call with the
    -- SAME integration + idempotency key already created the row. Never
    -- treated as an error — the caller's own submission was received
    -- exactly once either way. The FIRST accepted submission's own
    -- requested_passenger_name (and every other field) is preserved
    -- unchanged; this replay's own (possibly different) value is
    -- discarded, never applied as an update.
    select id into v_request_id
    from public.transportation_requests
    where intake_integration_id = v_integration.id and external_submission_ref = v_idempotency_key;
  else
    -- Only logged for the genuinely-new-row path — a replay never
    -- produces a second request_events row. actor_user_id is NULL (no
    -- authenticated identity exists for this caller). No PII/free-text
    -- field is copied into metadata — only the safe, internal
    -- integration id (requested_passenger_name is NOT logged here
    -- either, same reasoning as serviceType/recurringSchedule: it lives
    -- on the Request row itself already).
    insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata)
    values (
      v_integration.organization_id, v_request_id, 'request_logged', null,
      jsonb_build_object('source', 'web', 'intake_integration_id', v_integration.id)
    );

    -- P1-PILOT-S4B-R4D: durable notification event, written in THIS transaction
    -- and ONLY on the genuinely-new-row path (an idempotent replay never reaches
    -- here, so it can never notify twice). Recipients are resolved LIVE at
    -- dispatch time; no address or Request content is copied into the event.
    v_result.notification_event_id := public._enqueue_notification_event(
      v_integration.organization_id, 'website_request', 'transportation_request', v_request_id
    );
  end if;

  v_result.accepted := true;
  return v_result;
end;
$$;
create or replace function public.accept_staff_invite(p_token text)
returns public.staff_invite_acceptance_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.staff_invites%rowtype;
  v_caller_email text;
  v_m public.memberships%rowtype;
  v_created boolean := false;
  v_reactivated boolean := false;
  v_result public.staff_invite_acceptance_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if p_token is null or length(p_token) not between 32 and 200 then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_invite from public.staff_invites
  where token_hash = public._staff_invite_token_hash(p_token) for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- The caller must BE the invited identity. A different signed-in user
  -- learns nothing beyond "this token is not usable by you".
  select lower(email) into v_caller_email from auth.users where id = auth.uid();
  if v_caller_email is null or v_caller_email <> lower(v_invite.email) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- R4E: no invitation can be accepted into a suspended organization.
  if not exists (select 1 from public.organizations o where o.id = v_invite.organization_id and o.status = 'active') then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  if v_invite.status = 'cancelled' then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  if v_invite.status = 'accepted' then
    -- Idempotent repeat by the SAME person only.
    if v_invite.accepted_by is distinct from auth.uid() then
      raise exception 'stale_state' using errcode = 'ZW003';
    end if;
    select * into v_m from public.memberships where organization_id = v_invite.organization_id and user_id = auth.uid();
    v_result.organization_id := v_invite.organization_id;
    v_result.role := coalesce(v_m.role, v_invite.role);
    v_result.membership_created := false;
    v_result.membership_reactivated := false;
    return v_result;
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  select * into v_m from public.memberships
  where organization_id = v_invite.organization_id and user_id = auth.uid() for update;

  if not found then
    insert into public.memberships (organization_id, user_id, role, status)
    values (v_invite.organization_id, auth.uid(), v_invite.role, 'active');
    v_created := true;
  elsif v_m.role = 'driver' then
    -- A Driver identity is never converted into staff by an invitation.
    raise exception 'invalid_input' using errcode = 'ZW006';
  elsif v_m.status = 'inactive' then
    update public.memberships set role = v_invite.role, status = 'active' where id = v_m.id;
    v_reactivated := true;
  end if;
  -- else: already an active staff member -> the existing role is preserved.

  update public.staff_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, after_data)
  values (v_invite.organization_id, 'staff_invite', v_invite.id, 'staff_invitation_accepted', auth.uid(),
          jsonb_build_object('email', v_invite.email, 'role', v_invite.role,
                             'membership_created', v_created, 'membership_reactivated', v_reactivated));

  v_result.organization_id := v_invite.organization_id;
  v_result.role := case when v_created or v_reactivated then v_invite.role else v_m.role end;
  v_result.membership_created := v_created;
  v_result.membership_reactivated := v_reactivated;
  return v_result;
end;
$$;
create or replace function public.redeem_driver_invite(p_token uuid)
returns public.driver_invite_redemption_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.driver_invites;
  v_caller_email text;
  v_membership_exists boolean;
  v_existing_driver_id uuid;
  v_new_driver_id uuid;
  v_result public.driver_invite_redemption_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  -- Row-locked for the duration of this transaction — a second,
  -- concurrent redemption attempt (double-click, two tabs) blocks here
  -- until the first commits, then observes the now-'accepted' status
  -- below rather than racing to create a second Membership/Driver row
  -- (mirrors assign_trip's own row-lock-then-check discipline).
  select * into v_invite from public.driver_invites where token = p_token for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- No existence oracle beyond "a token exists" (which the caller
  -- already necessarily knows, having supplied it) — an email mismatch
  -- and a genuinely nonexistent token both simply mean this caller
  -- cannot act on this token.
  select lower(email) into v_caller_email from auth.users where id = auth.uid();
  if v_caller_email is null or v_caller_email <> lower(v_invite.email) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- R4E: no invitation can be accepted into a suspended organization.
  if not exists (select 1 from public.organizations o where o.id = v_invite.organization_id and o.status = 'active') then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  if v_invite.status = 'revoked' then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  if v_invite.status = 'accepted' then
    -- Idempotent-safe repeat call (a page refresh, a double-submit) only
    -- when it was THIS SAME person who already redeemed it — otherwise a
    -- genuine conflict, denied.
    if v_invite.accepted_by is distinct from auth.uid() then
      raise exception 'stale_state' using errcode = 'ZW003';
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Membership: create only if none exists yet for (org, this person) —
  -- never override an existing role (e.g. this person is already this
  -- org's organization_admin and is ALSO the invited driver; leave their
  -- admin Membership untouched, exactly like link_self_as_driver would).
  -- ---------------------------------------------------------------------
  select exists (
    select 1 from public.memberships
    where organization_id = v_invite.organization_id and user_id = auth.uid()
  ) into v_membership_exists;

  if not v_membership_exists then
    insert into public.memberships (organization_id, user_id, role, status)
    values (v_invite.organization_id, auth.uid(), 'driver', 'active');
  end if;

  -- ---------------------------------------------------------------------
  -- Driver row: reuse an existing active one for (org, this person) if
  -- present, else create using the INVITE's own display_name/phone (the
  -- admin-specified values — not caller-suppliable, so an invitee cannot
  -- claim a different identity than the one they were actually invited
  -- under).
  -- ---------------------------------------------------------------------
  select id into v_existing_driver_id
  from public.drivers
  where organization_id = v_invite.organization_id
    and user_id = auth.uid()
    and status = 'active';

  if v_existing_driver_id is not null then
    v_new_driver_id := v_existing_driver_id;
  else
    insert into public.drivers (organization_id, user_id, display_name, phone, status)
    values (v_invite.organization_id, auth.uid(), v_invite.display_name, v_invite.phone, 'active')
    returning id into v_new_driver_id;
  end if;

  if v_invite.status = 'pending' then
    update public.driver_invites
    set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
    where id = v_invite.id;

    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, after_data)
    values (
      v_invite.organization_id, 'driver_invite', v_invite.id, 'driver_invite_redeemed', auth.uid(),
      jsonb_build_object('driver_id', v_new_driver_id, 'membership_created', not v_membership_exists)
    );
  end if;

  v_result.driver_id := v_new_driver_id;
  v_result.organization_id := v_invite.organization_id;
  v_result.membership_created := not v_membership_exists;
  v_result.driver_linked := v_existing_driver_id is null;
  return v_result;
end;
$$;

-- ============================================================================
-- D1. Platform Admin loses its broad SELECT on audit_events
-- ============================================================================
-- (It existed since the RLS foundation, unused by any UI, and exposed EVERY
-- tenant's audit history -- team emails, settings -- to any PlatformAdminGrant
-- holder. Platform-level administrative history is now served only by the
-- whitelisted platform_list_activity below.)
drop policy if exists audit_events_select_platform_admin on public.audit_events;

-- R4F pre-release privacy hardening: the direct Platform Admin SELECT on
-- organizations (all tenants' business phone / email / address / contact) is no
-- longer needed -- the directory and detail read models are SECURITY DEFINER
-- functions. No application path read organizations as a Platform Admin.
drop policy if exists organizations_select_platform_admin on public.organizations;

-- ============================================================================
-- B/C. Platform read models + lifecycle mutation
-- ============================================================================
create type public.platform_organization_status_result as (
  organization_id uuid,
  status text,
  changed boolean
);

-- Tiny internal guard: raises ZW001 (no session) / ZW002 (not a Platform Admin).
-- Not executable by any client role.
create or replace function public._require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not exists (select 1 from public.platform_admin_grants g where g.user_id = auth.uid()) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
end;
$$;
revoke all on function public._require_platform_admin() from public, anon, authenticated;

-- ---- overview ---------------------------------------------------------------
create or replace function public.platform_get_overview()
returns table (
  total_organizations integer,
  active_organizations integer,
  suspended_organizations integer,
  integrations_total integer,
  integrations_active integer,
  notifications_failed integer,
  notifications_partial integer,
  notifications_stuck integer,
  platform_admin_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_platform_admin();
  return query
  select
    (select count(*)::int from public.organizations),
    (select count(*)::int from public.organizations where status = 'active'),
    (select count(*)::int from public.organizations where status <> 'active'),
    (select count(*)::int from public.request_intake_integrations),
    (select count(*)::int from public.request_intake_integrations where is_active),
    (select count(*)::int from public.notification_events where status = 'failed'),
    (select count(*)::int from public.notification_events where status = 'partial'),
    (select count(*)::int from public.notification_events e
      where (e.status = 'dispatching' and e.attempted_at < now() - interval '15 minutes')
         or (e.status = 'pending' and e.created_at < now() - interval '15 minutes')),
    (select count(*)::int from public.platform_admin_grants);
end;
$$;
comment on function public.platform_get_overview() is
  'Platform Admin only (PlatformAdminGrant; anyone else ZW002, no session ZW001). Aggregate platform-health counts only -- no tenant content. "Stuck" = pending or dispatching notification events older than 15 minutes (observable only; never mutated here).';
revoke all on function public.platform_get_overview() from public, anon;
grant execute on function public.platform_get_overview() to authenticated;

-- ---- directory --------------------------------------------------------------
-- "last_activity_at" = the latest of: any audit_events row for the organization,
-- the latest Request received, the latest Trip change. It is NOT a login time.
create or replace function public.platform_list_organizations(
  p_search text default null,
  p_status text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  organization_id uuid,
  name text,
  status text,
  created_at timestamptz,
  timezone text,
  active_staff_count integer,
  driver_count integer,
  integrations_total integer,
  integrations_active integer,
  request_count integer,
  trip_count integer,
  last_activity_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(p_search), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 100000));
begin
  perform public._require_platform_admin();
  if p_status is not null and p_status not in ('active', 'inactive') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_search is not null and length(v_search) > 100 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  return query
  with filtered as (
    select o.*
    from public.organizations o
    where (p_status is null or o.status = p_status)
      and (v_search is null
           or o.name ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ),
  page as (
    select f.*, count(*) over () as total
    from filtered f
    order by lower(f.name), f.id
    limit v_limit offset v_offset
  )
  select
    p.id, p.name, p.status, p.created_at, p.timezone,
    (select count(*)::int from public.memberships m
       where m.organization_id = p.id and m.status = 'active' and m.role in ('organization_admin', 'dispatcher')),
    (select count(*)::int from public.drivers d where d.organization_id = p.id),
    (select count(*)::int from public.request_intake_integrations i where i.organization_id = p.id),
    (select count(*)::int from public.request_intake_integrations i where i.organization_id = p.id and i.is_active),
    (select count(*)::int from public.transportation_requests r where r.organization_id = p.id),
    (select count(*)::int from public.trips t where t.organization_id = p.id),
    greatest(
      (select max(a.occurred_at) from public.audit_events a where a.organization_id = p.id),
      (select max(r.created_at) from public.transportation_requests r where r.organization_id = p.id),
      (select max(t.updated_at) from public.trips t where t.organization_id = p.id)
    ),
    p.total
  from page p
  order by lower(p.name), p.id;
end;
$$;
comment on function public.platform_list_organizations(text, text, integer, integer) is
  'Platform Admin only. Server-side search (name substring, wildcards escaped), status filter (active|inactive), stable name order, page size clamped to 50. Counts only -- no Request/Trip/Passenger rows. last_activity_at = latest audit event, Request received or Trip change (not a login time).';
revoke all on function public.platform_list_organizations(text, text, integer, integer) from public, anon;
grant execute on function public.platform_list_organizations(text, text, integer, integer) to authenticated;

-- ---- detail -----------------------------------------------------------------
create or replace function public.platform_get_organization(p_organization_id uuid)
returns table (
  organization_id uuid,
  name text,
  status text,
  created_at timestamptz,
  timezone text,
  business_stage text,
  active_admin_count integer,
  active_dispatcher_count integer,
  active_driver_membership_count integer,
  pending_staff_invite_count integer,
  driver_count integer,
  vehicle_count integer,
  passenger_count integer,
  request_count integer,
  trip_count integer,
  last_activity_at timestamptz,
  integrations_total integer,
  integrations_active integer,
  website_request_count integer,
  last_website_request_at timestamptz,
  notif_pending integer,
  notif_dispatching integer,
  notif_sent integer,
  notif_failed integer,
  notif_partial integer,
  notif_skipped integer,
  notif_stuck integer,
  last_failure_reason text,
  last_failure_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_platform_admin();
  if p_organization_id is null or not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  return query
  select
    o.id, o.name, o.status, o.created_at, o.timezone, o.business_stage,
    (select count(*)::int from public.memberships m where m.organization_id = o.id and m.status = 'active' and m.role = 'organization_admin'),
    (select count(*)::int from public.memberships m where m.organization_id = o.id and m.status = 'active' and m.role = 'dispatcher'),
    (select count(*)::int from public.memberships m where m.organization_id = o.id and m.status = 'active' and m.role = 'driver'),
    (select count(*)::int from public.staff_invites s where s.organization_id = o.id and s.status = 'pending' and s.expires_at > now()),
    (select count(*)::int from public.drivers d where d.organization_id = o.id),
    (select count(*)::int from public.vehicles v where v.organization_id = o.id),
    (select count(*)::int from public.passengers p where p.organization_id = o.id),
    (select count(*)::int from public.transportation_requests r where r.organization_id = o.id),
    (select count(*)::int from public.trips t where t.organization_id = o.id),
    greatest(
      (select max(a.occurred_at) from public.audit_events a where a.organization_id = o.id),
      (select max(r.created_at) from public.transportation_requests r where r.organization_id = o.id),
      (select max(t.updated_at) from public.trips t where t.organization_id = o.id)
    ),
    (select count(*)::int from public.request_intake_integrations i where i.organization_id = o.id),
    (select count(*)::int from public.request_intake_integrations i where i.organization_id = o.id and i.is_active),
    (select count(*)::int from public.transportation_requests r where r.organization_id = o.id and r.intake_integration_id is not null),
    (select max(r.created_at) from public.transportation_requests r where r.organization_id = o.id and r.intake_integration_id is not null),
    (select count(*)::int from public.notification_events e where e.organization_id = o.id and e.status = 'pending'),
    (select count(*)::int from public.notification_events e where e.organization_id = o.id and e.status = 'dispatching'),
    (select count(*)::int from public.notification_events e where e.organization_id = o.id and e.status = 'sent'),
    (select count(*)::int from public.notification_events e where e.organization_id = o.id and e.status = 'failed'),
    (select count(*)::int from public.notification_events e where e.organization_id = o.id and e.status = 'partial'),
    (select count(*)::int from public.notification_events e where e.organization_id = o.id and e.status = 'skipped'),
    (select count(*)::int from public.notification_events e where e.organization_id = o.id
       and ((e.status = 'dispatching' and e.attempted_at < now() - interval '15 minutes')
         or (e.status = 'pending' and e.created_at < now() - interval '15 minutes'))),
    (select e.failure_reason from public.notification_events e
       where e.organization_id = o.id and e.failure_reason is not null order by e.created_at desc, e.id desc limit 1),
    (select e.created_at from public.notification_events e
       where e.organization_id = o.id and e.failure_reason is not null order by e.created_at desc, e.id desc limit 1)
  from public.organizations o
  where o.id = p_organization_id;
end;
$$;
comment on function public.platform_get_organization(uuid) is
  'Platform Admin only; unknown organization ZW002. One row of COUNTS and health metadata for one organization: access counts, operational footprint counts, website-intake totals, notification delivery counts (with the fixed failure vocabulary). No Request/Trip/Passenger content, no addresses, no recipients.';
revoke all on function public.platform_get_organization(uuid) from public, anon;
grant execute on function public.platform_get_organization(uuid) to authenticated;

-- ---- integration health (no credentials, no integration ids) ----------------
create or replace function public.platform_list_organization_integrations(p_organization_id uuid)
returns table (
  allowed_origins text[],
  is_active boolean,
  created_at timestamptz,
  request_count integer,
  last_request_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_platform_admin();
  if p_organization_id is null or not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select i.allowed_origins, i.is_active, i.created_at,
         (select count(*)::int from public.transportation_requests r where r.intake_integration_id = i.id),
         (select max(r.created_at) from public.transportation_requests r where r.intake_integration_id = i.id)
  from public.request_intake_integrations i
  where i.organization_id = p_organization_id
  order by i.created_at, i.id;
end;
$$;
comment on function public.platform_list_organization_integrations(uuid) is
  'Platform Admin only. Read-only website-integration health for one organization: allowed origin(s), active flag, created date, Requests received, last received. Deliberately NO integration id / external id.';
revoke all on function public.platform_list_organization_integrations(uuid) from public, anon;
grant execute on function public.platform_list_organization_integrations(uuid) to authenticated;

-- ---- notification attention list -------------------------------------------
create or replace function public.platform_list_notification_attention(p_limit integer default 15)
returns table (
  organization_id uuid,
  organization_name text,
  event_type text,
  status text,
  failure_reason text,
  created_at timestamptz,
  completed_at timestamptz,
  is_stuck boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_platform_admin();
  return query
  select e.organization_id, o.name, e.event_type, e.status, e.failure_reason, e.created_at, e.completed_at,
         ((e.status = 'dispatching' and e.attempted_at < now() - interval '15 minutes')
          or (e.status = 'pending' and e.created_at < now() - interval '15 minutes'))
  from public.notification_events e
  join public.organizations o on o.id = e.organization_id
  where e.status in ('failed', 'partial')
     or (e.status = 'dispatching' and e.attempted_at < now() - interval '15 minutes')
     or (e.status = 'pending' and e.created_at < now() - interval '15 minutes')
  order by e.created_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 15), 50));
end;
$$;
comment on function public.platform_list_notification_attention(integer) is
  'Platform Admin only. Notification events needing attention (failed, partial, or pending/dispatching for more than 15 minutes), newest first. Event type, status, timestamps and the fixed failure vocabulary only -- never recipients, request/exception content or provider text.';
revoke all on function public.platform_list_notification_attention(integer) from public, anon;
grant execute on function public.platform_list_notification_attention(integer) to authenticated;

-- ---- lifecycle mutation -----------------------------------------------------
create or replace function public.set_platform_organization_status(
  p_organization_id uuid,
  p_status text,
  p_reason text
)
returns public.platform_organization_status_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_org public.organizations%rowtype;
  v_result public.platform_organization_status_result;
begin
  perform public._require_platform_admin();

  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_organization_id is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_org from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_result.organization_id := v_org.id;
  v_result.status := v_org.status;
  v_result.changed := false;
  if v_org.status = p_status then
    return v_result; -- idempotent: already in that state, no audit
  end if;

  update public.organizations set status = p_status where id = v_org.id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (
    v_org.id, 'organization', v_org.id,
    case when p_status = 'inactive' then 'platform_organization_suspended' else 'platform_organization_reactivated' end,
    auth.uid(),
    jsonb_build_object('status', v_org.status),
    jsonb_build_object('status', p_status),
    v_reason
  );

  v_result.status := p_status;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.set_platform_organization_status(uuid, text, text) is
  'Platform Admin only (PlatformAdminGrant; Organization Admin / Dispatcher / Driver / anon can not execute). Sets organizations.status to active or inactive (presented as "Suspended"); reason required (3-500 chars). Locks the organization row, is idempotent (same status = no change, no audit) and writes a platform_organization_suspended / platform_organization_reactivated AuditEvent with actor = auth.uid(). Never touches Memberships, Drivers, Requests, Trips, integrations or notification history.';
revoke all on function public.set_platform_organization_status(uuid, text, text) from public, anon;
grant execute on function public.set_platform_organization_status(uuid, text, text) to authenticated;

-- ---- platform activity ------------------------------------------------------
create or replace function public.platform_list_activity(
  p_limit integer default 30,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  occurred_at timestamptz,
  action text,
  organization_id uuid,
  organization_name text,
  actor_name text,
  reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_platform_admin();
  return query
  select a.id, a.occurred_at, a.action, a.organization_id, o.name,
         case when a.actor_user_id is null then null else coalesce(nullif(btrim(p.display_name), ''), u.email::text) end,
         a.reason
  from public.audit_events a
  join public.organizations o on o.id = a.organization_id
  left join public.user_profiles p on p.id = a.actor_user_id
  left join auth.users u on u.id = a.actor_user_id
  where a.action in ('platform_organization_suspended', 'platform_organization_reactivated')
    and (p_before_at is null or (a.occurred_at, a.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by a.occurred_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 51));
end;
$$;
comment on function public.platform_list_activity(integer, timestamptz, uuid) is
  'Platform Admin only. Newest-first, keyset-paged (occurred_at, id) page of PLATFORM administrative actions only (organization suspended / reactivated) from audit_events -- never a tenant''s operational or settings audit history.';
revoke all on function public.platform_list_activity(integer, timestamptz, uuid) from public, anon;
grant execute on function public.platform_list_activity(integer, timestamptz, uuid) to authenticated;

-- ============================================================================
-- E. tenant Settings > Activity: deliberate, safe presentation of platform actions
-- ============================================================================
create or replace function public.list_activity_events(
  p_organization_id uuid,
  p_limit integer default 30,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (id uuid, occurred_at timestamptz, action text, actor_name text, before_data jsonb, after_data jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c_actions constant text[] := array[
    'organization_created', 'organization_settings_updated', 'organization_operating_schedule_updated',
    'organization_services_configured', 'organization_service_offerings_updated',
    'website_integration_created', 'website_integration_activated', 'website_integration_disabled',
    'website_integration_origin_updated',
    'staff_invitation_created', 'staff_invitation_resent', 'staff_invitation_cancelled', 'staff_invitation_accepted',
    'membership_role_changed', 'membership_deactivated', 'membership_reactivated',
    'notification_preferences_updated',
    'platform_organization_suspended', 'platform_organization_reactivated'
  ];
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  return query
  select a.id, a.occurred_at, a.action,
         case when a.action like 'platform\_%' then 'Nemryn'
              when a.actor_user_id is null then null
              else coalesce(nullif(btrim(p.display_name), ''), u.email::text) end,
         a.before_data, a.after_data
  from public.audit_events a
  left join public.user_profiles p on p.id = a.actor_user_id
  left join auth.users u on u.id = a.actor_user_id
  where a.organization_id = p_organization_id
    and a.action = any (c_actions)
    and (p_before_at is null or (a.occurred_at, a.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by a.occurred_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 51));
end;
$$;
comment on function public.list_activity_events(uuid, integer, timestamptz, uuid) is
  'Organization Admin of p_organization_id only (Dispatcher, Driver, inactive, foreign, Platform Admin without Membership: ZW002). Newest-first page of that organization''s ADMINISTRATIVE audit_events, restricted to a whitelist of actions (operational trip/request audit rows are never returned), keyset-paged by (occurred_at, id). Returns raw before/after only to the server-side projector (src/lib/operations/activity-core.ts), which maps them to human text; nothing raw reaches the browser. The actor is the profile display name (else account email); null actor -> null. R4E: the two platform lifecycle actions are included with the actor shown as "Nemryn" (the platform administrator''s identity and the internal reason are never returned).';
revoke all on function public.list_activity_events(uuid, integer, timestamptz, uuid) from public;
grant execute on function public.list_activity_events(uuid, integer, timestamptz, uuid) to authenticated;
