import { requireDriverAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { Panel } from "@/components/ui/Panel";
import { DriverInstallCard } from "@/components/driver/DriverInstallCard";
import { DriverWorkingHoursCard } from "@/components/driver/DriverWorkingHoursCard";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Driver Profile / account entry (P1-PILOT-S5A): who is signed in and for which
 * organization -- read from the Driver's own active tenant context (never a
 * fixed tenant) -- plus the optional app-install entry and the app version.
 * Sign-out stays in the header. No operational data, no editing.
 */
export default async function DriverProfilePage() {
  const pathname = await getCurrentPathname("/driver/profile");
  const access = await requireDriverAccess(pathname);
  if (access.status !== "ok") return null; // the layout already renders the account-setup state

  return (
    <div className="flex flex-col gap-zw-md">
      <Panel>
        <DefinitionList
          items={[
            { label: "Name", value: access.displayName },
            { label: "Organization", value: access.organization.organizationName },
            ...(access.phone ? [{ label: "Phone", value: access.phone }] : []),
          ]}
        />
      </Panel>
      <DriverWorkingHoursCard organizationId={access.organization.organizationId} />
      <DriverInstallCard />
      <p className={cn(typography.metadata, "text-text-muted")}>Nemryn Driver · version {(process.env.NEXT_PUBLIC_BUILD_ID ?? "dev").slice(0, 7)}</p>
    </div>
  );
}
