import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { requireOnboardingAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Onboarding shell (P1-E3-S9, work item §5/§15) — one small, calm,
 * centered column, not a giant enterprise wizard. Every step page renders
 * inside this same shell; the shell itself just confirms real auth/org
 * access once (reused by every step) and shows the organization name so
 * the person always knows which business they're setting up.
 */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const pathname = await getCurrentPathname("/onboarding");
  const organization = await requireOnboardingAccess(pathname);

  return (
    <div className="min-h-dvh bg-surface-secondary">
      <header className="border-b border-border-subtle bg-surface-elevated px-4 py-4">
        <div className="mx-auto flex max-w-md items-center justify-between">
          {/*
            N0-M2-A2-R1: approved Nemryn platform lockup. width/height
            reflect the SVG's own viewBox (0 0 434 127); the visual
            width stays w-32, unchanged from the prior interim mark,
            with h-auto deriving the correct non-distorted height.
          */}
          <Image
            src="/brand/nemryn-logo-primary.svg"
            alt="Nemryn"
            width={434}
            height={127}
            priority
            className="h-auto w-32"
          />
          <p className={cn(typography.metadata, "text-text-secondary")}>{organization.organizationName}</p>
        </div>
      </header>

      <main className="mx-auto flex max-w-md flex-col gap-zw-lg px-4 py-10">{children}</main>

      {/* P1-OPS-PROG3B: Business basics (step 1) is required within the guided
          flow -- no exit there. Steps 2–5 keep their own "Skip for now" plus
          this "Finish later" exit. */}
      {pathname !== "/onboarding/basics" && pathname !== "/onboarding" && (
        <div className="mx-auto max-w-md px-4 pb-10 text-center">
          <Link href="/operations" className={cn(typography.bodySmall, "text-text-secondary underline")}>
            Finish later — go to Operations
          </Link>
        </div>
      )}
    </div>
  );
}
