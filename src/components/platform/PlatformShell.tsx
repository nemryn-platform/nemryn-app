import type { ReactNode } from "react";
import { signOutAction } from "@/lib/auth/sign-out-action";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";
import { PlatformNav } from "./PlatformNav";

/**
 * The Nemryn Platform control-plane shell. Deliberately NOT the tenant
 * workspace chrome: a top bar (no organization sidebar, no organization
 * switcher) that always says whose system this is, plus a standing notice that
 * this surface operates Nemryn -- it is not a way into any transportation
 * company's workspace.
 */
export function PlatformShell({ email, children }: { email: string | null; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-app">
      <header className="border-b border-chrome-border bg-chrome-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 lg:px-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <span className={cn(typography.subsectionHeading, "text-chrome-text-primary")}>Nemryn Platform</span>
              <span className={cn(typography.metadata, "rounded-full bg-warning-bg px-2 py-0.5 font-medium text-warning-text")}>Control plane</span>
            </div>
            <PlatformNav />
          </div>
          <div className="flex items-center gap-3">
            {email && <span className={cn(typography.metadata, "hidden break-all text-chrome-text-secondary sm:inline")}>{email}</span>}
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <div className="border-b border-warning-border bg-warning-bg">
        <p className={cn(typography.bodySmall, "mx-auto max-w-6xl px-4 py-2 text-warning-text lg:px-6")}>
          You are operating Nemryn, not a transportation company. This area shows platform health only — it does not open any organization&apos;s workspace or records.
        </p>
      </div>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-zw-lg px-4 py-zw-xl lg:px-6">{children}</main>
    </div>
  );
}
