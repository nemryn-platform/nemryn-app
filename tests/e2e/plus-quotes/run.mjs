// Nemryn Plus -- runner for the ISOLATED Estimates & Quotes browser regression suites.
//
//   npm run test:e2e:quotes                      all 7 suites, each after a verified fresh reset of the isolated database
//   npm run test:e2e:quotes -- s3a s4-a11y       selected suites
//   npm run test:e2e:quotes:strict               the UI-overhaul gate: the known U1 / U2 accessibility defects FAIL the run
//   ... -- --no-reset                            skip the reset (S3A then needs an otherwise empty quote database)
//
// The runner never contacts production; the production read-only scripts are separate and manual (see README.md).
// Suites run one at a time in their own process; each gets a fresh database, so no state is shared between suites.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP, ARTIFACTS_ROOT, DB, REPO_ROOT, artifactDir, assertFictionalSeed, sql } from "./_config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES = [
  ["s2", "s2-drafts.e2e.mjs", 33],
  ["s3a", "s3a-directory.e2e.mjs", 31],
  ["s3b", "s3b-lifecycle.e2e.mjs", 32],
  ["s3c", "s3c-print-followup.e2e.mjs", 54],
  ["o1", "o1-closed-notice.e2e.mjs", 27],
  ["s4-integrated", "s4-integrated.e2e.mjs", 69],
  ["s4-a11y", "s4-a11y.e2e.mjs", 26],
];
/**
 * KNOWN, OWNER-ACCEPTED accessibility defects (NP-P2-S5-S4 report section 9): U1 colour contrast (WCAG 1.4.3) and U2
 * focus not restored after Cancel / Close (WCAG 2.4.3). They are MANDATORY acceptance criteria of the canonical UI
 * overhaul -- not passed, not dismissed. The suite's assertions are unchanged; this list only labels the result.
 */
const KNOWN_A11Y_FAILURES = [
  "AXE create dialog: 0 serious / critical violations",
  "AXE edit dialog: 0 serious / critical violations",
  "AXE Mark sent dialog: 0 serious / critical violations",
  "AXE Mark sent dialog with the do-not-contact warning: 0 serious / critical violations",
  "AXE Estimates & Quotes directory: 0 serious / critical violations",
  "KEY Edit draft -> Cancel (keyboard)",
  "KEY Edit draft -> Close (X) (keyboard)",
  "KEY Record accepted -> Cancel (keyboard)",
];

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const noReset = args.includes("--no-reset");
const wanted = args.filter((a) => !a.startsWith("--"));
const unknown = wanted.filter((w) => !SUITES.some(([k]) => k === w));
if (unknown.length) throw new Error(`unknown suite(s): ${unknown.join(", ")} (choose from ${SUITES.map(([k]) => k).join(", ")})`);
const selected = SUITES.filter(([k]) => wanted.length === 0 || wanted.includes(k));

const WORKDIR = process.env.QUOTES_E2E_SUPABASE_WORKDIR;
if (!noReset && (!WORKDIR || !existsSync(path.join(WORKDIR, "supabase", "config.toml")))) {
  throw new Error("QUOTES_E2E_SUPABASE_WORKDIR must point at the isolated stack's project directory (containing supabase/config.toml) so each suite starts from a fresh reset; or pass --no-reset");
}
const latestMigration = readdirSync(path.join(REPO_ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().at(-1).split("_")[0];

async function freshReset() {
  // the CLI sometimes keeps running after the reset completes; the database state is what is verified
  spawnSync("supabase", ["db", "reset", "--local"], { cwd: WORKDIR, stdio: "ignore", timeout: 240_000, killSignal: "SIGKILL" });
  // the reset restarts the auth container; when the CLI is cut short the API gateway (Kong) can keep routing to the
  // old auth address (sign-in then fails with 502 / "doesn't match our records"). Restart THIS stack's Kong and wait
  // until auth answers through it. Only the isolated stack's own container is touched.
  const kong = DB.replace(/^supabase_db_/, "supabase_kong_");
  spawnSync("docker", ["restart", kong], { stdio: "ignore", timeout: 60_000 });
  const port = (spawnSync("docker", ["port", kong, "8000"], { encoding: "utf8" }).stdout ?? "").match(/:(\d+)\s*$/m)?.[1];
  let authOk = false;
  for (let i = 0; port && !authOk && i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/auth/v1/health`);
      authOk = res.status < 500; // 200 / 401 = auth reachable through the gateway; 502 = stale upstream
    } catch {}
    if (!authOk) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!authOk) throw new Error(`auth is not reachable through ${kong} after the reset`);
  const state = sql(`select (select max(version) from supabase_migrations.schema_migrations) || '/' || (select count(*) from plus_quotes) || '/' || (select count(*) from plus_contacts)`);
  if (state !== `${latestMigration}/0/0`) throw new Error(`reset not verified fresh: ${state} (expected ${latestMigration}/0/0)`);
  return state;
}

console.log(`Estimates & Quotes isolated regression -- app ${APP}, database ${DB}, ${noReset ? "NO reset" : `fresh reset in ${WORKDIR}`}${strict ? ", STRICT" : ""}`);
const results = [];
for (const [key, file, expected] of selected) {
  let fresh = "not reset";
  if (!noReset) fresh = await freshReset();
  assertFictionalSeed();
  const run = spawnSync(process.execPath, [path.join(HERE, file)], { env: process.env, encoding: "utf8", timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  writeFileSync(path.join(artifactDir(key), "run.log"), out);
  const passes = out.split("\n").filter((l) => l.startsWith("PASS")).length;
  const failLines = out.split("\n").filter((l) => l.startsWith("FAIL"));
  const knownHit = key === "s4-a11y" ? failLines.filter((l) => KNOWN_A11Y_FAILURES.some((k) => l.startsWith(`FAIL — ${k}`))) : [];
  const unexpected = failLines.filter((l) => !knownHit.includes(l));
  let verdict;
  if (failLines.length === 0 && run.status === 0) verdict = key === "s4-a11y" ? "PASS (U1 / U2 RESOLVED)" : "PASS";
  else if (unexpected.length === 0 && knownHit.length > 0) {
    verdict = strict ? "FAIL (known U1 / U2 defects -- UI-overhaul gate)" : "KNOWN DEFECTS ONLY (U1 / U2; accepted, overhaul-mandatory)";
    // a known check passing WITHOUT a fix means the fixtures no longer exercise it (or a partial fix): make it visible
    if (knownHit.length < KNOWN_A11Y_FAILURES.length) verdict += ` -- REVIEW: only ${knownHit.length} of ${KNOWN_A11Y_FAILURES.length} known checks failed (partial fix or lost coverage)`;
  }
  else verdict = "FAIL (unexpected)";
  results.push({ key, passes, fails: failLines.length, expected, verdict, unexpected, fresh });
  console.log(`${key.padEnd(14)} pass=${String(passes).padStart(3)} fail=${failLines.length}  (S4 baseline: ${expected} checks)  ${verdict}`);
  for (const l of unexpected.slice(0, 10)) console.log(`    ${l.slice(0, 220)}`);
}
const bad = results.filter((r) => r.verdict.startsWith("FAIL"));
console.log(`\n${bad.length === 0 ? "RESULT: no unexpected failures" : `RESULT: ${bad.length} suite(s) failed`}${results.some((r) => r.verdict.startsWith("KNOWN")) ? " -- known U1 / U2 accessibility defects remain (mandatory for the UI overhaul)" : ""}`);
console.log(`logs and artifacts: ${ARTIFACTS_ROOT}`);
process.exit(bad.length === 0 ? 0 : 1);
