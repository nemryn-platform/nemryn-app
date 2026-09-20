/**
 * Pure Organization Settings helpers (P1-PILOT-S4B-R4A) -- no runtime
 * imports, so it is unit-testable directly under plain Node
 * (organization-settings-core.test.mjs) and importable from both server
 * and client code.
 *
 * The validation here is the FRIENDLY first line: it produces field-level
 * messages before a round trip. It is never the authority --
 * `update_organization_settings` re-validates every rule below
 * (20260920090000_tenant_settings_foundation.sql) and the columns' own
 * CHECK constraints are the last line. The limits are duplicated on
 * purpose and must stay in step with that function.
 */

export const ORGANIZATION_SETTINGS_LIMITS = {
  name: 200,
  phone: 40,
  email: 254,
  address: 500,
  contactName: 200,
} as const;

// A practical US timezone list, not an exhaustive IANA catalog -- the
// server-side check (is_valid_iana_timezone, P1-E3-S2C) is the real
// authority regardless of what this list offers. Shared by the
// onboarding Business Basics step and Settings -> Organization so the two
// can never offer different choices for the same authoritative value.
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain, no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
];

/**
 * The options list, guaranteed to contain the organization's CURRENT
 * timezone even when it is a valid IANA zone outside the practical list
 * above (e.g. set by a platform operator) -- so opening and re-saving the
 * form never silently changes an unusual value to something else.
 */
export function timezoneOptionsFor(current: string): { value: string; label: string }[] {
  if (TIMEZONE_OPTIONS.some((option) => option.value === current)) {
    return TIMEZONE_OPTIONS;
  }
  return [{ value: current, label: current.replace(/_/g, " ") }, ...TIMEZONE_OPTIONS];
}

export interface OrganizationSettingsValues {
  name: string;
  timezone: string;
  businessPhone: string;
  businessEmail: string;
  businessAddress: string;
  primaryContactName: string;
}

export type OrganizationSettingsField = keyof OrganizationSettingsValues;

export type OrganizationSettingsFieldErrors = Partial<Record<OrganizationSettingsField, string>>;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type OrganizationSettingsValidation =
  | { ok: true; values: OrganizationSettingsValues }
  | { ok: false; fieldErrors: OrganizationSettingsFieldErrors };

/** Trims every field; returns field-level errors or the normalized values. Optional fields normalize to "" (the server stores that as cleared). */
export function validateOrganizationSettings(input: OrganizationSettingsValues): OrganizationSettingsValidation {
  const values: OrganizationSettingsValues = {
    name: input.name.trim(),
    timezone: input.timezone.trim(),
    businessPhone: input.businessPhone.trim(),
    businessEmail: input.businessEmail.trim().toLowerCase(),
    businessAddress: input.businessAddress.trim(),
    primaryContactName: input.primaryContactName.trim(),
  };
  const fieldErrors: OrganizationSettingsFieldErrors = {};

  if (values.name.length === 0) {
    fieldErrors.name = "Enter your organization's name.";
  } else if (values.name.length > ORGANIZATION_SETTINGS_LIMITS.name) {
    fieldErrors.name = `Keep the name to ${ORGANIZATION_SETTINGS_LIMITS.name} characters or fewer.`;
  }

  if (values.timezone.length === 0) {
    fieldErrors.timezone = "Choose your operating timezone.";
  }

  if (values.businessPhone.length > 0) {
    const digits = values.businessPhone.replace(/\D/g, "").length;
    if (values.businessPhone.length > ORGANIZATION_SETTINGS_LIMITS.phone || digits < 7 || digits > 20) {
      fieldErrors.businessPhone = "Enter a valid phone number.";
    }
  }

  if (values.businessEmail.length > 0) {
    if (values.businessEmail.length > ORGANIZATION_SETTINGS_LIMITS.email || !EMAIL_PATTERN.test(values.businessEmail)) {
      fieldErrors.businessEmail = "Enter a valid email address.";
    }
  }

  if (values.businessAddress.length > ORGANIZATION_SETTINGS_LIMITS.address) {
    fieldErrors.businessAddress = `Keep the address to ${ORGANIZATION_SETTINGS_LIMITS.address} characters or fewer.`;
  }

  if (values.primaryContactName.length > ORGANIZATION_SETTINGS_LIMITS.contactName) {
    fieldErrors.primaryContactName = `Keep the name to ${ORGANIZATION_SETTINGS_LIMITS.contactName} characters or fewer.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, values };
}

/** The jsonb patch `update_organization_settings` expects -- snake_case column keys, every editable field always present (the form always submits the whole profile). */
export function toSettingsPatch(values: OrganizationSettingsValues): Record<string, string> {
  return {
    name: values.name,
    timezone: values.timezone,
    business_phone: values.businessPhone,
    business_email: values.businessEmail,
    business_address: values.businessAddress,
    primary_contact_name: values.primaryContactName,
  };
}
