import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { trimSeconds, type OperatingSchedule } from "./operating-schedule-core";

export interface OperationsPreferences {
  schedule: OperatingSchedule | null;
  timezone: string;
  /** Existing Organization profile fields -- referenced from the Operations page, never duplicated. */
  businessPhone: string | null;
  businessEmail: string | null;
  primaryContactName: string | null;
  /** P1-OPS-PROG4: optional default trip duration in minutes (null = no default; there is no Nemryn default). */
  defaultTripDurationMinutes: number | null;
}

/**
 * Organization operating schedule (+ read-only references to the Organization
 * profile) for the caller's own workspace. Reads the organizations row through
 * the existing member SELECT policy (own organization only); `organizationId`
 * is always the server-resolved workspace. The schedule is an informational
 * preference -- nothing is rejected or blocked because of it.
 */
export async function getOperationsPreferences(organizationId: string): Promise<OperationsPreferences | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("timezone, operating_days, operating_opens_at, operating_closes_at, business_phone, business_email, primary_contact_name, default_trip_duration_minutes")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error("Failed to load operations preferences");
  if (!data) return null;

  const configured = data.operating_days && data.operating_opens_at && data.operating_closes_at;
  return {
    schedule: configured
      ? { days: data.operating_days as number[], opensAt: trimSeconds(data.operating_opens_at as string), closesAt: trimSeconds(data.operating_closes_at as string) }
      : null,
    timezone: data.timezone,
    businessPhone: data.business_phone,
    businessEmail: data.business_email,
    primaryContactName: data.primary_contact_name,
    defaultTripDurationMinutes: data.default_trip_duration_minutes,
  };
}

/** P1-OPS-PROG4: the organization's optional default trip duration (own organization only, member SELECT policy). */
export async function getOrganizationTripDefault(organizationId: string): Promise<number | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("default_trip_duration_minutes")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return data.default_trip_duration_minutes;
}
