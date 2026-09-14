# Driver Invitation Email — Production Configuration Checklist

**Phase:** P0-S2A — Driver Invitation Email Remediation Validation (sender
model finalized P0-S2A-WL-RB: Nemryn is the standard platform sender for
every organization — see `docs/product/driver-invite-linkage-model.md` §1D).
**Audience:** whoever has Resend + Vercel access and is authorized to
configure and deploy this fix.
**Status:** the application code is reviewed, tested, and ready. Nothing
below can be completed by this review — every step is a human action
against a real Resend account and the real Vercel project. **No secret
value is included in this document.**

---

## Before you start

This checklist assumes the reviewed code in this repository (currently
**uncommitted**) has been committed, pushed, and is ready to deploy.
Committing, pushing, and deploying are **separate, human-authorized
actions** this checklist does not perform and does not assume have
happened yet.

**Sender model:** every organization's driver-invitation email sends
from the SAME Nemryn address — there is no per-organization domain to
verify, and no tenant-side configuration step. (A per-tenant sender-
domain capability was built and evaluated, then deferred as a future
paid white-label feature — nothing below depends on it, and it is not
part of this checklist.)

## The steps

1. **Create / verify a Resend account.** This is Nemryn's own account —
   not per-tenant. If one doesn't already exist, create one at
   [resend.com](https://resend.com). If one already exists, confirm you
   have access to it.

2. **Verify Nemryn's own sending domain in Resend.** Add the domain
   Nemryn's platform email will send from (e.g. `nemryn.com`, or a
   subdomain such as `mail.nemryn.com`) in Resend's dashboard, and add
   the DNS records Resend provides (SPF/DKIM, typically a `TXT` and one
   or more `CNAME` records) to that domain's own DNS zone. Wait for
   Resend to show the domain as **verified** — sending from an unverified
   domain will fail or land in spam. This does not touch
   `app.zenwardmobility.com`'s own DNS or routing in any way — it is
   entirely about Nemryn's own sending domain.

3. **Configure `RESEND_API_KEY` in Vercel → Production.** Create an API
   key in Resend, then in the Vercel project's Settings → Environment
   Variables, add `RESEND_API_KEY` scoped to the **Production**
   environment (and Preview, if you want invitation emails to work from
   preview deployments too — optional). Mark it as a **sensitive**
   environment variable so its value is never shown in the dashboard or
   logs after saving.

4. **Configure `EMAIL_FROM` in Vercel → Production.** Add `EMAIL_FROM`
   set to a sender address on the domain verified in step 2, in the form
   `"Display Name <address@your-verified-domain>"` — for example
   `"Nemryn <notifications@nemryn.com>"`. This is Nemryn's own identity,
   the SAME value for every organization — not a secret; it does not
   need the "sensitive" flag, but it does need to exactly match a
   verified sending identity in Resend.

5. **Verify `NEXT_PUBLIC_APP_URL` is exactly `https://app.zenwardmobility.com`
   for the Production environment.** This is what the invitation email's
   `/join/<token>` link is built from. If it is missing, blank, set to a
   `localhost`/`127.0.0.1` value, or set to any other host, the invitation
   link will be wrong or the invite will be created with delivery
   explicitly reported as failed rather than emailing a broken link.
   Check this even if you believe it is already set — this is the single
   most common way this feature would silently misbehave.

6. **Confirm the environment values are actually applied to the current
   production deployment.** Setting a Vercel environment variable does
   **not** retroactively apply to an already-running deployment — a new
   deployment (a fresh build) is required for `NEXT_PUBLIC_APP_URL`
   specifically (it is inlined into the JavaScript bundle at build time,
   not read at server-start time), and is good practice for
   `RESEND_API_KEY`/`EMAIL_FROM` as well. After deploying the commit
   containing this fix (a separately authorized step), trigger — or wait
   for — the resulting Production deployment to complete before testing.

7. **Send one invite to a mailbox you personally control.** In
   production, sign in as a real Organization Admin (e.g. for Zenward
   Mobility) and invite a driver using an email address you can actually
   check (not a fictional/test address).

8. **Verify the sender, subject, and delivery of that email.** Confirm it
   arrives (check spam if it doesn't appear promptly), that the "From"
   name/address is exactly what you configured in step 4 (Nemryn's own
   identity — **not** the inviting organization's own domain, and the
   SAME for every organization that sends an invite), and that the
   subject reads `You're invited to drive for <the real organization
   name>` — e.g. `You're invited to drive for Zenward Mobility`.

9. **Open the invitation link from that email.** Confirm it is
   `https://app.zenwardmobility.com/join/<a token>` — not a `localhost`
   address, not a `*.vercel.app` preview address, and not a direct
   `/auth/confirm` link (the invitation email must never link there).

10. **Complete signup (or sign in, if you already have an account with
    that email).** Use the invited email address; the invitation link's
    own page will show which organization and name you were invited as.

11. **Redeem the invitation.** This normally happens automatically as
    part of completing signup — you should land directly on `/driver`
    with no extra step. If a Supabase account-confirmation email is
    required first (a separate email from this one), complete that step
    too; it is unrelated to this fix.

12. **Verify a Driver row was created** — in the Supabase Studio/SQL
    editor (or ask engineering to check), confirm exactly one `drivers`
    row exists for the account you just created, in the correct
    organization.

13. **Verify the Membership role is `driver`** — confirm exactly one
    `memberships` row for that account, `role = 'driver'`, `status =
    'active'`, in the correct organization.

14. **Verify the organization is correct** — the Driver and Membership
    rows from steps 12-13 should both reference the SAME organization as
    the one the invite was created from in step 7, and no other
    organization.

15. **Verify the invite status is `accepted`** — the `driver_invites` row
    you created in step 7 should now read `status = 'accepted'`, with
    `accepted_by` set to the new account's user id.

16. **Repeat step 7-15 with an invite from a DIFFERENT organization**, if
    a second one exists. Confirm the "From" address (Nemryn's, unchanged)
    is identical, while the subject/body correctly name the different
    organization — this is the direct confirmation that sender identity
    is standardized and content stays per-tenant dynamic.

## If something goes wrong

- **The invite was created but no email arrived, and the app said
  delivery failed or "not configured":** re-check steps 3-6. The app
  deliberately never claims an email was sent when it wasn't — that
  message is the system telling you the truth, not a bug. The invite
  itself is still valid; use the **Resend** control in the Pending
  Invites list once the configuration is fixed — this does not create a
  duplicate invite.
- **The email arrived but the link is wrong (localhost, a preview
  domain, etc.):** re-check step 5 and re-deploy (step 6) — this is
  virtually always a `NEXT_PUBLIC_APP_URL` build-time issue.
- **The email arrived from the wrong address, or the organization name
  is missing/wrong in the subject or body:** re-check step 4
  (`EMAIL_FROM`) for the sender, and confirm the invite was created from
  the correct organization's own admin session for the content — there
  is no per-tenant sender configuration to check; the sender is always
  the single platform value.
- **You need to roll back:** removing or blanking `RESEND_API_KEY` in
  Vercel and redeploying returns the feature to its previous
  (documented, non-crashing) behavior — invites are created, delivery is
  honestly reported as not configured, and no driver-facing regression
  results. No database change is involved in this fix at all, so there
  is nothing to roll back at the schema/RLS level.

No secret value (API key, password, or token) appears anywhere in this
document.
