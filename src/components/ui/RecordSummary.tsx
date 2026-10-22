import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { Panel, iconCircleClasses, iconToneClasses, type PanelTone } from "./Panel";

export interface RecordFact {
  label: string;
  /** A real value from the record; the caller supplies its own wording for "not set" (never a fabricated value). */
  value: ReactNode;
  /** Decorative Phosphor icon shown beside the label. */
  icon?: ReactNode;
  testId?: string;
}

export interface RecordSummaryProps {
  /** The record's own heading (passenger name, "Request"...): the h2 under the screen's one h1. */
  title: string;
  /** Status badge(s) beside the title. */
  status?: ReactNode;
  /** One quiet line under the title (date, who / when). */
  meta?: ReactNode;
  /** Decorative icon in the 45px circle (Concept B panel anatomy). */
  icon?: ReactNode;
  tone?: PanelTone;
  /** At-a-glance facts in a row under the title (2 columns on narrow widths, up to 4 on wide). */
  facts?: RecordFact[];
  /** Extra lines under the meta (a correction note, a blocked-action explanation). */
  children?: ReactNode;
  testId?: string;
}

/**
 * NP-UI-V2-2 record-detail summary: the record's identity, status and key facts in one raised panel directly under the
 * screen's display h1 -- Brand Lock v2 panel anatomy (radius 14, panel shadow, 45px icon circle). The title stays in
 * the Geist UI face: the display face is reserved for the screen's one h1 (Brand Lock v2 §2). Presentation only.
 */
export function RecordSummary({ title, status, meta, icon, tone = "accent", facts, children, testId }: RecordSummaryProps) {
  return (
    <Panel surface="raised" padding="none" data-testid={testId}>
      <div className="flex items-start gap-[0.8125rem] px-zw-lg py-zw-lg">
        {icon && (
          <span className={cn(iconCircleClasses.lg, iconToneClasses[tone])} aria-hidden>
            {icon}
          </span>
        )}
        <div className={cn("min-w-0 flex-1", icon && "pt-0.5")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className={cn(typography.pageTitleOperational, "break-words text-text-primary")}>{title}</h2>
            {status}
          </div>
          {meta && <div className={cn(typography.body, "mt-1 text-text-secondary")}>{meta}</div>}
          {children && <div className="mt-1.5 flex flex-col gap-1">{children}</div>}
        </div>
      </div>
      {facts && facts.length > 0 && (
        <dl
          className={cn(
            "grid grid-cols-2 border-t border-border-subtle",
            facts.length >= 4 ? "xl:grid-cols-4" : facts.length === 3 ? "lg:grid-cols-3" : "",
          )}
        >
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0 px-zw-lg py-zw-md" data-testid={fact.testId}>
              <dt className={cn(typography.metadata, "flex items-center gap-1.5 font-medium text-text-muted [&>svg]:size-3.5")}>
                {fact.icon && <span aria-hidden className="flex">{fact.icon}</span>}
                {fact.label}
              </dt>
              <dd className={cn(typography.subsectionHeading, "mt-1 break-words text-text-primary")}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
