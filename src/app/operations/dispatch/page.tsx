import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { getDispatchBoardData } from "@/lib/operations/dispatch-board";
import { getOperatorLinkedDriverId } from "@/lib/operations/assignment-context";
import { SummaryStrip } from "@/components/ui/SummaryStrip";
import { EmptyState } from "@/components/ui/EmptyState";
import { DispatchBoardClient } from "@/components/operations/dispatch/DispatchBoardClient";
import { DispatchLiveRefresh } from "@/components/operations/dispatch/DispatchLiveRefresh";

/**
 * Dispatch Board (P1-E3-S5) —
 * docs/design/stitch/references/03-dispatch-board.png, treated as the
 * canonical visual specification. See docs/product/dispatch-board-data-map.md
 * for the full field-level rationale behind every value and every
 * omission on this screen (Driver Availability status pills, "Potential
 * timing conflict", "Pending Confirmation"/REVIEW cards, the day
 * navigator, "Dispatch Settings" — none have a real data source or a
 * defined product rule yet).
 */
export default async function DispatchBoardPage() {
  const pathname = await getCurrentPathname("/operations/dispatch");
  const organization = await requireOperationsAccess(pathname);

  let data: Awaited<ReturnType<typeof getDispatchBoardData>>;
  let operatorDriverId: string | null;
  try {
    [data, operatorDriverId] = await Promise.all([
      getDispatchBoardData(organization.organizationId, organization.organizationTimezone),
      getOperatorLinkedDriverId(organization.organizationId),
    ]);
  } catch {
    return (
      <EmptyState
        icon={<WarningCircle className="size-8" aria-hidden />}
        title="Couldn't load the Dispatch Board"
        description="Something went wrong loading today's trips and drivers. Try refreshing the page in a moment."
      />
    );
  }

  return (
    <div className="flex flex-col gap-zw-lg">
      <DispatchLiveRefresh />
      <SummaryStrip
        inline
        items={[
          { label: "open trips today", value: data.summary.todayCount },
          { label: "unassigned", value: data.summary.unassignedCount, tone: "warning", dot: true },
          { label: "active", value: data.summary.activeCount, dot: true },
          ...(data.summary.attentionCount > 0
            ? [{ label: "need attention", value: data.summary.attentionCount, tone: "warning" as const, dot: true }]
            : []),
        ]}
      />

      <DispatchBoardClient
        data={data}
        timezone={organization.organizationTimezone}
        operatorDriverId={operatorDriverId}
        canManageDriverSetup={organization.role === "organization_admin"}
      />
    </div>
  );
}
