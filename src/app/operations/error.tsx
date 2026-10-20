"use client";

import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { ShellStatePanel } from "@/components/ui/RouteState";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";

/**
 * Error boundary inside the Operations shell (NP-UI-P1a, A5 / C1). The shell stays, so the person can navigate away.
 * Next.js handles redirect() / notFound() before this boundary. The error message is never shown -- only the opaque
 * digest as a support reference. Nothing is retried automatically.
 */
export default function OperationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ShellStatePanel
      testId="operations-error"
      icon={<WarningCircle className="size-10" aria-hidden />}
      title="This page couldn't be loaded"
      reference={error.digest}
      actions={
        <>
          <Button type="button" onClick={() => reset()}>
            Try again
          </Button>
          <LinkButton href="/operations" variant="outline">
            Back to Overview
          </LinkButton>
        </>
      }
    >
      <p role="alert">Something went wrong while loading this page.</p>
    </ShellStatePanel>
  );
}
