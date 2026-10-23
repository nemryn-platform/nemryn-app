import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Forgot password" };

/**
 * Forgot-password entry point (P0-S2B). Same shell as /sign-in and
 * /sign-up (same card, same logo, same layout) — a third state of the
 * same small auth surface, not a new visual product. An already-
 * signed-in visitor is sent to `/`, matching those two pages.
 */
export default async function ForgotPasswordPage() {
  const user = await getUser();
  if (user) {
    redirect("/");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-app bg-canvas-glow px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-border-subtle bg-surface-elevated p-8 shadow-panel">
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

        <h1 className={cn(typography.displaySection, "mb-1.5 text-text-primary")}>Reset your password</h1>
        <p className={cn(typography.bodySmall, "mb-8 text-text-secondary")}>
          Enter the email address on your account and we&apos;ll send you a link to reset your password.
        </p>

        <ForgotPasswordForm />

        <p
          className={cn(
            typography.bodySmall,
            "mt-8 border-t border-border-subtle pt-6 text-center text-text-secondary",
          )}
        >
          Remembered your password?{" "}
          <Link href="/sign-in" className="inline-flex min-h-11 items-center font-medium text-text-link">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
