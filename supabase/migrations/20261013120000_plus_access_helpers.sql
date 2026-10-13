-- NP-P1-S2 -- Nemryn Plus access helpers (database).
-- Spec: docs/security/plus-access-model.md section 3.1 (NP-P1-S2 slice); ZD-207 (entitlement states), ZD-206.
--
-- WHAT (functions only -- no table, no policy, no grant on any existing object, no Core change):
--   plus_can_read(org)              authenticated  -- may the CALLER read this organization's Plus data?
--   plus_can_write(org)             authenticated  -- may the CALLER change this organization's Plus data?
--   _require_plus_write(org)        owner-only     -- guard for future Plus write RPCs (ZW002 / ZW001)
--   _require_plus_admin_write(org)  owner-only     -- guard for Admin-only Plus settings (inquiry form, grants)
--
-- RULES (NP-P1-S2: Organization Admin only; named-staff grants are NP-P1-S3, which replaces these bodies):
--   plus_can_read  = caller is Organization Admin of an ACTIVE organization with an ACTIVE membership
--                    (has_org_role) AND the effective entitlement is write or read_only.
--                    locked and none never read; Dispatchers, Drivers, inactive members, suspended organizations,
--                    foreign tenants and a bare PlatformAdminGrant never read.
--   plus_can_write = the same caller rule AND the effective entitlement is write (running trial / active period).
--                    read_only never writes.
--   _require_plus_write: ZW002 when the caller cannot even read (no oracle: not entitled, foreign tenant, wrong role,
--                    locked); ZW001 when the caller can read but not write (read_only).
--   _require_plus_admin_write: as above, and the caller must be Organization Admin (identical in S2; diverges once
--                    S3 grants let non-admins write).
-- These helpers never raise for the boolean forms and never reveal another tenant's entitlement (false for every
-- caller without a relationship). No Core function calls them, so no Core workflow depends on Plus.
-- Platform Admin actions stay on the separate _require_platform_admin path (NP-P1-S1); a PlatformAdminGrant does
-- NOT satisfy these helpers.

create function public.plus_can_read(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_organization_id is not null
     and public.has_org_role(p_organization_id, array['organization_admin'])
     and public._plus_entitlement_state(p_organization_id) in ('write', 'read_only');
$$;
comment on function public.plus_can_read(uuid) is
  'NP-P1-S2. True iff the caller is Organization Admin of the (active) organization with an active membership AND its Nemryn Plus effective state is write or read_only. Never true for locked / none, any other role, inactive members, suspended organizations, foreign tenants or a bare PlatformAdminGrant. Never raises. Intended for RLS on future plus_* tables (S3 adds named-staff grants).';
revoke all on function public.plus_can_read(uuid) from public, anon;
grant execute on function public.plus_can_read(uuid) to authenticated;

create function public.plus_can_write(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_organization_id is not null
     and public.has_org_role(p_organization_id, array['organization_admin'])
     and public._plus_entitlement_state(p_organization_id) = 'write';
$$;
comment on function public.plus_can_write(uuid) is
  'NP-P1-S2. True iff the caller is Organization Admin of the (active) organization with an active membership AND its Nemryn Plus effective state is write (running trial or active period). read_only, locked and none never write. Never raises.';
revoke all on function public.plus_can_write(uuid) from public, anon;
grant execute on function public.plus_can_write(uuid) to authenticated;

create function public._require_plus_write(p_organization_id uuid)
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
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if not public.plus_can_write(p_organization_id) then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
end;
$$;
comment on function public._require_plus_write(uuid) is
  'NP-P1-S2. INTERNAL guard (owner-only; no client EXECUTE) for future Plus write RPCs: ZW001 without a uid; ZW002 when the caller cannot read the organization''s Plus data (no oracle); ZW001 when readable but not writable (read_only).';
revoke all on function public._require_plus_write(uuid) from public, anon, authenticated, service_role;

create function public._require_plus_admin_write(p_organization_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_plus_write(p_organization_id);
  if not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
end;
$$;
comment on function public._require_plus_admin_write(uuid) is
  'NP-P1-S2. INTERNAL guard (owner-only) for Admin-only Plus settings (e.g. publishing the inquiry form, managing named-staff grants): _require_plus_write AND Organization Admin. Identical to _require_plus_write while only Admins hold Plus (S2); diverges when S3 grants let other members write.';
revoke all on function public._require_plus_admin_write(uuid) from public, anon, authenticated, service_role;
