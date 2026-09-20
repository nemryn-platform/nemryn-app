#!/bin/bash
# Nemryn Platform -- genuine concurrent website-integration management test
# (P1-PILOT-S4B-R4B, work item §26). Real parallel psql processes, each its
# own transaction, each holding its transaction open ~1.5s (pg_sleep) so the
# transactions genuinely overlap.
#
# Scenario 1: N simultaneous "Create integration" calls for the SAME
#   organization + SAME origin (double-click / two tabs / retry).
#   Pass: exactly ONE row, exactly ONE website_integration_created AuditEvent,
#   exactly one session reports changed=true, the rest changed=false and all
#   return the SAME Integration ID, zero errors.
# Scenario 2: N simultaneous creates of N DIFFERENT origins for one
#   organization -- multiple integrations are legitimate and must not be
#   collapsed or fail. Pass: N rows, N distinct Integration IDs, zero errors.
# Scenario 3: simultaneous origin edit vs create of the SAME target origin
#   (the duplicate-origin invariant under an edit/create race).
#   Pass: never two integrations for that (org, origin).
#
# Uses seed Org A (admin 20000000-...-a1). Cleans up its own rows.
#
# Run with:
#   bash supabase/tests/website_integration_concurrency_test.sh

set -euo pipefail

PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1"
ORG=10000000-0000-0000-0000-0000000000a1
ADMIN=20000000-0000-0000-0000-0000000000a1
STAMP=$(date +%s)
N=6
OUT=$(mktemp -d)
FAIL=0
SAME="https://race-same-$STAMP.example.test"

run_session() { # $1 = out file prefix, $2 = SQL call
  $PSQL > "$1.out" 2> "$1.err" <<SQL || echo "ERR" >> "$1.err"
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$ADMIN';
$2
reset role;
select pg_sleep(1.5);
commit;
SQL
}

echo "=== Scenario 1: $N simultaneous creates, SAME org + SAME origin ==="
for i in $(seq 1 $N); do
  run_session "$OUT/s1-$i" "select (r).external_id || '|' || (r).changed from (select public.create_request_intake_integration('$ORG', '$SAME') as r) x;" &
done
wait
ROWS=$($PSQL -c "select count(*) from public.request_intake_integrations where organization_id='$ORG' and allowed_origins = array['$SAME']")
AUDITS=$($PSQL -c "select count(*) from public.audit_events a join public.request_intake_integrations i on i.id=a.entity_id where a.action='website_integration_created' and i.allowed_origins = array['$SAME']")
IDS=$(cat "$OUT"/s1-*.out | grep '|' | cut -d'|' -f1 | sort -u | wc -l | tr -d ' ')
CH_T=$(cat "$OUT"/s1-*.out | grep -c '|true$' || true)
CH_F=$(cat "$OUT"/s1-*.out | grep -c '|false$' || true)
ERR=$(cat "$OUT"/s1-*.err | grep -c . || true)
echo "rows:$ROWS audits:$AUDITS distinct_ids:$IDS changed=true:$CH_T changed=false:$CH_F errors:$ERR"
if [ "$ROWS" = 1 ] && [ "$AUDITS" = 1 ] && [ "$IDS" = 1 ] && [ "$CH_T" = 1 ] && [ "$CH_F" = "$((N-1))" ] && [ "$ERR" = 0 ]; then
  echo "TEST CONC-INT-1 (parallel identical create -> exactly one integration, one audit, one shared Integration ID): PASS"
else
  echo "TEST CONC-INT-1 (parallel identical create -> exactly one integration, one audit, one shared Integration ID): FAIL"; FAIL=1
fi

echo "=== Scenario 2: 4 simultaneous creates, 4 DIFFERENT origins ==="
for i in 1 2 3 4; do
  run_session "$OUT/s2-$i" "select (r).external_id from (select public.create_request_intake_integration('$ORG', 'https://race-diff-$i-$STAMP.example.test') as r) x;" &
done
wait
ROWS2=$($PSQL -c "select count(*) from public.request_intake_integrations where allowed_origins[1] like 'https://race-diff-%-$STAMP.example.test'")
IDS2=$(cat "$OUT"/s2-*.out | grep -c '^web_' || true)
ERR2=$(cat "$OUT"/s2-*.err | grep -c . || true)
echo "rows:$ROWS2 ids:$IDS2 errors:$ERR2"
if [ "$ROWS2" = 4 ] && [ "$IDS2" = 4 ] && [ "$ERR2" = 0 ]; then
  echo "TEST CONC-INT-2 (parallel creates of distinct origins all succeed; multiple integrations per org): PASS"
else
  echo "TEST CONC-INT-2 (parallel creates of distinct origins all succeed; multiple integrations per org): FAIL"; FAIL=1
fi

echo "=== Scenario 3: origin EDIT racing a CREATE for the same target origin ==="
TARGET="https://race-target-$STAMP.example.test"
EDIT_ID=$($PSQL -c "select id from public.request_intake_integrations where allowed_origins[1] = 'https://race-diff-1-$STAMP.example.test'")
run_session "$OUT/s3-a" "select (r).changed from (select public.update_request_intake_integration_origin('$EDIT_ID', '$TARGET') as r) x;" &
run_session "$OUT/s3-b" "select (r).changed from (select public.create_request_intake_integration('$ORG', '$TARGET') as r) x;" &
wait
ROWS3=$($PSQL -c "select count(*) from public.request_intake_integrations where organization_id='$ORG' and allowed_origins = array['$TARGET']")
echo "rows for target origin:$ROWS3 (errors: $(cat "$OUT"/s3-*.err | grep -c . || true) -- a ZW006 from the losing edit is the correct outcome)"
if [ "$ROWS3" = 1 ]; then
  echo "TEST CONC-INT-3 (edit vs create race never yields two integrations for one origin): PASS"
else
  echo "TEST CONC-INT-3 (edit vs create race never yields two integrations for one origin): FAIL"; FAIL=1
fi

# cleanup
$PSQL <<SQL >/dev/null
delete from public.audit_events where entity_id in (select id from public.request_intake_integrations where allowed_origins[1] like 'https://race-%-$STAMP.example.test' or allowed_origins[1] = 'https://race-same-$STAMP.example.test');
delete from public.request_intake_integrations where allowed_origins[1] like 'https://race-%-$STAMP.example.test' or allowed_origins[1] = 'https://race-same-$STAMP.example.test';
SQL
rm -rf "$OUT"
exit $FAIL
