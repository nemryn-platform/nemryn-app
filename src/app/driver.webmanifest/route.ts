import { buildDriverManifest } from "@/lib/pwa/pwa-core";

/** Public, tenant-free web app manifest for the Nemryn Driver PWA (P1-PILOT-S5A). */
export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(buildDriverManifest()), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, must-revalidate",
    },
  });
}
