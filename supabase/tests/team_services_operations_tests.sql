-- Nemryn Platform -- Team & Access, Services & Intake, Operations preferences
-- and organization direct-write cleanup tests (P1-PILOT-S4B-R4C).
-- Run against `supabase db reset` fresh-seeded data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/team_services_operations_tests.sql
--
-- Covers 20260920110000_team_services_operations_settings.sql. Concurrency
-- (simultaneous last-admin removal, parallel invite accept/create) lives in
-- team_last_admin_concurrency_test.sh.
-- Seed fixtures: Org A admin a1 + admin c1 (multi-org), dispatcher a2, driver
-- a3, inactive dispatcher a5; Org B admin b1, dispatcher b2, driver b3;
-- platform admin d1; no-membership e1. Own fixtures under 95000000-...-nN.

\set ON_ERROR_STOP off
\pset pager off

create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    execute p_stmt;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'OK';
end;
$$;

-- Runs a scalar-returning statement as a user and returns its text (or 'ERR:'||sqlstate).
create or replace function pg_temp.val_as(p_role text, p_uid uuid, p_stmt text)
returns text language plpgsql as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    execute p_stmt into v;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate;
  end;
  reset role;
  return v;
end;
$$;

create or replace function pg_temp.report(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  if p_ok then raise notice 'TEST %: PASS', p_name;
  else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token
) values
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'r4c-new-invitee@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'r4c-existing-user@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'r4c-third@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'r4c-owner-one@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'r4c-owner-two@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', '');
-- n2 already belongs to Org B (dispatcher): the "existing Nemryn user" case.
insert into public.memberships (organization_id, user_id, role, status)
values ('10000000-0000-0000-0000-0000000000b1', '95000000-0000-0000-0000-000000000002', 'dispatcher', 'active');

-- scratch: tokens created during the run
create temp table t_tok (k text primary key, token text, invite_id uuid);
grant all on t_tok to public;

-- =============================================================================
-- A. INVITE CREATION
-- =============================================================================
do $$
declare
  v_res public.staff_invite_result; v_row public.staff_invites%rowtype; v_audit public.audit_events%rowtype;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', '  R4C-New-Invitee@Example.test ', 'dispatcher');
  reset role;
  insert into t_tok values ('new', v_res.token, v_res.invite_id);
  select * into v_row from public.staff_invites where id = v_res.invite_id;

  perform pg_temp.report('INV-1 (Org admin invites: pending, org derived, email lowercased, role dispatcher, ~7-day expiry)',
    v_row.status = 'pending' and v_row.organization_id = '10000000-0000-0000-0000-0000000000a1' and v_row.email = 'r4c-new-invitee@example.test'
    and v_row.role = 'dispatcher' and v_row.expires_at > now() + interval '6 days 23 hours' and v_row.expires_at < now() + interval '7 days 1 hour'
    and v_row.invited_by = '20000000-0000-0000-0000-0000000000a1' and not v_res.reissued, format('row=%s', row_to_json(v_row)));
  perform pg_temp.report('INV-2 (token: 64 hex chars, only its SHA-256 is stored, raw token nowhere in the table)',
    v_res.token ~ '^[0-9a-f]{64}$' and v_row.token_hash = encode(extensions.digest(v_res.token, 'sha256'), 'hex')
    and not exists (select 1 from public.staff_invites where token_hash = v_res.token or email = v_res.token));
  select * into v_audit from public.audit_events where entity_id = v_row.id and action = 'staff_invitation_created';
  perform pg_temp.report('INV-3 (staff_invitation_created AuditEvent: actor, email, role; no token in audit)',
    v_audit.actor_user_id = '20000000-0000-0000-0000-0000000000a1' and v_audit.after_data ->> 'role' = 'dispatcher'
    and v_audit.after_data ->> 'email' = 'r4c-new-invitee@example.test' and position(v_res.token in v_audit.after_data::text) = 0);
end $$;

do $$
declare
  v_stmt text := $q$select public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', 'r4c-x@example.test', 'dispatcher')$q$;
  v_before bigint := (select count(*) from public.staff_invites);
  v_bad text; v_codes text := '';
begin
  perform pg_temp.report('INV-10 (Dispatcher cannot invite)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', v_stmt) = 'ZW002');
  perform pg_temp.report('INV-11 (Driver cannot invite)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', v_stmt) = 'ZW002');
  perform pg_temp.report('INV-12 (inactive Membership cannot invite)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a5', v_stmt) = 'ZW002');
  perform pg_temp.report('INV-13 (no-Membership user cannot invite)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', v_stmt) = 'ZW002');
  perform pg_temp.report('INV-14 (Platform Admin without Membership cannot invite)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000d1', v_stmt) = 'ZW002');
  perform pg_temp.report('INV-15 (Org B admin cannot invite INTO Org A)', pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', v_stmt) = 'ZW002');
  perform pg_temp.report('INV-16 (anon: no EXECUTE; no session: ZW001; null org: ZW002)',
    pg_temp.try_as('anon', null, v_stmt) = '42501' and pg_temp.try_as('authenticated', null, v_stmt) = 'ZW001'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.create_staff_invite(null, 'r4c-x@example.test', 'dispatcher')$q$) = 'ZW002');
  foreach v_bad in array array['driver', 'platform_admin', 'operations_staff', 'ORGANIZATION_ADMIN', '', 'admin'] loop
    v_codes := v_codes || pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1',
      format('select public.create_staff_invite(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', 'r4c-y@example.test', v_bad)) || ',';
  end loop;
  perform pg_temp.report('INV-17 (only organization_admin|dispatcher can be invited: driver/platform_admin/other roles -> ZW006)', v_codes = 'ZW006,ZW006,ZW006,ZW006,ZW006,ZW006,', v_codes);
  perform pg_temp.report('INV-18 (null role and malformed / blank / oversize email -> ZW006)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', 'r4c-y@example.test', null)$q$) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', 'not-an-email', 'dispatcher')$q$) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', '   ', 'dispatcher')$q$) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.create_staff_invite(%L, %L, %L)', '10000000-0000-0000-0000-0000000000a1', repeat('a', 250) || '@x.example', 'dispatcher')) = 'ZW006');
  perform pg_temp.report('INV-19 (none of the denied/invalid attempts created an invitation)', (select count(*) from public.staff_invites) = v_before);
  perform pg_temp.report('INV-20 (surface: create takes only organization + email + role; accept only the token)',
    (select array_agg(a order by a) from (select unnest(proargnames) a from pg_proc where proname = 'create_staff_invite') s) = array['p_email', 'p_organization_id', 'p_role']
    and (select array_agg(a) from (select unnest(proargnames) a from pg_proc where proname = 'accept_staff_invite') s) = array['p_token']);
end $$;

-- INV-21: cannot invite someone who already holds an ACTIVE staff or ANY driver Membership of this org;
-- an INACTIVE staff member can be invited back.
do $$
begin
  perform pg_temp.report('INV-21 (already an active team member -> ZW006)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', 'org-a-dispatcher@example.test', 'organization_admin')$q$) = 'ZW006');
  perform pg_temp.report('INV-22 (a Driver of this org can never be invited as staff -> ZW006)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', 'org-a-driver-a@example.test', 'dispatcher')$q$) = 'ZW006');
  perform pg_temp.report('INV-23 (an INACTIVE staff member can be invited back)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', 'org-a-inactive@example.test', 'organization_admin')$q$) = 'OK');
end $$;

-- =============================================================================
-- B. PREVIEW / ACCEPT (new user)
-- =============================================================================
do $$
declare v_tok text := (select token from t_tok where k = 'new'); v_p public.staff_invite_preview; v_code text;
begin
  set local role anon;
  v_p := public.get_staff_invite_preview(v_tok);
  reset role;
  perform pg_temp.report('PREV-1 (anon can preview with the token: org name, invited email, role, effective status only)',
    v_p.organization_name = 'Fictional Org A' and v_p.email = 'r4c-new-invitee@example.test' and v_p.role = 'dispatcher' and v_p.status = 'pending');
  perform pg_temp.report('PREV-2 (wrong / short / null / blank token -> ZW002; nothing else leaks)',
    pg_temp.try_as('anon', null, $q$select public.get_staff_invite_preview(repeat('a', 64))$q$) = 'ZW002'
    and pg_temp.try_as('anon', null, $q$select public.get_staff_invite_preview('short')$q$) = 'ZW002'
    and pg_temp.try_as('anon', null, $q$select public.get_staff_invite_preview(null)$q$) = 'ZW002');
  perform pg_temp.report('PREV-3 (preview composite exposes exactly organization_name/email/role/status -- no id or organization_id)',
    (select array_agg(attname::text order by attnum) from pg_attribute where attrelid = (select typrelid from pg_type where oid = 'public.staff_invite_preview'::regtype) and attnum > 0)
    = array['organization_name', 'email', 'role', 'status']);

  -- ACCEPT by the WRONG signed-in identity: nothing happens.
  v_code := pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000003', format('select public.accept_staff_invite(%L)', v_tok));
  perform pg_temp.report('ACC-1 (a different signed-in user cannot use the token: ZW002, no Membership created)',
    v_code = 'ZW002' and not exists (select 1 from public.memberships where user_id = '95000000-0000-0000-0000-000000000003'));
  perform pg_temp.report('ACC-2 (anon cannot accept; no session -> ZW001)',
    pg_temp.try_as('anon', null, format('select public.accept_staff_invite(%L)', v_tok)) = '42501'
    and pg_temp.try_as('authenticated', null, format('select public.accept_staff_invite(%L)', v_tok)) = 'ZW001');
  perform pg_temp.report('ACC-3 (garbage tokens -> ZW002)',
    pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000001', $q$select public.accept_staff_invite(repeat('0', 64))$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000001', $q$select public.accept_staff_invite('x')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000001', $q$select public.accept_staff_invite(null)$q$) = 'ZW002');
end $$;

do $$
declare
  v_tok text := (select token from t_tok where k = 'new'); v_res public.staff_invite_acceptance_result; v_m public.memberships%rowtype;
  v_users bigint := (select count(*) from auth.users); v_audit public.audit_events%rowtype;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '95000000-0000-0000-0000-000000000001';
  v_res := public.accept_staff_invite(v_tok);
  reset role;
  select * into v_m from public.memberships where user_id = '95000000-0000-0000-0000-000000000001';
  perform pg_temp.report('ACC-10 (new user accepts: Membership created for THAT org with THE INVITED role, active)',
    v_res.membership_created and v_m.organization_id = '10000000-0000-0000-0000-0000000000a1' and v_m.role = 'dispatcher' and v_m.status = 'active');
  perform pg_temp.report('ACC-11 (invitation marked accepted by that user; no new auth identity created)',
    (select status || accepted_by::text from public.staff_invites where id = (select invite_id from t_tok where k = 'new')) = 'accepted95000000-0000-0000-0000-000000000001'
    and (select count(*) from auth.users) = v_users);
  select * into v_audit from public.audit_events where entity_id = (select invite_id from t_tok where k = 'new') and action = 'staff_invitation_accepted';
  perform pg_temp.report('ACC-12 (staff_invitation_accepted AuditEvent by the acceptor)', v_audit.actor_user_id = '95000000-0000-0000-0000-000000000001' and v_audit.after_data ->> 'membership_created' = 'true');

  -- single use
  set local role authenticated;
  set local request.jwt.claim.sub = '95000000-0000-0000-0000-000000000001';
  v_res := public.accept_staff_invite(v_tok);
  reset role;
  perform pg_temp.report('ACC-13 (repeat by the same person: idempotent no-op, still exactly one Membership)',
    not v_res.membership_created and (select count(*) from public.memberships where user_id = '95000000-0000-0000-0000-000000000001') = 1);
  perform pg_temp.report('ACC-14 (used token cannot be reused by anyone else: still ZW002)',
    pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000003', format('select public.accept_staff_invite(%L)', v_tok)) = 'ZW002');
  perform pg_temp.report('ACC-15 (preview of a used token says accepted)',
    (select status from public.get_staff_invite_preview(v_tok)) = 'accepted');
end $$;

-- EXISTING user (already a dispatcher in Org B) accepts an Org A ADMIN invite.
do $$
declare v_res public.staff_invite_result; v_acc public.staff_invite_acceptance_result; v_users bigint := (select count(*) from auth.users);
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', 'r4c-existing-user@example.test', 'organization_admin');
  reset role;
  set local role authenticated;
  set local request.jwt.claim.sub = '95000000-0000-0000-0000-000000000002';
  v_acc := public.accept_staff_invite(v_res.token);
  reset role;
  perform pg_temp.report('EXIST-1 (existing user accepts: gets organization_admin in Org A, no new auth identity)',
    v_acc.membership_created and v_acc.role = 'organization_admin'
    and exists (select 1 from public.memberships where user_id = '95000000-0000-0000-0000-000000000002' and organization_id = '10000000-0000-0000-0000-0000000000a1' and role = 'organization_admin' and status = 'active')
    and (select count(*) from auth.users) = v_users);
  perform pg_temp.report('EXIST-2 (their Org B Membership is preserved untouched -> multi-org)',
    exists (select 1 from public.memberships where user_id = '95000000-0000-0000-0000-000000000002' and organization_id = '10000000-0000-0000-0000-0000000000b1' and role = 'dispatcher' and status = 'active')
    and (select count(*) from public.memberships where user_id = '95000000-0000-0000-0000-000000000002') = 2);
end $$;

-- CANCEL / RESEND / EXPIRE ------------------------------------------------------
do $$
declare v_res public.staff_invite_result; v_id uuid; v_old text; v_new public.staff_invite_result; v_code text; v_p text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', 'r4c-third@example.test', 'dispatcher');
  reset role;
  v_id := v_res.invite_id; v_old := v_res.token;

  -- cancel
  perform pg_temp.report('CANCEL-1 (Dispatcher / foreign admin / no-membership cannot cancel: ZW002)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.cancel_staff_invite(%L)', v_id)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select public.cancel_staff_invite(%L)', v_id)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', format('select public.cancel_staff_invite(%L)', v_id)) = 'ZW002'
    and pg_temp.try_as('anon', null, format('select public.cancel_staff_invite(%L)', v_id)) = '42501');
  v_code := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.cancel_staff_invite(%L)', v_id));
  perform pg_temp.report('CANCEL-2 (admin cancels own pending invitation; AuditEvent staff_invitation_cancelled)',
    v_code = 'OK' and (select status from public.staff_invites where id = v_id) = 'cancelled'
    and exists (select 1 from public.audit_events where entity_id = v_id and action = 'staff_invitation_cancelled'));
  perform pg_temp.report('CANCEL-3 (CANCELLED token cannot be accepted: ZW003, no Membership; preview says cancelled)',
    pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000003', format('select public.accept_staff_invite(%L)', v_old)) = 'ZW003'
    and not exists (select 1 from public.memberships where user_id = '95000000-0000-0000-0000-000000000003')
    and (select status from public.get_staff_invite_preview(v_old)) = 'cancelled');
  perform pg_temp.report('CANCEL-4 (cancelling again / resending a cancelled one -> ZW003)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.cancel_staff_invite(%L)', v_id)) = 'ZW003'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.resend_staff_invite(%L)', v_id)) = 'ZW003');

  -- a NEW invitation for the same email is allowed after cancel (only pending is unique)
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.create_staff_invite('10000000-0000-0000-0000-0000000000a1', 'r4c-third@example.test', 'dispatcher');
  reset role;
  v_id := v_res.invite_id; v_old := v_res.token;
  insert into t_tok values ('third', v_old, v_id);

  -- expiry
  update public.staff_invites set expires_at = now() - interval '1 minute' where id = v_id;
  perform pg_temp.report('EXPIRE-1 (EXPIRED token cannot be accepted: ZW003, no Membership; preview says expired)',
    pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000003', format('select public.accept_staff_invite(%L)', v_old)) = 'ZW003'
    and not exists (select 1 from public.memberships where user_id = '95000000-0000-0000-0000-000000000003')
    and (select status from public.get_staff_invite_preview(v_old)) = 'expired');
  perform pg_temp.report('EXPIRE-2 (the Admin list shows it as expired, not pending)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select status from public.list_staff_invites(''10000000-0000-0000-0000-0000000000a1'') where id = %L', v_id)) = 'expired');

  -- resend re-issues: new token valid, OLD token dead
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_new := public.resend_staff_invite(v_id);
  reset role;
  perform pg_temp.report('RESEND-1 (resend of an expired-pending invitation issues a fresh token + fresh expiry; reissued=true)',
    v_new.reissued and v_new.token <> v_old and v_new.expires_at > now() + interval '6 days' and v_new.token ~ '^[0-9a-f]{64}$');
  perform pg_temp.report('RESEND-2 (the OLD token is dead: ZW002 -- never two valid tokens per invitation)',
    pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000003', format('select public.accept_staff_invite(%L)', v_old)) = 'ZW002');
  perform pg_temp.report('RESEND-3 (Dispatcher / foreign admin cannot resend: ZW002; audit staff_invitation_resent)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.resend_staff_invite(%L)', v_id)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select public.resend_staff_invite(%L)', v_id)) = 'ZW002'
    and exists (select 1 from public.audit_events where entity_id = v_id and action = 'staff_invitation_resent'));
  update t_tok set token = v_new.token where k = 'third';
  v_code := pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000003', format('select public.accept_staff_invite(%L)', v_new.token));
  perform pg_temp.report('RESEND-4 (the NEW token works for the invited identity)',
    v_code = 'OK'
    and exists (select 1 from public.memberships where user_id = '95000000-0000-0000-0000-000000000003' and organization_id = '10000000-0000-0000-0000-0000000000a1' and role = 'dispatcher'), v_code);
end $$;

-- inactive staff member re-invited: accepting REACTIVATES with the invited role; Driver Membership is never converted
do $$
declare v_token text; v_id uuid; v_acc public.staff_invite_acceptance_result;
begin
  -- the INV-23 invitation for the inactive dispatcher (a5): fetch its token by re-issuing
  v_id := (select id from public.staff_invites where email = 'org-a-inactive@example.test' and status = 'pending');
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select token into v_token from public.resend_staff_invite(v_id);
  reset role;
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a5';
  v_acc := public.accept_staff_invite(v_token);
  reset role;
  perform pg_temp.report('REACT-1 (inactive dispatcher accepts an admin invitation: same Membership reactivated with the invited role, not duplicated)',
    v_acc.membership_reactivated and not v_acc.membership_created
    and (select role || status from public.memberships where organization_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '20000000-0000-0000-0000-0000000000a5') = 'organization_adminactive'
    and (select count(*) from public.memberships where organization_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '20000000-0000-0000-0000-0000000000a5') = 1);
  -- restore seed state
  update public.memberships set role = 'dispatcher', status = 'inactive' where organization_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '20000000-0000-0000-0000-0000000000a5';
end $$;

do $$
declare v_token text := repeat('c', 64);
begin
  -- a driver identity (Org A driver a3) with a staff invitation forged at owner level: accept must refuse conversion
  insert into public.staff_invites (organization_id, email, role, token_hash, expires_at, invited_by)
  values ('10000000-0000-0000-0000-0000000000a1', 'org-a-driver-a@example.test', 'organization_admin', public._staff_invite_token_hash(v_token), now() + interval '1 day', '20000000-0000-0000-0000-0000000000a1');
  perform pg_temp.report('DRVSAFE-1 (a Driver Membership is never converted to staff by an invitation: ZW006, role unchanged)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', format('select public.accept_staff_invite(%L)', v_token)) = 'ZW006'
    and (select role from public.memberships where organization_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '20000000-0000-0000-0000-0000000000a3') = 'driver');
  delete from public.staff_invites where token_hash = public._staff_invite_token_hash(v_token);
end $$;

-- =============================================================================
-- C. TEAM LIST
-- =============================================================================
do $$
declare v_n int; v_roles text; v_org_b_seen int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  select count(*), string_agg(distinct role, ',' order by role) into v_n, v_roles from public.list_team_members('10000000-0000-0000-0000-0000000000a1');
  select count(*) into v_org_b_seen from public.list_team_members('10000000-0000-0000-0000-0000000000a1') where email like 'org-b-%';
  reset role;
  perform pg_temp.report('LIST-1 (team list: STAFF roles only -- no drivers -- and no Org B people)', v_roles = 'dispatcher,organization_admin' or v_roles = 'organization_admin,dispatcher', v_roles);
  perform pg_temp.report('LIST-2 (Org B people never appear in Org A team list)', v_org_b_seen = 0);
  perform pg_temp.report('LIST-3 (exactly one row is flagged is_self: the caller)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select count(*)::text || ':' || max(email) from public.list_team_members('10000000-0000-0000-0000-0000000000a1') where is_self$q$) = '1:org-a-admin@example.test');
  perform pg_temp.report('LIST-4 (Org B admin / Dispatcher / Driver / no-membership / anon cannot list Org A team or invitations)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', $q$select * from public.list_team_members('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', $q$select * from public.list_team_members('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', $q$select * from public.list_team_members('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', $q$select * from public.list_team_members('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002'
    and pg_temp.try_as('anon', null, $q$select * from public.list_team_members('10000000-0000-0000-0000-0000000000a1')$q$) = '42501'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', $q$select * from public.list_staff_invites('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', $q$select * from public.list_staff_invites('10000000-0000-0000-0000-0000000000a1')$q$) = 'ZW002');
  perform pg_temp.report('LIST-5 (no token material or hash ever returned by the invitation list)',
    not exists (select 1 from pg_proc p where p.proname = 'list_staff_invites' and pg_get_function_result(p.oid) ~* 'token'));
end $$;

-- =============================================================================
-- D. ROLE CHANGE / STATUS
-- =============================================================================
do $$
declare
  v_a2 uuid := (select id from public.memberships where organization_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '20000000-0000-0000-0000-0000000000a2');
  v_a3 uuid := (select id from public.memberships where organization_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '20000000-0000-0000-0000-0000000000a3');
  v_b1m uuid := (select id from public.memberships where organization_id = '10000000-0000-0000-0000-0000000000b1' and user_id = '20000000-0000-0000-0000-0000000000b2');
  v_res public.membership_change_result; v_audit public.audit_events%rowtype; v_c1 text; v_c2 text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.change_membership_role(v_a2, 'organization_admin');
  reset role;
  perform pg_temp.report('ROLE-1 (admin promotes a Dispatcher to Organization Admin)', v_res.changed and v_res.role = 'organization_admin'
    and (select role from public.memberships where id = v_a2) = 'organization_admin');
  select * into v_audit from public.audit_events where entity_id = v_a2 and action = 'membership_role_changed' order by occurred_at desc limit 1;
  perform pg_temp.report('ROLE-2 (membership_role_changed AuditEvent: actor, before/after role, target email)',
    v_audit.actor_user_id = '20000000-0000-0000-0000-0000000000a1' and v_audit.before_data ->> 'role' = 'dispatcher'
    and v_audit.after_data ->> 'role' = 'organization_admin' and v_audit.after_data ->> 'email' = 'org-a-dispatcher@example.test');
  perform pg_temp.report('ROLE-3 (promoted user now passes admin authorization; demote back works)',
    (select public.has_org_role('10000000-0000-0000-0000-0000000000a1', array['organization_admin'])) is not null
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a2', $q$select public.has_org_role('10000000-0000-0000-0000-0000000000a1', array['organization_admin'])::text$q$) = 'true'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.change_membership_role(%L, %L)', v_a2, 'dispatcher')) = 'OK'
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a2', $q$select public.has_org_role('10000000-0000-0000-0000-0000000000a1', array['organization_admin'])::text$q$) = 'false');
  perform pg_temp.report('ROLE-4 (same role = no-op, changed=false)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select (public.change_membership_role(%L, %L)).changed::text', v_a2, 'dispatcher')) = 'false');
  perform pg_temp.report('ROLE-5 (only staff roles: driver / platform_admin / null role -> ZW006; a Driver Membership target -> ZW006)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.change_membership_role(%L, %L)', v_a2, 'driver')) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.change_membership_role(%L, %L)', v_a2, 'platform_admin')) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.change_membership_role(%L, null)', v_a2)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.change_membership_role(%L, %L)', v_a3, 'dispatcher')) = 'ZW006');
  perform pg_temp.report('ROLE-6 (Dispatcher / Driver / no-membership / anon cannot change a role; Org A admin cannot change an Org B Membership; nonexistent id: all ZW002)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.change_membership_role(%L, %L)', v_a2, 'organization_admin')) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', format('select public.change_membership_role(%L, %L)', v_a2, 'organization_admin')) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', format('select public.change_membership_role(%L, %L)', v_a2, 'organization_admin')) = 'ZW002'
    and pg_temp.try_as('anon', null, format('select public.change_membership_role(%L, %L)', v_a2, 'organization_admin')) = '42501'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.change_membership_role(%L, %L)', v_b1m, 'organization_admin')) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select public.change_membership_role(%L, %L)', v_a2, 'organization_admin')) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.change_membership_role('11111111-1111-1111-1111-111111111111', 'dispatcher')$q$) = 'ZW002'
    and (select role from public.memberships where id = v_a2) = 'dispatcher' and (select role from public.memberships where id = v_b1m) = 'dispatcher');

  -- status
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.set_membership_status(v_a2, false);
  reset role;
  perform pg_temp.report('STATUS-1 (admin deactivates a Dispatcher: inactive, history kept, access gone immediately)',
    v_res.changed and (select status from public.memberships where id = v_a2) = 'inactive'
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a2', $q$select public.is_org_member('10000000-0000-0000-0000-0000000000a1')::text$q$) = 'false');
  perform pg_temp.report('STATUS-2 (membership_deactivated AuditEvent)', exists (select 1 from public.audit_events where entity_id = v_a2 and action = 'membership_deactivated' and actor_user_id = '20000000-0000-0000-0000-0000000000a1'));
  perform pg_temp.report('STATUS-3 (a deactivated Dispatcher cannot administer anything: change role denied)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.change_membership_role(%L, %L)', v_a2, 'organization_admin')) = 'ZW002');
  v_c1 := pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select (public.set_membership_status(%L, true)).status', v_a2));
  v_c2 := pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select (public.set_membership_status(%L, true)).changed::text', v_a2));
  perform pg_temp.report('STATUS-4 (admin reactivates: active again, membership_reactivated audited; idempotent)',
    v_c1 = 'active' and v_c2 = 'false' and exists (select 1 from public.audit_events where entity_id = v_a2 and action = 'membership_reactivated'), v_c1 || '/' || v_c2);
  perform pg_temp.report('STATUS-5 (Dispatcher / foreign admin / Driver Membership target / null flag / anon denied)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.set_membership_status(%L, false)', v_a2)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select public.set_membership_status(%L, false)', v_a2)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_membership_status(%L, false)', v_a3)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_membership_status(%L, null)', v_a2)) = 'ZW006'
    and pg_temp.try_as('anon', null, format('select public.set_membership_status(%L, false)', v_a2)) = '42501');
end $$;

-- =============================================================================
-- E. LAST-ADMIN SAFETY (fresh organization via the product gate, two admins)
-- =============================================================================
do $$
declare
  v_org uuid; v_m1 uuid; v_m2 uuid; v_inv public.staff_invite_result; v_c text; v_active int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '95000000-0000-0000-0000-000000000004';
  v_org := (public.complete_pending_signup_manual('Owner One', 'R4C Last Admin Org')).organization_id;
  v_inv := public.create_staff_invite(v_org, 'r4c-owner-two@example.test', 'organization_admin');
  reset role;
  perform pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000005', format('select public.accept_staff_invite(%L)', v_inv.token));
  v_m1 := (select id from public.memberships where organization_id = v_org and user_id = '95000000-0000-0000-0000-000000000004');
  v_m2 := (select id from public.memberships where organization_id = v_org and user_id = '95000000-0000-0000-0000-000000000005');
  perform pg_temp.report('LAST-0 (fresh org: two active Organization Admins via product paths only)',
    (select count(*) from public.memberships where organization_id = v_org and role = 'organization_admin' and status = 'active') = 2);

  -- one admin may demote/deactivate THEMSELVES while another remains
  v_c := pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000004', format('select public.change_membership_role(%L, %L)', v_m1, 'dispatcher'));
  perform pg_temp.report('LAST-1 (self-demotion allowed while another active Admin remains)', v_c = 'OK' and (select role from public.memberships where id = v_m1) = 'dispatcher');
  -- now n5 is the ONLY admin
  perform pg_temp.report('LAST-2 (the last active Admin cannot demote themselves: ZW004)',
    pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000005', format('select public.change_membership_role(%L, %L)', v_m2, 'dispatcher')) = 'ZW004');
  perform pg_temp.report('LAST-3 (the last active Admin cannot deactivate themselves: ZW004)',
    pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000005', format('select public.set_membership_status(%L, false)', v_m2)) = 'ZW004');
  perform pg_temp.report('LAST-4 (both attempts changed nothing; one active Admin remains)',
    (select role || status from public.memberships where id = v_m2) = 'organization_adminactive'
    and (select count(*) from public.memberships where organization_id = v_org and role = 'organization_admin' and status = 'active') = 1);
  -- promote n4 back, then n5 may deactivate n4 (n5 remains) and be unable to deactivate self
  perform pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000005', format('select public.change_membership_role(%L, %L)', v_m1, 'organization_admin'));
  v_c := pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000005', format('select public.set_membership_status(%L, false)', v_m1));
  perform pg_temp.report('LAST-5 (an Admin may deactivate ANOTHER Admin while they themselves remain)', v_c = 'OK' and (select status from public.memberships where id = v_m1) = 'inactive');
  perform pg_temp.report('LAST-6 (INACTIVE admins do not count: the only active Admin still cannot demote/deactivate themselves)',
    pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000005', format('select public.change_membership_role(%L, %L)', v_m2, 'dispatcher')) = 'ZW004'
    and pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000005', format('select public.set_membership_status(%L, false)', v_m2)) = 'ZW004');
  perform pg_temp.report('LAST-7 (the deactivated Admin cannot act, so cannot demote the remaining one)',
    pg_temp.try_as('authenticated', '95000000-0000-0000-0000-000000000004', format('select public.change_membership_role(%L, %L)', v_m2, 'dispatcher')) = 'ZW002');
  select count(*) into v_active from public.memberships where organization_id = v_org and role = 'organization_admin' and status = 'active';
  perform pg_temp.report('LAST-8 (the organization still has an active Admin after every attempt)', v_active = 1, v_active::text);
end $$;

-- =============================================================================
-- F. GENERIC MEMBERSHIP / INVITE / TABLE PRIVILEGES
-- =============================================================================
do $$
declare v_stmt text; v_c text; v_ok boolean := true; v_failed text := '';
begin
  foreach v_stmt in array array[
    $q$insert into public.memberships (organization_id, user_id, role, status) values ('10000000-0000-0000-0000-0000000000a1', '95000000-0000-0000-0000-000000000003', 'organization_admin', 'active')$q$,
    $q$update public.memberships set role = 'organization_admin' where organization_id = '10000000-0000-0000-0000-0000000000a1'$q$,
    $q$update public.memberships set status = 'inactive' where organization_id = '10000000-0000-0000-0000-0000000000a1'$q$,
    $q$delete from public.memberships where organization_id = '10000000-0000-0000-0000-0000000000a1'$q$,
    $q$select * from public.staff_invites$q$,
    $q$insert into public.staff_invites (organization_id, email, role, token_hash, expires_at, invited_by) values ('10000000-0000-0000-0000-0000000000a1', 'x@example.test', 'organization_admin', 'h', now(), '20000000-0000-0000-0000-0000000000a1')$q$,
    $q$update public.staff_invites set role = 'organization_admin'$q$,
    $q$update public.staff_invites set status = 'pending', expires_at = now() + interval '99 days'$q$,
    $q$delete from public.staff_invites$q$,
    $q$select * from public.organization_service_offerings$q$,
    $q$insert into public.organization_service_offerings (organization_id, service_type) values ('10000000-0000-0000-0000-0000000000a1', 'dialysis')$q$,
    $q$delete from public.organization_service_offerings$q$
  ] loop
    v_c := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', v_stmt);   -- Org A ADMIN: strongest legitimate caller
    if v_c is distinct from '42501' then v_ok := false; v_failed := v_failed || format(' [%s -> %s]', left(v_stmt, 45), v_c); end if;
    v_c := pg_temp.try_as('anon', null, v_stmt);
    if v_c is distinct from '42501' then v_ok := false; v_failed := v_failed || format(' [anon %s -> %s]', left(v_stmt, 45), v_c); end if;
  end loop;
  perform pg_temp.report('PRIV-1 (memberships / staff_invites / organization_service_offerings: direct INSERT/UPDATE/DELETE/SELECT denied for an Org Admin and anon)', v_ok, v_failed);
  perform pg_temp.report('PRIV-2 (no policy exists for INSERT/UPDATE on memberships; staff_invites + service offerings have RLS on with zero policies and zero grants)',
    not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memberships' and cmd in ('INSERT', 'UPDATE', 'ALL'))
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('staff_invites', 'organization_service_offerings'))
    and (select bool_and(relrowsecurity) from pg_class where oid in ('public.staff_invites'::regclass, 'public.organization_service_offerings'::regclass))
    and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('staff_invites', 'organization_service_offerings') and grantee in ('anon', 'authenticated', 'PUBLIC')));
  perform pg_temp.report('PRIV-3 (memberships: authenticated keeps SELECT only)',
    has_table_privilege('authenticated', 'public.memberships', 'SELECT')
    and not has_table_privilege('authenticated', 'public.memberships', 'INSERT') and not has_table_privilege('authenticated', 'public.memberships', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.memberships', 'DELETE')
    and not exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'memberships' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')));
  perform pg_temp.report('PRIV-4 (new functions: authenticated EXECUTE, no PUBLIC; only the invite preview is anon-callable; helpers callable by nobody)',
    has_function_privilege('authenticated', 'public.create_staff_invite(uuid, text, text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.accept_staff_invite(text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.change_membership_role(uuid, text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_membership_status(uuid, boolean)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_organization_service_offerings(uuid, text[])', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.update_organization_operating_schedule(uuid, smallint[], time, time)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_staff_invite(uuid, text, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.accept_staff_invite(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.change_membership_role(uuid, text)', 'EXECUTE')
    and has_function_privilege('anon', 'public.get_staff_invite_preview(text)', 'EXECUTE')
    and not has_function_privilege('public', 'public.create_staff_invite(uuid, text, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._lock_org_admins(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._staff_invite_token_hash(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._generate_staff_invite_token()', 'EXECUTE')
    and not has_function_privilege('anon', 'public._staff_invite_token_hash(text)', 'EXECUTE'));
end $$;

-- =============================================================================
-- G. SERVICES & INTAKE
-- =============================================================================
do $$
declare v_res public.organization_service_offerings_result; v_a uuid := '10000000-0000-0000-0000-0000000000a1'; v_audit public.audit_events%rowtype; v_get text;
begin
  perform pg_temp.report('SVC-0 (an organization that never configured offerings reads as an empty list = not configured)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select cardinality(public.get_organization_service_offerings(%L))::text', v_a)) = '0');

  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.set_organization_service_offerings(v_a, array['dialysis', 'medical_appointment', 'dialysis', null]);
  reset role;
  perform pg_temp.report('SVC-1 (admin configures a subset; duplicates/nulls collapsed; first_configuration=true)',
    v_res.changed and v_res.first_configuration
    and array(select service_type from public.organization_service_offerings where organization_id = v_a order by 1) = array['dialysis', 'medical_appointment']);
  select * into v_audit from public.audit_events where organization_id = v_a and action = 'organization_services_configured';
  perform pg_temp.report('SVC-2 (first save audited organization_services_configured with before[] / after[])',
    v_audit.actor_user_id = '20000000-0000-0000-0000-0000000000a1' and v_audit.before_data -> 'service_types' = '[]'::jsonb
    and v_audit.after_data -> 'service_types' = '["dialysis", "medical_appointment"]'::jsonb);
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.set_organization_service_offerings(v_a, array['dialysis', 'medical_appointment', 'recurring_care']);
  reset role;
  perform pg_temp.report('SVC-3 (later change audited organization_service_offerings_updated, not first_configuration)',
    v_res.changed and not v_res.first_configuration
    and exists (select 1 from public.audit_events where organization_id = v_a and action = 'organization_service_offerings_updated' and after_data -> 'service_types' = '["dialysis", "medical_appointment", "recurring_care"]'::jsonb and before_data -> 'service_types' = '["dialysis", "medical_appointment"]'::jsonb));
  perform pg_temp.report('SVC-4 (identical save = no-op, no AuditEvent)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select (public.set_organization_service_offerings(%L, array[''recurring_care'',''dialysis'',''medical_appointment''])).changed::text', v_a)) = 'false'
    and (select count(*) from public.audit_events where organization_id = v_a and action like 'organization_service%') = 2);
  perform pg_temp.report('SVC-5 (get returns the sorted enabled set)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select array_to_string(public.get_organization_service_offerings(%L), '','')', v_a)) = 'dialysis,medical_appointment,recurring_care');
  perform pg_temp.report('SVC-6 (invalid: unknown type, empty array, only nulls, null array -> ZW006; configuration unchanged)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_organization_service_offerings(%L, array[''dialysis'',''teleport''])', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_organization_service_offerings(%L, array[]::text[])', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_organization_service_offerings(%L, array[null]::text[])', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_organization_service_offerings(%L, null)', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.set_organization_service_offerings(%L, array[''DIALYSIS''])', v_a)) = 'ZW006'
    and (select count(*) from public.organization_service_offerings where organization_id = v_a) = 3);
  perform pg_temp.report('SVC-7 (Dispatcher / Driver / inactive / no-membership / Platform Admin / anon cannot set or read offerings)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.set_organization_service_offerings(%L, array[''other''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', format('select public.set_organization_service_offerings(%L, array[''other''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a5', format('select public.set_organization_service_offerings(%L, array[''other''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', format('select public.set_organization_service_offerings(%L, array[''other''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000d1', format('select public.set_organization_service_offerings(%L, array[''other''])', v_a)) = 'ZW002'
    and pg_temp.try_as('anon', null, format('select public.set_organization_service_offerings(%L, array[''other''])', v_a)) = '42501'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.get_organization_service_offerings(%L)', v_a)) = 'ZW002');
  perform pg_temp.report('SVC-8 (cross-org: Org B admin cannot set/read Org A offerings; Org A admin cannot touch Org B; Org B stays unconfigured)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select public.set_organization_service_offerings(%L, array[''other''])', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select public.get_organization_service_offerings(%L)', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', $q$select public.set_organization_service_offerings('10000000-0000-0000-0000-0000000000b1', array['other'])$q$) = 'ZW002'
    and not exists (select 1 from public.organization_service_offerings where organization_id = '10000000-0000-0000-0000-0000000000b1'));
  perform pg_temp.report('SVC-9 (canonical list: the tenant-offering CHECK accepts exactly the values transportation_requests_service_type_check does)',
    (select array_agg(m[1] order by m[1]) from (select regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''', 'g') m from pg_constraint where conname = 'transportation_requests_service_type_check') x)
    = (select array_agg(m[1] order by m[1]) from (select regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''', 'g') m from pg_constraint where conrelid = 'public.organization_service_offerings'::regclass and contype = 'c') y));
end $$;

-- Public intake service enforcement. Org A: configured {dialysis, medical_appointment, recurring_care}.
-- Org B: never configured (legacy / no-config compatibility).
do $$
declare
  v_a_ext text; v_b_ext text; v_a_id uuid; v_b_id uuid; v_call text;
  v_trips bigint := (select count(*) from public.trips); v_pass bigint := (select count(*) from public.passengers); v_arr bigint := (select count(*) from public.recurring_arrangements);
  r public.request_intake_integration_result; v_c1 text;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  r := public.create_request_intake_integration('10000000-0000-0000-0000-0000000000a1', 'https://svc-a.r4c.example.test'); v_a_ext := r.external_id; v_a_id := r.integration_id;
  perform public.set_request_intake_integration_active(v_a_id, true);
  reset role;
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
  r := public.create_request_intake_integration('10000000-0000-0000-0000-0000000000b1', 'https://svc-b.r4c.example.test'); v_b_ext := r.external_id; v_b_id := r.integration_id;
  perform public.set_request_intake_integration_active(v_b_id, true);
  reset role;

  -- $1 external id, $2 key, $3 origin, $4 service type literal (or null)
  v_call := $q$select public.submit_public_transportation_request(
      p_integration_external_id => %L, p_idempotency_key => %L, p_requester_name => 'R4C Requester', p_requester_relationship => 'family',
      p_requester_phone => '555-0100', p_pickup_description => 'R4C pickup', p_destination_description => 'R4C destination',
      p_return_trip_needed => 'no', p_origin => %L, p_service_type => %s)$q$;

  v_c1 := pg_temp.try_as('service_role', null, format(v_call, v_a_ext, 'r4c-a-1', 'https://svc-a.r4c.example.test', '''dialysis'''));
  perform pg_temp.report('INTAKE-1 (configured org: an ENABLED service type is accepted)',
    v_c1 = 'OK' and (select service_type from public.transportation_requests where external_submission_ref = 'r4c-a-1') = 'dialysis', v_c1);
  perform pg_temp.report('INTAKE-2 (configured org: a DISABLED service type is rejected with the generic ZW006; nothing stored)',
    pg_temp.try_as('service_role', null, format(v_call, v_a_ext, 'r4c-a-2', 'https://svc-a.r4c.example.test', '''wheelchair_transportation''')) = 'ZW006'
    and not exists (select 1 from public.transportation_requests where external_submission_ref = 'r4c-a-2'));
  perform pg_temp.report('INTAKE-3 (a value outside the canonical list is still rejected, as before)',
    pg_temp.try_as('service_role', null, format(v_call, v_a_ext, 'r4c-a-3', 'https://svc-a.r4c.example.test', '''teleport''')) = 'ZW006');
  perform pg_temp.report('INTAKE-4 (configured org: an OMITTED service type is unaffected -- the field stays optional)',
    pg_temp.try_as('service_role', null, format(v_call, v_a_ext, 'r4c-a-4', 'https://svc-a.r4c.example.test', 'null')) = 'OK');
  perform pg_temp.report('INTAKE-5 (NO-CONFIG COMPATIBILITY: an org that never configured offerings accepts every canonical type exactly as before)',
    pg_temp.try_as('service_role', null, format(v_call, v_b_ext, 'r4c-b-1', 'https://svc-b.r4c.example.test', '''wheelchair_transportation''')) = 'OK'
    and pg_temp.try_as('service_role', null, format(v_call, v_b_ext, 'r4c-b-2', 'https://svc-b.r4c.example.test', '''rehabilitation''')) = 'OK'
    and pg_temp.try_as('service_role', null, format(v_call, v_b_ext, 'r4c-b-3', 'https://svc-b.r4c.example.test', '''other''')) = 'OK');
  perform pg_temp.report('INTAKE-6 (tenant isolation: Org A configuration does not affect Org B; requests land in their own org)',
    (select organization_id from public.transportation_requests where external_submission_ref = 'r4c-a-1') = '10000000-0000-0000-0000-0000000000a1'
    and (select organization_id from public.transportation_requests where external_submission_ref = 'r4c-b-1') = '10000000-0000-0000-0000-0000000000b1');

  -- disabling a service later does not touch history; new intake for it is rejected
  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', 'select public.set_organization_service_offerings(''10000000-0000-0000-0000-0000000000a1'', array[''medical_appointment''])');
  perform pg_temp.report('INTAKE-7 (a service disabled LATER: the historical Request is unchanged and still readable; new intake for it is rejected)',
    (select count(*) from public.transportation_requests where external_submission_ref = 'r4c-a-1' and service_type = 'dialysis') = 1
    and pg_temp.try_as('service_role', null, format(v_call, v_a_ext, 'r4c-a-5', 'https://svc-a.r4c.example.test', '''dialysis''')) = 'ZW006'
    and pg_temp.try_as('service_role', null, format(v_call, v_a_ext, 'r4c-a-6', 'https://svc-a.r4c.example.test', '''medical_appointment''')) = 'OK');
  perform pg_temp.report('INTAKE-8 (idempotent replay of a previously accepted key is unchanged)',
    pg_temp.try_as('service_role', null, format(v_call, v_a_ext, 'r4c-a-6', 'https://svc-a.r4c.example.test', '''medical_appointment''')) = 'OK'
    and (select count(*) from public.transportation_requests where external_submission_ref = 'r4c-a-6') = 1);
  perform pg_temp.report('INTAKE-9 (origin enforcement unchanged; still no Passenger / Trip / recurring arrangement)',
    pg_temp.try_as('service_role', null, format(v_call, v_a_ext, 'r4c-a-7', 'https://evil.example.test', '''medical_appointment''')) = 'ZW006'
    and (select count(*) from public.trips) = v_trips and (select count(*) from public.passengers) = v_pass and (select count(*) from public.recurring_arrangements) = v_arr);
  perform pg_temp.report('INTAKE-10 (grants unchanged: submit function is service_role-only)',
    has_function_privilege('service_role', 'public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time, text, text, text, text, text[], date, date, time, boolean, text, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time, text, text, text, text, text[], date, date, time, boolean, text, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.submit_public_transportation_request(text, text, text, text, text, text, text, text, text, date, time, text, text, text, text, text[], date, date, time, boolean, text, jsonb)', 'EXECUTE')
    and (select count(*) from pg_proc where proname = 'submit_public_transportation_request') = 1);
end $$;

-- Clean up this section's integrations/requests so later suites (which count
-- Org A/B integrations and requests) see the fixtures they expect.
delete from public.request_events where request_id in (select id from public.transportation_requests where external_submission_ref like 'r4c-%');
delete from public.transportation_requests where external_submission_ref like 'r4c-%';
delete from public.audit_events where entity_id in (select id from public.request_intake_integrations where allowed_origins[1] like 'https://svc-%.r4c.example.test');
delete from public.request_intake_integrations where allowed_origins[1] like 'https://svc-%.r4c.example.test';

-- =============================================================================
-- H. OPERATING SCHEDULE
-- =============================================================================
do $$
declare v_a uuid := '10000000-0000-0000-0000-0000000000a1'; v_o public.organizations%rowtype; v_tz text := (select timezone from public.organizations where id = '10000000-0000-0000-0000-0000000000a1');
  v_res public.organization_operating_schedule_result; v_audit public.audit_events%rowtype;
begin
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.update_organization_operating_schedule(v_a, array[1,2,3,4,5]::smallint[], '06:00', '18:30');
  reset role;
  select * into v_o from public.organizations where id = v_a;
  perform pg_temp.report('OPS-1 (admin sets Mon-Fri 06:00-18:30)', v_res.changed and v_o.operating_days = array[1,2,3,4,5]::smallint[] and v_o.operating_opens_at = '06:00' and v_o.operating_closes_at = '18:30');
  select * into v_audit from public.audit_events where organization_id = v_a and action = 'organization_operating_schedule_updated';
  perform pg_temp.report('OPS-2 (organization_operating_schedule_updated AuditEvent with before[null]/after)',
    v_audit.actor_user_id = '20000000-0000-0000-0000-0000000000a1' and v_audit.before_data -> 'days' = 'null'::jsonb and v_audit.after_data -> 'days' = '[1, 2, 3, 4, 5]'::jsonb and v_audit.after_data ->> 'opens_at' = '06:00:00');
  perform pg_temp.report('OPS-3 (identical = no-op; timezone untouched: still the Organization timezone, one source)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select (public.update_organization_operating_schedule(%L, array[1,2,3,4,5]::smallint[], ''06:00'', ''18:30'')).changed::text', v_a)) = 'false'
    and (select timezone from public.organizations where id = v_a) = v_tz
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name in ('operating_timezone', 'operations_phone', 'dispatch_phone', 'operations_email')));
  perform pg_temp.report('OPS-4 (invalid: empty / unsorted / duplicate / out-of-range days, opens >= closes, overnight, partial nulls -> ZW006; unchanged)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_operating_schedule(%L, array[]::smallint[], ''06:00'', ''18:00'')', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_operating_schedule(%L, array[5,1]::smallint[], ''06:00'', ''18:00'')', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_operating_schedule(%L, array[1,1]::smallint[], ''06:00'', ''18:00'')', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_operating_schedule(%L, array[1,8]::smallint[], ''06:00'', ''18:00'')', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_operating_schedule(%L, array[1]::smallint[], ''18:00'', ''06:00'')', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_operating_schedule(%L, array[1]::smallint[], ''22:00'', ''06:00'')', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_operating_schedule(%L, array[1]::smallint[], ''09:00'', ''09:00'')', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_operating_schedule(%L, array[1]::smallint[], null, ''18:00'')', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_operating_schedule(%L, null, ''06:00'', ''18:00'')', v_a)) = 'ZW006'
    and (select operating_days from public.organizations where id = v_a) = array[1,2,3,4,5]::smallint[]);
  perform pg_temp.report('OPS-5 (Dispatcher / Driver / inactive / no-membership / Platform Admin / anon / foreign admin denied)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select public.update_organization_operating_schedule(%L, array[7]::smallint[], ''01:00'', ''02:00'')', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a3', format('select public.update_organization_operating_schedule(%L, array[7]::smallint[], ''01:00'', ''02:00'')', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a5', format('select public.update_organization_operating_schedule(%L, array[7]::smallint[], ''01:00'', ''02:00'')', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000e1', format('select public.update_organization_operating_schedule(%L, array[7]::smallint[], ''01:00'', ''02:00'')', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000d1', format('select public.update_organization_operating_schedule(%L, array[7]::smallint[], ''01:00'', ''02:00'')', v_a)) = 'ZW002'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select public.update_organization_operating_schedule(%L, array[7]::smallint[], ''01:00'', ''02:00'')', v_a)) = 'ZW002'
    and pg_temp.try_as('anon', null, format('select public.update_organization_operating_schedule(%L, array[7]::smallint[], ''01:00'', ''02:00'')', v_a)) = '42501'
    and (select operating_days from public.organizations where id = v_a) = array[1,2,3,4,5]::smallint[]
    and (select operating_days from public.organizations where id = '10000000-0000-0000-0000-0000000000b1') is null);
  perform pg_temp.report('OPS-6 (direct writes to the schedule columns denied; DB CHECKs reject a half-set schedule and a reversed window even for the owner)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('update public.organizations set operating_days = array[1]::smallint[] where id = %L', v_a)) = '42501'
    and pg_temp.try_as('postgres', null, format('update public.organizations set operating_opens_at = null where id = %L', v_a)) = '23514'
    and pg_temp.try_as('postgres', null, format('update public.organizations set operating_opens_at = ''20:00'' where id = %L', v_a)) = '23514');
  set local role authenticated; set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  v_res := public.update_organization_operating_schedule(v_a, null, null, null);
  reset role;
  perform pg_temp.report('OPS-7 (all three null clears the schedule; audited)', v_res.changed and (select operating_days from public.organizations where id = v_a) is null
    and (select count(*) from public.audit_events where organization_id = v_a and action = 'organization_operating_schedule_updated') = 2);
  perform pg_temp.report('OPS-8 (Dispatcher and Driver CAN read the schedule -- own org row via existing member SELECT; foreign org cannot)',
    pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000a2', format('select count(*)::text from public.organizations where id = %L', v_a)) = '1'
    and pg_temp.val_as('authenticated', '20000000-0000-0000-0000-0000000000b1', format('select count(*)::text from public.organizations where id = %L', v_a)) = '0');
end $$;

-- =============================================================================
-- I. R4A DIRECT-WRITE CLEANUP: business_stage / service_area_description / status
-- =============================================================================
do $$
declare v_a uuid := '10000000-0000-0000-0000-0000000000a1'; v_audit public.audit_events%rowtype; v_c1 text;
begin
  perform pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_settings(%L, ''{"business_stage": "growing", "service_area_description": "  Metro Atlanta  "}''::jsonb)', v_a));
  perform pg_temp.report('ORG-1 (business_stage + service_area_description written through the audited function; trimmed)',
    (select business_stage || '|' || service_area_description from public.organizations where id = v_a) = 'growing|Metro Atlanta');
  select * into v_audit from public.audit_events where organization_id = v_a and action = 'organization_settings_updated' and after_data ? 'business_stage';
  perform pg_temp.report('ORG-2 (AuditEvent carries before/after for both)', v_audit.after_data ->> 'business_stage' = 'growing' and v_audit.after_data ->> 'service_area_description' = 'Metro Atlanta' and v_audit.actor_user_id = '20000000-0000-0000-0000-0000000000a1');
  perform pg_temp.report('ORG-3 (invalid stage / oversize area -> ZW006)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_settings(%L, ''{"business_stage": "giant"}''::jsonb)', v_a)) = 'ZW006'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_settings(%L, jsonb_build_object(''service_area_description'', repeat(''x'', 1001)))', v_a)) = 'ZW006');
  v_c1 := pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_settings(%L, ''{"business_stage": null, "service_area_description": null}''::jsonb)', v_a));
  perform pg_temp.report('ORG-4 (null clears both)',
    v_c1 = 'OK' and (select business_stage is null and service_area_description is null from public.organizations where id = v_a), v_c1);
  perform pg_temp.report('ORG-5 (organization STATUS is not writable through any client path: direct UPDATE denied; not a settings key)',
    pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('update public.organizations set status = ''inactive'' where id = %L', v_a)) = '42501'
    and pg_temp.try_as('authenticated', '20000000-0000-0000-0000-0000000000a1', format('select public.update_organization_settings(%L, ''{"status": "inactive"}''::jsonb)', v_a)) = 'ZW006'
    and (select status from public.organizations where id = v_a) = 'active');
  perform pg_temp.report('ORG-6 (GRANT INVENTORY: authenticated on organizations = SELECT only; no column UPDATE, no INSERT, no DELETE, no TRUNCATE; anon nothing)',
    has_table_privilege('authenticated', 'public.organizations', 'SELECT')
    and not exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'organizations' and grantee = 'authenticated' and privilege_type in ('UPDATE', 'INSERT'))
    and not has_table_privilege('authenticated', 'public.organizations', 'INSERT') and not has_table_privilege('authenticated', 'public.organizations', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.organizations', 'DELETE') and not has_table_privilege('authenticated', 'public.organizations', 'TRUNCATE')
    and not has_table_privilege('anon', 'public.organizations', 'SELECT') and not has_table_privilege('anon', 'public.organizations', 'UPDATE'));
end $$;

-- restore Org A to seed values for later suites
delete from public.organization_service_offerings where organization_id = '10000000-0000-0000-0000-0000000000a1';
update public.organizations set operating_days = null, operating_opens_at = null, operating_closes_at = null,
  name = 'Fictional Org A', business_stage = null, service_area_description = null where id = '10000000-0000-0000-0000-0000000000a1';
