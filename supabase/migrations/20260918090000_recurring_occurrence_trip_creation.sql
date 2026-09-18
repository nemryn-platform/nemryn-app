-- P1-E2-S1E — Controlled Recurring Occurrence → Trip Creation.
--
-- The ONE dedicated trusted mutation path for "create the Trip that
-- satisfies this currently-missing recurring occurrence." Reuses the
-- existing create_trip RPC's own passenger/address validation, INSERT,
-- trip_events, and audit_events logic by actually CALLING it (never
-- duplicating its body) — this migration's own function then
-- authoritatively associates the resulting Trip with the arrangement in
-- the SAME transaction. trips.recurring_arrangement_id remains
-- completely unreachable to any client role (confirmed unchanged below
-- — this migration adds no GRANT of any kind on that column); the ONLY
-- way a Trip's recurring_arrangement_id is ever set is inside this one
-- SECURITY DEFINER function's own UPDATE statement.
--
-- create_trip itself is NOT modified — audited first (its full body read
-- directly from 20260916110000_request_trip_passenger_integrity.sql)
-- and found to already own every invariant this new path needs
-- (passenger must exist/same-org/active; address nonblank/bounded;
-- state hard-coded 'scheduled'; one trip_events row; one audit_events
-- row) — reusing it via a plain function call, rather than reimplementing
-- any of that, is both less code and automatically inherits any future
-- correctness fix made to create_trip itself, with zero duplication risk
-- of drifting out of sync.

-- =============================================================================
-- A. _organization_local_to_utc — internal-only DST-safe local date+time+
-- timezone -> UTC instant helper.
-- =============================================================================
-- SQL-layer port of local-time.ts's own organizationLocalToUtc — same
-- exact algorithm (fixed winter/summer reference-instant offset
-- candidates for the requested date's own year, never a transition-
-- relative window), same exact failure semantics (status='nonexistent'
-- for a spring-forward gap, status='ambiguous' for a fall-back repeated
-- hour), reused here rather than reinvented because Postgres's own bare
-- `timestamp AT TIME ZONE zone` construct resolves a nonexistent or
-- ambiguous local wall-clock time to SOME instant silently, with no
-- indication anything was wrong — exactly the "silently guess" outcome
-- P1-E2-S1E §26 explicitly forbids. This helper cannot be reached from
-- TypeScript (no cross-runtime call path exists), so a direct code-reuse
-- import was never an option — this is a deliberate, tested PORT of the
-- identical algorithm to the one runtime that actually needs it here:
-- create_trip_for_recurring_occurrence's own SECURITY DEFINER execution,
-- which must derive the exact UTC scheduled_pickup_at from its OWN
-- locked, authoritative read of the arrangement row — never from a
-- browser- or server-action-supplied timestamp that could drift from, or
-- be forged independently of, the row this function itself just locked.
--
-- Empirically verified against real 2026 America/New_York DST
-- transitions before being written into this migration (not merely
-- reasoned about): spring-forward (2026-03-08, 2:00 AM -> 3:00 AM) and
-- fall-back (2026-11-01, 2:00 AM -> 1:00 AM), both confirmed against
-- Postgres's own live tzdata via `select d, (d::timestamp at time zone
-- 'America/New_York') - (d::timestamp at time zone 'UTC') from
-- generate_series(...)` before this function was finalized — see this
-- phase's own report, LOCAL TIME -> UTC STRATEGY / DST BEHAVIOR, for the
-- full transcript. The 3 required test classes (normal date,
-- spring-forward gap, fall-back overlap) are also proven in
-- supabase/tests/recurring_trip_creation_tests.sql.
--
-- Internal-only, per this schema's own established convention
-- (`_is_canonical_days_of_week`, `_lock_driver_active_assignment`) —
-- revoked from public, never granted to authenticated; reachable only
-- from within another SECURITY DEFINER function's own already-elevated
-- execution context (the owning role's implicit privilege on its own
-- objects, not a grant).
create or replace function public._organization_local_to_utc(p_date date, p_time time, p_timezone text)
returns table(status text, utc timestamptz)
language plpgsql
stable
as $$
declare
  v_naive timestamp := p_date + p_time;
  v_year int := extract(year from p_date)::int;
  v_winter_ref timestamp := make_timestamp(v_year, 1, 1, 12, 0, 0);
  v_summer_ref timestamp := make_timestamp(v_year, 7, 1, 12, 0, 0);
  v_winter_offset interval;
  v_summer_offset interval;
  v_offsets interval[];
  v_offset interval;
  v_candidates timestamptz[] := '{}';
  v_candidate timestamptz;
begin
  -- Offset of p_timezone at a FIXED winter/summer reference instant of
  -- the REQUESTED date's own year (never a window relative to the
  -- request itself, which can land in the same season on both sides
  -- depending on the requested month) — "local wall-clock reading of the
  -- reference instant" minus "the reference instant's own UTC reading",
  -- the identical technique timezoneOffsetMs (local-time.ts) uses.
  v_winter_offset := (v_winter_ref at time zone 'UTC' at time zone p_timezone) - v_winter_ref;
  v_summer_offset := (v_summer_ref at time zone 'UTC' at time zone p_timezone) - v_summer_ref;

  v_offsets := array(select distinct unnest(array[v_winter_offset, v_summer_offset]));

  foreach v_offset in array v_offsets loop
    v_candidate := (v_naive - v_offset) at time zone 'UTC';
    -- Round-trip check: does converting this candidate UTC instant BACK
    -- to local wall-clock in p_timezone reproduce the exact requested
    -- naive timestamp? Only a genuinely valid (non-nonexistent) instant
    -- round-trips exactly.
    if (v_candidate at time zone p_timezone) = v_naive then
      v_candidates := array_append(v_candidates, v_candidate);
    end if;
  end loop;

  v_candidates := array(select distinct unnest(v_candidates));

  if array_length(v_candidates, 1) is null then
    return query select 'nonexistent'::text, null::timestamptz;
  elsif array_length(v_candidates, 1) > 1 then
    return query select 'ambiguous'::text, null::timestamptz;
  else
    return query select 'ok'::text, v_candidates[1];
  end if;
end;
$$;

comment on function public._organization_local_to_utc(date, time, text) is
  'Internal only — never granted to any client role. DST-safe local(date,time,timezone) -> UTC instant, mirroring local-time.ts''s organizationLocalToUtc exactly (winter/summer reference-offset candidates + round-trip validation). Returns status=''nonexistent''/''ambiguous''/''ok'' — never silently guesses across a DST transition. Used exclusively by create_trip_for_recurring_occurrence, under that function''s own SECURITY DEFINER execution context.';

revoke all on function public._organization_local_to_utc(date, time, text) from public;

-- =============================================================================
-- B. create_trip_for_recurring_occurrence
-- =============================================================================
create or replace function public.create_trip_for_recurring_occurrence(
  p_organization_id uuid,
  p_arrangement_id uuid,
  p_service_date date
)
returns public.trip_creation_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_arrangement public.recurring_arrangements;
  v_local_today date;
  v_effective_cutoff date;
  v_existing_trip public.trips;
  v_conversion record;
  v_created_trip public.trip_creation_result;
  v_result public.trip_creation_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_service_date is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Lock the arrangement row (identical technique to
  -- skip_recurring_occurrence): its CURRENT facts are exactly what
  -- SERVICE-DATE VALIDATION checks against, and holding this lock for
  -- the remainder of the transaction is also the serialization boundary
  -- that makes concurrent duplicate "create Trip for this occurrence"
  -- calls safe (P1-E2-S1E §28/§32).
  select * into v_arrangement
  from public.recurring_arrangements
  where id = p_arrangement_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- ---------------------------------------------------------------------
  -- SERVICE-DATE VALIDATION (§25) — mirrors isPatternDate
  -- (recurring-care-core.ts) EXACTLY, including its pause/ended-cutoff
  -- symmetry: a date strictly before the effective pause/end cutoff
  -- remains a legitimate expected occurrence either way. This is
  -- deliberately NOT skip_recurring_occurrence's own stricter,
  -- asymmetric "ended -> reject unconditionally, no date carve-out"
  -- rule (a considered S1D product decision specific to declaring a NEW
  -- skip) — creating the Trip that already should have happened remains
  -- a legitimate catch-up action even after the arrangement has since
  -- been ended, exactly as long as the requested date itself was still
  -- genuinely expected under the arrangement's own historical facts.
  -- ---------------------------------------------------------------------
  v_local_today := (now() at time zone v_arrangement.timezone)::date;

  if p_service_date < v_arrangement.start_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if v_arrangement.end_date is not null and p_service_date > v_arrangement.end_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_service_date < v_local_today then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not (extract(isodow from p_service_date)::smallint = any (v_arrangement.days_of_week)) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if v_arrangement.status = 'paused' and v_arrangement.paused_at is not null then
    v_effective_cutoff := (v_arrangement.paused_at at time zone v_arrangement.timezone)::date;
    if p_service_date >= v_effective_cutoff then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  elsif v_arrangement.status = 'ended' and v_arrangement.ended_at is not null then
    v_effective_cutoff := (v_arrangement.ended_at at time zone v_arrangement.timezone)::date;
    if p_service_date >= v_effective_cutoff then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  if exists (
    select 1 from public.recurring_occurrence_exceptions
    where recurring_arrangement_id = p_arrangement_id and service_date = p_service_date
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- ---------------------------------------------------------------------
  -- IDEMPOTENCY (§28) — a qualifying (non-cancelled, dated) linked Trip
  -- already satisfying this service_date (resolved in the ARRANGEMENT's
  -- own timezone — the identical rule recurring-care-core.ts's own
  -- qualifyingTripsFor already establishes as authoritative) is returned
  -- as-is: no new Trip, no new audit event. A CANCELLED Trip on this
  -- date does NOT satisfy the check (§29) — a new replacement Trip is
  -- created below in that case, never resurrecting/rewriting the
  -- cancelled one. No new UNIQUE(arrangement,date) constraint exists or
  -- is added — multiple linked Trips per date remain legitimate for the
  -- domain in general (P1-E2-S1A1); idempotency here is enforced
  -- procedurally, scoped to only THIS specific action, not the schema.
  -- ---------------------------------------------------------------------
  select * into v_existing_trip
  from public.trips
  where recurring_arrangement_id = p_arrangement_id
    and organization_id = v_arrangement.organization_id
    and state <> 'cancelled'
    and scheduled_pickup_at is not null
    and (scheduled_pickup_at at time zone v_arrangement.timezone)::date = p_service_date
  limit 1;

  if v_existing_trip.id is not null then
    v_result.trip_id := v_existing_trip.id;
    v_result.organization_id := v_existing_trip.organization_id;
    v_result.state := v_existing_trip.state;
    v_result.created := false;
    return v_result;
  end if;

  -- ---------------------------------------------------------------------
  -- LOCAL TIME -> UTC (§26) — DST-safe, via the tested helper above.
  -- Never the browser's timezone, never the server's, never the
  -- Organization's CURRENT timezone (the arrangement's own stored
  -- SNAPSHOT is authoritative, exactly like every other Recurring Care
  -- read), never +24h arithmetic.
  -- ---------------------------------------------------------------------
  select * into v_conversion from public._organization_local_to_utc(p_service_date, v_arrangement.pickup_time, v_arrangement.timezone);
  if v_conversion.status <> 'ok' then
    -- Nonexistent or ambiguous local pickup time on this specific date —
    -- does not silently guess (§26). Categorized ZW006 like every other
    -- "this specific requested input does not describe a resolvable
    -- occurrence" failure in this function.
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- ---------------------------------------------------------------------
  -- REUSE create_trip (§27) — a plain function call, not a copy of its
  -- body. Inherits create_trip's own passenger validation (same-org,
  -- status='active' — so a Passenger deactivated AFTER this arrangement
  -- was created is correctly still rejected here, for free), its own
  -- address validation, its own hard-coded state='scheduled', its own
  -- trip_events row ('trip_scheduled'), and its own audit_events row
  -- ('trip_created'). p_request_id is never supplied — a recurring
  -- occurrence Trip is never Request-linked. p_pickup_facility_id/
  -- p_destination_facility_id/p_assistance_notes/p_instructions are also
  -- never supplied (§30 — no facility linkage, no assignment, no return
  -- leg is ever auto-created by this action).
  -- ---------------------------------------------------------------------
  select * into v_created_trip from public.create_trip(
    v_arrangement.organization_id,
    v_arrangement.passenger_id,
    v_arrangement.pickup_description,
    v_arrangement.destination_description,
    v_conversion.utc
  );

  -- Authoritatively associate the new Trip with this arrangement, in the
  -- SAME transaction as everything above — the one column create_trip
  -- itself has no parameter for, and the only place trips.
  -- recurring_arrangement_id is ever written by any code path in this
  -- schema.
  update public.trips set recurring_arrangement_id = p_arrangement_id where id = v_created_trip.trip_id;

  -- One small, explicit, ADDITIONAL audit_events row from the
  -- ARRANGEMENT's own vantage point (mirrors skip_recurring_occurrence/
  -- unskip_recurring_occurrence's own entity_type='recurring_arrangement'
  -- convention) — not a duplicate of create_trip's own 'trip_created'
  -- event (that one already exists, from the Trip's own vantage point);
  -- this one keeps the standing commitment's OWN audit history complete
  -- without requiring anyone to cross-reference trip_events/audit_events
  -- by trip_id to discover which recurring commitment a Trip fulfilled.
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, after_data)
  values (
    v_arrangement.organization_id, 'recurring_arrangement', p_arrangement_id, 'recurring_occurrence_trip_created', auth.uid(),
    jsonb_build_object('trip_id', v_created_trip.trip_id, 'service_date', p_service_date)
  );

  v_result.trip_id := v_created_trip.trip_id;
  v_result.organization_id := v_created_trip.organization_id;
  v_result.state := v_created_trip.state;
  v_result.created := true;
  return v_result;
end;
$$;

comment on function public.create_trip_for_recurring_occurrence(uuid, uuid, date) is
  'Organization Admin / Dispatcher only. The sole controlled path to create the Trip that satisfies a currently-missing RecurringArrangement occurrence. Re-validates service_date authoritatively against the arrangement''s OWN locked, current facts (start/end/weekday/skip/local-today/pause-or-end-cutoff — mirrors isPatternDate exactly, never trusting that the UI only shows valid dates). Idempotent: a qualifying (non-cancelled) linked Trip already on this date is returned as-is, changed via `created=false`, never duplicated — a CANCELLED Trip on the date does not count, so a genuine replacement is still created. Reuses create_trip itself (a plain function call, never a duplicated body) for the actual Trip INSERT/validation/trip_events/audit_events, then sets recurring_arrangement_id and writes one small additional audit_events row from the arrangement''s own vantage point. Never assigns a Driver/Vehicle, never links a Request/Facility, never creates a return leg. See docs/reports/p1-e2-s1e-recurring-care-operations-trip-creation.txt.';

revoke all on function public.create_trip_for_recurring_occurrence(uuid, uuid, date) from public;
grant execute on function public.create_trip_for_recurring_occurrence(uuid, uuid, date) to authenticated;
