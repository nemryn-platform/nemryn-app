import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Forgot password — Zenward Mobility" };

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
    <div className="flex min-h-dvh items-center justify-center bg-brand-care-navy px-4 py-12">
      <div className="w-full max-w-sm rounded-md bg-surface-elevated p-8 shadow-sm">
        <div className="mb-8 flex justify-center">
          <Image
            src="/images/zenward-mobility-logo.png"
            alt="Zenward Mobility"
            width={240}
            height={80}
            priority
            className="h-auto w-60"
          />
        </div>

        <h1 className={cn(typography.sectionHeading, "mb-1 text-text-primary")}>Reset your password</h1>
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
          <Link href="/sign-in" className="font-medium text-brand-interactive-teal">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
