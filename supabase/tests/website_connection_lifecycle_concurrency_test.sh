#!/bin/bash
# Nemryn -- genuine concurrent tests for the website connection lifecycle (P1-COMM-D2A). Each caller is a SEPARATE
# psql process / connection (never simulated in one connection).
#
#   CASE A  unused active website integration + a FIRST public Request racing an Admin's Delete
#           Required: NEVER an accepted Request referencing a since-deleted integration. Either the Request commits
#           first (integration becomes used -> delete is then refused) or the delete commits first (submission is
#           then safely rejected). Exactly one of the two outcomes; no orphan, no crash.
#   CASE B  used, active website integration + a NEW incoming Request racing an Admin's Remove (retire)
#           Required: deterministic -- if the Request commits first it is preserved and retirement still succeeds
#           afterward; if retirement commits first the racing submission is safely rejected. No half-committed state.
#   CASE C  two simultaneous Delete calls on the SAME unused integration
#           Required: idempotent-safe -- exactly one delete succeeds, the row ends up gone either way, no crash.
#   CASE D  two simultaneous Remove (retire) calls on the SAME used integration
#           Required: idempotent-safe -- exactly one call reports changed=true, the other changed=false, the row
#           ends up retired exactly once (one audit event), no crash.
set -u
FAIL_COUNT=0
ORG_A='10000000-0000-0000-0000-0000000000a1'
ADMIN='20000000-0000-0000-0000-0000000000a1'
N=6

psql_exec() { docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA; }
check() { if [ "$2" = "$3" ]; then echo "PASS — $1 ($2)"; else echo "FAIL — $1 (expected $3, got $2)"; FAIL_COUNT=$((FAIL_COUNT+1)); fi; }

cleanup() {
psql_exec <<SQL >/dev/null
delete from public.notification_events where entity_id in (select id from public.transportation_requests where requester_name like 'D2AC %');
delete from public.request_acquisition_attributions where request_id in (select id from public.transportation_requests where requester_name like 'D2AC %');
delete from public.request_events where request_id in (select id from public.transportation_requests where requester_name like 'D2AC %');
delete from public.transportation_requests where requester_name like 'D2AC %';
delete from public.audit_events where organization_id = '$ORG_A' and action in ('website_connection_deleted', 'website_connection_retired');
delete from public.request_intake_integrations where organization_id = '$ORG_A' and external_id like 'd2ac-%';
SQL
}

# ------------------------------------------------------------------ CASE A: delete vs first submission
echo "=== CASE A: unused integration -- Delete races the FIRST public Request ($N parallel submissions + 1 delete) ==="
cleanup
INT_ID='d2ac0000-0000-0000-0000-00000000ac01'
psql_exec <<SQL >/dev/null
insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins)
values ('$INT_ID', '$ORG_A', 'd2ac-race-a', 'website', true, array['https://d2ac-race-a.example.test']);
SQL
rm -f /tmp/d2ac_a_*.log
for i in $(seq 1 $N); do
  docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA > /tmp/d2ac_a_sub_$i.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.5);
SET LOCAL ROLE service_role;
SELECT 'SUB|' || accepted::text FROM public.submit_public_transportation_request(
  p_integration_external_id => 'd2ac-race-a', p_idempotency_key => 'd2ac-race-a-key-$i', p_requester_name => 'D2AC Racer $i',
  p_requester_relationship => 'self', p_requester_phone => '555-010$i', p_pickup_description => 'p', p_destination_description => 'd',
  p_return_trip_needed => 'no', p_origin => 'https://d2ac-race-a.example.test');
COMMIT;
SQL
done
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA > /tmp/d2ac_a_del.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.5);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT 'DEL|' || changed::text FROM public.delete_unused_request_intake_integration('$INT_ID');
COMMIT;
SQL
wait
ROW_EXISTS=$(psql_exec <<SQL
select count(*) from public.request_intake_integrations where id = '$INT_ID';
SQL
)
REQ_COUNT=$(psql_exec <<SQL
select count(*) from public.transportation_requests where requester_name like 'D2AC Racer%';
SQL
)
ORPHAN=$(psql_exec <<SQL
select count(*) from public.transportation_requests r where r.requester_name like 'D2AC Racer%' and not exists (select 1 from public.request_intake_integrations i where i.id = r.intake_integration_id);
SQL
)
DEL_OK=$(cat /tmp/d2ac_a_del.log | grep -c '^DEL|true$')
DEL_ERR=$(cat /tmp/d2ac_a_del.log | grep -ci "ERROR:  invalid_input")
ERRS=$(cat /tmp/d2ac_a_sub_*.log | grep -ci "error" )
check "A: no unexpected caller error (submissions never error; the delete may cleanly report invalid_input)" "$((ERRS))" "0"
check "A: NEVER an orphaned Request (a Request whose integration no longer exists)" "$ORPHAN" "0"
if [ "$REQ_COUNT" -gt 0 ]; then
  check "A: a Request committed first -> the integration is now USED -> delete correctly refused" "$DEL_OK/$ROW_EXISTS" "0/1"
else
  check "A: the delete committed first -> the row is gone -> every racing submission was safely rejected" "$REQ_COUNT/$ROW_EXISTS" "0/0"
fi
check "A: exactly one deterministic outcome (row exists XOR any Request committed is impossible; both empty is impossible)" "$([ "$ROW_EXISTS" = "0" ] || [ "$REQ_COUNT" -gt 0 ] && echo yes || echo no)" "yes"

# ------------------------------------------------------------------ CASE B: retire vs new submission
echo "=== CASE B: used integration -- Remove (retire) races a NEW incoming Request ($N parallel submissions + 1 retire) ==="
cleanup
INT_ID='d2ac0000-0000-0000-0000-00000000ac02'
psql_exec <<SQL >/dev/null
insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins)
values ('$INT_ID', '$ORG_A', 'd2ac-race-b', 'website', true, array['https://d2ac-race-b.example.test']);
SQL
# seed the integration as genuinely USED before the race (one prior accepted Request)
psql_exec <<SQL >/dev/null
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.submit_public_transportation_request(p_integration_external_id => 'd2ac-race-b', p_idempotency_key => 'd2ac-race-b-seed', p_requester_name => 'D2AC Seed',
  p_requester_relationship => 'self', p_requester_phone => '555-0100', p_pickup_description => 'p', p_destination_description => 'd', p_return_trip_needed => 'no',
  p_origin => 'https://d2ac-race-b.example.test');
COMMIT;
SQL
rm -f /tmp/d2ac_b_*.log
for i in $(seq 1 $N); do
  docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA > /tmp/d2ac_b_sub_$i.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.5);
SET LOCAL ROLE service_role;
SELECT 'SUB|' || accepted::text FROM public.submit_public_transportation_request(
  p_integration_external_id => 'd2ac-race-b', p_idempotency_key => 'd2ac-race-b-key-$i', p_requester_name => 'D2AC RaceB $i',
  p_requester_relationship => 'self', p_requester_phone => '555-010$i', p_pickup_description => 'p', p_destination_description => 'd',
  p_return_trip_needed => 'no', p_origin => 'https://d2ac-race-b.example.test');
COMMIT;
SQL
done
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA > /tmp/d2ac_b_ret.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.5);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT 'RET|' || changed::text FROM public.retire_request_intake_integration('$INT_ID');
COMMIT;
SQL
wait
RETIRED=$(psql_exec <<SQL
select (retired_at is not null)::text from public.request_intake_integrations where id = '$INT_ID';
SQL
)
ACCEPTED=$(cat /tmp/d2ac_b_sub_*.log | grep -c '^SUB|true$')
REJECTED=$(cat /tmp/d2ac_b_sub_*.log | grep -ci "ERROR:  invalid_input")
RET_OK=$(cat /tmp/d2ac_b_ret.log | grep -c '^RET|true$')
ORPHAN=$(psql_exec <<SQL
select count(*) from public.transportation_requests r where r.requester_name like 'D2AC RaceB%' and not exists (select 1 from public.request_intake_integrations i where i.id = r.intake_integration_id);
SQL
)
check "B: retirement ALWAYS eventually succeeds (retiring a used connection is exactly what this is for)" "$RETIRED" "true"
check "B: the retire call itself reported changed=true exactly once" "$RET_OK" "1"
check "B: every racing submission was deterministically either accepted or cleanly rejected -- no half-committed state" "$((ACCEPTED + REJECTED))" "$N"
check "B: no orphaned Request" "$ORPHAN" "0"

# ------------------------------------------------------------------ CASE C: double delete
echo "=== CASE C: $N simultaneous Delete calls on the SAME unused integration ==="
cleanup
INT_ID='d2ac0000-0000-0000-0000-00000000ac03'
psql_exec <<SQL >/dev/null
insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins)
values ('$INT_ID', '$ORG_A', 'd2ac-race-c', 'website', false, array['https://d2ac-race-c.example.test']);
SQL
rm -f /tmp/d2ac_c_*.log
for i in $(seq 1 $N); do
  docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA > /tmp/d2ac_c_$i.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.4);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT 'DEL|' || changed::text FROM public.delete_unused_request_intake_integration('$INT_ID');
COMMIT;
SQL
done
wait
ROW_EXISTS=$(psql_exec <<SQL
select count(*) from public.request_intake_integrations where id = '$INT_ID';
SQL
)
OKS=$(cat /tmp/d2ac_c_*.log | grep -c '^DEL|true$')
NOTFOUND=$(cat /tmp/d2ac_c_*.log | grep -ci "ERROR:  not_found")
CRASH=$(cat /tmp/d2ac_c_*.log | grep -i "ERROR:" | grep -civ "not_found")
check "C: the row is gone" "$ROW_EXISTS" "0"
check "C: exactly ONE caller actually deleted it" "$OKS" "1"
check "C: every other caller got a clean not-found, none crashed unexpectedly" "$((OKS + NOTFOUND))" "$N"
check "C: no unexpected error text" "$CRASH" "0"

# ------------------------------------------------------------------ CASE D: double retire
echo "=== CASE D: $N simultaneous Remove (retire) calls on the SAME used integration ==="
cleanup
INT_ID='d2ac0000-0000-0000-0000-00000000ac04'
psql_exec <<SQL >/dev/null
insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active, allowed_origins)
values ('$INT_ID', '$ORG_A', 'd2ac-race-d', 'website', true, array['https://d2ac-race-d.example.test']);
SQL
rm -f /tmp/d2ac_d_*.log
for i in $(seq 1 $N); do
  docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA > /tmp/d2ac_d_$i.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.4);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT 'RET|' || changed::text FROM public.retire_request_intake_integration('$INT_ID');
COMMIT;
SQL
done
wait
RETIRED_TRUE=$(cat /tmp/d2ac_d_*.log | grep -c '^RET|true$')
RETIRED_FALSE=$(cat /tmp/d2ac_d_*.log | grep -c '^RET|false$')
AUDITS=$(psql_exec <<SQL
select count(*) from public.audit_events where organization_id = '$ORG_A' and action = 'website_connection_retired' and entity_id = '$INT_ID';
SQL
)
check "D: exactly ONE caller reports changed=true (actually retired it)" "$RETIRED_TRUE" "1"
check "D: every other caller reports changed=false (safe idempotent no-op)" "$RETIRED_FALSE" "$((N-1))"
check "D: exactly ONE audit event (no duplicate retirement history)" "$AUDITS" "1"

cleanup
rm -f /tmp/d2ac_*.log
echo "=== FAIL_COUNT=$FAIL_COUNT ==="
exit $FAIL_COUNT
