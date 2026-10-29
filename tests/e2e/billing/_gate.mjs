// NP-FIN-P1G -- financial-write gate fixtures for the E2E suites (FICTIONAL seed only). Billing writes are denied by
// default, so a suite that writes billing records enables its fictional organizations through the platform-admin RPC
// (the same audited path production uses) and removes the enablement in its replica-mode cleanup.
const PLATFORM_ADMIN = "20000000-0000-0000-0000-0000000000d1"; // fictional seed platform admin

const list = (orgs) => orgs.map((o) => `'${o}'`).join(", ");

/** SQL for a cleanup batch that already runs with session_replication_role = replica (rows are otherwise kept). */
export const gateCleanupSql = (orgs) => `
    delete from billing_write_enablement_history where organization_id in (${list(orgs)});
    delete from billing_write_enablements where organization_id in (${list(orgs)});`;

/** Enable financial writes for fictional organizations as SYNTHETIC (never live) through the platform RPC. */
export const gateEnableSql = (orgs, reason) =>
  `begin; set local role authenticated; set local request.jwt.claim.sub = '${PLATFORM_ADMIN}';
   ${orgs.map((o) => `select (public.platform_set_billing_write_enablement('${o}', 'enabled', 'synthetic', null, '${reason.replace(/'/g, "''")}', 0)).status;`).join("\n   ")}
   commit;`;

/** Disable a fictional organization (expects its current version). */
export const gateDisableSql = (org, version, reason) =>
  `begin; set local role authenticated; set local request.jwt.claim.sub = '${PLATFORM_ADMIN}';
   select (public.platform_set_billing_write_enablement('${org}', 'disabled', 'synthetic', null, '${reason.replace(/'/g, "''")}', ${version})).status;
   commit;`;
