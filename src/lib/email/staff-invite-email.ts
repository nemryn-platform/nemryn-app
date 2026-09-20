import "server-only";
import type { EmailMessage } from "./send";
import { staffRoleLabel } from "@/lib/operations/team-core";

export interface StaffInviteEmailInput {
  organizationName: string;
  /** The address the invitation is for -- shown so a wrong recipient can tell. */
  recipientEmail: string;
  /** "admin" | "dispatcher" label, e.g. "Dispatcher". */
  role: string;
  /** Absolute `/team-invite/<token>` URL -- see src/lib/app-url.ts. */
  inviteUrl: string;
}

/**
 * The STAFF invitation email (P1-PILOT-S4B-R4C). Same sender/sending
 * discipline as the driver invitation email (Nemryn is the platform sender
 * for every organization; the organization's real name appears in the
 * subject/body). Never states whether the recipient already has an account.
 */
export function buildStaffInviteEmail(input: StaffInviteEmailInput): EmailMessage {
  const { organizationName, recipientEmail, inviteUrl } = input;
  const role = staffRoleLabel(input.role);
  const subject = `You're invited to join ${organizationName} on Nemryn`;

  const text = [
    `${organizationName} has invited you to join their team as ${role}.`,
    ``,
    `Use the secure link below to accept the invitation:`,
    ``,
    inviteUrl,
    ``,
    `This invitation is intended for ${recipientEmail} and expires in 7 days.`,
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
            <strong>${escapeHtml(organizationName)}</strong> has invited you to join their team as ${escapeHtml(role)}.
          </p>
          <p style="margin:0 0 20px 0;font-size:14px;line-height:22px;color:#3e535c;">
            Use the secure link below to accept the invitation.
          </p>
          <p style="margin:0 0 20px 0;">
            <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;padding:10px 18px;background:#123447;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Accept invitation</a>
          </p>
          <p style="margin:0 0 4px 0;font-size:13px;line-height:20px;color:#3e535c;word-break:break-all;">
            Or open this link: <a href="${escapeHtml(inviteUrl)}" style="color:#178577;">${escapeHtml(inviteUrl)}</a>
          </p>
          <p style="margin:16px 0 0 0;font-size:13px;line-height:20px;color:#64777e;">
            This invitation is intended for ${escapeHtml(recipientEmail)} and expires in 7 days. If you weren't expecting it, you can ignore this email.
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
