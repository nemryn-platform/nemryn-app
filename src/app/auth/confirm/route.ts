import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * P1-E4-S0A2 — the canonical Supabase Next.js SSR email-confirmation
 * callback. Required because the confirmation email's default link shape
 * (Supabase's own hosted `/auth/v1/verify?token=...&redirect_to=...`,
 * built from `{{ .ConfirmationURL }}`) redirects the browser with the new
 * session encoded in a URL FRAGMENT (`#access_token=...`) — a fragment is
 * never sent to any server, only readable by client-side JS, so a plain
 * Server Component landing page can never see it. This route instead
 * expects the email template to link HERE directly with `token_hash`/
 * `type` as ordinary query parameters (readable server-side — see
 * `docs/deployment/staging-auth-configuration.md` §Required Confirm
 * Signup email template for the exact template text this depends on),
 * and completes the exchange itself via `verifyOtp()` on the SERVER
 * Supabase client — which writes the real session cookie directly
 * (`createServerSupabaseClient()`'s cookie adapter, the same one every
 * Server Action already uses), before ever redirecting anywhere.
 *
 * A Route Handler, not a Server Component page — this endpoint MUTATES
 * (establishes a session) and then redirects; ZD-200 already found that
 * exact "Server Component redirect after an internal await" pattern
 * silently fails to be followed by the browser under some navigation
 * chains. A Route Handler's real HTTP redirect response is the
 * well-trodden path.
 *
 * Deliberately redirects to a FIXED destination (`/complete-signup`) on
 * success, never a caller-supplied `next` — there is no query parameter
 * here whose value ever reaches a redirect target, so there is no
 * open-redirect surface to validate in the first place. `/complete-
 * signup` itself (already idempotent — see ZD-201) is what actually
 * completes the pending operator-signup or Driver-invite continuation;
 * this endpoint's only job is turning a valid token into a real session.
 *
 * Never logs `token_hash` (a genuine, if short-lived, credential) — the
 * one console signal on failure names the REASON, never the value.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Built from the literal incoming request URL, not `request.nextUrl.
  // origin` — local testing found the latter can be silently normalized
  // by the dev server to a DIFFERENT host than the one actually
  // requested (e.g. "localhost" when the request came in on
  // "127.0.0.1"), which would redirect the browser to a host that never
  // received the session cookie this same response just set, discarding
  // it entirely. `request.url` has no such normalization. On the real
  // deployed app there is only one canonical host at all
  // (app.zenwardmobility.com), so this only ever mattered locally — but
  // building the redirect from the actual incoming request is strictly
  // more correct regardless of environment.
  const requestUrl = request.url;

  if (tokenHash && type) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (!error) {
      return NextResponse.redirect(new URL("/complete-signup", requestUrl));
    }
  }

  // Missing params, an expired/already-used token, or any other failure —
  // never a raw Supabase error surfaced to the visitor (same discipline
  // as every other auth error path in this codebase).
  return NextResponse.redirect(new URL("/auth/auth-code-error", requestUrl));
}
