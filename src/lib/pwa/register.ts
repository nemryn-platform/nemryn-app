"use client";

import { SERVICE_WORKER_PATH, SERVICE_WORKER_SCOPE } from "./pwa-core";

/**
 * Client-side service-worker plumbing for the Driver PWA (P1-PILOT-S5A).
 * Production only: in development the worker would cache unhashed dev chunks.
 */
export function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && process.env.NODE_ENV === "production";
}

export interface DriverWorkerHandle {
  /** Ask the waiting worker to take over; the caller reloads on `controllerchange`. */
  applyUpdate: () => void;
  unregister: () => void;
}

/**
 * Registers /sw.js with scope /driver. `onUpdateReady` fires when a NEW worker
 * has installed and is waiting behind an active one. Nothing is reloaded or
 * activated automatically -- the Driver decides (never mid-trip-action).
 */
export async function registerDriverWorker(onUpdateReady: () => void): Promise<DriverWorkerHandle | null> {
  if (!serviceWorkerSupported()) return null;
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: SERVICE_WORKER_SCOPE, updateViaCache: "none" });

  const watch = (worker: ServiceWorker | null) => {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) onUpdateReady();
    });
  };
  if (registration.waiting && navigator.serviceWorker.controller) onUpdateReady();
  watch(registration.installing);
  registration.addEventListener("updatefound", () => watch(registration.installing));

  // A Driver may keep the app open for hours: look for a new version when the app returns to the foreground.
  const check = () => {
    if (document.visibilityState === "visible") registration.update().catch(() => undefined);
  };
  document.addEventListener("visibilitychange", check);
  const timer = window.setInterval(check, 30 * 60 * 1000);

  let reloading = false;
  const onControllerChange = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

  return {
    applyUpdate: () => registration.waiting?.postMessage({ type: "SKIP_WAITING" }),
    unregister: () => {
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    },
  };
}

/** Fire-and-forget: tells the worker to drop anything that is not a public static asset (sign-out hygiene). */
export function notifyWorkerLogout(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: "LOGOUT" });
}

export const NETWORK_FAILURE_EVENT = "nemryn:network-failure";

/** A failed request tells the network indicator to re-check reachability now. */
export function reportNetworkFailure(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NETWORK_FAILURE_EVENT));
}
