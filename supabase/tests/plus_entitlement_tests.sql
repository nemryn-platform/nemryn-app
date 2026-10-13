-- Nemryn Plus -- entitlement foundation tests (NP-P1-S1).
-- ROLLBACK-ONLY: the whole file runs inside one transaction that is rolled back at the end, so it leaves no row,
-- audit event or status change behind (no cleanup section needed, unlike older suites).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_entitlement_tests.sql
-- Expect every "TEST ...: PASS" line and a final "SUMMARY ... failures = 0".
--
-- Covers 20261013100000_plus_entitlement_foundation.sql: E1-E18 of
-- docs/product/NP-P1-S1-entitlement-implementation-brief.md section 5.1 (as corrected in NP-P1-S1), plus transition
-- and audit cases. Seed fixtures: Org A admin a1, dispatcher a2, driver a3 (Driver 30..a1), inactive dispatcher a5;
-- c1 = admin in A + driver in B; Org B admin b1; d1 = platform admin (no membership); e1 = no membership.
-- Note: inside one transaction now() is constant, so date arithmetic below is exact.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table plus_results (n serial, name text, ok boolean, detail text);
grant all on plus_results to public;
grant usage on sequence plus_results_n_seq to public;

create function pg_temp.try_as(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute p_stmt; exception when others then reset role; return sqlstate; end;
  reset role;
  return 'OK';
end;
$$;

create function pg_temp.val_as(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute p_stmt into v; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return v;
end;
$$;

create function pg_temp.t(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into plus_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;

-- Effective state as seen by a caller.
create function pg_temp.state_as(p_uid uuid, p_org uuid)
returns text language sql as $$
  select pg_temp.val_as('authenticated', p_uid, format('select (public.plus_access_state(%L)).state', p_org));
$$;

-- A Platform Admin call (d1) of platform_set_organization_module; returns 'changed=<bool>' or the sqlstate.
create function pg_temp.set_plus(p_org uuid, p_status text, p_days integer, p_ends timestamptz, p_restr text, p_reason text default 'S1 test reason')
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000d1',
    format('select ''changed='' || (public.platform_set_organization_module(%L, ''plus'', %L, %s, %s, %s, %L)).changed',
      p_org, p_status, coalesce(p_days::text, 'null'), coalesce(quote_literal(p_ends), 'null'), coalesce(quote_literal(p_restr), 'null'), p_reason)), 'NULL');
$$;

create function pg_temp.audits(p_org uuid)
returns bigint language sql as $$
  select count(*) from public.audit_events where organization_id = p_org and action = 'platform_plus_access_changed';
$$;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_unknown constant uuid := '10000000-0000-0000-0000-00000000dead';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  c_a3 constant uuid := '20000000-0000-0000-0000-0000000000a3';
  c_a5 constant uuid := '20000000-0000-0000-0000-0000000000a5';
  c_b1 constant uuid := '20000000-0000-0000-0000-0000000000b1';
  c_c1 constant uuid := '20000000-0000-0000-0000-0000000000c1';
  c_d1 constant uuid := '20000000-0000-0000-0000-0000000000d1';
  c_e1 constant uuid := '20000000-0000-0000-0000-0000000000e1';
  v text;
  v_ok boolean;
  v_row public.organization_modules%rowtype;
  v_snap_before text;
  v_snap_after text;
  v_audit_before bigint;
  v_stmt text;
begin
  -- ===================================================================== E1 table privileges
  foreach v_stmt in array array[
    'select * from public.organization_modules',
    $q$insert into public.organization_modules (organization_id, module, status, status_reason) values ('10000000-0000-0000-0000-0000000000a1', 'plus', 'active', 'x y z')$q$,
    $q$update public.organization_modules set status = 'active'$q$,
    'delete from public.organization_modules'
  ] loop
    perform pg_temp.t('E1 anon denied: ' || left(v_stmt, 40), pg_temp.try_as('anon', null, v_stmt) = '42501', pg_temp.try_as('anon', null, v_stmt));
    perform pg_temp.t('E1 authenticated (Org A admin) denied: ' || left(v_stmt, 40), pg_temp.try_as('authenticated', c_a1, v_stmt) = '42501', pg_temp.try_as('authenticated', c_a1, v_stmt));
    perform pg_temp.t('E1 authenticated (platform admin) denied: ' || left(v_stmt, 40), pg_temp.try_as('authenticated', c_d1, v_stmt) = '42501', pg_temp.try_as('authenticated', c_d1, v_stmt));
    perform pg_temp.t('E1 service_role denied: ' || left(v_stmt, 40), pg_temp.try_as('service_role', null, v_stmt) = '42501', pg_temp.try_as('service_role', null, v_stmt));
  end loop;

  -- ===================================================================== E2 only Platform Admin may mutate / read the platform view
  foreach v_stmt in array array[
    format($q$select public.platform_set_organization_module(%L, 'plus', 'trial', null, null, null, 'self grant attempt')$q$, c_a),
    format($q$select public.platform_extend_plus_trial(%L, 5, 'self extend attempt')$q$, c_a),
    format($q$select public.platform_get_organization_module(%L, 'plus')$q$, c_a)
  ] loop
    perform pg_temp.t('E2 Org A admin refused: ' || left(v_stmt, 52), pg_temp.try_as('authenticated', c_a1, v_stmt) = 'ZW002', pg_temp.try_as('authenticated', c_a1, v_stmt));
    perform pg_temp.t('E2 Org A dispatcher refused: ' || left(v_stmt, 52), pg_temp.try_as('authenticated', c_a2, v_stmt) = 'ZW002', pg_temp.try_as('authenticated', c_a2, v_stmt));
    perform pg_temp.t('E2 driver refused: ' || left(v_stmt, 52), pg_temp.try_as('authenticated', c_a3, v_stmt) = 'ZW002', pg_temp.try_as('authenticated', c_a3, v_stmt));
    perform pg_temp.t('E2 no-membership user refused: ' || left(v_stmt, 52), pg_temp.try_as('authenticated', c_e1, v_stmt) = 'ZW002', pg_temp.try_as('authenticated', c_e1, v_stmt));
    perform pg_temp.t('E2 authenticated without uid refused: ' || left(v_stmt, 52), pg_temp.try_as('authenticated', null, v_stmt) = 'ZW001', pg_temp.try_as('authenticated', null, v_stmt));
    perform pg_temp.t('E2 anon has no EXECUTE: ' || left(v_stmt, 52), pg_temp.try_as('anon', null, v_stmt) = '42501', pg_temp.try_as('anon', null, v_stmt));
    perform pg_temp.t('E2 service_role has no EXECUTE: ' || left(v_stmt, 52), pg_temp.try_as('service_role', null, v_stmt) = '42501', pg_temp.try_as('service_role', null, v_stmt));
  end loop;
  perform pg_temp.t('E2 no entitlement row was created by any refused call', not exists (select 1 from public.organization_modules));

  -- ===================================================================== E8 / E14 / E15 before any grant
  perform pg_temp.t('E8 no row: Org A admin sees none', pg_temp.state_as(c_a1, c_a) = 'none', pg_temp.state_as(c_a1, c_a));
  perform pg_temp.t('E8 platform view: provisioned = false',
    pg_temp.val_as('authenticated', c_d1, format($q$select (public.platform_get_organization_module(%L, 'plus')).provisioned$q$, c_a)) = 'false');
  foreach v in array array['anon', 'authenticated', 'service_role'] loop
    perform pg_temp.t('E14 _plus_entitlement_state not executable by ' || v,
      pg_temp.try_as(v, c_a1, format('select public._plus_entitlement_state(%L)', c_a)) = '42501');
  end loop;
  perform pg_temp.t('E15 unknown organization: set -> ZW002', pg_temp.set_plus(c_unknown, 'active', null, null, null) = 'ERR:ZW002', pg_temp.set_plus(c_unknown, 'active', null, null, null));
  perform pg_temp.t('E15 unknown organization: extend -> ZW002',
    pg_temp.try_as('authenticated', c_d1, format($q$select public.platform_extend_plus_trial(%L, 5, 'reason x')$q$, c_unknown)) = 'ZW002');
  perform pg_temp.t('E15 unknown organization: get -> ZW002',
    pg_temp.try_as('authenticated', c_d1, format($q$select public.platform_get_organization_module(%L, 'plus')$q$, c_unknown)) = 'ZW002');
  perform pg_temp.t('T ending / restricting an organization without Plus -> ZW004 (expired)', pg_temp.set_plus(c_a, 'expired', null, null, null) = 'ERR:ZW004');
  perform pg_temp.t('T ending / restricting an organization without Plus -> ZW004 (cancelled)', pg_temp.set_plus(c_a, 'cancelled', null, null, null) = 'ERR:ZW004');
  perform pg_temp.t('T ending / restricting an organization without Plus -> ZW004 (disabled)', pg_temp.set_plus(c_a, 'disabled', null, null, 'no_access') = 'ERR:ZW004');

  -- ===================================================================== E5 input validation (ZW006)
  perform pg_temp.t('E5 trial days 6', pg_temp.set_plus(c_a, 'trial', 6, null, null) = 'ERR:ZW006');
  perform pg_temp.t('E5 trial days 31', pg_temp.set_plus(c_a, 'trial', 31, null, null) = 'ERR:ZW006');
  perform pg_temp.t('E5 trial with access end', pg_temp.set_plus(c_a, 'trial', 14, now() + interval '60 days', null) = 'ERR:ZW006');
  perform pg_temp.t('E5 trial with restriction', pg_temp.set_plus(c_a, 'trial', 14, null, 'read_only') = 'ERR:ZW006');
  perform pg_temp.t('E5 non-trial with trial days', pg_temp.set_plus(c_a, 'active', 14, null, null) = 'ERR:ZW006');
  perform pg_temp.t('E5 active with past access end', pg_temp.set_plus(c_a, 'active', null, now() - interval '1 day', null) = 'ERR:ZW006');
  perform pg_temp.t('E5 active with restriction', pg_temp.set_plus(c_a, 'active', null, null, 'read_only') = 'ERR:ZW006');
  perform pg_temp.t('E5 disabled without restriction', pg_temp.set_plus(c_a, 'disabled', null, null, null) = 'ERR:ZW006');
  perform pg_temp.t('E5 disabled with unknown restriction', pg_temp.set_plus(c_a, 'disabled', null, null, 'partial') = 'ERR:ZW006');
  perform pg_temp.t('E5 expired with restriction', pg_temp.set_plus(c_a, 'expired', null, null, 'read_only') = 'ERR:ZW006');
  perform pg_temp.t('E5 cancelled with access end', pg_temp.set_plus(c_a, 'cancelled', null, now() + interval '9 days', null) = 'ERR:ZW006');
  perform pg_temp.t('E5 unknown status', pg_temp.set_plus(c_a, 'paused', null, null, null) = 'ERR:ZW006');
  perform pg_temp.t('E5 blank reason', pg_temp.set_plus(c_a, 'active', null, null, null, '   ') = 'ERR:ZW006');
  perform pg_temp.t('E5 2-char reason', pg_temp.set_plus(c_a, 'active', null, null, null, 'ab') = 'ERR:ZW006');
  perform pg_temp.t('E5 501-char reason', pg_temp.set_plus(c_a, 'active', null, null, null, repeat('x', 501)) = 'ERR:ZW006');
  perform pg_temp.t('E5 unknown module',
    pg_temp.try_as('authenticated', c_d1, format($q$select public.platform_set_organization_module(%L, 'crm', 'active', null, null, null, 'reason x')$q$, c_a)) = 'ZW006');
  perform pg_temp.t('E5 get with unknown module',
    pg_temp.try_as('authenticated', c_d1, format($q$select public.platform_get_organization_module(%L, 'crm')$q$, c_a)) = 'ZW006');
  perform pg_temp.t('E5 nothing written by invalid calls', not exists (select 1 from public.organization_modules) and pg_temp.audits(c_a) = 0);

  -- ===================================================================== E12 snapshot of Org A Core state before any grant
  select format('%s|%s|%s|%s|%s|%s', o.status,
    (select count(*) from public.memberships where organization_id = c_a),
    (select count(*) filter (where status = 'active') from public.memberships where organization_id = c_a),
    (select count(*) from public.trips where organization_id = c_a),
    (select count(*) from public.transportation_requests where organization_id = c_a),
    (select count(*) from public.drivers where organization_id = c_a))
  into v_snap_before from public.organizations o where o.id = c_a;

  -- ===================================================================== E3 / E16 trial start (default 14 days)
  v := pg_temp.set_plus(c_a, 'trial', null, null, null, 'Pilot evaluation');
  perform pg_temp.t('E3 Platform Admin starts a trial', v = 'changed=true', v);
  select * into v_row from public.organization_modules where organization_id = c_a;
  perform pg_temp.t('E16 default trial is 14 days', v_row.trial_ends_at = now() + interval '14 days' and v_row.trial_started_at = now(), v_row.trial_ends_at::text);
  perform pg_temp.t('E3 row: status trial, no restriction, no access end, extension count 0',
    v_row.status = 'trial' and v_row.restriction is null and v_row.access_ends_at is null and v_row.trial_extension_count = 0);
  perform pg_temp.t('E3 row: updated_by = platform admin, status_reason stored', v_row.updated_by = c_d1 and v_row.status_reason = 'Pilot evaluation');
  perform pg_temp.t('E3 one audit event', pg_temp.audits(c_a) = 1, pg_temp.audits(c_a)::text);
  perform pg_temp.t('E3 audit: actor d1, reason, entity, before null, after trial',
    exists (select 1 from public.audit_events where organization_id = c_a and action = 'platform_plus_access_changed'
      and actor_user_id = c_d1 and reason = 'Pilot evaluation' and entity_type = 'organization_module' and entity_id = c_a
      and before_data is null and after_data ->> 'status' = 'trial' and after_data ->> 'module' = 'plus'));
  perform pg_temp.t('E3 Org A admin: write', pg_temp.state_as(c_a1, c_a) = 'write', pg_temp.state_as(c_a1, c_a));
  perform pg_temp.t('E3 Org A admin: trial_ends_at returned',
    pg_temp.val_as('authenticated', c_a1, format('select (public.plus_access_state(%L)).trial_ends_at = now() + interval ''14 days''', c_a)) = 'true');
  perform pg_temp.t('E3 platform view: provisioned, write, trial',
    pg_temp.val_as('authenticated', c_d1, format($q$select (s).provisioned::text || (s).effective_state || (s).status from public.platform_get_organization_module(%L, 'plus') s$q$, c_a)) = 'truewritetrial');

  -- ===================================================================== E9 / E11 nobody else learns the entitlement
  perform pg_temp.t('E9 Org A dispatcher: none', pg_temp.state_as(c_a2, c_a) = 'none');
  perform pg_temp.t('E9 Org A driver: none', pg_temp.state_as(c_a3, c_a) = 'none');
  perform pg_temp.t('E9 inactive Org A dispatcher: none', pg_temp.state_as(c_a5, c_a) = 'none');
  perform pg_temp.t('E9 Org B admin asking about Org A: none', pg_temp.state_as(c_b1, c_a) = 'none');
  perform pg_temp.t('E9 no-membership user: none', pg_temp.state_as(c_e1, c_a) = 'none');
  perform pg_temp.t('E9 anon: no EXECUTE', pg_temp.try_as('anon', null, format('select public.plus_access_state(%L)', c_a)) = '42501');
  perform pg_temp.t('E9 null organization: none', pg_temp.state_as(c_a1, null) = 'none');
  perform pg_temp.t('E11 Platform Admin without membership: none', pg_temp.state_as(c_d1, c_a) = 'none');
  perform pg_temp.t('E8 Org B (no row): Org B admin none', pg_temp.state_as(c_b1, c_b) = 'none');
  perform pg_temp.t('E9 c1 (admin in A, driver in B): write in A, none in B', pg_temp.state_as(c_c1, c_a) = 'write' and pg_temp.state_as(c_c1, c_b) = 'none');
  -- inactive Organization Admin (owner-level flip inside this transaction)
  update public.memberships set status = 'inactive' where organization_id = c_a and user_id = c_c1;
  perform pg_temp.t('E9 inactive Org A admin: none', pg_temp.state_as(c_c1, c_a) = 'none');
  update public.memberships set status = 'active' where organization_id = c_a and user_id = c_c1;

  -- ===================================================================== E4 / trial idempotency (corrected rule)
  v_audit_before := pg_temp.audits(c_a);
  v := pg_temp.set_plus(c_a, 'trial', null, null, null);
  perform pg_temp.t('E4b repeated start-trial is refused (no silent restart)', v = 'ERR:ZW004', v);
  v := pg_temp.set_plus(c_a, 'trial', 30, null, null);
  perform pg_temp.t('E4b start-trial with other days is refused too', v = 'ERR:ZW004', v);
  perform pg_temp.t('E4b trial dates unchanged by refused restarts',
    (select trial_ends_at = now() + interval '14 days' from public.organization_modules where organization_id = c_a));
  perform pg_temp.t('E4b no audit for refused restarts', pg_temp.audits(c_a) = v_audit_before);

  -- ===================================================================== E17 one extension
  perform pg_temp.t('E17 extend 0 days -> ZW006', pg_temp.try_as('authenticated', c_d1, format($q$select public.platform_extend_plus_trial(%L, 0, 'reason x')$q$, c_a)) = 'ZW006');
  perform pg_temp.t('E17 extend 31 days -> ZW006', pg_temp.try_as('authenticated', c_d1, format($q$select public.platform_extend_plus_trial(%L, 31, 'reason x')$q$, c_a)) = 'ZW006');
  perform pg_temp.t('E17 extend blank reason -> ZW006', pg_temp.try_as('authenticated', c_d1, format($q$select public.platform_extend_plus_trial(%L, 5, '  ')$q$, c_a)) = 'ZW006');
  v := pg_temp.val_as('authenticated', c_d1, format($q$select (r).changed::text || '/' || (r).trial_extension_count from public.platform_extend_plus_trial(%L, 10, 'Sales asked for 10 more days') r$q$, c_a));
  perform pg_temp.t('E17 first extension accepted', v = 'true/1', v);
  perform pg_temp.t('E17 trial end moved by exactly 10 days',
    (select trial_ends_at = now() + interval '24 days' and trial_extension_count = 1 from public.organization_modules where organization_id = c_a));
  perform pg_temp.t('E17 extension audited', pg_temp.audits(c_a) = v_audit_before + 1
    and exists (select 1 from public.audit_events where organization_id = c_a and action = 'platform_plus_access_changed'
      and reason = 'Sales asked for 10 more days' and (before_data ->> 'trial_extension_count') = '0' and (after_data ->> 'trial_extension_count') = '1'));
  perform pg_temp.t('E17 second extension -> ZW004', pg_temp.try_as('authenticated', c_d1, format($q$select public.platform_extend_plus_trial(%L, 5, 'reason x')$q$, c_a)) = 'ZW004');
  perform pg_temp.t('E17 extend without a row -> ZW004', pg_temp.try_as('authenticated', c_d1, format($q$select public.platform_extend_plus_trial(%L, 5, 'reason x')$q$, c_b)) = 'ZW004');

  -- ===================================================================== active + E4 identical update no-op
  v := pg_temp.set_plus(c_a, 'active', null, null, null, 'Converted to paid');
  perform pg_temp.t('T trial -> active', v = 'changed=true', v);
  perform pg_temp.t('T active keeps trial history (started / ends / extension)',
    (select trial_started_at is not null and trial_ends_at = now() + interval '24 days' and trial_extension_count = 1 from public.organization_modules where organization_id = c_a));
  perform pg_temp.t('T active open-ended: write', pg_temp.state_as(c_a1, c_a) = 'write');
  perform pg_temp.t('T active: no trial_ends_at returned to the admin',
    pg_temp.val_as('authenticated', c_a1, format('select (public.plus_access_state(%L)).trial_ends_at is null', c_a)) = 'true');
  v_audit_before := pg_temp.audits(c_a);
  v := pg_temp.set_plus(c_a, 'active', null, null, null, 'Same again');
  perform pg_temp.t('E4 identical active update: changed = false', v = 'changed=false', v);
  perform pg_temp.t('E4 identical active update: no audit, reason not overwritten',
    pg_temp.audits(c_a) = v_audit_before and (select status_reason from public.organization_modules where organization_id = c_a) = 'Converted to paid');
  perform pg_temp.t('E17 extend while active -> ZW004', pg_temp.try_as('authenticated', c_d1, format($q$select public.platform_extend_plus_trial(%L, 5, 'reason x')$q$, c_a)) = 'ZW004');
  v := pg_temp.set_plus(c_a, 'active', null, now() + interval '30 days', null, 'Paid through next month');
  perform pg_temp.t('T active with future access end: changed', v = 'changed=true', v);
  perform pg_temp.t('T active with future access end: write', pg_temp.state_as(c_a1, c_a) = 'write');
  v := pg_temp.set_plus(c_a, 'active', null, now() + interval '30 days', null, 'Same end date');
  perform pg_temp.t('E4 identical active update with access end: changed = false', v = 'changed=false', v);

  -- ===================================================================== E7 read-only states
  update public.organization_modules set access_ends_at = now() - interval '1 second' where organization_id = c_a;
  perform pg_temp.t('E7 active with elapsed access end: read_only', pg_temp.state_as(c_a1, c_a) = 'read_only', pg_temp.state_as(c_a1, c_a));
  v := pg_temp.set_plus(c_a, 'expired', null, null, null, 'Did not renew');
  perform pg_temp.t('T active -> expired', v = 'changed=true', v);
  perform pg_temp.t('E7 expired: read_only', pg_temp.state_as(c_a1, c_a) = 'read_only');
  perform pg_temp.t('T expired clears access end', (select access_ends_at is null from public.organization_modules where organization_id = c_a));
  v := pg_temp.set_plus(c_a, 'trial', null, null, null);
  perform pg_temp.t('E4c no second trial after expiry (consumed) -> ZW004', v = 'ERR:ZW004', v);
  v := pg_temp.set_plus(c_a, 'cancelled', null, null, null, 'Customer cancelled');
  perform pg_temp.t('T expired -> cancelled', v = 'changed=true', v);
  perform pg_temp.t('E7 cancelled: read_only', pg_temp.state_as(c_a1, c_a) = 'read_only');
  v := pg_temp.set_plus(c_a, 'disabled', null, null, 'read_only', 'Billing dispute freeze');
  perform pg_temp.t('T cancelled -> disabled read_only', v = 'changed=true', v);
  perform pg_temp.t('E7 disabled + read_only: read_only', pg_temp.state_as(c_a1, c_a) = 'read_only');
  perform pg_temp.t('E9 read_only is still invisible to the dispatcher', pg_temp.state_as(c_a2, c_a) = 'none');

  -- ===================================================================== E7a locked
  v := pg_temp.set_plus(c_a, 'disabled', null, null, 'no_access', 'Security review');
  perform pg_temp.t('T disabled read_only -> disabled no_access (restriction change is a real change)', v = 'changed=true', v);
  perform pg_temp.t('E7a locked for the Org A admin', pg_temp.state_as(c_a1, c_a) = 'locked', pg_temp.state_as(c_a1, c_a));
  perform pg_temp.t('E7a none for dispatcher / driver / Org B admin / platform admin / no-membership',
    pg_temp.state_as(c_a2, c_a) = 'none' and pg_temp.state_as(c_a3, c_a) = 'none' and pg_temp.state_as(c_b1, c_a) = 'none'
    and pg_temp.state_as(c_d1, c_a) = 'none' and pg_temp.state_as(c_e1, c_a) = 'none');
  perform pg_temp.t('E7a platform view shows locked + restriction',
    pg_temp.val_as('authenticated', c_d1, format($q$select (s).effective_state || '/' || (s).restriction from public.platform_get_organization_module(%L, 'plus') s$q$, c_a)) = 'locked/no_access');

  -- ===================================================================== E6 elapsed trial (Org B, owner-level date shift)
  v := pg_temp.set_plus(c_b, 'trial', 7, null, null, 'Short evaluation');
  perform pg_temp.t('E6 Org B 7-day trial accepted', v = 'changed=true'
    and (select trial_ends_at = now() + interval '7 days' from public.organization_modules where organization_id = c_b), v);
  perform pg_temp.t('E6 Org B admin: write', pg_temp.state_as(c_b1, c_b) = 'write');
  perform pg_temp.t('E6 Org A admin cannot see Org B', pg_temp.state_as(c_a1, c_b) = 'none');
  update public.organization_modules set trial_started_at = now() - interval '8 days', trial_ends_at = now() - interval '1 second' where organization_id = c_b;
  perform pg_temp.t('E6 elapsed trial: read_only', pg_temp.state_as(c_b1, c_b) = 'read_only', pg_temp.state_as(c_b1, c_b));
  perform pg_temp.t('E6 elapsed trial: no trial_ends_at returned (not write)',
    pg_temp.val_as('authenticated', c_b1, format('select (public.plus_access_state(%L)).trial_ends_at is null', c_b)) = 'true');
  v := pg_temp.val_as('authenticated', c_d1, format($q$select (r).changed::text || '/' || (r).effective_state from public.platform_extend_plus_trial(%L, 30, 'Late extension') r$q$, c_b));
  perform pg_temp.t('E17 an elapsed (still trial) trial can be extended once, from now', v = 'true/write'
    and (select trial_ends_at = now() + interval '30 days' from public.organization_modules where organization_id = c_b), v);
  v := pg_temp.set_plus(c_b, 'trial', 30, null, null);
  perform pg_temp.t('E4b Org B trial restart refused', v = 'ERR:ZW004', v);

  -- ===================================================================== E10 / E13 suspension vs Plus
  update public.organizations set status = 'inactive' where id = c_b;
  perform pg_temp.t('E10 suspended Org B with Plus write: admin sees none', pg_temp.state_as(c_b1, c_b) = 'none');
  update public.organizations set status = 'active' where id = c_b;
  perform pg_temp.t('E10 reactivated Org B: admin sees write again', pg_temp.state_as(c_b1, c_b) = 'write');
  select row_to_json(m)::text into v_snap_after from public.organization_modules m where organization_id = c_b;
  v := pg_temp.val_as('authenticated', c_d1, format($q$select (public.set_platform_organization_status(%L, 'inactive', 'S1 suspension test')).changed::text$q$, c_b));
  perform pg_temp.t('E13 platform suspension of Org B succeeds', v = 'true', v);
  perform pg_temp.t('E13 suspension does not touch organization_modules',
    (select row_to_json(m)::text from public.organization_modules m where organization_id = c_b) = v_snap_after);
  perform pg_temp.t('E13 suspended organization: Plus none for its admin', pg_temp.state_as(c_b1, c_b) = 'none');
  v := pg_temp.set_plus(c_b, 'active', null, null, null, 'Entitlement change while suspended');
  perform pg_temp.t('E13 entitlement can still be managed while suspended (no Core effect)', v = 'changed=true', v);
  perform pg_temp.t('E13 organization stays suspended after an entitlement change', (select status from public.organizations where id = c_b) = 'inactive');
  perform pg_temp.t('E13 suspended organization: still none for its admin', pg_temp.state_as(c_b1, c_b) = 'none');
  perform pg_temp.t('E13 the platform view still reports the stored state', pg_temp.val_as('authenticated', c_d1,
    format($q$select (public.platform_get_organization_module(%L, 'plus')).effective_state$q$, c_b)) = 'write');
  update public.organizations set status = 'active' where id = c_b;

  -- ===================================================================== E12 Core state unchanged by every entitlement change in Org A
  select format('%s|%s|%s|%s|%s|%s', o.status,
    (select count(*) from public.memberships where organization_id = c_a),
    (select count(*) filter (where status = 'active') from public.memberships where organization_id = c_a),
    (select count(*) from public.trips where organization_id = c_a),
    (select count(*) from public.transportation_requests where organization_id = c_a),
    (select count(*) from public.drivers where organization_id = c_a))
  into v_snap_after from public.organizations o where o.id = c_a;
  perform pg_temp.t('E12 Org A organizations.status / memberships / trips / requests / drivers unchanged', v_snap_before = v_snap_after, v_snap_before || ' vs ' || v_snap_after);

  -- ===================================================================== audit totals
  perform pg_temp.t('T Org A: one audit event per real change (8)', pg_temp.audits(c_a) = 8, pg_temp.audits(c_a)::text);
  perform pg_temp.t('T Org B: one audit event per real change (3)', pg_temp.audits(c_b) = 3, pg_temp.audits(c_b)::text);
  perform pg_temp.t('T audit rows never carry tenant content (only the entitlement keys)', not exists (
    select 1 from public.audit_events a where a.action = 'platform_plus_access_changed'
      and exists (select 1 from jsonb_object_keys(a.after_data) k
        where k not in ('module', 'status', 'restriction', 'trial_ends_at', 'trial_extension_count', 'access_ends_at'))));
  perform pg_temp.t('T organization_modules table still has no client grant',
    not has_table_privilege('authenticated', 'public.organization_modules', 'select')
    and not has_table_privilege('anon', 'public.organization_modules', 'select')
    and not has_table_privilege('service_role', 'public.organization_modules', 'select'));
end;
$$;

-- =====================================================================================================================
-- E18 Core regression: the request -> accept -> trip -> assign happy path is identical under every Plus state.
-- Runs as the Org A dispatcher (a2) and as the Org A admin (a1). Each iteration uses its own request / trip, far in the
-- future and an hour apart, so they never overlap.
-- =====================================================================================================================
create function pg_temp.core_path(p_uid uuid, p_hour integer)
returns text language plpgsql as $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  v_req uuid; v_trip uuid; v text;
begin
  v := pg_temp.val_as('authenticated', p_uid, format($q$select (public.log_transportation_request(%L, 'S1 Regression Requester', 'self', '555-0100', 'S1 pickup', 'S1 destination', 'no', 'phone', null, null, null, null, null, null)).request_id::text$q$, c_a));
  if v like 'ERR:%' then return 'log ' || v; end if;
  v_req := v::uuid;
  v := pg_temp.try_as('authenticated', p_uid, format($q$select public.link_request_passenger(%L, %L, '40000000-0000-0000-0000-0000000000a1')$q$, c_a, v_req));
  if v <> 'OK' then return 'link ' || v; end if;
  v := pg_temp.try_as('authenticated', p_uid, format($q$select public.accept_transportation_request(%L, %L)$q$, c_a, v_req));
  if v <> 'OK' then return 'accept ' || v; end if;
  v := pg_temp.val_as('authenticated', p_uid, format($q$select (public.create_trip(%L, '40000000-0000-0000-0000-0000000000a1', 'S1 pickup', 'S1 destination', %L::timestamptz, null, null, null, null, null, %L, null, null)).trip_id::text$q$,
    c_a, (date_trunc('day', now()) + interval '40 days' + make_interval(hours => p_hour)), v_req));
  if v like 'ERR:%' then return 'create_trip ' || v; end if;
  v_trip := v::uuid;
  v := pg_temp.try_as('authenticated', p_uid, format($q$select public.assign_trip(%L, '30000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1')$q$, v_trip));
  if v <> 'OK' then return 'assign ' || v; end if;
  return 'OK';
end;
$$;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  v_state text;
  v_hour integer := 0;
  v1 text; v2 text;
begin
  -- Org A is 'disabled + no_access' (locked) at this point; walk every state, owner-level, and run the Core path.
  foreach v_state in array array['none', 'trial', 'active', 'expired', 'read_only', 'locked'] loop
    delete from public.organization_modules where organization_id = c_a;
    if v_state = 'trial' then
      insert into public.organization_modules (organization_id, module, status, trial_started_at, trial_ends_at, status_reason)
      values (c_a, 'plus', 'trial', now(), now() + interval '14 days', 'E18 fixture');
    elsif v_state = 'active' then
      insert into public.organization_modules (organization_id, module, status, status_reason) values (c_a, 'plus', 'active', 'E18 fixture');
    elsif v_state = 'expired' then
      insert into public.organization_modules (organization_id, module, status, status_reason) values (c_a, 'plus', 'expired', 'E18 fixture');
    elsif v_state = 'read_only' then
      insert into public.organization_modules (organization_id, module, status, restriction, status_reason) values (c_a, 'plus', 'disabled', 'read_only', 'E18 fixture');
    elsif v_state = 'locked' then
      insert into public.organization_modules (organization_id, module, status, restriction, status_reason) values (c_a, 'plus', 'disabled', 'no_access', 'E18 fixture');
    end if;
    v_hour := v_hour + 1;
    v1 := pg_temp.core_path(c_a2, v_hour);
    v_hour := v_hour + 1;
    v2 := pg_temp.core_path(c_a1, v_hour);
    perform pg_temp.t('E18 Core path with Plus ' || v_state || ': dispatcher ' || v1 || ', admin ' || v2, v1 = 'OK' and v2 = 'OK');
  end loop;
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from plus_results;
select name, detail from plus_results where not ok order by n;

rollback;
