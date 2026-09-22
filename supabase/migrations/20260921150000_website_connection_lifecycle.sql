-- =============================================================================
-- P1-COMM-D2A -- Website Connection lifecycle: DELETE unused / RETIRE used (LOCAL ONLY, not applied to production)
-- =============================================================================
-- Product requirement: an operator needs a clean way to start over with a visible integration_type='website'
-- connection, while Nemryn preserves historical provenance for any connection that has actually received a Request.
--
--   UNUSED website connection (zero Requests) -> may be permanently HARD DELETED (delete_unused_request_intake_integration)
--   USED website connection (>=1 Request)     -> hard delete is PERMANENTLY DISALLOWED; may instead be RETIRED
--                                                 (retire_request_intake_integration): is_active=false, retired_at set,
--                                                 the row and every historical Request/attribution/notification/audit
--                                                 entry referencing it are preserved unchanged.
--   TEMPORARILY disabled (existing "Turn off")  -> unchanged: is_active=false, retired_at still null, can Turn on again.
--
-- Three distinct states on ONE existing boolean + one new nullable column (no new enum -- the brief's own preferred
-- "smallest clean model", and this codebase's own established idiom of nullable timestamp "since" columns, e.g.
-- memberships.deactivated_at):
--   ACTIVE               is_active = true,  retired_at = null
--   TEMPORARILY OFF       is_active = false, retired_at = null   (existing Turn off / Turn on, unchanged)
--   RETIRED (terminal)    is_active = false, retired_at IS NOT NULL
--
-- CRITICAL D2 architecture fact (audited fresh, not assumed): request_intake_integrations holds TWO
-- integration_type values. 'website' rows are the ONLY ones ever visible in Settings -> Website Requests
-- (list_request_intake_integrations already filters integration_type = 'website'). 'nemryn_form' rows are a
-- single HIDDEN binding per organization, created and owned EXCLUSIVELY by publish_website_request_form /
-- disable_website_request_form_publication (website_request_form_publications.intake_integration_id) -- no
-- 'nemryn_form' row is ever created, edited or deleted by a website-connection action, and no
-- website_request_form_publications row is EVER bound to a 'website'-type row (publish always creates its own
-- fresh 'nemryn_form' row). The two lifecycles are therefore already structurally independent in the current
-- schema; D2A's only job is to (a) make that independence an explicit, tested invariant of every new/modified
-- function below, and (b) never let a website-connection action reach a 'nemryn_form' row even if a caller somehow
-- obtained its uuid.
--
-- FK audit (real schema, not assumed): the only two FKs INTO request_intake_integrations are
-- transportation_requests(intake_integration_id, organization_id) and
-- website_request_form_publications(intake_integration_id, organization_id), both NO ACTION (never CASCADE) --
-- confirmed structurally impossible for a hard DELETE to cascade-destroy a Request, attribution, Trip, notification
-- or publication; a real dependency makes the DELETE fail outright, which is exactly why "used" is rechecked with a
-- lock immediately before DELETE rather than trusted from an earlier read. request_acquisition_attributions
-- references request_id only (never the integration) and audit_events.entity_id is a bare, FK-free uuid used
-- generically across every entity type in this schema -- deleting an integration row can NEVER orphan an audit
-- row at the database level, and audit evidence intentionally does not require the row to remain (the brief's own
-- preferred rule, confirmed against the real schema rather than assumed).

-- =============================================================================
-- 1. Lifecycle column
-- =============================================================================
alter table public.request_intake_integrations add column retired_at timestamptz;
alter table public.request_intake_integrations
  add constraint request_intake_integrations_retired_implies_inactive check (retired_at is null or is_active = false);

comment on column public.request_intake_integrations.retired_at is
  'P1-COMM-D2A. NULL = active or temporarily off (Turn off/Turn on unaffected). NOT NULL = permanently RETIRED: is_active is forced false and stays false, the row is never reactivated, edited, or reused, and no longer appears in list_request_intake_integrations (the primary/active view) -- only in list_previous_website_connections (history). Set exclusively by retire_request_intake_integration. Applies to integration_type = ''website'' only; a ''nemryn_form'' binding''s lifecycle is owned exclusively by the publication RPCs and this column is never set on one.';

-- A retired connection''s website is no longer "in use" for the duplicate-origin invariant, so a fresh connection
-- may reuse the same address (a genuinely NEW row/external id -- see create_request_intake_integration below).
drop index public.request_intake_integrations_org_origin_uidx;
create unique index request_intake_integrations_org_origin_uidx
  on public.request_intake_integrations (organization_id, (allowed_origins[1]))
  where integration_type = 'website'
    and allowed_origins is not null
    and array_length(allowed_origins, 1) = 1
    and retired_at is null;

-- =============================================================================
-- 2. Result type for the two new lifecycle mutations
-- =============================================================================
create type public.website_connection_lifecycle_result as (
  integration_id uuid,
  external_id text,
  changed boolean
);

-- =============================================================================
-- 3. delete_unused_request_intake_integration -- HARD DELETE, unused only
-- =============================================================================
create function public.delete_unused_request_intake_integration(p_integration_id uuid)
returns public.website_connection_lifecycle_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_row public.request_intake_integrations%rowtype;
  v_result public.website_connection_lifecycle_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  -- Ownership derived from the integration row and authorized against the caller (has_org_role requires an
  -- ACTIVE Membership, Organization Admin role, and an ACTIVE organization -- Dispatcher, Driver, inactive
  -- Membership, a suspended organization and Platform Admin without Membership are ALL the identical ZW002, no
  -- oracle). p_integration_id is never trusted as belonging to the caller''s organization until this check passes;
  -- no organization_id is ever accepted from the browser.
  select organization_id into v_org from public.request_intake_integrations where id = p_integration_id;
  if p_integration_id is null or v_org is null
     or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Same per-organization advisory lock create_request_intake_integration / update_request_intake_integration_origin
  -- already use, so a concurrent create/edit/delete on this organization''s connections fully serialises.
  perform pg_advisory_xact_lock(hashtext('request_intake_integration:' || v_org::text)::bigint);

  -- FOR UPDATE: the authoritative lock. A concurrent public submission takes FOR SHARE on this exact row inside
  -- _create_public_request before it ever inserts a Request -- that acquisition blocks here until this
  -- transaction commits or rolls back, and this transaction''s own eligibility recheck below blocks until any
  -- submission that got the lock FIRST has committed. Either the Request commits first (making the integration
  -- used, so the check below correctly refuses deletion) or this delete commits first (so the submission''s own
  -- FOR SHARE then finds nothing, ZW006) -- an accepted Request referencing a since-deleted integration is
  -- structurally impossible.
  select * into v_row from public.request_intake_integrations where id = p_integration_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- The hidden Nemryn-form binding is never reachable through this tenant-facing lifecycle RPC, regardless of how
  -- a caller obtained its id -- ownership of a 'nemryn_form' row belongs exclusively to the publication RPCs.
  if v_row.integration_type <> 'website' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_row.retired_at is not null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Re-checked HERE, under the row lock, immediately before DELETE -- the ONLY authoritative eligibility check
  -- (an earlier, unlocked read is never trusted). "Unused" = zero TransportationRequests reference it; a
  -- 'website'-type row is, by the current schema''s own construction, never referenced by
  -- website_request_form_publications (publish_website_request_form only ever creates/uses a 'nemryn_form' row),
  -- so no other dependency exists to check.
  if exists (select 1 from public.transportation_requests where intake_integration_id = v_row.id) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  delete from public.request_intake_integrations where id = v_row.id;

  -- No FK references audit_events.entity_id (confirmed above): recording evidence of a now-deleted row is safe.
  -- Metadata is deliberately minimal -- website address and connection-method preference only, never the
  -- Integration ID, any database id, or a secret.
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, after_data)
  values (v_org, 'request_intake_integration', v_row.id, 'website_connection_deleted', auth.uid(),
          jsonb_build_object('website', v_row.allowed_origins[1], 'connection_method', v_row.connection_method));

  v_result.integration_id := v_row.id;
  v_result.external_id := v_row.external_id;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.delete_unused_request_intake_integration(uuid) is
  'Organization Admin of the integration''s own ACTIVE organization only (Dispatcher, Driver, inactive Membership, suspended organization, foreign organization, Platform Admin without Membership: ZW002, no oracle). integration_type must be ''website'' (a ''nemryn_form'' binding: ZW002, indistinguishable from not-found) and retired_at must be null (already retired: ZW006). Re-checks, under a row lock taken immediately before DELETE, that ZERO transportation_requests reference the integration (ZW006 otherwise -- a used connection can never be hard-deleted, only retired). Permanently removes the row; writes website_connection_deleted (website + connection_method only, no Integration ID, no secret). Idempotent-safe under a race: a second concurrent call for the same (now-deleted) id gets the identical not-found ZW002.';
revoke all on function public.delete_unused_request_intake_integration(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_unused_request_intake_integration(uuid) to authenticated;

-- =============================================================================
-- 4. retire_request_intake_integration -- permanent RETIRE, used or unused
-- =============================================================================
create function public.retire_request_intake_integration(p_integration_id uuid)
returns public.website_connection_lifecycle_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_row public.request_intake_integrations%rowtype;
  v_result public.website_connection_lifecycle_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select organization_id into v_org from public.request_intake_integrations where id = p_integration_id;
  if p_integration_id is null or v_org is null
     or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  perform pg_advisory_xact_lock(hashtext('request_intake_integration:' || v_org::text)::bigint);

  -- Same FOR UPDATE serialisation as delete above: either an in-flight submission''s Request commits first (kept,
  -- unaffected -- retiring a used connection is exactly what this function is for) and retirement follows, or this
  -- retirement commits first and a submission racing it then correctly finds retired_at set and is rejected. No
  -- half-committed state either way.
  select * into v_row from public.request_intake_integrations where id = p_integration_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_row.integration_type <> 'website' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_result.integration_id := v_row.id;
  v_result.external_id := v_row.external_id;

  if v_row.retired_at is not null then
    v_result.changed := false;
    return v_result;
  end if;

  update public.request_intake_integrations set is_active = false, retired_at = now() where id = v_row.id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_org, 'request_intake_integration', v_row.id, 'website_connection_retired', auth.uid(),
          jsonb_build_object('is_active', v_row.is_active),
          jsonb_build_object('website', v_row.allowed_origins[1], 'connection_method', v_row.connection_method,
                              'request_count', (select count(*) from public.transportation_requests where intake_integration_id = v_row.id)));

  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.retire_request_intake_integration(uuid) is
  'Organization Admin of the integration''s own ACTIVE organization only (same ZW002 matrix as delete_unused_request_intake_integration). integration_type must be ''website'' (a ''nemryn_form'' binding: ZW002). Permanently retires the connection: is_active=false, retired_at=now(); the row, and every historical Request / S4C attribution / Trip / notification / audit entry that references it, is preserved unchanged -- never deleted. Idempotent (already retired: changed=false, no second audit). Writes website_connection_retired (website, connection_method, a point-in-time request_count -- never the Integration ID or a secret). After this call the connection is immutable through every ordinary tenant RPC (set_request_intake_integration_active, update_request_intake_integration_origin, set_request_intake_integration_setup all reject retired_at IS NOT NULL with ZW006) and disappears from list_request_intake_integrations; it is visible only via list_previous_website_connections.';
revoke all on function public.retire_request_intake_integration(uuid) from public, anon, authenticated, service_role;
grant execute on function public.retire_request_intake_integration(uuid) to authenticated;

-- =============================================================================
-- 5. list_previous_website_connections -- read model for "Previous connections"
-- =============================================================================
create function public.list_previous_website_connections(p_organization_id uuid)
returns table (website text, connection_method text, website_manager text, retired_at timestamptz, request_count bigint)
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
  select i.allowed_origins[1], i.connection_method, i.website_manager, i.retired_at, count(r.id)::bigint
  from public.request_intake_integrations i
  left join public.transportation_requests r on r.intake_integration_id = i.id and r.organization_id = i.organization_id
  where i.organization_id = p_organization_id and i.integration_type = 'website' and i.retired_at is not null
  group by i.id
  order by i.retired_at desc;
end;
$$;

comment on function public.list_previous_website_connections(uuid) is
  'Organization Admin of p_organization_id only (ZW002 otherwise). Returns that organization''s own RETIRED website connections (website address, connection-method preference, retired date, historical request count) for the "Previous connections" history view. Never returns a database id, the Integration ID, a public form key or any technical/credential detail. Never includes a ''nemryn_form'' binding (integration_type = ''website'' only) or a hard-deleted connection (it no longer exists -- nothing to list).';
revoke all on function public.list_previous_website_connections(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_previous_website_connections(uuid) to authenticated;

-- =============================================================================
-- 6. Existing website-connection RPCs: exclude / reject retired rows
-- =============================================================================
-- list_request_intake_integrations: a retired connection leaves the primary/active view (D2A's own new column);
-- everything else about this function (D2''s own integration_type = 'website' filter, the derived counts) is unchanged.
create or replace function public.list_request_intake_integrations(p_organization_id uuid)
returns table (
  id uuid, integration_type text, external_id text, is_active boolean, allowed_origins text[],
  created_at timestamptz, request_count bigint, last_request_received_at timestamptz,
  connection_method text, website_manager text
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

  if p_organization_id is null
     or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  return query
  select i.id, i.integration_type, i.external_id, i.is_active, i.allowed_origins, i.created_at,
         count(r.id)::bigint,
         max(r.created_at),
         i.connection_method, i.website_manager
  from public.request_intake_integrations i
  left join public.transportation_requests r
    on r.intake_integration_id = i.id and r.organization_id = i.organization_id
  where i.organization_id = p_organization_id
    and i.integration_type = 'website'
    and i.retired_at is null
  group by i.id
  order by i.created_at, i.id;
end;
$$;
revoke all on function public.list_request_intake_integrations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_request_intake_integrations(uuid) to authenticated;

-- create_request_intake_integration: a retired row never satisfies the idempotent-origin match (so the SAME
-- website address can be reconnected as a genuinely NEW row/external id -- never a silently-revived old one) and
-- never counts against the per-organization cap.
create or replace function public.create_request_intake_integration(
  p_organization_id uuid,
  p_origin text
)
returns public.request_intake_integration_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_max_per_org constant int := 10;
  v_origin text;
  v_existing public.request_intake_integrations%rowtype;
  v_external_id text;
  v_id uuid;
  v_attempt int := 0;
  v_result public.request_intake_integration_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if p_organization_id is null
     or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_origin := public._normalize_website_origin(p_origin);
  if v_origin is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  perform pg_advisory_xact_lock(hashtext('request_intake_integration:' || p_organization_id::text)::bigint);

  select * into v_existing
  from public.request_intake_integrations
  where organization_id = p_organization_id
    and integration_type = 'website'
    and allowed_origins = array[v_origin]
    and retired_at is null;

  if found then
    v_result.integration_id := v_existing.id;
    v_result.external_id := v_existing.external_id;
    v_result.is_active := v_existing.is_active;
    v_result.changed := false;
    v_result.deactivated := false;
    return v_result;
  end if;

  if (select count(*) from public.request_intake_integrations where organization_id = p_organization_id and retired_at is null) >= c_max_per_org then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_external_id := public._generate_intake_external_id();
    begin
      insert into public.request_intake_integrations (organization_id, external_id, integration_type, is_active, allowed_origins)
      values (p_organization_id, v_external_id, 'website', false, array[v_origin])
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, after_data)
  values (
    p_organization_id, 'request_intake_integration', v_id, 'website_integration_created', auth.uid(),
    jsonb_build_object('external_id', v_external_id, 'allowed_origins', jsonb_build_array(v_origin), 'is_active', false)
  );

  v_result.integration_id := v_id;
  v_result.external_id := v_external_id;
  v_result.is_active := false;
  v_result.changed := true;
  v_result.deactivated := false;
  return v_result;
end;
$$;
revoke all on function public.create_request_intake_integration(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.create_request_intake_integration(uuid, text) to authenticated;

-- set_request_intake_integration_active: a retired row can never be reactivated (or "re-disabled" -- it is
-- already terminally off) through the ordinary Turn on/off control.
create or replace function public.set_request_intake_integration_active(
  p_integration_id uuid,
  p_active boolean
)
returns public.request_intake_integration_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_row public.request_intake_integrations%rowtype;
  v_result public.request_intake_integration_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select organization_id into v_org from public.request_intake_integrations where id = p_integration_id;
  if p_integration_id is null or v_org is null
     or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_active is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_row from public.request_intake_integrations where id = p_integration_id for update;

  if v_row.retired_at is not null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_result.integration_id := v_row.id;
  v_result.external_id := v_row.external_id;
  v_result.deactivated := false;

  if v_row.is_active = p_active then
    v_result.is_active := v_row.is_active;
    v_result.changed := false;
    return v_result;
  end if;

  if p_active and (v_row.allowed_origins is null or array_length(v_row.allowed_origins, 1) is null) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  update public.request_intake_integrations set is_active = p_active where id = v_row.id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    v_row.organization_id, 'request_intake_integration', v_row.id,
    case when p_active then 'website_integration_activated' else 'website_integration_disabled' end,
    auth.uid(),
    jsonb_build_object('is_active', v_row.is_active),
    jsonb_build_object('is_active', p_active, 'external_id', v_row.external_id)
  );

  v_result.is_active := p_active;
  v_result.changed := true;
  return v_result;
end;
$$;
revoke all on function public.set_request_intake_integration_active(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_request_intake_integration_active(uuid, boolean) to authenticated;

-- update_request_intake_integration_origin: a retired row's website can never be changed ("not casually editable").
create or replace function public.update_request_intake_integration_origin(
  p_integration_id uuid,
  p_origin text
)
returns public.request_intake_integration_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_origin text;
  v_row public.request_intake_integrations%rowtype;
  v_new_active boolean;
  v_result public.request_intake_integration_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select organization_id into v_org from public.request_intake_integrations where id = p_integration_id;
  if p_integration_id is null or v_org is null
     or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_origin := public._normalize_website_origin(p_origin);
  if v_origin is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  perform pg_advisory_xact_lock(hashtext('request_intake_integration:' || v_org::text)::bigint);

  select * into v_row from public.request_intake_integrations where id = p_integration_id for update;

  if v_row.retired_at is not null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_result.integration_id := v_row.id;
  v_result.external_id := v_row.external_id;
  v_result.deactivated := false;

  if v_row.allowed_origins = array[v_origin] then
    v_result.is_active := v_row.is_active;
    v_result.changed := false;
    return v_result;
  end if;

  if exists (
    select 1 from public.request_intake_integrations
    where organization_id = v_row.organization_id
      and id <> v_row.id
      and integration_type = 'website'
      and allowed_origins = array[v_origin]
      and retired_at is null
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_new_active := false;
  update public.request_intake_integrations
  set allowed_origins = array[v_origin], is_active = v_new_active
  where id = v_row.id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    v_row.organization_id, 'request_intake_integration', v_row.id, 'website_integration_origin_updated', auth.uid(),
    jsonb_build_object('allowed_origins', to_jsonb(v_row.allowed_origins), 'is_active', v_row.is_active),
    jsonb_build_object('allowed_origins', jsonb_build_array(v_origin), 'is_active', v_new_active,
                       'external_id', v_row.external_id, 'auto_disabled', v_row.is_active)
  );

  v_result.is_active := v_new_active;
  v_result.changed := true;
  v_result.deactivated := v_row.is_active;
  return v_result;
end;
$$;
revoke all on function public.update_request_intake_integration_origin(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.update_request_intake_integration_origin(uuid, text) to authenticated;

-- set_request_intake_integration_setup (D1 guidance preferences): a retired row's preferences are frozen too.
create or replace function public.set_request_intake_integration_setup(p_integration_id uuid, p_connection_method text default null, p_website_manager text default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_before record;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select organization_id into v_org from public.request_intake_integrations where id = p_integration_id;
  if p_integration_id is null or v_org is null or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if (p_connection_method is not null and p_connection_method not in ('nemryn_form', 'existing_form', 'developer'))
     or (p_website_manager is not null and p_website_manager not in ('self', 'developer', 'wordpress', 'wix', 'squarespace', 'webflow', 'other_builder', 'not_sure')) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select connection_method, website_manager, retired_at into v_before from public.request_intake_integrations where id = p_integration_id for update;
  if v_before.retired_at is not null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_before.connection_method is not distinct from p_connection_method and v_before.website_manager is not distinct from p_website_manager then
    return false;
  end if;

  update public.request_intake_integrations
  set connection_method = p_connection_method, website_manager = p_website_manager
  where id = p_integration_id;
  return true;
end;
$$;
revoke all on function public.set_request_intake_integration_setup(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.set_request_intake_integration_setup(uuid, text, text) to authenticated;

-- =============================================================================
-- 7. Public submission path: authoritative row lock + retired rejection, shared by BOTH delivery modes
-- =============================================================================
-- The ONE change to the shared canonical primitive both submit_public_transportation_request (website) and
-- submit_public_form_request (published Nemryn form) already funnel through. FOR SHARE is the other half of the
-- FOR UPDATE delete_unused_request_intake_integration / retire_request_intake_integration already take on this
-- same row (see their own comments) -- this is what makes the delete/submission and retire/submission races
-- deterministic and safe. A 'nemryn_form' binding is never retired by ANY code path in this schema (D2A''s two new
-- RPCs both reject integration_type <> 'website'), so this check is a no-op for that delivery mode today and
-- becomes meaningful the moment a 'website' row it is called with is retired.
create or replace function public._create_public_request(p_integration_id uuid, p_idempotency_key text, p_requester_name text, p_requester_relationship text, p_requester_phone text,
  p_pickup_description text, p_destination_description text, p_return_trip_needed text,
  p_requester_email text default null, p_preferred_date date default null, p_preferred_time time without time zone default null,
  p_assistance_notes text default null, p_additional_notes text default null, p_service_type text default null,
  p_recurring_days_of_week text[] default null, p_recurring_start_date date default null, p_recurring_end_date date default null,
  p_recurring_appointment_time time without time zone default null, p_recurring_return_trip_expected boolean default null,
  p_requested_passenger_name text default null, p_acquisition jsonb default null)
returns public.public_request_submission_result
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  v_acquisition jsonb;
begin
  select * into v_integration from public.request_intake_integrations where id = p_integration_id for share;
  if not found or v_integration.retired_at is not null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_idempotency_key := nullif(btrim(p_idempotency_key), '');
  if v_idempotency_key is null or length(v_idempotency_key) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

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

  v_requested_passenger_name := nullif(btrim(p_requested_passenger_name), '');
  if v_requested_passenger_name is not null and length(v_requested_passenger_name) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_service_type := nullif(btrim(p_service_type), '');
  if v_service_type is not null and v_service_type not in (
    'medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
    'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if v_service_type is not null
     and exists (select 1 from public.organization_service_offerings o where o.organization_id = v_integration.organization_id)
     and not exists (
       select 1 from public.organization_service_offerings o
       where o.organization_id = v_integration.organization_id and o.service_type = v_service_type
     ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

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
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_recurring_end_date is not null and p_recurring_start_date is not null and p_recurring_end_date < p_recurring_start_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

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
    select id into v_request_id
    from public.transportation_requests
    where intake_integration_id = v_integration.id and external_submission_ref = v_idempotency_key;
  else
    insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata)
    values (
      v_integration.organization_id, v_request_id, 'request_logged', null,
      jsonb_build_object('source', 'web', 'intake_integration_id', v_integration.id)
    );

    begin
      v_acquisition := public._sanitize_acquisition(p_acquisition);
      if v_acquisition is not null then
        insert into public.request_acquisition_attributions (
          organization_id, request_id,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          landing_path, submission_path, referrer_host, form_version
        ) values (
          v_integration.organization_id, v_request_id,
          v_acquisition ->> 'utmSource', v_acquisition ->> 'utmMedium', v_acquisition ->> 'utmCampaign',
          v_acquisition ->> 'utmContent', v_acquisition ->> 'utmTerm',
          v_acquisition ->> 'landingPath', v_acquisition ->> 'submissionPath',
          v_acquisition ->> 'referrerHost', v_acquisition ->> 'formVersion'
        )
        on conflict (request_id) do nothing;
      end if;
    exception when others then
      raise warning 'website intake: acquisition attribution not stored';
    end;

    v_result.notification_event_id := public._enqueue_notification_event(
      v_integration.organization_id, 'website_request', 'transportation_request', v_request_id
    );
  end if;

  v_result.accepted := true;
  return v_result;
end;
$function$;

comment on function public._create_public_request(uuid, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) is
  'INTERNAL, owner-only (no client / service EXECUTE). The ONE canonical public-Request creation logic. P1-COMM-D2A: now takes FOR SHARE on the integration row and rejects retired_at IS NOT NULL -- the authoritative half of the delete/retire-vs-submission race safety (the other half is the FOR UPDATE delete_unused_request_intake_integration / retire_request_intake_integration take on the same row). Callers must already have resolved and authorised the integration/publication: submit_public_transportation_request (website: integration + suspension + Origin) and submit_public_form_request (published Nemryn form: publication + suspension + snapshot rules). Same generic invalid_input (ZW006) for every rejection -- retirement state is never leaked to the public caller.';
revoke all on function public._create_public_request(uuid, text, text, text, text, text, text, text, text, date, time without time zone, text, text, text, text[], date, date, time without time zone, boolean, text, jsonb) from public, anon, authenticated, service_role;

-- =============================================================================
-- 8. Activity whitelist (+ the two new lifecycle actions)
-- =============================================================================
create or replace function public.list_activity_events(p_organization_id uuid, p_limit integer DEFAULT 30, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, occurred_at timestamp with time zone, action text, actor_name text, before_data jsonb, after_data jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'driver_self_linked', 'driver_self_reactivated',
    'website_request_form_updated', 'website_request_form_published', 'website_request_form_unpublished',
    'website_connection_deleted', 'website_connection_retired'
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
$function$;

revoke all on function public.list_activity_events(uuid, integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_activity_events(uuid, integer, timestamptz, uuid) to authenticated;
