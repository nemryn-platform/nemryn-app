-- =============================================================================
-- NP-FIN-P1 (Stage 2) -- Core billing ledger re-foundation: RPCs (the ONLY write path).
--
-- Every function: SECURITY DEFINER, search_path pinned, authorized through the billing permission catalogue
-- (_billing_authorize -> ZW001 unauthenticated / ZW002 not permitted, no existence oracle), rows always read with
-- organization_id = p_organization_id. Idempotent per (organization, key). Audited with ids, amounts, kinds and statuses
-- only -- never payer names, references, notes or reason text (ZD-279).
--
-- GLOBAL LOCK ORDER (every write, so concurrent calls serialize and never deadlock):
--   0. advisory lock on the idempotency key
--   1. receipt counter row          (only when a receipt number is assigned)
--   2. receipt rows, ascending id   (FOR UPDATE)
--   3. invoice rows, ascending id   (FOR UPDATE)
-- Voiding an invoice locks only the invoice; it never takes a receipt lock after an invoice lock.
--
-- NP-BILL-P1 compatibility (ZD-268): billing_record_payment / billing_reverse_payment keep their signatures, result
-- type, rules, error codes and idempotency and become wrappers over receipts + allocations; _billing_paid_cents now
-- derives from allocations (so billing_get_invoice / list / trip status / void keep working unchanged); billing_summary
-- keeps its signature. Errors: ZW001 unauthenticated; ZW002 not found / not permitted; ZW003 stale; ZW004 illegal state;
-- ZW006 invalid input (message names the rule).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Result types
-- -----------------------------------------------------------------------------
create type public.billing_ledger_write_result as (
  receipt_id uuid,
  receipt_number integer,
  entry_id uuid,
  unallocated_cents bigint,
  changed boolean
);
comment on type public.billing_ledger_write_result is
  'NP-FIN-P1. Result of every ledger write RPC: the receipt concerned, the entry written (allocation / refund / reversal / event), the receipt''s unallocated funds afterwards; changed=false = idempotent repeat.';

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------
create function public._billing_authorize(p_organization_id uuid, p_action text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if p_organization_id is null or not public.billing_can(p_organization_id, p_action) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
end;
$$;
comment on function public._billing_authorize(uuid, text) is
  'NP-FIN-P1 (ZD-272). INTERNAL. Signed in (ZW001) and permitted for the action by the billing permission catalogue (ZW002 otherwise -- no existence oracle).';
revoke all on function public._billing_authorize(uuid, text) from public, anon, authenticated, service_role;

-- Net paid now derives from allocations (same signature as NP-BILL-P1; every reader keeps working)
create or replace function public._billing_paid_cents(p_invoice_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public._billing_invoice_net(p_invoice_id);
$$;
comment on function public._billing_paid_cents(uuid) is
  'NP-BILL-P1 / NP-FIN-P1. INTERNAL. Net paid = sum(apply) - sum(unapply) allocations (never stored).';

create function public._billing_payer_identity_matches(p_receipt public.billing_receipts, p_invoice public.billing_invoices)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Refinement A: identity is an organization-scoped id, never a name. 'other' payers are unverifiable except on the
  -- invoice the receipt was recorded from.
  select p_receipt.source_invoice_id is not distinct from p_invoice.id
      or (p_receipt.payer_kind = p_invoice.bill_to_kind and p_receipt.payer_kind <> 'other'
          and coalesce(p_receipt.payer_passenger_id, p_receipt.payer_request_id, p_receipt.payer_facility_id)
              = coalesce(p_invoice.bill_to_passenger_id, p_invoice.bill_to_request_id, p_invoice.bill_to_facility_id));
$$;
comment on function public._billing_payer_identity_matches(public.billing_receipts, public.billing_invoices) is
  'NP-FIN-P1 (ZD-269, refinement A). INTERNAL. True when the invoice belongs to the receipt''s payer by an authoritative identifier: the invoice the receipt was recorded from, or the same kind + same passenger / request / facility id. Free-text ("other") payers are never matched by name.';
revoke all on function public._billing_payer_identity_matches(public.billing_receipts, public.billing_invoices) from public, anon, authenticated, service_role;

create function public._billing_assurance_level(p_receipt_id uuid, p_refund_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select e.kind from public.billing_assurance_events e
    where (p_receipt_id is not null and e.receipt_id = p_receipt_id) or (p_refund_id is not null and e.refund_id = p_refund_id)
    order by case e.kind when 'reconciled' then 4 when 'provider_confirmed' then 3 when 'evidence_document_held' then 2 else 1 end desc
    limit 1), 'recorded');
$$;
comment on function public._billing_assurance_level(uuid, uuid) is
  'NP-FIN-P1 (ZD-270). INTERNAL. Highest assurance fact of a receipt or refund: recorded < evidence_reference_noted < evidence_document_held < provider_confirmed < reconciled.';
revoke all on function public._billing_assurance_level(uuid, uuid) from public, anon, authenticated, service_role;

create function public._billing_lock_receipt(p_organization_id uuid, p_receipt_id uuid)
returns public.billing_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.billing_receipts%rowtype;
begin
  select * into v from public.billing_receipts r
  where r.id = p_receipt_id and r.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return v;
end;
$$;
revoke all on function public._billing_lock_receipt(uuid, uuid) from public, anon, authenticated, service_role;

create function public._billing_clean_text(p text, p_max integer, p_rule text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := nullif(btrim(coalesce(p, '')), '');
begin
  if v is null then
    return null;
  end if;
  if length(v) > p_max then
    raise exception '%', p_rule using errcode = 'ZW006';
  end if;
  if public._billing_looks_like_pan(v) then
    raise exception 'looks_like_card_number' using errcode = 'ZW006';
  end if;
  return v;
end;
$$;
revoke all on function public._billing_clean_text(text, integer, text) from public, anon, authenticated, service_role;

create function public._billing_require_reason(p text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := btrim(coalesce(p, ''));
begin
  if length(v) < 3 or length(v) > 500 then
    raise exception 'reason_required' using errcode = 'ZW006';
  end if;
  if public._billing_looks_like_pan(v) then
    raise exception 'looks_like_card_number' using errcode = 'ZW006';
  end if;
  return v;
end;
$$;
revoke all on function public._billing_require_reason(text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Allocation core (locks: the caller holds the receipt lock; invoices are locked here in ascending id order)
-- -----------------------------------------------------------------------------
create function public._billing_apply_allocations(
  p_organization_id uuid,
  p_receipt public.billing_receipts,
  p_allocations jsonb,
  p_different_payer_reason text,
  p_request_key text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item record;
  v_inv public.billing_invoices%rowtype;
  v_seq integer := 0;
  v_reason text;
  v_needs_reason boolean := false;
  v_alloc public.billing_allocations%rowtype;
  v_count integer;
  v_distinct integer;
  v_min bigint;
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) > 50 then
    raise exception 'invalid_allocations' using errcode = 'ZW006';
  end if;
  if jsonb_array_length(p_allocations) = 0 then
    return 0;
  end if;
  begin
    select count(*), count(distinct (e ->> 'invoice_id')::uuid), min((e ->> 'amount_cents')::bigint),
           count(*) filter (where (e ->> 'invoice_id') is null or (e ->> 'amount_cents') is null)
      into v_count, v_distinct, v_min, v_seq
    from jsonb_array_elements(p_allocations) e
    where jsonb_typeof(e) = 'object' and (e -> 'expected_version' is null or jsonb_typeof(e -> 'expected_version') in ('number', 'null'));
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_allocations' using errcode = 'ZW006';
  end;
  if v_count <> jsonb_array_length(p_allocations) or v_count <> v_distinct or v_seq <> 0 or v_min is null or v_min <= 0 then
    raise exception 'invalid_allocations' using errcode = 'ZW006';   -- objects only, one entry per invoice, positive amounts
  end if;
  v_seq := 0;

  for v_item in
    select (e ->> 'invoice_id')::uuid as invoice_id,
           (e ->> 'amount_cents')::bigint as amount_cents,
           nullif(e ->> 'expected_version', '')::integer as expected_version
    from jsonb_array_elements(p_allocations) e
    order by (e ->> 'invoice_id')::uuid           -- lock order: invoices ascending
  loop
    if v_item.invoice_id is null or v_item.amount_cents is null or v_item.amount_cents <= 0 then
      raise exception 'invalid_allocations' using errcode = 'ZW006';
    end if;
    v_inv := public._billing_lock_invoice(p_organization_id, v_item.invoice_id);   -- ZW002 unknown / foreign
    if v_inv.status <> 'issued' then
      raise exception 'invoice_not_open' using errcode = 'ZW004';
    end if;
    if v_item.expected_version is not null and v_item.expected_version <> v_inv.version then
      raise exception 'stale_state' using errcode = 'ZW003';
    end if;
    if v_item.amount_cents > v_inv.total_cents - public._billing_invoice_net(v_inv.id) then
      raise exception 'amount_exceeds_balance' using errcode = 'ZW006';
    end if;
    v_needs_reason := not public._billing_payer_identity_matches(p_receipt, v_inv);
    v_reason := null;
    if v_needs_reason then
      -- refinement A / OD-2: identity not verified -> Organization Admin, explicit confirmation + reason, audited
      perform public._billing_authorize(p_organization_id, 'cross_payer_allocate');
      if p_different_payer_reason is null then
        raise exception 'different_payer_confirmation_required' using errcode = 'ZW006';
      end if;
      v_reason := public._billing_require_reason(p_different_payer_reason);
    end if;
    v_seq := v_seq + 1;
    begin
      insert into public.billing_allocations (organization_id, receipt_id, invoice_id, kind, amount_cents, different_payer, reason,
        request_key, request_seq, created_by)
      values (p_organization_id, p_receipt.id, v_inv.id, 'apply', v_item.amount_cents, v_needs_reason, v_reason,
        p_request_key, v_seq, auth.uid())
      returning * into v_alloc;
    exception when check_violation or not_null_violation then
      raise exception 'invalid_allocations' using errcode = 'ZW006';
    end;
    update public.billing_invoices set version = version + 1 where id = v_inv.id;
    perform public._billing_audit(p_organization_id, 'billing_allocation', v_alloc.id, 'billing_allocation_applied', null,
      jsonb_build_object('receipt_id', p_receipt.id, 'invoice_id', v_inv.id, 'amount_cents', v_alloc.amount_cents,
                         'different_payer', v_alloc.different_payer,
                         'balance_cents', v_inv.total_cents - public._billing_invoice_net(v_inv.id)), null);
  end loop;
  return v_seq;
end;
$$;
comment on function public._billing_apply_allocations(uuid, public.billing_receipts, jsonb, text, text) is
  'NP-FIN-P1. INTERNAL. Applies [{invoice_id, amount_cents, expected_version?}] (1-50, one per invoice) from a receipt whose row the caller has locked: invoices locked in ascending id order; issued only (ZW004), expected_version when given (ZW003), amount <= balance (ZW006) and <= the receipt''s unallocated funds (row guard); an invoice of a different / unverified payer needs the cross_payer_allocate permission and a reason (refinement A). Bumps each invoice version; audits each allocation.';
revoke all on function public._billing_apply_allocations(uuid, public.billing_receipts, jsonb, text, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Receipt core (shared by billing_record_receipt and the billing_record_payment wrapper)
-- -----------------------------------------------------------------------------
create function public._billing_record_receipt_core(
  p_organization_id uuid,
  p_source_invoice_id uuid,
  p_payer_kind text,
  p_payer_id uuid,
  p_payer_name text,
  p_gross_cents bigint,
  p_fee_cents bigint,
  p_received_on date,
  p_method text,
  p_provider text,
  p_reference text,
  p_note text,
  p_document_held boolean,
  p_allocations jsonb,
  p_different_payer_reason text,
  p_confirm_possible_duplicate boolean,
  p_key text
)
returns public.billing_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public._billing_org_today(p_organization_id);
  v_src public.billing_invoices%rowtype;
  v_kind text;
  v_pass uuid;
  v_req uuid;
  v_fac uuid;
  v_name text;
  v_reference text;
  v_note text;
  v_number integer;
  v_receipt public.billing_receipts%rowtype;
begin
  -- inputs
  if p_gross_cents is null or p_gross_cents <= 0 or p_gross_cents > 100000000000 then
    raise exception 'invalid_amount' using errcode = 'ZW006';
  end if;
  if coalesce(p_fee_cents, 0) < 0 or coalesce(p_fee_cents, 0) > p_gross_cents then
    raise exception 'invalid_fee' using errcode = 'ZW006';
  end if;
  if p_received_on is null or p_received_on > v_today or p_received_on < date '2000-01-01' then
    raise exception 'invalid_dates' using errcode = 'ZW006';
  end if;
  if p_method is null or p_method not in ('cash', 'check', 'card', 'ach', 'bank_transfer', 'wire', 'digital_wallet', 'other') then
    raise exception 'invalid_method' using errcode = 'ZW006';
  end if;
  if p_provider is not null and p_provider not in ('stripe', 'square', 'paypal', 'zelle', 'venmo', 'bank', 'other') then
    raise exception 'invalid_method' using errcode = 'ZW006';
  end if;
  v_reference := public._billing_clean_text(p_reference, 100, 'invalid_reference');
  v_note := public._billing_clean_text(p_note, 500, 'invalid_note');

  -- payer: from the source invoice's bill-to, or an organization-scoped id, or a typed name ("other", unverified)
  if p_source_invoice_id is not null then
    select * into v_src from public.billing_invoices i where i.id = p_source_invoice_id and i.organization_id = p_organization_id;
    if not found then
      raise exception 'not_found' using errcode = 'ZW002';
    end if;
    v_kind := v_src.bill_to_kind;
    v_pass := v_src.bill_to_passenger_id;
    v_req := v_src.bill_to_request_id;
    v_fac := v_src.bill_to_facility_id;
    v_name := v_src.bill_to_name;
  else
    v_kind := p_payer_kind;
    if v_kind = 'passenger' then
      select p.id, p.display_name into v_pass, v_name from public.passengers p where p.id = p_payer_id and p.organization_id = p_organization_id;
    elsif v_kind = 'requester' then
      select r.id, r.requester_name into v_req, v_name from public.transportation_requests r where r.id = p_payer_id and r.organization_id = p_organization_id;
    elsif v_kind = 'facility' then
      select f.id, f.name into v_fac, v_name from public.facilities f where f.id = p_payer_id and f.organization_id = p_organization_id;
    elsif v_kind = 'other' then
      if p_payer_id is not null then
        raise exception 'invalid_payer' using errcode = 'ZW006';
      end if;
      v_name := nullif(btrim(p_payer_name), '');
      if v_name is null or length(v_name) > 200 then
        raise exception 'payer_name_required' using errcode = 'ZW006';
      end if;
    else
      raise exception 'invalid_payer' using errcode = 'ZW006';
    end if;
    if v_name is null then
      raise exception 'not_found' using errcode = 'ZW002';   -- unknown or another organization's party
    end if;
  end if;
  v_name := left(btrim(v_name), 200);

  -- soft duplicate guard for staff-entered references (provider ids are unique by index)
  if v_reference is not null and not coalesce(p_confirm_possible_duplicate, false) and exists (
       select 1 from public.billing_receipts r
       where r.organization_id = p_organization_id and r.method = p_method and r.gross_cents = p_gross_cents
         and r.received_on = p_received_on
         and r.reference_norm = nullif(upper(regexp_replace(v_reference, '[^A-Za-z0-9]', '', 'g')), '')
         and not public._billing_receipt_is_reversed(r.id)) then
    raise exception 'possible_duplicate' using errcode = 'ZW006';
  end if;

  -- lock order step 1: the receipt counter
  insert into public.billing_receipt_counters (organization_id) values (p_organization_id) on conflict (organization_id) do nothing;
  update public.billing_receipt_counters set next_number = next_number + 1
  where organization_id = p_organization_id
  returning next_number - 1 into v_number;

  begin
    insert into public.billing_receipts (organization_id, receipt_number, payer_kind, payer_passenger_id, payer_request_id,
      payer_facility_id, payer_name, source_invoice_id, gross_cents, fee_cents, received_on, method, provider, reference, note,
      idempotency_key, recorded_by)
    values (p_organization_id, v_number, v_kind, v_pass, v_req, v_fac, v_name, p_source_invoice_id, p_gross_cents,
      coalesce(p_fee_cents, 0), p_received_on, p_method, p_provider, v_reference, v_note, p_key, auth.uid())
    returning * into v_receipt;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;

  -- assurance facts recorded by staff are EVIDENCE only (ZD-270)
  if v_reference is not null then
    insert into public.billing_assurance_events (organization_id, receipt_id, kind, source, actor_id)
    values (p_organization_id, v_receipt.id, 'evidence_reference_noted', 'staff', auth.uid());
  end if;
  if coalesce(p_document_held, false) then
    insert into public.billing_assurance_events (organization_id, receipt_id, kind, source, actor_id)
    values (p_organization_id, v_receipt.id, 'evidence_document_held', 'staff', auth.uid());
  end if;

  perform public._billing_audit(p_organization_id, 'billing_receipt', v_receipt.id, 'billing_receipt_recorded', null,
    jsonb_build_object('receipt_number', v_number, 'payer_kind', v_kind, 'gross_cents', p_gross_cents,
                       'fee_cents', v_receipt.fee_cents, 'method', p_method, 'provider', p_provider,
                       'received_on', p_received_on, 'source_invoice_id', p_source_invoice_id,
                       'evidence', (v_reference is not null or coalesce(p_document_held, false))), null);

  -- lock order steps 2-3: the new receipt row (ours), then invoices ascending
  perform 1 from public.billing_receipts r where r.id = v_receipt.id for update;
  perform public._billing_apply_allocations(p_organization_id, v_receipt, p_allocations, p_different_payer_reason, p_key);
  return v_receipt;
end;
$$;
comment on function public._billing_record_receipt_core(uuid, uuid, text, uuid, text, bigint, bigint, date, text, text, text, text, boolean, jsonb, text, boolean, text) is
  'NP-FIN-P1. INTERNAL. Validates and records ONE receipt (counter locked first), its staff evidence facts, and optional allocations (receipt then invoices ascending). Caller authorizes and handles idempotent replay.';
revoke all on function public._billing_record_receipt_core(uuid, uuid, text, uuid, text, bigint, bigint, date, text, text, text, text, boolean, jsonb, text, boolean, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Public write RPCs
-- -----------------------------------------------------------------------------
create function public.billing_record_receipt(
  p_organization_id uuid,
  p_source_invoice_id uuid,
  p_payer_kind text,
  p_payer_id uuid,
  p_payer_name text,
  p_gross_cents bigint,
  p_fee_cents bigint,
  p_received_on date,
  p_method text,
  p_provider text,
  p_reference text,
  p_note text,
  p_document_held boolean,
  p_allocations jsonb,
  p_different_payer_reason text,
  p_confirm_possible_duplicate boolean,
  p_idempotency_key text
)
returns public.billing_ledger_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_prior public.billing_receipts%rowtype;
  v_receipt public.billing_receipts%rowtype;
  v_result public.billing_ledger_write_result;
begin
  perform public._billing_authorize(p_organization_id, 'receipt_write');
  if coalesce(jsonb_array_length(case when jsonb_typeof(p_allocations) = 'array' then p_allocations end), 0) > 0 then
    perform public._billing_authorize(p_organization_id, 'allocate');
  end if;
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-receipt:' || p_organization_id::text || ':' || v_key)::bigint);

  select * into v_prior from public.billing_receipts r where r.organization_id = p_organization_id and r.idempotency_key = v_key;
  if found then
    -- replay: same key + same money facts + same allocation set returns the original
    if v_prior.gross_cents = p_gross_cents and v_prior.received_on = p_received_on and v_prior.method = p_method
       and coalesce((select jsonb_agg(jsonb_build_array(a.invoice_id, a.amount_cents) order by a.invoice_id)
                     from public.billing_allocations a where a.receipt_id = v_prior.id and a.request_key = v_key and a.kind = 'apply'), '[]'::jsonb)
         = coalesce((select jsonb_agg(jsonb_build_array((e ->> 'invoice_id')::uuid, (e ->> 'amount_cents')::bigint) order by (e ->> 'invoice_id')::uuid)
                     from jsonb_array_elements(case when jsonb_typeof(p_allocations) = 'array' then p_allocations else '[]'::jsonb end) e), '[]'::jsonb) then
      v_result := (v_prior.id, v_prior.receipt_number, null, public._billing_receipt_unallocated(v_prior.id), false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  v_receipt := public._billing_record_receipt_core(p_organization_id, p_source_invoice_id, p_payer_kind, p_payer_id, p_payer_name,
    p_gross_cents, p_fee_cents, p_received_on, p_method, p_provider, p_reference, p_note, p_document_held,
    coalesce(p_allocations, '[]'::jsonb), p_different_payer_reason, p_confirm_possible_duplicate, v_key);
  v_result := (v_receipt.id, v_receipt.receipt_number, null, public._billing_receipt_unallocated(v_receipt.id), true);
  return v_result;
end;
$$;
comment on function public.billing_record_receipt(uuid, uuid, text, uuid, text, bigint, bigint, date, text, text, text, text, boolean, jsonb, text, boolean, text) is
  'NP-FIN-P1. Records money RECEIVED (receipt_write; allocate when allocations are given). Payer = the bill-to of p_source_invoice_id, or an organization passenger / requester (request id) / facility, or "other" with a typed name. gross 1..1e11 cents, optional processing fee 0..gross (the agency''s expense), received_on <= today, method cash | check | card | ach | bank_transfer | wire | digital_wallet | other, optional provider, reference (evidence only), note, document_held. Allocations [{invoice_id, amount_cents, expected_version?}] are applied atomically; the rest stays as payer credit. A reference matching another receipt (method + amount + date) needs p_confirm_possible_duplicate. Text that looks like a card number is refused. Idempotent per key.';
revoke all on function public.billing_record_receipt(uuid, uuid, text, uuid, text, bigint, bigint, date, text, text, text, text, boolean, jsonb, text, boolean, text) from public, anon, service_role;
grant execute on function public.billing_record_receipt(uuid, uuid, text, uuid, text, bigint, bigint, date, text, text, text, text, boolean, jsonb, text, boolean, text) to authenticated;

create function public.billing_allocate_receipt(
  p_organization_id uuid,
  p_receipt_id uuid,
  p_allocations jsonb,
  p_different_payer_reason text,
  p_idempotency_key text
)
returns public.billing_ledger_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_receipt public.billing_receipts%rowtype;
  v_result public.billing_ledger_write_result;
begin
  perform public._billing_authorize(p_organization_id, 'allocate');
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-alloc:' || p_organization_id::text || ':' || v_key)::bigint);

  if exists (select 1 from public.billing_allocations a where a.organization_id = p_organization_id and a.request_key = v_key) then
    if exists (select 1 from public.billing_allocations a where a.organization_id = p_organization_id and a.request_key = v_key and a.receipt_id = p_receipt_id)
       and (select jsonb_agg(jsonb_build_array(a.invoice_id, a.amount_cents) order by a.invoice_id) from public.billing_allocations a
            where a.organization_id = p_organization_id and a.request_key = v_key and a.kind = 'apply')
         = (select jsonb_agg(jsonb_build_array((e ->> 'invoice_id')::uuid, (e ->> 'amount_cents')::bigint) order by (e ->> 'invoice_id')::uuid)
            from jsonb_array_elements(p_allocations) e) then
      select * into v_receipt from public.billing_receipts r where r.id = p_receipt_id;
      v_result := (v_receipt.id, v_receipt.receipt_number, null, public._billing_receipt_unallocated(v_receipt.id), false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  v_receipt := public._billing_lock_receipt(p_organization_id, p_receipt_id);      -- lock order step 2
  if public._billing_receipt_is_reversed(v_receipt.id) then
    raise exception 'receipt_reversed' using errcode = 'ZW004';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'invalid_allocations' using errcode = 'ZW006';
  end if;
  perform public._billing_apply_allocations(p_organization_id, v_receipt, p_allocations, p_different_payer_reason, v_key);
  v_result := (v_receipt.id, v_receipt.receipt_number, null, public._billing_receipt_unallocated(v_receipt.id), true);
  return v_result;
end;
$$;
comment on function public.billing_allocate_receipt(uuid, uuid, jsonb, text, text) is
  'NP-FIN-P1. Applies a receipt''s unallocated funds (payer credit) to issued invoices (allocate): receipt locked, then invoices ascending; amount <= balance and <= unallocated; an invoice of a different / unverified payer needs the cross_payer_allocate permission (Organization Admin) and a reason, audited (refinement A). Idempotent per key.';
revoke all on function public.billing_allocate_receipt(uuid, uuid, jsonb, text, text) from public, anon, service_role;
grant execute on function public.billing_allocate_receipt(uuid, uuid, jsonb, text, text) to authenticated;

create function public.billing_unapply_allocation(
  p_organization_id uuid,
  p_allocation_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns public.billing_ledger_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_reason text;
  v_alloc public.billing_allocations%rowtype;
  v_prior public.billing_allocations%rowtype;
  v_receipt public.billing_receipts%rowtype;
  v_inv public.billing_invoices%rowtype;
  v_un public.billing_allocations%rowtype;
  v_result public.billing_ledger_write_result;
begin
  perform public._billing_authorize(p_organization_id, 'unapply');
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-alloc:' || p_organization_id::text || ':' || v_key)::bigint);

  select * into v_prior from public.billing_allocations a where a.organization_id = p_organization_id and a.request_key = v_key and a.request_seq = 1;
  if found then
    if v_prior.kind = 'unapply' and v_prior.unapplies_allocation_id = p_allocation_id then
      select * into v_receipt from public.billing_receipts r where r.id = v_prior.receipt_id;
      v_result := (v_receipt.id, v_receipt.receipt_number, v_prior.id, public._billing_receipt_unallocated(v_receipt.id), false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  select * into v_alloc from public.billing_allocations a where a.id = p_allocation_id and a.organization_id = p_organization_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_alloc.kind <> 'apply' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  v_receipt := public._billing_lock_receipt(p_organization_id, v_alloc.receipt_id);          -- step 2
  v_inv := public._billing_lock_invoice(p_organization_id, v_alloc.invoice_id);              -- step 3
  if v_inv.status <> 'issued' then
    raise exception 'invoice_not_open' using errcode = 'ZW004';
  end if;
  if exists (select 1 from public.billing_allocations u where u.unapplies_allocation_id = v_alloc.id) then
    raise exception 'already_unapplied' using errcode = 'ZW004';
  end if;
  v_reason := public._billing_require_reason(p_reason);
  begin
    insert into public.billing_allocations (organization_id, receipt_id, invoice_id, kind, amount_cents, unapplies_allocation_id, reason,
      request_key, request_seq, created_by)
    values (p_organization_id, v_alloc.receipt_id, v_alloc.invoice_id, 'unapply', v_alloc.amount_cents, v_alloc.id, v_reason,
      v_key, 1, auth.uid())
    returning * into v_un;
  exception when unique_violation then
    raise exception 'already_unapplied' using errcode = 'ZW004';
  end;
  update public.billing_invoices set version = version + 1 where id = v_inv.id;
  perform public._billing_audit(p_organization_id, 'billing_allocation', v_un.id, 'billing_allocation_unapplied', null,
    jsonb_build_object('receipt_id', v_receipt.id, 'invoice_id', v_inv.id, 'unapplies_allocation_id', v_alloc.id,
                       'amount_cents', v_un.amount_cents,
                       'balance_cents', v_inv.total_cents - public._billing_invoice_net(v_inv.id)), null);
  v_result := (v_receipt.id, v_receipt.receipt_number, v_un.id, public._billing_receipt_unallocated(v_receipt.id), true);
  return v_result;
end;
$$;
comment on function public.billing_unapply_allocation(uuid, uuid, text, text) is
  'NP-FIN-P1. SENSITIVE (unapply, Organization Admin -- ZD-272). Removes ONE applied allocation in full (once, reason 3-500) from an ISSUED invoice: receipt then invoice locked. The money returns to the receipt as payer credit; the invoice balance reopens. Nothing is deleted. Idempotent per key.';
revoke all on function public.billing_unapply_allocation(uuid, uuid, text, text) from public, anon, service_role;
grant execute on function public.billing_unapply_allocation(uuid, uuid, text, text) to authenticated;

create function public.billing_record_refund(
  p_organization_id uuid,
  p_receipt_id uuid,
  p_amount_cents bigint,
  p_refunded_on date,
  p_method text,
  p_provider text,
  p_reference text,
  p_reason text,
  p_idempotency_key text
)
returns public.billing_ledger_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_reason text;
  v_reference text;
  v_prior public.billing_refunds%rowtype;
  v_receipt public.billing_receipts%rowtype;
  v_refund public.billing_refunds%rowtype;
  v_today date := public._billing_org_today(p_organization_id);
  v_result public.billing_ledger_write_result;
begin
  perform public._billing_authorize(p_organization_id, 'refund');
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-refund:' || p_organization_id::text || ':' || v_key)::bigint);

  select * into v_prior from public.billing_refunds f where f.organization_id = p_organization_id and f.idempotency_key = v_key;
  if found then
    if v_prior.receipt_id = p_receipt_id and v_prior.amount_cents = p_amount_cents then
      select * into v_receipt from public.billing_receipts r where r.id = v_prior.receipt_id;
      v_result := (v_receipt.id, v_receipt.receipt_number, v_prior.id, public._billing_receipt_unallocated(v_receipt.id), false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  v_receipt := public._billing_lock_receipt(p_organization_id, p_receipt_id);
  if public._billing_receipt_is_reversed(v_receipt.id) then
    raise exception 'receipt_reversed' using errcode = 'ZW004';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = 'ZW006';
  end if;
  if p_amount_cents > public._billing_receipt_unallocated(v_receipt.id) then
    raise exception 'refund_exceeds_refundable' using errcode = 'ZW006';
  end if;
  if p_refunded_on is null or p_refunded_on > v_today or p_refunded_on < v_receipt.received_on then
    raise exception 'invalid_dates' using errcode = 'ZW006';
  end if;
  if p_method is null or p_method not in ('cash', 'check', 'card', 'ach', 'bank_transfer', 'wire', 'digital_wallet', 'other')
     or (p_provider is not null and p_provider not in ('stripe', 'square', 'paypal', 'zelle', 'venmo', 'bank', 'other')) then
    raise exception 'invalid_method' using errcode = 'ZW006';
  end if;
  v_reference := public._billing_clean_text(p_reference, 100, 'invalid_reference');
  v_reason := public._billing_require_reason(p_reason);
  begin
    insert into public.billing_refunds (organization_id, receipt_id, refund_seq, amount_cents, refunded_on, method, provider, reference,
      reason, idempotency_key, recorded_by)
    values (p_organization_id, v_receipt.id,
      coalesce((select max(f.refund_seq) from public.billing_refunds f where f.receipt_id = v_receipt.id), 0) + 1,
      p_amount_cents, p_refunded_on, p_method, p_provider, v_reference, v_reason, v_key, auth.uid())
    returning * into v_refund;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;
  if v_reference is not null then
    insert into public.billing_assurance_events (organization_id, refund_id, kind, source, actor_id)
    values (p_organization_id, v_refund.id, 'evidence_reference_noted', 'staff', auth.uid());
  end if;
  perform public._billing_audit(p_organization_id, 'billing_refund', v_refund.id, 'billing_refund_recorded', null,
    jsonb_build_object('receipt_id', v_receipt.id, 'amount_cents', v_refund.amount_cents, 'method', p_method, 'provider', p_provider,
                       'refunded_on', p_refunded_on, 'unallocated_cents', public._billing_receipt_unallocated(v_receipt.id)), null);
  v_result := (v_receipt.id, v_receipt.receipt_number, v_refund.id, public._billing_receipt_unallocated(v_receipt.id), true);
  return v_result;
end;
$$;
comment on function public.billing_record_refund(uuid, uuid, bigint, date, text, text, text, text, text) is
  'NP-FIN-P1. SENSITIVE (refund, Organization Admin -- ZD-272 / ZD-278). RECORDS money the organization returned from a receipt''s unallocated funds (receipt locked; amount <= refundable, ZW006 refund_exceeds_refundable; date between the receipt date and today; reason 3-500). Recording does not move money and is not provider confirmation or reconciliation (separate facts). Unapply first to refund money that is applied to an invoice. Idempotent per key.';
revoke all on function public.billing_record_refund(uuid, uuid, bigint, date, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.billing_record_refund(uuid, uuid, bigint, date, text, text, text, text, text) to authenticated;

create function public.billing_reverse_refund(
  p_organization_id uuid,
  p_refund_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns public.billing_ledger_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_reason text;
  v_refund public.billing_refunds%rowtype;
  v_prior public.billing_refund_reversals%rowtype;
  v_receipt public.billing_receipts%rowtype;
  v_rev public.billing_refund_reversals%rowtype;
  v_result public.billing_ledger_write_result;
begin
  perform public._billing_authorize(p_organization_id, 'refund_reverse');
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-refund:' || p_organization_id::text || ':' || v_key)::bigint);

  select * into v_prior from public.billing_refund_reversals x where x.organization_id = p_organization_id and x.idempotency_key = v_key;
  if found then
    if v_prior.refund_id = p_refund_id then
      select * into v_receipt from public.billing_receipts r where r.id = v_prior.receipt_id;
      v_result := (v_receipt.id, v_receipt.receipt_number, v_prior.id, public._billing_receipt_unallocated(v_receipt.id), false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  select * into v_refund from public.billing_refunds f where f.id = p_refund_id and f.organization_id = p_organization_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_receipt := public._billing_lock_receipt(p_organization_id, v_refund.receipt_id);
  if exists (select 1 from public.billing_refund_reversals x where x.refund_id = v_refund.id) then
    raise exception 'already_reversed' using errcode = 'ZW004';
  end if;
  v_reason := public._billing_require_reason(p_reason);
  begin
    insert into public.billing_refund_reversals (organization_id, refund_id, receipt_id, reason, idempotency_key, reversed_by)
    values (p_organization_id, v_refund.id, v_receipt.id, v_reason, v_key, auth.uid())
    returning * into v_rev;
  exception when unique_violation then
    raise exception 'already_reversed' using errcode = 'ZW004';
  end;
  perform public._billing_audit(p_organization_id, 'billing_refund', v_refund.id, 'billing_refund_reversed', null,
    jsonb_build_object('receipt_id', v_receipt.id, 'refund_id', v_refund.id, 'amount_cents', v_refund.amount_cents,
                       'unallocated_cents', public._billing_receipt_unallocated(v_receipt.id)), null);
  v_result := (v_receipt.id, v_receipt.receipt_number, v_rev.id, public._billing_receipt_unallocated(v_receipt.id), true);
  return v_result;
end;
$$;
comment on function public.billing_reverse_refund(uuid, uuid, text, text) is
  'NP-FIN-P1. SENSITIVE (refund_reverse, Organization Admin). Corrects ONE refund recorded in error (once, reason 3-500): the refund stops counting and its amount is the payer''s credit again. The refund row is never changed. Idempotent per key.';
revoke all on function public.billing_reverse_refund(uuid, uuid, text, text) from public, anon, service_role;
grant execute on function public.billing_reverse_refund(uuid, uuid, text, text) to authenticated;

create function public.billing_reverse_receipt(
  p_organization_id uuid,
  p_receipt_id uuid,
  p_reason_code text,
  p_reason text,
  p_idempotency_key text
)
returns public.billing_ledger_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_reason text;
  v_prior public.billing_receipt_reversals%rowtype;
  v_receipt public.billing_receipts%rowtype;
  v_rev public.billing_receipt_reversals%rowtype;
  v_result public.billing_ledger_write_result;
begin
  perform public._billing_authorize(p_organization_id, 'reverse');
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-reverse:' || p_organization_id::text || ':' || v_key)::bigint);

  select * into v_prior from public.billing_receipt_reversals x where x.organization_id = p_organization_id and x.idempotency_key = v_key;
  if found then
    if v_prior.receipt_id = p_receipt_id then
      select * into v_receipt from public.billing_receipts r where r.id = v_prior.receipt_id;
      v_result := (v_receipt.id, v_receipt.receipt_number, v_prior.id, 0, false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  v_receipt := public._billing_lock_receipt(p_organization_id, p_receipt_id);
  if public._billing_receipt_is_reversed(v_receipt.id) then
    raise exception 'already_reversed' using errcode = 'ZW004';
  end if;
  if coalesce(p_reason_code, '') not in ('entry_error', 'returned_check', 'duplicate', 'other') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if public._billing_receipt_allocated(v_receipt.id) <> 0 then
    raise exception 'receipt_has_allocations' using errcode = 'ZW004';
  end if;
  if public._billing_receipt_refunded(v_receipt.id) <> 0 then
    raise exception 'receipt_has_refunds' using errcode = 'ZW004';
  end if;
  v_reason := public._billing_require_reason(p_reason);
  begin
    insert into public.billing_receipt_reversals (organization_id, receipt_id, reason_code, reason, idempotency_key, reversed_by)
    values (p_organization_id, v_receipt.id, p_reason_code, v_reason, v_key, auth.uid())
    returning * into v_rev;
  exception when unique_violation then
    raise exception 'already_reversed' using errcode = 'ZW004';
  end;
  perform public._billing_audit(p_organization_id, 'billing_receipt', v_receipt.id, 'billing_receipt_reversed', null,
    jsonb_build_object('receipt_number', v_receipt.receipt_number, 'gross_cents', v_receipt.gross_cents, 'reason_code', p_reason_code), null);
  v_result := (v_receipt.id, v_receipt.receipt_number, v_rev.id, 0, true);
  return v_result;
end;
$$;
comment on function public.billing_reverse_receipt(uuid, uuid, text, text, text) is
  'NP-FIN-P1. SENSITIVE (reverse, Organization Admin). Marks a receipt as recorded in error / returned check / duplicate (reason code + reason 3-500, once) -- only when nothing of it is applied or refunded (unapply first; ZW004). The receipt keeps its number and stays in the history as REVERSED; it is not a refund. Idempotent per key.';
revoke all on function public.billing_reverse_receipt(uuid, uuid, text, text, text) from public, anon, service_role;
grant execute on function public.billing_reverse_receipt(uuid, uuid, text, text, text) to authenticated;

create function public.billing_add_receipt_evidence(p_organization_id uuid, p_receipt_id uuid, p_kind text)
returns public.billing_ledger_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt public.billing_receipts%rowtype;
  v_event uuid;
  v_result public.billing_ledger_write_result;
begin
  perform public._billing_authorize(p_organization_id, 'evidence_add');
  if coalesce(p_kind, '') not in ('evidence_reference_noted', 'evidence_document_held') then
    raise exception 'invalid_input' using errcode = 'ZW006';   -- staff can never claim provider confirmation / reconciliation
  end if;
  v_receipt := public._billing_lock_receipt(p_organization_id, p_receipt_id);
  if public._billing_receipt_is_reversed(v_receipt.id) then
    raise exception 'receipt_reversed' using errcode = 'ZW004';
  end if;
  insert into public.billing_assurance_events (organization_id, receipt_id, kind, source, actor_id)
  values (p_organization_id, v_receipt.id, p_kind, 'staff', auth.uid())
  on conflict do nothing
  returning id into v_event;
  if v_event is not null then
    perform public._billing_audit(p_organization_id, 'billing_receipt', v_receipt.id, 'billing_receipt_evidence_added', null,
      jsonb_build_object('kind', p_kind), null);
  end if;
  v_result := (v_receipt.id, v_receipt.receipt_number, v_event, public._billing_receipt_unallocated(v_receipt.id), v_event is not null);
  return v_result;
end;
$$;
comment on function public.billing_add_receipt_evidence(uuid, uuid, text) is
  'NP-FIN-P1 (ZD-270). evidence_add. Adds a staff EVIDENCE fact to a receipt (evidence_reference_noted | evidence_document_held); idempotent (once per kind). Provider confirmation and reconciliation can never be added here.';
revoke all on function public.billing_add_receipt_evidence(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.billing_add_receipt_evidence(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- NP-BILL-P1 compatibility wrappers (same signatures, result type, rules, codes, idempotency)
-- -----------------------------------------------------------------------------
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
  v_prior public.billing_receipts%rowtype;
  v_alloc public.billing_allocations%rowtype;
  v_inv public.billing_invoices%rowtype;
  v_paid bigint;
  v_today date := public._billing_org_today(p_organization_id);
  v_receipt public.billing_receipts%rowtype;
  v_result public.billing_payment_write_result;
begin
  perform public._billing_require_admin(p_organization_id);
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-receipt:' || p_organization_id::text || ':' || v_key)::bigint);

  -- replay: the same key returns the original only for the same invoice + amount
  select * into v_prior from public.billing_receipts r where r.organization_id = p_organization_id and r.idempotency_key = v_key;
  if found then
    select * into v_alloc from public.billing_allocations a
    where a.receipt_id = v_prior.id and a.request_key = v_key and a.request_seq = 1 and a.kind = 'apply';
    if found and v_alloc.invoice_id = p_invoice_id and v_alloc.amount_cents = p_amount_cents then
      select i.* into v_inv from public.billing_invoices i where i.id = v_alloc.invoice_id;
      v_paid := public._billing_paid_cents(v_inv.id);
      v_result := (v_alloc.id, v_inv.id, v_paid, v_inv.total_cents - v_paid, v_inv.version, false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  -- NP-BILL-P1 checks, in the same order and with the same codes (re-checked under the locks by the core + row guard)
  select * into v_inv from public.billing_invoices i where i.id = p_invoice_id and i.organization_id = p_organization_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
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
  if p_method is null or p_method not in ('cash', 'check', 'card_external', 'bank_transfer', 'other') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  begin
    v_receipt := public._billing_record_receipt_core(p_organization_id, v_inv.id, null, null, null, p_amount_cents, 0, p_received_on,
      case p_method when 'card_external' then 'card' else p_method end, null, p_reference, p_note, false,
      jsonb_build_array(jsonb_build_object('invoice_id', v_inv.id, 'amount_cents', p_amount_cents, 'expected_version', p_expected_version)),
      null, true, v_key);
  exception when sqlstate 'ZW006' then
    -- NP-BILL-P1 reported text / format problems as invalid_input; keep its codes for its rules
    if sqlerrm in ('amount_exceeds_balance', 'invalid_amount', 'invalid_dates', 'invalid_idempotency_key') then
      raise;
    end if;
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;
  select * into v_alloc from public.billing_allocations a where a.receipt_id = v_receipt.id and a.request_seq = 1;
  select i.* into v_inv from public.billing_invoices i where i.id = v_alloc.invoice_id;
  v_paid := public._billing_paid_cents(v_inv.id);
  perform public._billing_audit(p_organization_id, 'billing_payment', v_alloc.id, 'billing_payment_recorded', null,
    jsonb_build_object('invoice_id', v_inv.id, 'amount_cents', p_amount_cents, 'method', p_method, 'received_on', p_received_on,
                       'balance_cents', v_inv.total_cents - v_paid, 'receipt_id', v_receipt.id), null);
  v_result := (v_alloc.id, v_inv.id, v_paid, v_inv.total_cents - v_paid, v_inv.version, true);
  return v_result;
end;
$$;
comment on function public.billing_record_payment(uuid, uuid, integer, bigint, date, text, text, text, text) is
  'NP-BILL-P1, re-implemented by NP-FIN-P1 (ZD-268) with the same signature, rules and codes. Organization Admin. Records ONE manual payment on an ISSUED invoice as one receipt (payer = the invoice bill-to) + one allocation of the same amount: expected_version (ZW003), amount 1..balance (ZW006 amount_exceeds_balance), received_on <= today and >= issue date - 365, method cash / check / card_external / bank_transfer / other. Returns payment_id = the allocation id. Idempotent per key (same invoice + amount returns the original, changed=false). Writes the legacy billing_payment_recorded audit row as well as the receipt / allocation rows.';

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
  v_prior public.billing_receipt_reversals%rowtype;
  v_alloc public.billing_allocations%rowtype;
  v_receipt public.billing_receipts%rowtype;
  v_inv public.billing_invoices%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_paid bigint;
  v_rev public.billing_receipt_reversals%rowtype;
  v_result public.billing_payment_write_result;
begin
  perform public._billing_require_admin(p_organization_id);
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-reverse:' || p_organization_id::text || ':' || v_key)::bigint);

  select * into v_prior from public.billing_receipt_reversals x where x.organization_id = p_organization_id and x.idempotency_key = v_key;
  if found then
    if exists (select 1 from public.billing_allocations a where a.id = p_payment_id and a.receipt_id = v_prior.receipt_id) then
      select * into v_alloc from public.billing_allocations a where a.id = p_payment_id;
      select i.* into v_inv from public.billing_invoices i where i.id = v_alloc.invoice_id;
      v_paid := public._billing_paid_cents(v_inv.id);
      v_result := (v_prior.id, v_inv.id, v_paid, v_inv.total_cents - v_paid, v_inv.version, false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  select * into v_alloc from public.billing_allocations a where a.id = p_payment_id and a.organization_id = p_organization_id;
  if not found then
    -- NP-BILL-P1: reversing a reversal was refused as invalid input (the reversal id is a receipt reversal now)
    if exists (select 1 from public.billing_receipt_reversals x where x.id = p_payment_id and x.organization_id = p_organization_id) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_receipt := public._billing_lock_receipt(p_organization_id, v_alloc.receipt_id);   -- lock order: receipt, then invoice
  v_inv := public._billing_lock_invoice(p_organization_id, v_alloc.invoice_id);
  if v_alloc.kind <> 'apply' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_inv.status <> 'issued' then
    raise exception 'invoice_not_open' using errcode = 'ZW004';
  end if;
  if p_expected_version is null or p_expected_version <> v_inv.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if public._billing_receipt_is_reversed(v_receipt.id)
     or exists (select 1 from public.billing_allocations u where u.unapplies_allocation_id = v_alloc.id) then
    raise exception 'already_reversed' using errcode = 'ZW004';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'reason_required' using errcode = 'ZW006';
  end if;
  -- a payment = a receipt applied ONLY to this invoice and never refunded; anything else is handled on the receipt page
  if v_receipt.gross_cents <> v_alloc.amount_cents
     or exists (select 1 from public.billing_allocations o where o.receipt_id = v_receipt.id and o.id <> v_alloc.id)
     or exists (select 1 from public.billing_refunds f where f.receipt_id = v_receipt.id) then
    raise exception 'use_receipt_page' using errcode = 'ZW004';
  end if;

  begin
    insert into public.billing_allocations (organization_id, receipt_id, invoice_id, kind, amount_cents, unapplies_allocation_id, reason,
      request_key, request_seq, created_by)
    values (p_organization_id, v_receipt.id, v_inv.id, 'unapply', v_alloc.amount_cents, v_alloc.id, left(v_reason, 500), v_key, 1, auth.uid());
    insert into public.billing_receipt_reversals (organization_id, receipt_id, reason_code, reason, idempotency_key, reversed_by)
    values (p_organization_id, v_receipt.id, 'entry_error', left(v_reason, 500), v_key, auth.uid())
    returning * into v_rev;
  exception
    when unique_violation then
      raise exception 'already_reversed' using errcode = 'ZW004';
    when check_violation then
      raise exception 'reason_required' using errcode = 'ZW006';
  end;
  update public.billing_invoices set version = version + 1 where id = v_inv.id returning * into v_inv;
  v_paid := public._billing_paid_cents(v_inv.id);
  perform public._billing_audit(p_organization_id, 'billing_payment', v_rev.id, 'billing_payment_reversed', null,
    jsonb_build_object('invoice_id', v_inv.id, 'reverses_payment_id', v_alloc.id, 'amount_cents', v_alloc.amount_cents,
                       'balance_cents', v_inv.total_cents - v_paid, 'receipt_id', v_receipt.id), v_reason);
  perform public._billing_audit(p_organization_id, 'billing_receipt', v_receipt.id, 'billing_receipt_reversed', null,
    jsonb_build_object('receipt_number', v_receipt.receipt_number, 'gross_cents', v_receipt.gross_cents, 'reason_code', 'entry_error'), null);
  v_result := (v_rev.id, v_inv.id, v_paid, v_inv.total_cents - v_paid, v_inv.version, true);
  return v_result;
end;
$$;
comment on function public.billing_reverse_payment(uuid, uuid, integer, text, text) is
  'NP-BILL-P1, re-implemented by NP-FIN-P1 (ZD-268) with the same signature, rules and codes. Organization Admin. Corrects ONE payment (= the allocation id returned by billing_record_payment) on an ISSUED invoice: receipt then invoice locked, expected_version (ZW003), reason 3-500, once (ZW004 already_reversed). Writes an unapply + a receipt reversal (entry_error) atomically; the original rows are never changed. A receipt applied to several invoices or refunded is handled on the receipt page (ZW004 use_receipt_page). Returns the reversal id. Idempotent per key. A reversal corrects the record; it does not execute or prove a refund.';

-- collected this month = receipts received this month (not reversed) minus recorded refunds this month (not reversed)
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
    (coalesce((select sum(r.gross_cents) from public.billing_receipts r
               where r.organization_id = p_organization_id and r.received_on >= date_trunc('month', v_today)::date
                 and not public._billing_receipt_is_reversed(r.id)), 0)
     - coalesce((select sum(f.amount_cents) from public.billing_refunds f
                 where f.organization_id = p_organization_id and f.refunded_on >= date_trunc('month', v_today)::date
                   and not exists (select 1 from public.billing_refund_reversals x where x.refund_id = f.id)), 0))::bigint,
    (select count(*) from public.billing_invoices i where i.organization_id = p_organization_id and i.status = 'draft')::integer,
    (select count(*) from public.trips t
      where t.organization_id = p_organization_id and t.state = 'completed' and t.passenger_id is not null
        and not exists (select 1 from public.billing_invoice_trips l where l.trip_id = t.id and l.released_at is null))::integer;
end;
$$;
comment on function public.billing_summary(uuid) is
  'NP-BILL-P1 / NP-FIN-P1. Organization Admin. Outstanding (issued, balance > 0), overdue, net collected this month (receipts received this month that were not reversed, minus refunds recorded this month that were not reversed; org timezone), drafts, completed trips ready to invoice.';

-- -----------------------------------------------------------------------------
-- Reads
-- -----------------------------------------------------------------------------
create function public.billing_get_invoice_ledger(p_organization_id uuid, p_invoice_id uuid)
returns table (
  allocation_id uuid,
  amount_cents bigint,
  created_at timestamptz,
  different_payer boolean,
  unapplied boolean,
  unapply_reason text,
  unapplied_at timestamptz,
  receipt_id uuid,
  receipt_number integer,
  received_on date,
  method text,
  provider text,
  reference text,
  note text,
  receipt_reversed boolean,
  receipt_reversal_reason text,
  receipt_reversal_code text,
  receipt_reversed_at timestamptz,
  assurance text,
  simple_payment boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._billing_authorize(p_organization_id, 'view');
  if not exists (select 1 from public.billing_invoices i where i.id = p_invoice_id and i.organization_id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select a.id, a.amount_cents, a.created_at, a.different_payer,
         u.id is not null, u.reason, u.created_at,
         r.id, r.receipt_number, r.received_on, r.method, r.provider, r.reference, r.note,
         x.id is not null, x.reason, x.reason_code, x.reversed_at,
         public._billing_assurance_level(r.id, null),
         -- a "simple payment": the whole receipt applied to this one invoice and nothing else (reversible from the invoice)
         (r.gross_cents = a.amount_cents and not exists (
            select 1 from public.billing_allocations o where o.receipt_id = r.id and o.id <> a.id and o.id is distinct from u.id)
          and not exists (select 1 from public.billing_refunds f where f.receipt_id = r.id))
  from public.billing_allocations a
  join public.billing_receipts r on r.id = a.receipt_id and r.organization_id = a.organization_id
  left join public.billing_allocations u on u.unapplies_allocation_id = a.id
  left join public.billing_receipt_reversals x on x.receipt_id = r.id
  where a.invoice_id = p_invoice_id and a.organization_id = p_organization_id and a.kind = 'apply'
  order by a.created_at, a.id;
end;
$$;
comment on function public.billing_get_invoice_ledger(uuid, uuid) is
  'NP-FIN-P1. view. The payments applied to one invoice (apply allocations), each with its receipt (number, date, method, provider, reference, note), whether it was later unapplied (reason), whether the receipt was reversed, its assurance level, and whether it is a simple whole-receipt payment (reversible from the invoice page). ZW002 for an unknown / foreign invoice.';
revoke all on function public.billing_get_invoice_ledger(uuid, uuid) from public, anon, service_role;
grant execute on function public.billing_get_invoice_ledger(uuid, uuid) to authenticated;

create function public.billing_list_receipts(p_organization_id uuid, p_filter text, p_search text, p_limit integer, p_offset integer)
returns table (
  receipt_id uuid,
  receipt_number integer,
  payer_kind text,
  payer_name text,
  received_on date,
  method text,
  provider text,
  gross_cents bigint,
  fee_cents bigint,
  allocated_cents bigint,
  refunded_cents bigint,
  unallocated_cents bigint,
  reversed boolean,
  assurance text,
  recorded_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_number integer;
begin
  perform public._billing_authorize(p_organization_id, 'view');
  if v_search is not null and length(v_search) > 100 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_search ~* '^(rcpt-?)?0*[0-9]{1,9}$' then
    v_number := regexp_replace(v_search, '[^0-9]', '', 'g')::integer;
  end if;
  return query
  with base as (
    select r.*, public._billing_receipt_allocated(r.id) as alloc, public._billing_receipt_refunded(r.id) as refd,
           public._billing_receipt_is_reversed(r.id) as rev
    from public.billing_receipts r
    where r.organization_id = p_organization_id
      and (v_search is null or r.receipt_number = v_number or r.payer_name ilike '%' || v_search || '%')
  )
  select b.id, b.receipt_number, b.payer_kind, b.payer_name, b.received_on, b.method, b.provider, b.gross_cents, b.fee_cents,
         b.alloc, b.refd, case when b.rev then 0 else b.gross_cents - b.alloc - b.refd end, b.rev,
         public._billing_assurance_level(b.id, null), b.recorded_at, count(*) over ()
  from base b
  where case coalesce(p_filter, 'all')
          when 'all' then true
          when 'credit' then not b.rev and b.gross_cents - b.alloc - b.refd > 0
          when 'reversed' then b.rev
          else false
        end
  order by b.received_on desc, b.receipt_number desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
comment on function public.billing_list_receipts(uuid, text, text, integer, integer) is
  'NP-FIN-P1. view. Receipts with derived allocated / refunded / unallocated (payer credit), reversed flag and assurance level. Filters: all | credit (unallocated > 0) | reversed; search by number (RCPT-12 / 12) or payer name. Bounded page + total.';
revoke all on function public.billing_list_receipts(uuid, text, text, integer, integer) from public, anon, service_role;
grant execute on function public.billing_list_receipts(uuid, text, text, integer, integer) to authenticated;

create function public.billing_get_receipt(p_organization_id uuid, p_receipt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.billing_receipts%rowtype;
  v_out jsonb;
begin
  perform public._billing_authorize(p_organization_id, 'view');
  select * into v from public.billing_receipts r where r.id = p_receipt_id and r.organization_id = p_organization_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  select jsonb_build_object(
    'receipt', jsonb_build_object(
      'id', v.id, 'receipt_number', v.receipt_number, 'payer_kind', v.payer_kind,
      'payer_id', coalesce(v.payer_passenger_id, v.payer_request_id, v.payer_facility_id), 'payer_name', v.payer_name,
      'source_invoice_id', v.source_invoice_id, 'currency', v.currency, 'gross_cents', v.gross_cents, 'fee_cents', v.fee_cents,
      'net_cents', v.net_cents, 'received_on', v.received_on, 'method', v.method, 'provider', v.provider,
      'reference', v.reference, 'note', v.note, 'recorded_at', v.recorded_at,
      'allocated_cents', public._billing_receipt_allocated(v.id), 'refunded_cents', public._billing_receipt_refunded(v.id),
      'unallocated_cents', public._billing_receipt_unallocated(v.id), 'assurance', public._billing_assurance_level(v.id, null)),
    'reversal', (select jsonb_build_object('id', x.id, 'reason_code', x.reason_code, 'reason', x.reason, 'reversed_at', x.reversed_at)
                 from public.billing_receipt_reversals x where x.receipt_id = v.id),
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'invoice_id', a.invoice_id, 'invoice_number', i.invoice_number, 'invoice_status', i.status,
               'amount_cents', a.amount_cents, 'created_at', a.created_at, 'different_payer', a.different_payer,
               'different_payer_reason', case when a.different_payer then a.reason end,
               'unapplied', u.id is not null, 'unapply_reason', u.reason, 'unapplied_at', u.created_at)
             order by a.created_at, i.invoice_number, a.id)
      from public.billing_allocations a
      join public.billing_invoices i on i.id = a.invoice_id and i.organization_id = a.organization_id
      left join public.billing_allocations u on u.unapplies_allocation_id = a.id
      where a.receipt_id = v.id and a.kind = 'apply'), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'refund_seq', f.refund_seq, 'amount_cents', f.amount_cents, 'refunded_on', f.refunded_on,
               'method', f.method, 'provider', f.provider, 'reference', f.reference, 'reason', f.reason, 'recorded_at', f.recorded_at,
               'assurance', public._billing_assurance_level(null, f.id),
               'reversed', rr.id is not null, 'reversal_reason', rr.reason, 'reversed_at', rr.reversed_at)
             order by f.refund_seq)
      from public.billing_refunds f
      left join public.billing_refund_reversals rr on rr.refund_id = f.id
      where f.receipt_id = v.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'source', e.source, 'occurred_at', e.occurred_at) order by e.occurred_at)
      from public.billing_assurance_events e where e.receipt_id = v.id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;
comment on function public.billing_get_receipt(uuid, uuid) is
  'NP-FIN-P1. view. One receipt (jsonb): header with derived allocated / refunded / unallocated and assurance, its reversal, allocations (invoice number / status, unapplied), refunds (with their own assurance and reversal) and assurance events. ZW002 for an unknown / foreign receipt.';
revoke all on function public.billing_get_receipt(uuid, uuid) from public, anon, service_role;
grant execute on function public.billing_get_receipt(uuid, uuid) to authenticated;

create function public.billing_list_open_invoices(p_organization_id uuid, p_receipt_id uuid, p_payer_kind text, p_payer_id uuid)
returns table (
  invoice_id uuid,
  invoice_number integer,
  bill_to_kind text,
  bill_to_name text,
  passenger_name text,
  issue_date date,
  due_date date,
  total_cents bigint,
  balance_cents bigint,
  version integer,
  same_payer boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt public.billing_receipts%rowtype;
begin
  perform public._billing_authorize(p_organization_id, 'view');
  if p_receipt_id is not null then
    select * into v_receipt from public.billing_receipts r where r.id = p_receipt_id and r.organization_id = p_organization_id;
    if not found then
      raise exception 'not_found' using errcode = 'ZW002';
    end if;
  else
    -- a prospective payer (new receipt): same identity rules as an existing receipt
    v_receipt.payer_kind := coalesce(p_payer_kind, 'other');
    v_receipt.payer_passenger_id := case when p_payer_kind = 'passenger' then p_payer_id end;
    v_receipt.payer_request_id := case when p_payer_kind = 'requester' then p_payer_id end;
    v_receipt.payer_facility_id := case when p_payer_kind = 'facility' then p_payer_id end;
  end if;
  return query
  select i.id, i.invoice_number, i.bill_to_kind, i.bill_to_name, p.display_name, i.issue_date, i.due_date, i.total_cents,
         i.total_cents - public._billing_paid_cents(i.id), i.version,
         public._billing_payer_identity_matches(v_receipt, i)
  from public.billing_invoices i
  join public.passengers p on p.id = i.passenger_id and p.organization_id = i.organization_id
  where i.organization_id = p_organization_id and i.status = 'issued' and i.total_cents - public._billing_paid_cents(i.id) > 0
  order by public._billing_payer_identity_matches(v_receipt, i) desc, i.issue_date, i.invoice_number
  limit 100;
end;
$$;
comment on function public.billing_list_open_invoices(uuid, uuid, text, uuid) is
  'NP-FIN-P1. view. Issued invoices with a balance (oldest first within each group), flagged same_payer by authoritative identity for an existing receipt or a prospective payer (passenger / requester request id / facility id; "other" never matches). Feeds the allocation editor and the oldest-first suggestion. At most 100.';
revoke all on function public.billing_list_open_invoices(uuid, uuid, text, uuid) from public, anon, service_role;
grant execute on function public.billing_list_open_invoices(uuid, uuid, text, uuid) to authenticated;

create function public.billing_invoice_credit_sources(p_organization_id uuid, p_invoice_id uuid)
returns table (receipt_id uuid, receipt_number integer, received_on date, unallocated_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.billing_invoices%rowtype;
begin
  perform public._billing_authorize(p_organization_id, 'view');
  select * into v_inv from public.billing_invoices i where i.id = p_invoice_id and i.organization_id = p_organization_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select r.id, r.receipt_number, r.received_on, public._billing_receipt_unallocated(r.id)
  from public.billing_receipts r
  where r.organization_id = p_organization_id
    and public._billing_payer_identity_matches(r, v_inv)
    and public._billing_receipt_unallocated(r.id) > 0
  order by r.received_on, r.receipt_number
  limit 50;
end;
$$;
comment on function public.billing_invoice_credit_sources(uuid, uuid) is
  'NP-FIN-P1. view. The payer credit available for an invoice: receipts of the SAME payer (authoritative identity only; never by name) with unallocated funds, oldest first. Credit of other / unverified payers is applied from the receipt page with explicit Organization Admin confirmation.';
revoke all on function public.billing_invoice_credit_sources(uuid, uuid) from public, anon, service_role;
grant execute on function public.billing_invoice_credit_sources(uuid, uuid) to authenticated;

create function public.billing_list_payers(p_organization_id uuid)
returns table (payer_kind text, payer_id uuid, payer_name text, open_invoice_count integer, balance_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._billing_authorize(p_organization_id, 'view');
  return query
  with open_inv as (
    select i.bill_to_kind as kind, coalesce(i.bill_to_passenger_id, i.bill_to_request_id, i.bill_to_facility_id) as pid,
           count(*)::integer as n, sum(i.total_cents - public._billing_paid_cents(i.id))::bigint as bal
    from public.billing_invoices i
    where i.organization_id = p_organization_id and i.status = 'issued' and i.bill_to_kind <> 'other'
      and i.total_cents - public._billing_paid_cents(i.id) > 0
    group by 1, 2
  )
  -- the payer's CURRENT name from its own record (invoice bill-to text is a per-invoice snapshot)
  select o.kind, o.pid,
         coalesce(case o.kind when 'passenger' then (select p.display_name from public.passengers p where p.id = o.pid and p.organization_id = p_organization_id)
                              when 'requester' then (select r.requester_name from public.transportation_requests r where r.id = o.pid and r.organization_id = p_organization_id)
                              when 'facility' then (select f.name from public.facilities f where f.id = o.pid and f.organization_id = p_organization_id) end, 'Unknown payer'),
         o.n, o.bal
  from open_inv o
  order by 3
  limit 200;
end;
$$;
comment on function public.billing_list_payers(uuid) is
  'NP-FIN-P1. view. Payers with an authoritative identity (passenger / requester request / facility) that have open issued invoices, labelled with the name from their own record -- the payer choices for recording a receipt that is not tied to one invoice. "Other" payers are typed by name and stay unverified.';
revoke all on function public.billing_list_payers(uuid) from public, anon, service_role;
grant execute on function public.billing_list_payers(uuid) to authenticated;

create function public.billing_ledger_summary(p_organization_id uuid)
returns table (credit_cents bigint, credit_receipt_count integer, receipts_this_month integer, refunds_this_month_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public._billing_org_today(p_organization_id);
begin
  perform public._billing_authorize(p_organization_id, 'view');
  return query
  with c as (
    select public._billing_receipt_unallocated(r.id) as un, r.received_on
    from public.billing_receipts r where r.organization_id = p_organization_id
  )
  select coalesce((select sum(c.un) from c where c.un > 0), 0)::bigint,
         (select count(*) from c where c.un > 0)::integer,
         (select count(*) from c where c.received_on >= date_trunc('month', v_today)::date)::integer,
         coalesce((select sum(f.amount_cents) from public.billing_refunds f
                   where f.organization_id = p_organization_id and f.refunded_on >= date_trunc('month', v_today)::date
                     and not exists (select 1 from public.billing_refund_reversals x where x.refund_id = f.id)), 0)::bigint;
end;
$$;
comment on function public.billing_ledger_summary(uuid) is
  'NP-FIN-P1. view. Payer credit (unallocated funds of receipts that were not reversed), number of receipts holding credit, receipts recorded this month, refunds recorded this month (org timezone).';
revoke all on function public.billing_ledger_summary(uuid) from public, anon, service_role;
grant execute on function public.billing_ledger_summary(uuid) to authenticated;
