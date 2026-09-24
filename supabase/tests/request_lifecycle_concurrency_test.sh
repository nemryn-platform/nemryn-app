#!/bin/bash
# Zenward Platform — genuine concurrent request-lifecycle test (P1-E1-S2B).
#
# Proves the shared Request-row FOR UPDATE lock genuinely serializes a
# lifecycle mutation (cancel_transportation_request) against a concurrent
# create_trip call on the SAME Request — not merely a written claim in
# the migration's own comments, but the same two-separate-psql-process
# methodology already established by mutation_concurrency_test.sh and
# driver_invite_concurrency_test.sh (a single sequential .sql script
# cannot demonstrate real lock contention).
#
# decline_transportation_request and link_request_passenger share the
# IDENTICAL locking primitive (the same `select ... for update` on the
# same table, inside a function body of the same shape) — proving the
# primitive holds for one representative transition (cancel) is
# representative of all three, matching this repository's own established
# practice of one concurrency script per shared primitive rather than one
# per RPC (mutation_concurrency_test.sh covers only assign_trip, not also
# reassign_trip, which shares the same row-lock discipline).
#
# P1-OPS-R1: cancel is now accepted -> cancelled (reason required), so the
# fixture starts ACCEPTED with a linked Passenger; the race is otherwise identical.
#
# Scenario: Request E1 starts accepted, zero linked Trips.
#   Session A: opens a transaction, locks the Request row (FOR UPDATE),
#     holds it for ~2 seconds (simulating a real in-flight mutation), then
#     calls cancel_transportation_request and commits.
#   Session B: launched ~0.3s after A (while A is still holding the
#     lock), calls create_trip(p_request_id => R2) on the SAME Request.
#
# Expected: Session B's call BLOCKS on the Request row lock until A
# commits (observable as B's wall-clock duration being close to A's hold
# time, not near-instant), and once unblocked, B's own read of the
# Request's state is up to date (sees A's just-committed 'cancelled'
# state), so B correctly rejects with invalid_input (ZW006) rather than
# creating a Trip against a Request that was cancelled a moment earlier.
# Zero Trips exist for this Request at the end — proving the Request-row
# lock, not merely sequential luck, is what prevented the race.
#
# Run with:
#   bash supabase/tests/request_lifecycle_concurrency_test.sh

set -euo pipefail

REQUEST='92300000-0000-0000-0000-0000000000e1'
ORG='10000000-0000-0000-0000-0000000000a1'
PASSENGER='40000000-0000-0000-0000-0000000000a1'
DISPATCHER='20000000-0000-0000-0000-0000000000a2'

echo "=== Fixture: fresh accepted Request E1 (linked Passenger), zero linked Trips (re-runnable) ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
delete from public.trips where request_id = '$REQUEST';
delete from public.request_events where request_id = '$REQUEST';
delete from public.transportation_requests where id = '$REQUEST';
insert into public.transportation_requests (
  id, organization_id, passenger_id, requester_name, requester_relationship, requester_phone,
  pickup_description, destination_description, return_trip_needed, source, state
) values (
  '$REQUEST', '$ORG', '$PASSENGER', 'Fictional Concurrency Test Requester', 'self', '555-0195',
  'Concurrency test E1 pickup', 'Concurrency test E1 destination', 'no', 'phone', 'accepted'
);
SQL

echo "=== Launching Session A (holds the Request row lock ~2s, then cancel_transportation_request) ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/req_concurrency_session_a.log 2>&1 <<SQL &
SET ROLE authenticated;
SET request.jwt.claim.sub = '$DISPATCHER';
BEGIN;
SELECT id FROM public.transportation_requests WHERE id = '$REQUEST' FOR UPDATE;
SELECT pg_sleep(2);
SELECT cancel_transportation_request('$ORG', '$REQUEST', 'requester_cancelled');
COMMIT;
SQL
PID_A=$!

sleep 0.3
echo "=== Launching Session B (should block on A's lock, then observe A's committed cancellation) ==="
START_B=$(date +%s.%N)
set +e
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/req_concurrency_session_b.log 2>&1 <<SQL
SET ROLE authenticated;
SET request.jwt.claim.sub = '$DISPATCHER';
SELECT create_trip('$ORG', '$PASSENGER', 'Concurrency test E1 trip pickup', 'Concurrency test E1 trip destination', null, null, null, null, null, null, '$REQUEST');
SQL
B_EXIT=$?
set -e
END_B=$(date +%s.%N)
ELAPSED_B=$(echo "$END_B - $START_B" | bc)

set +e
wait $PID_A
set -e

echo "--- Session A log ---"
cat /tmp/req_concurrency_session_a.log
echo "--- Session B log (exit=$B_EXIT, elapsed=${ELAPSED_B}s) ---"
cat /tmp/req_concurrency_session_b.log

echo "=== Verifying final state ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
select
  (select state from public.transportation_requests where id = '$REQUEST') as request_state,
  (select count(*) from public.trips where request_id = '$REQUEST') as linked_trip_count;
SQL

echo "=== Verdict ==="
ELAPSED_OK=$(echo "$ELAPSED_B > 1.0" | bc)
B_REJECTED=$(grep -c "ZW006\|invalid_input" /tmp/req_concurrency_session_b.log || true)
if [ "$ELAPSED_OK" = "1" ] && [ "$B_REJECTED" -ge "1" ]; then
  echo "TEST REQUEST-CONCURRENCY-1: PASS (Session B blocked for ${ELAPSED_B}s on the Request row lock, then correctly saw Session A's already-committed cancellation and rejected with invalid_input — genuine row-level serialization, not a lucky interleaving)"
else
  echo "TEST REQUEST-CONCURRENCY-1: FAIL (elapsed_B=${ELAPSED_B}s, B_rejected_lines=${B_REJECTED} — expected elapsed > 1.0s and at least one invalid_input rejection)"
fi
