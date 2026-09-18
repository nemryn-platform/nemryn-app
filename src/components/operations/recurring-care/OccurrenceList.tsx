import { OccurrenceRow } from "./OccurrenceRow";
import { EmptyState } from "@/components/ui/EmptyState";
import type { RecurringOccurrence } from "@/lib/operations/recurring-care";

export interface OccurrenceListProps {
  arrangementId: string;
  occurrences: RecurringOccurrence[];
}

/**
 * Upcoming transportation (P1-E2-S1E §12) — the next 14 local dates, from
 * the existing Recurring Care Assurance result only. Non-pattern dates
 * are never padded in (the evaluator already omits them entirely); an
 * arrangement with zero pattern dates in the horizon (e.g. a just-ended
 * arrangement, or one whose pattern doesn't recur within the next 14
 * days) shows a calm, non-alarming empty state (§35) — never implied as
 * an error.
 */
export function OccurrenceList({ arrangementId, occurrences }: OccurrenceListProps) {
  if (occurrences.length === 0) {
    return (
      <div className="rounded-md border border-border-subtle bg-surface-elevated">
        <EmptyState title="No occurrences in the next 14 days." description="This arrangement's pattern doesn't fall within the current window." />
      </div>
    );
  }

  return (
    <ul className="rounded-md border border-border-subtle bg-surface-elevated">
      {occurrences.map((occurrence) => (
        <OccurrenceRow key={occurrence.serviceDate} arrangementId={arrangementId} occurrence={occurrence} />
      ))}
    </ul>
  );
}
