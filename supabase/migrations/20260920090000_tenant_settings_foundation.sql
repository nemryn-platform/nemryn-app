-- P1-PILOT-S4B-R4A -- Tenant Foundation + Settings Control Center.
--
-- Three narrowly-scoped changes, all in service of "a completely fresh
-- NEMT business can create and configure its organization through the
-- product, with no manual SQL / service-role provisioning":
--
--   1. organizations gains the tenant-facing business profile columns that
--      did not exist yet (business phone, business email, business
--      address, primary operations contact name). name/timezone already
--      existed and are REUSED, not duplicated into a second settings model.
--
--   2. update_organization_settings -- the controlled, audited, Organization
--      Admin-only mutation behind Settings -> Organization. Organization
--      identity comes from an authorization check inside the function
--      (has_org_role on the target organization), never from a trusted
--      client value. Writes one `organization_settings_updated` AuditEvent
--      (changed fields only, before/after) in the same transaction.
--      Direct column UPDATE on organizations.name / organizations.timezone
--      is REVOKED from `authenticated` so this is the only path that changes
--      them -- otherwise an admin could edit either column through the
--      REST API and bypass the audit trail entirely.
--
--   3. signup_create_organization is no longer directly executable by
--      `authenticated`. Until now ANY authenticated principal (including a
--      Driver or Dispatcher of an unrelated tenant) could call it directly,
--      any number of times, minting unlimited organizations and Admin
--      Memberships; and two concurrent direct calls from one fresh user
--      produced two organizations. The exactly-once, advisory-locked,
--      "caller has no Membership yet" gates already exist --
--      complete_pending_signup() and complete_pending_signup_manual()
--      (20260903110000) -- they were simply bypassable. They remain the
--      ONLY entry points; they are SECURITY DEFINER and reach the
--      now-internal signup_create_organization under the owner's privilege.
--      No INSERT grant is added to organizations or memberships.

-- =============================================================================
-- 1. Business profile columns
-- =============================================================================
alter table public.organizations
  add column business_phone text,
  add column business_email text,
  add column business_address text,
  add column primary_contact_name text;

alter table public.organizations
  add constraint organizations_business_phone_length
    check (business_phone is null or length(business_phone) <= 40),
  add constraint organizations_business_email_valid
    check (business_email is null or (length(business_email) <= 254 and business_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  add constraint organizations_business_address_length
    check (business_address is null or length(business_address) <= 500),
  add constraint organizations_primary_contact_name_length
    check (primary_contact_name is null or length(primary_contact_name) <= 200);

comment on column public.organizations.business_phone is
  'The organization''s own business phone number (free text, <= 40 chars). Descriptive tenant profile data only -- never read by any RLS policy or authorization check, never used in public marketing output. Changed only via update_organization_settings (no direct UPDATE grant).';
comment on column public.organizations.business_email is
  'The organization''s own business email address (lowercased, format-checked). Descriptive only -- same handling as business_phone.';
comment on column public.organizations.business_address is
  'The organization''s own business address as a plain free-text block (<= 500 chars). No geocoding, no structured address model.';
comment on column public.organizations.primary_contact_name is
  'Name of the person the organization designates as its primary operations contact -- a plain label, NOT a link to a user or Membership. The contact''s phone/email are the organization''s business phone/email above.';

-- =============================================================================
-- 2. update_organization_settings
-- =============================================================================
create type public.organization_settings_result as (
  organization_id uuid,
  changed boolean
);

comment on type public.organization_settings_result is
  'Return shape for update_organization_settings. `changed` is false when the submitted values already matched the stored values (no write, no AuditEvent).';

-- p_changes is a jsonb PATCH: only the keys present are considered. An
-- absent key is left untouched; a present key with null/blank clears an
-- optional field. Unknown keys are rejected rather than ignored, so a
-- crafted payload can never smuggle a column (status, business_stage, id,
-- ...) through this function. Values must be JSON strings or null.
create or replace function public.update_organization_settings(
  p_organization_id uuid,
  p_changes jsonb
)
returns public.organization_settings_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array['name', 'timezone', 'business_phone', 'business_email', 'business_address', 'primary_contact_name'];
  v_key text;
  v_value jsonb;
  v_before public.organizations%rowtype;
  v_name text;
  v_timezone text;
  v_phone text;
  v_email text;
  v_address text;
  v_contact text;
  v_before_data jsonb := '{}'::jsonb;
  v_after_data jsonb := '{}'::jsonb;
  v_result public.organization_settings_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  -- Authorization FIRST and uniform: a Dispatcher, a Driver, an inactive
  -- Membership, a foreign organization and a nonexistent organization are
  -- all indistinguishable (no existence oracle) -- same ZW002 convention as
  -- every other organization-scoped mutation.
  if p_organization_id is null
     or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  for v_key, v_value in select * from jsonb_each(p_changes) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    if jsonb_typeof(v_value) not in ('string', 'null') then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end loop;

  -- Serialize concurrent edits of the same organization; the diff below is
  -- computed against the row as it is once this lock is held.
  select * into v_before from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_name := v_before.name;
  v_timezone := v_before.timezone;
  v_phone := v_before.business_phone;
  v_email := v_before.business_email;
  v_address := v_before.business_address;
  v_contact := v_before.primary_contact_name;

  if p_changes ? 'name' then
    v_name := nullif(btrim(p_changes ->> 'name'), '');
    if v_name is null or length(v_name) > 200 then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  if p_changes ? 'timezone' then
    v_timezone := nullif(btrim(p_changes ->> 'timezone'), '');
    if v_timezone is null or not public.is_valid_iana_timezone(v_timezone) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  if p_changes ? 'business_phone' then
    v_phone := nullif(btrim(p_changes ->> 'business_phone'), '');
    if v_phone is not null and (
         length(v_phone) > 40
         or length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 20
       ) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  if p_changes ? 'business_email' then
    v_email := lower(nullif(btrim(p_changes ->> 'business_email'), ''));
    if v_email is not null and (
         length(v_email) > 254
         or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       ) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  if p_changes ? 'business_address' then
    v_address := nullif(btrim(p_changes ->> 'business_address'), '');
    if v_address is not null and length(v_address) > 500 then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  if p_changes ? 'primary_contact_name' then
    v_contact := nullif(btrim(p_changes ->> 'primary_contact_name'), '');
    if v_contact is not null and length(v_contact) > 200 then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  v_result.organization_id := p_organization_id;

  -- Changed-fields-only before/after, so the (future) Activity view can say
  -- exactly what moved without diffing full rows.
  if v_name is distinct from v_before.name then
    v_before_data := v_before_data || jsonb_build_object('name', v_before.name);
    v_after_data := v_after_data || jsonb_build_object('name', v_name);
  end if;
  if v_timezone is distinct from v_before.timezone then
    v_before_data := v_before_data || jsonb_build_object('timezone', v_before.timezone);
    v_after_data := v_after_data || jsonb_build_object('timezone', v_timezone);
  end if;
  if v_phone is distinct from v_before.business_phone then
    v_before_data := v_before_data || jsonb_build_object('business_phone', v_before.business_phone);
    v_after_data := v_after_data || jsonb_build_object('business_phone', v_phone);
  end if;
  if v_email is distinct from v_before.business_email then
    v_before_data := v_before_data || jsonb_build_object('business_email', v_before.business_email);
    v_after_data := v_after_data || jsonb_build_object('business_email', v_email);
  end if;
  if v_address is distinct from v_before.business_address then
    v_before_data := v_before_data || jsonb_build_object('business_address', v_before.business_address);
    v_after_data := v_after_data || jsonb_build_object('business_address', v_address);
  end if;
  if v_contact is distinct from v_before.primary_contact_name then
    v_before_data := v_before_data || jsonb_build_object('primary_contact_name', v_before.primary_contact_name);
    v_after_data := v_after_data || jsonb_build_object('primary_contact_name', v_contact);
  end if;

  if v_after_data = '{}'::jsonb then
    v_result.changed := false;
    return v_result;
  end if;

  update public.organizations
  set name = v_name,
      timezone = v_timezone,
      business_phone = v_phone,
      business_email = v_email,
      business_address = v_address,
      primary_contact_name = v_contact
  where id = p_organization_id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'organization', p_organization_id, 'organization_settings_updated', auth.uid(),
    v_before_data, v_after_data
  );

  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.update_organization_settings(uuid, jsonb) is
  'Organization Admin of p_organization_id only (has_org_role; every other caller -- Dispatcher, Driver, inactive Membership, foreign or nonexistent organization -- gets the same ZW002). The sole path that changes organizations.name / timezone / business_phone / business_email / business_address / primary_contact_name (direct UPDATE on name/timezone is revoked). p_changes is a jsonb patch of only those keys; unknown keys are rejected (ZW006). Validates, locks the row, writes an organization_settings_updated AuditEvent with changed-field before/after in the same transaction; a no-op submission writes nothing.';

revoke all on function public.update_organization_settings(uuid, jsonb) from public;
grant execute on function public.update_organization_settings(uuid, jsonb) to authenticated;

-- Close the direct-write bypass around the audited path (see header).
-- status / business_stage / service_area_description keep their existing
-- narrow grants, untouched by this phase.
revoke update (name, timezone) on public.organizations from authenticated;

-- =============================================================================
-- 3. signup_create_organization becomes internal-only
-- =============================================================================
revoke execute on function public.signup_create_organization(text, text, text, text) from authenticated;

comment on function public.signup_create_organization(text, text, text, text) is
  'INTERNAL. Not executable by any client role (revoked from authenticated by 20260920090000): it is deliberately non-idempotent and has no eligibility gate of its own, so it is reachable only through the exactly-once, advisory-locked gates complete_pending_signup() and complete_pending_signup_manual() (SECURITY DEFINER, owner privilege). Atomically creates the caller''s UserProfile, a new Organization, and the caller''s own organization_admin Membership, plus an organization_created AuditEvent. role is always organization_admin, never caller-supplied. No raw INSERT grant exists on organizations or memberships -- see docs/product/operator-onboarding-model.md.';
