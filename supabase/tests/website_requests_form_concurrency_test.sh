#!/bin/bash
# Nemryn -- genuine concurrent tests for the Nemryn form configuration (P1-COMM-D1 / D1R).
# Several SEPARATE psql connections (separate OS processes), all as the SAME Organization Admin, call
# save_website_request_form at overlapping times on an organization that has no form yet.
#
# Semantics under test:  version = number of committed CONTENT changes (1 on creation); an identical effective save is a
# no-op (no version bump, no audit event, changed = false).
#
#   CASE A  6 callers, IDENTICAL configuration            -> 1 row, version 1, 1 audit, exactly 1 caller reports changed=true
#   CASE B  6 callers, SIX DIFFERENT configurations       -> 1 row, version 6, 6 audits, all 6 report changed=true
#   CASE C  6 callers, two groups of 3 identical configs  -> 1 row; the number of versions equals the number of times the
#                                                            content actually flipped between the two groups in the (arbitrary)
#                                                            serialisation order, so 2..6; version == audits == callers reporting
#                                                            a change, and the audited versions are exactly 1..V (no gap, no duplicate)
#   CASE E  form ALREADY EXISTS (version 1, 1 audit); 6 callers save the IDENTICAL configuration
#                                                         -> version stays 1, still exactly 1 audit, 0 callers report a change
#   CASE D  6 callers, same content written with different whitespace/duplicate-service ordering
#                                                         -> canonicalised: 1 row, version 1, 1 audit, 1 caller changed=true
set -u
FAIL_COUNT=0
ORG_A='10000000-0000-0000-0000-0000000000a1'
ADMIN='20000000-0000-0000-0000-0000000000a1'
N=6

psql_exec() { docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA; }
cleanup() {
psql_exec <<SQL >/dev/null
delete from public.audit_events where organization_id = '$ORG_A' and action = 'website_request_form_updated';
delete from public.website_request_forms where organization_id = '$ORG_A';
SQL
}
check() { if [ "$2" = "$3" ]; then echo "PASS — $1 ($2)"; else echo "FAIL — $1 (expected $3, got $2)"; FAIL_COUNT=$((FAIL_COUNT+1)); fi; }

# run_case <name> <payload-fn>   ; payload-fn i  prints the argument list for save_website_request_form for caller i
run_case() {
  local name="$1" fn="$2"
  echo "=== $name ==="
  cleanup
  rm -f /tmp/d1_conc_*.log
  if [ "${PRESEED:-0}" = "1" ]; then
    psql_exec >/dev/null <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT * FROM public.save_website_request_form(p_organization_id => '$ORG_A', $($fn 1));
COMMIT;
SQL
  fi
  for i in $(seq 1 $N); do
    ARGS=$($fn "$i")
    docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA > /tmp/d1_conc_$i.log 2>&1 <<SQL &
BEGIN;
SELECT pg_sleep(0.6);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"$ADMIN","role":"authenticated"}', true);
SELECT 'RESULT|' || form_version::text || '|' || changed::text FROM public.save_website_request_form(p_organization_id => '$ORG_A', $ARGS);
COMMIT;
SQL
  done
  wait
  ROWS=$(psql_exec <<SQL
select count(*) from public.website_request_forms where organization_id = '$ORG_A';
SQL
)
  VERSION=$(psql_exec <<SQL
select version from public.website_request_forms where organization_id = '$ORG_A';
SQL
)
  AUDITS=$(psql_exec <<SQL
select count(*) from public.audit_events where organization_id = '$ORG_A' and action = 'website_request_form_updated';
SQL
)
  AUDIT_SEQ=$(psql_exec <<SQL
select coalesce(string_agg((after_data->>'version'), ',' order by (after_data->>'version')::int), '') from public.audit_events where organization_id = '$ORG_A' and action = 'website_request_form_updated';
SQL
)
  ERRS=$(cat /tmp/d1_conc_*.log | grep -ci "error")
  CHANGED=$(cat /tmp/d1_conc_*.log | grep -c '^RESULT|.*|true$')
  OKS=$(cat /tmp/d1_conc_*.log | grep -c '^RESULT|')
  check "$name: audited versions are contiguous 1..V, no duplicates" "$AUDIT_SEQ" "$(seq 1 "$VERSION" | paste -sd, -)"
  [ "${PRESEED:-0}" = "1" ] || check "$name: version equals audit events equals callers reporting a change" "$VERSION/$AUDITS" "$VERSION/$CHANGED"
  check "$name: no caller errored" "$ERRS" "0"
  check "$name: every caller got a result" "$OKS" "$N"
  check "$name: exactly one configuration row" "$ROWS" "1"
  echo "  (final content: $(psql_exec <<SQL
select title || ' / ' || submit_label || ' / ' || coalesce(array_to_string(offered_service_types, ','), 'ALL') from public.website_request_forms where organization_id = '$ORG_A';
SQL
))"
}

same()  { echo "p_title => 'Book a ride', p_submit_label => 'Send request', p_confirmation_message => 'Thanks', p_allow_recurring => true, p_require_service_choice => false, p_status => 'draft'"; }
diffr() { echo "p_title => 'Concurrent title $1', p_submit_label => 'Send $1', p_confirmation_message => 'Thanks $1', p_allow_recurring => true, p_require_service_choice => false, p_status => 'draft'"; }
mixed() { local g=$(( $1 % 2 )); echo "p_title => 'Group $g title', p_submit_label => 'Send $g', p_confirmation_message => 'Thanks $g', p_allow_recurring => true, p_require_service_choice => false, p_status => 'draft'"; }
ws()    { # same effective content; padding differs per caller, services listed in different order with a duplicate
  local pad; pad=$(printf '%*s' "$1" '')
  local svc; if [ $(( $1 % 2 )) -eq 0 ]; then svc="array['other','dialysis','dialysis']"; else svc="array['dialysis','other']"; fi
  echo "p_title => '${pad}Book a ride${pad}', p_submit_label => '${pad}Send request', p_confirmation_message => 'Thanks${pad}', p_allow_recurring => true, p_require_service_choice => false, p_status => 'draft', p_offered_service_types => $svc"
}

echo "Caller payloads (what each of the $N concurrent callers sends):"
for f in same diffr mixed ws; do echo " [$f]"; for i in 1 2 3 4 5 6; do echo "   caller $i: $($f $i)"; done; done

run_case "CASE A identical first saves" same;  check "CASE A: version" "$VERSION" 1;  check "CASE A: audit events" "$AUDITS" 1;  check "CASE A: callers reporting a change" "$CHANGED" 1
run_case "CASE B six different configurations" diffr;  check "CASE B: version" "$VERSION" 6;  check "CASE B: audit events" "$AUDITS" 6;  check "CASE B: callers reporting a change" "$CHANGED" 6
run_case "CASE C two groups of three identical configurations" mixed;  check "CASE C: at least 2 and at most 6 versions (content flipped between the groups)" "$([ "$VERSION" -ge 2 ] && [ "$VERSION" -le 6 ] && echo yes || echo "no:$VERSION")" yes
run_case "CASE D identical after canonicalisation (whitespace, service order, duplicate service)" ws;  check "CASE D: version" "$VERSION" 1;  check "CASE D: audit events" "$AUDITS" 1;  check "CASE D: callers reporting a change" "$CHANGED" 1

PRESEED=1 run_case "CASE E identical saves against an EXISTING form" same;  check "CASE E: version unchanged" "$VERSION" 1;  check "CASE E: audit events (only the seeding save)" "$AUDITS" 1;  check "CASE E: callers reporting a change" "$CHANGED" 0

cleanup
rm -f /tmp/d1_conc_*.log
echo "=== FAIL_COUNT=$FAIL_COUNT ==="
exit $FAIL_COUNT
