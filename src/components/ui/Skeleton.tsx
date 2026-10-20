import { cn } from "@/lib/cn";

/**
 * Loading placeholders (NP-UI-P1a). Purely presentational: neutral `surface.secondary` blocks that pulse only when the
 * person has not asked for reduced motion (`motion-safe:`; globals.css also neutralises animation under
 * prefers-reduced-motion). Individual blocks are hidden from assistive technology; the region wrapping them
 * (`PageSkeleton`, or a caller's own `role="status"`) announces "Loading…" once.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block rounded-sm bg-surface-secondary motion-safe:animate-pulse", className)} />;
}

/** A few lines of text-height placeholders; the last line is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </span>
  );
}

/** Table-shaped placeholder (header row + rows) matching DataTable's frame. */
export function SkeletonTable({ rows = 5, columns = 4, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("overflow-hidden rounded-md border border-border-subtle bg-surface-elevated", className)}>
      <div className="flex gap-zw-md border-b border-border-subtle bg-surface-secondary px-zw-md py-zw-sm">
        {Array.from({ length: columns }, (_, c) => (
          <span key={c} className="h-3 flex-1 rounded-sm bg-border-subtle" />
        ))}
      </div>
      <div className="divide-y divide-border-subtle">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-zw-md px-zw-md py-zw-sm">
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton key={c} className="h-3 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Route-level loading layout (used by loading.tsx): a page-title block, a short summary row and a table. One polite
 * status announcement for screen readers; no fake data, counts or labels.
 */
export function PageSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-zw-lg" data-testid="page-skeleton">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-zw-md lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <SkeletonTable />
    </div>
  );
}
