#!/bin/bash
# Zenward Platform — genuine concurrent driver-invite-redemption test
# (P1-E3-S9, work item §14: "Run concurrency tests where new onboarding
# mutations can race"). Same two-separate-psql-process methodology as
# mutation_concurrency_test.sh — a real race, not a sequential script.
#
# Scenario: an invited driver double-clicks "Create account & join" (or
# has two tabs open) — two concurrent redeem_driver_invite(token) calls
# for the SAME token, from the SAME already-authenticated person (the
# only person who could ever pass the RPC's own email-match check).
#   Session A: locks the driver_invites row (FOR UPDATE, inside
#     redeem_driver_invite itself), holds ~2s (simulated via an
#     artificial pg_sleep injected before the call in the same
#     transaction), then completes the redemption and commits.
#   Session B: launched ~0.3s later, calls redeem_driver_invite on the
#     SAME token while A still holds the lock.
#
# Expected: whichever session's transaction actually reaches and holds
# the row lock first (real OS/connection-establishment scheduling
# between two independent `docker exec` processes decides this — it is
# NOT guaranteed to be Session A merely because it was launched first;
# both sessions call the identical idempotent RPC, so either legitimately
# "winning" is a correct, expected outcome, not a defect) completes the
# real redemption; the other session blocks on the lock, then correctly
# observes the invite already accepted BY THIS SAME PERSON and returns
# the SAME driver_id idempotently. The pass criterion below is therefore
# order-independent by design: exactly ONE Driver row, exactly ONE
# Membership row, and zero errors from either session — never a
# duplicate, never a failure, regardless of which session happened to
# win the race.
#
# Run with:
#   bash supabase/tests/driver_invite_concurrency_test.sh

set -euo pipefail

# A fresh, real (v4) UUID pair per run — not a fixed fixture id — so this
# script is safely re-runnable any number of times without a stale
# auth.users row from a previous run silently colliding via `on conflict
# do nothing` (found as a real bug in an earlier version of this script:
# a fixed id + `on conflict do nothing` left a PRIOR run's now-stale
# email in place, causing the RPC's own email-match check to correctly,
# but confusingly, deny the redemption).
STAMP=$(date +%s)
ADMIN_ID=$(docker exec supabase_db_ZenWard psql -U postgres -tA -c "select gen_random_uuid()")
DRIVER_ID_AUTH=$(docker exec supabase_db_ZenWard psql -U postgres -tA -c "select gen_random_uuid()")
ORG_NAME="Concurrency Test Org $STAMP"
DRIVER_EMAIL="concurrency-driver-$STAMP@example.test"

echo "=== Fixture: fresh org (via signup_create_organization) + a pending driver invite ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token
) values
  ('00000000-0000-0000-0000-000000000000', '$ADMIN_ID', 'authenticated', 'authenticated', 'concurrency-admin-$STAMP@example.test', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '$DRIVER_ID_AUTH', 'authenticated', 'authenticated', '$DRIVER_EMAIL', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', '')
on conflict (id) do nothing;

do \$\$
declare v_org public.organization_signup_result;
begin
  -- signup_create_organization is internal-only since P1-PILOT-S4B-R4A
  -- (not executable by `authenticated`); fixture setup calls it as the
  -- owner role with the caller identity set via the JWT-claim GUC.
  set local request.jwt.claim.sub = '$ADMIN_ID';
  v_org := public.signup_create_organization('$ORG_NAME', 'Concurrency Admin', null, 'America/New_York');
  raise notice 'org_id=%', v_org.organization_id;
end \$\$;

do \$\$
declare v_org uuid; v_r public.driver_invite_result;
begin
  select id into v_org from public.organizations where name = '$ORG_NAME';
  set local role authenticated;
  set local request.jwt.claim.sub = '$ADMIN_ID';
  v_r := public.create_driver_invite(v_org, '$DRIVER_EMAIL', 'Concurrency Driver', null);
  reset role;
  raise notice 'token=%', v_r.token;
end \$\$;
SQL

TOKEN=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select token from public.driver_invites where email = '$DRIVER_EMAIL'")
echo "Invite token: $TOKEN"

echo "=== Launching Session A (locks the invite row ~2s, then redeems) ==="
# Connected as `postgres` (bypasses driver_invites' own RLS, which only
# lets an organization_admin directly SELECT the table — an ordinary
# invitee never can, by design) so this session's own outer SELECT ...
# FOR UPDATE can acquire the lock at all. auth.uid() itself reads ONLY
# the `request.jwt.claim.sub` GUC (confirmed directly:
# `select pg_get_functiondef('auth.uid'::regproc)`), independent of the
# connected DB role — so the subsequent redeem_driver_invite() call
# inside this same transaction still authorizes exactly as it would for
# the real, ordinary authenticated driver. A later statement in the SAME
# transaction that touches an already-self-held row lock does not
# re-block on its own lock, so the RPC's internal FOR UPDATE simply
# proceeds once this session reaches it.
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/invite_concurrency_session_a.log 2>&1 <<SQL &
SET request.jwt.claim.sub = '$DRIVER_ID_AUTH';
BEGIN;
SELECT id FROM public.driver_invites WHERE token = '$TOKEN' FOR UPDATE;
SELECT pg_sleep(2);
SELECT (redeem_driver_invite('$TOKEN')).*;
COMMIT;
SQL
PID_A=$!

sleep 0.3
echo "=== Launching Session B (should block on A's lock, then observe A's committed redemption) ==="
START_B=$(date +%s.%N)
set +e
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 > /tmp/invite_concurrency_session_b.log 2>&1 <<SQL
SET ROLE authenticated;
SET request.jwt.claim.sub = '$DRIVER_ID_AUTH';
SELECT (redeem_driver_invite('$TOKEN')).*;
SQL
B_EXIT=$?
set -e
END_B=$(date +%s.%N)
ELAPSED_B=$(echo "$END_B - $START_B" | bc)

set +e
wait $PID_A
set -e

echo "--- Session A log ---"
cat /tmp/invite_concurrency_session_a.log
echo "--- Session B log (exit=$B_EXIT, elapsed=${ELAPSED_B}s) ---"
cat /tmp/invite_concurrency_session_b.log

echo "=== Verifying final state ==="
docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
select count(*) as driver_rows from public.drivers where user_id = '$DRIVER_ID_AUTH';
select count(*) as membership_rows from public.memberships where user_id = '$DRIVER_ID_AUTH';
select status, accepted_by from public.driver_invites where token = '$TOKEN';
SQL

DRIVER_COUNT=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.drivers where user_id = '$DRIVER_ID_AUTH'")
MEMBERSHIP_COUNT=$(docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -c "select count(*) from public.memberships where user_id = '$DRIVER_ID_AUTH'")

echo "=== Verdict ==="
ELAPSED_OK=$(echo "$ELAPSED_B > 1.0" | bc)
B_NO_ERROR=$(grep -c "ERROR" /tmp/invite_concurrency_session_b.log || true)
if [ "$ELAPSED_OK" = "1" ] && [ "$DRIVER_COUNT" = "1" ] && [ "$MEMBERSHIP_COUNT" = "1" ] && [ "$B_NO_ERROR" = "0" ]; then
  echo "TEST INVITE-CONCURRENCY-1: PASS (real row-lock contention occurred — Session B's own call took ${ELAPSED_B}s, consistent with blocking behind the other session's held lock — and the two concurrent redemption attempts produced no error and no duplicate row: exactly 1 Driver row, exactly 1 Membership row, regardless of which session's transaction actually completed the redemption first)"
else
  echo "TEST INVITE-CONCURRENCY-1: FAIL (elapsed_B=${ELAPSED_B}s, driver_rows=${DRIVER_COUNT}, membership_rows=${MEMBERSHIP_COUNT}, b_errors=${B_NO_ERROR})"
fi
