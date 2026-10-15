-- NP-P2-S3 -- Nemryn Plus request attribution: Growth records REFERENCE existing Core transportation requests.
--
-- Canonical design: docs/product/plus-domain-model.md section 10 and 3.2 (P2-S3 row), section 7 (activities);
-- docs/security/plus-access-model.md section 4 (CRM <-> Core boundary); PD-06 (one attribution row per Request).
--
-- WHAT (forward-only, additive; references only Core and earlier Plus objects -- no forward FK):
--   plus_request_attributions: at most ONE row per Core Request (request_id is the PRIMARY KEY), with the independent,
--     nullable dimensions contact_id and opportunity_id (num_nonnulls >= 1). referral_account_id is NOT created here
--     (P3-S1 adds it with plus_accounts).
--   plus_activities: + request_id (composite FK to transportation_requests); subject check widened to
--     num_nonnulls(contact_id, opportunity_id, request_id) >= 1; + activity types request_linked, attribution_changed.
--   RPCs: plus_link_request, plus_update_request_attribution (Plus write), plus_get_request_attribution,
--     plus_list_request_attributions, plus_get_request_summaries (Plus read).
--   plus_update_opportunity (P2-S1) replaced forward-only (section 6, NP-P2-S3-R2 owner-approved option B): an
--     opportunity's primary contact cannot change while Requests are linked to it.
--
-- BOUNDARY: Plus REFERENCES Core and reads minimum-necessary facts; it never creates, changes, accepts, declines or
-- cancels a Core Request, never touches Passengers, Trips, Recurring Care or request_acquisition_attributions, and never
-- locks a Core row beyond the ordinary foreign-key check. Every request-scoped read and write requires BOTH Plus access
-- AND the Core role that may read requests (has_org_role(org, [organization_admin, dispatcher]) -- the exact
-- transportation_requests SELECT policy). Core never reads Plus.
--
-- link_method: the three canonical values are RESERVED in the CHECK so P2-S4 needs no constraint change, but every
-- P2-S3 RPC writes 'linked_existing_request' only; conversion_idempotency_key is allowed only for the future conversion /
-- rebooking methods and is never written here. A correction keeps the original link_method (it records history in
-- plus_activities / audit_events instead of impersonating a conversion).

-- =============================================================================
-- 1. plus_request_attributions
-- =============================================================================
create table public.plus_request_attributions (
  request_id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  contact_id uuid,
  opportunity_id uuid,
  link_method text not null,
  conversion_idempotency_key text,
  linked_by uuid not null references auth.users (id),
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plus_request_attributions_request_fkey
    foreign key (request_id, organization_id) references public.transportation_requests (id, organization_id),
  constraint plus_request_attributions_contact_fkey
    foreign key (contact_id, organization_id) references public.plus_contacts (id, organization_id),
  constraint plus_request_attributions_opportunity_fkey
    foreign key (opportunity_id, organization_id) references public.plus_opportunities (id, organization_id),
  -- at least one supported dimension (P3-S1 replaces it with num_nonnulls(contact_id, opportunity_id, referral_account_id) >= 1)
  constraint plus_request_attributions_subject_check check (num_nonnulls(contact_id, opportunity_id) >= 1),
  constraint plus_request_attributions_link_method_check
    check (link_method in ('converted_from_opportunity', 'linked_existing_request', 'rebooking')),
  -- the idempotency key belongs to the future conversion / rebooking RPCs (P2-S4) only
  constraint plus_request_attributions_idempotency_check check (
    conversion_idempotency_key is null
    or (link_method in ('converted_from_opportunity', 'rebooking') and length(conversion_idempotency_key) between 8 and 200)
  )
);

comment on table public.plus_request_attributions is
  'NP-P2-S3. TENANT-OWNED link from ONE Core transportation request (request_id, PRIMARY KEY; composite FK) to Growth records: independent nullable dimensions contact_id / opportunity_id (composite FKs; at least one). For a private-pay opportunity the contact is always that opportunity''s primary contact (enforced by the RPCs). Never owns or changes the Request; a Request without a row is fully valid. SELECT via RLS (Plus read AND the Core request-read role); writes only through plus_link_request / plus_update_request_attribution. updated_at is the concurrency token. Reporting counts a Request once per dimension, never summed across dimensions (PD-06).';
comment on column public.plus_request_attributions.link_method is
  'NP-P2-S3. How the link was made. P2-S3 writes linked_existing_request only; converted_from_opportunity / rebooking are reserved for the P2-S4 RPCs. A correction never changes it.';
comment on column public.plus_request_attributions.conversion_idempotency_key is
  'NP-P2-S3 (reserved for P2-S4). Idempotency key of a conversion / rebooking; NULL for linked_existing_request. Unique per organization when set.';

create unique index plus_request_attributions_idempotency_key
  on public.plus_request_attributions (organization_id, conversion_idempotency_key) where conversion_idempotency_key is not null;
create index plus_request_attributions_org_contact_idx
  on public.plus_request_attributions (organization_id, contact_id, linked_at desc) where contact_id is not null;
create index plus_request_attributions_org_opportunity_idx
  on public.plus_request_attributions (organization_id, opportunity_id, linked_at desc) where opportunity_id is not null;

create trigger plus_request_attributions_set_updated_at
  before update on public.plus_request_attributions
  for each row execute function public.set_updated_at();
create trigger plus_request_attributions_prevent_org_change
  before update on public.plus_request_attributions
  for each row execute function public.prevent_organization_id_change();

alter table public.plus_request_attributions enable row level security;
revoke all on table public.plus_request_attributions from public, anon, authenticated, service_role;
grant select on table public.plus_request_attributions to authenticated;
-- Plus read AND the Core role that may read transportation_requests (the same expression as its SELECT policy)
create policy plus_request_attributions_select_plus on public.plus_request_attributions
  for select to authenticated
  using (public.plus_can_read(organization_id)
         and public.has_org_role(organization_id, array['organization_admin', 'dispatcher']));

-- =============================================================================
-- 2. plus_activities: + request subject (additive; every S4 / P2-S1 / P2-S2 row validates unchanged)
-- =============================================================================
alter table public.plus_activities add column request_id uuid;
alter table public.plus_activities
  add constraint plus_activities_request_fkey
  foreign key (request_id, organization_id) references public.transportation_requests (id, organization_id);

alter table public.plus_activities drop constraint plus_activities_subject_check;
alter table public.plus_activities
  add constraint plus_activities_subject_check check (num_nonnulls(contact_id, opportunity_id, request_id) >= 1);

alter table public.plus_activities drop constraint plus_activities_activity_type_check;
alter table public.plus_activities
  add constraint plus_activities_activity_type_check check (
    activity_type in ('note', 'call_logged', 'email_logged', 'meeting_logged', 'owner_changed', 'record_archived', 'stage_changed',
                      'request_linked', 'attribution_changed')
  );
-- request history always names its Request
alter table public.plus_activities
  add constraint plus_activities_request_subject_check
  check (activity_type not in ('request_linked', 'attribution_changed') or request_id is not null);
-- a correction always carries its staff-entered reason (the body); a link carries none
alter table public.plus_activities drop constraint plus_activities_body_required_check;
alter table public.plus_activities
  add constraint plus_activities_body_required_check check (
    activity_type not in ('note', 'call_logged', 'email_logged', 'meeting_logged', 'attribution_changed') or body is not null
  );

create index plus_activities_org_request_idx on public.plus_activities (organization_id, request_id, occurred_at desc, recorded_at desc)
  where request_id is not null;

comment on column public.plus_activities.request_id is
  'NP-P2-S3. Optional Core Request subject (composite FK) for request_linked / attribution_changed history. No Core request text, passenger, address or medical data is ever copied into plus_activities.';

-- =============================================================================
-- 3. helpers (internal)
-- =============================================================================
-- The Core role that may read transportation_requests (its SELECT policy). Request-scoped Plus RPCs require it in
-- addition to Plus access, so Plus never shows Request facts to someone Core would not.
create function public._plus_require_core_request_read(p_organization_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
end;
$$;
comment on function public._plus_require_core_request_read(uuid) is
  'NP-P2-S3. INTERNAL. ZW002 unless the caller holds the Core role that may read transportation_requests (organization_admin or dispatcher, active membership, active organization) -- the same expression as that table''s SELECT policy.';
revoke all on function public._plus_require_core_request_read(uuid) from public, anon, authenticated, service_role;

-- Resolves the attribution dimensions. An opportunity (any stage, of THIS organization) fixes the contact to its primary
-- contact: a different contact -> ZW006. An explicitly chosen contact must be ACTIVE unless it is p_keep_contact_id (the
-- unchanged contact of a correction). Unknown / foreign -> ZW002. Both rows are locked FOR SHARE so they cannot be
-- re-pointed / archived underneath the write.
create function public._plus_resolve_attribution(
  p_organization_id uuid,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_keep_contact_id uuid,
  out contact_id uuid,
  out opportunity_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_primary uuid;
  v_status text;
begin
  if num_nonnulls(p_contact_id, p_opportunity_id) = 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_opportunity_id is not null then
    select o.primary_contact_id into v_primary from public.plus_opportunities o
    where o.id = p_opportunity_id and o.organization_id = p_organization_id and o.channel = 'private_pay'
    for share;
    if not found then
      raise exception 'not_found' using errcode = 'ZW002';
    end if;
    if p_contact_id is not null and p_contact_id <> v_primary then
      raise exception 'invalid_input' using errcode = 'ZW006';   -- the pair must be consistent
    end if;
    select c.status into v_status from public.plus_contacts c
    where c.id = v_primary and c.organization_id = p_organization_id
    for share;
    if v_status is null or v_status = 'redacted' then
      raise exception 'not_found' using errcode = 'ZW002';
    end if;
    contact_id := v_primary;
    opportunity_id := p_opportunity_id;
    return;
  end if;
  select c.status into v_status from public.plus_contacts c
  where c.id = p_contact_id and c.organization_id = p_organization_id
  for share;
  if v_status is null or v_status = 'redacted' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_status <> 'active' and p_contact_id is distinct from p_keep_contact_id then
    raise exception 'invalid_input' using errcode = 'ZW006';      -- archived contacts are history
  end if;
  contact_id := p_contact_id;
  opportunity_id := null;
end;
$$;
comment on function public._plus_resolve_attribution(uuid, uuid, uuid, uuid) is
  'NP-P2-S3. INTERNAL. Validates and normalizes attribution dimensions for one organization: an opportunity fixes the contact to its primary contact (a different contact -> ZW006); a chosen contact must be active unless unchanged (p_keep_contact_id); neither -> ZW006; unknown / foreign -> ZW002. Locks both rows FOR SHARE.';
revoke all on function public._plus_resolve_attribution(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

create type public.plus_request_attribution_result as (
  request_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  updated_at timestamptz,
  changed boolean
);
comment on type public.plus_request_attribution_result is
  'NP-P2-S3. Result of plus_link_request / plus_update_request_attribution. changed=false: nothing was written (idempotent no-op). updated_at is the new version token.';

-- =============================================================================
-- 4. write RPCs (Plus write AND Core request read)
-- =============================================================================
create function public.plus_link_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_contact_id uuid,
  p_opportunity_id uuid
)
returns public.plus_request_attribution_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dims record;
  v_row public.plus_request_attributions%rowtype;
  v_result public.plus_request_attribution_result;
begin
  perform public._require_plus_write(p_organization_id);
  perform public._plus_require_core_request_read(p_organization_id);
  -- the Request must exist in THIS organization (foreign and unknown are indistinguishable). Read only; never locked.
  if not exists (select 1 from public.transportation_requests r where r.id = p_request_id and r.organization_id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  select * into v_dims from public._plus_resolve_attribution(p_organization_id, p_contact_id, p_opportunity_id, null);

  insert into public.plus_request_attributions (request_id, organization_id, contact_id, opportunity_id, link_method, linked_by)
  values (p_request_id, p_organization_id, v_dims.contact_id, v_dims.opportunity_id, 'linked_existing_request', auth.uid())
  on conflict (request_id) do nothing
  returning * into v_row;

  if v_row.request_id is null then
    -- already attributed (by anyone, possibly a concurrent submission that just committed)
    select * into v_row from public.plus_request_attributions a where a.request_id = p_request_id and a.organization_id = p_organization_id;
    if v_row.contact_id is not distinct from v_dims.contact_id and v_row.opportunity_id is not distinct from v_dims.opportunity_id then
      v_result.request_id := v_row.request_id; v_result.contact_id := v_row.contact_id; v_result.opportunity_id := v_row.opportunity_id;
      v_result.updated_at := v_row.updated_at; v_result.changed := false;   -- the same link again: idempotent no-op
      return v_result;
    end if;
    raise exception 'already_attributed' using errcode = 'ZW004';           -- use the correction workflow
  end if;

  insert into public.plus_activities (organization_id, contact_id, opportunity_id, request_id, activity_type, body, actor_user_id, occurred_at)
  values (p_organization_id, v_row.contact_id, v_row.opportunity_id, v_row.request_id, 'request_linked', null, auth.uid(), now());
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_request_attribution', v_row.request_id, 'plus_request_linked', auth.uid(), null,
          jsonb_build_object('contact_id', v_row.contact_id, 'opportunity_id', v_row.opportunity_id, 'link_method', v_row.link_method));

  v_result.request_id := v_row.request_id; v_result.contact_id := v_row.contact_id; v_result.opportunity_id := v_row.opportunity_id;
  v_result.updated_at := v_row.updated_at; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_link_request(uuid, uuid, uuid, uuid) is
  'NP-P2-S3. Plus WRITE + Core request read. Links an EXISTING Core Request of p_organization_id (any state; never changed or locked) to an active contact and/or a private-pay opportunity of the same organization (the opportunity fixes the contact to its primary contact; a different contact ZW006). link_method = linked_existing_request. The same link again -> changed=false; a Request already attributed differently -> ZW004 (use plus_update_request_attribution). Unknown / foreign request, contact or opportunity -> ZW002. Writes one request_linked activity and an audit row (ids only). Creates no contact, opportunity, Request, Passenger or Trip.';
revoke all on function public.plus_link_request(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.plus_link_request(uuid, uuid, uuid, uuid) to authenticated;

create function public.plus_update_request_attribution(
  p_organization_id uuid,
  p_request_id uuid,
  p_expected_updated_at timestamptz,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_reason text
)
returns public.plus_request_attribution_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_old public.plus_request_attributions%rowtype;
  v_new public.plus_request_attributions%rowtype;
  v_dims record;
  v_gone_contact uuid;
  v_gone_opportunity uuid;
  v_result public.plus_request_attribution_result;
begin
  perform public._require_plus_write(p_organization_id);
  perform public._plus_require_core_request_read(p_organization_id);
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  select * into v_old from public.plus_request_attributions a
  where a.request_id = p_request_id and a.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  select * into v_dims from public._plus_resolve_attribution(p_organization_id, p_contact_id, p_opportunity_id, v_old.contact_id);

  v_result.request_id := v_old.request_id;
  if v_old.contact_id is not distinct from v_dims.contact_id and v_old.opportunity_id is not distinct from v_dims.opportunity_id then
    v_result.contact_id := v_old.contact_id; v_result.opportunity_id := v_old.opportunity_id;
    v_result.updated_at := v_old.updated_at; v_result.changed := false;   -- nothing changes: no history entry
    return v_result;
  end if;

  -- link_method, linked_by and linked_at are history and never change
  update public.plus_request_attributions a set contact_id = v_dims.contact_id, opportunity_id = v_dims.opportunity_id
  where a.request_id = v_old.request_id
  returning * into v_new;

  -- history on the NEW subjects (the reason is the staff-entered body) ...
  insert into public.plus_activities (organization_id, contact_id, opportunity_id, request_id, activity_type, body, actor_user_id, occurred_at)
  values (p_organization_id, v_new.contact_id, v_new.opportunity_id, v_new.request_id, 'attribution_changed', v_reason, auth.uid(), now());
  -- ... and on any subject the Request was moved AWAY from, so its timeline stays truthful
  v_gone_contact := case when v_old.contact_id is distinct from v_new.contact_id then v_old.contact_id end;
  v_gone_opportunity := case when v_old.opportunity_id is distinct from v_new.opportunity_id then v_old.opportunity_id end;
  if num_nonnulls(v_gone_contact, v_gone_opportunity) > 0 then
    insert into public.plus_activities (organization_id, contact_id, opportunity_id, request_id, activity_type, body, actor_user_id, occurred_at)
    values (p_organization_id, v_gone_contact, v_gone_opportunity, v_new.request_id, 'attribution_changed', v_reason, auth.uid(), now());
  end if;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_request_attribution', v_new.request_id, 'plus_request_attribution_changed', auth.uid(),
          jsonb_build_object('contact_id', v_old.contact_id, 'opportunity_id', v_old.opportunity_id),
          jsonb_build_object('contact_id', v_new.contact_id, 'opportunity_id', v_new.opportunity_id));

  v_result.contact_id := v_new.contact_id; v_result.opportunity_id := v_new.opportunity_id;
  v_result.updated_at := v_new.updated_at; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_update_request_attribution(uuid, uuid, timestamptz, uuid, uuid, text) is
  'NP-P2-S3. Plus WRITE + Core request read. Corrects an existing attribution''s contact / opportunity with a required reason (3-500). Row lock + p_expected_updated_at (ZW003 when stale); unknown / foreign / unattributed -> ZW002. Same consistency rules as plus_link_request (an unchanged archived contact may stay). Identical dimensions -> changed=false, no history. Never deletes the row; link_method / linked_by / linked_at never change. Writes attribution_changed history on the new subjects and on any subject the Request moved away from (body = reason) and an audit row (old / new ids only). Never touches the Core Request.';
revoke all on function public.plus_update_request_attribution(uuid, uuid, timestamptz, uuid, uuid, text) from public, anon;
grant execute on function public.plus_update_request_attribution(uuid, uuid, timestamptz, uuid, uuid, text) to authenticated;

-- =============================================================================
-- 5. read RPCs (Plus read AND Core request read)
-- =============================================================================
-- The attribution of ONE Request (zero rows when the Request is not attributed).
create function public.plus_get_request_attribution(p_organization_id uuid, p_request_id uuid)
returns table (
  request_id uuid,
  contact_id uuid,
  contact_name text,
  contact_status text,
  opportunity_id uuid,
  opportunity_title text,
  opportunity_stage text,
  link_method text,
  linked_by_name text,
  linked_at timestamptz,
  updated_at timestamptz
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
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  perform public._plus_require_core_request_read(p_organization_id);
  if not exists (select 1 from public.transportation_requests r where r.id = p_request_id and r.organization_id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select a.request_id, a.contact_id, c.display_name, c.status, a.opportunity_id, o.title, o.stage, a.link_method,
         public._plus_staff_name(a.linked_by), a.linked_at, a.updated_at
  from public.plus_request_attributions a
  left join public.plus_contacts c on c.id = a.contact_id and c.organization_id = a.organization_id
  left join public.plus_opportunities o on o.id = a.opportunity_id and o.organization_id = a.organization_id
  where a.request_id = p_request_id and a.organization_id = p_organization_id;
end;
$$;
comment on function public.plus_get_request_attribution(uuid, uuid) is
  'NP-P2-S3. Plus READ + Core request read. The Growth attribution of one Request of p_organization_id: linked contact (name, status), opportunity (title, stage), link method, who linked it and when, and the version token. Zero rows when not attributed; ZW002 for no access or an unknown / foreign Request.';
revoke all on function public.plus_get_request_attribution(uuid, uuid) from public, anon;
grant execute on function public.plus_get_request_attribution(uuid, uuid) to authenticated;

-- The Requests attributed to ONE contact or ONE opportunity (ids + link facts; Core facts come from the summaries).
create function public.plus_list_request_attributions(
  p_organization_id uuid,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_limit integer,
  p_offset integer
)
returns table (
  request_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  opportunity_title text,
  link_method text,
  linked_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  perform public._plus_require_core_request_read(p_organization_id);
  if num_nonnulls(p_contact_id, p_opportunity_id) <> 1 or v_limit < 1 or v_limit > 100 or v_offset < 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_contact_id is not null and not exists (select 1 from public.plus_contacts c where c.id = p_contact_id
                                                and c.organization_id = p_organization_id and c.status <> 'redacted') then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if p_opportunity_id is not null and not exists (select 1 from public.plus_opportunities o where o.id = p_opportunity_id
                                                    and o.organization_id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select a.request_id, a.contact_id, a.opportunity_id, o.title, a.link_method, a.linked_at, count(*) over ()
  from public.plus_request_attributions a
  left join public.plus_opportunities o on o.id = a.opportunity_id and o.organization_id = a.organization_id
  where a.organization_id = p_organization_id
    and (p_contact_id is null or a.contact_id = p_contact_id)
    and (p_opportunity_id is null or a.opportunity_id = p_opportunity_id)
  order by a.linked_at desc, a.request_id
  limit v_limit offset v_offset;
end;
$$;
comment on function public.plus_list_request_attributions(uuid, uuid, uuid, integer, integer) is
  'NP-P2-S3. Plus READ + Core request read. The Requests attributed to exactly one contact OR one opportunity of p_organization_id, newest link first (1-100). Ids and link facts only; Core facts come from plus_get_request_summaries. ZW002 for no access or a foreign / unknown subject; ZW006 for both / neither.';
revoke all on function public.plus_list_request_attributions(uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.plus_list_request_attributions(uuid, uuid, uuid, integer, integer) to authenticated;

-- Minimum-necessary Core facts for ATTRIBUTED Requests (access model section 4), derived live from Core at read time.
create function public.plus_get_request_summaries(p_organization_id uuid, p_request_ids uuid[])
returns table (
  request_id uuid,
  state text,
  source text,
  service_type text,
  created_at timestamptz,
  preferred_date date,
  passenger_linked boolean,
  decision_reason_code text,
  trips_total integer,
  trips_completed integer,
  trips_cancelled integer,
  first_completed_at timestamptz,
  arrangement_count integer,
  arrangement_status text
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
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  perform public._plus_require_core_request_read(p_organization_id);
  if p_request_ids is null or cardinality(p_request_ids) < 1 or cardinality(p_request_ids) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  return query
  select r.id, r.state, r.source, r.service_type, r.created_at, r.preferred_date, r.passenger_id is not null,
         (select e.reason_code from public.request_events e
          where e.organization_id = r.organization_id and e.request_id = r.id and e.event_type in ('request_declined', 'request_cancelled')
          order by e.occurred_at desc, e.id desc limit 1),
         coalesce(t.total, 0), coalesce(t.completed, 0), coalesce(t.cancelled, 0), t.first_completed,
         coalesce(ra.cnt, 0), ra.latest_status
  from public.transportation_requests r
  join public.plus_request_attributions a on a.request_id = r.id and a.organization_id = r.organization_id
  left join lateral (
    select count(*)::integer as total,
           count(*) filter (where tr.state = 'completed')::integer as completed,
           count(*) filter (where tr.state in ('cancelled', 'no_show'))::integer as cancelled,
           min(tr.completed_at) as first_completed
    from public.trips tr where tr.organization_id = r.organization_id and tr.request_id = r.id
  ) t on true
  left join lateral (
    select count(*)::integer as cnt,
           (select x.status from public.recurring_arrangements x where x.organization_id = r.organization_id and x.request_id = r.id
            order by x.created_at desc, x.id desc limit 1) as latest_status
    from public.recurring_arrangements y where y.organization_id = r.organization_id and y.request_id = r.id
  ) ra on true
  where r.organization_id = p_organization_id and r.id = any (p_request_ids)
  order by r.created_at desc, r.id;
end;
$$;
comment on function public.plus_get_request_summaries(uuid, uuid[]) is
  'NP-P2-S3. Plus READ + Core request read. Minimum-necessary Core facts for up to 200 ATTRIBUTED Requests of p_organization_id, derived live from Core: state, source, service type, created / preferred date, whether a passenger is linked (yes/no), the latest decline / cancel reason CODE, trip counts (total / completed / cancelled or no-show), first completion, recurring arrangement count + latest status. NEVER requester phone / email, pickup or destination text, assistance or other notes, trip instructions or notes, exceptions, or passenger fields. Ids that are foreign, unknown or not attributed are omitted (no oracle).';
revoke all on function public.plus_get_request_summaries(uuid, uuid[]) from public, anon;
grant execute on function public.plus_get_request_summaries(uuid, uuid[]) to authenticated;

-- =============================================================================
-- 6. plus_update_opportunity: contact consistency with linked Requests (NP-P2-S3-R2, owner-approved option B)
-- =============================================================================
-- Forward-only CREATE OR REPLACE of the P2-S1 function (20261014120000 is NOT modified). Identical signature, so its
-- grants are kept; body identical except ONE added refusal: the primary contact of an opportunity with linked Requests
-- cannot change (ZW004, message 'linked_requests'). Every other field, the owner logic, the closed-stage ZW004, the
-- version check (ZW003), Plus-write authorization, SECURITY DEFINER and search_path are unchanged.
create or replace function public.plus_update_opportunity(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_expected_updated_at timestamptz,
  p_contact_id uuid,
  p_title text,
  p_inquiry_type text,
  p_service_type text,
  p_source text,
  p_source_detail text,
  p_campaign_code text,
  p_estimated_value_cents bigint,
  p_payment_reported_status text,
  p_owner_membership_id uuid
)
returns public.plus_opportunity_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := nullif(btrim(p_title), '');
  v_detail text := nullif(btrim(p_source_detail), '');
  v_campaign text := nullif(lower(btrim(p_campaign_code)), '');
  v_owner uuid;
  v_old public.plus_opportunities%rowtype;
  v_new public.plus_opportunities%rowtype;
  v_fields text[] := array[]::text[];
  v_result public.plus_opportunity_write_result;
begin
  perform public._require_plus_write(p_organization_id);

  select * into v_old from public.plus_opportunities
  where id = p_opportunity_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_old.stage in ('lost', 'converted') then
    -- closed opportunities are history; reopen a lost one first
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- a changed contact must be an ACTIVE contact of this organization; the unchanged one may since have been archived
  if p_contact_id is distinct from v_old.primary_contact_id then
    perform public._plus_require_active_contact(p_organization_id, p_contact_id);
    -- NP-P2-S3-R2 (owner-approved option B): a private-pay opportunity's linked Requests are attributed to its primary
    -- contact, so changing that contact while Requests are linked would silently break the pair. Refuse (nothing is
    -- written: no update, no audit); staff first correct each Request's link (plus_update_request_attribution), then
    -- change the contact. Runs AFTER the FOR UPDATE row lock: a concurrent plus_link_request (which locks this row FOR
    -- SHARE) either committed before and is seen here, or waits and then validates against the new contact.
    if exists (select 1 from public.plus_request_attributions a
               where a.organization_id = p_organization_id and a.opportunity_id = v_old.id) then
      raise exception 'linked_requests' using errcode = 'ZW004';
    end if;
  end if;
  -- an unchanged owner who has since lost write access is kept; a NEW owner must be eligible
  if p_owner_membership_id is not null and v_old.owner_user_id is not null
     and exists (select 1 from public.memberships m where m.id = p_owner_membership_id
                 and m.organization_id = p_organization_id and m.user_id = v_old.owner_user_id) then
    v_owner := v_old.owner_user_id;
  else
    v_owner := public._plus_resolve_owner(p_organization_id, p_owner_membership_id);
  end if;

  if v_old.primary_contact_id is distinct from p_contact_id then v_fields := array_append(v_fields, 'contact'); end if;
  if v_old.title is distinct from v_title then v_fields := array_append(v_fields, 'title'); end if;
  if v_old.inquiry_type is distinct from p_inquiry_type then v_fields := array_append(v_fields, 'inquiry_type'); end if;
  if v_old.service_type is distinct from p_service_type then v_fields := array_append(v_fields, 'service_type'); end if;
  if v_old.source is distinct from p_source then v_fields := array_append(v_fields, 'source'); end if;
  if v_old.source_detail is distinct from v_detail then v_fields := array_append(v_fields, 'source_detail'); end if;
  if v_old.campaign_code is distinct from v_campaign then v_fields := array_append(v_fields, 'campaign_code'); end if;
  if v_old.estimated_value_cents is distinct from p_estimated_value_cents then v_fields := array_append(v_fields, 'estimated_value'); end if;
  if v_old.payment_reported_status is distinct from p_payment_reported_status then v_fields := array_append(v_fields, 'payment_reported_status'); end if;
  if v_old.owner_user_id is distinct from v_owner then v_fields := array_append(v_fields, 'owner'); end if;

  v_result.opportunity_id := v_old.id;
  v_result.stage := v_old.stage;
  if cardinality(v_fields) = 0 then
    v_result.updated_at := v_old.updated_at;
    v_result.changed := false;
    return v_result;
  end if;

  begin
    update public.plus_opportunities
    set primary_contact_id = p_contact_id, title = v_title, inquiry_type = p_inquiry_type, service_type = p_service_type,
        source = p_source, source_detail = v_detail, campaign_code = v_campaign, estimated_value_cents = p_estimated_value_cents,
        payment_reported_status = p_payment_reported_status, owner_user_id = v_owner
    where id = v_old.id
    returning * into v_new;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;

  if 'owner' = any (v_fields) then
    insert into public.plus_activities (organization_id, opportunity_id, activity_type, body, actor_user_id)
    values (p_organization_id, v_old.id, 'owner_changed',
            case when v_owner is null then 'Owner removed' else 'Owner: ' || public._plus_staff_name(v_owner) end, auth.uid());
  end if;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_opportunity', v_old.id, 'plus_opportunity_updated', auth.uid(), null,
          jsonb_build_object('fields', to_jsonb(v_fields)));

  v_result.updated_at := v_new.updated_at;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_update_opportunity(uuid, uuid, timestamptz, uuid, text, text, text, text, text, text, bigint, text, uuid) is
  'NP-P2-S1; NP-P2-S3-R2. Plus WRITE. Replaces the editable fields of an OPEN opportunity of p_organization_id (foreign / unknown ZW002; lost / converted ZW004). Row lock + p_expected_updated_at, else ZW003 (no lost update). A changed contact must be an active contact of the organization AND the opportunity must have no linked Requests (plus_request_attributions) -- otherwise ZW004 with message linked_requests: correct those Request links first (no attribution is ever rewritten silently). A new owner must be an eligible writer. Identical values -> changed=false. An owner change writes an owner_changed activity on the opportunity. Audited as plus_opportunity_updated with the NAMES of changed fields only. channel and stage are not editable here.';
revoke all on function public.plus_update_opportunity(uuid, uuid, timestamptz, uuid, text, text, text, text, text, text, bigint, text, uuid) from public, anon;
grant execute on function public.plus_update_opportunity(uuid, uuid, timestamptz, uuid, text, text, text, text, text, text, bigint, text, uuid) to authenticated;
