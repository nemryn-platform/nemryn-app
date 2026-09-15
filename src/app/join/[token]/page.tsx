import Image from "next/image";
import Link from "next/link";
import { getUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { JoinSignUpForm } from "./JoinSignUpForm";
import { AcceptInviteButton } from "./AcceptInviteButton";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Join" };

/**
 * Driver invite landing (P1-E3-S9, work item §10 — closes GAP-15). The
 * token IS the credential — `get_driver_invite_preview` is public/anon-
 * callable (see the migration) but returns only organization_name/
 * display_name/email/status, nothing else. Three states, matching the
 * driver-invite-linkage-model.md contract exactly:
 *   1. Not signed in → sign up with the invite's own (locked) email.
 *   2. Signed in, matching email → one-click Accept.
 *   3. Signed in, DIFFERENT email → clear, honest guidance, no dead end.
 */
export default async function JoinInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: preview, error } = await supabase.rpc("get_driver_invite_preview", { p_token: token });

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-dvh items-center justify-center bg-brand-care-navy px-4 py-12">
      <div className="w-full max-w-sm rounded-md bg-surface-elevated p-8 shadow-sm">
        {/*
          N0-M2-A2-R1: this is the PLATFORM frame — it must stay Nemryn-
          only, never co-branded with the inviting tenant. The invitation
          body below intentionally keeps dynamic {"{organizationName}"} —
          do not hard-code it to Nemryn.
        */}
        <div className="mb-8 flex justify-center">
          <Image src="/brand/nemryn-logo-primary.svg" alt="Nemryn" width={434} height={127} priority className="h-auto w-60" />
        </div>
        {children}
      </div>
    </div>
  );

  // Composite-type fields are nullable at the TypeScript level even though
  // get_driver_invite_preview never actually returns a row with a null
  // email in practice (the underlying column is NOT NULL) — guarded here
  // defensively rather than asserted, same "no existence oracle" outcome
  // as a genuinely missing/invalid token.
  if (error || !preview || !preview.email || !preview.organization_name || !preview.display_name) {
    return shell(
      <>
        <h1 className={cn(typography.sectionHeading, "mb-2 text-text-primary")}>Invite not found</h1>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          This invite link isn&apos;t valid. Ask your dispatcher for a new one.
        </p>
      </>,
    );
  }
  const inviteEmail: string = preview.email;
  const organizationName: string = preview.organization_name;
  const invitedDisplayName: string = preview.display_name;

  if (preview.status !== "pending") {
    return shell(
      <>
        <h1 className={cn(typography.sectionHeading, "mb-2 text-text-primary")}>
          {preview.status === "accepted" ? "Already joined" : "Invite no longer available"}
        </h1>
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          {preview.status === "accepted"
            ? "This invite has already been used. If this is your account, just sign in."
            : "This invite has been revoked. Ask your dispatcher for a new one."}
        </p>
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
          You&apos;ve been invited to drive for {organizationName} as {invitedDisplayName}. Create your
          account to get started.
        </p>
        <JoinSignUpForm token={token} email={inviteEmail} />
        <p className={cn(typography.bodySmall, "mt-6 text-center text-text-secondary")}>
          Already have an account?{" "}
          <Link href={`/sign-in?next=${encodeURIComponent(`/join/${token}`)}`} className="font-medium text-text-link">
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
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          This invite is for <strong>{inviteEmail}</strong>, but you&apos;re signed in as <strong>{signedInEmail}</strong>.
          Sign out and sign back in with the invited email to continue.
        </p>
      </>,
    );
  }

  return shell(
    <>
      <h1 className={cn(typography.sectionHeading, "mb-1 text-text-primary")}>Join {organizationName}</h1>
      <p className={cn(typography.bodySmall, "mb-6 text-text-secondary")}>
        You&apos;re signed in as {signedInEmail}. Accept this invite to start receiving trips as {invitedDisplayName}.
      </p>
      <AcceptInviteButton token={token} />
    </>,
  );
}
