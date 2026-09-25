import { getUser } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/auth/profile";
import { OwnerDriverForm } from "./OwnerDriverForm";
import { typography } from "@/design/typography";
import { cn } from "@/lib/cn";

/**
 * Owner-Driver choice (P1-E3-S9, work item §4/§5) — "Support the reality
 * that one person may be Owner + Dispatcher + Driver." Never collapses
 * roles insecurely — see `setOwnerAlsoDrivesAction`/`link_self_as_driver`
 * and docs/product/owner-operator-mode.md for the full contract.
 */
export default async function OnboardingDriverPage() {
  const user = await getUser();
  const defaultName = user ? await getDisplayName(user.id, user.email ?? null) : "";

  return (
    <>
      <div>
        <p className={cn(typography.metadata, "text-text-secondary")}>Step 3 of 5</p>
        <h1 className={cn(typography.sectionHeading, "mt-1 text-text-primary")}>Do you also drive?</h1>
        <p className={cn(typography.bodySmall, "mt-2 text-text-secondary")}>
          Many small operators are the owner, dispatcher, and driver — Nemryn supports that. This keeps your
          Operations access exactly as it is and additionally sets you up to receive and run trips as a driver.
        </p>
      </div>

      <OwnerDriverForm defaultName={defaultName} />
    </>
  );
}
