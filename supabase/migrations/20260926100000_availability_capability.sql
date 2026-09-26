-- =============================================================================
-- P1-OPS-PROG5B -- Availability + Vehicle Capability Foundation (expand-only)
-- Spec: docs/reports/p1-ops-prog5a-availability-capability-spec.txt (amended, §0A)
--
-- Adds, additively and with no backfill:
--   * driver_weekly_schedules (explicit CONFIGURED state; no row = SCHEDULE NOT SET)
--   * driver_weekly_shifts (organization-local weekday + wall-clock times; overnight when end < start)
--   * driver_unavailability_windows / vehicle_unavailability_windows ([starts_at, ends_at), no reason column)
--   * vehicles.wheelchair_ramp / wheelchair_lift / wheelchair_positions / seated_capacity (NULL = unknown)
--   * trips.requires_wheelchair_access, recurring_arrangements.requires_wheelchair_access (NULL = not specified)
-- Replaces create_trip (12 -> 13 args, trailing optional requirement) and create_recurring_arrangement
-- (8 -> 9 args, trailing optional requirement) in place (drop + create in this transaction; named-argument callers
-- keep working), and create_trip_for_recurring_occurrence (same identity) to SNAPSHOT the arrangement requirement.
-- All writes go through SECURITY DEFINER RPCs (search_path pinned, REVOKE PUBLIC, GRANT authenticated). The new
-- tables get SELECT for Organization Admin / Dispatcher only; Drivers read their own schedule only through
-- driver_get_own_schedule. No new service-role path. No actor columns on the new tables (audit_events is the
-- attribution record). No free-text reason anywhere.
-- =============================================================================

-- =============================================================================
-- 1. Tables
-- =============================================================================
create table public.driver_weekly_schedules (
  driver_id uuid primary key,
  organization_id uuid not null,
  configured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_weekly_schedules_driver_org_key unique (driver_id, organization_id),
  constraint driver_weekly_schedules_driver_fkey foreign key (driver_id, organization_id)
    references public.drivers (id, organization_id) on delete cascade
);
comment on table public.driver_weekly_schedules is
  'P1-OPS-PROG5. Explicit CONFIGURED marker for a driver''s single current weekly schedule. No row = SCHEDULE NOT SET (never off shift, never available). Written only by set_/clear_driver_weekly_schedule.';

create table public.driver_weekly_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  driver_id uuid not null,
  weekday smallint not null,
  start_time time not null,
  end_time time not null,
  constraint driver_weekly_shifts_weekday_iso check (weekday between 1 and 7),
  constraint driver_weekly_shifts_distinct_times check (start_time <> end_time),
  constraint driver_weekly_shifts_minute_precision check (
    extract(second from start_time) = 0 and extract(second from end_time) = 0
  ),
  constraint driver_weekly_shifts_schedule_fkey foreign key (driver_id, organization_id)
    references public.driver_weekly_schedules (driver_id, organization_id) on delete cascade
);
create index driver_weekly_shifts_org_driver_idx on public.driver_weekly_shifts (organization_id, driver_id);
comment on table public.driver_weekly_shifts is
  'P1-OPS-PROG5. Organization-LOCAL wall-clock shift (ISO weekday 1..7). end_time < start_time = overnight, ending on the next local day (00:00 = midnight). Never stored as UTC. Non-overlap on the weekly ring is validated by set_driver_weekly_schedule.';

create table public.driver_unavailability_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  driver_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_unavailability_windows_ordered check (ends_at > starts_at),
  constraint driver_unavailability_windows_max_length check (ends_at - starts_at <= interval '366 days'),
  constraint driver_unavailability_windows_driver_fkey foreign key (driver_id, organization_id)
    references public.drivers (id, organization_id) on delete cascade
);
create index driver_unavailability_windows_org_start_idx on public.driver_unavailability_windows (organization_id, starts_at, id);
create index driver_unavailability_windows_org_driver_idx on public.driver_unavailability_windows (organization_id, driver_id, starts_at);
comment on table public.driver_unavailability_windows is
  'P1-OPS-PROG5. One-off driver unavailability [starts_at, ends_at). Timing only: deliberately NO reason / category / note column (personnel-data minimization). Max 366 days.';

create table public.vehicle_unavailability_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  vehicle_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_unavailability_windows_ordered check (ends_at > starts_at),
  constraint vehicle_unavailability_windows_max_length check (ends_at - starts_at <= interval '366 days'),
  constraint vehicle_unavailability_windows_vehicle_fkey foreign key (vehicle_id, organization_id)
    references public.vehicles (id, organization_id) on delete cascade
);
create index vehicle_unavailability_windows_org_start_idx on public.vehicle_unavailability_windows (organization_id, starts_at, id);
create index vehicle_unavailability_windows_org_vehicle_idx on public.vehicle_unavailability_windows (organization_id, vehicle_id, starts_at);
comment on table public.vehicle_unavailability_windows is
  'P1-OPS-PROG5. Time-bounded out-of-service window [starts_at, ends_at) for a vehicle. Advisory only (warnings); distinct from vehicles.status. No reason column; not a maintenance system.';

-- =============================================================================
-- 2. Additive nullable columns (NULL = unknown / not specified; no backfill)
-- =============================================================================
alter table public.vehicles
  add column wheelchair_ramp boolean,
  add column wheelchair_lift boolean,
  add column wheelchair_positions smallint,
  add column seated_capacity smallint;
alter table public.vehicles
  add constraint vehicles_wheelchair_positions_range check (wheelchair_positions is null or wheelchair_positions between 0 and 20),
  add constraint vehicles_seated_capacity_range check (seated_capacity is null or seated_capacity between 0 and 60);
comment on column public.vehicles.wheelchair_ramp is 'P1-OPS-PROG5. Recorded equipment fact; NULL = not recorded (never assumed false). Written only by set_vehicle_capabilities.';
comment on column public.vehicles.wheelchair_lift is 'P1-OPS-PROG5. Recorded equipment fact; NULL = not recorded. Written only by set_vehicle_capabilities.';
comment on column public.vehicles.wheelchair_positions is 'P1-OPS-PROG5. Wheelchair securement positions (0..20); NULL = not recorded. Written only by set_vehicle_capabilities.';
comment on column public.vehicles.seated_capacity is 'P1-OPS-PROG5. Seated passenger capacity (0..60); NULL = not recorded. Recorded only; no warning uses it in PROG5.';

alter table public.trips add column requires_wheelchair_access boolean;
comment on column public.trips.requires_wheelchair_access is
  'P1-OPS-PROG5. true = wheelchair transport equipment required; false = operator says not required; NULL = not specified. Never inferred from notes / passenger history. Set by create_trip, set_trip_wheelchair_requirement, or snapshotted from the recurring arrangement at occurrence creation.';

alter table public.recurring_arrangements add column requires_wheelchair_access boolean;
comment on column public.recurring_arrangements.requires_wheelchair_access is
  'P1-OPS-PROG5 (Q4). NULL = not specified; true / false as for trips. SNAPSHOTTED onto each occurrence Trip when it is created; later changes never rewrite existing trips.';

-- =============================================================================
-- 3. RLS (deny by default; SELECT for Organization Admin / Dispatcher; no write policy, no write grant)
-- =============================================================================
alter table public.driver_weekly_schedules enable row level security;
alter table public.driver_weekly_shifts enable row level security;
alter table public.driver_unavailability_windows enable row level security;
alter table public.vehicle_unavailability_windows enable row level security;

create policy driver_weekly_schedules_select_org_operations on public.driver_weekly_schedules
  for select to authenticated using (public.has_org_role(organization_id, array['organization_admin', 'dispatcher']));
create policy driver_weekly_shifts_select_org_operations on public.driver_weekly_shifts
  for select to authenticated using (public.has_org_role(organization_id, array['organization_admin', 'dispatcher']));
create policy driver_unavailability_windows_select_org_operations on public.driver_unavailability_windows
  for select to authenticated using (public.has_org_role(organization_id, array['organization_admin', 'dispatcher']));
create policy vehicle_unavailability_windows_select_org_operations on public.vehicle_unavailability_windows
  for select to authenticated using (public.has_org_role(organization_id, array['organization_admin', 'dispatcher']));

revoke all on public.driver_weekly_schedules, public.driver_weekly_shifts,
  public.driver_unavailability_windows, public.vehicle_unavailability_windows from public, anon, authenticated;
grant select on public.driver_weekly_schedules, public.driver_weekly_shifts,
  public.driver_unavailability_windows, public.vehicle_unavailability_windows to authenticated;

-- =============================================================================
-- 4. Result types
-- =============================================================================
create type public.driver_schedule_result as (
  driver_id uuid,
  organization_id uuid,
  configured boolean,
  shift_count integer,
  changed boolean
);
create type public.unavailability_window_result as (
  window_id uuid,
  resource_id uuid,
  organization_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  deleted boolean,
  changed boolean
);
create type public.vehicle_capabilities_result as (
  vehicle_id uuid,
  wheelchair_ramp boolean,
  wheelchair_lift boolean,
  wheelchair_positions smallint,
  seated_capacity smallint,
  changed boolean
);
create type public.wheelchair_requirement_result as (
  entity_id uuid,
  requires_wheelchair_access boolean,
  changed boolean
);
create type public.driver_own_schedule_result as (
  driver_id uuid,
  organization_id uuid,
  timezone text,
  configured boolean,
  shifts jsonb,
  upcoming_unavailability jsonb
);

-- =============================================================================
-- 5. Driver weekly schedule
-- =============================================================================
create function public.set_driver_weekly_schedule(p_driver_id uuid, p_shifts jsonb)
returns public.driver_schedule_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_driver public.drivers;
  v_item jsonb;
  v_weekday smallint;
  v_start time;
  v_end time;
  v_new jsonb := '[]'::jsonb;
  v_old jsonb;
  v_was_configured boolean;
  v_count integer;
  v_result public.driver_schedule_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  select * into v_driver from public.drivers where id = p_driver_id;
  if not found or not public.has_org_role(v_driver.organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  if p_shifts is null or jsonb_typeof(p_shifts) <> 'array' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  v_count := jsonb_array_length(p_shifts);
  if v_count < 1 or v_count > 28 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  for v_item in select value from jsonb_array_elements(p_shifts) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'weekday') <> 'number'
       or coalesce(v_item ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(v_item ->> 'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    if (v_item ->> 'weekday')::numeric <> trunc((v_item ->> 'weekday')::numeric)
       or (v_item ->> 'weekday')::numeric < 1 or (v_item ->> 'weekday')::numeric > 7 then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    v_weekday := (v_item ->> 'weekday')::smallint;
    v_start := (v_item ->> 'start')::time;
    v_end := (v_item ->> 'end')::time;
    if v_start = v_end then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
    v_new := v_new || jsonb_build_array(jsonb_build_object('weekday', v_weekday, 'start', to_char(v_start, 'HH24:MI'), 'end', to_char(v_end, 'HH24:MI')));
  end loop;

  -- Non-overlap on the recurring WEEK AS A RING (10080 minutes). Each shift occupies [s, s + d) where
  -- s = (weekday - 1) * 1440 + start minutes and d = (end - start) mod 1440 (1..1440; overnight when end < start).
  -- Two shifts overlap when either intersects the other, or the other shifted by +/- one week (Sunday overnight
  -- spilling into Monday). Touching boundaries do not overlap (half-open).
  if exists (
    with s as (
      select ordinality as k,
             ((e ->> 'weekday')::int - 1) * 1440 + extract(epoch from (e ->> 'start')::time)::int / 60 as st,
             ((extract(epoch from (e ->> 'end')::time)::int / 60 - extract(epoch from (e ->> 'start')::time)::int / 60 + 1440) % 1440) as du
      from jsonb_array_elements(v_new) with ordinality as t(e, ordinality)
    )
    select 1
    from s a join s b on a.k < b.k
    cross join (values (-10080), (0), (10080)) as w(shift)
    where a.st < b.st + w.shift + b.du and b.st + w.shift < a.st + a.du
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- Serialize concurrent setters for this driver.
  perform 1 from public.drivers where id = v_driver.id for update;

  select exists (select 1 from public.driver_weekly_schedules where driver_id = v_driver.id) into v_was_configured;
  select coalesce(jsonb_agg(jsonb_build_object('weekday', weekday, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI'))
                            order by weekday, start_time, end_time), '[]'::jsonb)
    into v_old from public.driver_weekly_shifts where driver_id = v_driver.id;

  select coalesce(jsonb_agg(e order by (e ->> 'weekday')::int, e ->> 'start', e ->> 'end'), '[]'::jsonb)
    into v_new from jsonb_array_elements(v_new) as e;

  v_result.driver_id := v_driver.id;
  v_result.organization_id := v_driver.organization_id;
  v_result.configured := true;
  v_result.shift_count := jsonb_array_length(v_new);

  if v_was_configured and v_old = v_new then
    v_result.changed := false;
    return v_result;
  end if;

  insert into public.driver_weekly_schedules (driver_id, organization_id)
  values (v_driver.id, v_driver.organization_id)
  on conflict (driver_id) do update set updated_at = now();

  delete from public.driver_weekly_shifts where driver_id = v_driver.id;
  insert into public.driver_weekly_shifts (organization_id, driver_id, weekday, start_time, end_time)
  select v_driver.organization_id, v_driver.id, (e ->> 'weekday')::smallint, (e ->> 'start')::time, (e ->> 'end')::time
  from jsonb_array_elements(v_new) as e;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_driver.organization_id, 'driver', v_driver.id, 'driver_schedule_set', auth.uid(),
          case when v_was_configured then jsonb_build_object('shifts', v_old) else null end,
          jsonb_build_object('shifts', v_new));

  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.set_driver_weekly_schedule(uuid, jsonb) is
  'P1-OPS-PROG5. Organization Admin / Dispatcher of the driver''s organization (else ZW002). Atomically marks the driver''s weekly schedule CONFIGURED and replaces ALL shifts. p_shifts: 1..28 {weekday 1..7, start "HH:MM", end "HH:MM"} (organization-local; end < start = overnight; start = end rejected); shifts must not overlap on the weekly ring (Sunday overnight vs Monday included); ZW006 otherwise. Idempotent (changed), audited as driver_schedule_set (times only).';
revoke all on function public.set_driver_weekly_schedule(uuid, jsonb) from public;
grant execute on function public.set_driver_weekly_schedule(uuid, jsonb) to authenticated;

create function public.clear_driver_weekly_schedule(p_driver_id uuid)
returns public.driver_schedule_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_driver public.drivers;
  v_old jsonb;
  v_result public.driver_schedule_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  select * into v_driver from public.drivers where id = p_driver_id;
  if not found or not public.has_org_role(v_driver.organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  perform 1 from public.drivers where id = v_driver.id for update;

  v_result.driver_id := v_driver.id;
  v_result.organization_id := v_driver.organization_id;
  v_result.configured := false;
  v_result.shift_count := 0;

  if not exists (select 1 from public.driver_weekly_schedules where driver_id = v_driver.id) then
    v_result.changed := false;
    return v_result;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('weekday', weekday, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI'))
                            order by weekday, start_time, end_time), '[]'::jsonb)
    into v_old from public.driver_weekly_shifts where driver_id = v_driver.id;
  delete from public.driver_weekly_schedules where driver_id = v_driver.id; -- shifts cascade

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_driver.organization_id, 'driver', v_driver.id, 'driver_schedule_cleared', auth.uid(),
          jsonb_build_object('shifts', v_old), null);

  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.clear_driver_weekly_schedule(uuid) is
  'P1-OPS-PROG5. Organization Admin / Dispatcher (else ZW002). Returns the driver to SCHEDULE NOT SET (deletes the configuration row; shifts cascade). Idempotent, audited as driver_schedule_cleared.';
revoke all on function public.clear_driver_weekly_schedule(uuid) from public;
grant execute on function public.clear_driver_weekly_schedule(uuid) to authenticated;

-- =============================================================================
-- 6. Unavailability windows (driver + vehicle)
-- =============================================================================
create function public.save_driver_unavailability(
  p_driver_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_window_id uuid default null
)
returns public.unavailability_window_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_driver public.drivers;
  v_window public.driver_unavailability_windows;
  v_result public.unavailability_window_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  select * into v_driver from public.drivers where id = p_driver_id;
  if not found or not public.has_org_role(v_driver.organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '366 days' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_result.resource_id := v_driver.id;
  v_result.organization_id := v_driver.organization_id;
  v_result.starts_at := p_starts_at;
  v_result.ends_at := p_ends_at;
  v_result.deleted := false;

  if p_window_id is null then
    insert into public.driver_unavailability_windows (organization_id, driver_id, starts_at, ends_at)
    values (v_driver.organization_id, v_driver.id, p_starts_at, p_ends_at)
    returning * into v_window;
    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
    values (v_driver.organization_id, 'driver', v_driver.id, 'driver_unavailability_added', auth.uid(), null,
            jsonb_build_object('window_id', v_window.id, 'starts_at', p_starts_at, 'ends_at', p_ends_at));
    v_result.window_id := v_window.id;
    v_result.changed := true;
    return v_result;
  end if;

  select * into v_window from public.driver_unavailability_windows
  where id = p_window_id and driver_id = v_driver.id and organization_id = v_driver.organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_result.window_id := v_window.id;
  if v_window.starts_at = p_starts_at and v_window.ends_at = p_ends_at then
    v_result.changed := false;
    return v_result;
  end if;
  update public.driver_unavailability_windows set starts_at = p_starts_at, ends_at = p_ends_at, updated_at = now()
  where id = v_window.id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_driver.organization_id, 'driver', v_driver.id, 'driver_unavailability_changed', auth.uid(),
          jsonb_build_object('window_id', v_window.id, 'starts_at', v_window.starts_at, 'ends_at', v_window.ends_at),
          jsonb_build_object('window_id', v_window.id, 'starts_at', p_starts_at, 'ends_at', p_ends_at));
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.save_driver_unavailability(uuid, timestamptz, timestamptz, uuid) is
  'P1-OPS-PROG5. Organization Admin / Dispatcher (else ZW002). Creates (p_window_id NULL) or updates a driver unavailability window [starts_at, ends_at) (ends > starts, <= 366 days; ZW006). Timing only -- no reason. Audited as driver_unavailability_added / _changed.';
revoke all on function public.save_driver_unavailability(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.save_driver_unavailability(uuid, timestamptz, timestamptz, uuid) to authenticated;

create function public.delete_driver_unavailability(p_window_id uuid)
returns public.unavailability_window_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window public.driver_unavailability_windows;
  v_result public.unavailability_window_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  select * into v_window from public.driver_unavailability_windows where id = p_window_id for update;
  if not found or not public.has_org_role(v_window.organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  delete from public.driver_unavailability_windows where id = v_window.id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_window.organization_id, 'driver', v_window.driver_id, 'driver_unavailability_removed', auth.uid(),
          jsonb_build_object('window_id', v_window.id, 'starts_at', v_window.starts_at, 'ends_at', v_window.ends_at), null);
  v_result.window_id := v_window.id;
  v_result.resource_id := v_window.driver_id;
  v_result.organization_id := v_window.organization_id;
  v_result.starts_at := v_window.starts_at;
  v_result.ends_at := v_window.ends_at;
  v_result.deleted := true;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.delete_driver_unavailability(uuid) is
  'P1-OPS-PROG5. Organization Admin / Dispatcher of the window''s organization (else ZW002). Deletes a driver unavailability window; audited as driver_unavailability_removed (timestamps only).';
revoke all on function public.delete_driver_unavailability(uuid) from public;
grant execute on function public.delete_driver_unavailability(uuid) to authenticated;

create function public.save_vehicle_unavailability(
  p_vehicle_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_window_id uuid default null
)
returns public.unavailability_window_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vehicle public.vehicles;
  v_window public.vehicle_unavailability_windows;
  v_result public.unavailability_window_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  select * into v_vehicle from public.vehicles where id = p_vehicle_id;
  if not found or not public.has_org_role(v_vehicle.organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '366 days' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_result.resource_id := v_vehicle.id;
  v_result.organization_id := v_vehicle.organization_id;
  v_result.starts_at := p_starts_at;
  v_result.ends_at := p_ends_at;
  v_result.deleted := false;

  if p_window_id is null then
    insert into public.vehicle_unavailability_windows (organization_id, vehicle_id, starts_at, ends_at)
    values (v_vehicle.organization_id, v_vehicle.id, p_starts_at, p_ends_at)
    returning * into v_window;
    insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
    values (v_vehicle.organization_id, 'vehicle', v_vehicle.id, 'vehicle_unavailability_added', auth.uid(), null,
            jsonb_build_object('window_id', v_window.id, 'starts_at', p_starts_at, 'ends_at', p_ends_at));
    v_result.window_id := v_window.id;
    v_result.changed := true;
    return v_result;
  end if;

  select * into v_window from public.vehicle_unavailability_windows
  where id = p_window_id and vehicle_id = v_vehicle.id and organization_id = v_vehicle.organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  v_result.window_id := v_window.id;
  if v_window.starts_at = p_starts_at and v_window.ends_at = p_ends_at then
    v_result.changed := false;
    return v_result;
  end if;
  update public.vehicle_unavailability_windows set starts_at = p_starts_at, ends_at = p_ends_at, updated_at = now()
  where id = v_window.id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_vehicle.organization_id, 'vehicle', v_vehicle.id, 'vehicle_unavailability_changed', auth.uid(),
          jsonb_build_object('window_id', v_window.id, 'starts_at', v_window.starts_at, 'ends_at', v_window.ends_at),
          jsonb_build_object('window_id', v_window.id, 'starts_at', p_starts_at, 'ends_at', p_ends_at));
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.save_vehicle_unavailability(uuid, timestamptz, timestamptz, uuid) is
  'P1-OPS-PROG5. Organization Admin / Dispatcher (else ZW002). Creates (p_window_id NULL) or updates a vehicle out-of-service window [starts_at, ends_at) (ends > starts, <= 366 days; ZW006). Advisory only; does not change vehicles.status. Audited as vehicle_unavailability_added / _changed.';
revoke all on function public.save_vehicle_unavailability(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.save_vehicle_unavailability(uuid, timestamptz, timestamptz, uuid) to authenticated;

create function public.delete_vehicle_unavailability(p_window_id uuid)
returns public.unavailability_window_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window public.vehicle_unavailability_windows;
  v_result public.unavailability_window_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  select * into v_window from public.vehicle_unavailability_windows where id = p_window_id for update;
  if not found or not public.has_org_role(v_window.organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  delete from public.vehicle_unavailability_windows where id = v_window.id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_window.organization_id, 'vehicle', v_window.vehicle_id, 'vehicle_unavailability_removed', auth.uid(),
          jsonb_build_object('window_id', v_window.id, 'starts_at', v_window.starts_at, 'ends_at', v_window.ends_at), null);
  v_result.window_id := v_window.id;
  v_result.resource_id := v_window.vehicle_id;
  v_result.organization_id := v_window.organization_id;
  v_result.starts_at := v_window.starts_at;
  v_result.ends_at := v_window.ends_at;
  v_result.deleted := true;
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.delete_vehicle_unavailability(uuid) is
  'P1-OPS-PROG5. Organization Admin / Dispatcher (else ZW002). Deletes a vehicle out-of-service window; audited as vehicle_unavailability_removed.';
revoke all on function public.delete_vehicle_unavailability(uuid) from public;
grant execute on function public.delete_vehicle_unavailability(uuid) to authenticated;

-- =============================================================================
-- 7. Vehicle capabilities (Organization Admin ONLY -- Q1)
-- =============================================================================
create function public.set_vehicle_capabilities(
  p_vehicle_id uuid,
  p_wheelchair_ramp boolean,
  p_wheelchair_lift boolean,
  p_wheelchair_positions integer,
  p_seated_capacity integer
)
returns public.vehicle_capabilities_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vehicle public.vehicles;
  v_result public.vehicle_capabilities_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  select * into v_vehicle from public.vehicles where id = p_vehicle_id for update;
  if not found or not public.has_org_role(v_vehicle.organization_id, array['organization_admin']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if (p_wheelchair_positions is not null and (p_wheelchair_positions < 0 or p_wheelchair_positions > 20))
     or (p_seated_capacity is not null and (p_seated_capacity < 0 or p_seated_capacity > 60)) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  v_result.vehicle_id := v_vehicle.id;
  v_result.wheelchair_ramp := p_wheelchair_ramp;
  v_result.wheelchair_lift := p_wheelchair_lift;
  v_result.wheelchair_positions := p_wheelchair_positions;
  v_result.seated_capacity := p_seated_capacity;
  if v_vehicle.wheelchair_ramp is not distinct from p_wheelchair_ramp
     and v_vehicle.wheelchair_lift is not distinct from p_wheelchair_lift
     and v_vehicle.wheelchair_positions is not distinct from p_wheelchair_positions::smallint
     and v_vehicle.seated_capacity is not distinct from p_seated_capacity::smallint then
    v_result.changed := false;
    return v_result;
  end if;

  update public.vehicles
  set wheelchair_ramp = p_wheelchair_ramp, wheelchair_lift = p_wheelchair_lift,
      wheelchair_positions = p_wheelchair_positions, seated_capacity = p_seated_capacity, updated_at = now()
  where id = v_vehicle.id;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_vehicle.organization_id, 'vehicle', v_vehicle.id, 'vehicle_capabilities_updated', auth.uid(),
          jsonb_build_object('wheelchair_ramp', v_vehicle.wheelchair_ramp, 'wheelchair_lift', v_vehicle.wheelchair_lift,
                             'wheelchair_positions', v_vehicle.wheelchair_positions, 'seated_capacity', v_vehicle.seated_capacity),
          jsonb_build_object('wheelchair_ramp', p_wheelchair_ramp, 'wheelchair_lift', p_wheelchair_lift,
                             'wheelchair_positions', p_wheelchair_positions, 'seated_capacity', p_seated_capacity));
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.set_vehicle_capabilities(uuid, boolean, boolean, integer, integer) is
  'P1-OPS-PROG5 (Q1). Organization ADMIN of the vehicle''s organization only (Dispatcher / Driver / foreign tenant: ZW002). Atomically sets all four recorded equipment facts; NULL = not recorded. positions 0..20, seated 0..60 (ZW006). Records facts only -- never a regulatory claim. Idempotent, audited as vehicle_capabilities_updated.';
revoke all on function public.set_vehicle_capabilities(uuid, boolean, boolean, integer, integer) from public;
grant execute on function public.set_vehicle_capabilities(uuid, boolean, boolean, integer, integer) to authenticated;

-- =============================================================================
-- 8. Wheelchair requirement setters (trip + recurring arrangement)
-- =============================================================================
create function public.set_trip_wheelchair_requirement(p_trip_id uuid, p_requires_wheelchair_access boolean)
returns public.wheelchair_requirement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips;
  v_result public.wheelchair_requirement_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found or not public.has_org_role(v_trip.organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_trip.state in ('completed', 'cancelled', 'no_show') then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  v_result.entity_id := v_trip.id;
  v_result.requires_wheelchair_access := p_requires_wheelchair_access;
  if v_trip.requires_wheelchair_access is not distinct from p_requires_wheelchair_access then
    v_result.changed := false;
    return v_result;
  end if;
  update public.trips set requires_wheelchair_access = p_requires_wheelchair_access where id = v_trip.id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (v_trip.organization_id, 'trip', v_trip.id, 'trip_wheelchair_requirement_updated', auth.uid(),
          jsonb_build_object('requires_wheelchair_access', v_trip.requires_wheelchair_access),
          jsonb_build_object('requires_wheelchair_access', p_requires_wheelchair_access));
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.set_trip_wheelchair_requirement(uuid, boolean) is
  'P1-OPS-PROG5. Organization Admin / Dispatcher (else ZW002). Sets true / false or clears (NULL = not specified) a NON-TERMINAL trip''s wheelchair transport equipment requirement (terminal: ZW004). Idempotent, audited as trip_wheelchair_requirement_updated.';
revoke all on function public.set_trip_wheelchair_requirement(uuid, boolean) from public;
grant execute on function public.set_trip_wheelchair_requirement(uuid, boolean) to authenticated;

create function public.set_recurring_wheelchair_requirement(
  p_organization_id uuid,
  p_arrangement_id uuid,
  p_requires_wheelchair_access boolean
)
returns public.wheelchair_requirement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_arrangement public.recurring_arrangements;
  v_result public.wheelchair_requirement_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;
  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  select * into v_arrangement from public.recurring_arrangements
  where id = p_arrangement_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;
  if v_arrangement.status = 'ended' then
    raise exception 'illegal_transition' using errcode = 'ZW004';
  end if;
  v_result.entity_id := v_arrangement.id;
  v_result.requires_wheelchair_access := p_requires_wheelchair_access;
  if v_arrangement.requires_wheelchair_access is not distinct from p_requires_wheelchair_access then
    v_result.changed := false;
    return v_result;
  end if;
  update public.recurring_arrangements set requires_wheelchair_access = p_requires_wheelchair_access where id = v_arrangement.id;
  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (p_organization_id, 'recurring_arrangement', v_arrangement.id, 'recurring_arrangement_wheelchair_requirement_updated', auth.uid(),
          jsonb_build_object('requires_wheelchair_access', v_arrangement.requires_wheelchair_access),
          jsonb_build_object('requires_wheelchair_access', p_requires_wheelchair_access));
  v_result.changed := true;
  return v_result;
end;
$$;
comment on function public.set_recurring_wheelchair_requirement(uuid, uuid, boolean) is
  'P1-OPS-PROG5 (Q4). Organization Admin / Dispatcher (same roles as edit_recurring_arrangement; else ZW002). Sets / clears a non-ended arrangement''s wheelchair requirement (ended: ZW004). Affects only occurrence trips created AFTERWARDS (snapshot); never rewrites existing trips. Idempotent, audited as recurring_arrangement_wheelchair_requirement_updated.';
revoke all on function public.set_recurring_wheelchair_requirement(uuid, uuid, boolean) from public;
grant execute on function public.set_recurring_wheelchair_requirement(uuid, uuid, boolean) to authenticated;

-- =============================================================================
-- 9. create_trip -- trailing p_requires_wheelchair_access (12 -> 13 args; one overload only)
-- =============================================================================
drop function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid, integer);

create function public.create_trip(
  p_organization_id uuid,
  p_passenger_id uuid,
  p_pickup_description text,
  p_destination_description text,
  p_scheduled_pickup_at timestamptz default null,
  p_appointment_at timestamptz default null,
  p_pickup_facility_id uuid default null,
  p_destination_facility_id uuid default null,
  p_assistance_notes text default null,
  p_instructions text default null,
  p_request_id uuid default null,
  p_expected_duration_minutes integer default null,
  p_requires_wheelchair_access boolean default null
)
returns public.trip_creation_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pickup_description text;
  v_destination_description text;
  v_request public.transportation_requests;
  v_event_type text;
  v_new_trip_id uuid;
  v_duration integer;
  v_duration_source text;
  v_result public.trip_creation_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_pickup_description := nullif(btrim(p_pickup_description), '');
  v_destination_description := nullif(btrim(p_destination_description), '');
  if v_pickup_description is null or v_destination_description is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if length(v_pickup_description) > 2000 or length(v_destination_description) > 2000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_scheduled_pickup_at is not null and p_appointment_at is not null
     and p_appointment_at < p_scheduled_pickup_at then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_expected_duration_minutes is not null and (p_expected_duration_minutes < 1 or p_expected_duration_minutes > 2880) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_passenger_id is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not exists (
    select 1 from public.passengers
    where id = p_passenger_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_pickup_facility_id is not null and not exists (
    select 1 from public.facilities
    where id = p_pickup_facility_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_destination_facility_id is not null and not exists (
    select 1 from public.facilities
    where id = p_destination_facility_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_request_id is not null then
    select * into v_request
    from public.transportation_requests
    where id = p_request_id and organization_id = p_organization_id
    for update;

    if not found then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;

    if v_request.state <> 'accepted' then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;

    if v_request.passenger_id is distinct from p_passenger_id then
      raise exception 'invalid_input' using errcode = 'ZW006';
    end if;
  end if;

  if p_expected_duration_minutes is not null then
    v_duration := p_expected_duration_minutes;
    v_duration_source := 'trip';
  else
    select default_trip_duration_minutes into v_duration from public.organizations where id = p_organization_id;
    v_duration_source := case when v_duration is null then null else 'organization_default' end;
  end if;

  insert into public.trips (
    organization_id, request_id, passenger_id, state,
    scheduled_pickup_at, appointment_at, pickup_description, destination_description,
    pickup_facility_id, destination_facility_id, assistance_notes, instructions,
    expected_duration_minutes, expected_duration_source, requires_wheelchair_access
  ) values (
    p_organization_id, p_request_id, p_passenger_id, 'scheduled',
    p_scheduled_pickup_at, p_appointment_at, v_pickup_description, v_destination_description,
    p_pickup_facility_id, p_destination_facility_id, p_assistance_notes, p_instructions,
    v_duration, v_duration_source, p_requires_wheelchair_access
  )
  returning id into v_new_trip_id;

  v_event_type := case when p_request_id is not null then 'request_converted_to_trip' else 'trip_scheduled' end;

  insert into public.trip_events (organization_id, trip_id, event_type, actor_user_id, metadata)
  values (p_organization_id, v_new_trip_id, v_event_type, auth.uid(), jsonb_build_object('request_id', p_request_id));

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'trip', v_new_trip_id, 'trip_created', auth.uid(),
    null,
    jsonb_build_object('state', 'scheduled', 'passenger_id', p_passenger_id, 'request_id', p_request_id,
                       'expected_duration_minutes', v_duration, 'expected_duration_source', v_duration_source,
                       'requires_wheelchair_access', p_requires_wheelchair_access)
  );

  v_result.trip_id := v_new_trip_id;
  v_result.organization_id := p_organization_id;
  v_result.state := 'scheduled';
  v_result.created := true;
  return v_result;
end;
$$;

comment on function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid, integer, boolean) is
  'Organization Admin / Dispatcher only. The sole controlled path to create a Trip — state is always ''scheduled'', never caller-supplied. Does not assign a Driver/Vehicle (use assign_trip). Non-idempotent by design. When p_request_id is supplied: the Request must be ACCEPTED (pending/declined/cancelled: ZW006), this function never changes the Request state, and the Request''s linked passenger_id must equal p_passenger_id (ZW006). P1-OPS-PROG4: optional p_expected_duration_minutes (1..2880, ZW006 otherwise); when omitted, the organization default in force is snapshotted (source organization_default), else the duration stays UNKNOWN. P1-OPS-PROG5: optional p_requires_wheelchair_access (NULL = not specified); stored exactly as supplied -- never inferred from the Request or any notes. See docs/data/mutation-api.md.';

revoke all on function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid, integer, boolean) from public;
grant execute on function public.create_trip(uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, text, uuid, integer, boolean) to authenticated;

-- =============================================================================
-- 10. create_recurring_arrangement -- trailing p_requires_wheelchair_access (8 -> 9 args; one overload only)
-- =============================================================================
drop function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date);

create function public.create_recurring_arrangement(
  p_organization_id uuid,
  p_passenger_id uuid,
  p_pickup_description text,
  p_destination_description text,
  p_pickup_time time,
  p_days_of_week smallint[],
  p_start_date date,
  p_end_date date default null,
  p_requires_wheelchair_access boolean default null
)
returns public.recurring_arrangement_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pickup_description text;
  v_destination_description text;
  v_days_of_week smallint[];
  v_timezone text;
  v_new public.recurring_arrangements;
  v_result public.recurring_arrangement_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  if not public.has_org_role(p_organization_id, array['organization_admin', 'dispatcher']) then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_pickup_description := nullif(btrim(p_pickup_description), '');
  v_destination_description := nullif(btrim(p_destination_description), '');
  if v_pickup_description is null or v_destination_description is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if length(v_pickup_description) > 2000 or length(v_destination_description) > 2000 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_pickup_time is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_start_date is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select array_agg(distinct d order by d) into v_days_of_week
  from unnest(p_days_of_week) as d
  where d is not null;

  if v_days_of_week is null or cardinality(v_days_of_week) = 0 then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if exists (select 1 from unnest(v_days_of_week) as d where d < 1 or d > 7) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not public._is_canonical_days_of_week(v_days_of_week) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  if p_passenger_id is null then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;
  if not exists (
    select 1 from public.passengers
    where id = p_passenger_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  select timezone into v_timezone from public.organizations where id = p_organization_id;
  if v_timezone is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  insert into public.recurring_arrangements (
    organization_id, passenger_id, pickup_description, destination_description,
    pickup_time, days_of_week, start_date, end_date, timezone, status, created_by, requires_wheelchair_access
  ) values (
    p_organization_id, p_passenger_id, v_pickup_description, v_destination_description,
    p_pickup_time, v_days_of_week, p_start_date, p_end_date, v_timezone, 'active', auth.uid(), p_requires_wheelchair_access
  )
  returning * into v_new;

  insert into public.audit_events (organization_id, entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    p_organization_id, 'recurring_arrangement', v_new.id, 'recurring_arrangement_created', auth.uid(),
    null,
    jsonb_build_object(
      'passenger_id', v_new.passenger_id, 'pickup_description', v_new.pickup_description,
      'destination_description', v_new.destination_description, 'pickup_time', v_new.pickup_time,
      'days_of_week', v_new.days_of_week, 'start_date', v_new.start_date, 'end_date', v_new.end_date,
      'timezone', v_new.timezone, 'status', v_new.status,
      'requires_wheelchair_access', v_new.requires_wheelchair_access
    )
  );

  v_result.arrangement_id := v_new.id;
  v_result.organization_id := v_new.organization_id;
  v_result.passenger_id := v_new.passenger_id;
  v_result.pickup_description := v_new.pickup_description;
  v_result.destination_description := v_new.destination_description;
  v_result.pickup_time := v_new.pickup_time;
  v_result.days_of_week := v_new.days_of_week;
  v_result.start_date := v_new.start_date;
  v_result.end_date := v_new.end_date;
  v_result.timezone := v_new.timezone;
  v_result.status := v_new.status;
  v_result.paused_at := v_new.paused_at;
  v_result.ended_at := v_new.ended_at;
  v_result.ended_reason := v_new.ended_reason;
  v_result.created_by := v_new.created_by;
  v_result.created_at := v_new.created_at;
  v_result.changed := true;
  return v_result;
end;
$$;

comment on function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date, boolean) is
  'Organization Admin / Dispatcher only. The sole controlled path to create a RecurringArrangement — status is always ''active'', paused_at/ended_at/ended_reason always NULL, created_by always auth.uid(), timezone always an Organization.timezone SNAPSHOT at creation time — none of these five fields is ever caller-influenced. Passenger must exist, same organization, status=''active'' (ZW006 otherwise, no existence oracle — same rule create_trip already enforces for its own passenger_id). days_of_week is normalized (deduplicated, ascending) before write; caller may supply any order. Non-idempotent by design (no natural idempotency key for creating new standing demand), matching create_trip/log_transportation_request. P1-OPS-PROG5 (Q4): optional p_requires_wheelchair_access (NULL = not specified), snapshotted onto occurrence trips at creation.';

revoke all on function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date, boolean) from public;
grant execute on function public.create_recurring_arrangement(uuid, uuid, text, text, time, smallint[], date, date, boolean) to authenticated;

-- =============================================================================
-- 11. create_trip_for_recurring_occurrence -- SNAPSHOT the arrangement requirement (identity unchanged)
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

  select * into v_arrangement
  from public.recurring_arrangements
  where id = p_arrangement_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

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

  -- IDEMPOTENCY (unchanged): an existing qualifying linked Trip is returned as-is -- never rewritten, so a later
  -- arrangement requirement change never mutates an already generated occurrence.
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

  select * into v_conversion from public._organization_local_to_utc(p_service_date, v_arrangement.pickup_time, v_arrangement.timezone);
  if v_conversion.status <> 'ok' then
    raise exception 'invalid_input' using errcode = 'ZW006';
  end if;

  -- REUSE create_trip by NAMED arguments (safe against the expanded signature). P1-OPS-PROG5 (Q4): the
  -- arrangement's CURRENT requires_wheelchair_access is SNAPSHOTTED onto the new Trip (and into its trip_created
  -- audit row). Nothing else about the call changed.
  select * into v_created_trip from public.create_trip(
    p_organization_id => v_arrangement.organization_id,
    p_passenger_id => v_arrangement.passenger_id,
    p_pickup_description => v_arrangement.pickup_description,
    p_destination_description => v_arrangement.destination_description,
    p_scheduled_pickup_at => v_conversion.utc,
    p_requires_wheelchair_access => v_arrangement.requires_wheelchair_access
  );

  update public.trips set recurring_arrangement_id = p_arrangement_id where id = v_created_trip.trip_id;

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

-- =============================================================================
-- 12. Driver own-schedule read (Q3) -- own active linked driver only; no driver_id parameter
-- =============================================================================
create function public.driver_get_own_schedule(p_organization_id uuid)
returns public.driver_own_schedule_result
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_driver_id uuid;
  v_result public.driver_own_schedule_result;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = 'ZW001';
  end if;

  v_driver_id := public.current_driver_id(p_organization_id);
  if v_driver_id is null then
    raise exception 'not_found' using errcode = 'ZW002';
  end if;

  v_result.driver_id := v_driver_id;
  v_result.organization_id := p_organization_id;
  select timezone into v_result.timezone from public.organizations where id = p_organization_id;
  v_result.configured := exists (select 1 from public.driver_weekly_schedules where driver_id = v_driver_id and organization_id = p_organization_id);
  select coalesce(jsonb_agg(jsonb_build_object('weekday', weekday, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI'))
                            order by weekday, start_time, end_time), '[]'::jsonb)
    into v_result.shifts
  from public.driver_weekly_shifts where driver_id = v_driver_id and organization_id = p_organization_id;
  select coalesce(jsonb_agg(jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at) order by starts_at), '[]'::jsonb)
    into v_result.upcoming_unavailability
  from public.driver_unavailability_windows
  where driver_id = v_driver_id and organization_id = p_organization_id
    and ends_at > now() and starts_at < now() + interval '14 days';
  return v_result;
end;
$$;
comment on function public.driver_get_own_schedule(uuid) is
  'P1-OPS-PROG5 (Q3). Driver-only, OWN data only: resolves the caller''s active linked Driver via current_driver_id (ZW002 otherwise) -- takes no driver_id, so it cannot address another driver. Returns the organization timezone, whether a weekly schedule is configured, own weekly shifts, and own unavailability windows overlapping the next 14 days. Read-only; no fleet or capability data.';
revoke all on function public.driver_get_own_schedule(uuid) from public;
grant execute on function public.driver_get_own_schedule(uuid) to authenticated;
