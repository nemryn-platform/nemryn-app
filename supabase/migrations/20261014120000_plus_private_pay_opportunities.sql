-- NP-P2-S1 -- Nemryn Plus private-pay opportunities + pipeline; plus_activities gains the opportunity subject.
--
-- Canonical design: docs/product/plus-domain-model.md section 3.2 (P2-S1 row), 7 and 8 / 8.1;
-- docs/product/plus-product-spec.md 4.3; PD-05 (one table, fixed stages), PD-09 (payment status is staff-reported).
--
-- WHAT (forward-only, additive; references only Core and earlier Plus objects -- no forward FK):
--   1. plus_opportunities   -- channel 'private_pay' ONLY (plus_opportunities_channel_check, widened in P3-S1), a
--                              required primary contact (composite FK), stored stages new_inquiry .. quote_accepted,
--                              converted (RESERVED: no P2-S1 function sets it; P2-S4 conversion will), lost (terminal).
--                              NO account_id / referral_account_id (P3-S1), NO inquiry_id (P2-S7).
--   2. plus_activities      -- + opportunity_id (composite FK); plus_activities_subject_check replaced by
--                              num_nonnulls(contact_id, opportunity_id) >= 1 (domain model 3.2); the type CHECK gains
--                              stage_changed (opportunity rows only). Every S4 row stays valid unchanged.
--   3. RPCs                 -- list / get / activities (Plus read); create / update / change stage / mark lost /
--                              reopen (Plus write, _require_plus_write). No conversion, Request, Passenger or Trip.
--
-- Opportunity history rows carry opportunity_id only (contact_id NULL), so S4 contact timelines are unchanged.
-- ZD-211 is untouched: staff-access changes stay in audit_events only.
-- Quote stages are STAFF-REPORTED sales stages until P2-S5: no quote document exists or is implied.
-- estimated_value_cents is an estimate (never revenue); payment_reported_status is staff-reported (never settlement).

-- =============================================================================
-- 1. plus_opportunities
-- =============================================================================
create table public.plus_opportunities (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  channel text not null default 'private_pay',
  title text not null,
  stage text not null default 'new_inquiry',
  primary_contact_id uuid,
  inquiry_type text,
  service_type text,
  source text not null,
  source_detail text,
  campaign_code text,
  estimated_value_cents bigint,
  payment_reported_status text not null default 'none',
  lost_reason text,
  lost_note text,
  owner_user_id uuid references auth.users (id),
  converted_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plus_opportunities_id_organization_id_key unique (id, organization_id),
  constraint plus_opportunities_primary_contact_fkey
    foreign key (primary_contact_id, organization_id) references public.plus_contacts (id, organization_id),
  -- P2-S1: private-pay only. P3-S1 replaces this with channel in ('private_pay', 'facility').
  constraint plus_opportunities_channel_check check (channel in ('private_pay')),
  constraint plus_opportunities_private_pay_contact_check check (channel <> 'private_pay' or primary_contact_id is not null),
  constraint plus_opportunities_title_check check (title = btrim(title) and length(title) between 1 and 200),
  -- private-pay stage set (P3-S1 adds the facility set per channel)
  constraint plus_opportunities_stage_check check (
    stage in ('new_inquiry', 'contacted', 'qualified', 'quote_sent', 'quote_accepted', 'converted', 'lost')
  ),
  constraint plus_opportunities_inquiry_type_check check (
    inquiry_type is null or inquiry_type in ('quote', 'availability', 'service_question', 'booking', 'other')
  ),
  -- the Core service-type closed set (20260920110000_team_services_operations_settings.sql)
  constraint plus_opportunities_service_type_check check (
    service_type is null or service_type in ('medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
                                             'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other')
  ),
  constraint plus_opportunities_source_check check (
    source in ('phone', 'website', 'web_inquiry', 'email', 'referral', 'facility', 'walk_in', 'event', 'advertising', 'other')
  ),
  constraint plus_opportunities_source_detail_check check (source_detail is null or (source_detail = btrim(source_detail) and length(source_detail) between 1 and 120)),
  constraint plus_opportunities_campaign_code_check check (campaign_code is null or (length(campaign_code) <= 64 and campaign_code ~ '^[a-z0-9][a-z0-9_-]*$')),
  constraint plus_opportunities_estimated_value_check check (estimated_value_cents is null or estimated_value_cents between 0 and 100000000),
  constraint plus_opportunities_payment_reported_status_check check (
    payment_reported_status in ('none', 'deposit_reported', 'paid_reported', 'refund_reported')
  ),
  -- Lost reasons: the owner-approved canonical vocabulary (NP-P2-S1-R1A). Non-medical.
  constraint plus_opportunities_lost_reason_check check (
    lost_reason is null or lost_reason in ('no_response', 'price', 'chose_competitor', 'outside_service_area',
                                           'service_not_offered', 'no_availability', 'not_a_fit', 'duplicate', 'other')
  ),
  constraint plus_opportunities_lost_check check ((stage = 'lost') = (lost_reason is not null)),
  constraint plus_opportunities_lost_note_check check (
    (lost_note is null or (stage = 'lost' and lost_note = btrim(lost_note) and length(lost_note) between 1 and 500))
    and (lost_reason is distinct from 'other' or lost_note is not null)
  ),
  constraint plus_opportunities_closed_check check ((stage in ('lost', 'converted')) = (closed_at is not null)),
  constraint plus_opportunities_converted_check check ((stage = 'converted') = (converted_at is not null))
);

comment on table public.plus_opportunities is
  'NP-P2-S1. TENANT-OWNED Nemryn Plus sales effort (private-pay only in P2-S1) for one existing plus_contacts row of the same organization (composite FK). SELECT via RLS plus_can_read(organization_id); writes only through plus_create_opportunity / plus_update_opportunity / plus_change_opportunity_stage / plus_mark_opportunity_lost / plus_reopen_opportunity. channel is immutable. converted is reserved for the P2-S4 Core conversion. Quote stages are staff-reported (no quote document before P2-S5); estimated_value_cents is an estimate, payment_reported_status is staff-reported. No health, trip or passenger data. updated_at is the concurrency token.';

create index plus_opportunities_org_channel_stage_idx on public.plus_opportunities (organization_id, channel, stage, updated_at desc);
create index plus_opportunities_org_contact_idx on public.plus_opportunities (organization_id, primary_contact_id);
create index plus_opportunities_org_owner_open_idx on public.plus_opportunities (organization_id, owner_user_id) where closed_at is null;

create trigger plus_opportunities_set_updated_at
  before update on public.plus_opportunities
  for each row execute function public.set_updated_at();
create trigger plus_opportunities_prevent_org_change
  before update on public.plus_opportunities
  for each row execute function public.prevent_organization_id_change();

-- channel is immutable after insert (domain model 8), whatever the caller.
create function public._plus_opportunity_channel_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.channel is distinct from old.channel then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  return new;
end;
$$;
comment on function public._plus_opportunity_channel_immutable() is
  'NP-P2-S1. INTERNAL trigger function: plus_opportunities.channel can never change after insert.';
revoke all on function public._plus_opportunity_channel_immutable() from public, anon, authenticated, service_role;
create trigger plus_opportunities_channel_immutable
  before update on public.plus_opportunities
  for each row execute function public._plus_opportunity_channel_immutable();

alter table public.plus_opportunities enable row level security;
revoke all on table public.plus_opportunities from public, anon, authenticated, service_role;
grant select on table public.plus_opportunities to authenticated;
create policy plus_opportunities_select_plus on public.plus_opportunities
  for select to authenticated
  using (public.plus_can_read(organization_id));

-- =============================================================================
-- 2. plus_activities: + opportunity subject (additive; every S4 row validates unchanged)
-- =============================================================================
alter table public.plus_activities add column opportunity_id uuid;
alter table public.plus_activities
  add constraint plus_activities_opportunity_fkey
  foreign key (opportunity_id, organization_id) references public.plus_opportunities (id, organization_id);

alter table public.plus_activities drop constraint plus_activities_subject_check;
alter table public.plus_activities
  add constraint plus_activities_subject_check check (num_nonnulls(contact_id, opportunity_id) >= 1);

alter table public.plus_activities drop constraint plus_activities_activity_type_check;
alter table public.plus_activities
  add constraint plus_activities_activity_type_check check (
    activity_type in ('note', 'call_logged', 'email_logged', 'meeting_logged', 'owner_changed', 'record_archived', 'stage_changed')
  );
-- a stage change always belongs to an opportunity
alter table public.plus_activities
  add constraint plus_activities_stage_subject_check check (activity_type <> 'stage_changed' or opportunity_id is not null);

create index plus_activities_org_opportunity_idx on public.plus_activities (organization_id, opportunity_id, occurred_at desc, recorded_at desc)
  where opportunity_id is not null;

comment on column public.plus_activities.opportunity_id is
  'NP-P2-S1. Optional opportunity subject (composite FK). Opportunity history rows (stage_changed, owner_changed) set opportunity_id only, so contact timelines are unchanged.';

-- =============================================================================
-- 3. result type + read RPCs (Plus read)
-- =============================================================================
create type public.plus_opportunity_write_result as (
  opportunity_id uuid,
  stage text,
  updated_at timestamptz,
  changed boolean
);
comment on type public.plus_opportunity_write_result is
  'NP-P2-S1. Result of the opportunity write RPCs. changed=false: nothing was written (idempotent no-op). updated_at is the new version token.';

create function public.plus_list_opportunities(
  p_organization_id uuid,
  p_search text,
  p_view text,
  p_stage text,
  p_source text,
  p_owner_membership_id uuid,
  p_contact_id uuid,
  p_limit integer,
  p_offset integer
)
returns table (
  opportunity_id uuid,
  title text,
  stage text,
  contact_id uuid,
  contact_name text,
  contact_status text,
  contact_do_not_contact boolean,
  inquiry_type text,
  service_type text,
  source text,
  estimated_value_cents bigint,
  owner_name text,
  closed_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_view text := coalesce(p_view, 'open');
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_view not in ('open', 'lost', 'converted', 'all')
     or (p_stage is not null and p_stage not in ('new_inquiry', 'contacted', 'qualified', 'quote_sent', 'quote_accepted', 'converted', 'lost'))
     or (p_source is not null and p_source not in ('phone', 'website', 'web_inquiry', 'email', 'referral', 'facility', 'walk_in', 'event', 'advertising', 'other'))
     or v_limit < 1 or v_limit > 200 or v_offset < 0 or length(coalesce(v_q, '')) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_owner_membership_id is not null then
    -- a handle from another organization simply matches nothing (no oracle)
    select m.user_id into v_owner from public.memberships m where m.id = p_owner_membership_id and m.organization_id = p_organization_id;
    if v_owner is null then
      v_owner := '00000000-0000-0000-0000-000000000000';
    end if;
  end if;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select o.id, o.title, o.stage, c.id, c.display_name, c.status, c.do_not_contact, o.inquiry_type, o.service_type, o.source,
         o.estimated_value_cents,
         case when o.owner_user_id is null then null else public._plus_staff_name(o.owner_user_id) end,
         o.closed_at, o.updated_at, count(*) over ()
  from public.plus_opportunities o
  join public.plus_contacts c on c.id = o.primary_contact_id and c.organization_id = o.organization_id
  where o.organization_id = p_organization_id
    and o.channel = 'private_pay'
    and (v_view = 'all'
         or (v_view = 'open' and o.stage not in ('lost', 'converted'))
         or (v_view = 'lost' and o.stage = 'lost')
         or (v_view = 'converted' and o.stage = 'converted'))
    and (p_stage is null or o.stage = p_stage)
    and (p_source is null or o.source = p_source)
    and (p_owner_membership_id is null or o.owner_user_id = v_owner)
    and (p_contact_id is null or o.primary_contact_id = p_contact_id)
    and (v_q is null or lower(o.title) like v_like or lower(c.display_name) like v_like)
  order by o.updated_at desc, o.id
  limit v_limit offset v_offset;
end;
$$;
comment on function public.plus_list_opportunities(uuid, text, text, text, text, uuid, uuid, integer, integer) is
  'NP-P2-S1. Plus READ (plus_can_read; ZW002 otherwise, ZW001 without a uid). Private-pay opportunities of p_organization_id with their contact''s name / status / do-not-contact flag: view open (default) | lost | converted | all, optional stage / source / owner handle / contact filters and a search over title and contact name; 1-200 per page; most recently updated first; total_count is the filtered total.';
revoke all on function public.plus_list_opportunities(uuid, text, text, text, text, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.plus_list_opportunities(uuid, text, text, text, text, uuid, uuid, integer, integer) to authenticated;

create function public.plus_get_opportunity(p_organization_id uuid, p_opportunity_id uuid)
returns table (
  opportunity_id uuid,
  channel text,
  title text,
  stage text,
  contact_id uuid,
  contact_name text,
  contact_status text,
  contact_do_not_contact boolean,
  inquiry_type text,
  service_type text,
  source text,
  source_detail text,
  campaign_code text,
  estimated_value_cents bigint,
  payment_reported_status text,
  lost_reason text,
  lost_note text,
  owner_membership_id uuid,
  owner_name text,
  owner_can_write boolean,
  closed_at timestamptz,
  created_by_name text,
  created_at timestamptz,
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
  return query
  select o.id, o.channel, o.title, o.stage, c.id, c.display_name, c.status, c.do_not_contact, o.inquiry_type, o.service_type,
         o.source, o.source_detail, o.campaign_code, o.estimated_value_cents, o.payment_reported_status, o.lost_reason, o.lost_note,
         (select m.id from public.memberships m where m.organization_id = o.organization_id and m.user_id = o.owner_user_id),
         case when o.owner_user_id is null then null else public._plus_staff_name(o.owner_user_id) end,
         case when o.owner_user_id is null then null else public._plus_user_can_write(o.organization_id, o.owner_user_id) end,
         o.closed_at, public._plus_staff_name(o.created_by), o.created_at, o.updated_at
  from public.plus_opportunities o
  join public.plus_contacts c on c.id = o.primary_contact_id and c.organization_id = o.organization_id
  where o.id = p_opportunity_id and o.organization_id = p_organization_id;
  if not found then
    -- foreign, unknown or NULL id: the same answer as no access (no existence oracle)
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
end;
$$;
comment on function public.plus_get_opportunity(uuid, uuid) is
  'NP-P2-S1. Plus READ. One opportunity of p_organization_id with its contact''s name / status / do-not-contact flag (ZW002 for no access AND for a foreign / unknown id). owner_membership_id is an opaque handle; updated_at is the version token.';
revoke all on function public.plus_get_opportunity(uuid, uuid) from public, anon;
grant execute on function public.plus_get_opportunity(uuid, uuid) to authenticated;

create function public.plus_list_opportunity_activities(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_limit integer,
  p_offset integer
)
returns table (
  activity_id uuid,
  activity_type text,
  from_stage text,
  to_stage text,
  body text,
  actor_name text,
  occurred_at timestamptz,
  recorded_at timestamptz,
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
  if v_limit < 1 or v_limit > 100 or v_offset < 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not exists (select 1 from public.plus_opportunities o where o.id = p_opportunity_id and o.organization_id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select a.id, a.activity_type, a.from_stage, a.to_stage, a.body, public._plus_staff_name(a.actor_user_id), a.occurred_at, a.recorded_at,
         count(*) over ()
  from public.plus_activities a
  where a.organization_id = p_organization_id and a.opportunity_id = p_opportunity_id
  order by a.occurred_at desc, a.recorded_at desc, a.id
  limit v_limit offset v_offset;
end;
$$;
comment on function public.plus_list_opportunity_activities(uuid, uuid, integer, integer) is
  'NP-P2-S1. Plus READ. The opportunity''s history (stage changes with from / to stage, owner changes), newest first. ZW002 for no access or a foreign / unknown opportunity.';
revoke all on function public.plus_list_opportunity_activities(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.plus_list_opportunity_activities(uuid, uuid, integer, integer) to authenticated;

-- =============================================================================
-- 4. write RPCs (Plus write)
-- =============================================================================
-- An ACTIVE contact of the organization, locked against a concurrent archive; ZW006 when archived, ZW002 when unknown / foreign.
create function public._plus_require_active_contact(p_organization_id uuid, p_contact_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select c.status into v_status from public.plus_contacts c
  where c.id = p_contact_id and c.organization_id = p_organization_id
  for no key update;
  if v_status is null or v_status = 'redacted' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_status <> 'active' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  return p_contact_id;
end;
$$;
comment on function public._plus_require_active_contact(uuid, uuid) is
  'NP-P2-S1. INTERNAL. Locks (FOR NO KEY UPDATE) and returns an ACTIVE contact of the organization: unknown / foreign ZW002, archived ZW006. Serializes with plus_archive_contact.';
revoke all on function public._plus_require_active_contact(uuid, uuid) from public, anon, authenticated, service_role;

create function public.plus_create_opportunity(
  p_organization_id uuid,
  p_contact_id uuid,
  p_title text,
  p_inquiry_type text,
  p_service_type text,
  p_source text,
  p_source_detail text,
  p_campaign_code text,
  p_estimated_value_cents bigint,
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
  v_existing public.plus_opportunities%rowtype;
  v_row public.plus_opportunities%rowtype;
  v_result public.plus_opportunity_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  perform public._plus_require_active_contact(p_organization_id, p_contact_id);
  v_owner := public._plus_resolve_owner(p_organization_id, p_owner_membership_id);

  -- Accidental duplicate submission: the same opportunity by the same person for the same contact within 30 s.
  -- (The contact row lock above serializes concurrent creates for that contact, so this holds under concurrency.)
  select * into v_existing from public.plus_opportunities o
  where o.organization_id = p_organization_id and o.primary_contact_id = p_contact_id and o.created_by = auth.uid()
    and o.title = v_title and o.stage = 'new_inquiry' and o.created_at > now() - interval '30 seconds'
  order by o.created_at desc
  limit 1;
  if found then
    v_result.opportunity_id := v_existing.id;
    v_result.stage := v_existing.stage;
    v_result.updated_at := v_existing.updated_at;
    v_result.changed := false;
    return v_result;
  end if;

  begin
    insert into public.plus_opportunities (organization_id, channel, title, stage, primary_contact_id, inquiry_type, service_type,
                                           source, source_detail, campaign_code, estimated_value_cents, owner_user_id, created_by)
    values (p_organization_id, 'private_pay', v_title, 'new_inquiry', p_contact_id, p_inquiry_type, p_service_type,
            p_source, v_detail, v_campaign, p_estimated_value_cents, v_owner, auth.uid())
    returning * into v_row;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_opportunity', v_row.id, 'plus_opportunity_created', auth.uid(), null,
          jsonb_build_object('channel', 'private_pay', 'stage', 'new_inquiry', 'source', v_row.source));

  v_result.opportunity_id := v_row.id;
  v_result.stage := v_row.stage;
  v_result.updated_at := v_row.updated_at;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_create_opportunity(uuid, uuid, text, text, text, text, text, text, bigint, uuid) is
  'NP-P2-S1. Plus WRITE (_require_plus_write). Creates a PRIVATE-PAY opportunity in stage new_inquiry for an ACTIVE contact of p_organization_id (unknown / foreign contact ZW002; archived contact ZW006). Values are validated by the table (ZW006): title 1-200, inquiry / service / source closed sets, source detail <= 120, campaign code ^[a-z0-9][a-z0-9_-]*$ <= 64 (lower-cased), estimate 0..100000000 cents. Owner handle must be an eligible Plus writer (ZW006). The same opportunity by the same person for the same contact within 30 s is an idempotent no-op. Audited as plus_opportunity_created (no contact data copied). Never creates a Core Request, Passenger or Trip.';
revoke all on function public.plus_create_opportunity(uuid, uuid, text, text, text, text, text, text, bigint, uuid) from public, anon;
grant execute on function public.plus_create_opportunity(uuid, uuid, text, text, text, text, text, text, bigint, uuid) to authenticated;

create function public.plus_update_opportunity(
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
  'NP-P2-S1. Plus WRITE. Replaces the editable fields of an OPEN opportunity of p_organization_id (foreign / unknown ZW002; lost / converted ZW004). Row lock + p_expected_updated_at, else ZW003 (no lost update). A changed contact must be an active contact of the organization; a new owner must be an eligible writer. Identical values -> changed=false. An owner change writes an owner_changed activity on the opportunity. Audited as plus_opportunity_updated with the NAMES of changed fields only. channel and stage are not editable here.';
revoke all on function public.plus_update_opportunity(uuid, uuid, timestamptz, uuid, text, text, text, text, text, text, bigint, text, uuid) from public, anon;
grant execute on function public.plus_update_opportunity(uuid, uuid, timestamptz, uuid, text, text, text, text, text, text, bigint, text, uuid) to authenticated;

create function public.plus_change_opportunity_stage(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_expected_updated_at timestamptz,
  p_to_stage text,
  p_note text
)
returns public.plus_opportunity_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_old public.plus_opportunities%rowtype;
  v_new public.plus_opportunities%rowtype;
  v_result public.plus_opportunity_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  -- open stages only: lost has its own RPC (reason required); converted is RESERVED for the P2-S4 Core conversion
  if p_to_stage is null or p_to_stage not in ('new_inquiry', 'contacted', 'qualified', 'quote_sent', 'quote_accepted') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_old from public.plus_opportunities
  where id = p_opportunity_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_result.opportunity_id := v_old.id;
  -- already there (e.g. a duplicate submission): idempotent no-op, no second history row
  if v_old.stage = p_to_stage then
    v_result.stage := v_old.stage;
    v_result.updated_at := v_old.updated_at;
    v_result.changed := false;
    return v_result;
  end if;
  if v_old.stage in ('lost', 'converted') then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  -- between open stages, forward skips and backward moves are both allowed (product spec 4.3)
  update public.plus_opportunities set stage = p_to_stage where id = v_old.id returning * into v_new;
  insert into public.plus_activities (organization_id, opportunity_id, activity_type, from_stage, to_stage, body, actor_user_id)
  values (p_organization_id, v_old.id, 'stage_changed', v_old.stage, p_to_stage, v_note, auth.uid());

  v_result.stage := v_new.stage;
  v_result.updated_at := v_new.updated_at;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_change_opportunity_stage(uuid, uuid, timestamptz, text, text) is
  'NP-P2-S1. Plus WRITE. Moves an OPEN opportunity to another OPEN stage (new_inquiry, contacted, qualified, quote_sent, quote_accepted; forward skips and backward moves allowed). lost -> use plus_mark_opportunity_lost; converted is reserved for the P2-S4 Core conversion (ZW006 here). Already in the target stage -> changed=false. Lost / converted opportunity ZW004; stale version ZW003; foreign / unknown ZW002. Writes one stage_changed activity (from, to, actor, optional note <= 500). quote_sent / quote_accepted are STAFF-REPORTED: no quote document exists before P2-S5.';
revoke all on function public.plus_change_opportunity_stage(uuid, uuid, timestamptz, text, text) from public, anon;
grant execute on function public.plus_change_opportunity_stage(uuid, uuid, timestamptz, text, text) to authenticated;

create function public.plus_mark_opportunity_lost(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_expected_updated_at timestamptz,
  p_lost_reason text,
  p_lost_note text
)
returns public.plus_opportunity_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(p_lost_note), '');
  v_old public.plus_opportunities%rowtype;
  v_new public.plus_opportunities%rowtype;
  v_result public.plus_opportunity_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  if p_lost_reason is null or p_lost_reason not in ('no_response', 'price', 'chose_competitor', 'outside_service_area',
                                                    'service_not_offered', 'no_availability', 'not_a_fit', 'duplicate', 'other')
     or (p_lost_reason = 'other' and v_note is null) or (v_note is not null and length(v_note) > 500) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_old from public.plus_opportunities
  where id = p_opportunity_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_result.opportunity_id := v_old.id;
  -- already lost (e.g. a duplicate submission): idempotent no-op
  if v_old.stage = 'lost' then
    v_result.stage := v_old.stage;
    v_result.updated_at := v_old.updated_at;
    v_result.changed := false;
    return v_result;
  end if;
  if v_old.stage = 'converted' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  update public.plus_opportunities
  set stage = 'lost', lost_reason = p_lost_reason, lost_note = v_note, closed_at = now()
  where id = v_old.id
  returning * into v_new;
  insert into public.plus_activities (organization_id, opportunity_id, activity_type, from_stage, to_stage, body, actor_user_id)
  values (p_organization_id, v_old.id, 'stage_changed', v_old.stage, 'lost', v_note, auth.uid());

  v_result.stage := v_new.stage;
  v_result.updated_at := v_new.updated_at;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_mark_opportunity_lost(uuid, uuid, timestamptz, text, text) is
  'NP-P2-S1. Plus WRITE. Marks an OPEN opportunity lost with a reason from the closed set (other requires a note <= 500; ZW006). Already lost -> changed=false; converted ZW004; stale ZW003; foreign / unknown ZW002. Sets closed_at; writes one stage_changed activity (from -> lost; the note as body).';
revoke all on function public.plus_mark_opportunity_lost(uuid, uuid, timestamptz, text, text) from public, anon;
grant execute on function public.plus_mark_opportunity_lost(uuid, uuid, timestamptz, text, text) to authenticated;

create function public.plus_reopen_opportunity(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_expected_updated_at timestamptz,
  p_to_stage text,
  p_reason text
)
returns public.plus_opportunity_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_old public.plus_opportunities%rowtype;
  v_new public.plus_opportunities%rowtype;
  v_result public.plus_opportunity_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  if p_to_stage is null or p_to_stage not in ('new_inquiry', 'contacted', 'qualified', 'quote_sent', 'quote_accepted')
     or v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_old from public.plus_opportunities
  where id = p_opportunity_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  -- only a LOST opportunity can be reopened in P2-S1 (converted belongs to the P2-S4 conversion workflow)
  if v_old.stage <> 'lost' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  update public.plus_opportunities
  set stage = p_to_stage, lost_reason = null, lost_note = null, closed_at = null
  where id = v_old.id
  returning * into v_new;
  insert into public.plus_activities (organization_id, opportunity_id, activity_type, from_stage, to_stage, body, actor_user_id)
  values (p_organization_id, v_old.id, 'stage_changed', 'lost', p_to_stage, v_reason, auth.uid());

  v_result.opportunity_id := v_old.id;
  v_result.stage := v_new.stage;
  v_result.updated_at := v_new.updated_at;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_reopen_opportunity(uuid, uuid, timestamptz, text, text) is
  'NP-P2-S1. Plus WRITE. Reopens a LOST opportunity of p_organization_id into an open stage with a required reason (3-500; ZW006). Stale version ZW003 (so a duplicate reopen is refused, never applied twice); not lost ZW004; foreign / unknown ZW002. Clears lost_reason / lost_note / closed_at; writes one stage_changed activity (lost -> stage, the reason as body).';
revoke all on function public.plus_reopen_opportunity(uuid, uuid, timestamptz, text, text) from public, anon;
grant execute on function public.plus_reopen_opportunity(uuid, uuid, timestamptz, text, text) to authenticated;
