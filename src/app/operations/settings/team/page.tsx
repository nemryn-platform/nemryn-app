import { requireOrganizationAdminAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { listStaffInvitations, listTeamMembers } from "@/lib/operations/team";
import { formatTeamDate } from "@/lib/operations/team-core";
import { PageHeader } from "@/components/ui/PageHeader";
import { TeamSection, type InvitationView, type TeamMemberView } from "@/components/operations/settings/TeamSection";

export const metadata = { title: "Team & Access" };

/**
 * Settings -> Team & Access (P1-PILOT-S4B-R4C). Organization Admin only.
 * STAFF Memberships and invitations for the caller's own workspace; Driver
 * lifecycle stays under Drivers.
 */
export default async function TeamSettingsPage() {
  const pathname = await getCurrentPathname("/operations/settings/team");
  const organization = await requireOrganizationAdminAccess(pathname);
  const tz = organization.organizationTimezone;

  const [members, invitations] = await Promise.all([
    listTeamMembers(organization.organizationId),
    listStaffInvitations(organization.organizationId),
  ]);

  const memberViews: TeamMemberView[] = members.map((member) => ({
    handle: member.handle,
    name: member.name,
    email: member.email,
    role: member.role,
    isActive: member.isActive,
    joined: formatTeamDate(member.joinedAt, tz),
    isSelf: member.isSelf,
  }));
  const invitationViews: InvitationView[] = invitations.map((invitation) => ({
    handle: invitation.handle,
    email: invitation.email,
    role: invitation.role,
    expired: invitation.status === "expired",
    expires: formatTeamDate(invitation.expiresAt, tz),
  }));

  return (
    <div className="flex flex-col gap-zw-lg">
      <PageHeader
        title="Team & Access"
        description="Manage the staff who can operate this organization in Nemryn."
        breadcrumb={[{ label: "Settings", href: "/operations/settings" }, { label: "Team & Access" }]}
      />
      <TeamSection members={memberViews} invitations={invitationViews} />
    </div>
  );
}
