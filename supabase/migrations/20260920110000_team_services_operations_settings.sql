-- P1-PILOT-S4B-R4C -- Team & Access + Services & Intake + Operations
-- Preferences, and closing the R4A direct-write gaps on organizations.
--
-- Everything below is a narrow SECURITY DEFINER function or an additive
-- column/table; every new table is closed (RLS on, no policy, no grant).
-- No generic INSERT/UPDATE/DELETE privilege is granted on anything.
--
--   A. Staff invitations (staff_invites) + team read/management functions.
--      memberships stops being directly writable by any client role
--      (INSERT/UPDATE revoked, the two now-inert policies dropped): every
--      Membership change goes through accept_staff_invite (existing
--      pattern: redeem_driver_invite), change_membership_role or
--      set_membership_status. Last-admin safety is enforced under a
--      per-organization advisory lock.
--   B. organization_service_offerings + get/set functions, and the ONE
--      tenant-specific validation added to submit_public_transportation_
--      request (frozen payload/contract untouched).
--   C. organizations.operating_days/opens/closes + update function.
--   D. update_organization_settings gains business_stage and
--      service_area_description; ALL remaining direct UPDATE grants on
--      organizations (status, business_stage, service_area_description) are
--      revoked. organizations now has no client UPDATE privilege at all.

-- =============================================================================
-- A. STAFF INVITATIONS
-- =============================================================================
-- Token material: 256 random bits, hex. Only its SHA-256 is stored; the raw
-- value exists in the email link (and transiently in the calling server
-- action) and is never recoverable from the database. A resend therefore
-- ISSUES A NEW TOKEN and the previous one stops working -- there is never
-- more than one valid token per invitation.
create table public.staff_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  email text not null,
  role text not null check (role in ('organization_admin', 'dispatcher')),
  token_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  expires_at timestamptz not null,
  invited_by uuid not null references auth.users (id),
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token_hash)
);

comment on table public.staff_invites is
  'TENANT-OWNED. A token-gated invitation for STAFF access (organization_admin | dispatcher) -- never a Driver invite (driver_invites is separate) and never itself a Membership. RLS on, no policy, no grant to any client role: every read and write goes through the SECURITY DEFINER functions of 20260920110000. Only the SHA-256 of the token is stored. "expired" is derived (pending and expires_at <= now()), not stored.';

-- At most one PENDING invitation per (organization, email).
create unique index staff_invites_org_email_pending_idx
  on public.staff_invites (organization_id, lower(email))
  where status = 'pending';
create index staff_invites_organization_id_idx on public.staff_invites (organization_id);

create trigger staff_invites_set_updated_at
  before update on public.staff_invites
  for each row execute function public.set_updated_at();
create trigger staff_invites_prevent_org_change
  before update on public.staff_invites
  for each row execute function public.prevent_organization_id_change();

alter table public.staff_invites enable row level security;
revoke all on public.staff_invites from anon, authenticated;

-- ---- internal helpers -------------------------------------------------------
create or replace function public._staff_invite_token_hash(p_token text)
returns text
language sql
immutable
set search_path = pg_catalog, public, extensions
as $$
  select encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function public._staff_invite_token_hash(text) from public, anon, authenticated;

create or replace function public._generate_staff_invite_token()
returns text
language sql
volatile
set search_path = pg_catalog, public, extensions
as $$
  select encode(extensions.gen_random_bytes(32), 'hex');
$$;
revoke all on function public._generate_staff_invite_token() from public, anon, authenticated;

-- Serializes every operation that can change how many active Organization
-- Admins an organization has (role change, deactivation), so two Admins
-- acting at once cannot both pass the "someone else remains" check.
create or replace function public._lock_org_admins(p_organization_id uuid)
returns void
language sql
volatile
set search_path = pg_catalog, public
as $$
  select pg_advisory_xact_lock(hashtext('org-admins:' || p_organization_id::text)::bigint);
$$;
revoke all on function public._lock_org_admins(uuid) from public, anon, authenticated;

create type public.staff_invite_result as (
  invite_id uuid,
  token text,
  email text,
  role text,
  expires_at timestamptz,
  reissued boolean
);

comment on type public.staff_invite_result is
  'Return shape for create_staff_invite / resend_staff_invite. `token` is the RAW invitation token, returned exactly once to the calling server action so it can be emailed; it is not stored and not shown to the browser. `reissued` is true when an existing pending invitation was re-issued (new token, previous one invalidated).';

-- ---- create_staff_invite -----------------------------------------------------
create or replace function public.create_staff_invite(
  p_organization_id uuid,
  p_email text,
  p_role text
)
returns public.staff_invite_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_ttl constant interval := interval '7 days';
  c_max_pending constant int := 25;
  v_email text;
  v_existing public.staff_invites%rowtype;
  v_member record;
  v_token text;
  v_id uuid;
  v_expires timestamptz := now() + c_ttl;
  v_result public.staff_invite_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if p_organization_id is null
     or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Only staff roles can ever be invited here. Driver has its own lifecycle.
  if p_role is null or p_role not in ('organization_admin', 'dispatcher') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_email := lower(nullif(btrim(p_email), ''));
  if v_email is null or length(v_email) > 255 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  perform pg_advisory_xact_lock(hashtext('staff-invites:' || p_organization_id::text)::bigint);

  -- Whether this email holds a Membership of THIS organization is the
  -- organization's own team information (the Admin already sees its team).
  -- Nothing is revealed about accounts elsewhere.
  select m.role, m.status into v_member
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_organization_id and lower(u.email) = v_email;

  if found and (v_member.role = 'driver' or v_member.status = 'active') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_token := public._generate_staff_invite_token();

  select * into v_existing
  from public.staff_invites
  where organization_id = p_organization_id and lower(email) = v_email and status = 'pending'
  for update;

  if found then
    update public.staff_invites
    set token_hash = public._staff_invite_token_hash(v_token), role = p_role,
        expires_at = v_expires, invited_by = auth.uid()
    where id = v_existing.id;

    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
    values (p_organization_id, 'staff_invite', v_existing.id, 'staff_invitation_resent', auth.uid(),
            jsonb_build_object('role', v_existing.role),
            jsonb_build_object('email', v_email, 'role', p_role, 'expires_at', v_expires));

    v_id := v_existing.id;
    v_result.reissued := true;
  else
    if (select count(*) from public.staff_invites
        where organization_id = p_organization_id and status = 'pending' and expires_at > now()) >= c_max_pending then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;

    insert into public.staff_invites (organization_id, email, role, token_hash, expires_at, invited_by)
    values (p_organization_id, v_email, p_role, public._staff_invite_token_hash(v_token), v_expires, auth.uid())
    returning id into v_id;

    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, after_data)
    values (p_organization_id, 'staff_invite', v_id, 'staff_invitation_created', auth.uid(),
            jsonb_build_object('email', v_email, 'role', p_role, 'expires_at', v_expires));

    v_result.reissued := false;
  end if;

  v_result.invite_id := v_id;
  v_result.token := v_token;
  v_result.email := v_email;
  v_result.role := p_role;
  v_result.expires_at := v_expires;
  return v_result;
end;
$$;

comment on function public.create_staff_invite(uuid, text, text) is
  'Organization Admin of p_organization_id only (else ZW002). Invites an email to organization_admin or dispatcher (anything else, including driver -> ZW006). Refuses an email that already holds an active or driver Membership of this organization (ZW006). An existing pending invitation for the email is re-issued (new token, prior token invalid). Returns the raw token once for emailing; only its hash is stored. Reveals nothing about accounts outside this organization.';

revoke all on function public.create_staff_invite(uuid, text, text) from public;
grant execute on function public.create_staff_invite(uuid, text, text) to authenticated;

-- ---- resend_staff_invite ------------------------------------------------------
create or replace function public.resend_staff_invite(p_invite_id uuid)
returns public.staff_invite_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_ttl constant interval := interval '7 days';
  v_org uuid;
  v_row public.staff_invites%rowtype;
  v_token text := public._generate_staff_invite_token();
  v_expires timestamptz := now() + c_ttl;
  v_result public.staff_invite_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select organization_id into v_org from public.staff_invites where id = p_invite_id;
  if p_invite_id is null or v_org is null or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  perform pg_advisory_xact_lock(hashtext('staff-invites:' || v_org::text)::bigint);
  select * into v_row from public.staff_invites where id = p_invite_id for update;

  if v_row.status <> 'pending' then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  update public.staff_invites
  set token_hash = public._staff_invite_token_hash(v_token), expires_at = v_expires, invited_by = auth.uid()
  where id = v_row.id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, after_data)
  values (v_org, 'staff_invite', v_row.id, 'staff_invitation_resent', auth.uid(),
          jsonb_build_object('email', v_row.email, 'role', v_row.role, 'expires_at', v_expires));

  v_result.invite_id := v_row.id;
  v_result.token := v_token;
  v_result.email := v_row.email;
  v_result.role := v_row.role;
  v_result.expires_at := v_expires;
  v_result.reissued := true;
  return v_result;
end;
$$;

comment on function public.resend_staff_invite(uuid) is
  'Organization Admin of the invitation''s own organization only (foreign/nonexistent id -> ZW002). Re-issues a PENDING (including expired-but-pending) invitation with a fresh token and a fresh 7-day expiry; the previous token stops working. Accepted/cancelled invitations -> ZW003.';

revoke all on function public.resend_staff_invite(uuid) from public;
grant execute on function public.resend_staff_invite(uuid) to authenticated;

-- ---- cancel_staff_invite ------------------------------------------------------
create or replace function public.cancel_staff_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_row public.staff_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select organization_id into v_org from public.staff_invites where id = p_invite_id;
  if p_invite_id is null or v_org is null or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  perform pg_advisory_xact_lock(hashtext('staff-invites:' || v_org::text)::bigint);
  select * into v_row from public.staff_invites where id = p_invite_id for update;

  if v_row.status <> 'pending' then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  update public.staff_invites set status = 'cancelled' where id = v_row.id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, after_data)
  values (v_org, 'staff_invite', v_row.id, 'staff_invitation_cancelled', auth.uid(),
          jsonb_build_object('email', v_row.email, 'role', v_row.role));
  return true;
end;
$$;

comment on function public.cancel_staff_invite(uuid) is
  'Organization Admin of the invitation''s own organization only. Cancels a PENDING invitation; the row is kept as history. A cancelled invitation can never be accepted.';

revoke all on function public.cancel_staff_invite(uuid) from public;
grant execute on function public.cancel_staff_invite(uuid) to authenticated;

-- ---- get_staff_invite_preview (token-gated, anon-callable) --------------------
create type public.staff_invite_preview as (
  organization_name text,
  email text,
  role text,
  status text
);

comment on type public.staff_invite_preview is
  'Minimum-necessary fields for the invitation landing page BEFORE the recipient has an account. status is the EFFECTIVE status: pending | expired | accepted | cancelled.';

create or replace function public.get_staff_invite_preview(p_token text)
returns public.staff_invite_preview
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result public.staff_invite_preview;
begin
  select o.name, i.email, i.role,
         case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end
  into v_result.organization_name, v_result.email, v_result.role, v_result.status
  from public.staff_invites i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = public._staff_invite_token_hash(p_token)
    and p_token is not null and length(p_token) between 32 and 200;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return v_result;
end;
$$;

comment on function public.get_staff_invite_preview(text) is
  'Public (anon + authenticated), token-gated, read-only -- the same precedent as get_driver_invite_preview. The 256-bit token is the credential; returns only organization name, invited email, role and effective status. Never an id.';

revoke all on function public.get_staff_invite_preview(text) from public;
grant execute on function public.get_staff_invite_preview(text) to anon, authenticated;

-- ---- accept_staff_invite ------------------------------------------------------
create type public.staff_invite_acceptance_result as (
  organization_id uuid,
  role text,
  membership_created boolean,
  membership_reactivated boolean
);

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

comment on function public.accept_staff_invite(text) is
  'Any authenticated user whose OWN account email equals the invitation''s email. Takes no organization or role parameter: both come from the invitation row, so cross-organization or elevated-role acceptance is structurally impossible. Cancelled or expired -> ZW003; single-use (a repeat by the same person is an idempotent no-op; by anyone else ZW003). Creates the Membership with the invited role (or reactivates an inactive staff Membership with it); never changes an active member''s role and never converts a Driver Membership. Existing Memberships in other organizations are untouched.';

revoke all on function public.accept_staff_invite(text) from public;
grant execute on function public.accept_staff_invite(text) to authenticated;

-- ---- list_staff_invites / list_team_members ----------------------------------
create or replace function public.list_staff_invites(p_organization_id uuid)
returns table (id uuid, email text, role text, status text, expires_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  return query
  select i.id, i.email, i.role,
         case when i.expires_at <= now() then 'expired' else 'pending' end,
         i.expires_at, i.created_at
  from public.staff_invites i
  where i.organization_id = p_organization_id and i.status = 'pending'
  order by i.created_at desc, i.id;
end;
$$;

comment on function public.list_staff_invites(uuid) is
  'Organization Admin of p_organization_id only. Pending invitations (effective status pending | expired). No token material is ever returned.';

revoke all on function public.list_staff_invites(uuid) from public;
grant execute on function public.list_staff_invites(uuid) to authenticated;

create or replace function public.list_team_members(p_organization_id uuid)
returns table (
  membership_id uuid,
  display_name text,
  email text,
  role text,
  status text,
  joined_at timestamptz,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- STAFF only: Driver Memberships belong to the Drivers module.
  return query
  select m.id, p.display_name, u.email::text, m.role, m.status, m.created_at, (m.user_id = auth.uid())
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.user_profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id and m.role in ('organization_admin', 'dispatcher')
  order by (m.status = 'active') desc, (m.role = 'organization_admin') desc, m.created_at, m.id;
end;
$$;

comment on function public.list_team_members(uuid) is
  'Organization Admin of p_organization_id only. STAFF Memberships (organization_admin, dispatcher) of that organization with display name and account email. membership_id is an opaque management handle; no user id or organization id is returned.';

revoke all on function public.list_team_members(uuid) from public;
grant execute on function public.list_team_members(uuid) to authenticated;

-- ---- change_membership_role / set_membership_status ---------------------------
create type public.membership_change_result as (
  membership_id uuid,
  role text,
  status text,
  changed boolean
);

create or replace function public.change_membership_role(p_membership_id uuid, p_role text)
returns public.membership_change_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_row public.memberships%rowtype;
  v_admins int;
  v_email text;
  v_result public.membership_change_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select organization_id into v_org from public.memberships where id = p_membership_id;
  if p_membership_id is null or v_org is null or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_role is null or p_role not in ('organization_admin', 'dispatcher') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  perform public._lock_org_admins(v_org);

  -- Re-authorize AFTER the lock: an Admin demoted or deactivated by a
  -- concurrent transaction while this one waited must not complete one more
  -- administrative action on the strength of a check made before the wait.
  if not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_row from public.memberships where id = p_membership_id for update;

  -- Driver Memberships are not staff and are not managed here.
  if v_row.role not in ('organization_admin', 'dispatcher') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_result.membership_id := v_row.id;
  v_result.status := v_row.status;

  if v_row.role = p_role then
    v_result.role := v_row.role;
    v_result.changed := false;
    return v_result;
  end if;

  -- Last-admin safety: never leave the organization without an active Admin.
  if v_row.role = 'organization_admin' and v_row.status = 'active' then
    select count(*) into v_admins from public.memberships
    where organization_id = v_org and role = 'organization_admin' and status = 'active';
    if v_admins <= 1 then
      raise exception 'last_admin' using errcode = 'ZW004';
    end if;
  end if;

  update public.memberships set role = p_role where id = v_row.id;
  select lower(email) into v_email from auth.users where id = v_row.user_id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_org, 'membership', v_row.id, 'membership_role_changed', auth.uid(),
          jsonb_build_object('role', v_row.role), jsonb_build_object('role', p_role, 'email', v_email));

  v_result.role := p_role;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.change_membership_role(uuid, text) is
  'Organization Admin of the target Membership''s own organization only (foreign/nonexistent id -> ZW002). Sets a STAFF Membership to organization_admin or dispatcher (anything else, or a Driver Membership -> ZW006). Refuses to demote the last active Organization Admin (ZW004 last_admin), serialized per organization so two simultaneous demotions cannot both succeed. Audited as membership_role_changed.';

revoke all on function public.change_membership_role(uuid, text) from public;
grant execute on function public.change_membership_role(uuid, text) to authenticated;

create or replace function public.set_membership_status(p_membership_id uuid, p_active boolean)
returns public.membership_change_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_row public.memberships%rowtype;
  v_admins int;
  v_email text;
  v_new text;
  v_result public.membership_change_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select organization_id into v_org from public.memberships where id = p_membership_id;
  if p_membership_id is null or v_org is null or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_active is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  perform public._lock_org_admins(v_org);

  -- Re-authorize AFTER the lock: an Admin demoted or deactivated by a
  -- concurrent transaction while this one waited must not complete one more
  -- administrative action on the strength of a check made before the wait.
  if not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_row from public.memberships where id = p_membership_id for update;

  if v_row.role not in ('organization_admin', 'dispatcher') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_new := case when p_active then 'active' else 'inactive' end;
  v_result.membership_id := v_row.id;
  v_result.role := v_row.role;

  if v_row.status = v_new then
    v_result.status := v_row.status;
    v_result.changed := false;
    return v_result;
  end if;

  if not p_active and v_row.role = 'organization_admin' then
    select count(*) into v_admins from public.memberships
    where organization_id = v_org and role = 'organization_admin' and status = 'active';
    if v_admins <= 1 then
      raise exception 'last_admin' using errcode = 'ZW004';
    end if;
  end if;

  update public.memberships set status = v_new where id = v_row.id;
  select lower(email) into v_email from auth.users where id = v_row.user_id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_org, 'membership', v_row.id,
          case when p_active then 'membership_reactivated' else 'membership_deactivated' end, auth.uid(),
          jsonb_build_object('status', v_row.status),
          jsonb_build_object('status', v_new, 'role', v_row.role, 'email', v_email));

  v_result.status := v_new;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.set_membership_status(uuid, boolean) is
  'Organization Admin of the target Membership''s own organization only. Deactivates (status inactive: zero access, live-checked by every RLS helper) or reactivates a STAFF Membership; history is never deleted. Refuses to deactivate the last active Organization Admin (ZW004 last_admin), serialized per organization. Audited as membership_deactivated / membership_reactivated.';

revoke all on function public.set_membership_status(uuid, boolean) from public;
grant execute on function public.set_membership_status(uuid, boolean) to authenticated;

-- ---- memberships is no longer directly writable by any client role -----------
drop policy if exists memberships_insert_org_admin on public.memberships;
drop policy if exists memberships_update_org_admin on public.memberships;
revoke insert, update, delete, truncate on public.memberships from authenticated, anon;

-- =============================================================================
-- B. SERVICE OFFERINGS
-- =============================================================================
-- Platform capability (the canonical service types Nemryn understands, the
-- same list transportation_requests_service_type_check and the public intake
-- function already use) is distinct from TENANT OFFERING (which of them this
-- organization provides). Only enabled canonical identifiers are stored --
-- never labels. An organization with zero rows has never configured its
-- offerings; the setter guarantees >= 1 row afterwards, so "has rows" ==
-- "explicitly configured".
create table public.organization_service_offerings (
  organization_id uuid not null references public.organizations (id),
  service_type text not null check (
    service_type in (
      'medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
      'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other'
    )
  ),
  created_at timestamptz not null default now(),
  primary key (organization_id, service_type)
);

comment on table public.organization_service_offerings is
  'TENANT-OWNED. One row per canonical service type an organization has ENABLED. No rows = never configured (public intake keeps its pre-R4C behavior); >= 1 row = authoritative (public intake accepts only these). RLS on, no policy, no grant: read/written only through get_/set_organization_service_offerings and the public-intake function.';

alter table public.organization_service_offerings enable row level security;
revoke all on public.organization_service_offerings from anon, authenticated;

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
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select coalesce(array_agg(service_type order by service_type), array[]::text[]) into v_out
  from public.organization_service_offerings where organization_id = p_organization_id;
  return v_out;
end;
$$;

comment on function public.get_organization_service_offerings(uuid) is
  'Organization Admin of p_organization_id only. The enabled canonical service types; an empty array means never configured.';

revoke all on function public.get_organization_service_offerings(uuid) from public;
grant execute on function public.get_organization_service_offerings(uuid) to authenticated;

create type public.organization_service_offerings_result as (
  organization_id uuid,
  first_configuration boolean,
  changed boolean
);

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
          'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other')) then
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

comment on function public.set_organization_service_offerings(uuid, text[]) is
  'Organization Admin of p_organization_id only. Replaces the organization''s enabled canonical service types with the given set (distinct; each must be canonical; at least one -> else ZW006). The first save is audited organization_services_configured, later ones organization_service_offerings_updated, each with before/after lists. Identical save = no-op. Affects only NEW website intake; historical Requests are untouched.';

revoke all on function public.set_organization_service_offerings(uuid, text[]) from public;
grant execute on function public.set_organization_service_offerings(uuid, text[]) to authenticated;

-- Tenant-specific service validation in the (frozen-contract) public intake
-- function. Same signature, same grants, same everything else.
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
  end if;

  v_result.accepted := true;
  return v_result;
end;
$$;

comment on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean, text
) is
  'SERVER-ONLY (service_role). The sole path by which a Request can be created via public tenant-website intake -- reachable ONLY through the Nemryn-owned Route Handler. No organization_id parameter: the organization is resolved entirely from p_integration_external_id. state always pending, source always web; no passenger_id, no Trip. Idempotent per (integration, idempotency key). R4C: when the resolved organization has explicitly configured service offerings (organization_service_offerings has rows), a supplied p_service_type that the tenant has not enabled is rejected with the same generic invalid_input; organizations with no configuration behave exactly as before, and an omitted service type is unaffected. Every rejection is the identical invalid_input (ZW006) -- no existence oracle.';

revoke all on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean, text
) from public, anon, authenticated;
grant execute on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text,
  text, text[], date, date, time, boolean, text
) to service_role;

-- =============================================================================
-- C. OPERATING SCHEDULE
-- =============================================================================
-- One weekly window shared by the selected operating days, interpreted in the
-- organization's own timezone (organizations.timezone -- the single source).
-- All three columns null = not configured. Same-day windows only (opens <
-- closes); no holidays, shifts or split hours. Informational preference: no
-- Request or Trip is ever rejected because of it.
alter table public.organizations
  add column operating_days smallint[],
  add column operating_opens_at time,
  add column operating_closes_at time;

alter table public.organizations
  add constraint organizations_operating_schedule_atomic
    check (
      (operating_days is null and operating_opens_at is null and operating_closes_at is null)
      or (operating_days is not null and operating_opens_at is not null and operating_closes_at is not null)
    ),
  add constraint organizations_operating_days_canonical
    check (operating_days is null or public._is_canonical_days_of_week(operating_days)),
  add constraint organizations_operating_window_ordered
    check (operating_opens_at is null or operating_opens_at < operating_closes_at);

comment on column public.organizations.operating_days is
  'ISO weekday numbers (1=Monday..7=Sunday, ascending, distinct) the organization operates. NULL with the two time columns = not configured. Informational (P1-PILOT-S4B-R4C): shown on Operations Overview; nothing is rejected or blocked because of it. Interpreted in organizations.timezone. Written only by update_organization_operating_schedule.';
comment on column public.organizations.operating_opens_at is
  'Opening wall-clock time on each operating day, in organizations.timezone. Paired with operating_closes_at (opens < closes).';
comment on column public.organizations.operating_closes_at is
  'Closing wall-clock time on each operating day, in organizations.timezone.';

create type public.organization_operating_schedule_result as (
  organization_id uuid,
  changed boolean
);

create or replace function public.update_organization_operating_schedule(
  p_organization_id uuid,
  p_days smallint[],
  p_opens_at time,
  p_closes_at time
)
returns public.organization_operating_schedule_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.organizations%rowtype;
  v_clear boolean;
  v_result public.organization_operating_schedule_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- All three null clears the schedule; otherwise all three are required.
  v_clear := p_days is null and p_opens_at is null and p_closes_at is null;
  if not v_clear then
    if p_days is null or p_opens_at is null or p_closes_at is null
       or not public._is_canonical_days_of_week(p_days)
       or p_opens_at >= p_closes_at then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  select * into v_before from public.organizations where id = p_organization_id for update;

  v_result.organization_id := p_organization_id;
  if v_before.operating_days is not distinct from p_days
     and v_before.operating_opens_at is not distinct from p_opens_at
     and v_before.operating_closes_at is not distinct from p_closes_at then
    v_result.changed := false;
    return v_result;
  end if;

  update public.organizations
  set operating_days = p_days, operating_opens_at = p_opens_at, operating_closes_at = p_closes_at
  where id = p_organization_id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'organization', p_organization_id, 'organization_operating_schedule_updated', auth.uid(),
          jsonb_build_object('days', to_jsonb(v_before.operating_days), 'opens_at', v_before.operating_opens_at, 'closes_at', v_before.operating_closes_at),
          jsonb_build_object('days', to_jsonb(p_days), 'opens_at', p_opens_at, 'closes_at', p_closes_at));

  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.update_organization_operating_schedule(uuid, smallint[], time, time) is
  'Organization Admin of p_organization_id only. Sets (or, with all three null, clears) the weekly operating schedule: canonical ISO days + opens < closes, interpreted in the organization''s timezone. Informational only. Audited as organization_operating_schedule_updated (before/after).';

revoke all on function public.update_organization_operating_schedule(uuid, smallint[], time, time) from public;
grant execute on function public.update_organization_operating_schedule(uuid, smallint[], time, time) to authenticated;

-- =============================================================================
-- D. R4A DIRECT-WRITE GAPS
-- =============================================================================
-- update_organization_settings now also owns business_stage and
-- service_area_description (validated, audited, admin-only), so the only
-- remaining direct column grants on organizations can go. After this,
-- `authenticated` holds NO UPDATE privilege on organizations at all and
-- there is exactly one way to write each setting.
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
  v_allowed constant text[] := array['name', 'timezone', 'business_phone', 'business_email', 'business_address', 'primary_contact_name', 'business_stage', 'service_area_description'];
  v_key text;
  v_value jsonb;
  v_before public.organizations%rowtype;
  v_name text;
  v_timezone text;
  v_phone text;
  v_email text;
  v_address text;
  v_contact text;
  v_stage text;
  v_service_area text;
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
  v_stage := v_before.business_stage;
  v_service_area := v_before.service_area_description;

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

  if p_changes ? 'business_stage' then
    v_stage := nullif(btrim(p_changes ->> 'business_stage'), '');
    if v_stage is not null and v_stage not in ('starting', 'growing', 'established') then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  if p_changes ? 'service_area_description' then
    v_service_area := nullif(btrim(p_changes ->> 'service_area_description'), '');
    if v_service_area is not null and length(v_service_area) > 1000 then
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

  if v_stage is distinct from v_before.business_stage then
    v_before_data := v_before_data || jsonb_build_object('business_stage', v_before.business_stage);
    v_after_data := v_after_data || jsonb_build_object('business_stage', v_stage);
  end if;
  if v_service_area is distinct from v_before.service_area_description then
    v_before_data := v_before_data || jsonb_build_object('service_area_description', v_before.service_area_description);
    v_after_data := v_after_data || jsonb_build_object('service_area_description', v_service_area);
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
      primary_contact_name = v_contact,
      business_stage = v_stage,
      service_area_description = v_service_area
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
  'Organization Admin of p_organization_id only (has_org_role; Dispatcher, Driver, inactive Membership, foreign or nonexistent organization all get ZW002). The sole path that changes organizations.name / timezone / business_phone / business_email / business_address / primary_contact_name / business_stage / service_area_description. p_changes is a jsonb patch of only those keys; unknown keys are rejected (ZW006). Validates, locks the row, writes an organization_settings_updated AuditEvent with changed-field before/after in the same transaction; a no-op submission writes nothing. (R4C: business_stage and service_area_description added; organization status is intentionally NOT writable through any client path.)';

revoke all on function public.update_organization_settings(uuid, jsonb) from public;
grant execute on function public.update_organization_settings(uuid, jsonb) to authenticated;

revoke update on public.organizations from authenticated, anon;
