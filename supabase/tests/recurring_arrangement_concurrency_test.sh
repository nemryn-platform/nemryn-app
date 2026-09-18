#!/bin/bash
# Zenward Platform — genuine concurrent-mutation tests for the P1-E2-S1D
# Recurring Arrangement lifecycle + occurrence exception RPCs.
#
# Same technique as supabase/tests/mutation_concurrency_test.sh: two
# SEPARATE psql connections (two OS processes) against the SAME row at
# overlapping wall-clock times, proving genuine row-level serialization by
# timing, not just by inspecting the final state. Session A always opens
# an explicit transaction, locks the target row (FOR UPDATE), holds it for
# ~2 seconds, THEN calls its own RPC (which re-acquires the same
# already-held lock, safe, same session) and commits. Session B, launched
# ~0.3s later while A is still sleeping, calls its own RPC directly. Since
# A always acquires the lock first, A deterministically "wins" the write
# ordering — exactly like mutation_concurrency_test.sh's own assign_trip
# race — what this actually proves is that B GENUINELY BLOCKS (real lock
# contention, not a lucky non-overlapping interleaving) and, once
# unblocked, correctly observes A's already-committed state rather than a
# stale read or a corrupted mixed row.
#
# Scenario A: simultaneous pause vs end of the same ACTIVE arrangement.
#   A pauses (wins the lock first) -> B's end() then legally transitions
#   paused -> ended, RETAINING the paused_at A just set. Exactly one
#   'recurring_arrangement_paused' and one 'recurring_arrangement_ended'
#   audit event — no duplicate, no impossible mixed row shape.
#
# Scenario B: simultaneous duplicate skip of the same arrangement/date.
#   A's skip commits first -> B's skip (SAME date, SAME arrangement) then
#   observes A's already-committed exception row under the identical
#   arrangement-row lock skip_recurring_occurrence itself takes, and
#   correctly takes the idempotent no-op path — B's own (different)
#   reason text is discarded, never overwriting A's. Exactly ONE
#   recurring_occurrence_exceptions row and exactly ONE
#   'recurring_occurrence_skipped' audit event result, never two.
#
# Scenario C: simultaneous resume vs end from PAUSED.
#   A resumes (wins the lock first, paused_at cleared to NULL) -> B's
#   end() then legally transitions active -> ended, leaving paused_at
#   NULL (never touched, matching the locked "ending from active leaves
#   paused_at NULL" rule). Exactly one 'recurring_arrangement_resumed' and
#   one 'recurring_arrangement_ended' audit event.
#
# Run with:
#   bash supabase/tests/recurring_arrangement_concurrency_test.sh

set -euo pipefail

ORG='10000000-0000-0000-0000-0000000000a1'
PASSENGER='40000000-0000-0000-0000-0000000000a1'
ADMIN='20000000-0000-0000-0000-0000000000a1'
DISPATCHER='20000000-0000-0000-0000-0000000000a2'

FAIL_COUNT=0

# =============================================================================
# Scenario A: pause vs end, from active
# =============================================================================
ARR_A='c1000000-0000-0000-0000-0000000000a1'
echo "=== Scenario A fixture: fresh ACTIVE arrangement $ARR_A ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from public.audit_events where entity_id = '$ARR_A';
delete from public.recurring_arrangements where id = '$ARR_A';
insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
values ('$ARR_A', '$ORG', '$PASSENGER', 'Concurrency A', 'Concurrency A', '08:00', array[1,2,3,4,5,6,7]::smallint[], '2026-01-01', 'America/New_York', 'active');
SQL

echo "=== Scenario A: Session A holds the row lock ~2s, then pauses ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/rec_conc_a_session_a.log 2>&1 <<SQL &
BEGIN;
SELECT id FROM public.recurring_arrangements WHERE id = '$ARR_A' FOR UPDATE;
SELECT pg_sleep(2);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '$ADMIN';
SELECT pause_recurring_arrangement('$ORG', '$ARR_A');
COMMIT;
SQL
PID_A=$!

sleep 0.3
echo "=== Scenario A: Session B (should block, then end() from the now-paused row) ==="
START_B=$(date +%s.%N)
set +e
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/rec_conc_a_session_b.log 2>&1 <<SQL
SET ROLE authenticated;
SET request.jwt.claim.sub = '$DISPATCHER';
SELECT end_recurring_arrangement('$ORG', '$ARR_A', 'ended during race');
SQL
B_EXIT=$?
set -e
END_B=$(date +%s.%N)
ELAPSED_B=$(echo "$END_B - $START_B" | bc)
set +e; wait $PID_A; set -e

echo "--- Session A log ---"; cat /tmp/rec_conc_a_session_a.log
echo "--- Session B log (exit=$B_EXIT, elapsed=${ELAPSED_B}s) ---"; cat /tmp/rec_conc_a_session_b.log

echo "=== Scenario A: final state + audit counts ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
select status, paused_at, ended_at, ended_reason from public.recurring_arrangements where id = '$ARR_A';
select action, count(*) from public.audit_events where entity_id = '$ARR_A' group by action order by action;
SQL

FINAL_STATUS=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select status from public.recurring_arrangements where id = '$ARR_A';")
FINAL_PAUSED_AT_NULL=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select (paused_at is null) from public.recurring_arrangements where id = '$ARR_A';")
PAUSE_EVENTS=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.audit_events where entity_id = '$ARR_A' and action = 'recurring_arrangement_paused';")
END_EVENTS=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.audit_events where entity_id = '$ARR_A' and action = 'recurring_arrangement_ended';")

echo "=== Scenario A verdict ==="
ELAPSED_OK=$(echo "$ELAPSED_B > 1.0" | bc)
if [ "$ELAPSED_OK" = "1" ] && [ "$FINAL_STATUS" = "ended" ] && [ "$FINAL_PAUSED_AT_NULL" = "f" ] && [ "$PAUSE_EVENTS" = "1" ] && [ "$END_EVENTS" = "1" ]; then
  echo "TEST RECURRING-CONCURRENCY-A: PASS (Session B blocked for ${ELAPSED_B}s on the arrangement row lock, then legally transitioned the now-paused row to ended, RETAINING paused_at as historical context; exactly 1 paused event + 1 ended event, no duplicate, no corrupted state)"
else
  echo "TEST RECURRING-CONCURRENCY-A: FAIL (elapsed_B=${ELAPSED_B}s, status=$FINAL_STATUS, paused_at_null=$FINAL_PAUSED_AT_NULL, pause_events=$PAUSE_EVENTS, end_events=$END_EVENTS)"
  FAIL_COUNT=$((FAIL_COUNT+1))
fi

# =============================================================================
# Scenario B: duplicate skip of the same arrangement/date
# =============================================================================
ARR_B='c1000000-0000-0000-0000-0000000000b1'
TARGET_DATE=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select min(d::date) from generate_series(current_date::timestamp, (current_date+13)::timestamp, interval '1 day') as d where extract(isodow from d) = 1;")
echo "=== Scenario B fixture: fresh ACTIVE daily arrangement $ARR_B, target date $TARGET_DATE ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from public.audit_events where entity_id = '$ARR_B';
delete from public.recurring_occurrence_exceptions where recurring_arrangement_id = '$ARR_B';
delete from public.recurring_arrangements where id = '$ARR_B';
insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
values ('$ARR_B', '$ORG', '$PASSENGER', 'Concurrency B', 'Concurrency B', '08:00', array[1,2,3,4,5,6,7]::smallint[], '2026-01-01', 'America/New_York', 'active');
SQL

echo "=== Scenario B: Session A holds the row lock ~2s, then skips $TARGET_DATE with reason 'A reason' ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/rec_conc_b_session_a.log 2>&1 <<SQL &
BEGIN;
SELECT id FROM public.recurring_arrangements WHERE id = '$ARR_B' FOR UPDATE;
SELECT pg_sleep(2);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '$ADMIN';
SELECT skip_recurring_occurrence('$ORG', '$ARR_B', '$TARGET_DATE', 'A reason');
COMMIT;
SQL
PID_A=$!

sleep 0.3
echo "=== Scenario B: Session B (should block, then observe A's committed skip and no-op) ==="
START_B=$(date +%s.%N)
set +e
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/rec_conc_b_session_b.log 2>&1 <<SQL
SET ROLE authenticated;
SET request.jwt.claim.sub = '$DISPATCHER';
SELECT skip_recurring_occurrence('$ORG', '$ARR_B', '$TARGET_DATE', 'B reason (should be discarded)');
SQL
B_EXIT=$?
set -e
END_B=$(date +%s.%N)
ELAPSED_B=$(echo "$END_B - $START_B" | bc)
set +e; wait $PID_A; set -e

echo "--- Session A log ---"; cat /tmp/rec_conc_b_session_a.log
echo "--- Session B log (exit=$B_EXIT, elapsed=${ELAPSED_B}s) ---"; cat /tmp/rec_conc_b_session_b.log

echo "=== Scenario B: final state + audit counts ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
select recurring_arrangement_id, service_date, reason from public.recurring_occurrence_exceptions where recurring_arrangement_id = '$ARR_B';
select action, count(*) from public.audit_events where entity_id = '$ARR_B' group by action order by action;
SQL

EXCEPTION_ROWS=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.recurring_occurrence_exceptions where recurring_arrangement_id = '$ARR_B';")
EXCEPTION_REASON=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select reason from public.recurring_occurrence_exceptions where recurring_arrangement_id = '$ARR_B';")
SKIP_EVENTS=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.audit_events where entity_id = '$ARR_B' and action = 'recurring_occurrence_skipped';")

echo "=== Scenario B verdict ==="
ELAPSED_OK=$(echo "$ELAPSED_B > 1.0" | bc)
if [ "$ELAPSED_OK" = "1" ] && [ "$EXCEPTION_ROWS" = "1" ] && [ "$EXCEPTION_REASON" = "A reason" ] && [ "$SKIP_EVENTS" = "1" ]; then
  echo "TEST RECURRING-CONCURRENCY-B: PASS (Session B blocked for ${ELAPSED_B}s on the arrangement row lock, then correctly took the idempotent no-op path — exactly 1 exception row, ORIGINAL reason preserved, exactly 1 skip audit event, no duplicate)"
else
  echo "TEST RECURRING-CONCURRENCY-B: FAIL (elapsed_B=${ELAPSED_B}s, rows=$EXCEPTION_ROWS, reason=$EXCEPTION_REASON, skip_events=$SKIP_EVENTS)"
  FAIL_COUNT=$((FAIL_COUNT+1))
fi

# =============================================================================
# Scenario C: resume vs end, from paused
# =============================================================================
ARR_C='c1000000-0000-0000-0000-0000000000c1'
echo "=== Scenario C fixture: fresh PAUSED arrangement $ARR_C ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from public.audit_events where entity_id = '$ARR_C';
delete from public.recurring_arrangements where id = '$ARR_C';
insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, paused_at)
values ('$ARR_C', '$ORG', '$PASSENGER', 'Concurrency C', 'Concurrency C', '08:00', array[1,2,3,4,5,6,7]::smallint[], '2026-01-01', 'America/New_York', 'paused', now() - interval '1 hour');
SQL

echo "=== Scenario C: Session A holds the row lock ~2s, then resumes ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/rec_conc_c_session_a.log 2>&1 <<SQL &
BEGIN;
SELECT id FROM public.recurring_arrangements WHERE id = '$ARR_C' FOR UPDATE;
SELECT pg_sleep(2);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '$ADMIN';
SELECT resume_recurring_arrangement('$ORG', '$ARR_C');
COMMIT;
SQL
PID_A=$!

sleep 0.3
echo "=== Scenario C: Session B (should block, then end() from the now-active row) ==="
START_B=$(date +%s.%N)
set +e
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/rec_conc_c_session_b.log 2>&1 <<SQL
SET ROLE authenticated;
SET request.jwt.claim.sub = '$DISPATCHER';
SELECT end_recurring_arrangement('$ORG', '$ARR_C', 'ended during resume race');
SQL
B_EXIT=$?
set -e
END_B=$(date +%s.%N)
ELAPSED_B=$(echo "$END_B - $START_B" | bc)
set +e; wait $PID_A; set -e

echo "--- Session A log ---"; cat /tmp/rec_conc_c_session_a.log
echo "--- Session B log (exit=$B_EXIT, elapsed=${ELAPSED_B}s) ---"; cat /tmp/rec_conc_c_session_b.log

echo "=== Scenario C: final state + audit counts ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
select status, paused_at, ended_at, ended_reason from public.recurring_arrangements where id = '$ARR_C';
select action, count(*) from public.audit_events where entity_id = '$ARR_C' group by action order by action;
SQL

FINAL_STATUS=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select status from public.recurring_arrangements where id = '$ARR_C';")
FINAL_PAUSED_AT_NULL=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select (paused_at is null) from public.recurring_arrangements where id = '$ARR_C';")
RESUME_EVENTS=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.audit_events where entity_id = '$ARR_C' and action = 'recurring_arrangement_resumed';")
END_EVENTS=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.audit_events where entity_id = '$ARR_C' and action = 'recurring_arrangement_ended';")

echo "=== Scenario C verdict ==="
ELAPSED_OK=$(echo "$ELAPSED_B > 1.0" | bc)
if [ "$ELAPSED_OK" = "1" ] && [ "$FINAL_STATUS" = "ended" ] && [ "$FINAL_PAUSED_AT_NULL" = "t" ] && [ "$RESUME_EVENTS" = "1" ] && [ "$END_EVENTS" = "1" ]; then
  echo "TEST RECURRING-CONCURRENCY-C: PASS (Session B blocked for ${ELAPSED_B}s on the arrangement row lock, then legally transitioned the now-active row to ended, paused_at correctly left NULL; exactly 1 resumed event + 1 ended event, no duplicate, no corrupted state)"
else
  echo "TEST RECURRING-CONCURRENCY-C: FAIL (elapsed_B=${ELAPSED_B}s, status=$FINAL_STATUS, paused_at_null=$FINAL_PAUSED_AT_NULL, resume_events=$RESUME_EVENTS, end_events=$END_EVENTS)"
  FAIL_COUNT=$((FAIL_COUNT+1))
fi

echo "=== Cleanup ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from public.audit_events where entity_id in ('$ARR_A', '$ARR_B', '$ARR_C');
delete from public.recurring_occurrence_exceptions where recurring_arrangement_id in ('$ARR_A', '$ARR_B', '$ARR_C');
delete from public.recurring_arrangements where id in ('$ARR_A', '$ARR_B', '$ARR_C');
SQL

echo "=== OVERALL: $((3 - FAIL_COUNT))/3 concurrency scenarios passed ==="
exit $FAIL_COUNT
