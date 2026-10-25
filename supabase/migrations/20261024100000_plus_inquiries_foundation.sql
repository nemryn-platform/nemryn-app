-- NP-P2-S7-A -- Nemryn Plus public inquiry intake: DATA FOUNDATION (tables, RLS, additive constraint changes).
--
-- Canonical design: docs/product/NP-P2-S7-public-inquiry-intake-design.md (APPROVED: OD-S7-1 .. OD-S7-17 + refinements
-- A-D; decisions ZD-243 .. ZD-263). Functions are in the NEXT migration (20261024110000_plus_inquiries_rpcs.sql); this
-- file creates no client-callable function.
--
-- WHAT (additive; no earlier migration is modified; no Core table, function, policy or grant is changed):
--   1. plus_inquiry_public_access      -- Platform-Admin-managed ACTIVATION ALLOWLIST (refinement A). One row = this
--                                         organization may publish and receive public inquiries. Starts EMPTY. Class A:
--                                         RLS on, no policy, no privilege for any client or service role.
--   2. plus_inquiry_forms              -- the organization's inquiry form (one per organization in v1): draft /
--                                         published / disabled, server-generated public key, config_version, version.
--   3. plus_inquiries                  -- the staff triage inbox: new / converted / dismissed. Minimal personal data
--                                         (no address, postal code, date of birth, diagnosis, insurance or exact date).
--   4. plus_inquiry_rate_limit_events  -- the inquiry form's OWN durable rate-limit ledger (Core's is not reused). Class A.
--   5. plus_opportunities.inquiry_id   -- one inquiry -> at most one opportunity (composite FK + unique); set-once.
--   6. plus_communication_consents     -- + inquiry_id; captured_via + 'web_form'; consent_text_version required iff
--                                         web_form (refinement B; every existing S6 row satisfies the new rules).
--   7. plus_activities                 -- + activity type 'inquiry_converted' (ids only, no free text).
--
-- SERVICE TYPES (refinement C): an inquiry may carry only the EIGHT Plus opportunity service types (the
-- plus_opportunities_service_type_check set), never Core's ninth 'airport_transportation' (deferred for Plus). So every
-- inquiry's service converts to an opportunity service unchanged; no Plus enum is widened.
--
-- PRIVACY: synthetic data only until PD-10 (HIPAA / BAA) and PD-11 (retention / erasure) close. No purge exists (PD-11).

-- =============================================================================
-- 0. Internal immutable helpers used by CHECK constraints
-- =============================================================================
-- The eight Plus opportunity service types, in canonical order (identical to plus_opportunities_service_type_check).
create function public._plus_inquiry_service_type_list()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array['medical_appointment', 'dialysis', 'rehabilitation', 'hospital_discharge', 'recurring_care',
               'senior_medical', 'wheelchair_transportation', 'other']::text[];
$$;
comment on function public._plus_inquiry_service_type_list() is
  'NP-P2-S7-A. INTERNAL. The eight Plus opportunity service types (plus_opportunities_service_type_check), canonical order. Inquiries never carry airport_transportation (refinement C).';
revoke all on function public._plus_inquiry_service_type_list() from public, anon, authenticated, service_role;

-- A valid offered-service list: no NULL, no duplicate, every value one of the eight.
create function public._plus_inquiry_service_types_valid(p_types text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_types is not null
     and array_position(p_types, null) is null
     and cardinality(p_types) <= 8
     and p_types <@ public._plus_inquiry_service_type_list()
     and cardinality(p_types) = (select count(distinct v) from unnest(p_types) v);
$$;
comment on function public._plus_inquiry_service_types_valid(text[]) is
  'NP-P2-S7-A. INTERNAL (CHECK helper). True iff the array has no NULL, no duplicate and only the eight Plus service types.';
revoke all on function public._plus_inquiry_service_types_valid(text[]) from public, anon, authenticated, service_role;

-- =============================================================================
-- 1. plus_inquiry_public_access -- activation allowlist (refinement A)
-- =============================================================================
create table public.plus_inquiry_public_access (
  organization_id uuid primary key references public.organizations (id),
  reason text not null,
  enabled_by uuid not null references auth.users (id),
  enabled_at timestamptz not null default now(),
  constraint plus_inquiry_public_access_reason_check check (reason = btrim(reason) and length(reason) between 1 and 500)
);
comment on table public.plus_inquiry_public_access is
  'NP-P2-S7-A (refinement A, ZD-262). ACTIVATION ALLOWLIST, empty by default: a row means Nemryn has enabled public inquiries for that ONE organization. Required (with a published form, an active organization and Plus effective state write) for publishing a form and for every public form lookup / submission. Written only by platform_set_plus_inquiry_public_access (Platform Admin, audited); removing the row makes the form unavailable at once. Class A: RLS on, no policy, no privilege for anon / authenticated / service_role.';
alter table public.plus_inquiry_public_access enable row level security;
revoke all on table public.plus_inquiry_public_access from public, anon, authenticated, service_role;

-- =============================================================================
-- 2. plus_inquiry_forms
-- =============================================================================
create table public.plus_inquiry_forms (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  public_key text not null default ('inq_' || encode(extensions.gen_random_bytes(16), 'hex')),
  status text not null default 'draft',
  headline text not null,
  intro_text text,
  offered_service_types text[] not null default '{}'::text[],
  config_version integer not null default 1,
  consent_text_version text not null,
  version integer not null default 1,
  published_at timestamptz,
  published_by uuid references auth.users (id),
  disabled_at timestamptz,
  disabled_by uuid references auth.users (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint plus_inquiry_forms_organization_key unique (organization_id),          -- one form per organization (v1)
  constraint plus_inquiry_forms_id_organization_id_key unique (id, organization_id),
  constraint plus_inquiry_forms_public_key_key unique (public_key),
  constraint plus_inquiry_forms_public_key_check check (public_key ~ '^inq_[0-9a-f]{32}$'),
  constraint plus_inquiry_forms_status_check check (status in ('draft', 'published', 'disabled')),
  constraint plus_inquiry_forms_headline_check check (headline = btrim(headline) and length(headline) between 1 and 120),
  constraint plus_inquiry_forms_intro_check check (intro_text is null or (intro_text = btrim(intro_text) and length(intro_text) between 1 and 500)),
  constraint plus_inquiry_forms_services_check check (public._plus_inquiry_service_types_valid(offered_service_types)),
  constraint plus_inquiry_forms_config_version_check check (config_version >= 1),
  constraint plus_inquiry_forms_version_check check (version >= 1),
  constraint plus_inquiry_forms_consent_text_version_check check (consent_text_version ~ '^plus-inquiry-consent-v[1-9][0-9]*$'),
  constraint plus_inquiry_forms_published_check check (status <> 'published' or (published_at is not null and published_by is not null)),
  constraint plus_inquiry_forms_disabled_check check (status <> 'disabled' or (disabled_at is not null and disabled_by is not null))
);
comment on table public.plus_inquiry_forms is
  'NP-P2-S7-A (ZD-247). TENANT-OWNED. The organization''s public inquiry form: draft / published / disabled. public_key (inq_ + 128 random bits, a namespace distinct from Core form_ keys) is server-generated, stable across edits and re-publishing, and is an address, not a secret. Edits apply live and increment config_version (recorded on every inquiry). SELECT via RLS plus_can_read; writes only through plus_save / publish / disable_inquiry_form (Organization Admin, Plus write). Public reads only through the service_role get_public_plus_inquiry_form.';
comment on column public.plus_inquiry_forms.version is 'Optimistic-concurrency token: every staff write must send the version it read (ZW003 otherwise).';
comment on column public.plus_inquiry_forms.config_version is 'The public configuration version: +1 on every saved content change; an inquiry records the version the person submitted.';

create trigger plus_inquiry_forms_set_updated_at before update on public.plus_inquiry_forms
  for each row execute function public.set_updated_at();
create trigger plus_inquiry_forms_prevent_org_change before update on public.plus_inquiry_forms
  for each row execute function public.prevent_organization_id_change();

alter table public.plus_inquiry_forms enable row level security;
revoke all on table public.plus_inquiry_forms from public, anon, authenticated, service_role;
grant select on table public.plus_inquiry_forms to authenticated;
create policy plus_inquiry_forms_select_plus on public.plus_inquiry_forms
  for select to authenticated
  using (public.plus_can_read(organization_id));

-- =============================================================================
-- 3. plus_inquiries
-- =============================================================================
create table public.plus_inquiries (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  form_id uuid not null,
  form_config_version integer not null,
  idempotency_key text not null,
  name text not null,
  phone text,
  email text,
  preferred_reply text not null default 'either',
  relationship text,
  inquiry_type text not null,
  service_type text,
  timeframe text,
  question text not null,
  consent_followup boolean not null default false,
  consent_marketing boolean not null default false,
  consent_text_version text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_path text,
  referrer_host text,
  status text not null default 'new',
  dismiss_reason text,
  dismiss_note text,
  contact_id uuid,
  triaged_by uuid references auth.users (id),
  triaged_at timestamptz,
  received_at timestamptz not null default now(),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint plus_inquiries_id_organization_id_key unique (id, organization_id),
  -- lets a web_form consent row cite the inquiry AND the contact it was converted to (composite FK on the ledger)
  constraint plus_inquiries_id_organization_contact_key unique (id, organization_id, contact_id),
  constraint plus_inquiries_idempotency_key unique (organization_id, idempotency_key),
  constraint plus_inquiries_form_fkey foreign key (form_id, organization_id) references public.plus_inquiry_forms (id, organization_id),
  constraint plus_inquiries_contact_fkey foreign key (contact_id, organization_id) references public.plus_contacts (id, organization_id),
  constraint plus_inquiries_idempotency_format_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  constraint plus_inquiries_form_config_version_check check (form_config_version >= 1),
  constraint plus_inquiries_name_check check (name = btrim(name) and length(name) between 1 and 120 and name !~ '[[:cntrl:]]'),
  -- phone and email use the plus_contacts rules exactly, so a converted inquiry always yields a valid contact
  constraint plus_inquiries_phone_check check (
    phone is null or (
      phone = btrim(phone) and length(phone) <= 40
      and phone ~ '^[0-9+(). -]+( ?(x|ext\.?) ?[0-9]{1,6})?$'
      and length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 20
    )
  ),
  constraint plus_inquiries_email_check check (
    email is null or (email = lower(btrim(email)) and length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  constraint plus_inquiries_reachable_check check (phone is not null or email is not null),
  constraint plus_inquiries_preferred_reply_check check (
    (preferred_reply = 'either')
    or (preferred_reply = 'phone' and phone is not null)
    or (preferred_reply = 'email' and email is not null)
  ),
  constraint plus_inquiries_relationship_check check (relationship is null or relationship in ('self', 'family', 'caregiver', 'facility_staff', 'other')),
  -- identical to plus_opportunities.inquiry_type (1:1 on conversion)
  constraint plus_inquiries_inquiry_type_check check (inquiry_type in ('quote', 'availability', 'service_question', 'booking', 'other')),
  constraint plus_inquiries_service_type_check check (service_type is null or service_type = any (public._plus_inquiry_service_type_list())),
  constraint plus_inquiries_timeframe_check check (timeframe is null or timeframe in ('asap', 'this_week', 'this_month', 'later', 'not_sure')),
  constraint plus_inquiries_question_check check (question = btrim(question) and length(question) between 1 and 500),
  constraint plus_inquiries_consent_text_version_check check (consent_text_version ~ '^plus-inquiry-consent-v[1-9][0-9]*$'),
  -- acquisition: the Core request_acquisition_attributions rules (values arrive through _sanitize_acquisition)
  constraint plus_inquiries_acquisition_lengths_check check (
    (utm_source is null or char_length(utm_source) between 1 and 120)
    and (utm_medium is null or char_length(utm_medium) between 1 and 120)
    and (utm_campaign is null or char_length(utm_campaign) between 1 and 160)
    and (utm_content is null or char_length(utm_content) between 1 and 160)
    and (utm_term is null or char_length(utm_term) between 1 and 160)
  ),
  constraint plus_inquiries_landing_path_check check (
    landing_path is null or (char_length(landing_path) between 1 and 300
                             and landing_path ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$' and landing_path not like '//%')
  ),
  constraint plus_inquiries_referrer_host_check check (
    referrer_host is null or (char_length(referrer_host) between 1 and 253 and referrer_host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
                              and referrer_host not like '%..%' and referrer_host not like '%-.%' and referrer_host not like '%.-%')
  ),
  -- lifecycle: new -> converted (final) | dismissed (reason) -> new (reopen)
  constraint plus_inquiries_status_check check (status in ('new', 'converted', 'dismissed')),
  constraint plus_inquiries_dismiss_reason_check check (
    (status = 'dismissed') = (dismiss_reason is not null)
    and (dismiss_reason is null or dismiss_reason in ('spam', 'duplicate', 'not_relevant', 'out_of_area', 'other'))
  ),
  constraint plus_inquiries_dismiss_note_check check (
    (dismiss_note is null or (status = 'dismissed' and dismiss_note = btrim(dismiss_note) and length(dismiss_note) between 1 and 500))
    and (dismiss_reason is distinct from 'other' or dismiss_note is not null)
  ),
  constraint plus_inquiries_converted_check check ((status = 'converted') = (contact_id is not null)),
  constraint plus_inquiries_triaged_check check (
    (status = 'new' and triaged_at is null and triaged_by is null)
    or (status <> 'new' and triaged_at is not null and triaged_by is not null)
  ),
  constraint plus_inquiries_version_check check (version >= 1)
);
comment on table public.plus_inquiries is
  'NP-P2-S7-A (ZD-243, ZD-248). TENANT-OWNED triage inbox of public inquiries. A submission creates ONLY this row (no contact, opportunity, Core Request, Passenger, Trip, notification or consent). Staff convert (create or link a contact + one private-pay opportunity; final) or dismiss with a reason (reopen -> new). The consent ticks are what the person ticked, NOT consent on record: ledger rows are written only at conversion (ZD-252). Column-level SELECT via RLS plus_can_read (idempotency_key is never client-readable); writes only through the service_role submission RPC and the Plus write RPCs.';
comment on column public.plus_inquiries.consent_followup is 'The person ticked the optional, unticked-by-default follow-up box. Not consent on record until staff convert (ZD-252).';
comment on column public.plus_inquiries.consent_marketing is 'The person ticked the optional, unticked-by-default marketing box. Not consent on record until staff convert (ZD-252).';
comment on column public.plus_inquiries.form_config_version is 'The form configuration version the person submitted (must equal the live version at submit; server-checked).';

create index plus_inquiries_org_status_received_idx on public.plus_inquiries (organization_id, status, received_at desc, id);
create index plus_inquiries_org_email_idx on public.plus_inquiries (organization_id, email) where email is not null;
create index plus_inquiries_org_phone_digits_idx
  on public.plus_inquiries (organization_id, (regexp_replace(phone, '[^0-9]', '', 'g'))) where phone is not null;

create trigger plus_inquiries_set_updated_at before update on public.plus_inquiries
  for each row execute function public.set_updated_at();
create trigger plus_inquiries_prevent_org_change before update on public.plus_inquiries
  for each row execute function public.prevent_organization_id_change();

alter table public.plus_inquiries enable row level security;
revoke all on table public.plus_inquiries from public, anon, authenticated, service_role;
-- column-level SELECT only: the idempotency key is never client-readable (the ZD-240 pattern)
grant select (id, organization_id, form_id, form_config_version, name, phone, email, preferred_reply, relationship,
              inquiry_type, service_type, timeframe, question, consent_followup, consent_marketing, consent_text_version,
              utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path, referrer_host, status,
              dismiss_reason, dismiss_note, contact_id, triaged_by, triaged_at, received_at, version, updated_at)
  on table public.plus_inquiries to authenticated;
create policy plus_inquiries_select_plus on public.plus_inquiries
  for select to authenticated
  using (public.plus_can_read(organization_id));

-- =============================================================================
-- 4. plus_inquiry_rate_limit_events -- own ledger (Core's public_intake_rate_limit_events is not reused)
-- =============================================================================
create table public.plus_inquiry_rate_limit_events (
  id bigint generated always as identity primary key,
  form_public_key text not null,
  client_key text not null,
  occurred_at timestamptz not null default now(),
  constraint plus_inquiry_rate_limit_form_key_check check (form_public_key ~ '^inq_[0-9a-f]{32}$'),
  constraint plus_inquiry_rate_limit_client_key_check check (client_key ~ '^[0-9a-f]{64}$')
);
comment on table public.plus_inquiry_rate_limit_events is
  'NP-P2-S7-A (ZD-254). Durable rate-limit ledger of the public inquiry form: one row per attempt that passed the check. client_key is a one-way salted SHA-256 of the client IP computed by the server (never a raw IP). Written only by check_and_record_plus_inquiry_rate_limit (service_role). Class A: RLS on, no policy, no privilege for any client or service role. No purge until PD-11.';
create index plus_inquiry_rate_limit_form_idx on public.plus_inquiry_rate_limit_events (form_public_key, occurred_at);
create index plus_inquiry_rate_limit_client_idx on public.plus_inquiry_rate_limit_events (client_key, occurred_at);
alter table public.plus_inquiry_rate_limit_events enable row level security;
revoke all on table public.plus_inquiry_rate_limit_events from public, anon, authenticated, service_role;

-- =============================================================================
-- 5. plus_opportunities.inquiry_id (one inquiry -> at most one opportunity; set once)
-- =============================================================================
alter table public.plus_opportunities add column inquiry_id uuid;
comment on column public.plus_opportunities.inquiry_id is
  'NP-P2-S7-A (ZD-251). The web inquiry this opportunity was converted from (plus_convert_inquiry); NULL otherwise. Composite FK (never another tenant''s inquiry); unique (one inquiry -> at most one opportunity); set once, never changed or cleared (trigger).';
alter table public.plus_opportunities
  add constraint plus_opportunities_inquiry_fkey
  foreign key (inquiry_id, organization_id) references public.plus_inquiries (id, organization_id);
create unique index plus_opportunities_inquiry_id_key on public.plus_opportunities (inquiry_id) where inquiry_id is not null;

create function public._plus_opportunity_inquiry_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.inquiry_id is not null and new.inquiry_id is distinct from old.inquiry_id then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  return new;
end;
$$;
comment on function public._plus_opportunity_inquiry_immutable() is
  'NP-P2-S7-A. INTERNAL trigger: plus_opportunities.inquiry_id may be set once (NULL -> value) and is never changed or cleared afterwards (ZW004).';
revoke all on function public._plus_opportunity_inquiry_immutable() from public, anon, authenticated, service_role;
create trigger plus_opportunities_inquiry_immutable before update of inquiry_id on public.plus_opportunities
  for each row execute function public._plus_opportunity_inquiry_immutable();

-- =============================================================================
-- 6. plus_communication_consents (refinement B). Verified against the deployed S6 definitions
--    (20261023100000): every existing row has captured_via in the staff methods or do_not_contact and
--    consent_text_version NULL, so each replaced / added constraint validates without a change to any row.
--    ADD COLUMN does not fire the append-only row triggers. No S6 function is replaced: the staff path
--    (_plus_append_consent) still accepts only the four staff methods, so web_form rows can come only from
--    plus_convert_inquiry.
-- =============================================================================
alter table public.plus_communication_consents add column inquiry_id uuid;
comment on column public.plus_communication_consents.inquiry_id is
  'NP-P2-S7-A (ZD-252). Set only on web_form grants: the inquiry whose ticked box is the evidence. Composite FK (inquiry, organization, contact): the inquiry must have been converted to this same contact.';
alter table public.plus_communication_consents
  add constraint plus_consents_inquiry_fkey
  foreign key (inquiry_id, organization_id, contact_id) references public.plus_inquiries (id, organization_id, contact_id);

alter table public.plus_communication_consents drop constraint plus_consents_captured_via_check;
alter table public.plus_communication_consents
  add constraint plus_consents_captured_via_check check (
    captured_via in ('verbal_phone', 'in_person', 'written', 'email_reply', 'do_not_contact', 'web_form')
  );
-- S6 reserved this as "consent_text_version is null"; P2-S7: required iff web_form, with the server's version format
alter table public.plus_communication_consents drop constraint plus_consents_text_version_check;
alter table public.plus_communication_consents
  add constraint plus_consents_text_version_check check (
    (captured_via = 'web_form') = (consent_text_version is not null)
    and (consent_text_version is null or consent_text_version ~ '^plus-inquiry-consent-v[1-9][0-9]*$')
  );
-- web_form rows: always a grant from an inquiry; never a correction; no staff note
alter table public.plus_communication_consents
  add constraint plus_consents_web_form_check check (
    (captured_via = 'web_form') = (inquiry_id is not null)
    and (captured_via <> 'web_form' or (status = 'granted' and corrects_consent_id is null and evidence_note is null))
  );
comment on column public.plus_communication_consents.captured_via is
  'Staff methods verbal_phone / in_person / written / email_reply; do_not_contact = system revocation written when Do not contact was switched on (ZD-233); web_form = a box the person ticked on the public inquiry form, recorded by the staff member who converted the inquiry (ZD-252). do_not_contact and web_form rows are never corrected.';
grant select (inquiry_id) on table public.plus_communication_consents to authenticated;

-- =============================================================================
-- 7. plus_activities: + inquiry_converted (opportunity + contact, ids only)
-- =============================================================================
alter table public.plus_activities drop constraint plus_activities_activity_type_check;
alter table public.plus_activities
  add constraint plus_activities_activity_type_check check (
    activity_type in ('note', 'call_logged', 'email_logged', 'meeting_logged', 'owner_changed', 'record_archived', 'stage_changed',
                      'request_linked', 'attribution_changed', 'quote_sent', 'quote_status_changed', 'quote_revised',
                      'inquiry_converted')
  );
alter table public.plus_activities
  add constraint plus_activities_inquiry_subject_check check (
    activity_type <> 'inquiry_converted' or (opportunity_id is not null and contact_id is not null and body is null)
  );
