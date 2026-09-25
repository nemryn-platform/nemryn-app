"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createFacilityAction } from "@/app/operations/facilities/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/** First Facility (P1-E3-S9, work item §5/§8) — reuses the real `createFacilityAction`. Safe to skip. */
export default function OnboardingFacilityPage() {
  const [state, formAction, pending] = useActionState(createFacilityAction, { status: "idle" as const });
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.push("/onboarding/passenger");
    }
  }, [state, router]);

  return (
    <>
      <div>
        <p className={cn(typography.metadata, "text-text-secondary")}>Step 4 of 5</p>
        <h1 className={cn(typography.sectionHeading, "mt-1 text-text-primary")}>Add your first facility</h1>
        <p className={cn(typography.bodySmall, "mt-2 text-text-secondary")}>
          A clinic, dialysis center, or other location your trips connect to.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-zw-md">
        <Input label="Facility Name" name="name" required placeholder="e.g. Cascade Dialysis Center" disabled={pending} />
        <Input label="Address" name="addressLine1" placeholder="Street address" disabled={pending} />
        <div className="grid grid-cols-3 gap-zw-sm">
          <Input label="City" name="city" disabled={pending} />
          <Input label="State" name="state" disabled={pending} />
          <Input label="ZIP" name="postalCode" disabled={pending} />
        </div>

        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            Couldn&apos;t save this facility. Check the name and try again.
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
          {pending ? "Saving…" : "Add Facility"}
        </Button>
        <Link href="/onboarding/passenger" className={cn(typography.bodySmall, "text-center text-text-secondary underline")}>
          Skip for now
        </Link>
      </form>
    </>
  );
}
