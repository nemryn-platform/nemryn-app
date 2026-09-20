-- Zenward Platform — Organization operational timezone tests (P1-E3-S2C).
-- Run against `supabase db reset` fresh-seeded data:
--   docker exec -i supabase_db_ZenWard psql -U postgres -d postgres -f - < supabase/tests/organization_timezone_tests.sql
--
-- Covers: IANA validator accept/reject (including the exact examples named
-- in the work item), existing-organization backfill, RLS-level access to
-- the new column (inactive Membership denied, foreign org denied) — the
-- same organizations_select_members/organizations_select_platform_admin
-- policies as every other column, now naturally covering `timezone` too
-- since SELECT was never column-restricted. Application-layer behavior
-- (single/multi-org context resolution, Driver Today grouping, DST,
-- midnight boundary) is covered separately by real Node/Intl tests against
-- the running app — see docs/reports/P1-E3-S2C-operational-timezone-report.txt.

-- =============================================================================
-- Validator function — direct assertions (also exercised live via the CHECK
-- constraint below, but asserted directly here for a precise pass/fail record)
-- =============================================================================
do $$
begin
  if public.is_valid_iana_timezone('America/New_York')
    and public.is_valid_iana_timezone('America/Chicago')
    and public.is_valid_iana_timezone('America/Los_Angeles')
    and public.is_valid_iana_timezone('UTC')
    and public.is_valid_iana_timezone('Etc/UTC')
    and public.is_valid_iana_timezone('Africa/Lagos')
  then
    raise notice 'TEST TZ-VALID-1: PASS (every required valid IANA example accepted)';
  else
    raise notice 'TEST TZ-VALID-1: FAIL';
  end if;
end $$;

do $$
begin
  if not public.is_valid_iana_timezone('EST')
    and not public.is_valid_iana_timezone('EDT')
    and not public.is_valid_iana_timezone('GMT-5')
    and not public.is_valid_iana_timezone('Georgia')
    and not public.is_valid_iana_timezone('Eastern')
    and not public.is_valid_iana_timezone('Not/AZone')
    and not public.is_valid_iana_timezone(null)
    and not public.is_valid_iana_timezone('')
  then
    raise notice 'TEST TZ-INVALID-1: PASS (every named-invalid example rejected, including the exact EST/EDT/GMT-5/Georgia/Eastern examples from the work item)';
  else
    raise notice 'TEST TZ-INVALID-1: FAIL';
  end if;
end $$;

-- =============================================================================
-- CHECK constraint — live INSERT/UPDATE behavior, not just the bare function
-- =============================================================================
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.organizations (name, status, timezone) values ('TZ Test Bad', 'active', 'EST');
    v_failed := true; -- should never reach here
  exception
    when check_violation then
      null; -- expected
  end;
  if v_failed then
    raise notice 'TEST TZ-CONSTRAINT-1: FAIL (invalid timezone was accepted by the CHECK constraint)';
  else
    raise notice 'TEST TZ-CONSTRAINT-1: PASS (INSERT with timezone=EST correctly rejected by organizations_timezone_valid_iana)';
  end if;
end $$;

do $$
declare v_id uuid;
begin
  insert into public.organizations (name, status, timezone) values ('TZ Test Good', 'active', 'Africa/Lagos') returning id into v_id;
  if v_id is not null then
    raise notice 'TEST TZ-CONSTRAINT-2: PASS (INSERT with a genuine IANA timezone succeeds)';
  else
    raise notice 'TEST TZ-CONSTRAINT-2: FAIL';
  end if;
  delete from public.organizations where id = v_id; -- cleanup, not part of the fixture set
end $$;

do $$
declare v_failed boolean := false;
begin
  begin
    update public.organizations set timezone = null where id = '10000000-0000-0000-0000-0000000000a1';
    v_failed := true;
  exception
    when not_null_violation then
      null; -- expected
  end;
  if v_failed then
    raise notice 'TEST TZ-CONSTRAINT-3: FAIL (timezone accepted a NULL despite the NOT NULL constraint)';
  else
    raise notice 'TEST TZ-CONSTRAINT-3: PASS (timezone cannot be set back to NULL — no organization can be left with an ambiguous operational timezone)';
  end if;
end $$;

-- =============================================================================
-- Existing (seeded) organizations have explicit, deliberate, DIFFERENT values
-- =============================================================================
do $$
declare v_a text; v_b text;
begin
  select timezone into v_a from public.organizations where id = '10000000-0000-0000-0000-0000000000a1';
  select timezone into v_b from public.organizations where id = '10000000-0000-0000-0000-0000000000b1';
  if v_a = 'America/New_York' and v_b = 'America/Chicago' and v_a <> v_b then
    raise notice 'TEST TZ-SEED-1: PASS (Org A=%, Org B=%  — explicit, distinct, deliberate seed values, not a single product-wide default)', v_a, v_b;
  else
    raise notice 'TEST TZ-SEED-1: FAIL (Org A=%, Org B=%)', v_a, v_b;
  end if;
end $$;

-- =============================================================================
-- RLS: reading .timezone follows the EXISTING organizations SELECT policies
-- exactly (no widening, no new policy) — inactive Membership and foreign-org
-- callers see nothing, same as any other column on this table.
-- =============================================================================
do $$
declare v_tz text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin, active
  select timezone into v_tz from public.organizations where id = '10000000-0000-0000-0000-0000000000a1';
  reset role;
  if v_tz = 'America/New_York' then
    raise notice 'TEST TZ-RLS-1: PASS (active Org A member reads their own org''s timezone)';
  else
    raise notice 'TEST TZ-RLS-1: FAIL (v_tz=%)', v_tz;
  end if;
end $$;

do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin
  select count(*) into v_count from public.organizations where id = '10000000-0000-0000-0000-0000000000b1'; -- Org B
  reset role;
  if v_count = 0 then
    raise notice 'TEST TZ-RLS-2: PASS (Org A admin cannot see Org B''s row/timezone at all — foreign org remains inaccessible)';
  else
    raise notice 'TEST TZ-RLS-2: FAIL (v_count=%)', v_count;
  end if;
end $$;

do $$
declare v_count int;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a5'; -- Org A, dispatcher, INACTIVE membership
  select count(*) into v_count from public.organizations where id = '10000000-0000-0000-0000-0000000000a1';
  reset role;
  if v_count = 0 then
    raise notice 'TEST TZ-RLS-3: PASS (inactive Membership cannot read the organization row/timezone at all)';
  else
    raise notice 'TEST TZ-RLS-3: FAIL (v_count=%)', v_count;
  end if;
end $$;

do $$
declare v_count int; v_denied boolean := false;
begin
  set local role anon;
  begin
    select count(*) into v_count from public.organizations where id = '10000000-0000-0000-0000-0000000000a1';
  exception
    when insufficient_privilege then
      -- anon never received a table-level SELECT grant on organizations at
      -- all (only `authenticated` did) — this is an even stronger denial
      -- than an RLS zero-row result, and the expected outcome here.
      v_denied := true;
  end;
  reset role;
  if v_denied or v_count = 0 then
    raise notice 'TEST TZ-RLS-4: PASS (anon cannot read any organization row/timezone — denied at % layer)', case when v_denied then 'the table-grant' else 'the RLS-policy' end;
  else
    raise notice 'TEST TZ-RLS-4: FAIL (v_count=%)', v_count;
  end if;
end $$;

-- =============================================================================
-- P1-E3-S9 update: the onboarding flow's own Business Basics step now
-- legitimately needs an Organization Admin to set their OWN org's
-- timezone (work item §6, "Timezone must be canonical because Trip
-- scheduling depends on it" — collected at signup time, not hard-coded).
-- 20260903100600_organization_timezone_update_grant.sql deliberately
-- ADDS the column grant this test previously asserted did not exist —
-- this test now verifies the NEW, correct boundary instead: an
-- Organization Admin CAN update their own org's timezone, to a genuine
-- IANA value only, and still CANNOT touch a foreign org's timezone
-- (org-scoping is unchanged, only the same-org write itself is now
-- permitted). The original value is restored at the end so later tests
-- in this suite are unaffected.
-- =============================================================================
-- P1-PILOT-S4B-R4A: direct UPDATE of organizations.timezone (and name) was
-- REVOKED from `authenticated` (20260920090000) so the audited
-- update_organization_settings RPC is the only write path. WRITE-1 now
-- asserts the Organization Admin can still change their own timezone --
-- through the RPC -- and WRITE-1b asserts the direct column UPDATE is now
-- denied. WRITE-2 asserts the foreign-org attempt is denied by the RPC.
do $$
declare v_changed boolean;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin, own org
  v_changed := (public.update_organization_settings('10000000-0000-0000-0000-0000000000a1', '{"timezone": "America/Chicago"}'::jsonb)).changed;
  reset role;
  if v_changed and (select timezone from public.organizations where id = '10000000-0000-0000-0000-0000000000a1') = 'America/Chicago' then
    raise notice 'TEST TZ-WRITE-1 (own org, valid IANA zone, via RPC): PASS (Organization Admin can update their own org''s timezone)';
  else
    raise notice 'TEST TZ-WRITE-1 (own org, valid IANA zone, via RPC): FAIL';
  end if;
exception when others then
  reset role;
  raise notice 'TEST TZ-WRITE-1 (own org, valid IANA zone, via RPC): FAIL (%: %)', sqlstate, sqlerrm;
end $$;

do $$
declare v_denied boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1';
  begin
    update public.organizations set timezone = 'America/Denver' where id = '10000000-0000-0000-0000-0000000000a1';
  exception when insufficient_privilege then
    v_denied := true;
  end;
  reset role;
  if v_denied then
    raise notice 'TEST TZ-WRITE-1b (direct column UPDATE of timezone): PASS (DENY -- only the audited RPC writes it)';
  else
    raise notice 'TEST TZ-WRITE-1b (direct column UPDATE of timezone): FAIL (direct UPDATE was permitted)';
  end if;
end $$;

do $$
declare v_denied boolean := false;
declare v_leaked text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000a1'; -- Org A admin -- NOT Org B's admin
  begin
    perform public.update_organization_settings('10000000-0000-0000-0000-0000000000b1', '{"timezone": "America/Denver"}'::jsonb);
  exception when sqlstate 'ZW002' then
    v_denied := true;
  end;
  reset role;
  select timezone into v_leaked from public.organizations where id = '10000000-0000-0000-0000-0000000000b1';
  if v_denied and v_leaked is distinct from 'America/Denver' then
    raise notice 'TEST TZ-WRITE-2 (foreign org denied): PASS (DENY -- org-scoping unchanged)';
  else
    raise notice 'TEST TZ-WRITE-2 (foreign org denied): FAIL (denied=%, org B timezone=%)', v_denied, v_leaked;
  end if;
end $$;

-- Restore Org A's original timezone so later tests in this suite (and
-- any other suite run after it in the same reset cycle) see the
-- unmodified seed value.
update public.organizations set timezone = 'America/New_York' where id = '10000000-0000-0000-0000-0000000000a1';

-- =============================================================================
-- Validator function privilege: `authenticated` MUST be able to execute it
-- (required so any ordinary organizations UPDATE — even one that never
-- touches timezone — doesn't fail the row's own CHECK-constraint
-- re-evaluation; confirmed by direct empirical test before this grant was
-- added, not assumed), while it is NOT granted to `anon`/`public` at large.
-- =============================================================================
do $$
declare v_result boolean;
begin
  set local role authenticated;
  v_result := public.is_valid_iana_timezone('America/New_York');
  reset role;
  if v_result then
    raise notice 'TEST TZ-PRIVILEGE-1: PASS (authenticated can execute the validator — required for ordinary organizations UPDATEs to keep working, since CHECK constraints re-evaluate under the calling role''s own privileges on every UPDATE regardless of which column changed)';
  else
    raise notice 'TEST TZ-PRIVILEGE-1: FAIL';
  end if;
end $$;

do $$
declare v_failed boolean := false;
begin
  set local role anon;
  begin
    perform public.is_valid_iana_timezone('America/New_York');
    v_failed := true;
  exception
    when insufficient_privilege then
      null; -- expected
  end;
  reset role;
  if v_failed then
    raise notice 'TEST TZ-PRIVILEGE-2: FAIL (anon could EXECUTE is_valid_iana_timezone — should not be granted)';
  else
    raise notice 'TEST TZ-PRIVILEGE-2: PASS (anon correctly denied — EXECUTE was never granted to anon or public)';
  end if;
end $$;
