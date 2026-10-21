"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatOperationsTime, humanizeExceptionType } from "@/lib/operations/presentation";
import { ReportIssueDialog } from "./ReportIssueDialog";
import { ResolveExceptionDialog } from "./ResolveExceptionDialog";
import type { TripDetailException } from "@/lib/operations/trip-detail";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface TripExceptionsPanelProps {
  tripId: string;
  openExceptions: TripDetailException[];
  timezone: string;
}

/**
 * "Trip Exceptions" (docs/design/stitch/references/02-trip-detail.png,
 * upgraded P1-E3-S8) — real open `trip_exceptions` rows only, never
 * manufactured from lateness/GPS/time thresholds (work item §16/§34 of
 * P1-E3-S6 — no such derivation exists anywhere in this codebase). Calm
 * empty state when nothing is open (work item §26 of P1-E3-S8). "Report
 * Issue" and "Resolve" are now real, working actions — the controlled
 * `report_trip_exception`/`resolve_trip_exception` RPCs (P1-E3-S6/S6A
 * had deliberately deferred both; see that migration's own header for
 * why a direct table write was not narrow enough to build against
 * safely).
 */
export function TripExceptionsPanel({ tripId, openExceptions, timezone }: TripExceptionsPanelProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const resolvingException = openExceptions.find((exception) => exception.id === resolvingId) ?? null;

  return (
    <Panel elevated>
      <h3 className={cn(typography.subsectionHeading, "text-text-primary")}>Trip Exceptions</h3>
      <div className="mt-zw-md">
        {openExceptions.length === 0 ? (
          <EmptyState title="No open exceptions" description="Nothing reported on this trip needs review." />
        ) : (
          <ul className="flex flex-col gap-zw-sm">
            {openExceptions.map((exception) => (
              <li key={exception.id} className="rounded-sm border border-warning-border bg-warning-bg px-zw-md py-zw-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className={cn(typography.bodySmall, "font-medium text-text-primary")}>
                    {exception.exceptionType ? humanizeExceptionType(exception.exceptionType) : "Exception"}
                  </p>
                  <span className={cn(typography.metadata, "shrink-0 text-text-muted")}>
                    {formatOperationsTime(exception.createdAt, timezone)}
                  </span>
                </div>
                {exception.description && (
                  <p className={cn(typography.bodySmall, "mt-1 text-text-secondary")}>{exception.description}</p>
                )}
                <div className="mt-zw-sm flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={() => setResolvingId(exception.id)}>
                    Resolve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button type="button" variant="outline" className="mt-zw-md w-full" onClick={() => setReportOpen(true)}>
        Report Issue
      </Button>

      {reportOpen && <ReportIssueDialog tripId={tripId} onClose={() => setReportOpen(false)} />}
      {resolvingException && (
        <ResolveExceptionDialog
          tripId={tripId}
          exceptionId={resolvingException.id}
          exceptionType={resolvingException.exceptionType}
          onClose={() => setResolvingId(null)}
        />
      )}
    </Panel>
  );
}
