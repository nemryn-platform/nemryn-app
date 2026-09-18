#!/bin/bash
# Zenward Platform — genuine concurrent "Create Trip for missing occurrence"
# test (P1-E2-S1E §28/§32). Same two-OS-process technique as
# recurring_arrangement_concurrency_test.sh / mutation_concurrency_test.sh:
# Session A locks the arrangement row (as postgres — authenticated holds
# no UPDATE grant on recurring_arrangements, so a raw client-side FOR
# UPDATE is impossible; the lock is taken by the connection's own default
# role, then the actual RPC call switches to authenticated), holds it
# ~2s, then calls create_trip_for_recurring_occurrence and commits.
# Session B, launched ~0.3s later while A still sleeps, calls the SAME
# RPC for the SAME arrangement+date directly.
#
# Scenario A: no pre-existing Trip. A creates the ONE real Trip
#   (wins the lock first); B blocks, then observes A's already-committed
#   Trip and takes the idempotent no-op path (created=false, SAME
#   trip_id). Exactly 1 Trip row, exactly 1 trip_created audit event,
#   exactly 1 recurring_occurrence_trip_created audit event.
#
# Scenario B: a CANCELLED Trip already exists for the target date. The
#   same race still produces exactly ONE replacement Trip (never two) —
#   the cancelled Trip does not satisfy the idempotency check for either
#   session, so whichever session wins the lock first creates the
#   replacement, and the second still correctly finds and returns THAT
#   replacement as a no-op (not a second one).
#
# Run with:
#   bash supabase/tests/recurring_trip_creation_concurrency_test.sh

set -euo pipefail

ORG='10000000-0000-0000-0000-0000000000a1'
PASSENGER='40000000-0000-0000-0000-0000000000a1'
ADMIN='20000000-0000-0000-0000-0000000000a1'
DISPATCHER='20000000-0000-0000-0000-0000000000a2'

FAIL_COUNT=0

# =============================================================================
# Scenario A: no pre-existing Trip
# =============================================================================
ARR_A='9b100000-0000-0000-0000-0000000000a1'
TARGET_DATE=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select (current_date + 3)::text;")

echo "=== Scenario A fixture: fresh ACTIVE daily arrangement $ARR_A, target date $TARGET_DATE ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from public.audit_events where entity_id = '$ARR_A' or entity_id in (select id from public.trips where recurring_arrangement_id = '$ARR_A');
delete from public.trip_events where trip_id in (select id from public.trips where recurring_arrangement_id = '$ARR_A');
delete from public.trips where recurring_arrangement_id = '$ARR_A';
delete from public.recurring_arrangements where id = '$ARR_A';
insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
values ('$ARR_A', '$ORG', '$PASSENGER', 'Concurrency RTC A', 'Concurrency RTC A', '08:00', array[1,2,3,4,5,6,7]::smallint[], '2026-01-01', 'America/New_York', 'active');
SQL

echo "=== Scenario A: Session A holds the row lock ~2s, then creates the Trip ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/rtc_conc_a_session_a.log 2>&1 <<SQL &
BEGIN;
SELECT id FROM public.recurring_arrangements WHERE id = '$ARR_A' FOR UPDATE;
SELECT pg_sleep(2);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '$ADMIN';
SELECT create_trip_for_recurring_occurrence('$ORG', '$ARR_A', '$TARGET_DATE');
COMMIT;
SQL
PID_A=$!

sleep 0.3
echo "=== Scenario A: Session B (should block, then observe A's committed Trip and no-op) ==="
START_B=$(date +%s.%N)
set +e
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/rtc_conc_a_session_b.log 2>&1 <<SQL
SET ROLE authenticated;
SET request.jwt.claim.sub = '$DISPATCHER';
SELECT create_trip_for_recurring_occurrence('$ORG', '$ARR_A', '$TARGET_DATE');
SQL
B_EXIT=$?
set -e
END_B=$(date +%s.%N)
ELAPSED_B=$(echo "$END_B - $START_B" | bc)
set +e; wait $PID_A; set -e

echo "--- Session A log ---"; cat /tmp/rtc_conc_a_session_a.log
echo "--- Session B log (exit=$B_EXIT, elapsed=${ELAPSED_B}s) ---"; cat /tmp/rtc_conc_a_session_b.log

TRIP_COUNT=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.trips where recurring_arrangement_id = '$ARR_A';")
TRIP_CREATED_EVENTS=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.audit_events where entity_type='trip' and action='trip_created' and entity_id in (select id from public.trips where recurring_arrangement_id = '$ARR_A');")
RECURRING_EVENTS=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.audit_events where entity_type='recurring_arrangement' and entity_id = '$ARR_A' and action='recurring_occurrence_trip_created';")

echo "=== Scenario A verdict ==="
ELAPSED_OK=$(echo "$ELAPSED_B > 1.0" | bc)
if [ "$ELAPSED_OK" = "1" ] && [ "$TRIP_COUNT" = "1" ] && [ "$TRIP_CREATED_EVENTS" = "1" ] && [ "$RECURRING_EVENTS" = "1" ]; then
  echo "TEST RECURRING-TRIP-CONCURRENCY-A: PASS (Session B blocked for ${ELAPSED_B}s on the arrangement row lock, then correctly took the idempotent no-op path — exactly 1 Trip, exactly 1 trip_created event, exactly 1 recurring_occurrence_trip_created event, no duplicates)"
else
  echo "TEST RECURRING-TRIP-CONCURRENCY-A: FAIL (elapsed_B=${ELAPSED_B}s, trip_count=$TRIP_COUNT, trip_created_events=$TRIP_CREATED_EVENTS, recurring_events=$RECURRING_EVENTS)"
  FAIL_COUNT=$((FAIL_COUNT+1))
fi

# =============================================================================
# Scenario B: a CANCELLED Trip already exists for the target date
# =============================================================================
ARR_B='9b100000-0000-0000-0000-0000000000b1'
TARGET_DATE_B=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select (current_date + 4)::text;")

echo "=== Scenario B fixture: fresh ACTIVE arrangement $ARR_B with a CANCELLED Trip on $TARGET_DATE_B ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from public.audit_events where entity_id = '$ARR_B' or entity_id in (select id from public.trips where recurring_arrangement_id = '$ARR_B');
delete from public.trip_events where trip_id in (select id from public.trips where recurring_arrangement_id = '$ARR_B');
delete from public.trips where recurring_arrangement_id = '$ARR_B';
delete from public.recurring_arrangements where id = '$ARR_B';
insert into public.recurring_arrangements (id, organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status)
values ('$ARR_B', '$ORG', '$PASSENGER', 'Concurrency RTC B', 'Concurrency RTC B', '08:00', array[1,2,3,4,5,6,7]::smallint[], '2026-01-01', 'America/New_York', 'active');
insert into public.trips (id, organization_id, passenger_id, recurring_arrangement_id, state, scheduled_pickup_at, pickup_description, destination_description, cancelled_at, cancellation_reason)
values (gen_random_uuid(), '$ORG', '$PASSENGER', '$ARR_B', 'cancelled', ('${TARGET_DATE_B}T12:00:00Z')::timestamptz, 'old', 'old', now(), 'pre-existing cancelled fixture');
SQL

echo "=== Scenario B: Session A holds the row lock ~2s, then creates the replacement Trip ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/rtc_conc_b_session_a.log 2>&1 <<SQL &
BEGIN;
SELECT id FROM public.recurring_arrangements WHERE id = '$ARR_B' FOR UPDATE;
SELECT pg_sleep(2);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '$ADMIN';
SELECT create_trip_for_recurring_occurrence('$ORG', '$ARR_B', '$TARGET_DATE_B');
COMMIT;
SQL
PID_A=$!

sleep 0.3
echo "=== Scenario B: Session B (should block, then observe A's committed replacement and no-op) ==="
START_B=$(date +%s.%N)
set +e
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/rtc_conc_b_session_b.log 2>&1 <<SQL
SET ROLE authenticated;
SET request.jwt.claim.sub = '$DISPATCHER';
SELECT create_trip_for_recurring_occurrence('$ORG', '$ARR_B', '$TARGET_DATE_B');
SQL
B_EXIT=$?
set -e
END_B=$(date +%s.%N)
ELAPSED_B=$(echo "$END_B - $START_B" | bc)
set +e; wait $PID_A; set -e

echo "--- Session A log ---"; cat /tmp/rtc_conc_b_session_a.log
echo "--- Session B log (exit=$B_EXIT, elapsed=${ELAPSED_B}s) ---"; cat /tmp/rtc_conc_b_session_b.log

NON_CANCELLED_TRIP_COUNT=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.trips where recurring_arrangement_id = '$ARR_B' and state <> 'cancelled';")
CANCELLED_STILL_INTACT=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.trips where recurring_arrangement_id = '$ARR_B' and state = 'cancelled' and pickup_description = 'old';")

echo "=== Scenario B verdict ==="
ELAPSED_OK=$(echo "$ELAPSED_B > 1.0" | bc)
if [ "$ELAPSED_OK" = "1" ] && [ "$NON_CANCELLED_TRIP_COUNT" = "1" ] && [ "$CANCELLED_STILL_INTACT" = "1" ]; then
  echo "TEST RECURRING-TRIP-CONCURRENCY-B: PASS (Session B blocked for ${ELAPSED_B}s, exactly ONE replacement Trip resulted from the race — never two — and the pre-existing cancelled Trip remains completely untouched)"
else
  echo "TEST RECURRING-TRIP-CONCURRENCY-B: FAIL (elapsed_B=${ELAPSED_B}s, non_cancelled_count=$NON_CANCELLED_TRIP_COUNT, cancelled_intact=$CANCELLED_STILL_INTACT)"
  FAIL_COUNT=$((FAIL_COUNT+1))
fi

echo "=== Cleanup ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from public.audit_events where entity_id in ('$ARR_A', '$ARR_B') or entity_id in (select id from public.trips where recurring_arrangement_id in ('$ARR_A', '$ARR_B'));
delete from public.trip_events where trip_id in (select id from public.trips where recurring_arrangement_id in ('$ARR_A', '$ARR_B'));
delete from public.trips where recurring_arrangement_id in ('$ARR_A', '$ARR_B');
delete from public.recurring_arrangements where id in ('$ARR_A', '$ARR_B');
SQL

echo "=== OVERALL: $((2 - FAIL_COUNT))/2 recurring trip-creation concurrency scenarios passed ==="
exit $FAIL_COUNT
