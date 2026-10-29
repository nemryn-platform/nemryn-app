-- NP-FIN-P1 -- READ-ONLY production preflight (single SELECT; safe to run against production; changes nothing).
--   supabase db query --linked -f docs/reports/NP-FIN-P1-readonly-preflight.sql
-- Every row must read ok = true. ANY ok = false is a STOP (docs/reports/NP-FIN-P1-migration-preflight.txt).
-- G1 is the ZD-268 zero-row gate: billing_payments must be EMPTY; the migration re-asserts it inside its transaction.
with
mig as (select count(*) as n, max(version) as head from supabase_migrations.schema_migrations),
checks(id, check_name, ok, detail) as (
  select 'G1', 'billing_payments is empty (ZD-268 zero-row gate)',
         (select count(*) from public.billing_payments) = 0,
         (select count(*)::text from public.billing_payments) || ' rows'
  union all
  select 'G2', 'invoice state recorded (no allocation is created by the migration)',
         true,
         coalesce((select string_agg(status || ':' || n, ', ' order by status) from (select status, count(*) n from public.billing_invoices group by 1) s), 'no invoices')
  union all
  select 'G3', 'migration head is the expected base (no FIN-P1 objects yet)',
         (select head from mig) = '20261028100000' and (select n from mig) = 98,
         (select n::text || ' / ' || head from mig)
  union all
  select 'G4', 'no object with a FIN-P1 name exists yet',
         not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public'
                     and c.relname in ('billing_receipts', 'billing_receipt_counters', 'billing_allocations', 'billing_refunds',
                                       'billing_refund_reversals', 'billing_receipt_reversals', 'billing_assurance_events'))
         and not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
                     and p.proname in ('billing_record_receipt', 'billing_can', '_billing_authorize', 'billing_get_receipt'))
         and not exists (select 1 from pg_type t join pg_namespace s on s.oid = t.typnamespace where s.nspname = 'public'
                     and t.typname = 'billing_ledger_write_result'),
         'tables / functions / type absent'
  union all
  select 'G5', 'NP-BILL-P1 objects the migration replaces are present with their expected signatures',
         (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
            and p.oid in ('public.billing_record_payment(uuid,uuid,integer,bigint,date,text,text,text,text)'::regprocedure,
                          'public.billing_reverse_payment(uuid,uuid,integer,text,text)'::regprocedure,
                          'public.billing_summary(uuid)'::regprocedure,
                          'public._billing_paid_cents(uuid)'::regprocedure,
                          'public._billing_payments_guard()'::regprocedure)) = 5,
         'record / reverse payment, summary, paid cents, payments guard'
  union all
  select 'G6', 'no session is holding locks on billing tables right now',
         not exists (select 1 from pg_locks l join pg_class c on c.oid = l.relation
                     where c.relname like 'billing_%' and l.mode in ('AccessExclusiveLock', 'ExclusiveLock', 'ShareRowExclusiveLock')),
         'no exclusive locks on billing_*'
)
select id, check_name, ok, detail from checks
union all
select 'SUMMARY', format('violations = %s of %s', count(*) filter (where not ok), count(*)), bool_and(ok), null from checks
order by 1;
