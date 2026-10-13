-- NP-P1-S1 -- Nemryn Plus entitlement foundation.
-- Spec: docs/product/NP-P1-S1-entitlement-implementation-brief.md (refined NP-P0-A02R + S1 corrections),
-- docs/product/plus-domain-model.md section 4, docs/security/plus-access-model.md section 3.
--
-- WHAT
--   1. public.organization_modules -- one row per (organization, module); module = 'plus' only. Platform-owned.
--   2. _plus_entitlement_state(uuid)              owner-only: the EFFECTIVE state none | write | read_only | locked.
--   3. plus_access_state(uuid)                    authenticated: the caller's own view (Organization Admin only;
--                                                 everyone else gets 'none' -- never an error, no oracle).
--   4. platform_set_organization_module(...)      Platform Admin: start trial / activate / expire / cancel / disable.
--   5. platform_extend_plus_trial(...)            Platform Admin: one trial extension.
--   6. platform_get_organization_module(...)      Platform Admin: stored row + effective state.
--
-- CORE ISOLATION (non-negotiable): no Core table, function, policy or grant is created, replaced or altered here.
-- organizations.status is never read or written by these functions except the existence lookup / row lock that
-- serializes concurrent entitlement changes. No Core function references organization_modules, so no Plus state can
-- affect Requests, dispatch, Trips, Drivers, Recurring Care, Proof of Service or public intake. Suspension
-- (organizations.status) still overrides Plus because plus_access_state builds on has_org_role.
--
-- TRIAL RULES (PD-17, working requirement pending formal approval)
--   * default 14 days, 7..30 allowed; trial_ends_at = now() + days;
--   * one trial per organization: trial_started_at is set on the first trial and never cleared. Starting a trial when
--     trial_started_at is already set is refused (ZW004) -- this covers both "restart a running trial" and "grant a
--     second trial later". A regrant needs a separately approved procedure (not implemented);
--   * one extension of 1..30 days through platform_extend_plus_trial (trial_extension_count 0 -> 1).
--
-- PRIVILEGES (P1-SEC-01 contract): table class A (no client or service_role privilege); _plus_entitlement_state has no
-- client EXECUTE; the four callable functions are EXECUTE for authenticated only and re-check authority inside.

-- =============================================================================
-- 1. organization_modules
-- =============================================================================
create table public.organization_modules (
  organization_id uuid not null references public.organizations (id),
  module text not null,
  status text not null,
  restriction text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_extension_count smallint not null default 0,
  access_ends_at timestamptz,
  status_reason text not null,
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, module),
  constraint organization_modules_module_check check (module in ('plus')),
  constraint organization_modules_status_check check (status in ('trial', 'active', 'expired', 'cancelled', 'disabled')),
  constraint organization_modules_restriction_check check (
    (status = 'disabled' and restriction in ('read_only', 'no_access'))
    or (status <> 'disabled' and restriction is null)
  ),
  -- trial dates exist together and stay as history after the trial ends (one-trial rule)
  constraint organization_modules_trial_dates_check check (
    (trial_started_at is null) = (trial_ends_at is null)
    and (trial_ends_at is null or trial_ends_at > trial_started_at)
  ),
  constraint organization_modules_trial_check check (status <> 'trial' or trial_ends_at is not null),
  constraint organization_modules_trial_extension_check check (
    trial_extension_count between 0 and 1 and (trial_extension_count = 0 or trial_started_at is not null)
  ),
  -- access_ends_at only bounds an 'active' period
  constraint organization_modules_access_ends_check check (status = 'active' or access_ends_at is null),
  constraint organization_modules_status_reason_check check (
    length(status_reason) between 3 and 500 and btrim(status_reason) = status_reason
  )
);

comment on table public.organization_modules is
  'PLATFORM-OWNED Nemryn Plus entitlement (NP-P1-S1, PD-02). Separate from organizations.status by design and never read by any Core function, so no state here can affect Core operations. RLS on, no policy, no client or service_role privilege (privilege-contract class A): written only by platform_set_organization_module / platform_extend_plus_trial, read only through plus_access_state and platform_get_organization_module. Rows are never deleted.';
comment on column public.organization_modules.restriction is
  'Only for status = disabled: read_only (writes frozen; Organization Admin keeps history read / export) or no_access (security restriction: effective state locked, no tenant read). NULL otherwise.';
comment on column public.organization_modules.trial_started_at is
  'Set when the organization''s single trial starts; never cleared (with trial_ends_at, kept as history after the trial ends). A non-null value refuses any further trial start.';
comment on column public.organization_modules.access_ends_at is
  'Optional end of an active (paid / comped) period. After it passes the effective state is read_only. Only allowed while status = active.';
comment on column public.organization_modules.status_reason is
  'Nemryn-internal reason for the latest change (3-500 chars). Never shown to the organization.';

create trigger organization_modules_set_updated_at
  before update on public.organization_modules
  for each row execute function public.set_updated_at();

create trigger organization_modules_prevent_org_change
  before update on public.organization_modules
  for each row execute function public.prevent_organization_id_change();

alter table public.organization_modules enable row level security;
revoke all on table public.organization_modules from public, anon, authenticated, service_role;

-- =============================================================================
-- 2. Result types
-- =============================================================================
create type public.plus_access_state_result as (
  state text,
  trial_ends_at timestamptz
);
comment on type public.plus_access_state_result is
  'Return shape of plus_access_state: the CALLER''s effective Plus state (none | write | read_only | locked) and, while trialling, the trial end. Nothing else (no status reason, no actor).';

create type public.platform_organization_module_result as (
  organization_id uuid,
  module text,
  status text,
  restriction text,
  trial_ends_at timestamptz,
  trial_extension_count smallint,
  access_ends_at timestamptz,
  effective_state text,
  changed boolean
);
comment on type public.platform_organization_module_result is
  'Return shape of platform_set_organization_module / platform_extend_plus_trial. changed = false means an idempotent no-op (no write, no audit).';

create type public.platform_organization_module_state as (
  organization_id uuid,
  module text,
  provisioned boolean,
  status text,
  restriction text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_extension_count smallint,
  access_ends_at timestamptz,
  effective_state text,
  status_reason text,
  updated_at timestamptz
);
comment on type public.platform_organization_module_state is
  'Return shape of platform_get_organization_module (Platform Admin read model). provisioned = false means no row: Core only.';

-- =============================================================================
-- 3. _plus_entitlement_state -- owner-only, no caller check
-- =============================================================================
create function public._plus_entitlement_state(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when m.organization_id is null then 'none'
    when m.status = 'trial' and now() < m.trial_ends_at then 'write'
    when m.status = 'active' and (m.access_ends_at is null or now() < m.access_ends_at) then 'write'
    when m.status = 'disabled' and m.restriction = 'no_access' then 'locked'
    else 'read_only'
  end
  from (select 1) as one
  left join public.organization_modules m
    on m.organization_id = p_organization_id and m.module = 'plus';
$$;
comment on function public._plus_entitlement_state(uuid) is
  'NP-P1-S1. INTERNAL (owner-only; no client EXECUTE). Effective Nemryn Plus state of an organization, evaluated at read time (no scheduler): write = running trial or active period; locked = disabled with restriction no_access; read_only = any other existing row (elapsed trial or period, expired, cancelled, disabled + read_only); none = no row. No caller check -- every caller-facing function wraps it with its own authority check.';
revoke all on function public._plus_entitlement_state(uuid) from public, anon, authenticated, service_role;

-- =============================================================================
-- 4. plus_access_state -- the caller's own view
-- =============================================================================
create function public.plus_access_state(p_organization_id uuid)
returns public.plus_access_state_result
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result public.plus_access_state_result;
begin
  v_result.state := 'none';
  v_result.trial_ends_at := null;

  -- NP-P1-S1: Organization Admin of an ACTIVE organization with an ACTIVE membership only (has_org_role checks all
  -- three live). Dispatchers, Drivers, inactive members, suspended organizations, foreign tenants, a bare
  -- PlatformAdminGrant and anon all get 'none' -- never an error, so nothing about another tenant can be learned.
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    return v_result;
  end if;

  v_result.state := public._plus_entitlement_state(p_organization_id);
  if v_result.state = 'write' then
    select m.trial_ends_at into v_result.trial_ends_at
    from public.organization_modules m
    where m.organization_id = p_organization_id and m.module = 'plus' and m.status = 'trial';
  end if;
  return v_result;
end;
$$;
comment on function public.plus_access_state(uuid) is
  'NP-P1-S1. Authenticated. The caller''s effective Nemryn Plus state for p_organization_id: write | read_only | locked for an Organization Admin of that active organization (with trial_ends_at while a trial runs); none for every other caller (Dispatcher, Driver, inactive member, suspended organization, foreign tenant, Platform Admin without membership, anon). Never raises for an unauthorized caller. Server guard: src/lib/plus/access.ts.';
revoke all on function public.plus_access_state(uuid) from public, anon;
grant execute on function public.plus_access_state(uuid) to authenticated;

-- =============================================================================
-- 5. platform_set_organization_module
-- =============================================================================
create function public.platform_set_organization_module(
  p_organization_id uuid,
  p_module text,
  p_status text,
  p_trial_days integer,
  p_access_ends_at timestamptz,
  p_restriction text,
  p_reason text
)
returns public.platform_organization_module_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_trial_default_days constant integer := 14;  -- PLUS_TRIAL_DEFAULT_DAYS (PD-17)
  v_reason text := nullif(btrim(p_reason), '');
  v_days integer;
  v_old public.organization_modules%rowtype;
  v_found boolean;
  v_new public.organization_modules%rowtype;
  v_result public.platform_organization_module_result;
begin
  perform public._require_platform_admin();

  -- ---- input validation (ZW006) ------------------------------------------------
  if p_module is distinct from 'plus' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_status is null or p_status not in ('trial', 'active', 'expired', 'cancelled', 'disabled') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_status = 'trial' then
    v_days := coalesce(p_trial_days, c_trial_default_days);
    if v_days < 7 or v_days > 30 or p_access_ends_at is not null or p_restriction is not null then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  else
    if p_trial_days is not null then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    if p_status = 'active' then
      if p_restriction is not null or (p_access_ends_at is not null and p_access_ends_at <= now()) then
        raise exception 'invalid_input' using errcode = 'ZW006';
      end if;
    elsif p_status = 'disabled' then
      if p_restriction is null or p_restriction not in ('read_only', 'no_access') or p_access_ends_at is not null then
        raise exception 'invalid_input' using errcode = 'ZW006';
      end if;
    else -- expired | cancelled
      if p_restriction is not null or p_access_ends_at is not null then
        raise exception 'invalid_input' using errcode = 'ZW006';
      end if;
    end if;
  end if;

  -- ---- organization: must exist (any organizations.status); its row lock serializes every entitlement change ----
  if p_organization_id is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  perform 1 from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_old from public.organization_modules
  where organization_id = p_organization_id and module = p_module
  for update;
  v_found := found;

  -- ---- transition rules (ZW004) ----------------------------------------------------
  if p_status = 'trial' then
    -- One trial per organization: never restart a running trial, never grant a second one later.
    if v_found and v_old.trial_started_at is not null then
      raise exception 'illegal_transition' using errcode = 'ZW004';
    end if;
  elsif not v_found and p_status in ('expired', 'cancelled', 'disabled') then
    -- Nothing to end or restrict: an organization without Plus stays Core-only (no read_only row is created).
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- ---- idempotent no-op (no write, no audit) ------------------------------------------
  if v_found and p_status <> 'trial'
     and v_old.status = p_status
     and v_old.restriction is not distinct from p_restriction
     and v_old.access_ends_at is not distinct from p_access_ends_at then
    v_result.organization_id := v_old.organization_id;
    v_result.module := v_old.module;
    v_result.status := v_old.status;
    v_result.restriction := v_old.restriction;
    v_result.trial_ends_at := v_old.trial_ends_at;
    v_result.trial_extension_count := v_old.trial_extension_count;
    v_result.access_ends_at := v_old.access_ends_at;
    v_result.effective_state := public._plus_entitlement_state(p_organization_id);
    v_result.changed := false;
    return v_result;
  end if;

  -- ---- write -------------------------------------------------------------------------
  if not v_found then
    insert into public.organization_modules (
      organization_id, module, status, restriction, trial_started_at, trial_ends_at, access_ends_at, status_reason, updated_by
    ) values (
      p_organization_id, p_module, p_status, null,
      case when p_status = 'trial' then now() end,
      case when p_status = 'trial' then now() + make_interval(days => v_days) end,
      p_access_ends_at, v_reason, auth.uid()
    )
    returning * into v_new;
  else
    update public.organization_modules
    set status = p_status,
        restriction = p_restriction,
        trial_started_at = case when p_status = 'trial' then now() else trial_started_at end,
        trial_ends_at = case when p_status = 'trial' then now() + make_interval(days => v_days) else trial_ends_at end,
        access_ends_at = p_access_ends_at,
        status_reason = v_reason,
        updated_by = auth.uid()
    where organization_id = p_organization_id and module = p_module
    returning * into v_new;
  end if;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (
    p_organization_id, 'organization_module', p_organization_id, 'platform_plus_access_changed', auth.uid(),
    case when v_found then jsonb_build_object(
      'module', v_old.module, 'status', v_old.status, 'restriction', v_old.restriction,
      'trial_ends_at', v_old.trial_ends_at, 'trial_extension_count', v_old.trial_extension_count,
      'access_ends_at', v_old.access_ends_at) end,
    jsonb_build_object(
      'module', v_new.module, 'status', v_new.status, 'restriction', v_new.restriction,
      'trial_ends_at', v_new.trial_ends_at, 'trial_extension_count', v_new.trial_extension_count,
      'access_ends_at', v_new.access_ends_at),
    v_reason
  );

  v_result.organization_id := v_new.organization_id;
  v_result.module := v_new.module;
  v_result.status := v_new.status;
  v_result.restriction := v_new.restriction;
  v_result.trial_ends_at := v_new.trial_ends_at;
  v_result.trial_extension_count := v_new.trial_extension_count;
  v_result.access_ends_at := v_new.access_ends_at;
  v_result.effective_state := public._plus_entitlement_state(p_organization_id);
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.platform_set_organization_module(uuid, text, text, integer, timestamptz, text, text) is
  'NP-P1-S1. Platform Admin only (PlatformAdminGrant via _require_platform_admin; anyone else ZW002, no uid ZW001). Sets the Nemryn Plus entitlement: trial (p_trial_days NULL = 14, else 7-30; only if this organization never had a trial, else ZW004), active (optional future p_access_ends_at), expired, cancelled, disabled (p_restriction read_only | no_access). Ending / restricting an organization that has no Plus row is ZW004. Reason 3-500 chars. Locks the organization row (serializes concurrent changes); an identical non-trial request is an idempotent no-op (changed = false, no audit). Writes one platform_plus_access_changed AuditEvent per real change. Never touches organizations.status or any Core row.';
revoke all on function public.platform_set_organization_module(uuid, text, text, integer, timestamptz, text, text) from public, anon;
grant execute on function public.platform_set_organization_module(uuid, text, text, integer, timestamptz, text, text) to authenticated;

-- =============================================================================
-- 6. platform_extend_plus_trial
-- =============================================================================
create function public.platform_extend_plus_trial(
  p_organization_id uuid,
  p_extra_days integer,
  p_reason text
)
returns public.platform_organization_module_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_old public.organization_modules%rowtype;
  v_new public.organization_modules%rowtype;
  v_result public.platform_organization_module_result;
begin
  perform public._require_platform_admin();

  if p_extra_days is null or p_extra_days < 1 or p_extra_days > 30 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_organization_id is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  perform 1 from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_old from public.organization_modules
  where organization_id = p_organization_id and module = 'plus'
  for update;
  if not found or v_old.status <> 'trial' or v_old.trial_extension_count >= 1 then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  update public.organization_modules
  set trial_ends_at = greatest(trial_ends_at, now()) + make_interval(days => p_extra_days),
      trial_extension_count = trial_extension_count + 1,
      status_reason = v_reason,
      updated_by = auth.uid()
  where organization_id = p_organization_id and module = 'plus'
  returning * into v_new;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (
    p_organization_id, 'organization_module', p_organization_id, 'platform_plus_access_changed', auth.uid(),
    jsonb_build_object(
      'module', v_old.module, 'status', v_old.status, 'restriction', v_old.restriction,
      'trial_ends_at', v_old.trial_ends_at, 'trial_extension_count', v_old.trial_extension_count,
      'access_ends_at', v_old.access_ends_at),
    jsonb_build_object(
      'module', v_new.module, 'status', v_new.status, 'restriction', v_new.restriction,
      'trial_ends_at', v_new.trial_ends_at, 'trial_extension_count', v_new.trial_extension_count,
      'access_ends_at', v_new.access_ends_at),
    v_reason
  );

  v_result.organization_id := v_new.organization_id;
  v_result.module := v_new.module;
  v_result.status := v_new.status;
  v_result.restriction := v_new.restriction;
  v_result.trial_ends_at := v_new.trial_ends_at;
  v_result.trial_extension_count := v_new.trial_extension_count;
  v_result.access_ends_at := v_new.access_ends_at;
  v_result.effective_state := public._plus_entitlement_state(p_organization_id);
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.platform_extend_plus_trial(uuid, integer, text) is
  'NP-P1-S1. Platform Admin only. Extends a trial ONCE by 1-30 days: trial_ends_at = greatest(trial_ends_at, now()) + days, trial_extension_count 0 -> 1 (also allowed when the trial has just elapsed but is still status trial). Not trialling, no row, or already extended: ZW004. Reason 3-500 chars. Locks the organization row; writes one platform_plus_access_changed AuditEvent.';
revoke all on function public.platform_extend_plus_trial(uuid, integer, text) from public, anon;
grant execute on function public.platform_extend_plus_trial(uuid, integer, text) to authenticated;

-- =============================================================================
-- 7. platform_get_organization_module
-- =============================================================================
create function public.platform_get_organization_module(p_organization_id uuid, p_module text)
returns public.platform_organization_module_state
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.organization_modules%rowtype;
  v_result public.platform_organization_module_state;
begin
  perform public._require_platform_admin();
  if p_module is distinct from 'plus' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_organization_id is null or not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  select * into v_row from public.organization_modules
  where organization_id = p_organization_id and module = p_module;

  v_result.organization_id := p_organization_id;
  v_result.module := p_module;
  v_result.provisioned := found;
  v_result.status := v_row.status;
  v_result.restriction := v_row.restriction;
  v_result.trial_started_at := v_row.trial_started_at;
  v_result.trial_ends_at := v_row.trial_ends_at;
  v_result.trial_extension_count := v_row.trial_extension_count;
  v_result.access_ends_at := v_row.access_ends_at;
  v_result.effective_state := public._plus_entitlement_state(p_organization_id);
  v_result.status_reason := v_row.status_reason;
  v_result.updated_at := v_row.updated_at;
  return v_result;
end;
$$;
comment on function public.platform_get_organization_module(uuid, text) is
  'NP-P1-S1. Platform Admin only. The stored Nemryn Plus entitlement row of one organization (provisioned = false when none) plus its effective state. No tenant content.';
revoke all on function public.platform_get_organization_module(uuid, text) from public, anon;
grant execute on function public.platform_get_organization_module(uuid, text) to authenticated;
