/**
 * Nemryn Driver PWA -- pure, import-free definitions (P1-PILOT-S5A).
 * Unit-tested under plain Node (pwa-core.test.mjs).
 *
 * The PWA is a delivery/runtime layer over the existing secure Driver domain.
 * It stores NO operational data: the only things it may cache are public static
 * assets (see service-worker.ts). Nothing here is tenant-specific.
 */

/** Identity. "Nemryn Driver" everywhere room allows; the home-screen label is the short brand-only "Nemryn" (never truncated by launchers). */
export const DRIVER_APP_NAME = "Nemryn Driver";
export const DRIVER_APP_SHORT_NAME = "Nemryn";
export const DRIVER_APP_DESCRIPTION = "Nemryn Driver: see your assigned trips and update them as you go.";

/** Existing Nemryn design-system values (public/brand/README.txt, globals.css). */
export const BRAND_GRAPHITE = "#171A1D";
export const SURFACE_APP = "#F7F7F4";

export const DRIVER_START_URL = "/driver";
export const DRIVER_MANIFEST_PATH = "/driver.webmanifest";
export const SERVICE_WORKER_PATH = "/sw.js";
/**
 * The worker controls only the Driver surface; Operations, Platform and auth pages never see it.
 * No trailing slash on purpose: a scope of "/driver/" would NOT cover the start page "/driver" itself.
 */
export const SERVICE_WORKER_SCOPE = "/driver";
export const OFFLINE_PATH = "/offline";

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

export interface DriverManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "any";
  background_color: string;
  theme_color: string;
  lang: string;
  dir: "ltr";
  prefer_related_applications: false;
  icons: ManifestIcon[];
}

/**
 * Deliberate choices:
 *  - start_url `/driver`, never a tenant URL: signed out, the normal auth
 *    redirect applies (sign-in -> `next=/driver`).
 *  - scope `/`: the sign-in / select-organization / confirmation pages a Driver
 *    passes through must stay inside the standalone window (an out-of-scope
 *    navigation would open a browser bar mid-flow).
 *  - orientation `any`: drivers mount phones landscape; foldables are near-square.
 */
export function buildDriverManifest(): DriverManifest {
  return {
    id: DRIVER_START_URL,
    name: DRIVER_APP_NAME,
    short_name: DRIVER_APP_SHORT_NAME,
    description: DRIVER_APP_DESCRIPTION,
    start_url: DRIVER_START_URL,
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: SURFACE_APP,
    theme_color: BRAND_GRAPHITE,
    lang: "en-US",
    dir: "ltr",
    prefer_related_applications: false,
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/**
 * Failure of the NETWORK (offline, DNS, dropped connection), as opposed to a
 * server answer. Used to keep "you're offline" separate from server errors, and
 * to make a failed lifecycle action an explicit, retryable failure.
 */
export function isNetworkFailure(error: unknown, navigatorOnline?: boolean): boolean {
  if (navigatorOnline === false) return true;
  if (!(error instanceof TypeError)) return false;
  return /failed to fetch|network ?error|load failed|networkerror|fetch failed|internet|offline/i.test(error.message);
}

export type NetworkState = "online" | "offline" | "reconnected";

/** Debounce before "Offline" is shown (ms): brief blips must not flash a banner. */
export const OFFLINE_DEBOUNCE_MS = 2000;
/** How long "Connected" stays visible after recovery. */
export const RECONNECTED_VISIBLE_MS = 3000;
/** Reachability re-check cadence while offline. */
export const OFFLINE_PROBE_INTERVAL_MS = 6000;
export const PING_PATH = "/api/ping";

/** True if the browser is running the installed app (display-mode: standalone, or iOS `navigator.standalone`). */
export function isStandaloneDisplay(matchesStandalone: boolean, iosStandalone: boolean | undefined): boolean {
  return matchesStandalone || iosStandalone === true;
}

/** iPhone/iPad (incl. iPadOS reporting as Mac with touch): the only platforms that need "Share -> Add to Home Screen" guidance. */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}
