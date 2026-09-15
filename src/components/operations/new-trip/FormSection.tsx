import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface FormSectionProps {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The card-panel + icon + bold-title header pattern the canonical
 * reference (05-internal-new-trip.png) establishes for "Request Source"
 * and "Passenger" — extended here to the Schedule/Pickup/Destination/
 * Instructions & Assistance sections the reference itself doesn't show
 * (docs/design/stitch/stitch-reference-index.md's own note: "the form's
 * own remaining sections ... are not shown, so the full field set this
 * screen ultimately needs is incomplete information"). Reusing this exact
 * visual language for the missing-but-backend-required sections keeps the
 * page internally consistent rather than inventing a second, divergent
 * section style for the parts the mockup happened not to depict.
 */
export function FormSection({ icon, title, action, children, className }: FormSectionProps) {
  return (
    <Panel className={cn("flex flex-col gap-zw-lg", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-text-muted" aria-hidden>
            {icon}
          </span>
          <h2 className={cn(typography.subsectionHeading, "text-text-primary")}>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </Panel>
  );
}
