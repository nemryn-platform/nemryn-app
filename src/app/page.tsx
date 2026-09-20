import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { resolveOrganizationContext } from "@/lib/auth/organization";
import { isPlatformAdmin } from "@/lib/auth/platform";
import { getSuspendedOrganizationNames } from "@/lib/auth/membership";

/**
 * Root route behavior (work item §27). This repository is the Zenward
 * Platform application — the public marketing homepage lives entirely in
 * the separate Zenward-Web repository (ZD-079); this route was previously
 * a placeholder verifying shared public-site primitives before that
 * separation was fully wired up (see docs/reports/
 * P1-E3-S1-completion-report.txt for the full history of this change).
 * `/` now resolves the authenticated landing destination server-side —
 * never a flash of placeholder/public content first.
 *
 * P1-E4-S0A1 §6: a zero-Membership visitor is no longer sent straight to
 * `/access-unavailable` — `/` is the one place ALL authenticated traffic
 * already passes through (including a session Supabase's own email
 * confirmation link established directly, which never touches the
 * sign-in Server Action at all), so it is also the one correct place to
 * route a possible pending-signup/invite continuation. `/complete-signup`
 * makes the actual determination (auto-complete, redeem, or fall through
 * to `/access-unavailable`/a recovery form) — this route does not
 * duplicate that logic, it only decides WHETHER to look.
 */
export default async function RootPage() {
  const user = await getUser();
  if (!user) {
    redirect("/sign-in");
  }

  const resolution = await resolveOrganizationContext();

  if (resolution.status === "none") {
    // R4E: a Nemryn Platform Admin with no tenant Membership lands in the
    // platform control plane; a member whose only workspace Nemryn has
    // suspended is told so rather than sent to organization signup.
    if (await isPlatformAdmin()) {
      redirect("/platform");
    }
    if ((await getSuspendedOrganizationNames()).length > 0) {
      redirect("/access-unavailable");
    }
    redirect("/complete-signup");
  }
  if (resolution.status === "select-required") {
    redirect("/select-organization");
  }

  const { role } = resolution.context;
  redirect(role === "driver" ? "/driver" : "/operations");
}
