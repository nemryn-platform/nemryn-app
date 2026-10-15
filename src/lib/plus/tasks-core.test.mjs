// NP-P2-S2 -- Nemryn Plus tasks pure rules. Run with:
//
//   node --test src/lib/plus/tasks-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const t = await import("./tasks-core.ts");

const C = "4cb65c2d-9e82-461b-a444-d4d991ab930f";
const O = "9d0c4b62-1f1e-4b5e-9c55-6a2f1d0e7a11";

test("views are the brief's set, open first; history is completed + cancelled", () => {
  assert.deepEqual([...t.TASK_VIEWS], ["open", "mine", "overdue", "today", "upcoming", "no_date", "history"]);
  assert.equal(t.taskViewLabel("history"), "Completed & cancelled");
});

test("validateTaskForm: title required and bounded; date-only due defaults to end of day", () => {
  assert.equal(t.validateTaskForm({ title: "  ", dueDate: "", dueTime: "", assigneeHandle: "" }).ok, false);
  assert.equal(t.validateTaskForm({ title: "x".repeat(201), dueDate: "", dueTime: "", assigneeHandle: "" }).ok, false);
  const ok = t.validateTaskForm({ title: "  Call back  ", dueDate: "2026-10-20", dueTime: "", assigneeHandle: "" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { title: "Call back", due: { date: "2026-10-20", time: t.END_OF_DAY_TIME }, assigneeHandle: null });
  const none = t.validateTaskForm({ title: "Review", dueDate: "", dueTime: "", assigneeHandle: "" });
  assert.equal(none.value.due, null, "no date is a valid task");
});

test("validateTaskForm: rejects malformed date/time, a time without a date, and a non-handle assignee", () => {
  assert.ok(t.validateTaskForm({ title: "a", dueDate: "20-10-2026", dueTime: "", assigneeHandle: "" }).errors.dueDate);
  assert.ok(t.validateTaskForm({ title: "a", dueDate: "2026-10-20", dueTime: "25:00", assigneeHandle: "" }).errors.dueTime);
  assert.ok(t.validateTaskForm({ title: "a", dueDate: "", dueTime: "09:00", assigneeHandle: "" }).errors.dueDate);
  assert.ok(t.validateTaskForm({ title: "a", dueDate: "", dueTime: "", assigneeHandle: "user@example.com" }).errors.assigneeHandle);
});

test("parseTaskSubject: exactly one of contact or opportunity", () => {
  assert.deepEqual(t.parseTaskSubject(C, ""), { kind: "contact", id: C });
  assert.deepEqual(t.parseTaskSubject(null, O), { kind: "opportunity", id: O });
  assert.equal(t.parseTaskSubject(C, O), null, "both is refused");
  assert.equal(t.parseTaskSubject("", ""), null, "neither is refused");
  assert.equal(t.parseTaskSubject("not-a-uuid", ""), null);
});

test("parseTaskListParams / taskListHref round-trip and sanitize", () => {
  const p = t.parseTaskListParams({ view: "overdue", q: "  van ", assignee: C });
  assert.deepEqual(p, { view: "overdue", search: "van", assignee: C });
  assert.equal(t.taskListHref(p), `/operations/growth/tasks?view=overdue&q=van&assignee=${C}`);
  const bad = t.parseTaskListParams({ view: "everything", assignee: "'; drop" });
  assert.deepEqual(bad, { view: "open", search: "", assignee: null });
  assert.equal(t.taskListHref(bad), "/operations/growth/tasks");
  assert.equal(t.taskListHref(bad, { view: "mine" }), "/operations/growth/tasks?view=mine");
});

test("dueLabel and localDueParts use the workspace timezone (UTC storage)", () => {
  // 2026-10-15T03:30Z is Oct 14, 11:30 PM in New York.
  const iso = "2026-10-15T03:30:00.000Z";
  assert.deepEqual(t.localDueParts(iso, "America/New_York"), { date: "2026-10-14", time: "23:30" });
  assert.deepEqual(t.localDueParts(iso, "UTC"), { date: "2026-10-15", time: "03:30" });
  assert.equal(t.dueLabel(iso, { overdue: true, today: false }, "America/New_York"), "Overdue · Oct 14, 2026, 11:30 PM");
  assert.equal(t.dueLabel(iso, { overdue: false, today: true }, "America/New_York"), "Due today · 11:30 PM");
  assert.equal(t.dueLabel(null, { overdue: false, today: false }, "UTC"), "No due date");
  assert.deepEqual(t.localDueParts(null, "UTC"), { date: "", time: "" });
});

test("error messages: no existence oracle, and never presented as a customer communication", () => {
  assert.match(t.taskErrorMessage("ZW002"), /isn't available/);
  assert.match(t.taskErrorMessage("ZW003"), /changed since you opened it/);
  for (const c of ["ZW001", "ZW002", "ZW003", "ZW004", "ZW006", undefined]) {
    assert.doesNotMatch(t.taskErrorMessage(c), /\b(sent|message sent|emailed|texted|called)\b/i);
  }
  assert.match(t.TASK_IS_INTERNAL_NOTE, /internal/i);
});
