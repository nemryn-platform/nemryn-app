-- Nemryn Plus -- private-pay opportunities + pipeline tests (NP-P2-S1). ROLLBACK-ONLY (one transaction, rolled back).
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/plus_opportunities_tests.sql
-- Expect every "TEST ...: PASS" and a final "SUMMARY (failures = 0 of N tests)".
-- Covers 20261014120000_plus_private_pay_opportunities.sql. FICTIONAL seed fixtures only: Org A admin a1, dispatcher a2,
-- driver a3; Org B admin b1, dispatcher b2; c1 = admin in A + driver in B; d1 = platform admin (no membership);
-- e1 = no membership. Contacts are owner-level fixtures (the contact RPCs are covered by plus_contacts_activities_tests).
-- All side effects are evaluated into variables BEFORE assertions (Postgres does not order evaluation inside an AND).

\set ON_ERROR_STOP on
\pset pager off
begin;

create temp table q_results (n serial, name text, ok boolean, detail text);

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
  insert into q_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'TEST %: PASS', p_name; else raise notice 'TEST %: FAIL (%)', p_name, p_detail; end if;
end;
$$;

create function pg_temp.mid(p_org uuid, p_uid uuid) returns uuid language sql as $$
  select id from public.memberships where organization_id = p_org and user_id = p_uid;
$$;

create function pg_temp.set_state(p_org uuid, p_state text)
returns void language plpgsql as $$
begin
  delete from public.organization_modules where organization_id = p_org;
  if p_state = 'none' then return; end if;
  insert into public.organization_modules (organization_id, module, status, restriction, trial_started_at, trial_ends_at, status_reason)
  select p_org, 'plus', s.status, s.restriction, s.ts, s.te, 'P2-S1 opportunity test'
  from (values
    ('active',  'active',   null,        null::timestamptz,           null::timestamptz),
    ('expired', 'expired',  null,        now() - interval '20 days',  now() - interval '6 days'),
    ('locked',  'disabled', 'no_access', null,                        null)
  ) as s(name, status, restriction, ts, te)
  where s.name = p_state;
end;
$$;

create function pg_temp.set_grant(p_org uuid, p_uid uuid, p_access text)
returns void language plpgsql as $$
begin
  update public.membership_module_grants set revoked_at = now(), revoked_by = '20000000-0000-0000-0000-0000000000a1'
  where membership_id = pg_temp.mid(p_org, p_uid) and revoked_at is null;
  if p_access <> 'none' then
    insert into public.membership_module_grants (organization_id, membership_id, module, access, granted_by)
    values (p_org, pg_temp.mid(p_org, p_uid), 'plus', p_access, '20000000-0000-0000-0000-0000000000a1');
  end if;
end;
$$;

-- owner-level fictional contact fixture
create function pg_temp.contact(p_org uuid, p_name text, p_creator uuid) returns uuid language sql as $$
  insert into public.plus_contacts (organization_id, display_name, email, contact_kind, created_by)
  values (p_org, p_name, lower(replace(p_name, ' ', '.')) || '@example.test', 'individual', p_creator) returning id;
$$;

-- create as a caller -> opportunity id / 'noop:<id>' / ERR
create function pg_temp.mk(p_uid uuid, p_org uuid, p_contact uuid, p_title text, p_inquiry text default 'quote',
                           p_service text default 'medical_appointment', p_source text default 'phone', p_detail text default null,
                           p_campaign text default null, p_value bigint default null, p_owner uuid default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select case when r.changed then r.opportunity_id::text else ''noop:'' || r.opportunity_id end from public.plus_create_opportunity(%L::uuid, %L::uuid, %L, %L, %L, %L, %L, %L, %L::bigint, %L::uuid) r',
    p_org, p_contact, p_title, p_inquiry, p_service, p_source, p_detail, p_campaign, p_value, p_owner)), 'NULL');
$$;
create function pg_temp.ver(p_opp uuid) returns timestamptz language sql as $$
  select updated_at from public.plus_opportunities where id = p_opp;
$$;
create function pg_temp.stg(p_opp uuid) returns text language sql as $$
  select stage from public.plus_opportunities where id = p_opp;
$$;
create function pg_temp.mv(p_uid uuid, p_org uuid, p_opp uuid, p_expected timestamptz, p_to text, p_note text default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.stage || '':'' || r.changed from public.plus_change_opportunity_stage(%L::uuid, %L::uuid, %L::timestamptz, %L, %L) r',
    p_org, p_opp, p_expected, p_to, p_note)), 'NULL');
$$;
create function pg_temp.lose(p_uid uuid, p_org uuid, p_opp uuid, p_expected timestamptz, p_reason text, p_note text default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.stage || '':'' || r.changed from public.plus_mark_opportunity_lost(%L::uuid, %L::uuid, %L::timestamptz, %L, %L) r',
    p_org, p_opp, p_expected, p_reason, p_note)), 'NULL');
$$;
create function pg_temp.reopen(p_uid uuid, p_org uuid, p_opp uuid, p_expected timestamptz, p_to text, p_reason text)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select r.stage || '':'' || r.changed from public.plus_reopen_opportunity(%L::uuid, %L::uuid, %L::timestamptz, %L, %L) r',
    p_org, p_opp, p_expected, p_to, p_reason)), 'NULL');
$$;
create function pg_temp.upd(p_uid uuid, p_org uuid, p_opp uuid, p_expected timestamptz, p_contact uuid, p_title text,
                            p_inquiry text default 'quote', p_service text default 'medical_appointment', p_source text default 'phone',
                            p_detail text default null, p_campaign text default null, p_value bigint default null,
                            p_payment text default 'none', p_owner uuid default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select ''changed='' || r.changed from public.plus_update_opportunity(%L::uuid, %L::uuid, %L::timestamptz, %L::uuid, %L, %L, %L, %L, %L, %L, %L::bigint, %L, %L::uuid) r',
    p_org, p_opp, p_expected, p_contact, p_title, p_inquiry, p_service, p_source, p_detail, p_campaign, p_value, p_payment, p_owner)), 'NULL');
$$;
create function pg_temp.lst(p_uid uuid, p_org uuid, p_view text default null, p_search text default null, p_stage text default null,
                            p_source text default null, p_owner uuid default null, p_contact uuid default null)
returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format(
    'select count(*)::text from public.plus_list_opportunities(%L::uuid, %L, %L, %L, %L, %L::uuid, %L::uuid, 200, 0)',
    p_org, p_search, p_view, p_stage, p_source, p_owner, p_contact)), 'NULL');
$$;
create function pg_temp.get(p_uid uuid, p_org uuid, p_opp uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format('select title from public.plus_get_opportunity(%L::uuid, %L::uuid)', p_org, p_opp)), 'NULL');
$$;
create function pg_temp.hist(p_uid uuid, p_org uuid, p_opp uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format('select count(*)::text from public.plus_list_opportunity_activities(%L::uuid, %L::uuid, 100, 0)', p_org, p_opp)), 'NULL');
$$;
create function pg_temp.rls(p_uid uuid, p_org uuid) returns text language sql as $$
  select coalesce(pg_temp.val_as('authenticated', p_uid, format('select count(*)::text from public.plus_opportunities where organization_id = %L', p_org)), 'NULL');
$$;
create function pg_temp.stage_rows(p_opp uuid) returns bigint language sql as $$
  select count(*) from public.plus_activities where opportunity_id = p_opp and activity_type = 'stage_changed';
$$;

do $$
declare
  c_a constant uuid := '10000000-0000-0000-0000-0000000000a1';
  c_b constant uuid := '10000000-0000-0000-0000-0000000000b1';
  c_a1 constant uuid := '20000000-0000-0000-0000-0000000000a1';
  c_a2 constant uuid := '20000000-0000-0000-0000-0000000000a2';
  c_a3 constant uuid := '20000000-0000-0000-0000-0000000000a3';
  c_b1 constant uuid := '20000000-0000-0000-0000-0000000000b1';
  c_b2 constant uuid := '20000000-0000-0000-0000-0000000000b2';
  c_c1 constant uuid := '20000000-0000-0000-0000-0000000000c1';
  c_d1 constant uuid := '20000000-0000-0000-0000-0000000000d1';
  c_e1 constant uuid := '20000000-0000-0000-0000-0000000000e1';
  v text; v2 text; o_probe uuid; ct1 uuid; ct2 uuid; ct_arch uuid; ct_b uuid; o1 uuid; o2 uuid; o3 uuid; ob uuid; v_ver timestamptz;
  v_core text; v_core2 text; v_s4_act uuid;
begin
  v_core := (select count(*) from public.transportation_requests)::text || '/' || (select count(*) from public.passengers)::text
            || '/' || (select count(*) from public.trips)::text || '/' || (select count(*) from public.recurring_arrangements)::text;
  perform pg_temp.set_state(c_a, 'active');
  perform pg_temp.set_state(c_b, 'active');
  ct1 := pg_temp.contact(c_a, 'Pat Fictional', c_a1);
  ct2 := pg_temp.contact(c_a, 'Sam Fictional', c_a1);
  ct_arch := pg_temp.contact(c_a, 'Archived Fictional', c_a1);
  update public.plus_contacts set status = 'archived' where id = ct_arch;
  ct_b := pg_temp.contact(c_b, 'Bea In B', c_b1);
  -- an S4-style contact activity that exists before any opportunity (compatibility)
  insert into public.plus_activities (organization_id, contact_id, activity_type, body, actor_user_id)
  values (c_a, ct1, 'note', 'S4 note before opportunities.', c_a1) returning id into v_s4_act;

  -- =================================================== schema / privileges / minimisation
  perform pg_temp.t('Q1 RLS on; one SELECT policy TO authenticated using plus_can_read(organization_id); authenticated SELECT only',
    (select relrowsecurity from pg_class where oid = 'public.plus_opportunities'::regclass)
    and (select count(*) from pg_policy where polrelid = 'public.plus_opportunities'::regclass) = 1
    and exists (select 1 from pg_policy where polrelid = 'public.plus_opportunities'::regclass and polcmd = 'r'
                and pg_get_expr(polqual, polrelid) ~ 'plus_can_read\(organization_id\)' and polroles = array['authenticated'::regrole]::oid[])
    and (select string_agg(grantee || ':' || privilege_type, ',') from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'plus_opportunities' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) = 'authenticated:SELECT');
  v := pg_temp.val_as('authenticated', c_a1, format($q$insert into public.plus_opportunities (organization_id, title, primary_contact_id, source, created_by) values (%L, 'X', %L, 'phone', %L) returning 'x'$q$, c_a, ct1, c_a1))
    || pg_temp.val_as('authenticated', c_a1, 'update public.plus_opportunities set stage = ''converted'' returning ''x''')
    || pg_temp.val_as('authenticated', c_a1, 'delete from public.plus_opportunities returning ''x''')
    || pg_temp.val_as('anon', null, 'select count(*)::text from public.plus_opportunities');
  perform pg_temp.t('Q2 direct INSERT / UPDATE / DELETE as an entitled Admin and anon SELECT -> 42501', v = 'ERR:42501ERR:42501ERR:42501ERR:42501', v);
  perform pg_temp.t('Q3 RPCs: authenticated EXECUTE only; internals none; all SECURITY DEFINER-or-trigger with pinned search_path',
    (select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('plus_list_opportunities', 'plus_get_opportunity', 'plus_list_opportunity_activities', 'plus_create_opportunity',
                         'plus_update_opportunity', 'plus_change_opportunity_stage', 'plus_mark_opportunity_lost', 'plus_reopen_opportunity'))
    and (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('_plus_require_active_contact', '_plus_opportunity_channel_immutable'))
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('plus_list_opportunities', 'plus_get_opportunity', 'plus_list_opportunity_activities', 'plus_create_opportunity',
                         'plus_update_opportunity', 'plus_change_opportunity_stage', 'plus_mark_opportunity_lost', 'plus_reopen_opportunity',
                         '_plus_require_active_contact')
       and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 9);
  perform pg_temp.t('Q4 canonical columns only (NP-P2-S7-A added inquiry_id): no account_id / referral_account_id, no health, trip or passenger field, no JSON',
    (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'plus_opportunities')
    = 'id,organization_id,channel,title,stage,primary_contact_id,inquiry_type,service_type,source,source_detail,campaign_code,estimated_value_cents,payment_reported_status,lost_reason,lost_note,owner_user_id,converted_at,closed_at,created_by,created_at,updated_at,inquiry_id'
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plus_opportunities' and data_type in ('json', 'jsonb')));
  perform pg_temp.t('Q5 no dependency on future tables; every FK targets organizations, auth.users, plus_contacts or (NP-P2-S7-A) plus_inquiries',
    (select bool_and(confrelid::regclass::text in ('organizations', 'public.organizations', 'auth.users', 'plus_contacts', 'public.plus_contacts',
                                                   'plus_inquiries', 'public.plus_inquiries'))
       from pg_constraint where contype = 'f' and conrelid = 'public.plus_opportunities'::regclass)
    -- (plus_tasks ships in NP-P2-S2; plus_request_attributions in NP-P2-S3; plus_quotes in NP-P2-S5-S1 and references
    -- plus_opportunities, never the reverse; plus_inquiries ships in NP-P2-S7-A (inquiry_id, ZD-251); accounts remain future)
    and to_regclass('public.plus_accounts') is null);
  begin
    insert into public.plus_opportunities (organization_id, title, primary_contact_id, source, created_by) values (c_a, 'X', ct_b, 'phone', c_a1);
    perform pg_temp.t('Q6 composite FK: an Org A opportunity can never reference an Org B contact', false);
  exception when foreign_key_violation then perform pg_temp.t('Q6 composite FK: an Org A opportunity can never reference an Org B contact', true);
  end;
  begin
    insert into public.plus_opportunities (organization_id, channel, title, primary_contact_id, source, created_by) values (c_a, 'facility', 'X', ct1, 'phone', c_a1);
    perform pg_temp.t('Q7 channel restricted to private_pay (facility refused by CHECK)', false);
  exception when check_violation then perform pg_temp.t('Q7 channel restricted to private_pay (facility refused by CHECK)', true);
  end;
  begin
    insert into public.plus_opportunities (organization_id, title, primary_contact_id, source, created_by) values (c_a, 'X', null, 'phone', c_a1);
    perform pg_temp.t('Q8 a private-pay opportunity requires a contact', false);
  exception when check_violation then perform pg_temp.t('Q8 a private-pay opportunity requires a contact', true);
  end;
  perform pg_temp.t('Q9 activity subject widened additively (P2-S1, then P2-S3 adds request_id); stage_changed needs an opportunity; S4 rows intact',
    exists (select 1 from pg_constraint where conname = 'plus_activities_subject_check' and pg_get_constraintdef(oid) ~ 'num_nonnulls\(contact_id, opportunity_id(, request_id)?\) >= 1')
    and exists (select 1 from pg_constraint where conname = 'plus_activities_stage_subject_check')
    and exists (select 1 from pg_constraint where conname = 'plus_activities_opportunity_fkey'
                and pg_get_constraintdef(oid) = 'FOREIGN KEY (opportunity_id, organization_id) REFERENCES plus_opportunities(id, organization_id)')
    and (select contact_id = ct1 and opportunity_id is null and activity_type = 'note' from public.plus_activities where id = v_s4_act));
  begin
    insert into public.plus_activities (organization_id, contact_id, activity_type, from_stage, to_stage, actor_user_id) values (c_a, ct1, 'stage_changed', 'new_inquiry', 'contacted', c_a1);
    perform pg_temp.t('Q10 a stage_changed row without an opportunity is impossible', false);
  exception when check_violation then perform pg_temp.t('Q10 a stage_changed row without an opportunity is impossible', true);
  end;
  begin
    insert into public.plus_activities (organization_id, contact_id, activity_type, body, actor_user_id) values (c_a, ct1, 'quote_sent', 'x', c_a1);
    perform pg_temp.t('Q11 fake quote / task / consent / request activity types still refused', false);
  exception when check_violation then perform pg_temp.t('Q11 fake quote / task / consent / request activity types still refused', true);
  end;

  -- =================================================== create
  v := pg_temp.mk(c_a1, c_a, ct1, '  Weekly dialysis rides  ', 'quote', 'dialysis', 'referral', ' Dr. Lee''s office ', ' Spring_2026 ', 125000);
  o1 := (select id from public.plus_opportunities where title = 'Weekly dialysis rides');
  perform pg_temp.t('C1 Admin creates: private_pay, new_inquiry, trimmed, campaign lower-cased, estimate stored, created_by = caller',
    v = o1::text and (select channel = 'private_pay' and stage = 'new_inquiry' and source_detail = 'Dr. Lee''s office' and campaign_code = 'spring_2026'
      and estimated_value_cents = 125000 and payment_reported_status = 'none' and created_by = c_a1 and closed_at is null and converted_at is null
      from public.plus_opportunities where id = o1), v);
  perform pg_temp.t('C2 creation audited (plus_opportunity_created) without copying contact data',
    (select count(*) from public.audit_events where entity_id = o1 and action = 'plus_opportunity_created') = 1
    and (select after_data::text !~ 'Pat|example|dialysis' from public.audit_events where entity_id = o1 and action = 'plus_opportunity_created'));
  v := pg_temp.mk(c_a1, c_a, ct1, 'Weekly dialysis rides', 'quote', 'dialysis', 'referral');
  perform pg_temp.t('C3 duplicate submission within 30 s -> idempotent no-op (same id, one row)',
    v = 'noop:' || o1 and (select count(*) from public.plus_opportunities where primary_contact_id = ct1 and title = 'Weekly dialysis rides') = 1, v);
  v := pg_temp.mk(c_a1, c_a, ct_arch, 'For archived') || '|' || pg_temp.mk(c_a1, c_a, ct_b, 'Foreign contact') || '|'
    || pg_temp.mk(c_a1, c_a, gen_random_uuid(), 'Unknown contact') || '|' || pg_temp.mk(c_a1, c_a, null, 'No contact');
  perform pg_temp.t('C4 contact must be an ACTIVE contact of the organization: archived ZW006; foreign / unknown / NULL ZW002',
    v = 'ERR:ZW006|ERR:ZW002|ERR:ZW002|ERR:ZW002', v);
  v := pg_temp.mk(c_a1, c_a, ct2, '   ') || pg_temp.mk(c_a1, c_a, ct2, repeat('t', 201)) || pg_temp.mk(c_a1, c_a, ct2, 'X', 'consult')
    || pg_temp.mk(c_a1, c_a, ct2, 'X', 'quote', 'surgery') || pg_temp.mk(c_a1, c_a, ct2, 'X', 'quote', null, 'billboard')
    || pg_temp.mk(c_a1, c_a, ct2, 'X', 'quote', null, 'phone', repeat('d', 121)) || pg_temp.mk(c_a1, c_a, ct2, 'X', 'quote', null, 'phone', null, 'Bad Code!')
    || pg_temp.mk(c_a1, c_a, ct2, 'X', 'quote', null, 'phone', null, repeat('c', 65)) || pg_temp.mk(c_a1, c_a, ct2, 'X', 'quote', null, 'phone', null, null, -1)
    || pg_temp.mk(c_a1, c_a, ct2, 'X', 'quote', null, 'phone', null, null, 100000001);
  perform pg_temp.t('C5 validation: title, inquiry type, service type, source, detail, campaign code, estimate bounds -> ZW006 (10 cases)',
    v = repeat('ERR:ZW006', 10), v);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v := pg_temp.mk(c_a1, c_a, ct2, 'Owner read grant', 'quote', null, 'phone', null, null, null, pg_temp.mid(c_a, c_a2))
    || '|' || pg_temp.mk(c_a1, c_a, ct2, 'Owner foreign', 'quote', null, 'phone', null, null, null, pg_temp.mid(c_b, c_b1))
    || '|' || pg_temp.mk(c_a1, c_a, ct2, 'Owner driver', 'quote', null, 'phone', null, null, null, pg_temp.mid(c_a, c_a3));
  perform pg_temp.t('C6 owner must be an eligible Plus writer of the organization (read grant / foreign / driver -> ZW006)', v = 'ERR:ZW006|ERR:ZW006|ERR:ZW006', v);
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.mk(c_a1, c_a, ct2, 'Wheelchair to rehab', 'availability', 'wheelchair_transportation', 'website', null, null, null, pg_temp.mid(c_a, c_a2));
  o2 := (select id from public.plus_opportunities where title = 'Wheelchair to rehab');
  perform pg_temp.t('C7 owner = write-grant Dispatcher -> ok', v = o2::text and (select owner_user_id = c_a2 from public.plus_opportunities where id = o2), v);

  -- =================================================== stage machine
  v_ver := pg_temp.ver(o1);
  v := pg_temp.mv(c_a1, c_a, o1, v_ver, 'quote_accepted', 'Customer said yes on the phone.');
  perform pg_temp.t('T1 forward skip new_inquiry -> quote_accepted; one stage_changed row (from, to, actor, note), opportunity subject only',
    v = 'quote_accepted:true' and pg_temp.stage_rows(o1) = 1
    and exists (select 1 from public.plus_activities where opportunity_id = o1 and activity_type = 'stage_changed' and from_stage = 'new_inquiry'
                and to_stage = 'quote_accepted' and actor_user_id = c_a1 and body = 'Customer said yes on the phone.' and contact_id is null), v);
  v := pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1), 'contacted');
  perform pg_temp.t('T2 backward quote_accepted -> contacted allowed', v = 'contacted:true' and pg_temp.stage_rows(o1) = 2, v);
  v := pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1) - interval '1 hour', 'contacted');
  perform pg_temp.t('T3 already in the target stage (duplicate) -> changed=false, no second history row', v = 'contacted:false' and pg_temp.stage_rows(o1) = 2, v);
  v := pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1), 'converted') || '|' || pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1), 'lost')
    || '|' || pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1), 'won') || '|' || pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1), null);
  perform pg_temp.t('T4 converted cannot be set manually; lost only via its own RPC; unknown / NULL stage -> ZW006',
    v = 'ERR:ZW006|ERR:ZW006|ERR:ZW006|ERR:ZW006' and pg_temp.stg(o1) = 'contacted', v);
  v := pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1) - interval '1 second', 'qualified');
  perform pg_temp.t('T5 stale version -> ZW003, nothing written', v = 'ERR:ZW003' and pg_temp.stg(o1) = 'contacted' and pg_temp.stage_rows(o1) = 2, v);
  perform pg_temp.t('T6 stage note > 500 -> ZW006', pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1), 'qualified', repeat('n', 501)) = 'ERR:ZW006');
  -- NP-P2-S4: ONLY the conversion RPC may set converted (it creates the Core Request in the same transaction, and the
  -- deferred plus_opportunities_conversion_guard refuses 'converted' without a conversion attribution).
  perform pg_temp.t('T7 no function except plus_convert_opportunity_to_request can set converted',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                and p.proname ~ '^(plus_|_plus_)' and p.proname <> 'plus_convert_opportunity_to_request'
                and p.prosrc ~* '(set|,)\s*stage\s*=\s*''converted''|converted_at\s*=\s*now|values\s*\([^)]*''converted''')
    and exists (select 1 from pg_trigger where tgname = 'plus_opportunities_conversion_guard' and tgdeferrable and tginitdeferred));
  v := pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1), 'quote_sent');
  perform pg_temp.t('T8 quote_sent is a staff-reported stage only: a manual move creates no quote record (NP-P2-S5-S1), payment status untouched',
    v = 'quote_sent:true' and not exists (select 1 from public.plus_quotes where opportunity_id = o1)
    and (select payment_reported_status = 'none' and stage = 'quote_sent' from public.plus_opportunities where id = o1), v);

  -- =================================================== lost / reopen
  v := pg_temp.lose(c_a1, c_a, o1, pg_temp.ver(o1), null) || '|' || pg_temp.lose(c_a1, c_a, o1, pg_temp.ver(o1), 'hated_us')
    || '|' || pg_temp.lose(c_a1, c_a, o1, pg_temp.ver(o1), 'other') || '|' || pg_temp.lose(c_a1, c_a, o1, pg_temp.ver(o1), 'price', repeat('n', 501));
  perform pg_temp.t('L1 lost needs a valid reason; other needs a note; note <= 500 -> ZW006', v = 'ERR:ZW006|ERR:ZW006|ERR:ZW006|ERR:ZW006' and pg_temp.stg(o1) = 'quote_sent', v);
  perform pg_temp.t('L2 lost with a stale version -> ZW003', pg_temp.lose(c_a1, c_a, o1, pg_temp.ver(o1) - interval '1 second', 'price') = 'ERR:ZW003');
  v := pg_temp.lose(c_a1, c_a, o1, pg_temp.ver(o1), 'other', '  Moved out of the area.  ');
  perform pg_temp.t('L3 lost (other + note): stage lost, reason / note / closed_at stored, stage_changed quote_sent -> lost with the note',
    v = 'lost:true' and (select lost_reason = 'other' and lost_note = 'Moved out of the area.' and closed_at is not null from public.plus_opportunities where id = o1)
    and exists (select 1 from public.plus_activities where opportunity_id = o1 and from_stage = 'quote_sent' and to_stage = 'lost' and body = 'Moved out of the area.'), v);
  v := pg_temp.lose(c_a1, c_a, o1, pg_temp.ver(o1) - interval '1 hour', 'price');
  perform pg_temp.t('L4 duplicate mark-lost -> changed=false, reason unchanged, no second row',
    v = 'lost:false' and (select lost_reason from public.plus_opportunities where id = o1) = 'other' and pg_temp.stage_rows(o1) = 4, v);
  v := pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1), 'qualified') || '|' || pg_temp.upd(c_a1, c_a, o1, pg_temp.ver(o1), ct1, 'Edited while lost');
  perform pg_temp.t('L5 lost is terminal for stage changes and edits -> ZW004', v = 'ERR:ZW004|ERR:ZW004', v);
  v := pg_temp.reopen(c_a1, c_a, o1, pg_temp.ver(o1), 'contacted', null) || '|' || pg_temp.reopen(c_a1, c_a, o1, pg_temp.ver(o1), 'contacted', 'no')
    || '|' || pg_temp.reopen(c_a1, c_a, o1, pg_temp.ver(o1), 'converted', 'They called back.') || '|' || pg_temp.reopen(c_a1, c_a, o1, pg_temp.ver(o1), 'lost', 'They called back.');
  perform pg_temp.t('L6 reopen needs a reason (3-500) and an open target stage (not converted / lost) -> ZW006', v = 'ERR:ZW006|ERR:ZW006|ERR:ZW006|ERR:ZW006', v);
  perform pg_temp.t('L7 reopen with a stale version -> ZW003', pg_temp.reopen(c_a1, c_a, o1, pg_temp.ver(o1) - interval '1 second', 'contacted', 'They called back.') = 'ERR:ZW003');
  v_ver := pg_temp.ver(o1);
  v := pg_temp.reopen(c_a1, c_a, o1, v_ver, 'contacted', '  They called back.  ');
  perform pg_temp.t('L8 reopen: open stage, lost fields + closed_at cleared, stage_changed lost -> contacted with the reason',
    v = 'contacted:true' and (select lost_reason is null and lost_note is null and closed_at is null from public.plus_opportunities where id = o1)
    and exists (select 1 from public.plus_activities where opportunity_id = o1 and from_stage = 'lost' and to_stage = 'contacted' and body = 'They called back.'), v);
  -- (in ONE transaction updated_at keeps the same now(), so the duplicate is refused as not-lost (ZW004); across real
  --  transactions it is ZW003 -- see plus_opportunities_concurrency_test.sh. Either way it is never applied twice.)
  perform pg_temp.t('L9 duplicate reopen is refused (ZW003 / ZW004), never applied twice', pg_temp.reopen(c_a1, c_a, o1, v_ver, 'contacted', 'They called back.') in ('ERR:ZW003', 'ERR:ZW004')
    and pg_temp.stage_rows(o1) = 5);
  -- NP-P2-S1-R1A: the owner-approved canonical lost-reason vocabulary, exactly (each accepted by the CHECK; retired values refused)
  perform pg_temp.t('L11 lost_reason CHECK is exactly the canonical vocabulary',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'plus_opportunities_lost_reason_check')
      ~ 'no_response.*price.*chose_competitor.*outside_service_area.*service_not_offered.*no_availability.*not_a_fit.*duplicate.*other'
    and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'plus_opportunities_lost_reason_check') !~ 'chose_another_provider|no_longer_needed');
  o_probe := pg_temp.mk(c_a1, c_a, ct1, 'Reason probe')::uuid;
  v := '';
  for v2 in select unnest(array['no_response', 'price', 'chose_competitor', 'outside_service_area', 'service_not_offered', 'no_availability', 'not_a_fit', 'duplicate']) loop
    v := v || pg_temp.lose(c_a1, c_a, o_probe, pg_temp.ver(o_probe), v2) || ',';
    perform pg_temp.reopen(c_a1, c_a, o_probe, pg_temp.ver(o_probe), 'contacted', 'Probe reopen.');
  end loop;
  v := v || pg_temp.lose(c_a1, c_a, o_probe, pg_temp.ver(o_probe), 'other', 'Probe note.') || ',' || pg_temp.reopen(c_a1, c_a, o_probe, pg_temp.ver(o_probe), 'contacted', 'Probe reopen.');
  v := v || ',' || pg_temp.lose(c_a1, c_a, o_probe, pg_temp.ver(o_probe), 'chose_another_provider') || ',' || pg_temp.lose(c_a1, c_a, o_probe, pg_temp.ver(o_probe), 'no_longer_needed');
  perform pg_temp.t('L12 every canonical reason is accepted by mark-lost; the retired P2-S1 draft values are refused (ZW006)',
    v = repeat('lost:true,', 9) || 'contacted:true,ERR:ZW006,ERR:ZW006', v);
  -- remove the probe so the list / filter counts below are unaffected (all inside the rolled-back transaction)
  delete from public.plus_activities where opportunity_id = o_probe;
  delete from public.audit_events where entity_id = o_probe;
  delete from public.plus_opportunities where id = o_probe;
  perform pg_temp.t('L10 reopening an OPEN opportunity -> ZW004', pg_temp.reopen(c_a1, c_a, o1, pg_temp.ver(o1), 'qualified', 'Not lost.') = 'ERR:ZW004');

  -- =================================================== update
  perform pg_temp.t('U1 stale update -> ZW003', pg_temp.upd(c_a1, c_a, o1, pg_temp.ver(o1) - interval '1 second', ct1, 'X', 'quote', 'dialysis', 'referral') = 'ERR:ZW003');
  v := pg_temp.upd(c_a1, c_a, o1, pg_temp.ver(o1), ct1, 'Weekly dialysis rides', 'quote', 'dialysis', 'referral', 'Dr. Lee''s office', 'spring_2026', 125000);
  perform pg_temp.t('U2 identical values -> changed=false, no audit', v = 'changed=false'
    and (select count(*) from public.audit_events where entity_id = o1 and action = 'plus_opportunity_updated') = 0, v);
  v := pg_temp.upd(c_a1, c_a, o1, pg_temp.ver(o1), ct2, 'Weekly dialysis rides (Sam)', 'booking', 'dialysis', 'referral', 'Dr. Lee''s office', 'spring_2026', 150000, 'deposit_reported', pg_temp.mid(c_a, c_a2));
  perform pg_temp.t('U3 real update applied (contact, title, inquiry, estimate, staff-reported payment, owner)', v = 'changed=true'
    and (select primary_contact_id = ct2 and inquiry_type = 'booking' and estimated_value_cents = 150000 and payment_reported_status = 'deposit_reported'
         and owner_user_id = c_a2 from public.plus_opportunities where id = o1), v);
  perform pg_temp.t('U4 audit = changed field NAMES only; owner change -> owner_changed row on the opportunity (not the contact)',
    (select after_data -> 'fields' from public.audit_events where entity_id = o1 and action = 'plus_opportunity_updated')
      = '["contact", "title", "inquiry_type", "estimated_value", "payment_reported_status", "owner"]'::jsonb
    and exists (select 1 from public.plus_activities where opportunity_id = o1 and activity_type = 'owner_changed' and contact_id is null));
  v := pg_temp.upd(c_a1, c_a, o1, pg_temp.ver(o1), ct_arch, 'X') || '|' || pg_temp.upd(c_a1, c_a, o1, pg_temp.ver(o1), ct_b, 'X')
    || '|' || pg_temp.upd(c_a1, c_a, o1, pg_temp.ver(o1), ct2, 'X', 'quote', null, 'phone', null, null, null, 'paid_in_full');
  perform pg_temp.t('U5 cannot switch to an archived (ZW006) or foreign (ZW002) contact; payment status closed set (ZW006)', v = 'ERR:ZW006|ERR:ZW002|ERR:ZW006', v);
  begin
    update public.plus_opportunities set channel = 'facility' where id = o1;
    perform pg_temp.t('U6 channel is immutable even for the owner role', false);
  exception when others then perform pg_temp.t('U6 channel is immutable even for the owner role', sqlstate in ('ZW004', '23514'), sqlstate);
  end;

  -- =================================================== history / S4 compatibility / contact archival
  -- (inside one transaction every row shares now(), so ORDER is asserted in the browser E2E; here the content)
  perform pg_temp.t('H1 history lists every stage change with from / to stage, the owner change, and the actor name',
    pg_temp.val_as('authenticated', c_a1, format('select string_agg(activity_type || '':'' || coalesce(from_stage, ''-'') || ''>'' || coalesce(to_stage, ''-''), '','' order by activity_type, from_stage, to_stage) from public.plus_list_opportunity_activities(%L, %L, 100, 0)', c_a, o1))
      = 'owner_changed:->-,stage_changed:contacted>quote_sent,stage_changed:lost>contacted,stage_changed:new_inquiry>quote_accepted,stage_changed:quote_accepted>contacted,stage_changed:quote_sent>lost'
    and pg_temp.val_as('authenticated', c_a1, format('select count(distinct actor_name)::text from public.plus_list_opportunity_activities(%L, %L, 100, 0)', c_a, o1)) = '1');
  perform pg_temp.t('H2 S4 contact timeline unchanged: no stage / opportunity rows appear in plus_list_contact_activities',
    pg_temp.val_as('authenticated', c_a1, format('select string_agg(activity_type, '','') from public.plus_list_contact_activities(%L, %L, 100, 0)', c_a, ct1)) = 'note');
  perform pg_temp.t('H3 S4 contact logging RPC still works', pg_temp.val_as('authenticated', c_a1,
    format('select (public.plus_log_contact_activity(%L, %L, ''call_logged'', ''Follow-up call.'', null)).changed::text', c_a, ct1)) = 'true');
  perform pg_temp.t('H4 immutability: no function updates or deletes plus_activities',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                and p.prosrc ~* '(update\s+(public\.)?plus_activities|delete\s+from\s+(public\.)?plus_activities)'));
  v := pg_temp.val_as('authenticated', c_a1, format('select (public.plus_archive_contact(%L, %L, (select updated_at from public.plus_contacts where id = %L), null)).changed::text', c_a, ct2, ct2));
  v2 := pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1), 'qualified');
  perform pg_temp.t('H5 archiving the contact keeps its opportunity readable and workable; list flags the contact archived; no new one for it',
    v = 'true' and v2 = 'qualified:true' and pg_temp.get(c_a1, c_a, o1) = 'Weekly dialysis rides (Sam)'
    and pg_temp.val_as('authenticated', c_a1, format('select contact_status from public.plus_list_opportunities(%L, null, ''open'', null, null, null, %L, 10, 0)', c_a, ct2)) = 'archived'
    and pg_temp.mk(c_a1, c_a, ct2, 'New for archived') = 'ERR:ZW006', v || ' ' || v2);
  perform pg_temp.t('H6 ZD-211 intact: no Plus opportunity function writes member-access events',
    not exists (select 1 from pg_proc where proname ~ 'opportunit' and prosrc ~ 'member_access'));

  -- =================================================== list / filters
  o3 := pg_temp.mk(c_a1, c_a, ct1, 'Airport run to visit family', 'availability', null, 'website')::uuid;
  perform pg_temp.lose(c_a1, c_a, o3, pg_temp.ver(o3), 'no_response');
  perform pg_temp.t('F1 views: open excludes lost; lost shows it; all shows both',
    pg_temp.lst(c_a1, c_a, 'open')::int = 2 and pg_temp.lst(c_a1, c_a, 'lost') = '1' and pg_temp.lst(c_a1, c_a, 'all') = '3');
  perform pg_temp.t('F2 filters: stage, source, owner, contact, search over title and contact name',
    pg_temp.lst(c_a1, c_a, 'all', null, 'qualified') = '1' and pg_temp.lst(c_a1, c_a, 'all', null, null, 'website') = '2'
    and pg_temp.lst(c_a1, c_a, 'all', null, null, null, pg_temp.mid(c_a, c_a2)) = '2'
    and pg_temp.lst(c_a1, c_a, 'all', null, null, null, null, ct1) = '1'
    and pg_temp.lst(c_a1, c_a, 'all', 'airport') = '1' and pg_temp.lst(c_a1, c_a, 'all', 'sam fict') = '2');
  perform pg_temp.t('F3 a foreign owner handle matches nothing (no oracle); bad view / stage / source -> ZW006',
    pg_temp.lst(c_a1, c_a, 'all', null, null, null, pg_temp.mid(c_b, c_b1)) = '0'
    and pg_temp.lst(c_a1, c_a, 'won') = 'ERR:ZW006' and pg_temp.lst(c_a1, c_a, 'all', null, 'won') = 'ERR:ZW006'
    and pg_temp.lst(c_a1, c_a, 'all', null, null, 'billboard') = 'ERR:ZW006');
  perform pg_temp.t('F4 search wildcards are literal', pg_temp.lst(c_a1, c_a, 'all', '%') = '0');

  -- =================================================== permissions (S3 model)
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  v := pg_temp.mk(c_a2, c_a, ct1, 'Dispatcher opportunity');
  v2 := pg_temp.mv(c_a2, c_a, v::uuid, pg_temp.ver(v::uuid), 'contacted');
  perform pg_temp.t('P1 WRITE-grant Dispatcher: create and move', v ~ '^[0-9a-f-]{36}$' and v2 = 'contacted:true', v || ' ' || v2);
  perform pg_temp.set_grant(c_a, c_a2, 'read');
  v := pg_temp.lst(c_a2, c_a, 'all') || '|' || pg_temp.get(c_a2, c_a, o1) || '|' || pg_temp.hist(c_a2, c_a, o1) || '|' || pg_temp.rls(c_a2, c_a);
  perform pg_temp.t('P2 READ-grant Dispatcher: list / detail / history / RLS read', v ~ '^[0-9]+\|Weekly dialysis rides \(Sam\)\|[0-9]+\|[0-9]+$' and v !~ '\|0$', v);
  v := pg_temp.mk(c_a2, c_a, ct1, 'Read try') || pg_temp.mv(c_a2, c_a, o1, pg_temp.ver(o1), 'quote_sent') || pg_temp.lose(c_a2, c_a, o1, pg_temp.ver(o1), 'price')
    || pg_temp.reopen(c_a2, c_a, o3, pg_temp.ver(o3), 'contacted', 'Reopen try') || pg_temp.upd(c_a2, c_a, o1, pg_temp.ver(o1), ct1, 'X');
  perform pg_temp.t('P3 READ-grant Dispatcher: every write -> ZW001', v = repeat('ERR:ZW001', 5), v);
  perform pg_temp.set_grant(c_a, c_a2, 'none');
  v := pg_temp.lst(c_a2, c_a) || pg_temp.get(c_a2, c_a, o1) || pg_temp.hist(c_a2, c_a, o1) || pg_temp.rls(c_a2, c_a) || pg_temp.mk(c_a2, c_a, ct1, 'No grant');
  perform pg_temp.t('P4 no grant / revoked Dispatcher: ZW002 everywhere, RLS 0', v = 'ERR:ZW002ERR:ZW002ERR:ZW002' || '0' || 'ERR:ZW002', v);
  perform pg_temp.set_grant(c_a, c_a2, 'write');
  update public.memberships set status = 'inactive' where id = pg_temp.mid(c_a, c_a2);
  perform pg_temp.t('P5 inactive Dispatcher (grant unrevoked): ZW002, RLS 0', pg_temp.lst(c_a2, c_a) = 'ERR:ZW002' and pg_temp.rls(c_a2, c_a) = '0');
  update public.memberships set status = 'active' where id = pg_temp.mid(c_a, c_a2);
  v := pg_temp.lst(c_a3, c_a) || pg_temp.rls(c_a3, c_a) || pg_temp.lst(c_e1, c_a) || pg_temp.lst(c_d1, c_a) || pg_temp.rls(c_d1, c_a)
    || pg_temp.get(c_d1, c_a, o1) || pg_temp.mk(c_d1, c_a, ct1, 'PA try');
  perform pg_temp.t('P6 Driver, no-membership user, Platform Admin without membership: no access', v = 'ERR:ZW0020ERR:ZW002ERR:ZW0020ERR:ZW002ERR:ZW002', v);
  perform pg_temp.t('P7 no uid -> ZW001; anon -> 42501', pg_temp.lst(null, c_a) = 'ERR:ZW001'
    and pg_temp.val_as('anon', null, format('select count(*)::text from public.plus_list_opportunities(%L, null, null, null, null, null, null, 10, 0)', c_a)) = 'ERR:42501');
  update public.organizations set status = 'inactive' where id = c_a;
  perform pg_temp.t('P8 suspended organization: Admin and write-grant Dispatcher -> ZW002, RLS 0',
    pg_temp.lst(c_a1, c_a) = 'ERR:ZW002' and pg_temp.rls(c_a1, c_a) = '0' and pg_temp.lst(c_a2, c_a) = 'ERR:ZW002');
  update public.organizations set status = 'active' where id = c_a;
  perform pg_temp.set_state(c_a, 'expired');
  v := pg_temp.lst(c_a1, c_a, 'all') || '|' || pg_temp.get(c_a1, c_a, o1) || '|' || pg_temp.hist(c_a1, c_a, o1);
  v2 := pg_temp.mk(c_a1, c_a, ct1, 'Expired') || pg_temp.mv(c_a1, c_a, o1, pg_temp.ver(o1), 'quote_sent') || pg_temp.lose(c_a1, c_a, o1, pg_temp.ver(o1), 'price')
     || pg_temp.reopen(c_a1, c_a, o3, pg_temp.ver(o3), 'contacted', 'Expired reopen') || pg_temp.upd(c_a1, c_a, o1, pg_temp.ver(o1), ct1, 'X');
  perform pg_temp.t('P9 expired Plus: Admin keeps read (list / detail / history); every write -> ZW001',
    v ~ '^[1-9][0-9]*\|Weekly dialysis rides \(Sam\)\|[1-9][0-9]*$' and v2 = repeat('ERR:ZW001', 5), v || ' / ' || v2);
  perform pg_temp.t('P10 expired Plus: the WRITE-grant Dispatcher has nothing (ZW002, RLS 0)', pg_temp.lst(c_a2, c_a) = 'ERR:ZW002' and pg_temp.rls(c_a2, c_a) = '0');
  perform pg_temp.set_state(c_a, 'locked');
  perform pg_temp.t('P11 locked Plus: Admin ZW002, RLS 0, records retained', pg_temp.lst(c_a1, c_a) = 'ERR:ZW002' and pg_temp.rls(c_a1, c_a) = '0'
    and (select count(*) from public.plus_opportunities where organization_id = c_a) > 0);
  perform pg_temp.set_state(c_a, 'none');
  perform pg_temp.t('P12 no entitlement: ZW002', pg_temp.lst(c_a1, c_a) = 'ERR:ZW002' and pg_temp.get(c_a1, c_a, o1) = 'ERR:ZW002');
  perform pg_temp.set_state(c_a, 'active');

  -- =================================================== cross-tenant
  ob := pg_temp.mk(c_b1, c_b, ct_b, 'Org B opportunity')::uuid;
  v := pg_temp.lst(c_b1, c_a) || pg_temp.get(c_b1, c_a, o1) || pg_temp.hist(c_b1, c_a, o1) || pg_temp.mk(c_b1, c_a, ct1, 'B into A')
    || pg_temp.mv(c_b1, c_a, o1, pg_temp.ver(o1), 'quote_sent') || pg_temp.lose(c_b1, c_a, o1, pg_temp.ver(o1), 'price')
    || pg_temp.reopen(c_b1, c_a, o3, pg_temp.ver(o3), 'contacted', 'Cross') || pg_temp.upd(c_b1, c_a, o1, pg_temp.ver(o1), ct1, 'X');
  perform pg_temp.t('X1 Org B Admin with Org A''s id -> ZW002 for every RPC', v = repeat('ERR:ZW002', 8), v);
  v := pg_temp.get(c_b1, c_b, o1) || pg_temp.get(c_b1, c_b, gen_random_uuid()) || pg_temp.hist(c_b1, c_b, o1)
    || pg_temp.mv(c_b1, c_b, o1, pg_temp.ver(o1), 'quote_sent') || pg_temp.lose(c_b1, c_b, o1, pg_temp.ver(o1), 'price')
    || pg_temp.reopen(c_b1, c_b, o3, pg_temp.ver(o3), 'contacted', 'Forged') || pg_temp.upd(c_b1, c_b, o1, pg_temp.ver(o1), ct_b, 'Forged')
    || pg_temp.mk(c_b1, c_b, ct1, 'Forged contact');
  perform pg_temp.t('X2 forged ids under Org B''s own id (Org A opportunity / contact) -> ZW002, identical to unknown; nothing changed',
    v = repeat('ERR:ZW002', 8) and pg_temp.stg(o1) = 'qualified' and pg_temp.stg(o3) = 'lost', v);
  perform pg_temp.t('X3 RLS: each Admin sees only their own organization''s opportunities',
    pg_temp.val_as('authenticated', c_b1, 'select string_agg(distinct organization_id::text, '','') from public.plus_opportunities') = c_b::text
    and pg_temp.rls(c_a1, c_b) = '0' and pg_temp.rls(c_b1, c_a) = '0');
  perform pg_temp.t('X4 multi-organization c1 (Admin in A, Driver in B): A yes, B never', pg_temp.lst(c_c1, c_a)::int > 0 and pg_temp.lst(c_c1, c_b) = 'ERR:ZW002');
  perform pg_temp.t('X5 Org B Dispatcher without a grant: nothing', pg_temp.lst(c_b2, c_b) = 'ERR:ZW002' and pg_temp.rls(c_b2, c_a) = '0');
  begin
    insert into public.plus_activities (organization_id, opportunity_id, activity_type, body, actor_user_id) values (c_a, ob, 'note', 'x', c_a1);
    perform pg_temp.t('X6 composite FK: an Org A activity can never reference an Org B opportunity', false);
  exception when foreign_key_violation then perform pg_temp.t('X6 composite FK: an Org A activity can never reference an Org B opportunity', true);
  end;

  -- =================================================== Core isolation
  v_core2 := (select count(*) from public.transportation_requests)::text || '/' || (select count(*) from public.passengers)::text
             || '/' || (select count(*) from public.trips)::text || '/' || (select count(*) from public.recurring_arrangements)::text;
  perform pg_temp.t('K1 no Core Request / Passenger / Trip / Recurring Care written', v_core = v_core2, v_core || ' -> ' || v_core2);
  perform pg_temp.t('K2 no Core function or Core RLS policy references Plus opportunities',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname !~ '^(plus_|_plus_|_require_plus_)'
      and p.proname not in ('platform_set_organization_module', 'platform_extend_plus_trial', 'platform_get_organization_module')
      and p.prosrc ~ 'plus_opportunities|plus_activities|plus_contacts')
    and not exists (select 1 from pg_policy where polrelid::regclass::text !~ '^(public\.)?plus_'
      and coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '') ~ 'plus_'));
  perform pg_temp.t('K3 no Plus function writes Core tables (no insert / update into Requests, Passengers, Trips, arrangements)',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname ~ '^(plus_|_plus_)'
      and p.prosrc ~* '(insert\s+into|update)\s+(public\.)?(transportation_requests|passengers|trips|recurring_arrangements|trip_assignments)'));
end;
$$;

select 'SUMMARY (failures = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' tests)' as result from q_results;
select name, detail from q_results where not ok order by n;

rollback;
