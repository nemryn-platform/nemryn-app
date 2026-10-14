// NP-P1-S3 -- Settings -> Nemryn Plus -> Team access, pure rules. Run with:
//
//   node --test src/lib/plus/team-access-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const core = await import("./team-access-core.ts");
const {
  parseGrantAccess,
  grantVersionToken,
  coreRoleLabel,
  plusAccessLabel,
  plusPermissionView,
  offeredTeamChanges,
  teamChangeButtonLabel,
  teamChangeCopy,
  validateTeamChangeInput,
  teamAccessErrorMessage,
  TEAM_ACCESS_STALE_MESSAGE,
} = core;

const UUID = "4cb65c2d-9e82-461b-a444-d4d991ab930f";
const UUID2 = "9f35b349-8781-44bc-97d0-d874c42d48d0";

test("grant access parsing and version tokens", () => {
  assert.equal(parseGrantAccess("read"), "read");
  assert.equal(parseGrantAccess("write"), "write");
  for (const raw of [null, undefined, "", "admin", "READ", 1]) assert.equal(parseGrantAccess(raw), null);
  assert.equal(grantVersionToken(null), "none");
  assert.equal(grantVersionToken(undefined), "none");
  assert.equal(grantVersionToken(UUID), UUID);
});

test("Core role and Plus permission use distinct wording", () => {
  assert.equal(coreRoleLabel("organization_admin"), "Organization Admin");
  assert.equal(coreRoleLabel("dispatcher"), "Dispatcher");
  assert.deepEqual(["read", "write", "none"].map(plusAccessLabel), ["Read", "Write", "No access"]);
  for (const label of ["Read", "Write", "No access", "Full access"]) {
    assert.notEqual(label, coreRoleLabel("dispatcher"));
    assert.notEqual(label, coreRoleLabel("organization_admin"));
  }
});

test("permission view: Admin full; Dispatcher grant; inert grants explained", () => {
  assert.equal(plusPermissionView({ role: "organization_admin", isActive: true, access: null }, true).label, "Full access");
  assert.equal(plusPermissionView({ role: "dispatcher", isActive: true, access: null }, true).label, "No access");
  const w = plusPermissionView({ role: "dispatcher", isActive: true, access: "write" }, true);
  assert.deepEqual([w.label, w.note], ["Write", null]);
  const inactive = plusPermissionView({ role: "dispatcher", isActive: false, access: "read" }, true);
  assert.equal(inactive.label, "Read");
  assert.match(inactive.note, /no Plus access while deactivated/);
  const notWritable = plusPermissionView({ role: "dispatcher", isActive: true, access: "write" }, false);
  assert.match(notWritable.note, /named staff currently have no access/);
});

test("offered changes: only active Dispatchers can be granted, any grant can be removed, Admins get nothing", () => {
  assert.deepEqual(offeredTeamChanges({ role: "organization_admin", isActive: true, access: null }, true), []);
  assert.deepEqual(offeredTeamChanges({ role: "dispatcher", isActive: true, access: null }, true), ["read", "write"]);
  assert.deepEqual(offeredTeamChanges({ role: "dispatcher", isActive: true, access: "read" }, true), ["write", "none"]);
  assert.deepEqual(offeredTeamChanges({ role: "dispatcher", isActive: true, access: "write" }, true), ["read", "none"]);
  assert.deepEqual(offeredTeamChanges({ role: "dispatcher", isActive: false, access: null }, true), [], "inactive: nothing to give");
  assert.deepEqual(offeredTeamChanges({ role: "dispatcher", isActive: false, access: "write" }, true), ["none"], "inactive grant can be removed");
  assert.deepEqual(offeredTeamChanges({ role: "dispatcher", isActive: true, access: null }, false), [], "Plus not writable: no grants");
  assert.deepEqual(offeredTeamChanges({ role: "dispatcher", isActive: true, access: "read" }, false), ["none"], "read_only: removal only");
});

test("button labels and confirmation copy name the person and the organization", () => {
  assert.equal(teamChangeButtonLabel("read", null), "Give read access");
  assert.equal(teamChangeButtonLabel("write", "read"), "Change to write");
  assert.equal(teamChangeButtonLabel("none", "write"), "Remove access");
  const give = teamChangeCopy("write", { name: "Dana", access: null }, "Fictional Org A");
  assert.match(give.title, /Dana/);
  assert.match(give.body, /Fictional Org A/);
  assert.match(give.body, /Core role and operations access are not changed/);
  assert.equal(give.destructive, false);
  const remove = teamChangeCopy("none", { name: "Dana", access: "read" }, "Fictional Org A");
  assert.equal(remove.destructive, true);
  assert.match(remove.body, /Fictional Org A/);
});

test("form validation: malformed input refused before the database", () => {
  const ok = validateTeamChangeInput({ handle: UUID, change: "write", expectedGrant: "none", organizationId: UUID2 });
  assert.deepEqual(ok, { ok: true, handle: UUID, change: "write", expectedGrantId: null, organizationId: UUID2 });
  const rv = validateTeamChangeInput({ handle: UUID, change: "none", expectedGrant: UUID, organizationId: UUID2 });
  assert.equal(rv.ok && rv.expectedGrantId, UUID);
  const bad = [
    { handle: "x", change: "read", expectedGrant: "none", organizationId: UUID2 },
    { handle: UUID, change: "admin", expectedGrant: "none", organizationId: UUID2 },
    { handle: UUID, change: "read", expectedGrant: "", organizationId: UUID2 },
    { handle: UUID, change: "read", expectedGrant: "nope", organizationId: UUID2 },
    { handle: UUID, change: "read", expectedGrant: "none", organizationId: null },
    { handle: null, change: "read", expectedGrant: "none", organizationId: UUID2 },
  ];
  for (const raw of bad) assert.equal(validateTeamChangeInput(raw).ok, false, JSON.stringify(raw));
});

test("error copy: plain words, no codes", () => {
  assert.equal(teamAccessErrorMessage("ZW003"), TEAM_ACCESS_STALE_MESSAGE);
  for (const code of ["ZW001", "ZW002", "ZW003", "ZW006", undefined, "XX000"]) {
    const m = teamAccessErrorMessage(code);
    assert.ok(m.length > 10);
    assert.doesNotMatch(m, /ZW\d|sqlstate|uuid/i);
  }
});
