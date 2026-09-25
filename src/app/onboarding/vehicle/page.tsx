"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createVehicleAction } from "@/app/operations/fleet/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * First Vehicle (P1-E3-S9, work item §5/§7) — reuses the exact same
 * `createVehicleAction` the real Fleet screen uses, not a parallel
 * onboarding-only insert path. Safe to skip (work item §5: "Allow: Skip
 * for now — where safe").
 */
export default function OnboardingVehiclePage() {
  const [state, formAction, pending] = useActionState(createVehicleAction, { status: "idle" as const });
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.push("/onboarding/driver");
    }
  }, [state, router]);

  return (
    <>
      <div>
        <p className={cn(typography.metadata, "text-text-secondary")}>Step 2 of 5</p>
        <h1 className={cn(typography.sectionHeading, "mt-1 text-text-primary")}>Add your first vehicle</h1>
        <p className={cn(typography.bodySmall, "mt-2 text-text-secondary")}>
          A name you&apos;ll recognize on Dispatch — you can add more, and edit this, anytime under Fleet.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-zw-md">
        <Input label="Vehicle" name="label" required placeholder="e.g. Ford Transit 12" disabled={pending} />

        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            Couldn&apos;t save this vehicle. Check the name and try again.
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
          {pending ? "Saving…" : "Add Vehicle"}
        </Button>
        <Link href="/onboarding/driver" className={cn(typography.bodySmall, "text-center text-text-secondary underline")}>
          Skip for now
        </Link>
      </form>
    </>
  );
}
