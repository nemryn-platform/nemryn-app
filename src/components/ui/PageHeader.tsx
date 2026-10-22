import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  breadcrumb?: BreadcrumbItem[];
  /** Page actions, in reading order: secondary first, the one primary action last (rightmost). */
  actions?: ReactNode;
  /** "operational" (default) = the Brand Lock v2 display h1 (Newsreader, `typography.displayPage`, D-1); "marketing" = the Geist marketing title role. */
  variant?: "operational" | "marketing";
  /**
   * NP-UI-P1b: "compact" is for a detail screen whose own record heading (an h2 in the page, e.g. the passenger
   * name) carries the visual weight: the h1 names the screen ("Trip Detail") as a quiet label above it.
   */
  size?: "default" | "compact";
  className?: string;
  testId?: string;
}

/**
 * The one page title of a screen: exactly one <h1> per view (NP-UI-P1b canonical title system — the shell's context
 * header never renders a heading). Title + description on the left, the page's own actions on the right; the actions
 * wrap under the title on narrow widths instead of squeezing it.
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  variant = "operational",
  size = "default",
  className,
  testId,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid={testId}>
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1
            className={cn(
              size === "compact"
                ? cn(typography.label, "text-text-secondary")
                : variant === "marketing"
                  ? typography.pageTitleMarketing
                  : typography.displayPage,
              size !== "compact" && "text-text-primary",
            )}
          >
            {title}
          </h1>
          {description && <p className={cn(typography.body, "mt-1 text-text-secondary")}>{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
