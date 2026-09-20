import type { ReactNode } from "react";
import { requirePlatformAdminAccess } from "@/lib/auth/platform";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { PlatformShell } from "@/components/platform/PlatformShell";

export const metadata = { title: { default: "Platform", template: "%s · Nemryn Platform" }, robots: { index: false, follow: false } };

/**
 * Server-side gate for every /platform/* route (P1-PILOT-S4B-R4E). Resolved
 * before any platform chrome renders: no session -> sign-in; no
 * PlatformAdminGrant -> 404 (an Organization Admin, Dispatcher or Driver has no
 * business here and is not told the surface exists). Independent of Membership
 * in both directions.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = await getCurrentPathname("/platform");
  const user = await requirePlatformAdminAccess(pathname);
  return <PlatformShell email={user.email ?? null}>{children}</PlatformShell>;
}
