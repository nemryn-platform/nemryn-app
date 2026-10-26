-- =============================================================================
-- NP-BILL-P1 (Stage A2) -- Core private-pay billing: RPCs (the ONLY write path).
--
-- Every function: SECURITY DEFINER, search_path pinned, auth.uid() required (ZW001), Organization Admin of
-- p_organization_id (ZW002 otherwise -- no existence oracle), rows always read with organization_id = p_organization_id.
-- Writes lock the invoice row (FOR UPDATE) and check expected_version (ZW003), so concurrent draft edits, issue,
-- payment, reversal and void serialize and a stale form never overwrites newer state. Creates, payments and reversals
-- are idempotent per (organization, key). Every write is audited (ids, amounts, statuses -- never names, addresses or
-- free-text notes). Errors: ZW001 unauthenticated; ZW002 not found / not permitted; ZW003 stale; ZW004 illegal state;
-- ZW006 invalid input (message names the rule).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Result types
-- -----------------------------------------------------------------------------
create type public.billing_invoice_write_result as (
  invoice_id uuid,
  invoice_number integer,
  status text,
  version integer,
  total_cents bigint,
  changed boolean
);
comment on type public.billing_invoice_write_result is 'NP-BILL-P1. Result of every invoice write RPC; changed=false = idempotent repeat.';

create type public.billing_payment_write_result as (
  payment_id uuid,
  invoice_id uuid,
  paid_cents bigint,
  balance_cents bigint,
  version integer,
  changed boolean
);
comment on type public.billing_payment_write_result is 'NP-BILL-P1. Result of record / reverse payment; changed=false = idempotent repeat.';

-- -----------------------------------------------------------------------------
-- Internal helpers (no client EXECUTE)
-- -----------------------------------------------------------------------------
create function public._billing_require_admin(p_organization_id uuid)
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
  if p_organization_id is null or not public.has_org_role(p_organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
end;
$$;
comment on function public._billing_require_admin(uuid) is 'NP-BILL-P1. INTERNAL. Signed in (ZW001) and an active Organization Admin of the organization (ZW002) -- D2.';
revoke all on function public._billing_require_admin(uuid) from public, anon, authenticated, service_role;

create function public._billing_require_key(p_key text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := btrim(coalesce(p_key, ''));
begin
  if v !~ '^[A-Za-z0-9._:-]{8,100}$' then
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;
  return v;
end;
$$;
revoke all on function public._billing_require_key(text) from public, anon, authenticated, service_role;

create function public._billing_org_today(p_organization_id uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (now() at time zone o.timezone)::date from public.organizations o where o.id = p_organization_id;
$$;
revoke all on function public._billing_org_today(uuid) from public, anon, authenticated, service_role;

create function public._billing_paid_cents(p_invoice_id uuid)
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
revoke all on function public._billing_paid_cents(uuid) from public, anon, authenticated, service_role;

create function public._billing_payment_state(p_status text, p_total bigint, p_paid bigint)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_status = 'draft' then 'draft'
    when p_status = 'void' then 'void'
    when p_paid <= 0 then 'unpaid'
    when p_paid < p_total then 'partially_paid'
    else 'paid'
  end;
$$;
comment on function public._billing_payment_state(text, bigint, bigint) is 'NP-BILL-P1. INTERNAL. Displayed state: draft | void | unpaid | partially_paid | paid (derived, never stored).';
revoke all on function public._billing_payment_state(text, bigint, bigint) from public, anon, authenticated, service_role;

create function public._billing_lock_invoice(p_organization_id uuid, p_invoice_id uuid)
returns public.billing_invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.billing_invoices%rowtype;
begin
  select * into v from public.billing_invoices i
  where i.id = p_invoice_id and i.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return v;
end;
$$;
revoke all on function public._billing_lock_invoice(uuid, uuid) from public, anon, authenticated, service_role;

create function public._billing_recompute_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub bigint;
  v_discount bigint;
begin
  select coalesce(sum(l.amount_cents), 0)::bigint into v_sub from public.billing_invoice_lines l where l.invoice_id = p_invoice_id;
  select i.discount_cents into v_discount from public.billing_invoices i where i.id = p_invoice_id;
  if v_discount > v_sub then
    raise exception 'discount_exceeds_subtotal' using errcode = 'ZW006';
  end if;
  update public.billing_invoices set subtotal_cents = v_sub, total_cents = v_sub - v_discount where id = p_invoice_id;
end;
$$;
revoke all on function public._billing_recompute_totals(uuid) from public, anon, authenticated, service_role;

create function public._billing_audit(p_organization_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_before jsonb, p_after jsonb, p_reason text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (p_organization_id, p_entity_type, p_entity_id, p_action, auth.uid(), p_before, p_after, p_reason);
$$;
comment on function public._billing_audit(uuid, text, uuid, text, jsonb, jsonb, text) is
  'NP-BILL-P1. INTERNAL. One audit_events row per billing action. Callers pass ids, amounts and statuses only -- never bill-to names, addresses, payment references or notes (R4).';
revoke all on function public._billing_audit(uuid, text, uuid, text, jsonb, jsonb, text) from public, anon, authenticated, service_role;

create function public._billing_trip_line_description(p_organization_id uuid, p_trip public.trips)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select left(
    'Transportation ' || to_char((coalesce(p_trip.scheduled_pickup_at, p_trip.completed_at) at time zone o.timezone)::date, 'Mon DD, YYYY')
    || ': ' || btrim(p_trip.pickup_description) || ' to ' || btrim(p_trip.destination_description), 300)
  from public.organizations o where o.id = p_organization_id;
$$;
revoke all on function public._billing_trip_line_description(uuid, public.trips) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Create a draft (R1 multi-trip consistency; R3 optional quote import)
-- -----------------------------------------------------------------------------
create function public.billing_create_invoice_draft(
  p_organization_id uuid,
  p_trip_ids uuid[],
  p_bill_to_kind text,
  p_bill_to_id uuid,
  p_bill_to_name text,
  p_source_quote_id uuid,
  p_idempotency_key text
)
returns public.billing_invoice_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_prior public.billing_invoices%rowtype;
  v_ids uuid[];
  v_trip public.trips%rowtype;
  v_passenger_id uuid;
  v_count integer;
  v_name text;
  v_address text;
  v_email text;
  v_phone text;
  v_quote public.plus_quotes%rowtype;
  v_inv public.billing_invoices%rowtype;
  v_pos integer := 0;
  v_date text;
  v_comp record;
  v_result public.billing_invoice_write_result;
begin
  perform public._billing_require_admin(p_organization_id);
  v_key := public._billing_require_key(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtext('billing-invoice:' || p_organization_id::text || ':' || v_key)::bigint);

  select array_agg(distinct t order by t) into v_ids from unnest(coalesce(p_trip_ids, array[]::uuid[])) t where t is not null;
  if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 31 then
    raise exception 'invalid_trip_selection' using errcode = 'ZW006';
  end if;

  -- replay: the same key returns the original draft only for the same trip set
  select * into v_prior from public.billing_invoices i where i.organization_id = p_organization_id and i.idempotency_key = v_key;
  if found then
    if (select array_agg(l.trip_id order by l.trip_id) from public.billing_invoice_trips l where l.invoice_id = v_prior.id) = v_ids then
      v_result := (v_prior.id, v_prior.invoice_number, v_prior.status, v_prior.version, v_prior.total_cents, false);
      return v_result;
    end if;
    raise exception 'invalid_idempotency_key' using errcode = 'ZW006';
  end if;

  -- R1: every trip in THIS organization, completed, ONE passenger, not on another active invoice. Rows are locked so a
  -- concurrent draft for the same trip waits here (and the partial unique index is the final guard).
  select count(*) into v_count from public.trips t where t.id = any (v_ids) and t.organization_id = p_organization_id;
  if v_count <> cardinality(v_ids) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  perform 1 from public.trips t where t.id = any (v_ids) and t.organization_id = p_organization_id order by t.id for update;
  if exists (select 1 from public.trips t where t.id = any (v_ids) and t.state <> 'completed') then
    raise exception 'trip_not_completed' using errcode = 'ZW004';
  end if;
  select min(t.passenger_id::text)::uuid, count(distinct t.passenger_id) into v_passenger_id, v_count
  from public.trips t where t.id = any (v_ids);
  if v_passenger_id is null or v_count <> 1 or exists (select 1 from public.trips t where t.id = any (v_ids) and t.passenger_id is null) then
    raise exception 'mixed_customers' using errcode = 'ZW006';
  end if;
  if exists (select 1 from public.billing_invoice_trips l where l.trip_id = any (v_ids) and l.released_at is null) then
    raise exception 'trip_already_invoiced' using errcode = 'ZW004';
  end if;

  -- R1: the bill-to party must be legitimately linked to EVERY included trip
  if p_bill_to_kind = 'passenger' then
    if p_bill_to_id is distinct from v_passenger_id then
      raise exception 'bill_to_not_linked' using errcode = 'ZW006';
    end if;
    select p.display_name, p.phone into v_name, v_phone from public.passengers p
    where p.id = v_passenger_id and p.organization_id = p_organization_id;
  elsif p_bill_to_kind = 'requester' then
    if p_bill_to_id is null or not exists (select 1 from public.trips t where t.id = any (v_ids) and t.request_id = p_bill_to_id) then
      raise exception 'bill_to_not_linked' using errcode = 'ZW006';
    end if;
    select r.requester_name, r.requester_phone, r.requester_email into v_name, v_phone, v_email
    from public.transportation_requests r where r.id = p_bill_to_id and r.organization_id = p_organization_id;
    if v_name is null then
      raise exception 'bill_to_not_linked' using errcode = 'ZW006';
    end if;
    -- EVERY included trip must come from a request by this same requester (name + phone digits): one family member who
    -- requested several rides can pay for all of them; a trip without a request, or requested by someone else, cannot
    -- be billed to this requester.
    if exists (
         select 1 from public.trips t
         left join public.transportation_requests r on r.id = t.request_id and r.organization_id = t.organization_id
         where t.id = any (v_ids)
           and (r.id is null
                or lower(btrim(r.requester_name)) is distinct from lower(btrim(v_name))
                or regexp_replace(coalesce(r.requester_phone, ''), '[^0-9]', '', 'g')
                   is distinct from regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'))) then
      raise exception 'bill_to_not_linked' using errcode = 'ZW006';
    end if;
  elsif p_bill_to_kind = 'facility' then
    if p_bill_to_id is null or exists (
         select 1 from public.trips t where t.id = any (v_ids)
           and t.pickup_facility_id is distinct from p_bill_to_id and t.destination_facility_id is distinct from p_bill_to_id) then
      raise exception 'bill_to_not_linked' using errcode = 'ZW006';
    end if;
    select f.name, nullif(concat_ws(', ', nullif(btrim(f.address_line1), ''), nullif(btrim(f.address_line2), ''),
                                    nullif(btrim(f.city), ''), nullif(btrim(concat_ws(' ', f.state, f.postal_code)), '')), '')
      into v_name, v_address
    from public.facilities f where f.id = p_bill_to_id and f.organization_id = p_organization_id;
    if v_name is null then
      raise exception 'bill_to_not_linked' using errcode = 'ZW006';
    end if;
  elsif p_bill_to_kind = 'other' then
    if p_bill_to_id is not null then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    v_name := nullif(btrim(p_bill_to_name), '');
    if v_name is null or length(v_name) > 200 then
      raise exception 'bill_to_name_required' using errcode = 'ZW006';
    end if;
  else
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  v_name := left(btrim(v_name), 200);

  -- R3: optional Plus quote -- readable by the caller, sent / accepted, and linked to EVERY included trip's request
  if p_source_quote_id is not null then
    if not public.plus_can_read(p_organization_id) then
      raise exception 'quote_unavailable' using errcode = 'ZW002';
    end if;
    select * into v_quote from public.plus_quotes q where q.id = p_source_quote_id and q.organization_id = p_organization_id;
    if not found then
      raise exception 'quote_unavailable' using errcode = 'ZW002';
    end if;
    if v_quote.status not in ('sent', 'accepted') then
      raise exception 'quote_not_billable' using errcode = 'ZW004';
    end if;
    if exists (
         select 1 from public.trips t where t.id = any (v_ids) and not exists (
           select 1 from public.plus_request_attributions a
           where a.organization_id = p_organization_id and a.request_id = t.request_id and a.opportunity_id = v_quote.opportunity_id)) then
      raise exception 'quote_not_linked' using errcode = 'ZW006';
    end if;
  end if;

  insert into public.billing_invoices (organization_id, status, passenger_id, bill_to_kind, bill_to_passenger_id, bill_to_request_id,
    bill_to_facility_id, bill_to_name, bill_to_address, bill_to_email, bill_to_phone, source_quote_id, source_quote_number,
    source_quote_kind, discount_cents, idempotency_key, created_by)
  values (p_organization_id, 'draft', v_passenger_id, p_bill_to_kind,
    case when p_bill_to_kind = 'passenger' then p_bill_to_id end,
    case when p_bill_to_kind = 'requester' then p_bill_to_id end,
    case when p_bill_to_kind = 'facility' then p_bill_to_id end,
    v_name, left(nullif(btrim(v_address), ''), 500), left(nullif(btrim(v_email), ''), 254), left(nullif(btrim(v_phone), ''), 40),
    v_quote.id, v_quote.quote_number, v_quote.kind, 0, v_key, auth.uid())
  returning * into v_inv;

  begin
    insert into public.billing_invoice_trips (invoice_id, trip_id, organization_id)
    select v_inv.id, t, p_organization_id from unnest(v_ids) t;
  exception when unique_violation then
    raise exception 'trip_already_invoiced' using errcode = 'ZW004';   -- lost a race with another draft
  end;

  -- lines: one per trip, or (R3) the quote's itemised components per trip INSTEAD of the trip line -- never both
  for v_trip in
    select * from public.trips t where t.id = any (v_ids) order by coalesce(t.scheduled_pickup_at, t.completed_at), t.id
  loop
    if v_quote.id is null then
      v_pos := v_pos + 1;
      insert into public.billing_invoice_lines (organization_id, invoice_id, position, trip_id, source, description, quantity, unit_cents, amount_cents)
      values (p_organization_id, v_inv.id, v_pos, v_trip.id, 'trip', public._billing_trip_line_description(p_organization_id, v_trip), 1, 0, 0);
    else
      select to_char((coalesce(v_trip.scheduled_pickup_at, v_trip.completed_at) at time zone o.timezone)::date, 'Mon DD, YYYY')
        into v_date from public.organizations o where o.id = p_organization_id;
      for v_comp in
        select * from (values
          (1, 'Base fare', v_quote.base_cents),
          (2, 'Mileage' || coalesce(' (' || v_quote.distance_miles::text || ' mi)', ''), v_quote.mileage_cents),
          (3, 'Wait time', v_quote.wait_cents),
          (4, 'Extra stops', v_quote.extra_stops_cents),
          (5, 'Mobility assistance', v_quote.mobility_assistance_cents),
          (6, 'Escort', v_quote.escort_cents),
          (7, 'Return leg', v_quote.return_leg_cents),
          (8, coalesce(v_quote.other_label, 'Other'), v_quote.other_cents)
        ) c(ord, label, cents)
        where c.cents > 0
        order by c.ord
      loop
        v_pos := v_pos + 1;
        insert into public.billing_invoice_lines (organization_id, invoice_id, position, trip_id, source, description, quantity, unit_cents, amount_cents)
        values (p_organization_id, v_inv.id, v_pos, v_trip.id, 'quote', left(v_comp.label || ' — ' || v_date, 300), 1, v_comp.cents, v_comp.cents);
      end loop;
    end if;
  end loop;
  perform public._billing_recompute_totals(v_inv.id);
  if v_quote.id is not null and v_quote.discount_cents > 0 then
    -- the quote's discount applies per ride; set after the lines so it never exceeds the subtotal
    update public.billing_invoices set discount_cents = least(v_quote.discount_cents * cardinality(v_ids), subtotal_cents),
      total_cents = subtotal_cents - least(v_quote.discount_cents * cardinality(v_ids), subtotal_cents)
    where id = v_inv.id;
  end if;

  select * into v_inv from public.billing_invoices i where i.id = v_inv.id;
  perform public._billing_audit(p_organization_id, 'billing_invoice', v_inv.id, 'billing_invoice_draft_created', null,
    jsonb_build_object('trip_count', cardinality(v_ids), 'bill_to_kind', v_inv.bill_to_kind,
                       'source_quote_id', v_inv.source_quote_id, 'total_cents', v_inv.total_cents), null);
  v_result := (v_inv.id, v_inv.invoice_number, v_inv.status, v_inv.version, v_inv.total_cents, true);
  return v_result;
end;
$$;
comment on function public.billing_create_invoice_draft(uuid, uuid[], text, uuid, text, uuid, text) is
  'NP-BILL-P1. Organization Admin. Creates ONE draft for 1-31 COMPLETED trips of this organization that all belong to ONE passenger and are not on another draft / issued invoice (R1; ZW004 trip_not_completed / trip_already_invoiced, ZW006 mixed_customers). Bill-to must be linked to every trip (R1, ZW006 bill_to_not_linked): passenger = the trips'' passenger; requester = the request of one of the trips AND every trip requested by that same requester (name + phone); facility = pickup or destination facility of every trip; other = typed name. Optional Plus quote (R3): readable (plus_can_read), sent / accepted, attributed to every trip''s request; its components become per-trip lines INSTEAD of the default trip line (never duplicated), its discount x trips the invoice discount; number + kind snapshotted. Idempotent per key (same trip set). Never issues, never touches trips.';
revoke all on function public.billing_create_invoice_draft(uuid, uuid[], text, uuid, text, uuid, text) from public, anon, service_role;
grant execute on function public.billing_create_invoice_draft(uuid, uuid[], text, uuid, text, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Edit / discard a draft
-- -----------------------------------------------------------------------------
create function public.billing_update_invoice_draft(
  p_organization_id uuid,
  p_invoice_id uuid,
  p_expected_version integer,
  p_bill_to_name text,
  p_bill_to_address text,
  p_bill_to_email text,
  p_bill_to_phone text,
  p_lines jsonb,
  p_discount_cents bigint,
  p_terms_note text
)
returns public.billing_invoice_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.billing_invoices%rowtype;
  v_line jsonb;
  v_pos integer := 0;
  v_qty numeric;
  v_unit bigint;
  v_desc text;
  v_trip uuid;
  v_source text;
  v_result public.billing_invoice_write_result;
begin
  perform public._billing_require_admin(p_organization_id);
  v_inv := public._billing_lock_invoice(p_organization_id, p_invoice_id);
  if p_expected_version is null or p_expected_version <> v_inv.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'invoice_immutable' using errcode = 'ZW004';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200
     or coalesce(p_discount_cents, 0) < 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if length(btrim(coalesce(p_bill_to_name, ''))) not between 1 and 200 then
    raise exception 'bill_to_name_required' using errcode = 'ZW006';
  end if;

  begin
    update public.billing_invoices set
      bill_to_name = btrim(p_bill_to_name),
      bill_to_address = nullif(btrim(p_bill_to_address), ''),
      bill_to_email = nullif(btrim(p_bill_to_email), ''),
      bill_to_phone = nullif(btrim(p_bill_to_phone), ''),
      terms_note = nullif(btrim(p_terms_note), ''),
      discount_cents = 0,
      total_cents = subtotal_cents,
      version = version + 1
    where id = v_inv.id;

    delete from public.billing_invoice_lines where invoice_id = v_inv.id;
    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      v_pos := v_pos + 1;
      v_desc := btrim(coalesce(v_line ->> 'description', ''));
      v_qty := coalesce((v_line ->> 'quantity')::numeric, 1);
      v_unit := (v_line ->> 'unit_cents')::bigint;
      v_trip := nullif(v_line ->> 'trip_id', '')::uuid;
      v_source := coalesce(nullif(v_line ->> 'source', ''), 'manual');
      if v_unit is null or (v_source = 'trip' and v_trip is null) then
        raise exception 'invalid_line' using errcode = 'ZW006';
      end if;
      insert into public.billing_invoice_lines (organization_id, invoice_id, position, trip_id, source, description, quantity, unit_cents, amount_cents)
      values (p_organization_id, v_inv.id, v_pos, v_trip, v_source, v_desc, round(v_qty, 2), v_unit, round(round(v_qty, 2) * v_unit)::bigint);
    end loop;

    perform public._billing_recompute_totals(v_inv.id);   -- discount is 0 here: subtotal first
    if coalesce(p_discount_cents, 0) > (select i.subtotal_cents from public.billing_invoices i where i.id = v_inv.id) then
      raise exception 'discount_exceeds_subtotal' using errcode = 'ZW006';
    end if;
    update public.billing_invoices set discount_cents = coalesce(p_discount_cents, 0), total_cents = subtotal_cents - coalesce(p_discount_cents, 0)
    where id = v_inv.id;
  exception
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_line' using errcode = 'ZW006';
    when foreign_key_violation then
      raise exception 'line_trip_not_on_invoice' using errcode = 'ZW006';   -- a trip line must reference this invoice's trips
  end;

  select * into v_inv from public.billing_invoices i where i.id = v_inv.id;
  perform public._billing_audit(p_organization_id, 'billing_invoice', v_inv.id, 'billing_invoice_draft_updated', null,
    jsonb_build_object('line_count', v_pos, 'discount_cents', v_inv.discount_cents, 'total_cents', v_inv.total_cents), null);
  v_result := (v_inv.id, v_inv.invoice_number, v_inv.status, v_inv.version, v_inv.total_cents, true);
  return v_result;
end;
$$;
comment on function public.billing_update_invoice_draft(uuid, uuid, integer, text, text, text, text, jsonb, bigint, text) is
  'NP-BILL-P1. Organization Admin, DRAFT only (ZW004), expected_version (ZW003). Replaces the bill-to contact text, the lines (jsonb [{description, quantity, unit_cents, trip_id?, source?}], max 200; amount = round(quantity x unit) computed here), the discount (<= subtotal) and terms. A trip line must reference a trip on this invoice (FK). Totals recomputed server-side; never accepted from the client.';
revoke all on function public.billing_update_invoice_draft(uuid, uuid, integer, text, text, text, text, jsonb, bigint, text) from public, anon, service_role;
grant execute on function public.billing_update_invoice_draft(uuid, uuid, integer, text, text, text, text, jsonb, bigint, text) to authenticated;

create function public.billing_discard_invoice_draft(p_organization_id uuid, p_invoice_id uuid, p_expected_version integer)
returns public.billing_invoice_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.billing_invoices%rowtype;
  v_result public.billing_invoice_write_result;
begin
  perform public._billing_require_admin(p_organization_id);
  v_inv := public._billing_lock_invoice(p_organization_id, p_invoice_id);
  if p_expected_version is null or p_expected_version <> v_inv.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'invoice_immutable' using errcode = 'ZW004';
  end if;
  delete from public.billing_invoices where id = v_inv.id;   -- lines and trip links cascade; never numbered, so no gap
  perform public._billing_audit(p_organization_id, 'billing_invoice', v_inv.id, 'billing_invoice_draft_discarded',
    jsonb_build_object('total_cents', v_inv.total_cents), null, null);
  v_result := (v_inv.id, null, 'discarded', v_inv.version, v_inv.total_cents, true);
  return v_result;
end;
$$;
comment on function public.billing_discard_invoice_draft(uuid, uuid, integer) is
  'NP-BILL-P1. Organization Admin, DRAFT only. Deletes a never-issued draft (it was never a financial record and has no number) and frees its trips. Audited.';
revoke all on function public.billing_discard_invoice_draft(uuid, uuid, integer) from public, anon, service_role;
grant execute on function public.billing_discard_invoice_draft(uuid, uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Issue / void
-- -----------------------------------------------------------------------------
create function public.billing_issue_invoice(
  p_organization_id uuid,
  p_invoice_id uuid,
  p_expected_version integer,
  p_issue_date date,
  p_due_date date
)
returns public.billing_invoice_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.billing_invoices%rowtype;
  v_today date := public._billing_org_today(p_organization_id);
  v_issue date;
  v_due date;
  v_number integer;
  v_result public.billing_invoice_write_result;
begin
  perform public._billing_require_admin(p_organization_id);
  v_inv := public._billing_lock_invoice(p_organization_id, p_invoice_id);
  if p_expected_version is null or p_expected_version <> v_inv.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if not exists (select 1 from public.billing_invoice_lines l where l.invoice_id = v_inv.id) or v_inv.total_cents <= 0 then
    raise exception 'invoice_total_required' using errcode = 'ZW006';
  end if;
  if exists (select 1 from public.billing_invoice_trips l join public.trips t on t.id = l.trip_id
             where l.invoice_id = v_inv.id and t.state <> 'completed') then
    raise exception 'trip_not_completed' using errcode = 'ZW004';
  end if;
  v_issue := coalesce(p_issue_date, v_today);
  v_due := coalesce(p_due_date, v_issue + 15);   -- D6 default terms
  if v_issue > v_today or v_issue < v_today - 365 or v_due < v_issue or v_due > v_issue + 365 then
    raise exception 'invalid_dates' using errcode = 'ZW006';
  end if;

  insert into public.billing_invoice_counters (organization_id) values (p_organization_id) on conflict (organization_id) do nothing;
  update public.billing_invoice_counters set next_number = next_number + 1
  where organization_id = p_organization_id
  returning next_number - 1 into v_number;

  update public.billing_invoices set status = 'issued', invoice_number = v_number, issue_date = v_issue, due_date = v_due,
    issued_by = auth.uid(), issued_at = now(), version = version + 1
  where id = v_inv.id
  returning * into v_inv;
  perform public._billing_audit(p_organization_id, 'billing_invoice', v_inv.id, 'billing_invoice_issued',
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'issued', 'invoice_number', v_number, 'total_cents', v_inv.total_cents, 'due_date', v_due), null);
  v_result := (v_inv.id, v_inv.invoice_number, v_inv.status, v_inv.version, v_inv.total_cents, true);
  return v_result;
end;
$$;
comment on function public.billing_issue_invoice(uuid, uuid, integer, date, date) is
  'NP-BILL-P1. Organization Admin, DRAFT only, expected_version. Requires lines and a total > 0 and still-completed trips; assigns the next per-organization number (counter row locked: no duplicates, no gaps among issued invoices); issue date <= today (org timezone, default today); due date default issue + 15 days (D6). From now on the invoice is frozen (trigger).';
revoke all on function public.billing_issue_invoice(uuid, uuid, integer, date, date) from public, anon, service_role;
grant execute on function public.billing_issue_invoice(uuid, uuid, integer, date, date) to authenticated;

create function public.billing_void_invoice(p_organization_id uuid, p_invoice_id uuid, p_expected_version integer, p_reason text)
returns public.billing_invoice_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.billing_invoices%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_result public.billing_invoice_write_result;
begin
  perform public._billing_require_admin(p_organization_id);
  v_inv := public._billing_lock_invoice(p_organization_id, p_invoice_id);
  if p_expected_version is null or p_expected_version <> v_inv.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_inv.status <> 'issued' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'reason_required' using errcode = 'ZW006';
  end if;
  if public._billing_paid_cents(v_inv.id) <> 0 then
    raise exception 'invoice_has_payments' using errcode = 'ZW004';   -- reverse the payments first
  end if;
  update public.billing_invoices set status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = v_reason,
    version = version + 1
  where id = v_inv.id
  returning * into v_inv;
  update public.billing_invoice_trips set released_at = now() where invoice_id = v_inv.id and released_at is null;
  perform public._billing_audit(p_organization_id, 'billing_invoice', v_inv.id, 'billing_invoice_voided',
    jsonb_build_object('status', 'issued'), jsonb_build_object('status', 'void', 'invoice_number', v_inv.invoice_number), v_reason);
  v_result := (v_inv.id, v_inv.invoice_number, v_inv.status, v_inv.version, v_inv.total_cents, true);
  return v_result;
end;
$$;
comment on function public.billing_void_invoice(uuid, uuid, integer, text) is
  'NP-BILL-P1. Organization Admin, ISSUED only, expected_version, reason 3-500 chars. Only when nothing is paid net of reversals (ZW004 invoice_has_payments). Keeps the number and all history; frees the trips for a corrected invoice. Audited with the reason.';
revoke all on function public.billing_void_invoice(uuid, uuid, integer, text) from public, anon, service_role;
grant execute on function public.billing_void_invoice(uuid, uuid, integer, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Payments (D5, R2)
-- -----------------------------------------------------------------------------
create function public.billing_record_payment(
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
revoke all on function public.billing_record_payment(uuid, uuid, integer, bigint, date, text, text, text, text) from public, anon, service_role;
grant execute on function public.billing_record_payment(uuid, uuid, integer, bigint, date, text, text, text, text) to authenticated;

create function public.billing_reverse_payment(
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
revoke all on function public.billing_reverse_payment(uuid, uuid, integer, text, text) from public, anon, service_role;
grant execute on function public.billing_reverse_payment(uuid, uuid, integer, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Reads
-- -----------------------------------------------------------------------------
create function public.billing_list_billable_trips(p_organization_id uuid, p_passenger_id uuid, p_limit integer, p_offset integer)
returns table (
  trip_id uuid,
  passenger_id uuid,
  passenger_name text,
  scheduled_pickup_at timestamptz,
  completed_at timestamptz,
  pickup_description text,
  destination_description text,
  request_id uuid,
  requester_name text,
  pickup_facility_id uuid,
  pickup_facility_name text,
  destination_facility_id uuid,
  destination_facility_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._billing_require_admin(p_organization_id);
  return query
  select t.id, t.passenger_id, p.display_name, t.scheduled_pickup_at, t.completed_at, t.pickup_description, t.destination_description,
         t.request_id, r.requester_name, t.pickup_facility_id, pf.name, t.destination_facility_id, df.name,
         count(*) over ()
  from public.trips t
  left join public.passengers p on p.id = t.passenger_id and p.organization_id = t.organization_id
  left join public.transportation_requests r on r.id = t.request_id and r.organization_id = t.organization_id
  left join public.facilities pf on pf.id = t.pickup_facility_id and pf.organization_id = t.organization_id
  left join public.facilities df on df.id = t.destination_facility_id and df.organization_id = t.organization_id
  where t.organization_id = p_organization_id and t.state = 'completed' and t.passenger_id is not null
    and (p_passenger_id is null or t.passenger_id = p_passenger_id)
    and not exists (select 1 from public.billing_invoice_trips l where l.trip_id = t.id and l.released_at is null)
  order by t.completed_at desc nulls last, t.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
comment on function public.billing_list_billable_trips(uuid, uuid, integer, integer) is
  'NP-BILL-P1. Organization Admin. Completed trips of this organization (with a passenger) not on any draft / issued invoice, newest first, optionally for one passenger; bounded page + total.';
revoke all on function public.billing_list_billable_trips(uuid, uuid, integer, integer) from public, anon, service_role;
grant execute on function public.billing_list_billable_trips(uuid, uuid, integer, integer) to authenticated;

create function public.billing_list_invoices(p_organization_id uuid, p_filter text, p_search text, p_limit integer, p_offset integer)
returns table (
  invoice_id uuid,
  invoice_number integer,
  status text,
  payment_state text,
  is_overdue boolean,
  bill_to_name text,
  passenger_name text,
  issue_date date,
  due_date date,
  total_cents bigint,
  paid_cents bigint,
  balance_cents bigint,
  trip_count integer,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public._billing_org_today(p_organization_id);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_number integer;
begin
  perform public._billing_require_admin(p_organization_id);
  if v_search is not null and length(v_search) > 100 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_search ~* '^(inv-?)?0*[0-9]{1,9}$' then
    v_number := regexp_replace(v_search, '[^0-9]', '', 'g')::integer;
  end if;
  return query
  with base as (
    select i.*, public._billing_paid_cents(i.id) as paid, p.display_name as pname,
           (select count(*) from public.billing_invoice_trips l where l.invoice_id = i.id)::integer as trips
    from public.billing_invoices i
    join public.passengers p on p.id = i.passenger_id and p.organization_id = i.organization_id
    where i.organization_id = p_organization_id
      and (v_search is null or i.invoice_number = v_number
           or i.bill_to_name ilike '%' || v_search || '%' or p.display_name ilike '%' || v_search || '%')
  ), shaped as (
    select b.*, public._billing_payment_state(b.status, b.total_cents, b.paid) as state,
           (b.status = 'issued' and b.paid < b.total_cents and b.due_date < v_today) as overdue
    from base b
  )
  select s.id, s.invoice_number, s.status, s.state, s.overdue, s.bill_to_name, s.pname, s.issue_date, s.due_date,
         s.total_cents, s.paid, s.total_cents - s.paid, s.trips, s.created_at, count(*) over ()
  from shaped s
  where case coalesce(p_filter, 'all')
          when 'all' then true
          when 'open' then s.state in ('unpaid', 'partially_paid')
          when 'overdue' then s.overdue
          when 'draft' then s.state = 'draft'
          when 'unpaid' then s.state = 'unpaid'
          when 'partially_paid' then s.state = 'partially_paid'
          when 'paid' then s.state = 'paid'
          when 'void' then s.state = 'void'
          else false
        end
  order by s.created_at desc, s.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
comment on function public.billing_list_invoices(uuid, text, text, integer, integer) is
  'NP-BILL-P1. Organization Admin. Invoices with derived paid / balance / state (draft | unpaid | partially_paid | paid | void) and overdue (issued, balance > 0, due date before today in the org timezone). Filters: all | open | overdue | draft | unpaid | partially_paid | paid | void; search by number (INV-12 / 12), bill-to or passenger name. Bounded page + total.';
revoke all on function public.billing_list_invoices(uuid, text, text, integer, integer) from public, anon, service_role;
grant execute on function public.billing_list_invoices(uuid, text, text, integer, integer) to authenticated;

create function public.billing_get_invoice(p_organization_id uuid, p_invoice_id uuid)
returns table (
  invoice_id uuid,
  invoice_number integer,
  status text,
  payment_state text,
  is_overdue boolean,
  passenger_id uuid,
  passenger_name text,
  bill_to_kind text,
  bill_to_name text,
  bill_to_address text,
  bill_to_email text,
  bill_to_phone text,
  source_quote_id uuid,
  source_quote_number integer,
  source_quote_kind text,
  subtotal_cents bigint,
  discount_cents bigint,
  total_cents bigint,
  paid_cents bigint,
  balance_cents bigint,
  currency text,
  issue_date date,
  due_date date,
  terms_note text,
  version integer,
  created_at timestamptz,
  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text
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
  select i.id, i.invoice_number, i.status,
         public._billing_payment_state(i.status, i.total_cents, x.paid),
         (i.status = 'issued' and x.paid < i.total_cents and i.due_date < v_today),
         i.passenger_id, p.display_name, i.bill_to_kind, i.bill_to_name, i.bill_to_address, i.bill_to_email, i.bill_to_phone,
         i.source_quote_id, i.source_quote_number, i.source_quote_kind, i.subtotal_cents, i.discount_cents, i.total_cents,
         x.paid, i.total_cents - x.paid, i.currency, i.issue_date, i.due_date, i.terms_note, i.version, i.created_at,
         i.issued_at, i.voided_at, i.void_reason
  from public.billing_invoices i
  join public.passengers p on p.id = i.passenger_id and p.organization_id = i.organization_id
  cross join lateral (select public._billing_paid_cents(i.id) as paid) x
  where i.id = p_invoice_id and i.organization_id = p_organization_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
end;
$$;
comment on function public.billing_get_invoice(uuid, uuid) is
  'NP-BILL-P1. Organization Admin. One invoice with derived paid / balance / state / overdue (ZW002 unknown or foreign). Lines, trips and payments are read from their tables (RLS: Organization Admins of the same organization).';
revoke all on function public.billing_get_invoice(uuid, uuid) from public, anon, service_role;
grant execute on function public.billing_get_invoice(uuid, uuid) to authenticated;

create function public.billing_trip_status(p_organization_id uuid, p_trip_id uuid)
returns table (billable boolean, invoice_id uuid, invoice_number integer, status text, payment_state text, balance_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_state text;
begin
  perform public._billing_require_admin(p_organization_id);
  select t.state into v_state from public.trips t where t.id = p_trip_id and t.organization_id = p_organization_id;
  if v_state is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select (v_state = 'completed' and i.id is null), i.id, i.invoice_number, i.status,
         case when i.id is null then null else public._billing_payment_state(i.status, i.total_cents, public._billing_paid_cents(i.id)) end,
         case when i.id is null then null else i.total_cents - public._billing_paid_cents(i.id) end
  from (select 1) one
  left join public.billing_invoice_trips l on l.trip_id = p_trip_id and l.released_at is null and l.organization_id = p_organization_id
  left join public.billing_invoices i on i.id = l.invoice_id and i.organization_id = p_organization_id;
end;
$$;
comment on function public.billing_trip_status(uuid, uuid) is
  'NP-BILL-P1. Organization Admin. For Trip Detail: whether the trip can be invoiced (completed, not on a draft / issued invoice) and the invoice it is on, if any (number, status, state, balance).';
revoke all on function public.billing_trip_status(uuid, uuid) from public, anon, service_role;
grant execute on function public.billing_trip_status(uuid, uuid) to authenticated;

create function public.billing_summary(p_organization_id uuid)
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
revoke all on function public.billing_summary(uuid) from public, anon, service_role;
grant execute on function public.billing_summary(uuid) to authenticated;
