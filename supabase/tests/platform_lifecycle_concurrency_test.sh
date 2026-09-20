#!/bin/bash
# Nemryn Platform -- genuine concurrent lifecycle tests (P1-PILOT-S4B-R4E).
# Real parallel psql processes, each its own transaction.
#
# Scenario 1: a Platform Admin SUSPENDS an organization while a public website
#             submission for that organization's ACTIVE integration is in flight.
#             The suspension holds its transaction open ~1.5s after the update
#             (row lock). The submission starts while that lock is held: it must
#             BLOCK on the organization row (FOR SHARE), then, once the suspension
#             commits, be REJECTED (generic invalid_input) -- so no Request can
#             come into existence after a suspension has committed.
# Scenario 2: two Platform Admins suspend the SAME organization at the same time:
#             exactly one status change and exactly one audit row (idempotent).
#
# Run with:
#   bash supabase/tests/platform_lifecycle_concurrency_test.sh
set -uo pipefail
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('R4E Lifecycle Concurrency $STAMP', 'America/New_York') returning id" | head -1)
PA1=$($PSQL -c "select gen_random_uuid()"); PA2=$($PSQL -c "select gen_random_uuid()")
for u in "$PA1" "$PA2"; do
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 'r4e-conc-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
  $PSQL -c "insert into public.platform_admin_grants (user_id, note) values ('$u', 'R4E concurrency test')" >/dev/null
done
EXT="r4e-conc-$STAMP"
$PSQL -c "insert into public.request_intake_integrations (organization_id, external_id, integration_type, is_active, allowed_origins) values ('$ORG', '$EXT', 'website', true, array['https://conc.r4e.example'])" >/dev/null
FAIL=0
OUT=$(mktemp -d)

echo "=== Scenario 1: suspension in flight vs public submission ==="
$PSQL > "$OUT/s.out" 2> "$OUT/s.err" <<SQL &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$PA1';
select (public.set_platform_organization_status('$ORG', 'inactive', 'concurrency test suspension')).changed;
reset role;
select pg_sleep(4.0);
commit;
SQL
PID_S=$!
sleep 1.5
# the submission measures, inside the database, how long its own call was blocked
$PSQL > "$OUT/i.out" 2> "$OUT/i.err" <<SQL
set role service_role;
do \$\$
declare t0 timestamptz := clock_timestamp(); v text := 'ACCEPTED';
begin
  begin
    perform public.submit_public_transportation_request('$EXT', 'r4e-conc-key-$STAMP', 'R4E Concurrent Requester', 'self', '555-0400', 'R4E pickup', 'R4E destination', 'no', null, null, null, null, null, 'https://conc.r4e.example');
  exception when others then v := sqlerrm;
  end;
  raise notice 'INTAKE_RESULT=% INTAKE_MS=%', v, (extract(epoch from clock_timestamp() - t0) * 1000)::int;
end \$\$;
SQL
wait $PID_S
ELAPSED=$(grep -o 'INTAKE_MS=[0-9]*' "$OUT/i.err" | cut -d= -f2)
REQS=$($PSQL -c "select count(*) from public.transportation_requests where organization_id='$ORG'")
STATUS=$($PSQL -c "select status from public.organizations where id='$ORG'")
echo "blocked_ms=${ELAPSED:-none} status=$STATUS requests=$REQS $(grep -o 'INTAKE_RESULT=[a-z_A-Z]*' "$OUT/i.err")"
if [ "$STATUS" = "inactive" ] && [ "$REQS" = "0" ] && grep -q "INTAKE_RESULT=invalid_input" "$OUT/i.err" && [ "${ELAPSED:-0}" -ge 1500 ]; then
  echo "TEST CONC-LIFECYCLE-1 (suspension in flight: the concurrent submission blocked on the org row for ${ELAPSED}ms, then was rejected; zero Requests created after suspension): PASS"
else
  echo "TEST CONC-LIFECYCLE-1: FAIL"; FAIL=1
fi

echo "=== Scenario 2: two Platform Admins suspend/reactivate the same organization simultaneously ==="
$PSQL -c "update public.organizations set status='active' where id='$ORG'" >/dev/null
run_pa() { # $1 out prefix, $2 user, $3 status
  $PSQL > "$1.out" 2> "$1.err" <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$2';
select (public.set_platform_organization_status('$ORG', '$3', 'concurrent lifecycle change')).changed;
reset role;
select pg_sleep(1.0);
commit;
SQL
}
AUD0=$($PSQL -c "select count(*) from public.audit_events where organization_id='$ORG' and action='platform_organization_suspended'")
run_pa "$OUT/p1" "$PA1" inactive &
run_pa "$OUT/p2" "$PA2" inactive &
wait
CH1=$(grep -c '^t$' "$OUT/p1.out"); CH2=$(grep -c '^t$' "$OUT/p2.out")
AUD=$(( $($PSQL -c "select count(*) from public.audit_events where organization_id='$ORG' and action='platform_organization_suspended'") - AUD0 ))
ERRS=$(cat "$OUT"/p1.err "$OUT"/p2.err | grep -c . || true)
echo "changed p1=$CH1 p2=$CH2 audits=$AUD errors=$ERRS"
if [ $((CH1 + CH2)) -eq 1 ] && [ "$AUD" = "1" ] && [ "$ERRS" = "0" ]; then
  echo "TEST CONC-LIFECYCLE-2 (simultaneous identical suspensions: exactly one change, exactly one audit, no error): PASS"
else
  echo "TEST CONC-LIFECYCLE-2: FAIL"; FAIL=1
fi

# cleanup (owner level)
$PSQL >/dev/null <<SQL
delete from public.request_events where organization_id='$ORG';
delete from public.notification_events where organization_id='$ORG';
delete from public.transportation_requests where organization_id='$ORG';
delete from public.request_intake_integrations where organization_id='$ORG';
delete from public.audit_events where organization_id='$ORG';
delete from public.organizations where id='$ORG';
delete from public.platform_admin_grants where user_id in ('$PA1','$PA2');
delete from auth.users where id in ('$PA1','$PA2');
SQL
rm -rf "$OUT"
echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
