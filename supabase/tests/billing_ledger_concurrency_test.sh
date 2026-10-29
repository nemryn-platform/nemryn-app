#!/bin/bash
# Nemryn Core billing LEDGER under REAL concurrency (NP-FIN-P1, ZD-268 / ZD-269). Parallel psql processes, each its own
# transaction that holds its locks ~1s after the call, so the other session genuinely waits.
#
#   K1  one receipt, two allocations to two invoices whose sum exceeds the receipt   -> exactly one; never over-spent
#   K2  two receipts allocated to ONE invoice beyond its balance                    -> exactly one; never over-paid
#   K3  the same record_receipt key twice at once                                   -> one receipt; changed true + false
#   K4  refund vs allocation on the same receipt (both orders)                      -> never over-spent
#   K5  allocation vs invoice VOID through the RPCs (both orders)                    -> (issued, paid) or (void, 0); never both
#   K5b BYPASS: direct owner allocation INSERT vs direct owner VOID UPDATE (both orders, no RPC) -> never void with money
#       applied (row guard locks + deferred invariant at commit)
#   K6  five receipts recorded at once                                              -> RCPT numbers 1..5, unique, no gaps
#   K7  unapply vs refund racing on the same receipt                                 -> consistent; refund <= freed funds
#   K8  receipt reversal vs allocation (both orders)                                 -> reversed at net 0, or allocated + reversal refused
#   K9  BILL-P1 wrapper: two payments from equal forms                                -> one + ZW003
#   K10 deadlock probe: allocate R -> [A, B] vs allocate S -> [B, A]                 -> both succeed (ascending lock order), no 40P01
#   K11 refund correction vs a new refund on a fully refunded receipt (both orders) -> active refunds never exceed it
#   INVARIANTS: 0 <= paid <= total; money only on issued invoices; allocated + refunded <= gross; reversed receipts at net 0;
#               billing_payments empty.
#
# Run with:  bash supabase/tests/billing_ledger_concurrency_test.sh
# ISOLATION GUARD (fails closed; identical to billing_concurrency_test.sh): runs ONLY against the disposable local isolated
# stack -- container supabase_db_NemrynS1Iso (label com.supabase.cli.project=NemrynS1Iso), local Docker socket, database
# "postgres", fictional seed fingerprint 2/1/0. Anything else exits 2 before writing.
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
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('Ledger Concurrency $STAMP', '$ORG_TZ') returning id" | head -1)
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
delete from public.billing_invoice_lines where organization_id='$ORG';
delete from public.billing_invoice_trips where organization_id='$ORG';
delete from public.billing_invoices where organization_id='$ORG';
delete from public.billing_invoice_counters where organization_id='$ORG';
set session_replication_role = origin;
delete from public.audit_events where organization_id='$ORG';
delete from public.trips where organization_id='$ORG';
delete from public.passengers where organization_id='$ORG';
delete from public.memberships where organization_id='$ORG';
delete from public.organizations where id='$ORG';
delete from auth.users where id in ('$AD1','$AD2');
SQL
  rm -rf "$OUT"
}
trap cleanup EXIT
for u in "$AD1" "$AD2"; do
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 'ledger-conc-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
PAS=$($PSQL <<SQL | grep -E "$UUID_RE" | head -1
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.passengers (organization_id, display_name) values ('$ORG', 'Fictional Ledger Concurrency Rider') returning id;
SQL
)
[[ "$PAS" =~ $UUID_RE ]] || refuse "fixture passenger was not created"
trip() { $PSQL -c "insert into public.trips (organization_id, passenger_id, state, pickup_description, destination_description, completed_at) values ('$ORG', '$PAS', 'completed', 'Fictional pickup', 'Fictional destination', now()) returning id" | head -1; }
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
run_owner() { # $1 out prefix, $2 statement(s) run as the table owner (bypass attempt); holds ~1s; COMMIT runs deferred checks
  $PSQL > "$1.out" 2> "$1.err" <<SQL
\set VERBOSITY verbose
begin;
$2;
select pg_sleep(1.0);
commit;
SQL
}
res() { if grep -qE 'ERROR' "$1.err"; then grep -oE 'ERROR: +[A-Z0-9]{5}: [a-z_]+' "$1.err" | head -1 | sed -E 's/ERROR: +/ERR:/'; else grep -vE '^(BEGIN|SET|RESET|COMMIT|INSERT 0 1|UPDATE [0-9]+)?$' "$1.out" | head -1; fi; }
as_admin() { $PSQL -c "begin; set local role authenticated; set local request.jwt.claim.sub = '$AD1'; $1; commit;" | grep -vE '^(BEGIN|SET|COMMIT)$' | head -1; }
ver() { $PSQL -c "select version from public.billing_invoices where id = '$1'"; }
issued() { # $1 key $2 cents -> issued invoice id for a fresh completed trip
  local t inv; t=$(trip)
  inv=$(as_admin "select (r).invoice_id from (select public.billing_create_invoice_draft('$ORG', array['$t']::uuid[], 'passenger', '$PAS', null, null, 'ldraft-$1-$STAMP') r) s")
  as_admin "select (public.billing_update_invoice_draft('$ORG', '$inv', $(ver "$inv"), 'Fictional Ledger Concurrency Rider', null, null, null, jsonb_build_array(jsonb_build_object('trip_id', '$t', 'source', 'trip', 'description', 'Ride', 'quantity', 1, 'unit_cents', $2)), 0, null)).version" >/dev/null
  as_admin "select (public.billing_issue_invoice('$ORG', '$inv', $(ver "$inv"), null, null)).invoice_number" >/dev/null
  echo "$inv"
}
credit() { # $1 key $2 cents -> receipt id with that much unallocated payer credit
  as_admin "select (r).receipt_id from (select public.billing_record_receipt('$ORG', null, 'passenger', '$PAS', null, $2, 0, current_date, 'cash', null, null, null, false, '[]'::jsonb, null, false, 'lrc-$1-$STAMP') r) s"
}
alloc_call() { # $1 receipt $2 jsonb allocations $3 key
  echo "select (r).unallocated_cents || ':' || (r).changed from (select public.billing_allocate_receipt('$ORG', '$1', '$2'::jsonb, null, 'lal-$3-$STAMP') r) s"
}
A1() { echo "[{\"invoice_id\": \"$1\", \"amount_cents\": $2}]"; }
A2() { echo "[{\"invoice_id\": \"$1\", \"amount_cents\": $2}, {\"invoice_id\": \"$3\", \"amount_cents\": $4}]"; }
net() { $PSQL -c "select public._billing_invoice_net('$1')"; }
unal() { $PSQL -c "select public._billing_receipt_unallocated('$1')"; }

# ---------------------------------------------------------------- K1 one receipt, two invoices, sum > receipt
R=$(credit k1 10000); X=$(issued k1x 10000); Y=$(issued k1y 10000)
run_as "$OUT/k1a" "$AD1" "$(alloc_call "$R" "$(A1 "$X" 6000)" k1a)" & run_as "$OUT/k1b" "$AD2" "$(alloc_call "$R" "$(A1 "$Y" 6000)" k1b)" & wait
A=$(res "$OUT/k1a"); B=$(res "$OUT/k1b"); U=$(unal "$R"); NX=$(net "$X"); NY=$(net "$Y")
if [ "$U" = 4000 ] && [ $((NX + NY)) = 6000 ] && [[ "$A$B" == *amount_exceeds_receipt* ]]; then pass "K1 one receipt, two allocations exceeding it at once: exactly one applied, receipt never over-spent ($A | $B)"
else fail "K1" "a=$A b=$B unallocated=$U netX=$NX netY=$NY"; fi

# ---------------------------------------------------------------- K2 two receipts, one invoice, sum > balance
R1=$(credit k2a 8000); R2=$(credit k2b 8000); Z=$(issued k2z 10000)
run_as "$OUT/k2a" "$AD1" "$(alloc_call "$R1" "$(A1 "$Z" 6000)" k2a)" & run_as "$OUT/k2b" "$AD2" "$(alloc_call "$R2" "$(A1 "$Z" 6000)" k2b)" & wait
A=$(res "$OUT/k2a"); B=$(res "$OUT/k2b"); NZ=$(net "$Z")
if [ "$NZ" = 6000 ] && [[ "$A$B" == *amount_exceeds_balance* ]]; then pass "K2 two receipts over-allocating one invoice at once: exactly one, invoice never over-paid ($A | $B)"
else fail "K2" "a=$A b=$B net=$NZ"; fi

# ---------------------------------------------------------------- K3 same record_receipt key twice
RC="select (r).receipt_id || ':' || (r).changed from (select public.billing_record_receipt('$ORG', null, 'passenger', '$PAS', null, 2500, 0, current_date, 'check', null, null, null, false, '[]'::jsonb, null, false, 'lk3-$STAMP') r) s"
run_as "$OUT/k3a" "$AD1" "$RC" & run_as "$OUT/k3b" "$AD1" "$RC" & wait
A=$(res "$OUT/k3a"); B=$(res "$OUT/k3b"); N=$($PSQL -c "select count(*) from public.billing_receipts where organization_id='$ORG' and idempotency_key='lk3-$STAMP'")
if [ "$N" = 1 ] && [ "${A%%:*}" = "${B%%:*}" ] && [[ "$A$B" == *true* && "$A$B" == *false* ]]; then pass "K3 same receipt key twice at once: one receipt, changed true + false"
else fail "K3" "a=$A b=$B n=$N"; fi

# ---------------------------------------------------------------- K4 refund vs allocation on one receipt (both orders)
for order in refund-first alloc-first; do
  R=$(credit "k4-$order" 5000); X=$(issued "k4x-$order" 10000)
  RF="select (r).unallocated_cents || ':' || (r).changed from (select public.billing_record_refund('$ORG', '$R', 4000, current_date, 'cash', null, null, 'Concurrency refund', 'lrf-k4-$order-$STAMP') r) s"
  AL=$(alloc_call "$R" "$(A1 "$X" 4000)" "k4-$order")
  if [ "$order" = refund-first ]; then run_as "$OUT/k4r" "$AD1" "$RF" & sleep 0.3; run_as "$OUT/k4a" "$AD2" "$AL" & wait
  else run_as "$OUT/k4a" "$AD2" "$AL" & sleep 0.3; run_as "$OUT/k4r" "$AD1" "$RF" & wait; fi
  P=$(res "$OUT/k4r"); Q=$(res "$OUT/k4a"); U=$(unal "$R"); NX=$(net "$X")
  REF=$($PSQL -c "select coalesce(sum(amount_cents), 0) from public.billing_refunds where receipt_id='$R'")
  if [ "$U" = 1000 ] && [ $((NX + REF)) = 4000 ] && [[ "$P$Q" == *exceeds* ]]; then pass "K4 refund vs allocation ($order): exactly one, never over-spent (refund=$P alloc=$Q)"
  else fail "K4 $order" "refund=$P alloc=$Q unallocated=$U net=$NX refunded=$REF"; fi
done

# ---------------------------------------------------------------- K5 allocation vs VOID through the RPCs (both orders)
for order in alloc-first void-first; do
  R=$(credit "k5-$order" 3000); X=$(issued "k5x-$order" 5000); V=$(ver "$X")
  AL=$(alloc_call "$R" "$(A1 "$X" 3000)" "k5-$order")
  VD="select (public.billing_void_invoice('$ORG', '$X', $V, 'Concurrency void test')).status"
  if [ "$order" = alloc-first ]; then run_as "$OUT/k5a" "$AD1" "$AL" & sleep 0.3; run_as "$OUT/k5v" "$AD2" "$VD" & wait
  else run_as "$OUT/k5v" "$AD2" "$VD" & sleep 0.3; run_as "$OUT/k5a" "$AD1" "$AL" & wait; fi
  P=$(res "$OUT/k5a"); W=$(res "$OUT/k5v")
  ST=$($PSQL -c "select status || ':' || public._billing_invoice_net(id) from public.billing_invoices where id='$X'")
  if { [ "$ST" = "issued:3000" ] && [[ "$W" == *ZW00* ]]; } || { [ "$ST" = "void:0" ] && [[ "$P" == *invoice_not_open* ]]; }; then pass "K5 allocation vs void ($order): exactly one wins ($ST; alloc=$P void=$W)"
  else fail "K5 $order" "state=$ST alloc=$P void=$W"; fi
done

# ---------------------------------------------------------------- K5b BYPASS: owner allocation INSERT vs owner VOID UPDATE (no RPC)
for order in insert-first void-first; do
  R=$(credit "k5b-$order" 3000); X=$(issued "k5bx-$order" 5000)
  INS="insert into public.billing_allocations (organization_id, receipt_id, invoice_id, kind, amount_cents, request_key, request_seq, created_by) values ('$ORG', '$R', '$X', 'apply', 3000, 'lk5b-$order-$STAMP', 1, '$AD1')"
  UPD="update public.billing_invoices set status = 'void', voided_at = now(), voided_by = '$AD1', void_reason = 'bypass race test', version = version + 1 where id = '$X'"
  if [ "$order" = insert-first ]; then run_owner "$OUT/k5bi" "$INS" & sleep 0.3; run_owner "$OUT/k5bu" "$UPD" & wait
  else run_owner "$OUT/k5bu" "$UPD" & sleep 0.3; run_owner "$OUT/k5bi" "$INS" & wait; fi
  I=$(res "$OUT/k5bi"); U=$(res "$OUT/k5bu")
  ST=$($PSQL -c "select status || ':' || public._billing_invoice_net(id) from public.billing_invoices where id='$X'")
  if [ "$ST" = "issued:3000" ] || [ "$ST" = "void:0" ]; then pass "K5b BYPASS owner insert vs owner void ($order): database kept the invariant ($ST; insert=${I:-ok} void=${U:-ok})"
  else fail "K5b $order" "state=$ST insert=$I void=$U"; fi
done

# ---------------------------------------------------------------- K6 five receipts at once (numbering)
BEFORE=$($PSQL -c "select coalesce(max(receipt_number), 0) from public.billing_receipts where organization_id='$ORG'")
for i in 1 2 3 4 5; do run_as "$OUT/k6-$i" "$AD1" "select (public.billing_record_receipt('$ORG', null, 'passenger', '$PAS', null, 100, 0, current_date, 'cash', null, null, null, false, '[]'::jsonb, null, false, 'lk6-$i-$STAMP')).receipt_number" & done; wait
NUMS=$($PSQL -c "select string_agg((receipt_number - $BEFORE)::text, ',' order by receipt_number) from public.billing_receipts where organization_id='$ORG' and idempotency_key like 'lk6-%-$STAMP'")
TOT=$($PSQL -c "select count(*) = max(receipt_number) and count(distinct receipt_number) = count(*) from public.billing_receipts where organization_id='$ORG'")
if [ "$NUMS" = "1,2,3,4,5" ] && [ "$TOT" = t ]; then pass "K6 five receipts at once: RCPT numbers consecutive, unique, no gaps in the organization"
else fail "K6" "numbers=$NUMS whole_org_gapless=$TOT"; fi

# ---------------------------------------------------------------- K7 unapply vs refund racing
R=$(credit k7 5000); X=$(issued k7x 5000)
as_admin "$(alloc_call "$R" "$(A1 "$X" 5000)" k7-setup)" >/dev/null
AID=$($PSQL -c "select id from public.billing_allocations where receipt_id='$R' and kind='apply'")
UN="select (r).unallocated_cents || ':' || (r).changed from (select public.billing_unapply_allocation('$ORG', '$AID', 'Concurrency unapply', 'lun-k7-$STAMP') r) s"
RF="select (r).unallocated_cents || ':' || (r).changed from (select public.billing_record_refund('$ORG', '$R', 5000, current_date, 'cash', null, null, 'Concurrency refund', 'lrf-k7-$STAMP') r) s"
run_as "$OUT/k7u" "$AD1" "$UN" & run_as "$OUT/k7r" "$AD2" "$RF" & wait
P=$(res "$OUT/k7u"); Q=$(res "$OUT/k7r"); U=$(unal "$R"); NX=$(net "$X"); REF=$($PSQL -c "select coalesce(sum(amount_cents), 0) from public.billing_refunds where receipt_id='$R'")
if [ $((U + NX + REF)) = 5000 ] && [ "$U" -ge 0 ] && [[ "$P" == *:true ]]; then pass "K7 unapply vs refund at once: consistent (unapply=$P refund=$Q; unallocated=$U net=$NX refunded=$REF)"
else fail "K7" "unapply=$P refund=$Q unallocated=$U net=$NX refunded=$REF"; fi

# ---------------------------------------------------------------- K8 receipt reversal vs allocation (both orders)
for order in reverse-first alloc-first; do
  R=$(credit "k8-$order" 2000); X=$(issued "k8x-$order" 5000)
  RV="select (public.billing_reverse_receipt('$ORG', '$R', 'entry_error', 'Concurrency reversal', 'lrv-k8-$order-$STAMP')).changed"
  AL=$(alloc_call "$R" "$(A1 "$X" 2000)" "k8-$order")
  if [ "$order" = reverse-first ]; then run_as "$OUT/k8v" "$AD1" "$RV" & sleep 0.3; run_as "$OUT/k8a" "$AD2" "$AL" & wait
  else run_as "$OUT/k8a" "$AD2" "$AL" & sleep 0.3; run_as "$OUT/k8v" "$AD1" "$RV" & wait; fi
  P=$(res "$OUT/k8v"); Q=$(res "$OUT/k8a")
  ST=$($PSQL -c "select public._billing_receipt_is_reversed('$R') || ':' || public._billing_invoice_net('$X')")
  if { [ "$ST" = "true:0" ] && [[ "$Q" == *receipt_reversed* ]]; } || { [ "$ST" = "false:2000" ] && [[ "$P" == *receipt_has_allocations* ]]; }; then pass "K8 reversal vs allocation ($order): exactly one ($ST; reverse=$P alloc=$Q)"
  else fail "K8 $order" "state=$ST reverse=$P alloc=$Q"; fi
done

# ---------------------------------------------------------------- K9 BILL-P1 wrapper: two payments from equal forms
X=$(issued k9x 10000); V=$(ver "$X")
PC() { echo "select (r).paid_cents || ':' || (r).changed from (select public.billing_record_payment('$ORG', '$X', $V, 6000, current_date, 'cash', null, null, '$1') r) s"; }
run_as "$OUT/k9a" "$AD1" "$(PC "lk9-a-$STAMP")" & run_as "$OUT/k9b" "$AD2" "$(PC "lk9-b-$STAMP")" & wait
A=$(res "$OUT/k9a"); B=$(res "$OUT/k9b"); NX=$(net "$X")
if [ "$NX" = 6000 ] && [[ "$A$B" == *ZW003* ]]; then pass "K9 wrapper: two payments from equal forms at once: exactly one, the other stale ($A | $B)"
else fail "K9" "a=$A b=$B net=$NX"; fi

# ---------------------------------------------------------------- K10 deadlock probe (opposite list orders)
RA=$(credit k10a 10000); RB=$(credit k10b 10000); IA=$(issued k10ia 10000); IB=$(issued k10ib 10000)
run_as "$OUT/k10a" "$AD1" "$(alloc_call "$RA" "$(A2 "$IA" 1000 "$IB" 1000)" k10a)" &
run_as "$OUT/k10b" "$AD2" "$(alloc_call "$RB" "$(A2 "$IB" 1000 "$IA" 1000)" k10b)" & wait
A=$(res "$OUT/k10a"); B=$(res "$OUT/k10b"); DL=$(cat "$OUT/k10a.err" "$OUT/k10b.err" | grep -c 40P01)
if [[ "$A" == *:true && "$B" == *:true ]] && [ "$DL" = 0 ] && [ "$(net "$IA")" = 2000 ] && [ "$(net "$IB")" = 2000 ]; then pass "K10 opposite-order multi-invoice allocations at once: both succeed, no deadlock (ascending lock order)"
else fail "K10" "a=$A b=$B deadlocks=$DL"; fi

# ---------------------------------------------------------------- K11 refund correction vs new refund (code review, both orders)
for order in correct-first refund-first; do
  R=$(credit "k11-$order" 1000)
  RF0=$(as_admin "select (r).entry_id from (select public.billing_record_refund('$ORG', '$R', 1000, current_date, 'cash', null, null, 'Full refund', 'lrf-k11-0-$order-$STAMP') r) s")
  CO="select (r).unallocated_cents || ':' || (r).changed from (select public.billing_reverse_refund('$ORG', '$RF0', 'Entered by mistake', 'lrrv-k11-$order-$STAMP') r) s"
  NR="select (r).unallocated_cents || ':' || (r).changed from (select public.billing_record_refund('$ORG', '$R', 1000, current_date, 'cash', null, null, 'Second refund', 'lrf-k11-1-$order-$STAMP') r) s"
  if [ "$order" = correct-first ]; then run_as "$OUT/k11c" "$AD1" "$CO" & sleep 0.3; run_as "$OUT/k11r" "$AD2" "$NR" & wait
  else run_as "$OUT/k11r" "$AD2" "$NR" & sleep 0.3; run_as "$OUT/k11c" "$AD1" "$CO" & wait; fi
  C=$(res "$OUT/k11c"); N=$(res "$OUT/k11r"); U=$(unal "$R")
  ACT=$($PSQL -c "select public._billing_receipt_refunded('$R')")
  if [ "$ACT" -le 1000 ] && [ $((ACT + U)) = 1000 ] && { [[ "$order" = correct-first && "$N" == *:true && "$C" == *:true ]] || [[ "$order" = refund-first && "$N" == *refund_exceeds_refundable* && "$C" == *:true ]]; }; then
    pass "K11 refund correction vs new refund ($order): active refunds never exceed the receipt (active=$ACT credit=$U; correct=$C refund=$N)"
  else fail "K11 $order" "correct=$C refund=$N active=$ACT credit=$U"; fi
done

# ---------------------------------------------------------------- invariants
BAD=$($PSQL -c "select count(*) from public.billing_invoices i where i.organization_id='$ORG' and (public._billing_invoice_net(i.id) < 0 or public._billing_invoice_net(i.id) > i.total_cents or (i.status <> 'issued' and public._billing_invoice_net(i.id) <> 0))")
OVR=$($PSQL -c "select count(*) from public.billing_receipts r where r.organization_id='$ORG' and (public._billing_receipt_allocated(r.id) + public._billing_receipt_refunded(r.id) > r.gross_cents or public._billing_receipt_allocated(r.id) < 0 or (public._billing_receipt_is_reversed(r.id) and (public._billing_receipt_allocated(r.id) <> 0 or public._billing_receipt_refunded(r.id) <> 0)))")
OLD=$($PSQL -c "select count(*) from public.billing_payments where organization_id='$ORG'")
if [ "$BAD" = 0 ] && [ "$OVR" = 0 ] && [ "$OLD" = 0 ]; then pass "INV 0 <= paid <= total, money only on issued invoices; allocated + refunded <= gross; reversed receipts at net 0; billing_payments empty"
else fail "INV" "bad_invoices=$BAD bad_receipts=$OVR legacy_rows=$OLD"; fi

echo
if [ "$FAIL" = 0 ]; then echo "RESULT: ALL PASS"; else echo "RESULT: FAILURES"; fi
exit $FAIL
