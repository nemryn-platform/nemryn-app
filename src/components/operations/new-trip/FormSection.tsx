import type { ReactNode } from "react";
import { Panel, PanelHeader, PanelSection } from "@/components/ui/Panel";
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
  // NP-UI-P2: the shared card anatomy (PanelSection header with the 40px icon tile, a hairline, then the fields) and the
  // approved subtle raise, so New Trip / Log Request field groups read like the rest of Core. Same h2, same fields.
  return (
    <Panel padding="none" elevated className={cn("flex flex-col", className)}>
      <PanelSection part="header">
        <PanelHeader as="h2" icon={icon} tone="neutral" title={title} actions={action} />
      </PanelSection>
      <PanelSection part="body" className="flex flex-col gap-zw-lg py-zw-lg">
        {children}
      </PanelSection>
    </Panel>
  );
}
