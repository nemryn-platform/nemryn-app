#!/bin/bash
# NP-FIN-P1G atomic release rehearsal -- ISOLATED STACK ONLY (supabase_db_NemrynS1Iso, fictional seed).
S=/private/tmp/claude-501/-Users-datamatics-Nemryn/13539c08-482e-4c5b-8692-b24cd200d0e8/scratchpad
R=/Users/datamatics/Nemryn
ISO=$HOME/NemrynS1Iso
PKG=$R/docs/reports/NP-FIN-P1G-atomic-release-package.sql
RB=$R/docs/reports/NP-FIN-P1G-emergency-reversal.sql
PSQL="docker exec -i supabase_db_NemrynS1Iso psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1"
A=10000000-0000-0000-0000-0000000000a1; B=10000000-0000-0000-0000-0000000000b1
UA=20000000-0000-0000-0000-0000000000a1; D1=20000000-0000-0000-0000-0000000000d1; PA=40000000-0000-0000-0000-0000000000a1
q() { $PSQL -c "$1" 2>&1; }
fp() { $PSQL -f - < $S/fingerprint.sql; }
mhead() { q "select count(*) || ' / ' || max(version) from supabase_migrations.schema_migrations"; }
as_a1() { q "begin; set local role authenticated; set local request.jwt.claim.sub = '$UA'; $1; commit;" | grep -vE '^(BEGIN|SET|COMMIT)$'; }
as_d1() { q "begin; set local role authenticated; set local request.jwt.claim.sub = '$D1'; $1; commit;" | grep -vE '^(BEGIN|SET|COMMIT)$'; }
log() { echo "$*"; }
check() { if [ "$2" = "$3" ]; then log "PASS $1 :: $2"; else log "FAIL $1 :: got [$2] expected [$3]"; fi; }
to_base() {
  mkdir -p $S/held; for v in 20261029100000 20261029110000 20261029120000; do mv $ISO/supabase/migrations/${v}_*.sql $S/held/ 2>/dev/null; done
  (cd $ISO && supabase db reset --local >/dev/null 2>&1)
}
restore_dir() { mv $S/held/*.sql $ISO/supabase/migrations/ 2>/dev/null; }
trip() { q "insert into trips (organization_id, passenger_id, state, pickup_description, destination_description, scheduled_pickup_at, completed_at) values ('$A', '$PA', 'completed', 'REH-$1 pickup', 'REH destination', now() - interval '2 days', now() - interval '47 hours') returning id" | grep -E '^[0-9a-f-]{36}$'; }
issued_invoice() { # $1 trip id, $2 key
  local inv=$(as_a1 "select (r).invoice_id from (select public.billing_create_invoice_draft('$A', '{$1}'::uuid[], 'passenger', '$PA', null, null, '$2') r) s")
  as_a1 "select (public.billing_update_invoice_draft('$A', '$inv', (select version from public.billing_invoices where id = '$inv'), 'Payer', null, null, null, '[{\"description\":\"Ride\",\"quantity\":\"1\",\"unit_cents\":5000,\"trip_id\":\"$1\",\"source\":\"trip\"}]'::jsonb, 0, null)).status" >/dev/null
  as_a1 "select (public.billing_issue_invoice('$A', '$inv', (select version from public.billing_invoices where id = '$inv'), current_date - 1, null)).status" >/dev/null
  echo $inv
}

python3 $S/build_package.py --inject-m3-failure --out $S/pkg-inject.sql >/dev/null || { echo "variant build failed"; exit 1; }
python3 $S/build_package.py --hold-before-commit 25 --out $S/pkg-hold.sql >/dev/null || { echo "variant build failed"; exit 1; }
log "variants built: $(grep -c 'REHEARSAL' $S/pkg-inject.sql) / $(grep -c 'REHEARSAL' $S/pkg-hold.sql) rehearsal markers"
log "=== R0 baseline: isolated stack at production's head"
to_base
check "R0 head" "$(mhead)" "98 / 20261028100000"
F98=$(fp); log "R0 schema fingerprint F98 = $F98"

log "=== R1 deliberately failing M3 (file mode) -> full rollback"
OUT=$($PSQL -f - < $S/pkg-inject.sql 2>&1 | grep -E "ERROR" | head -1)
log "R1 error: $OUT"
check "R1 head unchanged" "$(mhead)" "98 / 20261028100000"
check "R1 fingerprint unchanged" "$(fp)" "$F98"
check "R1 no FIN-P1 / P1G object" "$(q "select (to_regclass('public.billing_receipts') is null and to_regclass('public.billing_write_enablements') is null and to_regprocedure('public.billing_can(uuid,text)') is null)::text")" "true"

log "=== R1b deliberately failing M3 (whole file as ONE request: supabase db query -f, the CLI path used with --linked)"
OUT=$(cd $ISO && supabase db query --local -f $S/pkg-inject.sql 2>&1 | grep -iE "error|injected" | head -1)
log "R1b error: $OUT"
check "R1b fingerprint unchanged" "$(fp)" "$F98"

log "=== R2 zero-row gate stays mandatory (a BILL-P1 payment exists -> package refused)"
T=$(trip Z1); INV=$(issued_invoice $T reh-zero-1)
as_a1 "select (public.billing_record_payment('$A', '$INV', (select version from public.billing_invoices where id = '$INV'), 1000, current_date - 1, 'check', 'CHK-REH', null, 'reh-pay-1')).paid_cents" >/dev/null
check "R2 fixture payment present" "$(q "select count(*) from billing_payments")" "1"
OUT=$($PSQL -f - < $PKG 2>&1 | grep -E "ERROR" | head -1)
log "R2 error: $OUT"
check "R2 fingerprint unchanged" "$(fp)" "$F98"
check "R2 payment untouched" "$(q "select count(*) from billing_payments")" "1"

log "=== R3 concurrency: package held open before COMMIT; outside sessions"
to_base
T1=$(trip C1); T2=$(trip C2); INV=$(issued_invoice $T1 reh-conc-1)
INV_COUNT0=$(q "select count(*) from billing_invoices")
( $PSQL -f - < $S/pkg-hold.sql > $S/pkg-hold.out 2>&1; echo "EXIT=$?" >> $S/pkg-hold.out ) &
PKGPID=$!
for i in $(seq 1 60); do [ "$(q "select count(*) from pg_stat_activity where query like '%pg_sleep(25)%' and state = 'active' and pid <> pg_backend_pid()")" = "1" ] && break; sleep 1; done
log "R3 package is now inside its transaction (sleeping before COMMIT)"
check "R3a outside: head still 98 (no partial history visible)" "$(mhead)" "98 / 20261028100000"
check "R3b outside: no FIN-P1 / P1G object visible" "$(q "select (to_regclass('public.billing_receipts') is null and to_regclass('public.billing_write_enablements') is null)::text")" "true"
check "R3c outside: reads continue (invoice readable within 5 s)" "$(as_a1 "set local statement_timeout = '5s'; select status from public.billing_get_invoice('$A', '$INV')")" "issued"
( as_a1 "select (public.billing_record_payment('$A', '$INV', (select version from public.billing_invoices where id = '$INV'), 500, current_date - 1, 'cash', null, null, 'reh-pay-conc')).paid_cents" > $S/c1.out 2>&1 ) &
( as_a1 "select (r).invoice_id from (select public.billing_create_invoice_draft('$A', '{$T2}'::uuid[], 'passenger', '$PA', null, null, 'reh-draft-conc') r) s" > $S/c2.out 2>&1 ) &
sleep 3
check "R3d outside: an old-app payment and a draft creation WAIT on the package's locks" "$(q "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and (query like '%billing_record_payment%' or query like '%billing_create_invoice_draft%')")" "2"
wait $PKGPID; wait
log "R3 package: $(tail -1 $S/pkg-hold.out)"
check "R3e package committed: head" "$(mhead)" "101 / 20261029120000"
log "R3f waiting payment result: $(grep -E 'ERROR|^[0-9]' $S/c1.out | head -1)"
log "R3g waiting draft result:   $(grep -E 'ERROR|^[0-9a-f]' $S/c2.out | head -1)"
check "R3h no payment, receipt or draft slipped in" "$(q "select (select count(*) from billing_payments) || '|' || (select count(*) from billing_receipts) || '|' || (select count(*) from billing_invoices)")" "0|0|$INV_COUNT0"
check "R3i no organization enabled" "$(q "select count(*) from billing_write_enablements")" "0"

log "=== R4 post-release verification"
restore_dir; log "R4a supabase migration list (local), FIN rows:"; (cd $ISO && supabase migration list --local 2>&1 | grep -E "2026102(8100000|9100000|9110000|9120000)" | sed 's/^/      /')
log "R4b supabase db push --dry-run (local): $(cd $ISO && supabase db push --local --dry-run 2>&1 | grep -iE 'up to date|would push|20261029' | head -3 | tr '\n' ' ')"
check "R4c privilege contract (branch)" "$($PSQL -f - < $R/supabase/tests/privilege_contract_tests.sql 2>&1 | grep SUMMARY | grep -oE 'violations = [0-9]+ of [0-9]+')" "violations = 0 of 29"
check "R4d gate triggers" "$(q "select count(*) from pg_trigger where tgname = 'a_billing_write_gate'")" "12"
check "R4e disabled write refused" "$(as_a1 "select (public.billing_record_receipt('$A', null, 'passenger', '$PA', null, 100, 0, current_date - 1, 'cash', null, null, null, false, '[]'::jsonb, null, false, 'rehearsal-r4e-0001')).changed" 2>&1 | grep -oE 'billing_not_enabled' | head -1)" "billing_not_enabled"
FREL=$(fp)

log "=== R5 re-running the package after release -> refused, nothing changes"
OUT=$($PSQL -f - < $PKG 2>&1 | grep -E "ERROR" | head -1); log "R5 error: $OUT"
check "R5 fingerprint unchanged" "$(fp)" "$FREL"

log "=== R6 rollback (FIN-P1 + P1G together) with an empty ledger -> back to F98"
OUT=$($PSQL -f - < $RB 2>&1 | grep -E "ERROR|COMMIT" | tail -1); log "R6 result: $OUT"
check "R6 head" "$(mhead)" "98 / 20261028100000"
check "R6 fingerprint identical to the pre-release schema" "$(fp)" "$F98"

log "=== R7 package again (psql -f) -> synthetic enablement works -> rollback refused once the ledger has rows"
OUT=$($PSQL -f - < $PKG 2>&1 | grep -E "ERROR|COMMIT" | tail -1); log "R7 package (psql -f): $OUT"
check "R7a head" "$(mhead)" "101 / 20261029120000"
check "R7b fingerprint equals the first release" "$(fp)" "$FREL"
check "R7c authorized synthetic enablement" "$(as_d1 "select (public.platform_set_billing_write_enablement('$A', 'enabled', 'synthetic', null, 'Rehearsal: synthetic fictional Org A', 0)).status")" "enabled"
check "R7d synthetic billing works (receipt recorded)" "$(as_a1 "select (public.billing_record_receipt('$A', null, 'passenger', '$PA', null, 1500, 0, current_date - 1, 'cash', null, null, null, false, '[]'::jsonb, null, false, 'rehearsal-r7d-0001')).changed")" "t"
FR7=$(fp)
OUT=$($PSQL -f - < $RB 2>&1 | grep -E "ERROR" | head -1); log "R7e rollback: $OUT"
check "R7e rollback refused, nothing changed" "$(fp)|$(q "select count(*) from billing_receipts")" "$FR7|1"

log "=== R8 rollback refused while a LIVE record exists (ledger empty)"
to_base; $PSQL -f - < $PKG >/dev/null 2>&1; restore_dir
as_d1 "select (public.platform_set_billing_write_enablement('$B', 'enabled', 'live', 'NP-LAUNCH-02 GO rehearsal (fictional)', 'Rehearsal live fixture', 0)).status" >/dev/null
as_d1 "select (public.platform_set_billing_write_enablement('$B', 'disabled', 'live', 'NP-LAUNCH-02 GO rehearsal (fictional)', 'Rehearsal live off', 1)).status" >/dev/null
FR8=$(fp)
OUT=$($PSQL -f - < $RB 2>&1 | grep -E "ERROR" | head -1); log "R8 rollback: $OUT"
check "R8 nothing changed" "$(fp)" "$FR8"

log "=== R9 FIN-P1's standalone reversal cannot remove FIN-P1 under the gate"
OUT=$($PSQL -f - < $R/docs/reports/NP-FIN-P1-emergency-reversal.sql 2>&1 | grep -E "ERROR" | head -1); log "R9 FIN-P1 script alone: $OUT"
check "R9 nothing changed" "$(fp)" "$FR8"

restore_dir
(cd $ISO && supabase db reset --local >/dev/null 2>&1)
log "=== restored isolated stack: $(mhead)"
