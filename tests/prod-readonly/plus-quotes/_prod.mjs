// Nemryn Plus -- shared guards for the PRODUCTION READ-ONLY Estimates & Quotes verification scripts.
//
// These scripts are NEVER run automatically (no npm script, no CI). An operator runs them by hand, only with the
// owner's authorization for a read-only verification. They:
//   - talk to the database ONLY through `supabase db query --linked`, and q() refuses anything but one SELECT / WITH;
//   - refuse to start unless QUOTES_PROD_READONLY_ACK=read-only is set and the linked project is the expected one;
//   - read the synthetic SIM identities from the git-ignored .env.sim.local (values are never printed);
//   - write screenshots / PDFs only OUTSIDE the repository.
// See tests/e2e/plus-quotes/README.md ("Production read-only verification").
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newChromeSession } from "../../shared/cdp.mjs";

export { sleep, pdfText } from "../../shared/cdp.mjs";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** Production app and the Pilot Simulation tenant (fictional synthetic records only). */
export const APP = "https://app.nemryn.com";
export const ORG = "25e3a19b-c8b5-45d2-943e-f20baf697cc5";
const EXPECTED_PROJECT_REF = process.env.QUOTES_PROD_PROJECT_REF || "wyocbivzgrbekuyqdfts";

if (process.env.QUOTES_PROD_READONLY_ACK !== "read-only") {
  throw new Error("refusing: production read-only verification needs explicit owner authorization; set QUOTES_PROD_READONLY_ACK=read-only to confirm");
}
const linkedRef = (() => {
  try {
    return readFileSync(path.join(REPO_ROOT, "supabase/.temp/project-ref"), "utf8").trim();
  } catch {
    return "";
  }
})();
if (linkedRef !== EXPECTED_PROJECT_REF) throw new Error(`refusing: the Supabase CLI is linked to '${linkedRef || "nothing"}', expected ${EXPECTED_PROJECT_REF}`);

const WRITE_WORDS = /\b(insert|update|delete|merge|upsert|alter|drop|create|truncate|grant|revoke|comment|call|do|copy|vacuum|refresh|reindex|cluster|lock|set|reset|begin|commit|rollback|savepoint|prepare|execute|listen|notify)\b/i;
/** ONE read-only statement against the linked production database; anything else is refused before it is sent. */
export function q(sql) {
  const body = sql.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(body)) throw new Error("read-only: only SELECT / WITH statements are allowed");
  // screen the statement text with string literals blanked out (a ';' or keyword inside quotes is data, not SQL)
  const code = body.replace(/'(?:[^']|'')*'/g, "''");
  if (code.includes(";")) throw new Error("read-only: a single statement only");
  // identifiers such as updated_at / do_not_contact don't match the \b...\b keywords
  const hit = code.match(WRITE_WORDS)?.[0];
  if (hit) throw new Error(`read-only: refused statement containing '${hit}'`);
  const d = JSON.parse(execFileSync("supabase", ["db", "query", "--linked", "-o", "json", body], { cwd: REPO_ROOT, timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }).toString());
  return d.rows ?? d;
}
export const one = (sql) => {
  const r = q(sql)[0];
  return r ? Object.values(r)[0] : null;
};

/** SIM identities from the git-ignored env file. Refuses a tracked / non-ignored file. Values are never logged. */
export function simEnv() {
  const file = path.resolve(process.env.QUOTES_SIM_ENV_FILE || path.join(REPO_ROOT, ".env.sim.local"));
  try {
    execFileSync("git", ["check-ignore", "-q", file], { cwd: REPO_ROOT, stdio: "ignore" });
  } catch {
    throw new Error(`refusing: ${path.basename(file)} is not git-ignored; SIM credentials must live in an ignored local file`);
  }
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

/** Evidence directory OUTSIDE the repository. */
export const OUT_ROOT = path.resolve(process.env.QUOTES_PROD_ARTIFACTS_DIR || path.join(os.tmpdir(), "nemryn-plus-quotes-prod-readonly"));
if (OUT_ROOT === REPO_ROOT || OUT_ROOT.startsWith(REPO_ROOT + path.sep)) throw new Error("refusing QUOTES_PROD_ARTIFACTS_DIR inside the repository");
export function outDir(name) {
  const dir = path.join(OUT_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Headless Chrome session with a throw-away profile under the evidence directory. */
export function chromeSession(suffix = "") {
  const chromePath = process.env.QUOTES_E2E_CHROME_PATH || process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return newChromeSession({ chromePath, profileRoot: OUT_ROOT, suffix });
}
