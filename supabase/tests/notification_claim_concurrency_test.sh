#!/bin/bash
# Nemryn Platform -- genuine concurrent notification-claim test
# (P1-PILOT-S4B-R4D). Real parallel psql processes, each its own transaction.
#
# The real race: notifications are dispatched from server processes that can run
# concurrently (two serverless invocations, a retry after a slow response). The
# dispatch boundary must make sending EXACTLY-ONCE: N sessions call
# claim_notification_dispatch for the SAME event while each holds its transaction
# open ~1.5s; exactly ONE receives the payload, the others get NULL, and the event
# row shows a single dispatch attempt. A second scenario races N concurrent
# report_trip_exception calls for DISTINCT exceptions (distinct events, none lost,
# none duplicated).
#
# Run with:  bash supabase/tests/notification_claim_concurrency_test.sh
set -euo pipefail
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1"
OUT=$(mktemp -d); FAIL=0; N=8
ADMIN=20000000-0000-0000-0000-0000000000a1
TRIP=80000000-0000-0000-0000-0000000000a3

EVENT=$($PSQL <<SQL | grep -E '^[0-9a-f-]{36}$' | head -1
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$ADMIN';
select (public.report_trip_exception('$TRIP', null, null)).notification_event_id;
commit;
SQL
)
echo "event created: ${EVENT:0:8}..."

echo "=== Scenario 1: $N simultaneous claims of ONE event ==="
for i in $(seq 1 $N); do
  ( $PSQL > "$OUT/c-$i.out" 2> "$OUT/c-$i.err" <<SQL || echo ERR >> "$OUT/c-$i.err"
begin;
set local role service_role;
select case when public.claim_notification_dispatch('$EVENT') is null then 'NULL' else 'PAYLOAD' end;
reset role;
select pg_sleep(1.5);
commit;
SQL
  ) &
done
wait
WON=$(cat "$OUT"/c-*.out | grep -c '^PAYLOAD$' || true)
LOST=$(cat "$OUT"/c-*.out | grep -c '^NULL$' || true)
ERRS=$(cat "$OUT"/c-*.err | grep -c . || true)
STATUS=$($PSQL -c "select status from public.notification_events where id = '$EVENT'")
echo "payload:$WON null:$LOST errors:$ERRS status:$STATUS"
if [ "$WON" = 1 ] && [ "$LOST" = "$((N-1))" ] && [ "$ERRS" = 0 ] && [ "$STATUS" = dispatching ]; then
  echo "TEST CONC-NOTIFY-1 (parallel claims of one event: exactly one wins the payload, the rest get NULL): PASS"
else
  echo "TEST CONC-NOTIFY-1 (parallel claims of one event: exactly one wins the payload, the rest get NULL): FAIL"; FAIL=1
fi

echo "=== Scenario 2: $N simultaneous exceptions -> $N distinct events ==="
BEFORE=$($PSQL -c "select count(*) from public.notification_events where event_type='trip_exception'")
for i in $(seq 1 $N); do
  ( $PSQL > "$OUT/e-$i.out" 2> "$OUT/e-$i.err" <<SQL || echo ERR >> "$OUT/e-$i.err"
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$ADMIN';
select (public.report_trip_exception('$TRIP', null, null)).notification_event_id;
reset role;
select pg_sleep(1);
commit;
SQL
  ) &
done
wait
AFTER=$($PSQL -c "select count(*) from public.notification_events where event_type='trip_exception'")
IDS=$(cat "$OUT"/e-*.out | grep -cE '^[0-9a-f-]{36}$' || true)
DISTINCT=$(cat "$OUT"/e-*.out | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l | tr -d ' ')
ERRS2=$(cat "$OUT"/e-*.err | grep -c . || true)
echo "new events:$((AFTER-BEFORE)) ids:$IDS distinct:$DISTINCT errors:$ERRS2"
if [ "$((AFTER-BEFORE))" = "$N" ] && [ "$IDS" = "$N" ] && [ "$DISTINCT" = "$N" ] && [ "$ERRS2" = 0 ]; then
  echo "TEST CONC-NOTIFY-2 (parallel exceptions: one distinct durable event each, none lost, none duplicated): PASS"
else
  echo "TEST CONC-NOTIFY-2 (parallel exceptions: one distinct durable event each, none lost, none duplicated): FAIL"; FAIL=1
fi

# cleanup
$PSQL <<SQL >/dev/null
delete from public.notification_events where event_type = 'trip_exception';
delete from public.trip_events where trip_id = '$TRIP' and event_type = 'exception_flagged';
delete from public.trip_exceptions where trip_id = '$TRIP';
SQL
rm -rf "$OUT"
exit $FAIL
