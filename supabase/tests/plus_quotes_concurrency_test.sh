#!/bin/bash
# Nemryn Plus -- Estimates & Quotes under REAL concurrency (NP-P2-S5-S1). Parallel psql processes, each holding its
# locks ~1s after the call. After EVERY scenario the critical invariants are checked on the final rows:
#   one intended create = ONE quote; quote numbers unique per organization; a revision chain has at most one live
#   successor; an accepted quote is never superseded; a closed opportunity never gains a sent quote.
#
#   1  double click: the same create (same key) twice at once                 -> 1 quote; t + f (replay)
#   2  two staff, same key, same opportunity                                   -> 1 quote; t + f
#   3  six parallel creates (different keys)                                   -> six distinct, gap-free numbers
#   4  two draft edits from the same version                                   -> one t; the other ZW003 stale
#   5  draft edit first, Mark sent from the old version waits                  -> send ZW003 stale; quote still a draft
#   5b Mark sent first, draft edit waits                                       -> edit ZW004 quote_not_draft
#   6  Revise first, Record accepted on the same sent quote waits              -> both succeed; the revision can no longer be sent
#   6b Record accepted first, Revise waits                                     -> revise ZW004 illegal_transition; no revision
#   7  two revisions (different keys) of one sent quote                        -> one revision; the other ZW004 revision_exists
#   8  opportunity marked Lost first, Mark sent waits                          -> send ZW004 opportunity_closed; stage stays lost
#   8b Mark sent first, mark Lost waits from the old version                   -> Lost ZW003 stale (the stage advance bumped the version)
#   9  Record accepted vs Withdraw on one sent quote                           -> exactly one wins
#
# Run with:  bash supabase/tests/plus_quotes_concurrency_test.sh
# Throwaway organization (Plus active) + two throwaway Admins + fictional contacts / opportunities, removed on exit.
set -uo pipefail
DB="${NEMRYN_TEST_DB:-postgres}"
PSQL="docker exec -i supabase_db_ZenWard psql -U postgres -d $DB -tA -v ON_ERROR_STOP=0"
STAMP=$(date +%s)
ORG=$($PSQL -c "insert into public.organizations (name, timezone) values ('P2S5 Quote Concurrency $STAMP', 'America/New_York') returning id" | head -1)
AD1=$($PSQL -c "select gen_random_uuid()"); AD2=$($PSQL -c "select gen_random_uuid()")
OUT=$(mktemp -d)
cleanup() {
  $PSQL >/dev/null <<SQL
delete from public.audit_events where organization_id='$ORG';
delete from public.plus_activities where organization_id='$ORG';
delete from public.plus_quotes where organization_id='$ORG' and supersedes_quote_id is not null;
delete from public.plus_quotes where organization_id='$ORG';
delete from public.plus_quote_counters where organization_id='$ORG';
delete from public.plus_opportunities where organization_id='$ORG';
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
  $PSQL -c "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000', '$u', 'authenticated', 'authenticated', 'p2s5-quote-$u@example.test', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '')" >/dev/null
done
$PSQL >/dev/null <<SQL
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$AD1', 'organization_admin'), ('$ORG', '$AD2', 'organization_admin');
insert into public.organization_modules (organization_id, module, status, status_reason) values ('$ORG', 'plus', 'active', 'P2-S5 quote concurrency fixture');
SQL
K=$($PSQL -c "insert into public.plus_contacts (organization_id, display_name, phone, email, contact_kind, created_by) values ('$ORG', 'Conc Quote Pat Fictional', '(404) 555-0146', 'conc.quote.pat-$STAMP@example.test', 'individual', '$AD1') returning id" | head -1)
opportunity() { $PSQL -c "insert into public.plus_opportunities (organization_id, title, stage, primary_contact_id, source, created_by) values ('$ORG', '$1', 'qualified', '$K', 'phone', '$AD1') returning id" | head -1; }
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
as_admin() { $PSQL -c "begin; set local role authenticated; set local request.jwt.claim.sub = '$AD1'; $1; commit;" | grep -vE '^(BEGIN|SET|COMMIT)$' | head -1; }
check() { if [ "$2" = "0" ]; then echo "TEST $1: PASS"; else echo "TEST $1: FAIL"; FAIL=1; fi; }
ver() { echo "(select updated_at from public.plus_quotes where id = '$1')"; }
create_sql() { echo "select (public.plus_create_quote('$ORG', '$1', '$2', 'quote', null, false, null, ${3:-10000}, 0, 0, 0, 0, 0, 0, 0, null, 0, null, current_date + 10)).changed"; }
create_id() { as_admin "select (public.plus_create_quote('$ORG', '$1', '$2', 'quote', null, false, null, 10000, 0, 0, 0, 0, 0, 0, 0, null, 0, null, current_date + 10)).quote_id"; }
update_sql() { echo "select (public.plus_update_quote_draft('$ORG', '$1', $(ver "$1"), 'quote', null, false, null, $2, 0, 0, 0, 0, 0, 0, 0, null, 0, null, current_date + 10)).changed"; }
send_sql() { echo "select (public.plus_mark_quote_sent('$ORG', '$1', ${2:-$(ver "$1")})).changed"; }
respond_sql() { echo "select (public.plus_record_quote_response('$ORG', '$1', $(ver "$1"), '$2')).changed"; }
revise_sql() { echo "select (public.plus_revise_quote('$ORG', '$1', '$2')).changed"; }
withdraw_sql() { echo "select (public.plus_withdraw_quote('$ORG', '$1', $(ver "$1"), 'Concurrency fictional withdrawal')).changed"; }
send_now() { as_admin "$(send_sql "$1")" >/dev/null; }
st() { $PSQL -c "select status from public.plus_quotes where id = '$1'"; }
stage() { $PSQL -c "select stage from public.plus_opportunities where id = '$1'"; }
quotes_for_opp() { $PSQL -c "select count(*) from public.plus_quotes where opportunity_id = '$1'"; }
# global invariants on the final rows of the fixture organization
invariants() { $PSQL -c "select (select count(*) - count(distinct quote_number) from public.plus_quotes where organization_id = '$ORG')
  + (select count(*) from (select supersedes_quote_id from public.plus_quotes where organization_id = '$ORG' and supersedes_quote_id is not null and status <> 'withdrawn' group by 1 having count(*) > 1) d)
  + (select count(*) from public.plus_quotes q join public.plus_quotes s on s.supersedes_quote_id = q.id and s.status in ('sent', 'accepted', 'declined', 'superseded') where q.status = 'accepted')
  + (select count(*) from public.plus_quotes q join public.plus_opportunities o on o.id = q.opportunity_id where o.organization_id = '$ORG' and o.stage in ('lost', 'converted') and q.sent_at > o.closed_at)"; }
outs() { cat "$@" | grep -E '^[tf]$' | sort | paste -sd, -; }
errs() { cat "$@" | grep -oE '(invalid_input|stale_state|illegal_transition|quote_not_draft|revision_exists|revision_base_not_current|opportunity_closed|quote_expired)' | sort | paste -sd, -; }

echo "=== 1: double click (same key, same opportunity) ==="
O=$(opportunity "QConc 1")
run_as "$OUT/a" "$AD1" "$(create_sql "$O" "qconc-key-one-01")" & run_as "$OUT/b" "$AD1" "$(create_sql "$O" "qconc-key-one-01")" & wait
echo "outcomes=$(outs "$OUT/a.out" "$OUT/b.out") quotes=$(quotes_for_opp "$O") invariants=$(invariants)"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "f,t" ] && [ "$(quotes_for_opp "$O")" = "1" ] && [ "$(invariants)" = "0" ]
check "CONC-Q1 (double click: one quote, the other a replay)" $?

echo "=== 2: two staff, same key, same opportunity ==="
O=$(opportunity "QConc 2")
run_as "$OUT/a" "$AD1" "$(create_sql "$O" "qconc-key-two-01")" & run_as "$OUT/b" "$AD2" "$(create_sql "$O" "qconc-key-two-01")" & wait
echo "outcomes=$(outs "$OUT/a.out" "$OUT/b.out") quotes=$(quotes_for_opp "$O") invariants=$(invariants)"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "f,t" ] && [ "$(quotes_for_opp "$O")" = "1" ] && [ "$(invariants)" = "0" ]
check "CONC-Q2 (two staff, same key: one quote; the other returns it)" $?

echo "=== 3: six parallel creates with different keys ==="
O=$(opportunity "QConc 3")
MAX0=$($PSQL -c "select coalesce(max(quote_number), 0) from public.plus_quotes where organization_id = '$ORG'")
for i in 1 2 3 4 5 6; do
  if [ $((i % 2)) = 0 ]; then U="$AD2"; else U="$AD1"; fi
  run_as "$OUT/n$i" "$U" "$(create_sql "$O" "qconc-key-three-0$i")" &
done
wait
NUMS=$($PSQL -c "select string_agg(quote_number::text, ',' order by quote_number) from public.plus_quotes where opportunity_id = '$O'")
EXPECT=$(seq $((MAX0 + 1)) $((MAX0 + 6)) | paste -sd, -)
echo "numbers=$NUMS expected=$EXPECT invariants=$(invariants)"
[ "$NUMS" = "$EXPECT" ] && [ "$(invariants)" = "0" ]
check "CONC-Q3 (parallel creates: distinct, consecutive numbers per organization)" $?

echo "=== 4: two draft edits from the same version ==="
O=$(opportunity "QConc 4"); Q=$(create_id "$O" "qconc-key-four-01")
A=$(update_sql "$Q" 11000); B=$(update_sql "$Q" 12000)
run_as "$OUT/a" "$AD1" "$A" & run_as "$OUT/b" "$AD2" "$B" & wait
BASE=$($PSQL -c "select base_cents from public.plus_quotes where id = '$Q'")
echo "outcomes=$(outs "$OUT/a.out" "$OUT/b.out") refusals=$(errs "$OUT/a.err" "$OUT/b.err") base=$BASE"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "t" ] && [ "$(errs "$OUT/a.err" "$OUT/b.err")" = "stale_state" ] && { [ "$BASE" = "11000" ] || [ "$BASE" = "12000" ]; }
check "CONC-Q4 (two edits, one version: one wins; the other ZW003 stale, no lost update)" $?

echo "=== 5: draft edit first, Mark sent from the old version waits ==="
O=$(opportunity "QConc 5"); Q=$(create_id "$O" "qconc-key-five-01")
E=$(update_sql "$Q" 13000); S=$(send_sql "$Q")
run_as "$OUT/a" "$AD1" "$E" & sleep 0.3; run_as "$OUT/b" "$AD2" "$S" & wait
echo "edit=$(outs "$OUT/a.out") send_refusal=$(errs "$OUT/b.err") status=$(st "$Q") stage=$(stage "$O")"
[ "$(outs "$OUT/a.out")" = "t" ] && [ "$(errs "$OUT/b.err")" = "stale_state" ] && [ "$(st "$Q")" = "draft" ] && [ "$(stage "$O")" = "qualified" ]
check "CONC-Q5 (edit first: the send of the old version is ZW003 stale; never a sent quote the sender did not see)" $?
O=$(opportunity "QConc 5b"); Q=$(create_id "$O" "qconc-key-five-02")
S=$(send_sql "$Q"); E=$(update_sql "$Q" 13000)
run_as "$OUT/a" "$AD1" "$S" & sleep 0.3; run_as "$OUT/b" "$AD2" "$E" & wait
echo "send=$(outs "$OUT/a.out") edit_refusal=$(errs "$OUT/b.err") status=$(st "$Q") base=$($PSQL -c "select base_cents from public.plus_quotes where id = '$Q'") stage=$(stage "$O")"
[ "$(outs "$OUT/a.out")" = "t" ] && [ "$(errs "$OUT/b.err")" = "quote_not_draft" ] && [ "$(st "$Q")" = "sent" ] && [ "$(stage "$O")" = "quote_sent" ]
check "CONC-Q5b (send first: the waiting edit is ZW004 quote_not_draft; the sent snapshot is unchanged)" $?

echo "=== 6: Revise vs Record accepted on one sent quote ==="
O=$(opportunity "QConc 6"); Q=$(create_id "$O" "qconc-key-six-001"); send_now "$Q"
R=$(revise_sql "$Q" "qconc-key-six-rev1"); A=$(respond_sql "$Q" accepted)
run_as "$OUT/a" "$AD1" "$R" & sleep 0.3; run_as "$OUT/b" "$AD2" "$A" & wait
REV=$($PSQL -c "select id from public.plus_quotes where supersedes_quote_id = '$Q'")
as_admin "$(send_sql "$REV")" > "$OUT/c.out" 2> "$OUT/c.err"
echo "revise=$(outs "$OUT/a.out") accept=$(outs "$OUT/b.out") original=$(st "$Q") revision=$(st "$REV") revision_send=$(errs "$OUT/c.err") stage=$(stage "$O") invariants=$(invariants)"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "t,t" ] && [ "$(st "$Q")" = "accepted" ] && [ "$(st "$REV")" = "draft" ] && [ "$(errs "$OUT/c.err")" = "revision_base_not_current" ] && [ "$(stage "$O")" = "quote_accepted" ] && [ "$(invariants)" = "0" ]
check "CONC-Q6 (revise first, accept waits: accepted wins; the revision can never supersede it)" $?
O=$(opportunity "QConc 6b"); Q=$(create_id "$O" "qconc-key-six-002"); send_now "$Q"
A=$(respond_sql "$Q" accepted); R=$(revise_sql "$Q" "qconc-key-six-rev2")
run_as "$OUT/a" "$AD1" "$A" & sleep 0.3; run_as "$OUT/b" "$AD2" "$R" & wait
echo "accept=$(outs "$OUT/a.out") revise_refusal=$(errs "$OUT/b.err") revisions=$($PSQL -c "select count(*) from public.plus_quotes where supersedes_quote_id = '$Q'") invariants=$(invariants)"
[ "$(outs "$OUT/a.out")" = "t" ] && [ "$(errs "$OUT/b.err")" = "illegal_transition" ] && [ "$($PSQL -c "select count(*) from public.plus_quotes where supersedes_quote_id = '$Q'")" = "0" ] && [ "$(invariants)" = "0" ]
check "CONC-Q6b (accept first, revise waits: ZW004 illegal_transition; no revision)" $?

echo "=== 7: two revisions (different keys) of one sent quote ==="
O=$(opportunity "QConc 7"); Q=$(create_id "$O" "qconc-key-seven-01"); send_now "$Q"
run_as "$OUT/a" "$AD1" "$(revise_sql "$Q" "qconc-key-seven-ra")" & run_as "$OUT/b" "$AD2" "$(revise_sql "$Q" "qconc-key-seven-rb")" & wait
N=$($PSQL -c "select count(*) from public.plus_quotes where supersedes_quote_id = '$Q'")
echo "outcomes=$(outs "$OUT/a.out" "$OUT/b.out") refusals=$(errs "$OUT/a.err" "$OUT/b.err") revisions=$N invariants=$(invariants)"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "t" ] && [ "$(errs "$OUT/a.err" "$OUT/b.err")" = "revision_exists" ] && [ "$N" = "1" ] && [ "$(invariants)" = "0" ]
check "CONC-Q7 (two revisions: exactly one live successor; the other ZW004 revision_exists)" $?

echo "=== 8: opportunity marked Lost vs Mark sent ==="
O=$(opportunity "QConc 8"); Q=$(create_id "$O" "qconc-key-eight-01")
L="select (public.plus_mark_opportunity_lost('$ORG', '$O', (select updated_at from public.plus_opportunities where id = '$O'), 'price', null)).opportunity_id is not null"
S=$(send_sql "$Q")
run_as "$OUT/a" "$AD1" "$L" & sleep 0.3; run_as "$OUT/b" "$AD2" "$S" & wait
echo "lost=$(outs "$OUT/a.out") send_refusal=$(errs "$OUT/b.err") status=$(st "$Q") stage=$(stage "$O") invariants=$(invariants)"
[ "$(outs "$OUT/a.out")" = "t" ] && [ "$(errs "$OUT/b.err")" = "opportunity_closed" ] && [ "$(st "$Q")" = "draft" ] && [ "$(stage "$O")" = "lost" ] && [ "$(invariants)" = "0" ]
check "CONC-Q8 (Lost first, send waits: ZW004 opportunity_closed; stage stays lost; quote stays draft)" $?
O=$(opportunity "QConc 8b"); Q=$(create_id "$O" "qconc-key-eight-02")
L="select (public.plus_mark_opportunity_lost('$ORG', '$O', (select updated_at from public.plus_opportunities where id = '$O'), 'price', null)).opportunity_id is not null"
S=$(send_sql "$Q")
run_as "$OUT/a" "$AD1" "$S" & sleep 0.3; run_as "$OUT/b" "$AD2" "$L" & wait
echo "send=$(outs "$OUT/a.out") lost_refusal=$(errs "$OUT/b.err") status=$(st "$Q") stage=$(stage "$O") invariants=$(invariants)"
[ "$(outs "$OUT/a.out")" = "t" ] && [ "$(errs "$OUT/b.err")" = "stale_state" ] && [ "$(st "$Q")" = "sent" ] && [ "$(stage "$O")" = "quote_sent" ] && [ "$(invariants)" = "0" ]
check "CONC-Q8b (send first, Lost from the old version waits: ZW003 stale; stage quote_sent, never silently overwritten)" $?

echo "=== 9: Record accepted vs Withdraw on one sent quote ==="
O=$(opportunity "QConc 9"); Q=$(create_id "$O" "qconc-key-nine-01"); send_now "$Q"
A=$(respond_sql "$Q" accepted); W=$(withdraw_sql "$Q")
run_as "$OUT/a" "$AD1" "$A" & run_as "$OUT/b" "$AD2" "$W" & wait
FINAL=$(st "$Q")
echo "outcomes=$(outs "$OUT/a.out" "$OUT/b.out") refusals=$(errs "$OUT/a.err" "$OUT/b.err") status=$FINAL stage=$(stage "$O")"
[ "$(outs "$OUT/a.out" "$OUT/b.out")" = "t" ] && [ -n "$(errs "$OUT/a.err" "$OUT/b.err")" ] && { [ "$FINAL" = "accepted" ] || [ "$FINAL" = "withdrawn" ]; }
check "CONC-Q9 (accept vs withdraw: exactly one transition wins; the other is refused)" $?

echo "=== TOTAL FAILURES: $FAIL ==="
exit $FAIL
