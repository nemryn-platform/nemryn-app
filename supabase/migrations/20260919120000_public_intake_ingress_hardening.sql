-- P1-PILOT-S4B — Pilot Website Intake Production Hardening.
--
-- Closes the direct-RPC abuse bypass S4A's own report explicitly
-- flagged: `submit_public_transportation_request` was granted to
-- `anon, authenticated`, meaning ANY caller holding the publishable
-- (anon) key — which is, by Supabase's own design, not a secret, and is
-- necessarily embedded in this app's own public bundle — could call the
-- RPC directly via raw PostgREST, bypassing every anti-abuse control
-- this phase adds at the Next.js Route Handler layer entirely. Once a
-- real durable rate limiter exists at the HTTP boundary, that bypass is
-- no longer acceptable — the Route Handler must become the ONLY
-- intentionally supported anonymous entry point.
--
-- LOCKED DECISION: the RPC's own internal authority
-- (integration/organization resolution, field bounds, allowed state,
-- allowed provenance, idempotency, no-auto-Passenger, no-auto-Trip,
-- cross-tenant integrity) is NOT weakened or moved into application
-- code by this migration — every one of those protections, proven by
-- P1-PILOT-S4A's own test suite, remains exactly as strict regardless
-- of which Postgres role invokes the function. This migration changes
-- ONLY who is allowed to invoke it, never what it is allowed to do.

-- =============================================================================
-- A. Ingress hardening — submit_public_transportation_request becomes
-- service_role-only
-- =============================================================================
-- `service_role` bypasses RLS but does NOT automatically hold EXECUTE on
-- any function (EXECUTE is an independent privilege from RLS bypass —
-- confirmed directly: `has_function_privilege('service_role', ...,
-- 'EXECUTE')` returned false before this migration, even though
-- service_role already had BYPASSRLS). An explicit grant is required.
revoke all on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text
) from public, anon, authenticated;
grant execute on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text
) to service_role;

comment on function public.submit_public_transportation_request(
  text, text, text, text, text, text, text, text, text, date, time, text, text, text
) is
  'SERVER-ONLY (service_role), as of P1-PILOT-S4B. The sole path by which a Request can be created via public tenant-website intake — reachable ONLY through the Nemryn-owned Next.js Route Handler (src/app/api/public-intake/website/route.ts), which is the ONLY code in this codebase that instantiates a service-role Supabase client, and does so ONLY to call this one function and check_and_record_public_intake_rate_limit. No organization_id parameter exists anywhere in this signature — the organization is resolved entirely from p_integration_external_id via request_intake_integrations, and that resolution cannot be overridden by any other input. state is always ''pending'' and source is always ''web'', never caller-supplied. No passenger_id parameter exists — public intake never auto-links, auto-creates, or auto-merges a Passenger. Idempotent: the SAME (integration, p_idempotency_key) pair never creates more than one Request, enforced by transportation_requests_intake_idempotency_idx and ON CONFLICT DO NOTHING, safe under genuine concurrent submission. A disabled or nonexistent integration, and every field-validation failure, all raise the identical invalid_input (ZW006) — no existence oracle. p_origin is a secondary, non-authoritative signal only. Prior to P1-PILOT-S4B this function was anon/authenticated-executable directly via PostgREST — that direct path is now closed; durable rate limiting exists only at the Route Handler layer, in front of this function, so direct RPC access would have bypassed it entirely.';

-- =============================================================================
-- A2. service_role read access for CORS origin resolution
-- =============================================================================
-- `service_role`'s own BYPASSRLS attribute does NOT imply a table-level
-- GRANT (the identical lesson as section A's own EXECUTE grant above —
-- confirmed directly: a raw `SELECT ... FOR service_role` against this
-- table failed with `permission denied` before this grant, even though
-- service_role already bypasses RLS). `src/lib/public-intake/cors.ts`'s
-- own `resolveAllowedCorsOrigin` needs exactly one narrow read —
-- `allowed_origins` for every currently-active integration — to decide
-- the `Access-Control-Allow-Origin` response header (§Part 3 CORS/
-- Origin). SELECT only; no INSERT/UPDATE/DELETE grant is added here —
-- provisioning (create/activate/disable) remains exclusively a direct,
-- trusted-operator SQL operation (run as `postgres`), never something
-- application code (even under service_role) can do.
grant select on public.request_intake_integrations to service_role;

-- =============================================================================
-- B. Durable, atomic rate limiting
-- =============================================================================
-- One append-only event row per (allowed) submission ATTEMPT, scoped by
-- two independent dimensions checked together: the raw, lowercased
-- integration external_id string the caller presented (no integration
-- lookup/resolution is required before this check — a nonexistent or
-- disabled external_id still gets its own small per-string bucket,
-- which is harmless; the MEANINGFUL protection for that case is the
-- per-client dimension below, which stays constant regardless of what
-- external_id an attacker cycles through), and `client_key` — a
-- one-way HMAC-SHA256 hash of the caller's IP address, computed in the
-- ROUTE HANDLER (src/lib/public-intake/rate-limit.ts, Node's built-in
-- crypto module) BEFORE this table or function ever sees it. Postgres
-- never receives, stores, or processes a raw IP address anywhere in
-- this schema.
create table public.public_intake_rate_limit_events (
  id bigint generated always as identity primary key,
  integration_external_id text not null,
  client_key text not null,
  occurred_at timestamptz not null default now()
);

comment on table public.public_intake_rate_limit_events is
  'Durable rate-limit ledger for public tenant-website intake (P1-PILOT-S4B). One row per allowed attempt (both successful submissions AND rejected-for-other-reasons attempts that passed the rate check itself — see check_and_record_public_intake_rate_limit''s own comment for why counting every attempt, not just successes, is the deliberate, documented choice). `client_key` is a one-way hash computed application-side; this table never stores a raw IP address. No RLS policy, no grant to anon/authenticated — only the SECURITY DEFINER function below (running as the function owner) ever reads or writes this table, matching request_intake_integrations'' own zero-grant posture exactly. Rows are NOT deleted by any code path in this phase (no unbounded-growth mitigation is implemented — see the P1-PILOT-S4B report''s own OPEN ISSUES for why this is an accepted, documented gap for a pilot-scale deployment, not an oversight).';

create index public_intake_rate_limit_events_integration_idx
  on public.public_intake_rate_limit_events (integration_external_id, occurred_at);
create index public_intake_rate_limit_events_client_idx
  on public.public_intake_rate_limit_events (client_key, occurred_at);

alter table public.public_intake_rate_limit_events enable row level security;
revoke all on public.public_intake_rate_limit_events from anon, authenticated;

create type public.rate_limit_check_result as (
  allowed boolean
);

comment on type public.rate_limit_check_result is
  'Return shape for check_and_record_public_intake_rate_limit. Deliberately minimal — no counter value, no threshold, no window, no reason is ever returned. A throttled caller and a caller who passed the rate check but then failed field/integration validation both eventually produce the SAME generic public response from the Route Handler (see website-intake-core.ts''s own single PublicIntakeErrorCode) — this type''s own narrowness is one layer of that guarantee.';

-- REVIEWABLE THRESHOLDS (P1-PILOT-S4B) — a single rolling 1-hour window,
-- chosen over a more elaborate multi-window (hour + day) scheme for
-- this pilot's own realistic, currently-unknown-at-scale traffic
-- pattern (documented here rather than silently assumed; revisit with
-- real pilot traffic data before generalizing beyond one tenant):
--   PER-CLIENT: 8 attempts / rolling hour. Sized for a genuine busy
--     facility coordinator or household submitting several distinct
--     ride requests in one sitting, PLUS a small allowance for a
--     legitimate double-click/network-retry (which reuses the same
--     idempotency key but still consumes one attempt here — see the
--     table's own comment on why every attempt counts, not just
--     successes) — never so tight that ordinary real use is blocked,
--     per the phase's own explicit instruction.
--   PER-INTEGRATION: 120 attempts / rolling hour. Sized for a
--     legitimately busy clinic with MULTIPLE staff members submitting
--     concurrently across an hour, while still bounding a targeted
--     flood against one tenant's own intake channel specifically.
create or replace function public.check_and_record_public_intake_rate_limit(
  p_integration_external_id text,
  p_client_key text
)
returns public.rate_limit_check_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration_key text;
  v_client_key text;
  v_integration_count int;
  v_client_count int;
  v_per_client_limit constant int := 8;
  v_per_integration_limit constant int := 120;
  v_window constant interval := interval '1 hour';
  v_result public.rate_limit_check_result;
begin
  v_integration_key := lower(btrim(coalesce(p_integration_external_id, '')));
  v_client_key := btrim(coalesce(p_client_key, ''));

  if v_integration_key = '' or v_client_key = '' then
    -- Malformed input at this layer (should never happen given the
    -- Route Handler's own upstream validation) fails CLOSED — treated
    -- as not allowed, never as "skip the check".
    v_result.allowed := false;
    return v_result;
  end if;

  -- Transaction-scoped advisory locks serialize concurrent attempts
  -- against the SAME integration and the SAME client respectively —
  -- this is what makes the count-then-insert below genuinely atomic
  -- under real concurrency (proven by
  -- supabase/tests/public_intake_rate_limit_concurrency_test.sh): two
  -- simultaneous callers racing the same key cannot both read the same
  -- "count so far" before either has recorded its own attempt, which is
  -- exactly the read-before-write race a naive
  -- `SELECT count(*) ...; IF ... THEN INSERT ...;` pair (with no lock)
  -- would be vulnerable to. Held only for the duration of this
  -- function's own transaction — released automatically on return.
  perform pg_advisory_xact_lock(hashtext('public-intake-rl-integration:' || v_integration_key));
  perform pg_advisory_xact_lock(hashtext('public-intake-rl-client:' || v_client_key));

  select count(*) into v_integration_count
  from public.public_intake_rate_limit_events
  where integration_external_id = v_integration_key
    and occurred_at > now() - v_window;

  select count(*) into v_client_count
  from public.public_intake_rate_limit_events
  where client_key = v_client_key
    and occurred_at > now() - v_window;

  if v_integration_count >= v_per_integration_limit or v_client_count >= v_per_client_limit then
    v_result.allowed := false;
    return v_result;
  end if;

  insert into public.public_intake_rate_limit_events (integration_external_id, client_key)
  values (v_integration_key, v_client_key);

  v_result.allowed := true;
  return v_result;
end;
$$;

comment on function public.check_and_record_public_intake_rate_limit(text, text) is
  'SERVER-ONLY (service_role). Atomically checks AND records one public-intake attempt against both a per-integration and a per-client rolling-1-hour limit (8/client, 120/integration — see the function''s own REVIEWABLE THRESHOLDS comment above for the full reasoning). Called by the Route Handler BEFORE submit_public_transportation_request, so a throttled attempt never reaches the submission RPC at all. Counts every attempt that PASSES this check, not just eventually-successful submissions (a flood of garbage/invalid payloads is rate-limited exactly like a flood of valid ones — deliberate). Atomic under genuine concurrency via transaction-scoped advisory locks, not a naive read-then-write. Never reveals a counter, threshold, or window to any caller — returns only {allowed: boolean}.';

revoke all on function public.check_and_record_public_intake_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.check_and_record_public_intake_rate_limit(text, text) to service_role;
