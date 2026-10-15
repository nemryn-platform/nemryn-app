-- Nemryn Plus -- tasks & follow-ups tests (NP-P2-S2, Phase A). ROLLBACK-ONLY (one transaction, rolled back).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_tasks_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261015100000_plus_tasks.sql. FICTIONAL seed fixtures only (Org A admin a1, dispatcher a2, driver a3,
-- inactive dispatcher a5; Org B admin b1; c1 admin in A + driver in B; d1 platform admin; e1 no membership). Contacts /
-- opportunities are owner-level fixtures. Side effects are evaluated into variables BEFORE assertions.
-- Inside one transaction now() is constant: "stale" versions are simulated with a different timestamp, and due dates
-- for the today / upcoming views are computed from the organization's own day bounds (never straddling midnight).

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table t_results (n serial, name text, ok boolean, detail text);

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
  insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
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
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, 'P2-S2 task test'
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
create function pg_temp.contact(p_org uuid, p_name text, p_creator uuid) returns uuid language sql as $$
  insert into public.plus_contacts (organization_id, display_name, email, contact_kind, created_by)
  values (p_org, p_name, lower(replace(p_name, ' ', '.')) || '@example.test', 'individual', p_creator) returning id;
$$;
create function pg_temp.opp(p_org uuid, p_contact uuid, p_title text, p_creator uuid) returns uuid language sql as $$
  insert into public.plus_opportunities (organization_id, title, primary_contact_id, source, created_by)
  values (p_org, p_title, p_contact, 'phone', p_creator) returning id;
$$;
-- create as a caller -> task id / 'noop:<id>' / ERR
create function pg_temp.mk(p_uid uuid, p_org uuid, p_title text, p_due timestamptz, p_assignee uuid, p_contact uuid, p_opp uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select case when r.changed then r.task_id::text else ''noop:'' || r.task_id end from public.plus_create_task(%L::uuid, %L, %L::timestamptz, %L::uuid, %L::uuid, %L::uuid) r',
    p_org, p_title, p_due, p_assignee, p_contact, p_opp)), 'NULL');
$$;
create function pg_temp.ver(p_task uuid) returns timestamptz language sql as $$ select updated_at from public.plus_tasks where id = p_task; $$;
create function pg_temp.st(p_task uuid) returns text language sql as $$ select status from public.plus_tasks where id = p_task; $$;
create function pg_temp.upd(p_uid uuid, p_org uuid, p_task uuid, p_expected timestamptz, p_title text, p_due timestamptz, p_assignee uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed from public.plus_update_task(%L::uuid, %L::uuid, %L::timestamptz, %L, %L::timestamptz, %L::uuid) r',
    p_org, p_task, p_expected, p_title, p_due, p_assignee)), 'NULL');
$$;
create function pg_temp.reassign(p_uid uuid, p_org uuid, p_task uuid, p_expected timestamptz, p_assignee uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed from public.plus_reassign_task(%L::uuid, %L::uuid, %L::timestamptz, %L::uuid) r', p_org, p_task, p_expected, p_assignee)), 'NULL');
$$;
create function pg_temp.done(p_uid uuid, p_org uuid, p_task uuid, p_expected timestamptz)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.status || '':'' || r.changed from public.plus_complete_task(%L::uuid, %L::uuid, %L::timestamptz) r', p_org, p_task, p_expected)), 'NULL');
$$;
create function pg_temp.cancel(p_uid uuid, p_org uuid, p_task uuid, p_expected timestamptz)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.status || '':'' || r.changed from public.plus_cancel_task(%L::uuid, %L::uuid, %L::timestamptz) r', p_org, p_task, p_expected)), 'NULL');
$$;
create function pg_temp.lst(p_uid uuid, p_org uuid, p_view text, p_search text default null, p_assignee uuid default null,
                            p_contact uuid default null, p_opp uuid default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select count(*)::text from public.plus_list_tasks(%L::uuid, %L, %L, %L::uuid, %L::uuid, %L::uuid, 200, 0)', p_org, p_view, p_search, p_assignee, p_contact, p_opp)), 'NULL');
$$;
create function pg_temp.get(p_uid uuid, p_org uuid, p_task uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format('select title from public.plus_get_task(%L::uuid, %L::uuid)', p_org, p_task)), 'NULL');
$$;
create function pg_temp.rls(p_uid uuid, p_org uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format('select count(*)::text from public.plus_tasks where organization_id = %L', p_org)), 'NULL');
$$;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  c_a3 constant uuid := '20000000-0000-0000-0000-0000000000a3';
  c_a5 constant uuid := '20000000-0000-0000-0000-0000000000a5';
  c_b1 constant uuid := '20000000-0000-0000-0000-0000000000b1';
  c_c1 constant uuid := '20000000-0000-0000-0000-0000000000c1';
  c_d1 constant uuid := '20000000-0000-0000-0000-0000000000d1';
  c_e1 constant uuid := '20000000-0000-0000-0000-0000000000e1';
  v text; v2 text; ct1 uuid; ct_arch uuid; ct_b uuid; op1 uuid; op_lost uuid; op_b uuid;
  t1 uuid; t2 uuid; t_over uuid; t_today uuid; t_up uuid; t_none uuid; t3 uuid;
  v_start timestamptz; v_end timestamptz; v_core text; v_core2 text; v_acts bigint;
begin
  v_core := (select count(*) from public.transportation_requests)::text || '/' || (select count(*) from public.passengers)::text
            || '/' || (select count(*) from public.trips)::text || '/' || (select count(*) from public.trip_assignments)::text;
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_state(c_b, 'active');
  ct1 := pg_temp.contact(c_a, 'Task Fictional', c_a1);
  ct_arch := pg_temp.contact(c_a, 'Archived Task Fictional', c_a1);
  update public.plus_contacts set status = 'archived' where id = ct_arch;
  ct_b := pg_temp.contact(c_b, 'Task In B', c_b1);
  op1 := pg_temp.opp(c_a, ct1, 'Task opportunity', c_a1);
  op_lost := pg_temp.opp(c_a, ct1, 'Lost opportunity', c_a1);
  update public.plus_opportunities set stage = 'lost', lost_reason = 'price', closed_at = now() where id = op_lost;
  op_b := pg_temp.opp(c_b, ct_b, 'B opportunity', c_b1);
  v_acts := (select count(*) from public.plus_activities);
  select b.day_start, b.day_end into v_start, v_end from public._plus_org_day_bounds(c_a) b;

  -- ============================================== schema / privileges
  perform pg_temp.t('S1 RLS on; one SELECT policy TO authenticated using plus_can_read(organization_id); authenticated SELECT only',
    (select relrowsecurity from pg_class where oid = 'public.plus_tasks'::regclass)
    and (select count(*) from pg_policy where polrelid = 'public.plus_tasks'::regclass) = 1
    and exists (select 1 from pg_policy where polrelid = 'public.plus_tasks'::regclass and polcmd = 'r'
                and pg_get_expr(polqual, polrelid) ~ 'plus_can_read\(organization_id\)' and polroles = array['authenticated'::regrole]::oid[])
    and (select string_agg(grantee || ':' || privilege_type, ',') from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'plus_tasks' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) = 'authenticated:SELECT');
  v := pg_temp.val_as('authenticated', c_a1, format($q$insert into public.plus_tasks (organization_id, title, contact_id, created_by) values (%L, 'X', %L, %L) returning 'x'$q$, c_a, ct1, c_a1))
    || pg_temp.val_as('authenticated', c_a1, 'update public.plus_tasks set status = ''done'' returning ''x''')
    || pg_temp.val_as('authenticated', c_a1, 'delete from public.plus_tasks returning ''x''')
    || pg_temp.val_as('anon', null, 'select count(*)::text from public.plus_tasks');
  perform pg_temp.t('S2 direct INSERT / UPDATE / DELETE as an entitled Admin, and anon SELECT -> 42501', v = repeat('ERR:42501', 4), v);
  perform pg_temp.t('S3 canonical columns only: no account_id, no Core request_id, no JSON',
    (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'plus_tasks')
    = 'id,organization_id,title,due_at,assignee_user_id,contact_id,opportunity_id,status,completed_at,completed_by,created_by,created_at,updated_at');
  perform pg_temp.t('S4 FKs only to organizations, auth.users, plus_contacts, plus_opportunities (composite for subjects); named subject check',
    (select bool_and(confrelid::regclass::text in ('organizations', 'public.organizations', 'auth.users', 'plus_contacts', 'public.plus_contacts', 'plus_opportunities', 'public.plus_opportunities'))
       from pg_constraint where contype = 'f' and conrelid = 'public.plus_tasks'::regclass)
    and exists (select 1 from pg_constraint where conname = 'plus_tasks_contact_fkey' and pg_get_constraintdef(oid) = 'FOREIGN KEY (contact_id, organization_id) REFERENCES plus_contacts(id, organization_id)')
    and exists (select 1 from pg_constraint where conname = 'plus_tasks_opportunity_fkey' and pg_get_constraintdef(oid) = 'FOREIGN KEY (opportunity_id, organization_id) REFERENCES plus_opportunities(id, organization_id)')
    and exists (select 1 from pg_constraint where conname = 'plus_tasks_subject_check' and pg_get_constraintdef(oid) ~ 'num_nonnulls\(contact_id, opportunity_id\) = 1'));
  perform pg_temp.t('S5 RPCs authenticated-only; internals none; SECURITY DEFINER + pinned search_path',
    (select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('plus_list_tasks', 'plus_get_task', 'plus_create_task', 'plus_update_task', 'plus_reassign_task', 'plus_complete_task', 'plus_cancel_task'))
    and (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('_plus_org_day_bounds', '_plus_require_task_subject', '_plus_insert_task'))
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('plus_list_tasks', 'plus_get_task', 'plus_create_task', 'plus_update_task', 'plus_reassign_task', 'plus_complete_task',
                         'plus_cancel_task', '_plus_org_day_bounds', '_plus_require_task_subject', '_plus_insert_task')
       and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 10);
  begin
    insert into public.plus_tasks (organization_id, title, contact_id, opportunity_id, created_by) values (c_a, 'Both', ct1, op1, c_a1);
    perform pg_temp.t('S6 exactly one subject: both refused', false);
  exception when check_violation then perform pg_temp.t('S6 exactly one subject: both refused', true);
  end;
  begin
    insert into public.plus_tasks (organization_id, title, created_by) values (c_a, 'Neither', c_a1);
    perform pg_temp.t('S7 exactly one subject: neither refused', false);
  exception when check_violation then perform pg_temp.t('S7 exactly one subject: neither refused', true);
  end;
  begin
    insert into public.plus_tasks (organization_id, title, contact_id, created_by) values (c_a, 'Cross', ct_b, c_a1);
    perform pg_temp.t('S8 composite FK: an Org A task can never point at an Org B contact', false);
  exception when foreign_key_violation then perform pg_temp.t('S8 composite FK: an Org A task can never point at an Org B contact', true);
  end;
  begin
    insert into public.plus_tasks (organization_id, title, opportunity_id, created_by) values (c_a, 'Cross', op_b, c_a1);
    perform pg_temp.t('S9 composite FK: an Org A task can never point at an Org B opportunity', false);
  exception when foreign_key_violation then perform pg_temp.t('S9 composite FK: an Org A task can never point at an Org B opportunity', true);
  end;
  begin
    insert into public.plus_tasks (organization_id, title, contact_id, status, created_by) values (c_a, 'Bad done', ct1, 'done', c_a1);
    perform pg_temp.t('S10 done without completed_at / completed_by refused (completion consistency)', false);
  exception when check_violation then perform pg_temp.t('S10 done without completed_at / completed_by refused (completion consistency)', true);
  end;

  -- ============================================== create
  v := pg_temp.mk(c_a1, c_a, '  Call back about rides  ', now() + interval '3 days', pg_temp.mid(c_a, c_a1), ct1, null);
  t1 := (select id from public.plus_tasks where title = 'Call back about rides');
  perform pg_temp.t('C1 Admin creates a contact task: open, trimmed, assigned, created_by = caller', v = t1::text
    and (select status = 'open' and assignee_user_id = c_a1 and created_by = c_a1 and contact_id = ct1 and opportunity_id is null from public.plus_tasks where id = t1), v);
  perform pg_temp.t('C2 creation audited without copying the title or contact data',
    (select count(*) from public.audit_events where entity_id = t1 and action = 'plus_task_created') = 1
    and (select after_data::text !~ 'Call back|Task Fictional|example' from public.audit_events where entity_id = t1 and action = 'plus_task_created'));
  v := pg_temp.mk(c_a1, c_a, 'Call back about rides', now() + interval '3 days', pg_temp.mid(c_a, c_a1), ct1, null);
  perform pg_temp.t('C3 duplicate submission within 30 s -> idempotent no-op (one row)', v = 'noop:' || t1
    and (select count(*) from public.plus_tasks where title = 'Call back about rides') = 1, v);
  v := pg_temp.mk(c_a1, c_a, 'Opportunity task', null, null, null, op1);
  t2 := v::uuid;
  perform pg_temp.t('C4 an opportunity task (unassigned, no due date) is allowed', (select opportunity_id = op1 and contact_id is null and assignee_user_id is null and due_at is null from public.plus_tasks where id = t2));
  v := pg_temp.mk(c_a1, c_a, 'Both', null, null, ct1, op1) || '|' || pg_temp.mk(c_a1, c_a, 'Neither', null, null, null, null)
    || '|' || pg_temp.mk(c_a1, c_a, 'Archived', null, null, ct_arch, null) || '|' || pg_temp.mk(c_a1, c_a, 'Lost opp', null, null, null, op_lost)
    || '|' || pg_temp.mk(c_a1, c_a, 'Foreign contact', null, null, ct_b, null) || '|' || pg_temp.mk(c_a1, c_a, 'Foreign opp', null, null, null, op_b)
    || '|' || pg_temp.mk(c_a1, c_a, 'Unknown', null, null, gen_random_uuid(), null);
  perform pg_temp.t('C5 subject rules: both / neither / archived contact / lost opportunity -> ZW006; foreign / unknown -> ZW002',
    v = 'ERR:ZW006|ERR:ZW006|ERR:ZW006|ERR:ZW006|ERR:ZW002|ERR:ZW002|ERR:ZW002', v);
  v := pg_temp.mk(c_a1, c_a, '   ', null, null, ct1, null) || pg_temp.mk(c_a1, c_a, repeat('t', 201), null, null, ct1, null);
  perform pg_temp.t('C6 title empty / 201 chars -> ZW006', v = 'ERR:ZW006ERR:ZW006', v);

  -- ============================================== assignee eligibility
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.mk(c_a1, c_a, 'For write-grant dispatcher', null, pg_temp.mid(c_a, c_a2), ct1, null);
  perform pg_temp.t('A1 assignee = Dispatcher with a WRITE grant -> ok', v ~ '^[0-9a-f-]{36}$', v);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v := pg_temp.mk(c_a1, c_a, 'For read grant', null, pg_temp.mid(c_a, c_a2), ct1, null);
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  v := v || '|' || pg_temp.mk(c_a1, c_a, 'For revoked', null, pg_temp.mid(c_a, c_a2), ct1, null)
    || '|' || pg_temp.mk(c_a1, c_a, 'For inactive', null, pg_temp.mid(c_a, c_a5), ct1, null)
    || '|' || pg_temp.mk(c_a1, c_a, 'For driver', null, pg_temp.mid(c_a, c_a3), ct1, null)
    || '|' || pg_temp.mk(c_a1, c_a, 'For foreign', null, pg_temp.mid(c_b, c_b1), ct1, null);
  perform pg_temp.t('A2 read grant / revoked / inactive / driver / foreign assignee -> ZW006', v = 'ERR:ZW006|ERR:ZW006|ERR:ZW006|ERR:ZW006|ERR:ZW006', v);
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  update public.memberships set status = 'inactive' where id = pg_temp.mid(c_a, c_a2);
  v := pg_temp.mk(c_a1, c_a, 'For deactivated writer', null, pg_temp.mid(c_a, c_a2), ct1, null);
  update public.memberships set status = 'active' where id = pg_temp.mid(c_a, c_a2);
  perform pg_temp.t('A3 a write-grant Dispatcher who is deactivated cannot be assigned -> ZW006', v = 'ERR:ZW006', v);

  -- ============================================== due views (organization timezone)
  t_over := pg_temp.mk(c_a1, c_a, 'Overdue one', now() - interval '1 hour', pg_temp.mid(c_a, c_a1), ct1, null)::uuid;
  t_today := pg_temp.mk(c_a1, c_a, 'Due today one', now() + (v_end - now()) / 2, null, ct1, null)::uuid;
  t_up := pg_temp.mk(c_a1, c_a, 'Upcoming one', v_end + interval '2 days', null, ct1, null)::uuid;
  t_none := pg_temp.mk(c_a1, c_a, 'No date one', null, null, ct1, null)::uuid;
  perform pg_temp.t('D1 overdue = open and due before now (organization timezone independent)',
    pg_temp.val_as('authenticated', c_a1, format('select string_agg(title, '','' order by title) from public.plus_list_tasks(%L, ''overdue'', null, null, null, null, 200, 0)', c_a)) = 'Overdue one');
  perform pg_temp.t('D2 due today = from now to the end of the organization''s local today',
    pg_temp.val_as('authenticated', c_a1, format('select string_agg(title, '','' order by title) from public.plus_list_tasks(%L, ''today'', null, null, null, null, 200, 0)', c_a)) = 'Due today one');
  perform pg_temp.t('D3 upcoming = after today (incl. the 3-day task)',
    pg_temp.val_as('authenticated', c_a1, format('select string_agg(title, '','' order by title) from public.plus_list_tasks(%L, ''upcoming'', null, null, null, null, 200, 0)', c_a)) = 'Call back about rides,Upcoming one');
  perform pg_temp.t('D4 no date = open without due_at',
    pg_temp.lst(c_a1, c_a, 'no_date')::int = (select count(*) from public.plus_tasks where organization_id = c_a and status = 'open' and due_at is null));
  perform pg_temp.t('D5 is_overdue / is_due_today flags agree with the views',
    pg_temp.val_as('authenticated', c_a1, format('select string_agg(title || '':'' || is_overdue || ''/'' || is_due_today, '','' order by title) from public.plus_list_tasks(%L, ''open'', null, null, null, null, 200, 0) where title in (''Overdue one'', ''Due today one'', ''Upcoming one'')', c_a))
      = 'Due today one:false/true,Overdue one:true/false,Upcoming one:false/false');
  perform pg_temp.t('D6 day bounds: the organization''s today is 1 day long and contains now',
    v_end - v_start between interval '23 hours' and interval '25 hours' and now() >= v_start and now() < v_end);
  perform pg_temp.t('D7 mine = open tasks assigned to the caller', pg_temp.lst(c_a1, c_a, 'mine')::int = (select count(*) from public.plus_tasks where organization_id = c_a and status = 'open' and assignee_user_id = c_a1));
  perform pg_temp.t('D8 filters: assignee handle, contact (incl. its opportunity''s tasks), opportunity, search; foreign handle matches nothing',
    pg_temp.lst(c_a1, c_a, 'open', null, pg_temp.mid(c_a, c_a1))::int >= 2
    and pg_temp.lst(c_a1, c_a, 'open', null, null, null, op1) = '1'
    and pg_temp.lst(c_a1, c_a, 'open', null, null, ct1)::int = (select count(*) from public.plus_tasks where organization_id = c_a and status = 'open')
    and pg_temp.lst(c_a1, c_a, 'open', 'overdue one') = '1' and pg_temp.lst(c_a1, c_a, 'open', 'task opportunity') = '1'
    and pg_temp.lst(c_a1, c_a, 'open', null, pg_temp.mid(c_b, c_b1)) = '0' and pg_temp.lst(c_a1, c_a, 'open', '%') = '0');
  perform pg_temp.t('D9 bad view -> ZW006', pg_temp.lst(c_a1, c_a, 'later') = 'ERR:ZW006');

  -- ============================================== update / reassign
  perform pg_temp.t('U1 stale update -> ZW003', pg_temp.upd(c_a1, c_a, t1, pg_temp.ver(t1) - interval '1 second', 'X', null, null) = 'ERR:ZW003');
  v := pg_temp.upd(c_a1, c_a, t1, pg_temp.ver(t1), 'Call back about rides', (select due_at from public.plus_tasks where id = t1), pg_temp.mid(c_a, c_a1));
  perform pg_temp.t('U2 identical values -> changed=false, no audit', v = 'changed=false' and (select count(*) from public.audit_events where entity_id = t1 and action = 'plus_task_updated') = 0, v);
  v := pg_temp.upd(c_a1, c_a, t1, pg_temp.ver(t1), 'Call back about weekly rides', now() + interval '4 days', pg_temp.mid(c_a, c_a2));
  perform pg_temp.t('U3 real edit applied; audit lists field NAMES only', v = 'changed=true'
    and (select title = 'Call back about weekly rides' and assignee_user_id = c_a2 from public.plus_tasks where id = t1)
    and (select after_data -> 'fields' from public.audit_events where entity_id = t1 and action = 'plus_task_updated') = '["title", "due_at", "assignee"]'::jsonb, v);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v := pg_temp.upd(c_a1, c_a, t1, pg_temp.ver(t1), 'Call back about weekly rides (kept)', now() + interval '4 days', pg_temp.mid(c_a, c_a2));
  v2 := pg_temp.reassign(c_a1, c_a, t2, pg_temp.ver(t2), pg_temp.mid(c_a, c_a2));
  perform pg_temp.t('U4 an unchanged assignee who lost write access is kept on edit; but cannot be NEWLY assigned (ZW006)', v = 'changed=true' and v2 = 'ERR:ZW006'
    and (select assignee_user_id = c_a2 from public.plus_tasks where id = t1), v || ' ' || v2);
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.reassign(c_a1, c_a, t2, pg_temp.ver(t2), pg_temp.mid(c_a, c_a1));
  v2 := pg_temp.reassign(c_a1, c_a, t2, pg_temp.ver(t2) - interval '1 hour', pg_temp.mid(c_a, c_a1));
  perform pg_temp.t('U5 reassign to an eligible writer; the same assignee again -> changed=false', v = 'changed=true' and v2 = 'changed=false'
    and (select assignee_user_id = c_a1 from public.plus_tasks where id = t2), v || ' ' || v2);

  -- ============================================== complete / cancel
  perform pg_temp.t('X1 complete with a stale version -> ZW003', pg_temp.done(c_a1, c_a, t_over, pg_temp.ver(t_over) - interval '1 second') = 'ERR:ZW003');
  v := pg_temp.done(c_a1, c_a, t_over, pg_temp.ver(t_over));
  perform pg_temp.t('X2 complete: done, completed_at and completed_by stamped, audited once', v = 'done:true'
    and (select completed_at is not null and completed_by = c_a1 from public.plus_tasks where id = t_over)
    and (select count(*) from public.audit_events where entity_id = t_over and action = 'plus_task_completed') = 1, v);
  v2 := (select completed_at::text from public.plus_tasks where id = t_over);
  v := pg_temp.done(c_a1, c_a, t_over, pg_temp.ver(t_over) - interval '1 hour');
  perform pg_temp.t('X3 repeated completion is safe: changed=false, completed_at unchanged, no second audit', v = 'done:false'
    and (select completed_at::text from public.plus_tasks where id = t_over) = v2
    and (select count(*) from public.audit_events where entity_id = t_over and action = 'plus_task_completed') = 1, v);
  v := pg_temp.cancel(c_a1, c_a, t_over, pg_temp.ver(t_over)) || '|' || pg_temp.upd(c_a1, c_a, t_over, pg_temp.ver(t_over), 'X', null, null)
    || '|' || pg_temp.reassign(c_a1, c_a, t_over, pg_temp.ver(t_over), null);
  perform pg_temp.t('X4 a done task cannot be cancelled, edited or reassigned -> ZW004', v = 'ERR:ZW004|ERR:ZW004|ERR:ZW004', v);
  v := pg_temp.cancel(c_a1, c_a, t_none, pg_temp.ver(t_none));
  v2 := pg_temp.cancel(c_a1, c_a, t_none, pg_temp.ver(t_none) - interval '1 hour');
  perform pg_temp.t('X5 cancel: kept as history; repeat -> changed=false; completing a cancelled task -> ZW004',
    v = 'cancelled:true' and v2 = 'cancelled:false' and pg_temp.done(c_a1, c_a, t_none, pg_temp.ver(t_none)) = 'ERR:ZW004'
    and (select completed_at is null and completed_by is null from public.plus_tasks where id = t_none)
    and (select count(*) from public.audit_events where entity_id = t_none and action = 'plus_task_cancelled') = 1, v || ' ' || v2);
  perform pg_temp.t('X6 history views: done / cancelled / history; nothing deleted',
    pg_temp.lst(c_a1, c_a, 'done') = '1' and pg_temp.lst(c_a1, c_a, 'cancelled') = '1' and pg_temp.lst(c_a1, c_a, 'history') = '2'
    and exists (select 1 from public.plus_tasks where id = t_over) and exists (select 1 from public.plus_tasks where id = t_none));
  perform pg_temp.t('X7 tasks never write plus_activities (no fake customer communication)', (select count(*) from public.plus_activities) = v_acts);

  -- ============================================== permissions
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  t3 := pg_temp.mk(c_a2, c_a, 'Dispatcher-created', null, pg_temp.mid(c_a, c_a2), ct1, null)::uuid;
  v := pg_temp.done(c_a2, c_a, t3, pg_temp.ver(t3));
  perform pg_temp.t('P1 WRITE-grant Dispatcher creates and completes', t3 is not null and v = 'done:true', v);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v := pg_temp.lst(c_a2, c_a, 'open') || '|' || pg_temp.get(c_a2, c_a, t1) || '|' || pg_temp.rls(c_a2, c_a);
  perform pg_temp.t('P2 READ-grant Dispatcher: list / detail / RLS read', v ~ '^[1-9][0-9]*\|Call back about weekly rides \(kept\)\|[1-9][0-9]*$', v);
  v := pg_temp.mk(c_a2, c_a, 'Read try', null, null, ct1, null) || pg_temp.upd(c_a2, c_a, t1, pg_temp.ver(t1), 'X', null, null)
    || pg_temp.reassign(c_a2, c_a, t1, pg_temp.ver(t1), null) || pg_temp.done(c_a2, c_a, t1, pg_temp.ver(t1)) || pg_temp.cancel(c_a2, c_a, t1, pg_temp.ver(t1));
  perform pg_temp.t('P3 READ-grant Dispatcher: every task mutation -> ZW001', v = repeat('ERR:ZW001', 5), v);
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  perform pg_temp.t('P4 no grant / revoked: ZW002, RLS 0', pg_temp.lst(c_a2, c_a, 'open') = 'ERR:ZW002' and pg_temp.rls(c_a2, c_a) = '0'
    and pg_temp.mk(c_a2, c_a, 'No grant', null, null, ct1, null) = 'ERR:ZW002');
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  update public.memberships set status = 'inactive' where id = pg_temp.mid(c_a, c_a2);
  perform pg_temp.t('P5 inactive Dispatcher: ZW002, RLS 0', pg_temp.lst(c_a2, c_a, 'open') = 'ERR:ZW002' and pg_temp.rls(c_a2, c_a) = '0');
  update public.memberships set status = 'active' where id = pg_temp.mid(c_a, c_a2);
  v := pg_temp.lst(c_a3, c_a, 'open') || pg_temp.rls(c_a3, c_a) || pg_temp.lst(c_e1, c_a, 'open') || pg_temp.lst(c_d1, c_a, 'open') || pg_temp.rls(c_d1, c_a)
    || pg_temp.mk(c_d1, c_a, 'PA', null, null, ct1, null);
  perform pg_temp.t('P6 Driver, no-membership user, Platform Admin without membership: no access', v = 'ERR:ZW0020ERR:ZW002ERR:ZW0020ERR:ZW002', v);
  perform pg_temp.t('P7 no uid -> ZW001; anon -> 42501', pg_temp.lst(null, c_a, 'open') = 'ERR:ZW001'
    and pg_temp.val_as('anon', null, format('select count(*)::text from public.plus_list_tasks(%L, null, null, null, null, null, 10, 0)', c_a)) = 'ERR:42501');
  update public.organizations set status = 'inactive' where id = c_a;
  perform pg_temp.t('P8 suspended organization: ZW002, RLS 0', pg_temp.lst(c_a1, c_a, 'open') = 'ERR:ZW002' and pg_temp.rls(c_a1, c_a) = '0');
  update public.organizations set status = 'active' where id = c_a;
  perform pg_temp.set_state(c_a, 'expired');
  v := pg_temp.lst(c_a1, c_a, 'open') || '|' || pg_temp.get(c_a1, c_a, t1);
  v2 := pg_temp.mk(c_a1, c_a, 'Expired', null, null, ct1, null) || pg_temp.upd(c_a1, c_a, t1, pg_temp.ver(t1), 'X', null, null)
     || pg_temp.done(c_a1, c_a, t1, pg_temp.ver(t1)) || pg_temp.cancel(c_a1, c_a, t1, pg_temp.ver(t1)) || pg_temp.reassign(c_a1, c_a, t1, pg_temp.ver(t1), null);
  perform pg_temp.t('P9 expired Plus: Admin keeps read; every task mutation -> ZW001', v ~ '^[1-9][0-9]*\|Call back' and v2 = repeat('ERR:ZW001', 5), v || ' / ' || v2);
  perform pg_temp.t('P10 expired Plus: write-grant Dispatcher -> ZW002', pg_temp.lst(c_a2, c_a, 'open') = 'ERR:ZW002');
  perform pg_temp.set_state(c_a, 'locked');
  perform pg_temp.t('P11 locked: ZW002, RLS 0, rows retained', pg_temp.lst(c_a1, c_a, 'open') = 'ERR:ZW002' and pg_temp.rls(c_a1, c_a) = '0'
    and (select count(*) from public.plus_tasks where organization_id = c_a) > 0);
  perform pg_temp.set_state(c_a, 'none');
  perform pg_temp.t('P12 no entitlement: ZW002', pg_temp.lst(c_a1, c_a, 'open') = 'ERR:ZW002');
  perform pg_temp.set_state(c_a, 'active');

  -- ============================================== cross-tenant
  v := pg_temp.lst(c_b1, c_a, 'open') || pg_temp.get(c_b1, c_a, t1) || pg_temp.mk(c_b1, c_a, 'B into A', null, null, ct1, null)
    || pg_temp.upd(c_b1, c_a, t1, pg_temp.ver(t1), 'X', null, null) || pg_temp.done(c_b1, c_a, t1, pg_temp.ver(t1));
  perform pg_temp.t('T1 Org B Admin with Org A''s id -> ZW002 for every RPC', v = repeat('ERR:ZW002', 5), v);
  v := pg_temp.get(c_b1, c_b, t1) || pg_temp.get(c_b1, c_b, gen_random_uuid()) || pg_temp.upd(c_b1, c_b, t1, pg_temp.ver(t1), 'Forged', null, null)
    || pg_temp.done(c_b1, c_b, t1, pg_temp.ver(t1)) || pg_temp.cancel(c_b1, c_b, t1, pg_temp.ver(t1)) || pg_temp.reassign(c_b1, c_b, t1, pg_temp.ver(t1), null)
    || pg_temp.mk(c_b1, c_b, 'Forged subject', null, null, ct1, null);
  perform pg_temp.t('T2 forged ids under Org B''s own id -> ZW002, identical to unknown; nothing changed', v = repeat('ERR:ZW002', 7)
    and pg_temp.st(t1) = 'open', v);
  perform pg_temp.t('T3 RLS: each Admin sees only their own organization''s tasks', pg_temp.rls(c_b1, c_a) = '0' and pg_temp.rls(c_a1, c_b) = '0');
  perform pg_temp.t('T4 multi-organization c1 (Admin in A, Driver in B): A yes, B never', pg_temp.lst(c_c1, c_a, 'open')::int > 0 and pg_temp.lst(c_c1, c_b, 'open') = 'ERR:ZW002');

  -- ============================================== Core isolation
  v_core2 := (select count(*) from public.transportation_requests)::text || '/' || (select count(*) from public.passengers)::text
             || '/' || (select count(*) from public.trips)::text || '/' || (select count(*) from public.trip_assignments)::text;
  perform pg_temp.t('K1 no Core Request / Passenger / Trip / assignment written', v_core = v_core2, v_core || ' -> ' || v_core2);
  perform pg_temp.t('K2 no Core function or Core policy references plus_tasks; no Plus function writes Core tables',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname !~ '^(plus_|_plus_|_require_plus_)' and p.prosrc ~ 'plus_tasks')
    and not exists (select 1 from pg_policy where polrelid::regclass::text !~ '^(public\.)?plus_' and coalesce(pg_get_expr(polqual, polrelid), '') ~ 'plus_')
    and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ~ '^(plus_|_plus_)'
      and p.prosrc ~* '(insert\s+into|update)\s+(public\.)?(transportation_requests|passengers|trips|recurring_arrangements|trip_assignments)'));
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from t_results;
select name, detail from t_results where not ok order by n;

rollback;
