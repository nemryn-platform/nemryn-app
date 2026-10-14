-- NP-P1-S4 -- Nemryn Plus Contacts and the append-only activity timeline (first CRM data).
--
-- Canonical design: docs/product/plus-domain-model.md sections 3.2 (P1-S4 row), 6, 7 and 15;
-- docs/security/plus-access-model.md sections 3.2 and 5 (C1 / C2 / C6).
--
-- WHAT (additive; references only Core and earlier Plus objects -- no forward FK):
--   1. plus_contacts      -- people a workspace sells to or works with. NO account_id (P3-S1 adds it). No passenger link,
--                            date of birth, address, health, insurance or trip field of any kind.
--   2. plus_activities    -- append-only timeline. contact_id is the only subject in S4; plus_activities_subject_check is
--                            `num_nonnulls(contact_id) = 1`, replaced additively by P2-S1 / P2-S3 / P3-S1.
--   3. internal helpers   -- _plus_user_can_write (owner eligibility), _plus_contact_matches (duplicate warnings).
--   4. RPCs               -- list / get / activities / matches / owner options (Plus read or write), create / update /
--                            archive / log activity (Plus write). Every RPC re-checks Plus authority in the database.
--
-- ACCESS (access model 3.2): RLS on both tables; SELECT granted to authenticated with the policy
-- plus_can_read(organization_id) (Admin while write / read_only; named Dispatcher with an active read/write grant while
-- write). NO insert / update / delete privilege or policy for any client role: writes only through the RPCs, which call
-- _require_plus_write first. There is no update or delete path for activities at all (append-only, T20).
--
-- AUDIT: plus_activities is the Plus timeline (owner_changed, record_archived, logged interactions). Contact create /
-- edit / archive additionally write one audit_events row each, recording WHICH fields changed -- never their values, so
-- no contact data is copied into the Core audit log. (These actions are not in the Core Settings -> Activity allow-list.)
--
-- PRIVACY: synthetic data only until PD-10 (HIPAA / BAA) and PD-11 (retention / redaction) are resolved. `redacted` is
-- reserved in the status CHECK (domain model 6) but NO function sets it -- no redaction workflow before PD-11.

-- =============================================================================
-- 1. plus_contacts
-- =============================================================================
create table public.plus_contacts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  display_name text not null,
  phone text,
  email text,
  contact_kind text not null,
  job_title text,
  preferred_channel text not null default 'phone',
  do_not_contact boolean not null default false,
  owner_user_id uuid references auth.users (id),
  status text not null default 'active',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plus_contacts_id_organization_id_key unique (id, organization_id),
  constraint plus_contacts_display_name_check check (display_name = btrim(display_name) and length(display_name) between 1 and 200),
  -- digits, spaces and + ( ) . - ; an optional extension "x123" / "ext 123"; 7-20 digits in total
  constraint plus_contacts_phone_check check (
    phone is null or (
      phone = btrim(phone) and length(phone) <= 40
      and phone ~ '^[0-9+(). -]+( ?(x|ext\.?) ?[0-9]{1,6})?$'
      and length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 20
    )
  ),
  -- stored normalized: trimmed and lower-cased
  constraint plus_contacts_email_check check (
    email is null or (email = lower(btrim(email)) and length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  constraint plus_contacts_contact_kind_check check (contact_kind in ('individual', 'family_caregiver', 'facility_staff', 'referral_source', 'other')),
  constraint plus_contacts_job_title_check check (job_title is null or (job_title = btrim(job_title) and length(job_title) between 1 and 120)),
  constraint plus_contacts_preferred_channel_check check (preferred_channel in ('phone', 'email', 'none')),
  constraint plus_contacts_status_check check (status in ('active', 'archived', 'redacted')),
  -- reachable unless redacted (domain model 6)
  constraint plus_contacts_reachable_check check (phone is not null or email is not null or status = 'redacted')
);

comment on table public.plus_contacts is
  'NP-P1-S4. TENANT-OWNED Nemryn Plus contact (business or consumer contact data only: access model C1 / C2). SELECT via RLS plus_can_read(organization_id); writes only through plus_create_contact / plus_update_contact / plus_archive_contact. Never holds passenger, date-of-birth, address, health, insurance or trip data. Duplicates are allowed (warned, never merged). Archived rows keep their history; no hard delete. account_id arrives in P3-S1.';
comment on column public.plus_contacts.do_not_contact is
  'Stored preference. Every FUTURE outbound action (none exists in S4) must refuse when true.';
comment on column public.plus_contacts.owner_user_id is
  'Optional owner. When set by an RPC, must be a member who can write Plus in this organization (Organization Admin, or a Dispatcher with an active write grant).';

create index plus_contacts_org_status_name_idx on public.plus_contacts (organization_id, status, display_name);
create index plus_contacts_org_lower_name_idx on public.plus_contacts (organization_id, lower(display_name));
create index plus_contacts_org_email_idx on public.plus_contacts (organization_id, email) where email is not null;
create index plus_contacts_org_phone_idx on public.plus_contacts (organization_id, phone) where phone is not null;
create index plus_contacts_org_phone_digits_idx on public.plus_contacts (organization_id, (regexp_replace(phone, '[^0-9]', '', 'g'))) where phone is not null;

create trigger plus_contacts_set_updated_at
  before update on public.plus_contacts
  for each row execute function public.set_updated_at();
create trigger plus_contacts_prevent_org_change
  before update on public.plus_contacts
  for each row execute function public.prevent_organization_id_change();

alter table public.plus_contacts enable row level security;
revoke all on table public.plus_contacts from public, anon, authenticated, service_role;
grant select on table public.plus_contacts to authenticated;
create policy plus_contacts_select_plus on public.plus_contacts
  for select to authenticated
  using (public.plus_can_read(organization_id));

-- =============================================================================
-- 2. plus_activities (append-only)
-- =============================================================================
create table public.plus_activities (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  contact_id uuid,
  activity_type text not null,
  body text,
  from_stage text,
  to_stage text,
  actor_user_id uuid not null references auth.users (id),
  occurred_at timestamptz not null default now(),
  -- when the row was written (occurred_at may be earlier for an interaction logged after the fact)
  recorded_at timestamptz not null default now(),
  constraint plus_activities_id_organization_id_key unique (id, organization_id),
  constraint plus_activities_contact_fkey
    foreign key (contact_id, organization_id) references public.plus_contacts (id, organization_id),
  -- Replaced additively as subjects ship: P2-S1 num_nonnulls(contact_id, opportunity_id) >= 1, then P2-S3 / P3-S1.
  constraint plus_activities_subject_check check (num_nonnulls(contact_id) = 1),
  -- S4 types only (implemented): logged interactions + the two system events S4 produces. Replaced additively later.
  constraint plus_activities_activity_type_check check (
    activity_type in ('note', 'call_logged', 'email_logged', 'meeting_logged', 'owner_changed', 'record_archived')
  ),
  constraint plus_activities_body_check check (body is null or (body = btrim(body) and length(body) between 1 and 2000)),
  constraint plus_activities_body_required_check check (
    activity_type not in ('note', 'call_logged', 'email_logged', 'meeting_logged') or body is not null
  ),
  -- stage columns exist for P2-S1 (domain model 7) and are only ever set on stage_changed, which S4 does not allow
  constraint plus_activities_stage_check check (
    (activity_type = 'stage_changed' and from_stage is not null and to_stage is not null
       and length(from_stage) <= 40 and length(to_stage) <= 40)
    or (activity_type <> 'stage_changed' and from_stage is null and to_stage is null)
  ),
  constraint plus_activities_occurred_check check (occurred_at <= recorded_at + interval '5 minutes')
);

comment on table public.plus_activities is
  'NP-P1-S4. TENANT-OWNED, APPEND-ONLY Nemryn Plus timeline. SELECT via RLS plus_can_read(organization_id); rows are written only by Plus RPCs and never updated or deleted (no privilege, policy or function does either). No metadata json. A *_logged row records an interaction staff had themselves -- Nemryn never sent, called or scheduled anything. Free text must not contain medical details (UI notice; not a guarantee).';

create index plus_activities_org_contact_idx on public.plus_activities (organization_id, contact_id, occurred_at desc, recorded_at desc);

alter table public.plus_activities enable row level security;
revoke all on table public.plus_activities from public, anon, authenticated, service_role;
grant select on table public.plus_activities to authenticated;
create policy plus_activities_select_plus on public.plus_activities
  for select to authenticated
  using (public.plus_can_read(organization_id));

-- =============================================================================
-- 3. internal helpers
-- =============================================================================
create function public._plus_user_can_write(p_organization_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_organization_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and o.status = 'active'
      and (
        m.role = 'organization_admin'
        or (m.role = 'dispatcher' and exists (
          select 1 from public.membership_module_grants g
          where g.membership_id = m.id and g.organization_id = m.organization_id
            and g.module = 'plus' and g.revoked_at is null and g.access = 'write'))
      )
  );
$$;
comment on function public._plus_user_can_write(uuid, uuid) is
  'NP-P1-S4. INTERNAL. Whether a GIVEN user (not the caller) is an eligible Plus writer in the organization: active member of an active organization who is an Organization Admin or a Dispatcher with an active write grant. Used to validate contact owners. Does not check the entitlement (callers already passed _require_plus_write).';
revoke all on function public._plus_user_can_write(uuid, uuid) from public, anon, authenticated, service_role;

-- Possible duplicates in ONE organization: same normalized email, same phone digits (>= 7), or same name (case-insensitive).
create function public._plus_contact_matches(
  p_organization_id uuid,
  p_display_name text,
  p_phone text,
  p_email text,
  p_exclude_contact_id uuid
)
returns table (contact_id uuid, display_name text, status text, match_on text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (
    select lower(nullif(btrim(p_display_name), '')) as name,
           nullif(lower(btrim(p_email)), '') as email,
           nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '') as digits
  )
  select c.id, c.display_name, c.status,
         array_to_string(array_remove(array[
           case when q.email is not null and c.email = q.email then 'email' end,
           case when q.digits is not null and length(q.digits) >= 7 and regexp_replace(c.phone, '[^0-9]', '', 'g') = q.digits then 'phone' end,
           case when q.name is not null and lower(c.display_name) = q.name then 'name' end
         ], null), ',')
  from public.plus_contacts c, q
  where c.organization_id = p_organization_id
    and (p_exclude_contact_id is null or c.id <> p_exclude_contact_id)
    and ((q.email is not null and c.email = q.email)
      or (q.digits is not null and length(q.digits) >= 7 and c.phone is not null and regexp_replace(c.phone, '[^0-9]', '', 'g') = q.digits)
      or (q.name is not null and lower(c.display_name) = q.name))
  order by (c.status = 'active') desc, c.display_name, c.id
  limit 5;
$$;
comment on function public._plus_contact_matches(uuid, text, text, text, uuid) is
  'NP-P1-S4. INTERNAL. Up to 5 contacts of ONE organization that may be the same person (same normalized email, same phone digits, or same name ignoring case). Warnings only: nothing is ever merged.';
revoke all on function public._plus_contact_matches(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;

-- Display name for a staff user without exposing their email address to other members.
create function public._plus_staff_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(btrim(p.display_name), ''), split_part(u.email::text, '@', 1), 'Team member')
  from auth.users u left join public.user_profiles p on p.id = u.id
  where u.id = p_user_id;
$$;
comment on function public._plus_staff_name(uuid) is
  'NP-P1-S4. INTERNAL. A staff member''s display name (profile name, else the local part of their email) for Plus lists and timelines.';
revoke all on function public._plus_staff_name(uuid) from public, anon, authenticated, service_role;

-- =============================================================================
-- 4. result types
-- =============================================================================
create type public.plus_contact_write_result as (
  contact_id uuid,
  updated_at timestamptz,
  changed boolean,
  possible_duplicates integer
);
comment on type public.plus_contact_write_result is
  'NP-P1-S4. Result of plus_create_contact / plus_update_contact / plus_archive_contact. changed=false: nothing was written (idempotent no-op, or -- for create -- possible duplicates found and not confirmed; contact_id is then NULL and possible_duplicates > 0). updated_at is the new version token.';

create type public.plus_activity_write_result as (
  activity_id uuid,
  changed boolean
);

-- =============================================================================
-- 5. read RPCs (Plus read)
-- =============================================================================
create function public.plus_list_contacts(
  p_organization_id uuid,
  p_search text,
  p_contact_kind text,
  p_status text,
  p_limit integer,
  p_offset integer
)
returns table (
  contact_id uuid,
  display_name text,
  phone text,
  email text,
  contact_kind text,
  job_title text,
  preferred_channel text,
  do_not_contact boolean,
  status text,
  owner_name text,
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
  v_digits text;
  v_limit integer := coalesce(p_limit, 25);
  v_offset integer := coalesce(p_offset, 0);
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if (p_status is not null and p_status not in ('active', 'archived', 'all'))
     or (p_contact_kind is not null and p_contact_kind not in ('individual', 'family_caregiver', 'facility_staff', 'referral_source', 'other'))
     or v_limit < 1 or v_limit > 100 or v_offset < 0 or length(coalesce(v_q, '')) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := nullif(regexp_replace(v_q, '[^0-9]', '', 'g'), '');
  end if;

  return query
  select c.id, c.display_name, c.phone, c.email, c.contact_kind, c.job_title, c.preferred_channel, c.do_not_contact,
         c.status, case when c.owner_user_id is null then null else public._plus_staff_name(c.owner_user_id) end,
         c.updated_at, count(*) over ()
  from public.plus_contacts c
  where c.organization_id = p_organization_id
    and c.status <> 'redacted'
    and (coalesce(p_status, 'active') = 'all' or c.status = coalesce(p_status, 'active'))
    and (p_contact_kind is null or c.contact_kind = p_contact_kind)
    and (v_q is null
         or lower(c.display_name) like v_like
         or (c.email is not null and c.email like v_like)
         or (v_digits is not null and length(v_digits) >= 3 and c.phone is not null
             and regexp_replace(c.phone, '[^0-9]', '', 'g') like '%' || v_digits || '%'))
  order by lower(c.display_name), c.id
  limit v_limit offset v_offset;
end;
$$;
comment on function public.plus_list_contacts(uuid, text, text, text, integer, integer) is
  'NP-P1-S4. Plus READ (plus_can_read; ZW002 otherwise, ZW001 without a uid). One page (1-100, default 25) of the organization''s contacts, filtered by status (active default | archived | all), kind, and a search over name, email and phone digits; total_count is the filtered total. Owner shown by name only.';
revoke all on function public.plus_list_contacts(uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.plus_list_contacts(uuid, text, text, text, integer, integer) to authenticated;

create function public.plus_get_contact(p_organization_id uuid, p_contact_id uuid)
returns table (
  contact_id uuid,
  display_name text,
  phone text,
  email text,
  contact_kind text,
  job_title text,
  preferred_channel text,
  do_not_contact boolean,
  status text,
  owner_membership_id uuid,
  owner_name text,
  owner_can_write boolean,
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
  select c.id, c.display_name, c.phone, c.email, c.contact_kind, c.job_title, c.preferred_channel, c.do_not_contact,
         c.status,
         (select m.id from public.memberships m where m.organization_id = c.organization_id and m.user_id = c.owner_user_id),
         case when c.owner_user_id is null then null else public._plus_staff_name(c.owner_user_id) end,
         case when c.owner_user_id is null then null else public._plus_user_can_write(c.organization_id, c.owner_user_id) end,
         public._plus_staff_name(c.created_by), c.created_at, c.updated_at
  from public.plus_contacts c
  where c.id = p_contact_id and c.organization_id = p_organization_id and c.status <> 'redacted';
  if not found then
    -- a foreign, unknown or NULL id: the same answer as no access (no existence oracle)
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
end;
$$;
comment on function public.plus_get_contact(uuid, uuid) is
  'NP-P1-S4. Plus READ. One contact of p_organization_id (ZW002 for no access AND for a foreign / unknown id -- no existence oracle). owner_membership_id is an opaque handle for the edit form; updated_at is the version token.';
revoke all on function public.plus_get_contact(uuid, uuid) from public, anon;
grant execute on function public.plus_get_contact(uuid, uuid) to authenticated;

create function public.plus_list_contact_activities(
  p_organization_id uuid,
  p_contact_id uuid,
  p_limit integer,
  p_offset integer
)
returns table (
  activity_id uuid,
  activity_type text,
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
  if not exists (select 1 from public.plus_contacts c
                 where c.id = p_contact_id and c.organization_id = p_organization_id and c.status <> 'redacted') then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select a.id, a.activity_type, a.body, public._plus_staff_name(a.actor_user_id), a.occurred_at, a.recorded_at, count(*) over ()
  from public.plus_activities a
  where a.organization_id = p_organization_id and a.contact_id = p_contact_id
  order by a.occurred_at desc, a.recorded_at desc, a.id
  limit v_limit offset v_offset;
end;
$$;
comment on function public.plus_list_contact_activities(uuid, uuid, integer, integer) is
  'NP-P1-S4. Plus READ. The contact''s timeline, newest first (1-100 per page, default 50). ZW002 for no access or a foreign / unknown contact.';
revoke all on function public.plus_list_contact_activities(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.plus_list_contact_activities(uuid, uuid, integer, integer) to authenticated;

create function public.plus_find_contact_matches(
  p_organization_id uuid,
  p_display_name text,
  p_phone text,
  p_email text,
  p_exclude_contact_id uuid
)
returns table (contact_id uuid, display_name text, status text, match_on text)
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
  return query select * from public._plus_contact_matches(p_organization_id, p_display_name, p_phone, p_email, p_exclude_contact_id);
end;
$$;
comment on function public.plus_find_contact_matches(uuid, text, text, text, uuid) is
  'NP-P1-S4. Plus READ. Possible duplicates of the given name / phone / email in p_organization_id only (up to 5; match_on lists email, phone, name). For the "possible duplicate" warning -- never merges.';
revoke all on function public.plus_find_contact_matches(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.plus_find_contact_matches(uuid, text, text, text, uuid) to authenticated;

create function public.plus_list_contact_owner_options(p_organization_id uuid)
returns table (membership_id uuid, display_name text, is_self boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_plus_write(p_organization_id);
  return query
  select m.id, public._plus_staff_name(m.user_id), (m.user_id = auth.uid())
  from public.memberships m
  where m.organization_id = p_organization_id and m.status = 'active'
    and public._plus_user_can_write(p_organization_id, m.user_id)
  order by (m.user_id = auth.uid()) desc, public._plus_staff_name(m.user_id), m.id;
end;
$$;
comment on function public.plus_list_contact_owner_options(uuid) is
  'NP-P1-S4. Plus WRITE (_require_plus_write). The members who may own a contact: active Organization Admins and Dispatchers with an active write grant. membership_id is an opaque handle; no user id or email is returned.';
revoke all on function public.plus_list_contact_owner_options(uuid) from public, anon;
grant execute on function public.plus_list_contact_owner_options(uuid) to authenticated;

-- =============================================================================
-- 6. write RPCs (Plus write)
-- =============================================================================
-- Resolves an owner handle (membership id) to an eligible writer's user id; ZW006 for anything else.
create function public._plus_resolve_owner(p_organization_id uuid, p_owner_membership_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  if p_owner_membership_id is null then
    return null;
  end if;
  select m.user_id into v_user from public.memberships m
  where m.id = p_owner_membership_id and m.organization_id = p_organization_id;
  if v_user is null or not public._plus_user_can_write(p_organization_id, v_user) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  return v_user;
end;
$$;
revoke all on function public._plus_resolve_owner(uuid, uuid) from public, anon, authenticated, service_role;

create function public.plus_create_contact(
  p_organization_id uuid,
  p_display_name text,
  p_phone text,
  p_email text,
  p_contact_kind text,
  p_job_title text,
  p_preferred_channel text,
  p_do_not_contact boolean,
  p_owner_membership_id uuid,
  p_confirm_possible_duplicate boolean
)
returns public.plus_contact_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := nullif(btrim(p_display_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_title text := nullif(btrim(p_job_title), '');
  v_owner uuid;
  v_matches integer;
  v_row public.plus_contacts%rowtype;
  v_result public.plus_contact_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  v_owner := public._plus_resolve_owner(p_organization_id, p_owner_membership_id);

  -- Validation is the table's CHECKs (check_violation -> ZW006 below); a contact needs a phone or an email.
  if v_phone is null and v_email is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Possible duplicates: warn, never merge. Nothing is written until the caller confirms.
  select count(*) into v_matches from public._plus_contact_matches(p_organization_id, v_name, v_phone, v_email, null);
  if v_matches > 0 and not coalesce(p_confirm_possible_duplicate, false) then
    v_result.contact_id := null;
    v_result.changed := false;
    v_result.possible_duplicates := v_matches;
    return v_result;
  end if;

  begin
    insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, job_title,
                                      preferred_channel, do_not_contact, owner_user_id, created_by)
    values (p_organization_id, v_name, v_phone, v_email, p_contact_kind, v_title,
            coalesce(p_preferred_channel, 'phone'), coalesce(p_do_not_contact, false), v_owner, auth.uid())
    returning * into v_row;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_contact', v_row.id, 'plus_contact_created', auth.uid(), null,
          jsonb_build_object('possible_duplicates_confirmed', v_matches));

  v_result.contact_id := v_row.id;
  v_result.updated_at := v_row.updated_at;
  v_result.changed := true;
  v_result.possible_duplicates := v_matches;
  return v_result;
end;
$$;
comment on function public.plus_create_contact(uuid, text, text, text, text, text, text, boolean, uuid, boolean) is
  'NP-P1-S4. Plus WRITE (_require_plus_write: ZW002 no read access, ZW001 read-only / read grant). Creates a contact in p_organization_id (from the server session, never the browser). Inputs are trimmed; email lower-cased; invalid values ZW006 (needs phone or email). Owner handle must be an eligible Plus writer of the organization (ZW006). If possible duplicates exist and p_confirm_possible_duplicate is not true: NOTHING is written, changed=false, possible_duplicates=n. Audited as plus_contact_created (no contact values copied).';
revoke all on function public.plus_create_contact(uuid, text, text, text, text, text, text, boolean, uuid, boolean) from public, anon;
grant execute on function public.plus_create_contact(uuid, text, text, text, text, text, text, boolean, uuid, boolean) to authenticated;

create function public.plus_update_contact(
  p_organization_id uuid,
  p_contact_id uuid,
  p_expected_updated_at timestamptz,
  p_display_name text,
  p_phone text,
  p_email text,
  p_contact_kind text,
  p_job_title text,
  p_preferred_channel text,
  p_do_not_contact boolean,
  p_owner_membership_id uuid
)
returns public.plus_contact_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := nullif(btrim(p_display_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_title text := nullif(btrim(p_job_title), '');
  v_owner uuid;
  v_old public.plus_contacts%rowtype;
  v_new public.plus_contacts%rowtype;
  v_fields text[] := array[]::text[];
  v_result public.plus_contact_write_result;
begin
  perform public._require_plus_write(p_organization_id);

  select * into v_old from public.plus_contacts
  where id = p_contact_id and organization_id = p_organization_id
  for update;
  if not found or v_old.status = 'redacted' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_old.status <> 'active' then
    -- archived contacts are history: read-only
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- An owner that is unchanged is kept even if they have since lost write access; a NEW owner must be eligible.
  if p_owner_membership_id is not null
     and v_old.owner_user_id is not null
     and exists (select 1 from public.memberships m where m.id = p_owner_membership_id
                 and m.organization_id = p_organization_id and m.user_id = v_old.owner_user_id) then
    v_owner := v_old.owner_user_id;
  else
    v_owner := public._plus_resolve_owner(p_organization_id, p_owner_membership_id);
  end if;

  if v_phone is null and v_email is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if v_old.display_name is distinct from v_name then v_fields := array_append(v_fields, 'display_name'); end if;
  if v_old.phone is distinct from v_phone then v_fields := array_append(v_fields, 'phone'); end if;
  if v_old.email is distinct from v_email then v_fields := array_append(v_fields, 'email'); end if;
  if v_old.contact_kind is distinct from p_contact_kind then v_fields := array_append(v_fields, 'contact_kind'); end if;
  if v_old.job_title is distinct from v_title then v_fields := array_append(v_fields, 'job_title'); end if;
  if v_old.preferred_channel is distinct from p_preferred_channel then v_fields := array_append(v_fields, 'preferred_channel'); end if;
  if v_old.do_not_contact is distinct from p_do_not_contact then v_fields := array_append(v_fields, 'do_not_contact'); end if;
  if v_old.owner_user_id is distinct from v_owner then v_fields := array_append(v_fields, 'owner'); end if;

  v_result.contact_id := v_old.id;
  v_result.possible_duplicates := 0;
  if cardinality(v_fields) = 0 then
    v_result.updated_at := v_old.updated_at;
    v_result.changed := false;
    return v_result;
  end if;

  begin
    update public.plus_contacts
    set display_name = v_name, phone = v_phone, email = v_email, contact_kind = p_contact_kind, job_title = v_title,
        preferred_channel = p_preferred_channel, do_not_contact = p_do_not_contact, owner_user_id = v_owner
    where id = v_old.id
    returning * into v_new;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;

  if 'owner' = any (v_fields) then
    insert into public.plus_activities (organization_id, contact_id, activity_type, body, actor_user_id)
    values (p_organization_id, v_old.id, 'owner_changed',
            case when v_owner is null then 'Owner removed' else 'Owner: ' || public._plus_staff_name(v_owner) end, auth.uid());
  end if;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_contact', v_old.id, 'plus_contact_updated', auth.uid(), null,
          jsonb_build_object('fields', to_jsonb(v_fields)));

  v_result.updated_at := v_new.updated_at;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_update_contact(uuid, uuid, timestamptz, text, text, text, text, text, text, boolean, uuid) is
  'NP-P1-S4. Plus WRITE. Replaces the editable fields of an ACTIVE contact of p_organization_id (foreign / unknown ZW002; archived ZW004). p_expected_updated_at must equal the row''s updated_at under the row lock, else ZW003 (no lost update). Identical values -> changed=false, nothing written. An owner change writes an owner_changed activity. Audited as plus_contact_updated with the NAMES of the changed fields only.';
revoke all on function public.plus_update_contact(uuid, uuid, timestamptz, text, text, text, text, text, text, boolean, uuid) from public, anon;
grant execute on function public.plus_update_contact(uuid, uuid, timestamptz, text, text, text, text, text, text, boolean, uuid) to authenticated;

create function public.plus_archive_contact(
  p_organization_id uuid,
  p_contact_id uuid,
  p_expected_updated_at timestamptz,
  p_reason text
)
returns public.plus_contact_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_old public.plus_contacts%rowtype;
  v_new public.plus_contacts%rowtype;
  v_result public.plus_contact_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_old from public.plus_contacts
  where id = p_contact_id and organization_id = p_organization_id
  for update;
  if not found or v_old.status = 'redacted' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_result.contact_id := v_old.id;
  v_result.possible_duplicates := 0;
  -- already archived (e.g. a duplicate submission): idempotent no-op
  if v_old.status = 'archived' then
    v_result.updated_at := v_old.updated_at;
    v_result.changed := false;
    return v_result;
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  update public.plus_contacts set status = 'archived' where id = v_old.id returning * into v_new;
  insert into public.plus_activities (organization_id, contact_id, activity_type, body, actor_user_id)
  values (p_organization_id, v_old.id, 'record_archived', v_reason, auth.uid());
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_contact', v_old.id, 'plus_contact_archived', auth.uid(),
          jsonb_build_object('status', 'active'), jsonb_build_object('status', 'archived'));

  v_result.updated_at := v_new.updated_at;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_archive_contact(uuid, uuid, timestamptz, text) is
  'NP-P1-S4. Plus WRITE. Archives an active contact of p_organization_id (foreign / unknown ZW002; stale version ZW003; already archived -> changed=false). The row and its whole timeline are kept (no delete). Writes a record_archived activity (optional reason <= 500 as its body) and a plus_contact_archived audit event.';
revoke all on function public.plus_archive_contact(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.plus_archive_contact(uuid, uuid, timestamptz, text) to authenticated;

create function public.plus_log_contact_activity(
  p_organization_id uuid,
  p_contact_id uuid,
  p_activity_type text,
  p_body text,
  p_occurred_at timestamptz
)
returns public.plus_activity_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text := nullif(btrim(p_body), '');
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_contact public.plus_contacts%rowtype;
  v_existing uuid;
  v_id uuid;
  v_result public.plus_activity_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  -- staff-loggable types only; owner_changed / record_archived are written by the system
  if p_activity_type is null or p_activity_type not in ('note', 'call_logged', 'email_logged', 'meeting_logged') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_body is null or length(v_body) > 2000 or v_at > now() + interval '5 minutes' or v_at < now() - interval '366 days' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- FOR NO KEY UPDATE: concurrent log calls on the same contact serialize (so the duplicate guard below holds under
  -- real concurrency) and wait for an in-flight archive / edit; the FK check of the insert is not blocked.
  select * into v_contact from public.plus_contacts
  where id = p_contact_id and organization_id = p_organization_id
  for no key update;
  if not found or v_contact.status = 'redacted' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_contact.status <> 'active' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- Accidental duplicate submission: the same entry by the same person within 30 seconds is not written twice.
  select a.id into v_existing from public.plus_activities a
  where a.organization_id = p_organization_id and a.contact_id = v_contact.id and a.actor_user_id = auth.uid()
    and a.activity_type = p_activity_type and a.body = v_body
    -- "now" entries carry each transaction's own now(): compare the time only when the caller gave one explicitly
    and (p_occurred_at is null or a.occurred_at = p_occurred_at)
    and a.recorded_at > now() - interval '30 seconds'
  limit 1;
  if v_existing is not null then
    v_result.activity_id := v_existing;
    v_result.changed := false;
    return v_result;
  end if;

  insert into public.plus_activities (organization_id, contact_id, activity_type, body, actor_user_id, occurred_at)
  values (p_organization_id, v_contact.id, p_activity_type, v_body, auth.uid(), v_at)
  returning id into v_id;

  v_result.activity_id := v_id;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_log_contact_activity(uuid, uuid, text, text, timestamptz) is
  'NP-P1-S4. Plus WRITE. Appends a note / call_logged / email_logged / meeting_logged entry (body 1-2000 required; occurred_at NULL = now, not in the future, at most 366 days back) to an ACTIVE contact of p_organization_id (foreign / unknown ZW002; archived ZW004; other types ZW006). Logging records what staff did -- Nemryn sends, calls and schedules nothing. The same entry by the same person within 30 s is an idempotent no-op. Activities can never be updated or deleted.';
revoke all on function public.plus_log_contact_activity(uuid, uuid, text, text, timestamptz) from public, anon;
grant execute on function public.plus_log_contact_activity(uuid, uuid, text, text, timestamptz) to authenticated;
