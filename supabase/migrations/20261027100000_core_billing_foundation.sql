-- =============================================================================
-- NP-BILL-P1 (Stage A1) -- Core private-pay billing: data foundation.
--
-- Approved contract: docs/reports/NP-BILL-P1-contract-and-decisions.txt (D1-D6, refinements R1-R4).
-- CORE, not Plus (D1): no entitlement check; Organization Admins only (D2).
--
--   billing_invoice_counters  per-organization invoice numbers (assigned at issue, D4)
--   billing_invoices          one invoice = completed trips of ONE passenger for ONE bill-to party (D3, R1);
--                             frozen once issued, only issued -> void afterwards (D4, R4)
--   billing_invoice_trips     invoice <-> trip links; a trip is on at most ONE non-void invoice (partial unique index)
--   billing_invoice_lines     itemised charges in integer cents; editable only while the invoice is a draft
--   billing_payments          append-only manual payment ledger; corrections are reversal entries (D5, R2)
--
-- Every table: organization_id + composite (id, organization_id) keys, RLS enabled, SELECT for Organization Admins of
-- the same organization only, NO insert / update / delete grants -- writes only through the SECURITY DEFINER RPCs of
-- 20261027110000_core_billing_rpcs.sql. Immutability is enforced HERE by triggers (also against direct owner edits),
-- not only in the RPCs or the UI. Amounts: bigint cents, USD only (D6). No card data is ever stored.
-- Additive only: no existing table, function or policy is changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Counters
-- -----------------------------------------------------------------------------
create table public.billing_invoice_counters (
  organization_id uuid primary key references public.organizations (id),
  next_number integer not null default 1,
  constraint billing_invoice_counters_next_number_check check (next_number >= 1)
);
comment on table public.billing_invoice_counters is
  'NP-BILL-P1. Next invoice number per organization. Locked by the issuing transaction (UPDATE ... RETURNING), so issued numbers never repeat and have no gaps. No client access.';
alter table public.billing_invoice_counters enable row level security;
revoke all on table public.billing_invoice_counters from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Invoices
-- -----------------------------------------------------------------------------
create table public.billing_invoices (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_number integer,
  status text not null default 'draft',
  passenger_id uuid not null,
  bill_to_kind text not null,
  bill_to_passenger_id uuid,
  bill_to_request_id uuid,
  bill_to_facility_id uuid,
  bill_to_name text not null,
  bill_to_address text,
  bill_to_email text,
  bill_to_phone text,
  source_quote_id uuid,
  source_quote_number integer,
  source_quote_kind text,
  subtotal_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  total_cents bigint not null default 0,
  currency text not null default 'USD',
  issue_date date,
  due_date date,
  terms_note text,
  version integer not null default 1,
  idempotency_key text not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_by uuid references auth.users (id),
  issued_at timestamptz,
  voided_by uuid references auth.users (id),
  voided_at timestamptz,
  void_reason text,
  constraint billing_invoices_id_organization_id_key unique (id, organization_id),
  constraint billing_invoices_number_key unique (organization_id, invoice_number),
  constraint billing_invoices_idempotency_key unique (organization_id, idempotency_key),
  constraint billing_invoices_passenger_fkey
    foreign key (passenger_id, organization_id) references public.passengers (id, organization_id),
  constraint billing_invoices_bill_to_passenger_fkey
    foreign key (bill_to_passenger_id, organization_id) references public.passengers (id, organization_id),
  constraint billing_invoices_bill_to_request_fkey
    foreign key (bill_to_request_id, organization_id) references public.transportation_requests (id, organization_id),
  constraint billing_invoices_bill_to_facility_fkey
    foreign key (bill_to_facility_id, organization_id) references public.facilities (id, organization_id),
  constraint billing_invoices_source_quote_fkey
    foreign key (source_quote_id, organization_id) references public.plus_quotes (id, organization_id),
  constraint billing_invoices_status_check check (status in ('draft', 'issued', 'void')),
  constraint billing_invoices_bill_to_kind_check check (bill_to_kind in ('passenger', 'requester', 'facility', 'other')),
  constraint billing_invoices_bill_to_shape_check check (
    ((bill_to_kind = 'passenger') = (bill_to_passenger_id is not null))
    and ((bill_to_kind = 'requester') = (bill_to_request_id is not null))
    and ((bill_to_kind = 'facility') = (bill_to_facility_id is not null))
  ),
  constraint billing_invoices_bill_to_text_check check (
    bill_to_name = btrim(bill_to_name) and length(bill_to_name) between 1 and 200
    and (bill_to_address is null or length(bill_to_address) between 1 and 500)
    and (bill_to_email is null or length(bill_to_email) between 3 and 254)
    and (bill_to_phone is null or length(bill_to_phone) between 1 and 40)
  ),
  constraint billing_invoices_quote_shape_check check (
    (source_quote_id is null) = (source_quote_number is null)
    and (source_quote_id is null) = (source_quote_kind is null)
  ),
  constraint billing_invoices_money_check check (
    subtotal_cents between 0 and 100000000000 and discount_cents between 0 and subtotal_cents
    and total_cents = subtotal_cents - discount_cents
  ),
  constraint billing_invoices_currency_check check (currency = 'USD'),
  constraint billing_invoices_terms_check check (terms_note is null or length(terms_note) between 1 and 1000),
  constraint billing_invoices_issue_shape_check check (
    ((status = 'draft') = (invoice_number is null))
    and ((status = 'draft') = (issue_date is null))
    and ((status = 'draft') = (due_date is null))
    and ((status = 'draft') = (issued_at is null))
    and ((status = 'draft') = (issued_by is null))
    and (invoice_number is null or invoice_number >= 1)
    and (due_date is null or due_date >= issue_date)
    and (status = 'draft' or total_cents > 0)
  ),
  constraint billing_invoices_void_shape_check check (
    ((status = 'void') = (voided_at is not null))
    and ((status = 'void') = (voided_by is not null))
    and ((status = 'void') = (void_reason is not null))
    and (void_reason is null or length(btrim(void_reason)) between 3 and 500)
  ),
  constraint billing_invoices_version_check check (version >= 1),
  constraint billing_invoices_idempotency_format_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$')
);
comment on table public.billing_invoices is
  'NP-BILL-P1 (Core). A private-pay invoice for completed trips of ONE passenger, billed to ONE party (passenger / requester / facility / other). bill_to_* text is a snapshot (frozen at issue). Number assigned at issue. Frozen once issued (trigger); the only later change is issued -> void (reason, number kept). Optional Plus quote reference is snapshotted (number + kind) so billing never depends on Plus. Paid / balance are derived from billing_payments, never stored.';
create index billing_invoices_org_status_idx on public.billing_invoices (organization_id, status, created_at desc);
create index billing_invoices_org_passenger_idx on public.billing_invoices (organization_id, passenger_id);

create trigger billing_invoices_set_updated_at
  before update on public.billing_invoices
  for each row execute function public.set_updated_at();
create trigger billing_invoices_prevent_org_change
  before update on public.billing_invoices
  for each row execute function public.prevent_organization_id_change();

create function public._billing_invoices_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'invoice_immutable' using errcode = 'ZW004';   -- issued / void invoices are never deleted
    end if;
    return old;
  end if;
  -- identity: fixed at creation
  if new.id is distinct from old.id or new.passenger_id is distinct from old.passenger_id
     or new.bill_to_kind is distinct from old.bill_to_kind or new.bill_to_passenger_id is distinct from old.bill_to_passenger_id
     or new.bill_to_request_id is distinct from old.bill_to_request_id or new.bill_to_facility_id is distinct from old.bill_to_facility_id
     or new.source_quote_id is distinct from old.source_quote_id or new.source_quote_number is distinct from old.source_quote_number
     or new.source_quote_kind is distinct from old.source_quote_kind or new.currency is distinct from old.currency
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'invoice_immutable' using errcode = 'ZW004';
  end if;
  -- transitions: draft -> issued, issued -> void; nothing else
  if new.status is distinct from old.status
     and not ((old.status = 'draft' and new.status = 'issued') or (old.status = 'issued' and new.status = 'void')) then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  -- frozen once issued: only the void columns (and version / updated_at) may change afterwards
  if old.status <> 'draft' and (
       new.invoice_number is distinct from old.invoice_number
       or new.bill_to_name is distinct from old.bill_to_name or new.bill_to_address is distinct from old.bill_to_address
       or new.bill_to_email is distinct from old.bill_to_email or new.bill_to_phone is distinct from old.bill_to_phone
       or new.subtotal_cents is distinct from old.subtotal_cents or new.discount_cents is distinct from old.discount_cents
       or new.total_cents is distinct from old.total_cents or new.issue_date is distinct from old.issue_date
       or new.due_date is distinct from old.due_date or new.terms_note is distinct from old.terms_note
       or new.issued_by is distinct from old.issued_by or new.issued_at is distinct from old.issued_at) then
    raise exception 'invoice_immutable' using errcode = 'ZW004';
  end if;
  if old.status = 'void' and (
       new.voided_by is distinct from old.voided_by or new.voided_at is distinct from old.voided_at
       or new.void_reason is distinct from old.void_reason) then
    raise exception 'invoice_immutable' using errcode = 'ZW004';
  end if;
  return new;
end;
$$;
comment on function public._billing_invoices_guard() is
  'NP-BILL-P1. INTERNAL trigger (defence in depth, also against direct owner edits): identity columns are fixed; only draft -> issued and issued -> void; an issued / void invoice is frozen except the void columns; only drafts can be deleted (ZW004).';
revoke all on function public._billing_invoices_guard() from public, anon, authenticated, service_role;
create trigger billing_invoices_guard
  before update or delete on public.billing_invoices
  for each row execute function public._billing_invoices_guard();

alter table public.billing_invoices enable row level security;
revoke all on table public.billing_invoices from public, anon, authenticated, service_role;
grant select on table public.billing_invoices to authenticated;
create policy billing_invoices_select_admin on public.billing_invoices
  for select to authenticated
  using (public.has_org_role(organization_id, array['organization_admin']));

-- -----------------------------------------------------------------------------
-- 3. Invoice <-> trip links (duplicate-invoicing guard)
-- -----------------------------------------------------------------------------
create table public.billing_invoice_trips (
  invoice_id uuid not null,
  trip_id uuid not null,
  organization_id uuid not null references public.organizations (id),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  constraint billing_invoice_trips_pkey primary key (invoice_id, trip_id),
  constraint billing_invoice_trips_invoice_fkey
    foreign key (invoice_id, organization_id) references public.billing_invoices (id, organization_id) on delete cascade,
  constraint billing_invoice_trips_trip_fkey
    foreign key (trip_id, organization_id) references public.trips (id, organization_id)
);
comment on table public.billing_invoice_trips is
  'NP-BILL-P1. The completed trips an invoice bills. released_at is set when the invoice is voided; a trip can be on at most ONE invoice with released_at NULL (draft or issued) -- enforced by a partial unique index, so concurrent drafts for the same trip cannot both succeed.';
create unique index billing_invoice_trips_one_active_idx on public.billing_invoice_trips (trip_id) where released_at is null;
create index billing_invoice_trips_org_trip_idx on public.billing_invoice_trips (organization_id, trip_id);

create function public._billing_invoice_trips_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select i.status into v_status from public.billing_invoices i
  where i.id = coalesce(new.invoice_id, old.invoice_id);
  if tg_op = 'INSERT' then
    if v_status is distinct from 'draft' then
      raise exception 'invoice_immutable' using errcode = 'ZW004';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if v_status is not null and v_status <> 'draft' then   -- null: the draft itself is being deleted (cascade)
      raise exception 'invoice_immutable' using errcode = 'ZW004';
    end if;
    return old;
  end if;
  -- UPDATE: only releasing (released_at null -> timestamp) when the invoice is voided
  if new.invoice_id is distinct from old.invoice_id or new.trip_id is distinct from old.trip_id
     or new.organization_id is distinct from old.organization_id or new.created_at is distinct from old.created_at
     or old.released_at is not null or new.released_at is null or v_status <> 'void' then
    raise exception 'invoice_immutable' using errcode = 'ZW004';
  end if;
  return new;
end;
$$;
comment on function public._billing_invoice_trips_guard() is
  'NP-BILL-P1. INTERNAL trigger: links are added / removed only while the invoice is a draft; afterwards the only change is releasing them when the invoice is voided (ZW004).';
revoke all on function public._billing_invoice_trips_guard() from public, anon, authenticated, service_role;
create trigger billing_invoice_trips_guard
  before insert or update or delete on public.billing_invoice_trips
  for each row execute function public._billing_invoice_trips_guard();

alter table public.billing_invoice_trips enable row level security;
revoke all on table public.billing_invoice_trips from public, anon, authenticated, service_role;
grant select on table public.billing_invoice_trips to authenticated;
create policy billing_invoice_trips_select_admin on public.billing_invoice_trips
  for select to authenticated
  using (public.has_org_role(organization_id, array['organization_admin']));

-- -----------------------------------------------------------------------------
-- 4. Invoice lines
-- -----------------------------------------------------------------------------
create table public.billing_invoice_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  position integer not null,
  trip_id uuid,
  source text not null default 'manual',
  description text not null,
  quantity numeric(10, 2) not null default 1,
  unit_cents bigint not null,
  amount_cents bigint not null,
  constraint billing_invoice_lines_position_key unique (invoice_id, position),
  constraint billing_invoice_lines_invoice_fkey
    foreign key (invoice_id, organization_id) references public.billing_invoices (id, organization_id) on delete cascade,
  -- a trip line must reference a trip ON THIS invoice
  constraint billing_invoice_lines_invoice_trip_fkey
    foreign key (invoice_id, trip_id) references public.billing_invoice_trips (invoice_id, trip_id) on delete cascade,
  constraint billing_invoice_lines_source_check check (source in ('trip', 'quote', 'manual')),
  constraint billing_invoice_lines_position_check check (position between 1 and 200),
  constraint billing_invoice_lines_description_check check (description = btrim(description) and length(description) between 1 and 300),
  constraint billing_invoice_lines_money_check check (
    quantity > 0 and quantity <= 99999.99 and unit_cents between 0 and 10000000000
    and amount_cents = round(quantity * unit_cents)::bigint
  )
);
comment on table public.billing_invoice_lines is
  'NP-BILL-P1. Itemised charges (integer cents; amount = round(quantity * unit)). source: trip (the default line per trip), quote (imported from a Plus quote, visible and editable before issue), manual. Editable only while the invoice is a draft (trigger).';
create index billing_invoice_lines_invoice_idx on public.billing_invoice_lines (invoice_id, position);

create function public._billing_invoice_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select i.status into v_status from public.billing_invoices i
  where i.id = coalesce(new.invoice_id, old.invoice_id);
  if tg_op = 'DELETE' then
    if v_status is not null and v_status <> 'draft' then   -- null: the draft itself is being deleted (cascade)
      raise exception 'invoice_immutable' using errcode = 'ZW004';
    end if;
    return old;
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'invoice_immutable' using errcode = 'ZW004';
  end if;
  if tg_op = 'UPDATE' and (new.invoice_id is distinct from old.invoice_id or new.organization_id is distinct from old.organization_id) then
    raise exception 'invoice_immutable' using errcode = 'ZW004';
  end if;
  return new;
end;
$$;
comment on function public._billing_invoice_lines_guard() is
  'NP-BILL-P1. INTERNAL trigger: lines change only while their invoice is a draft (ZW004 otherwise).';
revoke all on function public._billing_invoice_lines_guard() from public, anon, authenticated, service_role;
create trigger billing_invoice_lines_guard
  before insert or update or delete on public.billing_invoice_lines
  for each row execute function public._billing_invoice_lines_guard();

alter table public.billing_invoice_lines enable row level security;
revoke all on table public.billing_invoice_lines from public, anon, authenticated, service_role;
grant select on table public.billing_invoice_lines to authenticated;
create policy billing_invoice_lines_select_admin on public.billing_invoice_lines
  for select to authenticated
  using (public.has_org_role(organization_id, array['organization_admin']));

-- -----------------------------------------------------------------------------
-- 5. Payments (append-only ledger)
-- -----------------------------------------------------------------------------
create table public.billing_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  entry_kind text not null,
  amount_cents bigint not null,
  received_on date not null,
  method text,
  reference text,
  note text,
  reverses_payment_id uuid,
  reason text,
  idempotency_key text not null,
  recorded_by uuid not null references auth.users (id),
  recorded_at timestamptz not null default now(),
  constraint billing_payments_id_organization_id_key unique (id, organization_id),
  constraint billing_payments_id_invoice_key unique (id, invoice_id),
  constraint billing_payments_idempotency_key unique (organization_id, idempotency_key),
  constraint billing_payments_one_reversal_key unique (reverses_payment_id),
  constraint billing_payments_invoice_fkey
    foreign key (invoice_id, organization_id) references public.billing_invoices (id, organization_id),
  -- a reversal corrects a payment of the SAME invoice
  constraint billing_payments_reverses_fkey
    foreign key (reverses_payment_id, invoice_id) references public.billing_payments (id, invoice_id),
  constraint billing_payments_kind_check check (entry_kind in ('payment', 'reversal')),
  constraint billing_payments_amount_check check (amount_cents between 1 and 100000000000),
  constraint billing_payments_method_check check (method is null or method in ('cash', 'check', 'card_external', 'bank_transfer', 'other')),
  constraint billing_payments_shape_check check (
    (entry_kind = 'payment' and method is not null and reverses_payment_id is null and reason is null)
    or (entry_kind = 'reversal' and method is null and reverses_payment_id is not null and reason is not null)
  ),
  constraint billing_payments_text_check check (
    (reference is null or length(reference) between 1 and 100)
    and (note is null or length(note) between 1 and 500)
    and (reason is null or length(btrim(reason)) between 3 and 500)
  ),
  constraint billing_payments_idempotency_format_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$')
);
comment on table public.billing_payments is
  'NP-BILL-P1. Append-only manual payment ledger (no UPDATE / DELETE, ever -- trigger). entry_kind payment (method, date, reference) or reversal (corrects ONE payment of the same invoice, reason required, once). A reversal corrects the ledger; it does not execute or prove a refund. Paid = sum(payment) - sum(reversal). No card data.';
create index billing_payments_invoice_idx on public.billing_payments (invoice_id, recorded_at);
create index billing_payments_org_received_idx on public.billing_payments (organization_id, received_on);

create function public._billing_payments_guard()
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
revoke all on function public._billing_payments_guard() from public, anon, authenticated, service_role;
create trigger billing_payments_guard
  before insert or update or delete on public.billing_payments
  for each row execute function public._billing_payments_guard();
create trigger billing_payments_no_truncate
  before truncate on public.billing_payments
  for each statement execute function public._billing_payments_guard();

alter table public.billing_payments enable row level security;
revoke all on table public.billing_payments from public, anon, authenticated, service_role;
grant select on table public.billing_payments to authenticated;
create policy billing_payments_select_admin on public.billing_payments
  for select to authenticated
  using (public.has_org_role(organization_id, array['organization_admin']));
