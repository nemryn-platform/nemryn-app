import { notFound } from "next/navigation";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getOperationsPreferences } from "@/lib/operations/organization-preferences";
import { timezoneOptionsFor } from "@/lib/operations/organization-settings-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { OperatingScheduleForm } from "@/components/operations/settings/OperatingScheduleForm";

export const metadata = { title: "Operations settings" };

/**
 * Settings -> Operations (P1-PILOT-S4B-R4C). Organization Admin only. A
 * lightweight weekly operating schedule, plus read-only references to the
 * organization's timezone and contact details, which each keep exactly one
 * source of truth under Settings -> Organization.
 */
export default async function OperationsSettingsPage() {
  const pathname = await getCurrentPathname("/operations/settings/operations");
  const organization = await requireOrganizationAdminAccess(pathname);

  const preferences = await getOperationsPreferences(organization.organizationId);
  if (!preferences) notFound();

  const timezoneLabel = timezoneOptionsFor(preferences.timezone).find((option) => option.value === preferences.timezone)?.label ?? preferences.timezone;

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Operations"
        description="Your operating schedule and how your organization can be reached."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Operations" }]}
      />
      <OperatingScheduleForm
        schedule={preferences.schedule}
        timezoneLabel={timezoneLabel}
        business={{ phone: preferences.businessPhone, email: preferences.businessEmail, contact: preferences.primaryContactName }}
      />
    </div>
  );
}
