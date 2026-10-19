// Nemryn Plus -- Estimates & Quotes isolated browser regression suites: shared configuration and safety guards.
//
// These suites run ONLY against a local, isolated Supabase stack seeded with the repository's FICTIONAL seed data
// (supabase/seed.sql) and a local `next start`. Every value is configurable through environment variables; nothing
// machine-specific is hard-coded. See tests/e2e/plus-quotes/README.md.
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** The local app under test. Must be http on localhost / 127.0.0.1 -- never a deployed host. */
export const APP = process.env.QUOTES_E2E_APP_URL || "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(APP)) {
  throw new Error(`refusing to run the isolated quote suites against ${APP}: QUOTES_E2E_APP_URL must be http://localhost:<port>`);
}

/**
 * The local Postgres container of the isolated stack. Restricted to the NemrynS1Iso project by default; another
 * LOCAL stack needs an explicit opt-in. Production is never reachable this way (docker exec only reaches local containers).
 */
export const DB = process.env.QUOTES_E2E_DB_CONTAINER || "supabase_db_NemrynS1Iso";
if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(DB)) throw new Error(`refusing DB container ${DB}: not a local Supabase database container name`);
if (DB !== "supabase_db_NemrynS1Iso" && process.env.QUOTES_E2E_ALLOW_OTHER_LOCAL_STACK !== "1") {
  throw new Error(`refusing DB container ${DB}: the quote suites are restricted to supabase_db_NemrynS1Iso (set QUOTES_E2E_ALLOW_OTHER_LOCAL_STACK=1 for another LOCAL isolated stack)`);
}

/** Where screenshots, PDFs and findings are written: OUTSIDE the repository (never tracked). */
export const ARTIFACTS_ROOT = path.resolve(process.env.QUOTES_E2E_ARTIFACTS_DIR || path.join(os.tmpdir(), "nemryn-plus-quotes-e2e"));
if (ARTIFACTS_ROOT === REPO_ROOT || ARTIFACTS_ROOT.startsWith(REPO_ROOT + path.sep)) {
  throw new Error(`refusing QUOTES_E2E_ARTIFACTS_DIR inside the repository (${ARTIFACTS_ROOT}): test artifacts must stay outside tracked sources`);
}
export function artifactDir(suite) {
  const dir = path.join(ARTIFACTS_ROOT, suite) + path.sep;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Chrome / Chromium binary for the CDP harness (headless). */
export const CHROME_PATH = process.env.QUOTES_E2E_CHROME_PATH || process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** The FICTIONAL local seed password from supabase/seed.sql (local-only identities; not a secret). */
export const SEED_PASSWORD = "local-test-only-fictional-pw";

/** psql in the isolated container (stdin; ON_ERROR_STOP). */
export const sql = (q) => execSync(`docker exec -i ${DB} psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1`, { input: q, timeout: 120_000 }).toString().trim();

/**
 * Fail fast unless the target database is the fictional seed: the seed organizations and @example.test identities
 * exist, and the production Pilot Simulation organization does NOT.
 */
export function assertFictionalSeed() {
  const fp = sql(`select (select count(*) from organizations where id in ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000b1'))
    || '/' || (select count(*) from auth.users where email = 'org-a-admin@example.test')
    || '/' || (select count(*) from organizations where id = '25e3a19b-c8b5-45d2-943e-f20baf697cc5')`);
  if (fp !== "2/1/0") throw new Error(`refusing to run: ${DB} does not look like the fictional seed database (fingerprint ${fp}, expected 2/1/0)`);
}
