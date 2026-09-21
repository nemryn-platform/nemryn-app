import path from "node:path";
import type { NextConfig } from "next";

/**
 * Build identity (P1-PILOT-S5A): the Vercel commit SHA in production builds, else a
 * build timestamp. It versions the Driver service worker so every deployment
 * produces a new worker script (browsers detect the update from the changed bytes).
 */
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 12) || `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  generateBuildId: async () => BUILD_ID,
  async headers() {
    return [
      // The Driver workspace is authenticated, per-user data: never stored by a browser
      // cache, an intermediary or bfcache (P1-PILOT-S5A cache policy).
      { source: "/driver/:path*", headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }] },
    ];
  },
  // Pin the workspace root explicitly: this project's git repo root is the
  // user's home directory (an unrelated pre-existing condition, not created
  // by this project — see /docs/product/product-definition.md §14), which
  // otherwise makes Next.js's root inference ambiguous.
  turbopack: {
    root: path.join(__dirname),
  },
  agentRules: false,
};

export default nextConfig;
