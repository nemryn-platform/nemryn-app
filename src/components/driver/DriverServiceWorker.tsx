"use client";

import { useEffect, useRef, useState } from "react";
import { registerDriverWorker, type DriverWorkerHandle } from "@/lib/pwa/register";
import { Button } from "@/components/ui/Button";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Registers the Driver service worker and shows a quiet "new version" notice
 * (P1-PILOT-S5A). The update is applied ONLY when the Driver taps Update; the app
 * never reloads by itself, so a trip action is never interrupted.
 */
export function DriverServiceWorker() {
  const [updateReady, setUpdateReady] = useState(false);
  const handle = useRef<DriverWorkerHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    registerDriverWorker(() => setUpdateReady(true))
      .then((h) => {
        if (cancelled) h?.unregister();
        else handle.current = h;
      })
      .catch(() => undefined); // the app works without the worker
    return () => {
      cancelled = true;
      handle.current?.unregister();
    };
  }, []);

  if (!updateReady) return null;
  return (
    <div role="status" className="flex shrink-0 items-center justify-between gap-3 border-b border-info-border bg-info-bg px-4 py-2">
      <p className={cn(typography.bodySmall, "text-info-text")}>A new version of Nemryn is available.</p>
      <Button type="button" size="sm" variant="outline" onClick={() => handle.current?.applyUpdate()}>
        Update
      </Button>
    </div>
  );
}
