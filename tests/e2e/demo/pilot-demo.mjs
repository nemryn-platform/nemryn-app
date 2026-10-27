// NP-PILOT-P2 -- repeatable pilot DEMO on the ISOLATED stack (NemrynS1Iso), FICTIONAL data only.
//   node tests/e2e/demo/pilot-demo.mjs status                                   # what is staged (writes nothing)
//   node tests/e2e/demo/pilot-demo.mjs prepare --confirm-isolated=NemrynS1Iso    # (re)stage the story up to "accepted quote"
//   node tests/e2e/demo/pilot-demo.mjs reset   --confirm-isolated=NemrynS1Iso    # remove every DEMO row
// The presenter then performs the rest LIVE in the app (see docs/demo/NP-PILOT-P2-demo-runbook.md): convert the quote
// to a request choosing the rider, accept, schedule, dispatch, complete as the driver, invoice from Trip Detail.
//
// SAFETY (isolation-guard.mjs, fails closed): before ANY database statement the environment must PROVE it is the
// disposable local NemrynS1Iso stack -- no remote URL in the environment, the exact local container + project label,
// the local Docker socket, the isolated project's config.toml with the matching DB port, a database answering on
// 127.0.0.1, and the fictional seed fingerprint. prepare / reset also need --confirm-isolated=NemrynS1Iso. Every batch
// re-proves the fingerprint INSIDE the database session first, so the billing-ledger trigger bypass used by reset can
// never run against any other database. Production is unreachable: the demo only uses `docker exec` on the local
// container. Public inquiry access is enabled for ONE submission inside the isolated stack and removed at once (the
// app's PLUS_INQUIRY_SUBMISSIONS switch stays off).
import { IN_SESSION_GUARD, IsolationRefused, proveIsolatedStack, requireConfirmation } from "./isolation-guard.mjs";

const mode = process.argv[2];
if (!["prepare", "status", "reset"].includes(mode)) { console.error("usage: pilot-demo.mjs status | prepare --confirm-isolated=NemrynS1Iso | reset --confirm-isolated=NemrynS1Iso"); process.exit(2); }
try {
  if (mode !== "status") requireConfirmation(process.argv.slice(3));
  const evidence = await proveIsolatedStack();
  console.log(`isolation proven: ${evidence.container} (project ${evidence.project}), loopback 127.0.0.1:${evidence.loopbackPort}, fingerprint ${evidence.fingerprint}`);
} catch (e) {
  if (e instanceof IsolationRefused) { console.error(`REFUSED (demo isolation guard): ${e.message}. Nothing was changed.`); process.exit(2); }
  throw e;
}
// only now load the shared config (its own localhost / container / fingerprint checks run as well)
const { APP, assertFictionalSeed, sql: rawSql } = await import("../plus-quotes/_config.mjs");
assertFictionalSeed();
const sql = (q) => rawSql(IN_SESSION_GUARD + q);
const ORG = "10000000-0000-0000-0000-0000000000a1"; // Fictional Org A
const ADMIN = "20000000-0000-0000-0000-0000000000a1";
const TAG = "DEMO";
const DEMO_PHONE = "(404) 555-0123";
const DEMO_BUSINESS = { phone: "(404) 555-0100", address: "100 Fictional Demo Way\nAtlanta, GA 30301" };

const one = (q) => sql(q).split("\n").map((l) => l.trim()).filter((l) => l && !/^(DO|BEGIN|SET|COMMIT|SELECT \d+|INSERT 0 \d+|UPDATE \d+|DELETE \d+)$/.test(l))[0] ?? "";
const asAdmin = (stmt) => one(`begin; set local role authenticated; set local request.jwt.claim.sub = '${ADMIN}'; ${stmt}; commit;`);

function reset() {
  // Billing is append-only at the database level (issued invoices, the payment ledger), so ONLY the billing rows of
  // DEMO invoices are removed with triggers bypassed -- all of an invoice's rows together, so nothing is orphaned.
  // Everything else is deleted in foreign-key order without any bypass (NP-PILOT-P1 follow-up F2).
  sql(`
    set session_replication_role = replica;
    create temp table demo_inv as select distinct i.id from billing_invoices i
      left join billing_invoice_trips t on t.invoice_id = i.id left join trips tr on tr.id = t.trip_id
      where i.organization_id = '${ORG}' and (tr.pickup_description like '${TAG}%' or i.bill_to_name like '${TAG}%'
        or i.source_quote_id in (select q.id from plus_quotes q where q.idempotency_key like 'demo-%'));
    delete from billing_payments where invoice_id in (select id from demo_inv);
    delete from billing_invoice_lines where invoice_id in (select id from demo_inv);
    delete from billing_invoice_trips where invoice_id in (select id from demo_inv);
    delete from billing_invoices where id in (select id from demo_inv);
    set session_replication_role = origin;
  `);
  sql(`
    delete from trip_events where trip_id in (select id from trips where pickup_description like '${TAG}%');
    delete from trip_assignments where trip_id in (select id from trips where pickup_description like '${TAG}%');
    delete from trips where pickup_description like '${TAG}%';
    delete from plus_activities where organization_id = '${ORG}' and (contact_id in (select id from plus_contacts where display_name like '${TAG}%') or opportunity_id in (select id from plus_opportunities where title like '${TAG}%'));
    delete from plus_request_attributions where contact_id in (select id from plus_contacts where display_name like '${TAG}%');
    delete from request_events where request_id in (select id from transportation_requests where requester_name like '${TAG}%');
    delete from transportation_requests where requester_name like '${TAG}%';
    delete from plus_quotes where organization_id = '${ORG}' and idempotency_key like 'demo-%';
    delete from plus_communication_consents where contact_id in (select id from plus_contacts where display_name like '${TAG}%');
    delete from plus_opportunities where organization_id = '${ORG}' and title like '${TAG}%';
    delete from plus_inquiries where organization_id = '${ORG}' and idempotency_key like 'demo-%';
    delete from plus_inquiry_public_access where organization_id = '${ORG}';
    delete from plus_inquiry_forms where organization_id = '${ORG}' and headline like '${TAG}%';
    delete from plus_contacts where organization_id = '${ORG}' and display_name like '${TAG}%';
    delete from passengers where organization_id = '${ORG}' and display_name like '${TAG}%';
    update organizations set business_phone = null, business_address = null
      where id = '${ORG}' and business_phone = '${DEMO_BUSINESS.phone}' and business_address = ${pgText(DEMO_BUSINESS.address)};
    delete from organization_modules where organization_id = '${ORG}' and status_reason = 'pilot demo';
  `);
}
function pgText(v) { return `'${v.replace(/'/g, "''")}'`; }

function status() {
  const r = (q) => one(q) || "0";
  console.log(`app:            ${APP}  (sign in as org-a-admin@example.test / the fictional seed password)`);
  console.log(`plus:           ${r(`select status from organization_modules where organization_id = '${ORG}' and module = 'plus'`) || "none (Core-only)"}`);
  console.log(`business:       ${r(`select coalesce(business_phone, '-') from organizations where id = '${ORG}'`)}`);
  console.log(`demo contact:   ${r(`select count(*) from plus_contacts where display_name like '${TAG}%'`)}`);
  console.log(`opportunity:    ${r(`select stage from plus_opportunities where title like '${TAG}%' limit 1`) || "-"}`);
  console.log(`quote:          ${r(`select q.quote_number || ' ' || q.status from plus_quotes q join plus_opportunities o on o.id = q.opportunity_id where o.title like '${TAG}%' order by q.quote_number desc limit 1`) || "-"}`);
  console.log(`requests:       ${r(`select count(*) || ' (' || coalesce(string_agg(state, ','), '') || ')' from transportation_requests where requester_name like '${TAG}%'`)}`);
  console.log(`trips:          ${r(`select count(*) || ' (' || coalesce(string_agg(state, ','), '') || ')' from trips where pickup_description like '${TAG}%'`)}`);
  console.log(`public access:  ${r(`select count(*) from plus_inquiry_public_access where organization_id = '${ORG}'`)} row(s) (must be 0 after prepare)`);
}

if (mode === "reset") { reset(); console.log("demo reset: DEMO rows removed, Org A back to Core-only (if the demo enabled Plus)."); status(); process.exit(0); }
if (mode === "status") { status(); process.exit(0); }

// ---------------------------------------------------------------- prepare
reset();
sql(`insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG}', 'plus', 'active', 'pilot demo') on conflict (organization_id, module) do nothing;`);
sql(`update organizations set business_phone = '${DEMO_BUSINESS.phone}', business_address = ${pgText(DEMO_BUSINESS.address)} where id = '${ORG}' and business_phone is null and business_address is null;`);
// the rider who will ride (a returning passenger the "same phone" hint finds -- the requester is her daughter)
sql(`insert into passengers (organization_id, display_name, phone, assistance_notes) values ('${ORG}', '${TAG} Rose Fictional', '404-555-0123', 'Fictional: uses a walker');`);
// 1. website inquiry (isolated stack only; public access exists for this ONE submission)
sql(`insert into plus_inquiry_forms (organization_id, status, headline, offered_service_types, consent_text_version, published_at, published_by, created_by, updated_by)
       values ('${ORG}', 'published', '${TAG} Request a ride', '{}', 'plus-inquiry-consent-v1', now(), '${ADMIN}', '${ADMIN}', '${ADMIN}');
     insert into plus_inquiry_public_access (organization_id, reason, enabled_by) values ('${ORG}', 'pilot demo (isolated)', '${ADMIN}');`);
const KEY = one(`select public_key from plus_inquiry_forms where organization_id = '${ORG}' and headline like '${TAG}%'`);
const VER = one(`select config_version from plus_inquiry_forms where organization_id = '${ORG}' and headline like '${TAG}%'`);
const stamp = Date.now().toString(36);
sql(`select (public.submit_plus_inquiry('${KEY}', 'demo-inq-${stamp}', ${VER}, '${TAG} Dana Fictional', '${DEMO_PHONE}', null, 'either', 'family', 'quote', null, 'this_week', 'Dialysis rides for my mother, Mon/Wed/Fri (fictional).', false, false, '{}'::jsonb)).*`);
sql(`delete from plus_inquiry_public_access where organization_id = '${ORG}'`);
const INQ = one(`select id from plus_inquiries where idempotency_key = 'demo-inq-${stamp}'`);
// 2. staff converts the inquiry into a contact + opportunity
const conv = asAdmin(`select (r).opportunity_id || '|' || (r).contact_id from (select public.plus_convert_inquiry('${ORG}', '${INQ}', 1, 'create', null, true, false, '${TAG} Dana — dialysis rides for her mother', null, false) r) s`);
const [OPP] = conv.split("|");
// 3. a round-trip quote, sent and accepted (the presenter can also show creating one live on another opportunity)
const Q = asAdmin(`select (public.plus_create_quote('${ORG}', '${OPP}', 'demo-q-${stamp}', 'quote', 'dialysis', true, 12, 4000, 1500, 0, 0, 1000, 0, 0, 0, null, 0, null, current_date + 30)).quote_id`);
asAdmin(`select (public.plus_mark_quote_sent('${ORG}', '${Q}', (select updated_at from public.plus_quotes where id = '${Q}'), false)).status`);
asAdmin(`select (public.plus_record_quote_response('${ORG}', '${Q}', (select updated_at from public.plus_quotes where id = '${Q}'), 'accepted')).status`);
console.log(`demo prepared: inquiry -> opportunity ${OPP} -> quote ${one(`select quote_number from plus_quotes where id = '${Q}'`)} accepted.`);
console.log(`open ${APP}/operations/growth/pipeline/${OPP} and follow docs/demo/NP-PILOT-P2-demo-runbook.md`);
status();
