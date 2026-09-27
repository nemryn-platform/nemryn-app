"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * P1-PILOT-R2B: re-read server truth when the driver comes back to this screen (tab / app becomes visible again,
 * or the window regains focus) -- so a dispatcher's Trip correction is never shown stale indefinitely. Uses the
 * existing router.refresh(); no polling, no push, no new data. At most one refresh per return.
 */
export function DriverRefreshOnFocus() {
  const router = useRouter();
  useEffect(() => {
    let last = 0;
    const refresh = () => {
      const now = Date.now();
      if (now - last < 1000) return; // visibilitychange + focus usually fire together
      last = now;
      router.refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [router]);
  return null;
}
