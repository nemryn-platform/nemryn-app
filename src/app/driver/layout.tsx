import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { IdentificationCard } from "@phosphor-icons/react/dist/ssr";
import { requireDriverAccess } from "@/lib/auth/authorization";
import { getCurrentPathname } from "@/lib/auth/current-path";
import { signOutAction } from "@/lib/auth/sign-out-action";
import { DriverLayoutClient } from "@/components/driver/DriverLayoutClient";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

/**
 * PWA identity (P1-PILOT-S5A): the installable "Nemryn Driver" app. The manifest,
 * icons and iOS home-screen title are attached to the Driver surface only -- the
 * Operations and Platform workspaces are not installable apps. Nothing here is
 * tenant-specific.
 */
export const metadata: Metadata = {
  manifest: "/driver.webmanifest",
  applicationName: "Nemryn Driver",
  appleWebApp: { capable: true, title: "Nemryn Driver", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#171A1D",
  // On Android the on-screen keyboard resizes the layout viewport, so the fixed shell never hides a focused field.
  interactiveWidget: "resizes-content",
};

/**
 * Server-side authorization gate for every /driver/* route (work item
 * §9/§25/§26). A Membership with role=driver but no resolvable linked
 * Driver record renders a safe account-configuration state INLINE (never
 * a redirect back into this same guard — that would loop, work item §60).
 */
export default async function DriverLayout({ children }: { children: ReactNode }) {
  const pathname = await getCurrentPathname("/driver");
  const access = await requireDriverAccess(pathname);

  if (access.status === "link-missing") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <EmptyState
          icon={<IdentificationCard className="size-8" aria-hidden />}
          title="Driver account not yet set up"
          description="Your account has driver access in this organization, but it isn't linked to a driver profile yet. Contact your dispatcher to finish setting up your account."
        />
        <form action={signOutAction} className="mt-6">
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </div>
    );
  }

  // P1-E3-S9 (Owner-Operator Mode) — true only when this person's real
  // Membership.role for this org is organization_admin/dispatcher (they
  // reached here via the relaxed guard as a dual-hat owner-operator, not
  // as an ordinary Driver-only Membership) — see requireDriverAccess's
  // own comment for why role, not a separate flag, is the right signal.
  const showOperationsLink = access.organization.role !== "driver";

  return (
    <DriverLayoutClient driverName={access.displayName} showOperationsLink={showOperationsLink}>
      {children}
    </DriverLayoutClient>
  );
}
