import Image from "next/image";
import Link from "next/link";
import { getUser } from "@/lib/auth/session";
import { isSafeRedirectPath } from "@/lib/auth/redirect";
import { SignInForm } from "@/components/auth/SignInForm";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { redirect } from "next/navigation";

export const metadata = { title: "Sign in" };

/**
 * The smallest secure login foundation (work item §10/§12) — not an
 * authentication marketing page. An already-signed-in visitor is sent to
 * `/`, which resolves the real destination (role/org context) rather than
 * duplicating that resolution here.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getUser();
  if (user) {
    redirect("/");
  }

  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? params.next : undefined;
  const next = isSafeRedirectPath(nextParam) ? nextParam : undefined;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-brand-care-navy px-4 py-12">
      {/*
        P1-E3-S2A temporarily used max-w-[24rem] here because max-w-sm was
        silently hijacked by a project-defined --spacing-sm token (0.5rem)
        that collided with Tailwind's own --container-sm (24rem) — see
        globals.css and docs/reports/P1-E3-S2B-design-token-driver-visual-report.txt.
        P1-E3-S2B renamed the colliding tokens (--spacing-zw-* now), which
        restored max-w-sm to its correct, compiled 24rem value — confirmed
        directly from the compiled CSS before switching back to it here.
      */}
      <div className="w-full max-w-sm rounded-md bg-surface-elevated p-8 shadow-sm">
        {/*
          N0-M2-A2-R1: approved Nemryn platform lockup (locked artwork —
          not modified here). width/height reflect the SVG's own
          viewBox (0 0 434 127); the visual width stays w-60, unchanged
          from the prior interim mark, with h-auto deriving the correct
          non-distorted height from that ratio.
        */}
        <div className="mb-8 flex justify-center">
          <Image
            src="/brand/nemryn-logo-primary.svg"
            alt="Nemryn"
            width={434}
            height={127}
            priority
            className="h-auto w-60"
          />
        </div>

        <h1 className={cn(typography.sectionHeading, "mb-1 text-text-primary")}>Welcome back</h1>
        <p className={cn(typography.bodySmall, "mb-8 text-text-secondary")}>
          Sign in to continue to Nemryn.
        </p>

        <SignInForm next={next} />

        {/*
          P1-E4-S0A §4: a restrained divider (not just a bare margin) to
          separate the sign-in form from the sign-up affordance below it —
          the one deliberate visual refinement this pass makes, kept to a
          single subtle border rather than any new color/shadow/gradient.
        */}
        <p
          className={cn(
            typography.bodySmall,
            "mt-8 border-t border-border-subtle pt-6 text-center text-text-secondary",
          )}
        >
          New to Nemryn?{" "}
          <Link href="/sign-up" className="font-medium text-text-link">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
