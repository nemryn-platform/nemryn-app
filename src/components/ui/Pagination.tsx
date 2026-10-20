import Link from "next/link";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";
import { pageItemRange, paginationRange } from "@/lib/ui/ui-core";

/**
 * URL-driven pager (NP-UI-P1a): a <nav aria-label="Pagination"> of real links (works without JavaScript; server pages
 * stay the source of truth). The current page has aria-current="page"; previous / next are disabled at the ends and
 * expose their direction in text. `hrefForPage` comes from the caller, so existing query parameters are preserved.
 */
export function Pagination({ page, totalPages, hrefForPage, totalItems, pageSize, label = "Pagination", className }: { page: number; totalPages: number; hrefForPage: (page: number) => string; totalItems?: number; pageSize?: number; label?: string; className?: string }) {
  if (totalPages <= 1 && totalItems === undefined) return null;
  const current = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const range = totalItems !== undefined && pageSize ? pageItemRange(current, pageSize, totalItems) : null;
  const linkBase = cn(typography.label, "inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-2");
  return (
    <nav aria-label={label} className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      {range ? (
        <p className={cn(typography.bodySmall, "text-text-secondary")}>
          Showing {range.from}–{range.to} of {totalItems}
        </p>
      ) : (
        <span />
      )}
      {totalPages > 1 && (
        <ul className="flex items-center gap-1">
          <li>
            {current > 1 ? (
              <Link href={hrefForPage(current - 1)} className={cn(linkBase, "text-text-link hover:bg-surface-hover")} rel="prev">
                <CaretLeft className="size-4" aria-hidden />
                <span>Previous</span>
              </Link>
            ) : (
              <span aria-disabled="true" className={cn(linkBase, "text-text-disabled")}>
                <CaretLeft className="size-4" aria-hidden />
                <span>Previous</span>
              </span>
            )}
          </li>
          {paginationRange(current, totalPages).map((p, i) =>
            p === "gap" ? (
              <li key={`gap-${i}`} aria-hidden className={cn(linkBase, "text-text-secondary")}>
                …
              </li>
            ) : (
              <li key={p}>
                <Link
                  href={hrefForPage(p)}
                  aria-current={p === current ? "page" : undefined}
                  aria-label={`Page ${p}`}
                  className={cn(linkBase, p === current ? "bg-action-primary-background text-action-primary-foreground" : "text-text-primary hover:bg-surface-hover")}
                >
                  {p}
                </Link>
              </li>
            ),
          )}
          <li>
            {current < totalPages ? (
              <Link href={hrefForPage(current + 1)} className={cn(linkBase, "text-text-link hover:bg-surface-hover")} rel="next">
                <span>Next</span>
                <CaretRight className="size-4" aria-hidden />
              </Link>
            ) : (
              <span aria-disabled="true" className={cn(linkBase, "text-text-disabled")}>
                <span>Next</span>
                <CaretRight className="size-4" aria-hidden />
              </span>
            )}
          </li>
        </ul>
      )}
    </nav>
  );
}
