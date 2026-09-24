import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { isRequestFormHost, resolveRequestDomainRoute } from "@/lib/operations/website-requests-setup-core";

/**
 * Renamed from middleware.ts (P1-E3-S1A) — Next.js 16 deprecated the
 * `middleware` file/export convention in favor of `proxy`
 * (https://nextjs.org/docs/messages/middleware-to-proxy). On the app host
 * the behavior is unchanged: session refresh only, never route
 * authorization (that stays in src/lib/auth/*, evaluated server-side per
 * layout).
 *
 * Lives at src/proxy.ts, not the project root — this app's router is at
 * src/app, and Next.js resolves the proxy/middleware convention file
 * relative to wherever pages/app actually is, not the repo root itself.
 *
 * P1-COMM-D3 -- dedicated hosted-form host (REQUEST_FORM_ORIGIN, e.g. https://request.nemryn.com). On THAT host only a strict
 * allowlist is served: `/<publicKey>` (rewritten to the existing /request/<publicKey> page), the two public form API routes it
 * calls, and static assets. Every other path -- sign-in, operations, driver, embed, the website intake API, anything unknown --
 * is a neutral 404, so no dashboard or login surface exists there. No session is refreshed on that host. With
 * REQUEST_FORM_ORIGIN unset, nothing below changes behavior.
 */

// Public / static paths that never need a session refresh on the app host (the previous matcher exclusions, unchanged).
const NO_SESSION_PATH = /^\/(?:sw\.js$|driver\.webmanifest$|api\/ping$|offline$|request\/|embed\/|api\/public-forms\/)/;

// The same response headers the app host sets for /request/* in next.config.ts. Header rules match the INCOMING path, so a
// rewritten /<publicKey> would not inherit them: they are applied here explicitly.
const HOSTED_FORM_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
};

function neutralNotFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store", "X-Frame-Options": "DENY" },
  });
}

export async function proxy(request: NextRequest) {
  if (isRequestFormHost(request.headers.get("host"), process.env.REQUEST_FORM_ORIGIN)) {
    const route = resolveRequestDomainRoute(request.nextUrl.pathname);
    if (route.kind === "not_found") return neutralNotFound();
    if (route.kind === "passthrough") return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = route.rewrite;
    const response = NextResponse.rewrite(url);
    for (const [key, value] of Object.entries(HOSTED_FORM_HEADERS)) response.headers.set(key, value);
    return response;
  }

  if (NO_SESSION_PATH.test(request.nextUrl.pathname)) return NextResponse.next();
  return updateSession(request);
}

/**
 * Runs for every path except Next's static assets, image optimizer and images: the host check above must see public
 * paths too (on the request-form host they are allow-listed or 404). On the app host those public paths still skip the
 * session refresh via NO_SESSION_PATH, exactly as the previous matcher exclusions did.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
