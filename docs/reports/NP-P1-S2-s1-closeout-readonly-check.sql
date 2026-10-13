-- =====================================================================================================================
-- NP-P1-S2 Part 1 -- S1 CLOSEOUT, READ-ONLY (Supabase SQL Editor, Nemryn production wyocbivzgrbekuyqdfts). One SELECT.
-- =====================================================================================================================
-- Purpose: close the two open S1 checks without changing anything:
--   (a) the Pilot Simulation audit pair (trial start, then expired), and
--   (b) the final entitlement states of Nemryn Pilot Simulation and Zenward Mobility.
-- Reads only organization_modules, audit_events (entitlement actions only: statuses, timestamps, reasons -- no tenant
-- content) and organizations (names). No write, no function with side effects (_plus_entitlement_state is a stable
-- read of organization_modules).
--
-- HOW TO RUN: SQL Editor -> New query -> paste -> Run. Copy the result grid back (text or screenshot).
-- EXPECTED (as of 2026-10-13):
--   entitlement | Nemryn Pilot Simulation | expired | -        | effective read_only | trial 2026-10-13 16:18 -> 2026-10-27 16:18
--   entitlement | Zenward Mobility        | trial   | -        | effective write     | trial 2026-10-13 15:31 -> 2026-10-27 15:31
--                                                                 (read_only automatically after 2026-10-27 15:31 UTC)
--   audit       | Nemryn Pilot Simulation | before NULL  -> after trial    | "NP-P1-S1 production smoke (synthetic)"
--   audit       | Nemryn Pilot Simulation | before trial -> after expired  | "NP-P1-S1 production smoke complete"
--   audit       | Zenward Mobility        | before NULL  -> after trial    | "NP-P1-S1 production smoke"
--   totals      | 2 entitlement rows, 3 Plus audit events
-- Any other row, a missing Pilot audit pair, or different totals = report back; do NOT correct by SQL.
-- =====================================================================================================================
select kind, organization, before_status, after_status, restriction, effective_state, trial_started_at, trial_ends_at,
       trial_extension_count, reason, at
from (
  select 1 as ord, 'entitlement' as kind, o.name as organization, null::text as before_status, m.status as after_status,
         m.restriction, public._plus_entitlement_state(m.organization_id) as effective_state, m.trial_started_at,
         m.trial_ends_at, m.trial_extension_count, m.status_reason as reason, m.updated_at as at
  from public.organization_modules m join public.organizations o on o.id = m.organization_id
  union all
  select 2, 'audit', o.name, a.before_data ->> 'status', a.after_data ->> 'status', a.after_data ->> 'restriction', null,
         null, (a.after_data ->> 'trial_ends_at')::timestamptz, (a.after_data ->> 'trial_extension_count')::smallint,
         a.reason, a.occurred_at
  from public.audit_events a join public.organizations o on o.id = a.organization_id
  where a.action = 'platform_plus_access_changed'
  union all
  select 3, 'totals', 'entitlement rows: ' || (select count(*) from public.organization_modules), null,
         'plus audit events: ' || (select count(*) from public.audit_events where action = 'platform_plus_access_changed'),
         null, null, null, null, null, null, null
) r
order by ord, organization, at;
