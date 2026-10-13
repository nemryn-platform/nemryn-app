-- NP-P1-S2-R1 -- Nemryn Plus entitlement: database-enforced optimistic concurrency (EXPAND).
--
-- WHY: NP-P1-S2 made the Platform Admin server action compare the entitlement's updated_at with the version the
-- panel rendered, THEN call platform_set_organization_module / platform_extend_plus_trial. Those S1 functions do not
-- know the expected version, so a change committed by another Platform Admin between the action's check and the
-- function's row lock would be silently overwritten (time-of-check / time-of-use). This migration closes that window
-- in the database.
--
-- WHAT (additive; the S1 functions and their bodies are NOT changed):
--   platform_set_organization_module(... 7 S1 args ..., p_expected_updated_at timestamptz)
--   platform_extend_plus_trial(p_organization_id, p_extra_days, p_reason, p_expected_updated_at timestamptz)
-- Each versioned overload: _require_platform_admin; locks the organization row (the same lock the S1 function takes)
-- and the module row FOR UPDATE; compares updated_at with p_expected_updated_at UNDER THE LOCK (NULL = "expect no
-- entitlement row"); on mismatch raises ZW003 (stale_state) and nothing is written; otherwise calls the unchanged S1
-- function in the same transaction (it re-acquires the locks it already holds), which keeps every S1 rule, the
-- idempotent no-op and the audit event exactly as released.
-- Concurrent callers serialize on the organization row lock: the second waits, then sees the first's committed
-- updated_at and is refused with ZW003 instead of overwriting it.
--
-- EXPAND / CONTRACT: the 7-argument / 3-argument S1 functions stay callable (the production app 7cac187..cea620a
-- calls them during the deploy window). The NP-P1-S2 app calls only the versioned overloads. A later reviewed
-- CONTRACT migration may drop the unversioned signatures once only versioned callers remain. PostgREST resolves the
-- overloads by their distinct named arguments.

create function public.platform_set_organization_module(
  p_organization_id uuid,
  p_module text,
  p_status text,
  p_trial_days integer,
  p_access_ends_at timestamptz,
  p_restriction text,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.platform_organization_module_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current timestamptz;
  v_found boolean;
begin
  perform public._require_platform_admin();
  if p_organization_id is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  perform 1 from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  select m.updated_at into v_current from public.organization_modules m
  where m.organization_id = p_organization_id and m.module = p_module
  for update;
  v_found := found;
  if (v_found and v_current is distinct from p_expected_updated_at) or (not v_found and p_expected_updated_at is not null) then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  return public.platform_set_organization_module(
    p_organization_id, p_module, p_status, p_trial_days, p_access_ends_at, p_restriction, p_reason);
end;
$$;
comment on function public.platform_set_organization_module(uuid, text, text, integer, timestamptz, text, text, timestamptz) is
  'NP-P1-S2-R1. Versioned (optimistic-concurrency) form of platform_set_organization_module for Platform Admins: under the organization + module row locks, the entitlement''s updated_at must equal p_expected_updated_at (NULL = no entitlement row expected), else ZW003 and nothing is written; then the unchanged S1 rules, idempotency and audit apply. Used by the NP-P1-S2 Platform Admin panel.';
revoke all on function public.platform_set_organization_module(uuid, text, text, integer, timestamptz, text, text, timestamptz) from public, anon;
grant execute on function public.platform_set_organization_module(uuid, text, text, integer, timestamptz, text, text, timestamptz) to authenticated;

create function public.platform_extend_plus_trial(
  p_organization_id uuid,
  p_extra_days integer,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.platform_organization_module_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current timestamptz;
  v_found boolean;
begin
  perform public._require_platform_admin();
  if p_organization_id is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  perform 1 from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  select m.updated_at into v_current from public.organization_modules m
  where m.organization_id = p_organization_id and m.module = 'plus'
  for update;
  v_found := found;
  if (v_found and v_current is distinct from p_expected_updated_at) or (not v_found and p_expected_updated_at is not null) then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  return public.platform_extend_plus_trial(p_organization_id, p_extra_days, p_reason);
end;
$$;
comment on function public.platform_extend_plus_trial(uuid, integer, text, timestamptz) is
  'NP-P1-S2-R1. Versioned (optimistic-concurrency) form of platform_extend_plus_trial for Platform Admins: under the organization + module row locks, updated_at must equal p_expected_updated_at, else ZW003 and nothing is written; then the unchanged S1 extension rules and audit apply.';
revoke all on function public.platform_extend_plus_trial(uuid, integer, text, timestamptz) from public, anon;
grant execute on function public.platform_extend_plus_trial(uuid, integer, text, timestamptz) to authenticated;
