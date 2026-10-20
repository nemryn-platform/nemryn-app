"use client";

import { PublicStateFrame } from "@/components/ui/RouteState";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";

/**
 * Route error boundary for pages outside the Operations / Driver shells (NP-UI-P1a, A5). Next.js handles redirect()
 * and notFound() itself -- they never reach this boundary. Never shows the error message (it may contain internal
 * detail); only the opaque digest as a support reference.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PublicStateFrame
      title="Something went wrong"
      testId="route-error"
      reference={error.digest}
      actions={
        <>
          <Button type="button" onClick={() => reset()} className="w-full justify-center">
            Try again
          </Button>
          <LinkButton href="/" variant="outline" className="w-full justify-center">
            Go to Nemryn
          </LinkButton>
        </>
      }
    >
      <p>This page couldn&apos;t be loaded. Try again, or come back in a moment.</p>
    </PublicStateFrame>
  );
}
