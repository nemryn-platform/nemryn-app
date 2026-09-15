import { requireUser } from "@/lib/auth/session";
import { resolveOrganizationContext } from "@/lib/auth/organization";
import { redirect } from "next/navigation";
import { CompleteSignupForm } from "@/components/auth/CompleteSignupForm";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Complete your account" };

/**
 * P1-E4-S0A1 §9 — the explicit, user-initiated recovery form. Reached
 * ONLY via `/complete-signup` (the Route Handler), which already tried
 * every automatic continuation (driver invite redemption, pending
 * operator signup metadata) and found nothing to complete. This page
 * itself performs no mutation and no automatic redirect chain — it is a
 * plain render, avoiding the exact "Server Component redirect after an
 * internal await" pattern that motivated moving the routing logic to a
 * Route Handler in the first place (see complete-signup/route.ts). The
 * one safety check it keeps is a pure, non-mutating re-resolution: if
 * this person already has a Membership (a race, or they navigated back
 * here after already completing), send them on rather than showing a
 * pointless form.
 */
export default async function CompleteSignupFormPage() {
  const user = await requireUser("/sign-in");

  const resolution = await resolveOrganizationContext();
  if (resolution.status === "select-required") {
    redirect("/select-organization");
  }
  if (resolution.status !== "none") {
    redirect(resolution.context.role === "driver" ? "/driver" : "/operations");
  }

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const prefillFullName = typeof metadata.pending_full_name === "string" ? metadata.pending_full_name : "";
  const prefillBusinessName =
    typeof metadata.pending_business_name === "string" ? metadata.pending_business_name : "";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-brand-care-navy px-4 py-12">
      <div className="w-full max-w-sm rounded-md bg-surface-elevated p-8 shadow-sm">
        <h1 className={cn(typography.sectionHeading, "mb-1 text-text-primary")}>Complete your organization setup</h1>
        <p className={cn(typography.bodySmall, "mb-8 text-text-secondary")}>
          We couldn&apos;t automatically finish setting up your business after signup. Enter these details to
          continue — your account ({user.email}) is already confirmed.
        </p>
        <CompleteSignupForm defaultFullName={prefillFullName} defaultBusinessName={prefillBusinessName} />
      </div>
    </div>
  );
}
