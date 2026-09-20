import Link from "next/link";
import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getUser } from "@/lib/auth/session";
import { listStaffInvitations, listTeamMembers } from "@/lib/operations/team";
import { PasswordResetRequest } from "@/components/operations/settings/PasswordResetRequest";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Security" };

/**
 * Settings -> Security (P1-PILOT-S4B-R4D). Organization Admin only. Shows only
 * what Nemryn genuinely has: the signed-in account's email and verification
 * state, the existing password-reset flow, and a summary of who has staff access
 * to this organization. No MFA / session / IP / SSO / password-policy controls
 * exist in the backend, so none are shown. Read-only apart from the caller's own
 * password-reset email; team changes stay in Team & Access.
 */
export default async function SecuritySettingsPage() {
  const pathname = await getCurrentPathname("/operations/settings/security");
  const organization = await requireOrganizationAdminAccess(pathname);

  const [user, members, invitations] = await Promise.all([
    getUser(),
    listTeamMembers(organization.organizationId),
    listStaffInvitations(organization.organizationId),
  ]);

  const activeAdmins = members.filter((m) => m.isActive && m.role === "organization_admin").length;
  const activeDispatchers = members.filter((m) => m.isActive && m.role === "dispatcher").length;
  const pending = invitations.filter((i) => i.status === "pending").length;
  const expired = invitations.filter((i) => i.status === "expired").length;
  const verified = Boolean(user?.email_confirmed_at);

  const summary: { label: string; value: number }[] = [
    { label: "Active Organization Admins", value: activeAdmins },
    { label: "Active Dispatchers", value: activeDispatchers },
    { label: "Pending invitations", value: pending },
    ...(expired > 0 ? [{ label: "Expired invitations", value: expired }] : []),
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-zw-lg">
      <PageHeader
        title="Security"
        description="Your account and who has access to this organization."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Security" }]}
      />

      <Panel className="flex flex-col gap-zw-md">
        <SectionHeader title="Your account" />
        <dl className="grid grid-cols-1 gap-zw-md md:grid-cols-2">
          <div className="min-w-0">
            <dt className={cn(typography.label, "text-text-muted")}>Email</dt>
            <dd className={cn(typography.body, "mt-0.5 min-w-0 break-all text-text-primary")}>{user?.email ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className={cn(typography.label, "text-text-muted")}>Email verification</dt>
            <dd className="mt-1">
              <StatusBadge label={verified ? "Verified" : "Not verified"} category={verified ? "positive" : "warning"} />
            </dd>
          </div>
          <div>
            <dt className={cn(typography.label, "text-text-muted")}>Sign-in method</dt>
            <dd className={cn(typography.body, "mt-0.5 text-text-primary")}>Email and password</dd>
          </div>
        </dl>
        <p className={cn(typography.metadata, "text-text-muted")}>Your account uses Nemryn&apos;s authentication system. Changing the email on an account isn&apos;t available yet.</p>
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-zw-md">
          <p className={cn(typography.label, "text-text-primary")}>Password</p>
          <p className={cn(typography.bodySmall, "text-text-secondary")}>
            To change your password, we&apos;ll email a secure reset link to your account address. You can only reset your own password.
          </p>
          <PasswordResetRequest />
        </div>
      </Panel>

      <Panel className="flex flex-col gap-zw-md">
        <SectionHeader title="Who has access" description="Staff access to this organization." />
        <dl className="grid grid-cols-2 gap-zw-md md:grid-cols-4">
          {summary.map((item) => (
            <div key={item.label}>
              <dt className={cn(typography.metadata, "text-text-muted")}>{item.label}</dt>
              <dd className={cn(typography.numericDisplay, "mt-0.5 text-text-primary")}>{item.value}</dd>
            </div>
          ))}
        </dl>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Review team access regularly and deactivate accounts that no longer need access.{" "}
          <Link href="/operations/settings/team" className="font-medium text-text-link">
            Review Team &amp; Access
          </Link>
        </p>
      </Panel>
    </div>
  );
}
