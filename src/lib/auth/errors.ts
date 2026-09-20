/**
 * Stable application-level auth error vocabulary (work item §48) — never a
 * raw Supabase/Postgres message or SQLSTATE surfaced to a user. Mirrors
 * the same design principle as the database's own ZW001-ZW006 contract
 * (docs/data/mutation-api.md): a small, named, stable set a UI can branch
 * on, never sentence-parsed.
 */
export const AUTH_ERROR = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  NO_ACTIVE_MEMBERSHIP: "NO_ACTIVE_MEMBERSHIP",
  ORG_CONTEXT_INVALID: "ORG_CONTEXT_INVALID",
  ROLE_FORBIDDEN: "ROLE_FORBIDDEN",
  DRIVER_LINK_MISSING: "DRIVER_LINK_MISSING",
  // P1-E3-S9 — signup-specific codes.
  SIGNUP_INVALID_INPUT: "SIGNUP_INVALID_INPUT",
  SIGNUP_WEAK_PASSWORD: "SIGNUP_WEAK_PASSWORD",
  SIGNUP_EMAIL_TAKEN: "SIGNUP_EMAIL_TAKEN",
  SIGNUP_FAILED: "SIGNUP_FAILED",
  INVITE_INVALID: "INVITE_INVALID",
  // P1-PILOT-S4B-R4A — first-run organization setup (/complete-signup/form).
  ORG_SETUP_INVALID_INPUT: "ORG_SETUP_INVALID_INPUT",
  ORG_SETUP_FAILED: "ORG_SETUP_FAILED",
  // P0-S2B — password-recovery-specific codes.
  FORGOT_PASSWORD_INVALID_EMAIL: "FORGOT_PASSWORD_INVALID_EMAIL",
  FORGOT_PASSWORD_FAILED: "FORGOT_PASSWORD_FAILED",
  RESET_PASSWORD_WEAK: "RESET_PASSWORD_WEAK",
  RESET_PASSWORD_MISMATCH: "RESET_PASSWORD_MISMATCH",
  RESET_PASSWORD_FAILED: "RESET_PASSWORD_FAILED",
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR)[keyof typeof AUTH_ERROR];

/** Safe, generic, user-facing copy — never distinguishes "no such account" from "wrong password" (work item §13). */
export const AUTH_ERROR_MESSAGE: Record<AuthErrorCode, string> = {
  INVALID_CREDENTIALS: "That email and password combination doesn't match our records.",
  SESSION_EXPIRED: "Your session has expired. Please sign in again.",
  NO_ACTIVE_MEMBERSHIP: "Your account does not currently have access to a Nemryn workspace.",
  ORG_CONTEXT_INVALID: "That organization is not available for your account.",
  ROLE_FORBIDDEN: "Your account does not have access to this area.",
  DRIVER_LINK_MISSING: "Your account is not yet linked to a driver profile.",
  SIGNUP_INVALID_INPUT: "Please fill in your name, email, password, and business name.",
  SIGNUP_WEAK_PASSWORD: "Please choose a password with at least 8 characters.",
  SIGNUP_EMAIL_TAKEN: "An account with that email already exists — try signing in instead.",
  SIGNUP_FAILED: "We couldn't complete sign-up. Please try again.",
  ORG_SETUP_INVALID_INPUT: "Enter your name and your organization's name to continue.",
  ORG_SETUP_FAILED: "We couldn't set up your organization. Please try again, or contact support if it keeps happening.",
  INVITE_INVALID: "This invite link is no longer valid — it may have been used already or revoked. Ask your dispatcher for a new one.",
  FORGOT_PASSWORD_INVALID_EMAIL: "Enter a valid email address.",
  FORGOT_PASSWORD_FAILED: "We couldn't process that request. Please try again shortly.",
  RESET_PASSWORD_WEAK: "Please choose a password with at least 8 characters.",
  RESET_PASSWORD_MISMATCH: "Those passwords don't match.",
  RESET_PASSWORD_FAILED: "We couldn't update your password. Please request a new reset link and try again.",
};
