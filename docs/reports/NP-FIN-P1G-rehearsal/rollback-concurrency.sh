#!/bin/bash
# NP-FIN-P1G rollback concurrency rehearsal -- ISOLATED STACK ONLY (supabase_db_NemrynS1Iso, fictional seed).
# Each scenario starts from a fresh CLI reset (101 / 20261029120000). Usage: rollback-concurrency.sh <scratch dir>
S=$1
R=/Users/datamatics/Nemryn
ISO=$HOME/NemrynS1Iso
G=$R/docs/reports/NP-FIN-P1G-rehearsal/build_reversal.py
FP=$R/docs/reports/NP-FIN-P1G-rehearsal/fingerprint.sql
RB=$R/docs/reports/NP-FIN-P1G-emergency-reversal.sql
OLD=$S/rb-prefix.sql   # the pre-fix rollback (checks before locks), kept only to demonstrate the race
PSQL="docker exec -i supabase_db_NemrynS1Iso psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1"
A=10000000-0000-0000-0000-0000000000a1; B=10000000-0000-0000-0000-0000000000b1
UA=20000000-0000-0000-0000-0000000000a1; D1=20000000-0000-0000-0000-0000000000d1; PA=40000000-0000-0000-0000-0000000000a1
q() { $PSQL -c "$1" 2>&1; }
fp() { $PSQL -f - < $FP; }
dfp() { q "select concat_ws('|', (select count(*) from billing_invoices), (select count(*) from billing_receipts), (select count(*) from billing_allocations), (select count(*) from billing_refunds), (select count(*) from billing_payments), (select count(*) from billing_write_enablements), (select count(*) from billing_write_enablement_history), (select count(*) from supabase_migrations.schema_migrations), (select count(*) from audit_events))"; }
mhead() { q "select count(*) || ' / ' || max(version) from supabase_migrations.schema_migrations"; }
log() { echo "$*"; }
check() { if [ "$2" = "$3" ]; then log "PASS $1 :: $2"; else log "FAIL $1 :: got [$2] expected [$3]"; fi; }
as_user() { echo "begin; set local role authenticated; set local request.jwt.claim.sub = '$1'; $2; commit;"; }
held() { echo "begin; set local role authenticated; set local request.jwt.claim.sub = '$1'; $2; reset role; select pg_sleep($3); commit;"; }
enable_a() { q "$(as_user $D1 "select (public.platform_set_billing_write_enablement('$A', 'enabled', 'synthetic', null, 'Rollback rehearsal: fictional Org A', 0)).status")" >/dev/null; }
RECEIPT="select (public.billing_record_receipt('$A', null, 'passenger', '$PA', null, 1500, 0, current_date - 1, 'cash', null, null, null, false, '[]'::jsonb, null, false, 'rollback-rehearsal-rcpt-0001')).changed"
ENABLE_B="select (public.platform_set_billing_write_enablement('$B', 'enabled', 'synthetic', null, 'Rollback rehearsal: fictional Org B', 0)).status"
LIVE_B="select (public.platform_set_billing_write_enablement('$B', 'enabled', 'live', 'NP-LAUNCH-02 GO rehearsal (fictional)', 'Rollback rehearsal: live fixture', 0)).status"
fresh() { (cd $ISO && supabase db reset --local >/dev/null 2>&1); }
mktrip() { q "insert into trips (organization_id, passenger_id, state, pickup_description, destination_description, scheduled_pickup_at, completed_at) values ('$A', '$PA', 'completed', 'ROLLBACK-REH pickup', 'ROLLBACK-REH destination', now() - interval '2 days', now() - interval '47 hours') returning id" | grep -E '^[0-9a-f-]{36}$'; }
mkdraft() { local t=$(mktrip); q "$(as_user $UA "select (r).invoice_id from (select public.billing_create_invoice_draft('$A', '{$t}'::uuid[], 'passenger', '$PA', null, null, '$1') r) s")" | grep -E '^[0-9a-f-]{36}$'; }
waiting() { q "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and pid <> pg_backend_pid() and query like '%$1%'"; }
until_sleeping() { for i in $(seq 1 60); do [ "$(q "select count(*) from pg_stat_activity where query like '%pg_sleep($1)%' and state = 'active' and pid <> pg_backend_pid()")" -ge 1 ] && return; sleep 0.5; done; }
F98=c020587ada8bfef35477795b6239e9d7

fresh; F101=$(fp); log "fresh state: $(mhead); schema fingerprint F101 = $F101"

log "=== S0 RACE DEMONSTRATION with the PRE-FIX rollback: a receipt in flight when the rollback starts"
fresh; enable_a
( $PSQL -c "$(held $UA "$RECEIPT" 6)" > $S/s0-x.out 2>&1 ) &
until_sleeping 6
OUT=$($PSQL -f - < $OLD 2>&1 | grep -E "ERROR|COMMIT" | tail -1); wait
log "S0 receipt session: $(grep -E '^t$|ERROR' $S/s0-x.out | head -1); pre-fix rollback: $OUT; head now $(mhead)"
log "S0 => the receipt COMMITTED, then the pre-fix rollback dropped billing_receipts: a committed financial record was LOST (the reported defect)"

log "=== S1 FIXED: a receipt committed immediately before the rollback's lock acquisition"
fresh; enable_a
( $PSQL -c "$(held $UA "$RECEIPT" 6)" > $S/s1-x.out 2>&1 ) &
until_sleeping 6
( $PSQL -f - < $RB > $S/s1-rb.out 2>&1 ) & RBPID=$!
sleep 2
check "S1a the rollback WAITS for the in-flight receipt (lock)" "$(waiting 'lock table public.billing_invoice_counters')" "1"
wait $RBPID; wait
log "S1 receipt session: $(grep -E '^t$|ERROR' $S/s1-x.out | head -1); rollback: $(grep -E 'ERROR|COMMIT' $S/s1-rb.out | tail -1)"
check "S1b receipt kept; schema and history unchanged" "$(q "select count(*) from billing_receipts")|$(fp)|$(mhead)" "1|$F101|101 / 20261029120000"

log "=== S2 a receipt AND an enablement change attempted while the rollback holds its locks (rollback commits)"
fresh; enable_a
mkdraft rollback-rehearsal-draft-01 > $S/s2-draft.out
check "S2 fixture: a BILL-P1 draft invoice exists (not ledger)" "$(q "select count(*) from billing_invoices where idempotency_key = 'rollback-rehearsal-draft-01'")" "1"
python3 $G --hold-after-guard 15 --out $S/rb-hold.sql >/dev/null
( $PSQL -f - < $S/rb-hold.sql > $S/s2-rb.out 2>&1 ) & RBPID=$!
until_sleeping 15
( $PSQL -c "$(as_user $UA "$RECEIPT")" > $S/s2-x.out 2>&1 ) &
( $PSQL -c "$(as_user $D1 "$ENABLE_B")" > $S/s2-y.out 2>&1 ) &
sleep 3
check "S2a the receipt and the enablement change both WAIT on the rollback's locks" "$(q "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and (query like '%billing_record_receipt%' or query like '%platform_set_billing_write_enablement%')")" "2"
wait $RBPID; wait
log "S2 rollback: $(grep -E 'ERROR|COMMIT' $S/s2-rb.out | tail -1)"
log "S2 waiting receipt: $(grep -E '^t$|ERROR' $S/s2-x.out | head -1)"
log "S2 waiting enablement: $(grep -E '^enabled$|ERROR' $S/s2-y.out | head -1)"
check "S2b rolled back to 98, schema identical to pre-release, BILL-P1 draft invoice preserved" "$(mhead)|$(fp)|$(q "select count(*) from billing_invoices where idempotency_key = 'rollback-rehearsal-draft-01'")" "98 / 20261028100000|$F98|1"

log "=== S3 same boundary, but the rollback FAILS after taking its locks (injected) -> the waiting writes then proceed normally"
fresh; enable_a
python3 $G --hold-after-guard 15 --inject-failure --out $S/rb-hold-inject.sql >/dev/null
D0=$(dfp)
( $PSQL -f - < $S/rb-hold-inject.sql > $S/s3-rb.out 2>&1 ) & RBPID=$!
until_sleeping 15
( $PSQL -c "$(as_user $UA "$RECEIPT")" > $S/s3-x.out 2>&1 ) &
( $PSQL -c "$(as_user $D1 "$ENABLE_B")" > $S/s3-y.out 2>&1 ) &
sleep 3
check "S3a both writes WAIT" "$(q "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and (query like '%billing_record_receipt%' or query like '%platform_set_billing_write_enablement%')")" "2"
wait $RBPID; wait
log "S3 rollback: $(grep -E 'ERROR' $S/s3-rb.out | head -1)"
log "S3 receipt after the failed rollback: $(grep -E '^t$|ERROR' $S/s3-x.out | head -1); enablement: $(grep -E '^enabled$|ERROR' $S/s3-y.out | head -1)"
check "S3b schema + history unchanged; the two writes committed afterwards (receipt 1, enablement rows 2)" "$(fp)|$(mhead)|$(q "select count(*) from billing_receipts")|$(q "select count(*) from billing_write_enablements")" "$F101|101 / 20261029120000|1|2"

log "=== S4 a LIVE enablement in flight when the rollback starts"
fresh
( $PSQL -c "$(held $D1 "$LIVE_B" 6)" > $S/s4-y.out 2>&1 ) &
until_sleeping 6
D0=$(dfp)
( $PSQL -f - < $RB > $S/s4-rb.out 2>&1 ) & RBPID=$!
sleep 2
check "S4a the rollback WAITS for the in-flight enablement" "$(waiting 'lock table public.billing_invoice_counters')" "1"
wait $RBPID; wait
log "S4 enablement: $(grep -E '^enabled$|ERROR' $S/s4-y.out | head -1); rollback: $(grep -E 'ERROR|COMMIT' $S/s4-rb.out | tail -1)"
check "S4b live record kept; schema and history unchanged" "$(q "select data_class || ':' || status from billing_write_enablements where organization_id = '$B'")|$(fp)|$(mhead)" "live:enabled|$F101|101 / 20261029120000"

log "=== S4c the same with the PRE-FIX rollback (for comparison)"
fresh
( $PSQL -c "$(held $D1 "$LIVE_B" 6)" > $S/s4c-y.out 2>&1 ) &
until_sleeping 6
OUT=$($PSQL -f - < $OLD 2>&1 | grep -E "ERROR|COMMIT" | tail -1); wait
log "S4c enablement: $(grep -E '^enabled$|ERROR' $S/s4c-y.out | head -1); pre-fix rollback: $OUT; head now $(mhead)"

log "=== S5 a historical LIVE record (current row synthetic) -> refused (stricter rule)"
fresh
q "$(as_user $D1 "$LIVE_B")" >/dev/null
q "$(as_user $D1 "select (public.platform_set_billing_write_enablement('$B', 'enabled', 'synthetic', null, 'Rollback rehearsal: back to synthetic', 1)).status")" >/dev/null
D0=$(dfp)
OUT=$($PSQL -f - < $RB 2>&1 | grep -E "ERROR" | head -1); log "S5 rollback: $OUT"
check "S5 nothing changed" "$(fp)|$(dfp)" "$F101|$D0"

log "=== S6 a legacy billing_payments row (owner bypass) -> refused"
fresh; enable_a; INV=$(mkdraft rollback-rehearsal-draft-03)
q "set session_replication_role = replica; insert into billing_payments (organization_id, invoice_id, entry_kind, amount_cents, received_on, method, idempotency_key, recorded_by) values ('$A', '$INV', 'payment', 100, current_date, 'cash', 'rollback-rehearsal-legacy-pay', '$UA');" > $S/s6-fx.out
check "S6 fixture: one legacy payment" "$(q "select count(*) from billing_payments")" "1"
D0=$(dfp)
OUT=$($PSQL -f - < $RB 2>&1 | grep -E "ERROR" | head -1); log "S6 rollback: $OUT"
check "S6 nothing changed" "$(fp)|$(dfp)" "$F101|$D0"

log "=== S7 migration head moved (a later version recorded) -> refused"
fresh
q "insert into supabase_migrations.schema_migrations (version, name) values ('20261030000000', 'rehearsal_later_version')" >/dev/null
D0=$(dfp); F0=$(fp)
OUT=$($PSQL -f - < $RB 2>&1 | grep -E "ERROR" | head -1); log "S7 rollback: $OUT"
check "S7 nothing changed" "$(fp)|$(dfp)" "$F0|$D0"

log "=== S8 success path (empty ledger, synthetic enablement, a BILL-P1 draft) -> COMMIT, pre-release schema, draft kept"
fresh; enable_a
mkdraft rollback-rehearsal-draft-02 >/dev/null
OUT=$($PSQL -f - < $RB 2>&1 | grep -E "ERROR|COMMIT" | tail -1); log "S8 rollback: $OUT"
check "S8 98 / pre-release schema / draft invoice kept" "$(mhead)|$(fp)|$(q "select count(*) from billing_invoices where idempotency_key = 'rollback-rehearsal-draft-02'")" "98 / 20261028100000|$F98|1"

fresh; log "=== restored: $(mhead); privilege contract: $($PSQL -f - < $R/supabase/tests/privilege_contract_tests.sql 2>&1 | grep SUMMARY | grep -oE 'violations = [0-9]+ of [0-9]+')"
