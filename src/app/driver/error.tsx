"use client";

import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { ShellStatePanel } from "@/components/ui/RouteState";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";

/** Error boundary inside the Driver shell (NP-UI-P1a, A5). Never shows the error message; never retries silently. */
export default function DriverError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ShellStatePanel
      testId="driver-error"
      icon={<WarningCircle className="size-10" aria-hidden />}
      title="This screen couldn't be loaded"
      reference={error.digest}
      actions={
        <>
          <Button type="button" size="lg" onClick={() => reset()}>
            Try again
          </Button>
          <LinkButton href="/driver" size="lg" variant="outline">
            Back to Today
          </LinkButton>
        </>
      }
    >
      <p role="alert">Something went wrong while loading this screen.</p>
    </ShellStatePanel>
  );
}
