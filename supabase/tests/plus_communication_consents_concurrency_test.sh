#!/bin/bash
# Nemryn Plus -- communication consent ledger under REAL concurrency (NP-P2-S6-A, refinement R2). Parallel psql processes,
# each its own transaction that holds its locks ~1s after the call, so the other session genuinely waits.
#
#   Scenario 1:  grant vs revoke on the same pair (both orders)        -> both rows; the later writer has the higher seq
#                and decides the state (seq order = serialized write order).
#   Scenario 2:  the same idempotency key twice at once, same contact   -> exactly one row; one changed=true, one false.
#   Scenario 3:  the same key at once on two contacts of one org       -> exactly one row; the other ZW006 conflict.
#   Scenario 4:  two corrections of the same latest row at once        -> exactly one applies, the other ZW003.
#   Scenario 5:  DNC switch-on vs grant, DNC first                     -> the waiting grant is refused (ZW004).
#   Scenario 6:  DNC switch-on vs grant, grant first                   -> the waiting DNC switch-on revokes that grant.
#   Scenario 7:  a delayed grant with an older captured_at vs a revoke -> the grant that waited is refused (stale_evidence).
#   Scenario 8:  revocation followed by a later grant                  -> granted again (no false stale refusal).
#   Scenario 9:  DNC cleared after system revocations                  -> nothing revives.
#   Scenario 10: two DNC switch-ons from the same version at once      -> one applies (other ZW003); ONE revocation set.
#   Scenario 11: a consent write whose transaction then fails          -> nothing persists; the same key works afterwards.
#   Scenario 12: six staggered writers on one pair                     -> seq order equals the order the writers got the
#                lock (post-call clock order); the final state is the last writer's.
#   INVARIANT (every scenario): turning DNC on never leaves a pair whose latest row is granted, and clearing DNC never
#   makes one effective again.
#
# Run with:  bash supabase/tests/plus_communication_consents_concurrency_test.sh
# ISOLATION GUARD (fails closed): runs ONLY against the disposable local isolated stack -- container
# supabase_db_NemrynS1Iso, labelled com.supabase.cli.project=NemrynS1Iso, reached through a LOCAL Docker socket
# (DOCKER_HOST unset, unix:// context), database "postgres", fictional seed fingerprint 2/1/0. There is no override:
# any other container (including the shared supabase_db_ZenWard dev stack), a remote Docker endpoint, another database or
# an unexpected seed exits 2 before anything is written. A hosted / production Supabase database is never reachable from
# here (only `docker exec` into a local container is used; no connection string, URL or key is read).
# Throwaway organization (Plus active) + two throwaway Admins, all removed on exit (also on failure). Synthetic data only.
# Cleanup removes the throwaway ledger rows with session_replication_role = replica (test-only: the append-only triggers
# are a production guarantee; this script deletes only the rows it created in its own throwaway organization).
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
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('S6 Consents Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
# every cleanup statement is scoped to these three freshly created ids; never run cleanup without them
[[ "$ORG" =~ $UUID_RE && "$AD1" =~ $UUID_RE && "$AD2" =~ $UUID_RE ]] || refuse "throwaway fixture ids were not created ('$ORG' '$AD1' '$AD2')"
OUT=$(mktemp -d)
cleanup() {
  [[ "$ORG" =~ $UUID_RE && "$AD1" =~ $UUID_RE && "$AD2" =~ $UUID_RE ]] || return 0
  $PSQL >/dev/null <<SQL
set session_replication_role = replica;
delete from public.plus_communication_consents where organization_id='$ORG';
set session_replication_role = origin;
delete from public.audit_events where organization_id='$ORG';
delete from public.plus_activities where organization_id='$ORG';
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
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 's6-conc-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
$PSQL >/dev/null <<SQL
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', 'S6 concurrency fixture');
SQL
FAIL=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1 :: $2"; FAIL=1; }
as_user() { # $1 user, $2 statement; one committed transaction; prints the result (or the error code)
  $PSQL <<SQL 2>&1 | grep -vE '^(BEGIN|SET|COMMIT|ROLLBACK)$' | sed -E 's/^ERROR: +([A-Z0-9]{5}): .*/ERR:\1/'
\set VERBOSITY verbose
begin; set local role authenticated; set local request.jwt.claim.sub = '$1';
$2;
commit;
SQL
}
run_as() { # $1 out prefix, $2 user, $3 call; prints its result + the post-call clock; holds its locks ~1s
  $PSQL > "$1.out" 2> "$1.err" <<SQL
\set VERBOSITY verbose
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$2';
$3;
select 'T=' || to_char(clock_timestamp(), 'HH24:MI:SS.US');
reset role;
select pg_sleep(1.0);
commit;
SQL
}
res() { # result line of a session: ok row, or ERR:<code>
  if grep -qE 'ERROR' "$1.err"; then grep -oE 'ERROR: +[A-Z0-9]{5}' "$1.err" | head -1 | sed -E 's/ERROR: +/ERR:/'; else grep -vE '^(T=.*|BEGIN|SET|RESET|COMMIT)?$' "$1.out" | head -1; fi
}
new_contact() { # $1 name, $2 phone, $3 email -> contact id
  $PSQL -c "insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by) values ('$ORG', '$1', $2, $3, 'individual', '$AD1') returning id" | head -1
}
rec() { # grant call text: $1 contact $2 channel $3 purpose $4 key [$5 captured_at sql] [$6 corrects id sql] [$7 note sql]
  echo "select r.changed || ',' || r.recorded_status || ',' || r.effective_status || ',' || r.consent_id from public.plus_record_consent('$ORG', '$1', '$2', '$3', 'verbal_phone', ${5:-null}, ${7:-null}, ${6:-null}, '$4') r"
}
rev() { # revoke call text (same arguments)
  echo "select r.changed || ',' || r.recorded_status || ',' || r.effective_status || ',' || r.consent_id from public.plus_revoke_consent('$ORG', '$1', '$2', '$3', 'written', ${5:-null}, ${7:-null}, ${6:-null}, '$4') r"
}
dnc_call() { # $1 contact $2 true|false; uses the CURRENT version (or $3 = a fixed version literal)
  local ver=${3:-"(select updated_at from public.plus_contacts where id = '$1')"}
  echo "select 'upd:' || r.changed from public.plus_contacts c, lateral public.plus_update_contact('$ORG', '$1', $ver, c.display_name, c.phone, c.email, c.contact_kind, c.job_title, c.preferred_channel, $2, null) r where c.id = '$1'"
}
latest() { # $1 contact $2 channel $3 purpose -> status of the highest-seq row
  $PSQL -c "select coalesce((select status from public.plus_communication_consents where contact_id = '$1' and channel = '$2' and purpose = '$3' order by seq desc limit 1), 'none')"
}
eff() { $PSQL -c "select public._plus_effective_consent('$ORG', '$1', '$2', '$3')"; }
granted_pairs() { # number of pairs of a contact whose latest row is granted
  $PSQL -c "select count(*) from (select distinct on (channel, purpose) status from public.plus_communication_consents where contact_id = '$1' order by channel, purpose, seq desc) l where status = 'granted'"
}
count_rows() { $PSQL -c "select count(*) from public.plus_communication_consents where contact_id = '$1'${2:+ and $2}"; }
seq_of_key() { $PSQL -c "select seq from public.plus_communication_consents where organization_id = '$ORG' and idempotency_key = '$1'"; }

# ---------------------------------------------------------------- Scenario 1: grant vs revoke (both orders)
for order in grant-first revoke-first; do
  C=$(new_contact "Conc S1 $order" "'404 555 0101'" "'s1-$order@example.test'")
  if [ "$order" = grant-first ]; then
    as_user "$AD1" "$(rec "$C" email marketing "s1-$order-seed")" >/dev/null   # a baseline grant so the revoke is meaningful
    run_as "$OUT/s1a" "$AD1" "$(rec "$C" email marketing "s1-$order-a" "now()")" & sleep 0.3
    run_as "$OUT/s1b" "$AD2" "$(rev "$C" email marketing "s1-$order-b")" & wait
    want=revoked
  else
    run_as "$OUT/s1a" "$AD1" "$(rev "$C" email marketing "s1-$order-a" "now() - interval '1 day'")" & sleep 0.3
    run_as "$OUT/s1b" "$AD2" "$(rec "$C" email marketing "s1-$order-b")" & wait
    want=granted
  fi
  SA=$(seq_of_key "s1-$order-a"); SB=$(seq_of_key "s1-$order-b"); L=$(latest "$C" email marketing)
  if [ -n "$SA" ] && [ -n "$SB" ] && [ "$SA" -lt "$SB" ] && [ "$L" = "$want" ]; then
    pass "S1 $order: both rows written; first writer seq $SA < waiting writer seq $SB; final = $L (the later writer)"
  else fail "S1 $order" "a=$(res "$OUT/s1a") b=$(res "$OUT/s1b") seqA=$SA seqB=$SB latest=$L"; fi
done

# ---------------------------------------------------------------- Scenario 2: same key, same contact, at once
C=$(new_contact "Conc S2" "'404 555 0102'" "'s2@example.test'")
run_as "$OUT/s2a" "$AD1" "$(rec "$C" sms service_followup s2-same-key-1)" & sleep 0.3
run_as "$OUT/s2b" "$AD2" "$(rec "$C" sms service_followup s2-same-key-1)" & wait
RA=$(res "$OUT/s2a"); RB=$(res "$OUT/s2b"); N=$(count_rows "$C")
if [ "$N" = 1 ] && [[ "$RA" == true,granted,* ]] && [[ "$RB" == false,granted,* ]] && [ "${RA##*,}" = "${RB##*,}" ]; then
  pass "S2 same key twice at once (same contact): one row; changed true then false, same consent id"
else fail "S2" "a=$RA b=$RB rows=$N"; fi

# ---------------------------------------------------------------- Scenario 3: same key, two contacts, at once
C1=$(new_contact "Conc S3a" "'404 555 0103'" null); C2=$(new_contact "Conc S3b" "'404 555 0104'" null)
run_as "$OUT/s3a" "$AD1" "$(rec "$C1" voice marketing s3-shared-key-1)" & sleep 0.3
run_as "$OUT/s3b" "$AD2" "$(rec "$C2" voice marketing s3-shared-key-1)" & wait
RA=$(res "$OUT/s3a"); RB=$(res "$OUT/s3b"); N=$($PSQL -c "select count(*) from public.plus_communication_consents where organization_id = '$ORG' and idempotency_key = 's3-shared-key-1'")
if [ "$N" = 1 ] && [[ "$RA" == true,granted,* ]] && [ "$RB" = "ERR:ZW006" ] && [ "$(count_rows "$C2")" = 0 ]; then
  pass "S3 same key on two contacts at once: exactly one row; the waiting writer gets ZW006 (unique index + conflict mapping)"
else fail "S3" "a=$RA b=$RB rows=$N"; fi

# ---------------------------------------------------------------- Scenario 4: concurrent corrections of the latest row
C=$(new_contact "Conc S4" "'404 555 0105'" "'s4@example.test'")
as_user "$AD1" "$(rec "$C" email service_followup s4-base-0001)" >/dev/null
BASE=$($PSQL -c "select id from public.plus_communication_consents where idempotency_key = 's4-base-0001' and organization_id = '$ORG'")
run_as "$OUT/s4a" "$AD1" "$(rev "$C" email service_followup s4-corr-a "null" "'$BASE'" "'wrong person (a)'")" & sleep 0.3
run_as "$OUT/s4b" "$AD2" "$(rev "$C" email service_followup s4-corr-b "null" "'$BASE'" "'wrong person (b)'")" & wait
RA=$(res "$OUT/s4a"); RB=$(res "$OUT/s4b"); N=$(count_rows "$C" "corrects_consent_id is not null")
if [ "$N" = 1 ] && [[ "$RA" == true,revoked,* ]] && [ "$RB" = "ERR:ZW003" ]; then
  pass "S4 two corrections of the same latest row: exactly one applies, the other ZW003"
else fail "S4" "a=$RA b=$RB corrections=$N"; fi

# ---------------------------------------------------------------- Scenario 5: DNC switch-on first, grant waits
C=$(new_contact "Conc S5" "'404 555 0106'" "'s5@example.test'")
as_user "$AD1" "$(rec "$C" email marketing s5-seed-0001)" >/dev/null
run_as "$OUT/s5a" "$AD1" "$(dnc_call "$C" true)" & sleep 0.3
run_as "$OUT/s5b" "$AD2" "$(rec "$C" sms marketing s5-grant-0001)" & wait
RA=$(res "$OUT/s5a"); RB=$(res "$OUT/s5b"); G=$(granted_pairs "$C"); E=$(eff "$C" email marketing)
if [ "$RA" = "upd:true" ] && [ "$RB" = "ERR:ZW004" ] && [ "$G" = 0 ] && [ "$E" = suppressed_do_not_contact ] \
   && [ "$(count_rows "$C" "captured_via = 'do_not_contact'")" = 1 ]; then
  pass "S5 DNC switch-on first: the waiting grant re-reads the contact and is refused (ZW004); the earlier grant is revoked; 0 granted pairs"
else fail "S5" "dnc=$RA grant=$RB granted_pairs=$G eff=$E"; fi

# ---------------------------------------------------------------- Scenario 6: grant first, DNC switch-on waits
C=$(new_contact "Conc S6" "'404 555 0107'" "'s6@example.test'")
run_as "$OUT/s6a" "$AD1" "$(rec "$C" sms marketing s6-grant-0001)" & sleep 0.3
run_as "$OUT/s6b" "$AD2" "$(dnc_call "$C" true)" & wait
RA=$(res "$OUT/s6a"); RB=$(res "$OUT/s6b"); G=$(granted_pairs "$C")
SG=$(seq_of_key s6-grant-0001); SR=$($PSQL -c "select seq from public.plus_communication_consents where contact_id = '$C' and captured_via = 'do_not_contact'")
if [[ "$RA" == true,granted,* ]] && [ "$RB" = "upd:true" ] && [ "$G" = 0 ] && [ -n "$SR" ] && [ "$SG" -lt "$SR" ]; then
  pass "S6 grant first: the waiting DNC switch-on sees the committed grant and revokes it (grant seq $SG < system revocation seq $SR); 0 granted pairs"
else fail "S6" "grant=$RA dnc=$RB granted_pairs=$G seqs=$SG/$SR"; fi

# ---------------------------------------------------------------- Scenario 7: delayed grant with older evidence vs revoke
C=$(new_contact "Conc S7" "'404 555 0108'" "'s7@example.test'")
run_as "$OUT/s7a" "$AD1" "$(rev "$C" email marketing s7-revoke-0001)" & sleep 0.3
run_as "$OUT/s7b" "$AD2" "$(rec "$C" email marketing s7-grant-old1 "now() - interval '2 days'")" & wait
RA=$(res "$OUT/s7a"); RB=$(res "$OUT/s7b"); L=$(latest "$C" email marketing)
if [[ "$RA" == true,revoked,* ]] && [ "$RB" = "ERR:ZW004" ] && [ "$L" = revoked ]; then
  pass "S7 a delayed grant whose evidence predates a revocation committed while it waited -> refused (stale_evidence); state stays revoked"
else fail "S7" "revoke=$RA grant=$RB latest=$L"; fi

# ---------------------------------------------------------------- Scenario 8: revocation, then a later grant
R=$(as_user "$AD1" "$(rec "$C" email marketing s8-grant-new1)")
if [[ "$R" == true,granted,consent_on_record,* ]] && [ "$(latest "$C" email marketing)" = granted ]; then
  pass "S8 a later grant after the revocation records consent again (no false stale refusal)"
else fail "S8" "$R"; fi

# ---------------------------------------------------------------- Scenario 9: DNC cleared after system revocations
C=$(new_contact "Conc S9" "'404 555 0109'" "'s9@example.test'")
as_user "$AD1" "$(rec "$C" email marketing s9-g1-00001)" >/dev/null
as_user "$AD1" "$(rec "$C" voice service_followup s9-g2-00001)" >/dev/null
as_user "$AD1" "$(dnc_call "$C" true)" >/dev/null
as_user "$AD1" "$(dnc_call "$C" false)" >/dev/null
G=$(granted_pairs "$C"); E1=$(eff "$C" email marketing); E2=$(eff "$C" voice service_followup)
if [ "$G" = 0 ] && [ "$E1" = no_consent_on_record ] && [ "$E2" = no_consent_on_record ] && [ "$(count_rows "$C" "captured_via = 'do_not_contact'")" = 2 ]; then
  pass "S9 DNC on (2 system revocations) then off: nothing revives (no_consent_on_record, 0 granted pairs)"
else fail "S9" "granted_pairs=$G eff=$E1/$E2"; fi

# ---------------------------------------------------------------- Scenario 10: two DNC switch-ons from the same version
C=$(new_contact "Conc S10" "'404 555 0110'" "'s10@example.test'")
as_user "$AD1" "$(rec "$C" email marketing s10-g1-0001)" >/dev/null
as_user "$AD1" "$(rec "$C" sms service_followup s10-g2-0001)" >/dev/null
VER=$($PSQL -c "select updated_at from public.plus_contacts where id = '$C'")
run_as "$OUT/s10a" "$AD1" "$(dnc_call "$C" true "'$VER'::timestamptz")" & sleep 0.3
run_as "$OUT/s10b" "$AD2" "$(dnc_call "$C" true "'$VER'::timestamptz")" & wait
RA=$(res "$OUT/s10a"); RB=$(res "$OUT/s10b"); N=$(count_rows "$C" "captured_via = 'do_not_contact'")
if [ "$RA" = "upd:true" ] && [ "$RB" = "ERR:ZW003" ] && [ "$N" = 2 ] && [ "$(granted_pairs "$C")" = 0 ]; then
  pass "S10 two DNC switch-ons from the same version: one applies, the other ZW003; exactly one set of 2 system revocations"
else fail "S10" "a=$RA b=$RB system_revocations=$N"; fi

# ---------------------------------------------------------------- Scenario 11: the transaction fails after the write
C=$(new_contact "Conc S11" "'404 555 0111'" "'s11@example.test'")
A0=$($PSQL -c "select count(*) from public.audit_events where organization_id = '$ORG'")
$PSQL >/dev/null 2>&1 <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$AD1';
$(rec "$C" email marketing s11-rollback-1);
select 1 / 0;
commit;
SQL
$PSQL >/dev/null 2>&1 <<SQL
begin; set local role authenticated; set local request.jwt.claim.sub = '$AD1';
$(rec "$C" email service_followup s11-rollback-2);
$(dnc_call "$C" true);
rollback;
SQL
N=$(count_rows "$C"); A1=$($PSQL -c "select count(*) from public.audit_events where organization_id = '$ORG'")
DNC=$($PSQL -c "select do_not_contact from public.plus_contacts where id = '$C'")
R=$(as_user "$AD1" "$(rec "$C" email marketing s11-rollback-1)")
if [ "$N" = 0 ] && [ "$A0" = "$A1" ] && [ "$DNC" = f ] && [[ "$R" == true,granted,* ]]; then
  pass "S11 a failed / rolled-back transaction leaves no consent row, audit row or DNC change; the same key then works (changed=true)"
else fail "S11" "rows=$N audit=$A0->$A1 dnc=$DNC retry=$R"; fi

# ---------------------------------------------------------------- Scenario 12: six staggered writers on one pair
C=$(new_contact "Conc S12" "'404 555 0112'" "'s12@example.test'")
for i in 1 2 3 4 5 6; do
  if [ $((i % 2)) = 1 ]; then CALL=$(rec "$C" email marketing "s12-w$i-0001"); else CALL=$(rev "$C" email marketing "s12-w$i-0001"); fi
  run_as "$OUT/s12-$i" "$([ $((i % 2)) = 1 ] && echo "$AD1" || echo "$AD2")" "$CALL" & sleep 0.15
done
wait
ORDER_BY_CLOCK=$(for i in 1 2 3 4 5 6; do echo "$(grep -oE 'T=[0-9:.]+' "$OUT/s12-$i.out") $(seq_of_key "s12-w$i-0001") $i"; done | sort | awk '{print $2}' | tr '\n' ' ')
ORDER_BY_SEQ=$(for i in 1 2 3 4 5 6; do seq_of_key "s12-w$i-0001"; done | sort -n | tr '\n' ' ')
LAST_I=$(for i in 1 2 3 4 5 6; do echo "$(seq_of_key "s12-w$i-0001") $i"; done | sort -n | tail -1 | awk '{print $2}')
WANT=$([ $((LAST_I % 2)) = 1 ] && echo granted || echo revoked)
ERRS=$(for i in 1 2 3 4 5 6; do res "$OUT/s12-$i"; done | grep -c ERR)
if [ "$ORDER_BY_CLOCK" = "$ORDER_BY_SEQ" ] && [ "$(count_rows "$C")" = 6 ] && [ "$(latest "$C" email marketing)" = "$WANT" ] && [ "$ERRS" = 0 ]; then
  pass "S12 six staggered writers serialized on the contact lock: seq order == lock-acquisition (post-call clock) order [$ORDER_BY_SEQ]; final = last writer ($WANT)"
else fail "S12" "clock-order=[$ORDER_BY_CLOCK] seq-order=[$ORDER_BY_SEQ] rows=$(count_rows "$C") latest=$(latest "$C" email marketing) want=$WANT errs=$ERRS"; fi

# ---------------------------------------------------------------- global invariant
BAD=$($PSQL -c "select count(*) from public.plus_contacts k where k.organization_id = '$ORG' and k.do_not_contact
  and exists (select 1 from (select distinct on (channel, purpose) status from public.plus_communication_consents c
                             where c.contact_id = k.id order by channel, purpose, seq desc) l where l.status = 'granted')")
EFF=$($PSQL -c "select count(*) from public.plus_contacts k cross join (values ('email'), ('sms'), ('voice')) ch(c) cross join (values ('service_followup'), ('marketing')) pu(p)
  where k.organization_id = '$ORG' and k.do_not_contact and public._plus_effective_consent('$ORG', k.id, ch.c, pu.p) <> 'suppressed_do_not_contact'")
if [ "$BAD" = 0 ] && [ "$EFF" = 0 ]; then
  pass "INVARIANT no DNC contact in this run has a pair whose latest row is granted, and every DNC pair resolves to suppressed_do_not_contact"
else fail "INVARIANT" "dnc_with_granted=$BAD non_suppressed=$EFF"; fi

if [ "$FAIL" = 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; fi
exit $FAIL
