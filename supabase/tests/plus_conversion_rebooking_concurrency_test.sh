#!/bin/bash
# Nemryn Plus -- conversion & rebooking under REAL concurrency (NP-P2-S4). Parallel psql processes, each holding its
# locks ~1s after the call. After EVERY scenario the critical invariant is checked on the final rows:
#   a single intended conversion / rebooking produces at most ONE pending Core Request, ONE attribution and one-time
#   history -- and no Core Request of the fixture organization exists without its attribution (no orphan).
#
#   1  double click: the same conversion (same key) twice at once                 -> 1 Request; t + f (replay)
#   2  two staff, same key, same opportunity                                       -> 1 Request; t + f
#   3  two staff, DIFFERENT keys, same opportunity                                 -> 1 Request; other ZW004 already_converted
#   4  the same key on two different opportunities                                 -> 1 Request; other ZW006
#   5  conversion vs an edit of the opportunity's contact                          -> serialized; never an inconsistent pair
#   6  conversion vs a P2-S3 manual link to the same opportunity                   -> never two Requests from one conversion
#   7  conversion vs archiving the contact                                         -> serialized; no Request for an archived contact
#   8  two rebook submissions with the same key                                    -> 1 Request; t + f
#   9  rebooking vs archiving the contact                                          -> serialized
#   10 failure AFTER Core creation (attribution insert fails) racing a normal one  -> the failed one leaves NO Request
#
# Run with:  bash supabase/tests/plus_conversion_rebooking_concurrency_test.sh
# Throwaway organization (Plus active) + two throwaway Admins + fictional contacts / opportunities, removed on exit.
set -uo pipefail
DB="${NEMRYN_TEST_DB:-postgres}"
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('P2S4 Conversion Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
OUT=$(mktemp -d)
cleanup() {
  $PSQL >/dev/null <<SQL
drop trigger if exists zz_p2s4_conc_fail_attr on public.plus_request_attributions;
drop function if exists public.zz_p2s4_conc_fail_attr();
delete from public.audit_events where organization_id='$ORG';
delete from public.plus_activities where organization_id='$ORG';
delete from public.plus_request_attributions where organization_id='$ORG';
delete from public.request_events where organization_id='$ORG';
delete from public.transportation_requests where organization_id='$ORG';
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
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 'p2s4-conv-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
$PSQL >/dev/null <<SQL
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', 'P2-S4 conversion concurrency fixture');
SQL
contact() { $PSQL -c "insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by) values ('$ORG', '$1', '(404) 555-0144', '$(echo "$1" | tr 'A-Z ' 'a-z.')-$STAMP@example.test', 'individual', '$AD1') returning id" | head -1; }
opportunity() { $PSQL -c "insert into public.plus_opportunities (organization_id, title, stage, primary_contact_id, source, created_by) values ('$ORG', '$1', 'qualified', '$2', 'phone', '$AD1') returning id" | head -1; }
request() { $PSQL -c "insert into public.transportation_requests (organization_id, requester_name, requester_relationship, requester_phone, pickup_description, destination_description, return_trip_needed, state, source) values ('$ORG', '$1', 'self', '(404) 555-0145', 'Fictional pickup', 'Fictional clinic', 'no', 'pending', 'phone') returning id" | head -1; }
K1=$(contact "Conc Conv Pat Fictional"); K2=$(contact "Conc Conv Sam Fictional"); K3=$(contact "Conc Conv Lee Fictional"); K4=$(contact "Conc Conv Ann Fictional")
K5=$(contact "Conc Conv Bob Fictional"); K6=$(contact "Conc Conv Eve Fictional")
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
conv() { echo "select (public.plus_convert_opportunity_to_request('$ORG', '$1', (select updated_at from public.plus_opportunities where id = '$1'), '$2', 'self', 'Fictional pickup 1', 'Fictional clinic 1', 'no', null, null, null, null)).changed"; }
rebook() { echo "select (public.plus_create_rebooking_request('$ORG', '$1', '$2', 'self', 'Fictional pickup 2', 'Fictional clinic 2', 'no', 'phone', null, null, null, null)).changed"; }
# the critical invariant, on the final rows: no Core Request of the organization without its attribution; history once
orphans() { $PSQL -c "select count(*) from public.transportation_requests r where r.organization_id = '$ORG' and not exists (select 1 from public.plus_request_attributions a where a.request_id = r.id)"; }
reqs_for_opp() { $PSQL -c "select count(*) from public.plus_request_attributions where opportunity_id = '$1' and link_method = 'converted_from_opportunity'"; }
links_for_opp() { $PSQL -c "select count(*) from public.plus_activities where opportunity_id = '$1' and activity_type = 'request_linked'"; }
outs() { cat "$@" | grep -E '^[tf]$' | sort | paste -sd, -; }
errs() { cat "$@" | grep -oE '(already_converted|invalid_input|linked_request_exists|stale_state|contact_not_active|illegal_transition|linked_requests|simulated)' | sort | paste -sd, -; }

echo "=== 1: double click (same key, same opportunity) ==="
O=$(opportunity "Conc 1" "$K1")
run_as "$OUT/a" "$AD1" "$(conv "$O" "conc-key-one-0001")" & run_as "$OUT/b" "$AD1" "$(conv "$O" "conc-key-one-0001")" & wait
echo "outcomes=$(outs "$OUT/a.out" "$OUT/b.out") conversions=$(reqs_for_opp "$O") request_linked=$(links_for_opp "$O") orphans=$(orphans)"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "f,t" ] && [ "$(reqs_for_opp "$O")" = "1" ] && [ "$(links_for_opp "$O")" = "1" ] && [ "$(orphans)" = "0" ]
check "CONC-C1 (double click: one Request, one history, the other a replay)" $?

echo "=== 2: two staff, same key, same opportunity ==="
O=$(opportunity "Conc 2" "$K2")
run_as "$OUT/a" "$AD1" "$(conv "$O" "conc-key-two-0001")" & run_as "$OUT/b" "$AD2" "$(conv "$O" "conc-key-two-0001")" & wait
echo "outcomes=$(outs "$OUT/a.out" "$OUT/b.out") conversions=$(reqs_for_opp "$O") orphans=$(orphans)"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "f,t" ] && [ "$(reqs_for_opp "$O")" = "1" ] && [ "$(orphans)" = "0" ]
check "CONC-C2 (two staff, same key: one Request; the other returns it)" $?

echo "=== 3: two staff, different keys, same opportunity ==="
O=$(opportunity "Conc 3" "$K3")
run_as "$OUT/a" "$AD1" "$(conv "$O" "conc-key-three-a01")" & run_as "$OUT/b" "$AD2" "$(conv "$O" "conc-key-three-b01")" & wait
echo "outcomes=$(outs "$OUT/a.out" "$OUT/b.out") refusals=$(errs "$OUT/a.err" "$OUT/b.err") conversions=$(reqs_for_opp "$O") orphans=$(orphans)"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "t" ] && [ "$(errs "$OUT/a.err" "$OUT/b.err")" = "already_converted" ] && [ "$(reqs_for_opp "$O")" = "1" ] && [ "$(orphans)" = "0" ]
check "CONC-C3 (different keys, same opportunity: one Request; the other ZW004 already_converted)" $?

echo "=== 4: the same key on two different opportunities ==="
OA=$(opportunity "Conc 4a" "$K4"); OB=$(opportunity "Conc 4b" "$K4")
run_as "$OUT/a" "$AD1" "$(conv "$OA" "conc-key-four-0001")" & run_as "$OUT/b" "$AD2" "$(conv "$OB" "conc-key-four-0001")" & wait
TOTAL=$(( $(reqs_for_opp "$OA") + $(reqs_for_opp "$OB") ))
echo "outcomes=$(outs "$OUT/a.out" "$OUT/b.out") refusals=$(errs "$OUT/a.err" "$OUT/b.err") conversions_total=$TOTAL orphans=$(orphans)"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "t" ] && [ "$(errs "$OUT/a.err" "$OUT/b.err")" = "invalid_input" ] && [ "$TOTAL" = "1" ] && [ "$(orphans)" = "0" ]
check "CONC-C4 (same key, two opportunities: one Request; the other ZW006, never the first one's Request)" $?

echo "=== 5: conversion vs an edit of the opportunity's contact ==="
O=$(opportunity "Conc 5" "$K5")
EDIT="select (public.plus_update_opportunity('$ORG', '$O', (select updated_at from public.plus_opportunities where id = '$O'), '$K6', 'Conc 5', 'quote', null, 'phone', null, null, null, 'none', null)).changed"
run_as "$OUT/a" "$AD1" "$(conv "$O" "conc-key-five-0001")" & sleep 0.3; run_as "$OUT/b" "$AD2" "$EDIT" & wait
PAIR=$($PSQL -c "select coalesce((select (a.contact_id = o.primary_contact_id)::text from public.plus_request_attributions a where a.opportunity_id = o.id), 'none') || '/' || o.stage from public.plus_opportunities o where o.id = '$O'")
echo "convert=$(outs "$OUT/a.out") edit_refusal=$(errs "$OUT/b.err") pair_consistent/stage=$PAIR conversions=$(reqs_for_opp "$O") orphans=$(orphans)"
[ "$PAIR" = "true/converted" ] && [ "$(reqs_for_opp "$O")" = "1" ] && [ -n "$(errs "$OUT/b.err")" ] && [ "$(orphans)" = "0" ]
check "CONC-C5 (conversion first, contact edit waits: edit refused; attribution contact = primary contact)" $?
O=$(opportunity "Conc 5b" "$K5")
EDIT="select (public.plus_update_opportunity('$ORG', '$O', (select updated_at from public.plus_opportunities where id = '$O'), '$K6', 'Conc 5b', 'quote', null, 'phone', null, null, null, 'none', null)).changed"
run_as "$OUT/b" "$AD2" "$EDIT" & sleep 0.3; run_as "$OUT/a" "$AD1" "$(conv "$O" "conc-key-five-0002")" & wait
echo "edit=$(outs "$OUT/b.out") convert_refusal=$(errs "$OUT/a.err") conversions=$(reqs_for_opp "$O") orphans=$(orphans)"
[ "$(outs "$OUT/b.out")" = "t" ] && [ "$(errs "$OUT/a.err")" = "stale_state" ] && [ "$(reqs_for_opp "$O")" = "0" ] && [ "$(orphans)" = "0" ]
check "CONC-C5b (contact edit first, conversion from the old version waits: ZW003 stale; no Request)" $?

echo "=== 6: conversion vs a P2-S3 manual link to the same opportunity ==="
O=$(opportunity "Conc 6" "$K1"); R=$(request "Conc 6 existing request")
run_as "$OUT/b" "$AD2" "select (public.plus_link_request('$ORG', '$R', null, '$O')).changed" & sleep 0.3; run_as "$OUT/a" "$AD1" "$(conv "$O" "conc-key-six-00001")" & wait
echo "link=$(outs "$OUT/b.out") convert_refusal=$(errs "$OUT/a.err") conversions=$(reqs_for_opp "$O") orphans=$(orphans)"
[ "$(outs "$OUT/b.out")" = "t" ] && [ "$(errs "$OUT/a.err")" = "linked_request_exists" ] && [ "$(reqs_for_opp "$O")" = "0" ] && [ "$(orphans)" = "0" ]
check "CONC-C6 (manual link first, conversion waits: ZW004 linked_request_exists; no second Request)" $?

echo "=== 7: conversion vs archiving the contact ==="
O=$(opportunity "Conc 7" "$K2")
ARCH="select (public.plus_archive_contact('$ORG', '$K2', (select updated_at from public.plus_contacts where id = '$K2'), 'Concurrency archive')).changed"
run_as "$OUT/b" "$AD2" "$ARCH" & sleep 0.3; run_as "$OUT/a" "$AD1" "$(conv "$O" "conc-key-seven-001")" & wait
echo "archive=$(outs "$OUT/b.out") convert_refusal=$(errs "$OUT/a.err") conversions=$(reqs_for_opp "$O") orphans=$(orphans)"
[ "$(outs "$OUT/b.out")" = "t" ] && [ "$(errs "$OUT/a.err")" = "contact_not_active" ] && [ "$(reqs_for_opp "$O")" = "0" ] && [ "$(orphans)" = "0" ]
check "CONC-C7 (archive first, conversion waits: ZW006 contact_not_active; no Request)" $?

echo "=== 8: two rebook submissions with the same key ==="
run_as "$OUT/a" "$AD1" "$(rebook "$K3" "conc-rebook-key-01")" & run_as "$OUT/b" "$AD2" "$(rebook "$K3" "conc-rebook-key-01")" & wait
RB=$($PSQL -c "select count(*) from public.plus_request_attributions where contact_id = '$K3' and link_method = 'rebooking'")
echo "outcomes=$(outs "$OUT/a.out" "$OUT/b.out") rebookings=$RB orphans=$(orphans)"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "f,t" ] && [ "$RB" = "1" ] && [ "$(orphans)" = "0" ]
check "CONC-C8 (two rebook submissions, same key: one Request; the other returns it)" $?

echo "=== 9: rebooking vs archiving the contact ==="
ARCH="select (public.plus_archive_contact('$ORG', '$K4', (select updated_at from public.plus_contacts where id = '$K4'), 'Concurrency archive')).changed"
run_as "$OUT/a" "$AD1" "$(rebook "$K4" "conc-rebook-key-02")" & sleep 0.3; run_as "$OUT/b" "$AD2" "$ARCH" & wait
RB=$($PSQL -c "select count(*) from public.plus_request_attributions where contact_id = '$K4' and link_method = 'rebooking'")
ST=$($PSQL -c "select status from public.plus_contacts where id = '$K4'")
echo "rebook=$(outs "$OUT/a.out") archive=$(outs "$OUT/b.out") rebookings=$RB contact=$ST orphans=$(orphans)"
[ "$(outs "$OUT/a.out")" = "t" ] && [ "$(outs "$OUT/b.out")" = "t" ] && [ "$RB" = "1" ] && [ "$ST" = "archived" ] && [ "$(orphans)" = "0" ]
check "CONC-C9 (rebooking first, archive waits: one Request for the then-active contact; archive applies after)" $?

echo "=== 10: a failure AFTER Core creation racing a normal conversion ==="
$PSQL >/dev/null <<SQL
create function public.zz_p2s4_conc_fail_attr() returns trigger language plpgsql as \$f\$
begin
  if new.conversion_idempotency_key = 'conc-key-fail-0001' then perform pg_sleep(0.5); raise exception 'simulated attribution failure'; end if;
  return new;
end;
\$f\$;
create trigger zz_p2s4_conc_fail_attr before insert on public.plus_request_attributions for each row execute function public.zz_p2s4_conc_fail_attr();
SQL
OF=$(opportunity "Conc 10 failing" "$K5"); OK=$(opportunity "Conc 10 normal" "$K6")
BEFORE=$($PSQL -c "select count(*) from public.transportation_requests where organization_id = '$ORG'")
run_as "$OUT/a" "$AD1" "$(conv "$OF" "conc-key-fail-0001")" & run_as "$OUT/b" "$AD2" "$(conv "$OK" "conc-key-ok-00001")" & wait
$PSQL >/dev/null -c "drop trigger zz_p2s4_conc_fail_attr on public.plus_request_attributions; drop function public.zz_p2s4_conc_fail_attr();"
AFTER=$($PSQL -c "select count(*) from public.transportation_requests where organization_id = '$ORG'")
echo "failing=$(errs "$OUT/a.err") normal=$(outs "$OUT/b.out") requests_added=$((AFTER - BEFORE)) failing_stage=$($PSQL -c "select stage from public.plus_opportunities where id = '$OF'") orphans=$(orphans)"
[ "$(errs "$OUT/a.err")" = "simulated" ] && [ "$(outs "$OUT/b.out")" = "t" ] && [ "$((AFTER - BEFORE))" = "1" ] && [ "$(reqs_for_opp "$OF")" = "0" ] && [ "$(orphans)" = "0" ]
check "CONC-C10 (failure after Core creation: its Request rolls back -- only the normal conversion's Request exists; no orphan)" $?

echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
