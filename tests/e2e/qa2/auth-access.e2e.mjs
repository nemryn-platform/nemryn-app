// NP-UI-QA2 auth-access -- sign-in (bad + good credentials) and sign-out, workspace selection + switching, role
// permissions (Dispatcher / Driver / signed out), the driver invitation flow end to end (invite -> /join -> account ->
// driver app), new-business sign-up + onboarding, error / not-found states, and a per-route heading + axe sweep of every
// Core and Growth screen (one named check per route). ISOLATED stack + fictional seed only.
import { suite, ORG_A, ORG_B, STAMP, sql, one, sleep, waitFor, go, path, text, has, h1s, click, setField, dialogOpen, axe, overflowX } from "./_qa2.mjs";

const t = suite("auth-access");

try {
  sql(`delete from organization_modules where organization_id='${ORG_A}'; insert into organization_modules (organization_id, module, status, status_reason) values ('${ORG_A}','plus','active','QA2 auth suite')`);

  t.section("sign-in / sign-out");
  const s = await t.open("anon", null);
  await go(s, "/sign-in");
  await setField(s, 'input[name="email"]', "org-a-admin@example.test");
  await setField(s, 'input[name="password"]', "definitely-not-the-password");
  await s.evaluate(`document.querySelector('button[type="submit"]').click()`);
  await sleep(2500);
  t.check("A1 a wrong password keeps the person on sign-in with an error message (no session)", (await path(s)).startsWith("/sign-in") && (await has(s, '[role="alert"]')), await path(s));
  await go(s, "/sign-in");
  await setField(s, 'input[name="email"]', "org-a-admin@example.test");
  await setField(s, 'input[name="password"]', "local-test-only-fictional-pw");
  await s.evaluate(`document.querySelector('button[type="submit"]').click()`);
  await waitFor(async () => (await path(s)).startsWith("/operations"), 20000);
  t.check("A2 correct credentials sign in to Operations", (await path(s)).startsWith("/operations"), await path(s));
  await s.evaluate(`document.querySelector('button[aria-haspopup="menu"][aria-label^="Account menu"]').click()`);
  await sleep(400);
  await s.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e => /sign out/i.test(e.textContent)).click()`);
  await waitFor(async () => (await path(s)).startsWith("/sign-in"), 15000);
  await go(s, "/operations/trips");
  t.check("A3 Sign Out ends the session: a protected route sends you to sign-in again", (await path(s)).startsWith("/sign-in"), await path(s));
  await go(s, "/driver");
  t.check("A4 signed out, the driver app also requires sign-in", (await path(s)).startsWith("/sign-in"), await path(s));

  t.section("workspace selection + switching");
  const multi = await t.open("multi", "multi-org-user@example.test");
  await go(multi, "/select-organization");
  const tx = await text(multi);
  t.check("W1 a person with two workspaces gets the workspace picker listing both", tx.includes("Fictional Org A") && tx.includes("Fictional Org B"));
  await multi.evaluate(`document.querySelector('input[name="organizationId"][value="${ORG_A}"]')?.form.requestSubmit()`);
  await waitFor(async () => (await path(multi)).startsWith("/operations"), 15000);
  t.check("W2 choosing Org A (Organization Admin there) enters Operations in Org A", (await path(multi)).startsWith("/operations") && (await text(multi)).includes("Fictional Org A"), await path(multi));
  await go(multi, "/select-organization?switch=1");
  await multi.evaluate(`document.querySelector('input[name="organizationId"][value="${ORG_B}"]')?.form.requestSubmit()`);
  await waitFor(async () => /^\/(driver|operations)/.test(await path(multi)), 20000);
  t.check("W3 switching to Org B (a Driver there) lands in the driver app, not Operations (role is per workspace)", (await path(multi)).startsWith("/driver"), await path(multi));
  await t.close(multi);

  t.section("role permissions");
  const disp = await t.open("dispatcher", "org-a-dispatcher@example.test");
  await go(disp, "/operations/settings/team");
  t.check("R1 a Dispatcher cannot open workspace Settings (server-side refusal)", !(await path(disp)).startsWith("/operations/settings"), await path(disp));
  await go(disp, "/operations/trips");
  t.check("R2 …but can work in Trips", (await path(disp)).startsWith("/operations/trips") && (await h1s(disp)).length === 1);
  const drv = await t.open("driver", "org-a-driver-a@example.test");
  await go(drv, "/operations");
  t.check("R3 a Driver opening Operations is sent to the driver app", (await path(drv)).startsWith("/driver"), await path(drv));
  await t.close(drv);
  await t.close(disp);

  t.section("driver invitation: invite -> /join -> account -> driver app");
  const admin = await t.open("admin", "org-a-admin@example.test");
  await go(admin, "/operations/drivers");
  await click(admin, "Invite Driver", "main", "button");
  await waitFor(() => dialogOpen(admin), 5000);
  const EMAIL = `qa2-join-${STAMP}@example.test`;
  await setField(admin, 'input[name="displayName"]', `QA2 Joiner ${STAMP}`, "dialog");
  await setField(admin, 'input[name="email"]', EMAIL, "dialog");
  await click(admin, "Send Invite", "dialog", "button");
  await waitFor(() => one(`select count(*) from driver_invites where email='${EMAIL}'`) === "1", 15000);
  const TOKEN = one(`select token from driver_invites where email='${EMAIL}'`);
  const join = await t.open("joiner", null);
  await go(join, `/join/${TOKEN}`);
  t.check("J1 the invite link names the workspace being joined (Nemryn frame + tenant context)", (await h1s(join)).join() === "Join Fictional Org A", JSON.stringify(await h1s(join)));
  await setField(join, 'input[name="fullName"]', `QA2 Joiner ${STAMP}`);
  await setField(join, 'input[name="password"]', "qa2-fictional-pw-123");
  await join.evaluate(`[...document.querySelectorAll('button[type="submit"]')].find(b => /Create account/.test(b.textContent))?.click()`);
  await waitFor(async () => (await path(join)).startsWith("/driver"), 25000);
  t.check("J2 creating the account accepts the invite: a linked active Driver in Org A, the invite marked accepted, the person lands in the driver app",
    (await path(join)).startsWith("/driver") && one(`select i.status||'|'||d.status from driver_invites i join drivers d on d.user_id=i.accepted_by and d.organization_id=i.organization_id where i.email='${EMAIL}'`) === "accepted|active", await path(join));
  await go(join, `/join/${TOKEN}`);
  t.check("J3 the used invite link cannot be accepted again", !(await has(join, 'input[name="password"]')));
  await t.close(join);
  const anon2 = await t.open("anon2", null);
  await go(anon2, `/join/${"0".repeat(64)}`);
  t.check("J4 an unknown invite token shows 'Invite not found'", (await h1s(anon2)).join() === "Invite not found", JSON.stringify(await h1s(anon2)));

  t.section("new business sign-up + onboarding");
  const OWNER = `qa2-owner-${STAMP}@example.test`;
  await go(anon2, "/sign-up");
  await setField(anon2, 'input[name="fullName"]', `QA2 Owner ${STAMP}`);
  await setField(anon2, 'input[name="email"]', OWNER);
  await setField(anon2, 'input[name="password"]', "qa2-fictional-pw-123");
  await setField(anon2, 'input[name="businessName"]', `QA2 Transport ${STAMP}`);
  await anon2.evaluate(`[...document.querySelectorAll('button[type="submit"]')].find(b => /Create account/.test(b.textContent))?.click()`);
  await waitFor(async () => (await path(anon2)).startsWith("/onboarding/basics"), 25000);
  const NEWORG = one(`select o.id from organizations o join memberships m on m.organization_id=o.id join auth.users u on u.id=m.user_id where u.email='${OWNER}' and m.role='organization_admin'`);
  t.check("O1 sign-up creates the account, its workspace and an Organization Admin membership, then starts onboarding", !!NEWORG && (await path(anon2)).startsWith("/onboarding/basics"), await path(anon2));
  await setField(anon2, 'select[name="timezone"]', "America/Chicago");
  await anon2.evaluate(`[...document.querySelectorAll('button[type="submit"]')].find(b => /Continue/.test(b.textContent))?.click()`);
  await waitFor(async () => (await path(anon2)).startsWith("/onboarding/vehicle"), 20000);
  t.check("O2 Business basics saves the timezone and moves on to the vehicle step", one(`select timezone from organizations where id='${NEWORG}'`) === "America/Chicago" && (await path(anon2)).startsWith("/onboarding/vehicle"), await path(anon2));
  await go(anon2, "/operations");
  t.check("O3 the new workspace's Operations Brief opens in its fresh 'Finish setting up' state (isolated from Org A data)", (await has(anon2, '[data-testid="setup-progress"]')) && !(await text(anon2)).includes("Fictional Passenger A1"));
  await t.close(anon2);

  t.section("error + not-found states");
  await go(admin, "/operations/settings/website-requests");
  t.check("X1 a failing Operations page shows the in-shell error panel (shell kept, one h1, no internal error text)", (await has(admin, '[data-testid="operations-error"]')) && (await has(admin, 'nav[aria-label="Primary"]')) && (await h1s(admin)).length === 1 && !/stack|at \S+\.js|NEXT_PUBLIC/.test(await text(admin)));
  await go(admin, "/operations/no-such-page-qa2");
  t.check("X2 an unknown Operations URL shows the in-shell 'Page not found'", (await h1s(admin)).join() === "Page not found" && (await has(admin, 'nav[aria-label="Primary"]')));
  await go(admin, "/operations/trips/00000000-0000-4000-8000-000000000000");
  t.check("X3 an unknown trip id shows 'Trip unavailable' (no existence oracle)", (await text(admin)).includes("Trip unavailable"));

  t.section("route sweep: one visible h1 and no serious / critical axe on every Core + Growth screen (Organization Admin, 1440)");
  const trip = one(`select id from trips where organization_id='${ORG_A}' order by scheduled_pickup_at limit 1`);
  const req = one(`select id from transportation_requests where organization_id='${ORG_A}' limit 1`);
  const pax = one(`select id from passengers where organization_id='${ORG_A}' limit 1`);
  const arr = one(`insert into recurring_arrangements (organization_id, passenger_id, pickup_description, destination_description, pickup_time, days_of_week, start_date, timezone, status, created_by) values ('${ORG_A}','${pax}','QA2 sweep pickup','QA2 sweep clinic','08:00',array[1,3,5],(now() at time zone 'America/New_York')::date + 1,'America/New_York','active',(select id from auth.users where email='org-a-admin@example.test')) returning id`);
  const K = one(`insert into plus_contacts (organization_id, display_name, phone, contact_kind, created_by) values ('${ORG_A}','QA2 Sweep Contact','(404) 555-0190','individual',(select id from auth.users where email='org-a-admin@example.test')) returning id`);
  const O = one(`insert into plus_opportunities (organization_id, title, stage, primary_contact_id, source, service_type, created_by) values ('${ORG_A}','QA2 Sweep Opp','qualified','${K}','phone','dialysis',(select id from auth.users where email='org-a-admin@example.test')) returning id`);
  const routes = [
    "/operations", "/operations/requests", `/operations/requests/${req}`, "/operations/requests/new", "/operations/trips", `/operations/trips/${trip}`, "/operations/trips/new",
    "/operations/dispatch", "/operations/dispatch?day=tomorrow", "/operations/tomorrow", "/operations/recurring-care", `/operations/recurring-care/${arr}`, "/operations/recurring-care/new",
    "/operations/recurring-care/create-missing", "/operations/passengers", "/operations/facilities", "/operations/drivers", "/operations/fleet", "/operations/proof-of-service",
    "/operations/growth", "/operations/growth/pipeline", `/operations/growth/pipeline/${O}`, "/operations/growth/pipeline/new", "/operations/growth/contacts", `/operations/growth/contacts/${K}`,
    "/operations/growth/contacts/new", "/operations/growth/tasks", "/operations/growth/quotes", "/operations/settings",
  ];
  for (const r of routes) {
    await go(admin, r);
    const hs = await h1s(admin);
    t.check(`H1 ${r.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "[id]")}: exactly one visible h1`, hs.length === 1, JSON.stringify(hs));
    const v = await axe(admin);
    t.check(`AX ${r.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "[id]")}: 0 serious / critical axe violations`, v.length === 0, JSON.stringify(v));
  }
  await admin.setViewport(390, 844);
  await go(admin, "/operations/trips");
  t.check("M1 390px: the approved Operations notice is shown (mobile Operations is not part of this phase)", /designed for tablet and desktop use/.test(await text(admin)) && (await overflowX(admin)) <= 1);
} catch (e) {
  await t.finish(e);
}
await t.finish();
