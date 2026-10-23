-- NP-P2-S6-A -- Nemryn Plus communication consent ledger (database foundation).
--
-- Canonical design: docs/product/NP-P2-S6-consent-ledger-design.md (APPROVED); decisions ZD-228 .. ZD-242
-- (docs/product/decision-register.md); docs/product/plus-domain-model.md section 12; docs/security/plus-access-model.md
-- sections 3.2, 6 and 8 (T20, T33).
--
-- WHAT (additive; references only Core and earlier Plus objects -- no forward FK):
--   1. plus_communication_consents  -- append-only ledger of what a person told the organization about being contacted:
--                                      one row per grant / revocation for (contact, channel, purpose). Recording only:
--                                      nothing here sends, schedules, calls or decides whether a message is lawful.
--   2. internal helpers             -- _plus_consent_address_digest (R1), _plus_effective_consent (resolver for NP-P4;
--                                      no client EXECUTE), _plus_append_consent (shared write body),
--                                      _plus_consents_revoke_for_dnc (ZD-233 step), _plus_consents_append_only (trigger).
--   3. RPCs                         -- plus_get_contact_consents / plus_list_contact_consent_events (Plus read),
--                                      plus_record_consent / plus_revoke_consent (Plus write).
--   4. plus_update_contact          -- BODY replaced (same signature, grant, authorization, version token, archived rule,
--                                      audit and owner logic). The only addition: switching do_not_contact from false to
--                                      true appends one system revocation per currently granted pair (ZD-233).
--
-- ACCESS (ZD-239, ZD-240): RLS on; one SELECT policy plus_can_read(organization_id); authenticated holds COLUMN-level
-- SELECT on every column except address_digest and idempotency_key (no table-level SELECT); no insert / update / delete /
-- truncate for any client role. Writes only through the RPCs, which call _require_plus_write first (read_only -> ZW001
-- for grants AND revocations; no bypass). No service-role path.
--
-- APPEND-ONLY (T20): no function updates or deletes a consent row; row and statement triggers refuse UPDATE, DELETE and
-- TRUNCATE for every role, including the owner. No retention or erasure procedure exists (PD-11 open).
--
-- ORDERING (ZD-231): seq is an identity allocated at INSERT, after the per-contact lock (consent writes take FOR NO KEY
-- UPDATE, plus_update_contact takes FOR UPDATE; these conflict), so for one contact seq order is the serialized write
-- order. The recorded state is the highest-seq row per (contact, channel, purpose).
--
-- ADDRESS DIGEST (ZD-232, refinement R1): sha256('nemryn.plus.consent-address.v1|' || org || '|' || kind || '|' ||
-- normalized) in lowercase hex. Domain-separated by organization (no cross-tenant equality) and versioned. It is NOT
-- anonymisation: a phone digest is reversible by enumeration. It only detects a changed address.
--
-- AUDIT: one audit_events row per appended consent row (plus_consent_granted / plus_consent_revoked) with the consent id,
-- channel, purpose, method and correction flag -- never the note, address, digest or idempotency key. No plus_activities
-- row is written (ZD-236).
--
-- PRIVACY: synthetic data only until PD-10 (HIPAA / BAA) and PD-11 (retention / erasure) are resolved (ZD-241).

-- =============================================================================
-- 1. plus_communication_consents
-- =============================================================================
create table public.plus_communication_consents (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  contact_id uuid not null,
  seq bigint generated always as identity,
  channel text not null,
  purpose text not null,
  status text not null,
  captured_via text not null,
  captured_at timestamptz not null,
  address_digest text,
  evidence_note text,
  corrects_consent_id uuid,
  consent_text_version text,
  idempotency_key text not null,
  recorded_by uuid not null references auth.users (id),
  recorded_at timestamptz not null default now(),
  constraint plus_consents_id_organization_id_key unique (id, organization_id),
  constraint plus_consents_id_organization_contact_key unique (id, organization_id, contact_id),
  constraint plus_consents_seq_key unique (seq),
  constraint plus_consents_idempotency_key unique (organization_id, idempotency_key),
  constraint plus_consents_contact_fkey
    foreign key (contact_id, organization_id) references public.plus_contacts (id, organization_id),
  -- a correction always targets an earlier row of the SAME organization and contact
  constraint plus_consents_corrects_fkey
    foreign key (corrects_consent_id, organization_id, contact_id)
    references public.plus_communication_consents (id, organization_id, contact_id),
  constraint plus_consents_channel_check check (channel in ('email', 'sms', 'voice')),
  constraint plus_consents_purpose_check check (purpose in ('service_followup', 'marketing')),
  constraint plus_consents_status_check check (status in ('granted', 'revoked')),
  -- P2-S7 replaces this named constraint to add 'web_form'
  constraint plus_consents_captured_via_check check (
    captured_via in ('verbal_phone', 'in_person', 'written', 'email_reply', 'do_not_contact')
  ),
  constraint plus_consents_digest_format_check check (address_digest is null or address_digest ~ '^[0-9a-f]{64}$'),
  constraint plus_consents_granted_address_check check (status <> 'granted' or address_digest is not null),
  constraint plus_consents_dnc_check check (
    captured_via <> 'do_not_contact' or (status = 'revoked' and corrects_consent_id is null)
  ),
  constraint plus_consents_note_check check (
    evidence_note is null or (evidence_note = btrim(evidence_note) and length(evidence_note) between 1 and 500)
  ),
  constraint plus_consents_correction_note_check check (corrects_consent_id is null or evidence_note is not null),
  constraint plus_consents_not_self_check check (corrects_consent_id is distinct from id),
  constraint plus_consents_captured_check check (captured_at <= recorded_at + interval '5 minutes'),
  -- reserved for P2-S7 (web_form); replaced there by "required iff web_form"
  constraint plus_consents_text_version_check check (consent_text_version is null),
  constraint plus_consents_idempotency_format_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$')
);

comment on table public.plus_communication_consents is
  'NP-P2-S6-A (ZD-228). TENANT-OWNED, APPEND-ONLY Nemryn Plus consent ledger: what a person told the organization about being contacted, per (contact, channel, purpose). Recording only -- nothing sends, and "consent on record" is never a legal permission to contact. Recorded state = highest seq per pair. SELECT via RLS plus_can_read(organization_id) on every column except address_digest / idempotency_key; rows are written only by plus_record_consent / plus_revoke_consent / the plus_update_contact DNC step and are never updated, deleted or truncated (triggers).';
comment on column public.plus_communication_consents.seq is
  'Server-assigned ordering key, allocated at INSERT after the per-contact lock: for one contact, seq order equals the serialized write order (ZD-231).';
comment on column public.plus_communication_consents.captured_at is
  'When the person gave or withdrew consent (staff-declared, within the last 366 days). Never used for ordering.';
comment on column public.plus_communication_consents.address_digest is
  'Grants only. Domain-separated SHA-256 of the normalized address the consent was given for (ZD-232). NOT anonymisation; not readable by clients (ZD-240).';
comment on column public.plus_communication_consents.captured_via is
  'Staff methods verbal_phone / in_person / written / email_reply; do_not_contact = system revocation written when Do not contact was switched on (ZD-233); never corrected.';

create index plus_consents_org_contact_pair_idx
  on public.plus_communication_consents (organization_id, contact_id, channel, purpose, seq desc);
create index plus_consents_org_contact_seq_idx
  on public.plus_communication_consents (organization_id, contact_id, seq desc);

-- Append-only guard (T20): refuses every UPDATE / DELETE / TRUNCATE, for every role including the owner.
create function public._plus_consents_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'append_only' using errcode = 'ZW004';
end;
$$;
comment on function public._plus_consents_append_only() is
  'NP-P2-S6-A. INTERNAL trigger: plus_communication_consents is append-only; every UPDATE, DELETE and TRUNCATE raises ZW004 append_only.';
revoke all on function public._plus_consents_append_only() from public, anon, authenticated, service_role;

create trigger plus_consents_append_only
  before update or delete on public.plus_communication_consents
  for each row execute function public._plus_consents_append_only();
create trigger plus_consents_no_truncate
  before truncate on public.plus_communication_consents
  for each statement execute function public._plus_consents_append_only();

alter table public.plus_communication_consents enable row level security;
revoke all on table public.plus_communication_consents from public, anon, authenticated, service_role;
-- column-level SELECT only: address_digest and idempotency_key are never client-readable (ZD-240)
grant select (id, organization_id, contact_id, seq, channel, purpose, status, captured_via, captured_at, evidence_note,
              corrects_consent_id, consent_text_version, recorded_by, recorded_at)
  on table public.plus_communication_consents to authenticated;
create policy plus_communication_consents_select_plus on public.plus_communication_consents
  for select to authenticated
  using (public.plus_can_read(organization_id));

-- =============================================================================
-- 2. internal helpers
-- =============================================================================
create function public._plus_consent_address_digest(p_organization_id uuid, p_channel text, p_phone text, p_email text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_organization_id is null or n.v is null then null
    else encode(sha256(convert_to('nemryn.plus.consent-address.v1|' || p_organization_id::text || '|' || n.kind || '|' || n.v, 'UTF8')), 'hex')
  end
  from (
    select case when p_channel = 'email' then 'email' when p_channel in ('sms', 'voice') then 'phone' end as kind,
           case when p_channel = 'email' then nullif(lower(btrim(p_email)), '')
                when p_channel in ('sms', 'voice') then nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '')
           end as v
  ) n;
$$;
comment on function public._plus_consent_address_digest(uuid, text, text, text) is
  'NP-P2-S6-A. INTERNAL (ZD-232, R1). Lowercase-hex SHA-256 of ''nemryn.plus.consent-address.v1|<org>|<email|phone>|<normalized>'' (email lower-cased and trimmed; phone digits only); NULL when there is no address for the channel. Detects a changed address only -- NOT anonymisation.';
revoke all on function public._plus_consent_address_digest(uuid, text, text, text) from public, anon, authenticated, service_role;

-- The effective-consent resolver (design section 3 B). Internal: no client EXECUTE; NP-P4's send check will call it.
create function public._plus_effective_consent(p_organization_id uuid, p_contact_id uuid, p_channel text, p_purpose text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact public.plus_contacts%rowtype;
  v_latest public.plus_communication_consents%rowtype;
begin
  if p_channel is null or p_channel not in ('email', 'sms', 'voice')
     or p_purpose is null or p_purpose not in ('service_followup', 'marketing') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  select * into v_contact from public.plus_contacts
  where id = p_contact_id and organization_id = p_organization_id;
  if not found or v_contact.status = 'redacted' then
    return 'not_found';
  end if;
  if v_contact.status = 'archived' then
    return 'suppressed_archived';
  end if;
  if v_contact.do_not_contact then
    return 'suppressed_do_not_contact';
  end if;
  select * into v_latest from public.plus_communication_consents
  where organization_id = p_organization_id and contact_id = p_contact_id and channel = p_channel and purpose = p_purpose
  order by seq desc
  limit 1;
  if not found or v_latest.status <> 'granted' then
    return 'no_consent_on_record';
  end if;
  if v_latest.address_digest is distinct from
     public._plus_consent_address_digest(p_organization_id, p_channel, v_contact.phone, v_contact.email)
     or public._plus_consent_address_digest(p_organization_id, p_channel, v_contact.phone, v_contact.email) is null then
    return 'address_changed';
  end if;
  return 'consent_on_record';
end;
$$;
comment on function public._plus_effective_consent(uuid, uuid, text, text) is
  'NP-P2-S6-A. INTERNAL resolver (no client EXECUTE). First match wins: not_found (unknown / foreign / redacted contact) | suppressed_archived | suppressed_do_not_contact (overrides every grant) | no_consent_on_record (no row, or latest row revoked) | address_changed (latest grant was for another address) | consent_on_record. Read-time, no cache. consent_on_record is NOT legal permission to contact.';
revoke all on function public._plus_effective_consent(uuid, uuid, text, text) from public, anon, authenticated, service_role;

create type public.plus_consent_write_result as (
  consent_id uuid,
  changed boolean,
  recorded_status text,
  effective_status text
);
comment on type public.plus_consent_write_result is
  'NP-P2-S6-A. Result of plus_record_consent / plus_revoke_consent. changed=false: idempotent replay of the same key (nothing written). effective_status is the resolver result after the call.';

-- Shared body of plus_record_consent / plus_revoke_consent (design section 4.3). p_status is fixed by the caller RPC,
-- never by the browser. actor, times, seq and digest are server-set.
create function public._plus_append_consent(
  p_status text,
  p_organization_id uuid,
  p_contact_id uuid,
  p_channel text,
  p_purpose text,
  p_captured_via text,
  p_captured_at timestamptz,
  p_evidence_note text,
  p_corrects_consent_id uuid,
  p_idempotency_key text
)
returns public.plus_consent_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_note text := nullif(btrim(p_evidence_note), '');
  v_at timestamptz := coalesce(p_captured_at, now());
  v_contact public.plus_contacts%rowtype;
  v_existing public.plus_communication_consents%rowtype;
  v_latest public.plus_communication_consents%rowtype;
  v_last_revoke_at timestamptz;
  v_digest text;
  v_id uuid;
  v_result public.plus_consent_write_result;
begin
  perform public._require_plus_write(p_organization_id);
  v_key := public._plus_require_idempotency_key(p_idempotency_key);
  if p_status not in ('granted', 'revoked')
     or p_channel is null or p_channel not in ('email', 'sms', 'voice')
     or p_purpose is null or p_purpose not in ('service_followup', 'marketing')
     -- staff methods only: do_not_contact is system-written; web_form arrives with P2-S7
     or p_captured_via is null or p_captured_via not in ('verbal_phone', 'in_person', 'written', 'email_reply')
     or v_at > now() + interval '5 minutes' or v_at < now() - interval '366 days'
     or (v_note is not null and length(v_note) > 500)
     or (p_corrects_consent_id is not null and v_note is null) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Serializes every consent write on this contact (and waits for an in-flight plus_update_contact, which holds FOR
  -- UPDATE). In READ COMMITTED the row returned after a wait is the committed new version, so a DNC switch-on that
  -- committed first is seen here.
  select * into v_contact from public.plus_contacts
  where id = p_contact_id and organization_id = p_organization_id
  for no key update;
  if not found or v_contact.status = 'redacted' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Idempotent replay: same key + same statement -> the existing row; same key + anything else -> ZW006.
  select * into v_existing from public.plus_communication_consents
  where organization_id = p_organization_id and idempotency_key = v_key;
  if found then
    if v_existing.contact_id = v_contact.id and v_existing.channel = p_channel and v_existing.purpose = p_purpose
       and v_existing.status = p_status and v_existing.corrects_consent_id is not distinct from p_corrects_consent_id then
      v_result.consent_id := v_existing.id;
      v_result.changed := false;
      v_result.recorded_status := p_status;
      v_result.effective_status := public._plus_effective_consent(p_organization_id, v_contact.id, p_channel, p_purpose);
      return v_result;
    end if;
    raise exception 'idempotency_conflict' using errcode = 'ZW006';
  end if;

  select * into v_latest from public.plus_communication_consents
  where organization_id = p_organization_id and contact_id = v_contact.id and channel = p_channel and purpose = p_purpose
  order by seq desc
  limit 1;

  if p_corrects_consent_id is not null then
    -- only the pair's CURRENT latest row can be corrected (ZD-234); a system DNC revocation never (ZD-233)
    if v_latest.id is null or v_latest.id <> p_corrects_consent_id then
      raise exception 'stale_state' using errcode = 'ZW003';
    end if;
    if v_latest.captured_via = 'do_not_contact' then
      raise exception 'illegal_transition' using errcode = 'ZW004';
    end if;
  end if;

  if p_status = 'granted' then
    if v_contact.status <> 'active' then
      raise exception 'illegal_transition' using errcode = 'ZW004';  -- archived: revocations only (ZD-235)
    end if;
    if v_contact.do_not_contact then
      raise exception 'do_not_contact' using errcode = 'ZW004';      -- ZD-233
    end if;
    v_digest := public._plus_consent_address_digest(p_organization_id, p_channel, v_contact.phone, v_contact.email);
    if v_digest is null then
      raise exception 'invalid_input' using errcode = 'ZW006';       -- no address on file for this channel
    end if;
    -- stale evidence (ZD-231): a grant older than the latest revocation (other than the row being corrected) is refused
    select r.captured_at into v_last_revoke_at from public.plus_communication_consents r
    where r.organization_id = p_organization_id and r.contact_id = v_contact.id and r.channel = p_channel
      and r.purpose = p_purpose and r.status = 'revoked' and r.id is distinct from p_corrects_consent_id
    order by r.seq desc
    limit 1;
    if v_last_revoke_at is not null and v_at < v_last_revoke_at then
      raise exception 'stale_evidence' using errcode = 'ZW004';
    end if;
  end if;

  begin
    insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via,
                                                    captured_at, address_digest, evidence_note, corrects_consent_id,
                                                    idempotency_key, recorded_by)
    values (p_organization_id, v_contact.id, p_channel, p_purpose, p_status, p_captured_via, v_at, v_digest, v_note,
            p_corrects_consent_id, v_key, auth.uid())
    returning id into v_id;
  exception
    when unique_violation then
      -- the same key was first used concurrently (on another contact of this organization): resolve as above
      select * into v_existing from public.plus_communication_consents
      where organization_id = p_organization_id and idempotency_key = v_key;
      if found and v_existing.contact_id = v_contact.id and v_existing.channel = p_channel and v_existing.purpose = p_purpose
         and v_existing.status = p_status and v_existing.corrects_consent_id is not distinct from p_corrects_consent_id then
        v_result.consent_id := v_existing.id;
        v_result.changed := false;
        v_result.recorded_status := p_status;
        v_result.effective_status := public._plus_effective_consent(p_organization_id, v_contact.id, p_channel, p_purpose);
        return v_result;
      end if;
      raise exception 'idempotency_conflict' using errcode = 'ZW006';
    when check_violation or not_null_violation or foreign_key_violation then
      raise exception 'invalid_input' using errcode = 'ZW006';
  end;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_contact', v_contact.id,
          case p_status when 'granted' then 'plus_consent_granted' else 'plus_consent_revoked' end, auth.uid(), null,
          jsonb_build_object('consent_id', v_id, 'channel', p_channel, 'purpose', p_purpose,
                             'captured_via', p_captured_via, 'correction', p_corrects_consent_id is not null));

  v_result.consent_id := v_id;
  v_result.changed := true;
  v_result.recorded_status := p_status;
  v_result.effective_status := public._plus_effective_consent(p_organization_id, v_contact.id, p_channel, p_purpose);
  return v_result;
end;
$$;
comment on function public._plus_append_consent(text, uuid, uuid, text, text, text, timestamptz, text, uuid, text) is
  'NP-P2-S6-A. INTERNAL. Shared body of plus_record_consent (granted) / plus_revoke_consent (revoked): Plus write guard, input validation, per-contact FOR NO KEY UPDATE lock, idempotent replay, correction / DNC / archived / stale-evidence rules, server-set actor, time, seq and digest, one minimised audit row.';
revoke all on function public._plus_append_consent(text, uuid, uuid, text, text, text, timestamptz, text, uuid, text)
  from public, anon, authenticated, service_role;

-- ZD-233: called by plus_update_contact in the same transaction, with the contact already locked FOR UPDATE, when
-- do_not_contact changes from false to true. Appends one system revocation per pair whose recorded state is granted.
create function public._plus_consents_revoke_for_dnc(p_organization_id uuid, p_contact_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pair record;
  v_id uuid;
  v_n integer := 0;
begin
  for v_pair in
    select l.channel, l.purpose
    from (
      select distinct on (c.channel, c.purpose) c.channel, c.purpose, c.status
      from public.plus_communication_consents c
      where c.organization_id = p_organization_id and c.contact_id = p_contact_id
      order by c.channel, c.purpose, c.seq desc
    ) l
    where l.status = 'granted'
    order by l.channel, l.purpose
  loop
    insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via,
                                                    captured_at, idempotency_key, recorded_by)
    values (p_organization_id, p_contact_id, v_pair.channel, v_pair.purpose, 'revoked', 'do_not_contact', now(),
            'dnc:' || replace(extensions.gen_random_uuid()::text, '-', ''), auth.uid())
    returning id into v_id;
    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
    values (p_organization_id, 'plus_contact', p_contact_id, 'plus_consent_revoked', auth.uid(), null,
            jsonb_build_object('consent_id', v_id, 'channel', v_pair.channel, 'purpose', v_pair.purpose,
                               'captured_via', 'do_not_contact', 'correction', false));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
comment on function public._plus_consents_revoke_for_dnc(uuid, uuid) is
  'NP-P2-S6-A. INTERNAL (ZD-233). Called only by plus_update_contact, under its FOR UPDATE contact lock, when do_not_contact changes false -> true: appends one revoked row (captured_via do_not_contact, actor = the editing staff member) per (channel, purpose) whose latest row is granted, with one minimised audit row each. Returns the number appended.';
revoke all on function public._plus_consents_revoke_for_dnc(uuid, uuid) from public, anon, authenticated, service_role;

-- =============================================================================
-- 3. RPCs
-- =============================================================================
create function public.plus_get_contact_consents(p_organization_id uuid, p_contact_id uuid)
returns table (
  channel text,
  purpose text,
  recorded_status text,
  effective_status text,
  latest_consent_id uuid,
  captured_via text,
  captured_at timestamptz,
  recorded_at timestamptz,
  recorded_by_name text,
  is_correction boolean
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
  if not exists (select 1 from public.plus_contacts c
                 where c.id = p_contact_id and c.organization_id = p_organization_id and c.status <> 'redacted') then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select p.ch, p.pu,
         coalesce(l.status, 'none'),
         public._plus_effective_consent(p_organization_id, p_contact_id, p.ch, p.pu),
         l.id, l.captured_via, l.captured_at, l.recorded_at,
         case when l.id is null then null else public._plus_staff_name(l.recorded_by) end,
         coalesce(l.corrects_consent_id is not null, false)
  from (values ('email', 'service_followup', 1), ('email', 'marketing', 2), ('sms', 'service_followup', 3),
               ('sms', 'marketing', 4), ('voice', 'service_followup', 5), ('voice', 'marketing', 6)) as p(ch, pu, ord)
  left join lateral (
    select c.* from public.plus_communication_consents c
    where c.organization_id = p_organization_id and c.contact_id = p_contact_id and c.channel = p.ch and c.purpose = p.pu
    order by c.seq desc
    limit 1
  ) l on true
  order by p.ord;
end;
$$;
comment on function public.plus_get_contact_consents(uuid, uuid) is
  'NP-P2-S6-A. Plus READ (plus_can_read; ZW001 without a uid; ZW002 for no access and for a foreign / unknown / redacted contact -- no existence oracle). Exactly 6 rows (email / sms / voice x service_followup / marketing): recorded_status (granted | revoked | none), effective_status (resolver), and the latest row''s method, times, recorder name and correction flag. Never returns the address digest, idempotency key or note. consent_on_record is not legal permission to contact.';
revoke all on function public.plus_get_contact_consents(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.plus_get_contact_consents(uuid, uuid) to authenticated;

create function public.plus_list_contact_consent_events(
  p_organization_id uuid,
  p_contact_id uuid,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  channel text,
  purpose text,
  status text,
  captured_via text,
  captured_at timestamptz,
  recorded_at timestamptz,
  recorded_by_name text,
  evidence_note text,
  corrects_consent_id uuid,
  total_count bigint
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
  select c.id, c.channel, c.purpose, c.status, c.captured_via, c.captured_at, c.recorded_at,
         public._plus_staff_name(c.recorded_by), c.evidence_note, c.corrects_consent_id, count(*) over ()
  from public.plus_communication_consents c
  where c.organization_id = p_organization_id and c.contact_id = p_contact_id
  order by c.seq desc
  limit v_limit offset v_offset;
end;
$$;
comment on function public.plus_list_contact_consent_events(uuid, uuid, integer, integer) is
  'NP-P2-S6-A. Plus READ. The contact''s consent history, newest first by seq (1-100 per page, default 50), with the evidence note (ZD-242) and total_count. ZW002 for no access or a foreign / unknown / redacted contact. Never returns the address digest or idempotency key.';
revoke all on function public.plus_list_contact_consent_events(uuid, uuid, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.plus_list_contact_consent_events(uuid, uuid, integer, integer) to authenticated;

create function public.plus_record_consent(
  p_organization_id uuid,
  p_contact_id uuid,
  p_channel text,
  p_purpose text,
  p_captured_via text,
  p_captured_at timestamptz,
  p_evidence_note text,
  p_corrects_consent_id uuid,
  p_idempotency_key text
)
returns public.plus_consent_write_result
language sql
security definer
set search_path = public, pg_temp
as $$
  select r.* from public._plus_append_consent('granted', p_organization_id, p_contact_id, p_channel, p_purpose,
                                              p_captured_via, p_captured_at, p_evidence_note, p_corrects_consent_id,
                                              p_idempotency_key) r;
$$;
comment on function public.plus_record_consent(uuid, uuid, text, text, text, timestamptz, text, uuid, text) is
  'NP-P2-S6-A. Plus WRITE (_require_plus_write: ZW002 no read access, ZW001 read_only / read grant). Appends a GRANTED row for an ACTIVE contact: staff method only; captured_at NULL = now, within 366 days; note <= 500 (required for a correction). ZW004 when the contact is archived, Do not contact is on, or the evidence is older than the latest revocation (stale_evidence); ZW006 when there is no address for the channel; ZW003 when correcting anything but the pair''s latest row. Same idempotency key replayed -> changed=false. Actor, time, order and address digest are server-set. Nothing is sent; this is not legal permission to contact.';
revoke all on function public.plus_record_consent(uuid, uuid, text, text, text, timestamptz, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.plus_record_consent(uuid, uuid, text, text, text, timestamptz, text, uuid, text) to authenticated;

create function public.plus_revoke_consent(
  p_organization_id uuid,
  p_contact_id uuid,
  p_channel text,
  p_purpose text,
  p_captured_via text,
  p_captured_at timestamptz,
  p_evidence_note text,
  p_corrects_consent_id uuid,
  p_idempotency_key text
)
returns public.plus_consent_write_result
language sql
security definer
set search_path = public, pg_temp
as $$
  select r.* from public._plus_append_consent('revoked', p_organization_id, p_contact_id, p_channel, p_purpose,
                                              p_captured_via, p_captured_at, p_evidence_note, p_corrects_consent_id,
                                              p_idempotency_key) r;
$$;
comment on function public.plus_revoke_consent(uuid, uuid, text, text, text, timestamptz, text, uuid, text) is
  'NP-P2-S6-A. Plus WRITE (ZW001 in read_only -- no exception, ZD-239). Appends a REVOKED row for an active OR archived contact (ZD-235), also while Do not contact is on, whatever its captured_at. History is never changed. Same idempotency key replayed -> changed=false.';
revoke all on function public.plus_revoke_consent(uuid, uuid, text, text, text, timestamptz, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.plus_revoke_consent(uuid, uuid, text, text, text, timestamptz, text, uuid, text) to authenticated;

-- =============================================================================
-- 4. plus_update_contact: BODY replaced (ZD-233). Identical to 20261014100000 except the marked DNC step.
-- =============================================================================
create or replace function public.plus_update_contact(
  p_organization_id uuid,
  p_contact_id uuid,
  p_expected_updated_at timestamptz,
  p_display_name text,
  p_phone text,
  p_email text,
  p_contact_kind text,
  p_job_title text,
  p_preferred_channel text,
  p_do_not_contact boolean,
  p_owner_membership_id uuid
)
returns public.plus_contact_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := nullif(btrim(p_display_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_title text := nullif(btrim(p_job_title), '');
  v_owner uuid;
  v_old public.plus_contacts%rowtype;
  v_new public.plus_contacts%rowtype;
  v_fields text[] := array[]::text[];
  v_result public.plus_contact_write_result;
begin
  perform public._require_plus_write(p_organization_id);

  select * into v_old from public.plus_contacts
  where id = p_contact_id and organization_id = p_organization_id
  for update;
  if not found or v_old.status = 'redacted' then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_old.status <> 'active' then
    -- archived contacts are history: read-only
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- An owner that is unchanged is kept even if they have since lost write access; a NEW owner must be eligible.
  if p_owner_membership_id is not null
     and v_old.owner_user_id is not null
     and exists (select 1 from public.memberships m where m.id = p_owner_membership_id
                 and m.organization_id = p_organization_id and m.user_id = v_old.owner_user_id) then
    v_owner := v_old.owner_user_id;
  else
    v_owner := public._plus_resolve_owner(p_organization_id, p_owner_membership_id);
  end if;

  if v_phone is null and v_email is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if v_old.display_name is distinct from v_name then v_fields := array_append(v_fields, 'display_name'); end if;
  if v_old.phone is distinct from v_phone then v_fields := array_append(v_fields, 'phone'); end if;
  if v_old.email is distinct from v_email then v_fields := array_append(v_fields, 'email'); end if;
  if v_old.contact_kind is distinct from p_contact_kind then v_fields := array_append(v_fields, 'contact_kind'); end if;
  if v_old.job_title is distinct from v_title then v_fields := array_append(v_fields, 'job_title'); end if;
  if v_old.preferred_channel is distinct from p_preferred_channel then v_fields := array_append(v_fields, 'preferred_channel'); end if;
  if v_old.do_not_contact is distinct from p_do_not_contact then v_fields := array_append(v_fields, 'do_not_contact'); end if;
  if v_old.owner_user_id is distinct from v_owner then v_fields := array_append(v_fields, 'owner'); end if;

  v_result.contact_id := v_old.id;
  v_result.possible_duplicates := 0;
  if cardinality(v_fields) = 0 then
    v_result.updated_at := v_old.updated_at;
    v_result.changed := false;
    return v_result;
  end if;

  begin
    update public.plus_contacts
    set display_name = v_name, phone = v_phone, email = v_email, contact_kind = p_contact_kind, job_title = v_title,
        preferred_channel = p_preferred_channel, do_not_contact = p_do_not_contact, owner_user_id = v_owner
    where id = v_old.id
    returning * into v_new;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end;

  -- NP-P2-S6-A (ZD-233): Do not contact switched ON -> revoke every currently granted (channel, purpose) in this same
  -- transaction, under this FOR UPDATE lock. Switching it OFF writes nothing: no earlier grant revives.
  if v_old.do_not_contact is false and v_new.do_not_contact is true then
    perform public._plus_consents_revoke_for_dnc(p_organization_id, v_old.id);
  end if;

  if 'owner' = any (v_fields) then
    insert into public.plus_activities (organization_id, contact_id, activity_type, body, actor_user_id)
    values (p_organization_id, v_old.id, 'owner_changed',
            case when v_owner is null then 'Owner removed' else 'Owner: ' || public._plus_staff_name(v_owner) end, auth.uid());
  end if;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_contact', v_old.id, 'plus_contact_updated', auth.uid(), null,
          jsonb_build_object('fields', to_jsonb(v_fields)));

  v_result.updated_at := v_new.updated_at;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_update_contact(uuid, uuid, timestamptz, text, text, text, text, text, text, boolean, uuid) is
  'NP-P1-S4. Plus WRITE. Replaces the editable fields of an ACTIVE contact of p_organization_id (foreign / unknown ZW002; archived ZW004). p_expected_updated_at must equal the row''s updated_at under the row lock, else ZW003 (no lost update). Identical values -> changed=false, nothing written. An owner change writes an owner_changed activity. Audited as plus_contact_updated with the NAMES of the changed fields only. NP-P2-S6-A (ZD-233): switching do_not_contact from false to true also appends one system consent revocation per currently granted (channel, purpose) in the same transaction; switching it off writes nothing (no consent revives). Signature and EXECUTE grant unchanged.';
