/**
 * Pure Nemryn Plus access rules (NP-P1-S1). Runtime-import-free (unit-tested under plain Node: access-core.test.mjs).
 *
 * The effective Plus state comes ONLY from the database (`plus_access_state`, which resolves the caller's own
 * Organization Admin membership). These helpers interpret it; they never grant anything on their own. Anything the
 * database did not clearly return is treated as `none` -- fail closed.
 */

/** The four effective states (docs/security/plus-access-model.md section 3.1a). */
export type PlusAccessState = "none" | "write" | "read_only" | "locked";

export const PLUS_ACCESS_STATES: readonly PlusAccessState[] = ["none", "write", "read_only", "locked"];

/** Unknown, missing or malformed values become `none` (fail closed). */
export function parsePlusAccessState(raw: unknown): PlusAccessState {
  return typeof raw === "string" && (PLUS_ACCESS_STATES as readonly string[]).includes(raw) ? (raw as PlusAccessState) : "none";
}

/** Only `write` and `read_only` may open the Growth area. `locked` (security disable) and `none` may not. */
export function canEnterGrowth(state: PlusAccessState): boolean {
  return state === "write" || state === "read_only";
}

/**
 * The caller's Plus capability (NP-P1-S3), from `plus_access_state.access`: `write` for an Organization Admin while Plus
 * is writable, `read` while it is read-only, and for a named Dispatcher the access of their active grant. It is
 * separate from the four effective states, which stay unchanged.
 */
export type PlusCapability = "none" | "read" | "write";

export const PLUS_CAPABILITIES: readonly PlusCapability[] = ["none", "read", "write"];

/** Unknown, missing or malformed values become `none` (fail closed). */
export function parsePlusCapability(raw: unknown): PlusCapability {
  return typeof raw === "string" && (PLUS_CAPABILITIES as readonly string[]).includes(raw) ? (raw as PlusCapability) : "none";
}

/**
 * Whether the caller may open Growth at all (NP-P1-S3): the state must allow entry AND the database must have given the
 * caller a capability. Either missing -> no entry. Used by the route guard and, cosmetically, by the sidebar.
 */
export function canOpenGrowth(state: PlusAccessState, capability: PlusCapability): boolean {
  return canEnterGrowth(state) && capability !== "none";
}

/** Whether Growth create / edit controls may be offered: writable entitlement AND write capability. */
export function canWriteGrowth(state: PlusAccessState, capability: PlusCapability): boolean {
  return state === "write" && capability === "write";
}

export interface PlusCapabilitySummary {
  label: string;
  message: string;
}

/**
 * What the signed-in person is told about THEIR OWN Growth access (NP-P1-S3). The Core role decides the wording only;
 * the capability always comes from the database. Never describes another person's access.
 */
export function plusCapabilitySummary(role: string, state: PlusAccessState, capability: PlusCapability): PlusCapabilitySummary {
  if (!canOpenGrowth(state, capability)) {
    return { label: "No access", message: "You don't have access to Growth in this workspace." };
  }
  if (role === "organization_admin") {
    return state === "read_only"
      ? { label: "View only", message: "Nemryn Plus is not active, so Growth is view-only. Your records are kept." }
      : { label: "Full access", message: "As an Organization Admin you have full Nemryn Plus access and manage who else can use Growth." };
  }
  // Named staff have Plus only while it is writable (access model 2.1); anything else is no access.
  if (state !== "write") {
    return { label: "No access", message: "You don't have access to Growth in this workspace." };
  }
  return capability === "write"
    ? { label: "Write access", message: "An Organization Admin gave you write access to Growth. Your operations access is unchanged." }
    : { label: "Read access", message: "An Organization Admin gave you read access to Growth: you can view it but not change it. Your operations access is unchanged." };
}

/** Read-only Plus: history stays visible to the Organization Admin, nothing can be changed. */
export function isPlusReadOnly(state: PlusAccessState): boolean {
  return state === "read_only";
}

/**
 * Whole days left in a running trial, rounded up (0 once the end has passed). `null` when there is no valid trial end.
 */
export function trialDaysRemaining(now: Date, trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return null;
  const ms = end - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** "October 27, 2026" in the organization's own timezone; `null` when there is no valid trial end. */
export function formatTrialEnd(trialEndsAt: string | null, timezone: string): string | null {
  if (!trialEndsAt) return null;
  const date = new Date(trialEndsAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: timezone }).format(date);
}

export interface PlusStatusSummary {
  /** Short status label, e.g. for a badge. */
  label: string;
  tone: "positive" | "informational" | "warning" | "critical" | "neutral";
  /** One-sentence, honest explanation. Never promises results; never exposes restricted data. */
  message: string;
  /** Trial end, formatted in the organization's timezone; only while a trial runs. */
  trialEnd: string | null;
  trialDaysLeft: number | null;
}

/**
 * What an Organization Admin is told about their workspace's Nemryn Plus status (NP-P1-S2). Read-only information:
 * Plus is granted, extended and ended by Nemryn (ZD-207), never from the workspace.
 */
export function plusStatusSummary(state: PlusAccessState, trialEndsAt: string | null, timezone: string, now: Date): PlusStatusSummary {
  if (state === "write") {
    const trialEnd = formatTrialEnd(trialEndsAt, timezone);
    if (trialEnd) {
      const days = trialDaysRemaining(now, trialEndsAt);
      return {
        label: "Trial",
        tone: "informational",
        message: `Your Nemryn Plus trial ends ${trialEnd}${days !== null && days > 0 ? ` (${days} ${days === 1 ? "day" : "days"} left)` : ""}.`,
        trialEnd,
        trialDaysLeft: days,
      };
    }
    return { label: "Active", tone: "positive", message: "Nemryn Plus is active for this workspace.", trialEnd: null, trialDaysLeft: null };
  }
  if (state === "read_only") {
    return {
      label: "Not active",
      tone: "warning",
      message: "Nemryn Plus is not active. Your records are kept and can be viewed. Operations are not affected.",
      trialEnd: null,
      trialDaysLeft: null,
    };
  }
  if (state === "locked") {
    return {
      label: "Restricted",
      tone: "critical",
      message: "Nemryn Plus access is restricted for this workspace. Contact Nemryn. Operations are not affected.",
      trialEnd: null,
      trialDaysLeft: null,
    };
  }
  return {
    label: "Not enabled",
    tone: "neutral",
    message: "Nemryn Plus is not enabled for this workspace. Your workspace uses Nemryn operations.",
    trialEnd: null,
    trialDaysLeft: null,
  };
}
