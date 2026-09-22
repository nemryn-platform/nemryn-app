#!/bin/bash
# Nemryn -- genuine concurrent tests for the form PUBLICATION and the public submission path (P1-COMM-D2).
# Each caller is a SEPARATE psql process / connection.
#
#   CASE A  6 parallel FIRST publishes (same Organization Admin)      -> 1 publication, 1 binding, 1 audit, one public key,
#                                                                        exactly 1 caller reports changed=true
#   CASE B  6 parallel submissions, SAME idempotency key               -> 1 Request, 1 attribution, 1 notification, all accepted,
#                                                                        exactly 1 "new"
#   CASE C  6 parallel submissions, DIFFERENT keys                     -> 6 Requests, 6 notifications (nothing is over-collapsed)
#   CASE D  publish UPDATE (v2) racing 6 submissions that saw v1       -> all accepted, one Request each, every snapshot records
#                                                                        the version the passenger saw (nemryn-form-v1), no attribution rewriting
#   CASE E  DISABLE racing 6 submissions                                -> no error; Requests == accepted submissions; once the
#                                                                        disable committed, a new submission is rejected
set -u
FAIL_COUNT=0
ORG_A='10000000-0000-0000-0000-0000000000a1'
ADMIN='20000000-0000-0000-0000-0000000000a1'
N=6

psql_exec() { docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA; }
check() { if [ "$2" = "$3" ]; then echo "PASS — $1 ($2)"; else echo "FAIL — $1 (expected $3, got $2)"; FAIL_COUNT=$((FAIL_COUNT+1)); fi; }

cleanup() {
psql_exec <<SQL >/dev/null
delete from public.notification_events where entity_id in (select id from public.transportation_requests where requester_name like 'D2C %');
delete from public.request_acquisition_attributions where request_id in (select id from public.transportation_requests where requester_name like 'D2C %');
delete from public.request_events where request_id in (select id from public.transportation_requests where requester_name like 'D2C %');
delete from public.transportation_requests where requester_name like 'D2C %';
delete from public.audit_events where organization_id = '$ORG_A' and action in ('website_request_form_published', 'website_request_form_unpublished', 'website_request_form_updated');
delete from public.website_request_form_publications where organization_id = '$ORG_A';
delete from public.request_intake_integrations where organization_id = '$ORG_A' and integration_type = 'nemryn_form';
delete from public.website_request_forms where organization_id = '$ORG_A';
SQL
}

as_admin() { # runs one statement as the Organization Admin (authenticated) inside a transaction
cat <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
$1
COMMIT;
SQL
}
seed_ready_form() {
  psql_exec <<SQL >/dev/null
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT * FROM public.save_website_request_form('$ORG_A', 'Concurrency form', 'Send', 'Thanks.', true, false, 'ready', null, null::text[]);
COMMIT;
SQL
}
publish_once() { psql_exec <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT public_key FROM public.publish_website_request_form('$ORG_A');
COMMIT;
SQL
}
sub_sql() { # $1 key, $2 idempotency, $3 name, $4 acquisition json
cat <<SQL
BEGIN;
SELECT pg_sleep(${5:-0.6});
SET LOCAL ROLE service_role;
SELECT 'RESULT|' || r.accepted::text || '|' || (r.notification_event_id is not null)::text FROM public.submit_public_form_request(
  p_public_key => '$1', p_idempotency_key => '$2', p_requester_name => '$3', p_requester_relationship => 'self',
  p_requester_phone => '555-0100', p_pickup_description => 'D2C pickup', p_destination_description => 'D2C destination',
  p_return_trip_needed => 'no', p_acquisition => '$4'::jsonb) r;
COMMIT;
SQL
}
count_requests() { psql_exec <<SQL
select count(*) from public.transportation_requests where requester_name like 'D2C %';
SQL
}

# ------------------------------------------------------------------ CASE A
echo "=== CASE A: $N parallel first publishes ==="
cleanup; seed_ready_form
rm -f /tmp/d2c_a_*.log
for i in $(seq 1 $N); do
  docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA > /tmp/d2c_a_$i.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.6);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT 'RESULT|' || public_key || '|' || changed::text FROM public.publish_website_request_form('$ORG_A');
COMMIT;
SQL
done
wait
PUBS=$(psql_exec <<SQL
select count(*) from public.website_request_form_publications where organization_id = '$ORG_A';
SQL
)
BINDINGS=$(psql_exec <<SQL
select count(*) from public.request_intake_integrations where organization_id = '$ORG_A' and integration_type = 'nemryn_form';
SQL
)
AUDITS=$(psql_exec <<SQL
select count(*) from public.audit_events where organization_id = '$ORG_A' and action = 'website_request_form_published';
SQL
)
KEYS=$(cat /tmp/d2c_a_*.log | grep '^RESULT|' | cut -d'|' -f2 | sort -u | wc -l | tr -d ' ')
CHANGED=$(cat /tmp/d2c_a_*.log | grep -c '^RESULT|.*|true$')
OKS=$(cat /tmp/d2c_a_*.log | grep -c '^RESULT|')
ERRS=$(cat /tmp/d2c_a_*.log | grep -ci "error")
check "A: no caller errored" "$ERRS" "0"; check "A: every caller got a result" "$OKS" "$N"
check "A: exactly one publication" "$PUBS" "1"; check "A: exactly one hidden binding" "$BINDINGS" "1"
check "A: one audit event" "$AUDITS" "1"; check "A: every caller received the SAME public key" "$KEYS" "1"
check "A: exactly one caller reports changed=true" "$CHANGED" "1"
KEY=$(psql_exec <<SQL
select public_key from public.website_request_form_publications where organization_id = '$ORG_A';
SQL
)

# ------------------------------------------------------------------ CASE B
echo "=== CASE B: $N parallel submissions, SAME idempotency key ==="
rm -f /tmp/d2c_b_*.log
for i in $(seq 1 $N); do
  sub_sql "$KEY" "D2C-SAME-KEY" "D2C Same" '{"utmSource":"session-'$i'","landingPath":"/l-'$i'"}' | docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA > /tmp/d2c_b_$i.log 2>&1 &
done
wait
REQ=$(count_requests)
ATTR=$(psql_exec <<SQL
select count(*) from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name like 'D2C %';
SQL
)
NOTIF=$(psql_exec <<SQL
select count(*) from public.notification_events where entity_id in (select id from public.transportation_requests where requester_name like 'D2C %');
SQL
)
WINNER_OK=$(psql_exec <<SQL
select count(*) from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name like 'D2C %' and a.utm_source like 'session-%' and a.landing_path = '/l-' || substring(a.utm_source from 9);
SQL
)
OKS=$(cat /tmp/d2c_b_*.log | grep -c '^RESULT|true|')
NEWS=$(cat /tmp/d2c_b_*.log | grep -c '^RESULT|true|true')
ERRS=$(cat /tmp/d2c_b_*.log | grep -ci "error")
check "B: no caller errored" "$ERRS" "0"; check "B: every caller accepted" "$OKS" "$N"
check "B: exactly ONE Request" "$REQ" "1"; check "B: exactly ONE attribution snapshot" "$ATTR" "1"
check "B: attribution belongs to one winning submission (values consistent)" "$WINNER_OK" "1"
check "B: exactly ONE notification event" "$NOTIF" "1"; check "B: exactly one caller saw a NEW Request" "$NEWS" "1"

# ------------------------------------------------------------------ CASE C
echo "=== CASE C: $N parallel submissions, DIFFERENT keys ==="
cleanup; seed_ready_form; KEY=$(publish_once | grep -o 'form_[0-9a-f]\{32\}' | head -1)
rm -f /tmp/d2c_c_*.log
for i in $(seq 1 $N); do
  sub_sql "$KEY" "D2C-DIFF-$i" "D2C Diff $i" '{}' | docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA > /tmp/d2c_c_$i.log 2>&1 &
done
wait
REQ=$(count_requests)
NOTIF=$(psql_exec <<SQL
select count(*) from public.notification_events where entity_id in (select id from public.transportation_requests where requester_name like 'D2C %');
SQL
)
ERRS=$(cat /tmp/d2c_c_*.log | grep -ci "error")
check "C: no caller errored" "$ERRS" "0"; check "C: $N distinct Requests" "$REQ" "$N"; check "C: $N notification events" "$NOTIF" "$N"

# ------------------------------------------------------------------ CASE D
echo "=== CASE D: publish UPDATE racing $N submissions that saw v1 ==="
cleanup; seed_ready_form; KEY=$(publish_once | grep -o 'form_[0-9a-f]\{32\}' | head -1)
psql_exec <<SQL >/dev/null
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT * FROM public.save_website_request_form('$ORG_A', 'Concurrency form v2', 'Send', 'Thanks.', true, false, 'ready', null, null::text[]);
COMMIT;
SQL
rm -f /tmp/d2c_d_*.log
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA > /tmp/d2c_d_pub.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.6);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT 'PUB|' || published_version::text || '|' || changed::text FROM public.publish_website_request_form('$ORG_A');
COMMIT;
SQL
for i in $(seq 1 $N); do
  sub_sql "$KEY" "D2C-RACE-$i" "D2C Race $i" '{"formVersion":"nemryn-form-v1","utmSource":"race"}' | docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA > /tmp/d2c_d_$i.log 2>&1 &
done
wait
REQ=$(count_requests)
ATTR=$(psql_exec <<SQL
select count(*) from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name like 'D2C Race %';
SQL
)
V1=$(psql_exec <<SQL
select count(*) from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.requester_name like 'D2C Race %' and a.form_version = 'nemryn-form-v1';
SQL
)
FINAL=$(psql_exec <<SQL
select published_version || '/' || status from public.website_request_form_publications where organization_id = '$ORG_A';
SQL
)
NOTIF=$(psql_exec <<SQL
select count(*) from public.notification_events where entity_id in (select id from public.transportation_requests where requester_name like 'D2C Race %');
SQL
)
ERRS=$(cat /tmp/d2c_d_*.log | grep -ci "error")
OKS=$(cat /tmp/d2c_d_[0-9]*.log | grep -c '^RESULT|true|')
check "D: no caller errored" "$ERRS" "0"; check "D: every submission accepted" "$OKS" "$N"
check "D: one Request each" "$REQ" "$N"; check "D: one attribution snapshot each (none rewritten / duplicated)" "$ATTR" "$N"
check "D: every snapshot records the version the passenger SAW (nemryn-form-v1), not the racing v2" "$V1" "$N"
check "D: publication ended at version 2, published" "$FINAL" "2/published"; check "D: one notification each" "$NOTIF" "$N"

# ------------------------------------------------------------------ CASE E
echo "=== CASE E: DISABLE racing $N submissions ==="
cleanup; seed_ready_form; KEY=$(publish_once | grep -o 'form_[0-9a-f]\{32\}' | head -1)
rm -f /tmp/d2c_e_*.log
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA > /tmp/d2c_e_dis.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.6);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT 'DIS|' || publication_status || '|' || changed::text FROM public.disable_website_request_form_publication('$ORG_A');
COMMIT;
SQL
for i in $(seq 1 $N); do
  # ON_ERROR_STOP off: a submission that lost the race is REJECTED (ZW006) -- that is the correct outcome, not a failure
  # submissions 1-3 race the disable; 4-6 start well AFTER it committed and must all be rejected
  if [ "$i" -le 3 ]; then DELAY=0.6; else DELAY=2.0; fi
  sub_sql "$KEY" "D2C-DISABLE-$i" "D2C Dis $i" '{}' "$DELAY" | docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA > /tmp/d2c_e_$i.log 2>&1 &
done
wait
REQ=$(count_requests)
ACC=$(cat /tmp/d2c_e_[0-9]*.log | grep -c '^RESULT|true|')
REJ=$(cat /tmp/d2c_e_[0-9]*.log | grep -c 'ZW006\|invalid_input')
STATUS=$(psql_exec <<SQL
select status from public.website_request_form_publications where organization_id = '$ORG_A';
SQL
)
check "E: publication disabled" "$STATUS" "disabled"
check "E: Requests created == accepted submissions (no half-committed Request)" "$REQ" "$ACC"
check "E: every submission was either accepted or cleanly rejected" "$((ACC + REJ))" "$N"
check "E: the three submissions that started AFTER the disable were all rejected (at most the 3 racers got in)" "$([ "$ACC" -le 3 ] && echo yes || echo "no:$ACC")" "yes"
LATE=$(psql_exec <<SQL | grep -E '^[0-9]+$'
begin;
set local role service_role;
select count(*) from public.get_public_request_form('$KEY');
commit;
SQL
)
check "E: after the disable committed the public config is gone" "$LATE" "0"

cleanup
rm -f /tmp/d2c_*.log
echo "=== FAIL_COUNT=$FAIL_COUNT ==="
exit $FAIL_COUNT
