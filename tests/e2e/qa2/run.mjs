// NP-UI-QA2 -- runner for the ISOLATED Core / Growth / Auth regression suites.
//
//   npm run test:e2e:qa2                       all 5 suites, each after a verified fresh reset of the isolated database
//   npm run test:e2e:qa2 -- core-requests      selected suites
//   npm run test:e2e:qa2:strict                known baseline defects (below) FAIL the run -- the UI-P2 acceptance gate
//   ... -- --no-reset                          skip the reset
//
// Same isolation rules as tests/e2e/plus-quotes (localhost app, NemrynS1Iso container, fictional seed, artifacts outside
// the repository). Suites run one at a time in their own process with their own fresh database.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP, ARTIFACTS_ROOT, DB, REPO_ROOT, assertFictionalSeed, sql } from "../plus-quotes/_config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** [key, file, expected check count at the QA2 baseline] */
const SUITES = [
  ["core-requests", "core-requests.e2e.mjs", 25],
  ["core-trips-dispatch", "core-trips-dispatch.e2e.mjs", 40],
  ["core-records", "core-records.e2e.mjs", 28],
  ["growth", "growth.e2e.mjs", 23],
  ["auth-access", "auth-access.e2e.mjs", 79],
];
/**
 * KNOWN BASELINE DEFECTS found by QA2 on the unchanged P1b application (NP-UI-QA2 report). Real defects, not test
 * flakiness: the assertions are NOT relaxed. UI-P2 must fix them; `--strict` (the P2 acceptance gate) fails while any
 * remains. Default mode labels a run whose ONLY failures are these as "KNOWN BASELINE DEFECTS ONLY".
 */
const KNOWN_BASELINE_DEFECTS = [
  // Standing Order (recurring arrangement) detail renders no <h1>: its only heading is the passenger-name <h2> (WCAG 1.3.1 / 2.4.6).
  "S5 arrangement detail: exactly one visible h1 (page title)",
  "H1 /operations/recurring-care/[id]: exactly one visible h1",
];

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const noReset = args.includes("--no-reset");
const wanted = args.filter((a) => !a.startsWith("--"));
const unknown = wanted.filter((w) => !SUITES.some(([k]) => k === w));
if (unknown.length) throw new Error(`unknown suite(s): ${unknown.join(", ")} (choose from ${SUITES.map(([k]) => k).join(", ")})`);
const selected = SUITES.filter(([k]) => wanted.length === 0 || wanted.includes(k));

const WORKDIR = process.env.QA2_E2E_SUPABASE_WORKDIR || process.env.QUOTES_E2E_SUPABASE_WORKDIR;
if (!noReset && (!WORKDIR || !existsSync(path.join(WORKDIR, "supabase", "config.toml")))) {
  throw new Error("QA2_E2E_SUPABASE_WORKDIR (or QUOTES_E2E_SUPABASE_WORKDIR) must point at the isolated stack's project directory so each suite starts from a fresh reset; or pass --no-reset");
}
const latestMigration = readdirSync(path.join(REPO_ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().at(-1).split("_")[0];

async function freshReset() {
  spawnSync("supabase", ["db", "reset", "--local"], { cwd: WORKDIR, stdio: "ignore", timeout: 240_000, killSignal: "SIGKILL" });
  // the reset restarts auth; restart THIS stack's Kong so it routes to the new auth container, then wait for auth
  const kong = DB.replace(/^supabase_db_/, "supabase_kong_");
  spawnSync("docker", ["restart", kong], { stdio: "ignore", timeout: 60_000 });
  const port = (spawnSync("docker", ["port", kong, "8000"], { encoding: "utf8" }).stdout ?? "").match(/:(\d+)\s*$/m)?.[1];
  let authOk = false;
  for (let i = 0; port && !authOk && i < 60; i++) {
    try {
      authOk = (await fetch(`http://127.0.0.1:${port}/auth/v1/health`)).status < 500;
    } catch {}
    if (!authOk) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!authOk) throw new Error(`auth is not reachable through ${kong} after the reset`);
  const state = sql(`select (select max(version) from supabase_migrations.schema_migrations) || '/' || (select count(*) from plus_contacts) || '/' || (select count(*) from transportation_requests where requester_name like 'QA2 %')`);
  if (state !== `${latestMigration}/0/0`) throw new Error(`reset not verified fresh: ${state} (expected ${latestMigration}/0/0)`);
  return state;
}

console.log(`Nemryn QA2 isolated regression -- app ${APP}, database ${DB}, ${noReset ? "NO reset" : `fresh reset in ${WORKDIR}`}${strict ? ", STRICT" : ""}`);
const results = [];
for (const [key, file, expected] of selected) {
  if (!noReset) await freshReset();
  assertFictionalSeed();
  const run = spawnSync(process.execPath, [path.join(HERE, file)], { encoding: "utf8", timeout: 1_800_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 });
  const out = (run.stdout ?? "") + (run.stderr ?? "");
  writeFileSync(path.join(ARTIFACTS_ROOT, `qa2-${key}-run.log`), out);
  const pass = (out.match(/^PASS — /gm) ?? []).length;
  const fails = out.split("\n").filter((l) => l.startsWith("FAIL — "));
  const failNames = fails.map((l) => l.slice(7).split(" :: ")[0]);
  const known = failNames.filter((n) => KNOWN_BASELINE_DEFECTS.includes(n));
  const unexpected = failNames.filter((n) => !KNOWN_BASELINE_DEFECTS.includes(n));
  const verdict = run.status === 0 && fails.length === 0 ? "PASS" : unexpected.length === 0 && known.length > 0 && !strict ? "KNOWN BASELINE DEFECTS ONLY" : "FAIL";
  results.push({ key, pass, fail: fails.length, expected, verdict, unexpected, known });
  console.log(`${key.padEnd(20)} pass=${String(pass).padStart(3)} fail=${fails.length}  (expected ${expected} checks)  ${verdict}`);
  for (const f of fails) console.log(`    ${f.slice(0, 220)}`);
}
const failed = results.filter((r) => r.verdict === "FAIL");
console.log(`\nRESULT: ${failed.length === 0 ? (results.some((r) => r.known.length) ? "no unexpected failures (known baseline defects remain)" : "all suites pass") : `${failed.length} suite(s) failed`}`);
console.log(`logs and artifacts: ${ARTIFACTS_ROOT}`);
process.exit(failed.length === 0 ? 0 : 1);
