-- NP-P2-S5-S2 -- OD-Q12 (ZD-221) release verification. READ-ONLY: one SELECT, no writes.
-- Run BEFORE applying 20261019100000_plus_quotes_single_active.sql (and again after it):
--   supabase db query --linked -f docs/reports/NP-P2-S5-S2-od-q12-duplicate-check.sql -o json
-- Expected before AND after: zero rows with violation = true (the migration refuses to run otherwise; it never repairs
-- data). Returns one summary row plus one row per offending (organization, opportunity, status), ids only (no prices,
-- no names, no free text).
with offenders as (
  select organization_id, opportunity_id, status, count(*) as live_rows
  from public.plus_quotes
  where status in ('draft', 'sent')
  group by organization_id, opportunity_id, status
  having count(*) > 1
)
select 'summary' as kind,
       null::uuid as organization_id,
       null::uuid as opportunity_id,
       null::text as status,
       (select count(*) from offenders)::bigint as live_rows,
       (select count(*) from offenders) > 0 as violation,
       (select count(*) from public.plus_quotes)::bigint as total_quotes,
       (select count(*) from public.plus_quotes where status = 'draft')::bigint as drafts,
       (select count(*) from public.plus_quotes where status = 'sent')::bigint as sent
union all
select 'offender', organization_id, opportunity_id, status, live_rows, true, null, null, null
from offenders;
