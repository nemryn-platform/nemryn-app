import "server-only";
import { headers } from "next/headers";
import { resolveConfiguredOrigin, isLoopbackOrigin } from "./app-url-core";

/**
 * The application's own canonical absolute origin — for building links
 * that leave the app (e.g. a `/join/<token>` URL placed inside an
 * invitation email). Server-only.
 *
 * Resolution order:
 *   1. `NEXT_PUBLIC_APP_URL` — the established per-environment application
 *      URL (docs/deployment/environment-variable-inventory.md; declared in
 *      `.env.example`/`.env.local` and every Vercel environment, and
 *      explicitly reserved for exactly this "absolute URL inside an email"
 *      need), normalized through `resolveConfiguredOrigin`
 *      (`src/lib/app-url-core.ts` — see that file for exactly which
 *      malformed-URL cases this rejects). It is browser-safe (it names a
 *      location, not a credential), but this helper stays server-only
 *      because its only callers build links inside server-side email/
 *      notification code.
 *   2. The incoming request's forwarded host (`x-forwarded-proto` +
 *      `x-forwarded-host`, falling back to `host`) — a safety net for a
 *      deployment where step 1 was not set or was malformed. On the real
 *      deployment there is one canonical host at all times, so this and
 *      step 1 agree.
 *
 * Guards against `NEXT_PUBLIC_APP_URL` silently pointing a real deployment
 * at a loopback address (a plausible misconfiguration — copying a local
 * `.env` value into Vercel) — in that one case this throws instead of
 * emailing an unreachable link to a real driver.
 *
 * Never returns a trailing slash. Throws if no source yields a usable
 * origin, or if production resolves to a loopback address — both are
 * genuine misconfigurations worth failing loudly on when an invite is
 * about to be sent, rather than silently emailing a broken link.
 */
export async function getAppOrigin(): Promise<string> {
  const configured = resolveConfiguredOrigin(process.env.NEXT_PUBLIC_APP_URL);
  const origin = configured ?? (await originFromRequestHeaders());

  if (!origin) {
    throw new Error("Cannot determine the application origin: set NEXT_PUBLIC_APP_URL.");
  }

  if (process.env.NODE_ENV === "production" && isLoopbackOrigin(origin)) {
    throw new Error(
      `Refusing to build an application link from a loopback origin (${origin}) in production. ` +
        "Check NEXT_PUBLIC_APP_URL in this deployment's environment configuration.",
    );
  }

  return origin;
}

async function originFromRequestHeaders(): Promise<string | null> {
  const headerList = await headers();
  const forwardedHost = headerList.get("x-forwarded-host");
  const host = forwardedHost ?? headerList.get("host");
  if (!host) return null;

  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return resolveConfiguredOrigin(`${proto}://${host}`);
}

/**
 * The absolute URL an invited driver follows to accept an invite. The
 * token (a 122-bit random UUID) is the entire credential — nothing else
 * (organization id, driver id, email) is placed in the URL.
 */
export async function buildDriverInviteUrl(token: string): Promise<string> {
  const origin = await getAppOrigin();
  return `${origin}/join/${encodeURIComponent(token)}`;
}

/**
 * The absolute URL an invited staff member follows to accept a team
 * invitation (P1-PILOT-S4B-R4C). The token (256 random bits, hashed at rest)
 * is the entire credential -- nothing else (organization, role, email) is in
 * the URL.
 */
export async function buildStaffInviteUrl(token: string): Promise<string> {
  const origin = await getAppOrigin();
  return `${origin}/team-invite/${encodeURIComponent(token)}`;
}
