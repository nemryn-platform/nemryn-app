-- Nemryn Plus -- Estimates & Quotes foundation (NP-P2-S5-S1). ROLLBACK-ONLY (one transaction, rolled back).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_quotes_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261018100000_plus_quotes_foundation.sql. FICTIONAL seed fixtures only: Org A (admin a1, dispatcher a2,
-- driver a3, inactive dispatcher a5, multi-org c1), Org B (admin b1, dispatcher b2), platform admin d1, no-membership
-- e1. Calls go through the REAL RPCs as the signed-in staff member. Inside one transaction now() is constant: a
-- "stale" version is simulated with an earlier timestamp; a past validity is simulated by a direct owner update of a
-- DRAFT (allowed) or with the guard trigger disabled inside this rolled-back transaction (documented per test).

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
create function pg_temp.side() returns text language sql as $$
  select (select count(*) from public.transportation_requests) || '/' || (select count(*) from public.request_events) || '/'
    || (select count(*) from public.trips) || '/' || (select count(*) from public.passengers) || '/' || (select count(*) from public.trip_assignments)
    || '/' || (select count(*) from public.recurring_arrangements) || '/' || (select count(*) from public.notification_events)
    || '/' || (select count(*) from public.plus_tasks) || '/' || (select count(*) from public.plus_request_attributions);
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
  c_b2 constant uuid := '20000000-0000-0000-0000-0000000000b2';
  c_d1 constant uuid := '20000000-0000-0000-0000-0000000000d1';
  c_e1 constant uuid := '20000000-0000-0000-0000-0000000000e1';
  v_today_a date;
  k uuid; kb uuid; k_arch uuid;
  o uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; ob uuid; o_lost uuid; o_conv uuid; o_acc uuid;
  q uuid; q2 uuid; q3 uuid; qb uuid; r uuid; r2 uuid;
  v text; v2 text; v_n int; v_c int; v_a int;
  v_fn record; v_ok boolean;
  v_na int; v_nb int;  -- numbers already used before this suite (0 on a fresh database; > 0 on an upgraded one)
begin
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_state(c_b, 'active');
  v_na := (select coalesce(max(quote_number), 0) from public.plus_quotes where organization_id = c_a);
  v_nb := (select coalesce(max(quote_number), 0) from public.plus_quotes where organization_id = c_b);
  v_today_a := (now() at time zone (select timezone from public.organizations where id = c_a))::date;
  k := pg_temp.contact(c_a, 'Quote Pat Fictional', c_a1);
  kb := pg_temp.contact(c_b, 'Quote Bea Fictional', c_b1);
  o := pg_temp.opp(c_a, k, 'Q weekly dialysis', c_a1);
  ob := pg_temp.opp(c_b, kb, 'QB opportunity', c_b1);
  insert into t_ctx values ('opp_money', (select estimated_value_cents || '/' || payment_reported_status from public.plus_opportunities where id = o));

  -- ===================================================================== S. Schema, RLS and function contract
  perform pg_temp.t('S1 RLS enabled on plus_quotes and plus_quote_counters',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.plus_quotes'::regclass, 'public.plus_quote_counters'::regclass)));
  perform pg_temp.t('S2 plus_quotes: authenticated SELECT only (no INSERT / UPDATE / DELETE / TRUNCATE); anon nothing; counters: no client privilege',
    has_table_privilege('authenticated', 'public.plus_quotes', 'SELECT')
    and not has_table_privilege('authenticated', 'public.plus_quotes', 'INSERT') and not has_table_privilege('authenticated', 'public.plus_quotes', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.plus_quotes', 'DELETE') and not has_table_privilege('authenticated', 'public.plus_quotes', 'TRUNCATE')
    and not has_table_privilege('anon', 'public.plus_quotes', 'SELECT') and not has_table_privilege('service_role', 'public.plus_quotes', 'SELECT')
    and not has_table_privilege('authenticated', 'public.plus_quote_counters', 'SELECT') and not has_table_privilege('anon', 'public.plus_quote_counters', 'SELECT'));
  perform pg_temp.t('S3 exactly one SELECT policy (plus_can_read) on plus_quotes; none on counters',
    (select count(*) from pg_policies where tablename = 'plus_quotes') = 1
    and (select cmd || '|' || qual from pg_policies where tablename = 'plus_quotes') = 'SELECT|plus_can_read(organization_id)'
    and (select count(*) from pg_policies where tablename = 'plus_quote_counters') = 0);
  v_ok := true; v := '';
  for v_fn in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and (p.proname like 'plus\_%quote%' or p.proname like '\_plus\_%quote%' or p.proname = '_plus_org_local_today' or p.proname = '_plus_next_quote_number') loop
    if not (has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') = (v_fn.proname like 'plus\_%'))
       or has_function_privilege('anon', v_fn.oid, 'EXECUTE') or has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
       or exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_fn.oid)) a where a.grantee = 0)
       or not coalesce((select proconfig = array['search_path=public, pg_temp'] from pg_proc where oid = v_fn.oid), false) then
      v_ok := false; v := v || v_fn.proname || ' ';
    end if;
  end loop;
  perform pg_temp.t('S4 every quote function: search_path pinned; public RPCs authenticated-only; internals no client EXECUTE; never PUBLIC / anon / service_role', v_ok, v);
  perform pg_temp.t('S5 public quote RPCs are SECURITY DEFINER (8)',
    (select count(*) from pg_proc where proname in ('plus_create_quote', 'plus_update_quote_draft', 'plus_mark_quote_sent', 'plus_record_quote_response',
      'plus_revise_quote', 'plus_withdraw_quote', 'plus_list_quotes', 'plus_get_quote') and prosecdef) = 8);
  perform pg_temp.t('S6 privacy: plus_quotes has NO address / route / appointment / medical column',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plus_quotes'
                and column_name ~ '(pickup|destination|address|route|appointment|diagnos|medical|assistance_notes|passenger)'));

  -- ===================================================================== C. Create + money
  v := pg_temp.cq(c_a1, c_a, o, 'q-create-0001', p_base => 10000, p_mileage => 2550, p_wait => 1500, p_stops => 500, p_mobility => 2000,
                  p_escort => 1000, p_return => 9000, p_other => 750, p_other_label => 'Fictional toll', p_discount => 1250);
  q := pg_temp.qid(v);
  perform pg_temp.t('C1 Admin creates a DRAFT; total = sum of the eight charges minus the discount (27300 - 1250 = 26050); next number in Org A (1 on a fresh database)',
    v like 'ok:%,true,' || (v_na + 1) || ',26050' and pg_temp.st(q) = 'draft'
    and (select total_cents from public.plus_quotes where id = q) = 26050, v);
  perform pg_temp.t('C2 the draft changes no opportunity stage; currency USD; created_by = caller; audit plus_quote_created (no prices in it)',
    pg_temp.stage(o) = 'qualified' and (select currency || '|' || (created_by = c_a1) from public.plus_quotes where id = q) = 'USD|true'
    and (select count(*) from public.audit_events where entity_id = q and action = 'plus_quote_created') = 1
    and not exists (select 1 from public.audit_events where entity_id = q and after_data::text ~ '_cents'));
  v := pg_temp.cq(c_a1, c_a, o, 'q-create-0001', p_base => 99999);
  perform pg_temp.t('C3 same key + same opportunity -> the ORIGINAL quote, changed=false; a different payload changes nothing',
    v = 'ok:' || q || ',false,' || (v_na + 1) || ',26050' and (select base_cents from public.plus_quotes where id = q) = 10000
    and (select count(*) from public.plus_quotes where opportunity_id = o) = 1, v);
  o2 := pg_temp.opp(c_a, k, 'Q second opportunity', c_a1);
  perform pg_temp.t('C4 the same key on ANOTHER opportunity -> ZW006 (never the first quote)', pg_temp.cq(c_a1, c_a, o2, 'q-create-0001') = 'ZW006:invalid_input');
  v_c := (select count(*) from public.plus_quotes);
  perform pg_temp.t('C5 discount greater than the subtotal -> ZW006', pg_temp.cq(c_a1, c_a, o, 'q-bad-0001', p_base => 1000, p_mileage => 0, p_discount => 1001) = 'ZW006:invalid_input');
  perform pg_temp.t('C6 a negative line -> ZW006', pg_temp.cq(c_a1, c_a, o, 'q-bad-0002', p_wait => -1) = 'ZW006:invalid_input');
  perform pg_temp.t('C7 a line over $100,000.00 (10,000,001 cents) -> ZW006; exactly 10,000,000 is allowed',
    pg_temp.cq(c_a1, c_a, o, 'q-bad-0003', p_base => 10000001) = 'ZW006:invalid_input'
    and pg_temp.cq(c_a1, c_a, o2, 'q-max-0001', p_base => 10000000, p_mileage => 0) like 'ok:%,true,%,10000000');
  delete from public.plus_quotes where idempotency_key = 'q-max-0001';  -- owner cleanup of the boundary fixture inside the rolled-back transaction
  perform pg_temp.t('C8 fractional cents are impossible: a non-integer amount is not a valid bigint argument',
    pg_temp.x(c_a1, format('select (public.plus_create_quote(%L, %L, ''q-bad-0004'', ''quote'', null, false, null, 12.5, 0, 0, 0, 0, 0, 0, 0, null, 0, null, %L)).quote_id', c_a, o, current_date + 7)) !~ '^ok:'
    and pg_temp.x(c_a1, format('select (public.plus_create_quote(%L, %L, ''q-bad-0005'', ''quote'', null, false, null, ''12.50'', 0, 0, 0, 0, 0, 0, 0, null, 0, null, %L)).quote_id', c_a, o, current_date + 7)) !~ '^ok:');
  perform pg_temp.t('C9 distance with more than one decimal / negative / over 99999.9 -> ZW006 (never rounded silently)',
    pg_temp.cq(c_a1, c_a, o, 'q-bad-0006', p_distance => 12.34) = 'ZW006:invalid_input'
    and pg_temp.cq(c_a1, c_a, o, 'q-bad-0007', p_distance => -1) = 'ZW006:invalid_input'
    and pg_temp.cq(c_a1, c_a, o, 'q-bad-0008', p_distance => 100000) = 'ZW006:invalid_input');
  perform pg_temp.t('C10 other charge without a label, a label without a charge, a 61-character label -> ZW006',
    pg_temp.cq(c_a1, c_a, o, 'q-bad-0009', p_other => 500) = 'ZW006:invalid_input'
    and pg_temp.cq(c_a1, c_a, o, 'q-bad-0010', p_other_label => 'Toll') = 'ZW006:invalid_input'
    and pg_temp.cq(c_a1, c_a, o, 'q-bad-0011', p_other => 500, p_other_label => repeat('x', 61)) = 'ZW006:invalid_input');
  perform pg_temp.t('C11 kind not estimate|quote; service airport_transportation (not a Plus service) or unknown -> ZW006',
    pg_temp.cq(c_a1, c_a, o, 'q-bad-0012', p_kind => 'invoice') = 'ZW006:invalid_input'
    and pg_temp.cq(c_a1, c_a, o, 'q-bad-0013', p_service => 'airport_transportation') = 'ZW006:invalid_input'
    and pg_temp.cq(c_a1, c_a, o, 'q-bad-0014', p_service => 'Dialysis') = 'ZW006:invalid_input');
  perform pg_temp.t('C12 terms over 500 characters -> ZW006; validity missing or before the organization''s today -> ZW006',
    pg_temp.cq(c_a1, c_a, o, 'q-bad-0015', p_terms => repeat('t', 501)) = 'ZW006:invalid_input'
    and pg_temp.cq(c_a1, c_a, o, 'q-bad-0016', p_valid => null) = 'ZW006:invalid_input'
    and pg_temp.cq(c_a1, c_a, o, 'q-bad-0017', p_valid => v_today_a - 1) = 'ZW006:invalid_input');
  perform pg_temp.t('C13 malformed idempotency key -> ZW006', pg_temp.cq(c_a1, c_a, o, 'short') = 'ZW006:invalid_input'
    and pg_temp.cq(c_a1, c_a, o, 'bad key with spaces') = 'ZW006:invalid_input');
  perform pg_temp.t('C14 refused creates wrote nothing', (select count(*) from public.plus_quotes) = v_c);
  begin
    update public.plus_quotes set total_cents = total_cents + 1 where id = q;
    v := 'no error';
  exception when check_violation then v := 'check_violation';
  end;
  perform pg_temp.t('C15 a forged total is impossible: the RPC has no total input and the CHECK rejects any other total (direct owner update)', v = 'check_violation', v);
  begin
    insert into public.plus_quotes (organization_id, opportunity_id, quote_number, kind, total_cents, currency, valid_until, idempotency_key, created_by)
    values (c_a, o, 9999, 'quote', 0, 'EUR', current_date + 1, 'q-eur-00001', c_a1);
    v := 'no error';
  exception when check_violation then v := 'check_violation';
  end;
  perform pg_temp.t('C16 USD only: a non-USD row is rejected by the CHECK (no API accepts a currency)', v = 'check_violation', v);
  v := pg_temp.cq(c_a1, c_a, o, 'q-create-0002', p_base => 333, p_mileage => 333, p_wait => 334);
  perform pg_temp.t('C17 integer arithmetic only: 333 + 333 + 334 = 1000 exactly', v like 'ok:%,true,%,1000', v);
  q2 := pg_temp.qid(v);

  -- ===================================================================== N. Numbering (tenant-scoped)
  v := pg_temp.cq(c_b1, c_b, ob, 'q-orgb-00001');
  qb := pg_temp.qid(v);
  perform pg_temp.t('N1 numbering is per organization (Org B''s next quote follows Org B''s own numbers, 1 on a fresh database) and never reused: Org A''s third number goes to q2 because the deleted boundary fixture consumed the second', v like 'ok:%,true,' || (v_nb + 1) || ',%' and (select quote_number from public.plus_quotes where id = q2) = v_na + 3, v);
  perform pg_temp.t('N2 the counter rows are per organization and never readable by clients',
    (select count(*) from public.plus_quote_counters where organization_id in (c_a, c_b)) = 2
    and pg_temp.x(c_a1, 'select count(*)::text from public.plus_quote_counters') like '42501:%');

  -- ===================================================================== A. Authorization and tenancy
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.cq(c_a2, c_a, o2, 'q-disp-00001');
  perform pg_temp.t('A1 a WRITE-grant Dispatcher creates a quote', v like 'ok:%,true,%');
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  perform pg_temp.t('A2 a READ-grant Dispatcher: lists / reads quotes, but every write -> ZW001',
    pg_temp.x(c_a2, format('select count(*)::text from public.plus_list_quotes(%L, %L, null)', c_a, o)) like 'ok:%'
    and pg_temp.x(c_a2, format('select quote_number::text from public.plus_get_quote(%L, %L)', c_a, q)) = 'ok:' || (v_na + 1)
    and pg_temp.cq(c_a2, c_a, o, 'q-ro-000001') like 'ZW001:%'
    and pg_temp.send(c_a2, c_a, q) like 'ZW001:%' and pg_temp.withdraw(c_a2, c_a, q, null) like 'ZW001:%');
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  perform pg_temp.t('A3 Dispatcher without a grant, Driver, inactive member, Platform Admin without membership, no-membership user -> ZW002 (read and write)',
    pg_temp.cq(c_a2, c_a, o, 'q-deny-0001') like 'ZW002:%' and pg_temp.x(c_a2, format('select count(*)::text from public.plus_list_quotes(%L, %L, null)', c_a, o)) like 'ZW002:%'
    and pg_temp.cq(c_a3, c_a, o, 'q-deny-0002') like 'ZW002:%' and pg_temp.cq(c_a5, c_a, o, 'q-deny-0003') like 'ZW002:%'
    and pg_temp.cq(c_d1, c_a, o, 'q-deny-0004') like 'ZW002:%' and pg_temp.cq(c_e1, c_a, o, 'q-deny-0005') like 'ZW002:%'
    and pg_temp.x(c_a3, format('select quote_number::text from public.plus_get_quote(%L, %L)', c_a, q)) like 'ZW002:%');
  perform pg_temp.t('A4 no user -> ZW001; anon role -> no EXECUTE (42501)',
    pg_temp.cq(null, c_a, o, 'q-deny-0006') like 'ZW001:%'
    and pg_temp.x(null, format('select (public.plus_get_quote(%L, %L)).quote_number', c_a, q), 'anon') like '42501:%');
  perform pg_temp.t('A5 foreign tenant: Org B admin on Org A ids -> ZW002; Org A admin using Org B''s quote / opportunity under Org A -> ZW002 (indistinguishable from unknown)',
    pg_temp.cq(c_b1, c_a, o, 'q-foreign-01') like 'ZW002:%'
    and pg_temp.x(c_b1, format('select quote_number::text from public.plus_get_quote(%L, %L)', c_a, q)) like 'ZW002:%'
    and pg_temp.x(c_a1, format('select quote_number::text from public.plus_get_quote(%L, %L)', c_a, qb)) like 'ZW002:%'
    and pg_temp.x(c_a1, format('select quote_number::text from public.plus_get_quote(%L, %L)', c_a, gen_random_uuid())) = pg_temp.x(c_a1, format('select quote_number::text from public.plus_get_quote(%L, %L)', c_a, qb))
    and pg_temp.cq(c_a1, c_a, ob, 'q-foreign-02') like 'ZW002:%'
    and pg_temp.send(c_a1, c_a, qb) like 'ZW002:%' and pg_temp.revise(c_a1, c_a, qb, 'q-foreign-03') like 'ZW002:%');
  perform pg_temp.t('A6 RLS: Org B admin sees 0 Org A quote rows; Org A admin sees them; a Driver sees none',
    pg_temp.x(c_b1, format('select count(*)::text from public.plus_quotes where organization_id = %L', c_a)) = 'ok:0'
    and pg_temp.x(c_a1, format('select count(*)::text from public.plus_quotes where organization_id = %L', c_a)) <> 'ok:0'
    and pg_temp.x(c_a3, 'select count(*)::text from public.plus_quotes') = 'ok:0');
  perform pg_temp.t('A7 direct INSERT / UPDATE / DELETE by a client -> 42501 (no write path besides the RPCs)',
    pg_temp.x(c_a1, format('insert into public.plus_quotes (organization_id, opportunity_id, quote_number, kind, total_cents, valid_until, idempotency_key, created_by) values (%L, %L, 77, ''quote'', 0, current_date, ''q-direct-001'', %L) returning id::text', c_a, o, c_a1)) like '42501:%'
    and pg_temp.x(c_a1, format('update public.plus_quotes set base_cents = 1 where id = %L returning id::text', q)) like '42501:%'
    and pg_temp.x(c_a1, format('delete from public.plus_quotes where id = %L returning id::text', q)) like '42501:%');
  perform pg_temp.t('A8 the multi-organization user c1 (Admin in A, Driver in B) can write in A but not in B',
    pg_temp.cq('20000000-0000-0000-0000-0000000000c1', c_a, o2, 'q-multi-0001') like 'ok:%'
    and pg_temp.cq('20000000-0000-0000-0000-0000000000c1', c_b, ob, 'q-multi-0002') like 'ZW002:%');
  perform pg_temp.set_state(c_a, 'expired');
  perform pg_temp.t('A9 Plus expired (read-only): the Admin can still list / read; every write -> ZW001',
    pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_quotes(%L, %L, null)', c_a, o)) like 'ok:%'
    and pg_temp.cq(c_a1, c_a, o, 'q-exp-00001') like 'ZW001:%' and pg_temp.send(c_a1, c_a, q) like 'ZW001:%');
  perform pg_temp.set_state(c_a, 'locked');
  perform pg_temp.t('A10 Plus locked: no read (ZW002) and no write (ZW002)',
    pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_quotes(%L, %L, null)', c_a, o)) like 'ZW002:%'
    and pg_temp.cq(c_a1, c_a, o, 'q-lock-00001') like 'ZW002:%');
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.t('A11 list: exactly one filter (opportunity XOR contact) else ZW006; a contact filter returns its quotes across opportunities',
    pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_quotes(%L, null, null)', c_a)) like 'ZW006:%'
    and pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_quotes(%L, %L, %L)', c_a, o, k)) like 'ZW006:%'
    and pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_quotes(%L, null, %L)', c_a, k))
        = 'ok:' || (select count(*) from public.plus_quotes q0 join public.plus_opportunities o0 on o0.id = q0.opportunity_id where o0.primary_contact_id = k)
    and pg_temp.x(c_a1, format('select count(*)::text from public.plus_list_quotes(%L, %L, null)', c_a, ob)) = 'ok:0');

  -- ===================================================================== U. Draft editing
  v := pg_temp.upd(c_a1, c_a, q2, 5000, 500);
  perform pg_temp.t('U1 a draft is edited; the total is recomputed by the server (5000 + 2550 - 500 = 7050)', v = 'ok:true,7050' and (select total_cents from public.plus_quotes where id = q2) = 7050, v);
  v_a := (select count(*) from public.audit_events where entity_id = q2 and action = 'plus_quote_draft_updated');
  v := pg_temp.upd(c_a1, c_a, q2, 5000, 500);
  perform pg_temp.t('U2 an identical save -> changed=false and no audit row', v = 'ok:false,7050'
    and (select count(*) from public.audit_events where entity_id = q2 and action = 'plus_quote_draft_updated') = v_a, v);
  perform pg_temp.t('U3 a stale version -> ZW003; nothing changed', pg_temp.upd(c_a1, c_a, q2, 6000, 0, now() - interval '1 minute') like 'ZW003:%'
    and (select base_cents from public.plus_quotes where id = q2) = 5000);
  perform pg_temp.t('U4 an edit with an invalid snapshot -> ZW006 (discount over subtotal)', pg_temp.upd(c_a1, c_a, q2, 100, 3000) like 'ZW006:%');

  -- ===================================================================== L. Lifecycle and opportunity stage
  v_n := (select count(*) from public.plus_activities where opportunity_id = o and activity_type = 'stage_changed');
  v := pg_temp.send(c_a1, c_a, q);
  perform pg_temp.t('L1 Mark sent: status sent, sent_at / sent_by recorded; the qualified opportunity moves to quote_sent with ONE stage_changed row',
    v = 'ok:sent,true,quote_sent' and (select sent_at is not null and sent_by = c_a1 from public.plus_quotes where id = q)
    and pg_temp.stage(o) = 'quote_sent'
    and (select count(*) from public.plus_activities where opportunity_id = o and activity_type = 'stage_changed' and from_stage = 'qualified' and to_stage = 'quote_sent') = 1
    and (select count(*) from public.audit_events where entity_id = q and action = 'plus_quote_sent') = 1, v);
  v := pg_temp.send(c_a1, c_a, q);
  perform pg_temp.t('L2 repeated Mark sent -> changed=false; no second stage history', v = 'ok:sent,false,quote_sent'
    and (select count(*) from public.plus_activities where opportunity_id = o and activity_type = 'stage_changed') = v_n + 1, v);
  perform pg_temp.t('L3 no quote activity rows are written in S1 (OD-Q15 open): history is in audit_events',
    not exists (select 1 from public.plus_activities where activity_type in ('quote_sent', 'quote_status_changed')));
  begin
    update public.plus_quotes set base_cents = base_cents + 100, total_cents = total_cents + 100 where id = q;
    v := 'no error';
  exception when others then v := sqlstate || ':' || sqlerrm;
  end;
  perform pg_temp.t('L4 a SENT quote''s prices cannot change: the draft RPC refuses (ZW004 quote_not_draft); a direct owner edit is blocked by the guard (ZW004 quote_immutable)',
    pg_temp.upd(c_a1, c_a, q, 1, 0) like 'ZW004:quote_not_draft' and v = 'ZW004:quote_immutable', v);
  v := pg_temp.respond(c_a1, c_a, q, 'accepted');
  perform pg_temp.t('L5 Record accepted: status accepted, responded_at / by; quote_sent opportunity -> quote_accepted; never converted',
    v = 'ok:accepted,true,quote_accepted' and pg_temp.stage(o) = 'quote_accepted'
    and (select responded_by = c_a1 from public.plus_quotes where id = q)
    and (select count(*) from public.audit_events where entity_id = q and action = 'plus_quote_accepted') = 1, v);
  perform pg_temp.t('L6 the same response again -> changed=false; the opposite response -> ZW004',
    pg_temp.respond(c_a1, c_a, q, 'accepted') = 'ok:accepted,false,quote_accepted' and pg_temp.respond(c_a1, c_a, q, 'declined') like 'ZW004:illegal_transition');
  begin
    update public.plus_quotes set discount_cents = 0, total_cents = total_cents + 1250 where id = q;
    v := 'no error';
  exception when others then v := sqlstate || ':' || sqlerrm;
  end;
  perform pg_temp.t('L7 an ACCEPTED quote''s snapshot cannot change (guard) and it cannot be withdrawn or revised',
    v = 'ZW004:quote_immutable' and pg_temp.withdraw(c_a1, c_a, q, 'Fictional reason') like 'ZW004:illegal_transition'
    and pg_temp.revise(c_a1, c_a, q, 'q-rev-acc-01') like 'ZW004:illegal_transition', v);
  begin
    update public.plus_quotes set status = 'draft', sent_at = null, sent_by = null, responded_at = null, responded_by = null where id = q;
    v := 'no error';
  exception when others then v := sqlstate || ':' || sqlerrm;
  end;
  perform pg_temp.t('L8 unsupported transitions: responding to a draft -> ZW004; accepted -> draft (direct) -> blocked by the guard',
    pg_temp.respond(c_a1, c_a, q2, 'accepted') like 'ZW004:illegal_transition' and v like 'ZW004:%', v);
  perform pg_temp.t('L9 an invalid response value -> ZW006', pg_temp.respond(c_a1, c_a, q2, 'maybe') like 'ZW006:%');

  -- declined: no stage change
  o3 := pg_temp.opp(c_a, k, 'Q declined path', c_a1, 'contacted');
  q3 := pg_temp.qid(pg_temp.cq(c_a1, c_a, o3, 'q-decl-00001'));
  perform pg_temp.send(c_a1, c_a, q3);
  v := pg_temp.respond(c_a1, c_a, q3, 'declined');
  perform pg_temp.t('L10 Record declined: status declined; the opportunity stays quote_sent (never Lost automatically)',
    v = 'ok:declined,true,quote_sent' and pg_temp.stage(o3) = 'quote_sent', v);

  -- no regression: sending on an opportunity already at quote_accepted keeps quote_accepted
  o_acc := pg_temp.opp(c_a, k, 'Q already accepted stage', c_a1, 'quote_accepted');
  r := pg_temp.qid(pg_temp.cq(c_a1, c_a, o_acc, 'q-noreg-0001'));
  v := pg_temp.send(c_a1, c_a, r);
  perform pg_temp.t('L11 Mark sent never regresses a later stage (quote_accepted stays) and writes no stage history there',
    v = 'ok:sent,true,quote_accepted' and pg_temp.stage(o_acc) = 'quote_accepted'
    and not exists (select 1 from public.plus_activities where opportunity_id = o_acc and activity_type = 'stage_changed'), v);
  v := pg_temp.respond(c_a1, c_a, r, 'accepted');
  perform pg_temp.t('L12 Record accepted on a quote_accepted opportunity -> no stage change, no history', v = 'ok:accepted,true,quote_accepted'
    and not exists (select 1 from public.plus_activities where opportunity_id = o_acc and activity_type = 'stage_changed'), v);

  -- expiry (derived)
  o4 := pg_temp.opp(c_a, k, 'Q expiry path', c_a1, 'new_inquiry');
  q3 := pg_temp.qid(pg_temp.cq(c_a1, c_a, o4, 'q-expire-001'));
  perform pg_temp.send(c_a1, c_a, q3);
  alter table public.plus_quotes disable trigger plus_quotes_guard;   -- test-only: simulate time passing (rolled back)
  update public.plus_quotes set valid_until = v_today_a - 1 where id = q3;
  alter table public.plus_quotes enable trigger plus_quotes_guard;
  perform pg_temp.t('L13 expiry is DERIVED: a sent quote past valid_until (organization-local today) reads is_expired=true; the stored status stays sent',
    pg_temp.x(c_a1, format('select is_expired::text || '','' || status from public.plus_get_quote(%L, %L)', c_a, q3)) = 'ok:true,sent'
    and pg_temp.x(c_a1, format('select string_agg(is_expired::text, '','') from public.plus_list_quotes(%L, %L, null)', c_a, o4)) = 'ok:true');
  perform pg_temp.t('L14 an expired quote: Record response -> ZW004 quote_expired; Revise is allowed',
    pg_temp.respond(c_a1, c_a, q3, 'accepted') like 'ZW004:quote_expired' and pg_temp.revise(c_a1, c_a, q3, 'q-expire-rv1') like 'ok:%,true,%');
  -- a draft whose validity has passed cannot be marked sent (a direct owner update of a DRAFT is allowed by the guard)
  r2 := pg_temp.qid(pg_temp.cq(c_a1, c_a, o4, 'q-expire-002'));
  update public.plus_quotes set valid_until = v_today_a - 1 where id = r2;
  perform pg_temp.t('L15 a draft past its validity cannot be marked sent (ZW004 quote_expired); the stage is untouched',
    pg_temp.send(c_a1, c_a, r2) like 'ZW004:quote_expired' and pg_temp.st(r2) = 'draft');

  -- revisions
  o5 := pg_temp.opp(c_a, k, 'Q revision path', c_a1, 'qualified');
  q3 := pg_temp.qid(pg_temp.cq(c_a1, c_a, o5, 'q-revbase-01', p_base => 20000, p_mileage => 1000, p_discount => 500));
  perform pg_temp.send(c_a1, c_a, q3);
  v := pg_temp.revise(c_a1, c_a, q3, 'q-revise-001');
  r := pg_temp.qid(v);
  perform pg_temp.t('L16 Revise a sent quote -> a NEW draft (new number) copying the snapshot, linked by supersedes; the original is unchanged (still sent)',
    v like 'ok:%,true,%' and r <> q3 and pg_temp.st(r) = 'draft' and pg_temp.st(q3) = 'sent'
    and (select supersedes_quote_id = q3 and total_cents = 20500 and quote_number > (select quote_number from public.plus_quotes where id = q3) from public.plus_quotes where id = r), v);
  perform pg_temp.t('L17 the same revise key -> the same revision (changed=false); a second LIVE revision of the same quote -> ZW004 revision_exists',
    pg_temp.revise(c_a1, c_a, q3, 'q-revise-001') = 'ok:' || r || ',false,' || (select quote_number from public.plus_quotes where id = r)
    and pg_temp.revise(c_a1, c_a, q3, 'q-revise-002') like 'ZW004:revision_exists');
  perform pg_temp.upd(c_a1, c_a, r, 18000, 0);
  v := pg_temp.send(c_a1, c_a, r);
  perform pg_temp.t('L18 marking the revision sent SUPERSEDES the original atomically; both histories audited; the original snapshot is intact',
    v like 'ok:sent,true,%' and pg_temp.st(q3) = 'superseded' and pg_temp.st(r) = 'sent'
    and (select total_cents from public.plus_quotes where id = q3) = 20500
    and (select count(*) from public.audit_events where entity_id = q3 and action = 'plus_quote_superseded') = 1, v);
  perform pg_temp.t('L19 a superseded quote is final (no response, no revise)',
    pg_temp.respond(c_a1, c_a, q3, 'accepted') like 'ZW004:%' and pg_temp.revise(c_a1, c_a, q3, 'q-revise-003') like 'ZW004:%');
  -- revision base no longer current: revise, then the original is accepted, then the revision cannot be sent
  q3 := pg_temp.qid(pg_temp.cq(c_a1, c_a, o5, 'q-revbase-02'));
  perform pg_temp.send(c_a1, c_a, q3);
  r := pg_temp.qid(pg_temp.revise(c_a1, c_a, q3, 'q-revise-004'));
  perform pg_temp.respond(c_a1, c_a, q3, 'accepted');
  perform pg_temp.t('L20 revision vs acceptance: once the original is accepted, its revision cannot be marked sent (ZW004 revision_base_not_current); nothing superseded',
    pg_temp.send(c_a1, c_a, r) like 'ZW004:revision_base_not_current' and pg_temp.st(q3) = 'accepted' and pg_temp.st(r) = 'draft');
  perform pg_temp.t('L21 the revision link can never cross organizations or opportunities (composite FK)',
    exists (select 1 from pg_constraint where conname = 'plus_quotes_supersedes_fkey' and pg_get_constraintdef(oid) ~ 'supersedes_quote_id, organization_id, opportunity_id'));
  -- withdraw
  v := pg_temp.withdraw(c_a1, c_a, r, null);
  v2 := pg_temp.withdraw(c_a1, c_a, r, null);
  perform pg_temp.t('L22 withdraw a draft without a reason -> withdrawn (kept); again -> changed=false',
    v = 'ok:withdrawn,true' and v2 = 'ok:withdrawn,false'
    and exists (select 1 from public.plus_quotes where id = r));
  q3 := pg_temp.qid(pg_temp.cq(c_a1, c_a, o5, 'q-withdr-001'));
  perform pg_temp.send(c_a1, c_a, q3);
  v := pg_temp.withdraw(c_a1, c_a, q3, '  ');
  v2 := pg_temp.withdraw(c_a1, c_a, q3, 'Fictional: customer changed plans');
  perform pg_temp.t('L23 withdraw a SENT quote: no reason -> ZW006; with a reason -> withdrawn, reason stored + audited; no stage change',
    v like 'ZW006:%' and v2 = 'ok:withdrawn,true'
    and (select withdrawn_reason from public.plus_quotes where id = q3) = 'Fictional: customer changed plans'
    and (select reason from public.audit_events where entity_id = q3 and action = 'plus_quote_withdrawn') = 'Fictional: customer changed plans', v || ' | ' || v2 || ' | ' || pg_temp.st(q3));
  q3 := (select id from public.plus_quotes where idempotency_key = 'q-expire-001');
  r2 := (select id from public.plus_quotes where idempotency_key = 'q-expire-rv1');
  v := pg_temp.revise(c_a1, c_a, q3, 'q-expire-rv3');
  v2 := pg_temp.withdraw(c_a1, c_a, r2, null);
  perform pg_temp.t('L24 while a live revision exists another is refused; after withdrawing it, a new revision of the same quote is allowed',
    v like 'ZW004:revision_exists' and v2 = 'ok:withdrawn,true' and pg_temp.revise(c_a1, c_a, q3, 'q-expire-rv2') like 'ok:%,true,%', v || ' | ' || v2);
  v := pg_temp.cq(c_a1, c_a, o5, 'q-parallel-1');
  v2 := pg_temp.cq(c_a1, c_a, o5, 'q-parallel-2');
  perform pg_temp.send(c_a1, c_a, pg_temp.qid(v));
  perform pg_temp.send(c_a1, c_a, pg_temp.qid(v2));
  perform pg_temp.t('L25 OD-Q12 not encoded: two independent quotes may both be sent and coexist as sent on one opportunity',
    v like 'ok:%' and v2 like 'ok:%' and pg_temp.st(pg_temp.qid(v)) = 'sent' and pg_temp.st(pg_temp.qid(v2)) = 'sent', v || ' | ' || v2);

  -- closed / archived source opportunities
  o_lost := pg_temp.opp(c_a, k, 'Q lost opportunity', c_a1);
  q3 := pg_temp.qid(pg_temp.cq(c_a1, c_a, o_lost, 'q-lost-00001'));
  update public.plus_opportunities set stage = 'lost', lost_reason = 'price', closed_at = now() where id = o_lost;
  perform pg_temp.t('L26 a LOST opportunity: every quote write -> ZW004 opportunity_closed; its quotes remain readable; its stage untouched',
    pg_temp.cq(c_a1, c_a, o_lost, 'q-lost-00002') like 'ZW004:opportunity_closed' and pg_temp.send(c_a1, c_a, q3) like 'ZW004:opportunity_closed'
    and pg_temp.withdraw(c_a1, c_a, q3, null) like 'ZW004:opportunity_closed'
    and pg_temp.x(c_a1, format('select status from public.plus_get_quote(%L, %L)', c_a, q3)) = 'ok:draft' and pg_temp.stage(o_lost) = 'lost');
  o_conv := pg_temp.opp(c_a, k, 'Q converted opportunity', c_a1);
  update public.plus_opportunities set stage = 'converted', converted_at = now(), closed_at = now() where id = o_conv;  -- the deferred conversion guard never fires: rolled back
  perform pg_temp.t('L27 a CONVERTED opportunity: quote create -> ZW004 opportunity_closed; stage stays converted',
    pg_temp.cq(c_a1, c_a, o_conv, 'q-conv-00001') like 'ZW004:opportunity_closed' and pg_temp.stage(o_conv) = 'converted');
  k_arch := pg_temp.contact(c_a, 'Quote Archived Fictional', c_a1);
  o6 := pg_temp.opp(c_a, k_arch, 'Q archived contact', c_a1);
  update public.plus_contacts set status = 'archived' where id = k_arch;
  perform pg_temp.t('L28 an archived primary contact: no new quote (ZW006)', pg_temp.cq(c_a1, c_a, o6, 'q-arch-00001') like 'ZW006:%');

  -- ===================================================================== X. Side effects
  perform pg_temp.t('X1 no Core Request, request event, Trip, Passenger, assignment, recurring arrangement, notification, task or attribution was created by any quote action',
    pg_temp.side() = (select val from t_ctx where name = 'side0'), (select val from t_ctx where name = 'side0') || ' -> ' || pg_temp.side());
  perform pg_temp.t('X2 the opportunity''s estimated value and reported payment status are never touched (OD-Q13)',
    (select estimated_value_cents || '/' || payment_reported_status from public.plus_opportunities where id = o) is not distinct from (select val from t_ctx where name = 'opp_money'));
  perform pg_temp.t('X3 quote actions never set a stage outside quote_sent / quote_accepted: no stage_changed row to converted or lost was written by quotes',
    not exists (select 1 from public.plus_activities where activity_type = 'stage_changed' and to_stage in ('converted', 'lost') and organization_id = c_a and recorded_at = now()));
  perform pg_temp.t('X4 every quote mutation is audited with entity plus_quote; no audit row carries a price',
    (select count(*) from public.audit_events where entity_type = 'plus_quote') > 0
    and not exists (select 1 from public.audit_events where entity_type = 'plus_quote' and (after_data::text ~ '_cents' or after_data::text ~ 'total')));
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as summary from t_results;
rollback;
