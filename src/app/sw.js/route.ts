import { buildServiceWorkerSource } from "@/lib/pwa/service-worker";

/**
 * The Driver service worker script (P1-PILOT-S5A). Generated per build so its
 * bytes change with every deployment -- that is what makes browsers detect an
 * update. Always revalidated; `Service-Worker-Allowed` is not widened (the
 * registration scope is /driver/, chosen by the client).
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(buildServiceWorkerSource(process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
