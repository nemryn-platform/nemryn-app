// NP-P2-S2 -- Growth nested navigation rules. Run with:
//
//   node --test src/lib/plus/growth-nav-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const n = await import("./growth-nav-core.ts");

test("children in canonical order: Dashboard, Pipeline, Contacts, Tasks", () => {
  assert.deepEqual(n.GROWTH_CHILDREN.map((c) => c.label), ["Dashboard", "Pipeline", "Contacts", "Tasks"]);
  assert.equal(n.GROWTH_CHILDREN[0].href, "/operations/growth");
});

test("isGrowthRoute: the root and its sub-tree only", () => {
  assert.equal(n.isGrowthRoute("/operations/growth"), true);
  assert.equal(n.isGrowthRoute("/operations/growth/tasks"), true);
  assert.equal(n.isGrowthRoute("/operations/growthy"), false);
  assert.equal(n.isGrowthRoute("/operations"), false);
});

test("exactly one child is active per Growth route; Dashboard hosts the agent page", () => {
  const active = (p) => n.GROWTH_CHILDREN.filter((c) => n.isGrowthChildActive(c.href, p)).map((c) => c.label);
  assert.deepEqual(active("/operations/growth"), ["Dashboard"]);
  assert.deepEqual(active("/operations/growth/agent"), ["Dashboard"]);
  assert.deepEqual(active("/operations/growth/pipeline/abc"), ["Pipeline"]);
  assert.deepEqual(active("/operations/growth/contacts/new"), ["Contacts"]);
  assert.deepEqual(active("/operations/growth/tasks"), ["Tasks"]);
  assert.deepEqual(active("/operations/trips"), []);
  assert.deepEqual(active("/operations/growth/pipelinex"), []);
});
