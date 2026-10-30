-- Nemryn Plus -- named-staff grant tests (NP-P1-S3). ROLLBACK-ONLY (one transaction, rolled back at the end).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_member_grants_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261013160000_memberships_id_organization_unique.sql and 20261013160100_plus_member_grants.sql:
-- membership_module_grants, _plus_member_access, grant-aware plus_can_read / plus_can_write / plus_access_state,
-- plus_list_member_access / plus_grant_member_access / plus_revoke_member_access.
-- Seed fixtures: Org A admin a1, dispatcher a2, driver a3, inactive dispatcher a5; Org B admin b1, dispatcher b2,
-- driver b3; c1 = admin in A + driver in B; d1 = platform admin (no membership); e1 = no membership.
-- Synthetic in-transaction fixture: b2 also gets an Org A dispatcher membership (multi-organization identity).
-- Inside one transaction now() is constant, so "stale" versions are simulated with other grant ids.

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table g_results (n serial, name text, ok boolean, detail text);

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

create function pg_temp.guard(p_fn text, p_uid uuid, p_org uuid)
returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin execute format('select public.%I(%L)', p_fn, p_org); exception when others then return sqlstate; end;
  return 'OK';
end;
$$;

create function pg_temp.t(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into g_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;

create function pg_temp.mid(p_org uuid, p_uid uuid) returns uuid language sql as $$
  select id from public.memberships where organization_id = p_org and user_id = p_uid;
$$;

-- grant / revoke as a caller: 'changed=<bool>,access=<a>' or 'ERR:<sqlstate>'
create function pg_temp.g(p_uid uuid, p_org uuid, p_mem uuid, p_access text, p_expected uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed || '',access='' || coalesce(r.access, ''-'') from public.plus_grant_member_access(%L::uuid, %L::uuid, %L::text, %L::uuid) r',
    p_org, p_mem, p_access, p_expected)), 'NULL');
$$;
create function pg_temp.rv(p_uid uuid, p_org uuid, p_mem uuid, p_expected uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed || '',access='' || coalesce(r.access, ''-'') from public.plus_revoke_member_access(%L::uuid, %L::uuid, %L::uuid) r',
    p_org, p_mem, p_expected)), 'NULL');
$$;
create function pg_temp.lst(p_uid uuid, p_org uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select count(*)::text from public.plus_list_member_access(%L::uuid)', p_org)), 'NULL');
$$;
-- "<read>/<write>"
create function pg_temp.rw(p_uid uuid, p_org uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format('select public.plus_can_read(%L)::text', p_org)), 'NULL')
      || '/' || coalesce(pg_temp.val_as('authenticated', p_uid, format('select public.plus_can_write(%L)::text', p_org)), 'NULL');
$$;
-- "<state>/<access>" from plus_access_state
create function pg_temp.st(p_uid uuid, p_org uuid)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.state || ''/'' || coalesce(r.access, ''NULL'') from public.plus_access_state(%L) r', p_org)), 'NULL');
$$;
create function pg_temp.active(p_mem uuid) returns uuid language sql as $$
  select id from public.membership_module_grants where membership_id = p_mem and module = 'plus' and revoked_at is null;
$$;
create function pg_temp.rows(p_mem uuid) returns bigint language sql as $$
  select count(*) from public.membership_module_grants where membership_id = p_mem;
$$;
create function pg_temp.aud(p_org uuid, p_action text) returns bigint language sql as $$
  select count(*) from public.audit_events where organization_id = p_org and action = p_action;
$$;

create function pg_temp.set_state(p_org uuid, p_state text)
returns void language plpgsql as $$
begin
  delete from public.organization_modules where organization_id = p_org;
  if p_state = 'none' then return; end if;
  insert into public.organization_modules (organization_id, module, status, restriction, trial_started_at, trial_ends_at, access_ends_at, status_reason)
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, s.ae, 'S3 grant test'
  from (values
    ('trial',         'trial',     null,        now() - interval '1 day',  now() + interval '13 days', null::timestamptz),
    ('active',        'active',    null,        null,                     null,                      null),
    ('trial_elapsed', 'trial',     null,        now() - interval '15 days', now() - interval '1 second', null),
    ('active_elapsed','active',    null,        null,                     null,                      now() - interval '1 second'),
    ('expired',       'expired',   null,        now() - interval '20 days', now() - interval '6 days', null),
    ('cancelled',     'cancelled', null,        null,                     null,                      null),
    ('disabled_ro',   'disabled',  'read_only', null,                     null,                      null),
    ('locked',        'disabled',  'no_access', null,                     null,                      null)
  ) as s(name, status, restriction, ts, te, ae)
  where s.name = p_state;
  if not found then raise exception 'unknown fixture state %', p_state; end if;
end;
$$;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  c_a3 constant uuid := '20000000-0000-0000-0000-0000000000a3';
  c_a5 constant uuid := '20000000-0000-0000-0000-0000000000a5';
  c_b1 constant uuid := '20000000-0000-0000-0000-0000000000b1';
  c_b2 constant uuid := '20000000-0000-0000-0000-0000000000b2';
  c_c1 constant uuid := '20000000-0000-0000-0000-0000000000c1';
  c_d1 constant uuid := '20000000-0000-0000-0000-0000000000d1';
  c_e1 constant uuid := '20000000-0000-0000-0000-0000000000e1';
  m_a1 uuid; m_a2 uuid; m_a3 uuid; m_a5 uuid; m_b2 uuid; m_b2a uuid;
  v text; v_g1 uuid; v_g2 uuid; v_g3 uuid; v_n bigint; v_mem_upd timestamptz; v_st text;
  v_ev record;
begin
  m_a1 := pg_temp.mid(c_a, c_a1); m_a2 := pg_temp.mid(c_a, c_a2); m_a3 := pg_temp.mid(c_a, c_a3);
  m_a5 := pg_temp.mid(c_a, c_a5); m_b2 := pg_temp.mid(c_b, c_b2);
  select updated_at into v_mem_upd from public.memberships where id = m_a2;

  -- ======================================================== schema / privileges
  perform pg_temp.t('S1 memberships has the additive unique (id, organization_id) constraint (PD-20)',
    exists (select 1 from pg_constraint where conrelid = 'public.memberships'::regclass
            and conname = 'memberships_id_organization_id_key' and contype = 'u'
            and pg_get_constraintdef(oid) = 'UNIQUE (id, organization_id)'));
  perform pg_temp.t('S2 grants reference memberships by the composite (membership_id, organization_id) FK',
    exists (select 1 from pg_constraint where conrelid = 'public.membership_module_grants'::regclass and contype = 'f'
            and pg_get_constraintdef(oid) = 'FOREIGN KEY (membership_id, organization_id) REFERENCES memberships(id, organization_id)'));
  perform pg_temp.t('S3 class A: RLS on, no policy, no anon / authenticated / service_role table privilege',
    (select relrowsecurity from pg_class where oid = 'public.membership_module_grants'::regclass)
    and not exists (select 1 from pg_policy where polrelid = 'public.membership_module_grants'::regclass)
    and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
                    and table_name = 'membership_module_grants' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')));
  perform pg_temp.t('S4 authenticated cannot SELECT / INSERT / UPDATE / DELETE grants directly (42501)',
    pg_temp.val_as('authenticated', c_a1, 'select count(*)::text from public.membership_module_grants') = 'ERR:42501'
    and pg_temp.val_as('authenticated', c_a1, format($q$insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by) values (%L, %L, 'plus', 'write', %L) returning 'x'$q$, c_a, m_a2, c_a1)) = 'ERR:42501'
    and pg_temp.val_as('authenticated', c_a1, 'update public.membership_module_grants set access = ''write'' returning ''x''') = 'ERR:42501'
    and pg_temp.val_as('authenticated', c_a1, 'delete from public.membership_module_grants returning ''x''') = 'ERR:42501');
  perform pg_temp.t('S5 RPC EXECUTE: authenticated only; _plus_member_access has no client EXECUTE',
    has_function_privilege('authenticated', 'public.plus_grant_member_access(uuid,uuid,text,uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.plus_revoke_member_access(uuid,uuid,uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.plus_list_member_access(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.plus_grant_member_access(uuid,uuid,text,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.plus_revoke_member_access(uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.plus_list_member_access(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public._plus_member_access(uuid)', 'execute')
    and not has_function_privilege('anon', 'public._plus_member_access(uuid)', 'execute')
    and not has_function_privilege('service_role', 'public._plus_member_access(uuid)', 'execute'));
  perform pg_temp.t('S6 every new / replaced Plus function is SECURITY DEFINER with a pinned search_path',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('_plus_member_access', 'plus_can_read', 'plus_can_write', 'plus_access_state',
                         'plus_list_member_access', 'plus_grant_member_access', 'plus_revoke_member_access')
       and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 7);
  perform pg_temp.t('S7 anon calling the grant RPC -> 42501',
    pg_temp.val_as('anon', null, format('select (public.plus_grant_member_access(%L, %L, ''read'', null)).changed::text', c_a, m_a2)) = 'ERR:42501');
  begin
    insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by)
    values (c_b, m_a2, 'plus', 'read', c_b1);
    perform pg_temp.t('S8 a grant row can never pair Org B with an Org A membership (composite FK)', false, 'insert succeeded');
  exception when foreign_key_violation then
    perform pg_temp.t('S8 a grant row can never pair Org B with an Org A membership (composite FK)', true);
  end;
  begin
    insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by)
    values (c_a, m_a2, 'plus', 'read', c_a1), (c_a, m_a2, 'plus', 'write', c_a1);
    perform pg_temp.t('S9 at most one ACTIVE grant per membership (partial unique index)', false, 'two active rows inserted');
  exception when unique_violation then
    perform pg_temp.t('S9 at most one ACTIVE grant per membership (partial unique index)', true);
  end;
  begin
    insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by)
    values (c_a, m_a2, 'crm', 'read', c_a1);
    perform pg_temp.t('S10 module restricted to plus, access to read / write', false, 'module crm inserted');
  exception when check_violation then
    begin
      insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by)
      values (c_a, m_a2, 'plus', 'admin', c_a1);
      perform pg_temp.t('S10 module restricted to plus, access to read / write', false, 'access admin inserted');
    exception when check_violation then
      perform pg_temp.t('S10 module restricted to plus, access to read / write', true);
    end;
  end;

  -- ======================================================== grant / change / revoke / regrant (entitlement active)
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.t('B0 before any grant: Dispatcher has no Plus (false/false, none/none)',
    pg_temp.rw(c_a2, c_a) = 'false/false' and pg_temp.st(c_a2, c_a) = 'none/none');
  perform pg_temp.t('B1 Organization Admin: write/write via plus_access_state; list shows staff only',
    pg_temp.st(c_a1, c_a) = 'write/write'
    and pg_temp.lst(c_a1, c_a) = (select count(*)::text from public.memberships where organization_id = c_a and role in ('organization_admin', 'dispatcher')));

  v := pg_temp.g(c_a1, c_a, m_a2, 'read', null);
  v_g1 := pg_temp.active(m_a2);
  perform pg_temp.t('B2 Admin grants READ to an active Dispatcher -> changed, one active row, one audit', v = 'changed=true,access=read'
    and v_g1 is not null and pg_temp.rows(m_a2) = 1 and pg_temp.aud(c_a, 'plus_member_access_granted') = 1, v);
  select * into v_ev from public.audit_events where organization_id = c_a and action = 'plus_member_access_granted';
  perform pg_temp.t('B3 audit: entity membership_module_grant, actor = Admin, before NULL, after {access read, membership, grant}',
    v_ev.entity_type = 'membership_module_grant' and v_ev.entity_id = v_g1 and v_ev.actor_user_id = c_a1
    and v_ev.before_data is null and v_ev.after_data ->> 'access' = 'read' and (v_ev.after_data ->> 'membership_id')::uuid = m_a2
    and (v_ev.after_data ->> 'grant_id')::uuid = v_g1 and v_ev.after_data ->> 'email' = 'org-a-dispatcher@example.test');
  perform pg_temp.t('B4 READ grant: Dispatcher can read, cannot write (true/false, write/read)',
    pg_temp.rw(c_a2, c_a) = 'true/false' and pg_temp.st(c_a2, c_a) = 'write/read');
  perform pg_temp.t('B5 READ grant: _require_plus_write -> ZW001 (visible, not permitted); admin guard -> ZW001',
    pg_temp.guard('_require_plus_write', c_a2, c_a) = 'ZW001' and pg_temp.guard('_require_plus_admin_write', c_a2, c_a) = 'ZW001');
  v := pg_temp.g(c_a1, c_a, m_a2, 'read', null);
  perform pg_temp.t('B7 duplicate submission (same access) -> changed=false, no write, no audit',
    v = 'changed=false,access=read' and pg_temp.rows(m_a2) = 1 and pg_temp.aud(c_a, 'plus_member_access_granted') = 1, v);
  v := pg_temp.g(c_a1, c_a, m_a2, 'read', gen_random_uuid());
  perform pg_temp.t('B8 duplicate with any expected version is still a no-op (end state already reached)', v = 'changed=false,access=read', v);
  v := pg_temp.g(c_a1, c_a, m_a2, 'write', null);
  perform pg_temp.t('B9 change READ -> WRITE with a stale expected (NULL) -> ZW003, nothing written',
    v = 'ERR:ZW003' and pg_temp.active(m_a2) = v_g1 and pg_temp.rows(m_a2) = 1 and pg_temp.aud(c_a, 'plus_member_access_granted') = 1, v);
  v := pg_temp.g(c_a1, c_a, m_a2, 'write', gen_random_uuid());
  perform pg_temp.t('B10 change with a forged / other expected grant id -> ZW003', v = 'ERR:ZW003', v);
  v := pg_temp.g(c_a1, c_a, m_a2, 'write', v_g1);
  v_g2 := pg_temp.active(m_a2);
  perform pg_temp.t('B11 change READ -> WRITE with the current version -> old row revoked by Admin, new active row (history kept)',
    v = 'changed=true,access=write' and v_g2 <> v_g1 and pg_temp.rows(m_a2) = 2
    and (select revoked_at is not null and revoked_by = c_a1 and access = 'read' from public.membership_module_grants where id = v_g1)
    and (select access = 'write' and granted_by = c_a1 from public.membership_module_grants where id = v_g2), v);
  perform pg_temp.t('B12 change audited once with before {access read, old grant} and after {access write, new grant}',
    pg_temp.aud(c_a, 'plus_member_access_granted') = 2
    and exists (select 1 from public.audit_events where organization_id = c_a and action = 'plus_member_access_granted'
                and entity_id = v_g2 and before_data ->> 'access' = 'read' and (before_data ->> 'grant_id')::uuid = v_g1
                and after_data ->> 'access' = 'write'));
  perform pg_temp.t('B13 WRITE grant: Dispatcher can read and write (true/true, write/write); _require_plus_write OK',
    pg_temp.rw(c_a2, c_a) = 'true/true' and pg_temp.st(c_a2, c_a) = 'write/write' and pg_temp.guard('_require_plus_write', c_a2, c_a) = 'OK');
  perform pg_temp.t('B14 WRITE grant does not confer Admin-only Plus settings: _require_plus_admin_write -> ZW002',
    pg_temp.guard('_require_plus_admin_write', c_a2, c_a) = 'ZW002');
  perform pg_temp.t('B15 WRITE-grant Dispatcher cannot list, grant (even to self) or revoke -> ZW002',
    pg_temp.lst(c_a2, c_a) = 'ERR:ZW002'
    and pg_temp.g(c_a2, c_a, m_a2, 'read', v_g2) = 'ERR:ZW002'
    and pg_temp.rv(c_a2, c_a, m_a2, v_g2) = 'ERR:ZW002'
    and pg_temp.active(m_a2) = v_g2);
  v := pg_temp.rv(c_a1, c_a, m_a2, v_g1);
  perform pg_temp.t('B16 revoke with a stale version (the old grant id) -> ZW003, still active', v = 'ERR:ZW003' and pg_temp.active(m_a2) = v_g2, v);
  v := pg_temp.rv(c_a1, c_a, m_a2, v_g2);
  perform pg_temp.t('B17 revoke with the current version -> revoked (row kept), audited once',
    v = 'changed=true,access=-' and pg_temp.active(m_a2) is null and pg_temp.rows(m_a2) = 2
    and (select revoked_by = c_a1 from public.membership_module_grants where id = v_g2)
    and pg_temp.aud(c_a, 'plus_member_access_revoked') = 1
    and exists (select 1 from public.audit_events where organization_id = c_a and action = 'plus_member_access_revoked'
                and entity_id = v_g2 and before_data ->> 'access' = 'write' and after_data ->> 'access' is null and actor_user_id = c_a1), v);
  perform pg_temp.t('B18 revoked Dispatcher loses Plus on the very next check (false/false, none/none)',
    pg_temp.rw(c_a2, c_a) = 'false/false' and pg_temp.st(c_a2, c_a) = 'none/none' and pg_temp.guard('_require_plus_write', c_a2, c_a) = 'ZW002');
  v := pg_temp.rv(c_a1, c_a, m_a2, v_g2);
  perform pg_temp.t('B19 duplicate revoke -> changed=false, no write, no audit', v = 'changed=false,access=-' and pg_temp.aud(c_a, 'plus_member_access_revoked') = 1, v);
  v := pg_temp.g(c_a1, c_a, m_a2, 'read', null);
  v_g3 := pg_temp.active(m_a2);
  perform pg_temp.t('B20 regrant after revocation -> new active row; all 3 history rows kept; 3 grant audits',
    v = 'changed=true,access=read' and v_g3 not in (v_g1, v_g2) and pg_temp.rows(m_a2) = 3
    and pg_temp.aud(c_a, 'plus_member_access_granted') = 3 and pg_temp.rw(c_a2, c_a) = 'true/false', v);
  perform pg_temp.t('B21 Core untouched: the Dispatcher membership row (role, status, updated_at) never changed',
    (select role = 'dispatcher' and status = 'active' and updated_at = v_mem_upd from public.memberships where id = m_a2));
  perform pg_temp.t('B22 grants never change Core role checks: has_org_role(dispatcher) true, (organization_admin) false',
    pg_temp.val_as('authenticated', c_a2, format('select public.has_org_role(%L, array[''dispatcher''])::text', c_a)) = 'true'
    and pg_temp.val_as('authenticated', c_a2, format('select public.has_org_role(%L, array[''organization_admin''])::text', c_a)) = 'false');
  perform pg_temp.t('B23 list shows the Dispatcher''s active grant and none for the Admin',
    pg_temp.val_as('authenticated', c_a1, format('select string_agg(role || '':'' || coalesce(access, ''-''), '','' order by role) from public.plus_list_member_access(%L) where membership_id in (%L, %L)', c_a, m_a1, m_a2))
      = 'dispatcher:read,organization_admin:-');

  -- ======================================================== authority / forged ids / eligibility
  perform pg_temp.t('A1 no uid -> ZW001 (grant, revoke, list)',
    pg_temp.g(null, c_a, m_a2, 'write', v_g3) = 'ERR:ZW001' and pg_temp.rv(null, c_a, m_a2, v_g3) = 'ERR:ZW001' and pg_temp.lst(null, c_a) = 'ERR:ZW001');
  perform pg_temp.t('A2 Driver / no-membership user / inactive member -> ZW002 everywhere',
    pg_temp.g(c_a3, c_a, m_a2, 'write', v_g3) = 'ERR:ZW002' and pg_temp.rv(c_a3, c_a, m_a2, v_g3) = 'ERR:ZW002' and pg_temp.lst(c_a3, c_a) = 'ERR:ZW002'
    and pg_temp.g(c_e1, c_a, m_a2, 'write', v_g3) = 'ERR:ZW002' and pg_temp.lst(c_e1, c_a) = 'ERR:ZW002'
    and pg_temp.g(c_a5, c_a, m_a2, 'write', v_g3) = 'ERR:ZW002');
  perform pg_temp.t('A3 Platform Admin without membership: no tenant Plus access, cannot list / grant / revoke',
    pg_temp.rw(c_d1, c_a) = 'false/false' and pg_temp.st(c_d1, c_a) = 'none/none'
    and pg_temp.lst(c_d1, c_a) = 'ERR:ZW002' and pg_temp.g(c_d1, c_a, m_a2, 'write', v_g3) = 'ERR:ZW002'
    and pg_temp.rv(c_d1, c_a, m_a2, v_g3) = 'ERR:ZW002');
  perform pg_temp.t('A4 cross-tenant: Org B Admin cannot list / grant / revoke for Org A',
    pg_temp.lst(c_b1, c_a) = 'ERR:ZW002' and pg_temp.g(c_b1, c_a, m_a2, 'write', v_g3) = 'ERR:ZW002' and pg_temp.rv(c_b1, c_a, m_a2, v_g3) = 'ERR:ZW002');
  perform pg_temp.set_state(c_b, 'active');
  perform pg_temp.t('A5 forged id: Org B Admin targets an Org A membership under Org B -> ZW002, nothing written',
    pg_temp.g(c_b1, c_b, m_a2, 'write', v_g3) = 'ERR:ZW002' and pg_temp.rv(c_b1, c_b, m_a2, v_g3) = 'ERR:ZW002' and pg_temp.active(m_a2) = v_g3);
  perform pg_temp.t('A6 forged id: Org A Admin targets an Org B membership under Org A -> ZW002',
    pg_temp.g(c_a1, c_a, m_b2, 'read', null) = 'ERR:ZW002' and pg_temp.rv(c_a1, c_a, m_b2, null) = 'ERR:ZW002' and pg_temp.rows(m_b2) = 0);
  perform pg_temp.t('A7 unknown / NULL membership or organization -> ZW002',
    pg_temp.g(c_a1, c_a, gen_random_uuid(), 'read', null) = 'ERR:ZW002' and pg_temp.g(c_a1, c_a, null, 'read', null) = 'ERR:ZW002'
    and pg_temp.g(c_a1, null, m_a2, 'read', null) = 'ERR:ZW002' and pg_temp.lst(c_a1, null) = 'ERR:ZW002');
  perform pg_temp.t('A8 Driver membership can never receive a grant -> ZW006',
    pg_temp.g(c_a1, c_a, m_a3, 'read', null) = 'ERR:ZW006' and pg_temp.rows(m_a3) = 0);
  perform pg_temp.t('A9 inactive Dispatcher membership cannot receive a grant -> ZW006',
    pg_temp.g(c_a1, c_a, m_a5, 'read', null) = 'ERR:ZW006' and pg_temp.rows(m_a5) = 0);
  perform pg_temp.t('A10 Organization Admin membership needs no grant -> ZW006 (also for self)',
    pg_temp.g(c_a1, c_a, m_a1, 'read', null) = 'ERR:ZW006' and pg_temp.rows(m_a1) = 0);
  perform pg_temp.t('A11 invalid access (admin, NULL, empty) -> ZW006',
    pg_temp.g(c_a1, c_a, m_a2, 'admin', v_g3) = 'ERR:ZW006' and pg_temp.g(c_a1, c_a, m_a2, null, v_g3) = 'ERR:ZW006'
    and pg_temp.g(c_a1, c_a, m_a2, '', v_g3) = 'ERR:ZW006');
  perform pg_temp.t('A12 no audit was written by any refused call (3 granted + 1 revoked so far)',
    pg_temp.aud(c_a, 'plus_member_access_granted') = 3 and pg_temp.aud(c_a, 'plus_member_access_revoked') = 1
    and pg_temp.aud(c_b, 'plus_member_access_granted') = 0);

  -- ======================================================== entitlement states (a2 holds a WRITE grant)
  v := pg_temp.g(c_a1, c_a, m_a2, 'write', v_g3);
  v_g3 := pg_temp.active(m_a2);
  perform pg_temp.set_state(c_a, 'trial');
  perform pg_temp.t('E1 trial (write): WRITE-grant Dispatcher true/true, state write/write',
    pg_temp.rw(c_a2, c_a) = 'true/true' and pg_temp.st(c_a2, c_a) = 'write/write');
  perform pg_temp.t('E1b trial: the trial end is an Admin-only notice (grant holder gets NULL, Admin gets the date)',
    pg_temp.val_as('authenticated', c_a2, format('select coalesce(trial_ends_at::text, ''NULL'') from public.plus_access_state(%L)', c_a)) = 'NULL'
    and pg_temp.val_as('authenticated', c_a1, format('select coalesce(trial_ends_at::text, ''NULL'') from public.plus_access_state(%L)', c_a)) <> 'NULL');
  foreach v_st in array array['trial_elapsed', 'active_elapsed', 'expired', 'cancelled', 'disabled_ro'] loop
    perform pg_temp.set_state(c_a, v_st);
    perform pg_temp.t(format('E2 %s (read_only): grant holder loses Plus (false/false, none/none); Admin keeps history read (true/false, read_only/read)', v_st),
      pg_temp.rw(c_a2, c_a) = 'false/false' and pg_temp.st(c_a2, c_a) = 'none/none'
      and pg_temp.rw(c_a1, c_a) = 'true/false' and pg_temp.st(c_a1, c_a) = 'read_only/read',
      pg_temp.rw(c_a2, c_a) || ' ' || pg_temp.st(c_a2, c_a) || ' ' || pg_temp.rw(c_a1, c_a) || ' ' || pg_temp.st(c_a1, c_a));
  end loop;
  perform pg_temp.set_state(c_a, 'expired');
  perform pg_temp.t('E3 read_only: Admin cannot grant (ZW001) but can list and revoke-check; grant row stays (history)',
    pg_temp.g(c_a1, c_a, m_a2, 'read', v_g3) = 'ERR:ZW001' and pg_temp.lst(c_a1, c_a) not like 'ERR%' and pg_temp.active(m_a2) = v_g3);
  perform pg_temp.set_state(c_a, 'locked');
  perform pg_temp.t('E4 locked: nobody reads tenant Plus (grant holder none/none; Admin locked/none, false/false)',
    pg_temp.rw(c_a2, c_a) = 'false/false' and pg_temp.st(c_a2, c_a) = 'none/none'
    and pg_temp.rw(c_a1, c_a) = 'false/false' and pg_temp.st(c_a1, c_a) = 'locked/none');
  perform pg_temp.t('E5 locked: Admin cannot list, grant or revoke (ZW002)',
    pg_temp.lst(c_a1, c_a) = 'ERR:ZW002' and pg_temp.g(c_a1, c_a, m_a2, 'read', v_g3) = 'ERR:ZW002' and pg_temp.rv(c_a1, c_a, m_a2, v_g3) = 'ERR:ZW002');
  perform pg_temp.set_state(c_a, 'none');
  perform pg_temp.t('E6 none: grant holder and Admin have no Plus; Admin cannot list / grant / revoke',
    pg_temp.rw(c_a2, c_a) = 'false/false' and pg_temp.st(c_a2, c_a) = 'none/none' and pg_temp.st(c_a1, c_a) = 'none/none'
    and pg_temp.lst(c_a1, c_a) = 'ERR:ZW002' and pg_temp.g(c_a1, c_a, m_a2, 'read', v_g3) = 'ERR:ZW002');
  perform pg_temp.set_state(c_a, 'cancelled');
  v := pg_temp.rv(c_a1, c_a, m_a2, v_g3);
  perform pg_temp.t('E7 cancelled (read_only): Admin can still REVOKE a stale grant (cleanup), audited', v = 'changed=true,access=-'
    and pg_temp.active(m_a2) is null and pg_temp.aud(c_a, 'plus_member_access_revoked') = 2, v);
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.t('E8 Plus re-activated: a REVOKED grant does not come back', pg_temp.rw(c_a2, c_a) = 'false/false');
  v := pg_temp.g(c_a1, c_a, m_a2, 'write', null);
  v_g3 := pg_temp.active(m_a2);
  perform pg_temp.t('E9 regrant WRITE while active', v = 'changed=true,access=write' and pg_temp.rw(c_a2, c_a) = 'true/true', v);

  -- ======================================================== membership / organization lifecycle (Core paths)
  v := pg_temp.val_as('authenticated', c_a1, format('select (public.set_membership_status(%L, false)).status', m_a2));
  perform pg_temp.t('L1 Dispatcher deactivated through Core set_membership_status -> loses Plus immediately; grant row kept (inert)',
    v = 'inactive' and pg_temp.rw(c_a2, c_a) = 'false/false' and pg_temp.st(c_a2, c_a) = 'none/none' and pg_temp.active(m_a2) = v_g3, v);
  perform pg_temp.t('L2 cannot grant to the deactivated membership (ZW006), but can still revoke its grant later',
    pg_temp.g(c_a1, c_a, m_a2, 'read', v_g3) = 'ERR:ZW006');
  v := pg_temp.val_as('authenticated', c_a1, format('select (public.set_membership_status(%L, true)).status', m_a2));
  perform pg_temp.t('L3 reactivated by the Admin -> the unrevoked grant is effective again (documented behaviour)',
    v = 'active' and pg_temp.rw(c_a2, c_a) = 'true/true', v);
  v := pg_temp.val_as('authenticated', c_a1, format('select (public.change_membership_role(%L, ''organization_admin'')).role', m_a2));
  perform pg_temp.t('L4 promoted to Organization Admin -> full Admin Plus (not via the grant); Admin-only guard passes',
    v = 'organization_admin' and pg_temp.rw(c_a2, c_a) = 'true/true' and pg_temp.guard('_require_plus_admin_write', c_a2, c_a) = 'OK', v);
  v := pg_temp.val_as('authenticated', c_a1, format('select (public.change_membership_role(%L, ''dispatcher'')).role', m_a2));
  perform pg_temp.t('L5 demoted back to Dispatcher -> only the grant applies again (Admin-only guard ZW002)',
    v = 'dispatcher' and pg_temp.rw(c_a2, c_a) = 'true/true' and pg_temp.guard('_require_plus_admin_write', c_a2, c_a) = 'ZW002', v);
  update public.memberships set role = 'driver' where id = m_a2;
  perform pg_temp.t('L6 Dispatcher changed to an ineligible role (driver) -> loses Plus at once',
    pg_temp.rw(c_a2, c_a) = 'false/false' and pg_temp.st(c_a2, c_a) = 'none/none');
  update public.memberships set role = 'dispatcher' where id = m_a2;
  update public.organizations set status = 'inactive' where id = c_a;  -- suspension (Platform lifecycle)
  perform pg_temp.t('L7 organization suspended -> grant holder AND Admin lose Plus; Admin cannot list or grant',
    pg_temp.rw(c_a2, c_a) = 'false/false' and pg_temp.rw(c_a1, c_a) = 'false/false' and pg_temp.st(c_a1, c_a) = 'none/none'
    and pg_temp.lst(c_a1, c_a) = 'ERR:ZW002' and pg_temp.g(c_a1, c_a, m_a2, 'read', v_g3) = 'ERR:ZW002');
  update public.organizations set status = 'active' where id = c_a;
  perform pg_temp.t('L8 organization reactivated -> grant effective again', pg_temp.rw(c_a2, c_a) = 'true/true');

  -- ======================================================== multi-organization identities
  insert into public.memberships (organization_id, user_id, role, status) values (c_a, c_b2, 'dispatcher', 'active')
  returning id into m_b2a;
  perform pg_temp.set_state(c_b, 'active');
  v := pg_temp.g(c_a1, c_a, m_b2a, 'read', null);
  perform pg_temp.t('M1 a person who is Dispatcher in A and B gets an Org A READ grant -> Plus in A only',
    v = 'changed=true,access=read' and pg_temp.rw(c_b2, c_a) = 'true/false' and pg_temp.rw(c_b2, c_b) = 'false/false'
    and pg_temp.st(c_b2, c_b) = 'none/none', v);
  perform pg_temp.t('M2 the Org A grant is invisible to Org B: Org B Admin lists no grant for that person in B',
    pg_temp.val_as('authenticated', c_b1, format('select count(*)::text from public.plus_list_member_access(%L) where access is not null', c_b)) = '0');
  perform pg_temp.t('M3 c1 (Admin in A, Driver in B): Admin Plus in A, none in B even with B active',
    pg_temp.rw(c_c1, c_a) = 'true/true' and pg_temp.rw(c_c1, c_b) = 'false/false' and pg_temp.st(c_c1, c_b) = 'none/none');
  v := pg_temp.g(c_b1, c_b, m_b2, 'write', null);
  perform pg_temp.t('M4 Org B Admin grants WRITE to the same person in B -> independent rows; A stays READ',
    v = 'changed=true,access=write' and pg_temp.rw(c_b2, c_b) = 'true/true' and pg_temp.rw(c_b2, c_a) = 'true/false', v);
  v := pg_temp.rv(c_b1, c_b, m_b2, pg_temp.active(m_b2));
  perform pg_temp.t('M5 revoking in B does not touch A', v = 'changed=true,access=-' and pg_temp.rw(c_b2, c_b) = 'false/false'
    and pg_temp.rw(c_b2, c_a) = 'true/false', v);
  perform pg_temp.t('M6 audit stays per organization (Org B events only in Org B)',
    pg_temp.aud(c_b, 'plus_member_access_granted') = 1 and pg_temp.aud(c_b, 'plus_member_access_revoked') = 1
    and not exists (select 1 from public.audit_events where organization_id = c_a and (after_data ->> 'membership_id')::uuid = m_b2));

  -- ======================================================== Core isolation
  perform pg_temp.t('C1 no Core function references a Plus helper, Plus table or organization_modules',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname !~ '^(plus_|_plus_|_require_plus_)'
      and p.proname not in ('platform_set_organization_module', 'platform_extend_plus_trial', 'platform_get_organization_module')
      -- NP-FIN-P1 FU-2 (narrow): billing_create_invoice_draft (NP-BILL-P1 R3 / ZD-274) may call plus_can_read ONLY,
      -- to gate the optional read-only quote import; any other Plus reference in it still fails this check.
      and not (p.proname = 'billing_create_invoice_draft'
               and regexp_replace(p.prosrc, 'plus_can_read', '', 'g') !~ 'plus_can_(read|write)|_require_plus_|_plus_member_access|membership_module_grants|organization_modules|_plus_entitlement_state')
      and p.prosrc ~ 'plus_can_(read|write)|_require_plus_|_plus_member_access|membership_module_grants|organization_modules|_plus_entitlement_state'));
  -- (Plus tables' own policies -- plus_* from NP-P1-S4 -- legitimately call plus_can_read; every OTHER policy is Core.)
  perform pg_temp.t('C2 no Core RLS policy references Plus objects (Core RLS unchanged)',
    not exists (select 1 from pg_policy where polrelid::regclass::text !~ '^(public\.)?plus_'
                and coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '')
                ~ 'plus_|membership_module_grants|organization_modules'));
  perform pg_temp.t('C3 the composite FK changes no membership behaviour: Core role change and deactivation of a grant holder worked (L1-L5)',
    (select role = 'dispatcher' and status = 'active' from public.memberships where id = m_a2));
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from g_results;
select name, detail from g_results where not ok order by n;

rollback;
