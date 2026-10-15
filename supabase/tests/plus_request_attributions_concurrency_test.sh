#!/bin/bash
# Nemryn Plus -- request attribution under REAL concurrency (NP-P2-S3). Parallel psql processes, each holding its locks
# ~1s after the call.
#
#   Scenario 1: two staff link the SAME Request to DIFFERENT contacts at once -> exactly one attribution row and one
#               request_linked activity; the other gets ZW004 (already attributed).
#   Scenario 2: the same link submitted twice at once (double click)          -> one row, one activity; the other is an
#               idempotent no-op (changed=false).
#   Scenario 3: two corrections from the same version                          -> exactly one applies; the other ZW003;
#               history written once.
#   Scenario 4: a link racing a Core decision (Accept) on the same Request     -> both succeed: the Request is accepted
#               by Core, the attribution exists, nothing blocks or alters the Core decision.
#   Scenario 5 (NP-P2-S3-R2): a link to an opportunity commits while a contact change of that opportunity waits
#               -> the contact change is refused (ZW004 linked_requests); the pair stays consistent.
#   Scenario 6 (NP-P2-S3-R2): a contact change commits while a link to that opportunity (naming the OLD contact) waits
#               -> the link validates against the NEW contact and is refused (ZW006); nothing inconsistent is stored.
#
# Run with:  bash supabase/tests/plus_request_attributions_concurrency_test.sh
# Throwaway organization (Plus active) + two throwaway Admins + fictional contacts / Requests, removed on exit.
set -uo pipefail
DB="${NEMRYN_TEST_DB:-postgres}"
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('P2S3 Attribution Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
OUT=$(mktemp -d)
cleanup() {
  $PSQL >/dev/null <<SQL
delete from public.audit_events where organization_id='$ORG';
delete from public.plus_activities where organization_id='$ORG';
delete from public.plus_request_attributions where organization_id='$ORG';
delete from public.plus_opportunities where organization_id='$ORG';
delete from public.request_events where organization_id='$ORG';
delete from public.transportation_requests where organization_id='$ORG';
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
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 'p2s3-attr-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
$PSQL >/dev/null <<SQL
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', 'P2-S3 attribution concurrency fixture');
SQL
contact() { $PSQL -c "insert into public.plus_contacts (organization_id, display_name, email, contact_kind, created_by) values ('$ORG', '$1', '$(echo "$1" | tr 'A-Z ' 'a-z.')-$STAMP@example.test', 'individual', '$AD1') returning id" | head -1; }
request() { $PSQL -c "insert into public.transportation_requests (organization_id, requester_name, requester_relationship, requester_phone, pickup_description, destination_description, return_trip_needed, state, source) values ('$ORG', '$1', 'self', '(404) 555-0198', 'Fictional pickup', 'Fictional clinic', 'no', 'pending', 'phone') returning id" | head -1; }
K1=$(contact "Conc Pat Fictional"); K2=$(contact "Conc Sam Fictional")
R1=$(request "Conc One"); R2=$(request "Conc Two"); R3=$(request "Conc Three"); R4=$(request "Conc Four")
R5=$(request "Conc Five"); R6=$(request "Conc Six")
opportunity() { $PSQL -c "insert into public.plus_opportunities (organization_id, title, primary_contact_id, source, created_by) values ('$ORG', '$1', '$K1', 'phone', '$AD1') returning id" | head -1; }
O5=$(opportunity "Conc Opp Five"); O6=$(opportunity "Conc Opp Six")
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
errs() { cat "$@" | grep -c ERROR; }

echo "=== Scenario 1: two different links of one Request at once ==="
run_as "$OUT/s1a" "$AD1" "select (public.plus_link_request('$ORG', '$R1', '$K1', null)).changed" &
run_as "$OUT/s1b" "$AD2" "select (public.plus_link_request('$ORG', '$R1', '$K2', null)).changed" &
wait
ROWS=$($PSQL -c "select count(*) from public.plus_request_attributions where request_id='$R1'")
ACTS=$($PSQL -c "select count(*) from public.plus_activities where request_id='$R1'")
WON=$(cat "$OUT/s1a.out" "$OUT/s1b.out" | grep -c '^t$'); REF=$(cat "$OUT/s1a.err" "$OUT/s1b.err" | grep -c 'already_attributed')
echo "rows=$ROWS activities=$ACTS won=$WON refused_already_attributed=$REF"
[ "$ROWS" = "1" ] && [ "$ACTS" = "1" ] && [ "$WON" = "1" ] && [ "$REF" = "1" ]
check "CONC-A1 (two different links at once: one attribution, the other ZW004)" $?

echo "=== Scenario 2: the same link twice at once ==="
run_as "$OUT/s2a" "$AD1" "select (public.plus_link_request('$ORG', '$R2', '$K1', null)).changed" &
run_as "$OUT/s2b" "$AD2" "select (public.plus_link_request('$ORG', '$R2', '$K1', null)).changed" &
wait
ROWS=$($PSQL -c "select count(*) from public.plus_request_attributions where request_id='$R2'")
ACTS=$($PSQL -c "select count(*) from public.plus_activities where request_id='$R2'")
OUTS=$(cat "$OUT/s2a.out" "$OUT/s2b.out" | grep -E '^[tf]$' | sort | paste -sd, -)
echo "rows=$ROWS activities=$ACTS outcomes=$OUTS errors=$(errs "$OUT/s2a.err" "$OUT/s2b.err")"
[ "$ROWS" = "1" ] && [ "$ACTS" = "1" ] && [ "$OUTS" = "f,t" ] && [ "$(errs "$OUT/s2a.err" "$OUT/s2b.err")" = "0" ]
check "CONC-A2 (double submit: one row, one history entry, the other a no-op)" $?

echo "=== Scenario 3: two corrections from one version ==="
$PSQL >/dev/null <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$AD1';
select public.plus_link_request('$ORG', '$R3', '$K1', null);
commit;
SQL
V=$($PSQL -c "select updated_at from public.plus_request_attributions where request_id='$R3'")
run_as "$OUT/s3a" "$AD1" "select (public.plus_update_request_attribution('$ORG', '$R3', '$V', '$K2', null, 'Correction A')).changed" &
run_as "$OUT/s3b" "$AD2" "select (public.plus_update_request_attribution('$ORG', '$R3', '$V', '$K2', null, 'Correction B')).changed" &
wait
APPLIED=$(cat "$OUT/s3a.out" "$OUT/s3b.out" | grep -c '^t$'); STALE=$(cat "$OUT/s3a.err" "$OUT/s3b.err" | grep -c 'stale_state')
HIST=$($PSQL -c "select count(distinct body) from public.plus_activities where request_id='$R3' and activity_type='attribution_changed'")
echo "applied=$APPLIED stale=$STALE distinct_correction_histories=$HIST contact=$($PSQL -c "select contact_id = '$K2' from public.plus_request_attributions where request_id='$R3'")"
[ "$APPLIED" = "1" ] && [ "$STALE" = "1" ] && [ "$HIST" = "1" ]
check "CONC-A3 (two corrections from one version: one applies, the other ZW003, history once)" $?

echo "=== Scenario 4: a link racing a Core Accept on the same Request ==="
run_as "$OUT/s4a" "$AD1" "select (public.plus_link_request('$ORG', '$R4', '$K1', null)).changed" &
run_as "$OUT/s4b" "$AD2" "select public.accept_transportation_request('$ORG', '$R4') is not null" &
wait
ST=$($PSQL -c "select state from public.transportation_requests where id='$R4'")
ROWS=$($PSQL -c "select count(*) from public.plus_request_attributions where request_id='$R4'")
echo "request_state=$ST attribution_rows=$ROWS errors=$(errs "$OUT/s4a.err" "$OUT/s4b.err")"
[ "$ST" = "accepted" ] && [ "$ROWS" = "1" ] && [ "$(errs "$OUT/s4a.err" "$OUT/s4b.err")" = "0" ]
check "CONC-A4 (link racing a Core Accept: both succeed; Core decision unaffected)" $?

upd_contact() { echo "select (public.plus_update_opportunity('$ORG', '$1', (select updated_at from public.plus_opportunities where id = '$1'), '$2', '$3', 'quote', null, 'phone', null, null, null, 'none', null)).changed"; }

echo "=== Scenario 5: link commits first, contact change of the same opportunity waits ==="
run_as "$OUT/s5a" "$AD1" "select (public.plus_link_request('$ORG', '$R5', null, '$O5')).changed" &
sleep 0.3
run_as "$OUT/s5b" "$AD2" "$(upd_contact "$O5" "$K2" "Conc Opp Five")" &
wait
PAIR=$($PSQL -c "select (a.contact_id = o.primary_contact_id)::text || '/' || (o.primary_contact_id = '$K1')::text from public.plus_request_attributions a join public.plus_opportunities o on o.id = a.opportunity_id where a.request_id = '$R5'")
REF=$(cat "$OUT/s5b.err" | grep -c 'linked_requests')
echo "link=$(cat "$OUT/s5a.out" | grep -E '^[tf]$') contact_change_refused_linked_requests=$REF pair_consistent/contact_unchanged=$PAIR"
[ "$REF" = "1" ] && [ "$PAIR" = "true/true" ] && [ "$(cat "$OUT/s5a.out" | grep -c '^t$')" = "1" ]
check "CONC-A5 (link first, contact change waits: contact change refused ZW004, pair consistent)" $?

echo "=== Scenario 6: contact change commits first, a link naming the OLD contact waits ==="
run_as "$OUT/s6a" "$AD1" "$(upd_contact "$O6" "$K2" "Conc Opp Six")" &
sleep 0.3
run_as "$OUT/s6b" "$AD2" "select (public.plus_link_request('$ORG', '$R6', '$K1', '$O6')).changed" &
wait
ROWS=$($PSQL -c "select count(*) from public.plus_request_attributions where request_id='$R6'")
NEWC=$($PSQL -c "select (primary_contact_id = '$K2')::text from public.plus_opportunities where id='$O6'")
INV=$(cat "$OUT/s6b.err" | grep -c 'invalid_input')
echo "contact_changed=$NEWC link_refused_invalid_pair=$INV attribution_rows=$ROWS"
[ "$NEWC" = "true" ] && [ "$INV" = "1" ] && [ "$ROWS" = "0" ]
check "CONC-A6 (contact change first, stale link waits: link validated against the NEW contact, refused ZW006, nothing stored)" $?

echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
