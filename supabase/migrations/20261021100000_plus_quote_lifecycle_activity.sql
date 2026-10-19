-- NP-P2-S5-S3B -- Nemryn Plus Estimates & Quotes: lifecycle events on the Growth timeline (OD-Q15 = A, ZD-222) and the
-- server-enforced do-not-contact acknowledgment for Mark sent (OD-Q16 = A, ZD-223).
--
-- 1. plus_activities gains a nullable, TENANT-SCOPED quote reference:
--      quote_id     -> composite FK (quote_id, organization_id, opportunity_id) -> plus_quotes (id, organization_id,
--                      opportunity_id): a quote activity can never point at another organization's or another
--                      opportunity's quote;
--      quote_status -> the lifecycle status the EVENT produced (the quote's own status changes later; the event doesn't).
--    Event types (the activity_type CHECK is widened additively with ONE new type):
--      quote_sent           -- staff marked a draft sent                                  quote_status = 'sent'
--      quote_status_changed -- accepted / declined recorded, superseded by a sent revision,
--                              or a SENT quote withdrawn                                  quote_status = that status
--      quote_revised (new)  -- a revision draft was created from a sent quote             quote_status = 'draft'
--    Quote events carry NO body (no prices, terms, reasons, medical or contact details are copied); they require
--    opportunity_id and quote_id; contact_id is the opportunity's primary contact at the time of the event (checked by
--    the guard trigger), so the event also appears on the Contact's timeline. Existing rows have no quote_id and stay
--    valid (no backfill). Draft creation / edits / draft withdrawal are work in progress and write no timeline event.
-- 2. The quote write RPCs insert their timeline event in the SAME transaction as the transition, only when a transition
--    actually happens (idempotent no-ops and refusals write nothing):
--      plus_mark_quote_sent  -- DROP + CREATE with one trailing parameter p_dnc_acknowledged boolean DEFAULT false
--                               (exactly one function; existing 3-argument calls resolve to it unchanged).
--                               OD-Q16: the CURRENT stored do_not_contact flag of the opportunity's primary contact is
--                               read under a FOR SHARE lock (after the opportunity lock, the established order); when it
--                               is true and p_dnc_acknowledged is not true -> ZW004 dnc_acknowledgment_required and
--                               nothing is written. The acknowledgment is recorded in the plus_quote_sent audit row
--                               (contact_do_not_contact, dnc_acknowledged) -- a STAFF acknowledgment, never consent; the
--                               contact record is not modified and nothing is sent.
--      plus_record_quote_response, plus_revise_quote, plus_withdraw_quote -- CREATE OR REPLACE (same signatures).
-- 3. plus_list_contact_activities / plus_list_opportunity_activities / plus_list_recent_activities are re-created (DROP +
--    CREATE: the return type gains quote_id, quote_number, quote_kind, quote_status, related_quote_number). Same
--    arguments, authorization, ordering, SECURITY DEFINER, search_path and grants; existing callers keep working (extra
--    columns are ignored).
-- No table grant, policy or RLS change; no Core object is touched; the released S1 / S2 / S3A migrations are unchanged.
-- LOCK ORDER (unchanged): advisory(key) -> plus_opportunities FOR UPDATE -> plus_contacts (FOR NO KEY UPDATE / FOR SHARE)
-- -> plus_quotes FOR UPDATE -> counter.

-- =============================================================================
-- 1. plus_activities: quote reference + event contract
-- =============================================================================
alter table public.plus_activities
  add column quote_id uuid,
  add column quote_status text;
comment on column public.plus_activities.quote_id is
  'NP-P2-S5-S3B / ZD-222. The quote a quote lifecycle event is about (quote_sent / quote_status_changed / quote_revised); NULL for every other activity. Composite FK (quote_id, organization_id, opportunity_id): never another tenant''s or opportunity''s quote.';
comment on column public.plus_activities.quote_status is
  'NP-P2-S5-S3B / ZD-222. The quote status the EVENT produced (sent / accepted / declined / superseded / withdrawn / draft for a revision). Staff-recorded, never proof of delivery or customer acceptance.';

alter table public.plus_activities
  add constraint plus_activities_quote_fkey
  foreign key (quote_id, organization_id, opportunity_id) references public.plus_quotes (id, organization_id, opportunity_id);

alter table public.plus_activities drop constraint plus_activities_activity_type_check;
alter table public.plus_activities
  add constraint plus_activities_activity_type_check check (
    activity_type in ('note', 'call_logged', 'email_logged', 'meeting_logged', 'owner_changed', 'record_archived', 'stage_changed',
                      'request_linked', 'attribution_changed', 'quote_sent', 'quote_status_changed', 'quote_revised')
  );

-- quote events: opportunity + quote + the produced status, and NO free text; every other type: no quote fields
alter table public.plus_activities drop constraint plus_activities_quote_subject_check;
alter table public.plus_activities
  add constraint plus_activities_quote_subject_check check (
    (activity_type in ('quote_sent', 'quote_status_changed', 'quote_revised')
       and opportunity_id is not null and quote_id is not null and body is null
       and ((activity_type = 'quote_sent' and quote_status = 'sent')
         or (activity_type = 'quote_status_changed' and quote_status in ('accepted', 'declined', 'superseded', 'withdrawn'))
         or (activity_type = 'quote_revised' and quote_status = 'draft')))
    or (activity_type not in ('quote_sent', 'quote_status_changed', 'quote_revised') and quote_id is null and quote_status is null)
  );

-- the contact of a quote event is the opportunity's primary contact at the time of the event (defence in depth: only
-- SECURITY DEFINER writers insert activities; no client has an INSERT privilege)
create function public._plus_activities_quote_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- a missing opportunity / quote is the CHECK constraint's job (it reports a check_violation); this guard only
  -- verifies the contact of an otherwise well-formed quote event
  if new.activity_type in ('quote_sent', 'quote_status_changed', 'quote_revised') and new.opportunity_id is not null and new.quote_id is not null then
    if not exists (select 1 from public.plus_opportunities o
                   where o.id = new.opportunity_id and o.organization_id = new.organization_id
                     and o.primary_contact_id is not distinct from new.contact_id) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;
  return new;
end;
$$;
comment on function public._plus_activities_quote_guard() is
  'NP-P2-S5-S3B. INTERNAL trigger: a quote lifecycle activity''s contact_id must be its opportunity''s primary contact (same organization) at insert time.';
revoke all on function public._plus_activities_quote_guard() from public, anon, authenticated, service_role;
create trigger plus_activities_quote_guard
  before insert on public.plus_activities
  for each row execute function public._plus_activities_quote_guard();

-- =============================================================================
-- 2. Internal: one quote timeline event (ids, type, produced status, actor -- nothing else)
-- =============================================================================
create function public._plus_quote_activity(p_opp public.plus_opportunities, p_quote_id uuid, p_type text, p_status text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.plus_activities (organization_id, contact_id, opportunity_id, quote_id, activity_type, quote_status, body, actor_user_id)
  values (p_opp.organization_id, p_opp.primary_contact_id, p_opp.id, p_quote_id, p_type, p_status, null, auth.uid());
$$;
comment on function public._plus_quote_activity(public.plus_opportunities, uuid, text, text) is
  'NP-P2-S5-S3B / ZD-222. INTERNAL. Writes ONE quote lifecycle timeline event for the locked opportunity (contact = its primary contact) in the caller''s transaction. No prices, terms, reasons or other free text.';
revoke all on function public._plus_quote_activity(public.plus_opportunities, uuid, text, text) from public, anon, authenticated, service_role;

-- =============================================================================
-- 3. plus_mark_quote_sent: OD-Q16 acknowledgment + timeline events (DROP + CREATE: one trailing defaulted parameter)
-- =============================================================================
drop function public.plus_mark_quote_sent(uuid, uuid, timestamptz);
create function public.plus_mark_quote_sent(
  p_organization_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz,
  p_dnc_acknowledged boolean default false
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
  v_dnc boolean;
  v_result public.plus_quote_write_result;
  v_constraint text;
begin
  perform public._require_plus_write(p_organization_id);
  v_opp := public._plus_quote_lock_open_opportunity(p_organization_id, public._plus_quote_opportunity(p_organization_id, p_quote_id));
  -- OD-Q16: the CURRENT stored preference, read under a share lock (a concurrent preference change waits or is waited on)
  select c.do_not_contact into v_dnc from public.plus_contacts c
  where c.id = v_opp.primary_contact_id and c.organization_id = p_organization_id
  for share;
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
  -- OD-Q16 (ZD-223): a do-not-contact contact requires the staff member's explicit acknowledgment; nothing is written
  if coalesce(v_dnc, false) and p_dnc_acknowledged is not true then
    raise exception 'dnc_acknowledgment_required' using errcode = 'ZW004';
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
    perform public._plus_quote_activity(v_opp, v_prev.id, 'quote_status_changed', 'superseded');
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
  perform public._plus_quote_activity(v_opp, v_q.id, 'quote_sent', 'sent');
  v_stage := public._plus_quote_advance_stage(v_opp, 'quote_sent');
  perform public._plus_quote_audit(v_q, 'plus_quote_sent',
    jsonb_build_object('opportunity_stage_before', v_opp.stage, 'opportunity_stage_after', v_stage,
                       'contact_do_not_contact', coalesce(v_dnc, false),
                       'dnc_acknowledged', coalesce(v_dnc, false) and p_dnc_acknowledged is true), null);
  v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_stage, v_q.total_cents, v_q.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_mark_quote_sent(uuid, uuid, timestamptz, boolean) is
  'NP-P2-S5-S1 / S2 / S3B. Plus WRITE. Records that STAFF shared a draft outside Nemryn (Nemryn sends nothing; not proof of delivery). OD-Q16 (ZD-223): when the opportunity''s contact is do-not-contact (current stored flag, read under lock) the staff member must pass p_dnc_acknowledged = true, else ZW004 dnc_acknowledgment_required and nothing is written; the acknowledgment is audited (never consent; the contact is not changed). Freezes the snapshot; a revision first supersedes its predecessor (which must still be the sent quote), then becomes sent; an independent draft cannot be sent while the opportunity has a current sent quote (OD-Q12); advances an open opportunity in new_inquiry / contacted / qualified to quote_sent; writes the quote_sent (and superseded) timeline events (ZD-222) -- one transaction. Already sent -> changed=false, nothing written. Errors: ZW002; ZW003 stale; ZW004 illegal_transition / quote_expired / dnc_acknowledgment_required / revision_base_not_current / sent_quote_exists / opportunity_closed.';
revoke all on function public.plus_mark_quote_sent(uuid, uuid, timestamptz, boolean) from public, anon, service_role;
grant execute on function public.plus_mark_quote_sent(uuid, uuid, timestamptz, boolean) to authenticated;

-- =============================================================================
-- 4. plus_record_quote_response: + timeline event (same signature)
-- =============================================================================
create or replace function public.plus_record_quote_response(
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
  perform public._plus_quote_activity(v_opp, v_q.id, 'quote_status_changed', p_response);
  v_stage := case when p_response = 'accepted' then public._plus_quote_advance_stage(v_opp, 'quote_accepted') else v_opp.stage end;
  perform public._plus_quote_audit(v_q, case when p_response = 'accepted' then 'plus_quote_accepted' else 'plus_quote_declined' end,
    jsonb_build_object('opportunity_stage_before', v_opp.stage, 'opportunity_stage_after', v_stage), null);
  v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_stage, v_q.total_cents, v_q.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_record_quote_response(uuid, uuid, timestamptz, text) is
  'NP-P2-S5-S1 / S3B. Plus WRITE. Records the customer''s response AS REPORTED BY STAFF (not verified acceptance) on a sent, not-expired quote: accepted advances an open opportunity (not yet quote_accepted) to quote_accepted; declined changes no stage (staff decide Lost). Writes the quote_status_changed timeline event (ZD-222). Never converts, never writes Core, payments or tasks. Same response again -> changed=false, nothing written. Errors: ZW002; ZW003 stale; ZW004 illegal_transition / quote_expired / opportunity_closed; ZW006 response not accepted|declined.';

-- =============================================================================
-- 5. plus_revise_quote: + quote_revised timeline event (same signature)
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
  perform public._plus_quote_activity(v_opp, v_new.id, 'quote_revised', 'draft');
  v_result := (v_new.id, v_new.quote_number, v_new.status, v_new.opportunity_id, v_opp.stage, v_new.total_cents, v_new.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_revise_quote(uuid, uuid, text) is
  'NP-P2-S5-S1 / S2 / S3B. Plus WRITE. Starts a revision of a SENT quote: a NEW draft (new number) copying its snapshot and linked by supersedes_quote_id; the original stays unchanged and is superseded only when the revision is marked sent. At most one live revision per quote, and (OD-Q12) the revision needs the opportunity''s draft slot to be free. Writes the quote_revised timeline event (ZD-222). Idempotent per (organization, key): a replay returns the same revision and writes nothing. Errors: ZW002; ZW004 illegal_transition / revision_exists / draft_exists / opportunity_closed; ZW006 invalid key / key used elsewhere / archived contact.';

-- =============================================================================
-- 6. plus_withdraw_quote: + timeline event for a SENT withdrawal (same signature)
-- =============================================================================
create or replace function public.plus_withdraw_quote(
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
  v_was_sent boolean;
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
  v_was_sent := v_q.status = 'sent';
  if v_was_sent and v_reason is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  update public.plus_quotes set status = 'withdrawn', withdrawn_reason = v_reason where id = v_q.id returning * into v_q;
  perform public._plus_quote_audit(v_q, 'plus_quote_withdrawn', jsonb_build_object('was_sent', v_q.sent_at is not null), v_reason);
  -- the timeline shows a SENT quote's withdrawal (never the reason); a discarded draft is work in progress
  if v_was_sent then
    perform public._plus_quote_activity(v_opp, v_q.id, 'quote_status_changed', 'withdrawn');
  end if;
  v_result := (v_q.id, v_q.quote_number, v_q.status, v_q.opportunity_id, v_opp.stage, v_q.total_cents, v_q.updated_at, true);
  return v_result;
end;
$$;
comment on function public.plus_withdraw_quote(uuid, uuid, timestamptz, text) is
  'NP-P2-S5-S1 / S3B. Plus WRITE. Withdraws a draft (reason optional) or a sent quote (reason required, <= 200; the reason is kept on the quote and its audit row, never on the timeline). The row is kept as history (never deleted); no stage changes. A sent withdrawal writes the quote_status_changed timeline event (ZD-222). Already withdrawn -> changed=false, nothing written. Errors: ZW002; ZW003 stale; ZW004 illegal_transition / opportunity_closed; ZW006 missing / long reason.';

-- The other quote an event refers to: a revision event -> the quote it revises; a superseded event -> the revision that
-- replaced it (the successor that was sent). NULL otherwise. Numbers only.
create function public._plus_quote_related_number(p_quote public.plus_quotes, p_event_status text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_quote.id is null then null
    when p_event_status = 'draft' and p_quote.supersedes_quote_id is not null then
      (select p.quote_number from public.plus_quotes p where p.id = p_quote.supersedes_quote_id and p.organization_id = p_quote.organization_id)
    when p_event_status = 'superseded' then
      (select s.quote_number from public.plus_quotes s
       where s.supersedes_quote_id = p_quote.id and s.organization_id = p_quote.organization_id and s.sent_at is not null
       order by s.sent_at limit 1)
  end;
$$;
comment on function public._plus_quote_related_number(public.plus_quotes, text) is
  'NP-P2-S5-S3B. INTERNAL. For timeline display: the number of the quote a revision revises, or of the sent revision that superseded a quote.';
revoke all on function public._plus_quote_related_number(public.plus_quotes, text) from public, anon, authenticated, service_role;

-- =============================================================================
-- 7. Timeline reads: the same functions, now also returning the quote reference (DROP + CREATE; same arguments / ACL)
-- =============================================================================
drop function public.plus_list_contact_activities(uuid, uuid, integer, integer);
create function public.plus_list_contact_activities(
  p_organization_id uuid,
  p_contact_id uuid,
  p_limit integer,
  p_offset integer
)
returns table (
  activity_id uuid,
  activity_type text,
  body text,
  actor_name text,
  occurred_at timestamptz,
  recorded_at timestamptz,
  total_count bigint,
  opportunity_id uuid,
  quote_id uuid,
  quote_number integer,
  quote_kind text,
  quote_status text,
  related_quote_number integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_limit < 1 or v_limit > 100 or v_offset < 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not exists (select 1 from public.plus_contacts c
                 where c.id = p_contact_id and c.organization_id = p_organization_id and c.status <> 'redacted') then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select a.id, a.activity_type, a.body, public._plus_staff_name(a.actor_user_id), a.occurred_at, a.recorded_at, count(*) over (),
         a.opportunity_id, a.quote_id, q.quote_number, q.kind, a.quote_status, public._plus_quote_related_number(q, a.quote_status)
  from public.plus_activities a
  left join public.plus_quotes q on q.id = a.quote_id and q.organization_id = a.organization_id
  where a.organization_id = p_organization_id and a.contact_id = p_contact_id
  order by a.occurred_at desc, a.recorded_at desc, a.id
  limit v_limit offset v_offset;
end;
$$;

drop function public.plus_list_opportunity_activities(uuid, uuid, integer, integer);
create function public.plus_list_opportunity_activities(
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_limit integer,
  p_offset integer
)
returns table (
  activity_id uuid,
  activity_type text,
  from_stage text,
  to_stage text,
  body text,
  actor_name text,
  occurred_at timestamptz,
  recorded_at timestamptz,
  total_count bigint,
  quote_id uuid,
  quote_number integer,
  quote_kind text,
  quote_status text,
  related_quote_number integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_limit < 1 or v_limit > 100 or v_offset < 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not exists (select 1 from public.plus_opportunities o where o.id = p_opportunity_id and o.organization_id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select a.id, a.activity_type, a.from_stage, a.to_stage, a.body, public._plus_staff_name(a.actor_user_id), a.occurred_at, a.recorded_at,
         count(*) over (), a.quote_id, q.quote_number, q.kind, a.quote_status, public._plus_quote_related_number(q, a.quote_status)
  from public.plus_activities a
  left join public.plus_quotes q on q.id = a.quote_id and q.organization_id = a.organization_id
  where a.organization_id = p_organization_id and a.opportunity_id = p_opportunity_id
  order by a.occurred_at desc, a.recorded_at desc, a.id
  limit v_limit offset v_offset;
end;
$$;

drop function public.plus_list_recent_activities(uuid, integer);
create function public.plus_list_recent_activities(
  p_organization_id uuid,
  p_limit integer
)
returns table (
  activity_id uuid,
  activity_type text,
  from_stage text,
  to_stage text,
  contact_id uuid,
  contact_name text,
  opportunity_id uuid,
  opportunity_title text,
  actor_name text,
  occurred_at timestamptz,
  quote_id uuid,
  quote_number integer,
  quote_kind text,
  quote_status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := coalesce(p_limit, 10);
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  return query
  select a.id, a.activity_type, a.from_stage, a.to_stage,
         coalesce(a.contact_id, o.primary_contact_id), coalesce(c.display_name, oc.display_name),
         a.opportunity_id, o.title, public._plus_staff_name(a.actor_user_id), a.occurred_at,
         a.quote_id, q.quote_number, q.kind, a.quote_status
  from public.plus_activities a
  left join public.plus_contacts c on c.id = a.contact_id and c.organization_id = a.organization_id
  left join public.plus_opportunities o on o.id = a.opportunity_id and o.organization_id = a.organization_id
  left join public.plus_contacts oc on oc.id = o.primary_contact_id and oc.organization_id = o.organization_id
  left join public.plus_quotes q on q.id = a.quote_id and q.organization_id = a.organization_id
  where a.organization_id = p_organization_id
    and coalesce(c.status, oc.status, 'active') <> 'redacted'
  order by a.occurred_at desc, a.recorded_at desc, a.id
  limit v_limit;
end;
$$;

comment on function public.plus_list_contact_activities(uuid, uuid, integer, integer) is
  'NP-P1-S4 / NP-P2-S5-S3B. Plus READ. The contact''s timeline, newest first (1-100 per page, default 50), incl. quote lifecycle events (ZD-222) with the quote reference (id, number, kind, event status, related number) -- never quote prices. ZW002 for no access or a foreign / unknown contact.';
revoke all on function public.plus_list_contact_activities(uuid, uuid, integer, integer) from public, anon, service_role;
grant execute on function public.plus_list_contact_activities(uuid, uuid, integer, integer) to authenticated;

comment on function public.plus_list_opportunity_activities(uuid, uuid, integer, integer) is
  'NP-P2-S1 / NP-P2-S5-S3B. Plus READ. The opportunity''s history (stage changes with from / to stage, owner changes, quote lifecycle events with their quote reference), newest first. ZW002 for no access or a foreign / unknown opportunity.';
revoke all on function public.plus_list_opportunity_activities(uuid, uuid, integer, integer) from public, anon, service_role;
grant execute on function public.plus_list_opportunity_activities(uuid, uuid, integer, integer) to authenticated;

comment on function public.plus_list_recent_activities(uuid, integer) is
  'NP-P2-S2 / NP-P2-S5-S3B. Plus READ. The 1-50 most recent Plus activity entries (logged interactions, stage / owner changes, archives, quote lifecycle events) of the caller''s organization with their contact / opportunity names, actor and quote reference. Activity bodies and quote prices are not returned.';
revoke all on function public.plus_list_recent_activities(uuid, integer) from public, anon, service_role;
grant execute on function public.plus_list_recent_activities(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
