import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "./env";
import type { Database } from "./database.types";

/**
 * P1-PILOT-S4B — the ONE privileged Supabase client in this codebase.
 * `import "server-only"` at the top of this file means Next.js's own
 * bundler throws a BUILD ERROR if any client component (or any module a
 * client component transitively imports) ever imports this file — a
 * compile-time guarantee, not merely a code-review convention. This is
 * deliberately its own dedicated file, separate from `server.ts`
 * (the ordinary per-request, cookie-based, publishable-key client every
 * authenticated Server Action already uses) and separate from `client.ts`
 * (the browser client, which is itself a "use client" module and could
 * never safely co-exist in the same file as a service-role credential
 * read).
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is read directly from `process.env` here,
 * intentionally NOT via the shared `getSupabaseUrl`/`getSupabasePublishableKey`
 * accessor pattern in `env.ts` — those two exist specifically because
 * their values are SAFE for the browser bundle (NEXT_PUBLIC_-prefixed);
 * mixing a privileged accessor into that same shared module would risk a
 * future call site treating it as equally safe by association. This
 * value bypasses Row Level Security ENTIRELY for anything it is used to
 * call.
 *
 * THE ONLY CALLER of `createServiceRoleSupabaseClient()` in this entire
 * codebase is `src/lib/public-intake/website-intake.ts`, and it is used
 * there to call ONLY two functions:
 * `check_and_record_public_intake_rate_limit` and
 * `submit_public_transportation_request` — both now restricted to
 * `service_role` by
 * supabase/migrations/20260919120000_public_intake_ingress_hardening.sql,
 * closing the direct-anon-RPC bypass P1-PILOT-S4A's own report flagged.
 * This is deliberately NOT a generic "admin database helper" — nothing
 * in this codebase uses this client for a raw table read/write, a
 * different RPC, or any purpose beyond those two calls. Every protection
 * those two functions enforce (tenant resolution, field bounds,
 * idempotency, rate limits, no-auto-Passenger, no-auto-Trip,
 * cross-tenant integrity) lives entirely inside the functions themselves
 * — this client is not, and must never become, a way to bypass that
 * authority from application code.
 *
 * Never returned in any HTTP response. Never logged (see
 * website-intake.ts's own safe, fixed-message logging). Never passed to
 * a client component. Never used to build a URL, header, or cookie value
 * a browser could observe.
 */
export function createServiceRoleSupabaseClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local and fill it in (server-only — see that file's own comment).",
    );
  }

  return createClient<Database>(getSupabaseUrl(), serviceRoleKey, {
    auth: {
      // No session to persist or refresh — this is a fixed, static
      // service-role credential, never a per-user session.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
