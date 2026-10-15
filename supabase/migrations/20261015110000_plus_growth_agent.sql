-- NP-P2-S2 (Phase D) -- Growth Agent foundation: deterministic, staff-supervised follow-up recommendations.
--
-- OWNER-REQUESTED EXTENSION beyond the canonical one-table P2-S2 (tasks) slice; documented separately in the NP-P2-S2
-- report and docs/security/plus-access-model.md. Additive, forward-only; no forward FK; no Core object touched.
--
-- WHAT
--   _plus_agent_threshold(key)            -- INTERNAL-TEST thresholds in ONE place (not approved production policy).
--   _plus_agent_candidates(org, opp)      -- deterministic detection over Plus data only (opportunities, the contact's
--                                            logged interactions, opportunity history, open tasks). Explainable:
--                                            a type, the days elapsed, the last recorded activity, a condition key.
--   plus_agent_recommendations            -- the review queue (class B: SELECT via plus_can_read; writes via RPCs).
--                                            Structured codes only: NO copied contact PII, NO message text, NO JSON.
--   plus_run_growth_agent_review(org)     -- staff-triggered review cycle (Plus write). Future scheduler boundary:
--                                            _plus_agent_review(org, actor, source); no scheduler is created here.
--   plus_list_agent_recommendations       -- read (Plus read).
--   plus_approve_agent_recommendation     -- staff approval: REVALIDATES the condition under a row lock, then creates
--                                            ONE internal follow-up task (never twice); nothing is ever sent.
--   plus_dismiss_agent_recommendation     -- staff dismissal ('dismissed' | 'not_relevant').
--
-- BOUNDARIES (enforced here, tested in plus_growth_agent_tests.sql)
--   The agent never sends, calls, schedules, changes a stage, marks lost, creates quotes, writes plus_activities or
--   touches any Core table. Its only possible effect is a staff-approved internal plus_tasks row. A suggested message
--   draft is rendered by the app from a fixed template at display time, labelled NOT SENT, and is never stored.
--   "No recorded reply" is never treated as proof that a customer ignored anyone; nothing is classified lost.

-- =============================================================================
-- 1. thresholds (internal testing only -- explicit and easy to adjust)
-- =============================================================================
create function public._plus_agent_threshold(p_key text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_key
    when 'new_inquiry_waiting_days' then 2     -- still "New inquiry", nothing recorded since it was created
    when 'awaiting_response_days' then 5       -- last recorded item is staff outreach (call / email) with nothing after
    when 'no_recent_activity_days' then 10     -- no recorded activity of any kind on the opportunity or its contact
    when 'suggested_due_days' then 1           -- default due date offered for an approved follow-up task
  end;
$$;
comment on function public._plus_agent_threshold(text) is
  'NP-P2-S2. INTERNAL. Growth Agent INTERNAL-TEST thresholds (days): new_inquiry_waiting_days 2, awaiting_response_days 5, no_recent_activity_days 10, suggested_due_days 1. NOT approved production policy; adjust with a reviewed migration.';
revoke all on function public._plus_agent_threshold(text) from public, anon, authenticated, service_role;

-- =============================================================================
-- 2. deterministic detection
-- =============================================================================
create function public._plus_agent_candidates(p_organization_id uuid, p_opportunity_id uuid)
returns table (
  opportunity_id uuid,
  recommendation_type text,
  condition_key text,
  signal_days integer,
  last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with opp as (
    select o.id, o.stage, o.created_at, o.primary_contact_id, o.updated_at
    from public.plus_opportunities o
    join public.plus_contacts c on c.id = o.primary_contact_id and c.organization_id = o.organization_id
    where o.organization_id = p_organization_id
      and o.channel = 'private_pay'
      and o.stage in ('new_inquiry', 'contacted', 'qualified', 'quote_sent', 'quote_accepted')
      and c.status = 'active'
      and (p_opportunity_id is null or o.id = p_opportunity_id)
      -- staff already have a follow-up planned (any open task on the opportunity or its contact): no recommendation
      and not exists (select 1 from public.plus_tasks t where t.organization_id = o.organization_id and t.status = 'open'
                       and (t.opportunity_id = o.id or t.contact_id = o.primary_contact_id))
  ),
  facts as (
    select opp.*,
      -- latest logged interaction with the contact since the opportunity was created
      (select a.id from public.plus_activities a where a.organization_id = p_organization_id and a.contact_id = opp.primary_contact_id
         and a.activity_type in ('note', 'call_logged', 'email_logged', 'meeting_logged') and a.occurred_at >= opp.created_at
       order by a.occurred_at desc, a.recorded_at desc, a.id desc limit 1) as last_interaction_id,
      -- latest entry of ANY kind on the opportunity or its contact (any time)
      (select a.id from public.plus_activities a where a.organization_id = p_organization_id
         and (a.opportunity_id = opp.id or a.contact_id = opp.primary_contact_id)
       order by a.occurred_at desc, a.recorded_at desc, a.id desc limit 1) as last_any_id,
      exists (select 1 from public.plus_activities a where a.opportunity_id = opp.id and a.activity_type = 'stage_changed') as stage_ever_changed
    from opp
  ),
  enriched as (
    select f.*,
      li.activity_type as last_interaction_type, li.occurred_at as last_interaction_at,
      la.occurred_at as last_any_at
    from facts f
    left join public.plus_activities li on li.id = f.last_interaction_id
    left join public.plus_activities la on la.id = f.last_any_id
  ),
  classified as (
    select e.*,
      case
        when e.stage = 'new_inquiry' and not e.stage_ever_changed and e.last_interaction_id is null
             and e.created_at <= now() - make_interval(days => public._plus_agent_threshold('new_inquiry_waiting_days'))
          then 'new_inquiry_waiting'
        when e.last_interaction_type in ('call_logged', 'email_logged') and e.last_any_id = e.last_interaction_id
             and e.last_interaction_at <= now() - make_interval(days => public._plus_agent_threshold('awaiting_response_days'))
          then 'awaiting_response'
        when greatest(coalesce(e.last_any_at, e.created_at), e.created_at)
             <= now() - make_interval(days => public._plus_agent_threshold('no_recent_activity_days'))
          then 'no_recent_activity'
      end as rtype
    from enriched e
  )
  select c.id,
         c.rtype,
         -- the situation fingerprint: an unchanged situation yields the same key (no repeated recommendation)
         c.rtype || ':' || c.stage || ':' || coalesce(c.last_any_id::text, 'none'),
         floor(extract(epoch from now() - case c.rtype
           when 'new_inquiry_waiting' then c.created_at
           when 'awaiting_response' then c.last_interaction_at
           else greatest(coalesce(c.last_any_at, c.created_at), c.created_at) end) / 86400)::integer,
         c.last_any_at
  from classified c
  where c.rtype is not null;
$$;
comment on function public._plus_agent_candidates(uuid, uuid) is
  'NP-P2-S2. INTERNAL. Deterministic Growth Agent detection for ONE organization (optionally one opportunity): open private-pay opportunities of an active contact with NO open task, classified as new_inquiry_waiting (still new, nothing recorded since creation, older than the threshold), awaiting_response (last recorded item is staff outreach -- call / email logged -- and nothing after it, older than the threshold; NOT proof of being ignored) or no_recent_activity (nothing recorded for the threshold). condition_key fingerprints the situation (type, stage, last activity) so an unchanged situation is never recommended twice.';
revoke all on function public._plus_agent_candidates(uuid, uuid) from public, anon, authenticated, service_role;

-- =============================================================================
-- 3. recommendation queue
-- =============================================================================
create table public.plus_agent_recommendations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  opportunity_id uuid not null,
  recommendation_type text not null,
  proposed_action text not null default 'create_follow_up_task',
  condition_key text not null,
  signal_days integer not null,
  last_activity_at timestamptz,
  status text not null default 'pending',
  generation_source text not null default 'staff_review',
  generated_by uuid not null references auth.users (id),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  approved_task_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plus_agent_recommendations_id_organization_id_key unique (id, organization_id),
  constraint plus_agent_recommendations_opportunity_fkey
    foreign key (opportunity_id, organization_id) references public.plus_opportunities (id, organization_id),
  constraint plus_agent_recommendations_task_fkey
    foreign key (approved_task_id, organization_id) references public.plus_tasks (id, organization_id),
  constraint plus_agent_recommendations_type_check check (recommendation_type in ('new_inquiry_waiting', 'awaiting_response', 'no_recent_activity')),
  -- the ONLY action the agent can propose in this milestone: an internal follow-up task
  constraint plus_agent_recommendations_action_check check (proposed_action in ('create_follow_up_task')),
  constraint plus_agent_recommendations_status_check check (status in ('pending', 'approved', 'dismissed', 'not_relevant', 'superseded')),
  -- 'scheduler' is reserved for a future, separately approved authenticated scheduler
  constraint plus_agent_recommendations_source_check check (generation_source in ('staff_review')),
  constraint plus_agent_recommendations_condition_key_check check (length(condition_key) between 1 and 200),
  constraint plus_agent_recommendations_signal_days_check check (signal_days >= 0),
  -- staff review is recorded consistently; only an approval carries a task
  constraint plus_agent_recommendations_review_check check (
    (status in ('approved', 'dismissed', 'not_relevant')) = (reviewed_at is not null)
    and (reviewed_at is null) = (reviewed_by is null)
    and (status = 'approved') = (approved_task_id is not null)
  )
);
comment on table public.plus_agent_recommendations is
  'NP-P2-S2. TENANT-OWNED Growth Agent review queue. One row per detected situation (opportunity + type + condition_key, unique: an unchanged situation is never recommended twice, whatever its review outcome). Structured codes only -- no contact PII, no message text, no JSON. SELECT via RLS plus_can_read(organization_id); written only by plus_run_growth_agent_review / plus_approve_agent_recommendation / plus_dismiss_agent_recommendation. NOT an outbox: nothing here is ever sent. updated_at is the concurrency token.';

create unique index plus_agent_recommendations_situation_key on public.plus_agent_recommendations (organization_id, opportunity_id, recommendation_type, condition_key);
-- at most ONE pending recommendation per opportunity
create unique index plus_agent_recommendations_one_pending_idx on public.plus_agent_recommendations (opportunity_id) where status = 'pending';
-- an approved task belongs to exactly one recommendation (replay / concurrent approval can never create two)
create unique index plus_agent_recommendations_task_key on public.plus_agent_recommendations (approved_task_id) where approved_task_id is not null;
create index plus_agent_recommendations_org_status_idx on public.plus_agent_recommendations (organization_id, status, created_at desc);

create trigger plus_agent_recommendations_set_updated_at
  before update on public.plus_agent_recommendations
  for each row execute function public.set_updated_at();
create trigger plus_agent_recommendations_prevent_org_change
  before update on public.plus_agent_recommendations
  for each row execute function public.prevent_organization_id_change();

alter table public.plus_agent_recommendations enable row level security;
revoke all on table public.plus_agent_recommendations from public, anon, authenticated, service_role;
grant select on table public.plus_agent_recommendations to authenticated;
create policy plus_agent_recommendations_select_plus on public.plus_agent_recommendations
  for select to authenticated
  using (public.plus_can_read(organization_id));

-- =============================================================================
-- 4. review cycle (staff-triggered; future scheduler boundary)
-- =============================================================================
create type public.plus_agent_review_result as (created integer, superseded integer, unchanged integer);

-- The review itself, for one organization, on behalf of p_actor. INTERNAL: the only caller today is the staff RPC
-- below; a future, separately approved authenticated scheduler would call this with its own source (not created here).
create function public._plus_agent_review(p_organization_id uuid, p_actor uuid, p_source text)
returns public.plus_agent_review_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result public.plus_agent_review_result;
  v_candidates integer;
begin
  -- one review at a time per organization (two staff pressing "Review" at once cannot double-insert)
  perform pg_advisory_xact_lock(hashtext('plus-agent-review:' || p_organization_id::text)::bigint);

  select count(*) into v_candidates from public._plus_agent_candidates(p_organization_id, null);

  -- pending recommendations whose situation no longer holds (or changed) are withdrawn
  update public.plus_agent_recommendations r set status = 'superseded'
  where r.organization_id = p_organization_id and r.status = 'pending'
    and not exists (select 1 from public._plus_agent_candidates(p_organization_id, null) c where c.opportunity_id = r.opportunity_id
                    and c.recommendation_type = r.recommendation_type and c.condition_key = r.condition_key);
  get diagnostics v_result.superseded = row_count;

  -- new situations become pending; a situation already seen (any outcome) is never recommended again
  insert into public.plus_agent_recommendations (organization_id, opportunity_id, recommendation_type, condition_key, signal_days,
                                                 last_activity_at, generation_source, generated_by)
  select p_organization_id, c.opportunity_id, c.recommendation_type, c.condition_key, c.signal_days, c.last_activity_at, p_source, p_actor
  from public._plus_agent_candidates(p_organization_id, null) c
  where not exists (select 1 from public.plus_agent_recommendations r where r.organization_id = p_organization_id
                    and r.opportunity_id = c.opportunity_id and r.recommendation_type = c.recommendation_type and r.condition_key = c.condition_key)
  on conflict do nothing;
  get diagnostics v_result.created = row_count;
  v_result.unchanged := v_candidates - v_result.created;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_agent_review', p_organization_id, 'plus_agent_review_run', p_actor, null,
          jsonb_build_object('source', p_source, 'created', v_result.created, 'superseded', v_result.superseded, 'unchanged', v_result.unchanged));
  return v_result;
end;
$$;
comment on function public._plus_agent_review(uuid, uuid, text) is
  'NP-P2-S2. INTERNAL (no client EXECUTE). One Growth Agent review cycle for one organization: serialized per organization (advisory lock); withdraws (superseded) pending recommendations whose situation changed or ended; inserts each NEW situation once; records a plus_agent_review_run audit event with counts only. The future-scheduler boundary: a separately approved scheduler would call this; none exists.';
revoke all on function public._plus_agent_review(uuid, uuid, text) from public, anon, authenticated, service_role;

create function public.plus_run_growth_agent_review(p_organization_id uuid)
returns public.plus_agent_review_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_plus_write(p_organization_id);
  return public._plus_agent_review(p_organization_id, auth.uid(), 'staff_review');
end;
$$;
comment on function public.plus_run_growth_agent_review(uuid) is
  'NP-P2-S2. Plus WRITE (_require_plus_write: ZW002 without read, ZW001 read-only / read grant). Runs one deterministic Growth Agent review for the caller''s organization on demand ("Review opportunities"). Creates recommendations only -- never tasks, messages, stage changes or Core writes.';
revoke all on function public.plus_run_growth_agent_review(uuid) from public, anon;
grant execute on function public.plus_run_growth_agent_review(uuid) to authenticated;

-- =============================================================================
-- 5. read
-- =============================================================================
create function public.plus_list_agent_recommendations(p_organization_id uuid, p_view text, p_limit integer, p_offset integer)
returns table (
  recommendation_id uuid,
  opportunity_id uuid,
  opportunity_title text,
  opportunity_stage text,
  contact_id uuid,
  contact_name text,
  contact_do_not_contact boolean,
  contact_preferred_channel text,
  contact_has_phone boolean,
  contact_has_email boolean,
  recommendation_type text,
  proposed_action text,
  signal_days integer,
  last_activity_at timestamptz,
  last_activity_type text,
  status text,
  generated_by_name text,
  created_at timestamptz,
  reviewed_by_name text,
  reviewed_at timestamptz,
  approved_task_id uuid,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_view text := coalesce(p_view, 'pending');
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_view not in ('pending', 'reviewed', 'all') or v_limit < 1 or v_limit > 100 or v_offset < 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  return query
  select r.id, o.id, o.title, o.stage, c.id, c.display_name, c.do_not_contact, c.preferred_channel, c.phone is not null, c.email is not null,
         r.recommendation_type, r.proposed_action, r.signal_days, r.last_activity_at,
         (select a.activity_type from public.plus_activities a where a.organization_id = r.organization_id
            and (a.opportunity_id = o.id or a.contact_id = o.primary_contact_id)
          order by a.occurred_at desc, a.recorded_at desc, a.id desc limit 1),
         r.status, public._plus_staff_name(r.generated_by), r.created_at,
         case when r.reviewed_by is null then null else public._plus_staff_name(r.reviewed_by) end, r.reviewed_at,
         r.approved_task_id, r.updated_at, count(*) over ()
  from public.plus_agent_recommendations r
  join public.plus_opportunities o on o.id = r.opportunity_id and o.organization_id = r.organization_id
  join public.plus_contacts c on c.id = o.primary_contact_id and c.organization_id = o.organization_id
  where r.organization_id = p_organization_id
    and case v_view when 'pending' then r.status = 'pending' when 'reviewed' then r.status <> 'pending' else true end
  order by (r.status = 'pending') desc, coalesce(r.reviewed_at, r.created_at) desc, r.id
  limit v_limit offset v_offset;
end;
$$;
comment on function public.plus_list_agent_recommendations(uuid, text, integer, integer) is
  'NP-P2-S2. Plus READ. The organization''s Growth Agent recommendations (view pending (default) | reviewed | all) with the opportunity, its contact''s name and contact PREFERENCES (do-not-contact, preferred channel, whether a phone / email exists -- not the values), the reason (type, days, last recorded activity), and who generated / reviewed it.';
revoke all on function public.plus_list_agent_recommendations(uuid, text, integer, integer) from public, anon;
grant execute on function public.plus_list_agent_recommendations(uuid, text, integer, integer) to authenticated;

-- =============================================================================
-- 6. staff review
-- =============================================================================
create type public.plus_agent_review_outcome as (
  recommendation_id uuid,
  outcome text,          -- approved | already_approved | superseded | dismissed | not_relevant
  task_id uuid,
  changed boolean
);

create function public.plus_approve_agent_recommendation(
  p_organization_id uuid,
  p_recommendation_id uuid,
  p_expected_updated_at timestamptz,
  p_task_title text,
  p_due_at timestamptz,
  p_assignee_membership_id uuid
)
returns public.plus_agent_review_outcome
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec public.plus_agent_recommendations%rowtype;
  v_still boolean;
  v_assignee uuid;
  v_task uuid;
  v_out public.plus_agent_review_outcome;
begin
  -- staff authority and a WRITABLE entitlement, every time (an expired / locked entitlement can never execute)
  perform public._require_plus_write(p_organization_id);

  select * into v_rec from public.plus_agent_recommendations
  where id = p_recommendation_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_out.recommendation_id := v_rec.id;
  -- replay / concurrent approval: the second caller (after the first committed) gets the SAME task, never a new one
  if v_rec.status = 'approved' then
    v_out.outcome := 'already_approved'; v_out.task_id := v_rec.approved_task_id; v_out.changed := false;
    return v_out;
  end if;
  if v_rec.status = 'superseded' then
    v_out.outcome := 'superseded'; v_out.changed := false;
    return v_out;
  end if;
  if v_rec.status <> 'pending' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if v_rec.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  -- Lock the situation's inputs BEFORE revalidating (NP-P2-S2-R1): the opportunity and its contact, in the order every
  -- other writer uses (opportunity, then contact). A concurrent task creation, stage change or logged activity on them
  -- either committed already (and is seen below) or waits for this approval -- never a stale or duplicate task.
  perform 1 from public.plus_opportunities o
  where o.id = v_rec.opportunity_id and o.organization_id = p_organization_id
  for no key update;
  perform 1 from public.plus_contacts c
  where c.organization_id = p_organization_id
    and c.id = (select o.primary_contact_id from public.plus_opportunities o where o.id = v_rec.opportunity_id and o.organization_id = p_organization_id)
  for no key update;

  -- REVALIDATE: the exact situation must still hold now (same type and condition key), else it is withdrawn
  select exists (select 1 from public._plus_agent_candidates(p_organization_id, v_rec.opportunity_id) c
                 where c.recommendation_type = v_rec.recommendation_type and c.condition_key = v_rec.condition_key)
    into v_still;
  if not v_still then
    update public.plus_agent_recommendations set status = 'superseded' where id = v_rec.id;
    v_out.outcome := 'superseded'; v_out.changed := true;
    return v_out;
  end if;

  -- the internal task: same rules as plus_create_task (open opportunity locked; eligible assignee at assignment time)
  perform public._plus_require_task_subject(p_organization_id, null, v_rec.opportunity_id);
  v_assignee := public._plus_resolve_owner(p_organization_id, p_assignee_membership_id);
  v_task := public._plus_insert_task(p_organization_id, p_task_title, p_due_at, v_assignee, null, v_rec.opportunity_id, auth.uid());

  update public.plus_agent_recommendations
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), approved_task_id = v_task
  where id = v_rec.id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_agent_recommendation', v_rec.id, 'plus_agent_recommendation_approved', auth.uid(),
          jsonb_build_object('status', 'pending'),
          jsonb_build_object('status', 'approved', 'type', v_rec.recommendation_type, 'task_id', v_task));

  v_out.outcome := 'approved'; v_out.task_id := v_task; v_out.changed := true;
  return v_out;
end;
$$;
comment on function public.plus_approve_agent_recommendation(uuid, uuid, timestamptz, text, timestamptz, uuid) is
  'NP-P2-S2. Plus WRITE (re-checked every call). Staff approval of a PENDING recommendation: row lock + version (ZW003); the situation is REVALIDATED under the lock (if it changed or ended the recommendation is withdrawn: outcome superseded, no task). Otherwise ONE internal open task is created on the opportunity (staff-edited title, optional due date, optional assignee who must be an eligible Plus writer -- ZW006 otherwise) and linked (approved_task_id, unique). A replay or concurrent second approval returns the same task (already_approved). Dismissed / not_relevant ZW004. NOTHING is sent; no stage, activity or Core change.';
revoke all on function public.plus_approve_agent_recommendation(uuid, uuid, timestamptz, text, timestamptz, uuid) from public, anon;
grant execute on function public.plus_approve_agent_recommendation(uuid, uuid, timestamptz, text, timestamptz, uuid) to authenticated;

create function public.plus_dismiss_agent_recommendation(
  p_organization_id uuid,
  p_recommendation_id uuid,
  p_expected_updated_at timestamptz,
  p_outcome text
)
returns public.plus_agent_review_outcome
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec public.plus_agent_recommendations%rowtype;
  v_out public.plus_agent_review_outcome;
begin
  perform public._require_plus_write(p_organization_id);
  if p_outcome is null or p_outcome not in ('dismissed', 'not_relevant') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  select * into v_rec from public.plus_agent_recommendations
  where id = p_recommendation_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_out.recommendation_id := v_rec.id;
  if v_rec.status = p_outcome then   -- duplicate submission: no-op
    v_out.outcome := v_rec.status; v_out.changed := false;
    return v_out;
  end if;
  if v_rec.status <> 'pending' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if v_rec.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  update public.plus_agent_recommendations set status = p_outcome, reviewed_by = auth.uid(), reviewed_at = now() where id = v_rec.id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_agent_recommendation', v_rec.id, 'plus_agent_recommendation_dismissed', auth.uid(),
          jsonb_build_object('status', 'pending'), jsonb_build_object('status', p_outcome, 'type', v_rec.recommendation_type));
  v_out.outcome := p_outcome; v_out.changed := true;
  return v_out;
end;
$$;
comment on function public.plus_dismiss_agent_recommendation(uuid, uuid, timestamptz, text) is
  'NP-P2-S2. Plus WRITE. Staff dismissal of a PENDING recommendation as dismissed or not_relevant (ZW006 otherwise). Same outcome again -> changed=false; other reviewed state ZW004; stale ZW003; foreign / unknown ZW002. The situation is remembered (condition_key) so it is not recommended again unless it changes.';
revoke all on function public.plus_dismiss_agent_recommendation(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.plus_dismiss_agent_recommendation(uuid, uuid, timestamptz, text) to authenticated;
