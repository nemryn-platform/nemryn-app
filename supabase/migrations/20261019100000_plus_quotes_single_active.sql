-- NP-P2-S5-S2 -- Nemryn Plus Estimates & Quotes: OD-Q12 Option A (owner-approved 2026-10-18, recorded as ZD-221).
--
-- At most ONE active draft and ONE current sent quotation per opportunity. Historical quotations (accepted, declined,
-- superseded, withdrawn) are kept and are NOT restricted. Expiry stays derived: a stored 'sent' quote whose validity has
-- passed still occupies the current-sent slot until an authorized transition changes its stored status.
--
-- What this migration does:
--   1. PREFLIGHT: refuses to run (raises, changes nothing) if any opportunity already has two drafts or two sent quotes.
--      No row is ever deleted, merged or superseded to satisfy the new rule.
--   2. Two partial UNIQUE indexes (organization_id, opportunity_id) WHERE status = 'draft' / 'sent'.
--   3. CREATE OR REPLACE (same signatures, comments and grants) of:
--        plus_create_quote    -- a second draft on the opportunity -> ZW004 draft_exists (idempotent replay unchanged)
--        plus_revise_quote    -- a revision needs the opportunity's draft slot free -> ZW004 draft_exists
--        plus_mark_quote_sent -- a draft that is not the revision of the current sent quote cannot be sent while one is
--                                current -> ZW004 sent_quote_exists. A valid revision still supersedes its predecessor
--                                FIRST (the partial unique index is checked immediately), then becomes sent -- one
--                                transaction.
--      Everything else is unchanged: Plus WRITE first, the lock order (advisory -> opportunity FOR UPDATE -> contact ->
--      quote FOR UPDATE -> counter), optimistic concurrency, immutability, stage advance, audit, no Core side effects.
--      Because every quote writer locks the opportunity FOR UPDATE before checking, concurrent writers on one opportunity
--      serialize and the second one sees the first one's committed row; the indexes are the last-resort backstop, and a
--      backstop violation is still reported as the domain error (never raw constraint text).
-- No table, column, grant, policy or other function changes. The released S1 migration is not modified.

-- =============================================================================
-- 1. Preflight: existing data must already satisfy OD-Q12 (fail safely; never repair data here)
-- =============================================================================
do $$
declare
  v_drafts integer;
  v_sent integer;
begin
  select count(*) into v_drafts from (
    select 1 from public.plus_quotes where status = 'draft' group by organization_id, opportunity_id having count(*) > 1
  ) d;
  select count(*) into v_sent from (
    select 1 from public.plus_quotes where status = 'sent' group by organization_id, opportunity_id having count(*) > 1
  ) s;
  if v_drafts > 0 or v_sent > 0 then
    raise exception 'od_q12_preflight_failed: % opportunit(ies) with more than one draft and % with more than one sent quote; resolve them through the quote RPCs (withdraw / respond) before applying this migration. Nothing was changed.', v_drafts, v_sent
      using errcode = 'P0001';
  end if;
end;
$$;

-- =============================================================================
-- 2. OD-Q12 invariants (partial unique indexes; historical statuses are unrestricted)
-- =============================================================================
create unique index plus_quotes_one_draft_per_opportunity_idx
  on public.plus_quotes (organization_id, opportunity_id) where status = 'draft';
create unique index plus_quotes_one_sent_per_opportunity_idx
  on public.plus_quotes (organization_id, opportunity_id) where status = 'sent';
comment on index public.plus_quotes_one_draft_per_opportunity_idx is
  'NP-P2-S5-S2 / ZD-221 (OD-Q12 A). At most one active draft per opportunity. Withdrawn drafts no longer occupy the slot.';
comment on index public.plus_quotes_one_sent_per_opportunity_idx is
  'NP-P2-S5-S2 / ZD-221 (OD-Q12 A). At most one current sent quote per opportunity (a derived-expired sent quote still counts).';

-- =============================================================================
-- 3. plus_create_quote: one active draft per opportunity
-- =============================================================================
create or replace function public.plus_create_quote(
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
  v_constraint text;
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
  -- OD-Q12 (ZD-221): one active draft per opportunity. Checked after the opportunity lock, so a concurrent create on the
  -- same opportunity waits and then sees the committed draft.
  if exists (select 1 from public.plus_quotes q
             where q.organization_id = p_organization_id and q.opportunity_id = v_opp.id and q.status = 'draft') then
    raise exception 'draft_exists' using errcode = 'ZW004';
  end if;
  perform public._plus_require_active_contact(p_organization_id, v_opp.primary_contact_id);
  v_total := public._plus_quote_validate(p_kind, p_service_type, p_distance_miles, p_base_cents, p_mileage_cents, p_wait_cents,
    p_extra_stops_cents, p_mobility_assistance_cents, p_escort_cents, p_return_leg_cents, p_other_cents, p_other_label,
    p_discount_cents, p_terms_note, p_valid_until, public._plus_org_local_today(p_organization_id));

  begin
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
  exception when unique_violation then
    -- backstop only (the check above runs under the opportunity lock): report the domain error, never constraint text
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'plus_quotes_one_draft_per_opportunity_idx' then
      raise exception 'draft_exists' using errcode = 'ZW004';
    end if;
    raise;
  end;
  perform public._plus_quote_audit(v_q, 'plus_quote_created', null, null);

  v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_opp.stage, v_q.total_cents, v_q.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_create_quote(uuid, uuid, text, text, text, boolean, numeric, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, bigint, text, date) is
  'NP-P2-S5-S1 / S2. Plus WRITE. Creates ONE draft estimate / quote for an OPEN opportunity (active primary contact) of p_organization_id with a per-organization number; prices are staff-entered integer cents and the total is computed here (never accepted from the client). OD-Q12 (ZD-221): at most one active draft per opportunity. Idempotent per (organization, key): the same key for the same opportunity returns the original (changed=false, nothing written); a key used elsewhere -> ZW006. Never changes the opportunity, never writes Core, sends nothing. Errors: ZW001 no write access; ZW002 unknown / foreign opportunity; ZW004 opportunity_closed / draft_exists; ZW006 invalid snapshot or key (or archived contact).';

-- =============================================================================
-- 4. plus_revise_quote: the revision is the opportunity's one active draft
-- =============================================================================
create or replace function public.plus_revise_quote(
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
  v_constraint text;
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
  -- OD-Q12 (ZD-221): the revision becomes the opportunity's one active draft; an unrelated draft must be withdrawn first
  if exists (select 1 from public.plus_quotes q
             where q.organization_id = p_organization_id and q.opportunity_id = v_src.opportunity_id and q.status = 'draft') then
    raise exception 'draft_exists' using errcode = 'ZW004';
  end if;

  begin
    insert into public.plus_quotes (organization_id, opportunity_id, quote_number, kind, service_type, round_trip, distance_miles,
      base_cents, mileage_cents, wait_cents, extra_stops_cents, mobility_assistance_cents, escort_cents, return_leg_cents,
      other_cents, other_label, discount_cents, total_cents, terms_note, valid_until, status, supersedes_quote_id, idempotency_key, created_by)
    values (p_organization_id, v_src.opportunity_id, public._plus_next_quote_number(p_organization_id), v_src.kind, v_src.service_type,
      v_src.round_trip, v_src.distance_miles, v_src.base_cents, v_src.mileage_cents, v_src.wait_cents, v_src.extra_stops_cents,
      v_src.mobility_assistance_cents, v_src.escort_cents, v_src.return_leg_cents, v_src.other_cents, v_src.other_label,
      v_src.discount_cents, v_src.total_cents, v_src.terms_note, v_src.valid_until, 'draft', v_src.id, v_key, auth.uid())
    returning * into v_new;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'plus_quotes_one_draft_per_opportunity_idx' then
      raise exception 'draft_exists' using errcode = 'ZW004';
    end if;
    raise;
  end;
  perform public._plus_quote_audit(v_new, 'plus_quote_created', jsonb_build_object('supersedes_quote_id', v_src.id), null);
  v_result := (v_new.id, v_new.quote_number, v_new.status, v_new.opportunity_id, v_opp.stage, v_new.total_cents, v_new.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_revise_quote(uuid, uuid, text) is
  'NP-P2-S5-S1 / S2. Plus WRITE. Starts a revision of a SENT quote: a NEW draft (new number) copying its snapshot and linked by supersedes_quote_id; the original stays unchanged and is superseded only when the revision is marked sent. At most one live revision per quote, and (OD-Q12, ZD-221) the revision needs the opportunity''s draft slot to be free. Idempotent per (organization, key). Errors: ZW002; ZW004 illegal_transition / revision_exists / draft_exists / opportunity_closed; ZW006 invalid key / key used elsewhere / archived contact.';

-- =============================================================================
-- 5. plus_mark_quote_sent: one current sent quote per opportunity; supersede BEFORE send
-- =============================================================================
create or replace function public.plus_mark_quote_sent(
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
  v_constraint text;
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
  if v_q.supersedes_quote_id is not null then
    -- a revision replaces its predecessor only while that predecessor is still the sent quote. The predecessor is
    -- superseded FIRST: the one-sent-per-opportunity index is checked immediately, row by row.
    v_prev := public._plus_quote_lock(p_organization_id, v_q.supersedes_quote_id);
    if v_prev.status <> 'sent' then
      raise exception 'revision_base_not_current' using errcode = 'ZW004';
    end if;
    update public.plus_quotes set status = 'superseded' where id = v_prev.id returning * into v_prev;
    perform public._plus_quote_audit(v_prev, 'plus_quote_superseded', jsonb_build_object('superseded_by_quote_id', v_q.id), null);
  elsif exists (select 1 from public.plus_quotes s
                where s.organization_id = p_organization_id and s.opportunity_id = v_q.opportunity_id and s.status = 'sent') then
    -- OD-Q12 (ZD-221): an independent draft never competes with, or silently replaces, the current sent quote
    raise exception 'sent_quote_exists' using errcode = 'ZW004';
  end if;

  begin
    update public.plus_quotes set status = 'sent', sent_at = now(), sent_by = auth.uid() where id = v_q.id returning * into v_q;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'plus_quotes_one_sent_per_opportunity_idx' then
      raise exception 'sent_quote_exists' using errcode = 'ZW004';
    end if;
    raise;
  end;
  v_stage := public._plus_quote_advance_stage(v_opp, 'quote_sent');
  perform public._plus_quote_audit(v_q, 'plus_quote_sent',
    jsonb_build_object('opportunity_stage_before', v_opp.stage, 'opportunity_stage_after', v_stage), null);
  v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_stage, v_q.total_cents, v_q.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_mark_quote_sent(uuid, uuid, timestamptz) is
  'NP-P2-S5-S1 / S2. Plus WRITE. Records that STAFF shared a draft (Nemryn sends nothing; not proof of delivery). Freezes the snapshot; a revision first supersedes its predecessor (which must still be the sent quote), then becomes sent; an independent draft cannot be sent while the opportunity has a current sent quote (OD-Q12, ZD-221); advances an open opportunity in new_inquiry / contacted / qualified to quote_sent (never regresses) -- one transaction. Already sent -> changed=false. Errors: ZW002; ZW003 stale; ZW004 illegal_transition / quote_expired / revision_base_not_current / sent_quote_exists / opportunity_closed.';

notify pgrst, 'reload schema';
