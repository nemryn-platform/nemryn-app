import "server-only";

/**
 * The application's single server-side transactional-email boundary.
 *
 * Design constraints (G0-R3; standardized on the Nemryn platform sender,
 * P0-S2A-WL-RB):
 *   - Initiated server-side only. No provider credential, no privileged
 *     key, ever reaches browser code — this module is `server-only` and
 *     the API key is read from a NON-`NEXT_PUBLIC_` variable.
 *   - Returns an EXPLICIT, discriminated delivery result. Callers never
 *     see a raw provider error; they get `sent` / `failed` /
 *     `not_configured` and decide what to tell the operator.
 *   - Provider errors and secrets are never surfaced to the browser and
 *     never logged with the API key or the invite token.
 *   - SENDER IDENTITY: Nemryn is the standard platform sender for every
 *     organization — there is no per-tenant sender domain/lookup.
 *     `EMAIL_FROM` is the ONE production source of the "From" address
 *     (`docs/product/driver-invite-linkage-model.md` §1D). The
 *     organization's real name still appears dynamically in the email's
 *     subject/body (`driver-invite-email.ts`) — only the technical
 *     sender is fixed to Nemryn. Custom tenant sending domains are a
 *     DEFERRED, future paid white-label capability, not built here (a
 *     prior local iteration of this codebase built a full per-tenant
 *     sender-verification schema and resolver for this; it was rolled
 *     back — see docs/reports/p0-s2a-wl-rollback-platform-sender.txt —
 *     once the commercial direction settled on a single standard
 *     sender).
 *
 * Production provider: Resend (https://resend.com) — a plain HTTPS POST,
 * no SDK dependency. Configure `RESEND_API_KEY` (server-only) and
 * `EMAIL_FROM` (Nemryn's own sender identity, e.g.
 * `"Nemryn <notifications@nemryn.com>"`, on a domain verified in Resend).
 *
 * Local development (no `RESEND_API_KEY`, `NODE_ENV !== "production"`):
 * the "log" transport writes the rendered message to the server console
 * so a developer can follow the link while testing. It is never used in
 * production.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always provided. */
  text: string;
  /** HTML body. Optional; falls back to `text`. */
  html?: string;
}

export type EmailResult =
  | { status: "sent"; provider: "resend" | "log"; id?: string }
  | { status: "failed"; provider: "resend" | "unknown"; detail: string }
  | { status: "not_configured" };

/**
 * Nemryn's own standard platform sender — used for every organization's
 * transactional email. `EMAIL_FROM` is the production source (set to
 * e.g. `"Nemryn <notifications@nemryn.com>"` on a domain verified in
 * Resend). The built-in default below is a neutral, honestly-labeled
 * placeholder for local/unconfigured environments — deliberately NOT
 * shaped like any tenant's own domain (Zenward Mobility's or anyone
 * else's): there is no per-tenant sender in this model at all.
 */
function fromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || "Nemryn <notifications@nemryn.com>";
}

export type EmailTransportStatus = "available" | "development" | "unavailable";

/**
 * What the PLATFORM's own email transport can do in this environment, known
 * without contacting any provider or revealing any secret (P1-PILOT-S4B-R4D).
 * "available" = a provider key is configured; "development" = no key but a
 * non-production process, so messages go to the server log transport (not real
 * delivery); "unavailable" = production with no provider configured -- sendEmail
 * would return `not_configured`. Tenants never configure this; Settings ->
 * Notifications only tells an Admin when delivery is currently unavailable.
 */
export function getEmailTransportStatus(): EmailTransportStatus {
  if (process.env.RESEND_API_KEY?.trim()) return "available";
  return process.env.NODE_ENV !== "production" ? "development" : "unavailable";
}

/**
 * Send one transactional email. Never throws — every outcome is a value.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (apiKey) {
    return sendViaResend(message, apiKey);
  }

  if (process.env.NODE_ENV !== "production") {
    // Dev-only console transport. Safe here: it runs on the developer's
    // own machine and the link is exactly what they need to test with.
    console.info(
      `[email:dev-transport] from=${fromAddress()} to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
    );
    return { status: "sent", provider: "log" };
  }

  // Production with no provider configured — the caller must NOT report
  // "sent". Safe diagnostic only; no secret, no token.
  console.warn("[email] transactional email not sent: no email provider configured (set RESEND_API_KEY)");
  return { status: "not_configured" };
}

async function sendViaResend(message: EmailMessage, apiKey: string): Promise<EmailResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { id?: string } | null;
      return { status: "sent", provider: "resend", id: body?.id };
    }

    // Keep the provider's own error OUT of anything the browser sees.
    // Log a bounded, key-free diagnostic server-side.
    const detail = `resend responded ${response.status}`;
    console.error(`[email] ${detail}`);
    return { status: "failed", provider: "resend", detail };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.name : "network error";
    console.error(`[email] resend request failed: ${detail}`);
    return { status: "failed", provider: "resend", detail };
  }
}
