-- NP-P2-S2 (Phase C) -- Growth Dashboard read RPCs (functions only; no table, no write, no Core object).
--
-- OWNER-REQUESTED EXTENSION: the useful operational dashboard at /operations/growth. Not the P2-S8 analytics / export
-- milestone. Counts come from server-side aggregates over the caller's own organization (plus_can_read), never from
-- fetching detailed rows. No conversion, booking, revenue or quote outcome exists here (P2-S3/S4/S5/S8).

-- Every number on the dashboard, in one aggregate round trip.
create function public.plus_growth_dashboard(p_organization_id uuid)
returns table (
  active_opportunities bigint,
  stage_new_inquiry bigint,
  stage_contacted bigint,
  stage_qualified bigint,
  stage_quote_sent bigint,
  stage_quote_accepted bigint,
  active_contacts bigint,
  open_tasks bigint,
  overdue_tasks bigint,
  due_today_tasks bigint,
  my_open_tasks bigint,
  pending_recommendations bigint,
  attention_opportunities bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_end timestamptz;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  select b.day_end into v_end from public._plus_org_day_bounds(p_organization_id) b;
  return query
  select
    o.active, o.s_new, o.s_contacted, o.s_qualified, o.s_quote_sent, o.s_quote_accepted,
    (select count(*) from public.plus_contacts c where c.organization_id = p_organization_id and c.status = 'active'),
    t.open, t.overdue, t.due_today, t.mine,
    (select count(*) from public.plus_agent_recommendations r where r.organization_id = p_organization_id and r.status = 'pending'),
    (select count(*) from public._plus_agent_candidates(p_organization_id, null))
  from (
    select count(*) filter (where stage in ('new_inquiry', 'contacted', 'qualified', 'quote_sent', 'quote_accepted')) as active,
           count(*) filter (where stage = 'new_inquiry') as s_new,
           count(*) filter (where stage = 'contacted') as s_contacted,
           count(*) filter (where stage = 'qualified') as s_qualified,
           count(*) filter (where stage = 'quote_sent') as s_quote_sent,
           count(*) filter (where stage = 'quote_accepted') as s_quote_accepted
    from public.plus_opportunities where organization_id = p_organization_id and channel = 'private_pay'
  ) o,
  (
    select count(*) filter (where status = 'open') as open,
           count(*) filter (where status = 'open' and due_at < now()) as overdue,
           count(*) filter (where status = 'open' and due_at >= now() and due_at < v_end) as due_today,
           count(*) filter (where status = 'open' and assignee_user_id = auth.uid()) as mine
    from public.plus_tasks where organization_id = p_organization_id
  ) t;
end;
$$;
comment on function public.plus_growth_dashboard(uuid) is
  'NP-P2-S2. Plus READ (ZW002 without access; ZW001 without a uid). One row of real counts for the caller''s organization: open private-pay opportunities by stage, active contacts, open / overdue / due-today (organization timezone) / my tasks, pending Growth Agent recommendations, and opportunities the deterministic detection flags for attention. Aggregates only.';
revoke all on function public.plus_growth_dashboard(uuid) from public, anon;
grant execute on function public.plus_growth_dashboard(uuid) to authenticated;

-- Opportunities needing attention: the SAME deterministic detection the Growth Agent uses (so the two never disagree).
create function public.plus_list_attention_opportunities(p_organization_id uuid, p_limit integer)
returns table (
  opportunity_id uuid,
  opportunity_title text,
  opportunity_stage text,
  contact_name text,
  attention_type text,
  signal_days integer,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := coalesce(p_limit, 5);
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  return query
  select o.id, o.title, o.stage, c.display_name, x.recommendation_type, x.signal_days, x.last_activity_at
  from public._plus_agent_candidates(p_organization_id, null) x
  join public.plus_opportunities o on o.id = x.opportunity_id and o.organization_id = p_organization_id
  join public.plus_contacts c on c.id = o.primary_contact_id and c.organization_id = o.organization_id
  order by x.signal_days desc, o.id
  limit v_limit;
end;
$$;
comment on function public.plus_list_attention_opportunities(uuid, integer) is
  'NP-P2-S2. Plus READ. Up to 1-50 open opportunities that the deterministic Growth Agent detection flags (new inquiry waiting, no recorded reply after outreach, no recent recorded activity), longest-waiting first.';
revoke all on function public.plus_list_attention_opportunities(uuid, integer) from public, anon;
grant execute on function public.plus_list_attention_opportunities(uuid, integer) to authenticated;

-- Recent Plus activity across contacts and opportunities of ONE organization.
create function public.plus_list_recent_activities(p_organization_id uuid, p_limit integer)
returns table (
  activity_id uuid,
  activity_type text,
  from_stage text,
  to_stage text,
  contact_id uuid,
  contact_name text,
  opportunity_id uuid,
  opportunity_title text,
  actor_name text,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := coalesce(p_limit, 10);
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  return query
  select a.id, a.activity_type, a.from_stage, a.to_stage,
         coalesce(a.contact_id, o.primary_contact_id), coalesce(c.display_name, oc.display_name),
         a.opportunity_id, o.title, public._plus_staff_name(a.actor_user_id), a.occurred_at
  from public.plus_activities a
  left join public.plus_contacts c on c.id = a.contact_id and c.organization_id = a.organization_id
  left join public.plus_opportunities o on o.id = a.opportunity_id and o.organization_id = a.organization_id
  left join public.plus_contacts oc on oc.id = o.primary_contact_id and oc.organization_id = o.organization_id
  where a.organization_id = p_organization_id
    and coalesce(c.status, oc.status, 'active') <> 'redacted'
  order by a.occurred_at desc, a.recorded_at desc, a.id
  limit v_limit;
end;
$$;
comment on function public.plus_list_recent_activities(uuid, integer) is
  'NP-P2-S2. Plus READ. The 1-50 most recent Plus activity entries (logged interactions, stage / owner changes, archives) of the caller''s organization with their contact / opportunity names and actor. Activity bodies are not returned.';
revoke all on function public.plus_list_recent_activities(uuid, integer) from public, anon;
grant execute on function public.plus_list_recent_activities(uuid, integer) to authenticated;
