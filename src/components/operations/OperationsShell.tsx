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
      <div className="flex h-dvh flex-col items-center justify-center bg-surface-app px-zw-lg text-center md:hidden">
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
          <main className="flex-1 overflow-y-auto px-4 py-zw-lg lg:px-6 lg:py-zw-xl">{children}</main>
        </div>
      </div>
    </>
  );
}
