import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { iconCircleClasses, iconToneClasses, type PanelTone } from "./Panel";

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
  /**
   * NP-UI-V2-2/3: an optional decorative Phosphor icon in the 40px circle -- the same Brand Lock v2 panel anatomy as
   * PanelHeader, so a section title inside a Panel reads like every other v2 panel. Omitted = unchanged.
   */
  icon?: ReactNode;
  /** Semantic tint of the icon circle (PanelHeader tones). "attention" / "critical" only for something that needs it. */
  tone?: PanelTone;
}

/**
 * Separates a section of content via typography and spacing, not a card.
 * Use inside a Panel, or directly on a page between grouped content.
 */
export function SectionHeader({ title, description, actions, className, as: Heading = "h2", size = "card", titleId, icon, tone = "neutral" }: SectionHeaderProps) {
  const single = !description;
  return (
    <div className={cn("flex flex-wrap justify-between gap-x-4 gap-y-2", icon && single ? "items-center" : "items-start", className)}>
      <div className={cn("flex min-w-0 gap-3", icon && single ? "items-center" : "items-start")}>
        {icon && (
          <span className={cn(iconCircleClasses.md, iconToneClasses[tone], "[&>svg]:size-5")} aria-hidden>
            {icon}
          </span>
        )}
        <div className={cn("min-w-0", icon && !single && "pt-0.5")}>
          <Heading id={titleId} className={cn(size === "section" ? typography.sectionHeading : typography.subsectionHeading, "text-text-primary")}>
            {title}
          </Heading>
          {description && <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
