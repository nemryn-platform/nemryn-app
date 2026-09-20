// Focused unit tests for pure Team & Access helpers (P1-PILOT-S4B-R4C).
//   node --test src/lib/operations/team-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { STAFF_ROLE_VALUES, STAFF_ROLE_OPTIONS, staffRoleLabel, isStaffRole, validateInviteInput, accessChangeCopy, formatTeamDate, INVITATION_STATUS_LABEL } =
  await import("./team-core.ts");
const { mapTeamError, teamErrorMessage } = await import("./team-errors.ts");

test("only the two staff roles can be invited or assigned -- never driver or platform roles", () => {
  assert.deepEqual([...STAFF_ROLE_VALUES], ["organization_admin", "dispatcher"]);
  for (const bad of ["driver", "platform_admin", "operations_staff", "", "ORGANIZATION_ADMIN", null, undefined, 1]) {
    assert.equal(isStaffRole(bad), false, String(bad));
  }
  assert.equal(validateInviteInput("a@b.example", "driver").ok, false);
});

test("role labels are human wording, never codes", () => {
  assert.equal(staffRoleLabel("organization_admin"), "Organization Admin");
  assert.equal(staffRoleLabel("dispatcher"), "Dispatcher");
  assert.equal(staffRoleLabel("driver"), "Team member");
  for (const option of STAFF_ROLE_OPTIONS) assert.doesNotMatch(option.label, /_/);
});

test("invite validation normalizes the email and requires a valid address and role", () => {
  const ok = validateInviteInput("  Ops@Example.COM ", "dispatcher");
  assert.deepEqual(ok, { ok: true, email: "ops@example.com", role: "dispatcher" });
  for (const bad of ["", "   ", "nope", "a@b", "a b@c.d", "@c.d", "a".repeat(250) + "@x.example"]) {
    assert.equal(validateInviteInput(bad, "dispatcher").ok, false, bad);
  }
});

test("invitation status labels", () => {
  assert.equal(INVITATION_STATUS_LABEL.pending, "Invitation sent");
  assert.equal(INVITATION_STATUS_LABEL.expired, "Expired");
});

test("self-management confirmation copy states the last-admin condition", () => {
  assert.match(accessChangeCopy({ action: "deactivate", isSelf: true, name: "Ada" }).body, /another active Organization Admin/);
  assert.match(accessChangeCopy({ action: "demote", isSelf: true, name: "Ada" }).body, /another active Organization Admin/);
  assert.match(accessChangeCopy({ action: "deactivate", isSelf: false, name: "Ada" }).title, /Ada/);
  assert.match(accessChangeCopy({ action: "deactivate", isSelf: false, name: "Ada" }).body, /reactivate/);
});

test("dates render in the organization's timezone", () => {
  assert.match(formatTeamDate("2026-09-20T03:30:00Z", "America/New_York"), /Sep 19, 2026/);
  assert.equal(formatTeamDate("nope", "America/New_York"), "");
});

test("team error mapping: no codes, no SQLSTATE, last-admin explained", () => {
  assert.equal(mapTeamError("ZW004"), "LAST_ADMIN");
  assert.equal(mapTeamError("ZW002"), "ACCESS_UNAVAILABLE");
  assert.equal(mapTeamError("ZW003"), "STALE");
  assert.equal(mapTeamError("ZW006"), "INVALID_INPUT");
  assert.equal(mapTeamError("XX000"), "UNKNOWN");
  assert.match(teamErrorMessage("LAST_ADMIN", "role"), /at least one active Organization Admin/);
  for (const code of ["UNAUTHORIZED", "ACCESS_UNAVAILABLE", "STALE", "LAST_ADMIN", "INVALID_INPUT", "UNKNOWN"]) {
    for (const op of ["invite", "resend", "cancel", "role", "status"]) {
      assert.doesNotMatch(teamErrorMessage(code, op), /ZW\d|\b4\d\d\b|postgres|supabase|rpc/i);
    }
  }
});

test("invite failure copy never reveals whether an address has an account", () => {
  assert.doesNotMatch(teamErrorMessage("INVALID_INPUT", "invite"), /account|registered|exists on nemryn/i);
});
