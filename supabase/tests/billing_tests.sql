-- NP-BILL-P1 -- Core private-pay billing tests. ROLLBACK-ONLY (one transaction, rolled back at the end).
--   docker exec -i supabase_db_NemrynS1Iso psql -U postgres -d postgres -f - < supabase/tests/billing_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261027100000_core_billing_foundation.sql + 20261027110000_core_billing_rpcs.sql (contract:
-- docs/reports/NP-BILL-P1-contract-and-decisions.txt, D1-D6, R1-R4). Fictional seed fixtures only: Org A admin a1,
-- dispatcher a2, driver a3; Org B admin b1. Trips are inserted directly as completed (fixtures), everything else goes
-- through the RPCs as the signed-in role. Inside one transaction now() is constant.
\set ON_ERROR_STOP on
\pset pager off
begin;
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

-- identities / orgs
insert into k values
  ('A', '10000000-0000-0000-0000-0000000000a1'), ('B', '10000000-0000-0000-0000-0000000000b1'),
  ('a1', '20000000-0000-0000-0000-0000000000a1'), ('a2', '20000000-0000-0000-0000-0000000000a2'),
  ('a3', '20000000-0000-0000-0000-0000000000a3'), ('b1', '20000000-0000-0000-0000-0000000000b1'),
  ('P1', '40000000-0000-0000-0000-0000000000a1'), ('PB', '40000000-0000-0000-0000-0000000000b1'),
  ('FA', '60000000-0000-0000-0000-0000000000a1');
-- admin call helper: runs a statement as Org A admin a1
create function pg_temp.a1(p_stmt text) returns text language sql as $$ select pg_temp.x('authenticated', pg_temp.kv('a1')::uuid, p_stmt); $$;

-- fixtures: a second Org A passenger, a request (requester), completed trips
insert into public.passengers (id, organization_id, display_name, phone) values
  ('40000000-0000-0000-0000-00000000b1a2', pg_temp.kv('A')::uuid, 'Fictional Billing Passenger Two', '(404) 555-0102');
insert into k values ('P2', '40000000-0000-0000-0000-00000000b1a2');
insert into public.transportation_requests (id, organization_id, requester_name, requester_relationship, requester_phone, requester_email,
  pickup_description, destination_description, return_trip_needed, state, source, passenger_id)
values ('70000000-0000-0000-0000-00000000b1a1', pg_temp.kv('A')::uuid, 'Fictional Daughter Payer', 'family', '(404) 555-0190',
  'payer@example.test', '1 Fictional Way', 'Fictional Clinic A', 'yes', 'accepted', 'phone', pg_temp.kv('P1')::uuid);
insert into k values ('R1', '70000000-0000-0000-0000-00000000b1a1');
create function pg_temp.trip(p_label text, p_org uuid, p_pass uuid, p_state text, p_req uuid default null, p_fac uuid default null)
returns uuid language sql as $$
  insert into public.trips (organization_id, passenger_id, state, pickup_description, destination_description, scheduled_pickup_at,
                            completed_at, request_id, destination_facility_id)
  values (p_org, p_pass, p_state, p_label || ' pickup', p_label || ' destination', now() - interval '1 day',
          case when p_state = 'completed' then now() - interval '20 hours' end, p_req, p_fac)
  returning id;
$$;
insert into k values
  ('T1', pg_temp.trip('T1', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed', pg_temp.kv('R1')::uuid, pg_temp.kv('FA')::uuid)),
  ('T2', pg_temp.trip('T2', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed', pg_temp.kv('R1')::uuid, pg_temp.kv('FA')::uuid)),
  ('T3', pg_temp.trip('T3', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed')),
  ('TS', pg_temp.trip('TS', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'scheduled')),
  ('TX', pg_temp.trip('TX', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'cancelled')),
  ('T4', pg_temp.trip('T4', pg_temp.kv('A')::uuid, pg_temp.kv('P2')::uuid, 'completed')),
  ('TB', pg_temp.trip('TB', pg_temp.kv('B')::uuid, pg_temp.kv('PB')::uuid, 'completed'));
create function pg_temp.draft(p_trips text, p_kind text, p_bill uuid, p_name text, p_key text, p_quote uuid default null)
returns text language sql as $$
  select pg_temp.a1(format('select (r).invoice_id::text from (select public.billing_create_invoice_draft(%L, %L::uuid[], %L, %L, %L, %L, %L) r) s',
    pg_temp.kv('A'), p_trips, p_kind, p_bill, p_name, p_quote, p_key));
$$;
create function pg_temp.ver(p_inv text) returns integer language sql as $$ select version from public.billing_invoices where id = p_inv::uuid; $$;
create function pg_temp.audits(p_action text, p_entity text) returns bigint language sql as $$ select count(*) from public.audit_events where action = p_action and entity_id = p_entity::uuid; $$;

-- ================================================================= A. access: RLS + RPC authorization (D2)
select pg_temp.t('A1 anon cannot execute billing RPCs (no grant)',
  pg_temp.code(pg_temp.x('anon', null, format('select (public.billing_summary(%L)).draft_count::text', pg_temp.kv('A')))) = '42501');
select pg_temp.t('A2 dispatcher of Org A is refused (ZW002, no existence oracle)',
  pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, format('select (public.billing_summary(%L)).draft_count::text', pg_temp.kv('A')))) = 'ZW002');
select pg_temp.t('A3 driver of Org A is refused (ZW002)',
  pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a3')::uuid, format('select (public.billing_summary(%L)).draft_count::text', pg_temp.kv('A')))) = 'ZW002');
select pg_temp.t('A4 Org B admin calling with Org A is refused (ZW002)',
  pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select (public.billing_summary(%L)).draft_count::text', pg_temp.kv('A')))) = 'ZW002');
select pg_temp.t('A5 unauthenticated (no sub) is refused (ZW001)',
  pg_temp.code(pg_temp.x('authenticated', null, format('select (public.billing_summary(%L)).draft_count::text', pg_temp.kv('A')))) = 'ZW001');
select pg_temp.t('A6 Org A admin can read the summary (Core: no Plus entitlement needed, D1)',
  pg_temp.code(pg_temp.a1(format('select (public.billing_summary(%L)).ready_trip_count::text', pg_temp.kv('A')))) = 'ok');
select pg_temp.t('A7 no direct writes for authenticated: INSERT into billing_invoices denied',
  pg_temp.code(pg_temp.a1(format('insert into public.billing_invoices (organization_id, passenger_id, bill_to_kind, bill_to_name, idempotency_key, created_by) values (%L, %L, ''other'', ''x'', ''direct-ins-1'', %L) returning id::text', pg_temp.kv('A'), pg_temp.kv('P1'), pg_temp.kv('a1')))) = '42501');
select pg_temp.t('A8 no direct writes: INSERT into billing_payments / UPDATE billing_invoice_lines denied',
  pg_temp.code(pg_temp.a1('insert into public.billing_payments (organization_id, invoice_id, entry_kind, amount_cents, received_on, method, idempotency_key, recorded_by) values (gen_random_uuid(), gen_random_uuid(), ''payment'', 1, current_date, ''cash'', ''direct-ins-2'', gen_random_uuid()) returning id::text')) = '42501'
  and pg_temp.code(pg_temp.a1('update public.billing_invoice_lines set unit_cents = 1 returning id::text')) = '42501');

-- ================================================================= B. draft creation rules (R1)
insert into k values ('D1', pg_temp.draft(format('{%s,%s}', pg_temp.kv('T1'), pg_temp.kv('T2')), 'passenger', pg_temp.kv('P1')::uuid, null, 'bill-d1-key-0001'));
select pg_temp.t('B1 draft for two completed trips of ONE passenger, billed to the passenger',
  pg_temp.code(pg_temp.kv('D1')) = 'ok'
  and (select status = 'draft' and invoice_number is null and bill_to_name = 'Fictional Passenger A1' and total_cents = 0
       from public.billing_invoices where id = pg_temp.kv('D1')::uuid)
  and (select count(*) from public.billing_invoice_lines where invoice_id = pg_temp.kv('D1')::uuid and source = 'trip' and trip_id is not null) = 2,
  pg_temp.kv('D1'));
select pg_temp.t('B2 idempotent: same key + same trips returns the same draft, nothing new',
  pg_temp.draft(format('{%s,%s}', pg_temp.kv('T2'), pg_temp.kv('T1')), 'passenger', pg_temp.kv('P1')::uuid, null, 'bill-d1-key-0001') = pg_temp.kv('D1')
  and (select count(*) from public.billing_invoices where organization_id = pg_temp.kv('A')::uuid) = 1);
select pg_temp.t('B3 same key, different trips -> ZW006',
  pg_temp.code(pg_temp.draft(format('{%s}', pg_temp.kv('T3')), 'passenger', pg_temp.kv('P1')::uuid, null, 'bill-d1-key-0001')) = 'ZW006');
select pg_temp.t('B4 a trip already on a draft cannot be put on another (ZW004 trip_already_invoiced)',
  pg_temp.msg(pg_temp.draft(format('{%s,%s}', pg_temp.kv('T1'), pg_temp.kv('T3')), 'passenger', pg_temp.kv('P1')::uuid, null, 'bill-dup-key-0001')) = 'trip_already_invoiced');
select pg_temp.t('B5 not completed (scheduled / cancelled) -> ZW004 trip_not_completed',
  pg_temp.msg(pg_temp.draft(format('{%s}', pg_temp.kv('TS')), 'passenger', pg_temp.kv('P1')::uuid, null, 'bill-ts-key-0001')) = 'trip_not_completed'
  and pg_temp.msg(pg_temp.draft(format('{%s}', pg_temp.kv('TX')), 'passenger', pg_temp.kv('P1')::uuid, null, 'bill-tx-key-0001')) = 'trip_not_completed');
select pg_temp.t('B6 mixing two passengers on one invoice -> ZW006 mixed_customers',
  pg_temp.msg(pg_temp.draft(format('{%s,%s}', pg_temp.kv('T3'), pg_temp.kv('T4')), 'other', null, 'Someone', 'bill-mix-key-0001')) = 'mixed_customers');
select pg_temp.t('B7 another organization''s trip -> ZW002 (and never listed)',
  pg_temp.code(pg_temp.draft(format('{%s}', pg_temp.kv('TB')), 'other', null, 'Someone', 'bill-tb-key-0001')) = 'ZW002');
select pg_temp.t('B8 bill-to passenger must be the trips'' passenger (ZW006 bill_to_not_linked)',
  pg_temp.msg(pg_temp.draft(format('{%s}', pg_temp.kv('T3')), 'passenger', pg_temp.kv('P2')::uuid, null, 'bill-bp-key-0001')) = 'bill_to_not_linked');
select pg_temp.t('B9 bill-to requester must be the request of an included trip (T3 has none)',
  pg_temp.msg(pg_temp.draft(format('{%s}', pg_temp.kv('T3')), 'requester', pg_temp.kv('R1')::uuid, null, 'bill-br-key-0001')) = 'bill_to_not_linked');
select pg_temp.t('B10 bill-to facility must be the pickup / destination facility of EVERY trip (T3 has none)',
  pg_temp.msg(pg_temp.draft(format('{%s}', pg_temp.kv('T3')), 'facility', pg_temp.kv('FA')::uuid, null, 'bill-bf-key-0001')) = 'bill_to_not_linked');
select pg_temp.t('B11 other bill-to needs a name; empty -> ZW006',
  pg_temp.msg(pg_temp.draft(format('{%s}', pg_temp.kv('T3')), 'other', null, '   ', 'bill-bo-key-0001')) = 'bill_to_name_required');
select pg_temp.t('B12 dispatcher cannot create a draft (ZW002)',
  pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, format('select (public.billing_create_invoice_draft(%L, %L::uuid[], ''other'', null, ''X'', null, ''bill-a2-key-0001'')).invoice_id::text', pg_temp.kv('A'), format('{%s}', pg_temp.kv('T3'))))) = 'ZW002');
select pg_temp.t('B13 billable list excludes trips on a draft, non-completed and other-org trips',
  pg_temp.a1(format('select string_agg(trip_id::text, '','') from public.billing_list_billable_trips(%L, null, 100, 0)', pg_temp.kv('A')))
      not like '%' || pg_temp.kv('T1') || '%'
  and pg_temp.a1(format('select string_agg(trip_id::text, '','') from public.billing_list_billable_trips(%L, null, 100, 0)', pg_temp.kv('A')))
      like '%' || pg_temp.kv('T3') || '%'
  and pg_temp.a1(format('select string_agg(trip_id::text, '','') from public.billing_list_billable_trips(%L, null, 100, 0)', pg_temp.kv('A')))
      not like '%' || pg_temp.kv('TS') || '%'
  and pg_temp.a1(format('select string_agg(trip_id::text, '','') from public.billing_list_billable_trips(%L, null, 100, 0)', pg_temp.kv('A')))
      not like '%' || pg_temp.kv('TB') || '%');

-- ================================================================= C. draft edits, discard, issue
insert into k values ('C1r', pg_temp.a1(format($q$select (public.billing_update_invoice_draft(%L, %L, %s, 'Fictional Passenger A1', '1 Fictional Way, Atlanta GA', null, '(404) 555-0111',
      jsonb_build_array(
        jsonb_build_object('trip_id', %L, 'source', 'trip', 'description', 'Ride 1', 'quantity', 1, 'unit_cents', 4500),
        jsonb_build_object('trip_id', %L, 'source', 'trip', 'description', 'Ride 2', 'quantity', 1, 'unit_cents', 4500),
        jsonb_build_object('source', 'manual', 'description', 'Mileage', 'quantity', 12.5, 'unit_cents', 199)),
      500, 'Due within 15 days.')).total_cents::text$q$,
      pg_temp.kv('A'), pg_temp.kv('D1'), pg_temp.ver(pg_temp.kv('D1')), pg_temp.kv('T1'), pg_temp.kv('T2'))));
select pg_temp.t('C1 edit lines (amount = round(qty x unit) computed server-side), discount, bill-to address',
  pg_temp.code(pg_temp.kv('C1r')) = 'ok'
  and (select subtotal_cents = 9000 + 2488 and discount_cents = 500 and total_cents = 9000 + 2488 - 500 from public.billing_invoices where id = pg_temp.kv('D1')::uuid), pg_temp.kv('C1r'));
select pg_temp.t('C2 stale version -> ZW003; a trip line for a trip NOT on the invoice -> ZW006',
  pg_temp.code(pg_temp.a1(format($q$select (public.billing_update_invoice_draft(%L, %L, 1, 'X', null, null, null, '[]'::jsonb, 0, null)).version::text$q$, pg_temp.kv('A'), pg_temp.kv('D1')))) = 'ZW003'
  and pg_temp.msg(pg_temp.a1(format($q$select (public.billing_update_invoice_draft(%L, %L, %s, 'X', null, null, null,
      jsonb_build_array(jsonb_build_object('trip_id', %L, 'source', 'trip', 'description', 'Foreign', 'quantity', 1, 'unit_cents', 1)), 0, null)).version::text$q$,
      pg_temp.kv('A'), pg_temp.kv('D1'), pg_temp.ver(pg_temp.kv('D1')), pg_temp.kv('T3')))) = 'line_trip_not_on_invoice');
select pg_temp.t('C3 discount above the subtotal -> ZW006; invoice unchanged',
  pg_temp.msg(pg_temp.a1(format($q$select (public.billing_update_invoice_draft(%L, %L, %s, 'X', null, null, null,
      jsonb_build_array(jsonb_build_object('source', 'manual', 'description', 'Tiny', 'quantity', 1, 'unit_cents', 100)), 500, null)).version::text$q$,
      pg_temp.kv('A'), pg_temp.kv('D1'), pg_temp.ver(pg_temp.kv('D1'))))) = 'discount_exceeds_subtotal'
  and (select total_cents = 10988 from public.billing_invoices where id = pg_temp.kv('D1')::uuid));
insert into k values ('D3', pg_temp.draft(format('{%s}', pg_temp.kv('T3')), 'other', null, 'Fictional Neighbour Payer', 'bill-d3-key-0001'));
select pg_temp.t('C4 a zero-total draft cannot be issued (ZW006 invoice_total_required)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_issue_invoice(%L, %L, %s, null, null)).status', pg_temp.kv('A'), pg_temp.kv('D3'), pg_temp.ver(pg_temp.kv('D3'))))) = 'invoice_total_required');
insert into k values ('C5r', pg_temp.a1(format('select (public.billing_discard_invoice_draft(%L, %L, %s)).status', pg_temp.kv('A'), pg_temp.kv('D3'), pg_temp.ver(pg_temp.kv('D3')))));
select pg_temp.t('C5 discard a draft: deleted with lines + links, trip billable again, audited, no number used',
  pg_temp.kv('C5r') = 'discarded'
  and not exists (select 1 from public.billing_invoices where id = pg_temp.kv('D3')::uuid)
  and not exists (select 1 from public.billing_invoice_trips where trip_id = pg_temp.kv('T3')::uuid)
  and pg_temp.audits('billing_invoice_draft_discarded', pg_temp.kv('D3')) = 1);
insert into k values ('C6r', pg_temp.a1(format('select (public.billing_issue_invoice(%L, %L, %s, null, null)).invoice_number::text', pg_temp.kv('A'), pg_temp.kv('D1'), pg_temp.ver(pg_temp.kv('D1')))));
select pg_temp.t('C6 issue: number 1 assigned, dates default today / today + 15 (D6), audited',
  pg_temp.kv('C6r') = '1'
  and (select i.status = 'issued' and i.issue_date = (now() at time zone o.timezone)::date
       from public.billing_invoices i join public.organizations o on o.id = i.organization_id where i.id = pg_temp.kv('D1')::uuid)
  and (select due_date = issue_date + 15 from public.billing_invoices where id = pg_temp.kv('D1')::uuid)
  and pg_temp.audits('billing_invoice_issued', pg_temp.kv('D1')) = 1);
select pg_temp.t('C7 issued invoices are frozen: editing / issuing again / discarding -> ZW004',
  pg_temp.code(pg_temp.a1(format($q$select (public.billing_update_invoice_draft(%L, %L, %s, 'X', null, null, null, '[]'::jsonb, 0, null)).version::text$q$, pg_temp.kv('A'), pg_temp.kv('D1'), pg_temp.ver(pg_temp.kv('D1'))))) = 'ZW004'
  and pg_temp.code(pg_temp.a1(format('select (public.billing_issue_invoice(%L, %L, %s, null, null)).status', pg_temp.kv('A'), pg_temp.kv('D1'), pg_temp.ver(pg_temp.kv('D1'))))) = 'ZW004'
  and pg_temp.code(pg_temp.a1(format('select (public.billing_discard_invoice_draft(%L, %L, %s)).status', pg_temp.kv('A'), pg_temp.kv('D1'), pg_temp.ver(pg_temp.kv('D1'))))) = 'ZW004');
-- R4: database-level immutability even for the table owner
create function pg_temp.owner_try(p_stmt text) returns text language plpgsql as $$
begin execute p_stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end;
$$;
select pg_temp.t('C8 DB-level: even a direct owner UPDATE of an issued invoice''s total / bill-to / number is refused',
  pg_temp.owner_try(format('update public.billing_invoices set total_cents = 1, subtotal_cents = 1, discount_cents = 0 where id = %L', pg_temp.kv('D1'))) like 'ZW004:%'
  and pg_temp.owner_try(format('update public.billing_invoices set bill_to_name = ''Changed'' where id = %L', pg_temp.kv('D1'))) like 'ZW004:%'
  and pg_temp.owner_try(format('update public.billing_invoices set invoice_number = 99 where id = %L', pg_temp.kv('D1'))) like 'ZW004:%');
select pg_temp.t('C9 DB-level: owner cannot change / add / delete lines of an issued invoice, nor delete it, nor move it back to draft',
  pg_temp.owner_try(format('update public.billing_invoice_lines set unit_cents = 1, amount_cents = 1 where invoice_id = %L', pg_temp.kv('D1'))) like 'ZW004:%'
  and pg_temp.owner_try(format('delete from public.billing_invoice_lines where invoice_id = %L', pg_temp.kv('D1'))) like 'ZW004:%'
  and pg_temp.owner_try(format('insert into public.billing_invoice_lines (organization_id, invoice_id, position, description, unit_cents, amount_cents) values (%L, %L, 99, ''x'', 1, 1)', pg_temp.kv('A'), pg_temp.kv('D1'))) like 'ZW004:%'
  and pg_temp.owner_try(format('delete from public.billing_invoices where id = %L', pg_temp.kv('D1'))) like 'ZW004:%'
  and pg_temp.owner_try(format('update public.billing_invoices set status = ''draft'' where id = %L', pg_temp.kv('D1'))) like 'ZW004:%');

-- ================================================================= D. payments (D5, R2)
create function pg_temp.pay(p_inv text, p_amount bigint, p_key text, p_ver integer default null) returns text language sql as $$
  select pg_temp.a1(format('select (r).payment_id::text || ''|'' || (r).paid_cents || ''|'' || (r).balance_cents || ''|'' || (r).changed from (select public.billing_record_payment(%L, %L, %s, %s, current_date, ''check'', ''CHK-1001'', ''fictional'', %L) r) s',
    pg_temp.kv('A'), p_inv, coalesce(p_ver, pg_temp.ver(p_inv)), p_amount, p_key));
$$;
insert into k values ('PAY1', pg_temp.pay(pg_temp.kv('D1'), 5000, 'bill-pay-key-0001'));
select pg_temp.t('D1 partial payment: paid 5000, balance 5988, state partially_paid',
  split_part(pg_temp.kv('PAY1'), '|', 2) = '5000' and split_part(pg_temp.kv('PAY1'), '|', 3) = '5988'
  and pg_temp.a1(format('select payment_state from public.billing_get_invoice(%L, %L)', pg_temp.kv('A'), pg_temp.kv('D1'))) = 'partially_paid',
  pg_temp.kv('PAY1'));
select pg_temp.t('D2 idempotent: the same key returns the same payment (changed=false), no second row',
  split_part(pg_temp.pay(pg_temp.kv('D1'), 5000, 'bill-pay-key-0001', 1), '|', 1) = split_part(pg_temp.kv('PAY1'), '|', 1)
  and split_part(pg_temp.pay(pg_temp.kv('D1'), 5000, 'bill-pay-key-0001', 1), '|', 4) = 'false'
  and (select count(*) from public.billing_payments where invoice_id = pg_temp.kv('D1')::uuid) = 1);
select pg_temp.t('D3 a stale form (old version, new key) cannot double-record (ZW003)',
  pg_temp.code(pg_temp.pay(pg_temp.kv('D1'), 5000, 'bill-pay-key-0002', pg_temp.ver(pg_temp.kv('D1')) - 1)) = 'ZW003');
select pg_temp.t('D4 overpayment refused (ZW006 amount_exceeds_balance); zero / negative refused',
  pg_temp.msg(pg_temp.pay(pg_temp.kv('D1'), 5989, 'bill-pay-key-0003')) = 'amount_exceeds_balance'
  and pg_temp.msg(pg_temp.pay(pg_temp.kv('D1'), 0, 'bill-pay-key-0004')) = 'invalid_amount'
  and pg_temp.msg(pg_temp.pay(pg_temp.kv('D1'), -5, 'bill-pay-key-0005')) = 'invalid_amount');
select pg_temp.t('D5 future received date refused; unknown method refused',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_record_payment(%L, %L, %s, 100, current_date + 400, ''cash'', null, null, ''bill-pay-key-0006'')).paid_cents::text', pg_temp.kv('A'), pg_temp.kv('D1'), pg_temp.ver(pg_temp.kv('D1'))))) = 'invalid_dates'
  and pg_temp.code(pg_temp.a1(format('select (public.billing_record_payment(%L, %L, %s, 100, current_date, ''bitcoin'', null, null, ''bill-pay-key-0007'')).paid_cents::text', pg_temp.kv('A'), pg_temp.kv('D1'), pg_temp.ver(pg_temp.kv('D1'))))) = 'ZW006');
select pg_temp.t('D6 void blocked while payments exist (ZW004 invoice_has_payments)',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_void_invoice(%L, %L, %s, ''wrong amount'')).status', pg_temp.kv('A'), pg_temp.kv('D1'), pg_temp.ver(pg_temp.kv('D1'))))) = 'invoice_has_payments');
insert into k values ('REV1', pg_temp.a1(format('select (r).payment_id::text || ''|'' || (r).paid_cents || ''|'' || (r).balance_cents from (select public.billing_reverse_payment(%L, %L, %s, ''Check bounced (fictional)'', ''bill-rev-key-0001'') r) s',
  pg_temp.kv('A'), split_part(pg_temp.kv('PAY1'), '|', 1), pg_temp.ver(pg_temp.kv('D1')))));
select pg_temp.t('D7 reversal: new ledger entry (original untouched), paid back to 0, balance = total, reason stored, audited',
  split_part(pg_temp.kv('REV1'), '|', 2) = '0' and split_part(pg_temp.kv('REV1'), '|', 3) = '10988'
  and (select entry_kind = 'reversal' and amount_cents = 5000 and reason like 'Check bounced%' from public.billing_payments where id = split_part(pg_temp.kv('REV1'), '|', 1)::uuid)
  and (select entry_kind = 'payment' and amount_cents = 5000 from public.billing_payments where id = split_part(pg_temp.kv('PAY1'), '|', 1)::uuid)
  and pg_temp.audits('billing_payment_reversed', split_part(pg_temp.kv('REV1'), '|', 1)) = 1, pg_temp.kv('REV1'));
select pg_temp.t('D8 a payment can be reversed only once; reversal needs a reason; a reversal cannot be reversed',
  pg_temp.msg(pg_temp.a1(format('select (public.billing_reverse_payment(%L, %L, %s, ''again please'', ''bill-rev-key-0002'')).paid_cents::text', pg_temp.kv('A'), split_part(pg_temp.kv('PAY1'), '|', 1), pg_temp.ver(pg_temp.kv('D1'))))) = 'already_reversed'
  and pg_temp.code(pg_temp.a1(format('select (public.billing_reverse_payment(%L, %L, %s, ''  '', ''bill-rev-key-0003'')).paid_cents::text', pg_temp.kv('A'), split_part(pg_temp.kv('PAY1'), '|', 1), pg_temp.ver(pg_temp.kv('D1'))))) in ('ZW004', 'ZW006')
  and pg_temp.code(pg_temp.a1(format('select (public.billing_reverse_payment(%L, %L, %s, ''reverse the reversal'', ''bill-rev-key-0004'')).paid_cents::text', pg_temp.kv('A'), split_part(pg_temp.kv('REV1'), '|', 1), pg_temp.ver(pg_temp.kv('D1'))))) = 'ZW006');
select pg_temp.t('D9 DB-level append-only: owner UPDATE / DELETE / TRUNCATE of payments refused',
  pg_temp.owner_try(format('update public.billing_payments set amount_cents = 1 where id = %L', split_part(pg_temp.kv('PAY1'), '|', 1))) like 'ZW004:%'
  and pg_temp.owner_try(format('delete from public.billing_payments where id = %L', split_part(pg_temp.kv('PAY1'), '|', 1))) like 'ZW004:%'
  and pg_temp.owner_try('truncate public.billing_payments cascade') like 'ZW004:%');
insert into k values ('PAY2', pg_temp.pay(pg_temp.kv('D1'), 10988, 'bill-pay-key-0010'));
select pg_temp.t('D10 full payment -> paid, balance 0; further payment refused',
  split_part(pg_temp.kv('PAY2'), '|', 3) = '0'
  and pg_temp.a1(format('select payment_state from public.billing_get_invoice(%L, %L)', pg_temp.kv('A'), pg_temp.kv('D1'))) = 'paid'
  and pg_temp.msg(pg_temp.pay(pg_temp.kv('D1'), 1, 'bill-pay-key-0011')) = 'amount_exceeds_balance');
select pg_temp.t('D11 payments on a draft are refused (ZW004 invoice_not_open)',
  pg_temp.msg(pg_temp.pay(pg_temp.draft(format('{%s}', pg_temp.kv('T3')), 'other', null, 'Fictional Payer', 'bill-d4-key-0001'), 100, 'bill-pay-key-0012')) = 'invoice_not_open');
select pg_temp.t('D12 audit rows carry ids / amounts only -- never the bill-to name, reference or note (R4)',
  not exists (select 1 from public.audit_events where entity_type in ('billing_invoice', 'billing_payment')
              and (coalesce(after_data::text, '') ~* 'Fictional Passenger|CHK-1001|fictional"' or coalesce(before_data::text, '') ~* 'Fictional Passenger')));

-- ================================================================= E. void (R2) + trips freed
insert into k values ('D5', pg_temp.draft(format('{%s}', pg_temp.kv('T4')), 'passenger', pg_temp.kv('P2')::uuid, null, 'bill-d5-key-0001'));
select pg_temp.a1(format($q$select (public.billing_update_invoice_draft(%L, %L, %s, 'Fictional Billing Passenger Two', null, null, null,
  jsonb_build_array(jsonb_build_object('trip_id', %L, 'source', 'trip', 'description', 'Ride', 'quantity', 1, 'unit_cents', 3000)), 0, null)).version::text$q$,
  pg_temp.kv('A'), pg_temp.kv('D5'), pg_temp.ver(pg_temp.kv('D5')), pg_temp.kv('T4')));
insert into k values ('D5n', pg_temp.a1(format('select (public.billing_issue_invoice(%L, %L, %s, null, null)).invoice_number::text', pg_temp.kv('A'), pg_temp.kv('D5'), pg_temp.ver(pg_temp.kv('D5')))));
select pg_temp.t('E1 second issued invoice gets number 2 (sequential per organization)', pg_temp.kv('D5n') = '2', pg_temp.kv('D5n'));
insert into k values ('E2a', pg_temp.a1(format('select (public.billing_void_invoice(%L, %L, %s, ''x'')).status', pg_temp.kv('A'), pg_temp.kv('D5'), pg_temp.ver(pg_temp.kv('D5')))));
insert into k values ('E2b', pg_temp.a1(format('select (public.billing_void_invoice(%L, %L, %s, ''Billed to the wrong person'')).status', pg_temp.kv('A'), pg_temp.kv('D5'), pg_temp.ver(pg_temp.kv('D5')))));
select pg_temp.t('E2 void needs a reason (ZW006); with a reason: void, number kept, trip released and billable again',
  pg_temp.msg(pg_temp.kv('E2a')) = 'reason_required'
  and pg_temp.kv('E2b') = 'void'
  and (select invoice_number = 2 and void_reason = 'Billed to the wrong person' from public.billing_invoices where id = pg_temp.kv('D5')::uuid)
  and (select released_at is not null from public.billing_invoice_trips where invoice_id = pg_temp.kv('D5')::uuid)
  and pg_temp.a1(format('select billable::text from public.billing_trip_status(%L, %L)', pg_temp.kv('A'), pg_temp.kv('T4'))) = 'true');
select pg_temp.t('E3 a void invoice is final: no payment, no un-void, owner cannot change the reason',
  pg_temp.msg(pg_temp.pay(pg_temp.kv('D5'), 100, 'bill-pay-key-0020')) = 'invoice_not_open'
  and pg_temp.owner_try(format('update public.billing_invoices set status = ''issued'' where id = %L', pg_temp.kv('D5'))) like 'ZW004:%'
  and pg_temp.owner_try(format('update public.billing_invoices set void_reason = ''changed'' where id = %L', pg_temp.kv('D5'))) like 'ZW004:%');
select pg_temp.t('E4 after void the trip can go on a new invoice (number 3 at issue)',
  pg_temp.code(pg_temp.draft(format('{%s}', pg_temp.kv('T4')), 'passenger', pg_temp.kv('P2')::uuid, null, 'bill-d6-key-0001')) = 'ok');

-- ================================================================= F. bill-to kinds (R1) + quote import (R3)
insert into k values ('DR', pg_temp.draft(format('{%s}', pg_temp.kv('T2')), 'requester', pg_temp.kv('R1')::uuid, null, 'bill-dr-key-0001'));
select pg_temp.t('F1 T2 is still on the issued invoice D1 -> refused (one active invoice per trip)',
  pg_temp.msg(pg_temp.kv('DR')) = 'trip_already_invoiced');
insert into k values ('T5', pg_temp.trip('T5', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed', pg_temp.kv('R1')::uuid, pg_temp.kv('FA')::uuid));
insert into k values ('DR2', pg_temp.draft(format('{%s}', pg_temp.kv('T5')), 'requester', pg_temp.kv('R1')::uuid, null, 'bill-dr-key-0002'));
select pg_temp.t('F2 bill-to requester linked through the trip''s request: requester name / phone / email snapshotted',
  (select bill_to_kind = 'requester' and bill_to_name = 'Fictional Daughter Payer' and bill_to_email = 'payer@example.test' and bill_to_phone = '(404) 555-0190'
   from public.billing_invoices where id = pg_temp.kv('DR2')::uuid), pg_temp.kv('DR2'));
select pg_temp.a1(format('select (public.billing_discard_invoice_draft(%L, %L, %s)).status', pg_temp.kv('A'), pg_temp.kv('DR2'), pg_temp.ver(pg_temp.kv('DR2'))));
insert into k values ('DF', pg_temp.draft(format('{%s}', pg_temp.kv('T5')), 'facility', pg_temp.kv('FA')::uuid, null, 'bill-df-key-0001'));
select pg_temp.t('F3 bill-to facility linked as the trip''s destination facility: name snapshotted',
  (select bill_to_kind = 'facility' and bill_to_name = 'Fictional Clinic A' from public.billing_invoices where id = pg_temp.kv('DF')::uuid), pg_temp.kv('DF'));
select pg_temp.a1(format('select (public.billing_discard_invoice_draft(%L, %L, %s)).status', pg_temp.kv('A'), pg_temp.kv('DF'), pg_temp.ver(pg_temp.kv('DF'))));

-- quote fixtures: Plus active for Org A, contact + opportunity attributed to R1 (and T5's request), a sent + accepted quote
delete from public.organization_modules where organization_id = pg_temp.kv('A')::uuid;
insert into public.organization_modules (organization_id, module, status, status_reason) values (pg_temp.kv('A')::uuid, 'plus', 'active', 'billing tests');
with c as (
  insert into public.plus_contacts (organization_id, display_name, phone, contact_kind, created_by)
  values (pg_temp.kv('A')::uuid, 'Fictional Daughter Payer', '(404) 555-0190', 'family_caregiver', pg_temp.kv('a1')::uuid) returning id)
insert into k select 'C', id::text from c;
with o as (
  insert into public.plus_opportunities (organization_id, title, source, primary_contact_id, created_by)
  values (pg_temp.kv('A')::uuid, 'Fictional dialysis rides', 'phone', pg_temp.kv('C')::uuid, pg_temp.kv('a1')::uuid) returning id)
insert into k select 'O', id::text from o;
insert into public.plus_request_attributions (request_id, organization_id, contact_id, opportunity_id, link_method, linked_by)
values (pg_temp.kv('R1')::uuid, pg_temp.kv('A')::uuid, pg_temp.kv('C')::uuid, pg_temp.kv('O')::uuid, 'linked_existing_request', pg_temp.kv('a1')::uuid);
insert into k values ('Q', pg_temp.a1(format($q$select (public.plus_create_quote(%L, %L, 'bill-quote-key-0001', 'quote', 'dialysis', false, 12.5,
  4000, 1500, 0, 0, 1000, 0, 0, 0, null, 500, null, current_date + 30)).quote_id::text$q$, pg_temp.kv('A'), pg_temp.kv('O'))));
select pg_temp.a1(format('select (public.plus_mark_quote_sent(%L, %L, %L, false)).status', pg_temp.kv('A'), pg_temp.kv('Q'),
  (select updated_at from public.plus_quotes where id = pg_temp.kv('Q')::uuid)));
insert into k values ('T8', pg_temp.trip('T8', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed'));
insert into k values ('QD', pg_temp.draft(format('{%s}', pg_temp.kv('T8')), 'other', null, 'Fictional Payer', 'bill-qd-key-0001', pg_temp.kv('Q')::uuid));
select pg_temp.t('F4 quote import refused when the quote''s opportunity is not linked to the trip''s request (T8 has none) -> ZW006 quote_not_linked',
  pg_temp.msg(pg_temp.kv('QD')) = 'quote_not_linked', pg_temp.kv('QD'));
insert into k values ('T6', pg_temp.trip('T6', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed', pg_temp.kv('R1')::uuid, pg_temp.kv('FA')::uuid));
insert into k values ('DQ', pg_temp.draft(format('{%s,%s}', pg_temp.kv('T5'), pg_temp.kv('T6')), 'requester', pg_temp.kv('R1')::uuid, null, 'bill-dq-key-0001', pg_temp.kv('Q')::uuid));
select pg_temp.t('F5 quote import: per trip, the quote''s non-zero components (base, mileage, mobility) INSTEAD of the trip line; discount x trips; never duplicated',
  pg_temp.code(pg_temp.kv('DQ')) = 'ok'
  and (select count(*) from public.billing_invoice_lines where invoice_id = pg_temp.kv('DQ')::uuid and source = 'quote') = 6
  and (select count(*) from public.billing_invoice_lines where invoice_id = pg_temp.kv('DQ')::uuid and source = 'trip') = 0
  and (select subtotal_cents = 2 * 6500 and discount_cents = 1000 and total_cents = 12000 from public.billing_invoices where id = pg_temp.kv('DQ')::uuid),
  pg_temp.kv('DQ'));
select pg_temp.t('F6 quote reference snapshotted (number + kind) and visible before issue; lines editable while draft',
  (select source_quote_id = pg_temp.kv('Q')::uuid and source_quote_number is not null and source_quote_kind = 'quote'
   from public.billing_invoices where id = pg_temp.kv('DQ')::uuid)
  and pg_temp.a1(format('select source_quote_number::text from public.billing_get_invoice(%L, %L)', pg_temp.kv('A'), pg_temp.kv('DQ'))) is not null);
select pg_temp.t('F7 a draft quote (not sent / accepted) cannot be imported (ZW004)',
  pg_temp.code(pg_temp.draft(format('{%s}', pg_temp.kv('T1')), 'other', null, 'x', 'bill-qx-key-0001',
    (select pg_temp.a1(format($q$select (public.plus_create_quote(%L, %L, 'bill-quote-key-0002', 'quote', 'dialysis', false, null,
      100, 0, 0, 0, 0, 0, 0, 0, null, 0, null, current_date + 30)).quote_id::text$q$, pg_temp.kv('A'), pg_temp.kv('O')))::uuid))) in ('ZW004', 'ZW006'));
-- Plus lapses: billing of an already imported quote keeps working (snapshot), new imports need Plus read
delete from public.organization_modules where organization_id = pg_temp.kv('A')::uuid;
select pg_temp.t('F8 without Plus: the draft with an imported quote still reads, edits and issues (Core billing independent of Plus)',
  pg_temp.a1(format('select source_quote_number::text from public.billing_get_invoice(%L, %L)', pg_temp.kv('A'), pg_temp.kv('DQ'))) is not null
  and pg_temp.code(pg_temp.a1(format('select (public.billing_issue_invoice(%L, %L, %s, null, null)).invoice_number::text', pg_temp.kv('A'), pg_temp.kv('DQ'), pg_temp.ver(pg_temp.kv('DQ'))))) = 'ok');
insert into k values ('T7', pg_temp.trip('T7', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed', pg_temp.kv('R1')::uuid));
select pg_temp.t('F9 without Plus a NEW quote import is refused (ZW002 quote_unavailable); a plain draft for the same trip still works',
  pg_temp.msg(pg_temp.draft(format('{%s}', pg_temp.kv('T7')), 'requester', pg_temp.kv('R1')::uuid, null, 'bill-q9-key-0001', pg_temp.kv('Q')::uuid)) = 'quote_unavailable'
  and pg_temp.code(pg_temp.draft(format('{%s}', pg_temp.kv('T7')), 'requester', pg_temp.kv('R1')::uuid, null, 'bill-q9-key-0002')) = 'ok');

-- R1 (PR review check A): a requester can be billed only for trips that ALL come from requests by that same requester
insert into public.transportation_requests (id, organization_id, requester_name, requester_relationship, requester_phone,
  pickup_description, destination_description, return_trip_needed, state, source, passenger_id) values
  ('70000000-0000-0000-0000-00000000b1a2', pg_temp.kv('A')::uuid, '  fictional daughter PAYER ', 'family', '404-555-0190', 'x', 'y', 'no', 'accepted', 'phone', pg_temp.kv('P1')::uuid),
  ('70000000-0000-0000-0000-00000000b1a3', pg_temp.kv('A')::uuid, 'Fictional Neighbour Requester', 'other', '(404) 555-0177', 'x', 'y', 'no', 'accepted', 'phone', pg_temp.kv('P1')::uuid);
insert into k values ('R2', '70000000-0000-0000-0000-00000000b1a2'), ('R3', '70000000-0000-0000-0000-00000000b1a3');
insert into k values
  ('T9', pg_temp.trip('T9', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed', pg_temp.kv('R1')::uuid)),
  ('T10', pg_temp.trip('T10', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed', pg_temp.kv('R2')::uuid)),
  ('T11', pg_temp.trip('T11', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed')),
  ('T12', pg_temp.trip('T12', pg_temp.kv('A')::uuid, pg_temp.kv('P1')::uuid, 'completed', pg_temp.kv('R3')::uuid));
select pg_temp.t('F10 requester R1 for {T9 (R1), T11 (no request)} -> ZW006 bill_to_not_linked (a trip without a request)',
  pg_temp.msg(pg_temp.draft(format('{%s,%s}', pg_temp.kv('T9'), pg_temp.kv('T11')), 'requester', pg_temp.kv('R1')::uuid, null, 'bill-f10-key-0001')) = 'bill_to_not_linked');
select pg_temp.t('F11 requester R1 for {T9 (R1), T12 (R3, another requester)} -> ZW006 bill_to_not_linked',
  pg_temp.msg(pg_temp.draft(format('{%s,%s}', pg_temp.kv('T9'), pg_temp.kv('T12')), 'requester', pg_temp.kv('R1')::uuid, null, 'bill-f11-key-0001')) = 'bill_to_not_linked');
select pg_temp.t('F12 requester R3 for {T9 (R1), T12 (R3)} -> refused too (the rule holds in both directions)',
  pg_temp.msg(pg_temp.draft(format('{%s,%s}', pg_temp.kv('T9'), pg_temp.kv('T12')), 'requester', pg_temp.kv('R3')::uuid, null, 'bill-f12-key-0001')) = 'bill_to_not_linked');
insert into k values ('DF13', pg_temp.draft(format('{%s,%s}', pg_temp.kv('T9'), pg_temp.kv('T10')), 'requester', pg_temp.kv('R1')::uuid, null, 'bill-f13-key-0001'));
select pg_temp.t('F13 two requests by the SAME requester (name / phone formatting differs) on one invoice -> allowed, R1 snapshot',
  pg_temp.code(pg_temp.kv('DF13')) = 'ok'
  and (select bill_to_kind = 'requester' and bill_to_name = 'Fictional Daughter Payer' from public.billing_invoices where id = pg_temp.kv('DF13')::uuid), pg_temp.kv('DF13'));
select pg_temp.t('F14 nothing was written by the refused requester drafts (T11 / T12 still billable)',
  not exists (select 1 from public.billing_invoice_trips where trip_id in (pg_temp.kv('T11')::uuid, pg_temp.kv('T12')::uuid)));
insert into public.transportation_requests (id, organization_id, requester_name, requester_relationship, requester_phone,
  pickup_description, destination_description, return_trip_needed, state, source, passenger_id) values
  ('70000000-0000-0000-0000-00000000b1b1', pg_temp.kv('B')::uuid, 'Fictional Daughter Payer', 'family', '(404) 555-0190', 'x', 'y', 'no', 'accepted', 'phone', pg_temp.kv('PB')::uuid);
select pg_temp.t('F15 another organization''s request (even with the same requester name / phone) cannot be the bill-to (ZW006)',
  pg_temp.msg(pg_temp.draft(format('{%s}', pg_temp.kv('T11')), 'requester', '70000000-0000-0000-0000-00000000b1b1'::uuid, null, 'bill-f15-key-0001')) = 'bill_to_not_linked');

-- ================================================================= G. cross-tenant reads (RLS)
select pg_temp.t('G1 Org B admin sees NO Org A billing rows through the tables (RLS)',
  pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, 'select count(*)::text from public.billing_invoices') = '0'
  and pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, 'select count(*)::text from public.billing_payments') = '0'
  and pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, 'select count(*)::text from public.billing_invoice_lines') = '0'
  and pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, 'select count(*)::text from public.billing_invoice_trips') = '0');
select pg_temp.t('G2 Org A dispatcher and driver see no billing rows (admin-only, D2)',
  pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, 'select count(*)::text from public.billing_invoices') = '0'
  and pg_temp.x('authenticated', pg_temp.kv('a3')::uuid, 'select count(*)::text from public.billing_payments') = '0');
select pg_temp.t('G3 Org A admin sees its own rows; Org B admin cannot read an Org A invoice through the RPC (ZW002)',
  pg_temp.a1('select count(*)::text from public.billing_invoices')::integer >= 3
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select status from public.billing_get_invoice(%L, %L)', pg_temp.kv('B'), pg_temp.kv('D1')))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select status from public.billing_get_invoice(%L, %L)', pg_temp.kv('A'), pg_temp.kv('D1')))) = 'ZW002');
select pg_temp.t('G4 Org B admin cannot pay / reverse / void an Org A invoice (ZW002 in either organization)',
  pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select (public.billing_record_payment(%L, %L, 1, 1, current_date, ''cash'', null, null, ''bill-b1-key-0001'')).paid_cents::text', pg_temp.kv('B'), pg_temp.kv('D1')))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select (public.billing_void_invoice(%L, %L, 1, ''nope nope'')).status', pg_temp.kv('B'), pg_temp.kv('D1')))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, format('select (public.billing_reverse_payment(%L, %L, 1, ''nope nope'', ''bill-b1-key-0002'')).paid_cents::text', pg_temp.kv('B'), split_part(pg_temp.kv('PAY2'), '|', 1)))) = 'ZW002');
select pg_temp.t('G5 summary + list reflect Org A only: outstanding 0 for D1 (paid), invoice list search by number',
  pg_temp.a1(format('select string_agg(invoice_number::text, '','') from public.billing_list_invoices(%L, ''all'', ''INV-1'', 25, 0)', pg_temp.kv('A'))) = '1'
  and pg_temp.a1(format('select payment_state from public.billing_list_invoices(%L, ''paid'', null, 25, 0) where invoice_id = %L', pg_temp.kv('A'), pg_temp.kv('D1'))) = 'paid');

-- ================================================================= H. trips untouched
select pg_temp.t('H1 billing never changed a trip (states of all fixture trips as inserted)',
  (select count(*) from public.trips where id in (pg_temp.kv('T1')::uuid, pg_temp.kv('T2')::uuid, pg_temp.kv('T3')::uuid, pg_temp.kv('T4')::uuid, pg_temp.kv('T5')::uuid, pg_temp.kv('T6')::uuid, pg_temp.kv('T7')::uuid, pg_temp.kv('T8')::uuid, pg_temp.kv('T9')::uuid, pg_temp.kv('T10')::uuid, pg_temp.kv('T11')::uuid, pg_temp.kv('T12')::uuid) and state = 'completed') = 12
  and (select state from public.trips where id = pg_temp.kv('TS')::uuid) = 'scheduled');

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' from k_results;
select n, name, detail from k_results where not ok order by n;
rollback;
