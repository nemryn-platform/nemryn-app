import { requireOnboardingAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { BusinessBasicsForm } from "@/components/onboarding/BusinessBasicsForm";

/**
 * Business Basics — step 1 of 5, required within the guided flow
 * (P1-OPS-PROG3B). The organization's current timezone comes from the
 * server-resolved context, so the form shows what is actually stored.
 */
export default async function BusinessBasicsPage() {
  const pathname = await getCurrentPathname("/onboarding/basics");
  const organization = await requireOnboardingAccess(pathname);
  return <BusinessBasicsForm currentTimezone={organization.organizationTimezone} />;
}
