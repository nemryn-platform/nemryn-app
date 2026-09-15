import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRequestedOrganizationId, resolveOrganizationContext } from "@/lib/auth/organization";
import { isSafeRedirectPath } from "@/lib/auth/redirect";
import { OrganizationSelector } from "@/components/auth/OrganizationSelector";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

export const metadata = { title: "Select workspace" };

/**
 * Only reachable meaningfully by a multi-org user with no (or a stale)
 * organization-context cookie — a single-org user or one who already has
 * a valid selection is redirected onward immediately, avoiding an
 * unnecessary extra screen (work item §27).
 *
 * P1-UX-R1A: `?switch=1` is the one exception to that immediate redirect
 * — it is how AccountMenu's explicit "Switch Organization" action reaches
 * this page. It ONLY ever controls whether the picker below is shown
 * instead of the normal auto-redirect; it carries no organization id and
 * is never trusted as one. `resolveOrganizationContext`'s own
 * `forceSelection` option still funnels through the exact same
 * membership-validated resolution as every other caller — a single-org
 * user still gets `status: "single"` (redirected onward exactly as
 * before, work item §7) even with `?switch=1` present, since there is
 * nothing for them to switch to.
 */
export default async function SelectOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser("/sign-in?next=%2Fselect-organization");

  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? params.next : undefined;
  const next = isSafeRedirectPath(nextParam) ? nextParam : undefined;
  const switchRequested = params.switch === "1";

  const resolution = await resolveOrganizationContext({ forceSelection: switchRequested });

  if (resolution.status === "none") {
    // P1-E4-S0A1 §6 — same reasoning as the route guards in
    // src/lib/auth/authorization.ts: route through the pending-signup/
    // invite continuation rather than straight to `/access-unavailable`.
    redirect("/complete-signup");
  }
  if (resolution.status === "single" || resolution.status === "selected") {
    redirect(next ?? "/");
  }
  if (resolution.status !== "select-required") {
    // Unreachable given the two branches above, but keeps this narrowing
    // explicit for TypeScript rather than an unchecked cast.
    redirect("/");
  }

  // P1-UX-R1A: display-only — which membership the caller was already
  // using, purely so the picker can mark it "Current" while explicitly
  // switching. Never used for authorization: the actual selection below
  // is still exclusively validated by selectOrganizationAction against a
  // fresh getActiveMemberships() call, exactly as before.
  const currentOrganizationId = switchRequested ? await getRequestedOrganizationId() : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      <h1 className={cn(typography.sectionHeading, "mb-1 text-text-primary")}>Select a workspace</h1>
      <p className={cn(typography.bodySmall, "mb-6 text-text-secondary")}>
        Your account has access to more than one Nemryn workspace. Choose which one to continue with.
      </p>
      <OrganizationSelector memberships={resolution.memberships} next={next} currentOrganizationId={currentOrganizationId} />
    </div>
  );
}
