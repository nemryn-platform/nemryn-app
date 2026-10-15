#!/bin/bash
# Nemryn Plus -- private-pay opportunities under REAL concurrency (NP-P2-S1). Parallel psql processes, each its own
# transaction holding its locks ~1s after the call, so the other session genuinely waits.
#
#   Scenario 1: two stage changes from the same version (to different stages)  -> one applies, the other ZW003;
#               exactly one stage_changed row; the final stage is the winner's.
#   Scenario 2: mark lost vs stage change from the same version                 -> exactly one applies, the other refused.
#   Scenario 3: two reopens of the same lost opportunity from the same version  -> one applies, the other ZW003;
#               exactly one lost -> open history row.
#   Scenario 4: the same new opportunity submitted twice at once                -> exactly one row.
#   Scenario 5: owner change vs stage change from the same version              -> one applies, the other ZW003.
#   Scenario 6: archiving the contact vs creating an opportunity for it         -> serialized on the contact row: either
#               the opportunity was created first, or the create is refused (ZW006) -- never one for an already
#               archived contact.
#
# Run with:  bash supabase/tests/plus_opportunities_concurrency_test.sh
# Throwaway organization (Plus active), two throwaway Admins and fictional contacts, all removed on exit.
set -uo pipefail
DB="${NEMRYN_TEST_DB:-postgres}"
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('P2S1 Pipeline Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
OUT=$(mktemp -d)
cleanup() {
  $PSQL >/dev/null <<SQL
delete from public.audit_events where organization_id='$ORG';
delete from public.plus_activities where organization_id='$ORG';
delete from public.plus_opportunities where organization_id='$ORG';
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
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 'p2s1-conc-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
$PSQL >/dev/null <<SQL
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', 'P2-S1 concurrency fixture');
SQL
M2=$($PSQL -c "select id from public.memberships where organization_id='$ORG' and user_id='$AD2'")
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
contact() { $PSQL -c "insert into public.plus_contacts (organization_id, display_name, email, contact_kind, created_by) values ('$ORG', '$1', '$2', 'individual', '$AD1') returning id" | head -1; }
opp() { as_user "$AD1" "select (public.plus_create_opportunity('$ORG', '$1', '$2', 'quote', null, 'phone', null, null, null, null)).opportunity_id" | head -1; }
ver() { $PSQL -c "select updated_at from public.plus_opportunities where id='$1'"; }
stg() { $PSQL -c "select stage from public.plus_opportunities where id='$1'"; }
rows() { $PSQL -c "select count(*) from public.plus_activities where opportunity_id='$1' and activity_type='$2'"; }
ok_count() { cat "$@" | grep -cE '^t$|^true$'; }
check() { if [ "$2" = "0" ]; then echo "TEST $1: PASS"; else echo "TEST $1: FAIL"; FAIL=1; fi; }
C=$(contact "Concurrency Fictional" "conc-$STAMP@example.test")

echo "=== Scenario 1: two stage changes from one version ==="
O=$(opp "$C" "Scenario one $STAMP"); V=$(ver "$O")
run_as "$OUT/s1a" "$AD1" "select (public.plus_change_opportunity_stage('$ORG', '$O', '$V', 'contacted', null)).changed" &
run_as "$OUT/s1b" "$AD2" "select (public.plus_change_opportunity_stage('$ORG', '$O', '$V', 'qualified', null)).changed" &
wait
OK=$(ok_count "$OUT/s1a.out" "$OUT/s1b.out"); ST=$(cat "$OUT/s1a.err" "$OUT/s1b.err" | grep -c stale_state)
WIN=$( [ "$(grep -c '^t$' "$OUT/s1a.out")" = "1" ] && echo contacted || echo qualified)
echo "applied=$OK stale=$ST final=$(stg "$O") winner=$WIN rows=$(rows "$O" stage_changed)"
[ "$OK" = "1" ] && [ "$ST" = "1" ] && [ "$(stg "$O")" = "$WIN" ] && [ "$(rows "$O" stage_changed)" = "1" ]
check "CONC-O1 (simultaneous stage changes: one applies, the other ZW003, one history row)" $?

echo "=== Scenario 2: mark lost vs stage change from one version ==="
O=$(opp "$C" "Scenario two $STAMP"); V=$(ver "$O")
run_as "$OUT/s2a" "$AD1" "select (public.plus_mark_opportunity_lost('$ORG', '$O', '$V', 'price', null)).changed" &
run_as "$OUT/s2b" "$AD2" "select (public.plus_change_opportunity_stage('$ORG', '$O', '$V', 'qualified', null)).changed" &
wait
OK=$(ok_count "$OUT/s2a.out" "$OUT/s2b.out"); REF=$(cat "$OUT/s2a.err" "$OUT/s2b.err" | grep -cE 'stale_state|illegal_transition')
echo "applied=$OK refused=$REF final=$(stg "$O") rows=$(rows "$O" stage_changed)"
[ "$OK" = "1" ] && [ "$REF" = "1" ] && [ "$(rows "$O" stage_changed)" = "1" ] && { [ "$(stg "$O")" = "lost" ] || [ "$(stg "$O")" = "qualified" ]; }
check "CONC-O2 (lost vs stage change: exactly one applies, the other refused)" $?

echo "=== Scenario 3: two reopens from one version ==="
O=$(opp "$C" "Scenario three $STAMP")
as_user "$AD1" "select public.plus_mark_opportunity_lost('$ORG', '$O', '$(ver "$O")', 'no_response', null)" >/dev/null
V=$(ver "$O")
run_as "$OUT/s3a" "$AD1" "select (public.plus_reopen_opportunity('$ORG', '$O', '$V', 'contacted', 'They called back.')).changed" &
run_as "$OUT/s3b" "$AD2" "select (public.plus_reopen_opportunity('$ORG', '$O', '$V', 'qualified', 'They emailed.')).changed" &
wait
OK=$(ok_count "$OUT/s3a.out" "$OUT/s3b.out"); ST=$(cat "$OUT/s3a.err" "$OUT/s3b.err" | grep -c stale_state)
REOPENS=$($PSQL -c "select count(*) from public.plus_activities where opportunity_id='$O' and from_stage='lost'")
echo "applied=$OK stale=$ST final=$(stg "$O") reopen_rows=$REOPENS"
[ "$OK" = "1" ] && [ "$ST" = "1" ] && [ "$REOPENS" = "1" ]
check "CONC-O3 (simultaneous reopens: one applies, the other ZW003, one reopen row)" $?

echo "=== Scenario 4: the same new opportunity submitted twice at once ==="
run_as "$OUT/s4a" "$AD1" "select (public.plus_create_opportunity('$ORG', '$C', 'Double submit $STAMP', 'quote', null, 'phone', null, null, null, null)).changed" &
run_as "$OUT/s4b" "$AD1" "select (public.plus_create_opportunity('$ORG', '$C', 'Double submit $STAMP', 'quote', null, 'phone', null, null, null, null)).changed" &
wait
N=$($PSQL -c "select count(*) from public.plus_opportunities where organization_id='$ORG' and title='Double submit $STAMP'")
echo "rows=$N changed=$(ok_count "$OUT/s4a.out" "$OUT/s4b.out") noop=$(cat "$OUT/s4a.out" "$OUT/s4b.out" | grep -c '^f$')"
[ "$N" = "1" ]
check "CONC-O4 (double submit of one opportunity: exactly one row)" $?

echo "=== Scenario 5: owner change vs stage change from one version ==="
O=$(opp "$C" "Scenario five $STAMP"); V=$(ver "$O")
run_as "$OUT/s5a" "$AD1" "select (public.plus_update_opportunity('$ORG', '$O', '$V', '$C', 'Scenario five $STAMP', 'quote', null, 'phone', null, null, null, 'none', '$M2')).changed" &
run_as "$OUT/s5b" "$AD2" "select (public.plus_change_opportunity_stage('$ORG', '$O', '$V', 'contacted', null)).changed" &
wait
OK=$(ok_count "$OUT/s5a.out" "$OUT/s5b.out"); ST=$(cat "$OUT/s5a.err" "$OUT/s5b.err" | grep -c stale_state)
echo "applied=$OK stale=$ST"
[ "$OK" = "1" ] && [ "$ST" = "1" ]
check "CONC-O5 (owner change vs stage change: one applies, the other ZW003)" $?

echo "=== Scenario 6: archive the contact vs create an opportunity for it ==="
C6=$(contact "Archive Race Fictional" "race-$STAMP@example.test"); CV=$($PSQL -c "select updated_at from public.plus_contacts where id='$C6'")
run_as "$OUT/s6a" "$AD1" "select (public.plus_archive_contact('$ORG', '$C6', '$CV', null)).changed" &
sleep 0.3
run_as "$OUT/s6b" "$AD2" "select (public.plus_create_opportunity('$ORG', '$C6', 'Race $STAMP', 'quote', null, 'phone', null, null, null, null)).changed" &
wait
CREATED=$($PSQL -c "select count(*) from public.plus_opportunities where primary_contact_id='$C6'")
REFUSED=$(grep -c invalid_input "$OUT/s6b.err")
echo "contact=$($PSQL -c "select status from public.plus_contacts where id='$C6'") created=$CREATED create_refused=$REFUSED"
[ "$($PSQL -c "select status from public.plus_contacts where id='$C6'")" = "archived" ] && { [ "$CREATED" = "0" ] && [ "$REFUSED" = "1" ]; }
check "CONC-O6 (create that waited for an in-flight archive is refused ZW006: no opportunity for an archived contact)" $?

echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
