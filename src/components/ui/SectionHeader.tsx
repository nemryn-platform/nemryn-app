import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface SectionHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** NP-UI-P1b: heading level (default h2) — pick the level that keeps the page outline from skipping. */
  as?: "h2" | "h3";
  /** NP-UI-P1b: "section" = type.app.sectionHeading (18px) for a page's major divisions; "card" (default, unchanged) = the 15px card title. */
  size?: "card" | "section";
  titleId?: string;
}

/**
 * Separates a section of content via typography and spacing, not a card.
 * Use inside a Panel, or directly on a page between grouped content.
 */
export function SectionHeader({ title, description, actions, className, as: Heading = "h2", size = "card", titleId }: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <Heading id={titleId} className={cn(size === "section" ? typography.sectionHeading : typography.subsectionHeading, "text-text-primary")}>
          {title}
        </Heading>
        {description && <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
