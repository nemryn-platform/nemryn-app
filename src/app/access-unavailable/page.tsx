import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireUser } from "@/lib/auth/session";
import { signOutAction } from "@/lib/auth/sign-out-action";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Access unavailable" };

/**
 * Authenticated + zero active Memberships (work item §28). Calm, no
 * tenant information disclosed, sign-out is the only action offered.
 */
export default async function AccessUnavailablePage() {
  await requireUser("/sign-in");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-warning-bg text-warning-strong">
        <WarningCircle className="size-6" aria-hidden />
      </span>
      <h1 className={cn(typography.sectionHeading, "mb-2 text-text-primary")}>Access unavailable</h1>
      <p className={cn(typography.body, "mb-8 max-w-sm text-text-secondary")}>
        Your account does not currently have access to a Nemryn workspace. If you believe this is a mistake,
        contact your organization administrator.
      </p>
      <form action={signOutAction}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
}
