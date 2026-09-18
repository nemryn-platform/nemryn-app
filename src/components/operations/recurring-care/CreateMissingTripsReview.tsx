"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  bulkCreateMissingTripsAction,
  type BulkCreateMissingTripsState,
} from "@/app/operations/recurring-care/create-missing/actions";
import { occurrenceKey, summarizeBatchResults, type MissingOccurrenceRow } from "@/lib/operations/recurring-care-bulk-core";
import { formatServiceDateShortLabel, formatWallClockTime } from "@/lib/operations/presentation";
import { recurringArrangementErrorMessage, type RecurringArrangementErrorCode } from "@/lib/operations/recurring-arrangement-errors";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

const INITIAL_STATE: BulkCreateMissingTripsState = { status: "idle", results: [] };

interface ResultDetail {
  key: string;
  passengerDisplayName: string;
  serviceDateLabel: string;
  status: "CREATED" | "ALREADY_SCHEDULED" | "FAILED";
  errorMessage?: string;
}

export interface CreateMissingTripsReviewProps {
  rows: MissingOccurrenceRow[];
}

/**
 * Client selection + submission surface for the bulk missing-Trip review
 * (P1-PILOT-S2 §7-§9, §14, §18). Deliberately reuses the existing
 * `DataTable`'s own `render` contract for the Select column — no new
 * table primitive introduced. Default selection is every row present on
 * mount/refresh (§9); a render-time adjustment (the React-recommended
 * "derive state from a changed prop" pattern, not an effect) re-applies
 * that default whenever the server's own revalidated `rows` prop changes
 * shape (e.g. after a batch submission resolves some occurrences and
 * they drop out of the MISSING list) — this is also what makes a FAILED
 * occurrence, which stays MISSING, naturally reappear selected and
 * retry-ready with no bespoke retry code path.
 */
export function CreateMissingTripsReview({ rows }: CreateMissingTripsReviewProps) {
  const rowKeys = useMemo(() => rows.map((r) => occurrenceKey(r.arrangementId, r.serviceDate)), [rows]);
  const rowKeySignature = rowKeys.join("|");

  const [selected, setSelected] = useState<Set<string>>(() => new Set(rowKeys));
  const [selectionSignature, setSelectionSignature] = useState(rowKeySignature);
  if (rowKeySignature !== selectionSignature) {
    setSelectionSignature(rowKeySignature);
    setSelected(new Set(rowKeys));
  }

  const [state, formAction, pending] = useActionState(bulkCreateMissingTripsAction, INITIAL_STATE);
  const [resultDetails, setResultDetails] = useState<ResultDetail[] | null>(null);
  const [processedResults, setProcessedResults] = useState(state.results);
  const router = useRouter();

  // Render-time derivation, not an effect (mirrors the selection-reset
  // pattern above): `state.results` gets a new array reference exactly
  // once per resolved server-action call, so comparing references is
  // sufficient to run this exactly once per real result. Labels are
  // looked up against `rows` -- still the pre-refresh snapshot at this
  // point, since `rows` itself only changes on the LATER render caused
  // by `router.refresh()` in the effect below (§ "include enough
  // context... without exposing internal IDs").
  if (state.results !== processedResults) {
    setProcessedResults(state.results);
    if (state.status === "done") {
      const byKey = new Map(rows.map((r) => [occurrenceKey(r.arrangementId, r.serviceDate), r]));
      const details: ResultDetail[] = state.results.map((result) => {
        const key = occurrenceKey(result.arrangementId, result.serviceDate);
        const source = byKey.get(key);
        return {
          key,
          passengerDisplayName: source?.passengerDisplayName ?? "This ride",
          serviceDateLabel: formatServiceDateShortLabel(result.serviceDate || "—"),
          status: result.status,
          errorMessage: result.errorCode ? recurringArrangementErrorMessage(result.errorCode as RecurringArrangementErrorCode) : undefined,
        };
      });
      setResultDetails(details);
    }
  }

  useEffect(() => {
    if (state.status === "done") {
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.results]);

  const summary = state.status === "done" ? summarizeBatchResults(state.results) : null;
  const failedDetails = resultDetails?.filter((d) => d.status === "FAILED") ?? [];

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const columns: DataTableColumn<MissingOccurrenceRow>[] = [
    {
      key: "select",
      header: "",
      render: (row) => {
        const key = occurrenceKey(row.arrangementId, row.serviceDate);
        return (
          <input
            type="checkbox"
            name="occurrenceKey"
            value={key}
            checked={selected.has(key)}
            onChange={() => toggle(key)}
            aria-label={`Select ${row.passengerDisplayName} on ${formatServiceDateShortLabel(row.serviceDate)}`}
            className="size-4"
          />
        );
      },
    },
    {
      key: "date",
      header: "Date",
      render: (row) => <span>{formatServiceDateShortLabel(row.serviceDate)}</span>,
    },
    {
      key: "passenger",
      header: "Passenger",
      primary: true,
      render: (row) => (
        <Link href={`/operations/recurring-care/${row.arrangementId}`} className="hover:text-text-link hover:underline">
          {row.passengerDisplayName}
        </Link>
      ),
    },
    {
      key: "pickupTime",
      header: "Pickup time",
      render: (row) => <span>{formatWallClockTime(row.pickupTime)}</span>,
    },
    {
      key: "route",
      header: "Route",
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate">{row.pickupDescription}</span>
          <span aria-hidden className="text-text-disabled">
            →
          </span>
          <span className="truncate">{row.destinationDescription}</span>
        </span>
      ),
    },
  ];

  const selectedCount = selected.size;

  return (
    <form action={formAction} className="flex flex-col gap-zw-md">
      {summary && (
        <div className="rounded-md border border-border-subtle bg-surface-elevated px-zw-md py-zw-sm">
          <p className={cn(typography.body, "text-text-primary")}>
            {summary.total} {summary.total === 1 ? "ride" : "rides"} processed / {summary.created} {summary.created === 1 ? "trip" : "trips"} created
            {summary.alreadyScheduled > 0 && ` / ${summary.alreadyScheduled} already scheduled`}
            {summary.failed > 0 && ` / ${summary.failed} failed`}
          </p>
          {failedDetails.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {failedDetails.map((detail) => (
                <li key={detail.key} className={cn(typography.bodySmall, "flex items-center gap-2 text-critical-text")}>
                  <StatusBadge label="Not created" category="critical" />
                  <span>
                    {detail.passengerDisplayName} · {detail.serviceDateLabel} — {detail.errorMessage}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="text" size="sm" onClick={() => setSelected(new Set(rowKeys))} disabled={pending}>
            Select all
          </Button>
          <Button type="button" variant="text" size="sm" onClick={() => setSelected(new Set())} disabled={pending}>
            Clear all
          </Button>
        </div>
        <Button type="submit" variant="primary" loading={pending} disabled={pending || selectedCount === 0}>
          {pending ? "Creating…" : `Create ${selectedCount} ${selectedCount === 1 ? "trip" : "trips"}`}
        </Button>
      </div>

      <DataTable columns={columns} rows={rows} getRowId={(row) => occurrenceKey(row.arrangementId, row.serviceDate)} />
    </form>
  );
}
