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

/** Looks up a value's label from one of these option lists (P1-E1-S2E) — Request Detail's own read-only display reuses the SAME lists Log Request's own Select controls already use, rather than declaring a second, parallel value→label mapping that could drift out of sync. Falls back to the raw value for any not-yet-seen value, never throws. */
export function selectOptionLabel(options: SelectOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
