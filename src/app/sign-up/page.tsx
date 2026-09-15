import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Sign up" };

/**
 * Sign-up (P1-E3-S9, work item §2) — an already-authenticated visitor is
 * sent to `/`, same as /sign-in. Mirrors SignInPage's own layout exactly
 * (same logo, same card shell) — sign-up and sign-in are the two halves
 * of one small auth surface, not visually distinct products.
 */
export default async function SignUpPage() {
  const user = await getUser();
  if (user) {
    redirect("/");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-brand-care-navy px-4 py-12">
      <div className="w-full max-w-sm rounded-md bg-surface-elevated p-8 shadow-sm">
        {/* N0-M2-A2-R1: approved Nemryn platform lockup — see SignInPage's own comment for the ratio rationale. */}
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

        <h1 className={cn(typography.sectionHeading, "mb-1 text-text-primary")}>Create your account</h1>
        <p className={cn(typography.bodySmall, "mb-6 text-text-secondary")}>
          Set up Nemryn for your transportation business.
        </p>

        <SignUpForm />

        <p className={cn(typography.bodySmall, "mt-6 text-center text-text-secondary")}>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-text-link">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
