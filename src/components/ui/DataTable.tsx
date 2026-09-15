import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  /** Marks the identity column (passenger name, trip ID) — rendered with primary text weight. */
  primary?: boolean;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedRowId?: string;
  emptyState?: ReactNode;
}

const alignClasses: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

/**
 * Compact, keyboard-accessible table. Rows stay rows — see the card rule in
 * interface-principles.md §1 before turning this into a card grid.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  selectedRowId,
  emptyState,
}: DataTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <div className="rounded-md border border-border-subtle bg-surface-elevated">{emptyState}</div>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle bg-surface-elevated">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border-subtle bg-surface-secondary">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  typography.tableHeader,
                  "px-zw-md py-zw-sm text-text-secondary",
                  alignClasses[column.align ?? "left"],
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((row) => {
            const rowId = getRowId(row);
            const isSelected = rowId === selectedRowId;
            const interactive = Boolean(onRowClick);

            return (
              <tr
                key={rowId}
                tabIndex={interactive ? 0 : undefined}
                onClick={interactive ? () => onRowClick?.(row) : undefined}
                onKeyDown={
                  interactive
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick?.(row);
                        }
                      }
                    : undefined
                }
                className={cn(
                  interactive && "cursor-pointer hover:bg-surface-hover focus-visible:bg-surface-hover",
                  isSelected && "bg-surface-hover border-l-2 border-l-selection-border",
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      typography.tableCell,
                      "px-zw-md py-zw-sm",
                      column.primary ? "text-text-primary" : "text-text-secondary",
                      alignClasses[column.align ?? "left"],
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
