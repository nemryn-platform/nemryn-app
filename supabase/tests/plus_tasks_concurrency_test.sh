#!/bin/bash
# Nemryn Plus -- tasks under REAL concurrency (NP-P2-S2, Phase A). Parallel psql processes, each holding its locks ~1s.
#
#   Scenario 1: complete vs cancel from the same version     -> exactly one applies, the other refused (ZW003 / ZW004).
#   Scenario 2: two completes at once (double submit)        -> one change + one idempotent no-op; one completion audit.
#   Scenario 3: two edits from the same version              -> one applies, the other ZW003 (no lost update).
#   Scenario 4: the same new task submitted twice at once    -> exactly one row.
#
# Run with:  bash supabase/tests/plus_tasks_concurrency_test.sh
# Throwaway organization (Plus active) + two throwaway Admins + a fictional contact, all removed on exit.
set -uo pipefail
DB="${NEMRYN_TEST_DB:-postgres}"
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('P2S2 Task Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
OUT=$(mktemp -d)
cleanup() {
  $PSQL >/dev/null <<SQL
delete from public.audit_events where organization_id='$ORG';
delete from public.plus_tasks where organization_id='$ORG';
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
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 'p2s2-task-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
$PSQL >/dev/null <<SQL
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', 'P2-S2 task concurrency fixture');
SQL
C=$($PSQL -c "insert into public.plus_contacts (organization_id, display_name, email, contact_kind, created_by) values ('$ORG', 'Task Concurrency Fictional', 'tc-$STAMP@example.test', 'individual', '$AD1') returning id" | head -1)
FAIL=0
as_user() { $PSQL <<SQL 2>&1 | grep -vE '^(BEGIN|SET|COMMIT)$'
begin; set local role authenticated; set local request.jwt.claim.sub = '$1';
$2;
commit;
SQL
}
run_as() { $PSQL > "$1.out" 2> "$1.err" <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$2';
$3;
reset role;
select pg_sleep(1.0);
commit;
SQL
}
task() { as_user "$AD1" "select (public.plus_create_task('$ORG', '$1', null, null, '$C', null)).task_id" | head -1; }
ver() { $PSQL -c "select updated_at from public.plus_tasks where id='$1'"; }
st() { $PSQL -c "select status from public.plus_tasks where id='$1'"; }
oks() { cat "$@" | grep -c '^t$'; }
check() { if [ "$2" = "0" ]; then echo "TEST $1: PASS"; else echo "TEST $1: FAIL"; FAIL=1; fi; }

echo "=== Scenario 1: complete vs cancel from one version ==="
T=$(task "Scenario one $STAMP"); V=$(ver "$T")
run_as "$OUT/s1a" "$AD1" "select (public.plus_complete_task('$ORG', '$T', '$V')).changed" &
run_as "$OUT/s1b" "$AD2" "select (public.plus_cancel_task('$ORG', '$T', '$V')).changed" &
wait
OK=$(oks "$OUT/s1a.out" "$OUT/s1b.out"); REF=$(cat "$OUT/s1a.err" "$OUT/s1b.err" | grep -cE 'stale_state|illegal_transition')
echo "applied=$OK refused=$REF final=$(st "$T")"
[ "$OK" = "1" ] && [ "$REF" = "1" ] && { [ "$(st "$T")" = "done" ] || [ "$(st "$T")" = "cancelled" ]; }
check "CONC-T1 (complete vs cancel: exactly one applies, the other refused)" $?

echo "=== Scenario 2: double complete ==="
T=$(task "Scenario two $STAMP"); V=$(ver "$T")
run_as "$OUT/s2a" "$AD1" "select (public.plus_complete_task('$ORG', '$T', '$V')).changed" &
run_as "$OUT/s2b" "$AD2" "select (public.plus_complete_task('$ORG', '$T', '$V')).changed" &
wait
AUD=$($PSQL -c "select count(*) from public.audit_events where entity_id='$T' and action='plus_task_completed'")
echo "changed=$(oks "$OUT/s2a.out" "$OUT/s2b.out") noop=$(cat "$OUT/s2a.out" "$OUT/s2b.out" | grep -c '^f$') audits=$AUD"
[ "$(oks "$OUT/s2a.out" "$OUT/s2b.out")" = "1" ] && [ "$(cat "$OUT/s2a.out" "$OUT/s2b.out" | grep -c '^f$')" = "1" ] && [ "$AUD" = "1" ]
check "CONC-T2 (double complete: one change + one no-op, one completion audit)" $?

echo "=== Scenario 3: two edits from one version ==="
T=$(task "Scenario three $STAMP"); V=$(ver "$T")
run_as "$OUT/s3a" "$AD1" "select (public.plus_update_task('$ORG', '$T', '$V', 'Edited by one', null, null)).changed" &
run_as "$OUT/s3b" "$AD2" "select (public.plus_update_task('$ORG', '$T', '$V', 'Edited by two', null, null)).changed" &
wait
OK=$(oks "$OUT/s3a.out" "$OUT/s3b.out"); ST=$(cat "$OUT/s3a.err" "$OUT/s3b.err" | grep -c stale_state)
WIN=$( [ "$(grep -c '^t$' "$OUT/s3a.out")" = "1" ] && echo "Edited by one" || echo "Edited by two")
FINAL=$($PSQL -c "select title from public.plus_tasks where id='$T'")
echo "applied=$OK stale=$ST final='$FINAL' winner='$WIN'"
[ "$OK" = "1" ] && [ "$ST" = "1" ] && [ "$FINAL" = "$WIN" ]
check "CONC-T3 (two edits from one version: one applies, the other ZW003, no lost update)" $?

echo "=== Scenario 4: the same new task twice at once ==="
run_as "$OUT/s4a" "$AD1" "select (public.plus_create_task('$ORG', 'Double task $STAMP', null, null, '$C', null)).changed" &
run_as "$OUT/s4b" "$AD1" "select (public.plus_create_task('$ORG', 'Double task $STAMP', null, null, '$C', null)).changed" &
wait
N=$($PSQL -c "select count(*) from public.plus_tasks where organization_id='$ORG' and title='Double task $STAMP'")
echo "rows=$N"
[ "$N" = "1" ]
check "CONC-T4 (double submit of one task: exactly one row)" $?

echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
