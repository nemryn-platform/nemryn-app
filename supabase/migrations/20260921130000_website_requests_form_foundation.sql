-- P1-COMM-D1 -- Website Requests UX + Universal Form foundation.
--
-- Persistence added for the customer-facing "Website Requests" product surface. NO change to the public
-- intake endpoint, submit_public_transportation_request, S4C attribution, RLS of any existing table, or
-- service_role. Everything below follows the P1-SEC-01 privilege baseline (explicit classification, RLS on,
-- no default privileges assumed, contract updated in the same phase).
--
-- 1. request_intake_integrations gains two optional PREFERENCE columns (guidance state, never authority):
--      connection_method  nemryn_form | existing_form | developer   (NULL = a connection that predates D1)
--      website_manager    self | developer | wordpress | wix | squarespace | webflow | other_builder | not_sure
--    They select instructions and language only; there is still ONE intake engine. The locked table keeps no
--    client privilege; they are read through the existing list RPC and written through a new admin-only RPC.
-- 2. public.website_request_forms: the smallest durable configuration of a Nemryn-generated transportation
--    request form. ONE per organization (unique organization_id), classification A (no client/service_role
--    privilege, RLS on, no policy), written/read only through admin-only SECURITY DEFINER RPCs. It is NOT a
--    form builder: fixed transportation-request schema, only copy + which services + recurring/service-choice
--    switches are configurable. Service truth stays in organization_service_offerings (the form stores only an
--    optional SUBSET; the effective list is always intersected with the tenant's current offerings at read time).
--    version drives the stable S4C formVersion ("nemryn-form-v<N>"): it increments whenever the form CONTENT
--    changes. Form state (draft | ready) is independent of the integration connection status.
--    This phase exposes NO public/hosted form and no embed: nothing here is reachable by anon or service_role.
-- 3. list_activity_events whitelist gains website_request_form_updated (audit written by the save RPC).

-- =============================================================================
-- 1. Integration setup preferences
-- =============================================================================
alter table public.request_intake_integrations
  add column connection_method text,
  add column website_manager text,
  add constraint request_intake_integrations_connection_method_check
    check (connection_method is null or connection_method in ('nemryn_form', 'existing_form', 'developer')),
  add constraint request_intake_integrations_website_manager_check
    check (website_manager is null or website_manager in ('self', 'developer', 'wordpress', 'wix', 'squarespace', 'webflow', 'other_builder', 'not_sure'));

comment on column public.request_intake_integrations.connection_method is
  'D1 guidance preference: how the tenant chose to connect (nemryn_form | existing_form | developer). NULL = a connection that predates D1 ("Existing connection"). Never an authorization input; there is one intake engine.';
comment on column public.request_intake_integrations.website_manager is
  'D1 guidance preference: who manages the tenant website (self | developer | wordpress | wix | squarespace | webflow | other_builder | not_sure). Selects instructions/language only.';

-- list RPC: same authorization, two more columns (return type changes => drop + create)
drop function public.list_request_intake_integrations(uuid);

create function public.list_request_intake_integrations(p_organization_id uuid)
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
  group by i.id
  order by i.created_at, i.id;
end;
$$;

comment on function public.list_request_intake_integrations(uuid) is
  'Organization Admin of p_organization_id only (has_org_role; Dispatcher, Driver, inactive Membership, foreign or nonexistent organization all get ZW002). Returns that organization''s own integrations with derived request_count / last_request_received_at and the D1 guidance preferences (connection_method, website_manager). The locked request_intake_integrations table is never granted or given a policy.';
revoke all on function public.list_request_intake_integrations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_request_intake_integrations(uuid) to authenticated;

-- setter: guidance preferences only
create function public.set_request_intake_integration_setup(p_integration_id uuid, p_connection_method text default null, p_website_manager text default null)
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

  -- Ownership derived from the integration row and authorized against the caller: a foreign, nonexistent or
  -- null id is the same ZW002 (no oracle). Organization Admin only; a suspended organization is denied.
  select organization_id into v_org from public.request_intake_integrations where id = p_integration_id;
  if p_integration_id is null or v_org is null or not public.has_org_role(v_org, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if (p_connection_method is not null and p_connection_method not in ('nemryn_form', 'existing_form', 'developer'))
     or (p_website_manager is not null and p_website_manager not in ('self', 'developer', 'wordpress', 'wix', 'squarespace', 'webflow', 'other_builder', 'not_sure')) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select connection_method, website_manager into v_before from public.request_intake_integrations where id = p_integration_id for update;
  if v_before.connection_method is not distinct from p_connection_method and v_before.website_manager is not distinct from p_website_manager then
    return false;
  end if;

  update public.request_intake_integrations
  set connection_method = p_connection_method, website_manager = p_website_manager
  where id = p_integration_id;
  return true;
end;
$$;

comment on function public.set_request_intake_integration_setup(uuid, text, text) is
  'Organization Admin of the integration''s organization only (foreign / nonexistent / Dispatcher / Driver / inactive / suspended: ZW002). Stores the D1 guidance preferences (connection_method, website_manager) for an existing connection; returns whether anything changed. Instructions/language only -- never changes what the intake endpoint accepts.';
revoke all on function public.set_request_intake_integration_setup(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.set_request_intake_integration_setup(uuid, text, text) to authenticated;

-- =============================================================================
-- 2. Nemryn form configuration (one per organization)
-- =============================================================================
create table public.website_request_forms (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  status text not null default 'draft' check (status in ('draft', 'ready')),
  title text not null,
  intro_text text,
  submit_label text not null,
  confirmation_message text not null,
  -- NULL = every service the organization currently offers (Services & Intake); otherwise an explicit SUBSET.
  offered_service_types text[],
  allow_recurring boolean not null default true,
  require_service_choice boolean not null default false,
  -- Drives the S4C formVersion "nemryn-form-v<version>"; increments when the form CONTENT changes.
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_request_forms_organization_id_key unique (organization_id),
  unique (id, organization_id),
  constraint website_request_forms_title_check check (char_length(title) between 1 and 120 and title !~ '[[:cntrl:]]'),
  constraint website_request_forms_submit_label_check check (char_length(submit_label) between 1 and 40 and submit_label !~ '[[:cntrl:]]'),
  constraint website_request_forms_confirmation_check check (
    char_length(confirmation_message) between 1 and 400 and regexp_replace(confirmation_message, E'[\\n\\r]', '', 'g') !~ '[[:cntrl:]]'),
  constraint website_request_forms_intro_check check (
    intro_text is null or (char_length(intro_text) between 1 and 600 and regexp_replace(intro_text, E'[\\n\\r]', '', 'g') !~ '[[:cntrl:]]')),
  constraint website_request_forms_services_check check (
    offered_service_types is null or (
      cardinality(offered_service_types) between 1 and 8
      and offered_service_types <@ array['medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge', 'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other']::text[]))
);

comment on table public.website_request_forms is
  'TENANT-OWNED configuration of the Nemryn-generated transportation request form (P1-COMM-D1). One row per organization. NOT a form builder: the field set is the fixed canonical website-intake contract; only copy, an optional service SUBSET, and the recurring / service-choice switches are configurable. Privilege contract class A: RLS on, no policy, no privilege for anon / authenticated / service_role; read and written only through admin-only SECURITY DEFINER RPCs. Not exposed publicly in D1 (no hosted form, no embed).';

create index website_request_forms_organization_id_idx on public.website_request_forms (organization_id);
create trigger website_request_forms_set_updated_at before update on public.website_request_forms for each row execute function public.set_updated_at();
create trigger website_request_forms_prevent_org_change before update on public.website_request_forms for each row execute function public.prevent_organization_id_change();
alter table public.website_request_forms enable row level security;
revoke all on table public.website_request_forms from public, anon, authenticated, service_role;

create type public.website_request_form_save_result as (form_version integer, status text, changed boolean);

create function public.get_website_request_form(p_organization_id uuid)
returns table (
  status text, title text, intro_text text, submit_label text, confirmation_message text,
  offered_service_types text[], allow_recurring boolean, require_service_choice boolean, version integer, updated_at timestamptz
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
  return query
  select f.status, f.title, f.intro_text, f.submit_label, f.confirmation_message, f.offered_service_types,
         f.allow_recurring, f.require_service_choice, f.version, f.updated_at
  from public.website_request_forms f where f.organization_id = p_organization_id;
end;
$$;

comment on function public.get_website_request_form(uuid) is
  'Organization Admin of p_organization_id only (Dispatcher, Driver, inactive, foreign, Platform Admin without Membership, suspended organization: ZW002). Returns the organization''s Nemryn form configuration, or zero rows when none has been configured.';
revoke all on function public.get_website_request_form(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_website_request_form(uuid) to authenticated;

create function public.save_website_request_form(
  p_organization_id uuid, p_title text, p_submit_label text, p_confirmation_message text,
  p_allow_recurring boolean, p_require_service_choice boolean, p_status text,
  p_intro_text text default null, p_offered_service_types text[] default null
)
returns public.website_request_form_save_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := nullif(regexp_replace(p_title, '^\s+|\s+$', '', 'g'), '');
  v_intro text := nullif(regexp_replace(coalesce(p_intro_text, ''), '^\s+|\s+$', '', 'g'), '');
  v_submit text := nullif(regexp_replace(p_submit_label, '^\s+|\s+$', '', 'g'), '');
  v_confirm text := nullif(regexp_replace(p_confirmation_message, '^\s+|\s+$', '', 'g'), '');
  v_services text[];
  v_row public.website_request_forms%rowtype;
  v_result public.website_request_form_save_result;
  v_content_changed boolean;
  v_configured boolean;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  -- Organization Admin of an ACTIVE organization only: suspended organization, inactive Membership, Dispatcher,
  -- Driver, foreign organization and a PlatformAdminGrant on its own are all the identical ZW002.
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if v_title is null or char_length(v_title) > 120 or v_submit is null or char_length(v_submit) > 40
     or v_confirm is null or char_length(v_confirm) > 400 or (v_intro is not null and char_length(v_intro) > 600)
     or p_allow_recurring is null or p_require_service_choice is null or p_status is null or p_status not in ('draft', 'ready') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  -- Control characters are never valid copy (multi-line text may contain plain newlines only).
  if v_title ~ '[[:cntrl:]]' or v_submit ~ '[[:cntrl:]]'
     or regexp_replace(v_confirm, E'[\\n\\r]', '', 'g') ~ '[[:cntrl:]]'
     or (v_intro is not null and regexp_replace(v_intro, E'[\\n\\r]', '', 'g') ~ '[[:cntrl:]]') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Services: NULL (= everything the organization offers) or a de-duplicated, non-empty, canonical subset that the
  -- organization currently offers. Service truth is NOT copied here; an unconfigured organization (no offering
  -- rows) has never restricted intake, so any canonical value is allowed, exactly like the intake function.
  if p_offered_service_types is not null then
    select coalesce(array_agg(distinct s order by s), '{}') into v_services from unnest(p_offered_service_types) s where s is not null;
    if cardinality(v_services) < 1
       or not (v_services <@ array['medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge', 'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other']::text[]) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    select exists (select 1 from public.organization_service_offerings o where o.organization_id = p_organization_id) into v_configured;
    if v_configured and exists (
      select 1 from unnest(v_services) s
      where not exists (select 1 from public.organization_service_offerings o where o.organization_id = p_organization_id and o.service_type = s)
    ) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  -- Serialise concurrent first saves for the organization (unique organization_id is the backstop).
  perform pg_advisory_xact_lock(hashtextextended('website_request_form:' || p_organization_id::text, 0));
  select * into v_row from public.website_request_forms where organization_id = p_organization_id for update;

  if not found then
    insert into public.website_request_forms (
      organization_id, status, title, intro_text, submit_label, confirmation_message, offered_service_types,
      allow_recurring, require_service_choice, version
    ) values (
      p_organization_id, p_status, v_title, v_intro, v_submit, v_confirm, v_services,
      p_allow_recurring, p_require_service_choice, 1
    ) returning * into v_row;

    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
    values (p_organization_id, 'website_request_form', v_row.id, 'website_request_form_updated', auth.uid(), null,
            jsonb_build_object('status', v_row.status, 'version', v_row.version, 'created', true));

    v_result.form_version := v_row.version; v_result.status := v_row.status; v_result.changed := true;
    return v_result;
  end if;

  v_content_changed :=
    v_row.title is distinct from v_title or v_row.intro_text is distinct from v_intro
    or v_row.submit_label is distinct from v_submit or v_row.confirmation_message is distinct from v_confirm
    or v_row.offered_service_types is distinct from v_services
    or v_row.allow_recurring is distinct from p_allow_recurring or v_row.require_service_choice is distinct from p_require_service_choice;

  if not v_content_changed and v_row.status = p_status then
    v_result.form_version := v_row.version; v_result.status := v_row.status; v_result.changed := false;
    return v_result;
  end if;

  update public.website_request_forms
  set status = p_status, title = v_title, intro_text = v_intro, submit_label = v_submit, confirmation_message = v_confirm,
      offered_service_types = v_services, allow_recurring = p_allow_recurring, require_service_choice = p_require_service_choice,
      version = v_row.version + case when v_content_changed then 1 else 0 end
  where id = v_row.id
  returning * into v_row;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'website_request_form', v_row.id, 'website_request_form_updated', auth.uid(),
          null, jsonb_build_object('status', v_row.status, 'version', v_row.version, 'created', false));

  v_result.form_version := v_row.version; v_result.status := v_row.status; v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.save_website_request_form(uuid, text, text, text, boolean, boolean, text, text, text[]) is
  'Organization Admin of an ACTIVE organization only (Dispatcher, Driver, inactive Membership, suspended organization, foreign organization, Platform Admin without Membership: ZW002). Creates or updates the organization''s single Nemryn form configuration. Validates copy bounds, status (draft | ready) and that any service SUBSET is canonical and currently offered by the organization (ZW006 otherwise). The version (=> S4C formVersion) increments only when form CONTENT changes; a status-only change or an identical save is not a new version. Audit website_request_form_updated (status/version only, no copy). Idempotent.';
revoke all on function public.save_website_request_form(uuid, text, text, text, boolean, boolean, text, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.save_website_request_form(uuid, text, text, text, boolean, boolean, text, text, text[]) to authenticated;

-- =============================================================================
-- 3. Activity whitelist (+ website_request_form_updated)
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
    'website_request_form_updated'
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
