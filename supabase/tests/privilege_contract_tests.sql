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
  ('website_request_forms'),
  ('website_request_form_publications'),
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
  ('vehicles'),
  -- P1-OPS-PROG5 availability / capability (SELECT for Admin / Dispatcher via RLS; writes through RPCs only)
  ('driver_weekly_schedules'),
  ('driver_weekly_shifts'),
  ('driver_unavailability_windows'),
  ('vehicle_unavailability_windows'),
  -- NP-P1-S1 Nemryn Plus entitlement: class A (no anon / authenticated / service_role privilege; RPCs only)
  ('organization_modules'),
  -- NP-P1-S3 named-staff Plus grants: class A (RPCs only)
  ('membership_module_grants'),
  -- NP-P1-S4 Plus contacts + append-only activities (SELECT via RLS plus_can_read; writes through RPCs only)
  ('plus_contacts'),
  ('plus_activities'),
  -- NP-P2-S1 private-pay opportunities (SELECT via RLS plus_can_read; writes through RPCs only)
  ('plus_opportunities'),
  -- NP-P2-S2 tasks (SELECT via RLS plus_can_read; writes through RPCs only)
  ('plus_tasks'),
  -- NP-P2-S2 Growth Agent review queue (SELECT via RLS plus_can_read; writes through RPCs only)
  ('plus_agent_recommendations'),
  -- NP-P2-S3 request attribution (SELECT via RLS plus_can_read AND the Core request-read role; writes through RPCs only)
  ('plus_request_attributions'),
  -- NP-P2-S5-S1 estimates & quotes (SELECT via RLS plus_can_read; writes through RPCs only) + number allocator (class A)
  ('plus_quotes'),
  ('plus_quote_counters'),
  -- NP-P2-S6-A consent ledger (append-only; column-level SELECT via RLS plus_can_read; writes through RPCs only)
  ('plus_communication_consents'),
  -- NP-P2-S7-A public inquiry intake: form + inbox (SELECT via RLS plus_can_read; writes through RPCs only);
  -- activation allowlist and rate-limit ledger (class A: no privilege for any role)
  ('plus_inquiry_forms'),
  ('plus_inquiries'),
  ('plus_inquiry_public_access'),
  ('plus_inquiry_rate_limit_events'),
  -- NP-BILL-P1 Core billing: invoices / trip links / lines / payment ledger (SELECT via RLS for Organization Admins;
  -- writes through RPCs only); invoice counters (class A: no privilege for any role)
  ('billing_invoice_counters'),
  ('billing_invoices'),
  ('billing_invoice_trips'),
  ('billing_invoice_lines'),
  ('billing_payments')
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
  ('vehicles', 'SELECT'),
  ('driver_weekly_schedules', 'SELECT'),
  ('driver_weekly_shifts', 'SELECT'),
  ('driver_unavailability_windows', 'SELECT'),
  ('vehicle_unavailability_windows', 'SELECT'),
  ('plus_contacts', 'SELECT'),
  ('plus_activities', 'SELECT'),
  ('plus_opportunities', 'SELECT'),
  ('plus_tasks', 'SELECT'),
  ('plus_agent_recommendations', 'SELECT'),
  ('plus_request_attributions', 'SELECT'),
  ('plus_quotes', 'SELECT'),
  ('plus_inquiry_forms', 'SELECT'),
  ('billing_invoices', 'SELECT'),
  ('billing_invoice_trips', 'SELECT'),
  ('billing_invoice_lines', 'SELECT'),
  ('billing_payments', 'SELECT')
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
  ('vehicles', 'UPDATE', 'label'),
  ('vehicles', 'UPDATE', 'status'),
  -- NP-P2-S6-A (ZD-240): column-level SELECT on the consent ledger; address_digest and idempotency_key are NOT granted
  ('plus_communication_consents', 'SELECT', 'captured_at'),
  ('plus_communication_consents', 'SELECT', 'captured_via'),
  ('plus_communication_consents', 'SELECT', 'channel'),
  ('plus_communication_consents', 'SELECT', 'consent_text_version'),
  ('plus_communication_consents', 'SELECT', 'contact_id'),
  ('plus_communication_consents', 'SELECT', 'corrects_consent_id'),
  ('plus_communication_consents', 'SELECT', 'evidence_note'),
  ('plus_communication_consents', 'SELECT', 'id'),
  ('plus_communication_consents', 'SELECT', 'organization_id'),
  ('plus_communication_consents', 'SELECT', 'purpose'),
  ('plus_communication_consents', 'SELECT', 'recorded_at'),
  ('plus_communication_consents', 'SELECT', 'recorded_by'),
  ('plus_communication_consents', 'SELECT', 'seq'),
  ('plus_communication_consents', 'SELECT', 'status'),
  -- NP-P2-S7-A: web_form evidence link on the ledger; the inbox's column-level SELECT (never idempotency_key)
  ('plus_communication_consents', 'SELECT', 'inquiry_id'),
  ('plus_inquiries', 'SELECT', 'consent_followup'),
  ('plus_inquiries', 'SELECT', 'consent_marketing'),
  ('plus_inquiries', 'SELECT', 'consent_text_version'),
  ('plus_inquiries', 'SELECT', 'contact_id'),
  ('plus_inquiries', 'SELECT', 'dismiss_note'),
  ('plus_inquiries', 'SELECT', 'dismiss_reason'),
  ('plus_inquiries', 'SELECT', 'email'),
  ('plus_inquiries', 'SELECT', 'form_config_version'),
  ('plus_inquiries', 'SELECT', 'form_id'),
  ('plus_inquiries', 'SELECT', 'id'),
  ('plus_inquiries', 'SELECT', 'inquiry_type'),
  ('plus_inquiries', 'SELECT', 'landing_path'),
  ('plus_inquiries', 'SELECT', 'name'),
  ('plus_inquiries', 'SELECT', 'organization_id'),
  ('plus_inquiries', 'SELECT', 'phone'),
  ('plus_inquiries', 'SELECT', 'preferred_reply'),
  ('plus_inquiries', 'SELECT', 'question'),
  ('plus_inquiries', 'SELECT', 'received_at'),
  ('plus_inquiries', 'SELECT', 'referrer_host'),
  ('plus_inquiries', 'SELECT', 'relationship'),
  ('plus_inquiries', 'SELECT', 'service_type'),
  ('plus_inquiries', 'SELECT', 'status'),
  ('plus_inquiries', 'SELECT', 'timeframe'),
  ('plus_inquiries', 'SELECT', 'triaged_at'),
  ('plus_inquiries', 'SELECT', 'triaged_by'),
  ('plus_inquiries', 'SELECT', 'updated_at'),
  ('plus_inquiries', 'SELECT', 'utm_campaign'),
  ('plus_inquiries', 'SELECT', 'utm_content'),
  ('plus_inquiries', 'SELECT', 'utm_medium'),
  ('plus_inquiries', 'SELECT', 'utm_source'),
  ('plus_inquiries', 'SELECT', 'utm_term'),
  ('plus_inquiries', 'SELECT', 'version')
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
  ('_create_public_request(uuid,text,text,text,text,text,text,text,text,date,time without time zone,text,text,text,text[],date,date,time without time zone,boolean,text,jsonb)', ''),
  ('_public_form_service_types(uuid,text[])', ''),
  ('_staff_invite_token_hash(text)', ''),
  ('_validate_request_decision_reason(text,text,text)', ''),
  ('accept_staff_invite(text)', 'u'),
  ('accept_transportation_request(uuid,uuid)', 'u'),
  ('assign_trip(uuid,uuid,uuid)', 'u'),
  ('cancel_staff_invite(uuid)', 'u'),
  ('cancel_transportation_request(uuid,uuid,text,text)', 'u'),
  ('cancel_trip(uuid,text)', 'u'),
  ('change_membership_role(uuid,text)', 'u'),
  ('check_and_record_public_intake_rate_limit(text,text)', 's'),
  ('get_public_request_form(text)', 's'),
  ('submit_public_form_request(text,text,text,text,text,text,text,text,text,date,time without time zone,text,text,text,text[],date,date,time without time zone,boolean,text,jsonb)', 's'),
  ('claim_notification_dispatch(uuid)', 's'),
  ('complete_notification_dispatch(uuid,integer,integer,text)', 's'),
  ('complete_pending_signup()', 'u'),
  ('complete_pending_signup_manual(text,text)', 'u'),
  ('create_driver_invite(uuid,text,text,text)', 'u'),
  ('create_recurring_arrangement(uuid,uuid,text,text,time without time zone,smallint[],date,date,boolean,uuid)', 'u'),
  ('create_request_intake_integration(uuid,text)', 'u'),
  ('create_staff_invite(uuid,text,text)', 'u'),
  ('create_trip(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text,uuid,integer,boolean)', 'u'),
  ('create_trip_for_recurring_occurrence(uuid,uuid,date)', 'u'),
  ('current_driver_id(uuid)', 'u'),
  ('decline_transportation_request(uuid,uuid,text,text)', 'u'),
  ('delete_unused_request_intake_integration(uuid)', 'u'),
  ('retire_request_intake_integration(uuid)', 'u'),
  ('list_previous_website_connections(uuid)', 'u'),
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
  ('get_website_request_form(uuid)', 'u'),
  ('get_website_request_form_publication(uuid)', 'u'),
  ('publish_website_request_form(uuid)', 'u'),
  ('disable_website_request_form_publication(uuid)', 'u'),
  ('save_website_request_form(uuid,text,text,text,boolean,boolean,text,text,text[])', 'u'),
  ('set_request_intake_integration_setup(uuid,text,text)', 'u'),
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
  ('log_transportation_request(uuid,text,text,text,text,text,text,text,text,uuid,date,time without time zone,text,text,text)', 'u'),
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
  ('set_trip_expected_duration(uuid,integer)', 'u'),
  -- P1-OPS-PROG5
  ('set_driver_weekly_schedule(uuid,jsonb)', 'u'),
  ('clear_driver_weekly_schedule(uuid)', 'u'),
  ('save_driver_unavailability(uuid,timestamp with time zone,timestamp with time zone,uuid)', 'u'),
  ('delete_driver_unavailability(uuid)', 'u'),
  ('save_vehicle_unavailability(uuid,timestamp with time zone,timestamp with time zone,uuid)', 'u'),
  ('delete_vehicle_unavailability(uuid)', 'u'),
  ('set_vehicle_capabilities(uuid,boolean,boolean,integer,integer)', 'u'),
  ('set_trip_wheelchair_requirement(uuid,boolean)', 'u'),
  ('update_trip_details(uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,uuid,text,uuid,text,text)', 'u'),
  ('record_trip_completion_by_operations(uuid,text,timestamp with time zone,text)', 'u'),
  ('set_recurring_wheelchair_requirement(uuid,uuid,boolean)', 'u'),
  ('driver_get_own_schedule(uuid)', 'u'),
  ('update_organization_trip_defaults(uuid,integer)', 'u'),
  ('update_organization_settings(uuid,jsonb)', 'u'),
  ('update_request_intake_integration_origin(uuid,text)', 'u'),
  -- NP-P1-S1 Nemryn Plus entitlement
  ('_plus_entitlement_state(uuid)', ''),
  ('plus_access_state(uuid)', 'u'),
  ('platform_set_organization_module(uuid,text,text,integer,timestamp with time zone,text,text)', 'u'),
  ('platform_extend_plus_trial(uuid,integer,text)', 'u'),
  ('platform_get_organization_module(uuid,text)', 'u'),
  -- NP-P1-S2 Nemryn Plus access helpers
  ('plus_can_read(uuid)', 'u'),
  ('plus_can_write(uuid)', 'u'),
  ('_require_plus_write(uuid)', ''),
  ('_require_plus_admin_write(uuid)', ''),
  -- NP-P1-S2-R1 versioned (optimistic-concurrency) entitlement mutations
  ('platform_set_organization_module(uuid,text,text,integer,timestamp with time zone,text,text,timestamp with time zone)', 'u'),
  ('platform_extend_plus_trial(uuid,integer,text,timestamp with time zone)', 'u'),
  -- NP-P1-S3 named-staff Plus grants
  ('_plus_member_access(uuid)', ''),
  ('plus_list_member_access(uuid)', 'u'),
  ('plus_grant_member_access(uuid,uuid,text,uuid)', 'u'),
  ('plus_revoke_member_access(uuid,uuid,uuid)', 'u'),
  -- NP-P1-S4 Plus contacts + activities
  ('_plus_user_can_write(uuid,uuid)', ''),
  ('_plus_contact_matches(uuid,text,text,text,uuid)', ''),
  ('_plus_staff_name(uuid)', ''),
  ('_plus_resolve_owner(uuid,uuid)', ''),
  ('plus_list_contacts(uuid,text,text,text,integer,integer)', 'u'),
  ('plus_get_contact(uuid,uuid)', 'u'),
  ('plus_list_contact_activities(uuid,uuid,integer,integer)', 'u'),
  ('plus_find_contact_matches(uuid,text,text,text,uuid)', 'u'),
  ('plus_list_contact_owner_options(uuid)', 'u'),
  ('plus_create_contact(uuid,text,text,text,text,text,text,boolean,uuid,boolean)', 'u'),
  ('plus_update_contact(uuid,uuid,timestamp with time zone,text,text,text,text,text,text,boolean,uuid)', 'u'),
  ('plus_archive_contact(uuid,uuid,timestamp with time zone,text)', 'u'),
  ('plus_log_contact_activity(uuid,uuid,text,text,timestamp with time zone)', 'u'),
  -- NP-P2-S1 private-pay opportunities
  ('_plus_opportunity_channel_immutable()', ''),
  ('_plus_require_active_contact(uuid,uuid)', ''),
  ('plus_list_opportunities(uuid,text,text,text,text,uuid,uuid,integer,integer)', 'u'),
  ('plus_get_opportunity(uuid,uuid)', 'u'),
  ('plus_list_opportunity_activities(uuid,uuid,integer,integer)', 'u'),
  ('plus_create_opportunity(uuid,uuid,text,text,text,text,text,text,bigint,uuid)', 'u'),
  ('plus_update_opportunity(uuid,uuid,timestamp with time zone,uuid,text,text,text,text,text,text,bigint,text,uuid)', 'u'),
  ('plus_change_opportunity_stage(uuid,uuid,timestamp with time zone,text,text)', 'u'),
  ('plus_mark_opportunity_lost(uuid,uuid,timestamp with time zone,text,text)', 'u'),
  ('plus_reopen_opportunity(uuid,uuid,timestamp with time zone,text,text)', 'u'),
  -- NP-P2-S2 tasks
  ('_plus_org_day_bounds(uuid)', ''),
  ('_plus_require_task_subject(uuid,uuid,uuid)', ''),
  ('_plus_insert_task(uuid,text,timestamp with time zone,uuid,uuid,uuid,uuid)', ''),
  ('plus_list_tasks(uuid,text,text,uuid,uuid,uuid,integer,integer)', 'u'),
  ('plus_get_task(uuid,uuid)', 'u'),
  ('plus_create_task(uuid,text,timestamp with time zone,uuid,uuid,uuid)', 'u'),
  ('plus_update_task(uuid,uuid,timestamp with time zone,text,timestamp with time zone,uuid)', 'u'),
  ('plus_reassign_task(uuid,uuid,timestamp with time zone,uuid)', 'u'),
  ('plus_complete_task(uuid,uuid,timestamp with time zone)', 'u'),
  ('plus_cancel_task(uuid,uuid,timestamp with time zone)', 'u'),
  -- NP-P2-S2 Growth Agent + dashboard
  ('_plus_agent_threshold(text)', ''),
  ('_plus_agent_candidates(uuid,uuid)', ''),
  ('_plus_agent_review(uuid,uuid,text)', ''),
  ('plus_run_growth_agent_review(uuid)', 'u'),
  ('plus_list_agent_recommendations(uuid,text,integer,integer)', 'u'),
  ('plus_approve_agent_recommendation(uuid,uuid,timestamp with time zone,text,timestamp with time zone,uuid)', 'u'),
  ('plus_dismiss_agent_recommendation(uuid,uuid,timestamp with time zone,text)', 'u'),
  ('plus_growth_dashboard(uuid)', 'u'),
  ('plus_list_attention_opportunities(uuid,integer)', 'u'),
  ('plus_list_recent_activities(uuid,integer)', 'u'),
  -- NP-P2-S3 request attribution
  ('_plus_require_core_request_read(uuid)', ''),
  ('_plus_resolve_attribution(uuid,uuid,uuid,uuid)', ''),
  ('plus_link_request(uuid,uuid,uuid,uuid)', 'u'),
  ('plus_update_request_attribution(uuid,uuid,timestamp with time zone,uuid,uuid,text)', 'u'),
  ('plus_get_request_attribution(uuid,uuid)', 'u'),
  ('plus_list_request_attributions(uuid,uuid,uuid,integer,integer)', 'u'),
  ('plus_get_request_summaries(uuid,uuid[])', 'u'),
  -- NP-P2-S4 conversion + rebooking
  ('_plus_opportunity_conversion_guard()', ''),
  ('_plus_core_request_source(text)', ''),
  ('_plus_require_idempotency_key(text)', ''),
  ('plus_convert_opportunity_to_request(uuid,uuid,timestamp with time zone,text,text,text,text,text,date,time without time zone,text,text)', 'u'),
  ('plus_create_rebooking_request(uuid,uuid,text,text,text,text,text,text,date,time without time zone,text,text,text)', 'u'),
  -- NP-P2-S5-S1 estimates & quotes
  ('_plus_quotes_guard()', ''),
  ('_plus_org_local_today(uuid)', ''),
  ('_plus_quote_validate(text,text,numeric,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,bigint,text,date,date)', ''),
  ('_plus_quote_lock_open_opportunity(uuid,uuid)', ''),
  ('_plus_quote_lock(uuid,uuid)', ''),
  ('_plus_quote_opportunity(uuid,uuid)', ''),
  ('_plus_next_quote_number(uuid)', ''),
  ('_plus_quote_advance_stage(plus_opportunities,text)', ''),
  ('_plus_quote_audit(plus_quotes,text,jsonb,text)', ''),
  -- NP-P2-S5-S3B: quote timeline events (internal) + the activity guard trigger function
  ('_plus_activities_quote_guard()', ''),
  ('_plus_quote_activity(plus_opportunities,uuid,text,text)', ''),
  ('_plus_quote_related_number(plus_quotes,text)', ''),
  ('plus_create_quote(uuid,uuid,text,text,text,boolean,numeric,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,bigint,text,date)', 'u'),
  ('plus_update_quote_draft(uuid,uuid,timestamp with time zone,text,text,boolean,numeric,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,bigint,text,date)', 'u'),
  -- NP-P2-S5-S3B: + trailing p_dnc_acknowledged boolean DEFAULT false (DROP + CREATE: one function, no overload)
  ('plus_mark_quote_sent(uuid,uuid,timestamp with time zone,boolean)', 'u'),
  ('plus_record_quote_response(uuid,uuid,timestamp with time zone,text)', 'u'),
  ('plus_revise_quote(uuid,uuid,text)', 'u'),
  ('plus_withdraw_quote(uuid,uuid,timestamp with time zone,text)', 'u'),
  ('plus_list_quotes(uuid,uuid,uuid)', 'u'),
  ('plus_get_quote(uuid,uuid)', 'u'),
  -- NP-P2-S5-S3A: organization-wide quote directory reads (Plus read; authenticated EXECUTE only)
  ('plus_list_organization_quotes(uuid,text,text,text,integer,integer)', 'u'),
  ('plus_quote_directory_summary(uuid)', 'u'),
  -- NP-P2-S6-A consent ledger: internals (no client EXECUTE) + Plus read / write RPCs (authenticated only)
  ('_plus_consents_append_only()', ''),
  ('_plus_consent_address_digest(uuid,text,text,text)', ''),
  ('_plus_effective_consent(uuid,uuid,text,text)', ''),
  ('_plus_append_consent(text,uuid,uuid,text,text,text,timestamp with time zone,text,uuid,text)', ''),
  ('_plus_consents_revoke_for_dnc(uuid,uuid)', ''),
  ('plus_get_contact_consents(uuid,uuid)', 'u'),
  ('plus_list_contact_consent_events(uuid,uuid,integer,integer)', 'u'),
  ('plus_record_consent(uuid,uuid,text,text,text,timestamp with time zone,text,uuid,text)', 'u'),
  ('plus_revoke_consent(uuid,uuid,text,text,text,timestamp with time zone,text,uuid,text)', 'u'),
  -- NP-P2-S7-A public inquiry intake: internals (no EXECUTE), Platform Admin allowlist + Plus RPCs (authenticated),
  -- the public boundary (service_role only; called by the S7-B server-only route)
  ('_plus_inquiry_service_type_list()', ''),
  ('_plus_inquiry_service_types_valid(text[])', ''),
  ('_plus_opportunity_inquiry_immutable()', ''),
  ('_plus_inquiry_public_access_enabled(uuid)', ''),
  ('_plus_inquiry_service_options(uuid)', ''),
  ('_plus_inquiry_public_form(text)', ''),
  ('_plus_inquiry_append_web_form_consent(uuid,uuid,plus_inquiries,text,text)', ''),
  ('platform_set_plus_inquiry_public_access(uuid,boolean,text)', 'u'),
  ('platform_get_plus_inquiry_public_access(uuid)', 'u'),
  ('get_public_plus_inquiry_form(text)', 's'),
  ('check_and_record_plus_inquiry_rate_limit(text,text)', 's'),
  ('submit_plus_inquiry(text,text,integer,text,text,text,text,text,text,text,text,text,boolean,boolean,jsonb)', 's'),
  ('plus_get_inquiry_form(uuid)', 'u'),
  ('plus_save_inquiry_form(uuid,text,text,text[],integer)', 'u'),
  ('plus_publish_inquiry_form(uuid,integer)', 'u'),
  ('plus_disable_inquiry_form(uuid,integer)', 'u'),
  ('plus_list_inquiries(uuid,text,text,integer,integer)', 'u'),
  ('plus_get_inquiry(uuid,uuid)', 'u'),
  ('plus_list_inquiry_duplicate_hints(uuid,uuid)', 'u'),
  ('plus_count_new_inquiries(uuid)', 'u'),
  ('plus_convert_inquiry(uuid,uuid,integer,text,uuid,boolean,boolean,text,uuid,boolean)', 'u'),
  ('plus_dismiss_inquiry(uuid,uuid,integer,text,text)', 'u'),
  ('plus_reopen_inquiry(uuid,uuid,integer)', 'u'),
  -- NP-BILL-P1 Core billing: internal helpers + immutability triggers (owner only); Organization Admin RPCs
  ('_billing_audit(uuid,text,uuid,text,jsonb,jsonb,text)', ''),
  ('_billing_invoice_lines_guard()', ''),
  ('_billing_invoice_trips_guard()', ''),
  ('_billing_invoices_guard()', ''),
  ('_billing_lock_invoice(uuid,uuid)', ''),
  ('_billing_org_today(uuid)', ''),
  ('_billing_paid_cents(uuid)', ''),
  ('_billing_payment_state(text,bigint,bigint)', ''),
  ('_billing_payments_guard()', ''),
  ('_billing_recompute_totals(uuid)', ''),
  ('_billing_require_admin(uuid)', ''),
  ('_billing_require_key(text)', ''),
  ('_billing_trip_line_description(uuid,trips)', ''),
  ('billing_create_invoice_draft(uuid,uuid[],text,uuid,text,uuid,text)', 'u'),
  ('billing_discard_invoice_draft(uuid,uuid,integer)', 'u'),
  ('billing_get_invoice(uuid,uuid)', 'u'),
  ('billing_issue_invoice(uuid,uuid,integer,date,date)', 'u'),
  ('billing_list_billable_trips(uuid,uuid,integer,integer)', 'u'),
  ('billing_list_invoices(uuid,text,text,integer,integer)', 'u'),
  ('billing_record_payment(uuid,uuid,integer,bigint,date,text,text,text,text)', 'u'),
  ('billing_reverse_payment(uuid,uuid,integer,text,text)', 'u'),
  ('billing_summary(uuid)', 'u'),
  ('billing_trip_status(uuid,uuid)', 'u'),
  ('billing_update_invoice_draft(uuid,uuid,integer,text,text,text,text,jsonb,bigint,text)', 'u'),
  ('billing_void_invoice(uuid,uuid,integer,text)', 'u')
),
-- TRANSITIONAL (expand -> contract): functions a release deliberately keeps ONLY while the previously deployed app
-- may still call them. Tolerated by checks 13 / 16-18 (their ACL must match the roles given here) and NOT required
-- by check 14; check 29 fails while any of them still exists, so the window is visible and can not be forgotten.
-- P1-OPS-R1: the pre-R1 decline / cancel overloads, dropped by 20260924091000_request_decision_workflow_contract.
c_fn_transitional(sig, roles) as (values
  ('cancel_transportation_request(uuid,uuid)', 'u'),
  ('decline_transportation_request(uuid,uuid,text)', 'u')
),
c_fn_all as (select sig, roles from c_fn union all select sig, roles from c_fn_transitional),
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
  union all select '13 every public function is in the contract (platform helper rls_auto_enable excepted)', not exists (select 1 from fn where proname <> 'rls_auto_enable' and sig not in (select sig from c_fn_all)),
         coalesce((select string_agg(sig, ', ') from fn where proname <> 'rls_auto_enable' and sig not in (select sig from c_fn_all)), 'ok')
  union all select '14 every contract function exists', not exists (select 1 from c_fn where sig not in (select sig from fn)),
         coalesce((select string_agg(sig, ', ') from c_fn where sig not in (select sig from fn)), 'ok')
  union all select '15 PUBLIC has EXECUTE on no public function (rls_auto_enable excepted)', not exists (select 1 from fn_exec where pub and proname <> 'rls_auto_enable'),
         coalesce((select string_agg(sig, ', ') from fn_exec where pub and proname <> 'rls_auto_enable'), 'ok')
  union all select '16 anon EXECUTE == the two invite-preview RPCs only', not exists (select 1 from fn_exec e join c_fn_all c using (sig) where e.a <> (c.roles like '%a%'))
         and not exists (select 1 from fn_exec where a and proname = 'rls_auto_enable'),
         coalesce((select string_agg(sig, ', ') from fn_exec where a), 'ok')
  union all select '17 authenticated EXECUTE == contract API', not exists (select 1 from fn_exec e join c_fn_all c using (sig) where e.u <> (c.roles like '%u%' or c.roles like '%a%'))
         and not exists (select 1 from fn_exec where u and proname = 'rls_auto_enable'),
         coalesce((select string_agg(e.sig, ', ') from fn_exec e join c_fn_all c using (sig) where e.u <> (c.roles like '%u%' or c.roles like '%a%')), 'ok')
  union all select '18 service_role EXECUTE == the four server-only RPCs', not exists (select 1 from fn_exec e join c_fn_all c using (sig) where e.s <> (c.roles like '%s%')),
         coalesce((select string_agg(e.sig, ', ') from fn_exec e join c_fn_all c using (sig) where e.s <> (c.roles like '%s%')), 'ok')
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
  union all select '29 no TRANSITIONAL (expand -> contract) function remains -- fails by design only between an EXPAND and its CONTRACT migration',
         not exists (select 1 from fn where sig in (select sig from c_fn_transitional)),
         coalesce((select string_agg(sig, ', ') from fn where sig in (select sig from c_fn_transitional)), 'ok')
)
select check_name, ok, detail from checks
union all select 'SUMMARY (violations = ' || count(*) filter (where not ok) || ' of ' || count(*) || ' checks)', count(*) filter (where not ok) = 0, ''
from checks
order by 2, 1;
