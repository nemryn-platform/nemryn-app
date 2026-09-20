-- P1-PILOT-S4B-R4B -- Website Integration Self-Service.
--
-- request_intake_integrations has been, since P1-PILOT-S4A, a deliberately
-- CLOSED table: RLS on, zero policies, zero grants to anon/authenticated,
-- SELECT-only for service_role (the public-intake Route Handler). Every row
-- so far was provisioned by hand. This migration lets an Organization
-- Admin manage their OWN website integrations from Settings -> Integrations
-- WITHOUT opening that table:
--
--   * no RLS policy and no grant is added to request_intake_integrations --
--     it stays exactly as locked as before (verified by the R4B tests);
--   * every read and every write goes through a narrow SECURITY DEFINER
--     function that authorizes the caller with has_org_role(<org>,
--     ['organization_admin']) and never accepts an integration id as proof
--     of anything (an integration UUID from another tenant is
--     indistinguishable from a nonexistent one -- ZW002, no oracle);
--   * nothing here touches the public-intake path:
--     submit_public_transportation_request, its grants, the rate-limit
--     ledger, and check_and_record_public_intake_rate_limit are untouched.
--     An integration this migration creates is consumed by that unchanged
--     path exactly like a hand-provisioned one.
--
-- Multiple integrations per organization are supported by construction (no
-- one-per-org constraint). The single invariant added is the smallest that
-- makes a retry safe: an organization cannot hold two website integrations
-- for the SAME normalized origin.

-- =============================================================================
-- 1. Internal helpers (not callable by any client role)
-- =============================================================================

-- Normalizes a website origin or returns NULL when it is not acceptable.
-- Accepts ONLY: https, a DNS host of >= 2 labels ending in an alphabetic (or
-- punycode) TLD, an optional numeric port, and at most one trailing slash.
-- Rejects: http, any path/query/fragment, userinfo, wildcards, IP literals
-- and bare single-label hosts (numeric/one-label TLDs never match), other
-- schemes, whitespace, non-ASCII (IDNs must be punycode), malformed input.
-- The default port :443 is dropped so the stored value equals what a browser
-- sends in the Origin header. No localhost/loopback allowance: local
-- testing uses a synthetic HTTPS origin (the Origin header is caller-set on a
-- server-to-server call), so there is nothing to special-case.
create or replace function public._normalize_website_origin(p_origin text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v text;
  v_port text;
  v_host text;
begin
  if p_origin is null then
    return null;
  end if;

  v := lower(btrim(p_origin));
  if length(v) = 0 or length(v) > 255 then
    return null;
  end if;

  -- One trailing slash is normalization; anything after the host is not.
  if right(v, 1) = '/' then
    v := left(v, length(v) - 1);
  end if;

  if v !~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})(:[0-9]{1,5})?$' then
    return null;
  end if;

  v_host := substring(v from '^https://([^:]+)');
  v_port := substring(v from ':([0-9]{1,5})$');

  if v_port is not null then
    if v_port::int < 1 or v_port::int > 65535 then
      return null;
    end if;
    if v_port::int = 443 then
      return 'https://' || v_host;
    end if;
    return 'https://' || v_host || ':' || v_port::int::text;
  end if;

  return 'https://' || v_host;
end;
$$;

comment on function public._normalize_website_origin(text) is
  'INTERNAL (no client grant). Returns the canonical https origin for an acceptable website address, or NULL. See the function body for the exact accept/reject rules; mirrored (with shared test vectors) by src/lib/operations/website-integration-core.ts.';

revoke all on function public._normalize_website_origin(text) from public, anon, authenticated;

-- Opaque, unique, non-sequential, URL/JSON-safe Integration ID:
-- 'web_' + 12 chars from a 32-symbol alphabet (no 0/O/1/I ambiguity), drawn
-- from a CSPRNG (pgcrypto) with `byte & 31` so every symbol is equally
-- likely (60 bits). Encodes nothing: not the organization, its name, a
-- sequence, a user or a timestamp. It is a public identifier, not a secret.
create or replace function public._generate_intake_external_id()
returns text
language plpgsql
volatile
set search_path = pg_catalog, public, extensions
as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_out text := 'web_';
  i int;
begin
  for i in 0..11 loop
    v_out := v_out || substr(c_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  return v_out;
end;
$$;

comment on function public._generate_intake_external_id() is
  'INTERNAL (no client grant). Generates the opaque Integration ID (web_ + 12 chars, 60 bits of CSPRNG entropy). Uniqueness is enforced by request_intake_integrations_external_id_key; the caller retries on the (astronomically rare) collision.';

revoke all on function public._generate_intake_external_id() from public, anon, authenticated;

-- =============================================================================
-- 2. Smallest correct duplicate invariant
-- =============================================================================
-- One organization cannot hold two website integrations for the same
-- normalized origin. Legacy/hand-provisioned rows with NULL or multi-value
-- allowed_origins are outside the predicate and unaffected.
create unique index request_intake_integrations_org_origin_uidx
  on public.request_intake_integrations (organization_id, (allowed_origins[1]))
  where integration_type = 'website'
    and allowed_origins is not null
    and array_length(allowed_origins, 1) = 1;

-- =============================================================================
-- 3. Result / read types
-- =============================================================================
create type public.request_intake_integration_result as (
  integration_id uuid,
  external_id text,
  is_active boolean,
  changed boolean,
  deactivated boolean
);

comment on type public.request_intake_integration_result is
  'Return shape for the three integration-management mutations. `changed` is false for an idempotent no-op (identical state, or a create for an origin that already has an integration -- the existing one is returned). `deactivated` is true only when an origin change automatically disabled a previously active integration.';

-- =============================================================================
-- 4. list_request_intake_integrations -- tenant-scoped read model
-- =============================================================================
-- Organization Admin of p_organization_id only. Safe columns only, plus the
-- two derived activity figures computed from the Requests actually tied to
-- each integration (transportation_requests.intake_integration_id) -- no
-- stored counters. The id is returned only as an opaque handle for the
-- management actions; the UI never displays it.
create or replace function public.list_request_intake_integrations(p_organization_id uuid)
returns table (
  id uuid,
  integration_type text,
  external_id text,
  is_active boolean,
  allowed_origins text[],
  created_at timestamptz,
  request_count bigint,
  last_request_received_at timestamptz
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
         max(r.created_at)
  from public.request_intake_integrations i
  left join public.transportation_requests r
    on r.intake_integration_id = i.id and r.organization_id = i.organization_id
  where i.organization_id = p_organization_id
  group by i.id
  order by i.created_at, i.id;
end;
$$;

comment on function public.list_request_intake_integrations(uuid) is
  'Organization Admin of p_organization_id only (has_org_role; Dispatcher, Driver, inactive Membership, foreign or nonexistent organization all get ZW002). Returns that organization''s own integrations with derived request_count / last_request_received_at. The locked request_intake_integrations table is never granted or given a policy.';

revoke all on function public.list_request_intake_integrations(uuid) from public;
grant execute on function public.list_request_intake_integrations(uuid) to authenticated;

-- =============================================================================
-- 5. create_request_intake_integration
-- =============================================================================
-- p_organization_id is the caller's CURRENT workspace as resolved
-- server-side by the app from the authenticated Membership (never a browser
-- value), and is authorized here regardless: has_org_role decides, so a
-- crafted value for any other organization is denied (ZW002). Everything
-- else is generated or fixed here: external_id (CSPRNG), integration_type
-- ('website'), is_active (false), created_by (auth.uid() -> AuditEvent).
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

  -- Serialize creates per organization so a double-click / two tabs / a
  -- retry cannot both pass the duplicate check below.
  perform pg_advisory_xact_lock(hashtext('request_intake_integration:' || p_organization_id::text)::bigint);

  select * into v_existing
  from public.request_intake_integrations
  where organization_id = p_organization_id
    and integration_type = 'website'
    and allowed_origins = array[v_origin];

  if found then
    v_result.integration_id := v_existing.id;
    v_result.external_id := v_existing.external_id;
    v_result.is_active := v_existing.is_active;
    v_result.changed := false;
    v_result.deactivated := false;
    return v_result;
  end if;

  if (select count(*) from public.request_intake_integrations where organization_id = p_organization_id) >= c_max_per_org then
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

comment on function public.create_request_intake_integration(uuid, text) is
  'Organization Admin of p_organization_id only. Creates a DISABLED website integration for that organization with a server-generated opaque Integration ID and the normalized https origin as its single allowed origin; writes website_integration_created. Idempotent per (organization, normalized origin): a retry/second tab returns the existing integration (changed=false) rather than a duplicate. Capped at 10 integrations per organization. The caller supplies only an organization it must administer and a website address -- never an external id, active flag, type or actor.';

revoke all on function public.create_request_intake_integration(uuid, text) from public;
grant execute on function public.create_request_intake_integration(uuid, text) to authenticated;

-- =============================================================================
-- 6. set_request_intake_integration_active -- activate / kill switch
-- =============================================================================
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

  -- Ownership is derived from the integration row and authorized against the
  -- caller. A foreign, nonexistent or null id is the same ZW002 -- no oracle.
  select organization_id into v_org from public.request_intake_integrations where id = p_integration_id;
  if p_integration_id is null or v_org is null
     or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_active is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_row from public.request_intake_integrations where id = p_integration_id for update;

  v_result.integration_id := v_row.id;
  v_result.external_id := v_row.external_id;
  v_result.deactivated := false;

  if v_row.is_active = p_active then
    v_result.is_active := v_row.is_active;
    v_result.changed := false;
    return v_result;
  end if;

  -- An integration with no configured origin would accept submissions from
  -- anywhere once active: require the origin constraint before activation.
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

comment on function public.set_request_intake_integration_active(uuid, boolean) is
  'Organization Admin of the integration''s own organization only (foreign/nonexistent id -> ZW002, indistinguishable). Activates or disables (kill switch) one integration; takes effect on the very next public submission because submit_public_transportation_request reads is_active live. Activation requires a configured origin. Never deletes or rewrites any Request, Passenger, Trip or recurring arrangement. Writes website_integration_activated / website_integration_disabled. Idempotent (changed=false).';

revoke all on function public.set_request_intake_integration_active(uuid, boolean) from public;
grant execute on function public.set_request_intake_integration_active(uuid, boolean) to authenticated;

-- =============================================================================
-- 7. update_request_intake_integration_origin
-- =============================================================================
-- external_id never changes. If the integration is ACTIVE and the origin
-- actually changes, it is automatically disabled in the same statement: the
-- admin must consciously reactivate after reviewing the new origin, so an
-- active public integration is never silently pointed at another site.
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

  -- Same per-organization lock as create, so an edit cannot race a create
  -- (or another edit) into the duplicate-origin invariant.
  perform pg_advisory_xact_lock(hashtext('request_intake_integration:' || v_org::text)::bigint);

  select * into v_row from public.request_intake_integrations where id = p_integration_id for update;

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

comment on function public.update_request_intake_integration_origin(uuid, text) is
  'Organization Admin of the integration''s own organization only (foreign/nonexistent id -> ZW002). Replaces the integration''s allowed origin with the normalized new one (external_id unchanged) and ALWAYS leaves it disabled: an active integration whose origin changes is automatically disabled (deactivated=true) and must be explicitly reactivated. Rejects an origin another integration of the same organization already holds. Writes website_integration_origin_updated with before/after.';

revoke all on function public.update_request_intake_integration_origin(uuid, text) from public;
grant execute on function public.update_request_intake_integration_origin(uuid, text) to authenticated;

-- The integration table itself is deliberately NOT touched: no policy, no
-- grant. Restated so a later reader of this migration sees the invariant
-- being preserved rather than assumed.
revoke all on public.request_intake_integrations from anon, authenticated;
