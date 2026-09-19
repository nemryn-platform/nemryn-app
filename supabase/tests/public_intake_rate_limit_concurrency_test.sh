#!/bin/bash
# Zenward Platform — genuine concurrent rate-limit test (P1-PILOT-S4B).
#
# Proves the durable rate limiter is atomic under REAL concurrency, not
# just correct when called sequentially (already proven by
# public_intake_rate_limit_tests.sql). Launches 15 genuinely separate OS
# processes (not a sequential loop, not simulated), all targeting the
# SAME client_key, whose documented per-client threshold is 8/hour — if
# the counter were a naive "SELECT count(*) ...; IF count < limit THEN
# INSERT ...;" with no lock, a burst of truly simultaneous callers could
# all read the SAME "count so far" before any of them has recorded its
# own attempt, and MORE than 8 could be allowed through (the classic
# read-before-write race). check_and_record_public_intake_rate_limit's
# own transaction-scoped advisory lock
# (pg_advisory_xact_lock(hashtext('public-intake-rl-client:' ||
# client_key))) is what this test actually proves works: every one of
# the 15 processes is launched within milliseconds of every other (all
# backgrounded, no artificial per-process delay), and the assertion is
# that EXACTLY 8 -- never more -- were ever allowed, regardless of the
# true wall-clock overlap Postgres's own connection/lock-queue scheduling
# produces.

set -u
FAIL_COUNT=0
CLIENT_KEY="s4b-rlc-concurrency-client-$$"
INTEGRATION_KEY="s4b-rlc-concurrency-integration"
N=15
EXPECTED_ALLOWED=8

psql_run() {
  docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1
}

echo "=== Fixture setup ==="
psql_run <<SQL
delete from public.public_intake_rate_limit_events where client_key = '$CLIENT_KEY' or integration_external_id = '$INTEGRATION_KEY';
SQL

echo "=== Launching $N genuinely concurrent rate-limit check-and-record calls against the SAME client_key ==="
mkdir -p /tmp/s4b-rlc-logs
rm -f /tmp/s4b-rlc-logs/*.log

for i in $(seq 1 "$N"); do
  docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA > "/tmp/s4b-rlc-logs/attempt-$i.log" 2>&1 <<SQL &
SET ROLE service_role;
SELECT allowed FROM public.check_and_record_public_intake_rate_limit('$INTEGRATION_KEY', '$CLIENT_KEY');
SQL
done

wait

echo "=== Collecting results ==="
ALLOWED_COUNT=0
DENIED_COUNT=0
for i in $(seq 1 "$N"); do
  # -tA output includes the leading "SET" (from `SET ROLE service_role;`,
  # which also prints a result line) on the line before the actual
  # boolean -- take the LAST non-empty line, never a naive whole-file
  # strip (which previously concatenated "SET" + "t"/"f" into "SETt").
  RESULT=$(grep -v '^SET$' "/tmp/s4b-rlc-logs/attempt-$i.log" | tr -d '[:space:]')
  echo "attempt-$i: $RESULT"
  if [ "$RESULT" = "t" ]; then
    ALLOWED_COUNT=$((ALLOWED_COUNT+1))
  elif [ "$RESULT" = "f" ]; then
    DENIED_COUNT=$((DENIED_COUNT+1))
  fi
done

echo "=== Verifying final durable state matches the in-flight results ==="
DB_COUNT=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA <<SQL
select count(*) from public.public_intake_rate_limit_events where client_key = '$CLIENT_KEY';
SQL
)

echo "allowed_count=$ALLOWED_COUNT denied_count=$DENIED_COUNT db_recorded_count=$DB_COUNT (N=$N, expected_allowed=$EXPECTED_ALLOWED)"

echo "=== Verdict ==="
if [ "$ALLOWED_COUNT" = "$EXPECTED_ALLOWED" ] && [ "$DENIED_COUNT" = "$((N - EXPECTED_ALLOWED))" ] && [ "$DB_COUNT" = "$EXPECTED_ALLOWED" ]; then
  echo "TEST RATE-LIMIT-CONCURRENCY-1: PASS ($N genuinely concurrent processes raced the SAME client_key; exactly $ALLOWED_COUNT were allowed and exactly $DB_COUNT rows were durably recorded -- matches the documented 8/hour per-client threshold EXACTLY, never more, proving the transaction-scoped advisory lock prevents the classic read-before-write race a naive counter would be vulnerable to)"
else
  echo "TEST RATE-LIMIT-CONCURRENCY-1: FAIL (allowed=$ALLOWED_COUNT, denied=$DENIED_COUNT, db_count=$DB_COUNT -- expected allowed=$EXPECTED_ALLOWED, denied=$((N - EXPECTED_ALLOWED)), db_count=$EXPECTED_ALLOWED)"
  FAIL_COUNT=$((FAIL_COUNT+1))
fi

echo "=== Cleanup ==="
psql_run <<SQL
delete from public.public_intake_rate_limit_events where client_key = '$CLIENT_KEY' or integration_external_id = '$INTEGRATION_KEY';
SQL
rm -rf /tmp/s4b-rlc-logs

echo "=== TOTAL FAILURES: $FAIL_COUNT ==="
exit $FAIL_COUNT
