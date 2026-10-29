-- NP-FIN-P1 -- EMERGENCY REVERSAL (prepared, NOT executed). Restores NP-BILL-P1 exactly and removes every FIN-P1 object.
-- VALID ONLY WHILE THE FIN-P1 LEDGER IS EMPTY: the first statement refuses (and rolls everything back) if any receipt,
-- allocation, refund, reversal or assurance event exists. After the first real receipt the policy is FORWARD-FIX ONLY.
-- Requires explicit owner authorization (docs/reports/NP-FIN-P1-migration-preflight.txt section 6). Run as one transaction:
--   supabase db query --linked -f docs/reports/NP-FIN-P1-emergency-reversal.sql      (owner-run only)
begin;

do $$
begin
  if exists (select 1 from public.billing_receipts) or exists (select 1 from public.billing_allocations)
     or exists (select 1 from public.billing_refunds) or exists (select 1 from public.billing_refund_reversals)
     or exists (select 1 from public.billing_receipt_reversals) or exists (select 1 from public.billing_assurance_events) then
    raise exception 'NP-FIN-P1 reversal refused: the ledger holds rows -- forward-fix only';
  end if;
end;
$$;

-- 1. restore the NP-BILL-P1 definitions (verbatim from 20261027100000 / 20261027110000)
create or replace function public._billing_payments_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_orig public.billing_payments%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'payment_immutable' using errcode = 'ZW004';   -- append-only: never updated or deleted
  end if;
  select i.status into v_status from public.billing_invoices i where i.id = new.invoice_id;
  if v_status is distinct from 'issued' then
    raise exception 'invoice_not_open' using errcode = 'ZW004';
  end if;
  if new.entry_kind = 'reversal' then
    select * into v_orig from public.billing_payments p where p.id = new.reverses_payment_id;
    if v_orig.entry_kind is distinct from 'payment' or v_orig.amount_cents is distinct from new.amount_cents then
      raise exception 'invalid_input' using errcode = 'ZW006';   -- a reversal mirrors exactly one payment
    end if;
  end if;
  return new;
end;
$$;

comment on function public._billing_payments_guard() is
  'NP-BILL-P1. INTERNAL trigger: the ledger is append-only (UPDATE / DELETE -> ZW004); entries only on an ISSUED invoice; a reversal mirrors exactly one payment of the same invoice (amount equal; FK + unique enforce same invoice and once).';

comment on table public.billing_payments is
  'NP-BILL-P1. Append-only manual payment ledger (no UPDATE / DELETE, ever -- trigger). entry_kind payment (method, date, reference) or reversal (corrects ONE payment of the same invoice, reason required, once). A reversal corrects the ledger; it does not execute or prove a refund. Paid = sum(payment) - sum(reversal). No card data.';

create or replace function public._billing_paid_cents(p_invoice_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case when p.entry_kind = 'payment' then p.amount_cents else -p.amount_cents end), 0)::bigint
  from public.billing_payments p where p.invoice_id = p_invoice_id;
$$;

comment on function public._billing_paid_cents(uuid) is 'NP-BILL-P1. INTERNAL. Net paid = payments - reversals (never stored).';

create or replace function public.billing_record_payment(
  p_organization_id uuid,
  p_invoice_id uuid,
  p_expected_version integer,
  p_amount_cents bigint,
  p_received_on date,
  p_method text,
  p_reference text,
  p_note text,
  p_idempotency_key text
)
returns public.billing_payment_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_prior public.billing_payments%rowtype;
  v_inv public.billing_invoices%rowtype;
  v_paid bigint;
  v_today date := public._billing_org_today(p_organization_id);
  v_pay public.billing_payments%rowtype;
  v_result public.billing_payment_write_result;
begin
  perform public._billing_require_admin(p_organization_id);
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-payment:' || p_organization_id::text || ':' || v_key)::bigint);

  select * into v_prior from public.billing_payments p where p.organization_id = p_organization_id and p.idempotency_key = v_key;
  if found then
    if v_prior.invoice_id = p_invoice_id and v_prior.entry_kind = 'payment' and v_prior.amount_cents = p_amount_cents then
      select i.* into v_inv from public.billing_invoices i where i.id = v_prior.invoice_id;
      v_paid := public._billing_paid_cents(v_inv.id);
      v_result := (v_prior.id, v_inv.id, v_paid, v_inv.total_cents - v_paid, v_inv.version, false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  v_inv := public._billing_lock_invoice(p_organization_id, p_invoice_id);
  if v_inv.status <> 'issued' then
    raise exception 'invoice_not_open' using errcode = 'ZW004';
  end if;
  if p_expected_version is null or p_expected_version <> v_inv.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  v_paid := public._billing_paid_cents(v_inv.id);
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = 'ZW006';
  end if;
  if p_amount_cents > v_inv.total_cents - v_paid then
    raise exception 'amount_exceeds_balance' using errcode = 'ZW006';   -- no overpayment (D5)
  end if;
  if p_received_on is null or p_received_on > v_today or p_received_on < v_inv.issue_date - 365 then
    raise exception 'invalid_dates' using errcode = 'ZW006';
  end if;

  begin
    insert into public.billing_payments (organization_id, invoice_id, entry_kind, amount_cents, received_on, method, reference, note,
      idempotency_key, recorded_by)
    values (p_organization_id, v_inv.id, 'payment', p_amount_cents, p_received_on, p_method,
      nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), v_key, auth.uid())
    returning * into v_pay;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;
  update public.billing_invoices set version = version + 1 where id = v_inv.id returning * into v_inv;
  v_paid := v_paid + p_amount_cents;
  perform public._billing_audit(p_organization_id, 'billing_payment', v_pay.id, 'billing_payment_recorded', null,
    jsonb_build_object('invoice_id', v_inv.id, 'amount_cents', p_amount_cents, 'method', p_method, 'received_on', p_received_on,
                       'balance_cents', v_inv.total_cents - v_paid), null);
  v_result := (v_pay.id, v_inv.id, v_paid, v_inv.total_cents - v_paid, v_inv.version, true);
  return v_result;
end;
$$;

comment on function public.billing_record_payment(uuid, uuid, integer, bigint, date, text, text, text, text) is
  'NP-BILL-P1. Organization Admin. Records ONE manual payment (cash / check / card_external / bank_transfer / other; no card data) on an ISSUED invoice: invoice row locked, expected_version (ZW003 -- a second staff member with a stale form cannot double-record), amount 1..balance (no overpayment, ZW006 amount_exceeds_balance), received_on <= today (org timezone). Idempotent per key (same invoice + amount returns the original, changed=false). Append-only.';

create or replace function public.billing_reverse_payment(
  p_organization_id uuid,
  p_payment_id uuid,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key text
)
returns public.billing_payment_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_prior public.billing_payments%rowtype;
  v_orig public.billing_payments%rowtype;
  v_inv public.billing_invoices%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_paid bigint;
  v_rev public.billing_payments%rowtype;
  v_result public.billing_payment_write_result;
begin
  perform public._billing_require_admin(p_organization_id);
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-payment:' || p_organization_id::text || ':' || v_key)::bigint);

  select * into v_prior from public.billing_payments p where p.organization_id = p_organization_id and p.idempotency_key = v_key;
  if found then
    if v_prior.entry_kind = 'reversal' and v_prior.reverses_payment_id = p_payment_id then
      select i.* into v_inv from public.billing_invoices i where i.id = v_prior.invoice_id;
      v_paid := public._billing_paid_cents(v_inv.id);
      v_result := (v_prior.id, v_inv.id, v_paid, v_inv.total_cents - v_paid, v_inv.version, false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  select * into v_orig from public.billing_payments p where p.id = p_payment_id and p.organization_id = p_organization_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_inv := public._billing_lock_invoice(p_organization_id, v_orig.invoice_id);   -- serializes with payments and void
  if v_orig.entry_kind <> 'payment' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_inv.status <> 'issued' then
    raise exception 'invoice_not_open' using errcode = 'ZW004';
  end if;
  if p_expected_version is null or p_expected_version <> v_inv.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if exists (select 1 from public.billing_payments r where r.reverses_payment_id = v_orig.id) then
    raise exception 'already_reversed' using errcode = 'ZW004';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'reason_required' using errcode = 'ZW006';
  end if;

  begin
    insert into public.billing_payments (organization_id, invoice_id, entry_kind, amount_cents, received_on, reverses_payment_id, reason,
      idempotency_key, recorded_by)
    values (p_organization_id, v_inv.id, 'reversal', v_orig.amount_cents, public._billing_org_today(p_organization_id), v_orig.id, v_reason,
      v_key, auth.uid())
    returning * into v_rev;
  exception when unique_violation then
    raise exception 'already_reversed' using errcode = 'ZW004';
  end;
  update public.billing_invoices set version = version + 1 where id = v_inv.id returning * into v_inv;
  v_paid := public._billing_paid_cents(v_inv.id);
  perform public._billing_audit(p_organization_id, 'billing_payment', v_rev.id, 'billing_payment_reversed', null,
    jsonb_build_object('invoice_id', v_inv.id, 'reverses_payment_id', v_orig.id, 'amount_cents', v_orig.amount_cents,
                       'balance_cents', v_inv.total_cents - v_paid), v_reason);
  v_result := (v_rev.id, v_inv.id, v_paid, v_inv.total_cents - v_paid, v_inv.version, true);
  return v_result;
end;
$$;

comment on function public.billing_reverse_payment(uuid, uuid, integer, text, text) is
  'NP-BILL-P1. Organization Admin. Corrects ONE recorded payment with a reversal entry (reason 3-500, once per payment, same amount, same invoice) on an ISSUED invoice; invoice row locked + expected_version. A reversal corrects the ledger -- it does not execute or prove a refund (R2). The original payment is never changed. Idempotent per key.';

create or replace function public.billing_summary(p_organization_id uuid)
returns table (
  outstanding_cents bigint,
  outstanding_count integer,
  overdue_cents bigint,
  overdue_count integer,
  collected_this_month_cents bigint,
  draft_count integer,
  ready_trip_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public._billing_org_today(p_organization_id);
begin
  perform public._billing_require_admin(p_organization_id);
  return query
  with open_inv as (
    select i.total_cents - public._billing_paid_cents(i.id) as bal, i.due_date
    from public.billing_invoices i where i.organization_id = p_organization_id and i.status = 'issued'
  )
  select
    coalesce((select sum(o.bal) from open_inv o where o.bal > 0), 0)::bigint,
    (select count(*) from open_inv o where o.bal > 0)::integer,
    coalesce((select sum(o.bal) from open_inv o where o.bal > 0 and o.due_date < v_today), 0)::bigint,
    (select count(*) from open_inv o where o.bal > 0 and o.due_date < v_today)::integer,
    coalesce((select sum(case when p.entry_kind = 'payment' then p.amount_cents else -p.amount_cents end)
              from public.billing_payments p
              where p.organization_id = p_organization_id and p.received_on >= date_trunc('month', v_today)::date), 0)::bigint,
    (select count(*) from public.billing_invoices i where i.organization_id = p_organization_id and i.status = 'draft')::integer,
    (select count(*) from public.trips t
      where t.organization_id = p_organization_id and t.state = 'completed' and t.passenger_id is not null
        and not exists (select 1 from public.billing_invoice_trips l where l.trip_id = t.id and l.released_at is null))::integer;
end;
$$;

comment on function public.billing_summary(uuid) is
  'NP-BILL-P1. Organization Admin. Outstanding (issued, balance > 0), overdue, net collected this month (payments - reversals by received date, org timezone), drafts, completed trips ready to invoice.';

-- 2. drop the FIN-P1 RPCs, helpers and result type (reverse dependency order)
drop function if exists public.billing_ledger_summary(uuid);
drop function if exists public.billing_list_payers(uuid);
drop function if exists public.billing_invoice_credit_sources(uuid, uuid);
drop function if exists public.billing_list_open_invoices(uuid, uuid, text, uuid);
drop function if exists public.billing_get_receipt(uuid, uuid);
drop function if exists public.billing_list_receipts(uuid, text, text, integer, integer);
drop function if exists public.billing_get_invoice_ledger(uuid, uuid);
drop function if exists public.billing_add_receipt_evidence(uuid, uuid, text);
drop function if exists public.billing_reverse_receipt(uuid, uuid, text, text, text);
drop function if exists public.billing_reverse_refund(uuid, uuid, text, text);
drop function if exists public.billing_record_refund(uuid, uuid, bigint, date, text, text, text, text, text);
drop function if exists public.billing_unapply_allocation(uuid, uuid, text, text);
drop function if exists public.billing_allocate_receipt(uuid, uuid, jsonb, text, text);
drop function if exists public.billing_record_receipt(uuid, uuid, text, uuid, text, bigint, bigint, date, text, text, text, text, boolean, jsonb, text, boolean, text);
drop function if exists public._billing_record_receipt_core(uuid, uuid, text, uuid, text, bigint, bigint, date, text, text, text, text, boolean, jsonb, text, boolean, text);
drop function if exists public._billing_apply_allocations(uuid, public.billing_receipts, jsonb, text, text);
drop function if exists public._billing_require_reason(text);
drop function if exists public._billing_clean_text(text, integer, text);
drop function if exists public._billing_lock_receipt(uuid, uuid);
drop function if exists public._billing_assurance_level(uuid, uuid);
drop function if exists public._billing_payer_identity_matches(public.billing_receipts, public.billing_invoices);
drop function if exists public._billing_authorize(uuid, text);
drop type if exists public.billing_ledger_write_result;

-- 3. drop the FIN-P1 tables (triggers and policies go with them), then their helper functions
drop trigger if exists billing_invoices_ledger_invariants on public.billing_invoices;
drop table if exists public.billing_assurance_events;
drop table if exists public.billing_receipt_reversals;
drop table if exists public.billing_refund_reversals;
drop table if exists public.billing_refunds;
drop table if exists public.billing_allocations;
drop table if exists public.billing_receipts;
drop table if exists public.billing_receipt_counters;
drop function if exists public.billing_can(uuid, text);
drop function if exists public._billing_action_roles(text);
drop function if exists public._billing_ledger_deferred_check();
drop function if exists public._billing_check_receipt_invariants(uuid);
drop function if exists public._billing_check_invoice_invariants(uuid);
drop function if exists public._billing_receipt_reversal_guard();
drop function if exists public._billing_refund_reversal_guard();
drop function if exists public._billing_refund_guard();
drop function if exists public._billing_allocation_guard();
drop function if exists public._billing_ledger_append_only();
drop function if exists public._billing_receipt_unallocated(uuid);
drop function if exists public._billing_receipt_is_reversed(uuid);
drop function if exists public._billing_receipt_refunded(uuid);
drop function if exists public._billing_receipt_allocated(uuid);
drop function if exists public._billing_invoice_net(uuid);
drop function if exists public._billing_looks_like_pan(text);

-- 4. the two migration versions
delete from supabase_migrations.schema_migrations where version in ('20261029100000', '20261029110000');

commit;
-- Afterwards: run supabase/tests/privilege_contract_tests.sql at the NP-BILL-P1 contract (git show origin/main version)
-- and redeploy the previous application build.
