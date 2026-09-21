/**
 * Pure helpers for owner-operator self-service Driver access (P1-PILOT-S5A1) --
 * no runtime imports, unit-testable under plain Node (self-driver-core.test.mjs).
 *
 * The authority for every decision here lives in the database
 * (`link_self_as_driver`: Organization Admin of the resolved organization, active
 * Membership, active organization). This module only (a) turns the caller's OWN
 * Driver rows into a display state, (b) validates the two human-typed fields
 * before the round trip, and (c) turns the database's stable error codes into
 * calm customer copy. It never sees, accepts or returns a user, organization,
 * membership or actor id as authority.
 */

export type DriverAccessState = "not_set_up" | "active" | "inactive" | "needs_support";

export const DISPLAY_NAME_MAX = 200;
export const PHONE_MAX = 40;

/**
 * The caller's own Driver rows in the CURRENT organization -> one display state.
 * Mirrors the database's own resolution order: any active row wins (idempotent
 * re-entry); exactly one inactive row can be turned back on; more than one
 * inactive row is ambiguous and is sent to support rather than guessed at.
 */
export function deriveDriverAccess(rows: ReadonlyArray<{ status: string }>): DriverAccessState {
  if (rows.length === 0) return "not_set_up";
  if (rows.some((row) => row.status === "active")) return "active";
  const inactive = rows.filter((row) => row.status === "inactive").length;
  return inactive === 1 ? "inactive" : "needs_support";
}

export const OPERATIONS_ACCESS_LABEL: Record<string, string> = {
  organization_admin: "Organization Admin",
  dispatcher: "Dispatcher",
  driver: "Driver",
};

export function operationsAccessLabel(role: string): string {
  return OPERATIONS_ACCESS_LABEL[role] ?? "Team member";
}

export type SelfDriverInput =
  | { ok: true; displayName: string; phone: string | null }
  | { ok: false; error: "name_required" | "name_too_long" | "phone_too_long" };

export function normalizeSelfDriverInput(nameRaw: unknown, phoneRaw: unknown): SelfDriverInput {
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (name.length === 0) return { ok: false, error: "name_required" };
  if (name.length > DISPLAY_NAME_MAX) return { ok: false, error: "name_too_long" };
  const phone = typeof phoneRaw === "string" ? phoneRaw.trim() : "";
  if (phone.length > PHONE_MAX) return { ok: false, error: "phone_too_long" };
  return { ok: true, displayName: name, phone: phone.length > 0 ? phone : null };
}

export type SelfDriverFailure = "not_allowed" | "conflict" | "invalid" | "failed";

/** Database error code -> stable failure. Never parses message text. */
export function classifySelfDriverError(code: string | null | undefined): SelfDriverFailure {
  if (code === "ZW001" || code === "ZW002") return "not_allowed";
  if (code === "ZW003") return "conflict";
  if (code === "ZW006") return "invalid";
  return "failed";
}

export const SELF_DRIVER_FAILURE_MESSAGE: Record<SelfDriverFailure, string> = {
  not_allowed: "Only an Organization Admin of an active workspace can set up Driver access for their own account.",
  conflict:
    "We couldn't set this up automatically because a Driver with this name already exists and isn't linked to an account. Please contact Nemryn support so the right Driver is used.",
  invalid: "Enter your name and, if you add one, a phone number under 40 characters.",
  failed: "We couldn't set up Driver access. Please try again.",
};

export const SELF_DRIVER_INPUT_MESSAGE: Record<"name_required" | "name_too_long" | "phone_too_long", string> = {
  name_required: "Enter the name dispatch and drivers should see.",
  name_too_long: "That name is too long.",
  phone_too_long: "That phone number is too long.",
};
