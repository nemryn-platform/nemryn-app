-- P1-SEC-01 -- Production database privilege baseline hardening.
--
-- WHAT THIS FIXES
-- ----------------
-- Production (hosted Supabase) and the local Supabase stack ship DIFFERENT default
-- privileges for objects created by `postgres` in schema public. Every one of our
-- migrations runs as `postgres`, so an object created in production silently received
-- whatever the hosted defaults grant, while the same object created locally did not.
-- Read-only production inventory (2026-09-21, before this migration):
--
--   pg_default_acl  postgres / public / tables     anon=arwd  authenticated=arwd  service_role=arwdDxtm
--                                    / sequences   anon=rwU   authenticated=rwU   service_role=rwU
--                                    / functions   anon=X     authenticated=X     service_role=X
--   (the S1D1 migration had already removed TRUNCATE/REFERENCES/TRIGGER from anon and
--    authenticated; local never had the DML/EXECUTE/sequence entries at all.)
--
-- Effect in production before this migration: 20 of 26 tables carried anon privileges
-- (19 with INSERT/DELETE), 19 tables carried authenticated DELETE and 14 authenticated INSERT
-- (5 are used), 73 of 92 public functions were EXECUTE-able by anon and 92 by service_role
-- (PUBLIC as well for the platform helper rls_auto_enable), and the intake-rate-limit sequence
-- was writable by anon/authenticated. None of it was exploitable: every table has RLS enabled,
-- there is no policy for anon or PUBLIC, no DELETE policy exists, and every SECURITY DEFINER
-- function pins search_path and re-checks the caller. The EFFECTIVE surface (privilege AND
-- policy) was identical in production and local (0 differences over 26 tables x anon /
-- authenticated x 4 commands).
-- But defence rested on RLS alone, and local tests could not see the production ACLs.
--
-- WHAT THIS MIGRATION DOES (deny by default, least privilege, RLS untouched)
-- --------------------------------------------------------------------------
-- 1. DEFAULT PRIVILEGES (fixes the SOURCE of drift). For the only owner our migrations
--    use (`postgres`): remove the hosted-default grants to anon / authenticated / service_role
--    on future tables, sequences and functions in schema public, and remove PUBLIC's implicit
--    EXECUTE on future functions, so a new object has NO client access until its own
--    migration grants it deliberately.
--
--    FUNCTION PUBLIC-EXECUTE STRATEGY (P1-SEC-01R, proven with rolled-back probes in
--    supabase/tests/support/default_function_privilege_probes.sql):
--      * A function gets PUBLIC EXECUTE from PostgreSQL's BUILT-IN default ACL
--        (acldefault('f') = {=X/owner, owner=X/owner}), not from any pg_default_acl row.
--      * `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public REVOKE ... FROM PUBLIC` is a NO-OP:
--        schema-scoped entries are only ever ADDED to the global default, never subtracted
--        from it. The only way to remove the built-in PUBLIC grant is the GLOBAL (no IN SCHEMA)
--        form for the owner role. That is what is used below.
--      * Global scope means it also applies to functions `postgres` creates in schemas other
--        than public. Today postgres creates functions in public only, and supautils runs
--        CREATE EXTENSION as supabase_admin (extension objects are not owned by postgres,
--        proven by probe), so nothing else is affected. As a belt-and-braces, schema
--        `extensions` gets an explicit schema-scoped PUBLIC re-grant so that an extension
--        whose objects ARE owned by postgres (production's pgcrypto / uuid-ossp / pg_stat_statements
--        are) keeps the vendor behaviour of PUBLIC-executable functions. Schema-scoped
--        entries add to the global default, so this restores exactly the previous behaviour
--        for `extensions` and nothing else.
--      * Alternatives considered and rejected (report P1-SEC-01R): explicit per-migration REVOKE
--        only (fails OPEN when forgotten), a dedicated function-owner role (major operational
--        change; migrations run as postgres), a DDL event trigger (a persistent hook that can
--        block every CREATE FUNCTION and cannot be pre-tested on production).
--    Not addressed: the `supabase_admin` default entries (postgres is not a member of that
--    role and cannot alter them). No object in schema public is owned by supabase_admin,
--    so those entries are unused; the parity test fails loudly if that ever changes.
-- 2. EXISTING OBJECTS are normalised to an explicit, reviewed ACL contract (below):
--      anon             no table, sequence privilege; EXECUTE only on the two token-based
--                       invite preview RPCs (the /join and /team-invite pages run before
--                       sign-in through a publishable-key server client)
--      authenticated    exactly the direct table/column grants the application uses plus
--                       EXECUTE on the product RPC / RLS-helper API; never DELETE, never
--                       TRUNCATE/REFERENCES/TRIGGER
--      service_role     SELECT on request_intake_integrations (the website-intake CORS
--                       lookup) and EXECUTE on the four server-only RPCs (public intake
--                       submit + rate limit, notification claim/complete). Nothing else.
--      PUBLIC           nothing
--    This equals the state the LOCAL environment already had for anon/authenticated, so
--    local == production for every client-facing privilege.
-- 3. TWO DELIBERATE TIGHTENINGS beyond local, both tables read ONLY through SECURITY DEFINER
--    RPCs (no direct .from() caller exists anywhere in src): authenticated loses SELECT on
--    audit_events (Activity is served by list_activity_events, which never returns raw rows
--    to the browser) and on platform_admin_grants (is_platform_admin() is SECURITY DEFINER).
--    Their RLS policies stay in place as the second layer.
--
-- WHAT IS NOT CHANGED: no RLS policy, no policy target, no function body, no table shape,
-- no shared authorization helper (has_org_role / is_org_member / current_driver_id remain
-- executable by authenticated exactly as before), no Driver/Platform/intake behaviour.
-- The migration is idempotent: every object is reset then re-granted from the contract.

-- =============================================================================
-- 1. Default privileges
-- =============================================================================
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
-- PUBLIC's EXECUTE default cannot be removed per-schema (per-schema entries only ADD); it is
-- removed with the GLOBAL default of the owner role. See the strategy note in the header.
alter default privileges for role postgres revoke execute on functions from public;
-- Vendor/extension functions in schema `extensions` keep PUBLIC EXECUTE (restores the previous
-- behaviour for that schema only; Nemryn functions live in public and do NOT get this).
alter default privileges for role postgres in schema extensions grant execute on functions to public;

-- =============================================================================
-- 2. Existing objects -> explicit contract
-- =============================================================================
do $mig$
declare
  -- authenticated: direct table privileges and column-level UPDATE/INSERT lists.
  -- Tables with an empty entry have NO client access (server / RPC / internal only).
  c_auth constant jsonb := '{
    "audit_events": {},
    "driver_invites": {"table":["SELECT"]},
    "driver_location_updates": {"table":["SELECT"]},
    "drivers": {"table":["SELECT"],"columns":{"update":["display_name","phone","status"]}},
    "facilities": {"table":["INSERT","SELECT"],"columns":{"update":["address_line1","address_line2","city","name","postal_code","state","status"]}},
    "memberships": {"table":["SELECT"]},
    "notification_events": {},
    "organization_notification_settings": {},
    "organization_service_offerings": {},
    "organizations": {"table":["SELECT"]},
    "passengers": {"table":["INSERT","SELECT"],"columns":{"update":["assistance_notes","display_name","phone","status"]}},
    "platform_admin_grants": {},
    "public_intake_rate_limit_events": {},
    "recurring_arrangements": {"table":["SELECT"]},
    "recurring_occurrence_exceptions": {"table":["SELECT"]},
    "request_events": {"table":["SELECT"]},
    "request_intake_integrations": {},
    "staff_invites": {},
    "transportation_requests": {"table":["SELECT"],"columns":{"update":["additional_notes","assistance_notes","destination_description","pickup_description","preferred_date","preferred_time","requester_email","requester_name","requester_phone","requester_relationship","return_trip_needed","source"]}},
    "trip_assignments": {"table":["SELECT"]},
    "trip_events": {"table":["SELECT"]},
    "trip_exceptions": {"table":["SELECT"]},
    "trip_notes": {"table":["INSERT","SELECT","UPDATE"]},
    "trips": {"table":["SELECT"],"columns":{"update":["appointment_at","assistance_notes","destination_description","destination_facility_id","instructions","pickup_description","pickup_facility_id","scheduled_pickup_at"]}},
    "user_profiles": {"table":["INSERT","SELECT","UPDATE"]},
    "vehicles": {"table":["INSERT","SELECT"],"columns":{"update":["label","status"]}}
  }'::jsonb;

  -- anon: EXECUTE only where a pre-sign-in server page needs it.
  c_fn_anon_and_auth constant text[] := array[
      'get_driver_invite_preview(uuid)',
      'get_staff_invite_preview(text)'
  ];
  -- service_role: EXECUTE only on the server-only RPCs.
  c_fn_service constant text[] := array[
      'check_and_record_public_intake_rate_limit(text,text)',
      'claim_notification_dispatch(uuid)',
      'complete_notification_dispatch(uuid,integer,integer,text)',
      'submit_public_transportation_request(text,text,text,text,text,text,text,text,text,date,time without time zone,text,text,text,text,text[],date,date,time without time zone,boolean,text)'
  ];
  -- authenticated: the product RPC / RLS-helper API.
  c_fn_auth constant text[] := array[
      'accept_staff_invite(text)',
      'assign_trip(uuid,uuid,uuid)',
      'cancel_staff_invite(uuid)',
      'cancel_transportation_request(uuid,uuid)',
      'cancel_trip(uuid,text)',
      'change_membership_role(uuid,text)',
      'complete_pending_signup()',
      'complete_pending_signup_manual(text,text)',
      'create_driver_invite(uuid,text,text,text)',
      'create_recurring_arrangement(uuid,uuid,text,text,time without time zone,smallint[],date,date)',
      'create_request_intake_integration(uuid,text)',
      'create_staff_invite(uuid,text,text)',
      'create_trip(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text,uuid)',
      'create_trip_for_recurring_occurrence(uuid,uuid,date)',
      'current_driver_id(uuid)',
      'decline_transportation_request(uuid,uuid,text)',
      'driver_arrive_at_destination(uuid,text)',
      'driver_arrive_at_pickup(uuid,text)',
      'driver_complete_trip(uuid,text)',
      'driver_get_profile(uuid)',
      'driver_get_trip_detail(uuid)',
      'driver_list_active_trips(uuid)',
      'driver_list_trip_history(uuid,timestamp with time zone,timestamp with time zone)',
      'driver_mark_passenger_onboard(uuid,text)',
      'driver_record_location(uuid,double precision,double precision,double precision)',
      'driver_start_to_destination(uuid,text)',
      'driver_start_to_pickup(uuid,text)',
      'edit_recurring_arrangement(uuid,uuid,text,text,time without time zone,smallint[],date,date)',
      'end_recurring_arrangement(uuid,uuid,text)',
      'get_notification_settings(uuid)',
      'get_organization_service_offerings(uuid)',
      'has_org_role(uuid,text[])',
      'is_driver_assigned_to_trip(uuid)',
      'is_org_member(uuid)',
      'is_platform_admin()',
      'is_valid_iana_timezone(text)',
      'link_request_passenger(uuid,uuid,uuid)',
      'link_self_as_driver(uuid,text,text)',
      'list_activity_events(uuid,integer,timestamp with time zone,uuid)',
      'list_notification_history(uuid,integer)',
      'list_request_intake_integrations(uuid)',
      'list_staff_invites(uuid)',
      'list_team_members(uuid)',
      'log_transportation_request(uuid,text,text,text,text,text,text,text,text,uuid,date,time without time zone,text,text)',
      'pause_recurring_arrangement(uuid,uuid)',
      'platform_get_organization(uuid)',
      'platform_get_overview()',
      'platform_list_activity(integer,timestamp with time zone,uuid)',
      'platform_list_notification_attention(integer)',
      'platform_list_organization_integrations(uuid)',
      'platform_list_organizations(text,text,integer,integer)',
      'reassign_trip(uuid,uuid,uuid,text,uuid)',
      'record_no_show(uuid,text)',
      'redeem_driver_invite(uuid)',
      'report_trip_exception(uuid,text,text)',
      'resend_staff_invite(uuid)',
      'resolve_trip_exception(uuid,text)',
      'resume_recurring_arrangement(uuid,uuid)',
      'revoke_driver_invite(uuid)',
      'set_membership_status(uuid,boolean)',
      'set_notification_settings(uuid,text,text[])',
      'set_organization_service_offerings(uuid,text[])',
      'set_platform_organization_status(uuid,text,text)',
      'set_request_intake_integration_active(uuid,boolean)',
      'skip_recurring_occurrence(uuid,uuid,date,text)',
      'unskip_recurring_occurrence(uuid,uuid,date)',
      'update_organization_operating_schedule(uuid,smallint[],time without time zone,time without time zone)',
      'update_organization_settings(uuid,jsonb)',
      'update_request_intake_integration_origin(uuid,text)'
  ];

  r record;
  v_priv text;
  v_col text;
  v_entry jsonb;
begin
  -- ---- tables ----
  for r in
    select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', r.relname);

    v_entry := c_auth -> r.relname;
    if v_entry is not null then
      for v_priv in select jsonb_array_elements_text(coalesce(v_entry -> 'table', '[]'::jsonb)) loop
        execute format('grant %s on table public.%I to authenticated', v_priv, r.relname);
      end loop;
      for v_priv in select jsonb_object_keys(coalesce(v_entry -> 'columns', '{}'::jsonb)) loop
        execute format('grant %s (%s) on table public.%I to authenticated', v_priv,
          (select string_agg(quote_ident(x), ', ') from jsonb_array_elements_text(v_entry -> 'columns' -> v_priv) x), r.relname);
      end loop;
    end if;
  end loop;

  -- The single direct server-side table read (website-intake CORS origin lookup).
  execute 'grant select on table public.request_intake_integrations to service_role';

  -- ---- sequences: no client or service access (written only by SECURITY DEFINER owner code) ----
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated, service_role', r.relname);
  end loop;

  -- ---- functions ----
  for r in
    select p.oid::regprocedure::text as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and p.proname <> 'rls_auto_enable'   -- platform-managed event-trigger helper, handled below
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.sig = any (c_fn_anon_and_auth) then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    elsif r.sig = any (c_fn_auth) then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    if r.sig = any (c_fn_service) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;

  -- rls_auto_enable() is installed by the Supabase platform (event trigger that turns RLS on
  -- for new tables). Event triggers do not need session-role EXECUTE, and it can never be
  -- called directly; remove the client/PUBLIC grants only, leave the platform's own access.
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$mig$;

comment on schema public is
  'Application schema. Privilege baseline (P1-SEC-01): deny by default. anon holds nothing here except EXECUTE on the two invite-preview RPCs; authenticated holds only the grants in supabase/tests/privilege_contract_tests.sql; service_role holds only the server-only intake/notification surface. New objects receive NO client privileges from default ACLs and must be granted deliberately (and added to the contract test).';
