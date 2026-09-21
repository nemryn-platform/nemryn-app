-- Nemryn -- database privilege CONTRACT (P1-SEC-01). READ-ONLY: this file is a single SELECT.
--
-- It asserts the INTENDED ACL state of schema public -- not whatever the environment's
-- defaults happen to be -- so the same file gives the same answer locally and in production.
-- Local expected == production expected. Every row is (check, ok, detail); any ok = false is a
-- privilege-drift finding.
--
--   local       docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/privilege_contract_tests.sql
--               (or: supabase db query --local -f supabase/tests/privilege_contract_tests.sql)
--   production  supabase db query --linked -f supabase/tests/privilege_contract_tests.sql
--               (SELECT-only; safe to run against production before and after every release.
--                Expect every row ok = true and the last row "SUMMARY ... violations = 0".)
--
-- Adding a table or function to schema public REQUIRES adding it to the contract CTEs below
-- (checks 01 and 08 fail for an unlisted object). That is deliberate: a new object must never
-- reach production with an ACL nobody decided.
-- Keep the contract CTEs in sync with supabase/migrations/20260921110000_production_privilege_baseline_hardening.sql.

with
-- ----------------------------------------------------------------- CONTRACT
c_tables(tbl) as (values
  ('audit_events'),
  ('driver_invites'),
  ('driver_location_updates'),
  ('drivers'),
  ('facilities'),
  ('memberships'),
  ('notification_events'),
  ('organization_notification_settings'),
  ('organization_service_offerings'),
  ('organizations'),
  ('passengers'),
  ('platform_admin_grants'),
  ('public_intake_rate_limit_events'),
  ('request_acquisition_attributions'),
  ('recurring_arrangements'),
  ('recurring_occurrence_exceptions'),
  ('request_events'),
  ('request_intake_integrations'),
  ('staff_invites'),
  ('transportation_requests'),
  ('trip_assignments'),
  ('trip_events'),
  ('trip_exceptions'),
  ('trip_notes'),
  ('trips'),
  ('user_profiles'),
  ('vehicles')
),
-- authenticated: direct TABLE-level privileges (anything not listed is NOT granted)
c_auth_tbl(tbl, priv) as (values
  ('driver_invites', 'SELECT'),
  ('driver_location_updates', 'SELECT'),
  ('drivers', 'SELECT'),
  ('facilities', 'INSERT'),
  ('facilities', 'SELECT'),
  ('memberships', 'SELECT'),
  ('organizations', 'SELECT'),
  ('passengers', 'INSERT'),
  ('passengers', 'SELECT'),
  ('recurring_arrangements', 'SELECT'),
  ('recurring_occurrence_exceptions', 'SELECT'),
  ('request_events', 'SELECT'),
  ('transportation_requests', 'SELECT'),
  ('trip_assignments', 'SELECT'),
  ('trip_events', 'SELECT'),
  ('trip_exceptions', 'SELECT'),
  ('trip_notes', 'INSERT'),
  ('trip_notes', 'SELECT'),
  ('trip_notes', 'UPDATE'),
  ('trips', 'SELECT'),
  ('user_profiles', 'INSERT'),
  ('user_profiles', 'SELECT'),
  ('user_profiles', 'UPDATE'),
  ('vehicles', 'INSERT'),
  ('vehicles', 'SELECT')
),
-- authenticated: COLUMN-level privileges
c_auth_col(tbl, priv, col) as (values
  ('drivers', 'UPDATE', 'display_name'),
  ('drivers', 'UPDATE', 'phone'),
  ('drivers', 'UPDATE', 'status'),
  ('facilities', 'UPDATE', 'address_line1'),
  ('facilities', 'UPDATE', 'address_line2'),
  ('facilities', 'UPDATE', 'city'),
  ('facilities', 'UPDATE', 'name'),
  ('facilities', 'UPDATE', 'postal_code'),
  ('facilities', 'UPDATE', 'state'),
  ('facilities', 'UPDATE', 'status'),
  ('passengers', 'UPDATE', 'assistance_notes'),
  ('passengers', 'UPDATE', 'display_name'),
  ('passengers', 'UPDATE', 'phone'),
  ('passengers', 'UPDATE', 'status'),
  ('transportation_requests', 'UPDATE', 'additional_notes'),
  ('transportation_requests', 'UPDATE', 'assistance_notes'),
  ('transportation_requests', 'UPDATE', 'destination_description'),
  ('transportation_requests', 'UPDATE', 'pickup_description'),
  ('transportation_requests', 'UPDATE', 'preferred_date'),
  ('transportation_requests', 'UPDATE', 'preferred_time'),
  ('transportation_requests', 'UPDATE', 'requester_email'),
  ('transportation_requests', 'UPDATE', 'requester_name'),
  ('transportation_requests', 'UPDATE', 'requester_phone'),
  ('transportation_requests', 'UPDATE', 'requester_relationship'),
  ('transportation_requests', 'UPDATE', 'return_trip_needed'),
  ('transportation_requests', 'UPDATE', 'source'),
  ('trips', 'UPDATE', 'appointment_at'),
  ('trips', 'UPDATE', 'assistance_notes'),
  ('trips', 'UPDATE', 'destination_description'),
  ('trips', 'UPDATE', 'destination_facility_id'),
  ('trips', 'UPDATE', 'instructions'),
  ('trips', 'UPDATE', 'pickup_description'),
  ('trips', 'UPDATE', 'pickup_facility_id'),
  ('trips', 'UPDATE', 'scheduled_pickup_at'),
  ('vehicles', 'UPDATE', 'label'),
  ('vehicles', 'UPDATE', 'status')
),
-- service_role: the only direct table privilege the server needs (website-intake CORS lookup)
c_service_tbl(tbl, priv) as (values ('request_intake_integrations', 'SELECT')),
-- functions: a = anon, u = authenticated, s = service_role ('' = internal only, owner)
c_fn(sig, roles) as (values
  ('_driver_execute_trip_transition(uuid,text,text,text,text,boolean)', ''),
  ('_enqueue_notification_event(uuid,text,text,uuid)', ''),
  ('_generate_intake_external_id()', ''),
  ('_generate_staff_invite_token()', ''),
  ('_is_canonical_days_of_week(smallint[])', ''),
  ('_is_valid_trip_transition(text,text)', ''),
  ('_lock_driver_active_assignment(uuid,uuid)', ''),
  ('_lock_org_admins(uuid)', ''),
  ('_normalize_website_origin(text)', ''),
  ('_notification_default_roles(text)', ''),
  ('_organization_local_to_utc(date,time without time zone,text)', ''),
  ('_require_platform_admin()', ''),
  ('_sanitize_acquisition(jsonb)', ''),
  ('_staff_invite_token_hash(text)', ''),
  ('accept_staff_invite(text)', 'u'),
  ('assign_trip(uuid,uuid,uuid)', 'u'),
  ('cancel_staff_invite(uuid)', 'u'),
  ('cancel_transportation_request(uuid,uuid)', 'u'),
  ('cancel_trip(uuid,text)', 'u'),
  ('change_membership_role(uuid,text)', 'u'),
  ('check_and_record_public_intake_rate_limit(text,text)', 's'),
  ('claim_notification_dispatch(uuid)', 's'),
  ('complete_notification_dispatch(uuid,integer,integer,text)', 's'),
  ('complete_pending_signup()', 'u'),
  ('complete_pending_signup_manual(text,text)', 'u'),
  ('create_driver_invite(uuid,text,text,text)', 'u'),
  ('create_recurring_arrangement(uuid,uuid,text,text,time without time zone,smallint[],date,date)', 'u'),
  ('create_request_intake_integration(uuid,text)', 'u'),
  ('create_staff_invite(uuid,text,text)', 'u'),
  ('create_trip(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text,uuid)', 'u'),
  ('create_trip_for_recurring_occurrence(uuid,uuid,date)', 'u'),
  ('current_driver_id(uuid)', 'u'),
  ('decline_transportation_request(uuid,uuid,text)', 'u'),
  ('driver_arrive_at_destination(uuid,text)', 'u'),
  ('driver_arrive_at_pickup(uuid,text)', 'u'),
  ('driver_complete_trip(uuid,text)', 'u'),
  ('driver_get_profile(uuid)', 'u'),
  ('driver_get_trip_detail(uuid)', 'u'),
  ('driver_list_active_trips(uuid)', 'u'),
  ('driver_list_trip_history(uuid,timestamp with time zone,timestamp with time zone)', 'u'),
  ('driver_mark_passenger_onboard(uuid,text)', 'u'),
  ('driver_record_location(uuid,double precision,double precision,double precision)', 'u'),
  ('driver_start_to_destination(uuid,text)', 'u'),
  ('driver_start_to_pickup(uuid,text)', 'u'),
  ('edit_recurring_arrangement(uuid,uuid,text,text,time without time zone,smallint[],date,date)', 'u'),
  ('end_recurring_arrangement(uuid,uuid,text)', 'u'),
  ('get_driver_invite_preview(uuid)', 'au'),
  ('get_request_acquisition(uuid,uuid)', 'u'),
  ('get_notification_settings(uuid)', 'u'),
  ('get_organization_service_offerings(uuid)', 'u'),
  ('get_staff_invite_preview(text)', 'au'),
  ('has_org_role(uuid,text[])', 'u'),
  ('is_driver_assigned_to_trip(uuid)', 'u'),
  ('is_org_member(uuid)', 'u'),
  ('is_platform_admin()', 'u'),
  ('is_valid_iana_timezone(text)', 'u'),
  ('link_request_passenger(uuid,uuid,uuid)', 'u'),
  ('link_self_as_driver(uuid,text,text)', 'u'),
  ('list_activity_events(uuid,integer,timestamp with time zone,uuid)', 'u'),
  ('list_notification_history(uuid,integer)', 'u'),
  ('list_request_intake_integrations(uuid)', 'u'),
  ('list_staff_invites(uuid)', 'u'),
  ('list_team_members(uuid)', 'u'),
  ('log_transportation_request(uuid,text,text,text,text,text,text,text,text,uuid,date,time without time zone,text,text)', 'u'),
  ('pause_recurring_arrangement(uuid,uuid)', 'u'),
  ('platform_get_organization(uuid)', 'u'),
  ('platform_get_overview()', 'u'),
  ('platform_list_activity(integer,timestamp with time zone,uuid)', 'u'),
  ('platform_list_notification_attention(integer)', 'u'),
  ('platform_list_organization_integrations(uuid)', 'u'),
  ('platform_list_organizations(text,text,integer,integer)', 'u'),
  ('prevent_organization_id_change()', ''),
  ('reassign_trip(uuid,uuid,uuid,text,uuid)', 'u'),
  ('record_no_show(uuid,text)', 'u'),
  ('redeem_driver_invite(uuid)', 'u'),
  ('report_trip_exception(uuid,text,text)', 'u'),
  ('resend_staff_invite(uuid)', 'u'),
  ('resolve_trip_exception(uuid,text)', 'u'),
  ('resume_recurring_arrangement(uuid,uuid)', 'u'),
  ('revoke_driver_invite(uuid)', 'u'),
  ('set_membership_status(uuid,boolean)', 'u'),
  ('set_notification_settings(uuid,text,text[])', 'u'),
  ('set_organization_service_offerings(uuid,text[])', 'u'),
  ('set_platform_organization_status(uuid,text,text)', 'u'),
  ('set_request_intake_integration_active(uuid,boolean)', 'u'),
  ('set_updated_at()', ''),
  ('signup_create_organization(text,text,text,text)', ''),
  ('skip_recurring_occurrence(uuid,uuid,date,text)', 'u'),
  ('submit_public_transportation_request(text,text,text,text,text,text,text,text,text,date,time without time zone,text,text,text,text,text[],date,date,time without time zone,boolean,text,jsonb)', 's'),
  ('unskip_recurring_occurrence(uuid,uuid,date)', 'u'),
  ('update_organization_operating_schedule(uuid,smallint[],time without time zone,time without time zone)', 'u'),
  ('update_organization_settings(uuid,jsonb)', 'u'),
  ('update_request_intake_integration_origin(uuid,text)', 'u')
),
-- ----------------------------------------------------------------- CATALOG
rel as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, pg_get_userbyid(c.relowner) as owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'S', 'v', 'm', 'f')
),
tbl as (select * from rel where relkind in ('r', 'p')),
seq as (select * from rel where relkind = 'S'),
privs(p) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')),
roles(r) as (values ('anon'), ('authenticated'), ('service_role')),
t_priv as (  -- table-level privileges actually held (including via PUBLIC)
  select t.relname, r.r as role, p.p as priv
  from tbl t cross join roles r cross join privs p
  where has_table_privilege(r.r, t.oid, p.p)
),
col_priv as (  -- column-level privileges actually held (explicit column ACL entries only)
  select c.relname, case when x.grantee = 0 then 'public' else pg_get_userbyid(x.grantee) end as role, x.privilege_type as priv, a.attname as col
  from pg_attribute a join rel c on c.oid = a.attrelid, lateral aclexplode(a.attacl) x
  where a.attacl is not null and not a.attisdropped
),
fn as (
  select p.oid, p.oid::regprocedure::text as sig, p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner, p.prorettype::regtype::text as ret
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
),
fn_exec as (
  select f.sig, f.proname,
         has_function_privilege('anon', f.oid, 'execute') as a,
         has_function_privilege('authenticated', f.oid, 'execute') as u,
         has_function_privilege('service_role', f.oid, 'execute') as s,
         coalesce((select true from aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'), false) as pub
  from fn f join pg_proc p on p.oid = f.oid
),
defacl as (
  select pg_get_userbyid(d.defaclrole) as owner, coalesce(n.nspname, '(global)') as schema, d.defaclobjtype as objtype,
         case when x.grantee = 0 then 'public' else pg_get_userbyid(x.grantee) end as grantee, x.privilege_type as priv
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace, lateral aclexplode(d.defaclacl) x
),
pol as (select * from pg_policies where schemaname = 'public'),
-- ----------------------------------------------------------------- CHECKS
checks(check_name, ok, detail) as (
  select '01 every public table is in the contract', not exists (select 1 from tbl where relname not in (select tbl from c_tables)),
         coalesce((select string_agg(relname, ', ') from tbl where relname not in (select tbl from c_tables)), 'ok')
  union all select '02 every contract table exists', not exists (select 1 from c_tables where tbl not in (select relname from tbl)),
         coalesce((select string_agg(tbl, ', ') from c_tables where tbl not in (select relname from tbl)), 'ok')
  union all select '03 RLS enabled on every public table', not exists (select 1 from tbl where not relrowsecurity),
         coalesce((select string_agg(relname, ', ') from tbl where not relrowsecurity), 'ok')
  union all select '04 no views / materialized views / foreign tables in public (would bypass table ACL review)', not exists (select 1 from rel where relkind in ('v', 'm', 'f')),
         coalesce((select string_agg(relname, ', ') from rel where relkind in ('v', 'm', 'f')), 'ok')
  union all select '05 anon holds NO table privilege', not exists (select 1 from t_priv where role = 'anon'),
         coalesce((select string_agg(relname || ':' || priv, ', ') from t_priv where role = 'anon'), 'ok')
  union all select '06 anon holds NO column privilege', not exists (select 1 from col_priv where role in ('anon', 'public')),
         coalesce((select string_agg(relname || '.' || col, ', ') from col_priv where role in ('anon', 'public')), 'ok')
  union all select '07 authenticated holds no DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN on any table', not exists (select 1 from t_priv where role = 'authenticated' and priv in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')),
         coalesce((select string_agg(relname || ':' || priv, ', ') from t_priv where role = 'authenticated' and priv in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')), 'ok')
  union all select '08 authenticated TABLE privileges == contract (no extra, none missing)',
         not exists (select 1 from t_priv where role = 'authenticated' and (relname, priv) not in (select tbl, priv from c_auth_tbl))
         and not exists (select 1 from c_auth_tbl where (tbl, priv) not in (select relname, priv from t_priv where role = 'authenticated')),
         coalesce((select string_agg('EXTRA ' || relname || ':' || priv, ', ') from t_priv where role = 'authenticated' and (relname, priv) not in (select tbl, priv from c_auth_tbl)), '')
           || coalesce((select string_agg(' MISSING ' || tbl || ':' || priv, ', ') from c_auth_tbl where (tbl, priv) not in (select relname, priv from t_priv where role = 'authenticated')), '') || ' '
  union all select '09 authenticated COLUMN privileges == contract',
         not exists (select 1 from col_priv where role = 'authenticated' and (relname, priv, col) not in (select tbl, priv, col from c_auth_col))
         and not exists (select 1 from c_auth_col where (tbl, priv, col) not in (select relname, priv, col from col_priv where role = 'authenticated')),
         coalesce((select string_agg('EXTRA ' || relname || '.' || col || ':' || priv, ', ') from col_priv where role = 'authenticated' and (relname, priv, col) not in (select tbl, priv, col from c_auth_col)), '')
           || coalesce((select string_agg(' MISSING ' || tbl || '.' || col || ':' || priv, ', ') from c_auth_col where (tbl, priv, col) not in (select relname, priv, col from col_priv where role = 'authenticated')), '') || ' '
  union all select '10 no column privilege is held by roles other than authenticated',
         not exists (select 1 from col_priv where role in ('service_role', 'public', 'anon')),
         coalesce((select string_agg(relname || '.' || col || ' -> ' || role, ', ') from col_priv where role in ('service_role', 'public', 'anon')), 'ok')
  union all select '11 service_role TABLE privileges == contract (SELECT on request_intake_integrations only)',
         not exists (select 1 from t_priv where role = 'service_role' and (relname, priv) not in (select tbl, priv from c_service_tbl))
         and not exists (select 1 from c_service_tbl where (tbl, priv) not in (select relname, priv from t_priv where role = 'service_role')),
         coalesce((select string_agg(relname || ':' || priv, ', ') from t_priv where role = 'service_role' and (relname, priv) not in (select tbl, priv from c_service_tbl)), 'ok')
  union all select '12 no client / service privilege on any public sequence', not exists (
           select 1 from seq s cross join roles r cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) p(p) where has_sequence_privilege(r.r, s.oid, p.p)),
         coalesce((select string_agg(s.relname || ':' || r.r, ', ') from seq s cross join roles r cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) p(p) where has_sequence_privilege(r.r, s.oid, p.p)), 'ok')
  union all select '13 every public function is in the contract (platform helper rls_auto_enable excepted)', not exists (select 1 from fn where proname <> 'rls_auto_enable' and sig not in (select sig from c_fn)),
         coalesce((select string_agg(sig, ', ') from fn where proname <> 'rls_auto_enable' and sig not in (select sig from c_fn)), 'ok')
  union all select '14 every contract function exists', not exists (select 1 from c_fn where sig not in (select sig from fn)),
         coalesce((select string_agg(sig, ', ') from c_fn where sig not in (select sig from fn)), 'ok')
  union all select '15 PUBLIC has EXECUTE on no public function (rls_auto_enable excepted)', not exists (select 1 from fn_exec where pub and proname <> 'rls_auto_enable'),
         coalesce((select string_agg(sig, ', ') from fn_exec where pub and proname <> 'rls_auto_enable'), 'ok')
  union all select '16 anon EXECUTE == the two invite-preview RPCs only', not exists (select 1 from fn_exec e join c_fn c using (sig) where e.a <> (c.roles like '%a%'))
         and not exists (select 1 from fn_exec where a and proname = 'rls_auto_enable'),
         coalesce((select string_agg(sig, ', ') from fn_exec where a), 'ok')
  union all select '17 authenticated EXECUTE == contract API', not exists (select 1 from fn_exec e join c_fn c using (sig) where e.u <> (c.roles like '%u%' or c.roles like '%a%'))
         and not exists (select 1 from fn_exec where u and proname = 'rls_auto_enable'),
         coalesce((select string_agg(e.sig, ', ') from fn_exec e join c_fn c using (sig) where e.u <> (c.roles like '%u%' or c.roles like '%a%')), 'ok')
  union all select '18 service_role EXECUTE == the four server-only RPCs', not exists (select 1 from fn_exec e join c_fn c using (sig) where e.s <> (c.roles like '%s%')),
         coalesce((select string_agg(e.sig, ', ') from fn_exec e join c_fn c using (sig) where e.s <> (c.roles like '%s%')), 'ok')
  union all select '19 every SECURITY DEFINER function pins search_path', not exists (select 1 from fn where prosecdef and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')),
         coalesce((select string_agg(sig, ', ') from fn where prosecdef and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')), 'ok')
  union all select '20 no policy targets anon or PUBLIC; every policy is TO authenticated', not exists (select 1 from pol where roles::text not like '{authenticated}'),
         coalesce((select string_agg(tablename || '.' || policyname || ' -> ' || roles::text, ', ') from pol where roles::text not like '{authenticated}'), 'ok')
  union all select '21 no DELETE policy exists (no client delete path by design)', not exists (select 1 from pol where cmd in ('DELETE', 'ALL')),
         coalesce((select string_agg(tablename || '.' || policyname, ', ') from pol where cmd in ('DELETE', 'ALL')), 'ok')
  union all select '22 default privileges (owner postgres, every schema except the platform-managed storage): no anon / authenticated / service_role / PUBLIC entry on tables or sequences, and none on functions in schema public',
         not exists (select 1 from defacl where owner = 'postgres' and schema <> 'storage' and objtype in ('r', 'S') and grantee in ('anon', 'authenticated', 'service_role', 'public'))
         and not exists (select 1 from defacl where owner = 'postgres' and schema = 'public' and objtype = 'f' and grantee in ('anon', 'authenticated', 'service_role', 'public'))
         and not exists (select 1 from defacl where owner = 'postgres' and schema not in ('storage', 'extensions') and objtype = 'f' and grantee in ('anon', 'authenticated', 'service_role', 'public')),
         coalesce((select string_agg(schema || '/' || objtype::text || ':' || grantee || ':' || priv, ', ') from defacl where owner = 'postgres' and schema <> 'storage'
                     and not (schema = 'extensions' and objtype = 'f' and grantee = 'public')), 'ok')
  union all select '23 default privileges (owner postgres, global): PUBLIC does not get EXECUTE on new functions',
         exists (select 1 from pg_default_acl d where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f')
         and not exists (select 1 from defacl where owner = 'postgres' and schema = '(global)' and objtype = 'f' and grantee = 'public'),
         coalesce((select string_agg(objtype::text || ':' || grantee, ', ') from defacl where owner = 'postgres' and schema = '(global)' and objtype = 'f'), 'no global function default row')
  union all select '24 every public object is owned by postgres (the only owner whose defaults the migrations control)',
         not exists (select 1 from rel where owner <> 'postgres') and not exists (select 1 from fn where owner <> 'postgres'),
         coalesce((select string_agg(relname || ':' || owner, ', ') from rel where owner <> 'postgres'), 'ok')
  union all select '25 Driver identity: authenticated has NO INSERT on drivers and NO UPDATE on drivers.user_id / organization_id / id',
         not has_table_privilege('authenticated', 'public.drivers', 'INSERT')
         and not has_any_column_privilege('authenticated', 'public.drivers', 'INSERT')
         and not has_column_privilege('authenticated', 'public.drivers', 'user_id', 'UPDATE')
         and not has_column_privilege('authenticated', 'public.drivers', 'organization_id', 'UPDATE')
         and not has_column_privilege('authenticated', 'public.drivers', 'id', 'UPDATE'),
         'drivers'
  union all select '26 Platform Admin / audit tables have no direct client privilege (read through SECURITY DEFINER RPCs only)',
         not has_any_column_privilege('authenticated', 'public.platform_admin_grants', 'SELECT')
         and not has_any_column_privilege('authenticated', 'public.audit_events', 'SELECT')
         and not has_any_column_privilege('anon', 'public.platform_admin_grants', 'SELECT')
         and not has_any_column_privilege('anon', 'public.audit_events', 'SELECT'),
         'platform_admin_grants, audit_events'
  union all select '28 default privileges: schema extensions keeps PUBLIC EXECUTE on vendor extension functions (the ONE documented exception to the global PUBLIC-EXECUTE default-deny; Nemryn functions live in public)',
         exists (select 1 from defacl where owner = 'postgres' and schema = 'extensions' and objtype = 'f' and grantee = 'public' and priv = 'EXECUTE'),
         coalesce((select string_agg(objtype::text || ':' || grantee, ', ') from defacl where owner = 'postgres' and schema = 'extensions'), 'no default row for schema extensions')
  union all select '27 anon / authenticated cannot CREATE in schema public', not has_schema_privilege('anon', 'public', 'CREATE') and not has_schema_privilege('authenticated', 'public', 'CREATE'), 'schema public'
)
select check_name, ok, detail from checks
union all select 'SUMMARY (violations = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks)', count(*) filter (where not ok) = 0, ''
from checks
order by 2, 1;
