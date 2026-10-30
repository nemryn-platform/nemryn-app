-- =============================================================================
-- NP-FIN-P1 (Stage 1) -- Core billing ledger re-foundation: data foundation.
--
-- Decisions: docs/product/decision-register.md ZD-266, ZD-268, ZD-269, ZD-270, ZD-272, ZD-278, ZD-279, ZD-280;
-- plan: docs/reports/NP-FIN-P1-implementation-plan.md; lock: docs/reports/NP-FIN-P0-decision-lock.txt.
--
--   billing_receipt_counters    per-organization receipt numbers (RCPT-000123)
--   billing_receipts            money RECEIVED (gross, optional processing fee = the agency's expense, payer snapshot)
--   billing_assurance_events    evidence / provider confirmation / reconciliation facts of a receipt or refund
--                               (provider_confirmed + reconciled can never come from staff -- ZD-270)
--   billing_allocations         money APPLIED to (apply) or removed from (unapply) ONE issued invoice
--   billing_refunds             money RETURNED from a receipt's unallocated funds (manually recorded, ZD-278)
--   billing_refund_reversals    a refund recorded in error (correction, once)
--   billing_receipt_reversals   a receipt recorded in error / returned check (correction, once)
--
-- Every table: organization_id + composite (id, organization_id) keys (cross-tenant links unrepresentable), RLS with a
-- SELECT policy through the billing permission catalogue (billing_can -> Organization Admin in FIN-P1), NO client write
-- grants -- writes only through the SECURITY DEFINER RPCs of 20261029110000_core_billing_ledger_rpcs.sql. Append-only
-- (UPDATE / DELETE / TRUNCATE refused for everyone, owner included). Financial invariants are enforced HERE twice:
-- BEFORE INSERT triggers lock the parent rows (receipt, then invoice) and validate against the latest committed state,
-- and DEFERRED constraint triggers re-validate at commit (multi-statement / bypass attempts).
--
-- billing_payments (NP-BILL-P1) is RETIRED, not dropped (ZD-268): it must be empty (asserted below -- production
-- preflight G1), every write is refused from now on, and its SELECT grant stays for one transition release so an older
-- app build still loads. Amounts: bigint cents, USD only. No card data (numbers that look like card numbers are refused).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Zero-row gate (ZD-268): the retired ledger must be empty. Any data -> STOP.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.billing_payments) then
    raise exception 'NP-FIN-P1: public.billing_payments is not empty -- STOP (ZD-268 zero-row gate)';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Helpers used by constraints
-- -----------------------------------------------------------------------------
create function public._billing_looks_like_pan(p text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text;
  run text;
  s integer;
  d integer;
  i integer;
begin
  if p is null then
    return false;
  end if;
  -- digits separated by single spaces / dashes count as one run ("4111 1111 1111 1111")
  v := regexp_replace(p, '(\d)[ -](?=\d)', '\1', 'g');
  for run in select (regexp_matches(v, '\d+', 'g'))[1] loop
    if length(run) between 13 and 19 then
      s := 0;
      for i in 1 .. length(run) loop
        d := substr(run, length(run) - i + 1, 1)::integer;
        if i % 2 = 0 then
          d := d * 2;
          if d > 9 then d := d - 9; end if;
        end if;
        s := s + d;
      end loop;
      if s % 10 = 0 then
        return true;   -- a 13-19 digit run that passes the Luhn check: treat as a payment card number
      end if;
    end if;
  end loop;
  return false;
end;
$$;
comment on function public._billing_looks_like_pan(text) is
  'NP-FIN-P1. INTERNAL. True when the text contains a 13-19 digit run (spaces / dashes allowed between digits) that passes the Luhn check, i.e. something that looks like a payment card number. Used by CHECK constraints so card numbers are never stored in references, notes or reasons.';
revoke all on function public._billing_looks_like_pan(text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Receipt counters
-- -----------------------------------------------------------------------------
create table public.billing_receipt_counters (
  organization_id uuid primary key references public.organizations (id),
  next_number integer not null default 1,
  constraint billing_receipt_counters_next_number_check check (next_number >= 1)
);
comment on table public.billing_receipt_counters is
  'NP-FIN-P1. Next receipt number per organization (RCPT-000123). Locked first by every receipt-creating transaction (global lock order: counter -> receipts -> invoices), so numbers never repeat and have no gaps. No client access.';
alter table public.billing_receipt_counters enable row level security;
revoke all on table public.billing_receipt_counters from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Receipts (money received)
-- -----------------------------------------------------------------------------
create table public.billing_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  receipt_number integer not null,
  payer_kind text not null,
  payer_passenger_id uuid,
  payer_request_id uuid,
  payer_facility_id uuid,
  payer_name text not null,
  source_invoice_id uuid,
  currency text not null default 'USD',
  gross_cents bigint not null,
  fee_cents bigint not null default 0,
  net_cents bigint generated always as (gross_cents - fee_cents) stored,
  received_on date not null,
  method text not null,
  provider text,
  reference text,
  reference_norm text generated always as (nullif(upper(regexp_replace(coalesce(reference, ''), '[^A-Za-z0-9]', '', 'g')), '')) stored,
  provider_txn_id text,
  note text,
  idempotency_key text not null,
  recorded_by uuid not null references auth.users (id),
  recorded_at timestamptz not null default now(),
  constraint billing_receipts_id_organization_id_key unique (id, organization_id),
  constraint billing_receipts_number_key unique (organization_id, receipt_number),
  constraint billing_receipts_idempotency_key unique (organization_id, idempotency_key),
  constraint billing_receipts_payer_passenger_fkey
    foreign key (payer_passenger_id, organization_id) references public.passengers (id, organization_id),
  constraint billing_receipts_payer_request_fkey
    foreign key (payer_request_id, organization_id) references public.transportation_requests (id, organization_id),
  constraint billing_receipts_payer_facility_fkey
    foreign key (payer_facility_id, organization_id) references public.facilities (id, organization_id),
  constraint billing_receipts_source_invoice_fkey
    foreign key (source_invoice_id, organization_id) references public.billing_invoices (id, organization_id),
  constraint billing_receipts_number_check check (receipt_number >= 1),
  constraint billing_receipts_payer_kind_check check (payer_kind in ('passenger', 'requester', 'facility', 'other')),
  constraint billing_receipts_payer_shape_check check (
    ((payer_kind = 'passenger') = (payer_passenger_id is not null))
    and ((payer_kind = 'requester') = (payer_request_id is not null))
    and ((payer_kind = 'facility') = (payer_facility_id is not null))
  ),
  constraint billing_receipts_payer_name_check check (payer_name = btrim(payer_name) and length(payer_name) between 1 and 200),
  constraint billing_receipts_currency_check check (currency = 'USD'),
  constraint billing_receipts_money_check check (gross_cents between 1 and 100000000000 and fee_cents between 0 and gross_cents),
  constraint billing_receipts_method_check check (method in ('cash', 'check', 'card', 'ach', 'bank_transfer', 'wire', 'digital_wallet', 'other')),
  constraint billing_receipts_provider_check check (provider is null or provider in ('stripe', 'square', 'paypal', 'zelle', 'venmo', 'bank', 'other')),
  constraint billing_receipts_text_check check (
    (reference is null or (reference = btrim(reference) and length(reference) between 1 and 100))
    and (note is null or (note = btrim(note) and length(note) between 1 and 500))
    and (provider_txn_id is null or length(provider_txn_id) between 1 and 200)
    and not public._billing_looks_like_pan(reference) and not public._billing_looks_like_pan(note)
  ),
  constraint billing_receipts_date_check check (received_on >= date '2000-01-01'),
  constraint billing_receipts_idempotency_format_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$')
);
comment on table public.billing_receipts is
  'NP-FIN-P1 (ZD-268). Money RECEIVED, recorded by staff (append-only). gross = what the payer paid; fee = optional processing fee (the agency''s expense, never charged to the customer); net = gross - fee. Payer: an organization-scoped passenger / request (requester) / facility id, or "other" (typed name, identity not verified). source_invoice_id = the invoice whose bill-to defined the payer (recorded from that invoice). A typed reference is evidence only -- provider confirmation is a separate fact (billing_assurance_events). provider_txn_id is reserved for provider integrations (FIN-P5 / P6; no writer in FIN-P1). Allocated / refunded / unallocated (payer credit) amounts are derived, never stored.';
create index billing_receipts_org_received_idx on public.billing_receipts (organization_id, received_on desc, receipt_number desc);
create index billing_receipts_duplicate_idx on public.billing_receipts (organization_id, method, reference_norm, gross_cents, received_on)
  where reference_norm is not null;
create index billing_receipts_payer_idx on public.billing_receipts (organization_id, payer_kind, payer_passenger_id, payer_request_id, payer_facility_id);
create unique index billing_receipts_provider_txn_key on public.billing_receipts (organization_id, provider, provider_txn_id)
  where provider_txn_id is not null;

-- -----------------------------------------------------------------------------
-- 4. Allocations (money applied to / removed from ONE issued invoice)
-- -----------------------------------------------------------------------------
create table public.billing_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  receipt_id uuid not null,
  invoice_id uuid not null,
  kind text not null,
  amount_cents bigint not null,
  unapplies_allocation_id uuid,
  different_payer boolean not null default false,
  reason text,
  request_key text not null,
  request_seq integer not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint billing_allocations_id_organization_id_key unique (id, organization_id),
  constraint billing_allocations_id_receipt_invoice_key unique (id, receipt_id, invoice_id),
  constraint billing_allocations_one_unapply_key unique (unapplies_allocation_id),
  constraint billing_allocations_request_key unique (organization_id, request_key, request_seq),
  constraint billing_allocations_receipt_fkey
    foreign key (receipt_id, organization_id) references public.billing_receipts (id, organization_id),
  constraint billing_allocations_invoice_fkey
    foreign key (invoice_id, organization_id) references public.billing_invoices (id, organization_id),
  -- an unapply removes exactly one apply of the SAME receipt and the SAME invoice
  constraint billing_allocations_unapplies_fkey
    foreign key (unapplies_allocation_id, receipt_id, invoice_id) references public.billing_allocations (id, receipt_id, invoice_id),
  constraint billing_allocations_kind_check check (kind in ('apply', 'unapply')),
  constraint billing_allocations_amount_check check (amount_cents between 1 and 100000000000),
  constraint billing_allocations_shape_check check (
    ((kind = 'apply') = (unapplies_allocation_id is null))
    and (kind = 'apply' or reason is not null)
    and (not different_payer or (kind = 'apply' and reason is not null))
  ),
  constraint billing_allocations_reason_check check (
    reason is null or (length(btrim(reason)) between 3 and 500 and not public._billing_looks_like_pan(reason))
  ),
  constraint billing_allocations_request_check check (request_key ~ '^[A-Za-z0-9._:-]{8,100}$' and request_seq between 1 and 100)
);
comment on table public.billing_allocations is
  'NP-FIN-P1 (ZD-268 / ZD-269). Append-only. apply = part of a receipt applied to ONE issued invoice of the same organization (composite FKs: cross-tenant allocation is unrepresentable); unapply = removes exactly one apply (same receipt + invoice, full amount, once, reason required). different_payer = an Organization Admin explicitly applied credit to an invoice of a payer whose identity does not match (reason required, audited). Invoice paid = sum(apply) - sum(unapply), never stored. request_key / request_seq make every allocating call idempotent.';
create index billing_allocations_invoice_idx on public.billing_allocations (invoice_id, created_at);
create index billing_allocations_receipt_idx on public.billing_allocations (receipt_id, created_at);

-- -----------------------------------------------------------------------------
-- 5. Refunds (money returned) and their corrections
-- -----------------------------------------------------------------------------
create table public.billing_refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  receipt_id uuid not null,
  refund_seq integer not null,
  amount_cents bigint not null,
  refunded_on date not null,
  method text not null,
  provider text,
  reference text,
  reason text not null,
  idempotency_key text not null,
  recorded_by uuid not null references auth.users (id),
  recorded_at timestamptz not null default now(),
  constraint billing_refunds_id_organization_id_key unique (id, organization_id),
  constraint billing_refunds_id_receipt_key unique (id, receipt_id),
  constraint billing_refunds_seq_key unique (receipt_id, refund_seq),
  constraint billing_refunds_idempotency_key unique (organization_id, idempotency_key),
  constraint billing_refunds_receipt_fkey
    foreign key (receipt_id, organization_id) references public.billing_receipts (id, organization_id),
  constraint billing_refunds_seq_check check (refund_seq between 1 and 1000),
  constraint billing_refunds_amount_check check (amount_cents between 1 and 100000000000),
  constraint billing_refunds_method_check check (method in ('cash', 'check', 'card', 'ach', 'bank_transfer', 'wire', 'digital_wallet', 'other')),
  constraint billing_refunds_provider_check check (provider is null or provider in ('stripe', 'square', 'paypal', 'zelle', 'venmo', 'bank', 'other')),
  constraint billing_refunds_text_check check (
    (reference is null or (reference = btrim(reference) and length(reference) between 1 and 100))
    and length(btrim(reason)) between 3 and 500
    and not public._billing_looks_like_pan(reference) and not public._billing_looks_like_pan(reason)
  ),
  constraint billing_refunds_date_check check (refunded_on >= date '2000-01-01'),
  constraint billing_refunds_idempotency_format_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$')
);
comment on table public.billing_refunds is
  'NP-FIN-P1 (ZD-278). Append-only. A refund RECORDED by an authorized user: money the organization says it returned from a receipt''s unallocated funds (refund <= unallocated, enforced under the receipt lock). Recording a refund does not move money and is not proof of settlement: provider confirmation / reconciliation are separate facts (billing_assurance_events, FIN-P5 / P6). Reduces the receipt''s refundable funds as soon as it is recorded; a refund entered in error is corrected by billing_refund_reversals.';
create index billing_refunds_receipt_idx on public.billing_refunds (receipt_id, refund_seq);
create index billing_refunds_org_date_idx on public.billing_refunds (organization_id, refunded_on);

create table public.billing_refund_reversals (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  refund_id uuid not null,
  receipt_id uuid not null,
  reason text not null,
  idempotency_key text not null,
  reversed_by uuid not null references auth.users (id),
  reversed_at timestamptz not null default now(),
  constraint billing_refund_reversals_id_organization_id_key unique (id, organization_id),
  constraint billing_refund_reversals_one_key unique (refund_id),
  constraint billing_refund_reversals_idempotency_key unique (organization_id, idempotency_key),
  constraint billing_refund_reversals_refund_fkey
    foreign key (refund_id, receipt_id) references public.billing_refunds (id, receipt_id),
  constraint billing_refund_reversals_receipt_fkey
    foreign key (receipt_id, organization_id) references public.billing_receipts (id, organization_id),
  constraint billing_refund_reversals_reason_check check (length(btrim(reason)) between 3 and 500 and not public._billing_looks_like_pan(reason)),
  constraint billing_refund_reversals_idempotency_format_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$')
);
comment on table public.billing_refund_reversals is
  'NP-FIN-P1. Append-only. Corrects ONE refund recorded in error (once, reason required); the refund stops counting and its amount is refundable / allocatable again. The refund row itself is never changed.';

-- -----------------------------------------------------------------------------
-- 6. Receipt reversals (receipt recorded in error / returned check)
-- -----------------------------------------------------------------------------
create table public.billing_receipt_reversals (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  receipt_id uuid not null,
  reason_code text not null,
  reason text not null,
  idempotency_key text not null,
  reversed_by uuid not null references auth.users (id),
  reversed_at timestamptz not null default now(),
  constraint billing_receipt_reversals_id_organization_id_key unique (id, organization_id),
  constraint billing_receipt_reversals_one_key unique (receipt_id),
  constraint billing_receipt_reversals_idempotency_key unique (organization_id, idempotency_key),
  constraint billing_receipt_reversals_receipt_fkey
    foreign key (receipt_id, organization_id) references public.billing_receipts (id, organization_id),
  constraint billing_receipt_reversals_code_check check (reason_code in ('entry_error', 'returned_check', 'duplicate', 'other')),
  constraint billing_receipt_reversals_reason_check check (length(btrim(reason)) between 3 and 500 and not public._billing_looks_like_pan(reason)),
  constraint billing_receipt_reversals_idempotency_format_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$')
);
comment on table public.billing_receipt_reversals is
  'NP-FIN-P1. Append-only. A receipt recorded in error, a returned (bounced) check or a duplicate: once per receipt, reason required, only when nothing of it is applied or refunded (net). It is a correction of the record, not a refund; the receipt row is never changed and keeps its number.';

-- -----------------------------------------------------------------------------
-- 7. Assurance events (ZD-270): four independent facts; manual entry can never claim provider / bank confirmation
-- -----------------------------------------------------------------------------
create table public.billing_assurance_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  receipt_id uuid,
  refund_id uuid,
  kind text not null,
  source text not null,
  source_ref uuid,
  actor_id uuid references auth.users (id),
  occurred_at timestamptz not null default now(),
  constraint billing_assurance_events_id_organization_id_key unique (id, organization_id),
  constraint billing_assurance_events_receipt_fkey
    foreign key (receipt_id, organization_id) references public.billing_receipts (id, organization_id),
  constraint billing_assurance_events_refund_fkey
    foreign key (refund_id, organization_id) references public.billing_refunds (id, organization_id),
  constraint billing_assurance_events_subject_check check ((receipt_id is null) <> (refund_id is null)),
  constraint billing_assurance_events_kind_check check (kind in ('evidence_reference_noted', 'evidence_document_held', 'provider_confirmed', 'reconciled')),
  constraint billing_assurance_events_source_check check (source in ('staff', 'provider_import', 'statement_match')),
  -- staff record EVIDENCE only; provider confirmation and reconciliation come only from an import / statement match
  constraint billing_assurance_events_source_kind_check check (
    (kind in ('evidence_reference_noted', 'evidence_document_held') and source = 'staff' and actor_id is not null)
    or (kind in ('provider_confirmed', 'reconciled') and source <> 'staff' and source_ref is not null)
  )
);
comment on table public.billing_assurance_events is
  'NP-FIN-P1 (ZD-270). Append-only assurance facts of a receipt or a refund: evidence_reference_noted / evidence_document_held (staff), provider_confirmed (provider integration / settlement import only) and reconciled (approved statement match only). A CHECK makes it impossible to record provider confirmation or reconciliation by hand -- a typed reference is never provider verification. FIN-P1 has no writer for provider_confirmed / reconciled.';
create unique index billing_assurance_events_receipt_kind_key on public.billing_assurance_events (receipt_id, kind) where receipt_id is not null;
create unique index billing_assurance_events_refund_kind_key on public.billing_assurance_events (refund_id, kind) where refund_id is not null;

-- -----------------------------------------------------------------------------
-- 8. Derivations (INTERNAL, never stored)
-- -----------------------------------------------------------------------------
create function public._billing_invoice_net(p_invoice_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case when a.kind = 'apply' then a.amount_cents else -a.amount_cents end), 0)::bigint
  from public.billing_allocations a where a.invoice_id = p_invoice_id;
$$;
comment on function public._billing_invoice_net(uuid) is 'NP-FIN-P1. INTERNAL. Net paid on an invoice = sum(apply) - sum(unapply).';
revoke all on function public._billing_invoice_net(uuid) from public, anon, authenticated, service_role;

create function public._billing_receipt_allocated(p_receipt_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case when a.kind = 'apply' then a.amount_cents else -a.amount_cents end), 0)::bigint
  from public.billing_allocations a where a.receipt_id = p_receipt_id;
$$;
revoke all on function public._billing_receipt_allocated(uuid) from public, anon, authenticated, service_role;

create function public._billing_receipt_refunded(p_receipt_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(f.amount_cents), 0)::bigint
  from public.billing_refunds f
  where f.receipt_id = p_receipt_id
    and not exists (select 1 from public.billing_refund_reversals rr where rr.refund_id = f.id);
$$;
comment on function public._billing_receipt_refunded(uuid) is 'NP-FIN-P1. INTERNAL. Recorded refunds of a receipt that were not reversed.';
revoke all on function public._billing_receipt_refunded(uuid) from public, anon, authenticated, service_role;

create function public._billing_receipt_is_reversed(p_receipt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.billing_receipt_reversals r where r.receipt_id = p_receipt_id);
$$;
revoke all on function public._billing_receipt_is_reversed(uuid) from public, anon, authenticated, service_role;

create function public._billing_receipt_unallocated(p_receipt_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public._billing_receipt_is_reversed(r.id) then 0
              else r.gross_cents - public._billing_receipt_allocated(r.id) - public._billing_receipt_refunded(r.id) end
  from public.billing_receipts r where r.id = p_receipt_id;
$$;
comment on function public._billing_receipt_unallocated(uuid) is
  'NP-FIN-P1. INTERNAL. Payer credit = refundable funds of a receipt = gross - net allocated - recorded (not reversed) refunds; 0 once reversed.';
revoke all on function public._billing_receipt_unallocated(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. Append-only guard (all ledger tables)
-- -----------------------------------------------------------------------------
create function public._billing_ledger_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'ledger_immutable' using errcode = 'ZW004';   -- append-only: never updated, deleted or truncated
end;
$$;
comment on function public._billing_ledger_append_only() is
  'NP-FIN-P1. INTERNAL trigger: receipts, allocations, refunds, reversals and assurance events are append-only for everyone, the table owner included (UPDATE / DELETE / TRUNCATE -> ZW004).';
revoke all on function public._billing_ledger_append_only() from public, anon, authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['billing_receipts', 'billing_allocations', 'billing_refunds', 'billing_refund_reversals',
                            'billing_receipt_reversals', 'billing_assurance_events'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public._billing_ledger_append_only()',
                   t || '_append_only', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public._billing_ledger_append_only()',
                   t || '_no_truncate', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Immediate invariant guards (lock parents in the global order: receipt -> invoice)
-- -----------------------------------------------------------------------------
create function public._billing_allocation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt public.billing_receipts%rowtype;
  v_inv public.billing_invoices%rowtype;
  v_apply public.billing_allocations%rowtype;
begin
  select * into v_receipt from public.billing_receipts r where r.id = new.receipt_id for update;
  select * into v_inv from public.billing_invoices i where i.id = new.invoice_id for update;
  -- never across organizations (the composite FKs refuse it too; checked here first so the reason is explicit)
  if v_receipt.organization_id is distinct from new.organization_id or v_inv.organization_id is distinct from new.organization_id then
    raise exception 'cross_organization' using errcode = 'ZW006';
  end if;
  if v_inv.status is distinct from 'issued' then
    raise exception 'invoice_not_open' using errcode = 'ZW004';
  end if;
  if v_receipt.currency is distinct from v_inv.currency then
    raise exception 'currency_mismatch' using errcode = 'ZW006';
  end if;
  if public._billing_receipt_is_reversed(v_receipt.id) then
    raise exception 'receipt_reversed' using errcode = 'ZW004';
  end if;
  if new.kind = 'apply' then
    if new.amount_cents > v_inv.total_cents - public._billing_invoice_net(v_inv.id) then
      raise exception 'amount_exceeds_balance' using errcode = 'ZW006';
    end if;
    if new.amount_cents > public._billing_receipt_unallocated(v_receipt.id) then
      raise exception 'amount_exceeds_receipt' using errcode = 'ZW006';
    end if;
  else
    select * into v_apply from public.billing_allocations a where a.id = new.unapplies_allocation_id;
    if v_apply.kind is distinct from 'apply' or v_apply.amount_cents is distinct from new.amount_cents then
      raise exception 'invalid_unapply' using errcode = 'ZW006';   -- an unapply mirrors exactly one apply, in full
    end if;
  end if;
  return new;
end;
$$;
comment on function public._billing_allocation_guard() is
  'NP-FIN-P1. INTERNAL BEFORE INSERT trigger: locks the receipt, then the invoice (global order), and validates against the latest committed state: invoice issued, same currency, receipt not reversed, apply <= invoice balance and <= receipt unallocated funds; an unapply mirrors exactly one apply. Concurrent allocations (RPC or direct) therefore serialize and cannot over-allocate.';
revoke all on function public._billing_allocation_guard() from public, anon, authenticated, service_role;
create trigger billing_allocations_guard
  before insert on public.billing_allocations
  for each row execute function public._billing_allocation_guard();

create function public._billing_refund_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt public.billing_receipts%rowtype;
begin
  select * into v_receipt from public.billing_receipts r where r.id = new.receipt_id for update;
  if public._billing_receipt_is_reversed(v_receipt.id) then
    raise exception 'receipt_reversed' using errcode = 'ZW004';
  end if;
  if new.amount_cents > public._billing_receipt_unallocated(v_receipt.id) then
    raise exception 'refund_exceeds_refundable' using errcode = 'ZW006';
  end if;
  if new.refunded_on < v_receipt.received_on then
    raise exception 'invalid_dates' using errcode = 'ZW006';
  end if;
  return new;
end;
$$;
comment on function public._billing_refund_guard() is
  'NP-FIN-P1. INTERNAL BEFORE INSERT trigger: locks the receipt; a refund never exceeds the receipt''s unallocated (refundable) funds, never on a reversed receipt, never dated before the receipt.';
revoke all on function public._billing_refund_guard() from public, anon, authenticated, service_role;
create trigger billing_refunds_guard
  before insert on public.billing_refunds
  for each row execute function public._billing_refund_guard();

create function public._billing_refund_reversal_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.billing_receipts r where r.id = new.receipt_id for update;
  if public._billing_receipt_is_reversed(new.receipt_id) then
    raise exception 'receipt_reversed' using errcode = 'ZW004';
  end if;
  return new;
end;
$$;
revoke all on function public._billing_refund_reversal_guard() from public, anon, authenticated, service_role;
create trigger billing_refund_reversals_guard
  before insert on public.billing_refund_reversals
  for each row execute function public._billing_refund_reversal_guard();

create function public._billing_receipt_reversal_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.billing_receipts r where r.id = new.receipt_id for update;
  if public._billing_receipt_allocated(new.receipt_id) <> 0 then
    raise exception 'receipt_has_allocations' using errcode = 'ZW004';   -- unapply first
  end if;
  if public._billing_receipt_refunded(new.receipt_id) <> 0 then
    raise exception 'receipt_has_refunds' using errcode = 'ZW004';
  end if;
  return new;
end;
$$;
comment on function public._billing_receipt_reversal_guard() is
  'NP-FIN-P1. INTERNAL BEFORE INSERT trigger: locks the receipt; a receipt can be reversed only when nothing of it is applied or refunded (net).';
revoke all on function public._billing_receipt_reversal_guard() from public, anon, authenticated, service_role;
create trigger billing_receipt_reversals_guard
  before insert on public.billing_receipt_reversals
  for each row execute function public._billing_receipt_reversal_guard();

-- -----------------------------------------------------------------------------
-- 11. Deferred invariants (re-checked at COMMIT; catches multi-statement / bypass sequences)
-- -----------------------------------------------------------------------------
create function public._billing_check_invoice_invariants(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.billing_invoices%rowtype;
  v_net bigint;
begin
  select * into v_inv from public.billing_invoices i where i.id = p_invoice_id;
  if not found then
    return;
  end if;
  v_net := public._billing_invoice_net(p_invoice_id);
  if v_net < 0 or v_net > v_inv.total_cents then
    raise exception 'ledger_invariant_violation: invoice paid out of range' using errcode = 'ZW004';
  end if;
  if v_inv.status <> 'issued' and v_net <> 0 then
    raise exception 'ledger_invariant_violation: money applied to a % invoice', v_inv.status using errcode = 'ZW004';
  end if;
  if v_inv.status = 'draft' and exists (select 1 from public.billing_allocations a where a.invoice_id = p_invoice_id) then
    raise exception 'ledger_invariant_violation: allocation on a draft invoice' using errcode = 'ZW004';
  end if;
end;
$$;
revoke all on function public._billing_check_invoice_invariants(uuid) from public, anon, authenticated, service_role;

create function public._billing_check_receipt_invariants(p_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gross bigint;
  v_alloc bigint;
  v_ref bigint;
begin
  select r.gross_cents into v_gross from public.billing_receipts r where r.id = p_receipt_id;
  if v_gross is null then
    return;
  end if;
  v_alloc := public._billing_receipt_allocated(p_receipt_id);
  v_ref := public._billing_receipt_refunded(p_receipt_id);
  if v_alloc < 0 or v_ref < 0 or v_alloc + v_ref > v_gross then
    raise exception 'ledger_invariant_violation: receipt over-spent' using errcode = 'ZW004';
  end if;
  if public._billing_receipt_is_reversed(p_receipt_id) and (v_alloc <> 0 or v_ref <> 0) then
    raise exception 'ledger_invariant_violation: reversed receipt still applied or refunded' using errcode = 'ZW004';
  end if;
end;
$$;
revoke all on function public._billing_check_receipt_invariants(uuid) from public, anon, authenticated, service_role;

create function public._billing_ledger_deferred_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'billing_invoices' then
    perform public._billing_check_invoice_invariants(new.id);
  elsif tg_table_name = 'billing_allocations' then
    perform public._billing_check_receipt_invariants(new.receipt_id);
    perform public._billing_check_invoice_invariants(new.invoice_id);
  else   -- refunds, refund reversals, receipt reversals
    perform public._billing_check_receipt_invariants(new.receipt_id);
  end if;
  return null;
end;
$$;
comment on function public._billing_ledger_deferred_check() is
  'NP-FIN-P1. INTERNAL deferred constraint trigger (checked at COMMIT): invoice 0 <= paid <= total, money only on issued invoices (void / draft at net 0); receipt allocated + refunded <= gross; a reversed receipt is fully unapplied and unrefunded. Defence in depth behind the RPC checks and the immediate guards.';
revoke all on function public._billing_ledger_deferred_check() from public, anon, authenticated, service_role;

create constraint trigger billing_allocations_invariants
  after insert on public.billing_allocations deferrable initially deferred
  for each row execute function public._billing_ledger_deferred_check();
create constraint trigger billing_refunds_invariants
  after insert on public.billing_refunds deferrable initially deferred
  for each row execute function public._billing_ledger_deferred_check();
create constraint trigger billing_refund_reversals_invariants
  after insert on public.billing_refund_reversals deferrable initially deferred
  for each row execute function public._billing_ledger_deferred_check();
create constraint trigger billing_receipt_reversals_invariants
  after insert on public.billing_receipt_reversals deferrable initially deferred
  for each row execute function public._billing_ledger_deferred_check();
-- an invoice leaving 'issued' (void) must carry no applied money -- also against a direct owner UPDATE
create constraint trigger billing_invoices_ledger_invariants
  after update of status on public.billing_invoices deferrable initially deferred
  for each row execute function public._billing_ledger_deferred_check();

-- -----------------------------------------------------------------------------
-- 12. Permission catalogue (ZD-272) + RLS
-- -----------------------------------------------------------------------------
create function public._billing_action_roles(p_action text)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    -- read / ordinary billing write (billing grant arrives in FIN-P4; Organization Admin only until then)
    when p_action in ('view', 'invoice_write', 'receipt_write', 'allocate', 'evidence_add') then array['organization_admin']
    -- SENSITIVE: Organization Admin only until a later approved decision (ZD-272)
    when p_action in ('void', 'unapply', 'reverse', 'refund', 'refund_reverse', 'cross_payer_allocate') then array['organization_admin']
    else null
  end;
$$;
comment on function public._billing_action_roles(text) is
  'NP-FIN-P1 (ZD-272). INTERNAL. The billing permission catalogue: action -> membership roles allowed. Ordinary: view, invoice_write, receipt_write, allocate, evidence_add. SENSITIVE: void, unapply, reverse, refund, refund_reverse, cross_payer_allocate. Every action maps to Organization Admin in FIN-P1; delegation later changes this mapping only. Unknown action -> NULL (refused).';
revoke all on function public._billing_action_roles(text) from public, anon, authenticated, service_role;

create function public.billing_can(p_organization_id uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and p_organization_id is not null and public._billing_action_roles(p_action) is not null
     and public.has_org_role(p_organization_id, public._billing_action_roles(p_action));
$$;
comment on function public.billing_can(uuid, text) is
  'NP-FIN-P1 (ZD-272). True when the signed-in caller may perform the billing action in the organization (permission catalogue; Organization Admin for every action in FIN-P1). Used by RLS on the ledger tables and by the RPCs.';
revoke all on function public.billing_can(uuid, text) from public, anon, service_role;
grant execute on function public.billing_can(uuid, text) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['billing_receipts', 'billing_allocations', 'billing_refunds', 'billing_refund_reversals',
                            'billing_receipt_reversals', 'billing_assurance_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.billing_can(organization_id, ''view''))',
                   t || '_select_billing', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Retire billing_payments (ZD-268): every write refused; SELECT kept for one transition release
-- -----------------------------------------------------------------------------
create or replace function public._billing_payments_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'billing_payments_retired' using errcode = 'ZW004';
end;
$$;
comment on function public._billing_payments_guard() is
  'NP-BILL-P1 / NP-FIN-P1 (ZD-268). INTERNAL trigger: billing_payments is RETIRED -- INSERT, UPDATE, DELETE and TRUNCATE are refused for everyone (ZW004). Payments are recorded as receipts + allocations. SELECT stays for one transition release; it is revoked in the following release and the table is dropped only by a separately approved migration.';
comment on table public.billing_payments is
  'RETIRED by NP-FIN-P1 (ZD-268): read-only, always empty (zero-row gate). Replaced by billing_receipts + billing_allocations. SELECT kept for one transition release only.';
