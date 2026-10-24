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
  /**
   * ACTION rows (for example "open the edit dialog"). NP-UI-P1a: the primary cell becomes a real <button> (the keyboard /
   * screen-reader path, named by its text plus `rowActionLabel`); a mouse click anywhere on the row still runs it.
   */
  onRowClick?: (row: T) => void;
  /** Visually hidden verb prefixed to an action row's button name, e.g. (row) => "Edit" -> "Edit Ana Ruiz". */
  rowActionLabel?: (row: T) => string;
  /**
   * NAVIGATION rows (NP-UI-P1a): each row renders its own real link marked `data-row-link` (usually in the primary
   * cell). That link is the only tab stop; a click anywhere else on the row follows the same link (with the click's
   * modifier keys; not after a text selection). Destinations come from the caller's link -- the table never invents one.
   */
  navigableRows?: boolean;
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
 *
 * NP-UI-P1a row semantics: a clickable <tr tabIndex=0> was announced as a plain row, with no role or name. Now
 * interactive rows expose a real control instead -- a link (`navigableRows`) or a button (`onRowClick`) -- and the
 * row itself is not a separate tab stop. Mouse behaviour and destinations are unchanged.
 */
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=checkbox],[role=switch]";
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  rowActionLabel,
  navigableRows = false,
  selectedRowId,
  emptyState,
}: DataTableProps<T>) {
  const primaryKey = (columns.find((c) => c.primary) ?? columns[0])?.key;
  if (rows.length === 0 && emptyState) {
    return <div className="rounded-md border border-border-subtle bg-surface-elevated shadow-sm">{emptyState}</div>;
  }

  return (
    // NP-UI-P2 table readability: the approved subtle raise, a quiet header row on the app canvas tone, 10px row
    // padding, the primary column in medium weight; numbers align (tabular) when a column is right-aligned.
    <div className="overflow-x-auto rounded-md border border-border-subtle bg-surface-elevated shadow-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border-subtle bg-surface-app">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  typography.tableHeader,
                  "whitespace-nowrap px-zw-md py-2.5 text-text-secondary",
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
            const interactive = navigableRows || Boolean(onRowClick);

            return (
              <tr
                key={rowId}
                onClick={
                  interactive
                    ? (event) => {
                        const target = event.target as HTMLElement;
                        // a real control inside the row handles its own click
                        const hit = target.closest(INTERACTIVE);
                        if (hit && hit !== event.currentTarget && event.currentTarget.contains(hit)) return;
                        if (navigableRows) {
                          // NC-UX-01: finishing a text selection in the row is not a click to open it
                          const selection = window.getSelection();
                          if (selection && !selection.isCollapsed && selection.containsNode(event.currentTarget, true)) return;
                          // the same click on the row's link, modifier keys included, so Cmd / Ctrl / Shift-click
                          // opens a new tab or window exactly as it would on the link itself
                          event.currentTarget.querySelector<HTMLAnchorElement>("a[data-row-link]")?.dispatchEvent(
                            new MouseEvent("click", { bubbles: true, cancelable: true, view: window, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey }),
                          );
                        } else onRowClick?.(row);
                      }
                    : undefined
                }
                className={cn(
                  interactive && "cursor-pointer hover:bg-surface-hover focus-within:bg-surface-hover",
                  isSelected && "bg-surface-hover border-l-2 border-l-selection-border",
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      typography.tableCell,
                      "px-zw-md py-2.5 align-middle",
                      column.primary ? "font-medium text-text-primary" : "text-text-secondary",
                      column.align === "right" && "tabular-nums",
                      alignClasses[column.align ?? "left"],
                    )}
                  >
                    {onRowClick && !navigableRows && column.key === primaryKey ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRowClick(row);
                        }}
                        className="-mx-1 rounded-xs px-1 text-left font-[inherit] text-inherit underline-offset-2 hover:underline"
                        data-row-action
                      >
                        {rowActionLabel && <span className="sr-only">{rowActionLabel(row)} </span>}
                        {column.render(row)}
                      </button>
                    ) : (
                      column.render(row)
                    )}
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
