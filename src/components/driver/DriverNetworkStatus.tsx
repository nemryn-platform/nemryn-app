"use client";

import { useEffect, useRef, useState } from "react";
import { WifiSlash, WifiHigh } from "@phosphor-icons/react/dist/ssr";
import { NETWORK_FAILURE_EVENT } from "@/lib/pwa/register";
import { OFFLINE_DEBOUNCE_MS, OFFLINE_PROBE_INTERVAL_MS, PING_PATH, RECONNECTED_VISIBLE_MS, type NetworkState } from "@/lib/pwa/pwa-core";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

async function reachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${PING_PATH}?t=${Date.now()}`, { method: "GET", cache: "no-store", credentials: "omit", signal: controller.signal });
    window.clearTimeout(timer);
    return res.status === 204 || res.ok;
  } catch {
    return false;
  }
}

/**
 * Restrained global network indicator for the Driver surface (P1-PILOT-S5A).
 *  - "Offline": shown after a short debounce (brief blips never flash a banner).
 *  - navigator.onLine is only a hint: recovery is confirmed by an actual reach of Nemryn
 *    (/api/ping), re-checked every few seconds while offline and immediately on
 *    an `online` event or after a failed request elsewhere in the app.
 *  - "Connected": a short confirmation, then gone.
 * Server errors (4xx/5xx) are a different thing and are never shown here.
 */
export function DriverNetworkStatus() {
  const [state, setState] = useState<NetworkState>("online");
  const offlineTimer = useRef<number | null>(null);
  const probeTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const stateRef = useRef<NetworkState>("online");

  useEffect(() => {
    const set = (next: NetworkState) => {
      stateRef.current = next;
      setState(next);
    };
    const clear = (ref: { current: number | null }) => {
      if (ref.current !== null) window.clearTimeout(ref.current);
      ref.current = null;
    };

    const scheduleProbe = () => {
      clear(probeTimer);
      probeTimer.current = window.setTimeout(async () => {
        if (await reachable()) recovered();
        else scheduleProbe();
      }, OFFLINE_PROBE_INTERVAL_MS);
    };
    const recovered = () => {
      clear(probeTimer);
      clear(offlineTimer);
      if (stateRef.current === "offline") {
        set("reconnected");
        clear(hideTimer);
        hideTimer.current = window.setTimeout(() => set("online"), RECONNECTED_VISIBLE_MS);
      }
    };
    const goOffline = () => {
      clear(offlineTimer);
      offlineTimer.current = window.setTimeout(() => {
        clear(hideTimer);
        set("offline");
        scheduleProbe();
      }, OFFLINE_DEBOUNCE_MS);
    };
    const onOnline = async () => {
      // The browser thinks it is back; confirm Nemryn is actually reachable before saying so.
      if (await reachable()) recovered();
      else if (stateRef.current === "offline") scheduleProbe();
      else goOffline();
    };
    const onFailure = async () => {
      if (!(await reachable())) goOffline();
    };

    if (!navigator.onLine) goOffline();
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener(NETWORK_FAILURE_EVENT, onFailure);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(NETWORK_FAILURE_EVENT, onFailure);
      clear(offlineTimer);
      clear(probeTimer);
      clear(hideTimer);
    };
  }, []);

  if (state === "online") return null;
  const offline = state === "offline";
  return (
    <div
      role="status"
      aria-live="polite"
      data-network-state={state}
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-4 py-2",
        offline ? "border-warning-border bg-warning-bg text-warning-text" : "border-success-border bg-success-bg text-success-text",
      )}
    >
      {offline ? <WifiSlash className="size-4 shrink-0" aria-hidden /> : <WifiHigh className="size-4 shrink-0" aria-hidden />}
      <p className={typography.bodySmall}>
        {offline ? (
          <>
            <span className="font-medium">Offline.</span> Trip updates require a connection.
          </>
        ) : (
          <span className="font-medium">Connected</span>
        )}
      </p>
    </div>
  );
}
