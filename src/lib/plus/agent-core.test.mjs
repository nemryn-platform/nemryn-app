// NP-P2-S2 -- Growth Agent pure rules (no-send, do-not-contact, no consent claims, provider seam). Run with:
//
//   node --test src/lib/plus/agent-core.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const a = await import("./agent-core.ts");

const ctx = (over = {}) => ({
  type: "new_inquiry_waiting",
  contactName: "Ada Fictional",
  organizationName: "Sim Transport",
  doNotContact: false,
  preferredChannel: "email",
  hasPhone: true,
  hasEmail: true,
  ...over,
});

test("thresholds mirror the database (_plus_agent_threshold) and are labelled internal-test", () => {
  assert.deepEqual({ ...a.AGENT_THRESHOLDS }, { newInquiryWaitingDays: 2, awaitingResponseDays: 5, noRecentActivityDays: 10, suggestedDueDays: 1 });
  const sql = readFileSync(new URL("../../../supabase/migrations/20261015110000_plus_growth_agent.sql", import.meta.url), "utf8");
  for (const [k, v] of [["new_inquiry_waiting_days", 2], ["awaiting_response_days", 5], ["no_recent_activity_days", 10], ["suggested_due_days", 1]]) {
    assert.match(sql, new RegExp(`'${k}'\\s+then\\s+${v}\\b`), `${k} = ${v} in SQL`);
  }
});

test("do_not_contact: no draft, and the proposed action / task title say review, never outreach", () => {
  const c = ctx({ doNotContact: true });
  assert.equal(a.draftDecision(c).allowed, false);
  assert.equal(a.templateDraftProvider.draft(c), null);
  assert.match(a.proposedActionText("awaiting_response", true), /no outreach/i);
  assert.match(a.suggestedTaskTitle("awaiting_response", "Rides", true), /^Review \(do not contact\)/);
});

test("conservative draft gating: missing or unclear channel means no draft", () => {
  assert.equal(a.draftDecision(ctx({ preferredChannel: "none" })).allowed, false);
  assert.equal(a.draftDecision(ctx({ preferredChannel: "phone", hasPhone: false })).allowed, false);
  assert.equal(a.draftDecision(ctx({ preferredChannel: "email", hasEmail: false })).allowed, false);
  assert.equal(a.draftDecision(ctx({ preferredChannel: "sms" })).allowed, false);
  assert.deepEqual(a.draftDecision(ctx({ preferredChannel: "phone" })), { allowed: true, channel: "phone" });
});

test("drafts: template-only, first name + workspace only, no consent / price / appointment claims", () => {
  const d = a.templateDraftProvider.draft(ctx());
  assert.equal(d.channel, "email");
  assert.match(d.text, /^Hello Ada,/);
  assert.match(d.text, /Sim Transport/);
  assert.doesNotMatch(d.text, /Fictional/, "no surname");
  assert.doesNotMatch(d.text, /consent|agreed|opted|\$|price|appointment|scheduled|available vehicle|medical/i);
  assert.equal(a.templateDraftProvider.id, "template-v1");
  assert.equal(a.firstName("<script>"), "there", "never echoes unusable names");
  assert.equal(a.firstName(null), "there");
});

test("labels: NOT SENT, the agent never sends, and the consent caveat makes no consent claim", () => {
  assert.match(a.NOT_SENT_LABEL, /NOT SENT/);
  assert.match(a.AGENT_IS_ASSISTANT_NOTE, /never sends messages, places calls, changes stages/);
  assert.match(a.CONSENT_CAVEAT, /no consent record/i);
  assert.match(a.recommendationReason("awaiting_response", 6), /doesn't mean the person ignored it/);
  assert.match(a.recommendationReason("no_recent_activity", 1), /1 day\./);
  // NP-P2-S3: a linked request is recorded activity, so "new inquiry waiting" names the interactions it means
  assert.match(a.recommendationReason("new_inquiry_waiting", 3), /no note, call, email or meeting recorded/);
});

test("module is network-free: no fetch / http / provider SDK in agent-core", () => {
  const src = readFileSync(new URL("./agent-core.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\bfetch\(|https?:\/\/|from\s+["'](openai|@anthropic-ai|twilio|nodemailer)/);
  assert.doesNotMatch(src, /^import /m, "runtime-import-free");
});

test("outcome labels and errors", () => {
  assert.equal(a.reviewOutcomeLabel("approved"), "Task created by staff");
  assert.match(a.reviewOutcomeLabel("superseded"), /situation changed/);
  assert.match(a.agentErrorMessage("ZW003"), /changed since you opened it/);
  assert.match(a.agentErrorMessage("ZW002"), /isn't available/);
});
