-- NP-CORE-PLUS-REQUEST-02A -- Nemryn Plus: create a contact from an existing Core Request and link it, atomically.
--
-- Canonical design: docs/reports/NP-CORE-PLUS-REQUEST-01-design-review.txt (sections 3 and 4) and
-- docs/reports/NP-CORE-PLUS-REQUEST-02-guard-and-ordering.txt (sections 1 and 2); decisions ZD-294 .. ZD-301.
--
-- WHAT (forward-only, additive; references only Core and earlier Plus objects -- no forward FK):
--   1. plus_request_contact_enablements  -- ACTIVATION GUARD, empty by default. One row = Nemryn has enabled "Add
--                                           contact from a Request" for that ONE organization. data_class is
--                                           CHECKed to 'synthetic': a real (live) tenant cannot be enabled without a
--                                           later, reviewed migration (ZD-299). Class A: no privilege for any role.
--   2. platform_set_ / platform_get_plus_request_contact_enablement  -- Platform Admin only, reason required, audited.
--   3. plus_request_contact_enabled       -- tenant visibility helper (Plus readers only; a boolean, nothing else).
--   4. plus_create_contact_for_request    -- ONE transaction: plus_create_contact (unchanged) then plus_link_request
--                                           (unchanged), plus one provenance audit row.
-- No existing table, column, constraint, policy, grant, function or signature is changed.
--
-- GATE ORDER inside plus_create_contact_for_request: Plus write -> Core request-read role -> activation row (FOR
-- SHARE) -> Request existence -> attribution -> create -> link. The gate runs AFTER authorization, so only authorized
-- Plus writers can learn whether the organization is enabled. FOR SHARE conflicts with the platform DELETE, so a
-- disable and an in-flight creation serialize: the creation commits fully first, or waits and is refused.
-- The platform function locks the organization FOR NO KEY UPDATE (not FOR UPDATE): FOR UPDATE would conflict with the
-- FOR KEY SHARE that every foreign-key check on organizations takes (blocking unrelated tenant writes during a toggle),
-- and would open a narrow lock-order deadlock window against a creation that takes the activation row between the
-- platform function's organization lock and its DELETE. FOR NO KEY UPDATE still serializes enablement changes.
--
-- ATOMICITY / DUPLICATES: plus_request_attributions.request_id is the PRIMARY KEY. Two concurrent creations for the
-- same Request both insert a contact, then serialize on that key inside plus_link_request; the loser raises ZW004
-- already_attributed, which aborts its whole transaction -- including the contact it created. No orphan, no duplicate.
-- A replay after a commit returns outcome already_linked without writing.
--
-- BOUNDARY (plus-access-model section 4): the function reads only the existence of the Request (id, organization_id).
-- It NEVER reads requester_* or passenger fields: every contact value comes from staff, reviewed in the form. It never
-- creates, changes or locks a Core Request (beyond the ordinary foreign-key check of the attribution row), Passenger,
-- Trip, recurring arrangement, acquisition snapshot or billing row; never creates an opportunity, task, quote or
-- consent row; never sets do_not_contact by itself.
--
-- AUDIT: plus_create_contact writes plus_contact_created and plus_link_request writes plus_request_linked (+ one
-- request_linked activity), as released. This function adds plus_contact_created_from_request ({request_id} only, no
-- contact values). Enablement changes write platform_plus_request_contact_enablement_changed with the reason.
-- No new plus_activities type.
--
-- PRIVACY: synthetic data only (ZD-299). The migration enables NO organization in any environment.

-- =============================================================================
-- 1. plus_request_contact_enablements -- activation guard (class A)
-- =============================================================================
create table public.plus_request_contact_enablements (
  organization_id uuid primary key references public.organizations (id),
  data_class text not null,
  reason text not null,
  enabled_by uuid not null references auth.users (id),
  enabled_at timestamptz not null default now(),
  -- live (real-customer) enablement is impossible until PD-10 / PD-11 are resolved and a reviewed migration widens this
  constraint plus_request_contact_enablements_data_class_check check (data_class = 'synthetic'),
  constraint plus_request_contact_enablements_reason_check check (reason = btrim(reason) and length(reason) between 1 and 500)
);
comment on table public.plus_request_contact_enablements is
  'NP-CORE-PLUS-REQUEST-02A (ZD-299). ACTIVATION GUARD, empty by default: a row means Nemryn has enabled "Add contact from a Request" for that ONE organization, attested as synthetic data (data_class CHECK = synthetic; live is impossible). Required by plus_create_contact_for_request, which takes the row FOR SHARE. Written only by platform_set_plus_request_contact_enablement (Platform Admin, audited); deleting the row disables the feature at once. Class A: RLS on, no policy, no privilege for anon / authenticated / service_role.';
alter table public.plus_request_contact_enablements enable row level security;
revoke all on table public.plus_request_contact_enablements from public, anon, authenticated, service_role;

-- =============================================================================
-- 2. result types
-- =============================================================================
create type public.plus_request_contact_enablement_result as (organization_id uuid, enabled boolean, data_class text, changed boolean);
comment on type public.plus_request_contact_enablement_result is
  'NP-CORE-PLUS-REQUEST-02A. Result of platform_set_plus_request_contact_enablement: the state after the call; changed=false = nothing written.';

create type public.plus_request_contact_result as (
  outcome text,               -- linked | possible_duplicates (nothing written) | already_linked (nothing written)
  request_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  possible_duplicates integer,
  updated_at timestamptz      -- the attribution version token (NULL for possible_duplicates)
);
comment on type public.plus_request_contact_result is
  'NP-CORE-PLUS-REQUEST-02A. Result of plus_create_contact_for_request. linked: one contact created and linked. possible_duplicates: NOTHING written (confirm, or link an existing contact). already_linked: the Request already has an attribution (its ids are returned); NOTHING written.';

-- =============================================================================
-- 3. Platform Admin: activation guard
-- =============================================================================
create function public.platform_set_plus_request_contact_enablement(
  p_organization_id uuid,
  p_enabled boolean,
  p_data_class text,
  p_reason text
)
returns public.plus_request_contact_enablement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_old public.plus_request_contact_enablements%rowtype;
  v_result public.plus_request_contact_enablement_result;
begin
  perform public._require_platform_admin();
  if p_enabled is null or v_reason is null or length(v_reason) > 500
     or (p_enabled and p_data_class is distinct from 'synthetic')
     or (not p_enabled and p_data_class is not null and p_data_class <> 'synthetic') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  -- serializes enablement changes per organization; NO KEY so the foreign-key checks of in-flight creations are not blocked
  perform 1 from public.organizations where id = p_organization_id for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  select * into v_old from public.plus_request_contact_enablements where organization_id = p_organization_id;

  v_result.organization_id := p_organization_id;
  v_result.enabled := p_enabled;
  v_result.data_class := case when p_enabled then 'synthetic' end;
  if (v_old.organization_id is not null) = p_enabled then
    v_result.data_class := v_old.data_class;
    v_result.changed := false;
    return v_result;
  end if;

  if p_enabled then
    insert into public.plus_request_contact_enablements (organization_id, data_class, reason, enabled_by)
    values (p_organization_id, 'synthetic', v_reason, auth.uid());
  else
    -- waits for any in-flight creation holding the row FOR SHARE
    delete from public.plus_request_contact_enablements where organization_id = p_organization_id;
  end if;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (p_organization_id, 'organization', p_organization_id, 'platform_plus_request_contact_enablement_changed', auth.uid(),
          jsonb_build_object('enabled', v_old.organization_id is not null, 'data_class', v_old.data_class),
          jsonb_build_object('enabled', p_enabled, 'data_class', v_result.data_class), v_reason);
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.platform_set_plus_request_contact_enablement(uuid, boolean, text, text) is
  'NP-CORE-PLUS-REQUEST-02A (ZD-299). PLATFORM ADMIN only (_require_platform_admin: ZW001 without a uid, ZW002 otherwise -- an Organization Admin can never enable their own organization). Enables (p_data_class must be ''synthetic'': an explicit attestation, also enforced by the table CHECK) or disables "Add contact from a Request" for ONE organization; reason 1-500 required both ways (ZW006); unknown organization ZW002; no change -> changed=false, nothing written. Disabling waits for in-flight creations. Audited as platform_plus_request_contact_enablement_changed with the reason.';
revoke all on function public.platform_set_plus_request_contact_enablement(uuid, boolean, text, text) from public, anon;
grant execute on function public.platform_set_plus_request_contact_enablement(uuid, boolean, text, text) to authenticated;

create function public.platform_get_plus_request_contact_enablement(p_organization_id uuid)
returns table (organization_id uuid, enabled boolean, data_class text, enabled_at timestamptz, enabled_by_name text, reason text)
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
  select p_organization_id, e.organization_id is not null, e.data_class, e.enabled_at,
         case when e.enabled_by is null then null else public._plus_staff_name(e.enabled_by) end, e.reason
  from (select 1) one
  left join public.plus_request_contact_enablements e on e.organization_id = p_organization_id;
end;
$$;
comment on function public.platform_get_plus_request_contact_enablement(uuid) is
  'NP-CORE-PLUS-REQUEST-02A (ZD-299). PLATFORM ADMIN only. One row: whether "Add contact from a Request" is enabled for the organization, its data class, since when, by whom and why.';
revoke all on function public.platform_get_plus_request_contact_enablement(uuid) from public, anon;
grant execute on function public.platform_get_plus_request_contact_enablement(uuid) to authenticated;

-- =============================================================================
-- 4. tenant visibility helper
-- =============================================================================
create function public.plus_request_contact_enabled(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.plus_can_read(p_organization_id)
     and exists (select 1 from public.plus_request_contact_enablements e where e.organization_id = p_organization_id);
$$;
comment on function public.plus_request_contact_enabled(uuid) is
  'NP-CORE-PLUS-REQUEST-02A (ZD-300). Authenticated; never raises. True iff the caller may read Plus data of the organization AND "Add contact from a Request" is enabled for it. False for everyone else (no oracle). No reason, actor or data class. For deciding whether to OFFER the action only; plus_create_contact_for_request enforces the gate itself.';
revoke all on function public.plus_request_contact_enabled(uuid) from public, anon;
grant execute on function public.plus_request_contact_enabled(uuid) to authenticated;

-- =============================================================================
-- 5. plus_create_contact_for_request (Plus write AND Core request read AND activation)
-- =============================================================================
create function public.plus_create_contact_for_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_display_name text,
  p_phone text,
  p_email text,
  p_contact_kind text,
  p_preferred_channel text,
  p_do_not_contact boolean,
  p_owner_membership_id uuid,
  p_confirm_possible_duplicate boolean
)
returns public.plus_request_contact_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attr public.plus_request_attributions%rowtype;
  v_contact public.plus_contact_write_result;
  v_link public.plus_request_attribution_result;
  v_result public.plus_request_contact_result;
begin
  perform public._require_plus_write(p_organization_id);
  perform public._plus_require_core_request_read(p_organization_id);
  -- activation guard (ZD-299): held until commit, so a concurrent disable waits for this creation or refuses it
  perform 1 from public.plus_request_contact_enablements e where e.organization_id = p_organization_id for share;
  if not found then
    raise exception 'request_contact_not_enabled' using errcode = 'ZW004';
  end if;
  -- existence only (foreign and unknown are indistinguishable); no requester or passenger column is read
  if p_request_id is null
     or not exists (select 1 from public.transportation_requests r where r.id = p_request_id and r.organization_id = p_organization_id) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_result.request_id := p_request_id;
  v_result.possible_duplicates := 0;

  -- already attributed (a replay, or someone linked it first): nothing is created
  select * into v_attr from public.plus_request_attributions a
  where a.request_id = p_request_id and a.organization_id = p_organization_id;
  if found then
    v_result.outcome := 'already_linked';
    v_result.contact_id := v_attr.contact_id;
    v_result.opportunity_id := v_attr.opportunity_id;
    v_result.updated_at := v_attr.updated_at;
    return v_result;
  end if;

  -- the released contact-creation contract: validation (ZW006), duplicate warning, owner eligibility, audit
  v_contact := public.plus_create_contact(p_organization_id, p_display_name, p_phone, p_email, p_contact_kind, null,
                                          p_preferred_channel, p_do_not_contact, p_owner_membership_id,
                                          p_confirm_possible_duplicate);
  if v_contact.contact_id is null then
    v_result.outcome := 'possible_duplicates';                       -- nothing written
    v_result.possible_duplicates := v_contact.possible_duplicates;
    return v_result;
  end if;

  -- the released link contract; a concurrent attribution makes it raise ZW004, rolling back the contact above
  v_link := public.plus_link_request(p_organization_id, p_request_id, v_contact.contact_id, null);
  if not v_link.changed then
    raise exception 'already_attributed' using errcode = 'ZW004';   -- defensive: impossible for a new contact
  end if;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'plus_contact', v_contact.contact_id, 'plus_contact_created_from_request', auth.uid(), null,
          jsonb_build_object('request_id', p_request_id));

  v_result.outcome := 'linked';
  v_result.contact_id := v_link.contact_id;
  v_result.opportunity_id := v_link.opportunity_id;
  v_result.possible_duplicates := v_contact.possible_duplicates;
  v_result.updated_at := v_link.updated_at;
  return v_result;
end;
$$;
comment on function public.plus_create_contact_for_request(uuid, uuid, text, text, text, text, text, boolean, uuid, boolean) is
  'NP-CORE-PLUS-REQUEST-02A (ZD-294 .. ZD-300). Plus WRITE (_require_plus_write: ZW002 no access, ZW001 read_only / read grant) + Core request read (ZW002) + activation guard (ZW004 request_contact_not_enabled; row held FOR SHARE). ONE transaction on an EXISTING Request of p_organization_id (unknown / foreign ZW002): already attributed -> outcome already_linked, nothing written; otherwise plus_create_contact UNCHANGED with the staff-reviewed values (ZW006 invalid; possible duplicates without p_confirm_possible_duplicate -> outcome possible_duplicates, NOTHING written), then plus_link_request UNCHANGED (link_method linked_existing_request, no opportunity; a concurrent attribution -> ZW004 and the new contact is rolled back). Adds one plus_contact_created_from_request audit row ({request_id} only). Never reads requester or passenger fields; never creates an opportunity, consent row, Request, Passenger or Trip; never changes the Request.';
revoke all on function public.plus_create_contact_for_request(uuid, uuid, text, text, text, text, text, boolean, uuid, boolean) from public, anon;
grant execute on function public.plus_create_contact_for_request(uuid, uuid, text, text, text, text, text, boolean, uuid, boolean) to authenticated;
