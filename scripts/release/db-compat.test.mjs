// NP-RELEASE-01 -- release gate tests (simulated production states only; no network, no production access).
//   node --test scripts/release/db-compat.test.mjs        (npm run test:release)
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyChanges, compareMigrations, evaluate, formatReport, validateProductionState, vercelIgnoreExit, VERDICT, EXIT } from "./db-compat-core.mjs";
import { collectProductionState, main, repoMigrationPaths, REPO_ROOT, SUPABASE_CLI_ARGS, CONFIG } from "./check-db-compat.mjs";

const REF = CONFIG.expectedProjectRef;
const EXPECTED = { projectRef: REF, projectName: CONFIG.expectedProjectName };
const PATHS = repoMigrationPaths();
const ALL = PATHS.map((p) => { const m = /(\d{14})_([a-z0-9_]+)\.sql$/.exec(p); return { version: m[1], name: m[2] }; });
const state = (migrations, over = {}) => validateProductionState({ projectRef: REF, projectName: "Nemryn", source: "simulated", migrations, ...over }, EXPECTED);
const APP_CHANGE = ["src/app/operations/growth/contacts/[contactId]/page.tsx"];
const tmp = mkdtempSync(path.join(os.tmpdir(), "nemryn-release-gate-"));
const stateFile = (obj) => { const f = path.join(tmp, `s-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify(obj)); return f; };

test("baseline: the repository has 93 conforming, ordered migrations", () => {
  assert.equal(ALL.length, 93);
  assert.equal(ALL.at(-1).version, "20261023100000");
});

test("T1 application change, production compatible -> PASS (exit 0)", () => {
  const r = evaluate({ mode: "pr", repoMigrationPaths: PATHS, changedFiles: APP_CHANGE, production: state(ALL) });
  assert.equal(r.verdict, VERDICT.PASS); assert.equal(r.exitCode, 0);
  assert.equal(evaluate({ mode: "deploy", repoMigrationPaths: PATHS, production: state(ALL) }).verdict, VERDICT.PASS);
});

test("T2 application change, one required migration missing -> BLOCKED, names the version", () => {
  const r = evaluate({ mode: "pr", repoMigrationPaths: PATHS, changedFiles: APP_CHANGE, production: state(ALL.slice(0, -1)) });
  assert.equal(r.verdict, VERDICT.BLOCKED); assert.equal(r.exitCode, 1);
  assert.match(r.reasons.join(" "), /20261023100000_plus_communication_consents/);
});

test("INCIDENT REPLAY NP-P2-S6C1: S6-B merge commit fa949eb against production as it was (92 migrations) -> BLOCKED", () => {
  let paths;
  try { paths = execFileSync("git", ["ls-tree", "--name-only", "fa949eb", "supabase/migrations/"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n").filter(Boolean); }
  catch { return; } // commit not available in a shallow clone: the T2 case covers the same rule
  const s6bChange = ["src/components/growth/ConsentPreferences.tsx", "src/lib/plus/consents.ts", "src/app/operations/growth/contacts/actions.ts"];
  const r = evaluate({ mode: "pr", repoMigrationPaths: paths, changedFiles: s6bChange, production: state(ALL.slice(0, 92)) });
  assert.equal(r.verdict, VERDICT.BLOCKED);
  assert.equal(evaluate({ mode: "deploy", repoMigrationPaths: paths, production: state(ALL.slice(0, 92)) }).verdict, VERDICT.BLOCKED);
});

test("T3 several required migrations missing -> BLOCKED, lists all", () => {
  const r = evaluate({ mode: "deploy", repoMigrationPaths: PATHS, production: state(ALL.slice(0, -3)) });
  assert.equal(r.verdict, VERDICT.BLOCKED);
  assert.match(r.reasons.join(" "), /3 required migration\(s\)/);
});

test("T4 migration-only PR awaiting the owner-run release -> PASS as DATABASE-FIRST (never applies anything)", () => {
  const r = evaluate({ mode: "pr", repoMigrationPaths: PATHS, changedFiles: ["supabase/migrations/20261023100000_plus_communication_consents.sql", "docs/x.md"], production: state(ALL.slice(0, -1)) });
  assert.equal(r.verdict, VERDICT.PASS);
  assert.match(r.notices.join(" "), /DATABASE-FIRST: 1 migration\(s\) awaiting the owner-run production release: 20261023100000/);
  // ... and the production build of that commit is SKIPPED until the owner releases the migration
  assert.equal(evaluate({ mode: "deploy", repoMigrationPaths: PATHS, production: state(ALL.slice(0, -1)) }).verdict, VERDICT.BLOCKED);
  // ... the migration-only PR still blocks on drift
  assert.equal(evaluate({ mode: "pr", repoMigrationPaths: PATHS, changedFiles: ["supabase/migrations/20261023100000_plus_communication_consents.sql"], production: state([...ALL, { version: "20261030100000", name: "unknown" }]) }).verdict, VERDICT.BLOCKED);
});

test("T5 documentation-only PR -> PASS even with pending migrations or an unreachable production", () => {
  assert.equal(evaluate({ mode: "pr", repoMigrationPaths: PATHS, changedFiles: ["docs/reports/a.txt", "README.md"], production: state(ALL.slice(0, -2)) }).verdict, VERDICT.PASS);
  assert.equal(evaluate({ mode: "pr", repoMigrationPaths: PATHS, changedFiles: ["docs/a.md", "supabase/tests/x.sql", "tests/e2e/y.mjs"], production: { ok: false, errors: ["unreachable"] } }).verdict, VERDICT.PASS);
  // classification is conservative: anything unknown is APPLICATION
  assert.equal(classifyChanges(["package.json"]).kind, "application");
  assert.equal(classifyChanges(["next.config.ts"]).kind, "application");
  assert.equal(classifyChanges([".github/workflows/x.yml"]).kind, "application");
  assert.equal(classifyChanges(["scripts/release/check-db-compat.mjs"]).kind, "application");
  assert.equal(classifyChanges(["supabase/migrations/README"]).kind, "application");
  assert.equal(classifyChanges(["supabase/seed.sql"]).kind, "application");
});

test("T6 production status unavailable -> application release UNVERIFIABLE (exit 2, never compatible)", () => {
  const r = evaluate({ mode: "pr", repoMigrationPaths: PATHS, changedFiles: APP_CHANGE, production: { ok: false, errors: ["management API returned HTTP 503"] } });
  assert.equal(r.verdict, VERDICT.UNVERIFIABLE); assert.equal(r.exitCode, 2);
  assert.equal(evaluate({ mode: "deploy", repoMigrationPaths: PATHS, production: undefined }).verdict, VERDICT.UNVERIFIABLE);
});

test("T7 wrong Supabase project (ref or name) -> not compatible", () => {
  const wrongRef = validateProductionState({ projectRef: "xqgzfpxlnqfcavgijsne", projectName: "chelth-Project", source: "x", migrations: ALL }, EXPECTED);
  assert.equal(wrongRef.ok, false); assert.match(wrongRef.errors.join(" "), /WRONG PROJECT/);
  const wrongName = validateProductionState({ projectRef: REF, projectName: "ZenWard", source: "x", migrations: ALL }, EXPECTED);
  assert.equal(wrongName.ok, false);
  assert.equal(evaluate({ mode: "deploy", repoMigrationPaths: PATHS, production: wrongRef }).verdict, VERDICT.UNVERIFIABLE);
});

test("T8 unexpected remote-only migration -> BLOCKED with DRIFT", () => {
  const r = evaluate({ mode: "deploy", repoMigrationPaths: PATHS, production: state([...ALL, { version: "20261024090000", name: "hotfix_in_dashboard" }]) });
  assert.equal(r.verdict, VERDICT.BLOCKED); assert.match(r.reasons.join(" "), /DRIFT: production has 1 migration\(s\) not in the repository: 20261024090000/);
  // the same version recorded under a different name is drift too
  const renamed = ALL.map((m) => (m.version === "20261021100000" ? { ...m, name: "something_else" } : m));
  assert.match(evaluate({ mode: "deploy", repoMigrationPaths: PATHS, production: state(renamed) }).reasons.join(" "), /same version, different name/);
});

test("T9 missing historical migration (older than the production head) -> BLOCKED with DRIFT", () => {
  const holes = ALL.filter((m) => m.version !== "20261014100000");
  const r = evaluate({ mode: "deploy", repoMigrationPaths: PATHS, production: state(holes) });
  assert.equal(r.verdict, VERDICT.BLOCKED); assert.match(r.reasons.join(" "), /older than the production head .* never applied: 20261014100000/);
  // a deleted repository migration that IS applied in production is remote-only drift
  assert.equal(evaluate({ mode: "deploy", repoMigrationPaths: PATHS.filter((p) => !p.includes("20261014100000")), production: state(ALL) }).verdict, VERDICT.BLOCKED);
});

test("T10 malformed migration responses -> not compatible", () => {
  for (const bad of [null, [], "x", { projectRef: REF, source: "x" }, { projectRef: REF, source: "x", migrations: "93" }, { projectRef: REF, source: "x", migrations: [] },
    { projectRef: REF, source: "x", migrations: [{ version: "2026-10-23" }] }, { projectRef: REF, source: "x", migrations: [{ version: 20261023100000 }] },
    { projectRef: REF, source: "x", migrations: [{ version: "20261023100000" }, { version: "20261023100000" }] }, { projectRef: REF, source: "x", migrations: [{ version: "20261023100000", name: "Bad Name;drop" }] },
    { projectRef: REF, migrations: ALL }]) {
    assert.equal(validateProductionState(bad, EXPECTED).ok, false, JSON.stringify(bad)?.slice(0, 80));
  }
  // non-conforming repository file names / duplicates block too
  assert.equal(evaluate({ mode: "deploy", repoMigrationPaths: [...PATHS, "supabase/migrations/patch.sql"], production: state(ALL) }).verdict, VERDICT.BLOCKED);
});

test("T11 race: a PR check passed, then a dependency became missing before deploy -> the deploy-time check catches it", () => {
  const prCheck = evaluate({ mode: "pr", repoMigrationPaths: PATHS, changedFiles: APP_CHANGE, production: state(ALL) });
  assert.equal(prCheck.verdict, VERDICT.PASS);
  // meanwhile a migration-only PR merged into main ahead of the deploy (the candidate now contains a new migration)
  const candidate = [...PATHS, "supabase/migrations/20261101100000_plus_inquiries.sql"];
  assert.equal(evaluate({ mode: "deploy", repoMigrationPaths: candidate, production: state(ALL) }).verdict, VERDICT.BLOCKED);
  // or production changed underneath (unexpected history) between check and deploy
  assert.equal(evaluate({ mode: "deploy", repoMigrationPaths: PATHS, production: state([...ALL, { version: "20261024000000", name: "x" }]) }).verdict, VERDICT.BLOCKED);
});

test("T12 missing credentials -> fail closed; a failing request never leaks the token", async () => {
  const none = await collectProductionState({ source: "management-api", env: {} });
  assert.equal(none.ok, false); assert.match(none.errors[0], /SUPABASE_ACCESS_TOKEN is not set/);
  const secret = "sbp_" + "x".repeat(40);
  const leakyFetch = async () => { throw new Error(`connect ECONNREFUSED while sending ${secret}`); };
  const r = await collectProductionState({ source: "management-api", env: { SUPABASE_ACCESS_TOKEN: secret }, fetchImpl: leakyFetch });
  assert.equal(r.ok, false); assert.ok(!r.errors.join(" ").includes(secret)); assert.match(r.errors.join(" "), /\[redacted\]/);
  const http401 = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const r2 = await collectProductionState({ source: "management-api", env: { SUPABASE_ACCESS_TOKEN: secret }, fetchImpl: http401 });
  assert.equal(r2.ok, false); assert.match(r2.errors[0], /HTTP 401/); assert.ok(!r2.errors[0].includes(REF), "the URL path is reported with {ref}");
  const report = formatReport(evaluate({ mode: "deploy", repoMigrationPaths: PATHS, production: r }));
  assert.ok(!report.includes(secret));
});

test("management-api transport: read-only GETs only, validated response, project identity checked", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization.startsWith("Bearer ") });
    if (url.endsWith(`/v1/projects/${REF}`)) return { ok: true, status: 200, json: async () => ({ ref: REF, name: "Nemryn" }) };
    if (url.endsWith(`/v1/projects/${REF}/database/migrations`)) return { ok: true, status: 200, json: async () => ALL };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const r = await collectProductionState({ source: "management-api", env: { SUPABASE_ACCESS_TOKEN: "t" }, fetchImpl: fakeFetch });
  assert.equal(r.ok, true); assert.equal(r.state.migrations.length, 93);
  assert.deepEqual(calls.map((c) => c.method), ["GET", "GET"]);
  assert.ok(calls.every((c) => c.url.startsWith("https://api.supabase.com/v1/projects/") && !/query|push|reset|repair/.test(c.url)));
  const wrong = async (url) => (url.endsWith(REF) ? { ok: true, status: 200, json: async () => ({ ref: REF, name: "chelth-Project" }) } : { ok: true, status: 200, json: async () => ALL });
  assert.equal((await collectProductionState({ source: "management-api", env: { SUPABASE_ACCESS_TOKEN: "t" }, fetchImpl: wrong })).ok, false);
});

test("T13 preview policy: preview / development builds proceed; unknown environments never proceed", () => {
  assert.equal(vercelIgnoreExit({ vercelEnv: "preview", verdict: VERDICT.UNVERIFIABLE }), 1);
  assert.equal(vercelIgnoreExit({ vercelEnv: "development", verdict: VERDICT.BLOCKED }), 1);
  assert.equal(vercelIgnoreExit({ vercelEnv: "preview", verdict: VERDICT.BLOCKED, previewPolicy: "gate" }), 0);
  assert.equal(vercelIgnoreExit({ vercelEnv: undefined, verdict: VERDICT.PASS }), 0);
  assert.equal(vercelIgnoreExit({ vercelEnv: "staging", verdict: VERDICT.PASS }), 0);
});

test("T14 Vercel exit codes: production proceeds (1) ONLY on PASS; BLOCKED / UNVERIFIABLE / crash skip (0)", () => {
  assert.equal(vercelIgnoreExit({ vercelEnv: "production", verdict: VERDICT.PASS }), 1);
  assert.equal(vercelIgnoreExit({ vercelEnv: "production", verdict: VERDICT.BLOCKED }), 0);
  assert.equal(vercelIgnoreExit({ vercelEnv: "production", verdict: VERDICT.UNVERIFIABLE }), 0);
  // the real wrapper script, end to end (state supplied through the test-only state file; never available on Vercel)
  const run = (env) => spawnSync("bash", ["scripts/release/vercel-ignore-build.sh"], { cwd: REPO_ROOT, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
  const ok = run({ VERCEL_ENV: "production", NEMRYN_RELEASE_SOURCE: "state-file", NEMRYN_RELEASE_STATE_FILE: stateFile({ projectRef: REF, projectName: "Nemryn", source: "sim", migrations: ALL }) });
  assert.equal(ok.status, 1, ok.stdout); assert.match(ok.stdout, /VERCEL_BUILD_DECISION=BUILD/);
  const missing = run({ VERCEL_ENV: "production", NEMRYN_RELEASE_SOURCE: "state-file", NEMRYN_RELEASE_STATE_FILE: stateFile({ projectRef: REF, projectName: "Nemryn", source: "sim", migrations: ALL.slice(0, -1) }) });
  assert.equal(missing.status, 0, missing.stdout); assert.match(missing.stdout, /VERCEL_BUILD_DECISION=SKIP/);
  const noCreds = run({ VERCEL_ENV: "production" });
  assert.equal(noCreds.status, 0); assert.match(noCreds.stdout, /SUPABASE_ACCESS_TOKEN is not set/);
  const onVercelWithStateFile = run({ VERCEL: "1", VERCEL_ENV: "production", NEMRYN_RELEASE_SOURCE: "state-file", NEMRYN_RELEASE_STATE_FILE: stateFile({ projectRef: REF, projectName: "Nemryn", source: "sim", migrations: ALL }) });
  assert.equal(onVercelWithStateFile.status, 0, "the test-only state file can never authorise a real Vercel build");
  // bash present but NO node binary on PATH (node lives in /usr/local/bin here): the wrapper must skip, never build
  const noNode = spawnSync("/bin/bash", ["scripts/release/vercel-ignore-build.sh"], { cwd: REPO_ROOT, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME, VERCEL_ENV: "production" } });
  assert.equal(spawnSync("/bin/bash", ["-c", "command -v node"], { env: { PATH: "/usr/bin:/bin" } }).status, 1, "precondition: node is not on this PATH");
  assert.equal(noNode.status, 0, `node missing -> skip, never build (${noNode.stdout})`);
  assert.match(noNode.stdout, /build SKIPPED/);
  const preview = run({ VERCEL_ENV: "preview" });
  assert.equal(preview.status, 1);
  const unknownEnv = run({ NEMRYN_RELEASE_SOURCE: "state-file", NEMRYN_RELEASE_STATE_FILE: stateFile({ projectRef: REF, projectName: "Nemryn", source: "sim", migrations: ALL }) });
  assert.equal(unknownEnv.status, 0, "VERCEL_ENV unset -> skip");
});

test("T15 the checker cannot mutate: fixed read-only CLI argv; no write commands anywhere in the gate code", async () => {
  assert.deepEqual([...SUPABASE_CLI_ARGS], ["migration", "list", "--linked"]);
  let captured = null;
  const fakeSpawn = (cmd, args) => { captured = [cmd, ...args]; return { status: 0, stdout: JSON.stringify({ migrations: ALL.map((m) => ({ local: m.version, remote: m.version })) }) }; };
  const r = await collectProductionState({ source: "supabase-cli", spawn: fakeSpawn });
  assert.deepEqual(captured, ["supabase", "migration", "list", "--linked"]);
  assert.equal(r.ok, true);
  for (const f of ["db-compat-core.mjs", "check-db-compat.mjs", "vercel-ignore-build.sh"]) {
    const src = readFileSync(path.join(REPO_ROOT, "scripts/release", f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|#)/.test(l)).join("\n");
    assert.doesNotMatch(src, /["'](push|reset|repair|query|up|dump)["']|db push|db reset|migration repair|migration up|\bPOST\b|\bPATCH\b|\bDELETE\b|\bPUT\b/, f);
  }
});

test("CLI end to end (PR mode, simulated state, injected change set): exit codes 0 / 1 / 2", async () => {
  const lines = [];
  const log = (s) => lines.push(s);
  const sf = stateFile({ projectRef: REF, projectName: "Nemryn", source: "sim", migrations: ALL });
  assert.equal(await main(["--mode", "pr", "--base", "abcdef1", "--source", "state-file", "--state-file", sf], {}, { log, changedFiles: () => ({ ok: true, files: APP_CHANGE }) }), EXIT.PASS);
  const sf2 = stateFile({ projectRef: REF, projectName: "Nemryn", source: "sim", migrations: ALL.slice(0, -1) });
  assert.equal(await main(["--mode", "pr", "--base", "abcdef1", "--source", "state-file", "--state-file", sf2], {}, { log, changedFiles: () => ({ ok: true, files: APP_CHANGE }) }), EXIT.BLOCKED);
  assert.equal(await main(["--mode", "pr", "--base", "abcdef1", "--source", "management-api"], {}, { log, changedFiles: () => ({ ok: true, files: APP_CHANGE }) }), EXIT.UNVERIFIABLE);
  // unknown change set (git failure) is treated as an application change
  assert.equal(await main(["--mode", "pr", "--base", "abcdef1", "--source", "management-api"], {}, { log, changedFiles: () => ({ ok: false, error: "git diff failed" }) }), EXIT.UNVERIFIABLE);
  assert.equal(await main(["--mode", "pr", "--base", "abcdef1", "--source", "management-api"], {}, { log, changedFiles: () => ({ ok: true, files: ["docs/a.md"] }) }), EXIT.PASS);
});

test("comparison details", () => {
  const c = compareMigrations(ALL, ALL.slice(0, -1));
  assert.equal(c.prodHead, "20261021100000"); assert.equal(c.pendingNew.length, 1); assert.equal(c.missingHistorical.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// NP-RELEASE-01A security regression tests
// ---------------------------------------------------------------------------------------------------------------------
import { sanitizeForLog } from "./db-compat-core.mjs";
import { candidateMigrationPaths, changedFiles } from "./check-db-compat.mjs";
import { chmodSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

test("01A identity: the project must match by `ref`; an `id`-only response is never accepted as the project", async () => {
  const idOnly = async (url) => (url.endsWith(REF) ? { ok: true, status: 200, json: async () => ({ id: REF, name: "Nemryn" }) } : { ok: true, status: 200, json: async () => ALL });
  const r = await collectProductionState({ source: "management-api", env: { SUPABASE_ACCESS_TOKEN: "t" }, fetchImpl: idOnly });
  assert.equal(r.ok, false);
  const wrongRef = async (url) => (url.endsWith(REF) ? { ok: true, status: 200, json: async () => ({ ref: "abcdefghijklmnopqrst", name: "Nemryn" }) } : { ok: true, status: 200, json: async () => ALL });
  assert.match((await collectProductionState({ source: "management-api", env: { SUPABASE_ACCESS_TOKEN: "t" }, fetchImpl: wrongRef })).errors.join(" "), /WRONG PROJECT/);
  const forbidden = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const f = await collectProductionState({ source: "management-api", env: { SUPABASE_ACCESS_TOKEN: "t" }, fetchImpl: forbidden });
  assert.equal(f.ok, false); assert.match(f.errors[0], /HTTP 403/, "a token lacking a permission fails closed");
});

test("01A candidate-as-data: the PR head is read from git objects (real S6-B commit), never from the working tree", async () => {
  let full;
  try { full = execFileSync("git", ["rev-parse", "fa949eb"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return; }
  const base = execFileSync("git", ["rev-parse", "6af7924"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const c = candidateMigrationPaths(full);
  assert.equal(c.ok, true); assert.equal(c.paths.length, 93);
  const log = () => {};
  const sf92 = stateFile({ projectRef: REF, projectName: "Nemryn", source: "sim", migrations: ALL.slice(0, 92) });
  assert.equal(await main(["--mode", "pr", "--base", base, "--candidate", full, "--source", "state-file", "--state-file", sf92], {}, { log }), EXIT.BLOCKED, "S6-B against 92 -> BLOCKED");
  const sf93 = stateFile({ projectRef: REF, projectName: "Nemryn", source: "sim", migrations: ALL });
  assert.equal(await main(["--mode", "pr", "--base", base, "--candidate", full, "--source", "state-file", "--state-file", sf93], {}, { log }), EXIT.PASS);
  assert.equal(await main(["--mode", "pr", "--base", base, "--candidate", "fa949eb", "--source", "state-file", "--state-file", sf93], {}, { log }), EXIT.UNVERIFIABLE, "short / malformed SHA refused");
  assert.equal(candidateMigrationPaths("0".repeat(40)).ok, false, "unknown commit fails closed");
});

test("01A log injection: untrusted file names cannot start a workflow-command line", () => {
  const evil = "supabase/migrations/x\n::set-env name=NODE_OPTIONS::--require=/tmp/pwn\r::add-mask::y.sql";
  const r = evaluate({ mode: "pr", repoMigrationPaths: [...PATHS, evil], changedFiles: [evil], production: state(ALL) });
  assert.equal(r.verdict, VERDICT.BLOCKED);
  const report = formatReport(r);
  for (const line of report.split("\n")) assert.ok(!line.startsWith("::") && !line.includes("::set-env") && !line.includes("::add-mask"), line);
  assert.equal(sanitizeForLog("a b\u0007c::d"), "a?b?c: :d");
});

test("01A NUL-separated git output: a file name containing a newline stays ONE entry", () => {
  const fakeGit = () => ({ status: 0, stdout: "docs/a b.md\0src/x\ny.ts\0" });
  const c = changedFiles("abcdef1", "abcdef2", { git: fakeGit });
  assert.deepEqual(c.files, ["docs/a b.md", "src/x\ny.ts"]);
  assert.equal(classifyChanges(c.files).kind, "application");
});

function fakeNodeDir(script) {
  const d = mkdtempSync(path.join(os.tmpdir(), "nemryn-fake-node-"));
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, "node"), `#!/bin/bash\n${script}\n`);
  chmodSync(path.join(d, "node"), 0o755);
  return d;
}
const wrapperWith = (dir, extraEnv = {}) => spawnSync("/bin/bash", ["scripts/release/vercel-ignore-build.sh"], { cwd: "/", encoding: "utf8", env: { PATH: `${dir}:/usr/bin:/bin`, VERCEL_ENV: "production", ...extraEnv } });

test("01A wrapper fail-closed: only an exact BUILD line with exit 0 builds; crashes / near-misses skip (run from another cwd)", () => {
  const wrapper = path.join(REPO_ROOT, "scripts/release/vercel-ignore-build.sh");
  const run = (dir) => spawnSync("/bin/bash", [wrapper], { cwd: "/", encoding: "utf8", env: { PATH: `${dir}:/usr/bin:/bin`, VERCEL_ENV: "production" } });
  assert.equal(run(fakeNodeDir('echo "VERCEL_BUILD_DECISION=BUILD"; exit 0')).status, 1, "exact BUILD + exit 0 -> build (also proves the script finds the repo from any cwd)");
  assert.equal(run(fakeNodeDir('echo "VERCEL_BUILD_DECISION=BUILD"; exit 3')).status, 0, "BUILD printed but checker failed -> skip");
  assert.equal(run(fakeNodeDir('echo "VERCEL_BUILD_DECISION=BUILD "; exit 0')).status, 0, "near-miss line -> skip");
  assert.equal(run(fakeNodeDir('echo "xVERCEL_BUILD_DECISION=BUILD"; exit 0')).status, 0);
  assert.equal(run(fakeNodeDir("kill -SEGV $$")).status, 0, "checker crash by signal -> skip");
  assert.equal(run(fakeNodeDir("exit 1")).status, 0);
  void wrapperWith;
});

test("01A wrapper fail-closed: a TERM (e.g. a timeout) during the check ends with 0 (skip), not 143", async () => {
  const wrapper = path.join(REPO_ROOT, "scripts/release/vercel-ignore-build.sh");
  const dir = fakeNodeDir("sleep 5; echo VERCEL_BUILD_DECISION=BUILD");
  const child = spawn("/bin/bash", [wrapper], { cwd: "/", env: { PATH: `${dir}:/usr/bin:/bin`, VERCEL_ENV: "production" }, detached: true, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 700));
  process.kill(-child.pid, "SIGTERM");
  const code = await new Promise((r) => child.on("exit", (c, sig) => r(c ?? sig)));
  assert.equal(code, 0);
});

test("01A workflows: trusted check never executes PR code; secret only for same-repo PRs; untrusted tests have no secrets; actions pinned", () => {
  const trusted = readFileSync(path.join(REPO_ROOT, ".github/workflows/release-db-compat.yml"), "utf8");
  const untrusted = readFileSync(path.join(REPO_ROOT, ".github/workflows/release-gate-tests.yml"), "utf8");
  const code = (s) => s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const t = code(trusted), u = code(untrusted);
  assert.match(t, /^on:\n  pull_request_target:/m);
  assert.doesNotMatch(t, /^\s+pull_request:\s*$/m);
  assert.match(t, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/, "checks out the base commit");
  assert.doesNotMatch(t, /ref: \$\{\{ github\.event\.pull_request\.head/, "never checks out the PR head");
  assert.doesNotMatch(t, /\bnpm\b|\bnpx\b|node --test|yarn|pnpm|bash scripts\/|\.\/scripts\//, "no install / test / PR script execution");
  assert.match(t, /--candidate "\$HEAD_SHA"/, "PR head passed as data");
  const secretRefs = t.match(/secrets\.[A-Z_]+/g) ?? [];
  assert.deepEqual(secretRefs, ["secrets.NEMRYN_RELEASE_SUPABASE_TOKEN"]);
  assert.match(t, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository && secrets\.NEMRYN_RELEASE_SUPABASE_TOKEN \|\| ''/, "forks get no token");
  assert.match(t, /permissions:\n  contents: read\n  statuses: write\n/);
  assert.doesNotMatch(t, /\$\{\{ github\.event\.pull_request\.(title|body|head\.ref|head\.label)/, "no untrusted strings interpolated");
  assert.match(t, /::stop-commands::/);
  assert.match(u, /^on:\n  pull_request:/m);
  assert.doesNotMatch(u, /secrets\./, "untrusted test workflow has no secrets");
  assert.match(u, /permissions:\n  contents: read\n/);
  const usesLines = [...t.matchAll(/^\s*(?:- )?uses: ([^\s]+)/gm), ...u.matchAll(/^\s*(?:- )?uses: ([^\s]+)/gm)].map((m) => m[1]);
  assert.equal(usesLines.length, 4, "checkout + setup-node in each workflow");
  for (const uses of usesLines) assert.match(uses, /@[0-9a-f]{40}$/, uses);
});
