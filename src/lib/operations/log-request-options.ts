/**
 * Client-safe option lists for Log Request (P1-E1-S2C) — the exact
 * allowed values `log_transportation_request` itself validates
 * server-side (20260916100000_request_mutation_foundation.sql), paired
 * with restrained, human-readable labels. This module has no
 * `server-only`/Supabase import, matching the same split
 * `new-trip-options.ts` already established (P1-E3-S7) so the client
 * component can import these without pulling a server-only module into
 * the browser bundle.
 *
 * These are UI convenience only — the RPC itself re-validates every one
 * of these values regardless of what this module ever contained (no
 * existence oracle, no trust boundary here).
 */

export interface SelectOption {
  value: string;
  label: string;
}

/** Mirrors transportation_requests.requester_relationship's own CHECK constraint exactly. */
export const REQUESTER_RELATIONSHIP_OPTIONS: SelectOption[] = [
  { value: "self", label: "The passenger themselves" },
  { value: "family", label: "Family member" },
  { value: "caregiver", label: "Caregiver" },
  { value: "facility_coordinator", label: "Facility coordinator" },
  { value: "other", label: "Other" },
];

/** Mirrors transportation_requests.return_trip_needed's own CHECK constraint exactly. Intent only — logging a request never creates a second Trip (P1-UX/ZD-069 remains the eventual return-trip mechanism, unchanged and untouched by this phase). */
export const RETURN_TRIP_OPTIONS: SelectOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
];

/** Mirrors transportation_requests.source's own CHECK constraint exactly (added in P1-E1-S2B). "web" intentionally is NOT the default here — this form is internal/authenticated capture, never public intake. */
export const SOURCE_OPTIONS: SelectOption[] = [
  { value: "phone", label: "Phone" },
  { value: "facility", label: "Facility" },
  { value: "email", label: "Email" },
  { value: "web", label: "Web" },
  { value: "other", label: "Other" },
];

/** The operationally-likeliest channel for an authenticated operator logging demand as it comes in — matches this form's own primary use case (phone call → Log Request), per the phase's own explicit recommendation. The operator can always change it. */
export const DEFAULT_SOURCE = "phone";

/**
 * "Service requested (optional)" (NC-REQUEST-SERVICE-TYPE-S1). The canonical values and labels are passed in by the
 * caller (SERVICE_TYPE_VALUES / SERVICE_TYPE_LABELS from website-intake-core), so this module keeps no second list.
 * OD-S1 = A: list the organization's configured Services; when it has none configured (a SUCCESSFUL empty answer), list
 * every canonical service. `configured = null` means the Services could NOT be loaded: that is never treated as "none
 * configured", so only "Not specified" is offered (the Request can still be logged without a service). The first option
 * is always "Not specified" (value ""), the default and always selectable. UI convenience only: the server action and
 * log_transportation_request re-validate, and Services never restrict what the database accepts.
 */
export const SERVICE_NOT_SPECIFIED_LABEL = "Not specified";
export const SERVICE_OPTIONS_UNAVAILABLE_NOTE = "Available services couldn't be loaded. You can still log this request without one.";

export function serviceRequestedOptions(
  canonical: readonly string[],
  labels: Readonly<Record<string, string>>,
  configured: readonly string[] | null,
): SelectOption[] {
  const shown = configured === null ? [] : configured.length === 0 ? canonical : canonical.filter((value) => configured.includes(value));
  return [{ value: "", label: SERVICE_NOT_SPECIFIED_LABEL }, ...shown.map((value) => ({ value, label: labels[value] ?? value }))];
}

/**
 * Posted serviceType -> the RPC value. Missing, empty or whitespace-only = not specified (null). Anything else must be
 * EXACTLY a canonical value: never trimmed, case-folded or mapped from a label (mirrors the database rule).
 */
export function parseServiceTypeInput(raw: unknown, canonical: readonly string[]): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  if (!/\S/.test(raw)) return { ok: true, value: null };
  return canonical.includes(raw) ? { ok: true, value: raw } : { ok: false };
}

/** Looks up a value's label from one of these option lists (P1-E1-S2E) — Request Detail's own read-only display reuses the SAME lists Log Request's own Select controls already use, rather than declaring a second, parallel value→label mapping that could drift out of sync. Falls back to the raw value for any not-yet-seen value, never throws. */
export function selectOptionLabel(options: SelectOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
