import type { ReactNode } from "react";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { requirePlusAccess } from "@/lib/plus/access";

/**
 * NP-P1-S1 -- Growth (Nemryn Plus) area guard. Renders inside the existing Operations layout and shell (no second
 * shell). Organization Admin + an entitlement that allows entry (write / read_only); everyone else is redirected by
 * requirePlusAccess. Each Growth page re-checks the same guard itself (deduplicated per request).
 */
export default async function GrowthLayout({ children }: { children: ReactNode }) {
  const pathname = await getCurrentPathname("/operations/growth");
  await requirePlusAccess(pathname);
  return <>{children}</>;
}
