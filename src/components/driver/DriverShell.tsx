import type { ReactNode } from "react";
import { DriverBottomNavigation } from "./DriverBottomNavigation";
import { DriverNetworkStatus } from "./DriverNetworkStatus";
import { DriverServiceWorker } from "./DriverServiceWorker";

export interface DriverShellProps {
  header?: ReactNode;
  children: ReactNode;
}

/**
 * DriverShell: DriverHeader (caller-supplied) + DriverContent + fixed
 * DriverBottomNavigation. Mobile-first, large touch targets throughout.
 *
 * The inner column is capped at max-w-md (28rem/448px, confirmed against
 * the compiled CSS — P1-E3-S2B, which fixed a --spacing-* vs --container-*
 * token collision that had silently made max-w-md compute to 16px at the
 * time this was originally written in P1-E3-S2; see
 * docs/reports/P1-E3-S2B-design-token-driver-visual-report.txt) and
 * centered — at the 390/430 primary target widths this is wider than the
 * viewport, so it has no visible effect; at tablet/desktop widths it keeps
 * the Driver surface intentionally compact (work item §5) rather than
 * stretching a mobile-designed single column full-bleed across a wide
 * screen. This is NOT the Operations desktop layout reused at a
 * breakpoint — Driver never gains a sidebar or multi-column composition at
 * any width.
 *
 * At `sm:` and up, a border is added alongside the existing shadow (P1-E3-
 * S2B, visual QA at 768/1024/1440 — docs/design/qa/driver-today/) so the
 * capped column reads as a deliberate panel rather than a plain edge-to-
 * edge rectangle floating on the page background. Matches this project's
 * own established "borders over shadows" panel convention (see Panel.tsx,
 * application-implementation-plan.md "Distinguishing visual
 * characteristics") rather than introducing a new decorative technique —
 * the shadow was already here; the border brings it in line with every
 * other panel in the design system. Full-bleed edge-to-edge at the 390/430
 * primary target widths is unchanged.
 */
export function DriverShell({ header, children }: DriverShellProps) {
  return (
    <div className="flex min-h-dvh justify-center bg-surface-secondary">
      <div className="flex h-dvh w-full max-w-md flex-col bg-surface-app sm:border sm:border-border-subtle sm:shadow-md">
        {header}
        {/* P1-PILOT-S5A: PWA runtime notices, in normal flow (never overlaying a trip action). */}
        <DriverServiceWorker />
        <DriverNetworkStatus />
        {/* overscroll-contain: an accidental pull-to-refresh in the installed app must not reload mid-action. */}
        <main className="flex-1 overflow-y-auto overscroll-y-contain px-4 py-zw-md">{children}</main>
        <DriverBottomNavigation />
      </div>
    </div>
  );
}
