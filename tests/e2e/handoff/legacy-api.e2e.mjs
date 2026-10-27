// NP-PILOT-P1 -- migration 98 backward compatibility: the CURRENTLY DEPLOYED app (main) calls the three changed RPCs
// through PostgREST with named arguments and WITHOUT the new trailing parameters. This replays those exact call shapes
// (copied from main: requests/new/actions.ts, growth/booking/actions.ts) as a signed-in staff member against the
// ISOLATED stack at migration 98 and checks they still resolve to the one function each and behave as before.
//   node tests/e2e/handoff/legacy-api.e2e.mjs
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { SEED_PASSWORD, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

assertFictionalSeed();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("isolated stack only (source ~/NemrynS1Iso/.env.isolated.local)");
const ORG_A = "10000000-0000-0000-0000-0000000000a1", U_A1 = "20000000-0000-0000-0000-0000000000a1";
const TAG = "LEGACYAPI";
let passes = 0, fails = 0;
const check = (n, c, d = "") => { if (c) passes++; else fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d ? " :: " + String(d).slice(0, 300) : ""}`); };
const one = (q) => sql(q).split("\n").map((l) => l.trim()).filter((l) => l && !/^(BEGIN|COMMIT|INSERT 0 \d+|UPDATE \d+|DELETE \d+|SET)$/.test(l))[0] ?? "";
function cleanup() {
  sql(`set session_replication_role = replica;
    delete from plus_activities where organization_id = '${ORG_A}' and contact_id in (select id from plus_contacts where display_name like '${TAG}%');
    delete from plus_request_attributions where organization_id = '${ORG_A}' and contact_id in (select id from plus_contacts where display_name like '${TAG}%');
    delete from request_events where request_id in (select id from transportation_requests where pickup_description like '${TAG}%');
    delete from transportation_requests where pickup_description like '${TAG}%';
    delete from plus_opportunities where organization_id = '${ORG_A}' and title like '${TAG}%';
    delete from plus_contacts where organization_id = '${ORG_A}' and display_name like '${TAG}%';
    delete from passengers where display_name like '${TAG}%';
    set session_replication_role = origin;`);
}
cleanup();
sql(`delete from organization_modules where organization_id = '${ORG_A}';
     insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}', 'plus', 'active', 'legacy api e2e');`);
const P = one(`insert into passengers (organization_id, display_name, phone) values ('${ORG_A}', '${TAG} Rider', '404-555-0111') returning id`);
const C = one(`insert into plus_contacts (organization_id, display_name, phone, contact_kind, created_by) values ('${ORG_A}', '${TAG} Contact', '(404) 555-0112', 'individual', '${U_A1}') returning id`);
const O = one(`insert into plus_opportunities (organization_id, title, source, primary_contact_id, created_by) values ('${ORG_A}', '${TAG} ride', 'phone', '${C}', '${U_A1}') returning id`);
try {
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  const { error: signErr } = await sb.auth.signInWithPassword({ email: "org-a-admin@example.test", password: SEED_PASSWORD });
  check("L0 signed in as the fictional Organization Admin", !signErr, signErr?.message);

  // main: src/app/operations/requests/new/actions.ts (15 named args, incl. p_passenger_id; no p_requested_passenger_name)
  const r1 = await sb.rpc("log_transportation_request", {
    p_organization_id: ORG_A, p_requester_name: `${TAG} Caller`, p_requester_relationship: "family", p_requester_phone: "(404) 555-0113",
    p_pickup_description: `${TAG} 1 Legacy Rd`, p_destination_description: "Fictional Clinic", p_return_trip_needed: "no", p_source: "phone",
    p_requester_email: undefined, p_passenger_id: P, p_preferred_date: undefined, p_preferred_time: undefined,
    p_assistance_notes: undefined, p_additional_notes: undefined, p_service_type: "dialysis",
  });

  const row1 = one(`select state || '|' || coalesce(passenger_id::text,'-') || '|' || coalesce(requested_passenger_name,'-') || '|' || coalesce(service_type,'-') from transportation_requests where pickup_description = '${TAG} 1 Legacy Rd'`);
  check("L1 Core New Request call shape from main (no rider-name arg) resolves and behaves as before: pending, passenger linked, no snapshot", !r1.error && row1 === `pending|${P}|-|dialysis`, r1.error?.message ?? `${JSON.stringify(r1.data)} ${row1}`);

  // main: growth/booking/actions.ts convertOpportunityAction (12 named args)
  const r2 = await sb.rpc("plus_convert_opportunity_to_request", {
    p_organization_id: ORG_A, p_opportunity_id: O, p_expected_updated_at: one(`select updated_at from plus_opportunities where id = '${O}'`),
    p_idempotency_key: `legacy-conv-${randomUUID()}`, p_requester_relationship: "self", p_pickup_description: `${TAG} 2 Legacy Rd`,
    p_destination_description: "Fictional Clinic", p_return_trip_needed: "no", p_preferred_date: null, p_preferred_time: null,
    p_assistance_notes: null, p_additional_notes: null,
  });
  const row2 = one(`select r.state || '|' || coalesce(r.passenger_id::text,'-') || '|' || coalesce(r.requested_passenger_name,'-') || '|' || o.stage from transportation_requests r join plus_request_attributions a on a.request_id = r.id join plus_opportunities o on o.id = a.opportunity_id where a.opportunity_id = '${O}'`);
  check("L2 conversion call shape from main (12 named args) resolves: pending request, no passenger, no snapshot, opportunity converted", !r2.error && r2.data?.changed === true && row2 === "pending|-|-|converted", r2.error?.message ?? row2);

  // main: growth/booking/actions.ts rebookContactAction (13 named args)
  const r3 = await sb.rpc("plus_create_rebooking_request", {
    p_organization_id: ORG_A, p_contact_id: C, p_idempotency_key: `legacy-rb-${randomUUID()}`, p_requester_relationship: "self",
    p_pickup_description: `${TAG} 3 Legacy Rd`, p_destination_description: "Fictional Clinic", p_return_trip_needed: "yes", p_source: "phone",
    p_preferred_date: null, p_preferred_time: null, p_assistance_notes: null, p_additional_notes: null, p_service_type: undefined,
  });
  const row3 = one(`select state || '|' || coalesce(passenger_id::text,'-') || '|' || coalesce(requested_passenger_name,'-') from transportation_requests where pickup_description = '${TAG} 3 Legacy Rd'`);
  check("L3 rebooking call shape from main (13 named args) resolves: pending request, no passenger, no snapshot", !r3.error && r3.data?.changed === true && row3 === "pending|-|-", r3.error?.message ?? row3);

  // the anon (publishable-key, signed-out) client still cannot execute any of them
  const anon = createClient(URL, KEY, { auth: { persistSession: false } });
  const a = await anon.rpc("plus_create_rebooking_request", { p_organization_id: ORG_A, p_contact_id: C, p_idempotency_key: `legacy-anon-${randomUUID()}`, p_requester_relationship: "self", p_pickup_description: `${TAG} 4 Anon Rd`, p_destination_description: "x", p_return_trip_needed: "no", p_source: "phone" });
  check("L4 signed-out (anon) caller is refused (no EXECUTE grant); nothing created", !!a.error && one(`select count(*) from transportation_requests where pickup_description = '${TAG} 4 Anon Rd'`) === "0", a.error?.code + " " + a.error?.message);
} catch (e) {
  fails++; console.log("FAIL — unexpected error ::", e?.stack ?? e);
} finally {
  try { cleanup(); sql(`delete from organization_modules where organization_id = '${ORG_A}'`); } catch (e) { console.log("cleanup warning:", String(e).slice(0, 200)); }
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
