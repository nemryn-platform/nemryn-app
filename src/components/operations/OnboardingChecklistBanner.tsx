"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Icon } from "@phosphor-icons/react";
import { Buildings, CalendarPlus, Check, IdentificationCard, Path, Storefront, Users, Van } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import type { OnboardingChecklist } from "@/lib/operations/onboarding-checklist";

const STEP_ICONS: Record<OnboardingChecklist["items"][number]["key"], Icon> = {
  business: Storefront,
  vehicle: Van,
  driver: IdentificationCard,
  facility: Buildings,
  passenger: Users,
  trip: Path,
};

/**
 * Lightweight setup checklist (P1-E3-S9, work item §11) — visible only
 * until the business is operational (`isComplete`), then it simply stops
 * rendering; nothing is dismissed/hidden by a client-side flag that could
 * drift from reality. Every item's completion is derived live from real
 * data (`getOnboardingChecklist`) — never a persisted "80% complete"
 * value.
 *
 * `checklist === null` (P1-PILOT-S3R) means the underlying
 * `getOnboardingChecklist` fetch genuinely failed — this low-priority
 * banner is simply omitted in that case (never rendered as complete,
 * never rendered with a fabricated 0/6 count) rather than given its own
 * contained "unavailable" treatment, since it is not operationally
 * load-bearing.
 *
 * NP-UI-P1b (Concept B "Finish setting up"): the count, the progress segments and each step's done / not-done state
 * all come from the same real `checklist` — order and completion are never taken from the mockup. The progress is a
 * real progressbar (value + text); each step says "complete" / "not complete" in text, not by colour or icon alone.
 * The step list can be hidden for this page view ("Hide steps"); it is not a dismissal and is not remembered. No
 * decorative artwork or tagline (Brand Lock §17).
 */
export function OnboardingChecklistBanner({ checklist }: { checklist: OnboardingChecklist | null }) {
  const [expanded, setExpanded] = useState(true);
  const stepsId = useId();
  const titleId = useId();

  if (checklist === null || checklist.isComplete) {
    return null;
  }

  const { completedCount, totalCount } = checklist;
  const progressText = `${completedCount} of ${totalCount} complete`;

  return (
    <Panel elevated className="flex flex-col gap-zw-md" aria-labelledby={titleId} role="region" data-testid="setup-progress">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className={cn(typography.metadata, "font-medium text-text-muted")}>Workspace setup</p>
          <h2 id={titleId} className={cn(typography.sectionHeading, "mt-0.5 text-text-primary")}>
            Finish setting up
          </h2>
          <p className={cn(typography.bodySmall, "mt-0.5 text-text-secondary")}>Complete a few key steps to get your operations running.</p>
        </div>
        <div className="flex min-w-48 flex-col gap-1.5 sm:items-end">
          <p className={cn(typography.label, "text-text-primary")} data-testid="setup-progress-count">
            {progressText}
          </p>
          <div
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={totalCount}
            aria-valuenow={completedCount}
            aria-valuetext={progressText}
            className="flex w-48 gap-1"
          >
            {checklist.items.map((item) => (
              <span key={item.key} className={cn("h-1.5 flex-1 rounded-full", item.complete ? "bg-success-strong" : "bg-border-subtle")} />
            ))}
          </div>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={stepsId}
            onClick={() => setExpanded((v) => !v)}
            className={cn(typography.bodySmall, "font-medium text-text-link underline-offset-2 hover:underline")}
            data-testid="setup-progress-toggle"
          >
            {expanded ? "Hide steps" : "Show steps"}
          </button>
        </div>
      </div>
      <ul id={stepsId} hidden={!expanded} className="grid grid-cols-1 gap-zw-sm sm:grid-cols-2 xl:grid-cols-3">
        {checklist.items.map((item) => {
          const StepIcon = STEP_ICONS[item.key] ?? CalendarPlus;
          return (
            <li key={item.key} className="min-w-0">
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors duration-base",
                  item.complete ? "border-success-border/40 bg-success-bg" : "border-border-subtle bg-surface-elevated hover:border-border-strong hover:bg-surface-hover",
                )}
                data-testid="setup-step"
                data-complete={item.complete ? "true" : "false"}
              >
                <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated text-text-secondary" aria-hidden>
                  <StepIcon className="size-4" />
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border-2 border-surface-elevated",
                      item.complete ? "bg-success-strong text-white" : "bg-surface-secondary",
                    )}
                  >
                    {item.complete && <Check className="size-2.5" weight="bold" />}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className={cn(typography.bodySmall, "block truncate font-medium text-text-primary")}>{item.label}</span>
                  <span className={cn(typography.metadata, "block", item.complete ? "text-success-text" : "text-text-secondary")}>
                    {item.complete ? "Complete" : "Not complete"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
