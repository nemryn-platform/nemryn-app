"use client";

import { useActionState } from "react";
import { setBusinessStageAction, type OnboardingActionState } from "./actions";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: OnboardingActionState = { status: "idle" };

const STAGES = [
  { value: "starting", label: "Starting", description: "1–2 vehicles" },
  { value: "growing", label: "Growing", description: "3–10 vehicles" },
  { value: "established", label: "Established", description: "10+ vehicles" },
] as const;

/**
 * Business Stage (P1-E3-S9, work item §3) — the FIRST onboarding step
 * after signup. Controls onboarding emphasis only (work item §12's
 * progressive-complexity framing) — never weakens security, never forks
 * the schema, never a pricing input (work item §3's own explicit
 * prohibition).
 */
export default function BusinessStagePage() {
  const [state, formAction, pending] = useActionState(setBusinessStageAction, INITIAL_STATE);

  return (
    <>
      <div>
        <p className={cn(typography.metadata, "text-text-secondary")}>Step 1 of 6</p>
        <h1 className={cn(typography.sectionHeading, "mt-1 text-text-primary")}>How are you operating today?</h1>
        <p className={cn(typography.bodySmall, "mt-2 text-text-secondary")}>
          This just helps us tailor your setup — you can change it anytime.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-zw-md">
        <fieldset className="flex flex-col gap-zw-sm">
          <legend className="sr-only">Business stage</legend>
          {STAGES.map((stage) => (
            <label
              key={stage.value}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-border-strong bg-surface-elevated px-4 py-3 has-[:checked]:border-selection-border has-[:checked]:bg-brand-calm-mist/40"
            >
              <input
                type="radio"
                name="businessStage"
                value={stage.value}
                required
                disabled={pending}
                className="size-4 accent-action-primary-background"
              />
              <span>
                <span className={cn(typography.body, "block font-medium text-text-primary")}>{stage.label}</span>
                <span className={cn(typography.metadata, "text-text-secondary")}>{stage.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {state.status === "error" && (
          <p role="alert" className={cn(typography.bodySmall, "text-critical-text")}>
            {state.error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" loading={pending} disabled={pending} className="w-full">
          Continue
        </Button>
      </form>
    </>
  );
}
