"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Icon } from "@phosphor-icons/react";
import { Buildings, CalendarPlus, CaretDown, CaretUp, Check, IdentificationCard, Path, Storefront, Users, Van } from "@phosphor-icons/react/dist/ssr";
import { IconButton } from "@/components/ui/IconButton";
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
 *
 * NP-UI-V2-1 (Brand Lock v2 §4, Concept B `.setup`): the hero surface — mint-to-white gradient, 31px display heading,
 * a teal segmented progress bar, and six 43px circular step marks with a check badge when done (an empty badge when
 * not). The steps, count, links and the disclosure are unchanged; only the presentation moved.
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
    <section
      className="@container relative flex flex-col gap-zw-lg rounded-lg border border-hero-border bg-surface-elevated bg-setup-hero px-zw-lg py-zw-lg shadow-hero sm:px-7 sm:pb-7"
      aria-labelledby={titleId}
      role="region"
      data-testid="setup-progress"
      id="setup"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 pr-10">
        <div className="min-w-0">
          <p className={cn(typography.metadata, "text-[0.625rem] font-bold uppercase tracking-[0.2em] text-text-secondary")}>Workspace setup</p>
          <h2 id={titleId} className={cn(typography.displaySetup, "mt-2 text-text-primary")}>
            Finish setting up
          </h2>
          <p className={cn(typography.body, "mt-1 text-text-secondary")}>Complete a few key steps to get your operations running.</p>
        </div>
        <div className="flex w-full max-w-[14.6875rem] flex-col gap-2.5 self-center sm:w-[14.6875rem]">
          <p className={cn(typography.metadata, "font-bold text-text-primary")} data-testid="setup-progress-count">
            {progressText}
          </p>
          <div
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={totalCount}
            aria-valuenow={completedCount}
            aria-valuetext={progressText}
            className="flex w-full gap-[5px]"
          >
            {checklist.items.map((item) => (
              <span key={item.key} className={cn("h-1.5 flex-1 rounded-full", item.complete ? "bg-success-strong bg-progress-done" : "bg-progress-track")} />
            ))}
          </div>
        </div>
      </div>
      <IconButton
        label={expanded ? "Hide steps" : "Show steps"}
        title={expanded ? "Hide steps" : "Show steps"}
        icon={expanded ? <CaretUp className="size-4" aria-hidden /> : <CaretDown className="size-4" aria-hidden />}
        aria-expanded={expanded}
        aria-controls={stepsId}
        onClick={() => setExpanded((v) => !v)}
        size="sm"
        className="absolute right-3 top-3 text-text-secondary hover:bg-surface-hover"
        data-testid="setup-progress-toggle"
      />
      <ul id={stepsId} hidden={!expanded} className="grid grid-cols-1 gap-[7px] @md:grid-cols-2 @xl:grid-cols-3 @5xl:grid-cols-6">
        {checklist.items.map((item) => {
          const StepIcon = STEP_ICONS[item.key] ?? CalendarPlus;
          return (
            <li key={item.key} className="min-w-0 @5xl:border-l @5xl:border-border-subtle @5xl:pl-3 @5xl:first:border-l-0 @5xl:first:pl-0">
              <Link
                href={item.href}
                className="flex items-center gap-[9px] rounded-sm px-0.5 py-[9px] transition-colors duration-base hover:bg-surface-elevated/60 motion-reduce:transition-none"
                data-testid="setup-step"
                data-complete={item.complete ? "true" : "false"}
              >
                <span
                  className={cn(
                    "relative flex size-[2.6875rem] shrink-0 items-center justify-center rounded-full border-[1.5px] bg-step-mark-background",
                    item.complete ? "border-step-mark-border text-text-link" : "border-border-strong/50 text-text-muted",
                  )}
                  aria-hidden
                >
                  <StepIcon className="size-5" />
                  <span
                    className={cn(
                      "absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-surface-elevated",
                      item.complete ? "bg-success-strong text-white" : "bg-surface-elevated ring-1 ring-inset ring-border-strong/70",
                    )}
                  >
                    {item.complete && <Check className="size-2.5" weight="bold" />}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className={cn(typography.metadata, "block font-semibold text-text-primary")}>{item.label}</span>
                  <span className={cn(typography.metadata, "block", item.complete ? "text-success-text" : "text-text-secondary")}>
                    {item.complete ? "Complete" : "Not complete"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
