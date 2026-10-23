// NP-RELEASE-01 -- production deployment dependency gate: PURE core (no I/O, no network, no child processes).
//
// Decides whether a candidate release is compatible with the VERIFIED production migration state. Root cause it
// prevents: NP-P2-S6C1 -- the S6-B UI was merged and auto-deployed by Vercel before migration 20261023100000 existed in
// production, so the Communication preferences panel failed at runtime.
//
// Rules (docs/reports/NP-RELEASE-01-deployment-gate-implementation.txt):
//   - A migration file in Git is NEVER evidence that it is applied; only the production history counts.
//   - Unknown, unreachable, malformed or wrong-project state is NEVER compatible (fail closed).
//   - Drift always blocks: a version applied in production but absent from the repository (remote-only), the same
//     version recorded under a different name, or a repository migration OLDER than the production head that was never
//     applied (missing historical / out of order).
//   - PR mode: documentation / test-only changes pass without verification; migration-only changes pass as
//     DATABASE-FIRST (they are applied later by the owner-run release, never by this tool); any application change
//     requires every repository migration to be applied in production.
//   - Deploy mode (the production build): allowed only when every repository migration is applied and there is no
//     drift. Version comparison is not a schema-content proof -- see SCHEMA_CONTENT_LIMITATION.

export const VERDICT = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", UNVERIFIABLE: "UNVERIFIABLE" });
/** Deterministic process exit codes for the CLI: PASS 0, BLOCKED 1, UNVERIFIABLE 2 (both non-zero = not allowed). */
export const EXIT = Object.freeze({ PASS: 0, BLOCKED: 1, UNVERIFIABLE: 2 });

export const SCHEMA_CONTENT_LIMITATION =
  "Version comparison proves which migrations were RECORDED as applied, not that the installed schema matches their contents. Verify schema contents separately (privilege contract + catalog fingerprint) after every migration release.";

const MIGRATION_FILE_RE = /^supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql$/;
const VERSION_RE = /^\d{14}$/;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;

/**
 * Change classes. Anything not explicitly docs / tests / migrations is APPLICATION (conservative default): source,
 * public assets, package / lock files, framework config, middleware, scripts, workflows, other supabase files.
 */
export function classifyPath(file) {
  const f = String(file).replace(/^\.\//, "");
  if (MIGRATION_FILE_RE.test(f)) return "migration";
  if (f.startsWith("supabase/migrations/")) return "application"; // a non-conforming file in the migrations folder is never "docs"
  if (f.startsWith("docs/") || /^[^/]+\.md$/.test(f)) return "docs";
  if (f.startsWith("tests/") || f.startsWith("supabase/tests/") || /\.test\.mjs$/.test(f)) return "tests";
  return "application";
}

export function classifyChanges(files) {
  const out = { migration: [], docs: [], tests: [], application: [] };
  for (const f of files ?? []) out[classifyPath(f)].push(String(f));
  const kind = out.application.length > 0 ? "application" : out.migration.length > 0 ? "migration-only" : "docs-or-tests-only";
  return { kind, ...out };
}

/** Repository migrations from a list of paths under supabase/migrations: [{version, name}], strictly ordered. */
export function parseRepoMigrations(paths) {
  const errors = [];
  const list = [];
  for (const p of paths) {
    const m = MIGRATION_FILE_RE.exec(p);
    if (!m) { errors.push(`non-conforming migration file name: ${p}`); continue; }
    list.push({ version: m[1], name: m[2] });
  }
  list.sort((a, b) => a.version.localeCompare(b.version));
  for (let i = 1; i < list.length; i++) if (list[i].version === list[i - 1].version) errors.push(`duplicate repository migration version ${list[i].version}`);
  return { migrations: list, errors };
}

/**
 * Validates a production state document. Shape (from any transport):
 *   { projectRef: string, projectName?: string, source: string, migrations: [{ version: string, name?: string|null }] }
 * Returns { ok, state, errors }. Anything unexpected is an error (fail closed).
 */
export function validateProductionState(raw, expected) {
  const errors = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["production state is not an object"] };
  const { projectRef, projectName, migrations, source } = raw;
  if (typeof projectRef !== "string" || !PROJECT_REF_RE.test(projectRef)) errors.push("production state has no valid project ref");
  else if (projectRef !== expected.projectRef) errors.push(`WRONG PROJECT: production state is for ${projectRef}, expected ${expected.projectRef}`);
  if (expected.projectName && projectName !== undefined && projectName !== null && projectName !== expected.projectName) {
    errors.push(`WRONG PROJECT: project name "${projectName}" does not match the expected "${expected.projectName}"`);
  }
  if (typeof source !== "string" || !source) errors.push("production state has no source");
  if (!Array.isArray(migrations)) errors.push("production migration list is missing or not an array");
  const seen = new Set();
  const clean = [];
  if (Array.isArray(migrations)) {
    if (migrations.length === 0) errors.push("production migration list is empty (never treated as a fresh database)");
    for (const m of migrations) {
      if (m === null || typeof m !== "object" || typeof m.version !== "string" || !VERSION_RE.test(m.version)) { errors.push("malformed production migration entry"); continue; }
      if (m.name !== undefined && m.name !== null && (typeof m.name !== "string" || !/^[a-z0-9_]+$/.test(m.name))) { errors.push(`malformed production migration name for ${m.version}`); continue; }
      if (seen.has(m.version)) { errors.push(`duplicate production migration version ${m.version}`); continue; }
      seen.add(m.version);
      clean.push({ version: m.version, name: m.name ?? null });
    }
  }
  clean.sort((a, b) => a.version.localeCompare(b.version));
  return errors.length ? { ok: false, errors } : { ok: true, state: { projectRef, projectName: projectName ?? null, source, migrations: clean }, errors: [] };
}

/** Compares repository migrations with the validated production state. */
export function compareMigrations(repo, prod) {
  const prodByVersion = new Map(prod.map((m) => [m.version, m]));
  const repoByVersion = new Map(repo.map((m) => [m.version, m]));
  const prodHead = prod.length ? prod[prod.length - 1].version : null;
  const missing = repo.filter((m) => !prodByVersion.has(m.version));
  const remoteOnly = prod.filter((m) => !repoByVersion.has(m.version));
  const nameMismatch = repo
    .filter((m) => prodByVersion.has(m.version) && prodByVersion.get(m.version).name !== null && prodByVersion.get(m.version).name !== m.name)
    .map((m) => ({ version: m.version, repo: m.name, production: prodByVersion.get(m.version).name }));
  const missingHistorical = prodHead ? missing.filter((m) => m.version < prodHead) : [];
  const pendingNew = prodHead ? missing.filter((m) => m.version > prodHead) : missing;
  return { prodHead, repoHead: repo.length ? repo[repo.length - 1].version : null, missing, pendingNew, missingHistorical, remoteOnly, nameMismatch };
}

function driftReasons(cmp) {
  const r = [];
  if (cmp.remoteOnly.length) r.push(`DRIFT: production has ${cmp.remoteOnly.length} migration(s) not in the repository: ${cmp.remoteOnly.map((m) => m.version).join(", ")}`);
  if (cmp.nameMismatch.length) r.push(`DRIFT: same version, different name: ${cmp.nameMismatch.map((m) => `${m.version} (repo ${m.repo} / production ${m.production})`).join(", ")}`);
  if (cmp.missingHistorical.length) r.push(`DRIFT: repository migration(s) older than the production head (${cmp.prodHead}) were never applied: ${cmp.missingHistorical.map((m) => m.version).join(", ")}`);
  return r;
}

/**
 * The decision.
 * @param {object} input
 *   mode: "pr" | "deploy"
 *   repoMigrationPaths: string[]          -- the candidate commit's supabase/migrations/*.sql paths
 *   changedFiles?: string[]               -- PR mode: files changed between base and head
 *   production: { ok, state?, errors }    -- the result of validateProductionState, or { ok:false, errors } when unavailable
 * @returns {{ verdict, exitCode, reasons: string[], notices: string[], summary: object }}
 */
export function evaluate(input) {
  const reasons = [];
  const notices = [];
  const repo = parseRepoMigrations(input.repoMigrationPaths ?? []);
  if (input.mode !== "pr" && input.mode !== "deploy") return result(VERDICT.UNVERIFIABLE, [`unknown mode ${input.mode}`], notices, {});
  if (repo.errors.length) return result(VERDICT.BLOCKED, repo.errors, notices, {});
  const changes = input.mode === "pr" ? classifyChanges(input.changedFiles) : null;
  const summary = { mode: input.mode, change: changes?.kind ?? "full-release", repoMigrations: repo.migrations.length };

  // PR without application changes: never blocked for pending migrations.
  if (changes && changes.kind !== "application") {
    if (!input.production?.ok) {
      notices.push(`production migration state not verified (${(input.production?.errors ?? ["unavailable"]).join("; ")}) -- not required for a ${changes.kind} change`);
      if (changes.kind === "migration-only") notices.push("DATABASE-FIRST: these migrations must be applied by the owner-run release (preflight, backup, dry run, push, verification) BEFORE any application change that depends on them is merged.");
      return result(VERDICT.PASS, [], notices, summary);
    }
    const cmp = compareMigrations(repo.migrations, input.production.state.migrations);
    Object.assign(summary, { productionMigrations: input.production.state.migrations.length, productionHead: cmp.prodHead, pending: cmp.pendingNew.map((m) => m.version) });
    const drift = driftReasons(cmp);
    if (drift.length) return result(VERDICT.BLOCKED, drift, notices, summary);
    if (changes.kind === "migration-only") {
      notices.push(`DATABASE-FIRST: ${cmp.pendingNew.length} migration(s) awaiting the owner-run production release: ${cmp.pendingNew.map((m) => m.version).join(", ") || "none"}. This check never applies migrations.`);
    } else if (cmp.pendingNew.length) {
      notices.push(`documentation / test-only change; ${cmp.pendingNew.length} migration(s) still pending in production: ${cmp.pendingNew.map((m) => m.version).join(", ")}`);
    }
    return result(VERDICT.PASS, [], notices, summary);
  }

  // Application change (PR) or full production release (deploy): verification is REQUIRED.
  if (!input.production?.ok) {
    return result(VERDICT.UNVERIFIABLE, [`production migration state could not be verified: ${(input.production?.errors ?? ["unavailable"]).join("; ")}`], notices, summary);
  }
  const cmp = compareMigrations(repo.migrations, input.production.state.migrations);
  Object.assign(summary, { productionMigrations: input.production.state.migrations.length, productionHead: cmp.prodHead, repoHead: cmp.repoHead });
  reasons.push(...driftReasons(cmp));
  if (cmp.pendingNew.length) {
    reasons.push(`${cmp.pendingNew.length} required migration(s) are NOT applied in production: ${cmp.pendingNew.map((m) => `${m.version}_${m.name}`).join(", ")}. Release them first (database-first), then re-run this check.`);
  }
  if (input.mode === "pr" && changes.migration.length) {
    notices.push("this PR mixes application and migration changes: the migrations must be applied in production before it can pass (or split it into a migration-only PR first)");
  }
  notices.push(SCHEMA_CONTENT_LIMITATION);
  return result(reasons.length ? VERDICT.BLOCKED : VERDICT.PASS, reasons, notices, summary);
}

function result(verdict, reasons, notices, summary) {
  return { verdict, exitCode: EXIT[verdict], reasons, notices, summary };
}

/**
 * NP-RELEASE-01A: untrusted text (e.g. a PR's file names) must never be able to start a new log line -- a line
 * beginning with "::" is a GitHub Actions workflow command. Control characters (incl. CR / LF) are replaced, "::" is
 * broken up, and the length is capped.
 */
export function sanitizeForLog(text, max = 300) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "?").replace(/::/g, ": :").slice(0, max);
}

/** Human-readable report. Contains no secrets: only versions, counts and the (public) project ref. */
export function formatReport(r) {
  const lines = [`NEMRYN RELEASE GATE -- ${r.verdict}`, `summary: ${sanitizeForLog(JSON.stringify(r.summary), 1000)}`];
  for (const x of r.reasons) lines.push(`reason: ${sanitizeForLog(x, 1000)}`);
  for (const x of r.notices) lines.push(`notice: ${sanitizeForLog(x, 1000)}`);
  return lines.join("\n");
}

/**
 * Vercel "Ignored Build Step" mapping. Vercel semantics: exit 0 = SKIP (ignore) the build, exit 1 = PROCEED.
 * Fail closed: ONLY an explicit production PASS proceeds; everything else (BLOCKED, UNVERIFIABLE, errors) skips.
 * Preview builds follow the preview policy (default: proceed -- previews are not production releases).
 */
export function vercelIgnoreExit({ vercelEnv, verdict, previewPolicy = "build" }) {
  if (vercelEnv === "preview" || vercelEnv === "development") return previewPolicy === "build" ? 1 : verdict === VERDICT.PASS ? 1 : 0;
  if (vercelEnv !== "production") return 0; // unknown environment: never proceed silently
  return verdict === VERDICT.PASS ? 1 : 0;
}
