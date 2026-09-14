import "server-only";

/**
 * The password-recovery "pending" cookie (P0-S2B).
 *
 * WHY THIS EXISTS: this codebase's confirmation-link pattern
 * (`src/app/auth/confirm/route.ts`) deliberately exchanges the Supabase
 * token SERVER-SIDE (a Route Handler calling `verifyOtp()`), matching
 * how `type=signup` already works here. That is what lets a plain
 * Server Component establish a session at all — but it also means the
 * BROWSER never runs Supabase's own client-side `onAuthStateChange`
 * listener for this exchange, so the `PASSWORD_RECOVERY` event Supabase
 * would normally fire (the standard, official way to distinguish "this
 * session exists because of a recovery link" from an ordinary sign-in)
 * is never observed here. This cookie is this application's own
 * server-side substitute for that same signal.
 *
 * IT IS NOT A CREDENTIAL. It carries no user id, no token, no secret —
 * just presence. Anyone holding it, without ALSO holding the real
 * Supabase session cookie, can do nothing with it; anyone holding a
 * real Supabase session, without this marker, still cannot reach the
 * password-change form on `/auth/reset-password` (see that route) —
 * deliberately, so a user who happens to already be signed in for an
 * unrelated reason (or a stale/foreign session) cannot land on the
 * reset form by guessing the URL. The actual authorization boundary for
 * "may this request change this account's password" remains Supabase's
 * own session validation (`getUser()` + `updateUser()`); this cookie
 * only gates whether the APPLICATION shows the form in the first place.
 *
 * Short-lived (10 minutes) — long enough to open a just-received email
 * and act on it, short enough to keep the marker's own window small.
 * Deliberately NOT cleared by the successful password-update action
 * itself — see that action's own doc comment for why (clearing it there
 * interacts badly with Next.js's automatic post-Server-Action route
 * refresh and can unmount the success view before it's ever seen).
 * Reuse of the underlying email link is prevented by Supabase's own
 * recovery token already being single-use, independent of this cookie;
 * this cookie's short, fixed lifetime is what bounds the window during
 * which `/auth/reset-password` is reachable at all.
 */
export const RECOVERY_COOKIE_NAME = "zw-recovery-pending";
export const RECOVERY_COOKIE_MAX_AGE_SECONDS = 600;

export const RECOVERY_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
