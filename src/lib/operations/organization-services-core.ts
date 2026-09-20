/**
 * Pure Services & Intake helpers (P1-PILOT-S4B-R4C) -- no runtime imports,
 * unit-testable under plain Node (organization-services-core.test.mjs).
 *
 * The canonical service identifiers are the platform's existing list -- the
 * same eight values as `transportation_requests_service_type_check`, the
 * public-intake function and `SERVICE_TYPE_VALUES`
 * (src/lib/public-intake/website-intake-core.ts). A test pins this list to
 * that one, so a ninth type added there cannot silently go missing here.
 * Tenant data stores identifiers only; the human labels live in code.
 */

export const SERVICE_OFFERING_OPTIONS: { value: string; label: string }[] = [
  { value: "medical_appointment", label: "Medical appointments" },
  { value: "dialysis", label: "Dialysis" },
  { value: "rehabilitation", label: "Rehabilitation" },
  { value: "hospital_discharge", label: "Hospital discharge" },
  { value: "recurring_care", label: "Recurring scheduled care" },
  { value: "senior_medical", label: "Senior medical transportation" },
  { value: "wheelchair_transportation", label: "Wheelchair transportation" },
  { value: "other", label: "Other" },
];

export function serviceLabel(value: string): string {
  return SERVICE_OFFERING_OPTIONS.find((option) => option.value === value)?.label ?? "Other";
}

export function isCanonicalService(value: unknown): value is string {
  return typeof value === "string" && SERVICE_OFFERING_OPTIONS.some((option) => option.value === value);
}

export type ServiceSelectionValidation = { ok: true; services: string[] } | { ok: false; error: string };

/** Keeps canonical values only (in canonical order, distinct) and requires at least one. */
export function validateServiceSelection(selected: string[]): ServiceSelectionValidation {
  const unique = new Set(selected);
  for (const value of unique) {
    if (!isCanonicalService(value)) {
      return { ok: false, error: "That selection isn't valid. Refresh the page and try again." };
    }
  }
  const services = SERVICE_OFFERING_OPTIONS.map((option) => option.value).filter((value) => unique.has(value));
  if (services.length === 0) {
    return { ok: false, error: "Choose at least one service your organization provides." };
  }
  return { ok: true, services };
}

/** "Dialysis, Medical appointments" -- for informational summaries. Empty selection = "All service types". */
export function summarizeServices(services: string[]): string {
  if (services.length === 0) return "All service types";
  return SERVICE_OFFERING_OPTIONS.filter((option) => services.includes(option.value))
    .map((option) => option.label)
    .join(", ");
}
