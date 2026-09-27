-- =============================================================================
-- P1-PILOT-R2C -- Dispatcher trip-completion recovery (PR-02) (database part).
-- Spec: docs/reports/p1-pilot-r2a-trip-correction-recovery-spec.txt sections 16-20, 27, 29 (+ owner decision D-6).
--
--   1. trip_events.event_type gains 'completion_recorded_by_operations' (additive; existing rows unaffected).
--   2. record_trip_completion_by_operations(...) -- the ONE exceptional path for Operations to close an in-progress
--      Trip whose Driver cannot complete it in Nemryn after the passenger is onboard. It never impersonates the Driver,
--      never writes a Driver lifecycle event (no trip_completed, no skipped en_route_to_destination /
--      arrived_at_destination), never edits an existing event or timestamp, and is not a generic state setter.
-- No other schema change. No new column, no recovery table, no service-role path.
-- =============================================================================

-- 1. trip_events vocabulary ----------------------------------------------------------------------------------------
alter table public.trip_events drop constraint trip_events_event_type_check;
alter table public.trip_events add constraint trip_events_event_type_check check (event_type = any (array[
  'trip_scheduled', 'en_route_to_pickup', 'arrived_at_pickup', 'passenger_onboard', 'en_route_to_destination',
  'arrived_at_destination', 'trip_completed', 'trip_cancelled', 'no_show_recorded', 'driver_assigned',
  'driver_reassigned', 'assignment_ended', 'note_added', 'exception_flagged', 'exception_resolved',
  'request_converted_to_trip',
  'trip_details_updated',
  'completion_recorded_by_operations'
]));

-- 2. record_trip_completion_by_operations ----------------------------------------------------------------------------
create function public.record_trip_completion_by_operations(
  p_trip_id uuid,
  p_expected_current_state text,
  p_completed_at timestamptz,
  p_note text
)
returns public.trip_transition_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips;
  v_assignment public.trip_assignments;
  v_note text;
  v_last_lifecycle_at timestamptz;
  v_result public.trip_transition_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  -- Organization is derived from the Trip row itself (never a client parameter). Driver (including the assigned
  -- Driver) / foreign tenant / inactive membership / suspended organization / Platform Admin without membership /
  -- not found: all the identical ZW002 (no existence oracle).
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found or not public.has_org_role(v_trip.organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  -- Optimistic concurrency: the operator's view of the state must still be current. A Driver who completed (or
  -- progressed) first makes this call stale; no second completion is ever written.
  if p_expected_current_state is null or v_trip.state is distinct from p_expected_current_state then
    raise exception 'stale_state' using errcode = 'ZW003';
  end if;

  -- Eligible starting states only (owner decision D-6). Earlier states have their own recovery paths (reassign,
  -- no-show, cancel); terminal Trips are never re-completed.
  if v_trip.state not in ('passenger_onboard', 'en_route_to_destination', 'arrived_at_destination') then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;

  -- An onboard Trip structurally has an active assignment. Its absence is an integrity problem: fail, never create or
  -- reconstruct one.
  select * into v_assignment
  from public.trip_assignments
  where trip_id = v_trip.id and organization_id = v_trip.organization_id and ended_at is null
  for update;
  if not found then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Required recovery note: how completion was confirmed. Trimmed, 10..500 characters.
  v_note := btrim(coalesce(p_note, ''));
  if length(v_note) < 10 or length(v_note) > 500 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- The operator-stated completion time: required (never inferred here), not more than 5 minutes in the future, and
  -- never before the latest lifecycle event that actually happened (no time travel).
  if p_completed_at is null or p_completed_at > now() + interval '5 minutes' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  select max(occurred_at) into v_last_lifecycle_at
  from public.trip_events
  where trip_id = v_trip.id
    and event_type in ('en_route_to_pickup', 'arrived_at_pickup', 'passenger_onboard', 'en_route_to_destination',
                       'arrived_at_destination');
  if v_last_lifecycle_at is not null and p_completed_at < v_last_lifecycle_at then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  update public.trips
    set state = 'completed',
        completed_at = p_completed_at
    where id = v_trip.id;

  -- The assigned Driver did perform the ride; the assignment ended by completion (the same end_reason the Driver's own
  -- completion writes), so completion-assignment facts stay truthful. The row is closed, never deleted or rewritten.
  update public.trip_assignments
    set ended_at = now(), end_reason = 'trip_completed'
    where id = v_assignment.id;

  -- Operational timeline: ONE provenance event -- never 'trip_completed', never a skipped Driver milestone. The note is
  -- NOT placed here (metadata carries only its presence).
  insert into public.trip_events (organization_id, trip_id, event_type, actor_user_id, metadata)
  values (v_trip.organization_id, v_trip.id, 'completion_recorded_by_operations', auth.uid(),
          jsonb_build_object('previous_state', v_trip.state, 'recorded_completed_at', p_completed_at, 'note_present', true));

  -- Administrative history (Organization Admin readable only): the note lives ONLY in audit_events.reason.
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, reason)
  values (v_trip.organization_id, 'trip', v_trip.id, 'trip_completion_recorded_by_operations', auth.uid(),
          jsonb_build_object('state', v_trip.state),
          jsonb_build_object('state', 'completed', 'completed_at', p_completed_at),
          v_note);

  v_result.trip_id := v_trip.id;
  v_result.previous_state := v_trip.state;
  v_result.current_state := 'completed';
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.record_trip_completion_by_operations(uuid, text, timestamptz, text) is
  'P1-PILOT-R2C (PR-02). Organization Admin / Dispatcher of the Trip''s organization only (otherwise ZW002, no oracle; the assigned Driver included). Exceptional recovery when the Driver cannot complete the Trip in Nemryn after pickup. Row-locked; p_expected_current_state must equal trips.state (ZW003); only passenger_onboard / en_route_to_destination / arrived_at_destination (ZW004 otherwise); an active assignment is required (ZW006 -- an integrity problem, never reconstructed); p_note trimmed 10..500 (ZW006); p_completed_at required, <= now() + 5 minutes and >= the latest existing lifecycle event (ZW006). Writes: trips.state=completed + completed_at=p_completed_at; the active assignment ended_at=now(), end_reason=trip_completed; ONE trip_events completion_recorded_by_operations (metadata previous_state / recorded_completed_at / note_present -- never the note); ONE audit_events trip_completion_recorded_by_operations (before state; after state + completed_at; reason = the note). Never writes trip_completed or any skipped Driver milestone.';

revoke all on function public.record_trip_completion_by_operations(uuid, text, timestamptz, text) from public;
grant execute on function public.record_trip_completion_by_operations(uuid, text, timestamptz, text) to authenticated;
