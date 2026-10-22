import { ListChecks } from "@phosphor-icons/react/dist/ssr";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { tripReadinessReasonLabel } from "@/lib/operations/presentation";
import type { TripReadinessResult } from "@/lib/operations/trip-readiness";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export interface TripReadinessPanelProps {
  /**
   * `null` for any Trip outside `state='scheduled'` (readiness is never
   * fetched for those — S4D §16), OR for a scheduled Trip whose readiness
   * fetch failed (paired with `unavailable`, S4D §24 error isolation).
   */
  readiness: TripReadinessResult | null;
  /** True only when a scheduled Trip's own readiness fetch threw — distinct from `readiness === null` for a non-scheduled Trip, which is a normal, silent "omit the block" case (S4D §16), not an error. */
  unavailable?: boolean;
}

/**
 * "Preparation" (P1-E1-S4D §17) — a small, SECONDARY panel, deliberately
 * restrained relative to Trip Assurance's own semantics. Trip Detail
 * currently surfaces the same underlying facts Trip Readiness draws on
 * through their OWN dedicated, already-existing panels:
 *   - `CurrentStatusPanel`'s "Assign Driver"/"Manage Assignment" link
 *     already reflects whether an active assignment exists.
 *   - `TripExceptionsPanel` already lists every open exception in full,
 *     with its own "Resolve" action.
 * This panel therefore never repeats those in an alarming, competing
 * banner: no AttentionState, no per-reason action button, no restatement
 * of exception type/description. It states the overall Prepared/Needs
 * preparation fact plus a plain reference list of reasons — a person who
 * wants to actually DO something about NEEDS_DRIVER/NEEDS_VEHICLE/
 * OPEN_EXCEPTION already has the real, working control for that
 * elsewhere on this exact page (S4D §18/§23's own "solve duplication in
 * presentation" instruction).
 *
 * Renders nothing for a non-scheduled Trip (`readiness === null` and
 * `unavailable` false) — never a "Not Applicable" badge (S4D §16).
 */
export function TripReadinessPanel({ readiness, unavailable = false }: TripReadinessPanelProps) {
  if (unavailable) {
    return (
      <Panel elevated>
        <PanelHeader title="Preparation" icon={<ListChecks className="size-5" />} />
        <p className={cn(typography.bodySmall, "mt-zw-sm pl-[3.25rem] text-text-muted")}>
          Preparation status isn&apos;t available right now.
        </p>
      </Panel>
    );
  }

  if (!readiness || readiness.state === "NOT_APPLICABLE") {
    return null;
  }

  const isReady = readiness.state === "READY";

  return (
    <Panel elevated>
      <PanelHeader
        title="Preparation"
        icon={<ListChecks className="size-5" />}
        tone={isReady ? "positive" : "attention"}
        actions={<StatusBadge label={isReady ? "Prepared" : "Needs preparation"} category={isReady ? "positive" : "warning"} />}
      />
      {isReady ? (
        <p className={cn(typography.bodySmall, "mt-zw-sm pl-[3.25rem] text-text-secondary")}>
          Prepared based on the information currently available.
        </p>
      ) : (
        <ul className="mt-zw-sm flex flex-col gap-1.5 pl-[3.25rem]">
          {readiness.reasons.map((reason) => (
            <li key={reason} className={cn(typography.bodySmall, "flex items-center gap-2 text-text-secondary")}>
              <span className="size-1.5 shrink-0 rounded-full bg-warning-strong" aria-hidden />
              {tripReadinessReasonLabel(reason)}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
