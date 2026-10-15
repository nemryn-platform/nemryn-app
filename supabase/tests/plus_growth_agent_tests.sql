-- Nemryn Plus -- Growth Agent + Growth Dashboard tests (NP-P2-S2, Phases C / D). ROLLBACK-ONLY.
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_growth_agent_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261015110000_plus_growth_agent.sql and 20261015120000_plus_growth_dashboard.sql. FICTIONAL fixtures only,
-- written owner-level with back-dated timestamps so each detection rule is exercised deterministically.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table g_results (n serial, name text, ok boolean, detail text);

create function pg_temp.val_as(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute p_stmt into v; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return v;
end;
$$;
create function pg_temp.t(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into g_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;
create function pg_temp.mid(p_org uuid, p_uid uuid) returns uuid language sql as $$
  select id from public.memberships where organization_id = p_org and user_id = p_uid;
$$;
create function pg_temp.set_state(p_org uuid, p_state text)
returns void language plpgsql as $$
begin
  delete from public.organization_modules where organization_id = p_org;
  if p_state = 'none' then return; end if;
  insert into public.organization_modules (organization_id, module, status, restriction, trial_started_at, trial_ends_at, status_reason)
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, 'P2-S2 agent test'
  from (values ('active', 'active', null, null::timestamptz, null::timestamptz),
               ('expired', 'expired', null, now() - interval '20 days', now() - interval '6 days'),
               ('locked', 'disabled', 'no_access', null, null)) as s(name, status, restriction, ts, te)
  where s.name = p_state;
end;
$$;
create function pg_temp.set_grant(p_org uuid, p_uid uuid, p_access text)
returns void language plpgsql as $$
begin
  update public.membership_module_grants set revoked_at = now(), revoked_by = '20000000-0000-0000-0000-0000000000a1'
  where membership_id = pg_temp.mid(p_org, p_uid) and revoked_at is null;
  if p_access <> 'none' then
    insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by)
    values (p_org, pg_temp.mid(p_org, p_uid), 'plus', p_access, '20000000-0000-0000-0000-0000000000a1');
  end if;
end;
$$;
-- fictional contact + opportunity created p_age ago
create function pg_temp.contact(p_org uuid, p_name text, p_dnc boolean default false) returns uuid language sql as $$
  insert into public.plus_contacts (organization_id, display_name, email, contact_kind, do_not_contact, created_by, created_at)
  values (p_org, p_name, lower(replace(p_name, ' ', '.')) || '@example.test', 'individual', p_dnc, '20000000-0000-0000-0000-0000000000a1', now() - interval '60 days')
  returning id;
$$;
create function pg_temp.opp(p_org uuid, p_contact uuid, p_title text, p_stage text, p_age interval) returns uuid language sql as $$
  insert into public.plus_opportunities (organization_id, title, stage, primary_contact_id, source, created_by, created_at)
  values (p_org, p_title, p_stage, p_contact, 'phone', '20000000-0000-0000-0000-0000000000a1', now() - p_age)
  returning id;
$$;
create function pg_temp.act(p_org uuid, p_contact uuid, p_opp uuid, p_type text, p_ago interval, p_from text default null, p_to text default null) returns uuid language sql as $$
  insert into public.plus_activities (organization_id, contact_id, opportunity_id, activity_type, body, from_stage, to_stage, actor_user_id, occurred_at, recorded_at)
  values (p_org, p_contact, p_opp, p_type, case when p_type in ('note', 'call_logged', 'email_logged', 'meeting_logged') then 'Fictional entry.' end,
          p_from, p_to, '20000000-0000-0000-0000-0000000000a1', now() - p_ago, now() - p_ago)
  returning id;
$$;
create function pg_temp.run(p_uid uuid, p_org uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format('select r.created || ''/'' || r.superseded || ''/'' || r.unchanged from public.plus_run_growth_agent_review(%L::uuid) r', p_org)), 'NULL');
$$;
create function pg_temp.rec(p_org uuid, p_opp uuid) returns uuid language sql as $$
  select id from public.plus_agent_recommendations where organization_id = p_org and opportunity_id = p_opp order by created_at desc, id desc limit 1;
$$;
create function pg_temp.rver(p_rec uuid) returns timestamptz language sql as $$ select updated_at from public.plus_agent_recommendations where id = p_rec; $$;
create function pg_temp.rst(p_rec uuid) returns text language sql as $$ select status from public.plus_agent_recommendations where id = p_rec; $$;
create function pg_temp.approve(p_uid uuid, p_org uuid, p_rec uuid, p_expected timestamptz, p_title text, p_assignee uuid default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.outcome || '':'' || coalesce(r.task_id::text, ''-'') || '':'' || r.changed from public.plus_approve_agent_recommendation(%L::uuid, %L::uuid, %L::timestamptz, %L, now() + interval ''1 day'', %L::uuid) r',
    p_org, p_rec, p_expected, p_title, p_assignee)), 'NULL');
$$;
create function pg_temp.dismiss(p_uid uuid, p_org uuid, p_rec uuid, p_expected timestamptz, p_outcome text)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.outcome || '':'' || r.changed from public.plus_dismiss_agent_recommendation(%L::uuid, %L::uuid, %L::timestamptz, %L) r', p_org, p_rec, p_expected, p_outcome)), 'NULL');
$$;
create function pg_temp.lst(p_uid uuid, p_org uuid, p_view text default 'pending') returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format('select count(*)::text from public.plus_list_agent_recommendations(%L::uuid, %L, 100, 0)', p_org, p_view)), 'NULL');
$$;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  c_a3 constant uuid := '20000000-0000-0000-0000-0000000000a3';
  c_b1 constant uuid := '20000000-0000-0000-0000-0000000000b1';
  c_d1 constant uuid := '20000000-0000-0000-0000-0000000000d1';
  v text; v2 text;
  k_nia uuid; k_rae uuid; k_sol uuid; k_fay uuid; k_tom uuid; k_lou uuid; k_dee uuid; k_xan uuid; k_bea uuid;
  o_nia uuid; o_rae uuid; o_sol uuid; o_fay uuid; o_tom uuid; o_lou uuid; o_dee uuid; o_xan uuid; o_bea uuid;
  r_nia uuid; r_rae uuid; r_sol uuid; r_dee uuid; v_task uuid; v_acts bigint; v_tasks bigint; v_stages text; v_core text;
begin
  v_core := (select count(*) from public.transportation_requests)::text || '/' || (select count(*) from public.passengers)::text
            || '/' || (select count(*) from public.trips)::text || '/' || (select count(*) from public.trip_assignments)::text;
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_state(c_b, 'active');

  -- ===== fixtures: one opportunity per rule, plus exclusions (all fictional)
  k_nia := pg_temp.contact(c_a, 'Nia Fictional');      o_nia := pg_temp.opp(c_a, k_nia, 'Waiting new inquiry', 'new_inquiry', interval '3 days');
  k_rae := pg_temp.contact(c_a, 'Rae Fictional');      o_rae := pg_temp.opp(c_a, k_rae, 'Outreach no reply', 'contacted', interval '9 days');
  perform pg_temp.act(c_a, null, o_rae, 'stage_changed', interval '8 days', 'new_inquiry', 'contacted');
  perform pg_temp.act(c_a, k_rae, null, 'call_logged', interval '6 days');
  k_sol := pg_temp.contact(c_a, 'Sol Fictional');      o_sol := pg_temp.opp(c_a, k_sol, 'Quiet qualified', 'qualified', interval '30 days');
  perform pg_temp.act(c_a, k_sol, null, 'note', interval '12 days');
  k_fay := pg_temp.contact(c_a, 'Fay Fictional');      o_fay := pg_temp.opp(c_a, k_fay, 'Fresh one', 'new_inquiry', interval '1 day');
  k_tom := pg_temp.contact(c_a, 'Tom Fictional');      o_tom := pg_temp.opp(c_a, k_tom, 'Has open task', 'qualified', interval '30 days');
  perform pg_temp.act(c_a, k_tom, null, 'note', interval '20 days');
  insert into public.plus_tasks (organization_id, title, due_at, opportunity_id, created_by) values (c_a, 'Planned follow-up', now() + interval '2 days', o_tom, c_a1);
  k_lou := pg_temp.contact(c_a, 'Lou Fictional');      o_lou := pg_temp.opp(c_a, k_lou, 'Already lost', 'qualified', interval '30 days');
  update public.plus_opportunities set stage = 'lost', lost_reason = 'price', closed_at = now() where id = o_lou;
  k_dee := pg_temp.contact(c_a, 'Dee Fictional', true); o_dee := pg_temp.opp(c_a, k_dee, 'Do not contact quiet', 'qualified', interval '30 days');
  k_xan := pg_temp.contact(c_a, 'Xan Fictional');      o_xan := pg_temp.opp(c_a, k_xan, 'Archived contact quiet', 'qualified', interval '30 days');
  update public.plus_contacts set status = 'archived' where id = k_xan;
  k_bea := pg_temp.contact(c_b, 'Bea Fictional');      o_bea := pg_temp.opp(c_b, k_bea, 'Org B quiet', 'qualified', interval '30 days');
  insert into public.plus_tasks (organization_id, title, due_at, contact_id, created_by) values (c_a, 'Overdue chore', now() - interval '2 hours', k_fay, c_a1);
  v_acts := (select count(*) from public.plus_activities);
  v_stages := (select string_agg(id::text || stage, ',' order by id) from public.plus_opportunities where organization_id = c_a);

  -- ===== schema / privileges / minimisation
  perform pg_temp.t('S1 queue: RLS on, one SELECT policy (plus_can_read), authenticated SELECT only; direct writes refused',
    (select relrowsecurity from pg_class where oid = 'public.plus_agent_recommendations'::regclass)
    and (select count(*) from pg_policy where polrelid = 'public.plus_agent_recommendations'::regclass) = 1
    and exists (select 1 from pg_policy where polrelid = 'public.plus_agent_recommendations'::regclass and polcmd = 'r' and pg_get_expr(polqual, polrelid) ~ 'plus_can_read\(organization_id\)')
    and (select string_agg(grantee || ':' || privilege_type, ',') from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'plus_agent_recommendations' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) = 'authenticated:SELECT'
    and pg_temp.val_as('authenticated', c_a1, format($q$insert into public.plus_agent_recommendations (organization_id, opportunity_id, recommendation_type, condition_key, signal_days, generated_by) values (%L, %L, 'no_recent_activity', 'x', 1, %L) returning 'x'$q$, c_a, o_sol, c_a1)) = 'ERR:42501'
    and pg_temp.val_as('authenticated', c_a1, 'update public.plus_agent_recommendations set status = ''approved'' returning ''x''') = 'ERR:42501');
  perform pg_temp.t('S2 structured codes only: no contact PII, message text, draft or JSON column; FKs to organizations / auth.users / opportunity / task only',
    (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'plus_agent_recommendations')
      = 'id,organization_id,opportunity_id,recommendation_type,proposed_action,condition_key,signal_days,last_activity_at,status,generation_source,generated_by,reviewed_by,reviewed_at,approved_task_id,created_at,updated_at'
    and (select bool_and(confrelid::regclass::text in ('organizations', 'public.organizations', 'auth.users', 'plus_opportunities', 'public.plus_opportunities', 'plus_tasks', 'public.plus_tasks'))
         from pg_constraint where contype = 'f' and conrelid = 'public.plus_agent_recommendations'::regclass));
  perform pg_temp.t('S3 the only proposable action is an internal follow-up task; the only source is a staff review',
    exists (select 1 from pg_constraint where conname = 'plus_agent_recommendations_action_check' and pg_get_constraintdef(oid) ~ 'create_follow_up_task' and pg_get_constraintdef(oid) !~ 'send|email|sms|call')
    and exists (select 1 from pg_constraint where conname = 'plus_agent_recommendations_source_check' and pg_get_constraintdef(oid) ~ 'staff_review'));
  perform pg_temp.t('S4 RPCs authenticated-only; internals (threshold, detection, review) have no client EXECUTE; definer + pinned search_path',
    (select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('plus_run_growth_agent_review', 'plus_list_agent_recommendations', 'plus_approve_agent_recommendation', 'plus_dismiss_agent_recommendation',
                         'plus_growth_dashboard', 'plus_list_attention_opportunities', 'plus_list_recent_activities'))
    and (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('_plus_agent_threshold', '_plus_agent_candidates', '_plus_agent_review'))
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('plus_run_growth_agent_review', 'plus_list_agent_recommendations', 'plus_approve_agent_recommendation', 'plus_dismiss_agent_recommendation',
                         'plus_growth_dashboard', 'plus_list_attention_opportunities', 'plus_list_recent_activities', '_plus_agent_candidates', '_plus_agent_review')
       and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 9);
  perform pg_temp.t('S5 no outbound code path: no agent / dashboard function uses pg_net, http, dblink, email or SMS',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and (p.proname ~ 'agent|dashboard|attention|recent_activities' or p.proname ~ '_task')
      and p.prosrc ~* '(net\.|http_|dblink|pg_notify|send_email|sendgrid|twilio|resend)'));
  perform pg_temp.t('S6 internal-test thresholds are explicit: 2 / 5 / 10 / 1 days',
    public._plus_agent_threshold('new_inquiry_waiting_days') = 2 and public._plus_agent_threshold('awaiting_response_days') = 5
    and public._plus_agent_threshold('no_recent_activity_days') = 10 and public._plus_agent_threshold('suggested_due_days') = 1);

  -- ===== detection
  perform pg_temp.t('D1 detection: new inquiry waiting / awaiting response / no recent activity (incl. do-not-contact); fresh, open-task, lost, archived-contact excluded',
    (select string_agg(o.title || '=' || c.recommendation_type, ',' order by o.title) from public._plus_agent_candidates(c_a, null) c join public.plus_opportunities o on o.id = c.opportunity_id)
      = 'Do not contact quiet=no_recent_activity,Outreach no reply=awaiting_response,Quiet qualified=no_recent_activity,Waiting new inquiry=new_inquiry_waiting',
    (select string_agg(o.title || '=' || c.recommendation_type, ',' order by o.title) from public._plus_agent_candidates(c_a, null) c join public.plus_opportunities o on o.id = c.opportunity_id));
  perform pg_temp.t('D2 explainable: signal days and last recorded activity per candidate',
    (select signal_days from public._plus_agent_candidates(c_a, o_rae)) = 6 and (select signal_days from public._plus_agent_candidates(c_a, o_sol)) = 12
    and (select signal_days from public._plus_agent_candidates(c_a, o_nia)) = 3
    and (select last_activity_at is not null from public._plus_agent_candidates(c_a, o_rae)));
  perform pg_temp.t('D3 detection is per organization (Org B''s quiet opportunity never appears for Org A)',
    not exists (select 1 from public._plus_agent_candidates(c_a, null) where opportunity_id = o_bea)
    and exists (select 1 from public._plus_agent_candidates(c_b, null) where opportunity_id = o_bea));

  -- ===== review cycle
  v := pg_temp.run(c_a1, c_a);
  r_nia := pg_temp.rec(c_a, o_nia); r_rae := pg_temp.rec(c_a, o_rae); r_sol := pg_temp.rec(c_a, o_sol); r_dee := pg_temp.rec(c_a, o_dee);
  perform pg_temp.t('R1 staff review creates 4 pending recommendations (created/superseded/unchanged = 4/0/0)', v = '4/0/0'
    and (select count(*) from public.plus_agent_recommendations where organization_id = c_a and status = 'pending') = 4, v);
  perform pg_temp.t('R2 who / how recorded: generated_by = the staff member, source staff_review; review audited with counts only',
    (select bool_and(generated_by = c_a1 and generation_source = 'staff_review') from public.plus_agent_recommendations where organization_id = c_a)
    and (select after_data = '{"source": "staff_review", "created": 4, "unchanged": 0, "superseded": 0}'::jsonb from public.audit_events where organization_id = c_a and action = 'plus_agent_review_run'));
  v := pg_temp.run(c_a1, c_a);
  perform pg_temp.t('R3 unchanged situations are NOT recommended twice (0/0/4)', v = '0/0/4'
    and (select count(*) from public.plus_agent_recommendations where organization_id = c_a) = 4, v);
  perform pg_temp.t('R4 the review changes nothing else: no task, activity, stage or lost transition',
    (select count(*) from public.plus_activities) = v_acts
    and (select string_agg(id::text || stage, ',' order by id) from public.plus_opportunities where organization_id = c_a) = v_stages
    and (select count(*) from public.plus_tasks where organization_id = c_a) = 2);
  perform pg_temp.t('R5 list shows the reason and contact PREFERENCES (do-not-contact flagged), not contact values',
    pg_temp.lst(c_a1, c_a) = '4'
    and pg_temp.val_as('authenticated', c_a1, format('select contact_do_not_contact::text || ''/'' || recommendation_type from public.plus_list_agent_recommendations(%L, ''pending'', 100, 0) where opportunity_id = %L', c_a, o_dee)) = 'true/no_recent_activity'
    and pg_temp.val_as('authenticated', c_a1, format('select last_activity_type from public.plus_list_agent_recommendations(%L, ''pending'', 100, 0) where opportunity_id = %L', c_a, o_rae)) = 'call_logged');

  -- ===== dismiss
  v := pg_temp.dismiss(c_a1, c_a, r_sol, pg_temp.rver(r_sol), 'not_relevant');
  perform pg_temp.t('X1 dismiss as not relevant: recorded with reviewer and time', v = 'not_relevant:true'
    and (select reviewed_by = c_a1 and reviewed_at is not null and approved_task_id is null from public.plus_agent_recommendations where id = r_sol), v);
  v := pg_temp.dismiss(c_a1, c_a, r_sol, pg_temp.rver(r_sol) - interval '1 hour', 'not_relevant') || '|' || pg_temp.dismiss(c_a1, c_a, r_sol, pg_temp.rver(r_sol), 'dismissed')
    || '|' || pg_temp.dismiss(c_a1, c_a, r_dee, pg_temp.rver(r_dee), 'ignored') || '|' || pg_temp.dismiss(c_a1, c_a, r_dee, pg_temp.rver(r_dee) - interval '1 second', 'dismissed');
  perform pg_temp.t('X2 duplicate dismiss no-op; other outcome after review ZW004; bad outcome ZW006; stale ZW003', v = 'not_relevant:false|ERR:ZW004|ERR:ZW006|ERR:ZW003', v);
  v := pg_temp.run(c_a1, c_a);
  perform pg_temp.t('X3 a dismissed situation is not recommended again while unchanged', v = '0/0/4' and pg_temp.rst(r_sol) = 'not_relevant', v);

  -- ===== approve
  v_tasks := (select count(*) from public.plus_tasks);
  perform pg_temp.t('A1 approve with a stale version -> ZW003, nothing created', pg_temp.approve(c_a1, c_a, r_nia, pg_temp.rver(r_nia) - interval '1 second', 'Follow up: Waiting new inquiry') = 'ERR:ZW003'
    and (select count(*) from public.plus_tasks) = v_tasks);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  perform pg_temp.t('A2 approve with an ineligible assignee (read grant) -> ZW006; recommendation stays pending, no task',
    pg_temp.approve(c_a1, c_a, r_nia, pg_temp.rver(r_nia), 'Follow up', pg_temp.mid(c_a, c_a2)) = 'ERR:ZW006' and pg_temp.rst(r_nia) = 'pending' and (select count(*) from public.plus_tasks) = v_tasks);
  v := pg_temp.approve(c_a1, c_a, r_nia, pg_temp.rver(r_nia), '  Follow up: Waiting new inquiry  ', pg_temp.mid(c_a, c_a1));
  v_task := (select approved_task_id from public.plus_agent_recommendations where id = r_nia);
  perform pg_temp.t('A3 approve: ONE internal open task on the opportunity, linked; reviewer recorded; audited', v = 'approved:' || v_task || ':true'
    and (select opportunity_id = o_nia and status = 'open' and title = 'Follow up: Waiting new inquiry' and assignee_user_id = c_a1 and created_by = c_a1 from public.plus_tasks where id = v_task)
    and (select status = 'approved' and reviewed_by = c_a1 from public.plus_agent_recommendations where id = r_nia)
    and (select count(*) from public.audit_events where entity_id = r_nia and action = 'plus_agent_recommendation_approved') = 1, v);
  v := pg_temp.approve(c_a1, c_a, r_nia, pg_temp.rver(r_nia) - interval '1 hour', 'Again');
  perform pg_temp.t('A4 replayed approval returns the SAME task (already_approved); no second task', v = 'already_approved:' || v_task || ':false'
    and (select count(*) from public.plus_tasks) = v_tasks + 1, v);
  perform pg_temp.t('A5 approval sends nothing and claims no outreach: no activity written, stage unchanged',
    (select count(*) from public.plus_activities) = v_acts and (select stage from public.plus_opportunities where id = o_nia) = 'new_inquiry');
  perform pg_temp.act(c_a, k_rae, null, 'note', interval '0 seconds');   -- the situation changes: staff logged something new
  v := pg_temp.approve(c_a1, c_a, r_rae, pg_temp.rver(r_rae), 'Follow up: Outreach no reply');
  perform pg_temp.t('A6 revalidation: a recommendation whose situation changed is withdrawn on approval (superseded, no task)',
    v = 'superseded:-:true' and pg_temp.rst(r_rae) = 'superseded' and (select count(*) from public.plus_tasks) = v_tasks + 1, v);
  v := pg_temp.approve(c_a1, c_a, r_rae, pg_temp.rver(r_rae), 'Again') || '|' || pg_temp.approve(c_a1, c_a, r_sol, pg_temp.rver(r_sol), 'Dismissed one');
  perform pg_temp.t('A7 approving a superseded one -> superseded no-op; a dismissed one -> ZW004', v = 'superseded:-:false|ERR:ZW004', v);
  v := pg_temp.run(c_a1, c_a);
  perform pg_temp.t('A8 next review: N now has an open task and R has new activity -> neither re-recommended (D stays pending)',
    v = '0/0/2' and (select count(*) from public.plus_agent_recommendations where organization_id = c_a and status = 'pending') = 1, v);

  -- ===== permissions / entitlement / tenant isolation
  perform pg_temp.t('P1 READ-grant Dispatcher: can view recommendations; cannot run, approve or dismiss (ZW001)',
    pg_temp.lst(c_a2, c_a) = '1' and pg_temp.run(c_a2, c_a) = 'ERR:ZW001'
    and pg_temp.approve(c_a2, c_a, r_dee, pg_temp.rver(r_dee), 'X') = 'ERR:ZW001' and pg_temp.dismiss(c_a2, c_a, r_dee, pg_temp.rver(r_dee), 'dismissed') = 'ERR:ZW001');
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  perform pg_temp.t('P2 revoked Dispatcher: no access (ZW002) to view or approve', pg_temp.lst(c_a2, c_a) = 'ERR:ZW002'
    and pg_temp.approve(c_a2, c_a, r_dee, pg_temp.rver(r_dee), 'X') = 'ERR:ZW002');
  perform pg_temp.t('P3 Driver / Platform Admin without membership: ZW002', pg_temp.lst(c_a3, c_a) = 'ERR:ZW002' and pg_temp.lst(c_d1, c_a) = 'ERR:ZW002'
    and pg_temp.run(c_d1, c_a) = 'ERR:ZW002');
  perform pg_temp.t('P4 cross-tenant: Org B Admin cannot list / run / approve Org A''s; forged Org A rec under Org B -> ZW002',
    pg_temp.lst(c_b1, c_a) = 'ERR:ZW002' and pg_temp.run(c_b1, c_a) = 'ERR:ZW002'
    and pg_temp.approve(c_b1, c_b, r_dee, pg_temp.rver(r_dee), 'Forged') = 'ERR:ZW002' and pg_temp.dismiss(c_b1, c_b, r_dee, pg_temp.rver(r_dee), 'dismissed') = 'ERR:ZW002'
    and pg_temp.val_as('authenticated', c_b1, 'select count(*)::text from public.plus_agent_recommendations') = '0');
  perform pg_temp.set_state(c_a, 'expired');
  perform pg_temp.t('P5 entitlement no longer writable: no review, approval or dismissal executes (ZW001); Admin can still view',
    pg_temp.run(c_a1, c_a) = 'ERR:ZW001' and pg_temp.approve(c_a1, c_a, r_dee, pg_temp.rver(r_dee), 'X') = 'ERR:ZW001'
    and pg_temp.dismiss(c_a1, c_a, r_dee, pg_temp.rver(r_dee), 'dismissed') = 'ERR:ZW001' and pg_temp.lst(c_a1, c_a) = '1' and pg_temp.rst(r_dee) = 'pending');
  perform pg_temp.set_state(c_a, 'locked');
  perform pg_temp.t('P6 locked: nothing readable', pg_temp.lst(c_a1, c_a) = 'ERR:ZW002');
  perform pg_temp.set_state(c_a, 'active');

  -- ===== dashboard
  perform pg_temp.t('B1 dashboard counts equal direct counts (opportunities by stage, contacts, tasks, recommendations, attention)',
    pg_temp.val_as('authenticated', c_a1, format('select concat_ws(''/'', active_opportunities, stage_new_inquiry, stage_contacted, stage_qualified, stage_quote_sent, stage_quote_accepted, active_contacts, open_tasks, overdue_tasks, due_today_tasks, my_open_tasks, pending_recommendations, attention_opportunities) from public.plus_growth_dashboard(%L)', c_a))
    = concat_ws('/',
        (select count(*) from public.plus_opportunities where organization_id = c_a and stage not in ('lost', 'converted')),
        (select count(*) from public.plus_opportunities where organization_id = c_a and stage = 'new_inquiry'),
        (select count(*) from public.plus_opportunities where organization_id = c_a and stage = 'contacted'),
        (select count(*) from public.plus_opportunities where organization_id = c_a and stage = 'qualified'),
        0, 0,
        (select count(*) from public.plus_contacts where organization_id = c_a and status = 'active'),
        (select count(*) from public.plus_tasks where organization_id = c_a and status = 'open'),
        (select count(*) from public.plus_tasks where organization_id = c_a and status = 'open' and due_at < now()),
        (select count(*) from public.plus_tasks t, public._plus_org_day_bounds(c_a) b where t.organization_id = c_a and t.status = 'open' and t.due_at >= now() and t.due_at < b.day_end),
        (select count(*) from public.plus_tasks where organization_id = c_a and status = 'open' and assignee_user_id = c_a1),
        (select count(*) from public.plus_agent_recommendations where organization_id = c_a and status = 'pending'),
        (select count(*) from public._plus_agent_candidates(c_a, null))),
    pg_temp.val_as('authenticated', c_a1, format('select concat_ws(''/'', active_opportunities, stage_new_inquiry, stage_contacted, stage_qualified, stage_quote_sent, stage_quote_accepted, active_contacts, open_tasks, overdue_tasks, due_today_tasks, my_open_tasks, pending_recommendations, attention_opportunities) from public.plus_growth_dashboard(%L)', c_a)));
  perform pg_temp.t('B2 Org B''s dashboard never includes Org A data (1 open opportunity, 1 contact, 0 tasks)',
    pg_temp.val_as('authenticated', c_b1, format('select concat_ws(''/'', active_opportunities, active_contacts, open_tasks, pending_recommendations) from public.plus_growth_dashboard(%L)', c_b)) = '1/1/0/0'
    and pg_temp.val_as('authenticated', c_b1, format('select count(*)::text from public.plus_growth_dashboard(%L)', c_a)) = 'ERR:ZW002');
  delete from public.plus_opportunities where organization_id = c_b;
  delete from public.plus_contacts where organization_id = c_b;
  perform pg_temp.t('B3 an empty workspace shows zeros (not errors)',
    pg_temp.val_as('authenticated', c_b1, format('select concat_ws(''/'', active_opportunities, stage_new_inquiry, active_contacts, open_tasks, overdue_tasks, due_today_tasks, pending_recommendations, attention_opportunities) from public.plus_growth_dashboard(%L)', c_b)) = '0/0/0/0/0/0/0/0');
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  perform pg_temp.t('B4 read-grant Dispatcher can view the dashboard; no grant cannot',
    pg_temp.val_as('authenticated', c_a2, format('select active_opportunities::text from public.plus_growth_dashboard(%L)', c_a)) ~ '^[0-9]+$'
    and pg_temp.val_as('authenticated', c_a3, format('select active_opportunities::text from public.plus_growth_dashboard(%L)', c_a)) = 'ERR:ZW002');
  perform pg_temp.t('B5 attention list = the agent detection (same opportunities), longest-waiting first',
    pg_temp.val_as('authenticated', c_a1, format('select string_agg(opportunity_title, '','') from public.plus_list_attention_opportunities(%L, 10)', c_a))
      = (select string_agg(o.title, ',' order by c.signal_days desc, o.id) from public._plus_agent_candidates(c_a, null) c join public.plus_opportunities o on o.id = c.opportunity_id));
  perform pg_temp.t('B6 recent activity is scoped to the organization and returns no bodies',
    pg_temp.val_as('authenticated', c_a1, format('select count(*)::text from public.plus_list_recent_activities(%L, 50)', c_a)) = (select least(count(*), 50)::text from public.plus_activities where organization_id = c_a)
    and not exists (select 1 from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name
                    where r.routine_name = 'plus_list_recent_activities' and p.parameter_mode = 'OUT' and p.parameter_name = 'body'));
  perform pg_temp.t('B7 bad limits -> ZW006', pg_temp.val_as('authenticated', c_a1, format('select count(*)::text from public.plus_list_attention_opportunities(%L, 99)', c_a)) = 'ERR:ZW006');

  -- ===== Core isolation
  perform pg_temp.t('K1 no Core Request / Passenger / Trip / assignment written by the agent or dashboard',
    v_core = (select count(*) from public.transportation_requests)::text || '/' || (select count(*) from public.passengers)::text
             || '/' || (select count(*) from public.trips)::text || '/' || (select count(*) from public.trip_assignments)::text);
  perform pg_temp.t('K2 no agent function writes Core, opportunity stages, plus_activities or contacts',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ~ 'agent'
      and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(transportation_requests|passengers|trips|trip_assignments|plus_activities|plus_contacts|plus_opportunities)'));
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from g_results;
select name, detail from g_results where not ok order by n;

rollback;
