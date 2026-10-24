"use client";

import Link from "next/link";
import { Tray, Plus } from "@phosphor-icons/react/dist/ssr";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LinkButton } from "@/components/ui/LinkButton";
import { deriveRequestReadiness } from "@/lib/operations/request-readiness-core";
import {
  requestStatusLabel,
  requestStatusCategory,
  requestReadinessLabel,
  requestReadinessTextClass,
  formatRequestAge,
  formatRequestServiceDate,
} from "@/lib/operations/presentation";
import type { RequestsListRow } from "@/lib/operations/requests-list";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface RequestsTableProps {
  rows: RequestsListRow[];
  /** True if a search term OR a non-default status view (anything but the default Pending-with-no-search) is currently applied — the signal that distinguishes empty-state C ("no MATCHES") from A/B ("no requests exist in this exact sense yet"). */
  hasActiveFilters: boolean;
  /** Whether this organization has EVER had any Request, regardless of the current view — the signal that distinguishes empty-state A (brand-new org) from B (caught up, but history exists). Meaningless/ignored when `hasActiveFilters` is true. */
  organizationHasAnyRequests: boolean;
  now: Date;
}

/**
 * The Request Hub queue table (P1-E1-S2D, row navigation added P1-E1-
 * S2E). `DataTable` is used WITHOUT its optional `onRowClick`: that prop
 * opens dialogs (`PassengersTable.tsx`), a different purpose entirely.
 *
 * NC-UX-01: the whole row opens Request Detail, through DataTable's
 * existing `navigableRows` (the Contacts / Estimates & Quotes pattern).
 * The passenger (or requester) name stays the row's one real link, marked
 * `data-row-link` — the only tab stop, opened with Enter, named by its
 * text; a click anywhere else on the row follows that same link. No
 * `tabIndex`/`onKeyDown` on the row, no redundant "View" button. A
 * client component only because the row's click handler lives in the
 * browser; rendering is unchanged.
 *
 * Status and Readiness are deliberately rendered with two visually
 * distinct treatments (§18) — Status as a `StatusBadge` pill (the
 * established lifecycle-state visual language), Readiness as plain
 * colored text with no pill/background — so the two concepts never
 * look like the same kind of thing, even though both appear in
 * adjacent columns.
 */
export function RequestsTable({ rows, hasActiveFilters, organizationHasAnyRequests, now }: RequestsTableProps) {
  const columns: DataTableColumn<RequestsListRow>[] = [
    {
      key: "passenger",
      header: "Passenger",
      primary: true,
      render: (row) => {
        if (row.passengerName) {
          return (
            <Link href={`/operations/requests/${row.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-text-link hover:underline" data-testid="request-row-link" data-row-link>
              {row.passengerName}
            </Link>
          );
        }
        return (
          <span className="flex flex-col">
            <Link href={`/operations/requests/${row.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-text-link hover:underline" data-testid="request-row-link" data-row-link>
              {row.requesterName}
            </Link>
            <span className={cn(typography.metadata, "text-text-muted")}>Passenger not linked</span>
          </span>
        );
      },
    },
    {
      key: "route",
      header: "Route",
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <span className="max-w-56 truncate">{row.pickupDescription}</span>
          <span aria-hidden className="text-text-disabled">
            →
          </span>
          <span className="max-w-56 truncate">{row.destinationDescription}</span>
        </span>
      ),
    },
    {
      key: "service",
      header: "Service",
      render: (row) => formatRequestServiceDate(row.preferredDate, row.preferredTime),
    },
    {
      key: "age",
      header: "Waiting",
      render: (row) => formatRequestAge(row.createdAt, now),
    },
    {
      key: "readiness",
      header: "Readiness",
      render: (row) => {
        const readiness = deriveRequestReadiness({
          state: row.state,
          passengerId: row.passengerId,
          passengerActive: row.passengerActive,
          hasLinkedTrips: row.hasLinkedTrips,
          hasActiveTrips: row.hasActiveTrips,
          hasLinkedArrangement: row.hasLinkedArrangement,
        });
        return <span className={cn(typography.bodySmall, "font-medium", requestReadinessTextClass(readiness))}>{requestReadinessLabel(readiness)}</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge label={requestStatusLabel(row.state)} category={requestStatusCategory(row.state)} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      navigableRows
      emptyState={
        hasActiveFilters ? (
          // Empty state C (P1-E1-S2D §21): a search term and/or a
          // non-default status view is active and matched nothing —
          // never indistinguishable from "no requests exist at all".
          <EmptyState
            icon={<Tray className="size-8" aria-hidden />}
            title="No requests match these filters"
            description="Try a different search term or clear the filters."
            action={
              <LinkButton href="/operations/requests" variant="outline">
                Clear filters
              </LinkButton>
            }
          />
        ) : organizationHasAnyRequests ? (
          // Empty state B: the default Pending view, no search — the
          // queue is genuinely caught up, but this organization has real
          // history (visible via the status tabs above this table).
          <EmptyState
            icon={<Tray className="size-8" aria-hidden />}
            title="Nothing needs review right now"
            description="Pending requests will appear here as they come in."
          />
        ) : (
          // Empty state A: a brand-new organization with zero Requests
          // ever logged — the ONLY empty state that offers the Log
          // Request action directly (it's also the page's own primary
          // action, per §4, but repeating it here answers "what do I do
          // right now" at the exact place someone lands with nothing yet).
          <EmptyState
            icon={<Tray className="size-8" aria-hidden />}
            title="No requests yet"
            description="Log Request records incoming transportation demand so it can be reviewed and converted into trips."
            action={
              <LinkButton href="/operations/requests/new" variant="outline" leadingIcon={<Plus className="size-4" aria-hidden />}>
                Log Request
              </LinkButton>
            }
          />
        )
      }
    />
  );
}
