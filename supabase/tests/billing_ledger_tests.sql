-- NP-FIN-P1 -- Core billing ledger re-foundation tests. ROLLBACK-ONLY (one transaction, rolled back at the end).
--   docker exec -i supabase_db_NemrynS1Iso psql -U postgres -d postgres -f - < supabase/tests/billing_ledger_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261029100000_core_billing_ledger_foundation.sql + 20261029110000_core_billing_ledger_rpcs.sql (ZD-266..ZD-280;
-- docs/reports/NP-FIN-P1-security-and-test-plan.md: T-A access, T-X cross-tenant, T-C core, T-I invariants, T-R refunds /
-- reversals, T-M immutability, T-D duplicates / idempotency, T-V assurance, T-P permission catalogue / payer identity,
-- T-Y privacy, T-W BILL-P1 compatibility, T-S reads). Fictional seed fixtures only: Org A admin a1, dispatcher a2,
-- driver a3; Org B admin b1. Trips are inserted directly as completed (fixtures); invoices, receipts, allocations,
-- refunds and reversals go through the RPCs as the signed-in role. Inside one transaction now() is constant.
\set ON_ERROR_STOP on
\pset pager off
begin;
-- FU-3: dates in this suite are Org A's LOCAL date, as the billing RPCs compute them (organizations.timezone). Pinning
-- this test transaction's timezone to Org A's own makes current_date correct at every hour (the suite used to fail
-- between 00:00 and 04:00 UTC, when the UTC date is already ahead of the organization's). Production code unchanged.
select set_config('timezone', (select timezone from public.organizations where id = '10000000-0000-0000-0000-0000000000a1'), true);
create temp table k_results (n serial, name text, ok boolean, detail text);
create temp table k (name text primary key, v text);
grant select on k to authenticated, anon;
create function pg_temp.x(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute p_stmt into v; exception when others then reset role; return 'ERR:' || sqlstate || ':' || sqlerrm; end;
  reset role;
  return v;
end;
$$;
create function pg_temp.code(p text) returns text language sql as $$
  select case when p like 'ERR:%' then split_part(p, ':', 2) else 'ok' end;
$$;
create function pg_temp.msg(p text) returns text language sql as $$
  select case when p like 'ERR:%' then split_part(p, ':', 3) else p end;
$$;
create function pg_temp.t(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into k_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;
create function pg_temp.kv(p text) returns text language sql as $$ select v from k where name = p; $$;
-- FU-3: an organization's own local date (Org B is in another timezone than the pinned Org A session)
create function pg_temp.org_today(p_org uuid) returns date language sql as $$
  select (now() at time zone o.timezone)::date from public.organizations o where o.id = p_org;
$$;
create function pg_temp.owner_try(p_stmt text) returns text language plpgsql as $$
begin execute p_stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end;
$$;

insert into k values
  ('A', '10000000-0000-0000-0000-0000000000a1'), ('B', '10000000-0000-0000-0000-0000000000b1'),
  ('a1', '20000000-0000-0000-0000-0000000000a1'), ('a2', '20000000-0000-0000-0000-0000000000a2'),
  ('a3', '20000000-0000-0000-0000-0000000000a3'), ('b1', '20000000-0000-0000-0000-0000000000b1'),
  ('P1', '40000000-0000-0000-0000-0000000000a1'), ('PB', '40000000-0000-0000-0000-0000000000b1');
create function pg_temp.a1(p_stmt text) returns text language sql as $$ select pg_temp.x('authenticated', pg_temp.kv('a1')::uuid, p_stmt); $$;

-- fixtures: a second Org A passenger; completed trips are created per invoice
insert into public.passengers (id, organization_id, display_name, phone) values
  ('40000000-0000-0000-0000-00000000f1a2', pg_temp.kv('A')::uuid, 'Fictional Ledger Passenger Two', '(404) 555-0112');
insert into k values ('P2', '40000000-0000-0000-0000-00000000f1a2');
create function pg_temp.trip(p_label text, p_org uuid, p_pass uuid)
returns uuid language sql as $$
  insert into public.trips (organization_id, passenger_id, state, pickup_description, destination_description, scheduled_pickup_at, completed_at)
  values (p_org, p_pass, 'completed', p_label || ' pickup', p_label || ' destination', now() - interval '1 day', now() - interval '20 hours')
  returning id;
$$;
-- an ISSUED invoice of p_cents for one fresh completed trip, billed to the passenger (or to "other" with p_name)
create function pg_temp.issued(p_label text, p_pass text, p_kind text, p_name text, p_cents bigint, p_org text default 'A', p_uid text default 'a1')
returns uuid language plpgsql as $$
declare
  v_org uuid := pg_temp.kv(p_org)::uuid;
  v_u uuid := pg_temp.kv(p_uid)::uuid;
  v_trip uuid := pg_temp.trip(p_label, v_org, pg_temp.kv(p_pass)::uuid);
  v_inv text;
  v_r text;
begin
  v_inv := pg_temp.x('authenticated', v_u, format('select (r).invoice_id::text from (select public.billing_create_invoice_draft(%L, %L::uuid[], %L, %L, %L, null, %L) r) s',
    v_org, '{' || v_trip || '}', p_kind, case when p_kind = 'passenger' then pg_temp.kv(p_pass) end, case when p_kind = 'other' then p_name end, 'led-draft-' || p_label));
  v_r := pg_temp.x('authenticated', v_u, format('select (public.billing_update_invoice_draft(%L, %L, %s, %L, null, null, null, %L::jsonb, 0, null)).status',
    v_org, v_inv, (select version from public.billing_invoices where id = v_inv::uuid), coalesce(p_name, 'Payer'),
    jsonb_build_array(jsonb_build_object('description', 'Fare', 'quantity', '1', 'unit_cents', p_cents, 'trip_id', v_trip, 'source', 'trip'))));
  v_r := pg_temp.x('authenticated', v_u, format('select (public.billing_issue_invoice(%L, %L, %s, %L::date, %L::date + 15)).status',
    v_org, v_inv, (select version from public.billing_invoices where id = v_inv::uuid), pg_temp.org_today(v_org), pg_temp.org_today(v_org)));
  if v_r <> 'issued' then raise exception 'fixture issue failed: %', v_r; end if;
  return v_inv::uuid;
end;
$$;
create function pg_temp.al(p_inv text, p_cents bigint) returns jsonb language sql as $$
  select jsonb_build_object('invoice_id', p_inv, 'amount_cents', p_cents);
$$;
-- record a receipt: returns receipt_id|number|unallocated|changed (or ERR:...)
create function pg_temp.rr(p_src text, p_kind text, p_payer text, p_name text, p_gross bigint, p_alloc jsonb, p_key text,
  p_ref text default null, p_reason text default null, p_confirm boolean default false, p_method text default 'check',
  p_doc boolean default false, p_fee bigint default 0, p_org text default 'A', p_uid text default 'a1')
returns text language sql as $$
  select pg_temp.x('authenticated', pg_temp.kv(p_uid)::uuid, format(
    'select (r).receipt_id::text || ''|'' || (r).receipt_number || ''|'' || (r).unallocated_cents || ''|'' || (r).changed from (select public.billing_record_receipt(%L, %L, %L, %L, %L, %s, %s, %L::date, %L, null, %L, null, %L::boolean, %L::jsonb, %L, %L::boolean, %L) r) s',
    pg_temp.kv(p_org), p_src, p_kind, p_payer, p_name, p_gross, p_fee, pg_temp.org_today(pg_temp.kv(p_org)::uuid), p_method, p_ref, p_doc, p_alloc, p_reason, p_confirm, p_key));
$$;
create function pg_temp.rid(p text) returns text language sql as $$ select split_part(p, '|', 1); $$;
create function pg_temp.paid(p_inv text) returns bigint language sql as $$ select public._billing_invoice_net(p_inv::uuid); $$;
create function pg_temp.unalloc(p_rcpt text) returns bigint language sql as $$ select public._billing_receipt_unallocated(p_rcpt::uuid); $$;
create function pg_temp.audits(p_action text, p_entity text) returns bigint language sql as $$ select count(*) from public.audit_events where action = p_action and entity_id = p_entity::uuid; $$;

-- invoices (Org A): I1 6000 + I2 4000 + I3 3000 + I4 2500 + I5 2000 for P1; Q1 5000 for P2; O1 / O2 for typed "other" payers
insert into k values
  ('I1', pg_temp.issued('L-I1', 'P1', 'passenger', null, 6000)::text),
  ('I2', pg_temp.issued('L-I2', 'P1', 'passenger', null, 4000)::text),
  ('I3', pg_temp.issued('L-I3', 'P1', 'passenger', null, 3000)::text),
  ('I4', pg_temp.issued('L-I4', 'P1', 'passenger', null, 2500)::text),
  ('I5', pg_temp.issued('L-I5', 'P1', 'passenger', null, 2000)::text),
  ('Q1', pg_temp.issued('L-Q1', 'P2', 'passenger', null, 5000)::text),
  ('O1', pg_temp.issued('L-O1', 'P1', 'other', 'Fictional Neighbour Payer', 1500)::text),
  ('O2', pg_temp.issued('L-O2', 'P1', 'other', 'Fictional Neighbour Payer', 1500)::text),
  ('IB', pg_temp.issued('L-IB', 'PB', 'passenger', null, 7000, 'B', 'b1')::text);
-- a draft (never issued) for "allocation to a draft" checks
insert into k values ('DR', pg_temp.a1(format('select (r).invoice_id::text from (select public.billing_create_invoice_draft(%L, %L::uuid[], ''passenger'', %L, null, null, ''led-draft-DR'') r) s',
  pg_temp.kv('A'), '{' || pg_temp.trip('L-DR', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid) || '}', pg_temp.kv('P1'))));

-- ================================================================= T-A access (deny by default)
select pg_temp.t('A1 anon cannot execute ledger RPCs (no grant, 42501)',
  pg_temp.code(pg_temp.x('anon', null, format('select (public.billing_list_receipts(%L, null, null, 10, 0)).receipt_number::text', pg_temp.kv('A')))) = '42501'
  and pg_temp.code(pg_temp.x('anon', null, format('select (public.billing_record_receipt(%L, %L, null, null, null, 100, 0, current_date, ''cash'', null, null, null, false, ''[]'', null, false, ''anon-key-0001'')).changed::text', pg_temp.kv('A'), pg_temp.kv('I1')))) = '42501');
select pg_temp.t('A2 dispatcher and driver of Org A are refused on every ledger RPC (ZW002, no existence oracle)',
  pg_temp.code(pg_temp.rr(pg_temp.kv('I1'), null, null, null, 100, '[]', 'disp-key-0001', p_uid => 'a2')) = 'ZW002'
  and pg_temp.code(pg_temp.rr(pg_temp.kv('I1'), null, null, null, 100, '[]', 'drv-key-0001', p_uid => 'a3')) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, format('select count(*)::text from public.billing_list_receipts(%L, null, null, 10, 0)', pg_temp.kv('A')))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a3')::uuid, format('select public.billing_get_invoice_ledger(%L, %L)::text', pg_temp.kv('A'), pg_temp.kv('I1')))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, format('select count(*)::text from public.billing_ledger_summary(%L)', pg_temp.kv('A')))) = 'ZW002');
select pg_temp.t('A3 Org B admin calling with Org A is refused (ZW002)',
  pg_temp.code(pg_temp.rr(pg_temp.kv('I1'), null, null, null, 100, '[]', 'orgb-key-0001', p_uid => 'b1')) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select count(*)::text from public.billing_list_receipts(%L, null, null, 10, 0)', pg_temp.kv('A')))) = 'ZW002');
select pg_temp.t('A4 unauthenticated (no sub) is refused (ZW001)',
  pg_temp.code(pg_temp.x('authenticated', null, format('select count(*)::text from public.billing_list_receipts(%L, null, null, 10, 0)', pg_temp.kv('A')))) = 'ZW001');
select pg_temp.t('A5 no direct writes for authenticated on any ledger table (42501)',
  pg_temp.code(pg_temp.a1(format('insert into public.billing_receipts (organization_id, receipt_number, payer_kind, payer_name, gross_cents, received_on, method, idempotency_key, recorded_by) values (%L, 999, ''other'', ''x'', 100, current_date, ''cash'', ''direct-ins-0001'', %L) returning id::text', pg_temp.kv('A'), pg_temp.kv('a1')))) = '42501'
  and pg_temp.code(pg_temp.a1('insert into public.billing_allocations (organization_id, receipt_id, invoice_id, kind, amount_cents, request_key, request_seq, created_by) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), ''apply'', 1, ''direct-ins-0002'', 1, gen_random_uuid()) returning id::text')) = '42501'
  and pg_temp.code(pg_temp.a1('insert into public.billing_refunds (organization_id, receipt_id, refund_seq, amount_cents, refunded_on, method, reason, idempotency_key, recorded_by) values (gen_random_uuid(), gen_random_uuid(), 1, 1, current_date, ''cash'', ''xyz'', ''direct-ins-0003'', gen_random_uuid()) returning id::text')) = '42501'
  and pg_temp.code(pg_temp.a1('insert into public.billing_assurance_events (organization_id, receipt_id, kind, source, actor_id) values (gen_random_uuid(), gen_random_uuid(), ''evidence_document_held'', ''staff'', gen_random_uuid()) returning id::text')) = '42501'
  and pg_temp.code(pg_temp.a1('update public.billing_receipt_counters set next_number = 1 returning organization_id::text')) = '42501');
select pg_temp.t('A6 internal ledger functions are not executable by authenticated (42501)',
  pg_temp.code(pg_temp.a1(format('select public._billing_receipt_unallocated(%L)::text', gen_random_uuid()))) = '42501'
  and pg_temp.code(pg_temp.a1(format('select (public._billing_authorize(%L, ''view''))::text', pg_temp.kv('A')))) = '42501'
  and pg_temp.code(pg_temp.a1('select public._billing_action_roles(''view'')::text')) = '42501');
select pg_temp.t('A7 billing_can: Organization Admin yes; dispatcher / driver / other tenant / unknown action no',
  pg_temp.a1(format('select public.billing_can(%L, ''refund'')::text', pg_temp.kv('A'))) = 'true'
  and pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, format('select public.billing_can(%L, ''view'')::text', pg_temp.kv('A'))) = 'false'
  and pg_temp.x('authenticated', pg_temp.kv('a3')::uuid, format('select public.billing_can(%L, ''view'')::text', pg_temp.kv('A'))) = 'false'
  and pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select public.billing_can(%L, ''view'')::text', pg_temp.kv('A'))) = 'false'
  and pg_temp.a1(format('select public.billing_can(%L, ''launch_rockets'')::text', pg_temp.kv('A'))) = 'false');

-- ================================================================= T-C core flows
-- C1: ONE receipt pays two invoices in full and leaves payer credit
insert into k values ('R1', pg_temp.rr(null, 'passenger', pg_temp.kv('P1'), null, 15000,
  jsonb_build_array(pg_temp.al(pg_temp.kv('I1'), 6000), pg_temp.al(pg_temp.kv('I2'), 4000)), 'led-rcpt-0001', 'CHK-1001'));
select pg_temp.t('C1 one receipt allocated to TWO invoices (both paid) and the excess 5000 stays as payer credit; first receipt number = 1',
  split_part(pg_temp.kv('R1'), '|', 2) = '1' and split_part(pg_temp.kv('R1'), '|', 3) = '5000'
  and pg_temp.paid(pg_temp.kv('I1')) = 6000 and pg_temp.paid(pg_temp.kv('I2')) = 4000
  and pg_temp.a1(format('select payment_state from public.billing_get_invoice(%L, %L)', pg_temp.kv('A'), pg_temp.kv('I1'))) = 'paid'
  and (select count(*) from public.billing_allocations where receipt_id = pg_temp.rid(pg_temp.kv('R1'))::uuid) = 2, pg_temp.kv('R1'));
insert into k values ('R2', pg_temp.rr(null, 'passenger', pg_temp.kv('P1'), null, 900, '[]', 'led-rcpt-0002'));
insert into k values ('RB', pg_temp.rr(null, 'passenger', pg_temp.kv('PB'), null, 7000, jsonb_build_array(pg_temp.al(pg_temp.kv('IB'), 7000)), 'led-rcpt-b001', p_org => 'B', p_uid => 'b1'));
select pg_temp.t('C2 receipt numbers are sequential per organization (Org A 2; Org B starts at 1); a receipt may have no allocation (pure credit)',
  split_part(pg_temp.kv('R2'), '|', 2) = '2' and split_part(pg_temp.kv('R2'), '|', 3) = '900'
  and split_part(pg_temp.kv('RB'), '|', 2) = '1', pg_temp.kv('R2') || ' / ' || pg_temp.kv('RB'));
insert into k values ('AL3', pg_temp.a1(format('select (r).unallocated_cents::text from (select public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-0001'') r) s',
  pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), jsonb_build_array(pg_temp.al(pg_temp.kv('I3'), 2000)))));
select pg_temp.t('C3 payer credit applied to a third invoice of the SAME payer: partially paid, credit 5000 -> 3000',
  pg_temp.kv('AL3') = '3000' and pg_temp.paid(pg_temp.kv('I3')) = 2000
  and pg_temp.a1(format('select payment_state from public.billing_get_invoice(%L, %L)', pg_temp.kv('A'), pg_temp.kv('I3'))) = 'partially_paid', pg_temp.kv('AL3'));
select pg_temp.t('C4 credit sources for an invoice list only the SAME payer''s receipts with credit, oldest first',
  pg_temp.a1(format('select string_agg(receipt_number::text || '':'' || unallocated_cents, '','' order by received_on, receipt_number) from public.billing_invoice_credit_sources(%L, %L)', pg_temp.kv('A'), pg_temp.kv('I4'))) = '1:3000,2:900'
  and pg_temp.a1(format('select count(*)::text from public.billing_invoice_credit_sources(%L, %L)', pg_temp.kv('A'), pg_temp.kv('Q1'))) = '0');
select pg_temp.t('C5 billing_list_open_invoices flags same_payer by identity and puts them first; issued with balance only',
  pg_temp.a1(format('select string_agg(same_payer::text, '','' order by ord) from (select same_payer, row_number() over () ord from public.billing_list_open_invoices(%L, %L, null, null)) s', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')))) like 'true,true,true%false%'
  and pg_temp.a1(format('select count(*)::text from public.billing_list_open_invoices(%L, %L, null, null) where invoice_id in (%L, %L, %L)', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), pg_temp.kv('I1'), pg_temp.kv('I2'), pg_temp.kv('DR'))) = '0');

-- ================================================================= T-I invariants
select pg_temp.t('I1 allocation above the invoice balance refused (ZW006 amount_exceeds_balance)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-i1'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), jsonb_build_array(pg_temp.al(pg_temp.kv('I3'), 1001))))) = 'amount_exceeds_balance');
select pg_temp.t('I2 allocations above the receipt''s unallocated funds refused (ZW006 amount_exceeds_receipt), nothing applied',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-i2'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')),
    jsonb_build_array(pg_temp.al(pg_temp.kv('I4'), 500), pg_temp.al(pg_temp.kv('I5'), 500))))) = 'amount_exceeds_receipt'
  and pg_temp.paid(pg_temp.kv('I4')) = 0 and pg_temp.paid(pg_temp.kv('I5')) = 0 and pg_temp.unalloc(pg_temp.rid(pg_temp.kv('R2'))) = 900);
select pg_temp.t('I3 allocation to a draft invoice refused (ZW004 invoice_not_open)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-i3'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')), jsonb_build_array(pg_temp.al(pg_temp.kv('DR'), 100))))) = 'invoice_not_open');
select pg_temp.t('I4 malformed allocations refused: duplicate invoice, zero / negative amount, non-numeric amount, non-object (ZW006 invalid_allocations)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-i4a'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')), jsonb_build_array(pg_temp.al(pg_temp.kv('I4'), 100), pg_temp.al(pg_temp.kv('I4'), 100))))) = 'invalid_allocations'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-i4b'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')), jsonb_build_array(pg_temp.al(pg_temp.kv('I4'), 0))))) = 'invalid_allocations'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-i4c'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')), jsonb_build_array(pg_temp.al(pg_temp.kv('I4'), -5))))) = 'invalid_allocations'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-i4d'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')), jsonb_build_array(jsonb_build_object('invoice_id', pg_temp.kv('I4'), 'amount_cents', 'ten'))))) = 'invalid_allocations'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-i4e'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')), '[1, 2]'))) = 'invalid_allocations');
select pg_temp.t('I5 void refused while money is applied (ZW004 invoice_has_payments)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_void_invoice(%L, %L, %s, ''wrong invoice'')).status', pg_temp.kv('A'), pg_temp.kv('I3'), (select version from public.billing_invoices where id = pg_temp.kv('I3')::uuid)))) = 'invoice_has_payments');
-- unapply I3's 2000 (Admin) -> credit back to 5000 -> void now allowed
insert into k values ('UN3', pg_temp.a1(format('select (r).entry_id::text || ''|'' || (r).unallocated_cents from (select public.billing_unapply_allocation(%L, %L, ''Applied to the wrong invoice (fictional)'', ''led-unap-0001'') r) s',
  pg_temp.kv('A'), (select id from public.billing_allocations where invoice_id = pg_temp.kv('I3')::uuid and kind = 'apply'))));
select pg_temp.t('I6 unapply returns the money to payer credit (3000 -> 5000), the invoice reopens, the apply row is untouched, void is then allowed',
  split_part(pg_temp.kv('UN3'), '|', 2) = '5000' and pg_temp.paid(pg_temp.kv('I3')) = 0
  and (select count(*) from public.billing_allocations where invoice_id = pg_temp.kv('I3')::uuid and kind = 'apply' and amount_cents = 2000) = 1
  and pg_temp.a1(format('select (public.billing_void_invoice(%L, %L, %s, ''wrong invoice'')).status', pg_temp.kv('A'), pg_temp.kv('I3'), (select version from public.billing_invoices where id = pg_temp.kv('I3')::uuid))) = 'void', pg_temp.kv('UN3'));
select pg_temp.t('I7 an allocation can be unapplied once only (ZW004 already_unapplied); an unapply cannot be unapplied (ZW006)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_unapply_allocation(%L, %L, ''again'', ''led-unap-0002'')).changed::text', pg_temp.kv('A'), (select id from public.billing_allocations where invoice_id = pg_temp.kv('I3')::uuid and kind = 'apply')))) in ('already_unapplied', 'invoice_not_open')
  and pg_temp.code(pg_temp.a1(format('select (public.billing_unapply_allocation(%L, %L, ''again'', ''led-unap-0003'')).changed::text', pg_temp.kv('A'), split_part(pg_temp.kv('UN3'), '|', 1)))) = 'ZW006');
select pg_temp.t('I8 allocation to a VOID invoice refused (ZW004 invoice_not_open)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-i8'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), jsonb_build_array(pg_temp.al(pg_temp.kv('I3'), 100))))) = 'invoice_not_open');
select pg_temp.t('I9 BYPASS: a direct owner INSERT that over-allocates is refused by the row guard (ZW006)',
  pg_temp.owner_try(format('insert into public.billing_allocations (organization_id, receipt_id, invoice_id, kind, amount_cents, request_key, request_seq, created_by) values (%L, %L, %L, ''apply'', 999999, ''owner-bypass-0001'', 1, %L)',
    pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), pg_temp.kv('I4'), pg_temp.kv('a1'))) like 'ZW006:amount_exceeds%');
select pg_temp.t('I10 BYPASS: a direct owner UPDATE voiding an invoice that has money applied is caught by the DEFERRED invariant at commit (ZW004)',
  pg_temp.owner_try(format('update public.billing_invoices set status = ''void'', voided_at = now(), voided_by = %L, void_reason = ''bypass attempt'' where id = %L; set constraints billing_invoices_ledger_invariants immediate',
    pg_temp.kv('a1'), pg_temp.kv('I1'))) like 'ZW004:ledger_invariant_violation%'
  and pg_temp.owner_try('set constraints all deferred') = 'ok'
  and (select status from public.billing_invoices where id = pg_temp.kv('I1')::uuid) = 'issued');
select pg_temp.t('I11 BYPASS: a direct owner INSERT of an allocation between two organizations is refused (row guard cross_organization) and structurally impossible (composite FKs on receipt + invoice)',
  pg_temp.owner_try(format('insert into public.billing_allocations (organization_id, receipt_id, invoice_id, kind, amount_cents, request_key, request_seq, created_by) values (%L, %L, %L, ''apply'', 1, ''owner-bypass-0002'', 1, %L)',
    pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), pg_temp.kv('IB'), pg_temp.kv('a1'))) = 'ZW006:cross_organization'
  and (select count(*) from pg_constraint where conrelid = 'public.billing_allocations'::regclass and contype = 'f'
         and conname in ('billing_allocations_receipt_fkey', 'billing_allocations_invoice_fkey') and array_length(conkey, 1) = 2) = 2
  and (select count(*) from pg_constraint where contype = 'f' and array_length(conkey, 1) = 2
         and conrelid in ('public.billing_refunds'::regclass, 'public.billing_receipt_reversals'::regclass, 'public.billing_assurance_events'::regclass)) >= 4);

-- ================================================================= T-X cross-tenant
select pg_temp.t('X1 Org A cannot allocate its receipt to an Org B invoice through the RPC (ZW002)',
  pg_temp.code(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-x1'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), jsonb_build_array(pg_temp.al(pg_temp.kv('IB'), 100))))) = 'ZW002');
select pg_temp.t('X2 Org B admin cannot refund, reverse, unapply or read an Org A receipt (ZW002)',
  pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select (public.billing_record_refund(%L, %L, 100, current_date, ''cash'', null, null, ''cross tenant'', ''led-x2-0001'')).changed::text', pg_temp.kv('B'), pg_temp.rid(pg_temp.kv('R1'))))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select (public.billing_reverse_receipt(%L, %L, ''entry_error'', ''cross tenant'', ''led-x2-0002'')).changed::text', pg_temp.kv('B'), pg_temp.rid(pg_temp.kv('R1'))))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select (public.billing_unapply_allocation(%L, %L, ''cross tenant'', ''led-x2-0003'')).changed::text', pg_temp.kv('B'), (select id from public.billing_allocations where invoice_id = pg_temp.kv('I1')::uuid)))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select public.billing_get_receipt(%L, %L)::text', pg_temp.kv('B'), pg_temp.rid(pg_temp.kv('R1'))))) = 'ZW002');
select pg_temp.t('X3 a payer from another organization is refused (ZW002)',
  pg_temp.code(pg_temp.rr(null, 'passenger', pg_temp.kv('PB'), null, 100, '[]', 'led-x3-0001')) = 'ZW002');
select pg_temp.t('X4 RLS: Org B admin, Org A dispatcher and driver read 0 ledger rows; Org A admin reads its own',
  pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select count(*)::text from public.billing_receipts where organization_id = %L', pg_temp.kv('A'))) = '0'
  and pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select count(*)::text from public.billing_allocations where organization_id = %L', pg_temp.kv('A'))) = '0'
  and pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, 'select count(*)::text from public.billing_receipts') = '0'
  and pg_temp.x('authenticated', pg_temp.kv('a3')::uuid, 'select count(*)::text from public.billing_allocations') = '0'
  and pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, 'select count(*)::text from public.billing_refunds') = '0'
  and pg_temp.x('authenticated', pg_temp.kv('a3')::uuid, 'select count(*)::text from public.billing_assurance_events') = '0'
  and pg_temp.a1(format('select count(*)::text from public.billing_receipts where organization_id = %L', pg_temp.kv('B'))) = '0'
  and pg_temp.a1('select count(*)::text from public.billing_receipts')::integer >= 2);
select pg_temp.t('X5 Org A open-invoice list never contains an Org B invoice',
  pg_temp.a1(format('select count(*)::text from public.billing_list_open_invoices(%L, null, ''passenger'', %L) where invoice_id = %L', pg_temp.kv('A'), pg_temp.kv('P1'), pg_temp.kv('IB'))) = '0');

-- ================================================================= T-R refunds and reversals
select pg_temp.t('R1 refund above the refundable (unallocated) funds refused (ZW006 refund_exceeds_refundable)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_record_refund(%L, %L, 5001, current_date, ''check'', null, null, ''Customer overpaid (fictional)'', ''led-ref-r1'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1'))))) = 'refund_exceeds_refundable');
insert into k values ('RF1', pg_temp.a1(format('select (r).entry_id::text || ''|'' || (r).unallocated_cents || ''|'' || (r).changed from (select public.billing_record_refund(%L, %L, 2000, current_date, ''check'', null, ''REF-77'', ''Customer overpaid (fictional)'', ''led-ref-0001'') r) s',
  pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')))));
select pg_temp.t('R2 refund within refundable funds recorded: credit 5000 -> 3000; allocations untouched; receipt over-spend impossible',
  split_part(pg_temp.kv('RF1'), '|', 2) = '3000' and pg_temp.paid(pg_temp.kv('I1')) = 6000 and pg_temp.paid(pg_temp.kv('I2')) = 4000, pg_temp.kv('RF1'));
select pg_temp.t('R3 refund idempotent: same key returns the same refund (changed=false); same key, other amount refused',
  split_part(pg_temp.a1(format('select (r).entry_id::text || ''|'' || (r).changed from (select public.billing_record_refund(%L, %L, 2000, current_date, ''check'', null, ''REF-77'', ''Customer overpaid (fictional)'', ''led-ref-0001'') r) s', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')))), '|', 2) = 'false'
  and (select count(*) from public.billing_refunds where idempotency_key = 'led-ref-0001') = 1
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_record_refund(%L, %L, 10, current_date, ''check'', null, null, ''Customer overpaid'', ''led-ref-0001'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1'))))) = 'invalid_idempotency_key');
select pg_temp.t('R4 refund dated before the receipt or in the future refused (ZW006 invalid_dates); reason required',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_record_refund(%L, %L, 10, current_date - 3, ''cash'', null, null, ''Too early'', ''led-ref-r4a'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1'))))) = 'invalid_dates'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_record_refund(%L, %L, 10, current_date + 1, ''cash'', null, null, ''Too late'', ''led-ref-r4b'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1'))))) = 'invalid_dates'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_record_refund(%L, %L, 10, current_date, ''cash'', null, null, '' '', ''led-ref-r4c'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1'))))) = 'reason_required');
insert into k values ('RRV', pg_temp.a1(format('select (r).unallocated_cents::text from (select public.billing_reverse_refund(%L, %L, ''Refund entered twice (fictional)'', ''led-rrv-0001'') r) s',
  pg_temp.kv('A'), split_part(pg_temp.kv('RF1'), '|', 1))));
select pg_temp.t('R5 refund reversal (entry error) restores refundable funds 3000 -> 5000; the refund row stays; second reversal refused (ZW004)',
  pg_temp.kv('RRV') = '5000' and (select count(*) from public.billing_refunds where id = split_part(pg_temp.kv('RF1'), '|', 1)::uuid) = 1
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_reverse_refund(%L, %L, ''again please'', ''led-rrv-0002'')).changed::text', pg_temp.kv('A'), split_part(pg_temp.kv('RF1'), '|', 1)))) = 'already_reversed', pg_temp.kv('RRV'));
select pg_temp.t('R6 a receipt with money applied cannot be reversed (ZW004 receipt_has_allocations)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_reverse_receipt(%L, %L, ''entry_error'', ''Entered twice'', ''led-rev-r6'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1'))))) = 'receipt_has_allocations');
insert into k values ('RF2', pg_temp.a1(format('select (r).entry_id::text from (select public.billing_record_refund(%L, %L, 400, current_date, ''cash'', null, null, ''Returned the cash (fictional)'', ''led-ref-0002'') r) s',
  pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')))));
select pg_temp.t('R7 a receipt with a recorded (not reversed) refund cannot be reversed (ZW004 receipt_has_refunds)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_reverse_receipt(%L, %L, ''entry_error'', ''Entered twice'', ''led-rev-r7'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2'))))) = 'receipt_has_refunds');
-- a fresh unallocated receipt R3 (returned check) -> reverse
insert into k values ('R3', pg_temp.rr(null, 'passenger', pg_temp.kv('P1'), null, 1200, '[]', 'led-rcpt-0003', 'CHK-3003'));
insert into k values ('RV3', pg_temp.a1(format('select (r).entry_id::text || ''|'' || (r).unallocated_cents from (select public.billing_reverse_receipt(%L, %L, ''returned_check'', ''Check returned by the bank (fictional)'', ''led-rev-0003'') r) s',
  pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R3')))));
select pg_temp.t('R8 receipt reversal (returned check): unallocated 0, receipt row kept with its number; second reversal refused; reversed receipt cannot be allocated or refunded',
  split_part(pg_temp.kv('RV3'), '|', 2) = '0' and pg_temp.unalloc(pg_temp.rid(pg_temp.kv('R3'))) = 0
  and (select receipt_number from public.billing_receipts where id = pg_temp.rid(pg_temp.kv('R3'))::uuid) = 3
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_reverse_receipt(%L, %L, ''entry_error'', ''again please'', ''led-rev-0004'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R3'))))) = 'already_reversed'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-r8'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R3')), jsonb_build_array(pg_temp.al(pg_temp.kv('I4'), 100))))) = 'receipt_reversed'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_record_refund(%L, %L, 100, current_date, ''cash'', null, null, ''Refund it'', ''led-ref-r8'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R3'))))) = 'receipt_reversed', pg_temp.kv('RV3'));
select pg_temp.t('R9 reasons are required for unapply / refund / reversals (ZW006 reason_required); reason codes are a closed list',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_unapply_allocation(%L, %L, ''x'', ''led-r9-0001'')).changed::text', pg_temp.kv('A'), (select id from public.billing_allocations where invoice_id = pg_temp.kv('I2')::uuid)))) = 'reason_required'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_reverse_receipt(%L, %L, ''whim'', ''Entered twice'', ''led-r9-0002'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2'))))) = 'invalid_input');

-- ================================================================= T-R (code review) refund-correction lifecycle
-- A correction must never create more refundable money than was received, never allow a second correction, never let
-- active refunds exceed the receipt, and corrected refunds must stop counting everywhere (balances, summary, print data).
insert into k values ('R4', pg_temp.rr(null, 'passenger', pg_temp.kv('P2'), null, 1000, '[]', 'led-rcpt-0004'));
insert into k values ('RFa', pg_temp.a1(format('select (r).entry_id::text from (select public.billing_record_refund(%L, %L, 600, %L::date, ''cash'', null, null, ''Returned 6.00 (fictional)'', ''led-ref-a001'') r) s',
  pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R4')), pg_temp.org_today(pg_temp.kv('A')::uuid))));
insert into k values ('RFa_rev', pg_temp.a1(format('select (r).unallocated_cents::text from (select public.billing_reverse_refund(%L, %L, ''Refund never paid out (fictional)'', ''led-rrv-a001'') r) s',
  pg_temp.kv('A'), pg_temp.kv('RFa'))));
insert into k values ('RFb', pg_temp.a1(format('select (r).entry_id::text || ''|'' || (r).unallocated_cents from (select public.billing_record_refund(%L, %L, 1000, %L::date, ''cash'', null, null, ''Full refund (fictional)'', ''led-ref-b001'') r) s',
  pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R4')), pg_temp.org_today(pg_temp.kv('A')::uuid))));
select pg_temp.t('R10 correction restores exactly the corrected amount (400 -> 1000, never above gross); a full refund afterwards empties the receipt',
  pg_temp.kv('RFa_rev') = '1000' and split_part(pg_temp.kv('RFb'), '|', 2) = '0' and pg_temp.unalloc(pg_temp.rid(pg_temp.kv('R4'))) = 0,
  pg_temp.kv('RFa_rev') || ' / ' || pg_temp.kv('RFb'));
select pg_temp.t('R11 a corrected refund cannot be corrected again (ZW004), so funds can never be restored twice; no further refund once active refunds = gross',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_reverse_refund(%L, %L, ''again please'', ''led-rrv-a002'')).changed::text', pg_temp.kv('A'), pg_temp.kv('RFa')))) = 'already_reversed'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_record_refund(%L, %L, 1, %L::date, ''cash'', null, null, ''One more'', ''led-ref-c001'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R4')), pg_temp.org_today(pg_temp.kv('A')::uuid)))) = 'refund_exceeds_refundable'
  and public._billing_receipt_refunded(pg_temp.rid(pg_temp.kv('R4'))::uuid) = 1000
  and (select sum(amount_cents) from public.billing_refunds where receipt_id = pg_temp.rid(pg_temp.kv('R4'))::uuid) = 1600);
select pg_temp.t('R12 a corrected refund stops counting in every read: receipt detail marks it Corrected, refunded = active refunds only, and the summary excludes it',
  (select (j #>> '{receipt,refunded_cents}')::bigint = 1000
          and (select count(*) from jsonb_array_elements(j -> 'refunds') f where (f ->> 'reversed')::boolean) = 1
          and (select count(*) from jsonb_array_elements(j -> 'refunds') f where not (f ->> 'reversed')::boolean) = 1
   from (select pg_temp.a1(format('select public.billing_get_receipt(%L, %L)::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R4'))))::jsonb j) s)
  and pg_temp.a1(format('select refunds_this_month_cents::text from public.billing_ledger_summary(%L)', pg_temp.kv('A')))::bigint
      = (select coalesce(sum(f.amount_cents), 0) from public.billing_refunds f where f.organization_id = pg_temp.kv('A')::uuid
           and not exists (select 1 from public.billing_refund_reversals x where x.refund_id = f.id)));
-- (a correction on a REVERSED receipt is unreachable: reversal needs zero active refunds, and the remaining corrected
--  refund is refused as already_reversed by R11; the row guard also refuses it -- see _billing_refund_reversal_guard)
select pg_temp.t('R13 a receipt with an active refund cannot be reversed, and a correction can only target a refund of the SAME receipt (composite FK, even for the owner)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_reverse_receipt(%L, %L, ''entry_error'', ''Entered twice'', ''led-rev-r13'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R4'))))) = 'receipt_has_refunds'
  -- owner bypass pointing a correction at ANOTHER receipt (R4, not reversed): the composite FK refuses it
  and pg_temp.owner_try(format('insert into public.billing_refund_reversals (organization_id, refund_id, receipt_id, reason, idempotency_key, reversed_by) values (%L, %L, %L, ''bypass'', ''owner-rrv-0001'', %L)',
        pg_temp.kv('A'), split_part(pg_temp.kv('RF2'), '|', 1), pg_temp.rid(pg_temp.kv('R4')), pg_temp.kv('a1'))) like '23503:%'
  -- owner bypass of a correction on a REVERSED receipt (R3): the row guard refuses it before anything else
  and pg_temp.owner_try(format('insert into public.billing_refund_reversals (organization_id, refund_id, receipt_id, reason, idempotency_key, reversed_by) values (%L, %L, %L, ''bypass'', ''owner-rrv-0002'', %L)',
        pg_temp.kv('A'), split_part(pg_temp.kv('RF2'), '|', 1), pg_temp.rid(pg_temp.kv('R3')), pg_temp.kv('a1'))) = 'ZW004:receipt_reversed');

-- ================================================================= T-M immutability (owner included)
select pg_temp.t('M1 owner UPDATE / DELETE on receipts, allocations, refunds, refund reversals, receipt reversals, assurance events refused (ZW004)',
  pg_temp.owner_try(format('update public.billing_receipts set gross_cents = 1 where id = %L', pg_temp.rid(pg_temp.kv('R1')))) like 'ZW004:%'
  and pg_temp.owner_try(format('delete from public.billing_receipts where id = %L', pg_temp.rid(pg_temp.kv('R2')))) like 'ZW004:%'
  and pg_temp.owner_try(format('update public.billing_allocations set amount_cents = 1 where receipt_id = %L', pg_temp.rid(pg_temp.kv('R1')))) like 'ZW004:%'
  and pg_temp.owner_try(format('delete from public.billing_allocations where receipt_id = %L', pg_temp.rid(pg_temp.kv('R1')))) like 'ZW004:%'
  and pg_temp.owner_try(format('update public.billing_refunds set amount_cents = 1 where id = %L', split_part(pg_temp.kv('RF1'), '|', 1))) like 'ZW004:%'
  and pg_temp.owner_try(format('delete from public.billing_refund_reversals where refund_id = %L', split_part(pg_temp.kv('RF1'), '|', 1))) like 'ZW004:%'
  and pg_temp.owner_try(format('delete from public.billing_receipt_reversals where receipt_id = %L', pg_temp.rid(pg_temp.kv('R3')))) like 'ZW004:%'
  and pg_temp.owner_try(format('update public.billing_assurance_events set kind = ''reconciled'' where receipt_id = %L', pg_temp.rid(pg_temp.kv('R1')))) like 'ZW004:%');
select pg_temp.t('M2 owner TRUNCATE of every ledger table refused (ZW004; pending deferred checks flushed first)',
  pg_temp.owner_try('set constraints all immediate') = 'ok'
  and pg_temp.owner_try('truncate public.billing_assurance_events') like 'ZW004:%'
  and pg_temp.owner_try('truncate public.billing_receipt_reversals') like 'ZW004:%'
  and pg_temp.owner_try('truncate public.billing_refund_reversals') like 'ZW004:%'
  and pg_temp.owner_try('truncate public.billing_refunds cascade') like 'ZW004:%'
  and pg_temp.owner_try('truncate public.billing_allocations cascade') like 'ZW004:%'
  and pg_temp.owner_try('truncate public.billing_receipts cascade') like 'ZW004:%'
  and pg_temp.owner_try('set constraints all deferred') = 'ok');
select pg_temp.t('M3 retired billing_payments: every write refused (ZW004 billing_payments_retired); SELECT still allowed for an Organization Admin (transition release)',
  pg_temp.owner_try(format('insert into public.billing_payments (organization_id, invoice_id, entry_kind, amount_cents, received_on, method, idempotency_key, recorded_by) values (%L, %L, ''payment'', 1, current_date, ''cash'', ''legacy-ins-0002'', %L)', pg_temp.kv('A'), pg_temp.kv('I4'), pg_temp.kv('a1'))) = 'ZW004:billing_payments_retired'
  and pg_temp.a1('select count(*)::text from public.billing_payments') = '0'
  and (select count(*) from public.billing_payments) = 0);

-- ================================================================= T-D duplicates and idempotency
select pg_temp.t('D1 the same receipt key + same facts returns the original (changed=false), no second receipt; same key + other amount refused',
  pg_temp.rid(pg_temp.rr(null, 'passenger', pg_temp.kv('P1'), null, 15000, jsonb_build_array(pg_temp.al(pg_temp.kv('I1'), 6000), pg_temp.al(pg_temp.kv('I2'), 4000)), 'led-rcpt-0001', 'CHK-1001')) = pg_temp.rid(pg_temp.kv('R1'))
  and split_part(pg_temp.rr(null, 'passenger', pg_temp.kv('P1'), null, 15000, jsonb_build_array(pg_temp.al(pg_temp.kv('I1'), 6000), pg_temp.al(pg_temp.kv('I2'), 4000)), 'led-rcpt-0001', 'CHK-1001'), '|', 4) = 'false'
  and (select count(*) from public.billing_receipts where idempotency_key = 'led-rcpt-0001') = 1
  and pg_temp.msg(pg_temp.rr(null, 'passenger', pg_temp.kv('P1'), null, 15001, '[]', 'led-rcpt-0001')) = 'invalid_idempotency_key');
select pg_temp.t('D2 a likely duplicate (same method, reference ignoring case / spaces / dashes, amount, date) needs explicit confirmation',
  pg_temp.msg(pg_temp.rr(null, 'passenger', pg_temp.kv('P1'), null, 15000, '[]', 'led-dup-0001', 'chk 1001')) = 'possible_duplicate'
  and pg_temp.code(pg_temp.rr(null, 'passenger', pg_temp.kv('P1'), null, 15000, '[]', 'led-dup-0002', 'chk 1001', p_confirm => true)) = 'ok'
  and pg_temp.code(pg_temp.rr(null, 'passenger', pg_temp.kv('P1'), null, 14999, '[]', 'led-dup-0003', 'CHK-1001')) = 'ok');
select pg_temp.t('D3 provider transaction ids are unique per organization + provider (owner insert; no FIN-P1 writer)',
  pg_temp.owner_try(format('insert into public.billing_receipts (organization_id, receipt_number, payer_kind, payer_name, gross_cents, received_on, method, provider, provider_txn_id, idempotency_key, recorded_by) values (%L, 9001, ''other'', ''x'', 100, current_date, ''card'', ''stripe'', ''ch_fictional_1'', ''prov-ins-0001'', %L)', pg_temp.kv('A'), pg_temp.kv('a1'))) = 'ok'
  and pg_temp.owner_try(format('insert into public.billing_receipts (organization_id, receipt_number, payer_kind, payer_name, gross_cents, received_on, method, provider, provider_txn_id, idempotency_key, recorded_by) values (%L, 9002, ''other'', ''x'', 100, current_date, ''card'', ''stripe'', ''ch_fictional_1'', ''prov-ins-0002'', %L)', pg_temp.kv('A'), pg_temp.kv('a1'))) like '23505:%');
select pg_temp.t('D4 allocate idempotent: the same key returns changed=false and applies nothing twice',
  split_part(pg_temp.a1(format('select (r).changed::text from (select public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-alloc-0001'') r) s', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), jsonb_build_array(pg_temp.al(pg_temp.kv('I3'), 2000)))), '|', 1) = 'false'
  and (select count(*) from public.billing_allocations where request_key = 'led-alloc-0001') = 1);
-- (side-effecting calls run in their own statement first: a STABLE read in the same statement would use its snapshot)
insert into k values ('FEE1', pg_temp.rr(null, 'passenger', pg_temp.kv('P2'), null, 1000, '[]', 'led-fee-0001', p_method => 'card', p_fee => 59));
select pg_temp.t('D5 processing fee: net = gross - fee; fee above gross refused (ZW006 invalid_fee); fee never reduces the customer''s credit',
  pg_temp.code(pg_temp.kv('FEE1')) = 'ok'
  and (select net_cents from public.billing_receipts where idempotency_key = 'led-fee-0001') = 941
  and pg_temp.unalloc((select id::text from public.billing_receipts where idempotency_key = 'led-fee-0001')) = 1000
  and pg_temp.msg(pg_temp.rr(null, 'passenger', pg_temp.kv('P2'), null, 1000, '[]', 'led-fee-0002', p_method => 'card', p_fee => 1001)) = 'invalid_fee');

-- ================================================================= T-V assurance facts (ZD-270)
insert into k values ('DOC1', pg_temp.rr(null, 'passenger', pg_temp.kv('P2'), null, 300, '[]', 'led-doc-0001', p_method => 'cash', p_doc => true));
select pg_temp.t('V1 assurance: reference -> evidence_reference_noted; document held -> evidence_document_held; nothing -> recorded',
  public._billing_assurance_level(pg_temp.rid(pg_temp.kv('R1'))::uuid, null) = 'evidence_reference_noted'
  and public._billing_assurance_level(pg_temp.rid(pg_temp.kv('R2'))::uuid, null) = 'recorded'
  and public._billing_assurance_level(pg_temp.rid(pg_temp.kv('DOC1'))::uuid, null) = 'evidence_document_held', pg_temp.kv('DOC1'));
select pg_temp.t('V2 staff can never add provider confirmation or reconciliation through the RPC (ZW006); evidence add is idempotent',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_add_receipt_evidence(%L, %L, ''provider_confirmed'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2'))))) = 'invalid_input'
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_add_receipt_evidence(%L, %L, ''reconciled'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2'))))) = 'invalid_input'
  and pg_temp.a1(format('select (public.billing_add_receipt_evidence(%L, %L, ''evidence_document_held'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')))) = 'true'
  and pg_temp.a1(format('select (public.billing_add_receipt_evidence(%L, %L, ''evidence_document_held'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')))) = 'false');
select pg_temp.t('V3 even a direct owner INSERT cannot record provider confirmation / reconciliation with source staff (CHECK 23514)',
  pg_temp.owner_try(format('insert into public.billing_assurance_events (organization_id, receipt_id, kind, source, actor_id) values (%L, %L, ''provider_confirmed'', ''staff'', %L)', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')), pg_temp.kv('a1'))) like '23514:%'
  and pg_temp.owner_try(format('insert into public.billing_assurance_events (organization_id, receipt_id, kind, source, actor_id) values (%L, %L, ''reconciled'', ''staff'', %L)', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R2')), pg_temp.kv('a1'))) like '23514:%');
select pg_temp.t('V4 a manually recorded refund is never provider-confirmed or reconciled (assurance stays staff evidence / recorded)',
  public._billing_assurance_level(null, split_part(pg_temp.kv('RF1'), '|', 1)::uuid) = 'evidence_reference_noted'
  and public._billing_assurance_level(null, pg_temp.kv('RF2')::uuid) = 'recorded');

-- ================================================================= T-P permission catalogue + payer identity (refinement A / OD-2)
select pg_temp.t('P1 permission catalogue: every SENSITIVE action maps to Organization Admin only; unknown action -> null',
  public._billing_action_roles('void') = array['organization_admin'] and public._billing_action_roles('unapply') = array['organization_admin']
  and public._billing_action_roles('reverse') = array['organization_admin'] and public._billing_action_roles('refund') = array['organization_admin']
  and public._billing_action_roles('refund_reverse') = array['organization_admin'] and public._billing_action_roles('cross_payer_allocate') = array['organization_admin']
  and public._billing_action_roles('anything_else') is null);
insert into k values
  ('XP1', pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-xp-0001'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), jsonb_build_array(pg_temp.al(pg_temp.kv('Q1'), 1000))))),
  ('XP2', pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, ''no'', ''led-xp-0002'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), jsonb_build_array(pg_temp.al(pg_temp.kv('Q1'), 1000)))));
insert into k values
  ('XP3', pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, ''Family pays for both riders (fictional)'', ''led-xp-0003'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1')), jsonb_build_array(pg_temp.al(pg_temp.kv('Q1'), 1000)))));
select pg_temp.t('P2 credit of passenger P1 to an invoice of passenger P2 needs explicit confirmation + reason (ZW006), then is applied and flagged different_payer',
  pg_temp.msg(pg_temp.kv('XP1')) = 'different_payer_confirmation_required' and pg_temp.msg(pg_temp.kv('XP2')) = 'reason_required'
  and pg_temp.kv('XP3') = 'true'
  and (select different_payer and reason like 'Family pays%' from public.billing_allocations where request_key = 'led-xp-0003'),
  pg_temp.kv('XP1') || ' / ' || pg_temp.kv('XP2') || ' / ' || pg_temp.kv('XP3'));
insert into k values ('RO1', pg_temp.rr(pg_temp.kv('O1'), null, null, null, 3000, jsonb_build_array(pg_temp.al(pg_temp.kv('O1'), 1500)), 'led-other-0001'));
select pg_temp.t('P3 free-text payers are never merged by name: a receipt from invoice O1 ("Fictional Neighbour Payer") needs confirmation for O2 with the SAME typed name',
  pg_temp.paid(pg_temp.kv('O1')) = 1500
  and pg_temp.msg(pg_temp.a1(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''led-other-0002'')).changed::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('RO1')), jsonb_build_array(pg_temp.al(pg_temp.kv('O2'), 1500))))) = 'different_payer_confirmation_required'
  and pg_temp.a1(format('select count(*)::text from public.billing_invoice_credit_sources(%L, %L)', pg_temp.kv('A'), pg_temp.kv('O2'))) = '0'
  and pg_temp.a1(format('select count(*)::text from public.billing_list_payers(%L) where payer_kind = ''other''', pg_temp.kv('A'))) = '0');
select pg_temp.t('P4 the cross-payer allocation is audited with different_payer=true (no names, no reason text in the audit data)',
  (select count(*) from public.audit_events e join public.billing_allocations a on a.id = e.entity_id
   where a.request_key = 'led-xp-0003' and e.action = 'billing_allocation_applied' and (e.after_data ->> 'different_payer')::boolean
     and e.reason is null and e.after_data::text not like '%Family pays%') = 1);

-- ================================================================= T-Y privacy
select pg_temp.t('Y1 audit data of every ledger action holds ids / amounts / kinds only: no payer name, reference, note or reason text',
  not exists (select 1 from public.audit_events e
              where e.organization_id = pg_temp.kv('A')::uuid
                and e.action in ('billing_receipt_recorded', 'billing_allocation_applied', 'billing_allocation_unapplied', 'billing_refund_recorded',
                                 'billing_refund_reversed', 'billing_receipt_reversed', 'billing_receipt_evidence_added')
                and (e.after_data ?| array['payer_name', 'reference', 'note', 'reason', 'description', 'service_type', 'assistance_notes']
                     or e.after_data::text ~* '(Fictional|CHK-|REF-77|overpaid|returned by the bank)' or e.reason is not null))
  and (select count(*) from public.audit_events where organization_id = pg_temp.kv('A')::uuid and action = 'billing_receipt_recorded') >= 4);
select pg_temp.t('Y2 text that looks like a card number is refused (ZW006 looks_like_card_number); a non-card 15-digit ACH trace number is accepted',
  pg_temp.msg(pg_temp.rr(null, 'passenger', pg_temp.kv('P2'), null, 100, '[]', 'led-pan-0001', '4111 1111 1111 1111', p_method => 'card')) = 'looks_like_card_number'
  and pg_temp.msg(pg_temp.rr(null, 'passenger', pg_temp.kv('P2'), null, 100, '[]', 'led-pan-0002', '5555-5555-5555-4444', p_method => 'card')) = 'looks_like_card_number'
  and pg_temp.code(pg_temp.rr(null, 'passenger', pg_temp.kv('P2'), null, 100, '[]', 'led-pan-0003', '021000021234568', p_method => 'ach')) = 'ok'
  and public._billing_looks_like_pan('021000021234568') = false and public._billing_looks_like_pan('card 378282246310005') = true);
select pg_temp.t('Y3 no ledger read RPC returns service type, assistance notes or trip notes',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('billing_get_invoice_ledger', 'billing_list_receipts', 'billing_get_receipt',
                    'billing_list_open_invoices', 'billing_invoice_credit_sources', 'billing_list_payers', 'billing_ledger_summary')
                and (pg_get_functiondef(p.oid) ~* 'service_type|assistance_notes|trip_notes|additional_notes')));

-- ================================================================= T-W BILL-P1 compatibility
insert into k values ('W1', pg_temp.a1(format('select (r).payment_id::text || ''|'' || (r).paid_cents || ''|'' || (r).balance_cents || ''|'' || (r).changed from (select public.billing_record_payment(%L, %L, %s, 1000, current_date, ''card_external'', ''AUTH-55'', ''fictional'', ''led-wrap-0001'') r) s',
  pg_temp.kv('A'), pg_temp.kv('I4'), (select version from public.billing_invoices where id = pg_temp.kv('I4')::uuid))));
select pg_temp.t('W1 billing_record_payment = one receipt (payer = the invoice bill-to, source invoice, card_external -> card) + one allocation; returns the allocation id',
  (select a.kind = 'apply' and a.amount_cents = 1000 and r.source_invoice_id = pg_temp.kv('I4')::uuid and r.method = 'card' and r.payer_kind = 'passenger'
          and r.payer_passenger_id = pg_temp.kv('P1')::uuid and r.gross_cents = 1000
   from public.billing_allocations a join public.billing_receipts r on r.id = a.receipt_id where a.id = split_part(pg_temp.kv('W1'), '|', 1)::uuid)
  and split_part(pg_temp.kv('W1'), '|', 2) = '1000' and split_part(pg_temp.kv('W1'), '|', 3) = '1500'
  and pg_temp.audits('billing_payment_recorded', split_part(pg_temp.kv('W1'), '|', 1)) = 1, pg_temp.kv('W1'));
select pg_temp.t('W2 billing_reverse_payment refuses a receipt shared with other invoices (ZW004 use_receipt_page)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_reverse_payment(%L, %L, %s, ''Entered by mistake'', ''led-wrap-0002'')).paid_cents::text', pg_temp.kv('A'),
    (select id from public.billing_allocations where invoice_id = pg_temp.kv('I1')::uuid and kind = 'apply'), (select version from public.billing_invoices where id = pg_temp.kv('I1')::uuid)))) = 'use_receipt_page');
select pg_temp.t('W3 billing_record_payment with a card-like reference is refused as invalid_input (ZW006), nothing recorded',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_record_payment(%L, %L, %s, 100, current_date, ''card_external'', ''4111111111111111'', null, ''led-wrap-0003'')).paid_cents::text', pg_temp.kv('A'), pg_temp.kv('I5'), (select version from public.billing_invoices where id = pg_temp.kv('I5')::uuid)))) = 'invalid_input'
  and pg_temp.paid(pg_temp.kv('I5')) = 0);
select pg_temp.t('W4 billing_summary collected this month = receipts received this month (not reversed) - refunds this month (not reversed)',
  pg_temp.a1(format('select collected_this_month_cents::text from public.billing_summary(%L)', pg_temp.kv('A')))::bigint
    = (select sum(gross_cents) from public.billing_receipts r where r.organization_id = pg_temp.kv('A')::uuid
         and not exists (select 1 from public.billing_receipt_reversals x where x.receipt_id = r.id) and r.received_on >= date_trunc('month', current_date))
      - (select coalesce(sum(amount_cents), 0) from public.billing_refunds f where f.organization_id = pg_temp.kv('A')::uuid
         and not exists (select 1 from public.billing_refund_reversals x where x.refund_id = f.id)));

-- ================================================================= T-S reads
select pg_temp.t('S1 billing_get_receipt: header amounts consistent (gross = allocated + refunded + unallocated), allocations + refunds + events listed',
  (select (j #>> '{receipt,gross_cents}')::bigint = (j #>> '{receipt,allocated_cents}')::bigint + (j #>> '{receipt,refunded_cents}')::bigint + (j #>> '{receipt,unallocated_cents}')::bigint
          and jsonb_array_length(j -> 'allocations') = 4 and jsonb_array_length(j -> 'refunds') = 1 and (j -> 'refunds' -> 0 ->> 'reversed')::boolean
          and jsonb_array_length(j -> 'events') = 1 and j -> 'reversal' = 'null'::jsonb
   from (select pg_temp.a1(format('select public.billing_get_receipt(%L, %L)::text', pg_temp.kv('A'), pg_temp.rid(pg_temp.kv('R1'))))::jsonb j) s));
select pg_temp.t('S2 billing_list_receipts filters credit / reversed and searches by RCPT number',
  pg_temp.a1(format('select string_agg(receipt_number::text, '','' order by receipt_number) from public.billing_list_receipts(%L, ''reversed'', null, 50, 0)', pg_temp.kv('A'))) = '3'
  and pg_temp.a1(format('select count(*)::text from public.billing_list_receipts(%L, ''credit'', null, 50, 0) where receipt_number = 3', pg_temp.kv('A'))) = '0'
  and pg_temp.a1(format('select receipt_number::text from public.billing_list_receipts(%L, ''all'', ''RCPT-000002'', 50, 0)', pg_temp.kv('A'))) = '2');
select pg_temp.t('S3 billing_get_invoice_ledger: the wrapper payment is a simple payment; a shared receipt is not; unapplied entries are marked',
  pg_temp.a1(format('select simple_payment::text from public.billing_get_invoice_ledger(%L, %L)', pg_temp.kv('A'), pg_temp.kv('I4'))) = 'true'
  and pg_temp.a1(format('select simple_payment::text from public.billing_get_invoice_ledger(%L, %L)', pg_temp.kv('A'), pg_temp.kv('I1'))) = 'false'
  and pg_temp.a1(format('select unapplied::text from public.billing_get_invoice_ledger(%L, %L)', pg_temp.kv('A'), pg_temp.kv('I3'))) = 'true');
select pg_temp.t('S4 ledger summary: payer credit = sum of unallocated funds of receipts that were not reversed',
  pg_temp.a1(format('select credit_cents::text from public.billing_ledger_summary(%L)', pg_temp.kv('A')))::bigint
    = (select sum(public._billing_receipt_unallocated(r.id)) from public.billing_receipts r where r.organization_id = pg_temp.kv('A')::uuid));

-- ================================================================= global invariants (whole fixture set, at the end)
select pg_temp.t('Z1 invariants hold everywhere: 0 <= paid <= total; money only on issued invoices; allocated + refunded <= gross; reversed receipts at net zero',
  not exists (select 1 from public.billing_invoices i where public._billing_invoice_net(i.id) < 0 or public._billing_invoice_net(i.id) > i.total_cents
              or (i.status <> 'issued' and public._billing_invoice_net(i.id) <> 0))
  and not exists (select 1 from public.billing_receipts r where public._billing_receipt_allocated(r.id) + public._billing_receipt_refunded(r.id) > r.gross_cents
              or (public._billing_receipt_is_reversed(r.id) and (public._billing_receipt_allocated(r.id) <> 0 or public._billing_receipt_refunded(r.id) <> 0))));
select pg_temp.t('Z2 deferred invariants pass at commit time for everything this suite wrote (set constraints all immediate)',
  pg_temp.owner_try('set constraints all immediate') = 'ok' and pg_temp.owner_try('set constraints all deferred') = 'ok');

select format(' SUMMARY (failures = %s of %s tests)', count(*) filter (where not ok), count(*)) from k_results;
rollback;
