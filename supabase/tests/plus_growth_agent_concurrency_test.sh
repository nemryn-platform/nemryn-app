#!/bin/bash
# Nemryn Plus -- Growth Agent review queue under REAL concurrency (NP-P2-S2, Phase D). Parallel psql processes, each
# holding its locks ~1s after the call.
#
#   Scenario 1: two staff approve the SAME recommendation at once  -> exactly ONE task; the other gets already_approved
#               (or a stale refusal), never a second task.
#   Scenario 2: two staff run "Review opportunities" at once        -> serialized; exactly one recommendation per
#               situation (no duplicates).
#   Scenario 3: approve vs dismiss of the same recommendation       -> exactly one outcome applies.
#   Scenario 4: approve while another staff member is adding a task  -> the approval waits, sees the new task and
#               to that opportunity (NP-P2-S2-R1)                      withdraws the recommendation: ONE task, not two.
#   Scenario 5: approve while another staff member logs an activity -> the approval waits and withdraws it: no task.
#
# Run with:  bash supabase/tests/plus_growth_agent_concurrency_test.sh
# Throwaway organization (Plus active) + two throwaway Admins + fictional contacts / opportunities, removed on exit.
set -uo pipefail
DB="${NEMRYN_TEST_DB:-postgres}"
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('P2S2 Agent Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
OUT=$(mktemp -d)
cleanup() {
  $PSQL >/dev/null <<SQL
delete from public.audit_events where organization_id='$ORG';
delete from public.plus_agent_recommendations where organization_id='$ORG';
delete from public.plus_tasks where organization_id='$ORG';
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
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 'p2s2-agent-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
$PSQL >/dev/null <<SQL
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', 'P2-S2 agent concurrency fixture');
SQL
# four quiet, fictional opportunities (each its own contact), 20 days old with nothing recorded
for i in 1 2 3 4; do
  $PSQL >/dev/null <<SQL
with c as (insert into public.plus_contacts (organization_id, display_name, email, contact_kind, created_by, created_at)
           values ('$ORG', 'Agent Conc $i Fictional', 'agent-conc-$i-$STAMP@example.test', 'individual', '$AD1', now() - interval '30 days') returning id)
insert into public.plus_opportunities (organization_id, title, stage, primary_contact_id, source, created_by, created_at)
select '$ORG', 'Quiet $i', 'qualified', id, 'phone', '$AD1', now() - interval '20 days' from c;
SQL
done
FAIL=0
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
check() { if [ "$2" = "0" ]; then echo "TEST $1: PASS"; else echo "TEST $1: FAIL"; FAIL=1; fi; }

echo "=== Scenario 2 (first): two reviews at once ==="
run_as "$OUT/s2a" "$AD1" "select (public.plus_run_growth_agent_review('$ORG')).created" &
run_as "$OUT/s2b" "$AD2" "select (public.plus_run_growth_agent_review('$ORG')).created" &
wait
N=$($PSQL -c "select count(*) from public.plus_agent_recommendations where organization_id='$ORG'")
DUP=$($PSQL -c "select count(*) from (select opportunity_id from public.plus_agent_recommendations where organization_id='$ORG' group by 1 having count(*) > 1) d")
echo "created=$(cat "$OUT/s2a.out" "$OUT/s2b.out" | grep -E '^[0-9]+$' | paste -sd+ - | bc) rows=$N duplicates=$DUP errors=$(cat "$OUT/s2a.err" "$OUT/s2b.err" | grep -c ERROR)"
[ "$N" = "4" ] && [ "$DUP" = "0" ] && [ "$(cat "$OUT/s2a.err" "$OUT/s2b.err" | grep -c ERROR)" = "0" ]
check "CONC-G2 (simultaneous reviews: serialized, exactly one recommendation per situation)" $?

echo "=== Scenario 1: two approvals of one recommendation at once ==="
R=$($PSQL -c "select r.id from public.plus_agent_recommendations r join public.plus_opportunities o on o.id = r.opportunity_id where r.organization_id='$ORG' and o.title='Quiet 1'")
V=$($PSQL -c "select updated_at from public.plus_agent_recommendations where id='$R'")
run_as "$OUT/s1a" "$AD1" "select (public.plus_approve_agent_recommendation('$ORG', '$R', '$V', 'Follow up: Quiet 1', null, null)).outcome" &
run_as "$OUT/s1b" "$AD2" "select (public.plus_approve_agent_recommendation('$ORG', '$R', '$V', 'Follow up: Quiet 1', null, null)).outcome" &
wait
TASKS=$($PSQL -c "select count(*) from public.plus_tasks where organization_id='$ORG'")
APPROVED=$(cat "$OUT/s1a.out" "$OUT/s1b.out" | grep -c '^approved$')
OTHER=$(cat "$OUT/s1a.out" "$OUT/s1b.out" "$OUT/s1a.err" "$OUT/s1b.err" | grep -cE '^already_approved$|stale_state')
echo "approved=$APPROVED other=$OTHER tasks=$TASKS status=$($PSQL -c "select status from public.plus_agent_recommendations where id='$R'")"
[ "$TASKS" = "1" ] && [ "$APPROVED" = "1" ] && [ "$OTHER" = "1" ]
check "CONC-G1 (simultaneous approvals: exactly one task, never two)" $?

echo "=== Scenario 3: approve vs dismiss ==="
R=$($PSQL -c "select r.id from public.plus_agent_recommendations r join public.plus_opportunities o on o.id = r.opportunity_id where r.organization_id='$ORG' and o.title='Quiet 2'")
V=$($PSQL -c "select updated_at from public.plus_agent_recommendations where id='$R'")
run_as "$OUT/s3a" "$AD1" "select (public.plus_approve_agent_recommendation('$ORG', '$R', '$V', 'Follow up: Quiet 2', null, null)).outcome" &
run_as "$OUT/s3b" "$AD2" "select (public.plus_dismiss_agent_recommendation('$ORG', '$R', '$V', 'dismissed')).outcome" &
wait
ST=$($PSQL -c "select status from public.plus_agent_recommendations where id='$R'")
T2=$($PSQL -c "select count(*) from public.plus_tasks t join public.plus_opportunities o on o.id = t.opportunity_id where o.title='Quiet 2' and o.organization_id='$ORG'")
REF=$(cat "$OUT/s3a.err" "$OUT/s3b.err" | grep -cE 'stale_state|illegal_transition')
echo "status=$ST tasks_for_it=$T2 refused=$REF"
{ { [ "$ST" = "approved" ] && [ "$T2" = "1" ]; } || { [ "$ST" = "dismissed" ] && [ "$T2" = "0" ]; }; } && [ "$REF" = "1" ]
check "CONC-G3 (approve vs dismiss: exactly one outcome, the other refused)" $?

rec_of() { $PSQL -c "select r.id || '|' || r.updated_at || '|' || o.id || '|' || o.primary_contact_id from public.plus_agent_recommendations r join public.plus_opportunities o on o.id = r.opportunity_id where r.organization_id='$ORG' and o.title='$1'"; }

echo "=== Scenario 4: approve while another staff member is adding a task to the same opportunity ==="
ROW=$(rec_of 'Quiet 3'); IFS='|' read -r R V OPP CON <<< "$ROW"
run_as "$OUT/s4b" "$AD2" "select (public.plus_create_task('$ORG', 'Manual follow-up: Quiet 3', null, null, null, '$OPP')).changed" &
sleep 0.3
run_as "$OUT/s4a" "$AD1" "select (public.plus_approve_agent_recommendation('$ORG', '$R', '$V', 'Follow up: Quiet 3', null, null)).outcome" &
wait
T4=$($PSQL -c "select count(*) from public.plus_tasks where opportunity_id='$OPP'")
ST4=$($PSQL -c "select status from public.plus_agent_recommendations where id='$R'")
echo "approve_outcome=$(cat "$OUT/s4a.out" | grep -E '^[a-z_]+$' | head -1) status=$ST4 tasks_for_opportunity=$T4 errors=$(cat "$OUT/s4a.err" "$OUT/s4b.err" | grep -c ERROR)"
[ "$T4" = "1" ] && [ "$ST4" = "superseded" ] && [ "$(cat "$OUT/s4a.err" "$OUT/s4b.err" | grep -c ERROR)" = "0" ]
check "CONC-G4 (approval racing a manual task: recommendation withdrawn, no second task)" $?

echo "=== Scenario 5: approve while another staff member logs an activity on the contact ==="
ROW=$(rec_of 'Quiet 4'); IFS='|' read -r R V OPP CON <<< "$ROW"
run_as "$OUT/s5b" "$AD2" "select (public.plus_log_contact_activity('$ORG', '$CON', 'note', 'Spoke on the phone.', now())).activity_id" &
sleep 0.3
run_as "$OUT/s5a" "$AD1" "select (public.plus_approve_agent_recommendation('$ORG', '$R', '$V', 'Follow up: Quiet 4', null, null)).outcome" &
wait
T5=$($PSQL -c "select count(*) from public.plus_tasks where opportunity_id='$OPP'")
ST5=$($PSQL -c "select status from public.plus_agent_recommendations where id='$R'")
echo "approve_outcome=$(cat "$OUT/s5a.out" | grep -E '^[a-z_]+$' | head -1) status=$ST5 tasks_for_opportunity=$T5 errors=$(cat "$OUT/s5a.err" "$OUT/s5b.err" | grep -c ERROR)"
[ "$T5" = "0" ] && [ "$ST5" = "superseded" ] && [ "$(cat "$OUT/s5a.err" "$OUT/s5b.err" | grep -c ERROR)" = "0" ]
check "CONC-G5 (approval racing a logged activity: recommendation withdrawn, no task)" $?

echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
