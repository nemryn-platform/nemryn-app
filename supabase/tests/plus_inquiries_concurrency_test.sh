#!/bin/bash
# Nemryn Plus -- public inquiry intake under REAL concurrency (NP-P2-S7-A). Parallel psql processes, each its own
# transaction that holds its locks ~1s after the call, so the other session genuinely waits.
#
#   Scenario 1: the same idempotency key submitted twice at once     -> exactly one inquiry; changed true + false.
#   Scenario 2: 12 parallel rate-limit attempts from one client       -> exactly 5 allowed (atomic count-then-insert).
#   Scenario 3: convert vs convert on one inquiry                     -> exactly one converts; one opportunity.
#   Scenario 4: convert vs dismiss, both orders                       -> exactly one transition wins.
#   Scenario 5: DNC switched on FIRST, then a link-conversion         -> conversion refused (acknowledgement), no grant.
#   Scenario 6: link-conversion FIRST, then DNC switched on           -> the waiting DNC switch-on revokes the new grants.
#   Scenario 7: a staff revocation commits FIRST, then a conversion   -> the older web evidence is NOT granted (stale).
#   INVARIANTS: one opportunity per inquiry; never a granted latest row on a do-not-contact contact; no Core row.
#
# Run with:  bash supabase/tests/plus_inquiries_concurrency_test.sh
# ISOLATION GUARD (fails closed; identical to plus_communication_consents_concurrency_test.sh): runs ONLY against the
# disposable local isolated stack -- container supabase_db_NemrynS1Iso (label com.supabase.cli.project=NemrynS1Iso),
# local Docker socket, database "postgres", fictional seed fingerprint 2/1/0. Anything else exits 2 before writing.
# Throwaway organization (Plus active, on the activation allowlist, one published form) + two throwaway Admins, all
# removed on exit (also on failure). Synthetic data only.
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
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('S7 Inquiries Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
[[ "$ORG" =~ $UUID_RE && "$AD1" =~ $UUID_RE && "$AD2" =~ $UUID_RE ]] || refuse "throwaway fixture ids were not created ('$ORG' '$AD1' '$AD2')"
OUT=$(mktemp -d)
CORE0=$($PSQL -c "select (select count(*) from transportation_requests) || '/' || (select count(*) from passengers) || '/' || (select count(*) from trips) || '/' || (select count(*) from notification_events)")
cleanup() {
  [[ "$ORG" =~ $UUID_RE && "$AD1" =~ $UUID_RE && "$AD2" =~ $UUID_RE ]] || return 0
  $PSQL >/dev/null <<SQL
set session_replication_role = replica;
delete from public.plus_communication_consents where organization_id='$ORG';
set session_replication_role = origin;
delete from public.audit_events where organization_id='$ORG';
delete from public.plus_activities where organization_id='$ORG';
delete from public.plus_opportunities where organization_id='$ORG';
delete from public.plus_inquiries where organization_id='$ORG';
delete from public.plus_inquiry_rate_limit_events where form_public_key in (select public_key from public.plus_inquiry_forms where organization_id='$ORG');
delete from public.plus_inquiry_forms where organization_id='$ORG';
delete from public.plus_inquiry_public_access where organization_id='$ORG';
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
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 's7-conc-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
KEY=$($PSQL <<SQL | grep -E '^inq_'
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', 'S7 concurrency fixture');
insert into public.plus_inquiry_public_access (organization_id, reason, enabled_by) values ('$ORG', 'S7 concurrency fixture', '$AD1');
insert into public.plus_inquiry_forms (organization_id, status, headline, consent_text_version, published_at, published_by, created_by, updated_by)
values ('$ORG', 'published', 'Concurrency form', 'plus-inquiry-consent-v1', now(), '$AD1', '$AD1', '$AD1') returning public_key;
SQL
)
[[ "$KEY" =~ ^inq_[0-9a-f]{32}$ ]] || refuse "fixture form was not created ('$KEY')"
FAIL=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1 :: $2"; FAIL=1; }
run_as() { # $1 out prefix, $2 role, $3 user (or ''), $4 call; prints its result; holds its locks ~1s
  $PSQL > "$1.out" 2> "$1.err" <<SQL
\set VERBOSITY verbose
begin;
set local role $2;
set local request.jwt.claim.sub = '$3';
$4;
reset role;
select pg_sleep(1.0);
commit;
SQL
}
res() { if grep -qE 'ERROR' "$1.err"; then grep -oE 'ERROR: +[A-Z0-9]{5}' "$1.err" | head -1 | sed -E 's/ERROR: +/ERR:/'; else grep -vE '^(BEGIN|SET|RESET|COMMIT)?$' "$1.out" | head -1; fi; }
submit() { # $1 idempotency key, $2 name, $3 phone sql, $4 email sql, $5 followup bool -> call text
  echo "select r.status || ':' || r.changed from public.submit_plus_inquiry('$KEY', '$1', 1, '$2', $3, $4, null, null, 'quote', null, null, 'Fictional question', $5, false, null) r"
}
mk_inquiry() { # $1 key $2 name $3 phone sql $4 email sql $5 followup -> inquiry id (committed)
  $PSQL -c "set role service_role; $(submit "$1" "$2" "$3" "$4" "$5")" >/dev/null
  $PSQL -c "select id from public.plus_inquiries where organization_id = '$ORG' and idempotency_key = '$1'"
}
ver() { $PSQL -c "select version from public.plus_inquiries where id = '$1'"; }
conv_call() { # $1 inquiry $2 mode $3 contact sql $4 ack
  echo "select r.outcome || '|' || r.consent_granted from public.plus_convert_inquiry('$ORG', '$1', $(ver "$1"), '$2', $3, true, false, null, null, $4) r"
}
dis_call() { echo "select r.status from public.plus_dismiss_inquiry('$ORG', '$1', $(ver "$1"), 'duplicate', null) r"; }
dnc_call() { echo "select 'upd:' || r.changed from public.plus_contacts c, lateral public.plus_update_contact('$ORG', c.id, c.updated_at, c.display_name, c.phone, c.email, c.contact_kind, c.job_title, c.preferred_channel, true, null) r where c.id = '$1'"; }
new_contact() { $PSQL -c "insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by) values ('$ORG', '$1', $2, $3, 'individual', '$AD1') returning id" | head -1; }
granted_pairs() { $PSQL -c "select count(*) from (select distinct on (channel, purpose) status from public.plus_communication_consents where contact_id = '$1' order by channel, purpose, seq desc) l where status = 'granted'"; }
opps_for() { $PSQL -c "select count(*) from public.plus_opportunities where inquiry_id = '$1'"; }

# ---------------------------------------------------------------- Scenario 1: same idempotency key at once
run_as "$OUT/s1a" service_role '' "$(submit s1-same-key-0001 'Conc One' "'404 555 0301'" null false)" & sleep 0.3
run_as "$OUT/s1b" service_role '' "$(submit s1-same-key-0001 'Conc One' "'404 555 0301'" null false)" & wait
RA=$(res "$OUT/s1a"); RB=$(res "$OUT/s1b"); N=$($PSQL -c "select count(*) from public.plus_inquiries where organization_id = '$ORG' and idempotency_key = 's1-same-key-0001'")
if [ "$N" = 1 ] && [ "$RA" = "accepted:true" ] && [ "$RB" = "accepted:false" ]; then pass "S1 same key twice at once: one inquiry; accepted changed true, then false"
else fail "S1" "a=$RA b=$RB rows=$N"; fi

# ---------------------------------------------------------------- Scenario 2: rate limit atomic under concurrency
CK=$(printf 'c%.0s' {1..64})
for i in $(seq 1 12); do
  $PSQL -c "set role service_role; select (public.check_and_record_plus_inquiry_rate_limit('$KEY', '$CK')).allowed" > "$OUT/s2-$i.out" 2>&1 &
done; wait
ALLOWED=$(cat "$OUT"/s2-*.out | grep -c '^t$'); ROWS=$($PSQL -c "select count(*) from public.plus_inquiry_rate_limit_events where client_key = '$CK'")
if [ "$ALLOWED" = 5 ] && [ "$ROWS" = 5 ]; then pass "S2 12 parallel attempts from one client: exactly 5 allowed and 5 recorded"
else fail "S2" "allowed=$ALLOWED rows=$ROWS"; fi

# ---------------------------------------------------------------- Scenario 3: convert vs convert
I=$(mk_inquiry s3-key-0001 'Conc Three' "'404 555 0303'" "'s3@example.test'" true)
C1=$(conv_call "$I" create null false); C2=$(conv_call "$I" create null false)
run_as "$OUT/s3a" authenticated "$AD1" "$C1" & sleep 0.3
run_as "$OUT/s3b" authenticated "$AD2" "$C2" & wait
RA=$(res "$OUT/s3a"); RB=$(res "$OUT/s3b")
if [[ "$RA" == converted\|* ]] && [[ "$RB" == ERR:ZW00[34] ]] && [ "$(opps_for "$I")" = 1 ]; then pass "S3 convert vs convert: exactly one converts ($RA), the other $RB; one opportunity"
else fail "S3" "a=$RA b=$RB opps=$(opps_for "$I")"; fi

# ---------------------------------------------------------------- Scenario 4: convert vs dismiss (both orders)
for order in convert-first dismiss-first; do
  I=$(mk_inquiry "s4-$order-01" "Conc Four $order" "'404 555 0304'" null false)
  CC=$(conv_call "$I" create null false); DC=$(dis_call "$I")
  if [ "$order" = convert-first ]; then
    run_as "$OUT/s4a" authenticated "$AD1" "$CC" & sleep 0.3; run_as "$OUT/s4b" authenticated "$AD2" "$DC" & wait; want=converted
  else
    run_as "$OUT/s4a" authenticated "$AD1" "$DC" & sleep 0.3; run_as "$OUT/s4b" authenticated "$AD2" "$CC" & wait; want=dismissed
  fi
  RA=$(res "$OUT/s4a"); RB=$(res "$OUT/s4b"); ST=$($PSQL -c "select status from public.plus_inquiries where id = '$I'")
  if [ "$ST" = "$want" ] && [[ "$RB" == ERR:ZW00[34] ]] && [ "$(opps_for "$I")" = "$([ $want = converted ] && echo 1 || echo 0)" ]; then
    pass "S4 $order: the first transition wins ($ST); the waiting one gets $RB"
  else fail "S4 $order" "a=$RA b=$RB status=$ST"; fi
done

# ---------------------------------------------------------------- Scenario 5: DNC on FIRST, then link-conversion
C=$(new_contact 'Conc Five' "'404 555 0305'" "'s5@example.test'")
I=$(mk_inquiry s5-key-0001 'Conc Five' "'404 555 0305'" "'s5@example.test'" true)
CC=$(conv_call "$I" link "'$C'" false)
run_as "$OUT/s5a" authenticated "$AD1" "$(dnc_call "$C")" & sleep 0.3
run_as "$OUT/s5b" authenticated "$AD2" "$CC" & wait
RA=$(res "$OUT/s5a"); RB=$(res "$OUT/s5b")
if [ "$RA" = "upd:true" ] && [ "$RB" = "ERR:ZW004" ] && [ "$(granted_pairs "$C")" = 0 ] && [ "$(opps_for "$I")" = 0 ]; then
  pass "S5 DNC switched on first: the waiting conversion sees it and is refused (acknowledgement required); no grant, no opportunity"
else fail "S5" "a=$RA b=$RB granted=$(granted_pairs "$C")"; fi

# ---------------------------------------------------------------- Scenario 6: link-conversion FIRST, then DNC on
C=$(new_contact 'Conc Six' "'404 555 0306'" "'s6@example.test'")
I=$(mk_inquiry s6-key-0001 'Conc Six' "'404 555 0306'" "'s6@example.test'" true)
CC=$(conv_call "$I" link "'$C'" false)
run_as "$OUT/s6a" authenticated "$AD1" "$CC" & sleep 0.3
run_as "$OUT/s6b" authenticated "$AD2" "$(dnc_call "$C")" & wait
RA=$(res "$OUT/s6a"); RB=$(res "$OUT/s6b"); REVS=$($PSQL -c "select count(*) from public.plus_communication_consents where contact_id = '$C' and captured_via = 'do_not_contact'")
if [ "$RA" = "converted|2" ] && [ "$RB" = "upd:true" ] && [ "$(granted_pairs "$C")" = 0 ] && [ "$REVS" = 2 ]; then
  pass "S6 conversion first (2 web_form grants), then DNC: the waiting switch-on revokes both; no granted pair remains"
else fail "S6" "a=$RA b=$RB granted=$(granted_pairs "$C") dnc_revocations=$REVS"; fi

# ---------------------------------------------------------------- Scenario 7: staff revocation FIRST, then conversion
C=$(new_contact 'Conc Seven' "'404 555 0307'" "'s7@example.test'")
I=$(mk_inquiry s7-key-0001 'Conc Seven' "'404 555 0307'" "'s7@example.test'" true)
$PSQL -c "update public.plus_inquiries set received_at = now() - interval '1 hour' where id = '$I'" >/dev/null
CC=$(conv_call "$I" link "'$C'" false)
REV="select r.changed::text from public.plus_revoke_consent('$ORG', '$C', 'email', 'service_followup', 'written', null, 'Asked to stop (fictional)', null, 's7-revoke-0001') r"
run_as "$OUT/s7a" authenticated "$AD1" "$REV" & sleep 0.3
run_as "$OUT/s7b" authenticated "$AD2" "$CC" & wait
RA=$(res "$OUT/s7a"); RB=$(res "$OUT/s7b"); EFF=$($PSQL -c "select public._plus_effective_consent('$ORG', '$C', 'email', 'service_followup')")
if [ "$RA" = "true" ] && [ "$RB" = "converted|1" ] && [ "$EFF" = "no_consent_on_record" ]; then
  pass "S7 revocation committed first: the older web evidence is NOT granted for email (stale), voice is; email stays revoked"
else fail "S7" "a=$RA b=$RB email_effective=$EFF"; fi

# ---------------------------------------------------------------- invariants
DUP=$($PSQL -c "select count(*) from (select inquiry_id from public.plus_opportunities where organization_id = '$ORG' and inquiry_id is not null group by 1 having count(*) > 1) d")
CORE1=$($PSQL -c "select (select count(*) from transportation_requests) || '/' || (select count(*) from passengers) || '/' || (select count(*) from trips) || '/' || (select count(*) from notification_events)")
if [ "$DUP" = 0 ] && [ "$CORE1" = "$CORE0" ]; then pass "INV one opportunity per inquiry; no Core Request / Passenger / Trip / notification created ($CORE1)"
else fail "INV" "duplicate_inquiry_links=$DUP core $CORE0 -> $CORE1"; fi

echo
if [ "$FAIL" = 0 ]; then echo "RESULT: ALL PASS"; else echo "RESULT: FAILURES"; fi
exit $FAIL
