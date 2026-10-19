-- Nemryn Plus -- Estimates & Quotes DIRECTORY reads (NP-P2-S5-S3A). ROLLBACK-ONLY (one transaction, rolled back).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_quotes_directory_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261020100000_plus_quotes_directory.sql: plus_list_organization_quotes + plus_quote_directory_summary --
-- authorization (every role / Plus state), tenant isolation, search (incl. LIKE wildcards and quote characters), status
-- filters incl. the DERIVED expired filter, pagination boundaries, stable sort orders, summary counts, and that the reads
-- write nothing. FICTIONAL seed fixtures only (same identities as plus_quotes_tests.sql). Quotes are created through the
-- REAL S1 / S2 RPCs; a past validity and distinct creation times are set with the guard trigger disabled inside this
-- rolled-back transaction.

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
-- one directory page as p_uid -> 'ok:<number list in page order>|<total_count>' or '<sqlstate>:<message>'
create function pg_temp.dir(p_uid uuid, p_org uuid, p_search text default null, p_status text default null, p_sort text default null,
                            p_limit integer default 100, p_offset integer default 0, p_role text default 'authenticated')
returns text language sql as $$
  select pg_temp.x(p_uid, format(
    'select coalesce(string_agg(quote_number::text, '','' order by rn), '''') || ''|'' || coalesce(max(total_count), 0) from (select *, row_number() over () rn from public.plus_list_organization_quotes(%L, %L, %L, %L, %s, %s)) x',
    p_org, p_search, p_status, p_sort, coalesce(p_limit::text, 'null'), coalesce(p_offset::text, 'null')), p_role);
$$;
create function pg_temp.cnt(p_org uuid, p_where text) returns bigint language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from public.plus_quotes q where organization_id = %L and %s', p_org, p_where) into v;
  return v;
end $$;
create function pg_temp.summ(p_uid uuid, p_org uuid) returns text language sql as $$
  select pg_temp.x(p_uid, format('select drafts || ''/'' || sent || ''/'' || accepted || ''/'' || expired from public.plus_quote_directory_summary(%L)', p_org));
$$;
-- the expected list of quote numbers under a predicate, newest-first semantics (created_at desc, number desc, id)
create function pg_temp.nums(p_org uuid, p_where text default 'true') returns text language plpgsql as $$
declare v text;
begin
  execute format('select coalesce(string_agg(quote_number::text, '','' order by created_at desc, quote_number desc, id), '''') from public.plus_quotes q where organization_id = %L and %s', p_org, p_where) into v;
  return v;
end $$;

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
  k1 uuid; k2 uuid; k3 uuid; kb uuid;
  o uuid[] := '{}'; ob uuid;
  q uuid; q_exp uuid; q_rev uuid;
  v text; v2 text; i int; v_today date; v_all text; v_tot int; v_counts text;
  v_fn record; v_ok boolean; v_n int;
begin
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_state(c_b, 'active');
  v_today := public._plus_org_local_today(c_a);
  k1 := pg_temp.contact(c_a, 'Directory Ann Fictional', c_a1);
  k2 := pg_temp.contact(c_a, 'Zed 100% Under_Score Fictional', c_a1);
  k3 := pg_temp.contact(c_a, 'O''Brien Fictional', c_a1);
  kb := pg_temp.contact(c_b, 'Directory Ann Fictional', c_b1);
  -- o1,o4,o7 -> Ann; o2,o5,o8 -> O'Brien; o3,o6,o9 -> Zed 100% Under_Score
  for i in 1..9 loop
    o := o || pg_temp.opp(c_a, case when i % 3 = 0 then k2 when i % 3 = 1 then k1 else k3 end, 'Dir opp ' || i || case when i = 4 then ' wheelchair 50%' else '' end, c_a1);
  end loop;
  ob := pg_temp.opp(c_b, kb, 'Dir opp 1 (Org B)', c_b1);
  -- Org A: draft (o1), draft estimate (o2), sent (o3), sent estimate later expired (o4), accepted (o5), declined (o6),
  -- withdrawn draft (o7), superseded + its sent revision (o8), draft (o9)
  perform pg_temp.cq(c_a1, c_a, o[1], 'dir-key-0001');
  perform pg_temp.cq(c_a1, c_a, o[2], 'dir-key-0002', p_kind => 'estimate');
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, o[3], 'dir-key-0003')); perform pg_temp.send(c_a1, c_a, q);
  q_exp := pg_temp.qid(pg_temp.cq(c_a1, c_a, o[4], 'dir-key-0004', p_kind => 'estimate')); perform pg_temp.send(c_a1, c_a, q_exp);
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, o[5], 'dir-key-0005')); perform pg_temp.send(c_a1, c_a, q); perform pg_temp.respond(c_a1, c_a, q, 'accepted');
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, o[6], 'dir-key-0006')); perform pg_temp.send(c_a1, c_a, q); perform pg_temp.respond(c_a1, c_a, q, 'declined');
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, o[7], 'dir-key-0007')); perform pg_temp.withdraw(c_a1, c_a, q, null);
  q := pg_temp.qid(pg_temp.cq(c_a1, c_a, o[8], 'dir-key-0008')); perform pg_temp.send(c_a1, c_a, q);
  q_rev := pg_temp.qid(pg_temp.revise(c_a1, c_a, q, 'dir-key-0008r')); perform pg_temp.send(c_a1, c_a, q_rev);
  perform pg_temp.cq(c_a1, c_a, o[9], 'dir-key-0009');
  perform pg_temp.cq(c_b1, c_b, ob, 'dir-key-b001');
  -- test-only (rolled back): the sent estimate's validity has passed; distinct creation times so the sort orders differ
  alter table public.plus_quotes disable trigger plus_quotes_guard;
  update public.plus_quotes set valid_until = v_today - 1 where id = q_exp;
  update public.plus_quotes set created_at = now() - (quote_number || ' minutes')::interval where organization_id = c_a;
  alter table public.plus_quotes enable trigger plus_quotes_guard;
  v_all := pg_temp.nums(c_a);
  v_tot := (select count(*) from public.plus_quotes where organization_id = c_a);
  v_counts := (select count(*) from public.plus_quotes)::text || '/' || (select count(*) from public.audit_events)::text || '/' || (select count(*) from public.plus_activities)::text;

  -- ===================================================================== S. Contract
  v_ok := true; v := '';
  for v_fn in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('plus_list_organization_quotes', 'plus_quote_directory_summary') loop
    if not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') or has_function_privilege('anon', v_fn.oid, 'EXECUTE')
       or has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
       or exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_fn.oid)) a where a.grantee = 0)
       or not (select prosecdef and provolatile = 's' and proconfig = array['search_path=public, pg_temp'] from pg_proc where oid = v_fn.oid) then
      v_ok := false; v := v || v_fn.proname || ' ';
    end if;
  end loop;
  perform pg_temp.t('S1 both directory RPCs: SECURITY DEFINER, STABLE (read-only), search_path pinned, authenticated EXECUTE only (no PUBLIC / anon / service_role)',
    v_ok and (select count(*) from pg_proc where proname in ('plus_list_organization_quotes', 'plus_quote_directory_summary')) = 2, v);
  perform pg_temp.t('S2 no new table or client grant: plus_quotes keeps one SELECT policy and SELECT-only for authenticated; the status index exists',
    (select count(*) from pg_policies where tablename = 'plus_quotes') = 1 and not has_table_privilege('authenticated', 'public.plus_quotes', 'INSERT')
    and not has_table_privilege('authenticated', 'public.plus_quotes', 'UPDATE') and not has_table_privilege('authenticated', 'public.plus_quotes', 'DELETE')
    and to_regclass('public.plus_quotes_org_status_valid_idx') is not null);

  -- ===================================================================== A. Authorization and tenancy
  v := pg_temp.dir(c_a1, c_a);
  perform pg_temp.t('A1 Organization Admin: the whole directory of Org A (every quote, total_count = all), nothing from Org B',
    v = 'ok:' || v_all || '|' || v_tot, v || ' vs ' || v_all);
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.dir(c_a2, c_a); v2 := pg_temp.summ(c_a2, c_a);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  perform pg_temp.t('A2 WRITE-grant and READ-grant Dispatchers read the same directory and summary',
    v = 'ok:' || v_all || '|' || v_tot and pg_temp.dir(c_a2, c_a) = v and v2 like 'ok:%' and pg_temp.summ(c_a2, c_a) = v2, v || ' / ' || v2);
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  perform pg_temp.t('A3 no-grant Dispatcher, Driver, inactive member, Platform Admin without membership, no-membership user -> ZW002 (list and summary)',
    pg_temp.dir(c_a2, c_a) like 'ZW002:%' and pg_temp.dir(c_a3, c_a) like 'ZW002:%' and pg_temp.dir(c_a5, c_a) like 'ZW002:%'
    and pg_temp.dir(c_d1, c_a) like 'ZW002:%' and pg_temp.dir(c_e1, c_a) like 'ZW002:%'
    and pg_temp.summ(c_a2, c_a) like 'ZW002:%' and pg_temp.summ(c_a3, c_a) like 'ZW002:%' and pg_temp.summ(c_e1, c_a) like 'ZW002:%');
  perform pg_temp.t('A4 no user -> ZW001; anon role has no EXECUTE (42501)',
    pg_temp.dir(null, c_a) like 'ZW001:%' and pg_temp.summ(null, c_a) like 'ZW001:%'
    and pg_temp.dir(null, c_a, p_role => 'anon') like '42501:%');
  perform pg_temp.t('A5 cross-tenant: Org B admin asking for Org A -> ZW002 (same as unknown); a random organization id -> ZW002',
    pg_temp.dir(c_b1, c_a) like 'ZW002:%' and pg_temp.summ(c_b1, c_a) like 'ZW002:%' and pg_temp.dir(c_a1, gen_random_uuid()) like 'ZW002:%');
  v := pg_temp.dir(c_a1, c_a, 'Directory Ann');
  perform pg_temp.t('A6 search never crosses tenants: the same contact name exists in both organizations; each sees only its own',
    v = 'ok:' || pg_temp.nums(c_a, format('opportunity_id in (%L, %L, %L)', o[1], o[4], o[7])) || '|3'
    and pg_temp.dir(c_b1, c_b, 'Directory Ann') = 'ok:1|1', v);
  perform pg_temp.set_state(c_a, 'expired');
  perform pg_temp.t('A7 Plus expired (read-only): the Admin can still read the directory and the summary',
    pg_temp.dir(c_a1, c_a) = 'ok:' || v_all || '|' || v_tot and pg_temp.summ(c_a1, c_a) like 'ok:%');
  perform pg_temp.set_state(c_a, 'locked');
  perform pg_temp.t('A8 Plus locked: no read (ZW002) for list and summary', pg_temp.dir(c_a1, c_a) like 'ZW002:%' and pg_temp.summ(c_a1, c_a) like 'ZW002:%');
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.t('A9 no direct client write path: INSERT / UPDATE / DELETE on plus_quotes as a signed-in Admin -> 42501',
    pg_temp.x(c_a1, format('insert into public.plus_quotes (organization_id, opportunity_id, quote_number, kind, total_cents, valid_until, idempotency_key, created_by) values (%L, %L, 500, ''quote'', 0, current_date, ''dir-direct-01'', %L) returning id::text', c_a, o[1], c_a1)) like '42501:%'
    and pg_temp.x(c_a1, 'update public.plus_quotes set base_cents = 1 returning id::text') like '42501:%'
    and pg_temp.x(c_a1, 'delete from public.plus_quotes returning id::text') like '42501:%');

  -- ===================================================================== F. Status filters (derived expiry)
  perform pg_temp.t('F1 draft / accepted / declined / withdrawn / superseded filters return exactly that stored status',
    pg_temp.dir(c_a1, c_a, p_status => 'draft') = 'ok:' || pg_temp.nums(c_a, 'status = ''draft''') || '|' || pg_temp.cnt(c_a, 'status = ''draft''')
    and pg_temp.dir(c_a1, c_a, p_status => 'accepted') = 'ok:' || pg_temp.nums(c_a, 'status = ''accepted''') || '|' || pg_temp.cnt(c_a, 'status = ''accepted''')
    and pg_temp.dir(c_a1, c_a, p_status => 'declined') = 'ok:' || pg_temp.nums(c_a, 'status = ''declined''') || '|' || pg_temp.cnt(c_a, 'status = ''declined''')
    and pg_temp.dir(c_a1, c_a, p_status => 'withdrawn') = 'ok:' || pg_temp.nums(c_a, 'status = ''withdrawn''') || '|' || pg_temp.cnt(c_a, 'status = ''withdrawn''')
    and pg_temp.dir(c_a1, c_a, p_status => 'superseded') = 'ok:' || pg_temp.nums(c_a, 'status = ''superseded''') || '|' || pg_temp.cnt(c_a, 'status = ''superseded'''));
  perform pg_temp.t('F2 "sent" = EVERY stored sent quote (the OD-Q12 current-sent slots, including the expired one)',
    pg_temp.dir(c_a1, c_a, p_status => 'sent') = 'ok:' || pg_temp.nums(c_a, 'status = ''sent''') || '|' || pg_temp.cnt(c_a, 'status = ''sent''') and pg_temp.dir(c_a1, c_a, p_status => 'sent') like '%' || (select quote_number from public.plus_quotes where id = q_exp) || '%');
  perform pg_temp.t('F3 "expired" = stored sent AND valid_until before the organization-local today: exactly the one sent estimate',
    pg_temp.dir(c_a1, c_a, p_status => 'expired') = 'ok:' || pg_temp.nums(c_a, format('status = ''sent'' and valid_until < %L', v_today)) || '|' || pg_temp.cnt(c_a, format('status = ''sent'' and valid_until < %L', v_today))
    and pg_temp.dir(c_a1, c_a, p_status => 'expired') like 'ok:%' || (select quote_number from public.plus_quotes where id = q_exp) || '%');
  perform pg_temp.t('F4 the expired quote keeps its STORED status sent and reads is_expired = true; drafts are never expired; no Expired status exists',
    pg_temp.x(c_a1, format('select status || ''/'' || is_expired from public.plus_list_organization_quotes(%L, null, ''expired'', null, 10, 0)', c_a)) = 'ok:sent/true'
    and pg_temp.x(c_a1, format('select string_agg(distinct is_expired::text, '','') from public.plus_list_organization_quotes(%L, null, ''draft'', null, 10, 0)', c_a)) = 'ok:false'
    and (select count(*) from public.plus_quotes where status = 'expired') = 0);
  alter table public.plus_quotes disable trigger plus_quotes_guard;
  update public.plus_quotes set valid_until = v_today where id = q_rev;
  alter table public.plus_quotes enable trigger plus_quotes_guard;
  perform pg_temp.t('F5 boundary: a sent quote valid until the organization-local TODAY is still valid (not expired)',
    pg_temp.dir(c_a1, c_a, p_status => 'expired') = 'ok:' || pg_temp.nums(c_a, format('status = ''sent'' and valid_until < %L', v_today)) || '|' || pg_temp.cnt(c_a, format('status = ''sent'' and valid_until < %L', v_today))
    and pg_temp.dir(c_a1, c_a, p_status => 'expired') not like '%' || (select quote_number from public.plus_quotes where id = q_rev) || '|%');
  perform pg_temp.t('F6 null / empty / "all" status = every quote', pg_temp.dir(c_a1, c_a, p_status => '') = pg_temp.dir(c_a1, c_a) and pg_temp.dir(c_a1, c_a, p_status => 'all') = pg_temp.dir(c_a1, c_a));

  -- ===================================================================== Q. Search
  v_n := (select quote_number from public.plus_quotes where opportunity_id = o[5]);
  perform pg_temp.t('Q1 by quote number: "#n", "Quote n", "estimate n" -> exactly that quote; a bare "n" returns it too (and any title / name containing those digits, by design)',
    pg_temp.dir(c_a1, c_a, '#' || v_n) = 'ok:' || v_n || '|1' and pg_temp.dir(c_a1, c_a, 'Quote ' || v_n) = 'ok:' || v_n || '|1' and pg_temp.dir(c_a1, c_a, 'estimate ' || v_n) = 'ok:' || v_n || '|1'
    and (',' || split_part(substr(pg_temp.dir(c_a1, c_a, v_n::text), 4), '|', 1) || ',') like '%,' || v_n || ',%',
    pg_temp.dir(c_a1, c_a, '#' || v_n));
  perform pg_temp.t('Q2 by kind: "estimate" -> every estimate; "quotes" -> every quote of kind quote',
    pg_temp.dir(c_a1, c_a, 'estimate') = 'ok:' || pg_temp.nums(c_a, 'kind = ''estimate''') || '|' || pg_temp.cnt(c_a, 'kind = ''estimate''')
    and pg_temp.dir(c_a1, c_a, 'quotes') = 'ok:' || pg_temp.nums(c_a, 'kind = ''quote''') || '|' || (select count(*) from public.plus_quotes where organization_id = c_a and kind = 'quote'));
  perform pg_temp.t('Q3 by opportunity title (case-insensitive substring) and by contact name (incl. an apostrophe)',
    pg_temp.dir(c_a1, c_a, 'DIR OPP 3') = 'ok:' || pg_temp.nums(c_a, format('opportunity_id = %L', o[3])) || '|1'
    and pg_temp.dir(c_a1, c_a, 'o''brien') = 'ok:' || pg_temp.nums(c_a, format('opportunity_id in (%L, %L, %L)', o[2], o[5], o[8])) || '|4',
    pg_temp.dir(c_a1, c_a, 'o''brien'));
  perform pg_temp.t('Q4 wildcards are literal: "%" matches only text containing a percent sign; "_" only an underscore; "\" never errors',
    pg_temp.dir(c_a1, c_a, '%') = 'ok:' || pg_temp.nums(c_a, format('opportunity_id in (%L, %L, %L, %L)', o[3], o[4], o[6], o[9])) || '|4'
    and pg_temp.dir(c_a1, c_a, '50%') = 'ok:' || pg_temp.nums(c_a, format('opportunity_id = %L', o[4])) || '|1'
    and pg_temp.dir(c_a1, c_a, '_') = 'ok:' || pg_temp.nums(c_a, format('opportunity_id in (%L, %L, %L)', o[3], o[6], o[9])) || '|3'
    and pg_temp.dir(c_a1, c_a, '\') = 'ok:|0' and pg_temp.dir(c_a1, c_a, '%%%%') = 'ok:|0',
    pg_temp.dir(c_a1, c_a, '%') || ' / ' || pg_temp.dir(c_a1, c_a, '_'));
  perform pg_temp.t('Q5 quote characters / SQL-looking text are data, never SQL: no error, no rows; the table is intact',
    pg_temp.dir(c_a1, c_a, ''' or 1=1 --') = 'ok:|0' and pg_temp.dir(c_a1, c_a, '''); drop table plus_quotes; --') = 'ok:|0'
    and to_regclass('public.plus_quotes') is not null);
  perform pg_temp.t('Q6 free text is NOT searched: the terms note text matches nothing', pg_temp.dir(c_a1, c_a, 'valid for the dates') = 'ok:|0');
  perform pg_temp.t('Q7 search + status combine; blank / whitespace search = no search; 200 characters ok, 201 -> ZW006',
    pg_temp.dir(c_a1, c_a, 'Directory Ann', 'draft') = 'ok:' || pg_temp.nums(c_a, format('opportunity_id = %L', o[1])) || '|1'
    and pg_temp.dir(c_a1, c_a, '   ') = pg_temp.dir(c_a1, c_a)
    and pg_temp.dir(c_a1, c_a, repeat('z', 200)) = 'ok:|0' and pg_temp.dir(c_a1, c_a, repeat('z', 201)) like 'ZW006:%');

  -- ===================================================================== P. Pagination + sort
  v := ''; i := 0;
  while i < v_tot + 3 loop
    v2 := pg_temp.dir(c_a1, c_a, p_limit => 3, p_offset => i);
    exit when split_part(substr(v2, 4), '|', 1) = '';
    v := v || case when v = '' then '' else ',' end || split_part(substr(v2, 4), '|', 1);
    i := i + 3;
  end loop;
  perform pg_temp.t('P1 pages of 3 cover every quote exactly once, in the same order as the full list (stable)', v = v_all, v || ' vs ' || v_all);
  perform pg_temp.t('P2 every page reports the filtered total; the last partial page and an offset past the end behave',
    pg_temp.dir(c_a1, c_a, p_limit => 3, p_offset => v_tot - 1) = 'ok:' || split_part(v_all, ',', v_tot) || '|' || v_tot
    and pg_temp.dir(c_a1, c_a, p_limit => 3, p_offset => v_tot + 50) = 'ok:|0'
    and pg_temp.dir(c_a1, c_a, p_limit => 1) = 'ok:' || split_part(v_all, ',', 1) || '|' || v_tot, pg_temp.dir(c_a1, c_a, p_limit => 3, p_offset => v_tot - 1));
  perform pg_temp.t('P3 bounds: limit 1 and 100 ok; limit 0 / 101, offset -1 / 100001 -> ZW006; offset 100000 ok; null limit / offset use the defaults (25, 0)',
    pg_temp.dir(c_a1, c_a, p_limit => 100) like 'ok:%' and pg_temp.dir(c_a1, c_a, p_limit => 0) like 'ZW006:%' and pg_temp.dir(c_a1, c_a, p_limit => 101) like 'ZW006:%'
    and pg_temp.dir(c_a1, c_a, p_offset => -1) like 'ZW006:%' and pg_temp.dir(c_a1, c_a, p_offset => 100001) like 'ZW006:%'
    and pg_temp.dir(c_a1, c_a, p_offset => 100000) = 'ok:|0' and pg_temp.dir(c_a1, c_a, p_limit => null, p_offset => null) = pg_temp.dir(c_a1, c_a));
  perform pg_temp.t('P4 invalid status or sort -> ZW006 (never a silent default; status values are case-sensitive)',
    pg_temp.dir(c_a1, c_a, p_status => 'expired_soon') like 'ZW006:%' and pg_temp.dir(c_a1, c_a, p_status => 'Draft') like 'ZW006:%'
    and pg_temp.dir(c_a1, c_a, p_sort => 'random') like 'ZW006:%');
  perform pg_temp.t('P5 sort orders: oldest = reverse creation; number = highest first; valid_until = soonest first (ties by number desc)',
    pg_temp.dir(c_a1, c_a, p_sort => 'oldest') = 'ok:' || (select string_agg(quote_number::text, ',' order by created_at asc, quote_number desc, id) from public.plus_quotes where organization_id = c_a) || '|' || v_tot
    and pg_temp.dir(c_a1, c_a, p_sort => 'number') = 'ok:' || (select string_agg(quote_number::text, ',' order by quote_number desc) from public.plus_quotes where organization_id = c_a) || '|' || v_tot
    and pg_temp.dir(c_a1, c_a, p_sort => 'valid_until') = 'ok:' || (select string_agg(quote_number::text, ',' order by valid_until asc, quote_number desc, id) from public.plus_quotes where organization_id = c_a) || '|' || v_tot);
  perform pg_temp.t('P6 rows carry the display metadata (opportunity title / stage, contact name, service, total, currency, dates) and the stored status',
    pg_temp.x(c_a1, format('select opportunity_title || ''|'' || opportunity_stage || ''|'' || contact_name || ''|'' || coalesce(service_type, ''-'') || ''|'' || total_cents || ''|'' || currency || ''|'' || (valid_until is not null) || ''|'' || (created_at is not null) || ''|'' || status from public.plus_list_organization_quotes(%L, ''Dir opp 5'', null, null, 5, 0)', c_a))
      = 'ok:Dir opp 5|quote_accepted|O''Brien Fictional|dialysis|12550|USD|true|true|accepted',
    pg_temp.x(c_a1, format('select opportunity_title || ''|'' || opportunity_stage || ''|'' || contact_name || ''|'' || coalesce(service_type, ''-'') || ''|'' || total_cents || ''|'' || currency || ''|'' || status from public.plus_list_organization_quotes(%L, ''Dir opp 5'', null, null, 5, 0)', c_a)));

  -- ===================================================================== C. Summary counts
  perform pg_temp.t('C1 summary = drafts / sent (all stored sent, incl. expired) / accepted / expired (subset of sent) -- equal to direct counts',
    pg_temp.summ(c_a1, c_a) = 'ok:' || (select count(*) filter (where status = 'draft') || '/' || count(*) filter (where status = 'sent') || '/' || count(*) filter (where status = 'accepted')
      || '/' || count(*) filter (where status = 'sent' and valid_until < v_today) from public.plus_quotes where organization_id = c_a)
, pg_temp.summ(c_a1, c_a));
  perform pg_temp.t('C2 summary is per organization: Org B = 1 draft only', pg_temp.summ(c_b1, c_b) = 'ok:1/0/0/0', pg_temp.summ(c_b1, c_b));
  delete from public.plus_quotes where organization_id = c_b;   -- owner cleanup inside the rolled-back transaction
  perform pg_temp.t('C3 an organization with no quotes: zeros (not an error) and an empty page with total 0',
    pg_temp.summ(c_b1, c_b) = 'ok:0/0/0/0' and pg_temp.dir(c_b1, c_b) = 'ok:|0');

  -- ===================================================================== X. Read-only
  perform pg_temp.t('X1 the directory reads wrote nothing (Org A quotes / audit / activities unchanged across every call above; Org B removed only by the test owner)',
    (select count(*) from public.plus_quotes)::text || '/' || (select count(*) from public.audit_events)::text || '/' || (select count(*) from public.plus_activities)::text
      = (split_part(v_counts, '/', 1)::int - 1)::text || '/' || split_part(v_counts, '/', 2) || '/' || split_part(v_counts, '/', 3));
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as summary from t_results;
rollback;
