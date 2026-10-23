-- Nemryn Plus -- Estimates & Quotes LIFECYCLE timeline + do-not-contact acknowledgment (NP-P2-S5-S3B). ROLLBACK-ONLY.
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_quotes_lifecycle_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261021100000_plus_quote_lifecycle_activity.sql: OD-Q15 = A (ZD-222) quote events on the Opportunity / Contact /
-- dashboard timelines (sent, accepted, declined, revised, superseded, sent-withdrawn), their tenant-scoped linkage and
-- data minimisation, idempotency and refusal behaviour; OD-Q16 = A (ZD-223) the server-enforced do-not-contact
-- acknowledgment for Mark sent (incl. old-call bypass attempts and preference changes mid-flow); authorization; side
-- effects. FICTIONAL seed fixtures only; quotes are driven through the REAL RPCs as the signed-in staff member.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table t_results (n serial, name text, ok boolean, detail text);
create function pg_temp.t(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;
-- run one statement as p_uid (default role authenticated) -> 'ok:<first column>' or '<sqlstate>:<message>'
create function pg_temp.x(p_uid uuid, p_sql text, p_role text default 'authenticated')
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return 'ok:' || coalesce(v, '<null>');
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
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, 'P2-S5-S1 quote test'
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
  insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by)
  values (p_org, p_name, '(404) 555-0130', lower(replace(p_name, ' ', '.')) || '@example.test', 'individual', p_creator) returning id;
$$;
create function pg_temp.opp(p_org uuid, p_contact uuid, p_title text, p_creator uuid, p_stage text default 'qualified')
returns uuid language sql as $$
  insert into public.plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by)
  values (p_org, p_title, p_stage, p_contact, 'phone', 'dialysis', p_creator) returning id;
$$;
-- create a quote as p_uid -> 'ok:<quote_id>,<changed>,<number>,<total>' or error
create function pg_temp.cq(p_uid uuid, p_org uuid, p_opp uuid, p_key text,
                           p_base bigint default 10000, p_mileage bigint default 2550, p_wait bigint default 0, p_stops bigint default 0,
                           p_mobility bigint default 0, p_escort bigint default 0, p_return bigint default 0, p_other bigint default 0,
                           p_other_label text default null, p_discount bigint default 0, p_valid date default (current_date + 14),
                           p_kind text default 'quote', p_service text default 'dialysis', p_distance numeric default 12.5,
                           p_terms text default 'Fictional terms: valid for the dates shown.')
returns text language sql as $$
  select pg_temp.x(p_uid, format(
    'select (r).quote_id || '','' || (r).changed || '','' || (r).quote_number || '','' || (r).total_cents from (select public.plus_create_quote(%L, %L, %L, %L, %L, false, %L, %s, %s, %s, %s, %s, %s, %s, %s, %L, %s, %L, %L) r) x',
    p_org, p_opp, p_key, p_kind, p_service, p_distance, p_base, p_mileage, p_wait, p_stops, p_mobility, p_escort, p_return, p_other,
    p_other_label, p_discount, p_terms, p_valid));
$$;
create function pg_temp.qid(p text) returns uuid language sql as $$ select case when p like 'ok:%' then split_part(substr(p, 4), ',', 1)::uuid end; $$;
create function pg_temp.ver(p_q uuid) returns timestamptz language sql as $$ select updated_at from public.plus_quotes where id = p_q; $$;
create function pg_temp.st(p_q uuid) returns text language sql as $$ select status from public.plus_quotes where id = p_q; $$;
create function pg_temp.stage(p_o uuid) returns text language sql as $$ select stage from public.plus_opportunities where id = p_o; $$;
create function pg_temp.send(p_uid uuid, p_org uuid, p_q uuid, p_ver timestamptz default null) returns text language sql as $$
  select pg_temp.x(p_uid, format('select (r).status || '','' || (r).changed || '','' || (r).opportunity_stage from (select public.plus_mark_quote_sent(%L, %L, %L) r) x',
    p_org, p_q, coalesce(p_ver, pg_temp.ver(p_q))));
$$;
create function pg_temp.respond(p_uid uuid, p_org uuid, p_q uuid, p_resp text, p_ver timestamptz default null) returns text language sql as $$
  select pg_temp.x(p_uid, format('select (r).status || '','' || (r).changed || '','' || (r).opportunity_stage from (select public.plus_record_quote_response(%L, %L, %L, %L) r) x',
    p_org, p_q, coalesce(p_ver, pg_temp.ver(p_q)), p_resp));
$$;
create function pg_temp.revise(p_uid uuid, p_org uuid, p_q uuid, p_key text) returns text language sql as $$
  select pg_temp.x(p_uid, format('select (r).quote_id || '','' || (r).changed || '','' || (r).quote_number from (select public.plus_revise_quote(%L, %L, %L) r) x', p_org, p_q, p_key));
$$;
create function pg_temp.withdraw(p_uid uuid, p_org uuid, p_q uuid, p_reason text, p_ver timestamptz default null) returns text language sql as $$
  select pg_temp.x(p_uid, format('select (r).status || '','' || (r).changed from (select public.plus_withdraw_quote(%L, %L, %L, %L) r) x',
    p_org, p_q, coalesce(p_ver, pg_temp.ver(p_q)), p_reason));
$$;
create function pg_temp.upd(p_uid uuid, p_org uuid, p_q uuid, p_base bigint, p_discount bigint default 0, p_ver timestamptz default null,
                            p_valid date default (current_date + 14)) returns text language sql as $$
  select pg_temp.x(p_uid, format(
    'select (r).changed || '','' || (r).total_cents from (select public.plus_update_quote_draft(%L, %L, %L, ''quote'', ''dialysis'', false, 12.5, %s, 2550, 0, 0, 0, 0, 0, 0, null, %s, ''Fictional terms: valid for the dates shown.'', %L) r) x',
    p_org, p_q, coalesce(p_ver, pg_temp.ver(p_q)), p_base, p_discount, p_valid));
$$;
create function pg_temp.sendack(p_uid uuid, p_org uuid, p_q uuid, p_ack boolean, p_ver timestamptz default null) returns text language sql as $$
  select pg_temp.x(p_uid, format('select (r).status || '','' || (r).changed || '','' || (r).opportunity_stage from (select public.plus_mark_quote_sent(%L, %L, %L, %L) r) x',
    p_org, p_q, coalesce(p_ver, pg_temp.ver(p_q)), p_ack));
$$;
-- activity rows of a quote as 'type:status', sorted (inside one transaction recorded_at is constant, so insertion order
-- is not observable; the alphabetical order happens to equal the lifecycle order for every case asserted here)
create function pg_temp.acts(p_q uuid) returns text language sql as $$
  select coalesce(string_agg(activity_type || ':' || quote_status, ',' order by activity_type, quote_status), '') from public.plus_activities where quote_id = p_q;
$$;
create function pg_temp.nacts() returns bigint language sql as $$ select count(*) from public.plus_activities $$;
create function pg_temp.naudit() returns bigint language sql as $$ select count(*) from public.audit_events where entity_type = 'plus_quote' $$;
create function pg_temp.side() returns text language sql as $$
  select (select count(*) from public.transportation_requests) || '/' || (select count(*) from public.trips) || '/' || (select count(*) from public.passengers)
    || '/' || (select count(*) from public.trip_assignments) || '/' || (select count(*) from public.notification_events) || '/' || (select count(*) from public.plus_tasks)
    -- NP-P2-S6-A: D5 "creates no consent record" is now literally checked against the consent ledger
    || '/' || (select count(*) from public.plus_communication_consents);
$$;
create temp table t_ctx (name text primary key, val text);
insert into t_ctx values ('side0', pg_temp.side());

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  c_a3 constant uuid := '20000000-0000-0000-0000-0000000000a3';
  c_a5 constant uuid := '20000000-0000-0000-0000-0000000000a5';
  c_b1 constant uuid := '20000000-0000-0000-0000-0000000000b1';
  c_d1 constant uuid := '20000000-0000-0000-0000-0000000000d1';
  c_e1 constant uuid := '20000000-0000-0000-0000-0000000000e1';
  k uuid; kd uuid; kb uuid; k2 uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; od uuid; od2 uuid; od3 uuid; ob uuid; o6 uuid;
  q uuid; q2 uuid; q3 uuid; r uuid; qd uuid; qd2 uuid; qd3 uuid; qb uuid; q6 uuid;
  v text; v2 text; n0 bigint; a0 bigint; v_today date; v_ok boolean; v_fn record;
begin
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_state(c_b, 'active');
  v_today := public._plus_org_local_today(c_a);
  k := pg_temp.contact(c_a, 'Lifecycle Pat Fictional', c_a1);
  k2 := pg_temp.contact(c_a, 'Lifecycle Other Fictional', c_a1);
  kd := pg_temp.contact(c_a, 'Lifecycle DNC Fictional', c_a1);
  update public.plus_contacts set do_not_contact = true where id = kd;
  kb := pg_temp.contact(c_b, 'Lifecycle B Fictional', c_b1);
  o1 := pg_temp.opp(c_a, k, 'LC sent + accepted', c_a1);
  o2 := pg_temp.opp(c_a, k, 'LC declined', c_a1, 'contacted');
  o3 := pg_temp.opp(c_a, k, 'LC revision', c_a1);
  o4 := pg_temp.opp(c_a, k, 'LC withdraw sent', c_a1);
  o5 := pg_temp.opp(c_a, k, 'LC refusals', c_a1);
  o6 := pg_temp.opp(c_a, k2, 'LC forged links', c_a1);
  od := pg_temp.opp(c_a, kd, 'LC dnc', c_a1);
  od2 := pg_temp.opp(c_a, kd, 'LC dnc 2', c_a1);
  od3 := pg_temp.opp(c_a, k2, 'LC dnc race', c_a1);
  ob := pg_temp.opp(c_b, kb, 'LC org B', c_b1);

  -- ===================================================================== S. Contract
  perform pg_temp.t('S1 exactly ONE plus_mark_quote_sent: (uuid, uuid, timestamptz, boolean DEFAULT false); SECURITY DEFINER; search_path pinned; authenticated EXECUTE only',
    (select count(*) from pg_proc where proname = 'plus_mark_quote_sent') = 1
    and (select pg_get_function_arguments(oid) from pg_proc where proname = 'plus_mark_quote_sent') like '%p_dnc_acknowledged boolean DEFAULT false'
    and (select prosecdef and proconfig = array['search_path=public, pg_temp'] and has_function_privilege('authenticated', oid, 'EXECUTE')
         and not has_function_privilege('anon', oid, 'EXECUTE') and not has_function_privilege('service_role', oid, 'EXECUTE') from pg_proc where proname = 'plus_mark_quote_sent'));
  v_ok := true; v := '';
  for v_fn in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('_plus_activities_quote_guard', '_plus_quote_activity', '_plus_quote_related_number',
                    'plus_list_contact_activities', 'plus_list_opportunity_activities', 'plus_list_recent_activities') loop
    if (has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') <> (v_fn.proname like 'plus\_%'))
       or has_function_privilege('anon', v_fn.oid, 'EXECUTE') or has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
       or not (select prosecdef and proconfig = array['search_path=public, pg_temp'] from pg_proc where oid = v_fn.oid) then
      v_ok := false; v := v || v_fn.proname || ' ';
    end if;
  end loop;
  perform pg_temp.t('S2 the 3 internals have no client EXECUTE; the 3 re-created timeline reads stay authenticated-only; all SECURITY DEFINER with pinned search_path', v_ok, v);
  perform pg_temp.t('S3 plus_activities: quote_id + quote_status columns, the composite FK (quote_id, organization_id, opportunity_id), the subject CHECK and the guard trigger; all constraints validated against existing rows',
    exists (select 1 from pg_constraint where conname = 'plus_activities_quote_fkey' and pg_get_constraintdef(oid) ~ 'FOREIGN KEY \(quote_id, organization_id, opportunity_id\) REFERENCES plus_quotes\(id, organization_id, opportunity_id\)')
    and (select bool_and(convalidated) from pg_constraint where conrelid = 'public.plus_activities'::regclass)
    and exists (select 1 from pg_trigger where tgname = 'plus_activities_quote_guard' and not tgisinternal)
    and not has_table_privilege('authenticated', 'public.plus_activities', 'INSERT') and not has_table_privilege('authenticated', 'public.plus_activities', 'UPDATE'));

  -- ===================================================================== T. Timeline events (OD-Q15)
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, o1, 'lc-key-0001'));
  n0 := pg_temp.nacts();
  perform pg_temp.t('T0 creating / editing a DRAFT writes no timeline event (work in progress)', pg_temp.acts(q) = '' and (pg_temp.upd(c_a1, c_a, q, 9000) like 'ok:%') and pg_temp.acts(q) = '');
  v := pg_temp.send(c_a1, c_a, q);   -- the existing 3-argument call (ack defaults to false; contact not do-not-contact)
  perform pg_temp.t('T1 Mark sent (non-DNC contact, no acknowledgment needed) writes ONE quote_sent event: this quote + opportunity + the opportunity''s contact, actor, no body',
    v = 'ok:sent,true,quote_sent' and pg_temp.acts(q) = 'quote_sent:sent'
    and exists (select 1 from public.plus_activities where quote_id = q and opportunity_id = o1 and contact_id = k and organization_id = c_a and actor_user_id = c_a1 and body is null), v);
  perform pg_temp.t('T2 the event is on the OPPORTUNITY timeline with its quote reference (number, kind, status), next to the stage change',
    pg_temp.x(c_a1, format('select string_agg(activity_type || ''|'' || coalesce(quote_number::text, ''-'') || ''|'' || coalesce(quote_kind, ''-'') || ''|'' || coalesce(quote_status, ''-''), '','' order by activity_type) from public.plus_list_opportunity_activities(%L, %L, 50, 0)', c_a, o1))
      = 'ok:quote_sent|' || (select quote_number from public.plus_quotes where id = q) || '|quote|sent,stage_changed|-|-|-');
  perform pg_temp.t('T3 the same event resolves on the CONTACT timeline (and the dashboard feed) with the opportunity id',
    pg_temp.x(c_a1, format('select string_agg(activity_type || ''|'' || opportunity_id || ''|'' || quote_number, '','') from public.plus_list_contact_activities(%L, %L, 50, 0) where quote_id = %L', c_a, k, q))
      = 'ok:quote_sent|' || o1 || '|' || (select quote_number from public.plus_quotes where id = q)
    and pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_recent_activities(%L, 50) where quote_id = %L and quote_status = ''sent''', c_a, q)) = 'ok:1');
  v := pg_temp.respond(c_a1, c_a, q, 'accepted');
  perform pg_temp.t('T4 Record accepted writes ONE quote_status_changed:accepted event (staff-recorded); the stage advances as before',
    v = 'ok:accepted,true,quote_accepted' and pg_temp.acts(q) = 'quote_sent:sent,quote_status_changed:accepted', v);
  q2 := pg_temp.qid(pg_temp.cq(c_a1, c_a, o2, 'lc-key-0002')); perform pg_temp.send(c_a1, c_a, q2);
  v := pg_temp.respond(c_a1, c_a, q2, 'declined');
  perform pg_temp.t('T5 Record declined writes ONE quote_status_changed:declined event; the opportunity is NOT marked lost',
    v = 'ok:declined,true,quote_sent' and pg_temp.acts(q2) = 'quote_sent:sent,quote_status_changed:declined' and pg_temp.stage(o2) = 'quote_sent', v);
  q3 := pg_temp.qid(pg_temp.cq(c_a1, c_a, o3, 'lc-key-0003', p_base => 20000)); perform pg_temp.send(c_a1, c_a, q3);
  r := pg_temp.qid(pg_temp.revise(c_a1, c_a, q3, 'lc-key-0003r'));
  perform pg_temp.t('T6 Revise writes ONE quote_revised:draft event on the NEW revision; the timeline names the revised quote (related number); the original is unchanged',
    pg_temp.acts(r) = 'quote_revised:draft' and pg_temp.st(q3) = 'sent'
    and pg_temp.x(c_a1, format('select related_quote_number::text from public.plus_list_opportunity_activities(%L, %L, 50, 0) where quote_id = %L', c_a, o3, r)) = 'ok:' || (select quote_number from public.plus_quotes where id = q3));
  perform pg_temp.upd(c_a1, c_a, r, 18000);
  v := pg_temp.send(c_a1, c_a, r);
  perform pg_temp.t('T7 sending the revision writes quote_status_changed:superseded on the ORIGINAL (related = the revision) and quote_sent on the revision; the original snapshot is unchanged',
    v like 'ok:sent,true,%' and pg_temp.acts(q3) = 'quote_sent:sent,quote_status_changed:superseded' and pg_temp.acts(r) = 'quote_revised:draft,quote_sent:sent'
    and (select total_cents from public.plus_quotes where id = q3) = 22550
    and pg_temp.x(c_a1, format('select related_quote_number::text from public.plus_list_opportunity_activities(%L, %L, 50, 0) where quote_id = %L and quote_status = ''superseded''', c_a, o3, q3)) = 'ok:' || (select quote_number from public.plus_quotes where id = r), v);
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, o4, 'lc-key-0004')); perform pg_temp.send(c_a1, c_a, q);
  v := pg_temp.withdraw(c_a1, c_a, q, 'Fictional: customer chose a different date (sensitive detail)');
  perform pg_temp.t('T8 withdrawing a SENT quote writes ONE quote_status_changed:withdrawn event; the reason stays on the quote / audit and is NOT copied to any activity',
    v = 'ok:withdrawn,true' and pg_temp.acts(q) = 'quote_sent:sent,quote_status_changed:withdrawn'
    and not exists (select 1 from public.plus_activities a where a.quote_id = q and (coalesce(a.body, '') ~ 'Fictional' or a::text ~ 'different date'))
    and (select withdrawn_reason from public.plus_quotes where id = q) like 'Fictional:%', v);
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, o4, 'lc-key-0004d'));
  v := pg_temp.withdraw(c_a1, c_a, q, null);
  perform pg_temp.t('T9 withdrawing a DRAFT writes no timeline event (audit only)', v = 'ok:withdrawn,true' and pg_temp.acts(q) = ''
    and (select count(*) from public.audit_events where entity_id = q and action = 'plus_quote_withdrawn') = 1);
  -- idempotent repeats
  n0 := pg_temp.nacts(); a0 := pg_temp.naudit();
  v := pg_temp.send(c_a1, c_a, r) || '|' || pg_temp.respond(c_a1, c_a, (select id from public.plus_quotes where opportunity_id = o1), 'accepted')
    || '|' || pg_temp.revise(c_a1, c_a, q3, 'lc-key-0003r') || '|' || pg_temp.withdraw(c_a1, c_a, q, null);
  perform pg_temp.t('T10 idempotent repeats (sent again, same response, same revise key, withdrawn again) write NO activity and NO audit',
    pg_temp.nacts() = n0 and pg_temp.naudit() = a0 and v !~ 'true', v);
  -- refusals write nothing
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, o5, 'lc-key-0005'));
  n0 := pg_temp.nacts(); a0 := pg_temp.naudit();
  v := pg_temp.send(c_a1, c_a, q, now() - interval '1 minute');
  update public.plus_quotes set valid_until = v_today - 1 where id = q;
  v2 := pg_temp.send(c_a1, c_a, q);
  perform pg_temp.t('T11 refused transitions (stale ZW003, expired ZW004) write no activity and no audit',
    v like 'ZW003:%' and v2 = 'ZW004:quote_expired' and pg_temp.nacts() = n0 and pg_temp.naudit() = a0, v || ' / ' || v2);
  perform pg_temp.t('T12 no quote event carries a price, a body or free text; the timeline reads return no amount column',
    not exists (select 1 from public.plus_activities where quote_id is not null and body is not null)
    and not exists (select 1 from pg_proc where proname in ('plus_list_contact_activities', 'plus_list_opportunity_activities', 'plus_list_recent_activities')
                    and pg_get_function_result(oid) ~ '(cents|price|amount|terms|reason|label|total_cents)'));
  perform pg_temp.t('T13 existing non-quote activities stay valid (no quote fields) and keep appearing',
    not exists (select 1 from public.plus_activities where activity_type not in ('quote_sent', 'quote_status_changed', 'quote_revised') and (quote_id is not null or quote_status is not null))
    and pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_opportunity_activities(%L, %L, 50, 0) where activity_type = ''stage_changed''', c_a, o1)) <> 'ok:0');

  -- ===================================================================== F. Forged links (database rejects)
  qb := pg_temp.qid(pg_temp.cq(c_b1, c_b, ob, 'lc-key-b001'));
  q6 := pg_temp.qid(pg_temp.cq(c_a1, c_a, o6, 'lc-key-0006'));
  begin
    insert into public.plus_activities (organization_id, contact_id, opportunity_id, quote_id, activity_type, quote_status, actor_user_id)
    values (c_a, k, o1, qb, 'quote_sent', 'sent', c_a1);
    v := 'no error';
  exception when others then v := sqlstate;
  end;
  begin
    insert into public.plus_activities (organization_id, contact_id, opportunity_id, quote_id, activity_type, quote_status, actor_user_id)
    values (c_a, k, o1, q6, 'quote_sent', 'sent', c_a1);
    v2 := 'no error';
  exception when others then v2 := sqlstate;
  end;
  perform pg_temp.t('F1 a quote event pointing at ANOTHER organization''s quote, or at a quote of ANOTHER opportunity, is rejected by the composite FK (23503)',
    v = '23503' and v2 = '23503', v || ' / ' || v2);
  begin
    insert into public.plus_activities (organization_id, contact_id, opportunity_id, quote_id, activity_type, quote_status, actor_user_id)
    values (c_a, k, o6, q6, 'quote_sent', 'sent', c_a1);
    v := 'no error';
  exception when others then v := sqlstate || ':' || sqlerrm;
  end;
  perform pg_temp.t('F2 a quote event whose contact is not the opportunity''s primary contact -> ZW006 (guard trigger)', v = 'ZW006:invalid_input', v);
  begin
    insert into public.plus_activities (organization_id, contact_id, opportunity_id, quote_id, activity_type, quote_status, body, actor_user_id)
    values (c_a, k2, o6, q6, 'quote_sent', 'sent', 'Total $100', c_a1);
    v := 'no error';
  exception when check_violation then v := 'check_violation';
  end;
  begin
    insert into public.plus_activities (organization_id, contact_id, opportunity_id, quote_id, activity_type, quote_status, actor_user_id)
    values (c_a, k2, o6, q6, 'quote_sent', 'accepted', c_a1);
    v2 := 'no error';
  exception when check_violation then v2 := 'check_violation';
  end;
  perform pg_temp.t('F3 a quote event with a body, or with a status that does not match its type, violates the CHECK',
    v = 'check_violation' and v2 = 'check_violation', v || ' / ' || v2);
  begin
    insert into public.plus_activities (organization_id, contact_id, quote_id, activity_type, quote_status, actor_user_id)
    values (c_a, k2, q6, 'quote_sent', 'sent', c_a1);
    v := 'no error';
  exception when others then v := case when sqlstate in ('23514', 'ZW006') then 'refused' else sqlstate end;
  end;
  begin
    insert into public.plus_activities (organization_id, contact_id, opportunity_id, quote_id, activity_type, body, actor_user_id)
    values (c_a, k2, o6, q6, 'note', 'Fictional note', c_a1);
    v2 := 'no error';
  exception when check_violation then v2 := 'check_violation';
  end;
  perform pg_temp.t('F4 a quote event without an opportunity is refused (guard / CHECK); a non-quote activity carrying a quote reference violates the CHECK',
    v = 'refused' and v2 = 'check_violation', v || ' / ' || v2);
  perform pg_temp.t('F5 clients cannot insert or update activities directly (42501)',
    pg_temp.x(c_a1, format('insert into public.plus_activities (organization_id, contact_id, opportunity_id, quote_id, activity_type, quote_status, actor_user_id) values (%L, %L, %L, %L, ''quote_sent'', ''sent'', %L) returning id::text', c_a, k2, o6, q6, c_a1)) like '42501:%'
    and pg_temp.x(c_a1, 'update public.plus_activities set quote_status = ''sent'' returning id::text') like '42501:%');

  -- ===================================================================== D. Do-not-contact acknowledgment (OD-Q16)
  qd := pg_temp.qid(pg_temp.cq(c_a1, c_a, od, 'lc-key-dnc1'));
  n0 := pg_temp.nacts(); a0 := pg_temp.naudit();
  v := pg_temp.send(c_a1, c_a, qd);   -- the existing 3-argument call cannot bypass
  v2 := pg_temp.sendack(c_a1, c_a, qd, false);
  perform pg_temp.t('D1 DNC contact: Mark sent without acknowledgment (3-argument call and explicit false) -> ZW004 dnc_acknowledgment_required; still a draft; no activity, audit or stage change',
    v = 'ZW004:dnc_acknowledgment_required' and v2 = 'ZW004:dnc_acknowledgment_required' and pg_temp.st(qd) = 'draft'
    and pg_temp.nacts() = n0 and pg_temp.naudit() = a0 and pg_temp.stage(od) = 'qualified', v || ' / ' || v2);
  perform pg_temp.t('D2 a NULL acknowledgment is not an acknowledgment',
    pg_temp.x(c_a1, format('select (public.plus_mark_quote_sent(%L, %L, %L, null)).status', c_a, qd, pg_temp.ver(qd))) = 'ZW004:dnc_acknowledgment_required');
  perform pg_temp.t('D3 a PostgREST-style NAMED call without the acknowledgment cannot bypass either',
    pg_temp.x(c_a1, format('select (public.plus_mark_quote_sent(p_organization_id => %L, p_quote_id => %L, p_expected_updated_at => %L)).status', c_a, qd, pg_temp.ver(qd))) = 'ZW004:dnc_acknowledgment_required');
  v := (select updated_at::text || '|' || do_not_contact || '|' || preferred_channel from public.plus_contacts where id = kd);
  v2 := pg_temp.sendack(c_a1, c_a, qd, true);
  perform pg_temp.t('D4 with explicit acknowledgment an authorized staff member records Sent: ONE quote_sent event; audit records contact_do_not_contact = true and dnc_acknowledged = true',
    v2 = 'ok:sent,true,quote_sent' and pg_temp.acts(qd) = 'quote_sent:sent'
    and (select after_data ->> 'contact_do_not_contact' || '/' || (after_data ->> 'dnc_acknowledged') from public.audit_events where entity_id = qd and action = 'plus_quote_sent') = 'true/true', v2);
  perform pg_temp.t('D5 the acknowledgment changes NOTHING on the contact (do_not_contact, preferred channel, updated_at) and creates no consent / message record',
    (select updated_at::text || '|' || do_not_contact || '|' || preferred_channel from public.plus_contacts where id = kd) = v
    and pg_temp.side() = (select val from t_ctx where name = 'side0'));
  n0 := pg_temp.nacts(); a0 := pg_temp.naudit();
  perform pg_temp.t('D6 repeating the acknowledged confirmation is a no-op (changed=false): no second activity or audit',
    pg_temp.sendack(c_a1, c_a, qd, true) = 'ok:sent,false,quote_sent' and pg_temp.nacts() = n0 and pg_temp.naudit() = a0);
  qd2 := pg_temp.qid(pg_temp.cq(c_a1, c_a, od3, 'lc-key-dnc3'));
  v := pg_temp.send(c_a1, c_a, qd2);
  v2 := (select (after_data ->> 'contact_do_not_contact') || '/' || (after_data ->> 'dnc_acknowledged') from public.audit_events where entity_id = qd2 and action = 'plus_quote_sent');
  perform pg_temp.t('D7 a non-DNC contact: plain Mark sent works; the audit records contact_do_not_contact = false, dnc_acknowledged = false',
    v = 'ok:sent,true,quote_sent' and v2 = 'false/false', v || ' / ' || coalesce(v2, '<null>'));
  -- preference changes between opening the dialog and submitting
  qd3 := pg_temp.qid(pg_temp.cq(c_a1, c_a, od2, 'lc-key-dnc2'));
  update public.plus_contacts set do_not_contact = false where id = kd;   -- (the dialog was opened while the flag was true)
  v := pg_temp.sendack(c_a1, c_a, qd3, true);
  v2 := (select (after_data ->> 'contact_do_not_contact') || '/' || (after_data ->> 'dnc_acknowledged') from public.audit_events where entity_id = qd3 and action = 'plus_quote_sent');
  perform pg_temp.t('D8 flag turned OFF after the dialog opened: an acknowledged submit succeeds and is audited truthfully (contact_do_not_contact = false, dnc_acknowledged = false)',
    v = 'ok:sent,true,quote_sent' and v2 = 'false/false', v || ' / ' || coalesce(v2, '<null>'));
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, pg_temp.opp(c_a, kd, 'LC dnc 4', c_a1), 'lc-key-dnc4'));
  update public.plus_contacts set do_not_contact = true where id = kd;    -- (the dialog was opened while the flag was false)
  perform pg_temp.t('D9 flag turned ON after the dialog opened: the unacknowledged submit is refused (dnc_acknowledgment_required); the acknowledged retry succeeds',
    pg_temp.send(c_a1, c_a, q) = 'ZW004:dnc_acknowledgment_required' and pg_temp.st(q) = 'draft' and pg_temp.sendack(c_a1, c_a, q, true) = 'ok:sent,true,quote_sent');
  r := pg_temp.qid(pg_temp.revise(c_a1, c_a, q, 'lc-key-dnc4r'));
  perform pg_temp.upd(c_a1, c_a, r, 7000);
  perform pg_temp.t('D10 a revision for a DNC contact needs the acknowledgment too; with it, the predecessor is superseded and both events are written',
    pg_temp.send(c_a1, c_a, r) = 'ZW004:dnc_acknowledgment_required' and pg_temp.st(q) = 'sent'
    and pg_temp.sendack(c_a1, c_a, r, true) like 'ok:sent,true,%' and pg_temp.st(q) = 'superseded'
    and pg_temp.acts(q) = 'quote_sent:sent,quote_status_changed:superseded');

  -- ===================================================================== A. Authorization (lifecycle writes + timeline reads)
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, pg_temp.opp(c_a, k, 'LC authz', c_a1), 'lc-key-auth1'));
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.sendack(c_a2, c_a, q, false);
  perform pg_temp.t('A1 a WRITE-grant Dispatcher marks sent (event actor = the Dispatcher)', v = 'ok:sent,true,quote_sent'
    and exists (select 1 from public.plus_activities where quote_id = q and activity_type = 'quote_sent' and actor_user_id = c_a2), v);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  perform pg_temp.t('A2 a READ-grant Dispatcher: reads the timelines, but respond / revise / withdraw / mark sent -> ZW001',
    pg_temp.x(c_a2, format('select count(*)::text from public.plus_list_contact_activities(%L, %L, 50, 0)', c_a, k)) like 'ok:%'
    and pg_temp.respond(c_a2, c_a, q, 'accepted') like 'ZW001:%' and pg_temp.revise(c_a2, c_a, q, 'lc-key-auth2') like 'ZW001:%'
    and pg_temp.withdraw(c_a2, c_a, q, 'x') like 'ZW001:%' and pg_temp.sendack(c_a2, c_a, q, true) like 'ZW001:%');
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  perform pg_temp.t('A3 no-grant Dispatcher, Driver, inactive member, Platform Admin, no-membership user -> ZW002 (writes and timeline reads)',
    pg_temp.sendack(c_a2, c_a, q, true) like 'ZW002:%' and pg_temp.respond(c_a3, c_a, q, 'accepted') like 'ZW002:%' and pg_temp.withdraw(c_a5, c_a, q, 'x') like 'ZW002:%'
    and pg_temp.revise(c_d1, c_a, q, 'lc-key-auth3') like 'ZW002:%' and pg_temp.sendack(c_e1, c_a, q, true) like 'ZW002:%'
    and pg_temp.x(c_a3, format('select count(*)::text from public.plus_list_opportunity_activities(%L, (select opportunity_id from public.plus_quotes where id = %L), 50, 0)', c_a, q)) like 'ZW002:%'
    and pg_temp.x(c_a3, format('select count(*)::text from public.plus_list_recent_activities(%L, 10)', c_a)) like 'ZW002:%');
  perform pg_temp.t('A4 no user -> ZW001; anon has no EXECUTE on the new Mark sent (42501)',
    pg_temp.sendack(null, c_a, q, true) like 'ZW001:%'
    and pg_temp.x(null, format('select (public.plus_mark_quote_sent(%L, %L, now(), true)).status', c_a, q), 'anon') like '42501:%');
  perform pg_temp.t('A5 foreign tenant: Org B admin on Org A quotes -> ZW002 (writes and timeline reads); Org A admin using Org B''s quote -> ZW002',
    pg_temp.respond(c_b1, c_a, q, 'accepted') like 'ZW002:%' and pg_temp.sendack(c_b1, c_a, q, true) like 'ZW002:%'
    and pg_temp.x(c_b1, format('select count(*)::text from public.plus_list_contact_activities(%L, %L, 50, 0)', c_a, k)) like 'ZW002:%'
    and pg_temp.sendack(c_a1, c_a, qb, true) like 'ZW002:%' and pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_contact_activities(%L, %L, 50, 0)', c_a, kb)) like 'ZW002:%');
  perform pg_temp.set_state(c_a, 'expired');
  perform pg_temp.t('A6 Plus expired: timelines readable; every lifecycle write -> ZW001',
    pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_contact_activities(%L, %L, 50, 0)', c_a, k)) like 'ok:%'
    and pg_temp.respond(c_a1, c_a, q, 'accepted') like 'ZW001:%' and pg_temp.withdraw(c_a1, c_a, q, 'x') like 'ZW001:%');
  perform pg_temp.set_state(c_a, 'locked');
  perform pg_temp.t('A7 Plus locked: timelines and writes -> ZW002',
    pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_contact_activities(%L, %L, 50, 0)', c_a, k)) like 'ZW002:%'
    and pg_temp.respond(c_a1, c_a, q, 'accepted') like 'ZW002:%');
  perform pg_temp.set_state(c_a, 'active');

  -- ===================================================================== X. Side effects
  perform pg_temp.t('X1 no Core Request, Trip, Passenger, assignment, notification or task was created by any lifecycle action',
    pg_temp.side() = (select val from t_ctx where name = 'side0'), (select val from t_ctx where name = 'side0') || ' -> ' || pg_temp.side());
  perform pg_temp.t('X2 OD-Q12 still holds after all lifecycle activity: no opportunity with two drafts or two sent quotes',
    not exists (select 1 from public.plus_quotes where status in ('draft', 'sent') group by organization_id, opportunity_id, status having count(*) > 1));
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as summary from t_results;
rollback;
