import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: BreadcrumbItem[];
  actions?: ReactNode;
  /** Both variants render in Geist Sans (single-family, N0-M2-A1A); `variant` only selects the size/weight role — `pageTitleOperational` (app) vs `pageTitleMarketing` (marketing). */
  variant?: "operational" | "marketing";
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  variant = "operational",
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            className={cn(
              variant === "marketing" ? typography.pageTitleMarketing : typography.pageTitleOperational,
              "text-text-primary",
            )}
          >
            {title}
          </h1>
          {description && (
            <p className={cn(typography.body, "mt-1 text-text-secondary")}>{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
