/**
 * Pure Platform Admin rules for the Nemryn Plus entitlement panel (NP-P1-S1). Runtime-import-free (unit-tested under
 * plain Node: entitlement-admin-core.test.mjs). The database (platform_set_organization_module /
 * platform_extend_plus_trial) re-validates every rule; this only shapes the panel and rejects obviously bad input early.
 */

import type { PlusAccessState } from "./access-core";

export type PlusStoredStatus = "trial" | "active" | "expired" | "cancelled" | "disabled";
export type PlusRestriction = "read_only" | "no_access";

/** Platform-side view of one organization's Plus entitlement (platform_get_organization_module). */
export interface PlusEntitlement {
  provisioned: boolean;
  status: PlusStoredStatus | null;
  restriction: PlusRestriction | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialExtensionCount: number;
  accessEndsAt: string | null;
  effectiveState: PlusAccessState;
  statusReason: string | null;
  updatedAt: string | null;
}

export type PlusAdminAction =
  | "start_trial"
  | "extend_trial"
  | "activate"
  | "expire"
  | "cancel"
  | "disable_read_only"
  | "disable_no_access";

export const PLUS_TRIAL_DEFAULT_DAYS = 14;
export const PLUS_TRIAL_MIN_DAYS = 7;
export const PLUS_TRIAL_MAX_DAYS = 30;
export const PLUS_EXTENSION_MAX_DAYS = 30;
export const PLUS_REASON_MIN = 3;
export const PLUS_REASON_MAX = 500;

export const PLUS_ACTION_LABELS: Record<PlusAdminAction, string> = {
  start_trial: "Start trial",
  extend_trial: "Extend trial",
  activate: "Activate Plus",
  expire: "Mark expired",
  cancel: "Cancel Plus",
  disable_read_only: "Disable (read-only)",
  disable_no_access: "Disable (no access)",
};

export function plusStatusLabel(entitlement: Pick<PlusEntitlement, "provisioned" | "status">): string {
  if (!entitlement.provisioned || !entitlement.status) return "Not provisioned";
  const labels: Record<PlusStoredStatus, string> = { trial: "Trial", active: "Active", expired: "Expired", cancelled: "Cancelled", disabled: "Disabled" };
  return labels[entitlement.status] ?? "Unknown";
}

export function plusEffectiveStateLabel(state: PlusAccessState): string {
  const labels: Record<PlusAccessState, string> = { none: "Not provisioned (Core only)", write: "Full access", read_only: "Read-only", locked: "Locked (no access)" };
  return labels[state];
}

export function plusEffectiveStateCategory(state: PlusAccessState): "positive" | "warning" | "critical" | "neutral" {
  return state === "write" ? "positive" : state === "read_only" ? "warning" : state === "locked" ? "critical" : "neutral";
}

export function plusRestrictionLabel(restriction: PlusRestriction | null): string {
  if (restriction === "read_only") return "Read-only (writes frozen)";
  if (restriction === "no_access") return "No access (security)";
  return "None";
}

/**
 * The actions that make sense for the current entitlement. Mirrors the database rules: a trial can be started only if
 * this organization never had one, extended only once while trialling; an organization without Plus can only be given
 * a trial or activated (there is nothing to end or restrict).
 */
export function availablePlusActions(e: PlusEntitlement): PlusAdminAction[] {
  if (!e.provisioned || !e.status) {
    return ["start_trial", "activate"];
  }
  const actions: PlusAdminAction[] = [];
  if (!e.trialStartedAt) actions.push("start_trial");
  if (e.status === "trial" && e.trialExtensionCount < 1) actions.push("extend_trial");
  actions.push("activate");
  if (e.status !== "expired") actions.push("expire");
  if (e.status !== "cancelled") actions.push("cancel");
  if (!(e.status === "disabled" && e.restriction === "read_only")) actions.push("disable_read_only");
  if (!(e.status === "disabled" && e.restriction === "no_access")) actions.push("disable_no_access");
  return actions;
}

export type PlusAdminRequest =
  | { kind: "set"; status: PlusStoredStatus; trialDays: number | null; accessEndsAt: string | null; restriction: PlusRestriction | null; reason: string }
  | { kind: "extend"; extraDays: number; reason: string };

export type PlusAdminValidation = { ok: true; value: PlusAdminRequest } | { ok: false; message: string };

const ACTIONS: readonly string[] = Object.keys(PLUS_ACTION_LABELS);

function wholeNumber(raw: unknown): number | null | "invalid" {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return null;
  if (!/^\d{1,3}$/.test(text)) return "invalid";
  return Number(text);
}

/**
 * Access end date (YYYY-MM-DD, UTC like every Platform date): access runs THROUGH that day, so the stored instant is
 * the following midnight UTC. Must be after `now`.
 */
export function accessEndInstant(raw: unknown, now: Date): string | null | "invalid" {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "invalid";
  const day = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== text) return "invalid";
  const end = new Date(day.getTime() + 86_400_000);
  return end.getTime() > now.getTime() ? end.toISOString() : "invalid";
}

/** Browser input is untrusted; the database re-validates every rule. */
export function validatePlusAdminInput(
  fields: { action: unknown; reason: unknown; trialDays?: unknown; extraDays?: unknown; accessEndsOn?: unknown },
  now: Date = new Date(),
): PlusAdminValidation {
  if (typeof fields.action !== "string" || !ACTIONS.includes(fields.action)) {
    return { ok: false, message: "Choose a valid Nemryn Plus change." };
  }
  const action = fields.action as PlusAdminAction;
  const reason = typeof fields.reason === "string" ? fields.reason.trim() : "";
  if (reason.length < PLUS_REASON_MIN) return { ok: false, message: "Enter a reason for this change." };
  if (reason.length > PLUS_REASON_MAX) return { ok: false, message: `Keep the reason under ${PLUS_REASON_MAX} characters.` };

  switch (action) {
    case "start_trial": {
      const days = wholeNumber(fields.trialDays);
      if (days === "invalid" || (days !== null && (days < PLUS_TRIAL_MIN_DAYS || days > PLUS_TRIAL_MAX_DAYS))) {
        return { ok: false, message: `Trial length must be ${PLUS_TRIAL_MIN_DAYS}–${PLUS_TRIAL_MAX_DAYS} days (leave blank for ${PLUS_TRIAL_DEFAULT_DAYS}).` };
      }
      return { ok: true, value: { kind: "set", status: "trial", trialDays: days, accessEndsAt: null, restriction: null, reason } };
    }
    case "extend_trial": {
      const days = wholeNumber(fields.extraDays);
      if (days === null || days === "invalid" || days < 1 || days > PLUS_EXTENSION_MAX_DAYS) {
        return { ok: false, message: `Extend by 1–${PLUS_EXTENSION_MAX_DAYS} days.` };
      }
      return { ok: true, value: { kind: "extend", extraDays: days, reason } };
    }
    case "activate": {
      const end = accessEndInstant(fields.accessEndsOn, now);
      if (end === "invalid") return { ok: false, message: "The access end date must be a valid future date, or left blank." };
      return { ok: true, value: { kind: "set", status: "active", trialDays: null, accessEndsAt: end, restriction: null, reason } };
    }
    case "expire":
      return { ok: true, value: { kind: "set", status: "expired", trialDays: null, accessEndsAt: null, restriction: null, reason } };
    case "cancel":
      return { ok: true, value: { kind: "set", status: "cancelled", trialDays: null, accessEndsAt: null, restriction: null, reason } };
    case "disable_read_only":
      return { ok: true, value: { kind: "set", status: "disabled", trialDays: null, accessEndsAt: null, restriction: "read_only", reason } };
    case "disable_no_access":
      return { ok: true, value: { kind: "set", status: "disabled", trialDays: null, accessEndsAt: null, restriction: "no_access", reason } };
  }
}

/** One-line explanation shown in each action's confirmation dialog. */
export const PLUS_ACTION_NOTES: Record<PlusAdminAction, string> = {
  start_trial: `Starts this organization's one Nemryn Plus trial (default ${PLUS_TRIAL_DEFAULT_DAYS} days). A trial can never be restarted or granted twice.`,
  extend_trial: "Extends the running trial once. After this, the trial cannot be extended again.",
  activate: "Gives full Nemryn Plus access. Leave the end date blank for open-ended access.",
  expire: "Ends Nemryn Plus. The Organization Admin keeps read-only access to history. Nothing is deleted.",
  cancel: "Records that the customer cancelled Nemryn Plus. Read-only history remains. Nothing is deleted.",
  disable_read_only: "Freezes Nemryn Plus changes (for example during a billing dispute). Read-only history remains.",
  disable_no_access: "Security restriction: nobody in the organization can open Nemryn Plus data. Records are kept.",
};

/** Shown on every Plus dialog: the entitlement never touches Core. */
export const PLUS_CORE_ISOLATION_NOTE = "Nemryn Plus changes never affect operations: requests, trips, dispatch and drivers keep working.";
