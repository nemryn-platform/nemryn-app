import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { iconCircleClasses, iconToneClasses } from "./Panel";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /**
   * NP-UI-P1b: "compact" is the in-panel form — a short, left-aligned line instead of a tall centred block, so an
   * empty panel never becomes a large blank area. "default" (unchanged) is the page-level empty state.
   */
  size?: "default" | "compact";
}

/**
 * A real explanation of why a list/table is empty, and where relevant, the
 * next action to take — never a bare "No data".
 */
export function EmptyState({ icon, title, description, action, className, size = "default" }: EmptyStateProps) {
  if (size === "compact") {
    return (
      <div className={cn("flex items-start gap-3 rounded-sm bg-surface-app px-zw-md py-zw-sm", className)}>
        {icon && (
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-text-muted [&>svg]:size-4" aria-hidden>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>{title}</p>
          {description && <p className={cn(typography.metadata, "mt-0.5 text-text-secondary")}>{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    );
  }
  // NP-UI-V2-2: the Concept B icon anatomy -- the icon sits in a 45px mint circle (decorative; the title carries the
  // meaning), a calmer vertical rhythm and a readable line length for the explanation.
  return (
    <div className={cn("flex flex-col items-center gap-3 px-zw-lg py-zw-2xl text-center", className)}>
      {icon && (
        <div className={cn(iconCircleClasses.lg, iconToneClasses.accent, "[&>svg]:size-[1.375rem]")} aria-hidden>
          {icon}
        </div>
      )}
      <div className="max-w-md">
        <p className={cn(typography.subsectionHeading, "text-base text-text-primary")}>{title}</p>
        {description && (
          <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
