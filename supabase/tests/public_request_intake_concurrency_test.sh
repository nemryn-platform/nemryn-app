#!/bin/bash
# Zenward Platform — genuine concurrent public-intake idempotency test
# (P1-PILOT-S4A). Same two-OS-process methodology as
# recurring_trip_creation_concurrency_test.sh/mutation_concurrency_test.sh:
# two SEPARATE psql connections (two OS processes) call
# submit_public_transportation_request with the SAME integration +
# SAME idempotency key at genuinely overlapping wall-clock times — never
# a sequential simulation.
#
# Unlike the existing mutation-concurrency scripts (which prove
# serialization via an explicit SELECT ... FOR UPDATE row lock on a
# PRE-EXISTING row), this RPC's idempotency mechanism is a fresh
# INSERT ... ON CONFLICT (transportation_requests_intake_idempotency_idx)
# DO NOTHING — there is no pre-existing row to lock. Genuine concurrency
# is instead produced by having BOTH sessions open an explicit
# transaction, pg_sleep briefly INSIDE that transaction (so both are
# guaranteed to reach their own INSERT attempt while the other is still
# mid-flight), then call the RPC and commit — Postgres's own unique-index
# insertion arbitration is the real mechanism under test: whichever
# transaction's INSERT physically lands first in the index wins outright;
# the other's conflicting insert is detected against it (blocking briefly
# on the index entry if the two truly overlap at the physical insert,
# exactly like two ordinary concurrent INSERTs racing the same unique
# key) and takes the DO NOTHING branch, then this script's own re-select
# picks up the winner's row. Both calls must return accepted=true either
# way — the caller-facing contract never surfaces which one "won".

set -u
FAIL_COUNT=0

ORG_A='10000000-0000-0000-0000-0000000000a1'
INTEGRATION_ID='b0000000-0000-0000-0000-00000000b001'
EXTERNAL_ID='test-concurrency-intake-org-a'
IDEMPOTENCY_KEY='S4A-CONCURRENCY-TEST-KEY-001'

psql_exec() {
  docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA
}
psql_run() {
  docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1
}

echo "=== Fixture setup ==="
psql_run <<SQL
delete from public.request_events where request_id in (
  select id from public.transportation_requests where external_submission_ref = '$IDEMPOTENCY_KEY'
);
delete from public.transportation_requests where external_submission_ref = '$IDEMPOTENCY_KEY';
delete from public.request_intake_integrations where id = '$INTEGRATION_ID';
insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active)
values ('$INTEGRATION_ID', '$ORG_A', '$EXTERNAL_ID', 'website', true);
SQL

echo "=== Launching two genuinely concurrent service_role submissions (same integration, same idempotency key) ==="
# P1-PILOT-S4B: as of 20260919120000_public_intake_ingress_hardening.sql,
# submit_public_transportation_request is service_role-only (simulating
# the trusted Route Handler's own execution context) — anon can no
# longer reach it directly at all (see TEST S4B-1/S4B-2 in
# public_request_intake_tests.sql).

docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/public_intake_concurrency_session_a.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(1.0);
SET LOCAL ROLE service_role;
SELECT * FROM public.submit_public_transportation_request(
  '$EXTERNAL_ID', '$IDEMPOTENCY_KEY', 'Session A Requester', 'self', '555-0201',
  'Concurrency Test Pickup A', 'Concurrency Test Destination A', 'no'
);
COMMIT;
SQL
PID_A=$!

sleep 0.3

START_B=$(date +%s.%N)
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/public_intake_concurrency_session_b.log 2>&1 <<SQL
BEGIN;
SELECT pg_sleep(0.5);
SET LOCAL ROLE service_role;
SELECT * FROM public.submit_public_transportation_request(
  '$EXTERNAL_ID', '$IDEMPOTENCY_KEY', 'Session B Requester -- different text, SAME idempotency key', 'self', '555-0202',
  'Concurrency Test Pickup B (should never persist)', 'Concurrency Test Destination B (should never persist)', 'yes'
);
COMMIT;
SQL
END_B=$(date +%s.%N)
ELAPSED_B=$(echo "$END_B - $START_B" | bc)

wait $PID_A

echo "--- Session A log ---"
cat /tmp/public_intake_concurrency_session_a.log
echo "--- Session B log (elapsed=${ELAPSED_B}s) ---"
cat /tmp/public_intake_concurrency_session_b.log

echo "=== Verifying final state ==="
ROW_COUNT=$(psql_exec <<SQL
select count(*) from public.transportation_requests
where intake_integration_id = '$INTEGRATION_ID' and external_submission_ref = '$IDEMPOTENCY_KEY';
SQL
)
REQUESTER_NAME=$(psql_exec <<SQL
select requester_name from public.transportation_requests
where intake_integration_id = '$INTEGRATION_ID' and external_submission_ref = '$IDEMPOTENCY_KEY';
SQL
)
EVENT_COUNT=$(psql_exec <<SQL
select count(*) from public.request_events
where request_id = (select id from public.transportation_requests where intake_integration_id = '$INTEGRATION_ID' and external_submission_ref = '$IDEMPOTENCY_KEY')
  and event_type = 'request_logged';
SQL
)

echo "row_count=$ROW_COUNT requester_name=\"$REQUESTER_NAME\" request_logged_event_count=$EVENT_COUNT"

# the result composite is (accepted, notification_event_id); count rows whose accepted column is t
A_ACCEPTED=$(grep -cE "^ *t *(\||$)" /tmp/public_intake_concurrency_session_a.log || true)
B_ACCEPTED=$(grep -cE "^ *t *(\||$)" /tmp/public_intake_concurrency_session_b.log || true)

echo "=== Verdict ==="
if [ "$ROW_COUNT" = "1" ] && [ "$EVENT_COUNT" = "1" ] && [ "$A_ACCEPTED" -ge "1" ] && [ "$B_ACCEPTED" -ge "1" ]; then
  echo "TEST PUBLIC-INTAKE-CONCURRENCY-1: PASS (two genuinely concurrent identical submissions -- same integration, same idempotency key -- both returned accepted, but exactly ONE Request row and exactly ONE request_logged event exist; the surviving row's own requester_name (\"$REQUESTER_NAME\") shows exactly one of the two payloads won, never a merge/corruption of both)"
else
  echo "TEST PUBLIC-INTAKE-CONCURRENCY-1: FAIL (row_count=$ROW_COUNT, event_count=$EVENT_COUNT, a_accepted=$A_ACCEPTED, b_accepted=$B_ACCEPTED -- expected row_count=1, event_count=1, both accepted)"
  FAIL_COUNT=$((FAIL_COUNT+1))
fi

echo "=== Cleanup ==="
psql_run <<SQL
delete from public.request_events where request_id in (
  select id from public.transportation_requests where intake_integration_id = '$INTEGRATION_ID'
);
delete from public.transportation_requests where intake_integration_id = '$INTEGRATION_ID';
delete from public.request_intake_integrations where id = '$INTEGRATION_ID';
SQL

echo "=== TOTAL FAILURES: $FAIL_COUNT ==="
exit $FAIL_COUNT
