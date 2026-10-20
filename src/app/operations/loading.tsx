import { PageSkeleton } from "@/components/ui/Skeleton";

/** Route-level loading state inside the Operations shell (NP-UI-P1a, C1). The shell, sidebar and header stay; only the
 * page content shows a neutral skeleton while the server component resolves. No fake data. */
export default function OperationsLoading() {
  return <PageSkeleton />;
}
