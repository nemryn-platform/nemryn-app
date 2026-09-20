#!/bin/bash
# Nemryn Platform -- genuine concurrent organization-creation test
# (P1-PILOT-S4B-R4A, work item §8: "double submission / two tabs / retry after
# a slow response"). Real parallel psql processes, each its own transaction --
# not a sequential script.
#
# Scenario: ONE fresh, memberless, authenticated user fires N simultaneous
# "Create organization" submissions (complete_pending_signup_manual -- the
# gate behind the first-run form). Each session holds its transaction open
# ~1.5s after the call (artificial pg_sleep) so the transactions genuinely
# overlap: whoever takes the per-user advisory lock first creates the
# organization; every other session blocks on that lock, then observes the
# committed Membership and returns created=false.
#
# Pass criteria (order-independent -- which session wins is not asserted):
#   * exactly ONE session reports created=true, the rest created=false
#   * exactly ONE organization, ONE Membership (organization_admin) exist for
#     that user, ONE organization_created AuditEvent, ONE UserProfile
#   * zero session errors
#
# Second scenario: N simultaneous update_organization_settings calls from one
# Organization Admin on the same organization all succeed and serialize on the
# row lock -- final state is one of the submitted values, never a torn mix,
# and exactly as many AuditEvents as calls that actually changed something.
#
# Run with:
#   bash supabase/tests/tenant_org_creation_concurrency_test.sh

set -euo pipefail

PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1"
N=6
STAMP=$(date +%s)
USER_ID=$($PSQL -c "select gen_random_uuid()")
ORG_NAME="R4A Concurrency Org $STAMP"
OUT=$(mktemp -d)

$PSQL <<SQL >/dev/null
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000', '$USER_ID', 'authenticated', 'authenticated',
  'r4a-concurrency-$STAMP@example.test',
  extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(),
  '{}', '{}', now(), now(), '', '', '', '', '', ''
);
SQL

echo "=== Scenario 1: $N simultaneous organization-creation submissions by ONE fresh user ==="
for i in $(seq 1 $N); do
  (
    $PSQL <<SQL > "$OUT/create-$i.out" 2> "$OUT/create-$i.err" || echo "ERR" >> "$OUT/create-$i.err"
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$USER_ID';
select (public.complete_pending_signup_manual('Concurrent Owner', '$ORG_NAME')).created;
reset role;
select pg_sleep(1.5);
commit;
SQL
  ) &
done
wait

CREATED_TRUE=$(cat "$OUT"/create-*.out | grep -c '^t$' || true)
CREATED_FALSE=$(cat "$OUT"/create-*.out | grep -c '^f$' || true)
ERRORS=$(cat "$OUT"/create-*.err | grep -c . || true)
ORGS=$($PSQL -c "select count(*) from public.organizations where name = '$ORG_NAME'")
MEMBERS=$($PSQL -c "select count(*) from public.memberships where user_id = '$USER_ID'")
ADMINS=$($PSQL -c "select count(*) from public.memberships where user_id = '$USER_ID' and role = 'organization_admin' and status = 'active'")
AUDITS=$($PSQL -c "select count(*) from public.audit_events where actor_user_id = '$USER_ID' and action = 'organization_created'")
PROFILES=$($PSQL -c "select count(*) from public.user_profiles where id = '$USER_ID'")

echo "created=true:$CREATED_TRUE created=false:$CREATED_FALSE errors:$ERRORS orgs:$ORGS memberships:$MEMBERS admins:$ADMINS audits:$AUDITS profiles:$PROFILES"
FAIL=0
if [ "$CREATED_TRUE" = "1" ] && [ "$CREATED_FALSE" = "$((N-1))" ] && [ "$ERRORS" = "0" ] \
   && [ "$ORGS" = "1" ] && [ "$MEMBERS" = "1" ] && [ "$ADMINS" = "1" ] && [ "$AUDITS" = "1" ] && [ "$PROFILES" = "1" ]; then
  echo "TEST CONC-ORG-1 (double/multi-submit creates exactly one organization + one Admin Membership): PASS"
else
  echo "TEST CONC-ORG-1 (double/multi-submit creates exactly one organization + one Admin Membership): FAIL"
  FAIL=1
fi

echo "=== Scenario 2: $N simultaneous settings updates by the new Organization Admin ==="
ORG_ID=$($PSQL -c "select organization_id from public.memberships where user_id = '$USER_ID'")
AUDITS_BEFORE=$($PSQL -c "select count(*) from public.audit_events where organization_id = '$ORG_ID' and action = 'organization_settings_updated'")
for i in $(seq 1 $N); do
  (
    $PSQL <<SQL > "$OUT/settings-$i.out" 2> "$OUT/settings-$i.err" || echo "ERR" >> "$OUT/settings-$i.err"
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$USER_ID';
select (public.update_organization_settings('$ORG_ID', '{"primary_contact_name": "Contact $i"}'::jsonb)).changed;
reset role;
select pg_sleep(0.5);
commit;
SQL
  ) &
done
wait

S_ERRORS=$(cat "$OUT"/settings-*.err | grep -c . || true)
S_CHANGED=$(cat "$OUT"/settings-*.out | grep -c '^t$' || true)
S_AUDITS=$(( $($PSQL -c "select count(*) from public.audit_events where organization_id = '$ORG_ID' and action = 'organization_settings_updated'") - AUDITS_BEFORE ))
FINAL=$($PSQL -c "select primary_contact_name from public.organizations where id = '$ORG_ID'")
echo "errors:$S_ERRORS changed=true:$S_CHANGED audits:$S_AUDITS final:'$FINAL'"
if [ "$S_ERRORS" = "0" ] && [ "$S_AUDITS" = "$S_CHANGED" ] && [ "$S_CHANGED" -ge 1 ] && echo "$FINAL" | grep -Eq '^Contact [1-6]$'; then
  echo "TEST CONC-SET-1 (concurrent settings updates serialize; audits == effective changes; no torn state): PASS"
else
  echo "TEST CONC-SET-1 (concurrent settings updates serialize; audits == effective changes; no torn state): FAIL"
  FAIL=1
fi

rm -rf "$OUT"
exit $FAIL
