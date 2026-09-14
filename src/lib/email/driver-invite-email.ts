import "server-only";
import type { EmailMessage } from "./send";

export interface DriverInviteEmailInput {
  organizationName: string;
  /** The address the invite is for — shown in the body so a wrong recipient can tell. */
  recipientEmail: string;
  /** Absolute `/join/<token>` URL — see src/lib/app-url.ts. */
  joinUrl: string;
}

/**
 * The DRIVER INVITATION EMAIL (G0-R3 STEP 7). This is NOT the Supabase
 * account-confirmation email — it is the first message, telling the
 * invited person their operator has invited them and giving them the
 * secure `/join/<token>` link. Account confirmation is Supabase's job
 * afterwards, once they sign up.
 *
 * The driver is being invited to work for the OPERATOR, so the email's
 * SUBJECT/BODY name the organization by its real, dynamic name — never
 * "Zenward" unless the organization actually is Zenward Mobility, never
 * hard-coded. No marketing language, no "AI" language.
 *
 * SENDER (P0-S2A-WL-RB — standardized on the Nemryn platform sender):
 * the technical "From" is Nemryn's own address (`send.ts`'s
 * `EMAIL_FROM`/its fallback), the SAME for every organization — there is
 * no per-tenant sender lookup here or anywhere else in this file. No
 * "Sent by …" / "Powered by …" attribution line of any kind is added —
 * the recipient already sees "Nemryn" as the sender in their own inbox,
 * so restating it in the body would be redundant, and the organization's
 * name already carries the content. See
 * `docs/product/driver-invite-linkage-model.md` §1D for the full
 * rationale and `docs/reports/p0-s2a-wl-rollback-platform-sender.txt`
 * for why a prior, per-tenant-sender-domain version of this was rolled
 * back.
 */
export function buildDriverInviteEmail(input: DriverInviteEmailInput): EmailMessage {
  const { organizationName, recipientEmail, joinUrl } = input;

  const subject = `You're invited to drive for ${organizationName}`;

  const text = [
    `${organizationName} has invited you to join their driver team.`,
    ``,
    `Use the secure link below to create your account and accept the invitation:`,
    ``,
    joinUrl,
    ``,
    `This invitation is intended for ${recipientEmail}.`,
    ``,
    `If you weren't expecting this invitation, you can ignore this email.`,
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f9fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#101f27;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #d5dee1;border-radius:10px;">
      <tr>
        <td style="padding:28px 28px 24px 28px;">
          <p style="margin:0 0 16px 0;font-size:16px;line-height:24px;">
            <strong>${escapeHtml(organizationName)}</strong> has invited you to join their driver team.
          </p>
          <p style="margin:0 0 20px 0;font-size:14px;line-height:22px;color:#3e535c;">
            Use the secure link below to create your account and accept the invitation.
          </p>
          <p style="margin:0 0 20px 0;">
            <a href="${escapeAttr(joinUrl)}" style="display:inline-block;padding:10px 18px;background:#123447;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Accept invitation</a>
          </p>
          <p style="margin:0 0 4px 0;font-size:13px;line-height:20px;color:#3e535c;word-break:break-all;">
            Or open this link: <a href="${escapeAttr(joinUrl)}" style="color:#178577;">${escapeHtml(joinUrl)}</a>
          </p>
          <p style="margin:16px 0 0 0;font-size:13px;line-height:20px;color:#64777e;">
            This invitation is intended for ${escapeHtml(recipientEmail)}. If you weren't expecting this invitation, you can ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { to: recipientEmail, subject, text, html };
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

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
