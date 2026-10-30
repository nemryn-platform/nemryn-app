# Builds docs/reports/NP-FIN-P1G-emergency-reversal.sql: guarded, ONE transaction = remove the P1G gate + the verbatim
# body of docs/reports/NP-FIN-P1-emergency-reversal.sql (lines 18-317) + one history delete + postconditions.
import hashlib, sys
ROOT = "/Users/datamatics/Nemryn"
args = sys.argv[1:]
hold = args[args.index("--hold-after-guard") + 1] if "--hold-after-guard" in args else None
inject = "--inject-failure" in args
dest = args[args.index("--out") + 1] if "--out" in args else f"{ROOT}/docs/reports/NP-FIN-P1G-emergency-reversal.sql"
hold_sql = f"\n-- REHEARSAL ONLY: hold the locks after the guard\nselect pg_sleep({hold});\n" if hold else ""
inject_sql = "\n-- REHEARSAL ONLY: injected failure before COMMIT\ndo $inj$ begin raise exception 'REHEARSAL: injected rollback failure'; end $inj$;\n" if inject else ""
fin = open(f"{ROOT}/docs/reports/NP-FIN-P1-emergency-reversal.sql").read()
sha = hashlib.sha256(fin.encode()).hexdigest()
lines = fin.split("\n")
a = next(i for i, l in enumerate(lines) if l.startswith("-- 1. restore the NP-BILL-P1 definitions"))
b = next(i for i, l in enumerate(lines) if l.startswith("-- 4. the two migration versions"))
body = "\n".join(lines[a:b]).rstrip("\n")
out = f"""-- =====================================================================================================================
-- NP-FIN-P1G -- EMERGENCY ROLLBACK OF FIN-P1 + P1G TOGETHER (prepared, NOT executed). GENERATED -- do not edit by hand.
-- One transaction: removes the P1G gate, then restores NP-BILL-P1 exactly (the verbatim body of
-- docs/reports/NP-FIN-P1-emergency-reversal.sql sections 1-3, sha256 {sha}), then removes the three migration versions.
-- Result: the database is back at 20261028100000 = production before the FIN-P1 / P1G release.
--
-- THIS IS A RELEASE ROLLBACK, NOT AN INCIDENT CONTROL.
--   * To stop financial writes in an incident: DISABLE the organization (platform_set_billing_write_enablement).
--   * Removing the gate ALONE is not offered: it would restore billing-write access for every organization while
--     FIN-P1 stays. There is deliberately no gate-only script. (NP-FIN-P1-emergency-reversal.sql on its own fails
--     while the gate exists, because the gate's tables use _billing_ledger_append_only(); the whole transaction rolls
--     back.)
--
-- ORDER: structure check (schema only) -> ACCESS EXCLUSIVE locks on all 12 financial tables, both enablement tables and
-- the migration history -> ALL data / head checks -> drops. Checks run only under the locks (no time-of-check /
-- time-of-use gap); a write in flight when the rollback starts must finish first and is then seen by the checks.
-- SAFE CONDITIONS -- ALL required; the guard below checks 1-3 and rolls everything back otherwise:
--   1. The FIN-P1 ledger is EMPTY (no receipt, allocation, refund, refund / receipt reversal, assurance event).
--      After the first ledger row the policy is FORWARD-FIX ONLY.
--   2. No organization holds, or has ever held, a LIVE enablement record (current row or history).
--   3. billing_payments is empty (as asserted at release; NP-BILL-P1 must start from its released state).
--   4. Explicit owner authorization for this rollback (a production write).
--   5. The application is rolled back to the pre-release build (main before PR #44) in the same window: the FIN-P1 /
--      P1G builds need the ledger RPCs.
--   6. The owner accepts the end state: NP-BILL-P1 exactly as released before FIN-P1, i.e. invoice writes open to
--      every organization's Organization Admins with NO financial-write gate (production's state today).
--   Audit rows (platform_billing_write_enablement_changed) are kept: audit_events is never pruned.
-- HOW TO RUN (only after authorization) -- the rehearsed transport only:
--   psql "<direct or session-mode connection string, user postgres>" -X -v ON_ERROR_STOP=1 -f <this file>
-- (not `supabase db query -f`, which refuses multi-statement files; the SQL Editor path is not rehearsed).
-- Afterwards: privilege contract at origin/main's version (0 / 29) and origin/main's billing_tests.sql.
-- =====================================================================================================================
begin;
set local lock_timeout = '15s';

-- ------------------------------------------------------------------------------- 0. STRUCTURE (schema only, no data)
do $struct$
begin
  if to_regclass('public.billing_receipts') is null or to_regclass('public.billing_write_enablements') is null
     or to_regclass('public.billing_write_enablement_history') is null then
    raise exception 'NP-FIN-P1G rollback refused: FIN-P1 / P1G objects are not present';
  end if;
end
$struct$;

-- ------------------------------------------------------------------------------------------ 1. LOCKS (before checks)
-- ACCESS EXCLUSIVE, taken ONCE, before any check: every concurrent financial write, enablement change, migration-history
-- write AND read of these tables waits until this transaction ends (seconds). A write in flight now must finish first
-- (lock_timeout -> fail closed), so the checks below see every committed row and nothing can commit between the
-- checks and COMMIT. ACCESS EXCLUSIVE (not EXCLUSIVE) because the drops below need it: taking it up front means no
-- lock upgrade later, which under concurrent load deadlocked (rehearsal S2 with EXCLUSIVE).
-- If a deadlock or lock timeout still occurs at acquisition, the rollback aborts with nothing changed: retry it.
lock table public.billing_invoice_counters, public.billing_invoices, public.billing_invoice_trips, public.billing_invoice_lines,
           public.billing_payments, public.billing_receipt_counters, public.billing_receipts, public.billing_allocations,
           public.billing_refunds, public.billing_refund_reversals, public.billing_receipt_reversals,
           public.billing_assurance_events, public.billing_write_enablements, public.billing_write_enablement_history,
           supabase_migrations.schema_migrations in access exclusive mode;

-- ----------------------------------------------------------------------------------------- 2. GUARD (under the locks)
do $guard$
begin
  if exists (select 1 from public.billing_receipts) or exists (select 1 from public.billing_allocations)
     or exists (select 1 from public.billing_refunds) or exists (select 1 from public.billing_refund_reversals)
     or exists (select 1 from public.billing_receipt_reversals) or exists (select 1 from public.billing_assurance_events) then
    raise exception 'NP-FIN-P1G rollback refused: the FIN-P1 ledger holds rows -- forward-fix only';
  end if;
  if exists (select 1 from public.billing_write_enablements where data_class = 'live')
     or exists (select 1 from public.billing_write_enablement_history where data_class = 'live') then
    raise exception 'NP-FIN-P1G rollback refused: an organization has (or had) a LIVE enablement record -- owner decision first';
  end if;
  if exists (select 1 from public.billing_payments) then
    raise exception 'NP-FIN-P1G rollback refused: billing_payments is not empty';
  end if;
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '20261029120000' then
    raise exception 'NP-FIN-P1G rollback refused: migration head is not 20261029120000';
  end if;
end
$guard$;
{hold_sql}-- ------------------------------------------------------------------------------------------- P1G: remove the gate
do $$
declare
  t text;
begin
  foreach t in array array['billing_invoice_counters', 'billing_invoices', 'billing_invoice_trips', 'billing_invoice_lines',
                            'billing_payments', 'billing_receipt_counters', 'billing_receipts', 'billing_allocations',
                            'billing_refunds', 'billing_refund_reversals', 'billing_receipt_reversals', 'billing_assurance_events'] loop
    execute format('drop trigger a_billing_write_gate on public.%I', t);
  end loop;
end;
$$;
drop function public.billing_write_status(uuid);
drop function public.platform_get_billing_write_enablement(uuid);
drop function public.platform_set_billing_write_enablement(uuid, text, text, text, text, integer);
drop type public.billing_write_enablement_result;
drop function public._billing_write_gate();
drop function public._billing_require_write_enabled(uuid);
drop function public._billing_write_enabled(uuid);
drop table public.billing_write_enablement_history;
drop table public.billing_write_enablements;
drop function public._billing_write_enablement_guard();

-- ------------------------------------------------- FIN-P1: verbatim NP-FIN-P1-emergency-reversal.sql sections 1-3
{body}

-- --------------------------------------------------------------------------------------------- migration history
delete from supabase_migrations.schema_migrations where version in ('20261029100000', '20261029110000', '20261029120000');

-- ---------------------------------------------------------------------------------------------------- POSTCONDITIONS
do $post$
begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '20261028100000' then
    raise exception 'NP-FIN-P1G rollback postcondition failed: head is not 20261028100000';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'a_billing_write_gate')
     or to_regclass('public.billing_receipts') is not null or to_regclass('public.billing_write_enablements') is not null
     or to_regprocedure('public.billing_can(uuid,text)') is not null then
    raise exception 'NP-FIN-P1G rollback postcondition failed: a FIN-P1 / P1G object remains';
  end if;
end
$post$;
{inject_sql}
commit;
"""
open(dest, "w").write(out)
print("ok", sha[:12], b - a, "body lines")
