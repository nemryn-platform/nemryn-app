import { SkeletonText, Skeleton } from "@/components/ui/Skeleton";

/** Route-level loading state inside the Driver shell (NP-UI-P1a). Neutral placeholders only; no fake trip data. */
export default function DriverLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-zw-md p-zw-md" data-testid="driver-skeleton">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-40 w-full" />
      <SkeletonText lines={2} />
    </div>
  );
}
