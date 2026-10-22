import type { ReactNode } from "react";
import { DesktopTower } from "@phosphor-icons/react/dist/ssr";
import { OperationsSidebar, type OperationsSidebarProps } from "./OperationsSidebar";
import { AppHeader, type AppHeaderProps } from "./AppHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export interface OperationsShellProps {
  sidebar: OperationsSidebarProps;
  header?: AppHeaderProps;
  children: ReactNode;
}

/**
 * The one OperationsShell: OperationsSidebar + AppHeader + PageContent.
 * Every operations route renders through this — do not build per-route
 * shell variants.
 *
 * Below the supported width (md, 768px) the sidebar has nowhere to go —
 * rather than silently disappear and leave an unusable page, the whole
 * shell swaps for an intentional guard state. No mobile dispatcher UI, no
 * hamburger drawer: the operations console is tablet/desktop only by
 * design (driver mobile use lives at /driver).
 */
export function OperationsShell({ sidebar, header, children }: OperationsShellProps) {
  return (
    <>
      {/* NP-UI-P1a (A3): below md the narrow-screen notice is the page's main LANDMARK (role="main"; the shell's own
          <main> is display:none there), so exactly one main landmark is exposed at every width. It is deliberately NOT a
          second <main> element: the shell's <main> stays the only one, so `main` selectors keep finding the content. */}
      <div role="main" className="flex h-dvh flex-col items-center justify-center bg-surface-app px-zw-lg text-center md:hidden">
        <EmptyState
          icon={<DesktopTower className="size-10" aria-hidden />}
          title="Operations"
          description="This workspace is designed for tablet and desktop use."
        />
      </div>
      <div className="hidden h-dvh bg-surface-app md:flex">
        <OperationsSidebar {...sidebar} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader {...header} />
          {/* NP-UI-P1b: page gutter 16px at tablet, 24px at desktop (lg), 32px on wide screens (xl); every page renders its own PageHeader (one h1).
              Brand Lock v2: the canvas carries Concept B's faint cool glow (decorative, `bg-canvas-glow`). */}
          <main className="flex-1 overflow-y-auto bg-canvas-glow px-zw-md py-zw-lg lg:px-zw-lg xl:px-zw-xl xl:py-zw-xl">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
