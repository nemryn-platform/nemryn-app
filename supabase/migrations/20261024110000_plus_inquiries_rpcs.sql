-- NP-P2-S7-A -- Nemryn Plus public inquiry intake: FUNCTIONS (depends on 20261024100000_plus_inquiries_foundation.sql).
--
-- Canonical design: docs/product/NP-P2-S7-public-inquiry-intake-design.md (ZD-243 .. ZD-263).
--
-- ROLES:
--   service_role only  get_public_plus_inquiry_form, check_and_record_plus_inquiry_rate_limit, submit_plus_inquiry
--                      (called by the S7-B server-only route; never by a browser; anon / authenticated -> 42501)
--   authenticated      Platform Admin: platform_get / platform_set_plus_inquiry_public_access (activation allowlist)
--                      Plus Admin write (_require_plus_admin_write): plus_save / publish / disable_inquiry_form
--                      Plus read (plus_can_read): plus_get_inquiry_form, plus_list_inquiries, plus_get_inquiry,
--                                                 plus_list_inquiry_duplicate_hints, plus_count_new_inquiries
--                      Plus write (_require_plus_write): plus_convert_inquiry, plus_dismiss_inquiry, plus_reopen_inquiry
--   internal (owner)   _plus_inquiry_public_access_enabled, _plus_inquiry_service_options, _plus_inquiry_public_form,
--                      _plus_inquiry_append_web_form_consent
--
-- PUBLIC AVAILABILITY (refinement A, ZD-262): a form is reachable ONLY when ALL hold, evaluated in the database on every
-- public call: status published AND the organization is active AND its Plus effective state is write AND the
-- organization is on the Platform-Admin allowlist (plus_inquiry_public_access, empty by default). Publishing also
-- requires the allowlist, so staff configuration cannot bypass activation. The S7-B route adds the global
-- PLUS_INQUIRY_SUBMISSIONS kill switch (default OFF) in front of these functions.
--
-- NO SIDE EFFECTS ON SUBMISSION: submit_plus_inquiry inserts one plus_inquiries row and nothing else -- no contact,
-- opportunity, Core Request, Passenger, Trip, notification, consent row or audit row.
--
-- CONVERSION (ZD-251, ZD-252, refinement D): one transaction. Reuses plus_create_contact (duplicate warning, owner rules)
-- and plus_create_opportunity (stage, source, owner rules) unchanged; never overwrites a populated contact field; refuses
-- archived / redacted contacts; requires and audits a do-not-contact acknowledgement; writes web_form consent only for
-- ticked purposes x channels whose address equals the contact's (email -> email, phone -> voice, NEVER sms), never for
-- a do-not-contact contact, never older than the latest revocation of the pair. Never a Core Request.

-- =============================================================================
-- 1. result types
-- =============================================================================
create type public.plus_inquiry_public_access_result as (organization_id uuid, enabled boolean, changed boolean);
create type public.plus_inquiry_form_write_result as (
  form_id uuid, status text, version integer, config_version integer, changed boolean
);
create type public.plus_inquiry_submission_result as (status text, changed boolean);
comment on type public.plus_inquiry_submission_result is
  'NP-P2-S7-A. status: accepted | unavailable | form_changed | invalid. changed=false on an accepted idempotent replay. Carries no id and no reason detail.';
create type public.plus_inquiry_triage_result as (inquiry_id uuid, status text, version integer, changed boolean);
create type public.plus_inquiry_conversion_result as (
  outcome text,               -- converted | possible_duplicates (nothing written)
  inquiry_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  possible_duplicates integer,
  consent_granted integer,
  consent_skipped text[],     -- '<channel>/<purpose>:<reason>' for every ticked pair NOT recorded
  version integer
);

-- =============================================================================
-- 2. internal helpers
-- =============================================================================
create function public._plus_inquiry_public_access_enabled(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.plus_inquiry_public_access a where a.organization_id = p_organization_id);
$$;
comment on function public._plus_inquiry_public_access_enabled(uuid) is
  'NP-P2-S7-A. INTERNAL. Whether the organization is on the public-inquiry activation allowlist (refinement A).';
revoke all on function public._plus_inquiry_public_access_enabled(uuid) from public, anon, authenticated, service_role;

-- The services an inquiry form may offer RIGHT NOW: the eight Plus types intersected with the organization's Core
-- service offerings (no offering rows = unrestricted, the Core form semantics). Never airport_transportation.
create function public._plus_inquiry_service_options(p_organization_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(s.v order by s.ord), '{}'::text[])
  from unnest(public._plus_inquiry_service_type_list()) with ordinality as s(v, ord)
  where not exists (select 1 from public.organization_service_offerings o where o.organization_id = p_organization_id)
     or exists (select 1 from public.organization_service_offerings o where o.organization_id = p_organization_id and o.service_type = s.v);
$$;
comment on function public._plus_inquiry_service_options(uuid) is
  'NP-P2-S7-A. INTERNAL (refinement C). The eight Plus service types intersected with the organization''s current Core service offerings (no rows = all eight), canonical order. airport_transportation is never included.';
revoke all on function public._plus_inquiry_service_options(uuid) from public, anon, authenticated, service_role;

-- The ONE public-availability rule (refinement A): the form row when every condition holds, else NULL.
create function public._plus_inquiry_public_form(p_public_key text)
returns public.plus_inquiry_forms
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := lower(btrim(coalesce(p_public_key, '')));
  v_form public.plus_inquiry_forms%rowtype;
begin
  if v_key !~ '^inq_[0-9a-f]{32}$' then
    return null;
  end if;
  select f.* into v_form from public.plus_inquiry_forms f where f.public_key = v_key and f.status = 'published';
  if not found
     or not exists (select 1 from public.organizations o where o.id = v_form.organization_id and o.status = 'active')
     or public._plus_entitlement_state(v_form.organization_id) <> 'write'
     or not public._plus_inquiry_public_access_enabled(v_form.organization_id) then
    return null;
  end if;
  return v_form;
end;
$$;
comment on function public._plus_inquiry_public_form(text) is
  'NP-P2-S7-A. INTERNAL. The published form for a key ONLY if the organization is active, Plus is in effective state write and the organization is on the activation allowlist; NULL otherwise (unknown, malformed, draft, disabled, suspended, read_only, locked, none and not-allowlisted are indistinguishable).';
revoke all on function public._plus_inquiry_public_form(text) from public, anon, authenticated, service_role;

-- One web_form grant (refinement B). The caller holds the contact row lock and has already set the inquiry's
-- contact_id. Returns NULL when written, else the skip reason. Never raises for an ineligible pair.
create function public._plus_inquiry_append_web_form_consent(
  p_organization_id uuid,
  p_contact_id uuid,
  p_inquiry public.plus_inquiries,
  p_channel text,
  p_purpose text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact public.plus_contacts%rowtype;
  v_contact_digest text;
  v_inquiry_digest text;
  v_last_revoke_at timestamptz;
  v_id uuid;
begin
  if p_channel not in ('email', 'voice') or p_purpose not in ('service_followup', 'marketing') then
    return 'not_eligible';                                       -- sms is never derived from a web form
  end if;
  select * into v_contact from public.plus_contacts where id = p_contact_id and organization_id = p_organization_id;
  if not found or v_contact.status <> 'active' then
    return 'contact_not_active';
  end if;
  if v_contact.do_not_contact then
    return 'do_not_contact';                                     -- ZD-233: DNC overrides every grant
  end if;
  v_inquiry_digest := public._plus_consent_address_digest(p_organization_id, p_channel, p_inquiry.phone, p_inquiry.email);
  if v_inquiry_digest is null then
    return 'no_inquiry_address';
  end if;
  v_contact_digest := public._plus_consent_address_digest(p_organization_id, p_channel, v_contact.phone, v_contact.email);
  if v_contact_digest is null then
    return 'no_contact_address';
  end if;
  if v_contact_digest <> v_inquiry_digest then
    return 'address_mismatch';                                   -- ZD-232: evidence is bound to the address given
  end if;
  if p_inquiry.received_at < now() - interval '366 days' then
    return 'evidence_too_old';                                   -- the S6 staff bound for captured_at
  end if;
  -- ZD-231 stale evidence: the latest revocation of the pair is newer than the submission
  select r.captured_at into v_last_revoke_at from public.plus_communication_consents r
  where r.organization_id = p_organization_id and r.contact_id = v_contact.id and r.channel = p_channel
    and r.purpose = p_purpose and r.status = 'revoked'
  order by r.seq desc
  limit 1;
  if v_last_revoke_at is not null and p_inquiry.received_at < v_last_revoke_at then
    return 'stale_evidence';
  end if;

  insert into public.plus_communication_consents (organization_id, contact_id, channel, purpose, status, captured_via,
                                                  captured_at, address_digest, consent_text_version, inquiry_id,
                                                  idempotency_key, recorded_by)
  values (p_organization_id, v_contact.id, p_channel, p_purpose, 'granted', 'web_form', p_inquiry.received_at,
          v_contact_digest, p_inquiry.consent_text_version, p_inquiry.id,
          'inq:' || p_inquiry.id::text || ':' || p_channel || ':' || p_purpose, auth.uid())
  returning id into v_id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_contact', v_contact.id, 'plus_consent_granted', auth.uid(), null,
          jsonb_build_object('consent_id', v_id, 'channel', p_channel, 'purpose', p_purpose,
                             'captured_via', 'web_form', 'correction', false, 'inquiry_id', p_inquiry.id));
  return null;
end;
$$;
comment on function public._plus_inquiry_append_web_form_consent(uuid, uuid, public.plus_inquiries, text, text) is
  'NP-P2-S7-A. INTERNAL (refinement B, ZD-252). Called only by plus_convert_inquiry under its contact lock. Appends one granted web_form ledger row (captured_at = the submission time, the inquiry''s consent text version, inquiry_id, server digest) when the contact is active and not do-not-contact, the channel is email or voice, the inquiry''s address equals the contact''s, the evidence is within 366 days and not older than the pair''s latest revocation. Otherwise writes nothing and returns the reason. One minimised audit row per grant (S6 shape).';
revoke all on function public._plus_inquiry_append_web_form_consent(uuid, uuid, public.plus_inquiries, text, text)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- 3. Platform Admin: activation allowlist (refinement A)
-- =============================================================================
create function public.platform_set_plus_inquiry_public_access(p_organization_id uuid, p_enabled boolean, p_reason text)
returns public.plus_inquiry_public_access_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_exists boolean;
  v_result public.plus_inquiry_public_access_result;
begin
  perform public._require_platform_admin();
  if p_enabled is null or v_reason is null or length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  perform 1 from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_exists := public._plus_inquiry_public_access_enabled(p_organization_id);
  v_result.organization_id := p_organization_id;
  v_result.enabled := p_enabled;
  if v_exists = p_enabled then
    v_result.changed := false;
    return v_result;
  end if;
  if p_enabled then
    insert into public.plus_inquiry_public_access (organization_id, reason, enabled_by) values (p_organization_id, v_reason, auth.uid());
  else
    delete from public.plus_inquiry_public_access where organization_id = p_organization_id;
  end if;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (p_organization_id, 'organization', p_organization_id, 'platform_plus_inquiry_public_access_changed', auth.uid(),
          jsonb_build_object('enabled', v_exists), jsonb_build_object('enabled', p_enabled), v_reason);
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.platform_set_plus_inquiry_public_access(uuid, boolean, text) is
  'NP-P2-S7-A (refinement A, ZD-262). PLATFORM ADMIN only (_require_platform_admin: ZW001 without a uid, ZW002 otherwise -- an Organization Admin can never enable their own organization). Adds or removes ONE organization on the public-inquiry activation allowlist; reason 1-500 required both ways (ZW006); unknown organization ZW002; no change -> changed=false, nothing written. Audited as platform_plus_inquiry_public_access_changed with the reason. Enabling exposes nothing by itself: a published form, an active organization, Plus write and the S7-B kill switch are still required.';
revoke all on function public.platform_set_plus_inquiry_public_access(uuid, boolean, text) from public, anon;
grant execute on function public.platform_set_plus_inquiry_public_access(uuid, boolean, text) to authenticated;

create function public.platform_get_plus_inquiry_public_access(p_organization_id uuid)
returns table (organization_id uuid, enabled boolean, enabled_at timestamptz, enabled_by_name text, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_platform_admin();
  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select p_organization_id, a.organization_id is not null, a.enabled_at,
         case when a.enabled_by is null then null else public._plus_staff_name(a.enabled_by) end, a.reason
  from (select 1) one
  left join public.plus_inquiry_public_access a on a.organization_id = p_organization_id;
end;
$$;
comment on function public.platform_get_plus_inquiry_public_access(uuid) is
  'NP-P2-S7-A (ZD-262). PLATFORM ADMIN only. One row: whether the organization is on the public-inquiry activation allowlist, since when, by whom and why.';
revoke all on function public.platform_get_plus_inquiry_public_access(uuid) from public, anon;
grant execute on function public.platform_get_plus_inquiry_public_access(uuid) to authenticated;

-- =============================================================================
-- 4. Public (service_role only; the S7-B server-only route is the sole caller)
-- =============================================================================
create function public.get_public_plus_inquiry_form(p_public_key text)
returns table (
  organization_name text,
  headline text,
  intro_text text,
  service_types text[],
  config_version integer,
  consent_text_version text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_form public.plus_inquiry_forms%rowtype;
begin
  v_form := public._plus_inquiry_public_form(p_public_key);
  if v_form.id is null then
    return;                                                       -- zero rows: uniformly unavailable
  end if;
  return query
  select o.name, v_form.headline, v_form.intro_text,
         array(select s from unnest(public._plus_inquiry_service_options(v_form.organization_id)) s
               where s = any (v_form.offered_service_types)),
         v_form.config_version, v_form.consent_text_version
  from public.organizations o where o.id = v_form.organization_id;
end;
$$;
comment on function public.get_public_plus_inquiry_form(text) is
  'NP-P2-S7-A. SERVICE_ROLE only. The public configuration of an AVAILABLE inquiry form (refinement A rule), or zero rows -- unknown, malformed, draft, disabled, suspended, non-write, locked and not-allowlisted keys are indistinguishable. Returns the organization display name, headline, intro, the offered services still offered by the organization, config_version and the consent text version. No ids, no settings.';
revoke all on function public.get_public_plus_inquiry_form(text) from public, anon, authenticated;
grant execute on function public.get_public_plus_inquiry_form(text) to service_role;

create function public.check_and_record_plus_inquiry_rate_limit(p_form_public_key text, p_client_key text)
returns public.rate_limit_check_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form_key text := lower(btrim(coalesce(p_form_public_key, '')));
  v_client_key text := lower(btrim(coalesce(p_client_key, '')));
  v_form_count integer;
  v_client_count integer;
  c_per_client constant integer := 5;     -- ZD-254 (Core website intake: 8)
  c_per_form constant integer := 60;      -- ZD-254 (Core website intake: 120)
  c_window constant interval := interval '1 hour';
  v_result public.rate_limit_check_result;
begin
  -- malformed input fails CLOSED
  if v_form_key !~ '^inq_[0-9a-f]{32}$' or v_client_key !~ '^[0-9a-f]{64}$' then
    v_result.allowed := false;
    return v_result;
  end if;
  -- transaction-scoped advisory locks make count-then-insert atomic per form and per client (own namespaces)
  perform pg_advisory_xact_lock(hashtext('plus-inquiry-rl-form:' || v_form_key));
  perform pg_advisory_xact_lock(hashtext('plus-inquiry-rl-client:' || v_client_key));
  select count(*) into v_form_count from public.plus_inquiry_rate_limit_events
  where form_public_key = v_form_key and occurred_at > now() - c_window;
  select count(*) into v_client_count from public.plus_inquiry_rate_limit_events
  where client_key = v_client_key and occurred_at > now() - c_window;
  if v_form_count >= c_per_form or v_client_count >= c_per_client then
    v_result.allowed := false;
    return v_result;
  end if;
  insert into public.plus_inquiry_rate_limit_events (form_public_key, client_key) values (v_form_key, v_client_key);
  v_result.allowed := true;
  return v_result;
end;
$$;
comment on function public.check_and_record_plus_inquiry_rate_limit(text, text) is
  'NP-P2-S7-A (ZD-254). SERVICE_ROLE only. Atomically checks AND records one public inquiry attempt: rolling 1 hour, 5 per client key and 60 per form key; malformed keys are refused (fail closed). Atomic under concurrency (advisory locks). Returns only {allowed}. Its own ledger: Core''s public_intake_rate_limit_events and its function are not used or changed.';
revoke all on function public.check_and_record_plus_inquiry_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.check_and_record_plus_inquiry_rate_limit(text, text) to service_role;

create function public.submit_plus_inquiry(
  p_public_key text,
  p_idempotency_key text,
  p_form_config_version integer,
  p_name text,
  p_phone text,
  p_email text,
  p_preferred_reply text,
  p_relationship text,
  p_inquiry_type text,
  p_service_type text,
  p_timeframe text,
  p_question text,
  p_consent_followup boolean,
  p_consent_marketing boolean,
  p_acquisition jsonb
)
returns public.plus_inquiry_submission_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form public.plus_inquiry_forms%rowtype;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_name text := nullif(btrim(p_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_reply text := coalesce(nullif(btrim(p_preferred_reply), ''), 'either');
  v_rel text := nullif(btrim(p_relationship), '');
  v_type text := nullif(btrim(p_inquiry_type), '');
  v_service text := nullif(btrim(p_service_type), '');
  v_timeframe text := nullif(btrim(p_timeframe), '');
  v_question text := nullif(btrim(p_question), '');
  v_acq jsonb;
  v_id uuid;
  v_result public.plus_inquiry_submission_result;
begin
  v_result.changed := false;
  -- 1. availability (the ONE rule) -- before anything else, so unavailable forms never reveal validation behaviour
  v_form := public._plus_inquiry_public_form(p_public_key);
  if v_form.id is null then
    v_result.status := 'unavailable';
    return v_result;
  end if;
  -- 2. the person must have seen the LIVE configuration (and so the live consent wording)
  if p_form_config_version is null or p_form_config_version <> v_form.config_version then
    v_result.status := 'form_changed';
    return v_result;
  end if;
  -- 3. closed-schema validation (the table CHECKs below are the final authority)
  if v_key !~ '^[A-Za-z0-9._:-]{8,100}$'
     or v_name is null or v_question is null or v_type is null
     or (v_service is not null and not (v_service = any (v_form.offered_service_types)
                                        and v_service = any (public._plus_inquiry_service_options(v_form.organization_id)))) then
    v_result.status := 'invalid';
    return v_result;
  end if;
  v_acq := public._sanitize_acquisition(p_acquisition);           -- Core's pure sanitiser (read-only reuse)

  begin
    insert into public.plus_inquiries (organization_id, form_id, form_config_version, idempotency_key, name, phone, email,
                                       preferred_reply, relationship, inquiry_type, service_type, timeframe, question,
                                       consent_followup, consent_marketing, consent_text_version,
                                       utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path, referrer_host)
    values (v_form.organization_id, v_form.id, v_form.config_version, v_key, v_name, v_phone, v_email,
            v_reply, v_rel, v_type, v_service, v_timeframe, v_question,
            coalesce(p_consent_followup, false), coalesce(p_consent_marketing, false), v_form.consent_text_version,
            v_acq ->> 'utmSource', v_acq ->> 'utmMedium', v_acq ->> 'utmCampaign', v_acq ->> 'utmContent', v_acq ->> 'utmTerm',
            v_acq ->> 'landingPath', v_acq ->> 'referrerHost')
    on conflict (organization_id, idempotency_key) do nothing
    returning id into v_id;
  exception
    when check_violation or not_null_violation or foreign_key_violation or string_data_right_truncation then
      v_result.status := 'invalid';
      return v_result;
  end;
  v_result.status := 'accepted';
  v_result.changed := v_id is not null;                           -- NULL id = an idempotent replay of the same key
  return v_result;
end;
$$;
comment on function public.submit_plus_inquiry(text, text, integer, text, text, text, text, text, text, text, text, text, boolean, boolean, jsonb) is
  'NP-P2-S7-A (ZD-243). SERVICE_ROLE only. The ONE public write. The organization is resolved ONLY from an AVAILABLE published key (refinement A rule); no parameter can name an organization, form, contact, status or owner. Statuses: unavailable | form_changed (config version differs from the live one) | invalid (closed sets, lengths, phone-or-email, contact-compatible phone / email, preferred reply needs its channel, service offered by the form AND still by the organization, idempotency key ^[A-Za-z0-9._:-]{8,100}$) | accepted. Inserts exactly ONE plus_inquiries row (status new, consent ticks as given, default false) and nothing else -- no contact, opportunity, Core Request, Passenger, Trip, notification, consent ledger row or audit row. The same (organization, key) again -> accepted, changed=false, no second row (safe under concurrency). Acquisition passes through Core''s _sanitize_acquisition.';
revoke all on function public.submit_plus_inquiry(text, text, integer, text, text, text, text, text, text, text, text, text, boolean, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.submit_plus_inquiry(text, text, integer, text, text, text, text, text, text, text, text, text, boolean, boolean, jsonb) to service_role;

-- =============================================================================
-- 5. Staff: form configuration (Organization Admin + Plus write) and read
-- =============================================================================
create function public.plus_get_inquiry_form(p_organization_id uuid)
returns table (
  form_id uuid,
  status text,
  public_key text,
  headline text,
  intro_text text,
  offered_service_types text[],
  config_version integer,
  consent_text_version text,
  version integer,
  published_at timestamptz,
  disabled_at timestamptz,
  updated_at timestamptz,
  public_access_enabled boolean,
  service_options text[]
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
  select f.id, f.status, f.public_key, f.headline, f.intro_text, f.offered_service_types, f.config_version,
         f.consent_text_version, f.version, f.published_at, f.disabled_at, f.updated_at,
         public._plus_inquiry_public_access_enabled(p_organization_id),
         public._plus_inquiry_service_options(p_organization_id)
  from (select 1) one
  left join public.plus_inquiry_forms f on f.organization_id = p_organization_id;
end;
$$;
comment on function public.plus_get_inquiry_form(uuid) is
  'NP-P2-S7-A. Plus READ. Exactly one row: the organization''s inquiry form (all form columns NULL when none exists yet), whether Nemryn has enabled public inquiries for it (public_access_enabled; never the reason) and the services it may offer now (service_options).';
revoke all on function public.plus_get_inquiry_form(uuid) from public, anon;
grant execute on function public.plus_get_inquiry_form(uuid) to authenticated;

create function public.plus_save_inquiry_form(
  p_organization_id uuid,
  p_headline text,
  p_intro_text text,
  p_offered_service_types text[],
  p_expected_version integer
)
returns public.plus_inquiry_form_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_consent_text_version constant text := 'plus-inquiry-consent-v1';
  v_headline text := nullif(btrim(p_headline), '');
  v_intro text := nullif(btrim(p_intro_text), '');
  v_services text[];
  v_old public.plus_inquiry_forms%rowtype;
  v_new public.plus_inquiry_forms%rowtype;
  v_fields text[] := array[]::text[];
  v_result public.plus_inquiry_form_write_result;
begin
  perform public._require_plus_admin_write(p_organization_id);
  if p_offered_service_types is null or not public._plus_inquiry_service_types_valid(p_offered_service_types)
     or not (p_offered_service_types <@ public._plus_inquiry_service_options(p_organization_id)) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  -- canonical order
  v_services := array(select s.v from unnest(public._plus_inquiry_service_type_list()) with ordinality s(v, ord)
                      where s.v = any (p_offered_service_types) order by s.ord);

  select * into v_old from public.plus_inquiry_forms where organization_id = p_organization_id for update;
  if not found then
    if p_expected_version is not null then
      raise exception 'stale_state' using errcode = 'ZW003';
    end if;
    begin
      insert into public.plus_inquiry_forms (organization_id, headline, intro_text, offered_service_types,
                                             consent_text_version, created_by, updated_by)
      values (p_organization_id, v_headline, v_intro, v_services, c_consent_text_version, auth.uid(), auth.uid())
      returning * into v_new;
    exception
      when unique_violation then raise exception 'stale_state' using errcode = 'ZW003';   -- created concurrently
      when check_violation or not_null_violation then raise exception 'invalid_input' using errcode = 'ZW006';
    end;
    v_fields := array['created'];
  else
    if p_expected_version is null or p_expected_version <> v_old.version then
      raise exception 'stale_state' using errcode = 'ZW003';
    end if;
    if v_old.headline is distinct from v_headline then v_fields := array_append(v_fields, 'headline'); end if;
    if v_old.intro_text is distinct from v_intro then v_fields := array_append(v_fields, 'intro_text'); end if;
    if v_old.offered_service_types is distinct from v_services then v_fields := array_append(v_fields, 'offered_service_types'); end if;
    if cardinality(v_fields) = 0 then
      v_result.form_id := v_old.id; v_result.status := v_old.status; v_result.version := v_old.version;
      v_result.config_version := v_old.config_version; v_result.changed := false;
      return v_result;
    end if;
    begin
      update public.plus_inquiry_forms
      set headline = v_headline, intro_text = v_intro, offered_service_types = v_services,
          config_version = config_version + 1, version = version + 1, updated_by = auth.uid()
      where id = v_old.id
      returning * into v_new;
    exception when check_violation or not_null_violation then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end;
  end if;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_inquiry_form', v_new.id, 'plus_inquiry_form_saved', auth.uid(), null,
          jsonb_build_object('fields', to_jsonb(v_fields), 'status', v_new.status, 'config_version', v_new.config_version));
  v_result.form_id := v_new.id; v_result.status := v_new.status; v_result.version := v_new.version;
  v_result.config_version := v_new.config_version; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_save_inquiry_form(uuid, text, text, text[], integer) is
  'NP-P2-S7-A (ZD-247). ORGANIZATION ADMIN + Plus write (_require_plus_admin_write: ZW002 no access / not admin, ZW001 read_only). Creates the organization''s form (p_expected_version NULL; status draft; server-generated key; consent text version set by the server) or updates it (p_expected_version = current version, else ZW003) -- also while published: edits apply live after the UI''s confirmation and increment config_version. Headline 1-120, intro <= 500, services a duplicate-free subset of the services the organization may offer now (never airport_transportation) -> ZW006 otherwise. Identical values -> changed=false. Audited (field names only). Never publishes.';
revoke all on function public.plus_save_inquiry_form(uuid, text, text, text[], integer) from public, anon;
grant execute on function public.plus_save_inquiry_form(uuid, text, text, text[], integer) to authenticated;

create function public.plus_publish_inquiry_form(p_organization_id uuid, p_expected_version integer)
returns public.plus_inquiry_form_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.plus_inquiry_forms%rowtype;
  v_new public.plus_inquiry_forms%rowtype;
  v_result public.plus_inquiry_form_write_result;
begin
  perform public._require_plus_admin_write(p_organization_id);
  select * into v_old from public.plus_inquiry_forms where organization_id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if p_expected_version is null or p_expected_version <> v_old.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_old.status = 'published' then
    v_result.form_id := v_old.id; v_result.status := v_old.status; v_result.version := v_old.version;
    v_result.config_version := v_old.config_version; v_result.changed := false;
    return v_result;
  end if;
  -- refinement A: staff configuration can never bypass activation
  if not public._plus_inquiry_public_access_enabled(p_organization_id) then
    raise exception 'public_access_not_enabled' using errcode = 'ZW004';
  end if;
  update public.plus_inquiry_forms
  set status = 'published', published_at = now(), published_by = auth.uid(), version = version + 1, updated_by = auth.uid()
  where id = v_old.id
  returning * into v_new;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_inquiry_form', v_new.id, 'plus_inquiry_form_published', auth.uid(),
          jsonb_build_object('status', v_old.status), jsonb_build_object('status', 'published', 'config_version', v_new.config_version));
  v_result.form_id := v_new.id; v_result.status := v_new.status; v_result.version := v_new.version;
  v_result.config_version := v_new.config_version; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_publish_inquiry_form(uuid, integer) is
  'NP-P2-S7-A (ZD-247, ZD-262). ORGANIZATION ADMIN + Plus write. draft / disabled -> published (same key). ZW004 public_access_not_enabled unless Nemryn has put the organization on the activation allowlist; ZW002 no form; ZW003 stale version; already published -> changed=false. Audited.';
revoke all on function public.plus_publish_inquiry_form(uuid, integer) from public, anon;
grant execute on function public.plus_publish_inquiry_form(uuid, integer) to authenticated;

create function public.plus_disable_inquiry_form(p_organization_id uuid, p_expected_version integer)
returns public.plus_inquiry_form_write_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.plus_inquiry_forms%rowtype;
  v_new public.plus_inquiry_forms%rowtype;
  v_result public.plus_inquiry_form_write_result;
begin
  perform public._require_plus_admin_write(p_organization_id);
  select * into v_old from public.plus_inquiry_forms where organization_id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if p_expected_version is null or p_expected_version <> v_old.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_old.status = 'disabled' then
    v_result.form_id := v_old.id; v_result.status := v_old.status; v_result.version := v_old.version;
    v_result.config_version := v_old.config_version; v_result.changed := false;
    return v_result;
  end if;
  if v_old.status = 'draft' then
    raise exception 'illegal_transition' using errcode = 'ZW004';   -- a draft was never public
  end if;
  update public.plus_inquiry_forms
  set status = 'disabled', disabled_at = now(), disabled_by = auth.uid(), version = version + 1, updated_by = auth.uid()
  where id = v_old.id
  returning * into v_new;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_inquiry_form', v_new.id, 'plus_inquiry_form_disabled', auth.uid(),
          jsonb_build_object('status', v_old.status), jsonb_build_object('status', 'disabled'));
  v_result.form_id := v_new.id; v_result.status := v_new.status; v_result.version := v_new.version;
  v_result.config_version := v_new.config_version; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_disable_inquiry_form(uuid, integer) is
  'NP-P2-S7-A (ZD-247). ORGANIZATION ADMIN + Plus write. published -> disabled: the public link and embed stop at once; the key and every inquiry are kept. Draft ZW004; already disabled -> changed=false; ZW002 no form; ZW003 stale version. Audited.';
revoke all on function public.plus_disable_inquiry_form(uuid, integer) from public, anon;
grant execute on function public.plus_disable_inquiry_form(uuid, integer) to authenticated;

-- =============================================================================
-- 6. Staff: inbox reads (Plus read)
-- =============================================================================
create function public.plus_list_inquiries(
  p_organization_id uuid,
  p_status text,
  p_search text,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  received_at timestamptz,
  name text,
  phone text,
  email text,
  preferred_reply text,
  relationship text,
  inquiry_type text,
  service_type text,
  timeframe text,
  status text,
  dismiss_reason text,
  contact_id uuid,
  opportunity_id uuid,
  triaged_at timestamptz,
  version integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := coalesce(nullif(btrim(p_status), ''), 'all');
  v_q text := nullif(btrim(p_search), '');
  v_limit integer := coalesce(p_limit, 25);
  v_offset integer := coalesce(p_offset, 0);
  v_like text;
  v_digits text;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_status not in ('all', 'new', 'converted', 'dismissed') or v_limit < 1 or v_limit > 100
     or v_offset < 0 or v_offset > 100000 or (v_q is not null and length(v_q) > 200) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := nullif(regexp_replace(v_q, '[^0-9]', '', 'g'), '');
    if v_digits is not null and length(v_digits) < 3 then v_digits := null; end if;
  end if;
  return query
  select i.id, i.received_at, i.name, i.phone, i.email, i.preferred_reply, i.relationship, i.inquiry_type, i.service_type,
         i.timeframe, i.status, i.dismiss_reason, i.contact_id, o.id, i.triaged_at, i.version, count(*) over ()
  from public.plus_inquiries i
  left join public.plus_opportunities o on o.inquiry_id = i.id and o.organization_id = i.organization_id
  where i.organization_id = p_organization_id
    and (v_status = 'all' or i.status = v_status)
    and (v_q is null
         or lower(i.name) like v_like escape '\'
         or coalesce(i.email, '') like v_like escape '\'
         or (v_digits is not null and regexp_replace(coalesce(i.phone, ''), '[^0-9]', '', 'g') like '%' || v_digits || '%'))
  order by i.received_at desc, i.id
  limit v_limit offset v_offset;
end;
$$;
comment on function public.plus_list_inquiries(uuid, text, text, integer, integer) is
  'NP-P2-S7-A. Plus READ (plus_can_read; ZW001 without a uid, ZW002 otherwise). One page (limit 1-100, default 25; offset 0-100000) of the organization''s inquiries, newest first. Status all | new | converted | dismissed. Search (<= 200, LIKE-escaped): name, email, phone digits (>= 3). Never returns the question, consent ticks or idempotency key; total_count is the filtered total. Invalid input ZW006.';
revoke all on function public.plus_list_inquiries(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.plus_list_inquiries(uuid, text, text, integer, integer) to authenticated;

create function public.plus_get_inquiry(p_organization_id uuid, p_inquiry_id uuid)
returns table (
  id uuid,
  received_at timestamptz,
  name text,
  phone text,
  email text,
  preferred_reply text,
  relationship text,
  inquiry_type text,
  service_type text,
  timeframe text,
  question text,
  consent_followup boolean,
  consent_marketing boolean,
  consent_text_version text,
  form_config_version integer,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_path text,
  referrer_host text,
  status text,
  dismiss_reason text,
  dismiss_note text,
  contact_id uuid,
  contact_display_name text,
  opportunity_id uuid,
  triaged_at timestamptz,
  triaged_by_name text,
  version integer
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
  if not exists (select 1 from public.plus_inquiries i where i.id = p_inquiry_id and i.organization_id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  return query
  select i.id, i.received_at, i.name, i.phone, i.email, i.preferred_reply, i.relationship, i.inquiry_type, i.service_type,
         i.timeframe, i.question, i.consent_followup, i.consent_marketing, i.consent_text_version, i.form_config_version,
         i.utm_source, i.utm_medium, i.utm_campaign, i.utm_content, i.utm_term, i.landing_path, i.referrer_host,
         i.status, i.dismiss_reason, i.dismiss_note, i.contact_id,
         case when c.status = 'redacted' then null else c.display_name end, o.id, i.triaged_at,
         case when i.triaged_by is null then null else public._plus_staff_name(i.triaged_by) end, i.version
  from public.plus_inquiries i
  left join public.plus_contacts c on c.id = i.contact_id and c.organization_id = i.organization_id
  left join public.plus_opportunities o on o.inquiry_id = i.id and o.organization_id = i.organization_id
  where i.id = p_inquiry_id and i.organization_id = p_organization_id;
end;
$$;
comment on function public.plus_get_inquiry(uuid, uuid) is
  'NP-P2-S7-A. Plus READ. One inquiry of p_organization_id with the question, the consent ticks (what the person ticked -- not consent on record), acquisition, triage state, the converted contact / opportunity and the version token. ZW002 for no access or an unknown / foreign inquiry (no existence oracle). Never returns the idempotency key.';
revoke all on function public.plus_get_inquiry(uuid, uuid) from public, anon;
grant execute on function public.plus_get_inquiry(uuid, uuid) to authenticated;

create function public.plus_list_inquiry_duplicate_hints(p_organization_id uuid, p_inquiry_id uuid)
returns table (kind text, record_id uuid, display_name text, status text, match_on text, received_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.plus_inquiries%rowtype;
  v_digits text;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.plus_can_read(p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  select * into v from public.plus_inquiries i where i.id = p_inquiry_id and i.organization_id = p_organization_id;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_digits := nullif(regexp_replace(coalesce(v.phone, ''), '[^0-9]', '', 'g'), '');
  return query
  select 'contact'::text, m.contact_id, m.display_name, m.status, m.match_on, null::timestamptz
  from public._plus_contact_matches(p_organization_id, v.name, v.phone, v.email, null) m
  where m.status <> 'redacted'
  union all
  (select 'inquiry'::text, o.id, o.name, o.status,
          array_to_string(array_remove(array[
            case when v.email is not null and o.email = v.email then 'email' end,
            case when v_digits is not null and length(v_digits) >= 7 and regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g') = v_digits then 'phone' end
          ], null), ','),
          o.received_at
   from public.plus_inquiries o
   where o.organization_id = p_organization_id and o.id <> v.id and o.status = 'new'
     and ((v.email is not null and o.email = v.email)
       or (v_digits is not null and length(v_digits) >= 7 and o.phone is not null
           and regexp_replace(o.phone, '[^0-9]', '', 'g') = v_digits))
   order by o.received_at desc, o.id
   limit 5);
end;
$$;
comment on function public.plus_list_inquiry_duplicate_hints(uuid, uuid) is
  'NP-P2-S7-A (ZD-250). Plus READ. HINTS ONLY -- never merges or dismisses: up to 5 contacts of the organization that may be this person (_plus_contact_matches: email, phone digits, name; redacted excluded) and up to 5 other NEW inquiries with the same email or phone digits. ZW002 for no access or an unknown / foreign inquiry.';
revoke all on function public.plus_list_inquiry_duplicate_hints(uuid, uuid) from public, anon;
grant execute on function public.plus_list_inquiry_duplicate_hints(uuid, uuid) to authenticated;

create function public.plus_count_new_inquiries(p_organization_id uuid)
returns integer
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
  return (select count(*)::integer from public.plus_inquiries i where i.organization_id = p_organization_id and i.status = 'new');
end;
$$;
comment on function public.plus_count_new_inquiries(uuid) is
  'NP-P2-S7-A (ZD-260). Plus READ. The number of NEW inquiries (the in-app badge / Dashboard count; no email or other alert).';
revoke all on function public.plus_count_new_inquiries(uuid) from public, anon;
grant execute on function public.plus_count_new_inquiries(uuid) to authenticated;

-- =============================================================================
-- 7. Staff: triage (Plus write)
-- =============================================================================
create function public.plus_convert_inquiry(
  p_organization_id uuid,
  p_inquiry_id uuid,
  p_expected_version integer,
  p_contact_mode text,
  p_contact_id uuid,
  p_confirm_possible_duplicate boolean,
  p_fill_blank_contact_fields boolean,
  p_opportunity_title text,
  p_owner_membership_id uuid,
  p_dnc_acknowledged boolean
)
returns public.plus_inquiry_conversion_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inq public.plus_inquiries%rowtype;
  v_contact public.plus_contacts%rowtype;
  v_contact_res public.plus_contact_write_result;
  v_opp_res public.plus_opportunity_write_result;
  v_contact_id uuid;
  v_dnc boolean := false;
  v_filled text[] := array[]::text[];
  v_title text := nullif(btrim(p_opportunity_title), '');
  v_kind text;
  v_channel text;
  v_pair record;
  v_skip text;
  v_granted integer := 0;
  v_skipped text[] := array[]::text[];
  v_result public.plus_inquiry_conversion_result;
begin
  perform public._require_plus_write(p_organization_id);
  if p_contact_mode is null or p_contact_mode not in ('create', 'link')
     or (p_contact_mode = 'create' and p_contact_id is not null)
     or (p_contact_mode = 'link' and p_contact_id is null)
     or (v_title is not null and length(v_title) > 200) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- the inquiry: one transition at a time (convert / convert, convert / dismiss serialize here)
  select * into v_inq from public.plus_inquiries
  where id = p_inquiry_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if p_expected_version is null or p_expected_version <> v_inq.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_inq.status <> 'new' then
    raise exception 'illegal_transition' using errcode = 'ZW004';   -- converted is final; dismissed must be reopened first
  end if;

  v_result.inquiry_id := v_inq.id;
  v_result.possible_duplicates := 0;
  v_result.consent_granted := 0;
  v_result.consent_skipped := array[]::text[];

  if p_contact_mode = 'create' then
    v_kind := case v_inq.relationship
                when 'family' then 'family_caregiver' when 'caregiver' then 'family_caregiver'
                when 'facility_staff' then 'facility_staff' when 'other' then 'other'
                else 'individual' end;
    v_channel := case v_inq.preferred_reply
                   when 'email' then 'email' when 'phone' then 'phone'
                   else case when v_inq.phone is not null then 'phone' else 'email' end end;
    -- the released contact-creation contract: duplicate warning, owner eligibility, validation, audit
    v_contact_res := public.plus_create_contact(p_organization_id, v_inq.name, v_inq.phone, v_inq.email, v_kind, null,
                                                v_channel, false, p_owner_membership_id, p_confirm_possible_duplicate);
    if v_contact_res.contact_id is null then
      v_result.outcome := 'possible_duplicates';                   -- nothing written; staff link or confirm
      v_result.possible_duplicates := v_contact_res.possible_duplicates;
      v_result.version := v_inq.version;
      return v_result;
    end if;
    v_contact_id := v_contact_res.contact_id;
  else
    -- link: lock the contact (serializes with plus_update_contact's DNC switch, consent writes and archiving)
    select * into v_contact from public.plus_contacts
    where id = p_contact_id and organization_id = p_organization_id
    for update;
    if not found or v_contact.status = 'redacted' then
      raise exception 'not_found' using errcode = 'ZW002';
    end if;
    if v_contact.status <> 'active' then
      raise exception 'illegal_transition' using errcode = 'ZW004';   -- archived contacts are history
    end if;
    v_dnc := v_contact.do_not_contact;
    if v_dnc and not coalesce(p_dnc_acknowledged, false) then
      raise exception 'do_not_contact_acknowledgement_required' using errcode = 'ZW004';
    end if;
    -- fill BLANK fields only, and only when asked; a populated field is never overwritten
    if coalesce(p_fill_blank_contact_fields, false) then
      if v_contact.phone is null and v_inq.phone is not null then v_filled := array_append(v_filled, 'phone'); end if;
      if v_contact.email is null and v_inq.email is not null then v_filled := array_append(v_filled, 'email'); end if;
      if cardinality(v_filled) > 0 then
        begin
          update public.plus_contacts
          set phone = case when 'phone' = any (v_filled) then v_inq.phone else phone end,
              email = case when 'email' = any (v_filled) then v_inq.email else email end
          where id = v_contact.id;
        exception when check_violation or not_null_violation then
          raise exception 'invalid_input' using errcode = 'ZW006';
        end;
        insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
        values (p_organization_id, 'plus_contact', v_contact.id, 'plus_contact_updated', auth.uid(), null,
                jsonb_build_object('fields', to_jsonb(v_filled), 'source', 'inquiry_conversion', 'inquiry_id', v_inq.id));
      end if;
    end if;
    v_contact_id := v_contact.id;
  end if;

  -- the released opportunity-creation contract (private_pay, new_inquiry, owner rules, validation, audit)
  v_opp_res := public.plus_create_opportunity(
    p_organization_id, v_contact_id,
    coalesce(v_title, v_inq.name || ' — ' || case v_inq.inquiry_type
                                               when 'quote' then 'Price question'
                                               when 'availability' then 'Availability question'
                                               when 'service_question' then 'Service question'
                                               when 'booking' then 'Booking interest'
                                               else 'Website inquiry' end),
    v_inq.inquiry_type, v_inq.service_type, 'web_inquiry', null, null, null, p_owner_membership_id);
  if not v_opp_res.changed then
    -- plus_create_opportunity's 30-second duplicate guard returned an EXISTING opportunity: never adopt it
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  update public.plus_opportunities set inquiry_id = v_inq.id where id = v_opp_res.opportunity_id;

  update public.plus_inquiries
  set status = 'converted', contact_id = v_contact_id, triaged_by = auth.uid(), triaged_at = now(), version = version + 1
  where id = v_inq.id
  returning * into v_inq;

  -- consent evidence (refinement B): ticked purposes x channels with an inquiry address; email -> email, phone -> voice
  for v_pair in
    select ch, pu from (values ('email', 'service_followup', 1), ('voice', 'service_followup', 2),
                               ('email', 'marketing', 3), ('voice', 'marketing', 4)) t(ch, pu, ord)
    where ((pu = 'service_followup' and v_inq.consent_followup) or (pu = 'marketing' and v_inq.consent_marketing))
      and ((ch = 'email' and v_inq.email is not null) or (ch = 'voice' and v_inq.phone is not null))
    order by ord
  loop
    v_skip := public._plus_inquiry_append_web_form_consent(p_organization_id, v_contact_id, v_inq, v_pair.ch, v_pair.pu);
    if v_skip is null then
      v_granted := v_granted + 1;
    else
      v_skipped := array_append(v_skipped, v_pair.ch || '/' || v_pair.pu || ':' || v_skip);
    end if;
  end loop;

  insert into public.plus_activities (organization_id, contact_id, opportunity_id, activity_type, actor_user_id)
  values (p_organization_id, v_contact_id, v_opp_res.opportunity_id, 'inquiry_converted', auth.uid());

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_inquiry', v_inq.id, 'plus_inquiry_converted', auth.uid(),
          jsonb_build_object('status', 'new'),
          jsonb_build_object('status', 'converted', 'contact_id', v_contact_id, 'opportunity_id', v_opp_res.opportunity_id,
                             'contact_mode', p_contact_mode, 'filled_fields', to_jsonb(v_filled),
                             'do_not_contact_acknowledged', v_dnc, 'consent_granted', v_granted,
                             'consent_skipped', to_jsonb(v_skipped)));

  v_result.outcome := 'converted';
  v_result.contact_id := v_contact_id;
  v_result.opportunity_id := v_opp_res.opportunity_id;
  v_result.consent_granted := v_granted;
  v_result.consent_skipped := v_skipped;
  v_result.version := v_inq.version;
  return v_result;
end;
$$;
comment on function public.plus_convert_inquiry(uuid, uuid, integer, text, uuid, boolean, boolean, text, uuid, boolean) is
  'NP-P2-S7-A (ZD-251, ZD-252, ZD-255). Plus WRITE (_require_plus_write: ZW002 no access, ZW001 read_only / read grant). ONE transaction under the inquiry row lock: status new + version (ZW003 stale, ZW004 not new). Contact: create (plus_create_contact unchanged -- possible duplicates without p_confirm_possible_duplicate -> outcome possible_duplicates, NOTHING written) or link an ACTIVE contact of the organization (unknown / foreign / redacted ZW002, archived ZW004; locked FOR UPDATE); a do-not-contact contact requires p_dnc_acknowledged (ZW004 otherwise; recorded in the audit); with p_fill_blank_contact_fields only NULL phone / email are filled -- never a populated field. Then exactly ONE private-pay opportunity via plus_create_opportunity (stage new_inquiry, source web_inquiry, inquiry type and service copied, owner per the existing rules; its 30-second duplicate guard is refused, ZW004), linked by inquiry_id (unique). Consent: ticked purposes only, email -> email and phone -> voice (never sms), only when the inquiry address equals the contact''s, never for do-not-contact, never older than the pair''s latest revocation; skipped pairs are returned with the reason. One inquiry_converted activity (ids only) and one plus_inquiry_converted audit row. Never a Core Request, Passenger, Trip or notification.';
revoke all on function public.plus_convert_inquiry(uuid, uuid, integer, text, uuid, boolean, boolean, text, uuid, boolean) from public, anon;
grant execute on function public.plus_convert_inquiry(uuid, uuid, integer, text, uuid, boolean, boolean, text, uuid, boolean) to authenticated;

create function public.plus_dismiss_inquiry(
  p_organization_id uuid,
  p_inquiry_id uuid,
  p_expected_version integer,
  p_reason text,
  p_note text
)
returns public.plus_inquiry_triage_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inq public.plus_inquiries%rowtype;
  v_note text := nullif(btrim(p_note), '');
  v_result public.plus_inquiry_triage_result;
begin
  perform public._require_plus_write(p_organization_id);
  if p_reason is null or p_reason not in ('spam', 'duplicate', 'not_relevant', 'out_of_area', 'other')
     or (p_reason = 'other' and v_note is null) or (v_note is not null and length(v_note) > 500) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  select * into v_inq from public.plus_inquiries where id = p_inquiry_id and organization_id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if p_expected_version is null or p_expected_version <> v_inq.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_inq.status <> 'new' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  update public.plus_inquiries
  set status = 'dismissed', dismiss_reason = p_reason, dismiss_note = v_note, triaged_by = auth.uid(), triaged_at = now(),
      version = version + 1
  where id = v_inq.id
  returning * into v_inq;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_inquiry', v_inq.id, 'plus_inquiry_dismissed', auth.uid(),
          jsonb_build_object('status', 'new'), jsonb_build_object('status', 'dismissed', 'reason', p_reason));
  v_result.inquiry_id := v_inq.id; v_result.status := v_inq.status; v_result.version := v_inq.version; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_dismiss_inquiry(uuid, uuid, integer, text, text) is
  'NP-P2-S7-A (ZD-248). Plus WRITE. new -> dismissed with a reason (spam | duplicate | not_relevant | out_of_area | other; note <= 500, required for other). ZW003 stale version; ZW004 not new; ZW002 unknown / foreign. Audited with the reason (never the note). Writes nothing else.';
revoke all on function public.plus_dismiss_inquiry(uuid, uuid, integer, text, text) from public, anon;
grant execute on function public.plus_dismiss_inquiry(uuid, uuid, integer, text, text) to authenticated;

create function public.plus_reopen_inquiry(p_organization_id uuid, p_inquiry_id uuid, p_expected_version integer)
returns public.plus_inquiry_triage_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inq public.plus_inquiries%rowtype;
  v_old_reason text;
  v_result public.plus_inquiry_triage_result;
begin
  perform public._require_plus_write(p_organization_id);
  select * into v_inq from public.plus_inquiries where id = p_inquiry_id and organization_id = p_organization_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if p_expected_version is null or p_expected_version <> v_inq.version then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;
  if v_inq.status <> 'dismissed' then
    raise exception 'illegal_transition' using errcode = 'ZW004';   -- converted is final; new is already open
  end if;
  v_old_reason := v_inq.dismiss_reason;
  update public.plus_inquiries
  set status = 'new', dismiss_reason = null, dismiss_note = null, triaged_by = null, triaged_at = null, version = version + 1
  where id = v_inq.id
  returning * into v_inq;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_inquiry', v_inq.id, 'plus_inquiry_reopened', auth.uid(),
          jsonb_build_object('status', 'dismissed', 'reason', v_old_reason), jsonb_build_object('status', 'new'));
  v_result.inquiry_id := v_inq.id; v_result.status := v_inq.status; v_result.version := v_inq.version; v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.plus_reopen_inquiry(uuid, uuid, integer) is
  'NP-P2-S7-A (ZD-248). Plus WRITE. dismissed -> new (the reason and note are cleared from the row; the audit keeps the old reason). Only a DISMISSED inquiry can reopen: converted is final, new ZW004. ZW003 stale version; ZW002 unknown / foreign.';
revoke all on function public.plus_reopen_inquiry(uuid, uuid, integer) from public, anon;
grant execute on function public.plus_reopen_inquiry(uuid, uuid, integer) to authenticated;
