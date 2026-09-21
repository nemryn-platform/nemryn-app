#!/usr/bin/env bash
# Nemryn database privilege contract check (P1-SEC-01). READ-ONLY (a single SELECT).
#
#   scripts/verify-db-privileges.sh local        # the local Supabase stack
#   scripts/verify-db-privileges.sh production   # the linked production project (Supabase CLI login required)
#
# Prints every check as (check_name | ok | detail) and exits 1 if any check is violated.
# Run it against production before and after every release that adds a table/function/migration:
# LOCAL EXPECTED == PRODUCTION EXPECTED for every security-sensitive privilege.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="supabase/tests/privilege_contract_tests.sql"
TARGET="${1:-}"

case "$TARGET" in
  local)      OUT="$(supabase db query --local  -f "$FILE" -o json 2>/dev/null || true)" ;;
  production) OUT="$(supabase db query --linked -f "$FILE" -o json 2>/dev/null || true)" ;;
  *) echo "usage: $0 local|production" >&2; exit 2 ;;
esac

if [ -z "$OUT" ]; then echo "no result from '$TARGET' (is the target reachable / are you logged in?)" >&2; exit 2; fi

# Accept either a bare row array or {"rows":[...]} shapes.
echo "$OUT" | python3 -c '
import json, sys
d = json.load(sys.stdin)
rows = d if isinstance(d, list) else d.get("rows", d.get("result", []))
bad = 0
for r in sorted(rows, key=lambda r: r["check_name"]):
    ok = r["ok"] in (True, "t", "true")
    if not ok: bad += 1
    print(("ok   " if ok else "FAIL ") + r["check_name"] + ("" if ok or not r.get("detail") else "  ->  " + str(r["detail"])[:300]))
sys.exit(1 if any((r["ok"] not in (True, "t", "true")) for r in rows) else 0)
'
