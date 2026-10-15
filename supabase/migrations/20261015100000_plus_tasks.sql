-- NP-P2-S2 (Phase A) -- Nemryn Plus tasks & follow-ups (plus_tasks).
--
-- Canonical design: docs/product/plus-domain-model.md section 9 and 3.2 (P2-S2 row); product spec 7.3 (Tasks page).
--
-- WHAT (forward-only, additive; references only Core and earlier Plus objects -- no forward FK):
--   plus_tasks: an internal follow-up for exactly ONE subject -- a contact OR an opportunity
--   (plus_tasks_subject_check: num_nonnulls(contact_id, opportunity_id) = 1; P3-S1 adds account_id and replaces it).
--   No account_id (P3), no Core request_id. Statuses open | done | cancelled; completion stamps completed_at /
--   completed_by; nothing is ever deleted. updated_at is the concurrency token.
--   RPCs: list / get (Plus read); create / update / reassign / complete / cancel (Plus write, _require_plus_write).
--
-- A task is INTERNAL WORK for staff. It is never a customer communication, sends nothing, and writes no plus_activities
-- row (the activity contract is unchanged). Changes are audited in audit_events with field NAMES only.
-- Due dates: stored as UTC timestamptz. OVERDUE = open and due_at < now() (an instant; timezone-independent).
-- DUE TODAY = open and now() <= due_at < the end of the organization's local day (its own IANA timezone).
-- UPCOMING = due at or after the end of that local day. (NP-P2-S2-R1: definitions stated once, used everywhere.)

-- =============================================================================
-- 1. plus_tasks
-- =============================================================================
create table public.plus_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  title text not null,
  due_at timestamptz,
  assignee_user_id uuid references auth.users (id),
  contact_id uuid,
  opportunity_id uuid,
  status text not null default 'open',
  completed_at timestamptz,
  completed_by uuid references auth.users (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plus_tasks_id_organization_id_key unique (id, organization_id),
  constraint plus_tasks_contact_fkey foreign key (contact_id, organization_id) references public.plus_contacts (id, organization_id),
  constraint plus_tasks_opportunity_fkey foreign key (opportunity_id, organization_id) references public.plus_opportunities (id, organization_id),
  -- exactly ONE subject (domain model 3.2, P2-S2). P3-S1 replaces it with num_nonnulls(contact_id, account_id, opportunity_id) = 1.
  constraint plus_tasks_subject_check check (num_nonnulls(contact_id, opportunity_id) = 1),
  constraint plus_tasks_title_check check (title = btrim(title) and length(title) between 1 and 200),
  constraint plus_tasks_status_check check (status in ('open', 'done', 'cancelled')),
  -- completion is recorded consistently: done <=> completed_at and completed_by
  constraint plus_tasks_completion_check check (
    (status = 'done') = (completed_at is not null) and (completed_at is null) = (completed_by is null)
  )
);

comment on table public.plus_tasks is
  'NP-P2-S2. TENANT-OWNED internal follow-up task for exactly one Plus subject (contact or opportunity of the same organization; composite FKs). SELECT via RLS plus_can_read(organization_id); writes only through plus_create_task / plus_update_task / plus_reassign_task / plus_complete_task / plus_cancel_task. The assignee must be an eligible Plus writer at assignment time. Never deleted; done / cancelled are history. Not a customer communication: sends nothing. updated_at is the concurrency token.';

create index plus_tasks_org_status_due_idx on public.plus_tasks (organization_id, status, due_at);
create index plus_tasks_org_assignee_idx on public.plus_tasks (organization_id, assignee_user_id, status, due_at);
create index plus_tasks_org_contact_idx on public.plus_tasks (organization_id, contact_id) where contact_id is not null;
create index plus_tasks_org_opportunity_idx on public.plus_tasks (organization_id, opportunity_id) where opportunity_id is not null;

create trigger plus_tasks_set_updated_at
  before update on public.plus_tasks
  for each row execute function public.set_updated_at();
create trigger plus_tasks_prevent_org_change
  before update on public.plus_tasks
  for each row execute function public.prevent_organization_id_change();

alter table public.plus_tasks enable row level security;
revoke all on table public.plus_tasks from public, anon, authenticated, service_role;
grant select on table public.plus_tasks to authenticated;
create policy plus_tasks_select_plus on public.plus_tasks
  for select to authenticated
  using (public.plus_can_read(organization_id));

-- =============================================================================
-- 2. helpers
-- =============================================================================
-- The organization's own "today" boundaries (start of today, start of tomorrow) as UTC instants.
create function public._plus_org_day_bounds(p_organization_id uuid)
returns table (day_start timestamptz, day_end timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (date_trunc('day', now() at time zone o.timezone)) at time zone o.timezone,
         (date_trunc('day', now() at time zone o.timezone) + interval '1 day') at time zone o.timezone
  from public.organizations o where o.id = p_organization_id;
$$;
comment on function public._plus_org_day_bounds(uuid) is
  'NP-P2-S2. INTERNAL. The start of today and of tomorrow in the organization''s own IANA timezone, as UTC instants (for due-today / overdue / upcoming).';
revoke all on function public._plus_org_day_bounds(uuid) from public, anon, authenticated, service_role;

-- Validates a task subject: exactly one of an ACTIVE contact or an OPEN opportunity of THIS organization (locked
-- FOR NO KEY UPDATE so it cannot be archived / closed underneath). Unknown / foreign -> ZW002; closed / archived -> ZW006.
create function public._plus_require_task_subject(p_organization_id uuid, p_contact_id uuid, p_opportunity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage text;
begin
  if num_nonnulls(p_contact_id, p_opportunity_id) <> 1 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_contact_id is not null then
    perform public._plus_require_active_contact(p_organization_id, p_contact_id);
  else
    select o.stage into v_stage from public.plus_opportunities o
    where o.id = p_opportunity_id and o.organization_id = p_organization_id
    for no key update;
    if v_stage is null then
      raise exception 'not_found' using errcode = 'ZW002';
    end if;
    if v_stage in ('lost', 'converted') then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;
end;
$$;
comment on function public._plus_require_task_subject(uuid, uuid, uuid) is
  'NP-P2-S2. INTERNAL. Exactly one subject: an ACTIVE contact or an OPEN opportunity of the organization, locked against a concurrent archive / close. Both / neither or closed / archived -> ZW006; unknown / foreign -> ZW002.';
revoke all on function public._plus_require_task_subject(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Inserts a task after the subject and assignee have been validated by the caller (shared by plus_create_task and the
-- Growth Agent approval). Returns the new task id.
create function public._plus_insert_task(
  p_organization_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_assignee_user_id uuid,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  begin
    insert into public.plus_tasks (organization_id, title, due_at, assignee_user_id, contact_id, opportunity_id, created_by)
    values (p_organization_id, nullif(btrim(p_title), ''), p_due_at, p_assignee_user_id, p_contact_id, p_opportunity_id, p_actor)
    returning id into v_id;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_task', v_id, 'plus_task_created', p_actor, null,
          jsonb_build_object('subject', case when p_contact_id is not null then 'contact' else 'opportunity' end,
                             'has_due_at', p_due_at is not null, 'assigned', p_assignee_user_id is not null));
  return v_id;
end;
$$;
comment on function public._plus_insert_task(uuid, text, timestamptz, uuid, uuid, uuid, uuid) is
  'NP-P2-S2. INTERNAL. Inserts an open task and its plus_task_created audit row (no title or contact data copied). Callers validate authority, subject and assignee first.';
revoke all on function public._plus_insert_task(uuid, text, timestamptz, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

create type public.plus_task_write_result as (
  task_id uuid,
  status text,
  updated_at timestamptz,
  changed boolean
);
comment on type public.plus_task_write_result is
  'NP-P2-S2. Result of the task write RPCs. changed=false: nothing was written (idempotent no-op). updated_at is the new version token.';

-- =============================================================================
-- 3. read RPCs (Plus read)
-- =============================================================================
create function public.plus_list_tasks(
  p_organization_id uuid,
  p_view text,
  p_search text,
  p_assignee_membership_id uuid,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_limit integer,
  p_offset integer
)
returns table (
  task_id uuid,
  title text,
  due_at timestamptz,
  status text,
  is_overdue boolean,
  is_due_today boolean,
  assignee_membership_id uuid,
  assignee_name text,
  assignee_is_self boolean,
  contact_id uuid,
  contact_name text,
  opportunity_id uuid,
  opportunity_title text,
  completed_at timestamptz,
  completed_by_name text,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_view text := coalesce(p_view, 'open');
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
  v_assignee uuid;
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_view not in ('open', 'mine', 'overdue', 'today', 'upcoming', 'no_date', 'done', 'cancelled', 'history')
     or v_limit < 1 or v_limit > 200 or v_offset < 0 or length(coalesce(v_q, '')) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_assignee_membership_id is not null then
    select m.user_id into v_assignee from public.memberships m where m.id = p_assignee_membership_id and m.organization_id = p_organization_id;
    v_assignee := coalesce(v_assignee, '00000000-0000-0000-0000-000000000000');  -- foreign handle matches nothing
  end if;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  select b.day_start, b.day_end into v_start, v_end from public._plus_org_day_bounds(p_organization_id) b;

  return query
  select t.id, t.title, t.due_at, t.status,
         (t.status = 'open' and t.due_at is not null and t.due_at < now()),
         (t.status = 'open' and t.due_at is not null and t.due_at >= now() and t.due_at < v_end),
         (select m.id from public.memberships m where m.organization_id = t.organization_id and m.user_id = t.assignee_user_id),
         case when t.assignee_user_id is null then null else public._plus_staff_name(t.assignee_user_id) end,
         coalesce(t.assignee_user_id = auth.uid(), false),
         coalesce(t.contact_id, o.primary_contact_id), coalesce(c.display_name, oc.display_name),
         t.opportunity_id, o.title,
         t.completed_at, case when t.completed_by is null then null else public._plus_staff_name(t.completed_by) end,
         t.updated_at, count(*) over ()
  from public.plus_tasks t
  left join public.plus_contacts c on c.id = t.contact_id and c.organization_id = t.organization_id
  left join public.plus_opportunities o on o.id = t.opportunity_id and o.organization_id = t.organization_id
  left join public.plus_contacts oc on oc.id = o.primary_contact_id and oc.organization_id = o.organization_id
  where t.organization_id = p_organization_id
    and case v_view
      when 'open' then t.status = 'open'
      when 'mine' then t.status = 'open' and t.assignee_user_id = auth.uid()
      when 'overdue' then t.status = 'open' and t.due_at < now()
      when 'today' then t.status = 'open' and t.due_at >= now() and t.due_at < v_end
      when 'upcoming' then t.status = 'open' and t.due_at >= v_end
      when 'no_date' then t.status = 'open' and t.due_at is null
      when 'done' then t.status = 'done'
      when 'cancelled' then t.status = 'cancelled'
      else t.status in ('done', 'cancelled')
    end
    and (p_assignee_membership_id is null or t.assignee_user_id = v_assignee)
    and (p_contact_id is null or t.contact_id = p_contact_id or o.primary_contact_id = p_contact_id)
    and (p_opportunity_id is null or t.opportunity_id = p_opportunity_id)
    and (v_q is null or lower(t.title) like v_like or lower(coalesce(c.display_name, oc.display_name, '')) like v_like
         or lower(coalesce(o.title, '')) like v_like)
  order by
    case when t.status = 'open' then 0 else 1 end,
    case when t.status = 'open' then t.due_at end asc nulls last,
    case when t.status <> 'open' then coalesce(t.completed_at, t.updated_at) end desc,
    t.created_at, t.id
  limit v_limit offset v_offset;
end;
$$;
comment on function public.plus_list_tasks(uuid, text, text, uuid, uuid, uuid, integer, integer) is
  'NP-P2-S2. Plus READ. Tasks of p_organization_id: view open (default) | mine | overdue (due before now) | today (due from now to the end of the organization''s local today) | upcoming (after today) | no_date | done | cancelled | history; optional assignee handle / contact (incl. that contact''s opportunities) / opportunity filters and a search over title, contact and opportunity. Open tasks soonest-due first; history most recent first. 1-200 rows; total_count is the filtered total.';
revoke all on function public.plus_list_tasks(uuid, text, text, uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.plus_list_tasks(uuid, text, text, uuid, uuid, uuid, integer, integer) to authenticated;

create function public.plus_get_task(p_organization_id uuid, p_task_id uuid)
returns table (
  task_id uuid,
  title text,
  due_at timestamptz,
  status text,
  is_overdue boolean,
  assignee_membership_id uuid,
  assignee_name text,
  assignee_can_write boolean,
  contact_id uuid,
  contact_name text,
  opportunity_id uuid,
  opportunity_title text,
  opportunity_stage text,
  completed_at timestamptz,
  completed_by_name text,
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
  select t.id, t.title, t.due_at, t.status, (t.status = 'open' and t.due_at is not null and t.due_at < now()),
         (select m.id from public.memberships m where m.organization_id = t.organization_id and m.user_id = t.assignee_user_id),
         case when t.assignee_user_id is null then null else public._plus_staff_name(t.assignee_user_id) end,
         case when t.assignee_user_id is null then null else public._plus_user_can_write(t.organization_id, t.assignee_user_id) end,
         coalesce(t.contact_id, o.primary_contact_id), coalesce(c.display_name, oc.display_name),
         t.opportunity_id, o.title, o.stage,
         t.completed_at, case when t.completed_by is null then null else public._plus_staff_name(t.completed_by) end,
         public._plus_staff_name(t.created_by), t.created_at, t.updated_at
  from public.plus_tasks t
  left join public.plus_contacts c on c.id = t.contact_id and c.organization_id = t.organization_id
  left join public.plus_opportunities o on o.id = t.opportunity_id and o.organization_id = t.organization_id
  left join public.plus_contacts oc on oc.id = o.primary_contact_id and oc.organization_id = o.organization_id
  where t.id = p_task_id and t.organization_id = p_organization_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
end;
$$;
comment on function public.plus_get_task(uuid, uuid) is
  'NP-P2-S2. Plus READ. One task of p_organization_id with its subject (contact, or opportunity and its contact) and people (ZW002 for no access AND for a foreign / unknown id). assignee_membership_id is an opaque handle; updated_at is the version token.';
revoke all on function public.plus_get_task(uuid, uuid) from public, anon;
grant execute on function public.plus_get_task(uuid, uuid) to authenticated;

-- =============================================================================
-- 4. write RPCs (Plus write)
-- =============================================================================
create function public.plus_create_task(
  p_organization_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_assignee_membership_id uuid,
  p_contact_id uuid,
  p_opportunity_id uuid
)
returns public.plus_task_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := nullif(btrim(p_title), '');
  v_assignee uuid;
  v_existing public.plus_tasks%rowtype;
  v_id uuid;
  v_result public.plus_task_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  perform public._plus_require_task_subject(p_organization_id, p_contact_id, p_opportunity_id);
  -- assignee: an eligible Plus writer of THIS organization at assignment time (ZW006 otherwise); NULL = unassigned
  v_assignee := public._plus_resolve_owner(p_organization_id, p_assignee_membership_id);

  -- Accidental duplicate submission: the same task by the same person for the same subject within 30 s.
  -- (The subject row lock above serializes concurrent creates for that subject.)
  select * into v_existing from public.plus_tasks t
  where t.organization_id = p_organization_id and t.created_by = auth.uid() and t.status = 'open' and t.title = v_title
    and t.contact_id is not distinct from p_contact_id and t.opportunity_id is not distinct from p_opportunity_id
    and t.created_at > now() - interval '30 seconds'
  order by t.created_at desc limit 1;
  if found then
    v_result.task_id := v_existing.id; v_result.status := v_existing.status; v_result.updated_at := v_existing.updated_at; v_result.changed := false;
    return v_result;
  end if;

  v_id := public._plus_insert_task(p_organization_id, v_title, p_due_at, v_assignee, p_contact_id, p_opportunity_id, auth.uid());
  select t.id, t.status, t.updated_at, true into v_result from public.plus_tasks t where t.id = v_id;
  return v_result;
end;
$$;
comment on function public.plus_create_task(uuid, text, timestamptz, uuid, uuid, uuid) is
  'NP-P2-S2. Plus WRITE (_require_plus_write). Creates an OPEN task for exactly one subject of p_organization_id: an active contact OR an open opportunity (both / neither or archived / closed ZW006; unknown / foreign ZW002). Title 1-200 (ZW006). Optional due_at (UTC instant) and assignee handle -- the assignee must be an eligible Plus writer (Admin, or active write grant) of the organization (ZW006). The same task by the same person for the same subject within 30 s is an idempotent no-op. Audited as plus_task_created. Sends nothing.';
revoke all on function public.plus_create_task(uuid, text, timestamptz, uuid, uuid, uuid) from public, anon;
grant execute on function public.plus_create_task(uuid, text, timestamptz, uuid, uuid, uuid) to authenticated;

create function public.plus_update_task(
  p_organization_id uuid,
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_due_at timestamptz,
  p_assignee_membership_id uuid
)
returns public.plus_task_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := nullif(btrim(p_title), '');
  v_old public.plus_tasks%rowtype;
  v_new public.plus_tasks%rowtype;
  v_assignee uuid;
  v_fields text[] := array[]::text[];
  v_result public.plus_task_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  select * into v_old from public.plus_tasks where id = p_task_id and organization_id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_old.status <> 'open' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  -- an unchanged assignee who has since lost write access is kept; a NEW assignee must be eligible
  if p_assignee_membership_id is not null and v_old.assignee_user_id is not null
     and exists (select 1 from public.memberships m where m.id = p_assignee_membership_id
                 and m.organization_id = p_organization_id and m.user_id = v_old.assignee_user_id) then
    v_assignee := v_old.assignee_user_id;
  else
    v_assignee := public._plus_resolve_owner(p_organization_id, p_assignee_membership_id);
  end if;

  if v_old.title is distinct from v_title then v_fields := array_append(v_fields, 'title'); end if;
  if v_old.due_at is distinct from p_due_at then v_fields := array_append(v_fields, 'due_at'); end if;
  if v_old.assignee_user_id is distinct from v_assignee then v_fields := array_append(v_fields, 'assignee'); end if;
  v_result.task_id := v_old.id;
  v_result.status := v_old.status;
  if cardinality(v_fields) = 0 then
    v_result.updated_at := v_old.updated_at; v_result.changed := false;
    return v_result;
  end if;
  begin
    update public.plus_tasks set title = v_title, due_at = p_due_at, assignee_user_id = v_assignee where id = v_old.id returning * into v_new;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_task', v_old.id, 'plus_task_updated', auth.uid(), null, jsonb_build_object('fields', to_jsonb(v_fields)));
  v_result.updated_at := v_new.updated_at; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_update_task(uuid, uuid, timestamptz, text, timestamptz, uuid) is
  'NP-P2-S2. Plus WRITE. Edits an OPEN task''s title, due_at and assignee (the subject never changes). Row lock + p_expected_updated_at (ZW003 when stale); done / cancelled ZW004; foreign / unknown ZW002. A NEW assignee must be an eligible Plus writer (ZW006); an unchanged one is kept. Identical values -> changed=false. Audited as plus_task_updated with field NAMES only.';
revoke all on function public.plus_update_task(uuid, uuid, timestamptz, text, timestamptz, uuid) from public, anon;
grant execute on function public.plus_update_task(uuid, uuid, timestamptz, text, timestamptz, uuid) to authenticated;

create function public.plus_reassign_task(
  p_organization_id uuid,
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_assignee_membership_id uuid
)
returns public.plus_task_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.plus_tasks%rowtype;
  v_new public.plus_tasks%rowtype;
  v_assignee uuid;
  v_result public.plus_task_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  select * into v_old from public.plus_tasks where id = p_task_id and organization_id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_old.status <> 'open' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  v_assignee := public._plus_resolve_owner(p_organization_id, p_assignee_membership_id);
  v_result.task_id := v_old.id; v_result.status := v_old.status;
  if v_old.assignee_user_id is not distinct from v_assignee then
    v_result.updated_at := v_old.updated_at; v_result.changed := false;   -- already assigned that way
    return v_result;
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  update public.plus_tasks set assignee_user_id = v_assignee where id = v_old.id returning * into v_new;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_task', v_old.id, 'plus_task_updated', auth.uid(), null, jsonb_build_object('fields', '["assignee"]'::jsonb));
  v_result.updated_at := v_new.updated_at; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_reassign_task(uuid, uuid, timestamptz, uuid) is
  'NP-P2-S2. Plus WRITE. Changes only the assignee of an OPEN task (NULL handle = unassign). The new assignee must be an eligible Plus writer of the organization (ZW006: no grant, read grant, revoked, inactive, driver, foreign). Already so assigned -> changed=false; stale ZW003; done / cancelled ZW004.';
revoke all on function public.plus_reassign_task(uuid, uuid, timestamptz, uuid) from public, anon;
grant execute on function public.plus_reassign_task(uuid, uuid, timestamptz, uuid) to authenticated;

create function public.plus_complete_task(p_organization_id uuid, p_task_id uuid, p_expected_updated_at timestamptz)
returns public.plus_task_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.plus_tasks%rowtype;
  v_new public.plus_tasks%rowtype;
  v_result public.plus_task_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  select * into v_old from public.plus_tasks where id = p_task_id and organization_id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_result.task_id := v_old.id;
  if v_old.status = 'done' then   -- repeated completion (double submit): idempotent no-op, history unchanged
    v_result.status := v_old.status; v_result.updated_at := v_old.updated_at; v_result.changed := false;
    return v_result;
  end if;
  if v_old.status = 'cancelled' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  update public.plus_tasks set status = 'done', completed_at = now(), completed_by = auth.uid() where id = v_old.id returning * into v_new;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_task', v_old.id, 'plus_task_completed', auth.uid(), jsonb_build_object('status', 'open'), jsonb_build_object('status', 'done'));
  v_result.status := v_new.status; v_result.updated_at := v_new.updated_at; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_complete_task(uuid, uuid, timestamptz) is
  'NP-P2-S2. Plus WRITE. Marks an OPEN task done (completed_at = now, completed_by = caller). Already done -> changed=false (no second history row); cancelled ZW004; stale ZW003; foreign / unknown ZW002. Audited as plus_task_completed. Completing a task records internal work only -- it never claims a customer was contacted.';
revoke all on function public.plus_complete_task(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.plus_complete_task(uuid, uuid, timestamptz) to authenticated;

create function public.plus_cancel_task(p_organization_id uuid, p_task_id uuid, p_expected_updated_at timestamptz)
returns public.plus_task_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.plus_tasks%rowtype;
  v_new public.plus_tasks%rowtype;
  v_result public.plus_task_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  select * into v_old from public.plus_tasks where id = p_task_id and organization_id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_result.task_id := v_old.id;
  if v_old.status = 'cancelled' then
    v_result.status := v_old.status; v_result.updated_at := v_old.updated_at; v_result.changed := false;
    return v_result;
  end if;
  if v_old.status = 'done' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  update public.plus_tasks set status = 'cancelled' where id = v_old.id returning * into v_new;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_task', v_old.id, 'plus_task_cancelled', auth.uid(), jsonb_build_object('status', 'open'), jsonb_build_object('status', 'cancelled'));
  v_result.status := v_new.status; v_result.updated_at := v_new.updated_at; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_cancel_task(uuid, uuid, timestamptz) is
  'NP-P2-S2. Plus WRITE. Cancels an OPEN task (kept as history). Already cancelled -> changed=false; done ZW004; stale ZW003; foreign / unknown ZW002. Audited as plus_task_cancelled.';
revoke all on function public.plus_cancel_task(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.plus_cancel_task(uuid, uuid, timestamptz) to authenticated;
