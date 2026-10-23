#!/usr/bin/env node
// NP-RELEASE-01 -- production deployment dependency gate: CLI.
//
//   node scripts/release/check-db-compat.mjs --mode pr --base <sha> [--head <sha>] --source management-api
//   node scripts/release/check-db-compat.mjs --mode deploy --source supabase-cli          (owner, local)
//   node scripts/release/check-db-compat.mjs --mode deploy --vercel                       (Vercel Ignored Build Step;
//                                                                                          use vercel-ignore-build.sh)
//
// READ-ONLY by construction. Transports:
//   management-api  GET https://api.supabase.com/v1/projects/{ref} and .../database/migrations (no SQL, no writes)
//   supabase-cli    `supabase migration list --linked` only (the exact argument vector is fixed below)
//   state-file      a JSON production-state document (tests / simulations; refused on Vercel)
// It never runs db push / reset / repair / query. It never prints the access token.
// Exit codes: 0 PASS, 1 BLOCKED, 2 UNVERIFIABLE. With --vercel it always exits 0 after printing a decision line
// "VERCEL_BUILD_DECISION=BUILD|SKIP"; the wrapper treats anything else (crash, missing line) as SKIP.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, formatReport, validateProductionState, vercelIgnoreExit, VERDICT } from "./db-compat-core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../..");
export const CONFIG = JSON.parse(readFileSync(path.join(HERE, "release-config.json"), "utf8"));
/** The ONLY Supabase CLI invocation this tool may make. */
export const SUPABASE_CLI_ARGS = Object.freeze(["migration", "list", "--linked"]);

export function repoMigrationPaths(root = REPO_ROOT) {
  const dir = path.join(root, "supabase", "migrations");
  return readdirSync(dir).filter((f) => !f.startsWith(".")).sort().map((f) => `supabase/migrations/${f}`);
}

const SHA_RE = /^[0-9a-f]{40}$/i;

export function changedFiles(base, head, { git = spawnSync, root = REPO_ROOT } = {}) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(base ?? "")) || !/^[0-9a-f]{7,40}$|^HEAD$/i.test(String(head ?? ""))) return { ok: false, error: "invalid --base / --head" };
  // -z: NUL-separated, so a file name containing a newline cannot split into two entries
  const r = git("git", ["diff", "-z", "--name-only", `${base}...${head}`], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return { ok: false, error: "git diff failed (is the base commit fetched?)" };
  return { ok: true, files: r.stdout.split("\0").filter(Boolean) };
}

/**
 * NP-RELEASE-01A: the candidate commit's migration file names read from the git object database as DATA (no checkout,
 * nothing from the candidate is executed). Used by the trusted pull_request_target workflow.
 */
export function candidateMigrationPaths(sha, { git = spawnSync, root = REPO_ROOT } = {}) {
  if (!SHA_RE.test(String(sha ?? ""))) return { ok: false, error: "invalid --candidate (a full 40-character commit SHA is required)" };
  const r = git("git", ["ls-tree", "-z", "--name-only", sha, "--", "supabase/migrations/"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return { ok: false, error: "git ls-tree failed for the candidate commit (is it fetched?)" };
  return { ok: true, paths: r.stdout.split("\0").filter(Boolean).sort() };
}

const sanitize = (msg, secret) => (secret ? String(msg).split(secret).join("[redacted]") : String(msg));

/** Collects the production state through ONE read-only transport. Never throws; returns validateProductionState(). */
export async function collectProductionState({ source, stateFile, env = process.env, fetchImpl = globalThis.fetch, spawn = spawnSync, root = REPO_ROOT, config = CONFIG } = {}) {
  const expected = { projectRef: config.expectedProjectRef, projectName: config.expectedProjectName };
  try {
    if (source === "state-file") {
      if (env.VERCEL === "1") return { ok: false, errors: ["the state-file source is refused on Vercel"] };
      if (!stateFile || !existsSync(stateFile)) return { ok: false, errors: ["state file missing"] };
      let raw;
      try { raw = JSON.parse(readFileSync(stateFile, "utf8")); } catch { return { ok: false, errors: ["state file is not valid JSON"] }; }
      return validateProductionState(raw, expected);
    }
    if (source === "supabase-cli") {
      const refFile = path.join(root, "supabase", ".temp", "project-ref");
      const linkedRef = existsSync(refFile) ? readFileSync(refFile, "utf8").trim() : null;
      const r = spawn("supabase", [...SUPABASE_CLI_ARGS], { cwd: root, encoding: "utf8", timeout: 120_000 });
      if (r.status !== 0 || typeof r.stdout !== "string") return { ok: false, errors: ["supabase migration list failed (login / link?)"] };
      const line = r.stdout.split("\n").find((l) => l.trim().startsWith("{"));
      let parsed;
      try { parsed = JSON.parse(line ?? ""); } catch { return { ok: false, errors: ["supabase migration list returned no parseable JSON"] }; }
      if (!parsed || !Array.isArray(parsed.migrations)) return { ok: false, errors: ["supabase migration list JSON has no migrations array"] };
      const remote = parsed.migrations.filter((m) => m && m.remote).map((m) => ({ version: String(m.remote), name: null }));
      return validateProductionState({ projectRef: linkedRef, source: "supabase-cli", migrations: remote }, expected);
    }
    if (source === "management-api") {
      const token = env.SUPABASE_ACCESS_TOKEN;
      if (!token) return { ok: false, errors: ["SUPABASE_ACCESS_TOKEN is not set (fail closed)"] };
      const ref = config.expectedProjectRef;
      const base = config.managementApiBase;
      const get = async (p) => {
        const res = await fetchImpl(`${base}${p}`, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`management API ${p.replace(ref, "{ref}")} returned HTTP ${res.status}`);
        return res.json();
      };
      const project = await get(`/v1/projects/${ref}`);
      const migrations = await get(`/v1/projects/${ref}/database/migrations`);
      if (!Array.isArray(migrations)) return { ok: false, errors: ["management API migrations response is not an array"] };
      // identity: the project's `ref` must match exactly (`id` is a different identifier and is never used as a ref)
      return validateProductionState({
        projectRef: typeof project?.ref === "string" ? project.ref : null,
        projectName: project?.name ?? null,
        source: "management-api",
        migrations: migrations.map((m) => ({ version: m?.version, name: m?.name ?? null })),
      }, expected);
    }
    return { ok: false, errors: [`unknown source ${source}`] };
  } catch (e) {
    return { ok: false, errors: [sanitize(e?.message ?? e, env.SUPABASE_ACCESS_TOKEN)] };
  }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--vercel" || k === "--json") a[k.slice(2)] = true;
    else if (k.startsWith("--")) a[k.slice(2)] = argv[++i];
  }
  return a;
}

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = parseArgs(argv);
  const out = deps.log ?? ((s) => process.stdout.write(s + "\n"));
  if (args.vercel) {
    // Vercel Ignored Build Step. Preview policy: build previews without a database dependency check.
    const vercelEnv = env.VERCEL_ENV;
    if (vercelEnv === "preview" || vercelEnv === "development") {
      out(`NEMRYN RELEASE GATE -- ${vercelEnv} build (preview policy: build; no production database dependency check)`);
      out(`VERCEL_BUILD_DECISION=${vercelIgnoreExit({ vercelEnv, verdict: VERDICT.UNVERIFIABLE, previewPolicy: CONFIG.previewPolicy }) === 1 ? "BUILD" : "SKIP"}`);
      return 0;
    }
    const production = await collectProductionState({ source: env.NEMRYN_RELEASE_SOURCE || "management-api", stateFile: env.NEMRYN_RELEASE_STATE_FILE, env, ...deps });
    const r = evaluate({ mode: "deploy", repoMigrationPaths: repoMigrationPaths(deps.root), production });
    out(formatReport(r));
    out(`VERCEL_BUILD_DECISION=${vercelIgnoreExit({ vercelEnv, verdict: r.verdict }) === 1 ? "BUILD" : "SKIP"}`);
    return 0;
  }
  const mode = args.mode;
  let changes = null;
  // --candidate <sha>: inspect a commit as DATA (trusted workflow); otherwise the working tree is the candidate
  let migrationPaths;
  if (args.candidate !== undefined) {
    const c = (deps.candidateMigrationPaths ?? candidateMigrationPaths)(args.candidate);
    if (!c.ok) { out(`NEMRYN RELEASE GATE -- UNVERIFIABLE\nreason: ${c.error}`); return 2; }
    migrationPaths = c.paths;
  } else {
    migrationPaths = repoMigrationPaths(deps.root);
  }
  if (mode === "pr") {
    const c = (deps.changedFiles ?? changedFiles)(args.base, args.candidate ?? args.head ?? "HEAD");
    // Unknown change set -> treated as an application change (verification required).
    changes = c.ok ? c.files : ["<unknown change set>"];
    if (!c.ok) out(`notice: ${c.error}; treating the change as an application change`);
  }
  const production = await collectProductionState({ source: args.source, stateFile: args["state-file"], env, ...deps });
  const r = evaluate({ mode, repoMigrationPaths: migrationPaths, changedFiles: changes ?? undefined, production });
  out(args.json ? JSON.stringify(r) : formatReport(r));
  return r.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), () => { process.stdout.write("NEMRYN RELEASE GATE -- UNVERIFIABLE (internal error)\n"); process.exit(2); });
}
