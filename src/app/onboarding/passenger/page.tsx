"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addPassengerAction } from "@/app/operations/trips/new/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/** First Passenger (P1-E3-S9, work item §5) — reuses the real, existing `addPassengerAction`. Safe to skip. */
export default function OnboardingPassengerPage() {
  const [state, formAction, pending] = useActionState(addPassengerAction, { status: "idle" as const });
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.push("/operations/trips/new?onboarding=1");
    }
  }, [state, router]);

  return (
    <>
      <div>
        <p className={cn(typography.metadata, "text-text-secondary")}>Step 5 of 5</p>
        <h1 className={cn(typography.sectionHeading, "mt-1 text-text-primary")}>Add your first passenger</h1>
        <p className={cn(typography.bodySmall, "mt-2 text-text-secondary")}>
          The last step — then you&apos;ll create your first trip.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-zw-md">
        <Input label="Full Name" name="displayName" required placeholder="e.g. James Carter" disabled={pending} />
        <Input label="Phone" name="phone" type="tel" disabled={pending} />

        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            Couldn&apos;t add this passenger. Check the name and try again.
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
          {pending ? "Saving…" : "Add Passenger"}
        </Button>
        <Link href="/operations/trips/new?onboarding=1" className={cn(typography.bodySmall, "text-center text-text-secondary underline")}>
          Skip for now
        </Link>
      </form>
    </>
  );
}
