-- =============================================================================
-- NP-FIN-P1G -- Deny-by-default financial-write gate (per organization).
--
-- Approved direction: docs/reports/NP-FIN-P1-release-gate-resolution.txt §4 (D-DATA), ZD-280 / NP-LAUNCH-02.
-- Requires 20261029100000_core_billing_ledger_foundation.sql + 20261029110000_core_billing_ledger_rpcs.sql.
--
--   billing_write_enablements          one row per organization: enabled | disabled, synthetic | live, version.
--                                       NO ROW = DISABLED. Written only by platform_set_billing_write_enablement
--                                       (Platform Admin); an organization can never enable itself.
--   billing_write_enablement_history   append-only history of every change (also direct owner writes).
--   _billing_write_gate()              BEFORE INSERT / UPDATE / DELETE trigger on EVERY financial table. It fires
--                                       first (trigger name "a_billing_write_gate") and refuses the write with ZW004
--                                       billing_not_enabled unless the row's organization is enabled. Because it sits
--                                       on the tables, it covers every path: NP-BILL-P1 RPCs, FIN-P1 RPCs, the
--                                       compatibility wrappers, nested SECURITY DEFINER calls, older application
--                                       builds and direct table writes (table owner included; only a superuser in
--                                       replica mode bypasses triggers).
--   Reads are NOT gated: existing records stay visible and printable while an organization is disabled.
--   Tenants see only whether billing is enabled (billing_write_status); reasons and approval references are
--   Platform-Admin-only (platform_get_billing_write_enablement).
--
-- "live" enablement requires an approval reference to the NP-LAUNCH-02 GO decision (CHECK). Nothing here enables any
-- organization: production enablement is an explicit, separately authorized release step.
-- No existing function, signature, table or policy is changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enablement state
-- -----------------------------------------------------------------------------
create table public.billing_write_enablements (
  organization_id uuid primary key references public.organizations (id),
  status text not null,
  data_class text not null,
  approval_ref text,
  reason text not null,
  version integer not null default 1,
  set_by uuid references auth.users (id),
  set_at timestamptz not null default now(),
  constraint billing_write_enablements_status_check check (status in ('enabled', 'disabled')),
  constraint billing_write_enablements_class_check check (data_class in ('synthetic', 'live')),
  constraint billing_write_enablements_reason_check check (length(btrim(reason)) between 3 and 500),
  constraint billing_write_enablements_version_check check (version >= 1),
  -- live financial use only with the NP-LAUNCH-02 GO decision on record
  constraint billing_write_enablements_live_check check (
    data_class <> 'live' or status <> 'enabled'
    or (approval_ref is not null and approval_ref ~ 'NP-LAUNCH-02' and length(approval_ref) between 12 and 200)
  ),
  constraint billing_write_enablements_approval_ref_check check (approval_ref is null or length(approval_ref) between 1 and 200)
);
comment on table public.billing_write_enablements is
  'NP-FIN-P1G. Deny-by-default financial-write gate: an organization may create or change financial records only while its row says enabled. NO ROW = DISABLED. data_class synthetic (fictional / pilot-simulation data) or live (real customers; requires an approval_ref naming the NP-LAUNCH-02 GO). Written only through platform_set_billing_write_enablement (Platform Admin); every change is versioned and copied to billing_write_enablement_history. Rows are never deleted.';

create table public.billing_write_enablement_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id),
  version integer not null,
  status text not null,
  data_class text not null,
  approval_ref text,
  reason text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  constraint billing_write_enablement_history_version_key unique (organization_id, version)
);
comment on table public.billing_write_enablement_history is
  'NP-FIN-P1G. Append-only history of billing_write_enablements (one row per version; written by trigger, so direct owner changes are recorded too). Never updated or deleted.';

create function public._billing_write_enablement_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'enablement_rows_are_kept' using errcode = 'ZW004';   -- disable instead; the history must stay whole
  end if;
  if tg_op = 'UPDATE' and (new.organization_id is distinct from old.organization_id or new.version <> old.version + 1) then
    raise exception 'stale_state' using errcode = 'ZW003';              -- every change is exactly one new version
  end if;
  if tg_op = 'INSERT' and new.version <> 1 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  insert into public.billing_write_enablement_history (organization_id, version, status, data_class, approval_ref, reason, changed_by)
  values (new.organization_id, new.version, new.status, new.data_class, new.approval_ref, new.reason, auth.uid());
  return new;
end;
$$;
comment on function public._billing_write_enablement_guard() is
  'NP-FIN-P1G. INTERNAL trigger: enablement rows are never deleted; each change is exactly one new version; every version is copied to the append-only history (also for direct owner writes).';
revoke all on function public._billing_write_enablement_guard() from public, anon, authenticated, service_role;
create trigger billing_write_enablements_guard
  before insert or update or delete on public.billing_write_enablements
  for each row execute function public._billing_write_enablement_guard();
create trigger billing_write_enablements_no_truncate
  before truncate on public.billing_write_enablements
  for each statement execute function public._billing_ledger_append_only();

create trigger billing_write_enablement_history_append_only
  before update or delete on public.billing_write_enablement_history
  for each row execute function public._billing_ledger_append_only();
create trigger billing_write_enablement_history_no_truncate
  before truncate on public.billing_write_enablement_history
  for each statement execute function public._billing_ledger_append_only();

-- No client privilege on either table (ZD-286): tenants read only enabled / version / set_at through
-- billing_write_status; the reason, approval_ref, data class, actor and history only through Platform Admin RPCs.
alter table public.billing_write_enablements enable row level security;
revoke all on table public.billing_write_enablements from public, anon, authenticated, service_role;
alter table public.billing_write_enablement_history enable row level security;
revoke all on table public.billing_write_enablement_history from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. The gate
-- -----------------------------------------------------------------------------
create function public._billing_write_enabled(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.billing_write_enablements e where e.organization_id = p_organization_id and e.status = 'enabled');
$$;
comment on function public._billing_write_enabled(uuid) is 'NP-FIN-P1G. INTERNAL. True only when the organization has an enablement row with status enabled (no row = disabled).';
revoke all on function public._billing_write_enabled(uuid) from public, anon, authenticated, service_role;

create function public._billing_require_write_enabled(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  -- FOR SHARE: a concurrent disable (UPDATE ... FOR UPDATE in the platform RPC) waits for this transaction, and a
  -- disable committed first is seen here -- a financial write and a disable can never both succeed out of order.
  select e.status into v_status from public.billing_write_enablements e where e.organization_id = p_organization_id for share;
  if v_status is distinct from 'enabled' then
    raise exception 'billing_not_enabled' using errcode = 'ZW004';
  end if;
end;
$$;
comment on function public._billing_require_write_enabled(uuid) is
  'NP-FIN-P1G. INTERNAL. Raises ZW004 billing_not_enabled unless the organization is enabled for financial writes; share-locks the enablement row so enable / disable and financial writes serialize.';
revoke all on function public._billing_require_write_enabled(uuid) from public, anon, authenticated, service_role;

create function public._billing_write_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public._billing_require_write_enabled(old.organization_id);
    return old;
  end if;
  perform public._billing_require_write_enabled(new.organization_id);
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    perform public._billing_require_write_enabled(old.organization_id);
  end if;
  return new;
end;
$$;
comment on function public._billing_write_gate() is
  'NP-FIN-P1G. INTERNAL BEFORE INSERT / UPDATE / DELETE trigger on every financial table (named a_billing_write_gate so it fires before every other row trigger): refuses the write with ZW004 billing_not_enabled unless the row''s organization is enabled. Covers RPCs, wrappers, nested SECURITY DEFINER calls, older app builds and direct table writes.';
revoke all on function public._billing_write_gate() from public, anon, authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['billing_invoice_counters', 'billing_invoices', 'billing_invoice_trips', 'billing_invoice_lines',
                            'billing_payments', 'billing_receipt_counters', 'billing_receipts', 'billing_allocations',
                            'billing_refunds', 'billing_refund_reversals', 'billing_receipt_reversals', 'billing_assurance_events'] loop
    execute format('create trigger a_billing_write_gate before insert or update or delete on public.%I for each row execute function public._billing_write_gate()', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Platform management + read
-- -----------------------------------------------------------------------------
create type public.billing_write_enablement_result as (
  organization_id uuid,
  status text,
  data_class text,
  version integer,
  changed boolean
);

create function public.platform_set_billing_write_enablement(
  p_organization_id uuid,
  p_status text,
  p_data_class text,
  p_approval_ref text,
  p_reason text,
  p_expected_version integer
)
returns public.billing_write_enablement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.billing_write_enablements%rowtype;
  v_new public.billing_write_enablements%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ref text := nullif(btrim(coalesce(p_approval_ref, '')), '');
  v_result public.billing_write_enablement_result;
begin
  perform public._require_platform_admin();                       -- ZW001 / ZW002: Platform Admins only
  if p_organization_id is null or not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if coalesce(p_status, '') not in ('enabled', 'disabled') or coalesce(p_data_class, '') not in ('synthetic', 'live') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'reason_required' using errcode = 'ZW006';
  end if;
  if p_status = 'enabled' and p_data_class = 'live' and (v_ref is null or v_ref !~ 'NP-LAUNCH-02' or length(v_ref) < 12 or length(v_ref) > 200) then
    raise exception 'live_requires_launch_approval' using errcode = 'ZW006';
  end if;

  select * into v_old from public.billing_write_enablements e where e.organization_id = p_organization_id for update;
  if not found then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'stale_state' using errcode = 'ZW003';
    end if;
    insert into public.billing_write_enablements (organization_id, status, data_class, approval_ref, reason, version, set_by, set_at)
    values (p_organization_id, p_status, p_data_class, v_ref, v_reason, 1, auth.uid(), now())
    returning * into v_new;
  else
    if p_expected_version is distinct from v_old.version then
      raise exception 'stale_state' using errcode = 'ZW003';
    end if;
    if v_old.status = p_status and v_old.data_class = p_data_class and v_old.approval_ref is not distinct from v_ref then
      v_result := (v_old.organization_id, v_old.status, v_old.data_class, v_old.version, false);   -- nothing to change
      return v_result;
    end if;
    update public.billing_write_enablements
       set status = p_status, data_class = p_data_class, approval_ref = v_ref, reason = v_reason,
           version = version + 1, set_by = auth.uid(), set_at = now()
     where organization_id = p_organization_id
    returning * into v_new;
  end if;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (p_organization_id, 'billing_write_enablement', p_organization_id, 'platform_billing_write_enablement_changed', auth.uid(),
    case when v_old.organization_id is null then null else jsonb_build_object('status', v_old.status, 'data_class', v_old.data_class, 'version', v_old.version) end,
    jsonb_build_object('status', v_new.status, 'data_class', v_new.data_class, 'version', v_new.version, 'has_approval_ref', v_new.approval_ref is not null),
    null);
  v_result := (v_new.organization_id, v_new.status, v_new.data_class, v_new.version, true);
  return v_result;
end;
$$;
comment on function public.platform_set_billing_write_enablement(uuid, text, text, text, text, integer) is
  'NP-FIN-P1G. Platform Admin only (ZW001 / ZW002). Enables or disables financial writes for ONE organization: status enabled | disabled, data_class synthetic | live (live + enabled needs an approval reference naming the NP-LAUNCH-02 GO, ZW006 live_requires_launch_approval), reason 3-500, expected_version (0 / null for a new row; ZW003 when stale). Row-locked so changes serialize with in-flight financial writes; versioned; history + audit row. An Organization Admin can never enable their own organization.';
revoke all on function public.platform_set_billing_write_enablement(uuid, text, text, text, text, integer) from public, anon, service_role;
grant execute on function public.platform_set_billing_write_enablement(uuid, text, text, text, text, integer) to authenticated;

create function public.platform_get_billing_write_enablement(p_organization_id uuid)
returns table (organization_id uuid, status text, data_class text, approval_ref text, reason text, version integer,
               set_by uuid, set_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_platform_admin();                       -- ZW001 / ZW002: Platform Admins only
  return query
  select e.organization_id, e.status, e.data_class, e.approval_ref, e.reason, e.version, e.set_by, e.set_at
  from public.billing_write_enablements e where e.organization_id = p_organization_id;
end;
$$;
comment on function public.platform_get_billing_write_enablement(uuid) is
  'NP-FIN-P1G. Platform Admin only (ZW001 / ZW002). The full enablement row of one organization, including the internal reason and approval reference (no row = never enabled). Changes nothing.';
revoke all on function public.platform_get_billing_write_enablement(uuid) from public, anon, service_role;
grant execute on function public.platform_get_billing_write_enablement(uuid) to authenticated;

create function public.billing_write_status(p_organization_id uuid)
returns table (enabled boolean, version integer, set_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._billing_authorize(p_organization_id, 'view');
  return query
  select coalesce(e.status = 'enabled', false), e.version, e.set_at
  from (select 1) one
  left join public.billing_write_enablements e on e.organization_id = p_organization_id;
end;
$$;
comment on function public.billing_write_status(uuid) is
  'NP-FIN-P1G. view. Whether the organization may create or change financial records (no row = false), with the version and time of the last change -- for the Billing UI notice. Never returns the reason, approval reference or data class (ZD-286). Changes nothing.';
revoke all on function public.billing_write_status(uuid) from public, anon, service_role;
grant execute on function public.billing_write_status(uuid) to authenticated;
