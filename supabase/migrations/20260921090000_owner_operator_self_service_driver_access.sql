-- P1-PILOT-S5A1 -- Owner-Operator self-service Driver access.
--
-- The canonical primitive already exists: link_self_as_driver (P1-E3-S9). This
-- migration HARDENS and COMPLETES it so the same function can back both the
-- first-run onboarding step and the post-onboarding Settings -> My Access page.
-- No second implementation, no new function, no new table, no new client
-- privilege.
--
-- What the audit found (see docs/reports/p1-pilot-s5a1-*.txt):
--   1. AUTHORIZATION TOO WIDE. Any ACTIVE member (Organization Admin, Dispatcher
--      or Driver) could self-link. The pilot rule is Organization Admin ONLY, so a
--      Dispatcher can never grant themselves Driver operational authority.
--      is_org_member -> has_org_role(organization_admin). has_org_role is
--      Membership-only and requires an ACTIVE organization, so an inactive
--      Membership, a suspended organization, a foreign organization and a
--      PlatformAdminGrant on its own are all denied.
--   2. INACTIVE LINKED DRIVER => DUPLICATE. The only reuse check was
--      status = 'active', so an inactive row for the same person+organization made
--      the function INSERT a second Driver row. It now reactivates the single
--      inactive row instead (audited distinctly), and refuses to guess when there
--      is more than one.
--   3. NO SCHEMA-LEVEL DUPLICATE GUARD. Nothing stopped two ACTIVE Driver rows for
--      the same (organization, auth user) under a race. A partial unique index now
--      makes that impossible, and the function serialises per (organization, user)
--      with a transaction advisory lock so a double-submit is idempotent rather
--      than an error.
--   4. IDENTITY SAFETY. A Driver row is NEVER linked to an auth user because a name
--      or phone looks similar. An unlinked Driver row in the same organization with
--      the same display name is treated as ambiguous: the call fails safely
--      (ZW003 driver_identity_conflict) instead of creating a look-alike second
--      Driver or silently claiming the existing one.
--   5. ACTIVITY. The two self-driver audit actions are added to the Activity
--      whitelist so the Admin sees "Driver access enabled" in Settings -> Activity.
--
-- Unchanged on purpose: Membership.role is never touched; current_driver_id,
-- is_org_member, has_org_role, every Driver RLS policy and every Driver RPC;
-- redeem_driver_invite and the invite flow; the client grants on public.drivers
-- (no client INSERT of user_id, no client UPDATE of user_id).

-- 3. schema-level duplicate guard ------------------------------------------
create unique index if not exists drivers_one_active_link_per_user_org_idx
  on public.drivers (organization_id, user_id)
  where user_id is not null and status = 'active';

comment on index public.drivers_one_active_link_per_user_org_idx is
  'S5A1: at most ONE active Driver row per (organization, auth user). Backstops link_self_as_driver / redeem_driver_invite against a concurrent double-submit. Inactive history rows are unconstrained (a person may have inactive history plus one active row).';

-- 1, 2, 4. the canonical self-link primitive --------------------------------
create or replace function public.link_self_as_driver(
  p_organization_id uuid,
  p_display_name text,
  p_phone text default null
)
returns public.owner_driver_link_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_display_name text;
  v_phone text;
  v_active_id uuid;
  v_inactive_ids uuid[];
  v_new_driver_id uuid;
  v_result public.owner_driver_link_result;
begin
  -- Authorization chain: authenticated -> ACTIVE Membership as Organization
  -- Admin of THIS organization -> the organization itself is active. The only
  -- identity this function ever touches is auth.uid(); there is no parameter that
  -- could target another person. Foreign / nonexistent / inactive-membership /
  -- suspended-organization / Dispatcher / Driver / Platform Admin without a
  -- Membership are all the same ZW002 (no existence oracle).
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_display_name := nullif(btrim(p_display_name), '');
  if v_display_name is null or length(v_display_name) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  v_phone := nullif(btrim(p_phone), '');
  if v_phone is not null and length(v_phone) > 40 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Serialise per (organization, person): a double-click / two tabs / a retry
  -- becomes a clean idempotent second call, never a duplicate or a unique error.
  perform pg_advisory_xact_lock(hashtextextended('self_driver:' || p_organization_id::text || ':' || auth.uid()::text, 0));

  -- A. already linked and ACTIVE -> idempotent re-entry, nothing changes.
  select id into v_active_id
  from public.drivers
  where organization_id = p_organization_id and user_id = auth.uid() and status = 'active'
  order by created_at, id
  limit 1;

  if v_active_id is not null then
    v_result.driver_id := v_active_id;
    v_result.organization_id := p_organization_id;
    v_result.linked := false;
    return v_result;
  end if;

  -- B. linked but INACTIVE -> reactivate that same row (history stays attached to
  --    one Driver id). More than one inactive row for this person is not something
  --    this function will guess about.
  select array_agg(id order by created_at, id) into v_inactive_ids
  from public.drivers
  where organization_id = p_organization_id and user_id = auth.uid() and status = 'inactive';

  if coalesce(cardinality(v_inactive_ids), 0) > 1 then
    raise exception 'driver_identity_conflict' using errcode = 'ZW003';
  end if;

  if coalesce(cardinality(v_inactive_ids), 0) = 1 then
    update public.drivers set status = 'active' where id = v_inactive_ids[1];

    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
    values (
      p_organization_id, 'driver', v_inactive_ids[1], 'driver_self_reactivated', auth.uid(),
      jsonb_build_object('status', 'inactive'), jsonb_build_object('status', 'active')
    );

    v_result.driver_id := v_inactive_ids[1];
    v_result.organization_id := p_organization_id;
    v_result.linked := true;
    return v_result;
  end if;

  -- C. no Driver row for this person. Refuse to create a look-alike beside an
  --    UNLINKED Driver row with the same name: that may be this same human entered
  --    another way, and ownership is not established by a matching name.
  if exists (
    select 1 from public.drivers
    where organization_id = p_organization_id
      and user_id is null
      and lower(btrim(display_name)) = lower(v_display_name)
  ) then
    raise exception 'driver_identity_conflict' using errcode = 'ZW003';
  end if;

  insert into public.drivers (organization_id, user_id, display_name, phone, status)
  values (p_organization_id, auth.uid(), v_display_name, v_phone, 'active')
  returning id into v_new_driver_id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, after_data)
  values (
    p_organization_id, 'driver', v_new_driver_id, 'driver_self_linked', auth.uid(),
    jsonb_build_object('display_name', v_display_name)
  );

  v_result.driver_id := v_new_driver_id;
  v_result.organization_id := p_organization_id;
  v_result.linked := true;
  return v_result;
end;
$$;

comment on function public.link_self_as_driver(uuid, text, text) is
  'Organization Admin of the target organization only (S5A1; previously any active member). Self-service: links the CALLER''s own auth.uid() to a Driver row in that organization and never touches Membership.role. Idempotent: an existing active linked row is returned unchanged; a single inactive linked row is reactivated (audit driver_self_reactivated); otherwise a new row is created (audit driver_self_linked). Fails safely (ZW003 driver_identity_conflict) when more than one inactive row exists for the caller or an UNLINKED Driver with the same name exists. Foreign / inactive-Membership / suspended-organization / Dispatcher / Driver / Platform-Admin-without-Membership: ZW002. Shared by onboarding and Settings -> My Access. See docs/product/owner-operator-mode.md.';

revoke all on function public.link_self_as_driver(uuid, text, text) from public;
grant execute on function public.link_self_as_driver(uuid, text, text) to authenticated;

-- 5. Activity whitelist ------------------------------------------------------
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
    'platform_organization_suspended', 'platform_organization_reactivated',
    'driver_self_linked', 'driver_self_reactivated'
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
  'Organization Admin of p_organization_id only (Dispatcher, Driver, inactive, foreign, Platform Admin without Membership: ZW002). Newest-first page of that organization''s ADMINISTRATIVE audit_events, restricted to a whitelist of actions (operational trip/request audit rows are never returned), keyset-paged by (occurred_at, id). Returns raw before/after only to the server-side projector (src/lib/operations/activity-core.ts), which maps them to human text; nothing raw reaches the browser. The actor is the profile display name (else account email); null actor -> null. R4E: the two platform lifecycle actions are included with the actor shown as "Nemryn" (the platform administrator''s identity and the internal reason are never returned). S5A1: driver_self_linked / driver_self_reactivated (an Organization Admin enabling Driver access for their own account) are included.';

revoke all on function public.list_activity_events(uuid, integer, timestamptz, uuid) from public;
grant execute on function public.list_activity_events(uuid, integer, timestamptz, uuid) to authenticated;
