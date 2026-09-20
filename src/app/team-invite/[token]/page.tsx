import Image from "next/image";
import Link from "next/link";
import { getUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signOutAction } from "@/lib/auth/sign-out-action";
import { staffRoleLabel } from "@/lib/operations/team-core";
import { TeamJoinSignUpForm } from "./TeamJoinSignUpForm";
import { AcceptTeamInviteButton } from "./AcceptTeamInviteButton";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Join your team" };

/**
 * Team invitation landing (P1-PILOT-S4B-R4C). The 256-bit token in the URL IS
 * the credential; `get_staff_invite_preview` is anon-callable but returns only
 * organization name, invited email, role and effective status. States:
 *   - not usable (unknown / expired / cancelled / already used) -> calm message
 *   - signed out -> sign up with the invited (locked) email, or sign in
 *   - signed in as the invited email -> one-click accept
 *   - signed in as someone else -> honest guidance
 * A recipient with an existing account is never asked to create another.
 */
export default async function TeamInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: preview, error } = await supabase.rpc("get_staff_invite_preview", { p_token: token });

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-dvh items-center justify-center bg-brand-care-navy px-4 py-12">
      <div className="w-full max-w-sm rounded-md bg-surface-elevated p-8 shadow-sm">
        <div className="mb-8 flex justify-center">
          <Image src="/brand/nemryn-logo-primary.svg" alt="Nemryn" width={434} height={127} priority className="h-auto w-60" />
        </div>
        {children}
      </div>
    </div>
  );

  if (error || !preview || !preview.email || !preview.organization_name || !preview.role) {
    return shell(
      <>
        <h1 className={cn(typography.sectionHeading, "mb-2 text-text-primary")}>Invitation not found</h1>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>This invitation link isn&apos;t valid. Ask your organization&apos;s administrator to send a new one.</p>
      </>,
    );
  }

  const inviteEmail: string = preview.email;
  const organizationName: string = preview.organization_name;
  const roleLabel = staffRoleLabel(preview.role);

  if (preview.status !== "pending") {
    const copy: Record<string, { title: string; body: string }> = {
      accepted: { title: "Already accepted", body: "This invitation has already been used. If this is your account, just sign in." },
      cancelled: { title: "Invitation no longer available", body: "This invitation was cancelled. Ask your administrator for a new one." },
      expired: { title: "Invitation expired", body: "This invitation has expired. Ask your administrator to resend it." },
    };
    const message = copy[preview.status ?? ""] ?? copy.cancelled;
    return shell(
      <>
        <h1 className={cn(typography.sectionHeading, "mb-2 text-text-primary")}>{message.title}</h1>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>{message.body}</p>
        {preview.status === "accepted" && (
          <Link href="/sign-in" className={cn(typography.bodySmall, "mt-4 inline-block font-medium text-text-link")}>
            Sign in
          </Link>
        )}
      </>,
    );
  }

  const user = await getUser();

  if (!user) {
    return shell(
      <>
        <h1 className={cn(typography.sectionHeading, "mb-1 text-text-primary")}>Join {organizationName}</h1>
        <p className={cn(typography.bodySmall, "mb-6 text-text-secondary")}>
          You&apos;ve been invited to join {organizationName} as {roleLabel}. Create your account to accept.
        </p>
        <TeamJoinSignUpForm token={token} email={inviteEmail} />
        <p className={cn(typography.bodySmall, "mt-6 text-center text-text-secondary")}>
          Already have an account?{" "}
          <Link href={`/sign-in?next=${encodeURIComponent(`/team-invite/${token}`)}`} className="font-medium text-text-link">
            Sign in
          </Link>
        </p>
      </>,
    );
  }

  const signedInEmail = user.email?.toLowerCase();
  if (signedInEmail !== inviteEmail.toLowerCase()) {
    return shell(
      <>
        <h1 className={cn(typography.sectionHeading, "mb-2 text-text-primary")}>Wrong account</h1>
        <p className={cn(typography.bodySmall, "mb-4 text-text-secondary")}>
          This invitation is for <strong>{inviteEmail}</strong>, but you&apos;re signed in as <strong>{signedInEmail}</strong>. Sign out and
          sign back in with the invited email to continue.
        </p>
        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </>,
    );
  }

  return shell(
    <>
      <h1 className={cn(typography.sectionHeading, "mb-1 text-text-primary")}>Join {organizationName}</h1>
      <p className={cn(typography.bodySmall, "mb-6 text-text-secondary")}>
        You&apos;re signed in as {signedInEmail}. Accept this invitation to join {organizationName} as {roleLabel}.
      </p>
      <AcceptTeamInviteButton token={token} />
    </>,
  );
}
