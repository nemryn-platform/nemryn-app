#!/usr/bin/env python3
"""P1-SEC-01R -- prove privilege_contract_tests.sql DETECTS each kind of future drift.

For every mutation: BEGIN; <mutation>; <contract query>; ROLLBACK against the local stack, then assert that the
expected contract checks fail. Nothing persists. Usage:  python3 supabase/tests/support/prove_contract_detects_drift.py
"""
import re, subprocess, sys, pathlib
root = pathlib.Path(__file__).resolve().parents[3]
contract = (root / "supabase/tests/privilege_contract_tests.sql").read_text()

MUTATIONS = [
  ("anon grant on a NEW table",                          "create table public.zz_m1(id int); grant select on public.zz_m1 to anon;", {"01", "05"}),
  ("broad authenticated DELETE on an existing table",    "grant delete on public.trips to authenticated;", {"07", "08"}),
  ("authenticated INSERT on drivers (identity)",         "grant insert on public.drivers to authenticated;", {"08", "25"}),
  ("service_role grant on a tenant table",               "grant select on public.trips to service_role;", {"11"}),
  ("service_role loses its required intake table read",  "revoke select on public.request_intake_integrations from service_role;", {"11"}),
  ("PUBLIC EXECUTE on a NEW function",                   "create function public.zz_m4() returns int language sql as $$ select 1 $$; grant execute on function public.zz_m4() to public;", {"13", "15"}),
  ("NEW function created with NO contract entry",        "create function public.zz_m4b() returns int language sql as $$ select 1 $$;", {"13"}),
  ("anon EXECUTE on a product RPC",                      "grant execute on function public.assign_trip(uuid, uuid, uuid) to anon;", {"16"}),
  ("service_role EXECUTE on a product RPC",              "grant execute on function public.assign_trip(uuid, uuid, uuid) to service_role;", {"18"}),
  ("authenticated loses a product RPC",                  "revoke execute on function public.assign_trip(uuid, uuid, uuid) from authenticated;", {"17"}),
  ("NEW table without RLS",                              "create table public.zz_m9(id int);", {"01", "03"}),
  ("default privileges drift: anon on future tables",    "alter default privileges for role postgres in schema public grant select on tables to anon;", {"22"}),
  ("default privileges drift: service_role on tables",   "alter default privileges for role postgres in schema public grant all on tables to service_role;", {"22"}),
  ("default privileges drift: authenticated on funcs",   "alter default privileges for role postgres in schema public grant execute on functions to authenticated;", {"22"}),
  ("global PUBLIC function default restored",            "alter default privileges for role postgres grant execute on functions to public;", {"23"}),
  ("sequence grant to anon",                             "grant usage on sequence public.public_intake_rate_limit_events_id_seq to anon;", {"12"}),
  ("anon column privilege",                              "grant select (id) on public.trips to anon;", {"06"}),
  ("DELETE policy added",                                "create policy zz_m_delete on public.vehicles for delete to authenticated using (true);", {"21"}),
  ("policy for anon",                                    "create policy zz_m_anon on public.vehicles for select to anon using (true);", {"20"}),
  ("SECURITY DEFINER without search_path",               "create function public.zz_m_def() returns int language sql security definer as $$ select 1 $$;", {"13", "19"}),
]

def run(mutation):
    sql = "begin;\n" + mutation + "\n" + contract + "\nrollback;\n"
    out = subprocess.run(["docker", "exec", "-i", "supabase_db_ZenWard", "psql", "-U", "postgres", "-d", "postgres", "-tA", "-F", "|", "-f", "-"], input=sql, capture_output=True, text=True).stdout
    failed = set()
    for line in out.splitlines():
        m = re.match(r"^(\d\d) .*\|f\|", line)
        if m: failed.add(m.group(1))
    return failed

bad = 0
base = run("select 1;")
print("baseline (no mutation) failing checks:", sorted(base) or "none")
if base: bad += 1
for name, mutation, expected in MUTATIONS:
    failed = run(mutation)
    ok = expected <= failed
    if not ok: bad += 1
    print(("DETECTED " if ok else "MISSED   ") + name.ljust(52) + " expected " + ",".join(sorted(expected)) + " -> failing: " + ",".join(sorted(failed)))
print("RESULT:", "all drift kinds detected" if bad == 0 else f"{bad} problem(s)")
sys.exit(1 if bad else 0)
