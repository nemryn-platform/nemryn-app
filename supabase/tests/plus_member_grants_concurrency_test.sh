#!/bin/bash
# Nemryn Plus -- named-staff grants under REAL concurrency (NP-P1-S3). Parallel psql processes, each its own transaction
# that holds its locks ~1s after the call, so the other session genuinely waits.
#
#   Scenario 1: two Admins grant the SAME access at once (double submit)      -> one change, one idempotent no-op;
#               exactly one active grant, one audit.
#   Scenario 2: two Admins grant DIFFERENT access from the same version      -> one applies, the other ZW003;
#               exactly one active grant (the winner's), one audit.
#   Scenario 3: change (READ->WRITE) vs revoke from the same version         -> one applies, the other ZW003; one audit.
#   Scenario 4: two Admins revoke at once (double submit)                    -> one revoke, one no-op; one audit.
#   Scenario 5: grant vs Core deactivation of the Dispatcher at once         -> serialized on the organization admin
#               lock; whichever wins, the deactivated Dispatcher ends with NO effective Plus access.
#   Invariant after every scenario: at most one active grant (never two), history rows never deleted.
#
# Run with:  bash supabase/tests/plus_member_grants_concurrency_test.sh
# Throwaway organization + three throwaway users, removed on exit (also on failure).
set -uo pipefail
DB="${NEMRYN_TEST_DB:-postgres}"
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('S3 Grant Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()"); DSP=$($PSQL -c "select gen_random_uuid()")
OUT=$(mktemp -d)
cleanup() {
  $PSQL >/dev/null <<SQL
delete from public.audit_events where organization_id='$ORG';
delete from public.membership_module_grants where organization_id='$ORG';
delete from public.organization_modules where organization_id='$ORG';
delete from public.memberships where organization_id='$ORG';
delete from public.organizations where id='$ORG';
delete from auth.users where id in ('$AD1','$AD2','$DSP');
SQL
  rm -rf "$OUT"
}
trap cleanup EXIT
for u in "$AD1" "$AD2" "$DSP"; do
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 's3-conc-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
$PSQL >/dev/null <<SQL
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin'), ('$ORG', '$DSP', 'dispatcher');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', 'S3 concurrency fixture');
SQL
MEM=$($PSQL -c "select id from public.memberships where organization_id='$ORG' and user_id='$DSP'")
FAIL=0
active_count() { $PSQL -c "select count(*) from public.membership_module_grants where membership_id='$MEM' and revoked_at is null"; }
active_id() { $PSQL -c "select coalesce(id::text, 'null') from public.membership_module_grants where membership_id='$MEM' and revoked_at is null union all select 'null' limit 1"; }
active_access() { $PSQL -c "select coalesce((select access from public.membership_module_grants where membership_id='$MEM' and revoked_at is null), 'none')"; }
rows() { $PSQL -c "select count(*) from public.membership_module_grants where membership_id='$MEM'"; }
audits() { $PSQL -c "select count(*) from public.audit_events where organization_id='$ORG' and action like 'plus_member_access_%'"; }
expected() { [ "$1" = "null" ] && echo "null::uuid" || echo "'$1'::uuid"; }
run_as() { # $1 out prefix, $2 user, $3 call
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
changed_true() { cat "$@" | grep -c '^t$'; }
changed_false() { cat "$@" | grep -c '^f$'; }
stale() { cat "$@" | grep -c 'stale_state'; }
check() { # $1 name, $2 condition result (0 = ok)
  if [ "$2" = "0" ]; then echo "TEST $1: PASS"; else echo "TEST $1: FAIL"; FAIL=1; fi
}

echo "=== Scenario 1: double submit, same access (no grant yet) ==="
A0=$(audits)
run_as "$OUT/s1a" "$AD1" "select (public.plus_grant_member_access('$ORG', '$MEM', 'read', null::uuid)).changed" &
run_as "$OUT/s1b" "$AD2" "select (public.plus_grant_member_access('$ORG', '$MEM', 'read', null::uuid)).changed" &
wait
T=$(changed_true "$OUT/s1a.out" "$OUT/s1b.out"); F=$(changed_false "$OUT/s1a.out" "$OUT/s1b.out"); AUD=$(( $(audits) - A0 ))
echo "changed=$T noop=$F active=$(active_count) access=$(active_access) audits=$AUD"
[ "$T" = "1" ] && [ "$F" = "1" ] && [ "$(active_count)" = "1" ] && [ "$(active_access)" = "read" ] && [ "$AUD" = "1" ]
check "CONC-G1 (simultaneous identical grants: one change + one no-op, one active grant, one audit)" $?

echo "=== Scenario 2: different access from the same version (no active grant) ==="
V=$(active_id)
if [ "$V" != "null" ]; then
  $PSQL >/dev/null <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$AD1';
select public.plus_revoke_member_access('$ORG', '$MEM', '$V'::uuid);
commit;
SQL
fi
A0=$(audits)
run_as "$OUT/s2a" "$AD1" "select (public.plus_grant_member_access('$ORG', '$MEM', 'read', null::uuid)).changed" &
run_as "$OUT/s2b" "$AD2" "select (public.plus_grant_member_access('$ORG', '$MEM', 'write', null::uuid)).changed" &
wait
T=$(changed_true "$OUT/s2a.out" "$OUT/s2b.out"); S=$(stale "$OUT/s2a.err" "$OUT/s2b.err"); AUD=$(( $(audits) - A0 ))
WIN=$( [ "$(grep -c '^t$' "$OUT/s2a.out")" = "1" ] && echo read || echo write )
echo "applied=$T stale=$S active=$(active_count) access=$(active_access) winner=$WIN audits=$AUD"
[ "$T" = "1" ] && [ "$S" = "1" ] && [ "$(active_count)" = "1" ] && [ "$(active_access)" = "$WIN" ] && [ "$AUD" = "1" ]
check "CONC-G2 (READ vs WRITE grants from one version: one applies, the other ZW003, no silent overwrite, one audit)" $?

echo "=== Scenario 3: two different changes from the same version ==="
# normalise to an active READ grant first
V=$(active_id)
if [ "$(active_access)" != "read" ]; then
  $PSQL >/dev/null <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$AD1';
select public.plus_grant_member_access('$ORG', '$MEM', 'read', $(expected "$V"));
commit;
SQL
fi
V=$(active_id); A0=$(audits)
run_as "$OUT/s3a" "$AD1" "select (public.plus_grant_member_access('$ORG', '$MEM', 'write', $(expected "$V"))).changed" &
run_as "$OUT/s3b" "$AD2" "select (public.plus_revoke_member_access('$ORG', '$MEM', $(expected "$V"))).changed" &
wait
T=$(changed_true "$OUT/s3a.out" "$OUT/s3b.out"); S=$(stale "$OUT/s3a.err" "$OUT/s3b.err"); AUD=$(( $(audits) - A0 ))
echo "applied=$T stale=$S active=$(active_count) audits=$AUD"
[ "$T" = "1" ] && [ "$S" = "1" ] && [ "$(active_count)" -le "1" ] && [ "$AUD" = "1" ]
check "CONC-G3 (READ->WRITE vs revoke at one version: one applies, one ZW003, never two active grants)" $?

echo "=== Scenario 4: double revoke ==="
V=$(active_id)
if [ "$V" = "null" ]; then
  $PSQL >/dev/null <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$AD1';
select public.plus_grant_member_access('$ORG', '$MEM', 'write', null::uuid);
commit;
SQL
  V=$(active_id)
fi
A0=$(audits)
run_as "$OUT/s4a" "$AD1" "select (public.plus_revoke_member_access('$ORG', '$MEM', '$V'::uuid)).changed" &
run_as "$OUT/s4b" "$AD2" "select (public.plus_revoke_member_access('$ORG', '$MEM', '$V'::uuid)).changed" &
wait
T=$(changed_true "$OUT/s4a.out" "$OUT/s4b.out"); F=$(changed_false "$OUT/s4a.out" "$OUT/s4b.out"); AUD=$(( $(audits) - A0 ))
echo "revoked=$T noop=$F active=$(active_count) audits=$AUD"
[ "$T" = "1" ] && [ "$F" = "1" ] && [ "$(active_count)" = "0" ] && [ "$AUD" = "1" ]
check "CONC-G4 (simultaneous revokes: one revoke + one no-op, one audit)" $?

echo "=== Scenario 5: grant vs Core deactivation of the Dispatcher ==="
run_as "$OUT/s5a" "$AD1" "select (public.plus_grant_member_access('$ORG', '$MEM', 'write', null::uuid)).changed" &
run_as "$OUT/s5b" "$AD2" "select (public.set_membership_status('$MEM', false)).status" &
wait
EFFECTIVE=$($PSQL <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$DSP';
select public.plus_can_read('$ORG')::text || '/' || public.plus_can_write('$ORG')::text;
commit;
SQL
)
EFFECTIVE=$(echo "$EFFECTIVE" | grep -E '^(true|false)/' | head -1)
GRANT_RESULT=$(cat "$OUT/s5a.out" "$OUT/s5a.err" | grep -oE '^t$|invalid_input' | head -1)
echo "grant=$GRANT_RESULT membership=$($PSQL -c "select status from public.memberships where id='$MEM'") effective=$EFFECTIVE active=$(active_count)"
[ "$EFFECTIVE" = "false/false" ] && [ "$($PSQL -c "select status from public.memberships where id='$MEM'")" = "inactive" ] && [ "$(active_count)" -le "1" ]
check "CONC-G5 (grant racing Core deactivation: serialized; the deactivated Dispatcher has no effective Plus)" $?

HIST=$(rows); GRANTED=$($PSQL -c "select count(*) from public.audit_events where organization_id='$ORG' and action='plus_member_access_granted'")
echo "history rows=$HIST grant audits=$GRANTED"
[ "$($PSQL -c "select count(*) from public.membership_module_grants where membership_id='$MEM' and revoked_at is null")" -le "1" ] && [ "$HIST" = "$GRANTED" ]
check "CONC-G6 (invariant: never two active grants; every granted row kept as history: rows = grant audits)" $?
echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
