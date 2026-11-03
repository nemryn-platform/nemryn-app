#!/bin/bash
# Nemryn Plus -- create a contact from a Core Request under REAL concurrency (NP-CORE-PLUS-REQUEST-02A). Parallel psql
# processes, each its own transaction that holds its locks ~1s after the call, so the other session genuinely waits.
#
#   Scenario 1: the same "Add contact" submitted twice at once (double click, no confirmation)
#               -> exactly ONE contact, attribution, request_linked activity and provenance audit; the other ZW004
#               already_attributed and ITS contact is rolled back (no orphan, no duplicate).
#   Scenario 2: the same, both with the duplicate warning confirmed  -> the same outcome (confirmation does not bypass it).
#   Scenario 3: "Add contact" first, "Link existing contact" waits   -> the link is refused (ZW004); one attribution.
#   Scenario 4: "Link existing contact" first, "Add contact" waits   -> the Add is refused (ZW004) and its new contact is
#               rolled back; the attribution is the existing contact's.
#   Scenario 5: "Add contact" racing a Core Accept on the same Request -> both succeed; the Core decision is unaffected.
#   Scenario 6: two Platform Admin enables at once                    -> one row, one changed=true, one audit row.
#   Scenario 7: creation first, disable waits                        -> the creation commits fully, then the disable applies.
#   Scenario 8: disable first, creation waits                        -> the creation is refused (ZW004 not enabled);
#               nothing written.
#   INVARIANTS: no deadlock in any scenario; no contact created by these scenarios is left without its attribution.
#
# Run with:  bash supabase/tests/plus_create_contact_for_request_concurrency_test.sh
# ISOLATION GUARD (fails closed; same rule as plus_communication_consents_concurrency_test.sh): runs ONLY against the
# disposable local isolated stack -- container supabase_db_NemrynS1Iso, labelled com.supabase.cli.project=NemrynS1Iso,
# reached through a LOCAL Docker socket, database "postgres", fictional seed fingerprint 2/1/0. Anything else exits 2
# before anything is written. Only `docker exec` into a local container is used; no connection string, URL or key is read.
# Throwaway organization (Plus active, enabled through the Platform Admin RPC as the seed Platform Admin d1) + two
# throwaway Admins, all removed on exit (also on failure). Synthetic data only.
set -uo pipefail
refuse() { echo "REFUSED (isolation guard): $1" >&2; exit 2; }
EXPECTED_CONTAINER="supabase_db_NemrynS1Iso"
CONTAINER="${NEMRYN_TEST_DB_CONTAINER:-$EXPECTED_CONTAINER}"
DB="${NEMRYN_TEST_DB:-postgres}"
[ "$CONTAINER" = "$EXPECTED_CONTAINER" ] || refuse "container '$CONTAINER' is not the isolated stack '$EXPECTED_CONTAINER'"
[ "$DB" = "postgres" ] || refuse "database '$DB' is not the isolated stack's local 'postgres' database"
[ -z "${DOCKER_HOST:-}" ] || refuse "DOCKER_HOST is set ('$DOCKER_HOST'): only the local Docker socket is allowed"
ENDPOINT=$(docker context inspect --format '{{.Endpoints.docker.Host}}' "$(docker context show 2>/dev/null)" 2>/dev/null)
case "$ENDPOINT" in unix://*) ;; *) refuse "Docker endpoint '$ENDPOINT' is not a local unix socket" ;; esac
LABEL=$(docker inspect --format '{{index .Config.Labels "com.supabase.cli.project"}}|{{.State.Running}}' "$CONTAINER" 2>/dev/null)
[ "$LABEL" = "NemrynS1Iso|true" ] || refuse "container '$CONTAINER' is not a running Supabase CLI container of project NemrynS1Iso ('$LABEL')"
PSQL="docker exec -i $CONTAINER psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
FP=$($PSQL -c "select (select count(*) from organizations where id in ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000b1')) || '/' || (select count(*) from auth.users where email = 'org-a-admin@example.test') || '/' || (select count(*) from organizations where id = '25e3a19b-c8b5-45d2-943e-f20baf697cc5')" 2>/dev/null)
[ "$FP" = "2/1/0" ] || refuse "database does not carry the fictional seed fingerprint (got '$FP', expected 2/1/0)"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
PA="20000000-0000-0000-0000-0000000000d1"   # seed Platform Admin
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('02A Request Contact Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
# every cleanup statement is scoped to these three freshly created ids; never run cleanup without them
[[ "$ORG" =~ $UUID_RE && "$AD1" =~ $UUID_RE && "$AD2" =~ $UUID_RE ]] || refuse "throwaway fixture ids were not created ('$ORG' '$AD1' '$AD2')"
OUT=$(mktemp -d)
cleanup() {
  [[ "$ORG" =~ $UUID_RE && "$AD1" =~ $UUID_RE && "$AD2" =~ $UUID_RE ]] || return 0
  $PSQL >/dev/null <<SQL
delete from public.plus_request_contact_enablements where organization_id='$ORG';
delete from public.audit_events where organization_id='$ORG';
delete from public.plus_activities where organization_id='$ORG';
delete from public.plus_request_attributions where organization_id='$ORG';
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
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', '02a-reqcontact-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
$PSQL >/dev/null <<SQL
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', '02A request contact concurrency fixture');
SQL
contact() { $PSQL -c "insert into public.plus_contacts (organization_id, display_name, email, contact_kind, created_by) values ('$ORG', '$1', '$2', 'individual', '$AD1') returning id" | head -1; }
request() { $PSQL -c "insert into public.transportation_requests (organization_id, requester_name, requester_relationship, requester_phone, pickup_description, destination_description, return_trip_needed, state, source) values ('$ORG', '$1', 'family', '(404) 555-0197', 'Fictional pickup', 'Fictional clinic', 'no', 'pending', 'phone') returning id" | head -1; }
K1=$(contact "Conc Existing Fictional" "conc.existing-$STAMP@example.test")
R1=$(request "Conc One"); R2=$(request "Conc Two"); R3=$(request "Conc Three"); R4=$(request "Conc Four")
R5=$(request "Conc Five"); R7=$(request "Conc Seven"); R8=$(request "Conc Eight")
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
# the RPC as a statement: name, phone, confirm
add() { echo "select (public.plus_create_contact_for_request('$ORG', '$1', '$2', '$3', null, 'family_caregiver', 'phone', false, null, $4)).outcome"; }
enable() { echo "select (public.platform_set_plus_request_contact_enablement('$ORG', $1, $2, '$3')).changed"; }
named() { $PSQL -c "select count(*) from public.plus_contacts where organization_id='$ORG' and display_name='$1'"; }

$PSQL >/dev/null <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$PA';
select public.platform_set_plus_request_contact_enablement('$ORG', true, 'synthetic', 'Fictional concurrency fixture');
commit;
SQL
[ "$($PSQL -c "select count(*) from public.plus_request_contact_enablements where organization_id='$ORG'")" = "1" ] || { echo "fixture enablement failed"; exit 1; }

echo "=== Scenario 1: the same Add contact twice at once (no confirmation) ==="
run_as "$OUT/s1a" "$AD1" "$(add "$R1" "Conc Double Fictional" "(404) 555-0141" false)" &
run_as "$OUT/s1b" "$AD2" "$(add "$R1" "Conc Double Fictional" "(404) 555-0141" false)" &
wait
C=$(named "Conc Double Fictional")
ROWS=$($PSQL -c "select count(*) from public.plus_request_attributions where request_id='$R1'")
ACTS=$($PSQL -c "select count(*) from public.plus_activities where request_id='$R1'")
PROV=$($PSQL -c "select count(*) from public.audit_events where organization_id='$ORG' and action='plus_contact_created_from_request' and after_data->>'request_id'='$R1'")
CREATED=$($PSQL -c "select count(*) from public.audit_events a join public.plus_contacts c on c.id = a.entity_id where a.action='plus_contact_created' and c.display_name='Conc Double Fictional'")
WON=$(cat "$OUT/s1a.out" "$OUT/s1b.out" | grep -c '^linked$'); REF=$(cat "$OUT/s1a.err" "$OUT/s1b.err" | grep -c 'already_attributed')
echo "contacts=$C attributions=$ROWS activities=$ACTS provenance_audits=$PROV created_audits=$CREATED linked=$WON refused_already_attributed=$REF"
[ "$C" = "1" ] && [ "$ROWS" = "1" ] && [ "$ACTS" = "1" ] && [ "$PROV" = "1" ] && [ "$CREATED" = "1" ] && [ "$WON" = "1" ] && [ "$REF" = "1" ]
check "CONC-1 (double submit at once: one contact + link; the loser's contact rolled back)" $?

echo "=== Scenario 2: the same, both confirmed ==="
run_as "$OUT/s2a" "$AD1" "$(add "$R2" "Conc Confirmed Fictional" "(404) 555-0143" true)" &
run_as "$OUT/s2b" "$AD2" "$(add "$R2" "Conc Confirmed Fictional" "(404) 555-0143" true)" &
wait
C=$(named "Conc Confirmed Fictional")
ROWS=$($PSQL -c "select count(*) from public.plus_request_attributions where request_id='$R2'")
WON=$(cat "$OUT/s2a.out" "$OUT/s2b.out" | grep -c '^linked$'); REF=$(cat "$OUT/s2a.err" "$OUT/s2b.err" | grep -c 'already_attributed')
echo "contacts=$C attributions=$ROWS linked=$WON refused_already_attributed=$REF"
[ "$C" = "1" ] && [ "$ROWS" = "1" ] && [ "$WON" = "1" ] && [ "$REF" = "1" ]
check "CONC-2 (confirmed double submit at once: still exactly one contact)" $?

echo "=== Scenario 3: Add contact first, Link existing waits ==="
run_as "$OUT/s3a" "$AD1" "$(add "$R3" "Conc AddFirst Fictional" "(404) 555-0144" false)" &
sleep 0.3
run_as "$OUT/s3b" "$AD2" "select (public.plus_link_request('$ORG', '$R3', '$K1', null)).changed" &
wait
ATTR=$($PSQL -c "select (c.display_name = 'Conc AddFirst Fictional')::text from public.plus_request_attributions a join public.plus_contacts c on c.id = a.contact_id where a.request_id='$R3'")
ROWS=$($PSQL -c "select count(*) from public.plus_request_attributions where request_id='$R3'")
REF=$(cat "$OUT/s3b.err" | grep -c 'already_attributed')
echo "add=$(grep -E '^[a-z_]+$' "$OUT/s3a.out" | head -1) link_refused=$REF attributions=$ROWS attributed_to_new_contact=$ATTR"
[ "$(grep -c '^linked$' "$OUT/s3a.out")" = "1" ] && [ "$REF" = "1" ] && [ "$ROWS" = "1" ] && [ "$ATTR" = "true" ]
check "CONC-3 (Add first, Link existing waits: the link is refused; one attribution)" $?

echo "=== Scenario 4: Link existing first, Add contact waits ==="
run_as "$OUT/s4a" "$AD1" "select (public.plus_link_request('$ORG', '$R4', '$K1', null)).changed" &
sleep 0.3
run_as "$OUT/s4b" "$AD2" "$(add "$R4" "Conc LinkFirst Fictional" "(404) 555-0145" false)" &
wait
C=$(named "Conc LinkFirst Fictional")
ATTR=$($PSQL -c "select (contact_id = '$K1')::text from public.plus_request_attributions where request_id='$R4'")
REF=$(cat "$OUT/s4b.err" | grep -c 'already_attributed')
echo "link=$(grep -E '^[tf]$' "$OUT/s4a.out") add_refused=$REF new_contacts_left=$C attributed_to_existing=$ATTR"
[ "$(grep -c '^t$' "$OUT/s4a.out")" = "1" ] && [ "$REF" = "1" ] && [ "$C" = "0" ] && [ "$ATTR" = "true" ]
check "CONC-4 (Link existing first, Add waits: Add refused and its contact rolled back)" $?

echo "=== Scenario 5: Add contact racing a Core Accept on the same Request ==="
run_as "$OUT/s5a" "$AD1" "$(add "$R5" "Conc Accept Fictional" "(404) 555-0146" false)" &
run_as "$OUT/s5b" "$AD2" "select public.accept_transportation_request('$ORG', '$R5') is not null" &
wait
ST=$($PSQL -c "select state from public.transportation_requests where id='$R5'")
ROWS=$($PSQL -c "select count(*) from public.plus_request_attributions where request_id='$R5'")
echo "request_state=$ST attributions=$ROWS errors=$(errs "$OUT/s5a.err" "$OUT/s5b.err")"
[ "$ST" = "accepted" ] && [ "$ROWS" = "1" ] && [ "$(errs "$OUT/s5a.err" "$OUT/s5b.err")" = "0" ]
check "CONC-5 (Add racing a Core Accept: both succeed; the Core decision is unaffected)" $?

echo "=== Scenario 6: two Platform Admin disable+enable cycles at once ==="
$PSQL >/dev/null <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$PA';
select public.platform_set_plus_request_contact_enablement('$ORG', false, null, 'Fictional reset before scenario 6');
commit;
SQL
N0=$($PSQL -c "select count(*) from public.audit_events where organization_id='$ORG' and action='platform_plus_request_contact_enablement_changed'")
run_as "$OUT/s6a" "$PA" "$(enable true "'synthetic'" "Fictional enable A")" &
run_as "$OUT/s6b" "$PA" "$(enable true "'synthetic'" "Fictional enable B")" &
wait
N1=$($PSQL -c "select count(*) from public.audit_events where organization_id='$ORG' and action='platform_plus_request_contact_enablement_changed'")
ROWS=$($PSQL -c "select count(*) from public.plus_request_contact_enablements where organization_id='$ORG'")
OUTS=$(cat "$OUT/s6a.out" "$OUT/s6b.out" | grep -E '^[tf]$' | sort | paste -sd, -)
echo "rows=$ROWS outcomes=$OUTS audits_added=$((N1 - N0)) errors=$(errs "$OUT/s6a.err" "$OUT/s6b.err")"
[ "$ROWS" = "1" ] && [ "$OUTS" = "f,t" ] && [ "$((N1 - N0))" = "1" ] && [ "$(errs "$OUT/s6a.err" "$OUT/s6b.err")" = "0" ]
check "CONC-6 (two enables at once: one row, one change, one audit)" $?

echo "=== Scenario 7: creation first, disable waits ==="
run_as "$OUT/s7a" "$AD1" "$(add "$R7" "Conc BeforeDisable Fictional" "(404) 555-0147" false)" &
sleep 0.3
run_as "$OUT/s7b" "$PA" "$(enable false null "Fictional disable during creation")" &
wait
C=$(named "Conc BeforeDisable Fictional")
ROWS=$($PSQL -c "select count(*) from public.plus_request_attributions where request_id='$R7'")
EN=$($PSQL -c "select count(*) from public.plus_request_contact_enablements where organization_id='$ORG'")
echo "create=$(grep -E '^[a-z_]+$' "$OUT/s7a.out" | head -1) disable=$(grep -E '^[tf]$' "$OUT/s7b.out") contacts=$C attributions=$ROWS enablement_rows=$EN errors=$(errs "$OUT/s7a.err" "$OUT/s7b.err")"
[ "$(grep -c '^linked$' "$OUT/s7a.out")" = "1" ] && [ "$(grep -c '^t$' "$OUT/s7b.out")" = "1" ] && [ "$C" = "1" ] && [ "$ROWS" = "1" ] && [ "$EN" = "0" ] \
  && [ "$(errs "$OUT/s7a.err" "$OUT/s7b.err")" = "0" ]
check "CONC-7 (creation holds the gate: it commits fully, then the disable applies)" $?

echo "=== Scenario 8: disable first, creation waits ==="
$PSQL >/dev/null <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$PA';
select public.platform_set_plus_request_contact_enablement('$ORG', true, 'synthetic', 'Fictional re-enable before scenario 8');
commit;
SQL
run_as "$OUT/s8a" "$PA" "$(enable false null "Fictional disable before creation")" &
sleep 0.3
run_as "$OUT/s8b" "$AD1" "$(add "$R8" "Conc AfterDisable Fictional" "(404) 555-0148" false)" &
wait
C=$(named "Conc AfterDisable Fictional")
ROWS=$($PSQL -c "select count(*) from public.plus_request_attributions where request_id='$R8'")
REF=$(cat "$OUT/s8b.err" | grep -c 'request_contact_not_enabled')
echo "disable=$(grep -E '^[tf]$' "$OUT/s8a.out") creation_refused_not_enabled=$REF contacts=$C attributions=$ROWS"
[ "$(grep -c '^t$' "$OUT/s8a.out")" = "1" ] && [ "$REF" = "1" ] && [ "$C" = "0" ] && [ "$ROWS" = "0" ]
check "CONC-8 (disable first, creation waits: refused, nothing written)" $?

echo "=== Invariants ==="
DL=$(cat "$OUT"/*.err | grep -ci 'deadlock')
ORPH=$($PSQL -c "select count(*) from public.plus_contacts c where c.organization_id='$ORG' and c.id <> '$K1' and not exists (select 1 from public.plus_request_attributions a where a.contact_id = c.id)")
echo "deadlocks=$DL orphaned_contacts=$ORPH"
[ "$DL" = "0" ] && [ "$ORPH" = "0" ]
check "CONC-INV (no deadlock; no contact left without its attribution)" $?

if [ "$FAIL" = "0" ]; then echo "SUMMARY: ALL CONCURRENCY SCENARIOS PASS"; else echo "SUMMARY: FAILURES PRESENT"; exit 1; fi
