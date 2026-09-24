#!/bin/bash
# Nemryn -- genuine concurrent Request DECISION races (P1-OPS-R1).
#
# Same two-or-more-separate-psql-process methodology as request_lifecycle_concurrency_test.sh: a holder
# session takes the Request row lock (FOR UPDATE) and sleeps, the competing sessions are launched while it
# is held so they genuinely queue on the lock, then the holder commits WITHOUT changing anything and the
# competitors run against each other. Each scenario is repeated ROUNDS times on a fresh Request.
#
#   A  N concurrent Accepts               -> exactly one transition / one request_accepted / one AuditEvent
#   B  Accept vs Decline (both queued)    -> exactly ONE decision wins; never both accepted + declined evidence
#   C  Cancel queued BEFORE Accept        -> Cancel sees pending and is rejected; Request ends accepted
#   D  Decline vs Passenger link          -> no corruption; link never changes the decision; ends declined
#   E  create_trip queued BEFORE Accept   -> create_trip sees pending and is rejected; zero Trips
#   F  N concurrent Declines / Cancels    -> one terminal transition + one event each
#
# Run against a local stack (fictional seed data only):
#   bash supabase/tests/request_decision_concurrency_test.sh

set -uo pipefail

ORG='10000000-0000-0000-0000-0000000000a1'
PASSENGER='40000000-0000-0000-0000-0000000000a1'
ADMIN='20000000-0000-0000-0000-0000000000a1'
DISPATCHER='20000000-0000-0000-0000-0000000000a2'
ROUNDS="${ROUNDS:-3}"
LOG=/tmp/p1opsr1-conc
mkdir -p "$LOG"
FAILS=0

psqlq() { docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 "$@"; }

fixture() { # $1 id, $2 state, $3 passenger ('' = null)
  local pass="null"; [ -n "$3" ] && pass="'$3'"
  psqlq >/dev/null <<SQL
delete from public.audit_events where entity_id = '$1';
delete from public.trip_events where trip_id in (select id from public.trips where request_id = '$1');
delete from public.trips where request_id = '$1';
delete from public.request_events where request_id = '$1';
delete from public.transportation_requests where id = '$1';
insert into public.transportation_requests (id, organization_id, passenger_id, requester_name, requester_relationship, requester_phone,
  pickup_description, destination_description, return_trip_needed, source, state)
values ('$1', '$ORG', $pass, 'R1 Concurrency Requester', 'self', '555-0790', 'R1 conc pickup', 'R1 conc destination', 'no', 'web', '$2');
SQL
}

holder() { # $1 id -- hold the row lock 2s, change nothing
  psqlq > "$LOG/holder.log" 2>&1 <<SQL &
BEGIN;
SELECT id FROM public.transportation_requests WHERE id = '$1' FOR UPDATE;
SELECT pg_sleep(2);
COMMIT;
SQL
  HOLDER_PID=$!
  sleep 0.4
}

as_user() { # $1 uid, $2 sql, $3 logfile  (background)
  psqlq > "$3" 2>&1 <<SQL &
SET ROLE authenticated;
SET request.jwt.claim.sub = '$1';
$2
SQL
}

verdict() { # $1 name, $2 ok(0/1), $3 detail
  if [ "$2" = "1" ]; then echo "TEST $1: PASS ($3)"; else echo "TEST $1: FAIL ($3)"; FAILS=$((FAILS+1)); fi
}

counts() { # $1 id -> "state|accepted_events|declined_events|cancelled_events|accept_audits|trips|linked_events"
  psqlq -c "select (select state from public.transportation_requests where id = '$1'),
    (select count(*) from public.request_events where request_id = '$1' and event_type = 'request_accepted'),
    (select count(*) from public.request_events where request_id = '$1' and event_type = 'request_declined'),
    (select count(*) from public.request_events where request_id = '$1' and event_type = 'request_cancelled'),
    (select count(*) from public.audit_events where entity_id = '$1' and action = 'request_accepted'),
    (select count(*) from public.trips where request_id = '$1'),
    (select count(*) from public.request_events where request_id = '$1' and event_type = 'passenger_linked')"
}

for round in $(seq 1 "$ROUNDS"); do
  # ------------------------------------------------------------------ A
  R="b7100000-0000-0000-0000-0000000000a$round"
  fixture "$R" pending ''
  holder "$R"
  for i in 1 2 3 4 5; do
    U=$DISPATCHER; [ $((i % 2)) = 0 ] && U=$ADMIN
    as_user "$U" "SELECT changed FROM accept_transportation_request('$ORG', '$R');" "$LOG/a$i.log"
  done
  wait
  CHANGED=$(cat "$LOG"/a[1-5].log | grep -c '^t$')
  NOOP=$(cat "$LOG"/a[1-5].log | grep -c '^f$')
  IFS='|' read -r ST AE DE CE AA TR LE <<< "$(counts "$R")"
  verdict "A.$round (5 concurrent Accepts)" $([ "$ST" = accepted ] && [ "$CHANGED" = 1 ] && [ "$NOOP" = 4 ] && [ "$AE" = 1 ] && [ "$AA" = 1 ] && echo 1 || echo 0) \
    "state=$ST changed=$CHANGED noop=$NOOP accepted_events=$AE audits=$AA"

  # ------------------------------------------------------------------ B
  R="b7100000-0000-0000-0000-0000000000b$round"
  fixture "$R" pending ''
  holder "$R"
  if [ $((round % 2)) = 1 ]; then FIRST=accept; else FIRST=decline; fi
  if [ "$FIRST" = accept ]; then
    as_user "$DISPATCHER" "SELECT current_state FROM accept_transportation_request('$ORG', '$R');" "$LOG/b1.log"; sleep 0.1
    as_user "$ADMIN" "SELECT current_state FROM decline_transportation_request('$ORG', '$R', 'no_availability');" "$LOG/b2.log"
  else
    as_user "$ADMIN" "SELECT current_state FROM decline_transportation_request('$ORG', '$R', 'no_availability');" "$LOG/b2.log"; sleep 0.1
    as_user "$DISPATCHER" "SELECT current_state FROM accept_transportation_request('$ORG', '$R');" "$LOG/b1.log"
  fi
  wait
  IFS='|' read -r ST AE DE CE AA TR LE <<< "$(counts "$R")"
  REJ=$(cat "$LOG/b1.log" "$LOG/b2.log" | grep -c 'illegal_transition')
  verdict "B.$round (Accept vs Decline, $FIRST queued first)" \
    $({ [ "$ST" = accepted ] && [ "$AE" = 1 ] && [ "$DE" = 0 ]; } || { [ "$ST" = declined ] && [ "$DE" = 1 ] && [ "$AE" = 0 ]; } && [ "$REJ" = 1 ] && echo 1 || echo 0) \
    "state=$ST accepted_events=$AE declined_events=$DE losers_rejected=$REJ"

  # ------------------------------------------------------------------ C
  R="b7100000-0000-0000-0000-0000000000c$round"
  fixture "$R" pending ''
  holder "$R"
  as_user "$ADMIN" "SELECT current_state FROM cancel_transportation_request('$ORG', '$R', 'requester_cancelled');" "$LOG/c1.log"; sleep 0.1
  as_user "$DISPATCHER" "SELECT current_state FROM accept_transportation_request('$ORG', '$R');" "$LOG/c2.log"
  wait
  IFS='|' read -r ST AE DE CE AA TR LE <<< "$(counts "$R")"
  verdict "C.$round (Cancel queued before Accept)" \
    $([ "$ST" = accepted ] && [ "$CE" = 0 ] && [ "$AE" = 1 ] && grep -q illegal_transition "$LOG/c1.log" && echo 1 || echo 0) \
    "state=$ST cancelled_events=$CE accepted_events=$AE cancel_rejected=$(grep -c illegal_transition "$LOG/c1.log")"

  # ------------------------------------------------------------------ D
  R="b7100000-0000-0000-0000-0000000000d$round"
  fixture "$R" pending ''
  holder "$R"
  as_user "$DISPATCHER" "SELECT changed FROM link_request_passenger('$ORG', '$R', '$PASSENGER');" "$LOG/d1.log"
  as_user "$ADMIN" "SELECT current_state FROM decline_transportation_request('$ORG', '$R', 'duplicate_request');" "$LOG/d2.log"
  wait
  IFS='|' read -r ST AE DE CE AA TR LE <<< "$(counts "$R")"
  LINKED=$(psqlq -c "select coalesce(passenger_id::text, 'null') from public.transportation_requests where id = '$R'")
  # Consistent iff: declined with exactly one decline event, never accepted, and the passenger column agrees with the event log.
  CONSISTENT=0
  if [ "$ST" = declined ] && [ "$DE" = 1 ] && [ "$AE" = 0 ]; then
    if { [ "$LE" = 1 ] && [ "$LINKED" = "$PASSENGER" ]; } || { [ "$LE" = 0 ] && [ "$LINKED" = null ] && grep -q illegal_transition "$LOG/d1.log"; }; then CONSISTENT=1; fi
  fi
  verdict "D.$round (Decline vs Passenger link)" "$CONSISTENT" "state=$ST declined_events=$DE accepted_events=$AE link_events=$LE passenger=$LINKED"

  # ------------------------------------------------------------------ E
  R="b7100000-0000-0000-0000-0000000000e$round"
  fixture "$R" pending "$PASSENGER"
  holder "$R"
  as_user "$DISPATCHER" "SELECT created FROM create_trip('$ORG', '$PASSENGER', 'R1 conc trip pickup', 'R1 conc trip destination', null, null, null, null, null, null, '$R');" "$LOG/e1.log"; sleep 0.1
  as_user "$ADMIN" "SELECT current_state FROM accept_transportation_request('$ORG', '$R');" "$LOG/e2.log"
  wait
  IFS='|' read -r ST AE DE CE AA TR LE <<< "$(counts "$R")"
  verdict "E.$round (create_trip queued before Accept)" \
    $([ "$ST" = accepted ] && [ "$TR" = 0 ] && grep -q invalid_input "$LOG/e1.log" && echo 1 || echo 0) \
    "state=$ST trips=$TR trip_rejected=$(grep -c invalid_input "$LOG/e1.log")"

  # ------------------------------------------------------------------ F
  R="b7100000-0000-0000-0000-0000000000f$round"
  fixture "$R" pending ''
  holder "$R"
  for i in 1 2 3; do as_user "$DISPATCHER" "SELECT changed FROM decline_transportation_request('$ORG', '$R', 'no_availability');" "$LOG/f$i.log"; done
  wait
  IFS='|' read -r ST AE DE CE AA TR LE <<< "$(counts "$R")"
  verdict "F.$round (3 concurrent Declines)" $([ "$ST" = declined ] && [ "$DE" = 1 ] && [ "$(cat "$LOG"/f[1-3].log | grep -c '^t$')" = 1 ] && echo 1 || echo 0) \
    "state=$ST declined_events=$DE"

  R="b7100000-0000-0000-0000-0000000001f$round"
  fixture "$R" accepted ''
  holder "$R"
  for i in 1 2 3; do as_user "$ADMIN" "SELECT changed FROM cancel_transportation_request('$ORG', '$R', 'requester_cancelled');" "$LOG/g$i.log"; done
  wait
  IFS='|' read -r ST AE DE CE AA TR LE <<< "$(counts "$R")"
  verdict "F2.$round (3 concurrent Cancels)" $([ "$ST" = cancelled ] && [ "$CE" = 1 ] && [ "$(cat "$LOG"/g[1-3].log | grep -c '^t$')" = 1 ] && echo 1 || echo 0) \
    "state=$ST cancelled_events=$CE"
done

echo "=== request_decision_concurrency_test.sh complete: $FAILS failure(s) ==="
[ "$FAILS" = 0 ]
