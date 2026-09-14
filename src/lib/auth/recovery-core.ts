/**
 * Pure, framework-free validation helpers for the password-recovery flow
 * (P0-S2B). No `server-only`/`next/headers`/Supabase import — nothing
 * here touches a request, a cookie, a session, or a secret, so it is
 * directly unit-testable with plain Node
 * (`node --test src/lib/auth/recovery-core.test.mjs`), matching the same
 * pure-core/thin-wrapper split already used for `src/lib/app-url-core.ts`.
 *
 * Deliberately excludes any "does this account exist" concern — that
 * question is never asked anywhere in this module, by design (email-
 * enumeration protection lives at the Server Action layer, which must
 * return the identical neutral response regardless of what Supabase
 * itself reports — see `src/app/forgot-password/actions.ts`). This
 * module only validates INPUT SHAPE, which is safe to distinguish
 * without leaking anything about a specific account.
 */

/**
 * A deliberately loose, RFC-5322-adjacent shape check — enough to catch
 * "obviously not an email" input (empty, no `@`, whitespace) before ever
 * calling Supabase, without pretending to be a full validator (a real
 * mailbox check happens implicitly: if the address is wrong but
 * shape-valid, Supabase's own `resetPasswordForEmail` simply finds no
 * matching account and — per its own documented enumeration-safe
 * behavior — still reports success).
 */
const PLAUSIBLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return PLAUSIBLE_EMAIL_PATTERN.test(trimmed);
}

/** Matches the minimum password length enforced at sign-up (`src/app/sign-up/actions.ts`) — one consistent policy across every place this application sets a password. */
export const MIN_PASSWORD_LENGTH = 8;

export type NewPasswordValidation =
  | { valid: true }
  | { valid: false; reason: "weak" | "mismatch" };

/**
 * Validates a new-password submission's SHAPE only (length + match) —
 * never anything account-specific. Used identically by the client form
 * (immediate feedback) and the Server Action (the actual authority —
 * client-side validation is a convenience, never trusted alone).
 */
export function validateNewPassword(password: unknown, confirmPassword: unknown): NewPasswordValidation {
  const a = typeof password === "string" ? password : "";
  const b = typeof confirmPassword === "string" ? confirmPassword : "";

  if (a.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, reason: "weak" };
  }
  if (a !== b) {
    return { valid: false, reason: "mismatch" };
  }
  return { valid: true };
}
