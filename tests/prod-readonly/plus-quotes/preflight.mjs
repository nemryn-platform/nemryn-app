// NP-P2-S5-S3C-R1 -- READ-ONLY production preflight + fictional data inventory (Pilot Simulation tenant only).
// Every production statement is a SELECT through `supabase db query --linked`. Reference definitions come from the
// isolated NemrynS1Iso stack (migrations byte-identical to the repository). Nothing is written anywhere.
// MANUAL, owner-authorized only (never CI). The isolated reference stack must be running with the repository migrations:
//   QUOTES_PROD_READONLY_ACK=read-only node tests/prod-readonly/plus-quotes/preflight.mjs
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { ORG, REPO_ROOT, q, one } from "./_prod.mjs";

// the LOCAL reference: the isolated stack with the repository migrations applied (read with SELECTs only)
const REF_DB = process.env.QUOTES_PROD_REFERENCE_DB_CONTAINER || "supabase_db_NemrynS1Iso";
if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(REF_DB)) throw new Error(`refusing reference container ${REF_DB}`);
const loc = (sql) => execSync(`docker exec -i ${REF_DB} psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1`, { input: sql, timeout: 60_000 }).toString().trim();
let fails = 0;
const check = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d !== "" && d !== undefined ? " :: " + String(d).slice(0, 600) : ""}`); return !!c; };
const section = (s) => console.log(`\n>>> ${s}`);

section("Database identity and migrations");
const repoVersions = readdirSync(path.join(REPO_ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.split("_")[0]).sort();
const prodVersions = q("select version from supabase_migrations.schema_migrations order by version").map((r) => r.version);
const missing = repoVersions.filter((v) => !prodVersions.includes(v));
const extra = prodVersions.filter((v) => !repoVersions.includes(v));
check("M1 production migration head is 20261021100000", prodVersions.at(-1) === "20261021100000", prodVersions.at(-1));
check("M2 production versions == repository files (no missing, no extra; S3C added none)", missing.length === 0 && extra.length === 0, `prod=${prodVersions.length} repo=${repoVersions.length} missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);

section("Schema fingerprints: production vs repository definitions (isolated stack)");
const FN = `select p.oid::regprocedure::text || '|' || p.prosecdef || '|' || coalesce(p.proacl::text,'-') || '|' || coalesce(array_to_string(p.proconfig, ';'),'-') || '|' || md5(p.prosrc) as f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname <> 'rls_auto_enable' order by 1`;
const POL = `select tablename || '|' || policyname || '|' || md5(cmd || '|' || coalesce(qual,'') || '|' || coalesce(with_check,'')) as f from pg_policies where schemaname = 'public' order by 1`;
const ACL = `select c.relname || '|' || coalesce(c.relacl::text,'-') || '|' || c.relrowsecurity as f from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`;
const CON = `select conrelid::regclass::text || '|' || conname || '|' || md5(pg_get_constraintdef(oid)) || '|' || convalidated as f from pg_constraint where connamespace = 'public'::regnamespace order by 1`;
const IDX = `select indexname || '|' || md5(indexdef) as f from pg_indexes where schemaname = 'public' order by 1`;
const TRG = `select tgrelid::regclass::text || '|' || tgname || '|' || tgenabled::text as f from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'storage.%' and tgrelid::regclass::text not like 'auth.%' order by 1`;
for (const [name, sql] of [["functions (signature, SECURITY DEFINER, ACL, search_path, body md5)", FN], ["RLS policies", POL], ["table ACL + RLS flags", ACL], ["constraints", CON], ["indexes", IDX], ["triggers", TRG]]) {
  const p = q(sql).map((r) => r.f);
  const l = loc(sql).split("\n").filter(Boolean);
  const onlyP = p.filter((x) => !l.includes(x));
  const onlyL = l.filter((x) => !p.includes(x));
  check(`S ${name}: production identical to the repository (${p.length} items)`, onlyP.length === 0 && onlyL.length === 0, `prod-only=${JSON.stringify(onlyP.slice(0, 3))} repo-only=${JSON.stringify(onlyL.slice(0, 3))}`);
}

check("S0 the only production-only public function is the documented Supabase platform helper rls_auto_enable() (event trigger ensure_rls; ACL postgres + service_role only; P1-SEC-01 contract check 13 exception)",
  JSON.stringify(q(`select coalesce(p.proacl::text,'-') as a from pg_proc p where p.proname='rls_auto_enable'`)) === JSON.stringify([{ a: "{postgres=X/postgres,service_role=X/postgres}" }]));

section("Quote / task contracts");
const sigs = q(`select p.oid::regprocedure::text as s, p.prosecdef as d, coalesce(p.proacl::text,'-') as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('plus_create_quote','plus_update_quote_draft','plus_mark_quote_sent','plus_record_quote_response','plus_revise_quote','plus_withdraw_quote','plus_list_quotes','plus_get_quote','plus_list_organization_quotes','plus_quote_directory_summary','plus_create_task','plus_list_tasks','plus_update_task','plus_complete_task','plus_cancel_task','plus_reassign_task') order by 1`);
console.log(sigs.map((r) => `   ${r.s} secdef=${r.d} acl=${r.acl}`).join("\n"));
check("C1 16 quote + task RPCs present, each exactly once, SECURITY DEFINER, client EXECUTE authenticated only (no anon / PUBLIC)",
  sigs.length === 16 && sigs.every((r) => (r.d === true || r.d === "t") && /authenticated=X/.test(r.acl) && !/anon=|(^|,)=X/.test(r.acl)), sigs.length);
check("C2 exactly ONE plus_mark_quote_sent(uuid,uuid,timestamptz,boolean)", sigs.filter((r) => r.s.startsWith("plus_mark_quote_sent(")).map((r) => r.s).join() === "plus_mark_quote_sent(uuid,uuid,timestamp with time zone,boolean)");
const send = one(`select prosrc from pg_proc where proname='plus_mark_quote_sent'`);
check("C3 OD-Q16: plus_mark_quote_sent reads the contact's do_not_contact FOR SHARE and refuses with dnc_acknowledgment_required", /for share/i.test(send) && /dnc_acknowledgment_required/.test(send) && /do_not_contact/.test(send));
check("C4 OD-Q12 partial unique indexes present", one(`select count(*) from pg_indexes where schemaname='public' and indexname in ('plus_quotes_one_draft_per_opportunity_idx','plus_quotes_one_sent_per_opportunity_idx') and indexdef ilike '%unique%'`) == 2);
check("C5 plus_tasks: due_at nullable; one-subject CHECK; opportunity composite FK (the follow-up needs no schema change)",
  one(`select is_nullable from information_schema.columns where table_schema='public' and table_name='plus_tasks' and column_name='due_at'`) === "YES"
  && one(`select count(*) from pg_constraint where conrelid='public.plus_tasks'::regclass and conname in ('plus_tasks_subject_check','plus_tasks_opportunity_fkey')`) == 2);
check("C6 no quote lifecycle function writes plus_tasks", one(`select count(*) from pg_proc where proname in ('plus_mark_quote_sent','plus_record_quote_response','plus_revise_quote','plus_withdraw_quote','plus_create_quote','plus_update_quote_draft') and prosrc ~* 'plus_tasks'`) == 0);
check("C7 Core interfaces present (log_transportation_request, conversion, rebooking) -- definitions covered by S above",
  one(`select count(*) from pg_proc where proname in ('log_transportation_request','plus_convert_opportunity_to_request','plus_create_rebooking_request')`) == 3);

section("Pilot Simulation identity, entitlement and members");
check("I1 Pilot Simulation organization", one(`select name from public.organizations where id='${ORG}'`) === "Nemryn Pilot Simulation");
console.log(JSON.stringify(q(`select name, timezone, business_phone is not null and business_phone<>'' as has_phone, business_email is not null and business_email<>'' as has_email, business_address is not null and business_address<>'' as has_address from public.organizations where id='${ORG}'`)));
console.log(JSON.stringify(q(`select module, status, trial_ends_at from public.organization_modules where organization_id='${ORG}'`)));
console.log(JSON.stringify(q(`select m.id as membership, m.role, m.status, coalesce((select access from public.membership_module_grants g where g.membership_id=m.id and g.revoked_at is null and g.module='plus' limit 1),'-') as plus_grant from public.memberships m where m.organization_id='${ORG}' order by m.role`)));

section("Fictional data inventory (read-only)");
console.log("opportunities:", JSON.stringify(q(`select id, title, stage, primary_contact_id from public.plus_opportunities where organization_id='${ORG}' order by created_at`)));
console.log("contacts:", JSON.stringify(q(`select id, display_name, status, do_not_contact from public.plus_contacts where organization_id='${ORG}' order by created_at`)));
console.log("quotes:", JSON.stringify(q(`select q.id, q.quote_number, q.kind, q.status, q.total_cents, q.valid_until, q.opportunity_id, q.supersedes_quote_id, q.valid_until < public._plus_org_local_today('${ORG}') as past_valid from public.plus_quotes q where q.organization_id='${ORG}' order by q.quote_number`)));
console.log("tasks:", JSON.stringify(q(`select id, title, status, due_at, opportunity_id, contact_id from public.plus_tasks where organization_id='${ORG}' order by created_at`)));
console.log("quote activities:", one(`select coalesce(string_agg(activity_type || ':' || quote_status, ',' order by recorded_at, id),'none') from public.plus_activities where organization_id='${ORG}' and quote_id is not null`));

section("Baseline counts");
const COUNTS = `select
  (select coalesce(string_agg(status || ':' || n, ',' order by status), 'none') from (select status, count(*) n from public.plus_quotes where organization_id='${ORG}' group by status) x) as quotes,
  (select count(*) from public.plus_opportunities where organization_id='${ORG}') as opportunities,
  (select count(*) from public.plus_tasks where organization_id='${ORG}') as tasks,
  (select count(*) from public.plus_activities where organization_id='${ORG}') as activities,
  (select count(*) from public.plus_activities where organization_id='${ORG}' and quote_id is not null) as quote_events,
  (select count(*) from public.audit_events where organization_id='${ORG}' and entity_type='plus_quote') as quote_audit,
  (select count(*) from public.audit_events where organization_id='${ORG}' and entity_type='plus_task') as task_audit,
  (select count(*) from public.audit_events where organization_id='${ORG}') as all_audit,
  (select count(*) from public.transportation_requests where organization_id='${ORG}') as requests,
  (select count(*) from public.trips where organization_id='${ORG}') as trips,
  (select count(*) from public.passengers where organization_id='${ORG}') as passengers,
  (select count(*) from public.trip_assignments where organization_id='${ORG}') as assignments,
  (select count(*) from public.notification_events where organization_id='${ORG}') as notifications,
  (select count(*) from public.membership_module_grants where organization_id='${ORG}' and revoked_at is null) as grants,
  (select string_agg(organization_id::text || '=' || status || '/' || coalesce(trial_ends_at::text,'-') || '/' || updated_at, ',' order by organization_id) from public.organization_modules where module='plus') as plus_modules,
  (select count(*) from public.plus_quotes where organization_id<>'${ORG}') as other_quotes,
  (select count(*) from public.plus_tasks where organization_id<>'${ORG}') as other_tasks,
  (select count(*) from public.plus_activities where organization_id<>'${ORG}') as other_activities,
  (select count(*) || '@' || coalesce(max(updated_at)::text,'-') from public.transportation_requests where organization_id<>'${ORG}') as other_requests,
  (select count(*) from public.trips where organization_id<>'${ORG}') as other_trips,
  (select count(*) from public.notification_events where organization_id<>'${ORG}') as other_notifications,
  (select count(*) from public.audit_events where organization_id<>'${ORG}') as other_audit`;
console.log(JSON.stringify(q(COUNTS)[0], null, 1));
console.log(`\n=== PREFLIGHT ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} ===`);
process.exit(fails === 0 ? 0 : 1);
