-- P1-PILOT-S4A — Tenant Website Intake + Request Hub Integration
-- Foundation.
--
-- Closes the gap `transportation_requests`' own table comment has
-- documented since 20260830130900: "No anonymous access of any kind
-- exists in this phase — public intake is deferred to a future trusted
-- server-side path." This migration IS that future path, built the same
-- way every other trusted-write boundary in this schema is built: a
-- narrow, SECURITY DEFINER RPC with an explicit, non-negotiable input
-- surface — never a table grant, never an RLS policy for `anon`.
--
-- The one existing precedent for ANY anon-callable database entry point
-- is `get_driver_invite_preview` (20260903100200_driver_invites.sql) —
-- a read-only function authorized purely by possession of an opaque
-- token, never by `auth.uid()`/membership. This migration follows the
-- identical shape for a WRITE: the external caller carries an opaque
-- `external_id` naming exactly one configured intake integration; the
-- organization is resolved ENTIRELY from that integration row, never
-- accepted as a parameter, exactly like `redeem_driver_invite` resolves
-- its own organization entirely from the invite row rather than taking
-- an `organization_id` parameter at all.
--
-- LOCKED DECISIONS carried forward from the phase brief: the public
-- intake path stops at Request Hub's existing `pending` state — no
-- Trip, Driver, Vehicle, Passenger, or Membership is ever created or
-- merged by this path. `source` is hard-coded `'web'`, never a
-- parameter. No `organization_id` parameter exists anywhere in the new
-- function's signature. New intake integrations default to inactive.
-- No rate limiting is implemented here — see the function's own comment
-- and the phase report for why, and what activation requires.

-- =============================================================================
-- A. request_intake_integrations — the tenant intake configuration
-- =============================================================================
-- One row per configured external intake channel (today: exactly one
-- `integration_type`, 'website' — the CHECK constraint is intentionally
-- narrow rather than an open enum, since only this one type is designed
-- and validated in this phase). `external_id` is the ONLY thing an
-- external caller ever presents — it is PUBLIC, not a secret (comment on
-- the column below), and grants nothing beyond "create a request for
-- exactly this organization" through the equally narrow RPC in section C.
--
-- Deliberately has NO RLS policy and NO grant to any role (`anon` or
-- `authenticated`) — every read of this table happens exclusively
-- inside the SECURITY DEFINER function below, which runs as the
-- function owner (bypasses RLS the same way every other SECURITY
-- DEFINER function in this schema already does for its own tables).
-- This is intentionally more closed than `transportation_requests`
-- itself: there is no product surface in this phase for an operator to
-- browse or self-manage their own integration row (S4A explicitly scopes
-- OUT "a general integrations platform"), so no read policy is added
-- speculatively. A future phase that builds operator-facing management
-- UI adds its own narrow SELECT (and mutation) policy at that time.
create table public.request_intake_integrations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  external_id text not null,
  integration_type text not null default 'website' check (integration_type in ('website')),
  is_active boolean not null default false,
  -- Optional allow-list of Origin header values this integration
  -- accepts submissions from. NEVER the authorization boundary (a
  -- non-browser caller can send any Origin header it likes) — purely a
  -- secondary, defense-in-depth signal the RPC checks only when this
  -- array is configured non-empty. NULL/empty means "no Origin
  -- restriction configured for this integration" (still safe: tenant
  -- isolation is enforced entirely by external_id -> organization_id
  -- resolution, not by Origin).
  allowed_origins text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite-FK anchor (this schema's own established cross-tenant
  -- protection convention — see transportation_requests' own `unique
  -- (id, organization_id)`): lets transportation_requests reference
  -- (id, organization_id) together below, so the database itself
  -- physically cannot store a transportation_request whose
  -- organization_id disagrees with the integration it names.
  unique (id, organization_id),
  -- Globally unique (not per-organization) — the whole point of this
  -- column is that a caller presents ONLY this value, with no other
  -- context, and the correct organization is looked up FROM it; a
  -- per-org-scoped uniqueness would require already knowing the
  -- organization to look it up, defeating the purpose.
  unique (external_id)
);

comment on table public.request_intake_integrations is
  'Tenant website intake configuration (P1-PILOT-S4A). One row = one configured external channel allowed to submit a transportation_requests row for its own organization, via submit_public_transportation_request only. New rows default is_active=false (disabled-by-default contract — an integration must be deliberately activated, never silently open). No RLS policy, no grant to anon/authenticated: only the SECURITY DEFINER function below ever reads this table.';

comment on column public.request_intake_integrations.external_id is
  'The PUBLIC identifier a tenant website embeds to identify itself. Treated as public, not a secret — security does not depend on this value being undiscoverable; it selects a tenant, it does not authenticate a caller. Grants nothing beyond submitting the tightly-scoped Request payload via submit_public_transportation_request.';

comment on column public.request_intake_integrations.is_active is
  'Disabled-by-default (P1-PILOT-S4A §Disabled-by-default contract). An inactive integration is indistinguishable, from the public caller''s point of view, from a nonexistent one — submit_public_transportation_request raises the identical generic invalid_input error for both, with no existence oracle. Cannot be activated by the public caller; no code path in this phase writes true to this column.';

comment on column public.request_intake_integrations.allowed_origins is
  'Optional secondary control only (P1-PILOT-S4A). NEVER tenant authorization — Origin/Referer is trivially spoofable by a non-browser caller. Tenant isolation is enforced entirely by external_id -> organization_id resolution inside the RPC, independent of this column.';

create trigger request_intake_integrations_set_updated_at
  before update on public.request_intake_integrations
  for each row execute function public.set_updated_at();

create index request_intake_integrations_organization_id_idx on public.request_intake_integrations (organization_id);

alter table public.request_intake_integrations enable row level security;

-- No policy is created for any role. RLS enabled with zero policies is
-- itself deny-by-default for every role except the table owner
-- (`postgres`, which the SECURITY DEFINER function below runs as) —
-- mirrors this schema's own established "RLS is defense-in-depth on top
-- of an already-empty privilege surface" posture (client-privilege-
-- surface-hardening.sql). Explicit revoke as a second, independent
-- layer (belt-and-suspenders, matching every other new table in this
-- schema's own convention of an explicit revoke even where none was
-- ever granted):
revoke all on public.request_intake_integrations from anon, authenticated;

-- =============================================================================
-- B. transportation_requests — additive provenance columns
-- =============================================================================
-- Evaluated per the phase brief's own instruction ("evaluate whether
-- existing transportation_requests can safely accept additive
-- provenance fields or whether a narrowly-scoped companion record is
-- cleaner"): additive columns on the existing table are the correct,
-- smaller choice here — a companion table would duplicate
-- organization_id/created_at and require an extra join on every single
-- existing Request Hub read (list, detail, activity) for a fact that is
-- genuinely 1:1 with the Request row itself and never queried
-- independently of it. This mirrors exactly how `source` itself was
-- already added additively in 20260916100000, not as a companion table.
--
-- `intake_integration_id` is nullable — NULL for every existing row and
-- every future staff-entered row (log_transportation_request never sets
-- it); non-NULL identifies exactly which configured integration created
-- the row. This is the authoritative provenance signal the Request Hub
-- UI change (section E below) keys off — NOT `source = 'web'`, which
-- remains a separately staff-selectable descriptive channel a human can
-- choose for an entirely manually-typed row (e.g. "the requester told me
-- they found us through our website") and must not be conflated with
-- "this row was created by the automated public intake path."
--
-- `external_submission_ref` is the client-supplied idempotency key (see
-- the RPC's own comment for the full idempotency contract) — nullable
-- for the same reason, present only on rows created via public intake.
alter table public.transportation_requests
  add column intake_integration_id uuid,
  add column external_submission_ref text;

comment on column public.transportation_requests.intake_integration_id is
  'P1-PILOT-S4A. NULL for every staff-entered Request (including one whose source happens to be manually set to ''web''). Non-NULL identifies exactly which request_intake_integrations row created this Request via submit_public_transportation_request. This is the authoritative "was this row created by public intake" signal — never source=''web'' alone, which is a separately staff-selectable descriptive field.';

comment on column public.transportation_requests.external_submission_ref is
  'P1-PILOT-S4A. The client-supplied idempotency key for a public-intake-created Request, paired with intake_integration_id under transportation_requests_intake_idempotency_idx. NULL for every staff-entered Request.';

-- Composite FK anchored against request_intake_integrations' own
-- (id, organization_id) uniqueness (section A above) — the database
-- itself physically rejects any row whose intake_integration_id names an
-- integration belonging to a DIFFERENT organization than the row's own
-- organization_id. This is not merely defense-in-depth against a bug in
-- the RPC below; it is a second, independent, structural guarantee that
-- holds even if the RPC's own internal logic were ever wrong.
alter table public.transportation_requests
  add constraint transportation_requests_intake_integration_fkey
  foreign key (intake_integration_id, organization_id)
  references public.request_intake_integrations (id, organization_id);

-- Idempotency: a PARTIAL unique index (only when both columns are
-- non-NULL) so staff-entered rows (both columns NULL) are entirely
-- unaffected — Postgres unique indexes already treat NULL as never
-- equal to NULL, but the explicit WHERE clause makes the intent
-- unambiguous and lets the RPC's own `ON CONFLICT (...) WHERE ...`
-- target this exact index. The SAME (integration, idempotency key) pair
-- can never produce two rows — this is the sole idempotency mechanism
-- (concurrency-safe at the database level; see the RPC comment and the
-- dedicated concurrency test for the two-process proof).
create unique index transportation_requests_intake_idempotency_idx
  on public.transportation_requests (intake_integration_id, external_submission_ref)
  where intake_integration_id is not null and external_submission_ref is not null;

-- =============================================================================
-- C. submit_public_transportation_request — the sole anon-callable
-- creation path
-- =============================================================================
create type public.public_request_submission_result as (
  accepted boolean
);

comment on type public.public_request_submission_result is
  'Return shape for submit_public_transportation_request. Deliberately minimal — no request id, no organization id, no internal identifier of any kind is ever returned to a public caller. `accepted` is true both for a genuinely new Request and for an idempotent replay of an already-processed submission; the two are indistinguishable to the caller by design (the caller needs only to know its submission was received exactly once, never whether this specific call happened to be the first).';

create or replace function public.submit_public_transportation_request(
  p_integration_external_id text,
  p_idempotency_key text,
  p_requester_name text,
  p_requester_relationship text,
  p_requester_phone text,
  p_pickup_description text,
  p_destination_description text,
  p_return_trip_needed text,
  p_requester_email text default null,
  p_preferred_date date default null,
  p_preferred_time time default null,
  p_assistance_notes text default null,
  p_additional_notes text default null,
  p_origin text default null
)
returns public.public_request_submission_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration public.request_intake_integrations%rowtype;
  v_idempotency_key text;
  v_requester_name text;
  v_requester_phone text;
  v_requester_email text;
  v_pickup_description text;
  v_destination_description text;
  v_assistance_notes text;
  v_additional_notes text;
  v_request_id uuid;
  v_result public.public_request_submission_result;
begin
  -- -----------------------------------------------------------------------
  -- Deliberately NO `auth.uid() is null` check — unlike every other
  -- mutation RPC in this schema, this one MUST work for a genuinely
  -- anonymous caller (auth.uid() is always NULL for `anon`). Authorization
  -- here is entirely "does p_integration_external_id name an active
  -- integration" — checked below — never an identity check.
  -- -----------------------------------------------------------------------

  -- -----------------------------------------------------------------------
  -- Tenant resolution: the ONLY input that selects an organization.
  -- No p_organization_id parameter exists anywhere in this function's
  -- signature — structurally impossible for a caller to "redirect" a
  -- submission into a different tenant by tampering with any field,
  -- since no field ever names a tenant directly. A nonexistent
  -- external_id and a disabled integration raise the IDENTICAL error
  -- (invalid_input, ZW006) — no existence oracle, exactly mirroring
  -- has_org_role's own "not_found is not_found, regardless of why"
  -- contract used everywhere else in this schema.
  -- -----------------------------------------------------------------------
  if p_integration_external_id is null or btrim(p_integration_external_id) = '' or length(btrim(p_integration_external_id)) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select * into v_integration
  from public.request_intake_integrations
  where external_id = btrim(p_integration_external_id)
    and integration_type = 'website';

  if not found or v_integration.is_active is not true then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Secondary control only (see the column's own comment) — checked
  -- only when the integration has actually configured an allow-list.
  -- Never the authorization boundary; the block above already fully
  -- resolved and validated the tenant before this runs.
  if v_integration.allowed_origins is not null and array_length(v_integration.allowed_origins, 1) > 0 then
    if p_origin is null or not (p_origin = any (v_integration.allowed_origins)) then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  -- -----------------------------------------------------------------------
  -- Idempotency key: required, bounded. This is the sole idempotency
  -- input — see section B's own comment for the full mechanism (a
  -- partial unique index on (intake_integration_id,
  -- external_submission_ref), enforced by ON CONFLICT below, never a
  -- client-side disabled-button state).
  -- -----------------------------------------------------------------------
  v_idempotency_key := nullif(btrim(p_idempotency_key), '');
  if v_idempotency_key is null or length(v_idempotency_key) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- Field validation — IDENTICAL bounds to log_transportation_request's
  -- own validation (20260916100000_request_mutation_foundation.sql),
  -- deliberately kept in exact sync rather than diverging: a public
  -- Request and a staff-entered Request must satisfy the same minimum
  -- save contract. No passenger_id parameter exists at all (public
  -- intake must never auto-link/auto-create/auto-merge a Passenger —
  -- locked product decision); no preferred structured-field beyond what
  -- log_transportation_request itself already accepts; no medical
  -- intake fields.
  -- -----------------------------------------------------------------------
  v_requester_name := nullif(btrim(p_requester_name), '');
  if v_requester_name is null or length(v_requester_name) > 200 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_requester_relationship not in ('self', 'family', 'caregiver', 'facility_coordinator', 'other') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_requester_phone := nullif(btrim(p_requester_phone), '');
  if v_requester_phone is null or length(v_requester_phone) > 50 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_requester_email := nullif(btrim(p_requester_email), '');
  if v_requester_email is not null and length(v_requester_email) > 320 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_pickup_description := nullif(btrim(p_pickup_description), '');
  v_destination_description := nullif(btrim(p_destination_description), '');
  if v_pickup_description is null or v_destination_description is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if length(v_pickup_description) > 2000 or length(v_destination_description) > 2000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_return_trip_needed not in ('yes', 'no', 'not_sure') then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_assistance_notes := nullif(btrim(p_assistance_notes), '');
  if v_assistance_notes is not null and length(v_assistance_notes) > 4000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_additional_notes := nullif(btrim(p_additional_notes), '');
  if v_additional_notes is not null and length(v_additional_notes) > 4000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- -----------------------------------------------------------------------
  -- The Request itself. organization_id is v_integration.organization_id
  -- — resolved internally two steps above, never a parameter. state is
  -- hard-coded 'pending' and source is hard-coded 'web' — neither is
  -- ever a parameter, mirroring log_transportation_request's own
  -- hard-coded 'pending' and create_trip's own hard-coded 'scheduled'.
  -- passenger_id is never set (omitted entirely — defaults to its own
  -- column default of NULL).
  --
  -- Idempotency: ON CONFLICT targets the exact partial unique index from
  -- section B. Two concurrent identical submissions (same integration,
  -- same idempotency key) are safe purely from this single atomic
  -- statement — the index enforces mutual exclusion at the database
  -- level; whichever transaction's INSERT commits first wins, the other
  -- observes a conflict and DOES NOTHING, then re-selects the
  -- now-committed row below. No advisory lock, no SELECT ... FOR UPDATE
  -- is needed before this statement, because there is no pre-existing
  -- row to lock — the row does not exist until exactly one of the
  -- racing INSERTs creates it.
  -- -----------------------------------------------------------------------
  insert into public.transportation_requests (
    organization_id, requester_name, requester_relationship, requester_phone, requester_email,
    pickup_description, destination_description, preferred_date, preferred_time,
    return_trip_needed, assistance_notes, additional_notes, source, state,
    intake_integration_id, external_submission_ref
  ) values (
    v_integration.organization_id, v_requester_name, p_requester_relationship, v_requester_phone, v_requester_email,
    v_pickup_description, v_destination_description, p_preferred_date, p_preferred_time,
    p_return_trip_needed, v_assistance_notes, v_additional_notes, 'web', 'pending',
    v_integration.id, v_idempotency_key
  )
  on conflict (intake_integration_id, external_submission_ref)
    where intake_integration_id is not null and external_submission_ref is not null
  do nothing
  returning id into v_request_id;

  if v_request_id is null then
    -- Idempotent replay: another (possibly concurrent) call with the
    -- SAME integration + idempotency key already created the row. Never
    -- treated as an error — the caller's own submission was received
    -- exactly once either way.
    select id into v_request_id
    from public.transportation_requests
    where intake_integration_id = v_integration.id and external_submission_ref = v_idempotency_key;
  else
    -- Only logged for the genuinely-new-row path — a replay never
    -- produces a second request_events row, matching every other
    -- idempotent no-op in this schema (e.g. link_request_passenger's own
    -- changed=false path, which also skips its own event insert).
    -- actor_user_id is NULL (no authenticated identity exists for this
    -- caller) — request_events.actor_user_id already allows NULL (no
    -- schema change needed). No PII/free-text field is copied into
    -- metadata — only the safe, internal integration id.
    insert into public.request_events (organization_id, request_id, event_type, actor_user_id, metadata)
    values (
      v_integration.organization_id, v_request_id, 'request_logged', null,
      jsonb_build_object('source', 'web', 'intake_integration_id', v_integration.id)
    );
  end if;

  v_result.accepted := true;
  return v_result;
end;
$$;

comment on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text
) is
  'PUBLIC / anon-callable. The sole path by which an external tenant website can create a transportation_requests row. No organization_id parameter exists anywhere in this signature — the organization is resolved entirely from p_integration_external_id via request_intake_integrations, and that resolution cannot be overridden by any other input. state is always ''pending'' and source is always ''web'', never caller-supplied. No passenger_id parameter exists — public intake never auto-links, auto-creates, or auto-merges a Passenger. Idempotent: the SAME (integration, p_idempotency_key) pair never creates more than one Request, enforced by transportation_requests_intake_idempotency_idx and ON CONFLICT DO NOTHING, safe under genuine concurrent submission. A disabled or nonexistent integration, and every field-validation failure, all raise the identical invalid_input (ZW006) — no existence oracle. p_origin is a secondary, non-authoritative signal only. Rate limiting is explicitly OUT of scope for this function (see P1-PILOT-S4A report) — production activation of any integration requires real anti-abuse infrastructure to exist first; every integration defaults to is_active=false and no code path in this phase ever sets it true.';

revoke all on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text
) from public;
-- Granted to BOTH anon and authenticated, matching
-- get_driver_invite_preview's own established precedent exactly — this
-- function must work identically regardless of whether the calling
-- browser happens to also hold an unrelated Nemryn session cookie (it
-- will not, in the real cross-origin case, but the function's own
-- authorization never depends on that either way).
grant execute on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text
) to anon, authenticated;
