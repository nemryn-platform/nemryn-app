#!/bin/bash
# Nemryn Plus -- Contacts / activities under REAL concurrency (NP-P1-S4). Parallel psql processes, each its own
# transaction that holds its locks ~1s after the call, so the other session genuinely waits.
#
#   Scenario 1: two writers edit the SAME contact from the same version   -> one applies, the other ZW003 (no lost
#               update); exactly one plus_contact_updated audit; the final row is the winner's.
#   Scenario 2: archive vs edit from the same version                     -> exactly one applies, the other is refused.
#   Scenario 3: the same activity submitted twice at once (double submit) -> exactly one activity row.
#   Scenario 4: logging vs archiving at once                              -> serialized; a log that waited for the
#               archive is refused (ZW004); the contact ends archived with exactly one record_archived activity.
#
# Run with:  bash supabase/tests/plus_contacts_concurrency_test.sh
# Throwaway organization (Plus active) + two throwaway Admins, all removed on exit (also on failure). Synthetic data only.
set -uo pipefail
DB="${NEMRYN_TEST_DB:-postgres}"
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('S4 Contacts Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
OUT=$(mktemp -d)
cleanup() {
  $PSQL >/dev/null <<SQL
delete from public.audit_events where organization_id='$ORG';
delete from public.plus_activities where organization_id='$ORG';
delete from public.plus_contacts where organization_id='$ORG';
delete from public.organization_modules where organization_id='$ORG';
delete from public.memberships where organization_id='$ORG';
delete from public.organizations where id='$ORG';
delete from auth.users where id in ('$AD1','$AD2');
SQL
  rm -rf "$OUT"
}
trap cleanup EXIT
for u in "$AD1" "$AD2"; do
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 's4-conc-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
$PSQL >/dev/null <<SQL
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', 'S4 concurrency fixture');
SQL
FAIL=0
as_user() { # $1 user, $2 statement; one committed transaction; prints the result
  $PSQL <<SQL 2>&1 | grep -vE '^(BEGIN|SET|COMMIT)$'
begin; set local role authenticated; set local request.jwt.claim.sub = '$1';
$2;
commit;
SQL
}
run_as() { # $1 out prefix, $2 user, $3 call; holds its locks ~1s
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
new_contact() { # $1 name, $2 email -> contact id
  as_user "$AD1" "select (public.plus_create_contact('$ORG', '$1', null, '$2', 'individual', null, 'email', false, null, true)).contact_id" | head -1
}
ver() { $PSQL -c "select updated_at from public.plus_contacts where id='$1'"; }
count_t() { cat "$@" | grep -c '^t$'; }
count_err() { local pat="$1"; shift; cat "$@" | grep -c "$pat"; }
check() { if [ "$2" = "0" ]; then echo "TEST $1: PASS"; else echo "TEST $1: FAIL"; FAIL=1; fi; }

echo "=== Scenario 1: two edits from the same version ==="
C=$(new_contact "Concurrent Edit" "edit-$STAMP@example.test"); V=$(ver "$C")
run_as "$OUT/s1a" "$AD1" "select (public.plus_update_contact('$ORG', '$C', '$V', 'Edited By One', null, 'edit-$STAMP@example.test', 'individual', null, 'email', false, null)).changed" &
run_as "$OUT/s1b" "$AD2" "select (public.plus_update_contact('$ORG', '$C', '$V', 'Edited By Two', null, 'edit-$STAMP@example.test', 'individual', null, 'email', false, null)).changed" &
wait
OK=$(count_t "$OUT/s1a.out" "$OUT/s1b.out"); ST=$(count_err stale_state "$OUT/s1a.err" "$OUT/s1b.err")
FINAL=$($PSQL -c "select display_name from public.plus_contacts where id='$C'")
WIN=$( [ "$(grep -c '^t$' "$OUT/s1a.out")" = "1" ] && echo "Edited By One" || echo "Edited By Two")
AUD=$($PSQL -c "select count(*) from public.audit_events where entity_id='$C' and action='plus_contact_updated'")
echo "applied=$OK stale=$ST final='$FINAL' winner='$WIN' audits=$AUD"
[ "$OK" = "1" ] && [ "$ST" = "1" ] && [ "$FINAL" = "$WIN" ] && [ "$AUD" = "1" ]
check "CONC-C1 (simultaneous edits from one version: one applies, the other ZW003, no lost update, one audit)" $?

echo "=== Scenario 2: archive vs edit from the same version ==="
C=$(new_contact "Archive Or Edit" "arch-$STAMP@example.test"); V=$(ver "$C")
run_as "$OUT/s2a" "$AD1" "select (public.plus_archive_contact('$ORG', '$C', '$V', 'race')).changed" &
run_as "$OUT/s2b" "$AD2" "select (public.plus_update_contact('$ORG', '$C', '$V', 'Edited Instead', null, 'arch-$STAMP@example.test', 'individual', null, 'email', false, null)).changed" &
wait
OK=$(count_t "$OUT/s2a.out" "$OUT/s2b.out"); REF=$(cat "$OUT/s2a.err" "$OUT/s2b.err" | grep -cE 'stale_state|illegal_transition')
STATE=$($PSQL -c "select status || '/' || display_name from public.plus_contacts where id='$C'")
echo "applied=$OK refused=$REF final=$STATE"
[ "$OK" = "1" ] && [ "$REF" = "1" ] && { [ "$STATE" = "archived/Archive Or Edit" ] || [ "$STATE" = "active/Edited Instead" ]; }
check "CONC-C2 (archive vs edit from one version: exactly one applies, the other refused)" $?

echo "=== Scenario 3: the same activity submitted twice at once ==="
C=$(new_contact "Double Log" "log-$STAMP@example.test")
run_as "$OUT/s3a" "$AD1" "select (public.plus_log_contact_activity('$ORG', '$C', 'call_logged', 'Called once.', null)).changed" &
run_as "$OUT/s3b" "$AD1" "select (public.plus_log_contact_activity('$ORG', '$C', 'call_logged', 'Called once.', null)).changed" &
wait
ROWS=$($PSQL -c "select count(*) from public.plus_activities where contact_id='$C' and activity_type='call_logged'")
echo "changed=$(count_t "$OUT/s3a.out" "$OUT/s3b.out") noop=$(cat "$OUT/s3a.out" "$OUT/s3b.out" | grep -c '^f$') rows=$ROWS"
[ "$ROWS" = "1" ] && [ "$(count_t "$OUT/s3a.out" "$OUT/s3b.out")" = "1" ]
check "CONC-C3 (double submit of one activity: exactly one row)" $?

echo "=== Scenario 4: logging vs archiving at once ==="
C=$(new_contact "Log Or Archive" "la-$STAMP@example.test"); V=$(ver "$C")
run_as "$OUT/s4a" "$AD1" "select (public.plus_archive_contact('$ORG', '$C', '$V', null)).changed" &
sleep 0.3
run_as "$OUT/s4b" "$AD2" "select (public.plus_log_contact_activity('$ORG', '$C', 'note', 'Written during the archive.', null)).changed" &
wait
ARCH=$($PSQL -c "select status from public.plus_contacts where id='$C'")
RA=$($PSQL -c "select count(*) from public.plus_activities where contact_id='$C' and activity_type='record_archived'")
LOGREF=$(count_err illegal_transition "$OUT/s4b.err")
echo "archive_applied=$(count_t "$OUT/s4a.out") log_refused=$LOGREF status=$ARCH record_archived=$RA"
[ "$ARCH" = "archived" ] && [ "$RA" = "1" ] && [ "$LOGREF" = "1" ]
check "CONC-C4 (a log that waited for an in-flight archive is refused ZW004; contact archived once)" $?

echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
