#!/bin/bash
# Nemryn Platform -- genuine concurrent last-admin protection test
# (P1-PILOT-S4B-R4C, work items §12 / §42). Real parallel psql processes, each
# its own transaction, each holding its transaction open ~1.5s after the call
# (pg_sleep) so the transactions genuinely overlap.
#
# The dangerous shape: two Organization Admins each remove the OTHER (or
# themselves) at the same moment. Each call, checked alone, leaves an admin
# behind; together they could leave none.
#
# Scenario 1: Admin A demotes Admin B  ||  Admin B demotes Admin A
# Scenario 2: Admin A deactivates B    ||  B deactivates A
# Scenario 3: A demotes SELF           ||  B demotes SELF
# Scenario 4: A deactivates SELF       ||  B deactivates SELF
# Scenario 5: THREE admins; each session tries to demote/deactivate both others
# Scenario 6: parallel accept of the SAME invitation by the SAME person x6
#             (double-click / two tabs): exactly one Membership, exactly one
#             accepted event, zero errors.
#
# Pass criteria: after every scenario the organization still has >= 1 active
# Organization Admin; in the two-admin scenarios exactly one action succeeded
# and the other was refused (ZW004 last_admin, or ZW002 because the caller was
# already removed while waiting -- re-authorized after the lock).
#
# Run with:
#   bash supabase/tests/team_last_admin_concurrency_test.sh

set -euo pipefail

PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1"
STAMP=$(date +%s)
OUT=$(mktemp -d)
FAIL=0

new_user() { # $1 = email  -> prints id
  local id; id=$($PSQL -c "select gen_random_uuid()")
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$id', 'authenticated', 'authenticated', '$1', extensions.crypt('local-test-only-fictional-pw', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
  echo "$id"
}

# builds an org with N admins (fixture set-up at owner level; the behavior under test is the protected mutation)
make_org() { # $1 = tag, $2.. = admin user ids ; prints org id
  local tag=$1; shift
  local org; org=$($PSQL -c "with o as (insert into public.organizations (name, timezone) values ('R4C Concurrency $tag $STAMP', 'America/New_York') returning id) select id from o")
  for u in "$@"; do
    $PSQL -c "insert into public.memberships (organization_id, user_id, role, status) values ('$org', '$u', 'organization_admin', 'active')" >/dev/null
  done
  echo "$org"
}
mem_id() { $PSQL -c "select id from public.memberships where organization_id='$1' and user_id='$2'"; }
active_admins() { $PSQL -c "select count(*) from public.memberships where organization_id='$1' and role='organization_admin' and status='active'"; }

run_session() { # $1 out-prefix, $2 user id, $3 sql call
  $PSQL > "$1.out" 2> "$1.err" <<SQL || echo "ERR" >> "$1.err"
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$2';
$3
reset role;
select pg_sleep(1.5);
commit;
SQL
}
outcome() { # $1 prefix -> OK | ZW004 | ZW002 | other
  # psql prints the exception MESSAGE: last_admin (ZW004) / not_found (ZW002)
  if grep -q "last_admin" "$1.err" 2>/dev/null; then echo ZW004
  elif grep -q "not_found" "$1.err" 2>/dev/null; then echo ZW002
  elif [ -s "$1.err" ]; then echo OTHER
  else echo OK; fi
}
check_pair() { # $1 name, $2 org, $3 prefix-a, $4 prefix-b
  local a b n; a=$(outcome "$3"); b=$(outcome "$4"); n=$(active_admins "$2")
  echo "$1: A=$a B=$b active_admins=$n"
  if [ "$n" -ge 1 ] && { { [ "$a" = OK ] && [ "$b" != OK ] && [ "$b" != OTHER ]; } || { [ "$b" = OK ] && [ "$a" != OK ] && [ "$a" != OTHER ]; }; }; then
    echo "TEST $1: PASS (exactly one succeeded, the other was refused, an active Admin remains)"
  else
    echo "TEST $1: FAIL"; FAIL=1
  fi
}

for ROUND in 1 2 3; do
  U1=$(new_user "r4c-ca-$STAMP-$ROUND-1@example.test"); U2=$(new_user "r4c-ca-$STAMP-$ROUND-2@example.test")

  ORG=$(make_org "s1-$ROUND" "$U1" "$U2"); M1=$(mem_id "$ORG" "$U1"); M2=$(mem_id "$ORG" "$U2")
  run_session "$OUT/s1a" "$U1" "select public.change_membership_role('$M2', 'dispatcher');" &
  run_session "$OUT/s1b" "$U2" "select public.change_membership_role('$M1', 'dispatcher');" &
  wait
  check_pair "CONC-ADMIN-1.$ROUND (mutual demotion)" "$ORG" "$OUT/s1a" "$OUT/s1b"

  ORG=$(make_org "s2-$ROUND" "$U1" "$U2"); M1=$(mem_id "$ORG" "$U1"); M2=$(mem_id "$ORG" "$U2")
  run_session "$OUT/s2a" "$U1" "select public.set_membership_status('$M2', false);" &
  run_session "$OUT/s2b" "$U2" "select public.set_membership_status('$M1', false);" &
  wait
  check_pair "CONC-ADMIN-2.$ROUND (mutual deactivation)" "$ORG" "$OUT/s2a" "$OUT/s2b"

  ORG=$(make_org "s3-$ROUND" "$U1" "$U2"); M1=$(mem_id "$ORG" "$U1"); M2=$(mem_id "$ORG" "$U2")
  run_session "$OUT/s3a" "$U1" "select public.change_membership_role('$M1', 'dispatcher');" &
  run_session "$OUT/s3b" "$U2" "select public.change_membership_role('$M2', 'dispatcher');" &
  wait
  check_pair "CONC-ADMIN-3.$ROUND (simultaneous self-demotion)" "$ORG" "$OUT/s3a" "$OUT/s3b"

  ORG=$(make_org "s4-$ROUND" "$U1" "$U2"); M1=$(mem_id "$ORG" "$U1"); M2=$(mem_id "$ORG" "$U2")
  run_session "$OUT/s4a" "$U1" "select public.set_membership_status('$M1', false);" &
  run_session "$OUT/s4b" "$U2" "select public.set_membership_status('$M2', false);" &
  wait
  check_pair "CONC-ADMIN-4.$ROUND (simultaneous self-deactivation)" "$ORG" "$OUT/s4a" "$OUT/s4b"
done

echo "=== Scenario 5: three admins, each session removes BOTH others ==="
U1=$(new_user "r4c-ca-$STAMP-t1@example.test"); U2=$(new_user "r4c-ca-$STAMP-t2@example.test"); U3=$(new_user "r4c-ca-$STAMP-t3@example.test")
ORG=$(make_org "s5" "$U1" "$U2" "$U3"); M1=$(mem_id "$ORG" "$U1"); M2=$(mem_id "$ORG" "$U2"); M3=$(mem_id "$ORG" "$U3")
run_session "$OUT/s5a" "$U1" "select public.set_membership_status('$M2', false); select public.set_membership_status('$M3', false);" &
run_session "$OUT/s5b" "$U2" "select public.set_membership_status('$M1', false); select public.set_membership_status('$M3', false);" &
run_session "$OUT/s5c" "$U3" "select public.change_membership_role('$M1', 'dispatcher'); select public.change_membership_role('$M2', 'dispatcher');" &
wait
N=$(active_admins "$ORG")
echo "active_admins after 3-way removal attempt: $N"
if [ "$N" -ge 1 ]; then echo "TEST CONC-ADMIN-5 (three admins all trying to remove the others: at least one active Admin always remains): PASS"
else echo "TEST CONC-ADMIN-5: FAIL"; FAIL=1; fi

echo "=== Scenario 6: 6 parallel accepts of ONE invitation by ONE person ==="
ADM=$(new_user "r4c-ca-$STAMP-adm@example.test"); INV=$(new_user "r4c-ca-$STAMP-inv@example.test")
ORG=$(make_org "s6" "$ADM")
TOKEN=$($PSQL <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$ADM';
select (public.create_staff_invite('$ORG', 'r4c-ca-$STAMP-inv@example.test', 'dispatcher')).token;
commit;
SQL
)
TOKEN=$(echo "$TOKEN" | grep -E '^[0-9a-f]{64}$')
for i in 1 2 3 4 5 6; do
  run_session "$OUT/s6-$i" "$INV" "select (public.accept_staff_invite('$TOKEN')).membership_created;" &
done
wait
MEMS=$($PSQL -c "select count(*) from public.memberships where organization_id='$ORG' and user_id='$INV'")
EVT=$($PSQL -c "select count(*) from public.audit_events where organization_id='$ORG' and action='staff_invitation_accepted'")
CREATED=$(cat "$OUT"/s6-*.out | grep -c '^t$' || true)
ERRS=$(cat "$OUT"/s6-*.err | grep -c . || true)
echo "memberships:$MEMS accepted_events:$EVT created=true:$CREATED errors:$ERRS"
if [ "$MEMS" = 1 ] && [ "$EVT" = 1 ] && [ "$CREATED" = 1 ] && [ "$ERRS" = 0 ]; then
  echo "TEST CONC-INVITE-1 (parallel accept: exactly one Membership, one event, zero errors): PASS"
else
  echo "TEST CONC-INVITE-1: FAIL"; FAIL=1
fi

# cleanup (owner level): the synthetic orgs' rows; auth users are harmless fixtures
$PSQL <<SQL >/dev/null
delete from public.audit_events where organization_id in (select id from public.organizations where name like 'R4C Concurrency % $STAMP');
delete from public.staff_invites where organization_id in (select id from public.organizations where name like 'R4C Concurrency % $STAMP');
delete from public.memberships where organization_id in (select id from public.organizations where name like 'R4C Concurrency % $STAMP');
delete from public.organizations where name like 'R4C Concurrency % $STAMP';
SQL
rm -rf "$OUT"
exit $FAIL
