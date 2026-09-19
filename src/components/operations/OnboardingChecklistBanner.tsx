import Link from "next/link";
import { CheckCircle, Circle } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/ui/Panel";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import type { OnboardingChecklist } from "@/lib/operations/onboarding-checklist";

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
 */
export function OnboardingChecklistBanner({ checklist }: { checklist: OnboardingChecklist | null }) {
  if (checklist === null || checklist.isComplete) {
    return null;
  }

  return (
    <Panel className="flex flex-col gap-zw-md">
      <div className="flex items-center justify-between">
        <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>Finish setting up</h2>
        <p className={cn(typography.metadata, "text-text-secondary")}>
          {checklist.completedCount} of {checklist.totalCount} complete
        </p>
      </div>
      <ul className="flex flex-wrap gap-zw-sm">
        {checklist.items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className={cn(
                typography.bodySmall,
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5",
                item.complete
                  ? "border-success-border bg-success-bg text-success-strong"
                  : "border-border-strong bg-surface-elevated text-text-secondary hover:border-selection-border",
              )}
            >
              {item.complete ? (
                <CheckCircle className="size-4" weight="fill" aria-hidden />
              ) : (
                <Circle className="size-4" aria-hidden />
              )}
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
