import "server-only";
import type { EmailMessage } from "./send";

/**
 * Notification emails (P1-PILOT-S4B-R4D). PRIVACY POSTURE: an email tells a
 * staff member that something needs attention and links into Nemryn; it never
 * duplicates the underlying record. Transportation Requests and Trips can hold
 * sensitive personal information, so these messages deliberately contain ONLY:
 *   - website request: that a request arrived, its requested DATE (if given) and
 *     its service CATEGORY (if given), and a link to the Request Hub;
 *   - trip exception: that an issue was reported, the trip's scheduled pickup
 *     time (organization timezone), and a link to Trips.
 * Never included: requester/passenger names, phone numbers or emails, pickup or
 * destination addresses, assistance/additional notes, exception type or
 * description, internal identifiers, integration details, or any technical/
 * provider information. Links are to list pages (no record ids).
 */

export interface NotificationEmailInput {
  eventType: "website_request" | "trip_exception";
  recipient: string;
  organizationName: string;
  /** Absolute app origin, e.g. https://app.nemryn.com -- no trailing slash. */
  appOrigin: string;
  /** website_request: "YYYY-MM-DD" when the requester gave a date. */
  requestedDate?: string | null;
  /** website_request: a HUMAN service label (already mapped from the identifier). */
  serviceLabel?: string | null;
  /** trip_exception: ISO instant of the trip's scheduled pickup. */
  pickupAt?: string | null;
  timezone: string;
}

function formatRequestedDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  // A plain calendar date: format it in UTC so no timezone can shift the day.
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", year: "numeric", month: "short", day: "numeric" }).format(date);
}

function formatPickup(iso: string, timezone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function buildNotificationEmail(input: NotificationEmailInput): EmailMessage {
  const { organizationName, appOrigin } = input;
  let subject: string;
  let headline: string;
  const details: string[] = [];
  let linkLabel: string;
  let linkUrl: string;

  if (input.eventType === "website_request") {
    subject = `New transportation request — ${organizationName}`;
    headline = "A new transportation request was received through your website.";
    const requested = input.requestedDate ? formatRequestedDate(input.requestedDate) : null;
    if (requested) details.push(`Requested date: ${requested}`);
    if (input.serviceLabel) details.push(`Service: ${input.serviceLabel}`);
    linkLabel = "Open Request Hub";
    linkUrl = `${appOrigin}/operations/requests`;
  } else {
    subject = `Trip issue reported — ${organizationName}`;
    headline = "An issue was reported on a trip.";
    const pickup = input.pickupAt ? formatPickup(input.pickupAt, input.timezone) : null;
    if (pickup) details.push(`Scheduled pickup: ${pickup}`);
    linkLabel = "Open Trips";
    linkUrl = `${appOrigin}/operations/trips`;
  }

  const footer = `You're receiving this because ${organizationName} has this notification turned on. An Organization Admin can change it under Settings → Notifications.`;

  const text = [headline, "", ...details, ...(details.length ? [""] : []), `${linkLabel}: ${linkUrl}`, "", footer].join("\n");

  const detailHtml = details.map((line) => `<p style="margin:0 0 6px 0;font-size:14px;line-height:22px;color:#3e535c;">${escapeHtml(line)}</p>`).join("");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f9fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#101f27;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #d5dee1;border-radius:10px;">
      <tr>
        <td style="padding:28px 28px 24px 28px;">
          <p style="margin:0 0 16px 0;font-size:16px;line-height:24px;"><strong>${escapeHtml(headline)}</strong></p>
          ${detailHtml}
          <p style="margin:20px 0;">
            <a href="${escapeHtml(linkUrl)}" style="display:inline-block;padding:10px 18px;background:#123447;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(linkLabel)}</a>
          </p>
          <p style="margin:16px 0 0 0;font-size:13px;line-height:20px;color:#64777e;">${escapeHtml(footer)}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { to: input.recipient, subject, text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
