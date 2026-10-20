import Image from "next/image";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { typography } from "@/design/typography";

/**
 * Shared presentation for route-level not-found / error states (NP-UI-P1a). Two frames, no new branding:
 * - `PublicStateFrame`: the existing Nemryn-only auth frame (graphite ground, white card, the approved
 *   /brand/nemryn-logo-primary.svg lockup at its approved ratio -- the same treatment as sign-in / auth-code-error).
 * - `ShellStatePanel`: in-content state for routes inside the Operations shell (the shell itself stays).
 * Neither ever shows an internal error message: callers pass plain copy and, at most, the opaque error digest as a
 * support reference.
 */
export function PublicStateFrame({ title, children, actions, reference, testId }: { title: string; children: ReactNode; actions?: ReactNode; reference?: string; testId?: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-brand-care-navy px-4 py-12" data-testid={testId}>
      <div className="w-full max-w-sm rounded-md bg-surface-elevated p-8 shadow-sm">
        <div className="mb-8 flex justify-center">
          <Image src="/brand/nemryn-logo-primary.svg" alt="Nemryn" width={434} height={127} priority className="h-auto w-60" />
        </div>
        <h1 className={cn(typography.sectionHeading, "mb-2 text-text-primary")}>{title}</h1>
        <div className={cn(typography.bodySmall, "mb-8 text-text-secondary")}>{children}</div>
        {actions && <div className="flex flex-col gap-zw-md">{actions}</div>}
        {reference && <p className={cn(typography.metadata, "mt-6 text-text-muted")}>Reference: {reference}</p>}
      </div>
    </main>
  );
}

export function ShellStatePanel({ icon, title, children, actions, reference, testId }: { icon?: ReactNode; title: string; children: ReactNode; actions?: ReactNode; reference?: string; testId?: string }) {
  return (
    <section className="mx-auto flex max-w-lg flex-col items-center gap-zw-md py-zw-2xl text-center" data-testid={testId}>
      {icon && <span className="text-text-muted">{icon}</span>}
      <h1 className={cn(typography.pageTitleOperational, "text-text-primary")}>{title}</h1>
      <div className={cn(typography.body, "text-text-secondary")}>{children}</div>
      {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      {reference && <p className={cn(typography.metadata, "text-text-muted")}>Reference: {reference}</p>}
    </section>
  );
}
