#!/bin/bash
# Nemryn Plus -- genuine concurrent entitlement tests (NP-P1-S1). Real parallel psql processes, each its own transaction.
#
# Scenario 1: two Platform Admins START A TRIAL for the same organization at the same time: exactly one trial starts
#             (one row, one audit); the other call blocks on the organization row lock, then is refused (ZW004 --
#             the one-trial rule), never a second trial or a silent restart.
# Scenario 2: two Platform Admins EXTEND that trial at the same time: exactly one extension (trial_extension_count 1,
#             trial end moved once, one audit); the other is refused (ZW004).
# Scenario 3: two Platform Admins make DIFFERENT changes at the same time (expire vs cancel): both serialize, the
#             second sees the first's committed row (its audit before-state is the first's after-state): no lost update.
# Scenario 4: two IDENTICAL changes at the same time: exactly one real change and one audit; the other is a no-op.
#
# Run with:
#   bash supabase/tests/plus_entitlement_concurrency_test.sh
# Uses its own throwaway organization and two throwaway Platform Admins, removed on exit (also on failure).
set -uo pipefail
DB="${NEMRYN_TEST_DB:-postgres}"
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('S1 Plus Concurrency $STAMP', 'America/New_York') returning id" | head -1)
PA1=$($PSQL -c "select gen_random_uuid()"); PA2=$($PSQL -c "select gen_random_uuid()")
OUT=$(mktemp -d)
cleanup() {
  $PSQL >/dev/null <<SQL
delete from public.audit_events where organization_id='$ORG';
delete from public.organization_modules where organization_id='$ORG';
delete from public.organizations where id='$ORG';
delete from public.platform_admin_grants where user_id in ('$PA1','$PA2');
delete from auth.users where id in ('$PA1','$PA2');
SQL
  rm -rf "$OUT"
}
trap cleanup EXIT
for u in "$PA1" "$PA2"; do
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 's1-plus-conc-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
  $PSQL -c "insert into public.platform_admin_grants (user_id, note) values ('$u', 'NP-P1-S1 concurrency test')" >/dev/null
done
FAIL=0
audits() { $PSQL -c "select count(*) from public.audit_events where organization_id='$ORG' and action='platform_plus_access_changed'"; }

# $1 out prefix, $2 platform admin, $3 SQL call (its result is printed), holds the transaction 1s after the call
run_pa() {
  $PSQL > "$1.out" 2> "$1.err" <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$2';
$3;
reset role;
select pg_sleep(1.0);
commit;
SQL
}

echo "=== Scenario 1: simultaneous trial starts ==="
A0=$(audits)
CALL="select (public.platform_set_organization_module('$ORG', 'plus', 'trial', null, null, null, 'concurrent trial start')).changed"
run_pa "$OUT/t1" "$PA1" "$CALL" &
run_pa "$OUT/t2" "$PA2" "$CALL" &
wait
OK=$(cat "$OUT/t1.out" "$OUT/t2.out" | grep -c '^t$'); REFUSED=$(cat "$OUT/t1.err" "$OUT/t2.err" | grep -c 'illegal_transition')
ROWS=$($PSQL -c "select count(*) from public.organization_modules where organization_id='$ORG'")
ENDS=$($PSQL -c "select (trial_ends_at - trial_started_at) = interval '14 days' from public.organization_modules where organization_id='$ORG'")
AUD=$(( $(audits) - A0 ))
echo "started=$OK refused=$REFUSED rows=$ROWS fourteen_days=$ENDS audits=$AUD"
if [ "$OK" = "1" ] && [ "$REFUSED" = "1" ] && [ "$ROWS" = "1" ] && [ "$ENDS" = "t" ] && [ "$AUD" = "1" ]; then
  echo "TEST CONC-PLUS-1 (simultaneous trial starts: exactly one trial, one audit; the other refused ZW004): PASS"
else
  echo "TEST CONC-PLUS-1: FAIL"; FAIL=1
fi

echo "=== Scenario 2: simultaneous trial extensions ==="
A0=$(audits)
END0=$($PSQL -c "select trial_ends_at from public.organization_modules where organization_id='$ORG'")
CALL="select (public.platform_extend_plus_trial('$ORG', 5, 'concurrent extension')).changed"
run_pa "$OUT/e1" "$PA1" "$CALL" &
run_pa "$OUT/e2" "$PA2" "$CALL" &
wait
OK=$(cat "$OUT/e1.out" "$OUT/e2.out" | grep -c '^t$'); REFUSED=$(cat "$OUT/e1.err" "$OUT/e2.err" | grep -c 'illegal_transition')
STATE=$($PSQL -c "select trial_extension_count || '/' || (trial_ends_at = '$END0'::timestamptz + interval '5 days' or trial_ends_at > '$END0'::timestamptz) || '/' || (trial_ends_at - '$END0'::timestamptz <= interval '5 days 2 seconds') from public.organization_modules where organization_id='$ORG'")
AUD=$(( $(audits) - A0 ))
echo "extended=$OK refused=$REFUSED count/moved/once=$STATE audits=$AUD"
if [ "$OK" = "1" ] && [ "$REFUSED" = "1" ] && [ "$STATE" = "1/true/true" ] && [ "$AUD" = "1" ]; then
  echo "TEST CONC-PLUS-2 (simultaneous extensions: exactly one, trial end moved once, one audit; the other refused ZW004): PASS"
else
  echo "TEST CONC-PLUS-2: FAIL"; FAIL=1
fi

echo "=== Scenario 3: different simultaneous changes (expire vs cancel) -- no lost update ==="
A0=$(audits)
run_pa "$OUT/x1" "$PA1" "select (public.platform_set_organization_module('$ORG', 'plus', 'expired', null, null, null, 'concurrent expire')).changed" &
sleep 0.3
run_pa "$OUT/x2" "$PA2" "select (public.platform_set_organization_module('$ORG', 'plus', 'cancelled', null, null, null, 'concurrent cancel')).changed" &
wait
OK=$(cat "$OUT/x1.out" "$OUT/x2.out" | grep -c '^t$'); ERRS=$(cat "$OUT/x1.err" "$OUT/x2.err" | grep -c 'ERROR' || true)
FINAL=$($PSQL -c "select status from public.organization_modules where organization_id='$ORG'")
CHAIN=$($PSQL -c "select string_agg((before_data->>'status') || '>' || (after_data->>'status'), ',' order by occurred_at, id) from (select * from public.audit_events where organization_id='$ORG' and action='platform_plus_access_changed' order by occurred_at desc, id desc limit 2) a")
AUD=$(( $(audits) - A0 ))
echo "changed=$OK errors=$ERRS final=$FINAL audits=$AUD chain=$CHAIN"
if [ "$OK" = "2" ] && [ "$ERRS" = "0" ] && [ "$FINAL" = "cancelled" ] && [ "$AUD" = "2" ] && [ "$CHAIN" = "trial>expired,expired>cancelled" ]; then
  echo "TEST CONC-PLUS-3 (different simultaneous changes serialize; the second saw the first's committed state; no lost update): PASS"
else
  echo "TEST CONC-PLUS-3: FAIL"; FAIL=1
fi

echo "=== Scenario 4: identical simultaneous changes ==="
A0=$(audits)
CALL="select (public.platform_set_organization_module('$ORG', 'plus', 'active', null, null, null, 'concurrent activation')).changed"
run_pa "$OUT/a1" "$PA1" "$CALL" &
run_pa "$OUT/a2" "$PA2" "$CALL" &
wait
CH=$(cat "$OUT/a1.out" "$OUT/a2.out" | grep -c '^t$'); NOOP=$(cat "$OUT/a1.out" "$OUT/a2.out" | grep -c '^f$'); ERRS=$(cat "$OUT/a1.err" "$OUT/a2.err" | grep -c 'ERROR' || true)
AUD=$(( $(audits) - A0 ))
echo "changed=$CH noop=$NOOP errors=$ERRS audits=$AUD"
if [ "$CH" = "1" ] && [ "$NOOP" = "1" ] && [ "$ERRS" = "0" ] && [ "$AUD" = "1" ]; then
  echo "TEST CONC-PLUS-4 (identical simultaneous changes: exactly one change and one audit; the other an idempotent no-op): PASS"
else
  echo "TEST CONC-PLUS-4: FAIL"; FAIL=1
fi

ORGSTATUS=$($PSQL -c "select status from public.organizations where id='$ORG'")
if [ "$ORGSTATUS" = "active" ]; then
  echo "TEST CONC-PLUS-5 (no entitlement change touched organizations.status): PASS"
else
  echo "TEST CONC-PLUS-5: FAIL"; FAIL=1
fi

echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
