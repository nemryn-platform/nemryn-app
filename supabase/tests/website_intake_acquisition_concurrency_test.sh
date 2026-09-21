#!/bin/bash
# Nemryn -- genuine concurrent test for acquisition attribution (P1-PILOT-S4C).
# Several SEPARATE psql connections (separate OS processes) submit the SAME integration + SAME idempotency key at
# overlapping times, each with a DIFFERENT acquisition object. Required outcome: exactly ONE Request, exactly ONE
# attribution snapshot, belonging to the WINNING submission (its utm_source matches the surviving Request's requester),
# exactly ONE notification event, and every caller accepted.
set -u
FAIL_COUNT=0
ORG_A='10000000-0000-0000-0000-0000000000a1'
INTEGRATION_ID='b9000000-0000-0000-0000-00000000b001'
EXTERNAL_ID='s4c-concurrency-org-a'
KEY='S4C-CONCURRENCY-KEY-001'
N=6

psql_exec() { docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA; }

cleanup() {
psql_exec <<SQL >/dev/null
delete from public.notification_events where entity_id in (select id from public.transportation_requests where intake_integration_id = '$INTEGRATION_ID');
delete from public.request_acquisition_attributions where request_id in (select id from public.transportation_requests where intake_integration_id = '$INTEGRATION_ID');
delete from public.request_events where request_id in (select id from public.transportation_requests where intake_integration_id = '$INTEGRATION_ID');
delete from public.transportation_requests where intake_integration_id = '$INTEGRATION_ID';
delete from public.request_intake_integrations where id = '$INTEGRATION_ID';
SQL
}

echo "=== Fixture setup ==="
cleanup
psql_exec <<SQL >/dev/null
insert into public.request_intake_integrations (id, organization_id, external_id, integration_type, is_active) values ('$INTEGRATION_ID', '$ORG_A', '$EXTERNAL_ID', 'website', true);
SQL

echo "=== Launching $N concurrent service_role submissions (same key, different acquisition each) ==="
for i in $(seq 1 $N); do
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA > /tmp/s4c_conc_$i.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.6);
SET LOCAL ROLE service_role;
SELECT accepted::text || '|' || coalesce(notification_event_id::text, 'replay') FROM public.submit_public_transportation_request(
  p_integration_external_id => '$EXTERNAL_ID', p_idempotency_key => '$KEY', p_requester_name => 'Session $i',
  p_requester_relationship => 'self', p_requester_phone => '555-020$i', p_pickup_description => 'S4C conc pickup $i',
  p_destination_description => 'S4C conc dest $i', p_return_trip_needed => 'no',
  p_acquisition => jsonb_build_object('utmSource', 'source-$i', 'utmCampaign', 'campaign-$i', 'landingPath', '/landing-$i'));
COMMIT;
SQL
done
wait

echo "=== Verifying final state ==="
REQ=$(psql_exec <<SQL
select count(*) from public.transportation_requests where intake_integration_id = '$INTEGRATION_ID' and external_submission_ref = '$KEY';
SQL
)
ATTR=$(psql_exec <<SQL
select count(*) from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id where r.intake_integration_id = '$INTEGRATION_ID';
SQL
)
WINNER=$(psql_exec <<SQL
select replace(requester_name, 'Session ', '') from public.transportation_requests where intake_integration_id = '$INTEGRATION_ID' and external_submission_ref = '$KEY';
SQL
)
MATCH=$(psql_exec <<SQL
select count(*) from public.request_acquisition_attributions a join public.transportation_requests r on r.id = a.request_id
where r.intake_integration_id = '$INTEGRATION_ID' and a.utm_source = 'source-' || replace(r.requester_name, 'Session ', '') and a.utm_campaign = 'campaign-' || replace(r.requester_name, 'Session ', '');
SQL
)
NOTIF=$(psql_exec <<SQL
select count(*) from public.notification_events where entity_id in (select id from public.transportation_requests where intake_integration_id = '$INTEGRATION_ID');
SQL
)
NEWCOUNT=$(cat /tmp/s4c_conc_*.log | grep -c '^true|[0-9a-f]\{8\}-')
ACCEPTED=$(cat /tmp/s4c_conc_*.log | grep -c '^true|')
echo "requests=$REQ attributions=$ATTR winner=Session $WINNER attribution_matches_winner=$MATCH notifications=$NOTIF accepted_callers=$ACCEPTED new_callers=$NEWCOUNT"

echo "=== Verdict ==="
if [ "$REQ" = "1" ] && [ "$ATTR" = "1" ] && [ "$MATCH" = "1" ] && [ "$NOTIF" = "1" ] && [ "$ACCEPTED" = "$N" ] && [ "$NEWCOUNT" = "1" ]; then
  echo "TEST S4C-ACQUISITION-CONCURRENCY-1: PASS ($N concurrent identical submissions with $N DIFFERENT acquisitions: 1 Request, 1 attribution belonging to the winning submission, 1 notification, every caller accepted, exactly one 'new')"
else
  echo "TEST S4C-ACQUISITION-CONCURRENCY-1: FAIL"
  cat /tmp/s4c_conc_*.log | head -20
  FAIL_COUNT=$((FAIL_COUNT+1))
fi
cleanup
rm -f /tmp/s4c_conc_*.log
echo "=== TOTAL FAILURES: $FAIL_COUNT ==="
exit $FAIL_COUNT
