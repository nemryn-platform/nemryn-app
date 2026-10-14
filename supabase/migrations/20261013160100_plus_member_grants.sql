-- NP-P1-S3 -- Nemryn Plus named-staff grants (membership_module_grants) and grant-aware access helpers.
--
-- Canonical design: docs/product/plus-domain-model.md section 5; docs/security/plus-access-model.md sections 2-3.
--
-- WHAT
--   1. membership_module_grants: an Organization Admin gives an existing, active Dispatcher explicit Plus `read` or
--      `write` access. History is kept: a change revokes the active row and inserts a new one; a revoke stamps
--      revoked_at / revoked_by. At most one active grant per membership (partial unique index). Class A: RLS on, no
--      policy, no privilege for anon / authenticated / service_role -- read and written only through the RPCs below.
--   2. _plus_member_access(org) (internal): the caller's member-level access -- 'write' for an Organization Admin,
--      otherwise the active grant's access for the caller's ACTIVE dispatcher membership of an ACTIVE organization.
--   3. Replaced (same signatures): plus_can_read, plus_can_write, plus_access_state. _require_plus_write and
--      _require_plus_admin_write keep their S2 bodies -- they are built on plus_can_read / plus_can_write.
--   4. plus_access_state_result gains `access` (none | read | write): the caller's capability. `state` keeps the four
--      effective entitlement states unchanged (the S2 app reads `state` only, so this is compatible).
--   5. RPCs (Organization Admin only, audited): plus_list_member_access, plus_grant_member_access,
--      plus_revoke_member_access.
--
-- EFFECTIVE RULES (access model section 2.1)
--   entitlement write    : Admin read+write; Dispatcher with an active grant: read, or read+write; everyone else none
--   entitlement read_only: Admin read (history) only; grant holders lose access
--   locked / none        : no tenant Plus access for anyone
--   inactive membership, role no longer dispatcher, suspended organization: no access (via has_org_role, live)
--   Driver: never (a grant is refused); Platform Admin without a membership: never.
--   A grant is never deleted when a membership is deactivated or its role changes -- it becomes inert, and is
--   effective again only if the membership is again an active Dispatcher (an Admin can revoke it at any time).
--
-- Core is unchanged: no Core function, policy or privilege is modified; Core functions never call a Plus helper.
-- The only Core schema dependency is the additive memberships (id, organization_id) unique constraint (20261013160000).

-- =============================================================================
-- 1. membership_module_grants
-- =============================================================================
create table public.membership_module_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  membership_id uuid not null,
  module text not null,
  access text not null,
  granted_by uuid not null references auth.users (id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users (id),
  revoked_at timestamptz,
  constraint membership_module_grants_id_organization_id_key unique (id, organization_id),
  -- tenant isolation by structure: a grant can only reference a membership of its own organization
  constraint membership_module_grants_membership_fkey
    foreign key (membership_id, organization_id) references public.memberships (id, organization_id),
  constraint membership_module_grants_module_check check (module in ('plus')),
  constraint membership_module_grants_access_check check (access in ('read', 'write')),
  constraint membership_module_grants_revocation_check check (
    (revoked_at is null) = (revoked_by is null) and (revoked_at is null or revoked_at >= granted_at)
  )
);

comment on table public.membership_module_grants is
  'NP-P1-S3. TENANT-OWNED, class A: RLS on, no policy, no client privilege. Named-staff Nemryn Plus access (read | write) for an ACTIVE dispatcher membership, granted and revoked only by an Organization Admin through plus_grant_member_access / plus_revoke_member_access (audited). Rows are history: never deleted; revoked_at marks the end. Effective only while the membership is an active dispatcher of an active organization AND the Plus entitlement is write.';

-- At most ONE active grant per membership and module (backstop for the RPCs'' own serialization).
create unique index membership_module_grants_one_active_idx
  on public.membership_module_grants (membership_id, module) where revoked_at is null;
create index membership_module_grants_org_active_idx
  on public.membership_module_grants (organization_id, module) where revoked_at is null;

create trigger membership_module_grants_prevent_org_change
  before update on public.membership_module_grants
  for each row execute function public.prevent_organization_id_change();

alter table public.membership_module_grants enable row level security;
revoke all on table public.membership_module_grants from public, anon, authenticated, service_role;

-- =============================================================================
-- 2. _plus_member_access (internal)
-- =============================================================================
create function public._plus_member_access(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_organization_id is null or auth.uid() is null then 'none'
    when public.has_org_role(p_organization_id, array['organization_admin']) then 'write'
    when public.has_org_role(p_organization_id, array['dispatcher']) then coalesce((
      select g.access
      from public.membership_module_grants g
      join public.memberships m on m.id = g.membership_id and m.organization_id = g.organization_id
      where g.organization_id = p_organization_id
        and g.module = 'plus'
        and g.revoked_at is null
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role = 'dispatcher'
    ), 'none')
    else 'none'
  end;
$$;
comment on function public._plus_member_access(uuid) is
  'NP-P1-S3. INTERNAL (no client EXECUTE). The caller''s member-level Plus access for p_organization_id, independent of the entitlement: write for an Organization Admin; for an ACTIVE dispatcher of an ACTIVE organization, the access of their active grant (read | write); none otherwise (no grant, inactive, driver, suspended organization, foreign tenant, Platform Admin without membership, anon). Combine with _plus_entitlement_state for the effective rule.';
revoke all on function public._plus_member_access(uuid) from public, anon, authenticated, service_role;

-- =============================================================================
-- 3. grant-aware plus_can_read / plus_can_write (same signatures as NP-P1-S2)
-- =============================================================================
create or replace function public.plus_can_read(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case public._plus_member_access(p_organization_id)
    when 'none' then false
    else case public._plus_entitlement_state(p_organization_id)
      when 'write' then true
      -- read_only: historical access stays Organization-Admin-only; grant holders lose access
      when 'read_only' then public.has_org_role(p_organization_id, array['organization_admin'])
      else false  -- locked / none
    end
  end;
$$;
comment on function public.plus_can_read(uuid) is
  'NP-P1-S3 (grant-aware; replaces the S2 Admin-only body). True iff the caller may READ tenant Plus data of p_organization_id: entitlement write -> Organization Admin or a dispatcher with an active read/write grant; entitlement read_only -> Organization Admin only; locked / none -> nobody. Inactive memberships, suspended organizations, drivers and Platform Admins without a membership: false. For RLS and RPC guards.';

create or replace function public.plus_can_write(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public._plus_member_access(p_organization_id) = 'write'
     and public._plus_entitlement_state(p_organization_id) = 'write';
$$;
comment on function public.plus_can_write(uuid) is
  'NP-P1-S3 (grant-aware; replaces the S2 Admin-only body). True iff the caller may WRITE tenant Plus data of p_organization_id: entitlement write AND (Organization Admin or a dispatcher with an active write grant).';

comment on function public._require_plus_write(uuid) is
  'NP-P1-S2, grant-aware since NP-P1-S3 through plus_can_read / plus_can_write. INTERNAL. Guard for Plus write RPCs: ZW001 without a uid; ZW002 when the caller cannot read Plus in this organization; ZW001 when they can read but not write (read grant, or read_only entitlement).';
comment on function public._require_plus_admin_write(uuid) is
  'NP-P1-S2. INTERNAL. _require_plus_write plus Organization Admin (ZW002 otherwise): Admin-only Plus settings such as managing named-staff grants. A write-grant dispatcher is refused.';

-- =============================================================================
-- 4. plus_access_state: + caller capability
-- =============================================================================
alter type public.plus_access_state_result add attribute access text;
comment on type public.plus_access_state_result is
  'Return shape of plus_access_state: the CALLER''s effective Plus state (none | write | read_only | locked), the caller''s capability `access` (none | read | write; NP-P1-S3) and, for an Organization Admin while trialling, the trial end. Nothing else (no status reason, no actor, no grant detail).';

create or replace function public.plus_access_state(p_organization_id uuid)
returns public.plus_access_state_result
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result public.plus_access_state_result;
  v_member text;
  v_state text;
begin
  v_result.state := 'none';
  v_result.access := 'none';
  v_result.trial_ends_at := null;

  -- No relationship (anon, foreign tenant, driver, inactive, suspended organization, dispatcher without a grant,
  -- Platform Admin without membership): 'none' -- never an error, nothing about another tenant can be learned.
  v_member := public._plus_member_access(p_organization_id);
  if v_member = 'none' then
    return v_result;
  end if;

  v_state := public._plus_entitlement_state(p_organization_id);

  if public.has_org_role(p_organization_id, array['organization_admin']) then
    -- Organization Admin: sees every state (locked -> "restricted" notice), as in NP-P1-S1.
    v_result.state := v_state;
    v_result.access := case v_state when 'write' then 'write' when 'read_only' then 'read' else 'none' end;
    if v_state = 'write' then
      select m.trial_ends_at into v_result.trial_ends_at
      from public.organization_modules m
      where m.organization_id = p_organization_id and m.module = 'plus' and m.status = 'trial';
    end if;
    return v_result;
  end if;

  -- Grant holder: Plus only while the entitlement is write; read_only / locked / none -> 'none' (no notice either).
  if v_state = 'write' then
    v_result.state := 'write';
    v_result.access := v_member;
  end if;
  return v_result;
end;
$$;
comment on function public.plus_access_state(uuid) is
  'NP-P1-S1, grant-aware since NP-P1-S3. Authenticated. The caller''s effective Nemryn Plus state for p_organization_id and capability: an Organization Admin of the active organization gets write | read_only | locked (with trial_ends_at while a trial runs) and access write | read | none; a dispatcher with an active grant gets state write with access read | write while the entitlement is write, otherwise none; every other caller gets none. Never raises. Server guard: src/lib/plus/access.ts.';

-- =============================================================================
-- 5. Organization Admin RPCs
-- =============================================================================
create type public.plus_member_access_result as (
  membership_id uuid,
  access text,
  grant_id uuid,
  changed boolean
);
comment on type public.plus_member_access_result is
  'NP-P1-S3. Result of plus_grant_member_access / plus_revoke_member_access: the membership, its ACTIVE grant after the call (access + grant_id, both NULL when none) and whether anything changed (false = idempotent no-op, nothing written, no audit).';

-- ---- plus_list_member_access ------------------------------------------------
create function public.plus_list_member_access(p_organization_id uuid)
returns table (
  membership_id uuid,
  display_name text,
  email text,
  role text,
  status text,
  is_self boolean,
  access text,
  grant_id uuid,
  granted_at timestamptz
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
  -- Organization Admin of the organization while Plus is readable for them (write or read_only).
  if p_organization_id is null
     or not public.has_org_role(p_organization_id, array['organization_admin'])
     or not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- STAFF memberships only (Drivers are never eligible and never listed).
  return query
  select m.id, p.display_name, u.email::text, m.role, m.status, (m.user_id = auth.uid()),
         g.access, g.id, g.granted_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.user_profiles p on p.id = m.user_id
  left join public.membership_module_grants g
    on g.membership_id = m.id and g.organization_id = m.organization_id and g.module = 'plus' and g.revoked_at is null
  where m.organization_id = p_organization_id and m.role in ('organization_admin', 'dispatcher')
  order by (m.status = 'active') desc, (m.role = 'organization_admin') desc, m.created_at, m.id;
end;
$$;
comment on function public.plus_list_member_access(uuid) is
  'NP-P1-S3. Organization Admin of p_organization_id only, while Plus is write or read_only (ZW002 otherwise; ZW001 without a uid). Staff memberships (organization_admin, dispatcher) with display name, email, Core role and status, and the ACTIVE Plus grant (access, grant_id, granted_at; NULL when none). Admins need no grant. membership_id and grant_id are opaque management handles.';
revoke all on function public.plus_list_member_access(uuid) from public, anon;
grant execute on function public.plus_list_member_access(uuid) to authenticated;

-- ---- plus_grant_member_access -----------------------------------------------
create function public.plus_grant_member_access(
  p_organization_id uuid,
  p_membership_id uuid,
  p_access text,
  p_expected_grant_id uuid
)
returns public.plus_member_access_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.memberships%rowtype;
  v_grant public.membership_module_grants%rowtype;
  v_found boolean;
  v_new_id uuid;
  v_email text;
  v_result public.plus_member_access_result;
begin
  -- Authority first (no oracle): Organization Admin of the organization AND entitlement write.
  -- ZW001 no uid / read_only entitlement; ZW002 anyone else (dispatcher, driver, foreign, Platform Admin, none, locked).
  perform public._require_plus_admin_write(p_organization_id);

  -- Serialize every grant change for the organization with Core admin / role / status changes (same lock as
  -- change_membership_role / set_membership_status), then RE-AUTHORIZE: an Admin demoted or deactivated while this
  -- call waited, or an entitlement that ended meanwhile, must not complete one more change.
  perform public._lock_org_admins(p_organization_id);
  perform public._require_plus_admin_write(p_organization_id);

  if p_access is null or p_access not in ('read', 'write') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- The membership must belong to THIS organization: a forged, foreign or unknown id -> ZW002 (no oracle).
  select * into v_member from public.memberships
  where id = p_membership_id and organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  -- S3: only an ACTIVE dispatcher can hold a grant. Admins need none; drivers never; inactive members cannot.
  if v_member.role <> 'dispatcher' or v_member.status <> 'active' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_grant from public.membership_module_grants
  where membership_id = v_member.id and organization_id = p_organization_id and module = 'plus' and revoked_at is null
  for update;
  v_found := found;

  v_result.membership_id := v_member.id;

  -- Duplicate submission / already in the requested state: idempotent no-op (nothing written, no audit).
  if v_found and v_grant.access = p_access then
    v_result.access := v_grant.access;
    v_result.grant_id := v_grant.id;
    v_result.changed := false;
    return v_result;
  end if;

  -- Optimistic concurrency: the caller must have seen the CURRENT active grant (NULL = "no active grant").
  if (case when v_found then v_grant.id end) is distinct from p_expected_grant_id then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  -- A change of access keeps history: the old grant is revoked, a new one is inserted.
  if v_found then
    update public.membership_module_grants
    set revoked_at = now(), revoked_by = auth.uid()
    where id = v_grant.id;
  end if;

  insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by)
  values (p_organization_id, v_member.id, 'plus', p_access, auth.uid())
  returning id into v_new_id;

  select lower(email) into v_email from auth.users where id = v_member.user_id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'membership_module_grant', v_new_id, 'plus_member_access_granted', auth.uid(),
    case when v_found then jsonb_build_object('module', 'plus', 'membership_id', v_member.id, 'access', v_grant.access, 'grant_id', v_grant.id) end,
    jsonb_build_object('module', 'plus', 'membership_id', v_member.id, 'access', p_access, 'grant_id', v_new_id, 'email', v_email)
  );

  v_result.access := p_access;
  v_result.grant_id := v_new_id;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_grant_member_access(uuid, uuid, text, uuid) is
  'NP-P1-S3. Organization Admin of p_organization_id only, entitlement write (ZW002 / ZW001 via _require_plus_admin_write, re-checked under the organization admin lock). Gives an ACTIVE dispatcher membership OF THAT ORGANIZATION Plus read | write (foreign / unknown membership ZW002; admin, driver, inactive or bad access ZW006). Same access already active -> changed=false, no write, no audit. Otherwise p_expected_grant_id must equal the current active grant id (NULL when none) or ZW003; a change revokes the old grant and inserts a new one (history kept). Audited as plus_member_access_granted.';
revoke all on function public.plus_grant_member_access(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.plus_grant_member_access(uuid, uuid, text, uuid) to authenticated;

-- ---- plus_revoke_member_access ----------------------------------------------
create function public.plus_revoke_member_access(
  p_organization_id uuid,
  p_membership_id uuid,
  p_expected_grant_id uuid
)
returns public.plus_member_access_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.memberships%rowtype;
  v_grant public.membership_module_grants%rowtype;
  v_email text;
  v_result public.plus_member_access_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  -- Removing access is always allowed to the Organization Admin while Plus is readable for them (write or read_only),
  -- so stale grants can be cleaned up after Plus ends. locked / none / anyone else -> ZW002.
  if p_organization_id is null
     or not public.has_org_role(p_organization_id, array['organization_admin'])
     or not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  perform public._lock_org_admins(p_organization_id);
  if not public.has_org_role(p_organization_id, array['organization_admin'])
     or not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Any staff or former-staff membership OF THIS ORGANIZATION (a grant on a deactivated or re-roled membership can
  -- still be revoked). Forged / foreign / unknown -> ZW002.
  select * into v_member from public.memberships
  where id = p_membership_id and organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_grant from public.membership_module_grants
  where membership_id = v_member.id and organization_id = p_organization_id and module = 'plus' and revoked_at is null
  for update;

  v_result.membership_id := v_member.id;
  v_result.access := null;
  v_result.grant_id := null;

  -- Nothing active (already revoked, e.g. a duplicate submission): idempotent no-op.
  if not found then
    v_result.changed := false;
    return v_result;
  end if;

  if v_grant.id is distinct from p_expected_grant_id then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  update public.membership_module_grants
  set revoked_at = now(), revoked_by = auth.uid()
  where id = v_grant.id;

  select lower(email) into v_email from auth.users where id = v_member.user_id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'membership_module_grant', v_grant.id, 'plus_member_access_revoked', auth.uid(),
    jsonb_build_object('module', 'plus', 'membership_id', v_member.id, 'access', v_grant.access, 'grant_id', v_grant.id),
    jsonb_build_object('module', 'plus', 'membership_id', v_member.id, 'access', null, 'grant_id', v_grant.id, 'email', v_email)
  );

  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_revoke_member_access(uuid, uuid, uuid) is
  'NP-P1-S3. Organization Admin of p_organization_id only, while Plus is write or read_only (ZW002 otherwise; re-checked under the organization admin lock). Revokes the ACTIVE Plus grant of a membership OF THAT ORGANIZATION (foreign / unknown ZW002). No active grant -> changed=false, no write, no audit. Otherwise p_expected_grant_id must equal the active grant id or ZW003. The row is kept (revoked_at / revoked_by). Audited as plus_member_access_revoked.';
revoke all on function public.plus_revoke_member_access(uuid, uuid, uuid) from public, anon;
grant execute on function public.plus_revoke_member_access(uuid, uuid, uuid) to authenticated;
