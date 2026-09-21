import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Renamed from middleware.ts (P1-E3-S1A) — Next.js 16 deprecated the
 * `middleware` file/export convention in favor of `proxy`
 * (https://nextjs.org/docs/messages/middleware-to-proxy). Behavior is
 * unchanged: session refresh only, never route authorization (that stays
 * in src/lib/auth/*, evaluated server-side per layout).
 *
 * Lives at src/proxy.ts, not the project root — this app's router is at
 * src/app, and Next.js resolves the proxy/middleware convention file
 * relative to wherever pages/app actually is, not the repo root itself.
 * The original middleware.ts (P1-E3-S1) was placed at the project root,
 * one level too high for this project's src/ layout, so it was silently
 * never discovered by the build (confirmed via direct inspection of
 * next/dist/build/index.js's rootDir computation — see the P1-E3-S1A
 * report). Moved here as part of this phase's compatibility audit.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

/**
 * Excludes static assets, Next's image optimizer, and favicon (work item
 * §32 from P1-E3-S1) — no reason to run a session-refresh + Supabase round
 * trip for requests that never render authenticated content. Unchanged by
 * this rename.
 */
export const config = {
  // P1-PILOT-S5A: the service worker script, the manifest, the reachability probe and the public
  // offline page are static/public and must not pay a session-refresh round trip.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw\\.js$|driver\\.webmanifest$|api/ping$|offline$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
