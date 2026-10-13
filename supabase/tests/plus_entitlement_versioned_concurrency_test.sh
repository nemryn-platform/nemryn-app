#!/bin/bash
# Nemryn Plus -- versioned entitlement mutations under REAL concurrency (NP-P1-S2-R1). Parallel psql processes.
#
# The NP-P1-S2 race: two Platform Admins render the panel at the same entitlement version V and submit different
# changes. Before 20261013140000 the second change silently overwrote the first. Now each call compares updated_at
# with V under the organization + module row locks:
#   Scenario 1: two different set changes with the same V -> exactly one applies, the other is refused with
#               stale_state (ZW003); exactly one audit event; the final state is the winner's.
#   Scenario 2: cancel vs set-an-end-date with the same V -> exactly one applies, the other ZW003 (extend + stale
#               version is covered by plus_entitlement_versioned_tests.sql V10/V11).
#   Scenario 3: the loser retries with the NEW version -> applies (no lockout).
#
# Run with:  bash supabase/tests/plus_entitlement_versioned_concurrency_test.sh
# Throwaway organization + two throwaway Platform Admins, removed on exit (also on failure).
set -uo pipefail
DB="${NEMRYN_TEST_DB:-postgres}"
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('S2R1 Versioned Concurrency $STAMP', 'America/New_York') returning id" | head -1)
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
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 's2r1-conc-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
  $PSQL -c "insert into public.platform_admin_grants (user_id, note) values ('$u', 'NP-P1-S2-R1 concurrency test')" >/dev/null
done
FAIL=0
audits() { $PSQL -c "select count(*) from public.audit_events where organization_id='$ORG' and action='platform_plus_access_changed'"; }
version() { $PSQL -c "select updated_at from public.organization_modules where organization_id='$ORG'"; }
run_pa() { # $1 out prefix, $2 platform admin, $3 call; holds the transaction 1s after the call
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

# Start a trial through the versioned path (no row expected).
$PSQL >/dev/null <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$PA1';
select public.platform_set_organization_module('$ORG', 'plus', 'trial', null, null, null, 'setup', null::timestamptz);
commit;
SQL
V=$(version)
echo "setup: version=$V audits=$(audits)"

echo "=== Scenario 1: two different changes rendered at the same version ==="
A0=$(audits)
run_pa "$OUT/s1a" "$PA1" "select (public.platform_set_organization_module('$ORG', 'plus', 'expired', null, null, null, 'admin 1 expire', '$V'::timestamptz)).changed" &
run_pa "$OUT/s1b" "$PA2" "select (public.platform_set_organization_module('$ORG', 'plus', 'disabled', null, null, 'no_access', 'admin 2 disable', '$V'::timestamptz)).changed" &
wait
OK=$(cat "$OUT/s1a.out" "$OUT/s1b.out" | grep -c '^t$'); STALE=$(cat "$OUT/s1a.err" "$OUT/s1b.err" | grep -c 'stale_state')
FINAL=$($PSQL -c "select status || coalesce('/' || restriction, '') from public.organization_modules where organization_id='$ORG'")
WINNER=$( [ "$(grep -c '^t$' "$OUT/s1a.out")" = "1" ] && echo "expired" || echo "disabled/no_access")
AUD=$(( $(audits) - A0 ))
echo "applied=$OK stale=$STALE final=$FINAL winner=$WINNER audits=$AUD"
if [ "$OK" = "1" ] && [ "$STALE" = "1" ] && [ "$FINAL" = "$WINNER" ] && [ "$AUD" = "1" ]; then
  echo "TEST VCONC-1 (same-version concurrent changes: exactly one applies, the other ZW003, no silent overwrite): PASS"
else
  echo "TEST VCONC-1: FAIL"; FAIL=1
fi

echo "=== Scenario 2: cancel vs set end date at the same version ==="
V=$(version)
$PSQL >/dev/null <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$PA1';
select public.platform_set_organization_module('$ORG', 'plus', 'active', null, null, null, 'to active', '$V'::timestamptz);
commit;
SQL
V=$(version); A0=$(audits)
run_pa "$OUT/s2a" "$PA1" "select (public.platform_set_organization_module('$ORG', 'plus', 'cancelled', null, null, null, 'admin 1 cancel', '$V'::timestamptz)).changed" &
run_pa "$OUT/s2b" "$PA2" "select (public.platform_set_organization_module('$ORG', 'plus', 'active', null, now() + interval '30 days', null, 'admin 2 set end date', '$V'::timestamptz)).changed" &
wait
OK=$(cat "$OUT/s2a.out" "$OUT/s2b.out" | grep -c '^t$'); STALE=$(cat "$OUT/s2a.err" "$OUT/s2b.err" | grep -c 'stale_state')
AUD=$(( $(audits) - A0 ))
echo "applied=$OK stale=$STALE audits=$AUD final=$($PSQL -c "select status from public.organization_modules where organization_id='$ORG'")"
if [ "$OK" = "1" ] && [ "$STALE" = "1" ] && [ "$AUD" = "1" ]; then
  echo "TEST VCONC-2 (competing changes at one version: exactly one applies, the other ZW003): PASS"
else
  echo "TEST VCONC-2: FAIL"; FAIL=1
fi

echo "=== Scenario 3: the refused admin retries with the new version ==="
V=$(version); A0=$(audits)
R=$($PSQL <<SQL 2>&1
begin; set local role authenticated; set local request.jwt.claim.sub = '$PA2';
select (public.platform_set_organization_module('$ORG', 'plus', 'expired', null, null, null, 'retry after refresh', '$V'::timestamptz)).changed;
commit;
SQL
)
AUD=$(( $(audits) - A0 ))
if echo "$R" | grep -q '^t$' && [ "$AUD" = "1" ]; then
  echo "TEST VCONC-3 (retry with the refreshed version applies): PASS"
else
  echo "TEST VCONC-3: FAIL ($R)"; FAIL=1
fi

ORGSTATUS=$($PSQL -c "select status from public.organizations where id='$ORG'")
if [ "$ORGSTATUS" = "active" ]; then echo "TEST VCONC-4 (organizations.status untouched): PASS"; else echo "TEST VCONC-4: FAIL"; FAIL=1; fi
echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
