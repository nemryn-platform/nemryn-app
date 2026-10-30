# Builds docs/reports/NP-FIN-P1G-atomic-release-package.sql: M1 + M2 + M3 byte-identical, their CLI history rows,
# preconditions, write locks, postconditions -- one transaction. Usage: python3 build_package.py [--inject-m3-failure|--hold-before-commit N]
import subprocess, sys, hashlib
ROOT = "/Users/datamatics/Nemryn"
M = [("20261029100000", "core_billing_ledger_foundation"), ("20261029110000", "core_billing_ledger_rpcs"), ("20261029120000", "core_billing_write_gate")]
def hist(version):
    q = f"select format('insert into supabase_migrations.schema_migrations (version, name, statements) values (%L, %L, %L::text[]);', version, name, statements::text) from supabase_migrations.schema_migrations where version = '{version}'"
    out = subprocess.run(["docker", "exec", "supabase_db_NemrynS1Iso", "psql", "-U", "postgres", "-d", "postgres", "-Atc", q], capture_output=True, text=True, check=True).stdout
    assert out.startswith("insert into"), version
    return out.rstrip("\n")
def count(version):
    return subprocess.run(["docker", "exec", "supabase_db_NemrynS1Iso", "psql", "-U", "postgres", "-d", "postgres", "-Atc",
        f"select array_length(statements, 1) from supabase_migrations.schema_migrations where version = '{version}'"], capture_output=True, text=True, check=True).stdout.strip()
args = sys.argv[1:]
inject = "--inject-m3-failure" in args
hold = args[args.index("--hold-before-commit") + 1] if "--hold-before-commit" in args else None
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in args else f"{ROOT}/docs/reports/NP-FIN-P1G-atomic-release-package.sql"
bodies = [open(f"{ROOT}/supabase/migrations/{v}_{n}.sql").read() for v, n in M]
counts = [count(v) for v, _ in M]
sha = [hashlib.sha256(b.encode()).hexdigest() for b in bodies]
P = []
P.append(f"""-- =====================================================================================================================
-- NP-FIN-P1G -- ATOMIC RELEASE PACKAGE (ZD-285): NP-FIN-P1 M1 + M2 and NP-FIN-P1G M3 in ONE transaction.
-- GENERATED -- do not edit by hand. Bodies are byte-identical to:
--   M1 supabase/migrations/20261029100000_core_billing_ledger_foundation.sql  sha256 {sha[0]}
--   M2 supabase/migrations/20261029110000_core_billing_ledger_rpcs.sql        sha256 {sha[1]}
--   M3 supabase/migrations/20261029120000_core_billing_write_gate.sql         sha256 {sha[2]}
-- History rows: exactly what `supabase db push` (CLI 2.109.0) records for these files (version, name and the CLI's
-- split statements: {counts[0]} / {counts[1]} / {counts[2]}), copied from the CLI-applied rows on the isolated stack.
-- =====================================================================================================================
-- DO NOT RUN against production without the owner's explicit authorization of the FIN-P1 / P1G migration window.
-- Rehearsed on the isolated stack only: docs/reports/NP-FIN-P1G-atomic-release-rehearsal.txt.
--
-- SAFETY DESIGN
--   * BEGIN ... COMMIT around everything. Any failure -- precondition, lock timeout, the zero-row gate, any migration
--     statement, a history insert, a postcondition -- aborts the transaction: schema AND history stay at 20261028100000.
--   * Other sessions never see an intermediate state: until COMMIT they see BILL-P1; after COMMIT they see FIN-P1 with
--     the gate and NO organization enabled. There is no interval with ungated ledger writes.
--   * WRITE LOCKS before M1: EXCLUSIVE locks on the five NP-BILL-P1 tables block every concurrent billing WRITE (reads
--     continue) until COMMIT. Without them a payment could commit AFTER M1's zero-row check and before billing_payments
--     is retired later in M1 (the check itself takes no write-blocking lock). Blocked writes resume after COMMIT and
--     are refused by the gate (ZW004 billing_not_enabled). lock_timeout makes the package fail closed instead of
--     queueing behind a long transaction.
--   * The FIN-P1 zero-row gate (M1 section 0) is kept unchanged and is re-asserted as a postcondition.
--   * PRECONDITIONS: current_user postgres; the target is Nemryn production (synthetic "Nemryn Pilot Simulation"
--     organization present) or the isolated fictional seed; the history table shape; head = 20261028100000 and none of
--     the three versions recorded; no FIN-P1 / P1G object exists.
--   * POSTCONDITIONS: head 20261029120000 with exactly the three rows; billing_payments and every ledger / enablement
--     table empty (no organization enabled); 12 gate triggers; no client privilege on the enablement tables; anon cannot
--     execute the new RPCs.
-- HOW TO RUN (only after authorization) -- the ONLY rehearsed transport:
--   psql "<direct or session-mode connection string, user postgres>" -X -v ON_ERROR_STOP=1 -f <this file>
-- NOT `supabase db query -f`: it sends the file as a prepared statement and Postgres refuses multi-statement SQL
-- (rehearsal R1b: refused, nothing changed). The SQL Editor / Management API path was not rehearsed -- do not use it.
-- Then run the post-release checks in NP-FIN-P1G-atomic-release-rehearsal.txt §5.
-- =====================================================================================================================

begin;
set local lock_timeout = '15s';
set local statement_timeout = '10min';

-- ---------------------------------------------------------------------------------------------------- PRECONDITIONS
do $pre$
declare
  v_cols text;
  v_head text;
begin
  if current_user <> 'postgres' then
    raise exception 'NP-FIN-P1G package precondition failed: run as postgres (current_user = %)', current_user;
  end if;
  if not exists (select 1 from public.organizations where id = '25e3a19b-c8b5-45d2-943e-f20baf697cc5' and name = 'Nemryn Pilot Simulation')
     and not (exists (select 1 from public.organizations where id = '10000000-0000-0000-0000-0000000000a1' and name = 'Fictional Org A')
              and exists (select 1 from public.organizations where id = '10000000-0000-0000-0000-0000000000b1' and name = 'Fictional Org B')) then
    raise exception 'NP-FIN-P1G package precondition failed: not Nemryn production and not the isolated fictional seed';
  end if;
  select string_agg(column_name || ':' || data_type, ',' order by column_name) into v_cols
  from information_schema.columns where table_schema = 'supabase_migrations' and table_name = 'schema_migrations';
  if v_cols is distinct from 'name:text,statements:ARRAY,version:text' then
    raise exception 'NP-FIN-P1G package precondition failed: unexpected migration-history columns (%)', v_cols;
  end if;
  select max(version) into v_head from supabase_migrations.schema_migrations;
  if v_head is distinct from '20261028100000' then
    raise exception 'NP-FIN-P1G package precondition failed: migration head is % (expected 20261028100000)', v_head;
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version in ('20261029100000', '20261029110000', '20261029120000')) then
    raise exception 'NP-FIN-P1G package precondition failed: a FIN-P1 / P1G version is already recorded';
  end if;
  if to_regclass('public.billing_receipts') is not null or to_regclass('public.billing_write_enablements') is not null
     or to_regprocedure('public.billing_can(uuid,text)') is not null then
    raise exception 'NP-FIN-P1G package precondition failed: a FIN-P1 / P1G object already exists';
  end if;
end
$pre$;

-- ------------------------------------------------------------------------------------------------------ WRITE LOCKS
lock table public.billing_invoice_counters, public.billing_invoices, public.billing_invoice_trips,
           public.billing_invoice_lines, public.billing_payments in exclusive mode;
""")
for i, ((v, n), body) in enumerate(zip(M, bodies)):
    P.append(f"\n-- ================================================================== M{i+1} {v}_{n}.sql (byte-identical)\n")
    if inject and i == 2:
        P.append(body)
        P.append("\n-- REHEARSAL ONLY: injected failure at the end of M3\ndo $inj$ begin raise exception 'REHEARSAL: injected M3 failure'; end $inj$;\n")
    else:
        P.append(body)
    P.append(f"\n-- history row M{i+1}\n{hist(v)}\n")
P.append(f"""
-- --------------------------------------------------------------------------------------------------- POSTCONDITIONS
do $post$
declare
  t text;
  v integer;
begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '20261029120000'
     or (select count(*) from supabase_migrations.schema_migrations
         where (version, name, array_length(statements, 1)) in (('20261029100000', 'core_billing_ledger_foundation', {counts[0]}),
                                                                ('20261029110000', 'core_billing_ledger_rpcs', {counts[1]}),
                                                                ('20261029120000', 'core_billing_write_gate', {counts[2]}))) <> 3 then
    raise exception 'NP-FIN-P1G package postcondition failed: migration history is not exactly M1 + M2 + M3 at head 20261029120000';
  end if;
  if exists (select 1 from public.billing_payments) then
    raise exception 'NP-FIN-P1G package postcondition failed: billing_payments is not empty (ZD-268)';
  end if;
  foreach t in array array['billing_receipts', 'billing_receipt_counters', 'billing_allocations', 'billing_refunds', 'billing_refund_reversals',
                            'billing_receipt_reversals', 'billing_assurance_events', 'billing_write_enablements', 'billing_write_enablement_history'] loop
    v := null;
    execute format('select 1 from public.%I limit 1', t) into v;   -- EXECUTE does not set FOUND
    if v is not null then
      raise exception 'NP-FIN-P1G package postcondition failed: % is not empty', t;
    end if;
  end loop;
  if (select count(*) from pg_trigger where tgname = 'a_billing_write_gate' and not tgisinternal) <> 12 then
    raise exception 'NP-FIN-P1G package postcondition failed: expected 12 gate triggers';
  end if;
  if has_table_privilege('authenticated', 'public.billing_write_enablements', 'select')
     or has_table_privilege('authenticated', 'public.billing_write_enablement_history', 'select')
     or has_table_privilege('anon', 'public.billing_write_enablements', 'select') then
    raise exception 'NP-FIN-P1G package postcondition failed: a client role can read the enablement tables';
  end if;
  if has_function_privilege('anon', 'public.platform_set_billing_write_enablement(uuid,text,text,text,text,integer)', 'execute')
     or has_function_privilege('anon', 'public.platform_get_billing_write_enablement(uuid)', 'execute')
     or has_function_privilege('anon', 'public.billing_write_status(uuid)', 'execute')
     or has_function_privilege('anon', 'public.billing_record_receipt(uuid,uuid,text,uuid,text,bigint,bigint,date,text,text,text,text,boolean,jsonb,text,boolean,text)', 'execute') then
    raise exception 'NP-FIN-P1G package postcondition failed: anon can execute a new billing RPC';
  end if;
end
$post$;
""")
if hold:
    P.append(f"\n-- REHEARSAL ONLY: hold the transaction open before COMMIT\nselect pg_sleep({hold});\n")
P.append("\ncommit;\n")
open(out, "w").write("".join(P))
print(out, counts, [s[:12] for s in sha])
