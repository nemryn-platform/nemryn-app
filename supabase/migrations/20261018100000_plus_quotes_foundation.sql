-- NP-P2-S5-S1 -- Nemryn Plus Estimates & Quotes: database foundation, authorization and security contract (stage Q1).
--
-- Owner decisions (2026-10-18, recorded as ZD-212 .. ZD-220): manually priced, itemized staff estimates / quotes
-- (no rate calculation, payments or invoicing); every quote belongs to an existing opportunity; fixed price columns
-- (incl. extra stops + escort); kinds estimate | quote; lifecycle draft -> sent -> accepted | declined, superseded,
-- withdrawn, with expiry DERIVED from valid_until (no scheduler); Mark sent / Record accepted advance an open
-- opportunity forward only; USD only, integer cents; Admins and WRITE-grant Dispatchers act (no second approver);
-- NO addresses, routes, appointment or medical details in Plus.
--
-- STILL OPEN and deliberately NOT encoded here:
--   OD-Q10 display format / validity default / print content  -> quote_number is a plain per-organization integer;
--                                                                valid_until is required, no default.
--   OD-Q12 one live draft / one current sent per opportunity -> NOT enforced. Supersession only follows an explicit
--                                                                revision chain (at most one live successor per quote).
--   OD-Q13 opportunity.estimated_value_cents                 -> never touched.
--   OD-Q15 quote_id on plus_activities                       -> NOT added. The quote_sent / quote_status_changed
--                                                                activity types are allowed but NOT written yet;
--                                                                every quote mutation is recorded in audit_events.
--   OD-Q11 follow-up tasks, OD-Q16 do-not-contact handling     -> nothing automatic; nothing is ever sent.
--
-- BOUNDARIES: no Core table or function is touched; no Core Request, Trip, Passenger, assignment, payment, invoice or
-- message is ever created. Only the opportunity STAGE (forward, open opportunities only) and plus_activities
-- stage_changed rows are written outside the quote tables, exactly like plus_change_opportunity_stage.
-- ACCESS: class B (SELECT via RLS plus_can_read; no client write privilege; every write through a SECURITY DEFINER
-- RPC that calls _require_plus_write first). plus_quote_counters is class A (no client privilege at all).
-- LOCK ORDER (every quote writer): advisory(organization, idempotency key) [create / revise only]
--   -> plus_opportunities FOR UPDATE -> plus_contacts FOR NO KEY UPDATE [create / revise only, via
--   _plus_require_active_contact] -> plus_quotes FOR UPDATE -> plus_quote_counters (row lock via UPDATE).
--   Same opportunity-before-contact order as every existing opportunity writer; quote rows and counters are locked
--   by quote RPCs only, so no cycle exists.

-- =============================================================================
-- 1. plus_quote_counters (class A: per-organization number allocation; no client privilege)
-- =============================================================================
create table public.plus_quote_counters (
  organization_id uuid primary key references public.organizations (id),
  next_number integer not null default 1,
  constraint plus_quote_counters_next_number_check check (next_number >= 1)
);
comment on table public.plus_quote_counters is
  'NP-P2-S5-S1. SYSTEM-OWNED per-organization quote number allocator. RLS on, no policy, no client privilege: written only inside plus_create_quote / plus_revise_quote (row-locked UPDATE). Numbers are unique per-organization display references, NOT an accounting sequence. The counter is transactional (a rolled-back create also rolls back its number), and no RPC deletes a quote.';
alter table public.plus_quote_counters enable row level security;
revoke all on table public.plus_quote_counters from public, anon, authenticated, service_role;

-- =============================================================================
-- 2. plus_quotes (class B)
-- =============================================================================
create table public.plus_quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  opportunity_id uuid not null,
  quote_number integer not null,
  kind text not null,
  -- snapshot (OD-Q9: NO address, route, appointment or medical field exists on this table)
  service_type text,
  round_trip boolean not null default false,
  distance_miles numeric(7, 1),
  -- manual price components: non-negative integer cents (OD-Q7), each at most $100,000.00
  base_cents bigint not null default 0,
  mileage_cents bigint not null default 0,
  wait_cents bigint not null default 0,
  extra_stops_cents bigint not null default 0,
  mobility_assistance_cents bigint not null default 0,
  escort_cents bigint not null default 0,
  return_leg_cents bigint not null default 0,
  other_cents bigint not null default 0,
  other_label text,
  discount_cents bigint not null default 0,
  total_cents bigint not null,
  currency text not null default 'USD',
  -- commercial terms
  terms_note text,
  valid_until date not null,
  -- lifecycle
  status text not null default 'draft',
  supersedes_quote_id uuid,
  idempotency_key text not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references auth.users (id),
  responded_at timestamptz,
  responded_by uuid references auth.users (id),
  withdrawn_reason text,
  constraint plus_quotes_id_organization_id_key unique (id, organization_id),
  constraint plus_quotes_id_org_opportunity_key unique (id, organization_id, opportunity_id),
  constraint plus_quotes_number_key unique (organization_id, quote_number),
  constraint plus_quotes_idempotency_key unique (organization_id, idempotency_key),
  constraint plus_quotes_opportunity_fkey
    foreign key (opportunity_id, organization_id) references public.plus_opportunities (id, organization_id),
  -- a revision is always of a quote of the SAME organization AND the SAME opportunity
  constraint plus_quotes_supersedes_fkey
    foreign key (supersedes_quote_id, organization_id, opportunity_id) references public.plus_quotes (id, organization_id, opportunity_id),
  constraint plus_quotes_supersedes_self_check check (supersedes_quote_id is null or supersedes_quote_id <> id),
  constraint plus_quotes_number_check check (quote_number >= 1),
  constraint plus_quotes_kind_check check (kind in ('estimate', 'quote')),
  constraint plus_quotes_service_type_check check (
    service_type is null or service_type in ('medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
                                             'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other')
  ),
  constraint plus_quotes_distance_check check (distance_miles is null or distance_miles >= 0),
  constraint plus_quotes_lines_check check (
    base_cents between 0 and 10000000 and mileage_cents between 0 and 10000000 and wait_cents between 0 and 10000000
    and extra_stops_cents between 0 and 10000000 and mobility_assistance_cents between 0 and 10000000
    and escort_cents between 0 and 10000000 and return_leg_cents between 0 and 10000000
    and other_cents between 0 and 10000000 and discount_cents between 0 and 10000000
  ),
  -- the total is ALWAYS the sum of the charges minus the discount, never negative (the RPCs compute it; this guards it)
  constraint plus_quotes_total_check check (
    total_cents = base_cents + mileage_cents + wait_cents + extra_stops_cents + mobility_assistance_cents + escort_cents
                  + return_leg_cents + other_cents - discount_cents
    and total_cents >= 0
  ),
  constraint plus_quotes_other_label_check check (
    (other_cents = 0 and other_label is null)
    or (other_cents > 0 and other_label is not null and other_label = btrim(other_label) and length(other_label) between 1 and 60)
  ),
  constraint plus_quotes_currency_check check (currency = 'USD'),
  constraint plus_quotes_terms_note_check check (terms_note is null or (terms_note = btrim(terms_note) and length(terms_note) between 1 and 500)),
  constraint plus_quotes_status_check check (status in ('draft', 'sent', 'accepted', 'declined', 'superseded', 'withdrawn')),
  constraint plus_quotes_idempotency_key_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  -- lifecycle metadata is consistent with the status
  constraint plus_quotes_sent_check check (
    (status = 'draft' and sent_at is null and sent_by is null)
    or (status in ('sent', 'accepted', 'declined', 'superseded') and sent_at is not null and sent_by is not null)
    or (status = 'withdrawn' and (sent_at is null) = (sent_by is null))
  ),
  constraint plus_quotes_responded_check check (
    (status in ('accepted', 'declined')) = (responded_at is not null and responded_by is not null)
    and (responded_at is null) = (responded_by is null)
  ),
  constraint plus_quotes_withdrawn_reason_check check (
    (status = 'withdrawn' or withdrawn_reason is null)
    and (withdrawn_reason is null or (withdrawn_reason = btrim(withdrawn_reason) and length(withdrawn_reason) between 1 and 200))
    -- withdrawing a SENT quote always carries a reason
    and (status <> 'withdrawn' or sent_at is null or withdrawn_reason is not null)
  )
);

comment on table public.plus_quotes is
  'NP-P2-S5-S1. TENANT-OWNED Nemryn Plus staff estimate / quote (stage Q1, PD-08 / ZD-212) for one opportunity of the same organization (composite FK). Manually entered price lines in USD integer cents; total_cents is computed by the RPCs and guarded by a CHECK. Immutable commercial snapshot once it leaves draft (trigger). "Sent" / "accepted" / "declined" are STAFF STATEMENTS -- never proof of delivery or customer acceptance; nothing is ever sent by Nemryn. Expiry is derived (sent and valid_until before the organization''s local today). Holds NO address, route, appointment or medical detail (ZD-220). SELECT via RLS plus_can_read(organization_id); writes only through plus_create_quote / plus_update_quote_draft / plus_mark_quote_sent / plus_record_quote_response / plus_revise_quote / plus_withdraw_quote. No Core Request, payment or invoice is ever derived from it.';
comment on column public.plus_quotes.quote_number is
  'Per-organization display reference (unique per organization). Not an accounting number; the display format is open (OD-Q10).';
comment on column public.plus_quotes.total_cents is
  'Server-computed: sum of the charge lines minus discount_cents (CHECK). Never accepted from a client.';
comment on column public.plus_quotes.distance_miles is
  'Staff-entered estimate only (one decimal). Nemryn computes no distance and stores no address (ZD-220).';

create index plus_quotes_org_opportunity_idx on public.plus_quotes (organization_id, opportunity_id, created_at desc);
-- a quote can be revised at most once at a time: at most ONE live (not withdrawn) successor per quote
create unique index plus_quotes_one_live_successor_idx on public.plus_quotes (supersedes_quote_id)
  where supersedes_quote_id is not null and status <> 'withdrawn';

create trigger plus_quotes_set_updated_at
  before update on public.plus_quotes
  for each row execute function public.set_updated_at();
create trigger plus_quotes_prevent_org_change
  before update on public.plus_quotes
  for each row execute function public.prevent_organization_id_change();

-- Defence in depth (also against direct owner edits): the commercial snapshot is frozen once a quote leaves draft,
-- identity never changes, and only the approved status transitions are possible.
create function public._plus_quotes_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.opportunity_id is distinct from old.opportunity_id or new.quote_number is distinct from old.quote_number
     or new.idempotency_key is distinct from old.idempotency_key or new.supersedes_quote_id is distinct from old.supersedes_quote_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'quote_immutable' using errcode = 'ZW004';
  end if;
  if old.status <> 'draft' and (
       new.kind is distinct from old.kind or new.service_type is distinct from old.service_type
       or new.round_trip is distinct from old.round_trip or new.distance_miles is distinct from old.distance_miles
       or new.base_cents is distinct from old.base_cents or new.mileage_cents is distinct from old.mileage_cents
       or new.wait_cents is distinct from old.wait_cents or new.extra_stops_cents is distinct from old.extra_stops_cents
       or new.mobility_assistance_cents is distinct from old.mobility_assistance_cents
       or new.escort_cents is distinct from old.escort_cents or new.return_leg_cents is distinct from old.return_leg_cents
       or new.other_cents is distinct from old.other_cents or new.other_label is distinct from old.other_label
       or new.discount_cents is distinct from old.discount_cents or new.total_cents is distinct from old.total_cents
       or new.currency is distinct from old.currency or new.terms_note is distinct from old.terms_note
       or new.valid_until is distinct from old.valid_until
       or new.sent_at is distinct from old.sent_at or new.sent_by is distinct from old.sent_by) then
    raise exception 'quote_immutable' using errcode = 'ZW004';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('sent', 'withdrawn'))
       or (old.status = 'sent' and new.status in ('accepted', 'declined', 'superseded', 'withdrawn'))) then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if old.status in ('accepted', 'declined', 'superseded', 'withdrawn') and (
       new.responded_at is distinct from old.responded_at or new.responded_by is distinct from old.responded_by
       or new.withdrawn_reason is distinct from old.withdrawn_reason) then
    raise exception 'quote_immutable' using errcode = 'ZW004';
  end if;
  return new;
end;
$$;
comment on function public._plus_quotes_guard() is
  'NP-P2-S5-S1. INTERNAL trigger: freezes the commercial snapshot once a quote leaves draft, keeps identity columns immutable and allows only draft -> sent | withdrawn and sent -> accepted | declined | superseded | withdrawn (ZW004).';
revoke all on function public._plus_quotes_guard() from public, anon, authenticated, service_role;
create trigger plus_quotes_guard
  before update on public.plus_quotes
  for each row execute function public._plus_quotes_guard();

alter table public.plus_quotes enable row level security;
revoke all on table public.plus_quotes from public, anon, authenticated, service_role;
grant select on table public.plus_quotes to authenticated;
create policy plus_quotes_select_plus on public.plus_quotes
  for select to authenticated
  using (public.plus_can_read(organization_id));

-- =============================================================================
-- 3. plus_activities: quote activity types ALLOWED (not written in S1 -- OD-Q15 open)
-- =============================================================================
alter table public.plus_activities drop constraint plus_activities_activity_type_check;
alter table public.plus_activities
  add constraint plus_activities_activity_type_check check (
    activity_type in ('note', 'call_logged', 'email_logged', 'meeting_logged', 'owner_changed', 'record_archived', 'stage_changed',
                      'request_linked', 'attribution_changed', 'quote_sent', 'quote_status_changed')
  );
-- quote history always belongs to an opportunity
alter table public.plus_activities
  add constraint plus_activities_quote_subject_check
  check (activity_type not in ('quote_sent', 'quote_status_changed') or opportunity_id is not null);

-- =============================================================================
-- 4. Internal helpers (no client EXECUTE)
-- =============================================================================
create type public.plus_quote_write_result as (
  quote_id uuid,
  quote_number integer,
  status text,
  opportunity_id uuid,
  opportunity_stage text,
  total_cents bigint,
  updated_at timestamptz,
  changed boolean
);
comment on type public.plus_quote_write_result is
  'NP-P2-S5-S1. Result of every quote write RPC. changed=false = an idempotent repeat that wrote nothing.';

-- The organization's own local date (organizations.timezone is the operational authority; no new policy).
create function public._plus_org_local_today(p_organization_id uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (now() at time zone o.timezone)::date from public.organizations o where o.id = p_organization_id;
$$;
comment on function public._plus_org_local_today(uuid) is
  'NP-P2-S5-S1. INTERNAL. Today in the organization''s own IANA timezone (organizations.timezone). Used for derived quote expiry.';
revoke all on function public._plus_org_local_today(uuid) from public, anon, authenticated, service_role;

-- Validates every staff-entered snapshot field and returns the authoritative total (ZW006 on anything invalid).
-- NULL money / distance inputs mean "none" (0 / NULL). Money arrives as integer cents: fractions are impossible.
create function public._plus_quote_validate(
  p_kind text, p_service_type text, p_distance_miles numeric,
  p_base_cents bigint, p_mileage_cents bigint, p_wait_cents bigint, p_extra_stops_cents bigint,
  p_mobility_assistance_cents bigint, p_escort_cents bigint, p_return_leg_cents bigint,
  p_other_cents bigint, p_other_label text, p_discount_cents bigint, p_terms_note text, p_valid_until date,
  p_local_today date
)
returns bigint
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_lines bigint[] := array[coalesce(p_base_cents, 0), coalesce(p_mileage_cents, 0), coalesce(p_wait_cents, 0),
                            coalesce(p_extra_stops_cents, 0), coalesce(p_mobility_assistance_cents, 0), coalesce(p_escort_cents, 0),
                            coalesce(p_return_leg_cents, 0), coalesce(p_other_cents, 0)];
  v_line bigint;
  v_subtotal bigint := 0;
  v_label text := nullif(btrim(p_other_label), '');
  v_terms text := nullif(btrim(p_terms_note), '');
begin
  if p_kind is null or p_kind not in ('estimate', 'quote') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_service_type is not null and p_service_type not in ('medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge',
                                                           'recurring_care', 'senior_medical', 'wheelchair_transportation', 'other') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  -- one decimal at most, never rounded silently; numeric(7,1) range
  if p_distance_miles is not null and (p_distance_miles < 0 or p_distance_miles > 99999.9 or p_distance_miles <> round(p_distance_miles, 1)) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  foreach v_line in array v_lines loop
    if v_line < 0 or v_line > 10000000 then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    v_subtotal := v_subtotal + v_line;
  end loop;
  if coalesce(p_discount_cents, 0) < 0 or coalesce(p_discount_cents, 0) > 10000000 or coalesce(p_discount_cents, 0) > v_subtotal then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if (coalesce(p_other_cents, 0) > 0) <> (v_label is not null) or (v_label is not null and length(v_label) > 60) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_terms is not null and length(v_terms) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  -- an explicit validity date is required; it cannot already be in the past for the organization
  if p_valid_until is null or p_valid_until < p_local_today then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  return v_subtotal - coalesce(p_discount_cents, 0);
end;
$$;
comment on function public._plus_quote_validate(text, text, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, bigint, text, date, date) is
  'NP-P2-S5-S1. INTERNAL. Validates a quote snapshot (kind, Plus service type, distance with at most one decimal, each line 0..10,000,000 cents, discount <= subtotal, other label iff other charge, terms <= 500, valid_until not before the organization''s today) and returns the authoritative total in cents. ZW006 on anything invalid.';
revoke all on function public._plus_quote_validate(text, text, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, bigint, text, date, date) from public, anon, authenticated, service_role;

-- Locks an OPEN opportunity of the organization (FOR UPDATE). Unknown / foreign -> ZW002; converted / lost -> ZW004.
create function public._plus_quote_lock_open_opportunity(p_organization_id uuid, p_opportunity_id uuid)
returns public.plus_opportunities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opp public.plus_opportunities%rowtype;
begin
  select * into v_opp from public.plus_opportunities o
  where o.id = p_opportunity_id and o.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_opp.stage in ('converted', 'lost') then
    raise exception 'opportunity_closed' using errcode = 'ZW004';
  end if;
  return v_opp;
end;
$$;
comment on function public._plus_quote_lock_open_opportunity(uuid, uuid) is
  'NP-P2-S5-S1. INTERNAL. Locks (FOR UPDATE) and returns an OPEN opportunity of the organization: unknown / foreign ZW002; converted / lost ZW004 opportunity_closed.';
revoke all on function public._plus_quote_lock_open_opportunity(uuid, uuid) from public, anon, authenticated, service_role;

-- Locks the quote of an organization (after its opportunity has been locked by the caller).
create function public._plus_quote_lock(p_organization_id uuid, p_quote_id uuid)
returns public.plus_quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_q public.plus_quotes%rowtype;
begin
  select * into v_q from public.plus_quotes q where q.id = p_quote_id and q.organization_id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return v_q;
end;
$$;
comment on function public._plus_quote_lock(uuid, uuid) is
  'NP-P2-S5-S1. INTERNAL. Locks (FOR UPDATE) and returns a quote of the organization; unknown / foreign ZW002.';
revoke all on function public._plus_quote_lock(uuid, uuid) from public, anon, authenticated, service_role;

-- The opportunity a quote belongs to (no lock; the caller then locks opportunity -> quote in that order).
create function public._plus_quote_opportunity(p_organization_id uuid, p_quote_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_opp uuid;
begin
  select q.opportunity_id into v_opp from public.plus_quotes q where q.id = p_quote_id and q.organization_id = p_organization_id;
  if v_opp is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return v_opp;
end;
$$;
comment on function public._plus_quote_opportunity(uuid, uuid) is
  'NP-P2-S5-S1. INTERNAL. The opportunity of a quote of the organization (unknown / foreign ZW002), so writers can lock opportunity before quote.';
revoke all on function public._plus_quote_opportunity(uuid, uuid) from public, anon, authenticated, service_role;

-- Allocates the next per-organization number (row-locked UPDATE; first use creates the counter row).
create function public._plus_next_quote_number(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  insert into public.plus_quote_counters (organization_id) values (p_organization_id) on conflict (organization_id) do nothing;
  update public.plus_quote_counters set next_number = next_number + 1
  where organization_id = p_organization_id
  returning next_number - 1 into v_n;
  return v_n;
end;
$$;
comment on function public._plus_next_quote_number(uuid) is
  'NP-P2-S5-S1. INTERNAL. Next per-organization quote number; the counter row is locked by the UPDATE until the creating transaction ends (concurrent creates serialize; numbers never repeat).';
revoke all on function public._plus_next_quote_number(uuid) from public, anon, authenticated, service_role;

-- Moves an OPEN opportunity forward to p_target (quote_sent / quote_accepted) when it is in an earlier open stage,
-- writing the same stage_changed history row as plus_change_opportunity_stage. Never regresses; never touches
-- converted / lost (the caller already refused those). Returns the resulting stage.
create function public._plus_quote_advance_stage(p_opp public.plus_opportunities, p_target text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order constant text[] := array['new_inquiry', 'contacted', 'qualified', 'quote_sent', 'quote_accepted'];
begin
  if p_target not in ('quote_sent', 'quote_accepted') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if array_position(v_order, p_opp.stage) is null or array_position(v_order, p_opp.stage) >= array_position(v_order, p_target) then
    return p_opp.stage;
  end if;
  update public.plus_opportunities set stage = p_target where id = p_opp.id and organization_id = p_opp.organization_id;
  insert into public.plus_activities (organization_id, opportunity_id, activity_type, from_stage, to_stage, body, actor_user_id)
  values (p_opp.organization_id, p_opp.id, 'stage_changed', p_opp.stage, p_target, null, auth.uid());
  return p_target;
end;
$$;
comment on function public._plus_quote_advance_stage(public.plus_opportunities, text) is
  'NP-P2-S5-S1. INTERNAL. Forward-only stage move of an open opportunity to quote_sent / quote_accepted (ZD-217), with the standard stage_changed history row. Never regresses a later stage.';
revoke all on function public._plus_quote_advance_stage(public.plus_opportunities, text) from public, anon, authenticated, service_role;

-- Writes one audit row (ids, number, kind, statuses and stage only -- never prices or staff text other than a withdrawal reason).
create function public._plus_quote_audit(p_quote public.plus_quotes, p_action text, p_extra jsonb, p_reason text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (p_quote.organization_id, 'plus_quote', p_quote.id, p_action, auth.uid(), null,
          jsonb_build_object('quote_id', p_quote.id, 'quote_number', p_quote.quote_number, 'kind', p_quote.kind,
                             'status', p_quote.status, 'opportunity_id', p_quote.opportunity_id) || coalesce(p_extra, '{}'::jsonb),
          p_reason);
$$;
comment on function public._plus_quote_audit(public.plus_quotes, text, jsonb, text) is
  'NP-P2-S5-S1. INTERNAL. One audit_events row per quote mutation (entity plus_quote): ids, number, kind, status, opportunity and stage effects; no prices.';
revoke all on function public._plus_quote_audit(public.plus_quotes, text, jsonb, text) from public, anon, authenticated, service_role;

-- =============================================================================
-- 5. Write RPCs (Plus WRITE: Organization Admin or WRITE-grant Dispatcher; authenticated EXECUTE only)
-- =============================================================================
create function public.plus_create_quote(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_idempotency_key text,
  p_kind text,
  p_service_type text,
  p_round_trip boolean,
  p_distance_miles numeric,
  p_base_cents bigint,
  p_mileage_cents bigint,
  p_wait_cents bigint,
  p_extra_stops_cents bigint,
  p_mobility_assistance_cents bigint,
  p_escort_cents bigint,
  p_return_leg_cents bigint,
  p_other_cents bigint,
  p_other_label text,
  p_discount_cents bigint,
  p_terms_note text,
  p_valid_until date
)
returns public.plus_quote_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_prior public.plus_quotes%rowtype;
  v_opp public.plus_opportunities%rowtype;
  v_total bigint;
  v_q public.plus_quotes%rowtype;
  v_result public.plus_quote_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  v_key := public._plus_require_idempotency_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('plus-quote:' || p_organization_id::text || ':' || v_key)::bigint);

  -- replay: the same key returns the original creation (the key is the identity of the intent; a different payload
  -- does not create or change anything). A key already used for another opportunity or for a revision is refused.
  select * into v_prior from public.plus_quotes q where q.organization_id = p_organization_id and q.idempotency_key = v_key;
  if found then
    if v_prior.opportunity_id = p_opportunity_id and v_prior.supersedes_quote_id is null then
      select q.id, q.quote_number, q.status, q.opportunity_id, o.stage, q.total_cents, q.updated_at, false
        into v_result from public.plus_quotes q join public.plus_opportunities o on o.id = q.opportunity_id and o.organization_id = q.organization_id
      where q.id = v_prior.id;
      return v_result;
    end if;
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_opp := public._plus_quote_lock_open_opportunity(p_organization_id, p_opportunity_id);
  perform public._plus_require_active_contact(p_organization_id, v_opp.primary_contact_id);
  v_total := public._plus_quote_validate(p_kind, p_service_type, p_distance_miles, p_base_cents, p_mileage_cents, p_wait_cents,
    p_extra_stops_cents, p_mobility_assistance_cents, p_escort_cents, p_return_leg_cents, p_other_cents, p_other_label,
    p_discount_cents, p_terms_note, p_valid_until, public._plus_org_local_today(p_organization_id));

  insert into public.plus_quotes (organization_id, opportunity_id, quote_number, kind, service_type, round_trip, distance_miles,
    base_cents, mileage_cents, wait_cents, extra_stops_cents, mobility_assistance_cents, escort_cents, return_leg_cents,
    other_cents, other_label, discount_cents, total_cents, terms_note, valid_until, status, idempotency_key, created_by)
  values (p_organization_id, v_opp.id, public._plus_next_quote_number(p_organization_id), p_kind, p_service_type,
    coalesce(p_round_trip, false), p_distance_miles,
    coalesce(p_base_cents, 0), coalesce(p_mileage_cents, 0), coalesce(p_wait_cents, 0), coalesce(p_extra_stops_cents, 0),
    coalesce(p_mobility_assistance_cents, 0), coalesce(p_escort_cents, 0), coalesce(p_return_leg_cents, 0),
    coalesce(p_other_cents, 0), nullif(btrim(p_other_label), ''), coalesce(p_discount_cents, 0), v_total,
    nullif(btrim(p_terms_note), ''), p_valid_until, 'draft', v_key, auth.uid())
  returning * into v_q;
  perform public._plus_quote_audit(v_q, 'plus_quote_created', null, null);

  v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_opp.stage, v_q.total_cents, v_q.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_create_quote(uuid, uuid, text, text, text, boolean, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, bigint, text, date) is
  'NP-P2-S5-S1. Plus WRITE. Creates ONE draft estimate / quote for an OPEN opportunity (active primary contact) of p_organization_id with a per-organization number; prices are staff-entered integer cents and the total is computed here (never accepted from the client). Idempotent per (organization, key): the same key for the same opportunity returns the original (changed=false, nothing written); a key used elsewhere -> ZW006. Never changes the opportunity, never writes Core, sends nothing. Errors: ZW001 no write access; ZW002 unknown / foreign opportunity; ZW004 opportunity_closed; ZW006 invalid snapshot or key (or archived contact).';
revoke all on function public.plus_create_quote(uuid, uuid, text, text, text, boolean, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, bigint, text, date) from public, anon, service_role;
grant execute on function public.plus_create_quote(uuid, uuid, text, text, text, boolean, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, bigint, text, date) to authenticated;

create function public.plus_update_quote_draft(
  p_organization_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz,
  p_kind text,
  p_service_type text,
  p_round_trip boolean,
  p_distance_miles numeric,
  p_base_cents bigint,
  p_mileage_cents bigint,
  p_wait_cents bigint,
  p_extra_stops_cents bigint,
  p_mobility_assistance_cents bigint,
  p_escort_cents bigint,
  p_return_leg_cents bigint,
  p_other_cents bigint,
  p_other_label text,
  p_discount_cents bigint,
  p_terms_note text,
  p_valid_until date
)
returns public.plus_quote_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opp public.plus_opportunities%rowtype;
  v_old public.plus_quotes%rowtype;
  v_new public.plus_quotes%rowtype;
  v_total bigint;
  v_result public.plus_quote_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  v_opp := public._plus_quote_lock_open_opportunity(p_organization_id, public._plus_quote_opportunity(p_organization_id, p_quote_id));
  v_old := public._plus_quote_lock(p_organization_id, p_quote_id);
  if v_old.status <> 'draft' then
    raise exception 'quote_not_draft' using errcode = 'ZW004';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  v_total := public._plus_quote_validate(p_kind, p_service_type, p_distance_miles, p_base_cents, p_mileage_cents, p_wait_cents,
    p_extra_stops_cents, p_mobility_assistance_cents, p_escort_cents, p_return_leg_cents, p_other_cents, p_other_label,
    p_discount_cents, p_terms_note, p_valid_until, public._plus_org_local_today(p_organization_id));

  -- nothing actually changed (e.g. a repeated save): no write, no history row, version unchanged
  if (p_kind, p_service_type, coalesce(p_round_trip, false), p_distance_miles, coalesce(p_base_cents, 0), coalesce(p_mileage_cents, 0),
      coalesce(p_wait_cents, 0), coalesce(p_extra_stops_cents, 0), coalesce(p_mobility_assistance_cents, 0), coalesce(p_escort_cents, 0),
      coalesce(p_return_leg_cents, 0), coalesce(p_other_cents, 0), nullif(btrim(p_other_label), ''), coalesce(p_discount_cents, 0),
      nullif(btrim(p_terms_note), ''), p_valid_until)
     is not distinct from
     (v_old.kind, v_old.service_type, v_old.round_trip, v_old.distance_miles, v_old.base_cents, v_old.mileage_cents, v_old.wait_cents,
      v_old.extra_stops_cents, v_old.mobility_assistance_cents, v_old.escort_cents, v_old.return_leg_cents, v_old.other_cents,
      v_old.other_label, v_old.discount_cents, v_old.terms_note, v_old.valid_until) then
    v_result := (v_old.id, v_old.quote_number, v_old.status, v_old.opportunity_id, v_opp.stage, v_old.total_cents, v_old.updated_at, false);
    return v_result;
  end if;

  update public.plus_quotes set
    kind = p_kind, service_type = p_service_type, round_trip = coalesce(p_round_trip, false), distance_miles = p_distance_miles,
    base_cents = coalesce(p_base_cents, 0), mileage_cents = coalesce(p_mileage_cents, 0), wait_cents = coalesce(p_wait_cents, 0),
    extra_stops_cents = coalesce(p_extra_stops_cents, 0), mobility_assistance_cents = coalesce(p_mobility_assistance_cents, 0),
    escort_cents = coalesce(p_escort_cents, 0), return_leg_cents = coalesce(p_return_leg_cents, 0),
    other_cents = coalesce(p_other_cents, 0), other_label = nullif(btrim(p_other_label), ''),
    discount_cents = coalesce(p_discount_cents, 0), total_cents = v_total, terms_note = nullif(btrim(p_terms_note), ''),
    valid_until = p_valid_until
  where id = v_old.id
  returning * into v_new;
  perform public._plus_quote_audit(v_new, 'plus_quote_draft_updated', null, null);
  v_result := (v_new.id, v_new.quote_number, v_new.status, v_new.opportunity_id, v_opp.stage, v_new.total_cents, v_new.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_update_quote_draft(uuid, uuid, timestamptz, text, text, boolean, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, bigint, text, date) is
  'NP-P2-S5-S1. Plus WRITE. Replaces the snapshot of a DRAFT quote (optimistic concurrency on updated_at; total recomputed here). Unchanged input -> changed=false, nothing written. Errors: ZW002 unknown / foreign; ZW003 stale; ZW004 quote_not_draft / opportunity_closed; ZW006 invalid snapshot.';
revoke all on function public.plus_update_quote_draft(uuid, uuid, timestamptz, text, text, boolean, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, bigint, text, date) from public, anon, service_role;
grant execute on function public.plus_update_quote_draft(uuid, uuid, timestamptz, text, text, boolean, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, bigint, text, date) to authenticated;

create function public.plus_mark_quote_sent(
  p_organization_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz
)
returns public.plus_quote_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opp public.plus_opportunities%rowtype;
  v_q public.plus_quotes%rowtype;
  v_prev public.plus_quotes%rowtype;
  v_stage text;
  v_result public.plus_quote_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  v_opp := public._plus_quote_lock_open_opportunity(p_organization_id, public._plus_quote_opportunity(p_organization_id, p_quote_id));
  v_q := public._plus_quote_lock(p_organization_id, p_quote_id);
  if v_q.status = 'sent' then
    v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_opp.stage, v_q.total_cents, v_q.updated_at, false);
    return v_result;
  end if;
  if v_q.status <> 'draft' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if v_q.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  -- an already-expired draft cannot be marked sent (edit its validity first)
  if v_q.valid_until < public._plus_org_local_today(p_organization_id) then
    raise exception 'quote_expired' using errcode = 'ZW004';
  end if;
  -- a revision replaces its predecessor only while that predecessor is still the sent quote
  if v_q.supersedes_quote_id is not null then
    v_prev := public._plus_quote_lock(p_organization_id, v_q.supersedes_quote_id);
    if v_prev.status <> 'sent' then
      raise exception 'revision_base_not_current' using errcode = 'ZW004';
    end if;
    update public.plus_quotes set status = 'superseded' where id = v_prev.id returning * into v_prev;
    perform public._plus_quote_audit(v_prev, 'plus_quote_superseded', jsonb_build_object('superseded_by_quote_id', v_q.id), null);
  end if;

  update public.plus_quotes set status = 'sent', sent_at = now(), sent_by = auth.uid() where id = v_q.id returning * into v_q;
  v_stage := public._plus_quote_advance_stage(v_opp, 'quote_sent');
  perform public._plus_quote_audit(v_q, 'plus_quote_sent',
    jsonb_build_object('opportunity_stage_before', v_opp.stage, 'opportunity_stage_after', v_stage), null);
  v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_stage, v_q.total_cents, v_q.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_mark_quote_sent(uuid, uuid, timestamptz) is
  'NP-P2-S5-S1. Plus WRITE. Records that STAFF shared a draft (Nemryn sends nothing; not proof of delivery). Freezes the snapshot; supersedes the revised predecessor (which must still be sent); advances an open opportunity in new_inquiry / contacted / qualified to quote_sent (never regresses) -- one transaction. Already sent -> changed=false. Errors: ZW002; ZW003 stale; ZW004 illegal_transition / quote_expired / revision_base_not_current / opportunity_closed.';
revoke all on function public.plus_mark_quote_sent(uuid, uuid, timestamptz) from public, anon, service_role;
grant execute on function public.plus_mark_quote_sent(uuid, uuid, timestamptz) to authenticated;

create function public.plus_record_quote_response(
  p_organization_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz,
  p_response text
)
returns public.plus_quote_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opp public.plus_opportunities%rowtype;
  v_q public.plus_quotes%rowtype;
  v_stage text;
  v_result public.plus_quote_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  if p_response is null or p_response not in ('accepted', 'declined') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  v_opp := public._plus_quote_lock_open_opportunity(p_organization_id, public._plus_quote_opportunity(p_organization_id, p_quote_id));
  v_q := public._plus_quote_lock(p_organization_id, p_quote_id);
  if v_q.status = p_response then
    v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_opp.stage, v_q.total_cents, v_q.updated_at, false);
    return v_result;
  end if;
  if v_q.status <> 'sent' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if v_q.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_q.valid_until < public._plus_org_local_today(p_organization_id) then
    raise exception 'quote_expired' using errcode = 'ZW004';
  end if;

  update public.plus_quotes set status = p_response, responded_at = now(), responded_by = auth.uid() where id = v_q.id returning * into v_q;
  v_stage := case when p_response = 'accepted' then public._plus_quote_advance_stage(v_opp, 'quote_accepted') else v_opp.stage end;
  perform public._plus_quote_audit(v_q, case when p_response = 'accepted' then 'plus_quote_accepted' else 'plus_quote_declined' end,
    jsonb_build_object('opportunity_stage_before', v_opp.stage, 'opportunity_stage_after', v_stage), null);
  v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_stage, v_q.total_cents, v_q.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_record_quote_response(uuid, uuid, timestamptz, text) is
  'NP-P2-S5-S1. Plus WRITE. Records the customer''s response AS REPORTED BY STAFF (not verified acceptance) on a sent, not-expired quote: accepted advances an open opportunity (not yet quote_accepted) to quote_accepted; declined changes no stage (staff decide Lost). Never converts, never writes Core, payments or tasks. Same response again -> changed=false. Errors: ZW002; ZW003 stale; ZW004 illegal_transition / quote_expired / opportunity_closed; ZW006 response not accepted|declined.';
revoke all on function public.plus_record_quote_response(uuid, uuid, timestamptz, text) from public, anon, service_role;
grant execute on function public.plus_record_quote_response(uuid, uuid, timestamptz, text) to authenticated;

create function public.plus_revise_quote(
  p_organization_id uuid,
  p_quote_id uuid,
  p_idempotency_key text
)
returns public.plus_quote_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_prior public.plus_quotes%rowtype;
  v_opp public.plus_opportunities%rowtype;
  v_src public.plus_quotes%rowtype;
  v_new public.plus_quotes%rowtype;
  v_result public.plus_quote_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  v_key := public._plus_require_idempotency_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('plus-quote:' || p_organization_id::text || ':' || v_key)::bigint);
  select * into v_prior from public.plus_quotes q where q.organization_id = p_organization_id and q.idempotency_key = v_key;
  if found then
    if v_prior.supersedes_quote_id = p_quote_id then
      select q.id, q.quote_number, q.status, q.opportunity_id, o.stage, q.total_cents, q.updated_at, false
        into v_result from public.plus_quotes q join public.plus_opportunities o on o.id = q.opportunity_id and o.organization_id = q.organization_id
      where q.id = v_prior.id;
      return v_result;
    end if;
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_opp := public._plus_quote_lock_open_opportunity(p_organization_id, public._plus_quote_opportunity(p_organization_id, p_quote_id));
  perform public._plus_require_active_contact(p_organization_id, v_opp.primary_contact_id);
  v_src := public._plus_quote_lock(p_organization_id, p_quote_id);
  -- only a SENT quote (including one now derived as expired) is revised; accepted / declined are final
  if v_src.status <> 'sent' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if exists (select 1 from public.plus_quotes q where q.supersedes_quote_id = v_src.id and q.status <> 'withdrawn') then
    raise exception 'revision_exists' using errcode = 'ZW004';
  end if;

  insert into public.plus_quotes (organization_id, opportunity_id, quote_number, kind, service_type, round_trip, distance_miles,
    base_cents, mileage_cents, wait_cents, extra_stops_cents, mobility_assistance_cents, escort_cents, return_leg_cents,
    other_cents, other_label, discount_cents, total_cents, terms_note, valid_until, status, supersedes_quote_id, idempotency_key, created_by)
  values (p_organization_id, v_src.opportunity_id, public._plus_next_quote_number(p_organization_id), v_src.kind, v_src.service_type,
    v_src.round_trip, v_src.distance_miles, v_src.base_cents, v_src.mileage_cents, v_src.wait_cents, v_src.extra_stops_cents,
    v_src.mobility_assistance_cents, v_src.escort_cents, v_src.return_leg_cents, v_src.other_cents, v_src.other_label,
    v_src.discount_cents, v_src.total_cents, v_src.terms_note, v_src.valid_until, 'draft', v_src.id, v_key, auth.uid())
  returning * into v_new;
  perform public._plus_quote_audit(v_new, 'plus_quote_created', jsonb_build_object('supersedes_quote_id', v_src.id), null);
  v_result := (v_new.id, v_new.quote_number, v_new.status, v_new.opportunity_id, v_opp.stage, v_new.total_cents, v_new.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_revise_quote(uuid, uuid, text) is
  'NP-P2-S5-S1. Plus WRITE. Starts a revision of a SENT quote: a NEW draft (new number) copying its snapshot and linked by supersedes_quote_id; the original stays unchanged and is superseded only when the revision is marked sent. At most one live revision per quote. Idempotent per (organization, key). Errors: ZW002; ZW004 illegal_transition / revision_exists / opportunity_closed; ZW006 invalid key / key used elsewhere / archived contact.';
revoke all on function public.plus_revise_quote(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.plus_revise_quote(uuid, uuid, text) to authenticated;

create function public.plus_withdraw_quote(
  p_organization_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz,
  p_reason text
)
returns public.plus_quote_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_opp public.plus_opportunities%rowtype;
  v_q public.plus_quotes%rowtype;
  v_result public.plus_quote_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  if v_reason is not null and length(v_reason) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  v_opp := public._plus_quote_lock_open_opportunity(p_organization_id, public._plus_quote_opportunity(p_organization_id, p_quote_id));
  v_q := public._plus_quote_lock(p_organization_id, p_quote_id);
  if v_q.status = 'withdrawn' then
    v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_opp.stage, v_q.total_cents, v_q.updated_at, false);
    return v_result;
  end if;
  if v_q.status not in ('draft', 'sent') then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if v_q.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  -- a sent quote is only withdrawn with a reason (a draft may be discarded without one)
  if v_q.status = 'sent' and v_reason is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  update public.plus_quotes set status = 'withdrawn', withdrawn_reason = v_reason where id = v_q.id returning * into v_q;
  perform public._plus_quote_audit(v_q, 'plus_quote_withdrawn', jsonb_build_object('was_sent', v_q.sent_at is not null), v_reason);
  v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_opp.stage, v_q.total_cents, v_q.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_withdraw_quote(uuid, uuid, timestamptz, text) is
  'NP-P2-S5-S1. Plus WRITE. Withdraws a draft (reason optional) or a sent quote (reason required, <= 200). The row is kept as history (never deleted); no stage changes. Already withdrawn -> changed=false. Errors: ZW002; ZW003 stale; ZW004 illegal_transition / opportunity_closed; ZW006 missing / long reason.';
revoke all on function public.plus_withdraw_quote(uuid, uuid, timestamptz, text) from public, anon, service_role;
grant execute on function public.plus_withdraw_quote(uuid, uuid, timestamptz, text) to authenticated;

-- =============================================================================
-- 6. Read RPCs (Plus READ; tenant-scoped; no oracle)
-- =============================================================================
create function public.plus_list_quotes(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_contact_id uuid
)
returns table (
  quote_id uuid,
  quote_number integer,
  kind text,
  status text,
  is_expired boolean,
  opportunity_id uuid,
  opportunity_title text,
  opportunity_stage text,
  contact_id uuid,
  service_type text,
  round_trip boolean,
  total_cents bigint,
  currency text,
  valid_until date,
  supersedes_quote_id uuid,
  superseded_by_quote_id uuid,
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if num_nonnulls(p_opportunity_id, p_contact_id) <> 1 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  v_today := public._plus_org_local_today(p_organization_id);
  return query
  select q.id, q.quote_number, q.kind, q.status, (q.status = 'sent' and q.valid_until < v_today),
         q.opportunity_id, o.title, o.stage, o.primary_contact_id, q.service_type, q.round_trip, q.total_cents, q.currency,
         q.valid_until, q.supersedes_quote_id,
         (select s.id from public.plus_quotes s where s.supersedes_quote_id = q.id and s.organization_id = q.organization_id and s.status <> 'withdrawn' limit 1),
         q.sent_at, q.responded_at, q.created_at, q.updated_at
  from public.plus_quotes q
  join public.plus_opportunities o on o.id = q.opportunity_id and o.organization_id = q.organization_id
  where q.organization_id = p_organization_id
    and (p_opportunity_id is null or q.opportunity_id = p_opportunity_id)
    and (p_contact_id is null or o.primary_contact_id = p_contact_id)
  order by q.created_at desc, q.quote_number desc;
end;
$$;
comment on function public.plus_list_quotes(uuid, uuid, uuid) is
  'NP-P2-S5-S1. Plus READ. The quotes of ONE opportunity or of ONE contact (exactly one filter; ZW006 otherwise) in p_organization_id, newest first, with derived is_expired (sent and valid_until before the organization''s local today). Another organization''s ids simply match nothing. ZW001 no user; ZW002 no Plus read access.';
revoke all on function public.plus_list_quotes(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.plus_list_quotes(uuid, uuid, uuid) to authenticated;

create function public.plus_get_quote(p_organization_id uuid, p_quote_id uuid)
returns table (
  quote_id uuid,
  quote_number integer,
  kind text,
  status text,
  is_expired boolean,
  opportunity_id uuid,
  opportunity_title text,
  opportunity_stage text,
  contact_id uuid,
  contact_name text,
  service_type text,
  round_trip boolean,
  distance_miles numeric,
  base_cents bigint,
  mileage_cents bigint,
  wait_cents bigint,
  extra_stops_cents bigint,
  mobility_assistance_cents bigint,
  escort_cents bigint,
  return_leg_cents bigint,
  other_cents bigint,
  other_label text,
  discount_cents bigint,
  total_cents bigint,
  currency text,
  terms_note text,
  valid_until date,
  supersedes_quote_id uuid,
  superseded_by_quote_id uuid,
  created_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  sent_at timestamptz,
  sent_by_name text,
  responded_at timestamptz,
  responded_by_name text,
  withdrawn_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select q.id, q.quote_number, q.kind, q.status, (q.status = 'sent' and q.valid_until < public._plus_org_local_today(p_organization_id)),
         q.opportunity_id, o.title, o.stage, o.primary_contact_id, c.display_name, q.service_type, q.round_trip, q.distance_miles,
         q.base_cents, q.mileage_cents, q.wait_cents, q.extra_stops_cents, q.mobility_assistance_cents, q.escort_cents,
         q.return_leg_cents, q.other_cents, q.other_label, q.discount_cents, q.total_cents, q.currency, q.terms_note, q.valid_until,
         q.supersedes_quote_id,
         (select s.id from public.plus_quotes s where s.supersedes_quote_id = q.id and s.organization_id = q.organization_id and s.status <> 'withdrawn' limit 1),
         public._plus_staff_name(q.created_by), q.created_at, q.updated_at,
         q.sent_at, case when q.sent_by is null then null else public._plus_staff_name(q.sent_by) end,
         q.responded_at, case when q.responded_by is null then null else public._plus_staff_name(q.responded_by) end,
         q.withdrawn_reason
  from public.plus_quotes q
  join public.plus_opportunities o on o.id = q.opportunity_id and o.organization_id = q.organization_id
  join public.plus_contacts c on c.id = o.primary_contact_id and c.organization_id = o.organization_id
  where q.organization_id = p_organization_id and q.id = p_quote_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
end;
$$;
comment on function public.plus_get_quote(uuid, uuid) is
  'NP-P2-S5-S1. Plus READ. One quote of p_organization_id with its full snapshot, derived is_expired and staff names (no addresses or medical details exist to return). ZW001 no user; ZW002 no Plus read access OR unknown / foreign quote (indistinguishable).';
revoke all on function public.plus_get_quote(uuid, uuid) from public, anon, service_role;
grant execute on function public.plus_get_quote(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
