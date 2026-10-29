#!/bin/bash
# Nemryn Core billing under REAL concurrency (NP-BILL-P1; evidence queries retargeted to the NP-FIN-P1 ledger:
# payments are receipts + allocations, reversals are unapply + receipt reversal, billing_payments stays empty). Parallel psql processes, each its own transaction that holds
# its locks ~1s after the call, so the other session genuinely waits.
#
#   S1 two different drafts for the SAME trip at once              -> exactly one draft; the other trip_already_invoiced
#   S2 the same draft key twice at once                            -> one invoice; changed true + false
#   S3 five drafts issued at once                                  -> numbers 1..5, unique, no gaps
#   S4 two payments from two stale-equal forms (different keys)    -> exactly one recorded; the other ZW003 (no double record)
#   S5 the same payment key twice at once                          -> one ledger row; changed true + false
#   S6 payment vs void on an unpaid invoice (both orders)          -> exactly one wins; never a payment on a void invoice
#   S7 two reversals of the same payment at once                   -> exactly one reversal
#   S8 multi-trip requester invoice vs passenger invoice sharing a trip -> exactly one gets the shared trip
#   INVARIANTS: 0 <= paid <= total on every invoice; at most one reversal per payment; at most one active invoice per
#               trip; no trip changed.
#
# Run with:  bash supabase/tests/billing_concurrency_test.sh
# ISOLATION GUARD (fails closed; identical to plus_inquiries_concurrency_test.sh): runs ONLY against the disposable local
# isolated stack -- container supabase_db_NemrynS1Iso (label com.supabase.cli.project=NemrynS1Iso), local Docker socket,
# database "postgres", fictional seed fingerprint 2/1/0. Anything else exits 2 before writing.
# Throwaway organization + two throwaway Admins + a passenger + completed trips, all removed on exit. Synthetic data only.
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
# FU-3: every session runs in the throwaway organization's own timezone, so current_date is its local date at
# every hour (the RPCs compare dates in organizations.timezone; UTC is a day ahead between 00:00 and 04:00 UTC).
ORG_TZ="America/New_York"
PSQL="docker exec -i -e PGTZ=$ORG_TZ $CONTAINER psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
FP=$($PSQL -c "select (select count(*) from organizations where id in ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000b1')) || '/' || (select count(*) from auth.users where email = 'org-a-admin@example.test') || '/' || (select count(*) from organizations where id = '25e3a19b-c8b5-45d2-943e-f20baf697cc5')" 2>/dev/null)
[ "$FP" = "2/1/0" ] || refuse "database does not carry the fictional seed fingerprint (got '$FP', expected 2/1/0)"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('Billing Concurrency $STAMP', '$ORG_TZ') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
[[ "$ORG" =~ $UUID_RE && "$AD1" =~ $UUID_RE && "$AD2" =~ $UUID_RE ]] || refuse "throwaway fixture ids were not created ('$ORG' '$AD1' '$AD2')"
OUT=$(mktemp -d)
cleanup() {
  [[ "$ORG" =~ $UUID_RE && "$AD1" =~ $UUID_RE && "$AD2" =~ $UUID_RE ]] || return 0
  $PSQL >/dev/null <<SQL
set session_replication_role = replica;
delete from public.billing_assurance_events where organization_id='$ORG';
delete from public.billing_receipt_reversals where organization_id='$ORG';
delete from public.billing_refund_reversals where organization_id='$ORG';
delete from public.billing_refunds where organization_id='$ORG';
delete from public.billing_allocations where organization_id='$ORG';
delete from public.billing_receipts where organization_id='$ORG';
delete from public.billing_receipt_counters where organization_id='$ORG';
delete from public.billing_payments where organization_id='$ORG';
delete from public.billing_invoice_lines where organization_id='$ORG';
delete from public.billing_invoice_trips where organization_id='$ORG';
delete from public.billing_invoices where organization_id='$ORG';
delete from public.billing_invoice_counters where organization_id='$ORG';
set session_replication_role = origin;
delete from public.audit_events where organization_id='$ORG';
delete from public.trips where organization_id='$ORG';
delete from public.transportation_requests where organization_id='$ORG';
delete from public.passengers where organization_id='$ORG';
delete from public.memberships where organization_id='$ORG';
delete from public.organizations where id='$ORG';
delete from auth.users where id in ('$AD1','$AD2');
SQL
  rm -rf "$OUT"
}
trap cleanup EXIT
for u in "$AD1" "$AD2"; do
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 'bill-conc-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
PAS=$($PSQL <<SQL | grep -E "$UUID_RE" | head -1
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.passengers (organization_id, display_name) values ('$ORG', 'Fictional Concurrency Rider') returning id;
SQL
)
[[ "$PAS" =~ $UUID_RE ]] || refuse "fixture passenger was not created"
trip() { $PSQL -c "insert into public.trips (organization_id, passenger_id, state, pickup_description, destination_description, completed_at) values ('$ORG', '$PAS', 'completed', 'Fictional pickup', 'Fictional destination', now()) returning id" | head -1; }
TRIP_STATES0=$($PSQL -c "select count(*) from public.trips where organization_id='$ORG'")
FAIL=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1 :: $2"; FAIL=1; }
run_as() { # $1 out prefix, $2 user, $3 call; holds its locks ~1s
  $PSQL > "$1.out" 2> "$1.err" <<SQL
\set VERBOSITY verbose
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$2';
$3;
reset role;
select pg_sleep(1.0);
commit;
SQL
}
res() { if grep -qE 'ERROR' "$1.err"; then grep -oE 'ERROR: +[A-Z0-9]{5}: [a-z_]+' "$1.err" | head -1 | sed -E 's/ERROR: +/ERR:/'; else grep -vE '^(BEGIN|SET|RESET|COMMIT)?$' "$1.out" | head -1; fi; }
as_admin() { $PSQL -c "begin; set local role authenticated; set local request.jwt.claim.sub = '$AD1'; $1; commit;" | grep -vE '^(BEGIN|SET|COMMIT)$' | head -1; }
draft_call() { echo "select (r).invoice_id || ':' || (r).changed from (select public.billing_create_invoice_draft('$ORG', array['$1']::uuid[], 'passenger', '$PAS', null, null, '$2') r) s"; }
ver() { $PSQL -c "select version from public.billing_invoices where id = '$1'"; }
priced_draft() { # $1 trip $2 key -> issued-ready draft id (price 10000)
  local inv; inv=$(as_admin "$(draft_call "$1" "$2")" | cut -d: -f1)
  as_admin "select (public.billing_update_invoice_draft('$ORG', '$inv', $(ver "$inv"), 'Fictional Concurrency Rider', null, null, null, jsonb_build_array(jsonb_build_object('trip_id', '$1', 'source', 'trip', 'description', 'Ride', 'quantity', 1, 'unit_cents', 10000)), 0, null)).version" >/dev/null
  echo "$inv"
}
issued() { local inv; inv=$(priced_draft "$1" "$2"); as_admin "select (public.billing_issue_invoice('$ORG', '$inv', $(ver "$inv"), null, null)).invoice_number" >/dev/null; echo "$inv"; }

# ---------------------------------------------------------------- S1 two drafts, same trip
T=$(trip)
run_as "$OUT/s1a" "$AD1" "$(draft_call "$T" "conc-s1-a-$STAMP")" & run_as "$OUT/s1b" "$AD2" "$(draft_call "$T" "conc-s1-b-$STAMP")" & wait
A=$(res "$OUT/s1a"); B=$(res "$OUT/s1b"); N=$($PSQL -c "select count(*) from public.billing_invoice_trips where trip_id='$T' and released_at is null")
if [ "$N" = 1 ] && { [[ "$A" == *ZW004* ]] || [[ "$B" == *ZW004* ]]; } && { [[ "$A" == *:true ]] || [[ "$B" == *:true ]]; }; then pass "S1 two drafts for the same trip at once: exactly one ($A | $B)"
else fail "S1" "a=$A b=$B active_links=$N"; fi

# ---------------------------------------------------------------- S2 same draft key twice
T=$(trip)
run_as "$OUT/s2a" "$AD1" "$(draft_call "$T" "conc-s2-$STAMP")" & run_as "$OUT/s2b" "$AD1" "$(draft_call "$T" "conc-s2-$STAMP")" & wait
A=$(res "$OUT/s2a"); B=$(res "$OUT/s2b"); N=$($PSQL -c "select count(*) from public.billing_invoices where organization_id='$ORG' and idempotency_key='conc-s2-$STAMP'")
if [ "$N" = 1 ] && [ "${A%%:*}" = "${B%%:*}" ] && [[ "$A$B" == *true* && "$A$B" == *false* ]]; then pass "S2 same draft key twice at once: one invoice, changed true + false"
else fail "S2" "a=$A b=$B n=$N"; fi

# ---------------------------------------------------------------- S3 five issues at once
IDS=(); for i in 1 2 3 4 5; do IDS+=("$(priced_draft "$(trip)" "conc-s3-$i-$STAMP")"); done
for i in 0 1 2 3 4; do run_as "$OUT/s3-$i" "$AD1" "select (public.billing_issue_invoice('$ORG', '${IDS[$i]}', $(ver "${IDS[$i]}"), null, null)).invoice_number" & done; wait
NUMS=$($PSQL -c "select string_agg(invoice_number::text, ',' order by invoice_number) from public.billing_invoices where organization_id='$ORG' and status='issued'")
if [ "$NUMS" = "1,2,3,4,5" ]; then pass "S3 five drafts issued at once: numbers $NUMS (unique, no gaps)"
else fail "S3" "numbers=$NUMS"; fi

# ---------------------------------------------------------------- S4 two payments, same expected version, different keys
INV=$(issued "$(trip)" "conc-s4-$STAMP"); V=$(ver "$INV")
pay_call() { echo "select (r).paid_cents || ':' || (r).changed from (select public.billing_record_payment('$ORG', '$1', $2, $3, current_date, 'cash', null, null, '$4') r) s"; }
run_as "$OUT/s4a" "$AD1" "$(pay_call "$INV" "$V" 6000 "conc-s4-a-$STAMP")" & run_as "$OUT/s4b" "$AD2" "$(pay_call "$INV" "$V" 6000 "conc-s4-b-$STAMP")" & wait
A=$(res "$OUT/s4a"); B=$(res "$OUT/s4b"); N=$($PSQL -c "select count(*) || ':' || coalesce(sum(amount_cents), 0) from public.billing_allocations where invoice_id='$INV' and kind='apply'")
if [ "$N" = "1:6000" ] && [[ "$A$B" == *ZW003* ]]; then pass "S4 two payments from equal forms at once: exactly one recorded, the other refused stale ($A | $B)"
else fail "S4" "a=$A b=$B ledger=$N"; fi

# ---------------------------------------------------------------- S5 same payment key twice
INV=$(issued "$(trip)" "conc-s5-$STAMP"); V=$(ver "$INV")
run_as "$OUT/s5a" "$AD1" "$(pay_call "$INV" "$V" 2500 "conc-s5-$STAMP")" & run_as "$OUT/s5b" "$AD1" "$(pay_call "$INV" "$V" 2500 "conc-s5-$STAMP")" & wait
A=$(res "$OUT/s5a"); B=$(res "$OUT/s5b"); N=$($PSQL -c "select count(*) from public.billing_allocations where invoice_id='$INV' and kind='apply'")
if [ "$N" = 1 ] && [[ "$A$B" == *true* && "$A$B" == *false* ]]; then pass "S5 same payment key twice at once: one ledger row, changed true + false"
else fail "S5" "a=$A b=$B rows=$N"; fi

# ---------------------------------------------------------------- S6 payment vs void (both orders)
for order in pay-first void-first; do
  INV=$(issued "$(trip)" "conc-s6-$order-$STAMP"); V=$(ver "$INV")
  PAYC=$(pay_call "$INV" "$V" 1000 "conc-s6-$order-$STAMP")
  VOIDC="select (public.billing_void_invoice('$ORG', '$INV', $V, 'Concurrency void test')).status"
  if [ "$order" = pay-first ]; then run_as "$OUT/s6p" "$AD1" "$PAYC" & sleep 0.3; run_as "$OUT/s6v" "$AD2" "$VOIDC" & wait
  else run_as "$OUT/s6v" "$AD2" "$VOIDC" & sleep 0.3; run_as "$OUT/s6p" "$AD1" "$PAYC" & wait; fi
  P=$(res "$OUT/s6p"); W=$(res "$OUT/s6v")
  ST=$($PSQL -c "select status || ':' || (select count(*) from public.billing_allocations where invoice_id='$INV' and kind='apply') from public.billing_invoices where id='$INV'")
  if { [ "$ST" = "issued:1" ] && [[ "$W" == *ZW00* ]]; } || { [ "$ST" = "void:0" ] && [[ "$P" == *ZW00* ]]; }; then pass "S6 payment vs void ($order): exactly one wins ($ST; pay=$P void=$W)"
  else fail "S6 $order" "state=$ST pay=$P void=$W"; fi
done

# ---------------------------------------------------------------- S7 two reversals of one payment
INV=$(issued "$(trip)" "conc-s7-$STAMP"); V=$(ver "$INV")
PID=$(as_admin "select (public.billing_record_payment('$ORG', '$INV', $V, 4000, current_date, 'check', null, null, 'conc-s7-pay-$STAMP')).payment_id")
V=$(ver "$INV")
rev_call() { echo "select (r).paid_cents || ':' || (r).changed from (select public.billing_reverse_payment('$ORG', '$PID', $V, 'Concurrency reversal', '$1') r) s"; }
run_as "$OUT/s7a" "$AD1" "$(rev_call "conc-s7-a-$STAMP")" & run_as "$OUT/s7b" "$AD2" "$(rev_call "conc-s7-b-$STAMP")" & wait
A=$(res "$OUT/s7a"); B=$(res "$OUT/s7b"); N=$($PSQL -c "select count(*) from public.billing_receipt_reversals x join public.billing_allocations a on a.receipt_id = x.receipt_id where a.id='$PID'")
if [ "$N" = 1 ] && [[ "$A$B" == *ZW00* ]]; then pass "S7 two reversals of one payment at once: exactly one ($A | $B)"
else fail "S7" "a=$A b=$B reversals=$N"; fi

# ---------------------------------------------------------------- S8 requester multi-trip vs passenger single-trip, shared trip
REQ=$($PSQL -c "insert into public.transportation_requests (organization_id, requester_name, requester_relationship, requester_phone, pickup_description, destination_description, return_trip_needed, state, source, passenger_id) values ('$ORG', 'Fictional Concurrency Payer', 'family', '(404) 555-0144', 'x', 'y', 'no', 'accepted', 'phone', '$PAS') returning id" | head -1)
reqtrip() { $PSQL -c "insert into public.trips (organization_id, passenger_id, state, pickup_description, destination_description, completed_at, request_id) values ('$ORG', '$PAS', 'completed', 'Fictional pickup', 'Fictional destination', now(), '$REQ') returning id" | head -1; }
TA=$(reqtrip); TBS=$(reqtrip)
REQC="select (r).invoice_id || ':' || (r).changed from (select public.billing_create_invoice_draft('$ORG', array['$TA', '$TBS']::uuid[], 'requester', '$REQ', null, null, 'conc-s8-req-$STAMP') r) s"
PASC="select (r).invoice_id || ':' || (r).changed from (select public.billing_create_invoice_draft('$ORG', array['$TBS']::uuid[], 'passenger', '$PAS', null, null, 'conc-s8-pas-$STAMP') r) s"
run_as "$OUT/s8a" "$AD1" "$REQC" & run_as "$OUT/s8b" "$AD2" "$PASC" & wait
A=$(res "$OUT/s8a"); B=$(res "$OUT/s8b"); N=$($PSQL -c "select count(*) from public.billing_invoice_trips where trip_id='$TBS' and released_at is null")
if [ "$N" = 1 ] && { [[ "$A" == *ZW004* ]] || [[ "$B" == *ZW004* ]]; } && [[ "$A$B" == *:true* ]]; then pass "S8 requester multi-trip vs passenger invoice on a shared trip: exactly one ($A | $B)"
else fail "S8" "a=$A b=$B active_links=$N"; fi

# ---------------------------------------------------------------- invariants
BAD=$($PSQL -c "select count(*) from public.billing_invoices i cross join lateral (select coalesce(sum(case when p.kind='apply' then p.amount_cents else -p.amount_cents end), 0) paid from public.billing_allocations p where p.invoice_id = i.id) x where i.organization_id='$ORG' and (x.paid < 0 or x.paid > i.total_cents or (i.status = 'void' and x.paid <> 0))")
REV=$($PSQL -c "select (select count(*) from (select unapplies_allocation_id from public.billing_allocations where organization_id='$ORG' and unapplies_allocation_id is not null group by 1 having count(*) > 1) d) + (select count(*) from (select receipt_id from public.billing_receipt_reversals where organization_id='$ORG' group by 1 having count(*) > 1) e) + (select count(*) from public.billing_payments where organization_id='$ORG')")
ACT=$($PSQL -c "select count(*) from (select trip_id from public.billing_invoice_trips where organization_id='$ORG' and released_at is null group by 1 having count(*) > 1) d")
TS=$($PSQL -c "select count(*) from public.trips where organization_id='$ORG' and state <> 'completed'")
if [ "$BAD" = 0 ] && [ "$REV" = 0 ] && [ "$ACT" = 0 ] && [ "$TS" = 0 ]; then pass "INV 0 <= paid <= total (void => 0); <= 1 reversal per payment; <= 1 active invoice per trip; trips untouched"
else fail "INV" "bad_balances=$BAD multi_reversals=$REV multi_active=$ACT changed_trips=$TS"; fi

echo
if [ "$FAIL" = 0 ]; then echo "RESULT: ALL PASS"; else echo "RESULT: FAILURES"; fi
exit $FAIL
