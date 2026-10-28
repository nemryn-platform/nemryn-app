// NP-PILOT-P2 -- isolation guard for the pilot demo kit. FAILS CLOSED: unless every check proves the target is the
// disposable local NemrynS1Iso stack seeded with FICTIONAL data, it refuses before any database statement runs.
// Same checks as supabase/tests/billing_concurrency_test.sh, plus loopback / project-config / remote-URL checks.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const EXPECTED_PROJECT = "NemrynS1Iso";
export const EXPECTED_CONTAINER = `supabase_db_${EXPECTED_PROJECT}`;
/** The fictional seed fingerprint: both seed organizations, the seed admin, and NOT the production Pilot Simulation org. */
export const FINGERPRINT_SQL = `select (select count(*) from public.organizations where id in ('10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000b1'))
  || '/' || (select count(*) from auth.users where email = 'org-a-admin@example.test')
  || '/' || (select count(*) from public.organizations where id = '25e3a19b-c8b5-45d2-943e-f20baf697cc5')`;
/**
 * Prepended to EVERY statement batch the demo sends (same psql session, ON_ERROR_STOP): the database re-proves it is
 * the fictional seed before anything else runs -- so the billing-ledger trigger bypass in `reset` can never execute
 * against any other database, even if the outer checks were somehow satisfied.
 */
export const IN_SESSION_GUARD = `do $guard$ begin
  if (${FINGERPRINT_SQL}) <> '2/1/0' or current_database() <> 'postgres' or inet_server_addr() is not null then
    raise exception 'demo isolation guard: not the fictional local isolated database -- refusing';
  end if;
end $guard$;
`;
const URL_VARS = ["DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_PRISMA_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "PGHOST"];

export class IsolationRefused extends Error {}
const refuse = (msg) => { throw new IsolationRefused(msg); };

export function isLoopbackTarget(value) {
  let host = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try { host = new URL(host).hostname; } catch { return false; }
  }
  host = host.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function run(cmd, args) {
  try { return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).toString().trim(); }
  catch { return null; }
}

function tcpReachable(host, port, ms = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(ms, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Throws IsolationRefused unless the environment is PROVEN to be the local isolated stack. Returns the evidence. */
export async function proveIsolatedStack(env = process.env) {
  for (const k of URL_VARS) {
    if (env[k] && !isLoopbackTarget(env[k])) refuse(`${k} points to a non-local destination`);
  }
  if ((env.QUOTES_E2E_DB_CONTAINER ?? EXPECTED_CONTAINER) !== EXPECTED_CONTAINER) refuse(`QUOTES_E2E_DB_CONTAINER is not ${EXPECTED_CONTAINER}`);
  if (env.QUOTES_E2E_ALLOW_OTHER_LOCAL_STACK) refuse("QUOTES_E2E_ALLOW_OTHER_LOCAL_STACK is set: the demo never runs against another stack");
  if (env.DOCKER_HOST) refuse(`DOCKER_HOST is set ('${env.DOCKER_HOST}'): only the local Docker socket is allowed`);
  const context = run("docker", ["context", "show"]);
  const endpoint = context && run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}", context]);
  if (!endpoint || !endpoint.startsWith("unix://")) refuse(`Docker endpoint '${endpoint ?? "unknown"}' is not a local unix socket`);
  const label = run("docker", ["inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}|{{.State.Running}}', EXPECTED_CONTAINER]);
  if (label !== `${EXPECTED_PROJECT}|true`) refuse(`${EXPECTED_CONTAINER} is not a running Supabase CLI container of project ${EXPECTED_PROJECT} ('${label ?? "missing"}')`);
  const ports = run("docker", ["inspect", "--format", '{{json (index .NetworkSettings.Ports "5432/tcp")}}', EXPECTED_CONTAINER]);
  let hostPort = null;
  try {
    const bindings = JSON.parse(ports ?? "null") ?? [];
    if (!bindings.length || !bindings.every((b) => ["0.0.0.0", "127.0.0.1", "::", "::1", ""].includes(b.HostIp))) refuse("the database port is not published on this machine only");
    hostPort = Number(bindings[0].HostPort);
  } catch (e) { if (e instanceof IsolationRefused) throw e; refuse("the database port binding could not be read"); }
  const dir = env.NEMRYN_ISOLATED_DIR || path.join(os.homedir(), EXPECTED_PROJECT);
  const configPath = path.join(dir, "supabase", "config.toml");
  if (!existsSync(configPath)) refuse(`isolated project config not found (${configPath})`);
  const config = readFileSync(configPath, "utf8");
  if (!new RegExp(`^project_id = "${EXPECTED_PROJECT}"$`, "m").test(config)) refuse(`${configPath} is not project ${EXPECTED_PROJECT}`);
  const dbPort = Number((config.match(/^\[db\][\s\S]*?^port = (\d+)/m) ?? [])[1]);
  if (!dbPort || dbPort !== hostPort) refuse(`config db port ${dbPort || "?"} does not match the container's published port ${hostPort}`);
  if (!(await tcpReachable("127.0.0.1", hostPort))) refuse(`no database answers on loopback 127.0.0.1:${hostPort}`);
  const fp = run("docker", ["exec", EXPECTED_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", FINGERPRINT_SQL]);
  if (fp !== "2/1/0") refuse(`the database does not carry the fictional seed fingerprint (got '${fp ?? "no answer"}', expected 2/1/0)`);
  return { project: EXPECTED_PROJECT, container: EXPECTED_CONTAINER, loopbackPort: hostPort, fingerprint: fp };
}

/** Destructive modes need the operator to name the isolated project explicitly. */
export function requireConfirmation(argv) {
  if (!argv.includes(`--confirm-isolated=${EXPECTED_PROJECT}`)) {
    refuse(`destructive demo operations need --confirm-isolated=${EXPECTED_PROJECT}`);
  }
}
