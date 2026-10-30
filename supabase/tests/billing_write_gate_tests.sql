-- NP-FIN-P1G -- deny-by-default financial-write gate tests. ROLLBACK-ONLY (one transaction, rolled back at the end).
--   docker exec -i supabase_db_NemrynS1Iso psql -U postgres -d postgres -f - < supabase/tests/billing_write_gate_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)". Run on a FRESH reset (the suite asserts
-- that nothing is enabled by the migrations). Fictional seed only: Org A admin a1, dispatcher a2, driver a3; Org B admin
-- b1; fictional platform admin d1.
\set ON_ERROR_STOP on
\pset pager off
begin;
select set_config('timezone', (select timezone from public.organizations where id = '10000000-0000-0000-0000-0000000000b1'), true);
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
create function pg_temp.code(p text) returns text language sql as $$ select case when p like 'ERR:%' then split_part(p, ':', 2) else 'ok' end; $$;
create function pg_temp.msg(p text) returns text language sql as $$ select case when p like 'ERR:%' then split_part(p, ':', 3) else p end; $$;
create function pg_temp.t(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into k_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;
create function pg_temp.kv(p text) returns text language sql as $$ select v from k where name = p; $$;
create function pg_temp.owner_try(p_stmt text) returns text language plpgsql as $$
begin execute p_stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end;
$$;
insert into k values
  ('A', '10000000-0000-0000-0000-0000000000a1'), ('B', '10000000-0000-0000-0000-0000000000b1'),
  ('a1', '20000000-0000-0000-0000-0000000000a1'), ('a2', '20000000-0000-0000-0000-0000000000a2'),
  ('a3', '20000000-0000-0000-0000-0000000000a3'), ('b1', '20000000-0000-0000-0000-0000000000b1'),
  ('d1', '20000000-0000-0000-0000-0000000000d1'), ('PB', '40000000-0000-0000-0000-0000000000b1');
create function pg_temp.b1(p_stmt text) returns text language sql as $$ select pg_temp.x('authenticated', pg_temp.kv('b1')::uuid, p_stmt); $$;
create function pg_temp.d1(p_stmt text) returns text language sql as $$ select pg_temp.x('authenticated', pg_temp.kv('d1')::uuid, p_stmt); $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone o.timezone)::date from public.organizations o where o.id = pg_temp.kv('B')::uuid; $$;
create function pg_temp.setg(p_org text, p_status text, p_class text, p_ref text, p_ver integer) returns text language sql as $$
  select pg_temp.d1(format('select (r).status || ''|'' || (r).version || ''|'' || (r).changed from (select public.platform_set_billing_write_enablement(%L, %L, %L, %L, ''Fictional test change'', %s) r) s',
    pg_temp.kv(p_org), p_status, p_class, p_ref, coalesce(p_ver::text, 'null')));
$$;
create function pg_temp.ver(p_org text) returns integer language sql as $$ select version from public.billing_write_enablements where organization_id = pg_temp.kv(p_org)::uuid; $$;
create function pg_temp.trip(p_label text) returns uuid language sql as $$
  insert into public.trips (organization_id, passenger_id, state, pickup_description, destination_description, scheduled_pickup_at, completed_at)
  values (pg_temp.kv('B')::uuid, pg_temp.kv('PB')::uuid, 'completed', p_label || ' pickup', p_label || ' destination', now() - interval '1 day', now() - interval '20 hours')
  returning id;
$$;
create function pg_temp.inv_ver(p text) returns integer language sql as $$ select version from public.billing_invoices where id = p::uuid; $$;

-- ================================================================= 0. deny by default from the migration itself
select pg_temp.t('G0 the migrations enable NO organization (table empty on a fresh reset; Zenward / any real tenant never enabled automatically)',
  (select count(*) from public.billing_write_enablements) = 0 and (select count(*) from public.billing_write_enablement_history) = 0);
select pg_temp.t('G0b with no row, an Organization Admin cannot create a draft (ZW004 billing_not_enabled)',
  pg_temp.msg(pg_temp.b1(format('select (public.billing_create_invoice_draft(%L, %L::uuid[], ''passenger'', %L, null, null, ''gate-draft-0000'')).status',
    pg_temp.kv('B'), '{' || pg_temp.trip('GT-T0') || '}', pg_temp.kv('PB')))) = 'billing_not_enabled');

-- ================================================================= 1. platform-only management
select pg_temp.t('M1 an Organization Admin cannot enable their OWN organization (ZW002); neither can another tenant, a dispatcher or a driver',
  pg_temp.code(pg_temp.b1(format('select (public.platform_set_billing_write_enablement(%L, ''enabled'', ''synthetic'', null, ''self enable'', 0)).status', pg_temp.kv('B')))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a1')::uuid, format('select (public.platform_set_billing_write_enablement(%L, ''enabled'', ''synthetic'', null, ''other tenant'', 0)).status', pg_temp.kv('B')))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, format('select (public.platform_set_billing_write_enablement(%L, ''enabled'', ''synthetic'', null, ''dispatcher'', 0)).status', pg_temp.kv('A')))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a3')::uuid, format('select (public.platform_set_billing_write_enablement(%L, ''enabled'', ''synthetic'', null, ''driver'', 0)).status', pg_temp.kv('A')))) = 'ZW002');
select pg_temp.t('M2 anon cannot call it (42501); unauthenticated -> ZW001',
  pg_temp.code(pg_temp.x('anon', null, format('select (public.platform_set_billing_write_enablement(%L, ''enabled'', ''synthetic'', null, ''anon'', 0)).status', pg_temp.kv('B')))) = '42501'
  and pg_temp.code(pg_temp.x('authenticated', null, format('select (public.platform_set_billing_write_enablement(%L, ''enabled'', ''synthetic'', null, ''nobody'', 0)).status', pg_temp.kv('B')))) = 'ZW001');
select pg_temp.t('M3 clients cannot write the enablement tables directly (42501); history is not client-readable',
  pg_temp.code(pg_temp.b1(format('insert into public.billing_write_enablements (organization_id, status, data_class, reason) values (%L, ''enabled'', ''synthetic'', ''direct'') returning status', pg_temp.kv('B')))) = '42501'
  and pg_temp.code(pg_temp.b1(format('update public.billing_write_enablements set status = ''enabled'' where organization_id = %L returning status', pg_temp.kv('B')))) = '42501'
  and pg_temp.code(pg_temp.b1('select count(*)::text from public.billing_write_enablement_history')) = '42501');
select pg_temp.t('M4 live enablement needs an NP-LAUNCH-02 approval reference (RPC ZW006; direct owner insert refused by CHECK 23514)',
  pg_temp.msg(pg_temp.setg('A', 'enabled', 'live', null, 0)) = 'live_requires_launch_approval'
  and pg_temp.msg(pg_temp.setg('A', 'enabled', 'live', 'owner said ok', 0)) = 'live_requires_launch_approval'
  and pg_temp.owner_try(format('insert into public.billing_write_enablements (organization_id, status, data_class, reason) values (%L, ''enabled'', ''live'', ''bypass'')', pg_temp.kv('A'))) like '23514:%'
  and (select count(*) from public.billing_write_enablements) = 0);
insert into k values ('E1', pg_temp.setg('B', 'enabled', 'synthetic', null, 0));
select pg_temp.t('M5 the platform admin enables Org B (synthetic): version 1, history row, audit row with no free text',
  pg_temp.kv('E1') = 'enabled|1|true'
  and (select count(*) from public.billing_write_enablement_history where organization_id = pg_temp.kv('B')::uuid and version = 1 and changed_by = pg_temp.kv('d1')::uuid) = 1
  and (select count(*) from public.audit_events where organization_id = pg_temp.kv('B')::uuid and action = 'platform_billing_write_enablement_changed' and reason is null
         and after_data ->> 'status' = 'enabled' and after_data::text !~ 'Fictional test change') = 1, pg_temp.kv('E1'));
select pg_temp.t('M6 versioned: a stale version is refused (ZW003); the same state again changes nothing; rows are never deleted / truncated',
  pg_temp.code(pg_temp.setg('B', 'disabled', 'synthetic', null, 0)) = 'ZW003'
  and pg_temp.setg('B', 'enabled', 'synthetic', null, 1) = 'enabled|1|false'
  and pg_temp.owner_try(format('delete from public.billing_write_enablements where organization_id = %L', pg_temp.kv('B'))) = 'ZW004:enablement_rows_are_kept'
  and pg_temp.owner_try(format('update public.billing_write_enablements set status = ''disabled'' where organization_id = %L', pg_temp.kv('B'))) like 'ZW003:%'
  and pg_temp.owner_try('truncate public.billing_write_enablements') like 'ZW004:%'
  and pg_temp.owner_try('delete from public.billing_write_enablement_history') like 'ZW004:%');
select pg_temp.t('M7 a live enablement WITH the approval reference is accepted (fictional org; then reverted to synthetic)',
  pg_temp.setg('A', 'enabled', 'live', 'NP-LAUNCH-02 GO 2026-11-01 (fictional test)', 0) = 'enabled|1|true'
  and pg_temp.setg('A', 'enabled', 'synthetic', null, 1) = 'enabled|2|true');

-- ================================================================= 2. Org B financial records created WHILE enabled
insert into k values ('TB1', pg_temp.trip('GT-T1')::text), ('TB2', pg_temp.trip('GT-T2')::text), ('TB3', pg_temp.trip('GT-T3')::text), ('TB4', pg_temp.trip('GT-T4')::text);
create function pg_temp.issued_b(p_trip text, p_key text, p_cents bigint) returns text language plpgsql as $$
declare v_inv text;
begin
  v_inv := pg_temp.b1(format('select (r).invoice_id::text from (select public.billing_create_invoice_draft(%L, %L::uuid[], ''passenger'', %L, null, null, %L) r) s', pg_temp.kv('B'), '{' || p_trip || '}', pg_temp.kv('PB'), p_key));
  perform pg_temp.b1(format('select (public.billing_update_invoice_draft(%L, %L, %s, ''Payer'', null, null, null, %L::jsonb, 0, null)).status', pg_temp.kv('B'), v_inv, pg_temp.inv_ver(v_inv),
    jsonb_build_array(jsonb_build_object('description', 'Ride', 'quantity', '1', 'unit_cents', p_cents, 'trip_id', p_trip, 'source', 'trip'))));
  perform pg_temp.b1(format('select (public.billing_issue_invoice(%L, %L, %s, %L::date, null)).status', pg_temp.kv('B'), v_inv, pg_temp.inv_ver(v_inv), pg_temp.today()));
  return v_inv;
end;
$$;
insert into k values ('IB1', pg_temp.issued_b(pg_temp.kv('TB1'), 'gate-inv-0001', 5000)), ('IB2', pg_temp.issued_b(pg_temp.kv('TB2'), 'gate-inv-0002', 3000));
insert into k values ('DB', pg_temp.b1(format('select (r).invoice_id::text from (select public.billing_create_invoice_draft(%L, %L::uuid[], ''passenger'', %L, null, null, ''gate-draft-0003'') r) s', pg_temp.kv('B'), '{' || pg_temp.kv('TB3') || '}', pg_temp.kv('PB'))));
select pg_temp.b1(format('select (public.billing_update_invoice_draft(%L, %L, %s, ''Payer'', null, null, null, %L::jsonb, 0, null)).status', pg_temp.kv('B'), pg_temp.kv('DB'), pg_temp.inv_ver(pg_temp.kv('DB')),
  jsonb_build_array(jsonb_build_object('description', 'Ride', 'quantity', '1', 'unit_cents', 2000, 'trip_id', pg_temp.kv('TB3'), 'source', 'trip')))) is not null as draft_line;
insert into k values ('PAY', pg_temp.b1(format('select (r).payment_id::text from (select public.billing_record_payment(%L, %L, %s, 1000, %L::date, ''check'', ''CHK-G1'', null, ''gate-pay-0001'') r) s', pg_temp.kv('B'), pg_temp.kv('IB1'), pg_temp.inv_ver(pg_temp.kv('IB1')), pg_temp.today())));
insert into k values ('RC', pg_temp.b1(format('select (r).receipt_id::text from (select public.billing_record_receipt(%L, null, ''passenger'', %L, null, 4000, 0, %L::date, ''cash'', null, null, null, false, ''[]''::jsonb, null, false, ''gate-rcpt-0001'') r) s', pg_temp.kv('B'), pg_temp.kv('PB'), pg_temp.today())));
insert into k values ('RF', pg_temp.b1(format('select (r).entry_id::text from (select public.billing_record_refund(%L, %L, 500, %L::date, ''cash'', null, null, ''Fictional refund'', ''gate-ref-0001'') r) s', pg_temp.kv('B'), pg_temp.kv('RC'), pg_temp.today())));
insert into k values ('RC2', pg_temp.b1(format('select (r).receipt_id::text from (select public.billing_record_receipt(%L, null, ''passenger'', %L, null, 700, 0, %L::date, ''cash'', null, null, null, false, ''[]''::jsonb, null, false, ''gate-rcpt-0002'') r) s', pg_temp.kv('B'), pg_temp.kv('PB'), pg_temp.today())));
select pg_temp.t('W0 while enabled, Org B can invoice, pay, receive, refund (fixtures for the disabled checks)',
  pg_temp.kv('IB1') ~ '^[0-9a-f-]{36}$' and pg_temp.kv('IB2') ~ '^[0-9a-f-]{36}$' and pg_temp.kv('DB') ~ '^[0-9a-f-]{36}$'
  and pg_temp.kv('PAY') ~ '^[0-9a-f-]{36}$' and pg_temp.kv('RC') ~ '^[0-9a-f-]{36}$' and pg_temp.kv('RF') ~ '^[0-9a-f-]{36}$' and pg_temp.kv('RC2') ~ '^[0-9a-f-]{36}$',
  concat_ws(' ', pg_temp.kv('IB1'), pg_temp.kv('DB'), pg_temp.kv('PAY'), pg_temp.kv('RC'), pg_temp.kv('RF')));

-- ================================================================= 3. DISABLE Org B -> every financial write path refused
insert into k values ('E2', pg_temp.setg('B', 'disabled', 'synthetic', null, 1));
create function pg_temp.denied(p_stmt text) returns boolean language sql as $$ select pg_temp.msg(pg_temp.b1(p_stmt)) = 'billing_not_enabled'; $$;
create temp table snap as
  select (select count(*) from public.billing_invoices where organization_id = '10000000-0000-0000-0000-0000000000b1') inv,
         (select count(*) from public.billing_invoice_lines where organization_id = '10000000-0000-0000-0000-0000000000b1') lines,
         (select count(*) from public.billing_receipts where organization_id = '10000000-0000-0000-0000-0000000000b1') rcpt,
         (select count(*) from public.billing_allocations where organization_id = '10000000-0000-0000-0000-0000000000b1') alloc,
         (select count(*) from public.billing_refunds where organization_id = '10000000-0000-0000-0000-0000000000b1') refunds,
         (select string_agg(id::text || version || status, ',' order by id) from public.billing_invoices where organization_id = '10000000-0000-0000-0000-0000000000b1') inv_state;
select pg_temp.t('D1 NP-BILL-P1 writes refused while disabled: create / update / discard draft, issue, void, record payment (wrapper), reverse payment (wrapper)',
  pg_temp.kv('E2') = 'disabled|2|true'
  and pg_temp.denied(format('select (public.billing_create_invoice_draft(%L, %L::uuid[], ''passenger'', %L, null, null, ''gate-draft-0004'')).status', pg_temp.kv('B'), '{' || pg_temp.kv('TB4') || '}', pg_temp.kv('PB')))
  and pg_temp.denied(format('select (public.billing_update_invoice_draft(%L, %L, %s, ''Payer'', null, null, null, ''[]''::jsonb, 0, null)).status', pg_temp.kv('B'), pg_temp.kv('DB'), pg_temp.inv_ver(pg_temp.kv('DB'))))
  and pg_temp.denied(format('select (public.billing_discard_invoice_draft(%L, %L, %s)).status', pg_temp.kv('B'), pg_temp.kv('DB'), pg_temp.inv_ver(pg_temp.kv('DB'))))
  and pg_temp.denied(format('select (public.billing_issue_invoice(%L, %L, %s, null, null)).status', pg_temp.kv('B'), pg_temp.kv('DB'), pg_temp.inv_ver(pg_temp.kv('DB'))))
  and pg_temp.denied(format('select (public.billing_void_invoice(%L, %L, %s, ''void it'')).status', pg_temp.kv('B'), pg_temp.kv('IB2'), pg_temp.inv_ver(pg_temp.kv('IB2'))))
  and pg_temp.denied(format('select (public.billing_record_payment(%L, %L, %s, 100, %L::date, ''cash'', null, null, ''gate-pay-0002'')).paid_cents::text', pg_temp.kv('B'), pg_temp.kv('IB1'), pg_temp.inv_ver(pg_temp.kv('IB1')), pg_temp.today()))
  and pg_temp.denied(format('select (public.billing_reverse_payment(%L, %L, %s, ''bounced'', ''gate-rev-0001'')).paid_cents::text', pg_temp.kv('B'), pg_temp.kv('PAY'), pg_temp.inv_ver(pg_temp.kv('IB1')))),
  pg_temp.kv('E2'));
select pg_temp.t('D2 FIN-P1 writes refused while disabled: record receipt, allocate, unapply, refund, refund correction, receipt reversal, evidence',
  pg_temp.denied(format('select (public.billing_record_receipt(%L, null, ''passenger'', %L, null, 100, 0, %L::date, ''cash'', null, null, null, false, ''[]''::jsonb, null, false, ''gate-rcpt-0003'')).changed::text', pg_temp.kv('B'), pg_temp.kv('PB'), pg_temp.today()))
  and pg_temp.denied(format('select (public.billing_allocate_receipt(%L, %L, %L::jsonb, null, ''gate-alloc-0001'')).changed::text', pg_temp.kv('B'), pg_temp.kv('RC'), jsonb_build_array(jsonb_build_object('invoice_id', pg_temp.kv('IB2'), 'amount_cents', 100))))
  and pg_temp.denied(format('select (public.billing_unapply_allocation(%L, %L, ''wrong invoice'', ''gate-unap-0001'')).changed::text', pg_temp.kv('B'), pg_temp.kv('PAY')))
  and pg_temp.denied(format('select (public.billing_record_refund(%L, %L, 100, %L::date, ''cash'', null, null, ''Refund it'', ''gate-ref-0002'')).changed::text', pg_temp.kv('B'), pg_temp.kv('RC'), pg_temp.today()))
  and pg_temp.denied(format('select (public.billing_reverse_refund(%L, %L, ''entered twice'', ''gate-rrv-0001'')).changed::text', pg_temp.kv('B'), pg_temp.kv('RF')))
  and pg_temp.denied(format('select (public.billing_reverse_receipt(%L, %L, ''entry_error'', ''entered twice'', ''gate-rvr-0001'')).changed::text', pg_temp.kv('B'), pg_temp.kv('RC2')))
  and pg_temp.denied(format('select (public.billing_add_receipt_evidence(%L, %L, ''evidence_document_held'')).changed::text', pg_temp.kv('B'), pg_temp.kv('RC'))));
select pg_temp.t('D3 nothing changed while disabled (counts and every invoice version / status identical)',
  (select inv from snap) = (select count(*) from public.billing_invoices where organization_id = pg_temp.kv('B')::uuid)
  and (select lines from snap) = (select count(*) from public.billing_invoice_lines where organization_id = pg_temp.kv('B')::uuid)
  and (select rcpt from snap) = (select count(*) from public.billing_receipts where organization_id = pg_temp.kv('B')::uuid)
  and (select alloc from snap) = (select count(*) from public.billing_allocations where organization_id = pg_temp.kv('B')::uuid)
  and (select refunds from snap) = (select count(*) from public.billing_refunds where organization_id = pg_temp.kv('B')::uuid)
  and (select inv_state from snap) = (select string_agg(id::text || version || status, ',' order by id) from public.billing_invoices where organization_id = pg_temp.kv('B')::uuid));
select pg_temp.t('D4 reads still work while disabled: invoice, list, ledger, receipts, receipt detail, summaries, trip status, write status = false',
  pg_temp.code(pg_temp.b1(format('select status from public.billing_get_invoice(%L, %L)', pg_temp.kv('B'), pg_temp.kv('IB1')))) = 'ok'
  and pg_temp.b1(format('select count(*)::text from public.billing_list_invoices(%L, ''all'', null, 50, 0)', pg_temp.kv('B')))::integer >= 3
  and pg_temp.b1(format('select count(*)::text from public.billing_get_invoice_ledger(%L, %L)', pg_temp.kv('B'), pg_temp.kv('IB1'))) = '1'
  and pg_temp.b1(format('select count(*)::text from public.billing_list_receipts(%L, ''all'', null, 50, 0)', pg_temp.kv('B')))::integer >= 3
  and pg_temp.code(pg_temp.b1(format('select public.billing_get_receipt(%L, %L)::text', pg_temp.kv('B'), pg_temp.kv('RC')))) = 'ok'
  and pg_temp.code(pg_temp.b1(format('select outstanding_cents::text from public.billing_summary(%L)', pg_temp.kv('B')))) = 'ok'
  and pg_temp.code(pg_temp.b1(format('select credit_cents::text from public.billing_ledger_summary(%L)', pg_temp.kv('B')))) = 'ok'
  and pg_temp.code(pg_temp.b1(format('select billable::text from public.billing_trip_status(%L, %L)', pg_temp.kv('B'), pg_temp.kv('TB1')))) = 'ok'
  and pg_temp.b1(format('select enabled::text from public.billing_write_status(%L)', pg_temp.kv('B'))) = 'false');

-- ================================================================= 4. direct-write bypass (table owner) refused on EVERY gated table
select pg_temp.t('B1 direct owner writes to every financial table of a DISABLED organization are refused by the gate first (ZW004 billing_not_enabled)',
  pg_temp.owner_try(format('insert into public.billing_invoices (organization_id, passenger_id, bill_to_kind, bill_to_name, idempotency_key, created_by) values (%L, %L, ''other'', ''x'', ''owner-gate-0001'', %L)', pg_temp.kv('B'), pg_temp.kv('PB'), pg_temp.kv('b1'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('update public.billing_invoices set version = version where id = %L', pg_temp.kv('IB1'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('delete from public.billing_invoices where id = %L', pg_temp.kv('DB'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('update public.billing_invoice_lines set description = description where invoice_id = %L', pg_temp.kv('DB'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('delete from public.billing_invoice_trips where invoice_id = %L', pg_temp.kv('DB'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('update public.billing_invoice_counters set next_number = next_number where organization_id = %L', pg_temp.kv('B'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('update public.billing_receipt_counters set next_number = next_number where organization_id = %L', pg_temp.kv('B'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('insert into public.billing_receipts (organization_id, receipt_number, payer_kind, payer_name, gross_cents, received_on, method, idempotency_key, recorded_by) values (%L, 999, ''other'', ''x'', 100, current_date, ''cash'', ''owner-gate-0002'', %L)', pg_temp.kv('B'), pg_temp.kv('b1'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('insert into public.billing_allocations (organization_id, receipt_id, invoice_id, kind, amount_cents, request_key, request_seq, created_by) values (%L, %L, %L, ''apply'', 1, ''owner-gate-0003'', 1, %L)', pg_temp.kv('B'), pg_temp.kv('RC'), pg_temp.kv('IB2'), pg_temp.kv('b1'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('insert into public.billing_refunds (organization_id, receipt_id, refund_seq, amount_cents, refunded_on, method, reason, idempotency_key, recorded_by) values (%L, %L, 9, 1, current_date, ''cash'', ''bypass'', ''owner-gate-0004'', %L)', pg_temp.kv('B'), pg_temp.kv('RC'), pg_temp.kv('b1'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('insert into public.billing_refund_reversals (organization_id, refund_id, receipt_id, reason, idempotency_key, reversed_by) values (%L, %L, %L, ''bypass'', ''owner-gate-0005'', %L)', pg_temp.kv('B'), pg_temp.kv('RF'), pg_temp.kv('RC'), pg_temp.kv('b1'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('insert into public.billing_receipt_reversals (organization_id, receipt_id, reason_code, reason, idempotency_key, reversed_by) values (%L, %L, ''other'', ''bypass'', ''owner-gate-0006'', %L)', pg_temp.kv('B'), pg_temp.kv('RC2'), pg_temp.kv('b1'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('insert into public.billing_assurance_events (organization_id, receipt_id, kind, source, actor_id) values (%L, %L, ''evidence_document_held'', ''staff'', %L)', pg_temp.kv('B'), pg_temp.kv('RC'), pg_temp.kv('b1'))) = 'ZW004:billing_not_enabled'
  and pg_temp.owner_try(format('insert into public.billing_payments (organization_id, invoice_id, entry_kind, amount_cents, received_on, method, idempotency_key, recorded_by) values (%L, %L, ''payment'', 1, current_date, ''cash'', ''owner-gate-0007'', %L)', pg_temp.kv('B'), pg_temp.kv('IB1'), pg_temp.kv('b1'))) = 'ZW004:billing_not_enabled');
select pg_temp.t('B2 STRUCTURAL: every financial table (public.billing_* except the gate''s own tables) has the gate as a BEFORE ROW INSERT/UPDATE/DELETE trigger that fires first',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'billing\_%'
      and c.relname not in ('billing_write_enablements', 'billing_write_enablement_history')
      and not exists (select 1 from pg_trigger tg where tg.tgrelid = c.oid and tg.tgname = 'a_billing_write_gate'
                        and tg.tgfoid = 'public._billing_write_gate()'::regprocedure and not tg.tgisinternal
                        and (tg.tgtype & 1) = 1 and (tg.tgtype & 2) = 2 and (tg.tgtype & 28) = 28))
  and (select count(*) from pg_trigger where tgname = 'a_billing_write_gate') = 12
  and not exists (select 1 from pg_trigger t2 where t2.tgrelid in (select tgrelid from pg_trigger where tgname = 'a_billing_write_gate')
                    and not t2.tgisinternal and (t2.tgtype & 2) = 2 and (t2.tgtype & 1) = 1 and t2.tgname < 'a_billing_write_gate'));
select pg_temp.t('B3 STRUCTURAL: every table any billing function writes is a gated financial table, the gate''s own tables, or audit_events',
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
      lateral regexp_matches(p.prosrc, '(insert\s+into|update|delete\s+from)\s+(?:public\.)?([a-z_]+)', 'gi') m
    where n.nspname = 'public' and (p.proname like 'billing\_%' or p.proname like '\_billing\_%' or p.proname like 'platform\_set\_billing\_%')
      and exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = lower(m[2]))
      and lower(m[2]) not in ('audit_events', 'billing_write_enablements', 'billing_write_enablement_history')
      and not exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
                      where c.relnamespace = 'public'::regnamespace and c.relname = lower(m[2]) and tg.tgname = 'a_billing_write_gate')));

-- ================================================================= 5. re-enable, tenant isolation, status
insert into k values ('E3', pg_temp.setg('B', 'enabled', 'synthetic', null, 2));
select pg_temp.t('R1 re-enabled: writes work again (record receipt), and version history is complete (1 enabled, 2 disabled, 3 enabled)',
  pg_temp.kv('E3') = 'enabled|3|true'
  and pg_temp.code(pg_temp.b1(format('select (public.billing_record_receipt(%L, null, ''passenger'', %L, null, 100, 0, %L::date, ''cash'', null, null, null, false, ''[]''::jsonb, null, false, ''gate-rcpt-0004'')).changed::text', pg_temp.kv('B'), pg_temp.kv('PB'), pg_temp.today()))) = 'ok'
  and (select string_agg(version || ':' || status, ',' order by version) from public.billing_write_enablement_history where organization_id = pg_temp.kv('B')::uuid) = '1:enabled,2:disabled,3:enabled');
select pg_temp.t('T1 tenant isolation: no tenant role can read the enablement table at all (42501); enabling Org B never enables another organization; status of another organization -> ZW002',
  pg_temp.code(pg_temp.b1('select count(*)::text from public.billing_write_enablements')) = '42501'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a1')::uuid, 'select count(*)::text from public.billing_write_enablements')) = '42501'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, 'select count(*)::text from public.billing_write_enablements')) = '42501'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a3')::uuid, 'select count(*)::text from public.billing_write_enablements')) = '42501'
  and not public._billing_write_enabled('10000000-0000-0000-0000-0000000000f1')
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a2')::uuid, format('select enabled::text from public.billing_write_status(%L)', pg_temp.kv('A')))) = 'ZW002'
  and pg_temp.code(pg_temp.b1(format('select enabled::text from public.billing_write_status(%L)', pg_temp.kv('A')))) = 'ZW002');
select pg_temp.t('V1 ZD-286: the tenant-facing status returns ONLY enabled / version / set_at (no reason, approval_ref or data class); the full row is Platform-Admin-only',
  (select string_agg(a.n, ',' order by a.i) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, i)
     where p.oid = 'public.billing_write_status(uuid)'::regprocedure and a.m = 't') = 'enabled,version,set_at'
  and pg_temp.b1(format('select row_to_json(s)::text from public.billing_write_status(%L) s', pg_temp.kv('B'))) !~ 'Fictional test change|approval|reason|synthetic|data_class'
  and pg_temp.code(pg_temp.b1(format('select reason from public.platform_get_billing_write_enablement(%L)', pg_temp.kv('B')))) = 'ZW002'
  and pg_temp.code(pg_temp.x('authenticated', pg_temp.kv('a1')::uuid, format('select reason from public.platform_get_billing_write_enablement(%L)', pg_temp.kv('A')))) = 'ZW002'
  and pg_temp.code(pg_temp.x('anon', null, format('select reason from public.platform_get_billing_write_enablement(%L)', pg_temp.kv('B')))) = '42501'
  and pg_temp.d1(format('select reason || ''|'' || data_class || ''|'' || version from public.platform_get_billing_write_enablement(%L)', pg_temp.kv('B'))) = 'Fictional test change|synthetic|3');
select pg_temp.t('T2 an organization with no row stays denied even with an ACTIVE Plus entitlement (organization_modules is not the gate); no real tenant enabled',
  pg_temp.owner_try($q$insert into public.organization_modules (organization_id, module, status, status_reason) values ('10000000-0000-0000-0000-0000000000f1', 'plus', 'active', 'gate test')
                       on conflict (organization_id, module) do update set status = 'active'$q$) = 'ok'
  and not public._billing_write_enabled('10000000-0000-0000-0000-0000000000f1')
  and pg_temp.owner_try($q$insert into public.billing_invoice_counters (organization_id) values ('10000000-0000-0000-0000-0000000000f1')$q$) = 'ZW004:billing_not_enabled'
  and not exists (select 1 from public.billing_write_enablements e join public.organizations o on o.id = e.organization_id where o.name ilike '%zenward%')
  and (select count(*) from public.billing_write_enablements) = 2);

select format(' SUMMARY (failures = %s of %s tests)', count(*) filter (where not ok), count(*)) from k_results;
rollback;
